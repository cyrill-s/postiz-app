import { IntegrationRepository } from './integration.repository';
import { IntegrationService } from './integration.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn(), set: jest.fn() },
}));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: jest.fn() },
}));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service',
  () => ({ NotificationService: class {} })
);

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(new Date('2026-09-27T12:00:00Z'));
});
afterEach(() => jest.useRealTimers());

it('counts only published root posts belonging to this organization and connection', async () => {
  const count = jest.fn().mockResolvedValue(4);
  const repository = new IntegrationRepository(
    {} as any,
    { model: { post: { count } } } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  const from = new Date('2026-09-21T00:00:00Z'),
    to = new Date('2026-09-27T12:00:00Z');
  expect(
    await repository.countPublishedPosts('org-a', 'connection-a', from, to)
  ).toBe(4);
  expect(count).toHaveBeenCalledWith({
    where: {
      organizationId: 'org-a',
      integrationId: 'connection-a',
      parentPostId: null,
      deletedAt: null,
      state: 'PUBLISHED',
      releaseId: { not: null, notIn: ['', 'missing'] },
      publishDate: { gte: from, lte: to },
    },
  });
});

it('combines provider counters with labeled Postiz counts and keeps the existing cache', async () => {
  const count = jest.fn().mockResolvedValue(4);
  const analytics = jest
    .fn()
    .mockResolvedValue([
      {
        label: 'Подписчики',
        type: 'snapshot',
        data: [{ total: '9', date: '2026-09-27' }],
        percentageChange: 0,
      },
    ]);
  const service = new IntegrationService(
    { countPublishedPosts: count } as any,
    {} as any,
    {
      getSocialIntegration: () => ({
        analyticsPublishedPosts: true,
        analytics,
      }),
    } as any,
    {} as any,
    {} as any,
    {} as any
  );
  jest
    .spyOn(service, 'getIntegrationById')
    .mockResolvedValue({
      type: 'social',
      providerIdentifier: 'telegram',
      internalId: 'channel',
      token: '-100123',
      tokenExpiration: new Date('2100-01-01'),
    } as any);
  const result = await service.checkAnalytics(
    { id: 'org-a' } as any,
    'connection-a',
    '7'
  );
  expect(result).toHaveLength(2);
  expect(result[1]).toMatchObject({
    label: 'Публикации через Postiz',
    type: 'snapshot',
    data: [{ total: '4' }],
  });
  expect(count).toHaveBeenCalledWith(
    'org-a',
    'connection-a',
    expect.any(Date),
    new Date('2026-09-27T12:00:00Z')
  );
  expect(ioRedis.set).toHaveBeenCalledWith(
    'integration:org-a:connection-a:7',
    JSON.stringify(result),
    'EX',
    expect.any(Number)
  );
});
