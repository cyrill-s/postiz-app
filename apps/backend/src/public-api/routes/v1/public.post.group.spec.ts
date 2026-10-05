import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { HttpException, INestApplication, ValidationPipe } from '@nestjs/common';
import { PublicIntegrationsController } from './public.integrations.controller';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';

jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/media/media.service', () => ({ MediaService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/notifications/notification.service', () => ({ NotificationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.service', () => ({ AdminStatsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/organizations/organization.service', () => ({ OrganizationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/clipping/clipping.service', () => ({ ClippingService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {}, socialIntegrationList: [] }));
jest.mock('@gitroom/nestjs-libraries/integrations/refresh.integration.service', () => ({ RefreshIntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({ RefreshToken: class {} }));
jest.mock('@gitroom/nestjs-libraries/upload/multer.stream.engine', () => ({ streamUploadOptions: () => ({}) }));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({ ioRedis: {} }));
jest.mock('@sentry/nestjs', () => ({ metrics: { count: jest.fn() } }));

describe('public post group HTTP routes', () => {
  let app: INestApplication;
  let base: string;
  const response = {
    group: 'group', publishDate: '2026-10-06T12:00:00.000Z', state: 'QUEUE',
    posts: [{ id: 'root', integrationId: 'channel', content: 'Text', imageCount: 2, state: 'QUEUE', publishDate: '2026-10-06T12:00:00.000Z' }],
  };
  const cancelled = { group: 'group', cancelled: ['root', 'other-root'] };
  const posts = {
    getPublicPostGroup: jest.fn(), updatePublicPostGroup: jest.fn(),
    cancelPublicPostGroup: jest.fn(), deletePost: jest.fn(),
  };
  const request = (method: string, body?: unknown, org = 'org-a', group = 'group') =>
    fetch(`${base}/public/v1/posts/group/${group}${method === 'POST' ? '/cancel' : ''}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: org },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  beforeAll(async () => {
    // Stub unrelated dependencies while preserving the actual controller,
    // route decorators and @GetOrgFromRequest parameter extraction.
    const dependencies: any[] = Reflect.getMetadata('design:paramtypes', PublicIntegrationsController);
    const module = await Test.createTestingModule({
      controllers: [PublicIntegrationsController],
      providers: dependencies.map((provide) => ({ provide, useValue: provide === PostsService ? posts : {} })),
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    // Model the org assigned by PublicAuthMiddleware, which remains unchanged.
    app.use((req: any, res: any, next: () => void) => {
      req.org = { id: req.headers.authorization };
      next();
    });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    posts.getPublicPostGroup.mockResolvedValue(response);
    posts.updatePublicPostGroup.mockResolvedValue(response);
    posts.cancelPublicPostGroup.mockResolvedValue(cancelled);
    posts.deletePost.mockResolvedValue({ error: true });
  });
  afterAll(async () => { await app?.close(); });

  it('GET returns 200 and the exact group shape using the authenticated org', async () => {
    const result = await request('GET');
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(response);
    expect(posts.getPublicPostGroup).toHaveBeenCalledWith('org-a', 'group');
    await request('GET', undefined, 'org-b');
    expect(posts.getPublicPostGroup).toHaveBeenLastCalledWith('org-b', 'group');
  });
  it('PUT returns 200 and forwards the full patch with the authenticated org', async () => {
    const patch = {
      date: '2026-10-07T12:00:00.000Z', posts: [{ id: 'root', content: 'Edited' }], removePostIds: ['other-root'],
    };
    const result = await request('PUT', patch);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(response);
    expect(posts.updatePublicPostGroup).toHaveBeenCalledWith('org-a', 'group', patch);
  });
  it('POST cancel returns 200 with root ids using the authenticated org', async () => {
    const result = await request('POST');
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(cancelled);
    expect(posts.cancelPublicPostGroup).toHaveBeenCalledWith('org-a', 'group');
    await request('POST', undefined, 'org-b');
    expect(posts.cancelPublicPostGroup).toHaveBeenLastCalledWith('org-b', 'group');
    expect(posts.deletePost).not.toHaveBeenCalled();
  });
  it('DELETE group retains the existing delete service and response', async () => {
    const result = await request('DELETE');
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ error: true });
    expect(posts.deletePost).toHaveBeenCalledWith('org-a', 'group');
    expect(posts.cancelPublicPostGroup).not.toHaveBeenCalled();
  });
  it.each([
    ['GET', 404, { statusCode: 404, message: 'Post group not found' }],
    ['PUT', 404, { statusCode: 404, message: 'Post group not found' }],
    ['PUT', 400, { msg: 'Unknown post id for this group: other-root' }],
    ['PUT', 409, { error: 'publishing' }],
    ['POST', 404, { statusCode: 404, message: 'Post group not found' }],
    ['POST', 409, { error: 'publishing' }],
  ])('preserves the %s %i error body', async (method, status, error) => {
    (method === 'GET' ? posts.getPublicPostGroup
      : method === 'POST' ? posts.cancelPublicPostGroup : posts.updatePublicPostGroup)
      .mockRejectedValueOnce(new HttpException(error, status));
    const result = await request(method, method === 'PUT' ? { date: response.publishDate } : undefined);
    expect(result.status).toBe(status);
    expect(await result.json()).toEqual(error);
  });
});
