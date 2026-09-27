const assert = require('node:assert/strict');
const Module = require('node:module');
process.env.TELEGRAM_TOKEN = '123:synthetic';
process.env.TELEGRAM_WEBHOOK_SECRET = 's'.repeat(32);
const data = new Map();
const redis = { set: async (key, value) => data.set(key, value), get: async key => data.get(key) };
const sent = [];
const bot = {
  getChat: async id => String(id) === '-100123'
    ? { id: -100123, type: 'channel', linked_chat_id: -100456, username: 'channel' }
    : { id: -100456, type: 'supergroup', linked_chat_id: -100123 },
  getMe: async () => ({ id: 123 }),
  getChatMember: async () => ({ status: 'administrator' }),
  getChatMemberCount: async () => 5,
  sendMessage: async (...args) => { sent.push(args); return { message_id: 99 }; },
};
const original = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'node-telegram-bot-api') return class { constructor() { return bot; } };
  if (request.includes('/redis/redis.service')) return { ioRedis: redis };
  return original.call(this, request, parent, isMain);
};
(async () => {
  for (const app of ['backend', 'orchestrator']) {
    const root = `/app/apps/${app}/dist/libraries/nestjs-libraries/src`;
    const { TelegramProvider } = require(`${root}/integrations/social/telegram.provider.js`);
    const { TelegramUpdates } = require(`${root}/integrations/social/telegram.updates.js`);
    await new TelegramUpdates().webhook(process.env.TELEGRAM_WEBHOOK_SECRET, { update_id: 1,
      message: { chat: { id: -100456, type: 'supergroup' }, message_id: 77, is_automatic_forward: true,
        forward_origin: { type: 'channel', chat: { id: -100123, type: 'channel' }, message_id: 10 } },
    });
    const provider = new TelegramProvider();
    assert.equal(await provider.checkCommentSupport('channel', '-100123'), true);
    const result = await provider.comment('channel', '10', undefined, '-100123', [{ id: 'test', message: '<b>Test</b>', settings: {} }], {});
    assert.equal(result[0].releaseURL, 'https://t.me/channel/10?comment=99');
    assert.deepEqual(sent.at(-1), ['-100456', '<b>Test</b>', { parse_mode: 'HTML', reply_to_message_id: 77 }]);
    assert.equal((await provider.analytics('channel', '-100123', 7))[0].data[0].total, '5');
    console.log(`${app}: webhook, native discussion comments and participant analytics passed`);
  }
  process.exit(0);
})().catch(error => { console.error(error.name, error.message); process.exit(1); });
