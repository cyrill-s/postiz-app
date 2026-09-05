import { VkCommunityProvider } from './vk.community.provider';
import { BadBody, RefreshToken, NotEnoughScopes } from '../social.abstract';
import axios from 'axios';
import { Readable } from 'stream';

jest.mock('axios');

describe('VK community channels', () => {
  let provider: VkCommunityProvider;
  let fetchMock: jest.SpyInstance;
  const post = { id: 'post-uuid-1', message: 'Test', settings: {} };
  const respond = (response: unknown) =>
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ response })));
  const sent = (index: number) =>
    fetchMock.mock.calls[index][1].body as URLSearchParams;

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://poster.example';
    process.env.VK_COMMUNITY_ID = 'api-app';
    process.env.VK_COMMUNITY_SECRET = 'app-secret';
    provider = new VkCommunityProvider();
    fetchMock = jest.spyOn(global, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  it('uses the existing VK callback with a random, provider-specific state', async () => {
    process.env.FRONTEND_URL = 'https://poster.example';
    process.env.VK_ID = 'test-app';
    const a = await provider.generateAuthUrl();
    const b = await provider.generateAuthUrl();
    const url = new URL(a.url);
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://poster.example/integrations/social/vk'
    );
    expect(url.searchParams.get('state')).toBe(a.state);
    expect(a.state).toMatch(/^vk-community-.{32}$/);
    expect(a.state).not.toBe(b.state);
    expect(url.searchParams.get('scope')).toContain('groups');
    expect(url.searchParams.get('scope')).not.toContain('offline');
    expect(url.origin).toBe('https://oauth.vk.com');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('api-app');
    expect(url.toString()).not.toContain('app-secret');
  });

  it('explains missing configuration without sending users through broken VK ID OAuth', async () => {
    delete process.env.VK_COMMUNITY_SECRET;
    const url = new URL((await provider.generateAuthUrl()).url);
    expect(url.origin).toBe('https://poster.example');
    expect(url.searchParams.get('error')).toBe('configuration');
  });

  it('does not reuse the personal VK integration ID during selection', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'secret', expires_in: 0 }))
    );
    respond(8192 | 262144 | 4 | 16);
    respond([{ id: 123, first_name: 'Test', last_name: 'User' }]);
    expect(
      (await provider.authenticate({ code: 'code', codeVerifier: 'proof' })).id
    ).toBe('vk-community-user:123');
    expect(sent(0).get('redirect_uri')).toBe(
      'https://poster.example/integrations/social/vk'
    );
    expect(sent(0).get('code')).toBe('code');
  });

  it('rejects OAuth without publishing scopes before creating a channel', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'secret' }))
    );
    respond(4);
    await expect(
      provider.authenticate({ code: 'code', codeVerifier: 'proof' })
    ).rejects.toBeInstanceOf(NotEnoughScopes);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not pretend to refresh a revoked legacy token', async () => {
    expect((await provider.refreshToken()).accessToken).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('paginates groups and gives every publishable community its own ID', async () => {
    respond({
      count: 3,
      items: [
        { id: 1, name: 'A', admin_level: 3 },
        { id: 2, name: 'Moderator', admin_level: 1 },
      ],
    });
    respond({ count: 3, items: [{ id: 3, name: 'B', admin_level: 2 }] });
    const pages = await provider.pages('secret');
    expect(pages.map((p) => p.id)).toEqual([
      'vk-community:1',
      'vk-community:3',
    ]);
    expect(sent(1).get('offset')).toBe('2');
    expect(sent(0).get('filter')).toBe('editor');
  });

  it('checks editor permissions server-side, even for a forged selection', async () => {
    respond({ groups: [{ id: 1, name: 'No access', admin_level: 1 }] });
    await expect(
      provider.fetchPageInformation('secret', { page: 'vk-community:1' })
    ).rejects.toBeInstanceOf(BadBody);
  });

  it('rejects a personal ID without contacting VK', async () => {
    await expect(provider.post('123', 'secret', [post])).rejects.toBeInstanceOf(
      BadBody
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reconnects the selected group, keeping its identity and metadata', async () => {
    respond({
      groups: [
        {
          id: 123,
          name: 'Group',
          admin_level: 3,
          photo_200: 'avatar',
          screen_name: 'group',
        },
      ],
    });
    expect(
      await provider.reConnect(
        'vk-community-user:1',
        'vk-community:123',
        'new-secret'
      )
    ).toEqual({
      id: 'vk-community:123',
      name: 'Group',
      accessToken: 'new-secret',
      picture: 'avatar',
      username: 'group',
    });
  });

  it('posts to the negative group wall, from the community, with a retry GUID', async () => {
    respond({ post_id: 42 });
    expect(await provider.post('vk-community:123', 'secret', [post])).toEqual([
      {
        id: post.id,
        postId: '42',
        releaseURL: 'https://vk.com/wall-123_42',
        status: 'completed',
      },
    ]);
    expect(Object.fromEntries(sent(0))).toMatchObject({
      owner_id: '-123',
      from_group: '1',
      message: 'Test',
      guid: post.id,
    });
    expect(fetchMock.mock.calls[0][0]).not.toContain('secret');
  });

  it('never reports a VK HTTP-200 API error as a completed post or logs the token', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            error_code: 15,
            request_params: [{ key: 'access_token', value: 'secret' }],
          },
        })
      )
    );
    try {
      await provider.post('vk-community:123', 'secret', [post]);
      throw new Error('Expected API failure');
    } catch (error) {
      expect(error).toBeInstanceOf(BadBody);
      expect(JSON.stringify(error)).not.toContain('secret');
    }
  });

  it('requests token refresh on revoked credentials and rejects missing post IDs', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { error_code: 5 } }))
    );
    await expect(
      provider.post('vk-community:123', 'secret', [post])
    ).rejects.toBeInstanceOf(RefreshToken);
    respond({});
    await expect(
      provider.post('vk-community:123', 'secret', [post])
    ).rejects.toBeInstanceOf(BadBody);
  });

  it('uploads photos to the group and uses the media owner returned by VK', async () => {
    respond({ upload_url: 'https://upload.vk.com/photo' });
    respond([{ id: 9, owner_id: -987 }]);
    respond({ post_id: 42 });
    jest
      .mocked(axios.get)
      .mockResolvedValueOnce({ data: Readable.from(Buffer.from('photo')) });
    jest
      .mocked(axios.post)
      .mockResolvedValueOnce({
        data: { photo: 'photo-json', server: 7, hash: 'hash' },
      });
    await provider.post('vk-community:123', 'secret', [
      {
        ...post,
        media: [{ type: 'image', path: 'https://poster.example/test.jpg' }],
      },
    ]);
    expect(sent(0).get('group_id')).toBe('123');
    expect(sent(1).get('group_id')).toBe('123');
    expect(sent(2).get('attachments')).toBe('photo-987_9');
  });

  it('uploads video under video_file and never asks VK to auto-post it', async () => {
    respond({
      upload_url: 'https://upload.vk.com/video',
      owner_id: -123,
      video_id: 8,
      access_key: 'key',
    });
    respond({ post_id: 42 });
    jest
      .mocked(axios.get)
      .mockResolvedValueOnce({ data: Readable.from(Buffer.from('video')) });
    jest
      .mocked(axios.post)
      .mockResolvedValueOnce({ data: { video_id: 8, size: 5 } });
    await provider.post('vk-community:123', 'secret', [
      {
        ...post,
        media: [{ type: 'video', path: 'https://poster.example/test.mp4' }],
      },
    ]);
    expect(sent(0).get('wallpost')).toBe('0');
    expect(sent(1).get('attachments')).toBe('video-123_8_key');
    const form = jest.mocked(axios.post).mock.calls.at(-1)![1] as any;
    expect(form._streams[0]).toContain('name="video_file"');
  });

  it('comments on the selected wall using the group ID as from_group', async () => {
    respond({ comment_id: 9 });
    await provider.comment('vk-community:123', '42', undefined, 'secret', [
      post,
    ]);
    expect(Object.fromEntries(sent(0))).toMatchObject({
      owner_id: '-123',
      from_group: '123',
      post_id: '42',
      guid: post.id,
    });
  });
});
