# Telegram native comments and available analytics

The existing Telegram bot remains the only Telegram identity. No user account or MTProto session is required.

## Behavior

- Channel comments are replies to the automatically forwarded post in the linked discussion supergroup. They are never sent as new channel posts. All scheduled comments reply to the original discussion root; Temporal keeps its existing delays.
- The bot must administer both the channel and its discussion group. Postiz checks the discussion configuration when validating a post that includes comments, before publishing the root.
- Automatic forwards arrive at `/api/integrations/telegram/webhook`. An authenticated webhook stores only channel/group/message IDs in Redis. Mappings have no expiry, so delayed comments can use them after Telegram's 24-hour update retention window. Keep Redis persistent and backed up. If a mapping is missing or the discussion group changes, Postiz fails clearly rather than sending an unrelated message.
- Existing `/connect` onboarding uses short-lived, one-time webhook receipts while webhook mode is enabled. Polling onboarding remains available when it is disabled. The two update mechanisms are never called together.
- Text, formatting, links and existing media publishing remain available. A comment supports at most 10 files; text limits remain 4096 without media and 1024 with media. Split media/text publishing for the main post is preserved.
- Private channel and group links use Telegram's `t.me/c` format.
- Channel analytics shows the current Bot API participant count and the number of saved PUBLISHED root posts through this Postiz connection in the selected 7/30-day period. Counts exclude comments, deleted records, drafts, and other organizations/connections. They are snapshots, without artificial growth charts.
- Bot API does not expose post views or reach history. No fabricated zero counters are returned. Existing short-link click analytics remains available.

## Configuration

Keep the existing `TELEGRAM_TOKEN`. Generate `TELEGRAM_WEBHOOK_SECRET` on the server (at least 32 random ASCII characters) and add it to the app environment. Do not commit the secret. Deploy the new image and check the endpoint before registering it:

```sh
docker exec -w /app postiz-next-app-1 node ops/telegram/setup-webhook.cjs apply
```

The helper refuses to replace another application's webhook and never drops pending updates. It uses `FRONTEND_URL`, which must be HTTPS and reachable by Telegram. `inspect` checks registration without changing it. Requests without the secret header are rejected before accessing Redis.

Before rolling back to a build without webhook support, run the helper with `rollback`, preserving pending updates, then restore the previous app image and environment. Otherwise Telegram polling would conflict with the remaining webhook.

On the `poster` host, Telegram's existing outbound routes use `wg-aibot`. Incoming webhook connections require their HTTPS replies to use the public interface. `webhook-routing.py` and `postiz-telegram-webhook-routing.service` persist a narrowly scoped rule: source `80.90.178.91`, TCP source port 443, Telegram's documented webhook subnets, routing table/priority 11443. The helper is specific to that host; do not install it elsewhere without adapting its addresses. Outbound Bot API requests retain their VPN route. See the deployment report for installation and rollback.

Telegram retains `last_error_date` after successful deliveries. Check its timestamp and pending count alongside a real delivered update; a historical error alone does not mean the webhook is currently failing.

## Verification and packaging

```sh
pnpm exec jest --config jest.telegram.config.cjs --runInBand
pnpm exec jest --config jest.max.config.cjs --runInBand
pnpm exec jest --config jest.max-ui.config.cjs --runInBand
```

Build all three apps on Node 22 with the production public URLs, commit the source, then run `python3 ops/telegram/package-native.py`. Its image layers compiled modules and frontend assets over `local/postiz:max-native-ac9bd184`; it preserves Linux dependencies, readiness, MAX certificates, and the existing Temporal workflow bundle. No schema migration is required. Verify its manifest before building and run `ops/telegram/native-smoke.cjs` in a disposable image with `--network none` and no real credentials.

References: [Bot API messages and automatic forwards](https://core.telegram.org/bots/api#message), [webhook authentication](https://core.telegram.org/bots/api#setwebhook), [participant count](https://core.telegram.org/bots/api#getchatmembercount), [discussion groups](https://core.telegram.org/api/discussion), [views require a user session](https://core.telegram.org/method/messages.getMessagesViews).
