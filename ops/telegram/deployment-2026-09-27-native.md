# Telegram native comments and bot analytics — deployment 2026-09-27

Application: https://poster.80.90.178.91.sslip.io

## Release

- Host: SSH alias `poster`, `/opt/postiz-next`.
- Source: `ec28998e17a61d0dbacc71978de9357e405ef4fc`, branch `codex/telegram-native`.
- Base: deployed MAX image `local/postiz:max-native-ac9bd184`; source baseline `0145aabf`.
- Image: `local/postiz:telegram-native-ec28998e`.
- Image digest: `sha256:95dfdaca786d0d5c41c7cf6afa296544648825692b332e1b7159d619b7e8fcaf`.
- Bundle SHA256: `06141f75072ec7568a8b44f8c93b00ad19cc464d84227dae774b221036d044d8`.
- Release, manifest and private test receipts: `/opt/postiz-next/releases/telegram-native-ec28998e/`.

Only the app container was recreated. The release preserves Linux dependencies, startup/readiness, MAX certificates, the existing Temporal workflow bundle, media configuration and database schema. No migration was required. The existing override received the new image and a server-generated webhook secret; other values were verified unchanged. Secrets were not copied into the repository or release bundle. The original checkout's unrelated changes were excluded.

## Authorized live test

The user selected **[Test] Про настоящую музыку**, `@themusicmaven`, and confirmed adding `@julsai_poster_bot` as administrator of its linked discussion group. Channel `-1002107839892` links to group `-1004390785976`; the group links back. Both bot memberships were checked before publishing.

The channel was connected to the existing test organization **rubanana**, ID `eab0d7e0-958e-4aee-8f4a-d5c9c0154eda`. New integration ID: `cmujsz6w50001o265wia4jypw`. No other channel received a test message.

The root and two comments were submitted together through the normal Postiz public API and executed by the existing Temporal publishing workflow. Submission had a unique marker and a server-side receipt to prevent accidental duplicate retries.

- Marker: `TELEGRAM-NATIVE-20260927-ec28998e`.
- Root Postiz ID: `cmujth2s00000o24hwc9ifam2`; Telegram ID `11`.
- Root: https://t.me/themusicmaven/11
- Comment 1: Postiz `cmujth2up0001o24hsn8m72l4`, Telegram `4`, https://t.me/themusicmaven/11?comment=4
- Comment 2: Postiz `cmujth2v40002o24hv7o34pz7`, Telegram `5`, https://t.me/themusicmaven/11?comment=5

All three Postiz rows are PUBLISHED with real Telegram IDs and no errors. Telegram's authenticated automatic-forward event stored discussion root `3` in group `-1004390785976`. Both comment URLs point to channel post `11`; the provider resolves both replies to that original discussion root. The first comment completed at `12:50:49.512 UTC`, the second at `12:51:50.108 UTC`: **60,596 ms** apart, matching the configured one-minute delay. The public Telegram embed independently showed the root's unique marker and bold formatting. Bot API offers no message-history readback; comment verification used successful API results, saved release IDs and webhook routing, not a claimed history fetch.

One test post and its two comments remain for inspection.

## Analytics

| Metric | 7 days | 30 days |
| --- | ---: | ---: |
| Current participants | 3 | 3 |
| Posts published through this Postiz connection | 1 | 1 |

Both analytics endpoints returned HTTP 200 with native snapshot data. A direct `getChatMemberCount` also returned 3. The Postiz count excludes both comment rows and channel posts created outside this connection. Post analytics returned HTTP 200 with an empty array: Bot API does not expose post views or reach history, and no artificial zeros or growth figures are displayed. Existing Postiz analytics caching remains in place.

## Webhook network repair

The HTTPS endpoint passed authenticated (201) and unauthenticated (401) checks, but Telegram deliveries initially timed out. Packet capture showed SYN arriving on `eth0` and SYN-ACK leaving through `wg-aibot`: the host's existing Telegram routes caused asymmetric routing.

Table/priority 11443 now routes only replies from `80.90.178.91`, TCP source port 443, to Telegram's `149.154.160.0/20` and `91.108.4.0/22` through `80.90.178.1` on `eth0`. Outbound Bot API traffic still uses `wg-aibot`. A later capture confirmed a completed TCP/TLS exchange in both directions on `eth0`, and the live post's automatic-forward update was received. No firewall was opened and other routing rules were preserved.

Host files:

- `/usr/local/sbin/postiz-telegram-webhook-routing`, installed from `ops/telegram/webhook-routing.py`.
- `/etc/systemd/system/postiz-telegram-webhook-routing.service`, enabled and active.
- Prior routing snapshot: release directory `routing-before.json`.

The helper was checked for idempotency on the live host. Telegram registration uses `/api/integrations/telegram/webhook`, its secret header, message/channel_post updates and 40 connections. Pending updates were preserved throughout; the final queue was empty. Telegram retained a historical timeout timestamp of `12:50:39 UTC`, before the successful live test; that field does not clear automatically on every success.

See Telegram's [webhook networking requirements](https://core.telegram.org/bots/webhooks) for the published source subnets.

## Verification

- 39 Telegram provider, webhook, analytics and shared DTO tests passed.
- 88 MAX regression tests and 3 analytics UI tests passed. Suites share some DTO tests; these counts are not a unique-test total.
- Frontend production build and backend/orchestrator builds passed with Node 22.23.2 and PNPM.
- Isolated Linux runtime smoke passed for backend and orchestrator, with no network or real credentials.
- Bundle manifest verified before image creation.
- Final app health: healthy, no restarts or OOM. Backend, orchestrator and frontend online with zero PM2 restarts.
- External `/auth`: 200; `/api/monitor/health`: 200; `/api/mcp`: 401.
- Read-only MAX analytics still returned HTTP 200 and the expected 3 participants, 3 posts and 8 views for 7 days.
- All 30 other existing containers retained their IDs, start times and resource limits.
- Base compose SHA256 stayed `b2ff18a0689e8bbe018614d07ba65be5c0b112685d5ca10f1fbbbba7c4cb4952`.
- App limits stayed 3 GiB memory/swap, 1.25 CPUs, CPU shares 128, PID limit 1024 and OOM score adjustment 700.

## Rollback

Before restoring an image without webhook support, remove Telegram registration without dropping pending events:

```sh
docker exec -w /app postiz-next-app-1 node ops/telegram/setup-webhook.cjs rollback
```

Restore the private `previous-compose.override.yaml` backup to `/opt/postiz-next/docker-compose.vk-community.yaml` (mode 600), then recreate only app:

```sh
cd /opt/postiz-next
docker compose -f docker-compose.yaml -f docker-compose.vk-community.yaml up -d --no-deps app
```

That restores `local/postiz:max-native-ac9bd184` and the previous environment. To remove the host routing addition after disabling the webhook, run `systemctl disable --now postiz-telegram-webhook-routing.service`; its stop command removes only the owned rules/routes. Keep the backups and the completed test receipts. Verify app health and external endpoints again. Do not republish the completed test or restart the backend alone with PM2.
