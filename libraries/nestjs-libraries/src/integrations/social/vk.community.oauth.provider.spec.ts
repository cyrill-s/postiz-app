import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { VkCommunityOAuthProvider } from './vk.community.oauth.provider';

const TOKEN = 'vk2.a.test-only-access-token';
const REFRESH = 'vk2.r.test-only-refresh-token';
const GROUP_ID = '230176305';
const USER_ID = 321;
const app = '54782667';
const identity = 'vk-community-oauth:' + GROUP_ID;
const auth = {
  state: 'state-from-the-pkce-flow',
  code: 'authorization-code&&&&device',
  codeVerifier: 'from-the-same-pkce-flow',
  reconnectId: 'vk-community:' + GROUP_ID,
};
const grant = {
  access_token: TOKEN,
  refresh_token: REFRESH,
  expires_in: 3600,
  user_id: USER_ID,
  state: auth.state,
  scope: 'photos wall vkid.personal_info',
};

describe('VK community via VK ID', () => {
  let provider: VkCommunityOAuthProvider;
  let fetchMock: jest.SpyInstance;
  const json = (data: unknown) =>
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(data)));
  const data = (index: number) =>
    fetchMock.mock.calls[index][1].body as URLSearchParams;

  beforeEach(() => {
    process.env.JWT_SECRET = 'isolated-test-encryption-key';
    process.env.FRONTEND_URL = 'https://postiz.example';
    process.env.VK_COMMUNITY_OAUTH_CLIENT_ID = app;
    provider = new VkCommunityOAuthProvider();
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('Unstubbed network request'));
  });

  afterEach(() => jest.restoreAllMocks());

  it('requests the dedicated app and the two approved scopes using the registered VK callback', async () => {
    const session = await provider.generateAuthUrl();
    const url = new URL(session.url);
    expect(url.origin).toBe('https://id.vk.ru');
    expect(url.searchParams.get('client_id')).toBe(app);
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://postiz.example/integrations/social/vk'
    );
    expect(url.searchParams.get('scope')).toBe('wall photos');
    expect(url.searchParams.get('state')).toBe(session.state);
    expect(session.state).toMatch(/^vk_community_[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).not.toBe(
      session.codeVerifier
    );
  });

  it('binds a grant to the managed community and seals both credentials', async () => {
    json(grant);
    json({ response: { count: 0, items: [] } });
    json({ response: { upload_url: 'https://pu.vk.ru/upload' } });
    json({
      response: {
        groups: [
          { id: Number(GROUP_ID), name: 'Books', screen_name: 'lavkaoma' },
        ],
      },
    });
    const result = await provider.authenticate(auth);
    expect(result).toMatchObject({
      id: identity,
      expiresIn: 3600,
      username: 'lavkaoma',
    });
    expect(result.accessToken).not.toContain(TOKEN);
    expect(result.refreshToken).not.toContain(REFRESH);
    expect(JSON.parse(AuthService.fixedDecryption(result.accessToken))).toEqual(
      {
        group: GROUP_ID,
        user: USER_ID,
        accessToken: TOKEN,
      }
    );
    expect(data(0).get('device_id')).toBe('device');
    expect(data(1).get('filter')).toBe('postponed');
    expect(data(1).get('owner_id')).toBe('-' + GROUP_ID);
  });

  it('requires a trusted reconnect and rejects a token without photos', async () => {
    await expect(
      provider.authenticate({ ...auth, reconnectId: undefined })
    ).rejects.toMatchObject({
      message: expect.stringContaining('переподключение'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    json({ ...grant, scope: 'wall vkid.personal_info' });
    await expect(provider.authenticate(auth)).rejects.toMatchObject({
      message: expect.stringContaining('wall и photos'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects an account that can read the public wall but lacks management access', async () => {
    json(grant);
    json({
      error: {
        error_code: 15,
        request_params: [{ key: 'access_token', value: TOKEN }],
      },
    });
    await expect(provider.authenticate(auth)).rejects.toMatchObject({
      message: expect.stringContaining('управляет стеной'),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rotates credentials with the same app, device and channel', async () => {
    const encrypted = AuthService.fixedEncryption(
      JSON.stringify({
        group: GROUP_ID,
        user: USER_ID,
        app,
        device: 'device',
        refreshToken: REFRESH,
      })
    );
    fetchMock.mockImplementationOnce((_url, request) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            ...grant,
            state: request.body.get('state'),
            refresh_token: 'rotated',
          })
        )
      )
    );
    const result = await provider.refreshToken(encrypted);
    expect(result.id).toBe(identity);
    expect(data(0).get('client_id')).toBe(app);
    expect(data(0).get('device_id')).toBe('device');
    expect(data(0).get('refresh_token')).toBe(REFRESH);
    expect(
      JSON.parse(AuthService.fixedDecryption(result.refreshToken!)).refreshToken
    ).toBe('rotated');
  });

  it('attaches a user-owned upload to the community post and uses the calendar post id for deduplication', async () => {
    const encrypted = AuthService.fixedEncryption(
      JSON.stringify({
        group: GROUP_ID,
        user: USER_ID,
        accessToken: TOKEN,
      })
    );
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))
    );
    json({ response: { upload_url: 'https://pu.vk.ru/upload' } });
    json({ server: 1, photo: '[1]', hash: 'checksum' });
    json({ response: [{ owner_id: USER_ID, id: 456 }] });
    json({ response: { post_id: 23 } });
    const result = await provider.post(identity, encrypted, [
      {
        id: 'post-id',
        message: 'Caption',
        settings: {},
        media: [{ type: 'image', path: 'https://postiz.example/image.jpg' }],
      },
    ]);
    expect(data(1).get('group_id')).toBe(GROUP_ID);
    expect(data(3).get('group_id')).toBe(GROUP_ID);
    expect(data(4).get('attachments')).toBe('photo321_456');
    expect(data(4).get('owner_id')).toBe('-' + GROUP_ID);
    expect(data(4).get('from_group')).toBe('1');
    expect(data(4).get('guid')).toBe('post-id');
    expect(result[0].releaseURL).toBe('https://vk.ru/wall-230176305_23');
  });

  it('rejects any publish attempt for another wall before calling the network', async () => {
    const encrypted = AuthService.fixedEncryption(
      JSON.stringify({
        group: GROUP_ID,
        user: USER_ID,
        accessToken: TOKEN,
      })
    );
    await expect(
      provider.post('vk-community-oauth:1', encrypted, [])
    ).rejects.toThrow('другому сообществу');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
