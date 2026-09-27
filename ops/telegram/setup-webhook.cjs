// Run inside the app container after deployment. Never log Bot API URLs or secrets.
const assert = require('node:assert/strict');
async function request(method, payload = {}) {
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
  });
  const body = await response.json();
  assert.ok(response.ok && body.ok, `Telegram rejected ${method}: HTTP ${response.status}`);
  return body.result;
}
(async () => {
  const url = `${process.env.FRONTEND_URL}/api/integrations/telegram/webhook`;
  assert.ok(url.startsWith('https://'));
  const before = await request('getWebhookInfo');
  assert.ok(!before.url || before.url === url, 'Another webhook is configured; preserve it.');
  if (process.argv[2] === 'apply') {
    assert.ok((process.env.TELEGRAM_WEBHOOK_SECRET?.length || 0) >= 32);
    await request('setWebhook', { url, secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: [...new Set([...(before.allowed_updates || []), 'message', 'channel_post'])],
      drop_pending_updates: false,
    });
  } else if (process.argv[2] === 'rollback') {
    await request('deleteWebhook', { drop_pending_updates: false });
  } else assert.equal(process.argv[2], 'inspect');
  const after = await request('getWebhookInfo');
  console.log(JSON.stringify({ configured: !!after.url, matchesPostiz: after.url === url,
    pending: after.pending_update_count, hasDeliveryError: !!after.last_error_date,
    allowedUpdates: after.allowed_updates }));
})().catch(error => { console.error(error.name, error.message.replace(/bot[0-9]+:[^/\s]+/g, 'bot[redacted]')); process.exitCode = 1; });
