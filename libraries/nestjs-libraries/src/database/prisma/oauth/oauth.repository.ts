import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class OAuthRepository {
  constructor(
    private _oauthApp: PrismaRepository<'oAuthApp'>,
    private _oauthAuth: PrismaRepository<'oAuthAuthorization'>,
    private transaction: PrismaTransaction
  ) {}

  getAppByOrgId(orgId: string) {
    return this._oauthApp.model.oAuthApp.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
      include: {
        picture: true,
      },
    });
  }

  getAppByClientId(clientId: string) {
    return this._oauthApp.model.oAuthApp.findFirst({
      where: {
        clientId,
        deletedAt: null,
      },
      include: {
        picture: true,
      },
    });
  }

  createApp(
    orgId: string,
    data: {
      name: string;
      description?: string;
      pictureId?: string;
      redirectUrl: string;
      clientId: string;
      clientSecret: string;
    }
  ) {
    return this._oauthApp.model.oAuthApp.create({
      data: {
        organizationId: orgId,
        name: data.name,
        description: data.description,
        pictureId: data.pictureId,
        redirectUrl: data.redirectUrl,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
      },
      include: {
        picture: true,
      },
    });
  }

  createDynamicApp(data: {
    name: string;
    redirectUrl: string;
    redirectUris: string;
    clientId: string;
    clientSecret?: string;
    tokenEndpointAuthMethod: string;
  }) {
    return this._oauthApp.model.oAuthApp.create({
      data: {
        name: data.name,
        redirectUrl: data.redirectUrl,
        redirectUris: data.redirectUris,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
        tokenEndpointAuthMethod: data.tokenEndpointAuthMethod,
        dynamic: true,
      },
    });
  }

  // Dynamic clients register before the consent screen, so abandoned flows
  // leave orphan rows; prune the ones no user ever authorized
  deleteStaleDynamicApps(olderThan: Date) {
    return this._oauthApp.model.oAuthApp.deleteMany({
      where: {
        dynamic: true,
        createdAt: { lt: olderThan },
        authorizations: { none: {} },
      },
    });
  }

  async updateApp(
    orgId: string,
    data: {
      name?: string;
      description?: string;
      pictureId?: string;
      redirectUrl?: string;
    }
  ) {
    const app = await this._oauthApp.model.oAuthApp.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
    });
    if (!app) {
      return null;
    }
    return this._oauthApp.model.oAuthApp.update({
      where: { id: app.id },
      data,
      include: {
        picture: true,
      },
    });
  }

  async deleteApp(orgId: string) {
    const app = await this._oauthApp.model.oAuthApp.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
    });
    if (!app) {
      return null;
    }
    return this._oauthApp.model.oAuthApp.update({
      where: { id: app.id },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  async updateClientSecret(orgId: string, newSecret: string) {
    const app = await this._oauthApp.model.oAuthApp.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
    });
    if (!app) {
      return null;
    }
    return this._oauthApp.model.oAuthApp.update({
      where: { id: app.id },
      data: {
        clientSecret: newSecret,
      },
    });
  }

  createAuthorization(data: {
    oauthAppId: string;
    userId: string;
    organizationId: string;
    authorizationCode: string;
    codeExpiresAt: Date;
    codeChallenge?: string;
    codeChallengeMethod?: string;
    redirectUri?: string;
  }) {
    return this._oauthAuth.model.oAuthAuthorization.upsert({
      where: {
        oauthAppId_userId_organizationId: {
          oauthAppId: data.oauthAppId,
          userId: data.userId,
          organizationId: data.organizationId,
        },
      },
      create: {
        oauthAppId: data.oauthAppId,
        userId: data.userId,
        organizationId: data.organizationId,
        authorizationCode: data.authorizationCode,
        codeExpiresAt: data.codeExpiresAt,
        codeChallenge: data.codeChallenge || null,
        codeChallengeMethod: data.codeChallengeMethod || null,
        redirectUri: data.redirectUri || null,
      },
      update: {
        authorizationCode: data.authorizationCode,
        codeExpiresAt: data.codeExpiresAt,
        codeChallenge: data.codeChallenge || null,
        codeChallengeMethod: data.codeChallengeMethod || null,
        redirectUri: data.redirectUri || null,
        accessToken: null,
        revokedAt: null,
      },
    });
  }

  findByCode(encryptedCode: string) {
    return this._oauthAuth.model.oAuthAuthorization.findFirst({
      where: {
        authorizationCode: encryptedCode,
        revokedAt: null,
      },
    });
  }

  async exchangeCodeForToken(
    id: string,
    encryptedCode: string,
    encryptedToken: string
  ) {
    return this.transaction.model.$transaction(async (tx) => {
      const consumed = await tx.oAuthAuthorization.updateMany({
        where: {
          id,
          authorizationCode: encryptedCode,
          codeExpiresAt: { gt: new Date() },
          revokedAt: null,
        },
        data: {
          accessToken: encryptedToken,
          authorizationCode: null,
          codeExpiresAt: null,
          codeChallenge: null,
          codeChallengeMethod: null,
          redirectUri: null,
        },
      });
      if (!consumed.count) return null;
      return tx.oAuthAuthorization.findUnique({
        where: { id },
        select: {
          organizationId: true,
          organization: { select: { paymentId: true } },
        },
      });
    });
  }

  async exchangeJulsCode(
    code: string,
    oauthAppId: string,
    candidateToken: string
  ) {
    return this.transaction.model.$transaction(async (tx) => {
      const challenge = await tx.julsBootstrapCode.findUnique({
        where: { codeDigest: createHash('sha256').update(code).digest('hex') },
        include: { workspace: true },
      });
      if (!challenge || challenge.workspace.oauthAppId !== oauthAppId)
        return null;
      const { issuer, externalWorkspaceId } = challenge.workspace;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(
        [issuer, externalWorkspaceId]
      )}, 0))`;
      const workspace = await tx.julsWorkspace.findUnique({
        where: { id: challenge.workspaceId },
      });
      if (workspace.revokedAt) return null;
      // Lock the grant against normal revocation as well as parallel exchanges.
      await tx.$queryRaw`SELECT "id" FROM "OAuthAuthorization" WHERE "id" = ${challenge.authorizationId} FOR UPDATE`;
      const authorization = await tx.oAuthAuthorization.findFirst({
        where: {
          id: challenge.authorizationId,
          oauthAppId,
          revokedAt: null,
          oauthApp: { deletedAt: null },
          user: { activated: true },
        },
        include: { organization: { select: { paymentId: true } } },
      });
      if (!authorization) return null;
      const membership = await tx.userOrganization.findFirst({
        where: {
          userId: workspace.userId,
          organizationId: workspace.organizationId,
          disabled: false,
        },
      });
      if (!membership) return null;
      const consumed = await tx.julsBootstrapCode.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      if (!consumed.count) return null;
      const accessToken = authorization.accessToken || candidateToken;
      if (!authorization.accessToken)
        await tx.oAuthAuthorization.update({
          where: { id: authorization.id },
          data: { accessToken },
        });
      await tx.julsAuditEvent.create({
        data: { workspaceId: workspace.id, action: 'bootstrap_exchanged' },
      });
      return {
        organizationId: workspace.organizationId,
        accessToken,
        organization: authorization.organization,
      };
    });
  }

  findByAccessToken(encryptedToken: string) {
    return this._oauthAuth.model.oAuthAuthorization.findFirst({
      where: {
        accessToken: encryptedToken,
        revokedAt: null,
        oauthApp: { deletedAt: null },
        user: { activated: true },
        organization: {
          OR: [
            { julsWorkspace: { is: null } },
            { julsWorkspace: { is: { revokedAt: null } } },
          ],
        },
      },
      include: {
        oauthApp: {
          select: {
            clientId: true,
            dynamic: true,
            redirectUris: true,
          },
        },
        organization: {
          include: {
            subscription: {
              select: {
                subscriptionTier: true,
                totalChannels: true,
                isLifetime: true,
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            email: true,
            activated: true,
          },
        },
      },
    });
  }

  getApprovedApps(userId: string) {
    return this._oauthAuth.model.oAuthAuthorization.findMany({
      where: {
        userId,
        revokedAt: null,
        accessToken: { not: null },
      },
      include: {
        oauthApp: {
          include: {
            picture: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  revokeAuthorization(userId: string, authId: string) {
    return this._oauthAuth.model.oAuthAuthorization.update({
      where: {
        id: authId,
        userId,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  revokeAllForApp(oauthAppId: string) {
    return this._oauthAuth.model.oAuthAuthorization.updateMany({
      where: {
        oauthAppId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }
}
