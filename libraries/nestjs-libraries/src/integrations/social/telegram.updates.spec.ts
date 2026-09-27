import { TelegramUpdates } from './telegram.updates';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { set: jest.fn(), get: jest.fn(), getdel: jest.fn() },
}));
const forward = {
  update_id: 1,
  message: {
    message_id: 77,
    chat: { id: -100456, type: 'supergroup' },
    is_automatic_forward: true,
    text: 'Private content must not be retained',
    forward_origin: {
      type: 'channel',
      chat: { id: -100123, type: 'channel' },
      message_id: 10,
    },
  },
};
beforeEach(() => {
  jest.resetAllMocks();
  process.env.TELEGRAM_TOKEN = '123:synthetic';
  process.env.TELEGRAM_WEBHOOK_SECRET = 's'.repeat(32);
});
afterEach(() => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
});

it.each([undefined, 'wrong', 'я'.repeat(32)])(
  'rejects invalid webhook authentication before touching Redis: %s',
  async (secret) => {
    await expect(
      new TelegramUpdates().webhook(secret, forward)
    ).rejects.toThrow();
    expect(ioRedis.set).not.toHaveBeenCalled();
  }
);
it('rejects a disabled webhook even if an empty secret is supplied', async () => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
  await expect(new TelegramUpdates().webhook('', forward)).rejects.toThrow();
});
it('stores only routing IDs for an authenticated automatic forward', async () => {
  expect(await new TelegramUpdates().webhook('s'.repeat(32), forward)).toEqual({
    ok: true,
  });
  expect(ioRedis.set).toHaveBeenCalledWith(
    expect.stringContaining(':discussion:-100123:10'),
    JSON.stringify({ chatId: -100456, messageId: 77 })
  );
  expect(JSON.stringify((ioRedis.set as jest.Mock).mock.calls)).not.toContain(
    'Private content'
  );
  expect(JSON.stringify((ioRedis.set as jest.Mock).mock.calls)).not.toContain(
    'synthetic'
  );
});
it.each([
  { ...forward, message: { ...forward.message, is_automatic_forward: false } },
  {
    ...forward,
    message: { ...forward.message, forward_origin: { type: 'user' } },
  },
  { update_id: 5, message: null },
  null,
])('ignores manual forwards and unrelated updates: %j', async (update) => {
  await new TelegramUpdates().webhook('s'.repeat(32), update);
  expect(ioRedis.set).not.toHaveBeenCalled();
});
it('retains onboarding commands briefly, without keeping their text', async () => {
  await new TelegramUpdates().receive({
    update_id: 10,
    channel_post: {
      message_id: 8,
      chat: { id: -100123, type: 'channel' },
      text: '/connect abcd',
    },
  });
  expect(ioRedis.set).toHaveBeenCalledWith(
    expect.stringContaining(':connect:abcd'),
    JSON.stringify({ chatId: -100123, messageId: 8, updateId: 10 }),
    'EX',
    600,
    'NX'
  );
});
