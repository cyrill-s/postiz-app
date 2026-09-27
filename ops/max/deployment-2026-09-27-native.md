# MAX native comments and analytics — deployment 2026-09-27

Application: https://poster.80.90.178.91.sslip.io

## Release

- Host: SSH alias `poster`, `/opt/postiz-next`.
- Release source: `ac9bd18423d62a37b78b33e7cf5f12b01572ec5c`, branch `codex/max-native-release`.
- Base: production `b60c6c0277ecfb5f49537041e9a93f8b9b76b895`, image `local/postiz:readiness-97-b60c6c02`.
- Final image: `local/postiz:max-native-ac9bd184`.
- Image digest: `sha256:fbdf1794ba6f765031cc279f05c29bb018a3022959d281575929b243b620edf8`.
- Bundle SHA256: `ee973650484171c8cd43d74c7f392e2fd4fb034f1b01a212101941fd0c932b89`.
- Server bundle and manifest: `/opt/postiz-next/releases/max-native-ac9bd184/`.
- Test receipts: `/opt/postiz-next/releases/max-native-0c1553b0/test*.json` (server only, mode 600).

The release uses the actual production baseline, preserving its startup/readiness fixes, Linux dependencies, MAX certificates, Temporal workflow bundle, database schema, and media settings. Only the app service was recreated. No migration was needed. The original local checkout was older than production; its unrelated edits were excluded.

## Verification

- 88 MAX provider, post DTO and queue tests passed, including a regression for the observed `comments.comments_disabled` error.
- 10 formatting/Telegram tests and 3 analytics UI tests passed.
- Frontend production build and backend/orchestrator builds passed with Node 22.23.2 and PNPM 10.6.1.
- Both release images passed isolated Linux runtime checks for backend and orchestrator with no network and no production credentials.
- Artifact checksums verified on the server before image creation.
- Existing ESLint configuration fails before linting with a FlatCompat circular JSON error; lint success is not claimed.
- Final checks at 12:04 UTC: app container healthy, zero restarts, no OOM; backend, orchestrator and frontend online. External `/auth` returned 200, `/api/monitor/health` 200 and `/api/mcp` 401. Live test readback and Postiz analytics were rerun successfully after the final image switch.
- All 30 other existing containers retained their IDs, start times and resource limits. Base compose hash stayed `b2ff18a0689e8bbe018614d07ba65be5c0b112685d5ca10f1fbbbba7c4cb4952`. App limits remained 3 GiB memory/swap, 1.25 CPUs, CPU shares 128, PID limit 1024, OOM score adjustment 700.

## Authorized live test

The user explicitly confirmed testing in **rubai news (rubanana_bot)**, `@channel_rubanana`, chat ID `-77691527321772`. Two active Postiz connections point to this same channel: an own-token connection and a Juls connection. The channel had 3 participants. No other channel was used.

- Test marker: `MAX-NATIVE-20260927-0c1553b0`.
- Root Postiz ID: `cmujrhxud0000pa4ib91ttat7`.
- Root MAX ID: `mid.ffffb957081ca75401a0e2b85ee27581`.
- Test post: https://max.ru/channel_rubanana/AaDiuF7idYE
- Comment 1: `mid.ffffb957081ca75401a0e2bcb7fc3ca9`.
- Comment 2: `mid.ffffb957081ca75401a0e2bda5e074cc`.

The root and both comments were submitted together through Postiz's public posts API. MAX initially rejected the first comment with HTTP 400, code `proto.payload`, message `comments.comments_disabled`. A diagnostic replay confirmed the same rejection and created no comment. The user enabled comments in MAX. The existing Temporal execution was then reset at workflow-task completion event 45, immediately before the first comment activity; the root publication was replayed from history and was not sent again. Both comments were subsequently delivered by the standard workflow. After readback confirmed both deliveries, the root's stale error state was reconciled to PUBLISHED. All three Postiz rows are PUBLISHED with real MAX release IDs.

MAX readback confirmed exactly two comments, both with `recipient.post_id` equal to the original root ID. Bold and italic formatting survived. The named hyperlink became readable `label (URL)` text, and MAX automatically linked the URL. The second comment arrived **60,900 ms** after the first, matching its configured one-minute delay.

One test post and two test comments remain in the channel for inspection. Existing posts were not modified.

## Analytics observed

| Metric | 7 days | 30 days |
| --- | ---: | ---: |
| Current participants | 3 | 3 |
| Posts published in the selected period | 3 | 5 |
| Accumulated views of those posts | 8 | 44 |

The test post returned 2 lifetime views. Postiz's channel analytics endpoints for 7/30 days and its post analytics endpoint returned HTTP 200 with native snapshot data. Read-only analytics through the Juls credential model matched the own-token result. These are observed counters, not daily growth figures; channel analytics uses Postiz's existing cache.

## Build and rollback notes

`ops/max/package-native.py` packages a clean committed tree; `Dockerfile.native` layers the artifacts over the production base. For this managed worktree, dependencies were shared through a local symlink. Backend compilation needed an ignored local tsconfig extending the backend build config with `preserveSymlinks: true`, `incremental: false`, and an explicit `../apps/backend/src/**/*.ts` include. Both server apps were compiled before packaging. Frontend build used the current sslip.io public URL and existing Timeweb media URL. Credentials were never bundled.

For transport from macOS, use `COPYFILE_DISABLE=1 tar --no-xattrs` to avoid Apple metadata in release archives.

To roll back, change only the app image in `/opt/postiz-next/docker-compose.vk-community.yaml` from `local/postiz:max-native-ac9bd184` to `local/postiz:readiness-97-b60c6c02`, then run:

```sh
cd /opt/postiz-next
docker compose -f docker-compose.yaml -f docker-compose.vk-community.yaml up -d --no-deps app
```

Verify container health, `/auth` (200), `/api/monitor/health` (200), and `/api/mcp` (401). Preserve the current environment and resource limits. Do not republish the completed live-test post. Do not restart the backend alone with PM2.
