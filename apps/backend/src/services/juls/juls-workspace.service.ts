import { HttpException, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { sign } from 'jsonwebtoken';
import { Prisma, JulsWorkspace } from '@prisma/client';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { julsConfiguration } from './juls-auth.guard';
import {
  JulsHandoffDto,
  JulsMaxChannelDto,
  JulsProvisionDto,
  JulsWorkspaceDto,
} from './juls.dto';
import { MaxProvider } from '@gitroom/nestjs-libraries/integrations/social/max.provider';

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const fail = (error: string, status = 409): never => {
  throw new HttpException({ error }, status);
};

@Injectable()
export class JulsWorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  // Every lifecycle operation takes the same lock, including a revoke before creation.
  private async locked<T>(
    externalWorkspaceId: string,
    run: (
      tx: Prisma.TransactionClient,
      workspace: JulsWorkspace | null
    ) => Promise<T>
  ) {
    const { issuer } = julsConfiguration();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(
        [issuer, externalWorkspaceId]
      )}, 0))`;
      const workspace = await tx.julsWorkspace.findUnique({
        where: { issuer_externalWorkspaceId: { issuer, externalWorkspaceId } },
      });
      return run(tx, workspace);
    });
  }

  private async active(
    tx: Prisma.TransactionClient,
    workspace: JulsWorkspace | null
  ) {
    if (!workspace) fail('workspace_not_found', 404);
    if (workspace.revokedAt) fail('workspace_revoked', 410);
    if (!workspace.organizationId || !workspace.userId || !workspace.oauthAppId)
      fail('workspace_access_revoked', 410);
    const { clientId } = julsConfiguration();
    const app = await tx.oAuthApp.findFirst({
      where: { id: workspace.oauthAppId, clientId, deletedAt: null },
    });
    if (!app) fail('juls_app_unavailable', 503);
    const membership = await tx.userOrganization.findFirst({
      where: {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
        disabled: false,
        user: { activated: true },
      },
    });
    if (!membership) fail('workspace_access_revoked', 410);
    return workspace;
  }

  async provision(input: JulsProvisionDto, requestId: string) {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId || ''))
      fail('invalid_idempotency_key', 400);
    const requestDigest = digest(
      JSON.stringify([
        input.externalWorkspaceId,
        input.owner.externalUserId,
        input.owner.name,
        input.organization.name,
      ])
    );
    const { issuer, clientId } = julsConfiguration();
    return this.locked(input.externalWorkspaceId, async (tx, existing) => {
      if (existing?.revokedAt) fail('workspace_revoked', 410);
      let workspace = existing;
      if (!workspace) {
        const app = await tx.oAuthApp.findFirst({
          where: { clientId, deletedAt: null },
        });
        if (!app) fail('juls_app_unavailable', 503);
        const userId = randomUUID();
        const user = await tx.user.create({
          data: {
            id: userId,
            email: `${userId}@juls.invalid`,
            name: input.owner.name,
            providerName: 'JULS',
            timezone: 0,
            password: null,
            isSuperAdmin: false,
            sendSuccessEmails: false,
            sendFailureEmails: false,
            sendStreakEmails: false,
          },
        });
        const organization = await tx.organization.create({
          data: {
            name: input.organization.name,
            allowTrial: false,
            isTrailing: false,
            users: { create: { userId: user.id, role: 'SUPERADMIN' } },
          },
        });
        workspace = await tx.julsWorkspace.create({
          data: {
            issuer,
            externalWorkspaceId: input.externalWorkspaceId,
            externalOwnerId: input.owner.externalUserId,
            organizationId: organization.id,
            userId: user.id,
            oauthAppId: app.id,
          },
        });
        await tx.julsAuditEvent.create({
          data: {
            workspaceId: workspace.id,
            action: 'provisioned',
            actorId: input.owner.externalUserId,
          },
        });
      }
      await this.active(tx, workspace);
      if (workspace.externalOwnerId !== input.owner.externalUserId)
        fail('owner_conflict');
      const previous = await tx.julsBootstrapCode.findUnique({
        where: {
          workspaceId_requestId: { workspaceId: workspace.id, requestId },
        },
      });
      if (previous) {
        if (previous.requestDigest !== requestDigest)
          fail('idempotency_conflict');
        if (previous.consumedAt || previous.expiresAt <= new Date())
          fail('bootstrap_attempt_finished');
        const authorization = await tx.oAuthAuthorization.findUnique({
          where: { id: previous.authorizationId },
        });
        if (authorization.revokedAt) fail('authorization_revoked', 410);
        return {
          organizationId: workspace.organizationId,
          userId: workspace.userId,
          authorizationCode: AuthService.fixedDecryption(
            previous.encryptedCode
          ),
          expiresAt: previous.expiresAt.toISOString(),
          alreadyExisted: !!existing,
        };
      }
      const authorization = await tx.oAuthAuthorization.upsert({
        where: {
          oauthAppId_userId_organizationId: {
            oauthAppId: workspace.oauthAppId,
            userId: workspace.userId,
            organizationId: workspace.organizationId,
          },
        },
        create: {
          oauthAppId: workspace.oauthAppId,
          userId: workspace.userId,
          organizationId: workspace.organizationId,
        },
        update: {}, // Never clear a working token or resurrect a revoked grant.
      });
      if (authorization.revokedAt) fail('authorization_revoked', 410);
      const code = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 180_000);
      await tx.julsBootstrapCode.create({
        data: {
          workspaceId: workspace.id,
          authorizationId: authorization.id,
          requestId,
          requestDigest,
          codeDigest: digest(code),
          encryptedCode: AuthService.fixedEncryption(code),
          expiresAt,
        },
      });
      await tx.julsAuditEvent.create({
        data: {
          workspaceId: workspace.id,
          action: 'bootstrap_issued',
          actorId: input.owner.externalUserId,
        },
      });
      return {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
        authorizationCode: code,
        expiresAt: expiresAt.toISOString(),
        alreadyExisted: !!existing,
      };
    });
  }

  async handoff(input: JulsHandoffDto) {
    // Deployment-controlled URL only; callers cannot select a redirect or origin.
    const base = process.env.NEXT_PUBLIC_BACKEND_URL;
    const frontend = process.env.FRONTEND_URL;
    if (!base || !frontend) fail('handoff_not_configured', 503);
    const url = new URL(`${base.replace(/\/$/, '')}/internal/juls/session`);
    if (url.protocol !== 'https:' && !process.env.NOT_SECURED)
      fail('handoff_requires_https', 503);
    return this.locked(input.externalWorkspaceId, async (tx, workspace) => {
      await this.active(tx, workspace);
      if (workspace.externalOwnerId !== input.actorExternalUserId)
        fail('actor_forbidden', 403);
      const ticket = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + 60_000);
      await tx.julsHandoff.create({
        data: {
          ticketDigest: digest(ticket),
          workspaceId: workspace.id,
          actorId: input.actorExternalUserId,
          expiresAt,
        },
      });
      await tx.julsAuditEvent.create({
        data: {
          workspaceId: workspace.id,
          action: 'handoff_issued',
          actorId: input.actorExternalUserId,
        },
      });
      url.searchParams.set('ticket', ticket);
      return { url: url.toString(), expiresAt: expiresAt.toISOString() };
    });
  }

  async connectMaxChannel(input: JulsMaxChannelDto) {
    // Authorize before calling MAX, then take the same lock again for the write.
    // This keeps a remote request out of a database transaction while the second
    // active() check prevents a concurrent revoke from creating a channel.
    await this.locked(input.externalWorkspaceId, async (tx, workspace) => {
      await this.active(tx, workspace);
      if (workspace.externalOwnerId !== input.actorExternalUserId)
        fail('actor_forbidden', 403);
    });

    const verified = await new MaxProvider().authenticateJulsChannel({
      chatId: input.channelId,
      maxUserId: input.maxUserId,
    });
    if (typeof verified === 'string') return fail(verified, 400);

    return this.locked(input.externalWorkspaceId, async (tx, workspace) => {
      await this.active(tx, workspace);
      if (workspace.externalOwnerId !== input.actorExternalUserId)
        fail('actor_forbidden', 403);

      const integration = await tx.integration.upsert({
        where: {
          organizationId_internalId: {
            organizationId: workspace.organizationId,
            internalId: verified.id,
          },
        },
        create: {
          organizationId: workspace.organizationId,
          internalId: verified.id,
          rootInternalId: verified.id,
          name: verified.name,
          picture: verified.picture || undefined,
          providerIdentifier: 'max',
          type: 'social',
          token: verified.accessToken,
          refreshToken: '',
          profile: '',
        },
        update: {
          name: verified.name,
          picture: verified.picture || undefined,
          providerIdentifier: 'max',
          type: 'social',
          token: verified.accessToken,
          refreshToken: '',
          disabled: false,
          deletedAt: null,
          refreshNeeded: false,
        },
      });
      await tx.julsAuditEvent.create({
        data: {
          workspaceId: workspace.id,
          action: 'max_channel_connected',
          actorId: input.actorExternalUserId,
        },
      });
      return {
        integrationId: integration.id,
        channelId: input.channelId,
        name: integration.name,
      };
    });
  }

  async consumeHandoff(ticket: string) {
    if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket))
      fail('invalid_handoff', 401);
    const { issuer } = julsConfiguration();
    const found = await this.prisma.julsHandoff.findUnique({
      where: { ticketDigest: digest(ticket) },
      include: { workspace: true },
    });
    if (!found || found.workspace.issuer !== issuer)
      fail('invalid_handoff', 401);
    return this.locked(
      found.workspace.externalWorkspaceId,
      async (tx, workspace) => {
        await this.active(tx, workspace);
        const consumed = await tx.julsHandoff.updateMany({
          where: {
            ticketDigest: digest(ticket),
            consumedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { consumedAt: new Date() },
        });
        if (!consumed.count) fail('invalid_handoff', 401);
        const expiresAt = new Date(Date.now() + 30 * 60_000);
        const jwt = sign(
          {
            id: workspace.userId,
            julsWorkspaceId: workspace.id,
            organizationId: workspace.organizationId,
          },
          process.env.JWT_SECRET!,
          { expiresIn: '30m' }
        );
        await tx.julsAuditEvent.create({
          data: {
            workspaceId: workspace.id,
            action: 'handoff_consumed',
            actorId: found.actorId,
          },
        });
        return { jwt, organizationId: workspace.organizationId, expiresAt };
      }
    );
  }

  async revoke(input: JulsWorkspaceDto) {
    const { issuer } = julsConfiguration();
    return this.locked(input.externalWorkspaceId, async (tx, existing) => {
      if (existing?.revokedAt) return { revoked: true };
      const workspace = existing
        ? await tx.julsWorkspace.update({
            where: { id: existing.id },
            data: { revokedAt: new Date() },
          })
        : await tx.julsWorkspace.create({
            data: {
              issuer,
              externalWorkspaceId: input.externalWorkspaceId,
              revokedAt: new Date(),
            },
          });
      if (workspace.organizationId) {
        await tx.oAuthAuthorization.updateMany({
          where: { organizationId: workspace.organizationId },
          data: {
            revokedAt: new Date(),
            accessToken: null,
            authorizationCode: null,
            codeExpiresAt: null,
          },
        });
        await tx.userOrganization.updateMany({
          where: { organizationId: workspace.organizationId },
          data: { disabled: true },
        });
        await tx.user.update({
          where: { id: workspace.userId },
          data: { activated: false },
        });
        await tx.organization.update({
          where: { id: workspace.organizationId },
          data: { apiKey: null },
        });
      }
      await tx.julsHandoff.updateMany({
        where: { workspaceId: workspace.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.julsBootstrapCode.updateMany({
        where: { workspaceId: workspace.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.julsAuditEvent.create({
        data: { workspaceId: workspace.id, action: 'access_revoked' },
      });
      return { revoked: true };
    });
  }
}
