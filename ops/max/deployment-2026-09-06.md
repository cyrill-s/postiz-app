# MAX deployment — 2026-09-06

Source commit: 7a53c61 (`codex/ok-community`).
Image: `local/postiz:v2.23.0-vk-ok-max-1`.
Image ID: `sha256:5fd9d77e411a69805bf6a1d266ae260df0f57294128e4abf9b1b66fb1b304f9d`.
Release: `/opt/postiz-next/releases/vk-ok-max-1` on 185.119.58.121.
App started: 2026-09-06 11:48:44 UTC.

Backend, orchestrator and frontend production builds passed under Node 22.23.2.
MAX test suite: 41/41. Workflow bundle compiled with Temporal SDK 1.15.0,
matching the pinned Linux runtime. No dependency or database schema changes.

Before rollout, a 512 MiB / 0.5 CPU Linux container loaded the MAX provider,
media helpers, catalog and settings validation in both backend and orchestrator.
The SSRF-safe transport reached MAX over verified TLS and received HTTP 401
without credentials, as expected. Production initially lacked the required
Russian CA; the public CA from the official HTTPS download is now included in
the app and enabled through NODE_EXTRA_CA_CERTS. TLS checks remain enabled.

Recreated only app using the existing base compose plus its app override.
Previous override is saved at
`/opt/postiz-next/releases/vk-ok-max-1/previous-compose.override.yaml`.
Base compose SHA256 remains
`49618b31057cffa01f4f918601dcccec74a324e24cd87266ae805cb73678d24e`.

Post-deploy checks:

- Docker healthy, restart count 0, OOMKilled false.
- Worker queue `max` reached RUNNING; existing queues also start normally.
- `/auth`, `/api/integrations`, `/icons/platforms/max.png` all HTTP 200.
- Catalog contains MAX with bot-token password field and numeric chat_id field.
- Original public preview `/p/cmtovkiwi0002qz84k6p8xgk6?share=true` returns 200.
- `https://jsia.ru/health` returns 200.
- App memory approximately 1.316 GiB / 3 GiB; cgroup max/oom/oom_kill counters 0.
- All 17 unrelated containers retained IDs, start times and resource limits.
- App limits retained: 3 GiB memory/swap, 1.25 CPUs, CPU shares 128,
  OOM score 700, pids 1024.

Requested channel ID is `-77691527321772`. No bot token was supplied, so no MAX
channel was connected and no live post was sent. Browser verification reached
the sign-in page (no authenticated browser session available); catalog and
production assets were verified through HTTP and compiled runtime checks.
The user can refresh the app and choose Add Channel → MAX to enter the bot token
and this channel ID. Bot must be a channel administrator with publishing rights.

Rollback: restore the saved previous override and recreate only app with
`docker compose -f docker-compose.yaml -f docker-compose.vk-community.yaml up -d --no-deps app`.
This restores `local/postiz:v2.23.0-vk-ok-9` and its original environment.
