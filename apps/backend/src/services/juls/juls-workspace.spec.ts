import 'reflect-metadata';
import { createHash, createHmac, randomUUID } from 'crypto';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import {
  PrismaService,
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { OAuthRepository } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.repository';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import {
  JulsController,
  JulsSessionController,
} from '../../api/routes/juls.controller';
import { OAuthController } from '../../api/routes/oauth.controller';
import { JulsAuthGuard } from './juls-auth.guard';
import { JulsWorkspaceService } from './juls-workspace.service';
import { AuthMiddleware } from '../auth/auth.middleware';

// Those services have unrelated remote dependencies. The middleware's reads use the test DB.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/users/users.service',
  () => ({ UsersService: class {} })
);

const databaseUrl = process.env.JULS_TEST_DATABASE_URL;
const suite = databaseUrl ? describe : describe.skip;

suite('Juls workspace HTTP contract (isolated PostgreSQL)', () => {
  let prisma: PrismaService;
  let app: INestApplication;
  let service: JulsWorkspaceService;
  let oauth: OAuthService;
  let base: string;
  let input: {
    externalWorkspaceId: string;
    owner: { externalUserId: string; name: string };
    organization: { name: string };
  };
  const originalEnv = { ...process.env };
  const clientSecret = 'pcs_synthetic-client-secret';
  const clientId = `pca_test_${randomUUID()}`;
  const issuer = `test-${randomUUID()}`;

  const exchange = (code: string) =>
    oauth.exchangeCodeForToken(code, clientId, clientSecret);
  const provision = (requestId = randomUUID()) =>
    service.provision(input, requestId);
  const signed = async (
    operation: string,
    body: unknown,
    options: {
      nonce?: string;
      timestamp?: string;
      key?: string;
      signature?: string;
      signedBody?: string;
      path?: string;
    } = {}
  ) => {
    const path = `/internal/juls/${operation}`;
    const rawBody = JSON.stringify(body);
    const timestamp =
      options.timestamp ?? String(Math.floor(Date.now() / 1000));
    const nonce = options.nonce ?? randomUUID();
    const key = options.key ?? (operation === 'provision' ? randomUUID() : '');
    const canonical = [
      'v1',
      'POST',
      options.path ?? path,
      timestamp,
      nonce,
      key,
      createHash('sha256')
        .update(options.signedBody ?? rawBody)
        .digest('hex'),
    ].join('\n');
    const signature =
      options.signature ??
      `v1=${createHmac('sha256', process.env.JULS_PROVISIONING_SECRET!)
        .update(canonical)
        .digest('hex')}`;
    return fetch(`${base}${path}`, {
      method: 'POST',
      body: rawBody,
      headers: {
        'content-type': 'application/json',
        'x-juls-timestamp': timestamp,
        'x-juls-nonce': nonce,
        'idempotency-key': key,
        'x-juls-signature': signature,
      },
    });
  };

  beforeAll(async () => {
    // Never infer a destructive test target from DATABASE_URL or a developer .env.
    const parsed = new URL(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(parsed.hostname) ||
      parsed.pathname !== '/juls_contract'
    ) {
      throw new Error(
        'JULS_TEST_DATABASE_URL must point to local /juls_contract'
      );
    }
    process.env.DATABASE_URL = databaseUrl;
    process.env.JWT_SECRET = 'synthetic-juls-contract-test-jwt-secret';
    process.env.JULS_PROVISIONING_SECRET =
      'synthetic-juls-contract-hmac-secret-32bytes';
    process.env.JULS_ISSUER = issuer;
    process.env.JULS_OAUTH_CLIENT_ID = clientId;
    process.env.DISABLE_REGISTRATION = 'true';
    process.env.NOT_SECURED = 'true';
    process.env.FRONTEND_URL = 'http://localhost:4200';
    process.env.NEXT_PUBLIC_BACKEND_URL = 'http://localhost:3000/api';
    prisma = new PrismaService();
    await prisma.$connect();
    const applicationOrg = await prisma.organization.create({
      data: { name: 'Juls test application' },
    });
    await prisma.oAuthApp.create({
      data: {
        name: 'Juls',
        organizationId: applicationOrg.id,
        clientId,
        clientSecret: AuthService.fixedEncryption(clientSecret),
        redirectUrl: 'https://juls.example.test/oauth/postiz/callback',
      },
    });
    service = new JulsWorkspaceService(prisma);
    oauth = new OAuthService(
      new OAuthRepository(
        new PrismaRepository(prisma),
        new PrismaRepository(prisma),
        new PrismaTransaction(prisma)
      )
    );
    const module = await Test.createTestingModule({
      controllers: [JulsController, JulsSessionController, OAuthController],
      providers: [
        JulsAuthGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: JulsWorkspaceService, useValue: service },
        { provide: OAuthService, useValue: oauth },
      ],
    }).compile();
    app = module.createNestApplication({ rawBody: true, logger: false });
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    process.env = originalEnv;
  });
  beforeEach(() => {
    input = {
      externalWorkspaceId: `ws_${randomUUID()}`,
      owner: { externalUserId: 'human_1', name: 'Example owner' },
      organization: { name: 'Example workspace' },
    };
  });

  test('creates an isolated principal without email/password registration and audits it', async () => {
    const response = await signed('provision', input);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const result = await response.json();
    const user = await prisma.user.findUnique({ where: { id: result.userId } });
    expect(user).toMatchObject({
      providerName: 'JULS',
      password: null,
      isSuperAdmin: false,
      sendSuccessEmails: false,
    });
    expect(user.email).toMatch(/@juls\.invalid$/);
    expect(
      await prisma.userOrganization.findFirst({ where: { userId: user.id } })
    ).toMatchObject({
      role: 'SUPERADMIN',
      disabled: false,
      organizationId: result.organizationId,
    });
    const organization = await prisma.organization.findUnique({
      where: { id: result.organizationId },
    });
    expect(organization).toMatchObject({
      allowTrial: false,
      isTrailing: false,
      apiKey: null,
    });
    expect(
      await prisma.julsAuditEvent.count({
        where: {
          workspace: { organizationId: result.organizationId },
          action: 'provisioned',
        },
      })
    ).toBe(1);
    const token = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: result.authorizationCode,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    expect(token.status).toBe(201);
    const credential = await token.json();
    expect(credential.id).toBe(result.organizationId);
    expect(
      (await oauth.getOrgByOAuthToken(credential.access_token)).organization.id
    ).toBe(result.organizationId);
  });

  test('concurrent provision requests create one organization and independent valid codes', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => provision())
    );
    expect(new Set(results.map((result) => result.organizationId)).size).toBe(
      1
    );
    expect(results.filter((result) => !result.alreadyExisted)).toHaveLength(1);
    const tokens = await Promise.all(
      results.map((result) => exchange(result.authorizationCode))
    );
    expect(new Set(tokens.map((token) => token.access_token)).size).toBe(1);
  });

  test('replays one attempt, rejects changed payload, and requires new attempt after exchange', async () => {
    const key = randomUUID();
    const first = await provision(key);
    expect((await provision(key)).authorizationCode).toBe(
      first.authorizationCode
    );
    await expect(
      service.provision({ ...input, organization: { name: 'Changed' } }, key)
    ).rejects.toMatchObject({ response: { error: 'idempotency_conflict' } });
    await exchange(first.authorizationCode);
    await expect(provision(key)).rejects.toMatchObject({
      response: { error: 'bootstrap_attempt_finished' },
    });
  });

  test('recovers a lost token response and preserves a working token while new codes are outstanding', async () => {
    const first = await exchange((await provision()).authorizationCode);
    const pending = await provision();
    expect(await oauth.getOrgByOAuthToken(first.access_token)).not.toBeNull();
    expect((await exchange(pending.authorizationCode)).access_token).toBe(
      first.access_token
    );
  });

  test('connects only a MAX channel administered by the OTP-bound MAX user', async () => {
    const workspace = await provision();
    process.env.JULS_MAX_BOT_TOKEN = 'synthetic-server-only-max-token';
    const realFetch = global.fetch;
    const maxFetch = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (url: any, init?: any) => {
        const target = String(url);
        if (!target.startsWith('https://platform-api2.max.ru'))
          return realFetch(url, init);
        if (target.endsWith('/members/me'))
          return new Response(
            JSON.stringify({ is_admin: true, permissions: ['write'] })
          );
        if (target.endsWith('/members/admins'))
          return new Response(
            JSON.stringify({
              members: [
                {
                  user_id: 789,
                  is_owner: true,
                  is_admin: true,
                  is_bot: false,
                },
              ],
            })
          );
        return new Response(
          JSON.stringify({
            chat_id: -123456,
            type: 'channel',
            status: 'active',
            title: 'Juls MAX channel',
          })
        );
      });
    try {
      const response = await signed('max-channel/connect', {
        externalWorkspaceId: input.externalWorkspaceId,
        actorExternalUserId: input.owner.externalUserId,
        channelId: '-123456',
        maxUserId: '789',
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const result = await response.json();
      expect(result).toMatchObject({
        channelId: '-123456',
        name: 'Juls MAX channel',
      });
      const integration = await prisma.integration.findUnique({
        where: {
          organizationId_internalId: {
            organizationId: workspace.organizationId,
            internalId: 'max:-123456',
          },
        },
      });
      expect(integration).toMatchObject({
        id: result.integrationId,
        providerIdentifier: 'max',
      });
      expect(
        JSON.parse(AuthService.fixedDecryption(integration.token))
      ).toEqual({ chatId: '-123456', tokenSource: 'juls' });
      expect(integration.token).not.toContain(process.env.JULS_MAX_BOT_TOKEN);
      expect(
        await prisma.julsAuditEvent.count({
          where: {
            workspace: { organizationId: workspace.organizationId },
            action: 'max_channel_connected',
          },
        })
      ).toBe(1);
    } finally {
      maxFetch.mockRestore();
      delete process.env.JULS_MAX_BOT_TOKEN;
    }
  });

  test('a code can be redeemed exactly once under concurrency', async () => {
    const result = await provision();
    const outcomes = await Promise.allSettled([
      exchange(result.authorizationCode),
      exchange(result.authorizationCode),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled')
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === 'rejected')
    ).toHaveLength(1);
  });

  test('codes expire and wrong client credentials cannot consume them', async () => {
    const result = await provision();
    await expect(
      oauth.exchangeCodeForToken(result.authorizationCode, clientId, 'wrong')
    ).rejects.toMatchObject({ response: { error: 'invalid_client' } });
    await prisma.julsBootstrapCode.updateMany({
      where: { workspace: { organizationId: result.organizationId } },
      data: { expiresAt: new Date(0) },
    });
    await expect(exchange(result.authorizationCode)).rejects.toMatchObject({
      response: { error: 'invalid_grant' },
    });
  });

  test('same human has separate identities and credentials in separate workspaces', async () => {
    const first = await provision();
    const second = await service.provision(
      { ...input, externalWorkspaceId: `ws_${randomUUID()}` },
      randomUUID()
    );
    expect(second.userId).not.toBe(first.userId);
    expect(second.organizationId).not.toBe(first.organizationId);
    const a = await exchange(first.authorizationCode);
    const b = await exchange(second.authorizationCode);
    expect(a.access_token).not.toBe(b.access_token);
    expect(
      (await oauth.getOrgByOAuthToken(a.access_token)).organizationId
    ).toBe(first.organizationId);
    await expect(
      service.provision(
        { ...input, owner: { ...input.owner, externalUserId: 'intruder' } },
        randomUUID()
      )
    ).rejects.toMatchObject({ response: { error: 'owner_conflict' } });
  });

  test('revocation is terminal, invalidates token/code/ticket and is idempotent', async () => {
    const first = await provision();
    const token = await exchange(first.authorizationCode);
    const pending = await provision();
    const link = await service.handoff({
      externalWorkspaceId: input.externalWorkspaceId,
      actorExternalUserId: input.owner.externalUserId,
    });
    expect(await service.revoke(input)).toEqual({ revoked: true });
    expect(await service.revoke(input)).toEqual({ revoked: true });
    expect(await oauth.getOrgByOAuthToken(token.access_token)).toBeNull();
    await expect(exchange(pending.authorizationCode)).rejects.toMatchObject({
      response: { error: 'invalid_grant' },
    });
    await expect(
      service.consumeHandoff(new URL(link.url).searchParams.get('ticket')!)
    ).rejects.toMatchObject({ response: { error: 'workspace_revoked' } });
    await expect(provision()).rejects.toMatchObject({
      response: { error: 'workspace_revoked' },
    });
  });

  test('revoke before provision leaves a tombstone and racing provision cannot resurrect it', async () => {
    await service.revoke(input);
    await expect(provision()).rejects.toMatchObject({
      response: { error: 'workspace_revoked' },
    });
    const racing = { ...input, externalWorkspaceId: `ws_${randomUUID()}` };
    await Promise.allSettled([
      service.provision(racing, randomUUID()),
      service.revoke(racing),
    ]);
    await expect(service.provision(racing, randomUUID())).rejects.toMatchObject(
      { response: { error: 'workspace_revoked' } }
    );
  });

  test('revoke racing exchange leaves no usable token', async () => {
    const result = await provision();
    const outcomes = await Promise.allSettled([
      exchange(result.authorizationCode),
      service.revoke(input),
    ]);
    if (outcomes[0].status === 'fulfilled')
      expect(
        await oauth.getOrgByOAuthToken(outcomes[0].value.access_token)
      ).toBeNull();
    expect(
      (
        await prisma.julsWorkspace.findUnique({
          where: {
            issuer_externalWorkspaceId: {
              issuer,
              externalWorkspaceId: input.externalWorkspaceId,
            },
          },
        })
      ).revokedAt
    ).not.toBeNull();
  });

  test('a manually revoked OAuth grant is not revived by provisioning', async () => {
    const result = await provision();
    await exchange(result.authorizationCode);
    await prisma.oAuthAuthorization.updateMany({
      where: { organizationId: result.organizationId },
      data: { revokedAt: new Date() },
    });
    await expect(provision()).rejects.toMatchObject({
      response: { error: 'authorization_revoked' },
    });
  });

  test('handoff only accepts the owner, consumes once and creates a short scoped session', async () => {
    const result = await provision();
    await expect(
      service.handoff({
        externalWorkspaceId: input.externalWorkspaceId,
        actorExternalUserId: 'intruder',
      })
    ).rejects.toMatchObject({ response: { error: 'actor_forbidden' } });
    const link = await service.handoff({
      externalWorkspaceId: input.externalWorkspaceId,
      actorExternalUserId: input.owner.externalUserId,
    });
    expect(new URL(link.url).pathname).toBe('/api/internal/juls/session');
    const ticket = new URL(link.url).searchParams.get('ticket');
    const session = await service.consumeHandoff(ticket!);
    const payload = AuthService.verifyJWT(session.jwt) as any;
    expect(payload).toMatchObject({
      id: result.userId,
      organizationId: result.organizationId,
    });
    expect(payload.exp - payload.iat).toBe(1800);
    await expect(service.consumeHandoff(ticket!)).rejects.toMatchObject({
      response: { error: 'invalid_handoff' },
    });
  });

  test('expired ticket fails and the browser endpoint sets cookies then redirects to a fixed page', async () => {
    await provision();
    const body = {
      externalWorkspaceId: input.externalWorkspaceId,
      actorExternalUserId: input.owner.externalUserId,
    };
    const expired = await service.handoff(body);
    await prisma.julsHandoff.updateMany({
      where: { workspace: { externalWorkspaceId: input.externalWorkspaceId } },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      service.consumeHandoff(new URL(expired.url).searchParams.get('ticket')!)
    ).rejects.toMatchObject({ response: { error: 'invalid_handoff' } });
    const link = await (await signed('handoff', body)).json();
    const ticket = new URL(link.url).searchParams.get('ticket');
    const response = await fetch(
      `${base}/internal/juls/session?ticket=${ticket}`,
      { redirect: 'manual' }
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'http://localhost:4200/launches'
    );
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  test('managed browser cannot switch organizations, use unscoped JWT or survive revoke', async () => {
    const result = await provision();
    const link = await service.handoff({
      externalWorkspaceId: input.externalWorkspaceId,
      actorExternalUserId: input.owner.externalUserId,
    });
    const session = await service.consumeHandoff(
      new URL(link.url).searchParams.get('ticket')!
    );
    const middleware = new AuthMiddleware(
      {
        getOrgsByUserId: (userId: string) =>
          prisma.organization.findMany({
            where: { users: { some: { userId } } },
            include: { users: { where: { userId } } },
          }),
      } as any,
      {
        getUserById: (id: string) => prisma.user.findUnique({ where: { id } }),
      } as any,
      prisma
    );
    const request = (jwt: string, org = result.organizationId) =>
      ({ headers: { auth: jwt, showorg: org }, cookies: {} } as any);
    const next = jest.fn();
    await middleware.use(request(session.jwt), {} as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    await expect(
      middleware.use(request(session.jwt, 'other-org'), {} as any, next)
    ).rejects.toBeDefined();
    await expect(
      middleware.use(
        request(AuthService.signJWT({ id: result.userId })),
        {} as any,
        next
      )
    ).rejects.toBeDefined();
    await service.revoke(input);
    await expect(
      middleware.use(request(session.jwt), {} as any, next)
    ).rejects.toBeDefined();
  });

  test.each([
    ['wrong signature', { signature: `v1=${'0'.repeat(64)}` }],
    [
      'old timestamp',
      { timestamp: String(Math.floor(Date.now() / 1000) - 301) },
    ],
    ['altered body', { signedBody: '{}' }],
    ['different path', { path: '/internal/juls/revoke' }],
  ])('rejects %s', async (_name, options) => {
    expect((await signed('provision', input, options)).status).toBe(401);
  });

  test('rejects request replay but allows an idempotent retry with a fresh signature', async () => {
    const nonce = randomUUID();
    const key = randomUUID();
    expect((await signed('provision', input, { nonce, key })).status).toBe(200);
    expect((await signed('provision', input, { nonce, key })).status).toBe(409);
    expect((await signed('provision', input, { key })).status).toBe(200);
  });

  test.each([
    {},
    { externalWorkspaceId: 'ws' },
    { externalWorkspaceId: 'ws', owner: null, organization: { name: 'Org' } },
    {
      externalWorkspaceId: '../path',
      owner: { externalUserId: 'u', name: 'A' },
      organization: { name: 'Org' },
    },
  ])('validates required fields: %j', async (body) => {
    expect((await signed('provision', body)).status).toBe(400);
  });

  test('rejects unsupported billing fields rather than implying their enforcement', async () => {
    expect(
      (await signed('provision', { ...input, plan: 'unlimited' })).status
    ).toBe(400);
  });

  test('is disabled without configuration', async () => {
    const secret = process.env.JULS_PROVISIONING_SECRET;
    delete process.env.JULS_PROVISIONING_SECRET;
    const response = await fetch(`${base}/internal/juls/provision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    process.env.JULS_PROVISIONING_SECRET = secret;
    expect(response.status).toBe(503);
  });

  test('wrong OAuth app cannot redeem a bootstrap code', async () => {
    const result = await provision();
    const org = await prisma.organization.create({
      data: { name: 'Other app organization' },
    });
    const other = await prisma.oAuthApp.create({
      data: {
        organizationId: org.id,
        name: 'Other',
        clientId: `pca_${randomUUID()}`,
        clientSecret: AuthService.fixedEncryption(clientSecret),
        redirectUrl: 'https://other.example.test/callback',
      },
    });
    await expect(
      oauth.exchangeCodeForToken(
        result.authorizationCode,
        other.clientId,
        clientSecret
      )
    ).rejects.toMatchObject({ response: { error: 'invalid_grant' } });
    expect((await exchange(result.authorizationCode)).id).toBe(
      result.organizationId
    );
  });

  test('handoff is consumed exactly once under concurrency', async () => {
    await provision();
    const link = await service.handoff({
      externalWorkspaceId: input.externalWorkspaceId,
      actorExternalUserId: input.owner.externalUserId,
    });
    const ticket = new URL(link.url).searchParams.get('ticket')!;
    const results = await Promise.allSettled([
      service.consumeHandoff(ticket),
      service.consumeHandoff(ticket),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled')
    ).toHaveLength(1);
  });

  test('misconfigured first-party app creates no partial organization or principal', async () => {
    const users = await prisma.user.count();
    const orgs = await prisma.organization.count();
    process.env.JULS_OAUTH_CLIENT_ID = 'nonexistent';
    try {
      await expect(provision()).rejects.toMatchObject({
        response: { error: 'juls_app_unavailable' },
      });
    } finally {
      process.env.JULS_OAUTH_CLIENT_ID = clientId;
    }
    expect(await prisma.user.count()).toBe(users);
    expect(await prisma.organization.count()).toBe(orgs);
    expect(
      await prisma.julsWorkspace.findUnique({
        where: {
          issuer_externalWorkspaceId: {
            issuer,
            externalWorkspaceId: input.externalWorkspaceId,
          },
        },
      })
    ).toBeNull();
  });

  test('deleted app invalidates its token and disables future handoffs', async () => {
    const result = await provision();
    const token = await exchange(result.authorizationCode);
    await prisma.oAuthApp.update({
      where: { clientId },
      data: { deletedAt: new Date() },
    });
    try {
      expect(await oauth.getOrgByOAuthToken(token.access_token)).toBeNull();
      await expect(
        service.handoff({
          externalWorkspaceId: input.externalWorkspaceId,
          actorExternalUserId: input.owner.externalUserId,
        })
      ).rejects.toMatchObject({ response: { error: 'juls_app_unavailable' } });
    } finally {
      await prisma.oAuthApp.update({
        where: { clientId },
        data: { deletedAt: null },
      });
    }
  });

  test('signed revoke and handoff do not require browser auth; unsigned requests fail', async () => {
    await provision();
    expect(
      (
        await fetch(`${base}/internal/juls/revoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        })
      ).status
    ).toBe(401);
    const response = await signed('revoke', {
      externalWorkspaceId: input.externalWorkspaceId,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: true });
    expect(
      (
        await signed('handoff', {
          externalWorkspaceId: input.externalWorkspaceId,
          actorExternalUserId: input.owner.externalUserId,
        })
      ).status
    ).toBe(410);
  });

  test('normal OAuth code exchange also consumes exactly once', async () => {
    const result = await provision();
    const appRow = await prisma.oAuthApp.findUnique({ where: { clientId } });
    const code = await oauth.createAuthorizationCode(
      appRow.id,
      result.userId,
      result.organizationId
    );
    const outcomes = await Promise.allSettled([exchange(code), exchange(code)]);
    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled')
    ).toHaveLength(1);
  });
});
