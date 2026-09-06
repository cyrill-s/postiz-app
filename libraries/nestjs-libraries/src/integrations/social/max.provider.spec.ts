import { Readable } from 'stream';
import { MaxProvider } from './max.provider';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { BadBody, RefreshToken } from '../social.abstract';
import { timer } from '@gitroom/helpers/utils/timer';
jest.mock('@gitroom/helpers/utils/timer', () => ({
  timer: jest.fn().mockResolvedValue(undefined),
}));

const credentials = { chatId: '-123456', token: 'private-max-bot-token' };
const post = {
  id: 'post-1',
  message: 'Привет из Postiz! https://example.org',
  settings: {},
};

describe('MAX channels', () => {
  let provider: MaxProvider;
  let mock: jest.SpyInstance;
  let encrypted: string;
  const reply = (data: unknown, status = 200) =>
    mock.mockResolvedValueOnce(new Response(JSON.stringify(data), { status }));
  const auth = (data: unknown = credentials) =>
    provider.authenticate({
      code: Buffer.from(JSON.stringify(data)).toString('base64'),
      codeVerifier: 'nonce',
    });
  const channel = (extra = {}) =>
    reply({
      chat_id: -123456,
      type: 'channel',
      status: 'active',
      title: 'Новости',
      icon: { url: 'https://example.org/icon.png' },
      ...extra,
    });
  const publish = (posts: any[] = [post], id = 'max:-123456') =>
    provider.post(id, encrypted, posts);
  const sent = (index: number) => JSON.parse(mock.mock.calls[index][1].body);
  const media = (type: 'image' | 'video') => ({
    type,
    path: `https://example.org/media.${type === 'image' ? 'png' : 'mp4'}`,
  });
  const source = () => {
    jest.spyOn(provider as any, 'mediaSize').mockResolvedValue(16);
    jest
      .spyOn(provider as any, 'mediaStream')
      .mockImplementation(async () => Readable.from(Buffer.alloc(16)));
  };
  beforeEach(() => {
    process.env.JWT_SECRET = 'isolated-test-encryption-key';
    provider = new MaxProvider();
    mock = jest.spyOn(global, 'fetch');
    encrypted = AuthService.fixedEncryption(JSON.stringify(credentials));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('checks channel membership and encrypts credentials separately for each channel', async () => {
    channel();
    reply({ is_admin: true, permissions: ['write'] });
    const result = await auth();
    expect(result).toMatchObject({
      id: 'max:-123456',
      name: 'Новости',
      accessToken: encrypted,
      expiresIn: 0,
    });
    expect(encrypted).not.toContain(credentials.token);
    expect(mock.mock.calls.map(([url]) => url)).toEqual([
      'https://platform-api2.max.ru/chats/-123456',
      'https://platform-api2.max.ru/chats/-123456/members/me',
    ]);
    expect(mock.mock.calls[0][1].headers.Authorization).toBe(credentials.token);
    expect(mock.mock.calls[0][0]).not.toContain(credentials.token);
  });
  it.each([
    { is_admin: false },
    { is_admin: true, permissions: ['read_all_messages'] },
    { is_admin: true, permissions: null },
  ])('rejects insufficient publishing rights: %j', async (member) => {
    channel();
    reply(member);
    expect(await auth()).toContain('правом публикации');
  });
  it('accepts the legacy publishing permission', async () => {
    channel();
    reply({ is_admin: true, permissions: ['post_edit_delete_message'] });
    expect(await auth()).toMatchObject({ id: 'max:-123456' });
  });
  it.each([
    { type: 'dialog' },
    { type: 'chat' },
    { status: 'removed' },
    { chat_id: -999 },
  ])('rejects the wrong channel: %j', async (extra) => {
    channel(extra);
    expect(await auth()).toContain('активного канала');
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it.each([
    { chatId: 'https://max.ru/channel' },
    { chatId: '9007199254740993' },
    { token: 'bad\ntoken' },
    { token: null },
  ])(
    'rejects malformed credentials without an API request: %j',
    async (extra) => {
      expect(typeof (await auth({ ...credentials, ...extra }))).toBe('string');
      expect(mock).not.toHaveBeenCalled();
    }
  );
  it('posts plain text and uses the returned permalink', async () => {
    reply({
      message: { body: { mid: 'mid.123' }, url: 'https://max.ru/channel/post' },
    });
    expect(await publish()).toEqual([
      {
        id: post.id,
        postId: 'mid.123',
        releaseURL: 'https://max.ru/channel/post',
        status: 'completed',
      },
    ]);
    expect(sent(0)).toEqual({ text: post.message });
    expect(mock.mock.calls[0][0]).toBe(
      'https://platform-api2.max.ru/messages?chat_id=-123456'
    );
  });
  it('does not invent a permalink for a private channel', async () => {
    reply({ message: { body: { mid: 'mid.123' } } });
    expect(await publish()).toMatchObject([{ releaseURL: '' }]);
  });
  it('rejects credentials from another channel before posting', async () => {
    await expect(publish([post], 'max:-999')).rejects.toBeInstanceOf(BadBody);
    expect(mock).not.toHaveBeenCalled();
  });
  it.each(
    [
      [],
      [post, post],
      [{ ...post, message: '' }],
      [{ ...post, message: 'x'.repeat(4001) }],
      [{ ...post, media: Array(11).fill(media('image')) }],
    ].map((posts) => ({ posts }))
  )('rejects unsupported post content before sending', async ({ posts }) => {
    await expect(publish(posts)).rejects.toBeInstanceOf(BadBody);
    expect(mock).not.toHaveBeenCalled();
  });
  it('uploads an image and sends its returned photos payload', async () => {
    source();
    reply({ url: 'https://iu.oneme.ru/upload?token=upload-secret' });
    const payload = { photos: { photo1: { token: 'image-token' } } };
    reply(payload);
    reply({ message: { body: { mid: 'mid.image' } } });
    await publish([{ ...post, media: [media('image')] }]);
    expect(mock.mock.calls[0][0]).toContain('/uploads?type=image');
    expect(sent(2).attachments).toEqual([{ type: 'image', payload }]);
    expect(mock.mock.calls[1][1].headers.Authorization).toBeUndefined();
  });
  it('uses the video token from the upload URL response, with a media-only post', async () => {
    source();
    reply({ url: 'https://omub.okcdn.ru/upload', token: 'video-token' });
    reply({ retval: 1 });
    reply({ message: { body: { mid: 'mid.video' } } });
    await publish([{ ...post, message: '', media: [media('video')] }]);
    expect(sent(2)).toEqual({
      text: null,
      attachments: [{ type: 'video', payload: { token: 'video-token' } }],
    });
  });
  it('accepts an XML response from the video upload host', async () => {
    source();
    reply({ url: 'https://omub.okcdn.ru/upload', token: 'video-token' });
    mock.mockResolvedValueOnce(new Response('<retval>1</retval>'));
    reply({ message: { body: { mid: 'mid.video' } } });
    await expect(
      publish([{ ...post, media: [media('video')] }])
    ).resolves.toMatchObject([{ postId: 'mid.video' }]);
  });
  it('does not repeat a send after a network failure with an unknown outcome', async () => {
    mock.mockRejectedValueOnce(new Error('Connection reset'));
    await expect(publish()).rejects.toBeInstanceOf(BadBody);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('backs off on an explicit rate limit response', async () => {
    reply({ code: 'rate.limit' }, 429);
    reply({ message: { body: { mid: 'mid.retry' } } });
    await expect(publish()).resolves.toMatchObject([{ postId: 'mid.retry' }]);
    expect(timer).toHaveBeenCalledWith(1000);
  });
  it('rejects oversized media before uploading', async () => {
    jest
      .spyOn(provider as any, 'mediaSize')
      .mockResolvedValue(51 * 1024 * 1024);
    await expect(
      publish([{ ...post, media: [media('image')] }])
    ).rejects.toBeInstanceOf(BadBody);
    expect(mock).not.toHaveBeenCalled();
  });
  it('rejects an untrusted upload host without fetching it', async () => {
    source();
    reply({ url: 'https://example.org/upload' });
    await expect(
      publish([{ ...post, media: [media('image')] }])
    ).rejects.toBeInstanceOf(BadBody);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('retries only explicit not-ready responses without re-uploading media', async () => {
    source();
    reply({ url: 'https://iu.oneme.ru/upload' });
    reply({ token: 'image-token' });
    reply({ code: 'attachment.not.ready' }, 400);
    reply({ message: { body: { mid: 'mid.ready' } } });
    await expect(
      publish([{ ...post, media: [media('image')] }])
    ).resolves.toMatchObject([{ postId: 'mid.ready' }]);
    expect(timer).toHaveBeenCalledWith(1000);
    expect(sent(2)).toEqual(sent(3));
  });
  it('bounds retries when media never becomes ready', async () => {
    for (let i = 0; i < 6; i++) reply({ code: 'attachment.not.ready' }, 400);
    await expect(publish()).rejects.toBeInstanceOf(BadBody);
    expect(mock).toHaveBeenCalledTimes(6);
  });
  it('marks expired credentials for reconnection without exposing the upstream body', async () => {
    reply({ message: credentials.token }, 401);
    try {
      await publish();
      throw new Error('Expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(RefreshToken);
      expect(JSON.stringify(error)).not.toContain(credentials.token);
    }
  });
  it('does not retry an ambiguous server error or accept a missing message ID', async () => {
    reply({ message: credentials.token }, 500);
    await expect(publish()).rejects.toBeInstanceOf(BadBody);
    expect(mock).toHaveBeenCalledTimes(1);
    reply({});
    await expect(publish()).rejects.toBeInstanceOf(BadBody);
  });
});
