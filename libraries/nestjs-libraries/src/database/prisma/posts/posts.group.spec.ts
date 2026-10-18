import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { IsString } from 'class-validator';
import { PostsService } from './posts.service';
import { PostsRepository } from './posts.repository';

// Keep storage, Redis and provider clients out of this service/repository suite.
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({ UploadFactory: { createStorage: jest.fn() } }));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({ ioRedis: {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({ IntegrationManager: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/refresh.integration.service', () => ({ RefreshIntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/integrations/social.abstract', () => ({ RefreshToken: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({ IntegrationService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/media/media.service', () => ({ MediaService: class {} }));
jest.mock('@gitroom/nestjs-libraries/short-linking/short.link.service', () => ({ ShortLinkService: class {} }));
jest.mock('@gitroom/nestjs-libraries/openai/openai.service', () => ({ OpenaiService: class {} }));
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));
jest.mock('@sentry/nestjs', () => ({ metrics: { count: jest.fn() } }));
jest.mock('sharp', () => jest.fn());
// The sanitizer has its own runtime dependency; mirror the existing DTO specs.
jest.mock('@gitroom/helpers/utils/sanitize.post.content', () => ({ sanitizePostContent: (value: string) => value }));

class ProviderSettings {
  @IsString()
  mode: string;
}

describe('public post group edit/cancel (service and scoped repository writes)', () => {
  const now = new Date('2026-10-05T12:00:00.000Z');
  const date = '2026-10-06T12:00:00.000Z';
  const newDate = '2026-10-07T18:30:00.000Z';
  let rows: any[];
  let service: PostsService;
  let repository: PostsRepository;
  let findMany: jest.Mock;
  let updateMany: jest.Mock;
  let transaction: jest.Mock;
  let list: jest.Mock;
  let start: jest.Mock;
  let terminate: jest.Mock;
  let getIntegrationById: jest.Mock;
  let provider: { dto: typeof ProviderSettings; checkValidity: jest.Mock; maxLength: jest.Mock };

  const makePost = (id: string, extra: any = {}) => ({
    id, organizationId: 'org-a', group: 'group', integrationId: `channel-${id}`,
    content: `Text ${id}`, state: 'QUEUE', publishDate: new Date(date),
    updatedAt: new Date('2026-10-04T12:00:00Z'), parentPostId: null,
    deletedAt: null, delay: 17, intervalInDays: 3,
    image: JSON.stringify([{ id: 'image', path: 'https://media.example/image.jpg', alt: 'Alt' }]),
    settings: '{ "mode": "normal", "__type": "telegram", "unknownSetting": 7 }',
    integration: { id: `channel-${id}`, providerIdentifier: 'telegram', name: id, additionalSettings: '[]' },
    tags: [{ tag: { name: 'tag', id: 'tag-id' } }],
    releaseId: null, releaseURL: null, creationMethod: 'WEB',
    ...extra,
  });
  const saved = (id: string) => rows.find((post) => post.id === id);
  const snapshot = () => rows.map((post) => ({ ...post }));
  // Model only the Prisma filters used by this path; the actual repository
  // supplies the org/group/deleted/state/version/time predicates under test.
  const matches = (post: any, where: any): boolean =>
    Object.entries(where).every(([key, expected]: [string, any]) => {
      const actual = post[key];
      if (expected instanceof Date) return actual?.getTime() === expected.getTime();
      if (expected && typeof expected === 'object') {
        if (expected.in) return expected.in.includes(actual);
        if (expected.gte) return actual.getTime() >= expected.gte.getTime();
        if (expected.gt) return actual.getTime() > expected.gt.getTime();
        if ('not' in expected) return actual !== expected.not;
      }
      return actual === expected;
    });
  const expectError = async (body: any, status: number, group = 'group', org = 'org-a') => {
    const before = snapshot();
    try {
      await service.updatePublicPostGroup(org, group, body);
      throw new Error('Expected the PUT to fail');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(status);
      expect((err as HttpException).getResponse()).toEqual(
        status === 400 ? { msg: expect.any(String) } : status === 409
          ? { error: 'publishing' } : expect.objectContaining({ statusCode: 404 })
      );
    }
    expect(rows).toEqual(before);
    expect(transaction).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  };
  const expectCancelError = async (status: number, group = 'group', org = 'org-a') => {
    const before = snapshot();
    try {
      await service.cancelPublicPostGroup(org, group);
      throw new Error('Expected the cancel to fail');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(status);
      expect((err as HttpException).getResponse()).toEqual(status === 409
        ? { error: 'publishing' } : expect.objectContaining({ statusCode: 404 }));
    }
    expect(rows).toEqual(before);
    expect(updateMany).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(terminate).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(now);
    rows = [
      makePost('root-a'),
      makePost('comment', { parentPostId: 'root-a', content: 'Comment', delay: 45 }),
      makePost('reply', { parentPostId: 'comment', content: 'Reply', delay: 60, image: '[]' }),
      makePost('root-b', { integration: { id: 'channel-root-b', providerIdentifier: 'vk-community', name: 'VK', additionalSettings: '[]' } }),
      makePost('foreign', { organizationId: 'org-b' }),
      makePost('other-group', { group: 'other' }),
      makePost('deleted', { deletedAt: now }),
    ];
    findMany = jest.fn(async ({ where, orderBy }) => {
      const selected = rows.filter((post) => matches(post, where)).map((post) => ({ ...post }));
      return orderBy?.id === 'asc' ? selected.sort((a, b) => a.id.localeCompare(b.id)) : selected;
    });
    updateMany = jest.fn(async ({ where, data }) => {
      const selected = rows.filter((post) => matches(post, where));
      selected.forEach((post) => Object.assign(post, data, { updatedAt: new Date() }));
      return { count: selected.length };
    });
    transaction = jest.fn(async (callback) => {
      const before = snapshot();
      try { return await callback({ post: { findMany, updateMany } }); }
      catch (err) { rows = before; throw err; }
    });
    repository = new PostsRepository(
      { model: { post: { findMany } } } as any,
      {} as any,
      { model: { comments: { findMany: jest.fn().mockResolvedValue([]) } } } as any,
      {} as any, {} as any, {} as any,
      { model: { $transaction: transaction } } as any
    );
    list = jest.fn(({ query }) => (async function* () {
      yield { workflowId: `old-${query.match(/postId="([^"]+)"/)[1]}` };
    })());
    start = jest.fn().mockResolvedValue({});
    terminate = jest.fn().mockResolvedValue(undefined);
    const client = {
      getRawClient: () => ({ workflow: { list, start } }),
      getWorkflowHandle: jest.fn(async () => ({
        describe: async () => ({ status: { name: 'RUNNING' } }), terminate,
      })),
    };
    provider = {
      dto: ProviderSettings,
      checkValidity: jest.fn().mockResolvedValue(true),
      maxLength: jest.fn().mockReturnValue(100),
    };
    getIntegrationById = jest.fn(async (org, id) =>
      rows.find((post) => post.organizationId === org && post.integrationId === id)?.integration
    );
    service = new PostsService(
      repository,
      { getSocialIntegration: () => provider } as any,
      { getIntegrationById } as any,
      {} as any, {} as any, {} as any,
      { client } as any, {} as any
    );
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  it('GET returns only live roots and the exact media-count shape, scoped to the org', async () => {
    expect(await service.getPublicPostGroup('org-a', 'group')).toEqual({
      group: 'group', publishDate: date, state: 'QUEUE',
      posts: [
        { id: 'root-a', integrationId: 'channel-root-a', content: 'Text root-a', imageCount: 1, state: 'QUEUE', publishDate: date },
        { id: 'root-b', integrationId: 'channel-root-b', content: 'Text root-b', imageCount: 1, state: 'QUEUE', publishDate: date },
      ],
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { group: 'group', organizationId: 'org-a', deletedAt: null },
    }));
    expect((await service.getPublicPostGroup('org-b', 'group')).posts.map((post) => post.id)).toEqual(['foreign']);
    await expect(service.getPublicPostGroup('org-c', 'group')).rejects.toMatchObject({ status: 404 });
  });

  it('GET returns published/draft/error state and 404 for missing/deleted/child-only groups', async () => {
    rows = [makePost('root-a', { state: 'PUBLISHED' })];
    expect((await service.getPublicPostGroup('org-a', 'group')).state).toBe('PUBLISHED');
    saved('root-a').state = 'ERROR';
    expect((await service.getPublicPostGroup('org-a', 'group')).state).toBe('ERROR');
    saved('root-a').state = 'DRAFT';
    expect((await service.getPublicPostGroup('org-a', 'group')).state).toBe('DRAFT');
    saved('root-a').deletedAt = now;
    await expect(service.getPublicPostGroup('org-a', 'group')).rejects.toMatchObject({ status: 404 });
    rows = [makePost('comment', { parentPostId: 'absent' })];
    await expect(service.getPublicPostGroup('org-a', 'group')).rejects.toMatchObject({ status: 404 });
    await expect(service.getPublicPostGroup('org-a', 'missing')).rejects.toMatchObject({ status: 404 });
  });

  it('GET exposes each root state/date when the group is mixed, preserving top-level fields', async () => {
    saved('root-b').state = 'PUBLISHED';
    saved('root-b').publishDate = new Date(newDate);
    const result = await service.getPublicPostGroup('org-a', 'group');
    expect(result).toMatchObject({ group: 'group', state: 'QUEUE', publishDate: date });
    expect(result.posts).toEqual([
      { id: 'root-a', integrationId: 'channel-root-a', content: 'Text root-a', imageCount: 1, state: 'QUEUE', publishDate: date },
      { id: 'root-b', integrationId: 'channel-root-b', content: 'Text root-b', imageCount: 1, state: 'PUBLISHED', publishDate: newDate },
    ]);
  });

  it('cancel soft-deletes every eligible root and thread in the org, then terminates every root workflow', async () => {
    saved('root-b').state = 'DRAFT';
    // The guard applies to roots; comment dates/states do not block the group.
    saved('comment').state = 'PUBLISHED';
    saved('comment').publishDate = now;
    saved('foreign').state = 'PUBLISHED';
    const before = snapshot();
    terminate.mockImplementation(async () => {
      for (const id of ['root-a', 'root-b', 'comment', 'reply']) expect(saved(id).deletedAt).toEqual(now);
    });
    expect(await service.cancelPublicPostGroup('org-a', 'group')).toEqual({
      group: 'group', cancelled: ['root-a', 'root-b'],
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-a', group: 'group', parentPostId: null, deletedAt: null },
    }));
    expect(updateMany).toHaveBeenNthCalledWith(1, {
      where: {
        organizationId: 'org-a', group: 'group', id: { in: ['root-a', 'root-b'] },
        parentPostId: null, deletedAt: null, state: { in: ['QUEUE', 'DRAFT'] },
        publishDate: { gt: new Date(now.getTime() + 300000) },
      },
      data: { deletedAt: now },
    });
    for (const post of before) {
      expect(saved(post.id)).toEqual(['root-a', 'root-b', 'comment', 'reply'].includes(post.id)
        ? { ...post, deletedAt: now, updatedAt: now } : post);
    }
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledWith({ query: 'postId="root-a" AND ExecutionStatus="Running"' });
    expect(list).toHaveBeenCalledWith({ query: 'postId="root-b" AND ExecutionStatus="Running"' });
    expect(terminate).toHaveBeenCalledTimes(2);
    expect(start).not.toHaveBeenCalled();
  });

  it.each(['PUBLISHED', 'ERROR'])('cancel rejects a mixed QUEUE/%s group without deleting or terminating anything', async (state) => {
    saved('root-b').state = state;
    await expectCancelError(409);
  });

  it.each(['QUEUE', 'DRAFT'])('cancel strictly enforces more than five minutes for %s roots', async (state) => {
    saved('root-b').state = state;
    for (const milliseconds of [-1, 0, 299999, 300000]) {
      saved('root-b').publishDate = new Date(now.getTime() + milliseconds);
      await expectCancelError(409);
    }
    saved('root-b').publishDate = new Date(now.getTime() + 300001);
    await expect(service.cancelPublicPostGroup('org-a', 'group')).resolves.toEqual({
      group: 'group', cancelled: ['root-a', 'root-b'],
    });
  });

  it('cancel returns 404 for missing, foreign-only, deleted and child-only groups', async () => {
    await expectCancelError(404, 'missing');
    await expectCancelError(404, 'group', 'org-c');
    rows = [makePost('deleted', { deletedAt: now }), makePost('comment', { parentPostId: 'absent' })];
    await expectCancelError(404);
  });

  it('cancel is scoped to the authenticated org even when another org has a publishing root with the same group', async () => {
    saved('root-a').state = 'PUBLISHED';
    const before = snapshot();
    expect(await service.cancelPublicPostGroup('org-b', 'group')).toEqual({
      group: 'group', cancelled: ['foreign'],
    });
    expect(rows.filter((post) => post.organizationId === 'org-a')).toEqual(
      before.filter((post) => post.organizationId === 'org-a')
    );
    expect(saved('foreign').deletedAt).toEqual(now);
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({ query: 'postId="foreign" AND ExecutionStatus="Running"' });
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it('cancel rolls back a partial root match when the worker moves a root out of QUEUE before the update', async () => {
    const before = snapshot();
    const workerChange = { state: 'PUBLISHED', updatedAt: now };
    const implementation = updateMany.getMockImplementation();
    // Preserve the independently committed worker change when rolling back
    // this transaction's writes, as the database would.
    transaction.mockImplementationOnce(async (callback) => {
      try { return await callback({ post: { findMany, updateMany } }); }
      catch (err) {
        rows = before.map((post) => post.id === 'root-b' ? { ...post, ...workerChange } : post);
        throw err;
      }
    });
    updateMany.mockImplementationOnce(async (args) => {
      Object.assign(saved('root-b'), workerChange);
      const result = await implementation(args);
      expect(result.count).toBe(1);
      expect(saved('root-a').deletedAt).toEqual(now);
      expect(saved('root-b').deletedAt).toBeNull();
      return result;
    });
    try {
      await service.cancelPublicPostGroup('org-a', 'group');
      throw new Error('Expected concurrent publishing rejection');
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(409);
      expect((err as HttpException).getResponse()).toEqual({ error: 'publishing' });
    }
    expect(rows).toEqual(before.map((post) => post.id === 'root-b' ? { ...post, ...workerChange } : post));
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();
    expect(terminate).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('cancel rolls back all roots if deleting their children fails', async () => {
    const before = snapshot();
    updateMany.mockImplementationOnce(updateMany.getMockImplementation())
      .mockRejectedValueOnce(new Error('Database failure'));
    await expect(service.cancelPublicPostGroup('org-a', 'group')).rejects.toThrow('Database failure');
    expect(rows).toEqual(before);
    expect(list).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('cancel reports an aborted serializable transaction as a publishing conflict', async () => {
    const before = snapshot();
    transaction.mockRejectedValueOnce({ code: 'P2034' });
    try {
      await service.cancelPublicPostGroup('org-a', 'group');
      throw new Error('Expected transaction conflict');
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(409);
      expect((err as HttpException).getResponse()).toEqual({ error: 'publishing' });
    }
    expect(rows).toEqual(before);
    expect(list).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('PUT changes only root content, preserving the group, raw images/settings, tags, delays and children', async () => {
    const before = snapshot();
    const validation = jest.spyOn(service, 'validatePosts');
    const result = await service.updatePublicPostGroup('org-a', 'group', {
      posts: [{ id: 'root-a', content: '<p>Edited</p>' }],
    });
    expect(result.posts[0].content).toBe('<p>Edited</p>');
    const expected = before.map((post) => post.id === 'root-a'
      ? { ...post, content: '<p>Edited</p>', updatedAt: now } : post);
    expect(rows).toEqual(expected);
    expect(validation).toHaveBeenCalledWith('org-a', [expect.objectContaining({
      settings: { mode: 'normal', __type: 'telegram', unknownSetting: 7 },
      value: [
        expect.objectContaining({ id: 'root-a', content: '<p>Edited</p>', delay: 17, image: JSON.parse(saved('root-a').image) }),
        expect.objectContaining({ id: 'comment', content: 'Comment', delay: 45 }),
        expect.objectContaining({ id: 'reply', content: 'Reply', delay: 60 }),
      ],
    })]);
    expect(list).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('PUT reschedules all roots and descendants and awaits termination/restart of every root workflow', async () => {
    const before = snapshot();
    const result = await service.updatePublicPostGroup('org-a', 'group', { date: newDate });
    expect(result.publishDate).toBe(newDate);
    for (const id of ['root-a', 'root-b', 'comment', 'reply']) {
      expect(saved(id).publishDate).toEqual(new Date(newDate));
      expect(saved(id).state).toBe('QUEUE');
      expect(saved(id).content).toBe(before.find((post) => post.id === id).content);
    }
    expect(saved('foreign')).toEqual(before.find((post) => post.id === 'foreign'));
    expect(saved('other-group')).toEqual(before.find((post) => post.id === 'other-group'));
    expect(terminate).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledWith('postWorkflowV112', expect.objectContaining({
      workflowId: 'post_root-a', workflowIdConflictPolicy: 'TERMINATE_EXISTING', taskQueue: 'main',
      args: [{ postId: 'root-a', organizationId: 'org-a', taskQueue: 'telegram' }],
    }));
    expect(start).toHaveBeenCalledWith('postWorkflowV112', expect.objectContaining({
      args: [{ postId: 'root-b', organizationId: 'org-a', taskQueue: 'vk' }],
    }));
    expect(terminate.mock.invocationCallOrder[0]).toBeLessThan(start.mock.invocationCallOrder[0]);
    expect(terminate.mock.invocationCallOrder[1]).toBeLessThan(start.mock.invocationCallOrder[1]);
  });

  it('PUT soft-deletes only the selected root and its entire thread and terminates only its workflows', async () => {
    const before = snapshot();
    const result = await service.updatePublicPostGroup('org-a', 'group', { removePostIds: ['root-a'] });
    expect(result.posts.map((post) => post.id)).toEqual(['root-b']);
    for (const id of ['root-a', 'comment', 'reply']) expect(saved(id).deletedAt).toEqual(now);
    expect(saved('root-b')).toEqual(before.find((post) => post.id === 'root-b'));
    expect(saved('foreign')).toEqual(before.find((post) => post.id === 'foreign'));
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({ query: 'postId="root-a" AND ExecutionStatus="Running"' });
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it('combines content, date and removal in one transaction, restarting only the surviving root', async () => {
    const result = await service.updatePublicPostGroup('org-a', 'group', {
      date: newDate, posts: [{ id: 'root-b', content: 'Changed VK' }], removePostIds: ['root-a'],
    });
    expect(result).toMatchObject({ publishDate: newDate, posts: [{ id: 'root-b', content: 'Changed VK' }] });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(terminate).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith('postWorkflowV112', expect.objectContaining({ workflowId: 'post_root-b' }));
  });

  it.each([
    {}, { posts: [] }, { removePostIds: [] }, { unknown: true },
    { date: null }, { posts: null }, { removePostIds: null },
    { date: 'bad' }, { date: '2026-02-30T12:00:00Z' },
    { date: '2026-10-06' }, { date: '2026-10-06T12:00:00' }, { date: '2026-10-06T12:00:00+03:00' },
    { date: '2026-10-05T11:59:59Z' }, { date: now.toISOString() },
    { posts: [{ id: 'root-a', content: 42 }] }, { posts: [{ id: 'root-a' }] },
    { posts: [{ id: 'root-a', content: 'ok' }, { id: 'root-a', content: 'duplicate' }] },
    { posts: [{ id: 'root-a', content: 'ok', settings: {} }] },
    { removePostIds: ['root-a', 'root-a'] }, { removePostIds: ['root-a', 'root-b'] },
    { posts: [{ id: 'root-a', content: 'ok' }], removePostIds: ['root-a'] },
  ])('rejects malformed/empty/past/all-removal requests before writing: %j', async (body) => {
    await expectError(body, 400);
  });

  it.each(['unknown', 'foreign', 'other-group', 'deleted', 'comment', 'reply'])('rejects non-root or non-member id %s', async (id) => {
    await expectError({ posts: [{ id, content: 'Edited' }] }, 400);
    await expectError({ removePostIds: [id] }, 400);
  });
  it('PUT returns 404 for missing groups or groups belonging only to another org', async () => {
    await expectError({ date: newDate }, 404, 'missing');
    await expectError({ date: newDate }, 404, 'group', 'org-c');
  });

  it.each(['PUBLISHED', 'ERROR'])('refuses affected %s roots for edits, dates and removal', async (state) => {
    saved('root-a').state = state;
    await expectError({ posts: [{ id: 'root-a', content: 'Edit' }] }, 409);
    await expectError({ date: newDate }, 409);
    await expectError({ removePostIds: ['root-a'] }, 409);
  });
  it.each([-1, 0, 299999])('applies the five-minute guard to all operations (%i ms away)', async (milliseconds) => {
    saved('root-a').publishDate = new Date(now.getTime() + milliseconds);
    await expectError({ posts: [{ id: 'root-a', content: 'Edit' }] }, 409);
    await expectError({ date: newDate }, 409);
    await expectError({ removePostIds: ['root-a'] }, 409);
  });
  it('accepts exactly five minutes and does not guard an unaffected published sibling', async () => {
    saved('root-a').publishDate = new Date(now.getTime() + 300000);
    saved('root-b').state = 'PUBLISHED';
    await expect(service.updatePublicPostGroup('org-a', 'group', { posts: [{ id: 'root-a', content: 'Edit' }] })).resolves.toBeDefined();
  });

  it.each(['length', 'media', 'settings', 'empty'])('validates the full combined request before any date/content/remove mutation (%s)', async (failure) => {
    if (failure === 'media') provider.checkValidity.mockResolvedValue('Invalid media');
    if (failure === 'settings') saved('root-b').settings = '{"mode":42}';
    if (failure === 'empty') saved('root-b').image = '[]';
    const content = failure === 'length' ? 'x'.repeat(101) : failure === 'empty' ? '' : 'Edited';
    await expectError({ date: newDate, posts: [{ id: 'root-b', content }], removePostIds: ['root-a'] }, 400);
  });
  it('validates every root before editing two channels, including a bad second root', async () => {
    await expectError({ posts: [{ id: 'root-a', content: 'Valid' }, { id: 'root-b', content: 'x'.repeat(101) }] }, 400);
  });
  it('normalizes a missing integration validation failure to { msg }', async () => {
    getIntegrationById.mockResolvedValue(undefined);
    await expectError({ posts: [{ id: 'root-a', content: 'Edit' }] }, 400);
  });
  it('accepts empty text when the preserved root has media', async () => {
    expect((await service.updatePublicPostGroup('org-a', 'group', { posts: [{ id: 'root-a', content: '' }] })).posts[0].content).toBe('');
  });
  it('uses the provider-specific caption limit for an edited Telegram root with preserved media', async () => {
    await expectError({ posts: [{ id: 'root-a', content: 'x'.repeat(1025) }] }, 400);
  });

  it('preserves DRAFT for content/date edits, permits incomplete draft settings, and terminates without starting', async () => {
    for (const id of ['root-a', 'comment', 'reply']) saved(id).state = 'DRAFT';
    saved('root-a').settings = '{}';
    const result = await service.updatePublicPostGroup('org-a', 'group', {
      date: newDate, posts: [{ id: 'root-a', content: 'x'.repeat(1025) }],
    });
    expect(result.state).toBe('DRAFT');
    for (const id of ['root-a', 'comment', 'reply']) expect(saved(id).state).toBe('DRAFT');
    expect(terminate).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith('postWorkflowV112', expect.objectContaining({ workflowId: 'post_root-b' }));
  });
  it('still rejects empty drafts without media and applies the date guard to affected drafts', async () => {
    saved('root-a').state = 'DRAFT';
    saved('root-a').image = '[]';
    await expectError({ posts: [{ id: 'root-a', content: '' }] }, 400);
    saved('root-a').publishDate = new Date(now.getTime() - 1);
    await expectError({ date: newDate }, 409);
  });

  it('rechecks time/version at the write and rolls back if publishing or a concurrent edit invalidated the snapshot', async () => {
    const before = snapshot();
    updateMany.mockImplementationOnce(async ({ where, data }) => {
      Object.assign(saved(where.id), data);
      return { count: 1 };
    }).mockResolvedValueOnce({ count: 0 });
    await expect(service.updatePublicPostGroup('org-a', 'group', { date: newDate })).rejects.toMatchObject({ status: 409 });
    expect(rows).toEqual(before);
    expect(updateMany.mock.calls[0][0].where).toMatchObject({
      organizationId: 'org-a', group: 'group', parentPostId: null, deletedAt: null,
      updatedAt: before[0].updatedAt, state: { in: ['QUEUE', 'DRAFT'] },
      publishDate: { gte: new Date(now.getTime() + 300000) },
    });
    expect(list).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
  it('rejects a publish state change occurring while provider validation is in flight', async () => {
    provider.checkValidity.mockImplementationOnce(async () => {
      saved('root-a').state = 'PUBLISHED';
      saved('root-a').updatedAt = now;
      return true;
    });
    await expect(service.updatePublicPostGroup('org-a', 'group', {
      posts: [{ id: 'root-a', content: 'Edited' }],
    })).rejects.toMatchObject({ status: 409 });
    expect(saved('root-a').content).toBe('Text root-a');
    expect(saved('root-a').state).toBe('PUBLISHED');
    expect(start).not.toHaveBeenCalled();
  });
  it('rechecks the five-minute boundary after asynchronous provider validation', async () => {
    saved('root-a').publishDate = new Date(now.getTime() + 600000);
    provider.checkValidity.mockImplementationOnce(async () => {
      jest.setSystemTime(new Date(now.getTime() + 300001));
      return true;
    });
    const before = snapshot();
    await expect(service.updatePublicPostGroup('org-a', 'group', {
      posts: [{ id: 'root-a', content: 'Edited' }],
    })).rejects.toMatchObject({ status: 409 });
    expect(rows).toEqual(before);
    expect(start).not.toHaveBeenCalled();
  });
  it('rejects a requested date that elapsed during validation before writing any rows', async () => {
    provider.checkValidity.mockImplementationOnce(async () => {
      jest.setSystemTime(new Date(now.getTime() + 65000));
      return true;
    });
    const before = snapshot();
    try {
      await service.updatePublicPostGroup('org-a', 'group', {
        date: new Date(now.getTime() + 60000).toISOString(),
      });
      throw new Error('Expected elapsed date rejection');
    } catch (err) {
      expect((err as HttpException).getStatus()).toBe(400);
      expect((err as HttpException).getResponse()).toEqual({ msg: 'date must be in the future' });
    }
    expect(rows).toEqual(before);
    expect(updateMany).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
  it('rolls back content/date writes if the descendant soft delete fails', async () => {
    const before = snapshot();
    const implementation = updateMany.getMockImplementation();
    updateMany.mockImplementation(async (args) => {
      if (args.where.id?.in && args.data.deletedAt) throw new Error('Database failure');
      return implementation(args);
    });
    await expect(service.updatePublicPostGroup('org-a', 'group', {
      date: newDate, posts: [{ id: 'root-b', content: 'Edited' }], removePostIds: ['root-a'],
    })).rejects.toThrow('Database failure');
    expect(rows).toEqual(before);
    expect(start).not.toHaveBeenCalled();
  });
});
