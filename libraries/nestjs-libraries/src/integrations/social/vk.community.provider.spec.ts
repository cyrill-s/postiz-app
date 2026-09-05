import { VkCommunityProvider } from './vk.community.provider';
import { BadBody, RefreshToken } from '../social.abstract';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

const TOKEN = 'vk1.a.community-test-secret';
const post = {
  id: 'post-uuid-1',
  message: 'Test https://example.com',
  settings: {},
};

describe('VK community token channels', () => {
  let provider: VkCommunityProvider;
  let fetchMock: jest.SpyInstance;
  let encrypted: string;
  const respond = (response: unknown) =>
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ response })));
  const error = (error_code: number) =>
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            error_code,
            request_params: [{ key: 'access_token', value: TOKEN }],
          },
        })
      )
    );
  const sent = (index: number) =>
    fetchMock.mock.calls[index][1].body as URLSearchParams;
  const auth = (fields = { token: TOKEN }) =>
    provider.authenticate({
      code: Buffer.from(JSON.stringify(fields)).toString('base64'),
      codeVerifier: 'nonce',
    });

  beforeEach(() => {
    process.env.JWT_SECRET = 'isolated-test-encryption-key';
    provider = new VkCommunityProvider();
    fetchMock = jest.spyOn(global, 'fetch');
    encrypted = AuthService.fixedEncryption(TOKEN);
  });
  afterEach(() => jest.restoreAllMocks());

  it('requires only a password field and creates random non-OAuth state', async () => {
    expect(await provider.customFields()).toMatchObject([
      { key: 'token', type: 'password' },
    ]);
    const a = await provider.generateAuthUrl();
    const b = await provider.generateAuthUrl();
    expect(a.url).toBe(a.state);
    expect(a.state).toHaveLength(32);
    expect(a.state).not.toBe(b.state);
    expect(provider.isBetweenSteps).toBe(false);
  });

  it('derives community identity from the token and stores encrypted credentials', async () => {
    respond({ mask: 8192 });
    respond({
      groups: [
        { id: 123, name: 'Group', screen_name: 'group', photo_200: 'avatar' },
      ],
    });
    const result = await auth();
    expect(result).toEqual({
      id: 'vk-community:123',
      name: 'Group',
      accessToken: encrypted,
      refreshToken: '',
      expiresIn: 0,
      picture: 'avatar',
      username: 'group',
    });
    expect(encrypted).not.toContain(TOKEN);
    expect(sent(1).has('group_id')).toBe(false);
    expect(sent(0).get('access_token')).toBe(TOKEN);
  });

  it('adds distinct communities with distinct IDs rather than the VK user ID', async () => {
    for (const id of [123, 456]) {
      respond({ mask: 8192 });
      respond({ groups: [{ id, name: 'Group' }] });
      expect(await auth()).toMatchObject({ id: `vk-community:${id}` });
    }
  });

  it('rejects missing wall permission before looking up or saving a community', async () => {
    respond({ mask: 4 });
    expect(await auth()).toContain('нет доступа к стене');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects service/user keys without treating public group metadata as proof', async () => {
    error(27);
    expect(typeof (await auth())).toBe('string');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects ambiguous or deactivated community identity', async () => {
    respond({ mask: 8192 });
    respond({ groups: [{ id: 1 }, { id: 2 }] });
    expect(await auth()).toContain('Не удалось определить');
    respond({ mask: 8192 });
    respond({ groups: [{ id: 1, deactivated: 'deleted' }] });
    expect(await auth()).toContain('Не удалось определить');
  });

  it('handles malformed and invalid credentials without contacting VK', async () => {
    expect(
      typeof (await provider.authenticate({ code: 'broken', codeVerifier: '' }))
    ).toBe('string');
    expect(typeof (await auth({ token: 'short' }))).toBe('string');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not pretend to refresh a revoked community key', async () => {
    expect((await provider.refreshToken()).accessToken).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to the negative group wall, from the community, with a retry GUID', async () => {
    respond({ post_id: 42 });
    expect(await provider.post('vk-community:123', encrypted, [post])).toEqual([
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
      message: post.message,
      guid: post.id,
    });
    expect(fetchMock.mock.calls[0][0]).not.toContain(TOKEN);
  });

  it('rejects personal IDs and plaintext storage credentials before any request', async () => {
    await expect(
      provider.post('123', encrypted, [post])
    ).rejects.toBeInstanceOf(BadBody);
    await expect(
      provider.post('vk-community:123', TOKEN, [post])
    ).rejects.toBeInstanceOf(BadBody);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects media both at scheduling validation and at publication', async () => {
    expect(await provider.checkValidity([[{ path: 'photo.jpg' }]])).toContain(
      'Удалите фото и видео'
    );
    expect(await provider.checkValidity([[]])).toBe(true);
    await expect(
      provider.post('vk-community:123', encrypted, [
        { ...post, media: [{ type: 'image', path: 'photo.jpg' }] },
      ])
    ).rejects.toBeInstanceOf(BadBody);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never reports an HTTP-200 VK error as completed or exposes request_params', async () => {
    error(15);
    try {
      await provider.post('vk-community:123', encrypted, [post]);
      throw new Error('Expected failure');
    } catch (e) {
      expect(e).toBeInstanceOf(BadBody);
      expect(JSON.stringify(e)).not.toContain(TOKEN);
    }
  });

  it('does not disconnect a key for unsupported group auth methods (error 27)', async () => {
    error(27);
    await expect(
      provider.post('vk-community:123', encrypted, [post])
    ).rejects.toBeInstanceOf(BadBody);
  });

  it('requests reconnect on revoked credentials and rejects missing post IDs', async () => {
    error(5);
    await expect(
      provider.post('vk-community:123', encrypted, [post])
    ).rejects.toBeInstanceOf(RefreshToken);
    respond({});
    await expect(
      provider.post('vk-community:123', encrypted, [post])
    ).rejects.toBeInstanceOf(BadBody);
  });

  it('rejects empty posts before calling VK', async () => {
    await expect(
      provider.post('vk-community:123', encrypted, [{ ...post, message: ' ' }])
    ).rejects.toBeInstanceOf(BadBody);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
