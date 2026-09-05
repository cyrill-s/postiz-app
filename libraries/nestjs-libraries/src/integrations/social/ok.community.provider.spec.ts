import { OkCommunityProvider } from './ok.community.provider';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { BadBody, RefreshToken } from '../social.abstract';
import { createHash } from 'crypto';
const credentials = { groupId: '70000035141015', applicationKey: 'PUBLICKEY', token: 'private-test-access-token', sessionSecret: '1234567890abcdef1234567890abcdef' };
const post = { id: 'post1', message: 'Текст https://example.org', settings: {} };
const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
describe('OK community channels', () => {
  let provider: OkCommunityProvider;
  let mock: jest.SpyInstance;
  let encrypted: string;
  const reply = (data: unknown) => mock.mockResolvedValueOnce(new Response(JSON.stringify(data)));
  const body = (index: number) => mock.mock.calls[index][1].body as URLSearchParams;
  const auth = (data: unknown = credentials) => provider.authenticate({ code: Buffer.from(JSON.stringify(data)).toString('base64'), codeVerifier: 'nonce' });
  const setup = (status = 'ADMIN', groupId = credentials.groupId, userId = '123') => {
    reply({ uid: '123' }); reply(true); reply(true);
    reply([{ groupId, userId, status }]);
  };
  beforeEach(() => {
    process.env.JWT_SECRET = 'isolated-test-encryption-key';
    provider = new OkCommunityProvider();
    mock = jest.spyOn(global, 'fetch');
    encrypted = AuthService.fixedEncryption(JSON.stringify(credentials));
  });
  afterEach(() => jest.restoreAllMocks());
  it('uses password fields for both secrets and one-use connection state', async () => {
    expect((await provider.customFields()).filter(f => f.type === 'password').map(f => f.key)).toEqual(['token', 'applicationSecret']);
    const first = await provider.generateAuthUrl();
    expect(first.url).toBe(first.state);
    expect(first.state).not.toBe((await provider.generateAuthUrl()).state);
  });
  it('derives the session secret from an application secret without storing it', async () => {
    setup(); reply([{ uid: credentials.groupId, name: 'Группа' }]);
    const applicationSecret = 'AppSecretExample_12345==';
    const result = await auth({ ...credentials, sessionSecret: undefined, applicationSecret });
    expect(typeof result).not.toBe('string');
    if (typeof result === 'string') throw Error(result);
    const stored = JSON.parse(AuthService.fixedDecryption(result.accessToken));
    expect(stored.sessionSecret).toBe(createHash('md5').update(credentials.token + applicationSecret).digest('hex'));
    expect(stored.applicationSecret).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain(applicationSecret);
  });
  it('maps the real OK picAvatar response while requesting pic_avatar', async () => {
    setup(); reply([{ uid: credentials.groupId, name: 'Группа', picAvatar: 'https://i.mycdn.me/image?id=123' }]);
    expect(await auth()).toMatchObject({ picture: 'https://i.mycdn.me/image?id=123' });
    expect(body(4).get('fields')).toBe('uid,name,pic_avatar');
  });
  it('validates administrator identity and stores encrypted credentials per group', async () => {
    setup(); reply([{ uid: credentials.groupId, name: 'Группа' }]);
    expect(await auth()).toMatchObject({ id: `ok-community:${credentials.groupId}`, accessToken: encrypted, name: 'Группа', expiresIn: 0 });
    expect(encrypted).not.toContain(credentials.token);
    expect(body(3).get('uids')).toBe('123');
    expect(body(4).get('uids')).toBe(credentials.groupId);
  });
  it.each(['ACTIVE', 'BLOCKED', 'UNKNOWN'])('rejects member status %s', async status => {
    setup(status);
    expect(await auth()).toContain('администратором');
    expect(mock).toHaveBeenCalledTimes(4);
  });
  it('does not trust membership belonging to another user or group', async () => {
    setup('ADMIN', '999'); expect(await auth()).toContain('администратором');
    setup('ADMIN', credentials.groupId, '999'); expect(await auth()).toContain('администратором');
  });
  it('rejects missing publishing permissions', async () => {
    reply({ uid: '123' }); reply(true); reply(false);
    expect(await auth()).toContain('GROUP_CONTENT');
    expect(mock).toHaveBeenCalledTimes(3);
  });
  it('rejects malformed credentials before contacting OK', async () => {
    expect(typeof await auth({ ...credentials, sessionSecret: 'app-secret' })).toBe('string');
    expect(typeof await auth({ ...credentials, groupId: '-123' })).toBe('string');
    expect(typeof await provider.authenticate({ code: '?', codeVerifier: '' })).toBe('string');
    expect(mock).not.toHaveBeenCalled();
  });
  it('signs sorted unencoded parameters, excluding access_token and sends secrets only in the body', async () => {
    reply('111'); await provider.post(`ok-community:${credentials.groupId}`, encrypted, [post]);
    const sent = Object.fromEntries(body(0));
    const { sig, access_token, ...signed } = sent;
    const reference = createHash('md5').update(Object.keys(signed).sort().map(k => `${k}=${signed[k]}`).join('') + credentials.sessionSecret).digest('hex');
    expect(sig).toBe(reference); expect(access_token).toBe(credentials.token);
    expect(mock.mock.calls[0][0]).toBe('https://api.ok.ru/fb.do');
    expect(body(0).has('sessionSecret')).toBe(false);
    expect(JSON.parse(sent.attachment)).toEqual({ media: [{ type: 'text', text: post.message }], onBehalfOfGroup: 'true' });
    expect(sent).toMatchObject({ type: 'GROUP_THEME', gid: credentials.groupId });
  });
  it('returns a group topic permalink only for a confirmed string ID', async () => {
    reply('111'); expect(await provider.post(`ok-community:${credentials.groupId}`, encrypted, [post])).toEqual([{ id: 'post1', postId: '111', releaseURL: `https://ok.ru/group/${credentials.groupId}/topic/111`, status: 'completed' }]);
    reply({}); await expect(provider.post(`ok-community:${credentials.groupId}`, encrypted, [post])).rejects.toBeInstanceOf(BadBody);
  });
  it('cannot use another group channel with stored credentials', async () => {
    await expect(provider.post('ok-community:999', encrypted, [post])).rejects.toBeInstanceOf(BadBody);
    await expect(provider.post(`ok-community:${credentials.groupId}`, credentials.token, [post])).rejects.toBeInstanceOf(BadBody);
    expect(mock).not.toHaveBeenCalled();
  });
  it('rejects videos, excessive photos, empty posts and comment chains', async () => {
    expect(await provider.checkValidity([[{ path: 'https://example.org/a.mp4' }]])).not.toBe(true);
    expect(await provider.checkValidity([Array(11).fill({ path: 'https://example.org/a.png' })])).not.toBe(true);
    await expect(provider.post(`ok-community:${credentials.groupId}`, encrypted, [{ ...post, message: '' }])).rejects.toBeInstanceOf(BadBody);
    await expect(provider.post(`ok-community:${credentials.groupId}`, encrypted, [post, post])).rejects.toBeInstanceOf(BadBody);
    expect(mock).not.toHaveBeenCalled();
  });
  it('does not expose API error payloads or retry an uncertain publication', async () => {
    reply({ error_code: 10, error_msg: credentials.token, request: credentials.sessionSecret });
    try { await provider.post(`ok-community:${credentials.groupId}`, encrypted, [post]); throw Error('expected'); }
    catch (error) { expect(error).toBeInstanceOf(BadBody); expect(JSON.stringify(error)).not.toContain(credentials.token); expect(JSON.stringify(error)).not.toContain(credentials.sessionSecret); }
    mock.mockRejectedValueOnce(new Error('timeout ' + credentials.token));
    await expect(provider.post(`ok-community:${credentials.groupId}`, encrypted, [post])).rejects.toMatchObject({ nonRetryable: true });
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it('requests reconnect for an expired token without pretending to refresh', async () => {
    reply({ error_code: 102 });
    await expect(provider.post(`ok-community:${credentials.groupId}`, encrypted, [post])).rejects.toBeInstanceOf(RefreshToken);
    expect((await provider.refreshToken()).accessToken).toBe('');
  });
  it('uploads a group photo without album commit, then publishes its token', async () => {
    reply(true);
    mock.mockResolvedValueOnce(new Response(png));
    reply({ upload_url: 'https://upload.ok.ru/photos', photo_ids: ['photo1'] });
    reply({ photos: { photo1: { token: 'photo-token' } } });
    reply('111');
    await provider.post(`ok-community:${credentials.groupId}`, encrypted, [{ ...post, media: [{ path: 'https://poster.generationl.ru/uploads/a.png', type: 'image' }] }]);
    expect(body(2).get('gid')).toBe(credentials.groupId);
    expect(body(2).has('aid')).toBe(false);
    expect(mock.mock.calls[3][1].body).toBeInstanceOf(FormData);
    expect(JSON.parse(body(4).get('attachment')!).media[1]).toEqual({ type: 'photo', list: [{ id: 'photo-token' }] });
    expect(mock.mock.calls.filter(call => call[1].body instanceof URLSearchParams).map(call => call[1].body.get('method'))).not.toContain('photosV2.commit');
  });
  it('does not publish when photo permission or upload confirmation is missing', async () => {
    const photoPost = { ...post, media: [{ path: 'https://example.org/a.png', type: 'image' as const }] };
    reply(false); await expect(provider.post(`ok-community:${credentials.groupId}`, encrypted, [photoPost])).rejects.toBeInstanceOf(BadBody);
    reply(true); mock.mockResolvedValueOnce(new Response(png)); reply({ upload_url: 'https://upload.ok.ru/photos' }); reply({ photos: { photo1: { error: 'failed' } } });
    await expect(provider.post(`ok-community:${credentials.groupId}`, encrypted, [photoPost])).rejects.toBeInstanceOf(BadBody);
    expect(mock.mock.calls.some(call => call[1].body instanceof URLSearchParams && call[1].body.get('method') === 'mediatopic.post')).toBe(false);
  });
  it('rejects unsafe upload targets and oversized source images', async () => {
    const photoPost = { ...post, media: [{ path: 'https://example.org/a.png', type: 'image' as const }] };
    reply(true); mock.mockResolvedValueOnce(new Response(png)); reply({ upload_url: 'https://evil.example/upload' });
    await expect(provider.post(`ok-community:${credentials.groupId}`, encrypted, [photoPost])).rejects.toBeInstanceOf(BadBody);
    reply(true); mock.mockResolvedValueOnce(new Response(Buffer.alloc(10*1024*1024+1)));
    await expect(provider.post(`ok-community:${credentials.groupId}`, encrypted, [photoPost])).rejects.toBeInstanceOf(BadBody);
    expect(mock).toHaveBeenCalledTimes(5);
  });
});
