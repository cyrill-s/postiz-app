# Deployment 2026-09-05

- Source commit: `02ff3c3` on `codex/vk-community`.
- Image: `local/postiz:v2.23.0-vk-community-1`.
- Image manifest: `sha256:3b2295f70a20fe7f4d0e9d97a54ef260cba2123aa8d2cdbbbf8bb0e7a7541331`.
- Release directory: `/opt/postiz-next/releases/02ff3c3`.
- Active compose files: `/opt/postiz-next/docker-compose.yaml` and
  `/opt/postiz-next/docker-compose.vk-community.yaml`.
- Base compose SHA256 (unchanged): `49618b31057cffa01f4f918601dcccec74a324e24cd87266ae805cb73678d24e`.

15 provider tests passed; backend TypeScript build and frontend production build
(including TypeScript checks) passed under Node 22.23.2. Both backend/orchestrator
provider modules loaded successfully in a Linux container with no network and
a 512 MiB / 0.5 CPU limit before switching production.

Post-deploy: /auth 200, /api/integrations 200 with both vk and vk-community,
jsia.ru/health 200. Docker healthy, OOMKilled false, restart count 0.
After worker startup: app 2.342 GiB / 3 GiB, about 10.65% CPU; disk free 49 GiB.
All 17 other running containers retained IDs, start times and resource limits.
App retained RAM/swap 3 GiB, 1.25 CPUs, CPU shares 128, oom_score_adj 700,
pids_limit 1024. No manual DB migration or backup was created.

Browser verification: existing Telegram and personal VK channels remain visible;
version v2.23.0-vk-community; Add Channel includes VK — сообщество. Selecting it
shows the expected missing-VK-API-app explanation. The first cold load briefly
rendered empty while the app/client loaded; waiting for the actual Add Channel
button and then reloading passed. No code change was needed for that transient.

Live publishing is NOT verified. Read-only requests with the existing VK token
returned 1051 for groups.get and account.getAppPermissions. The existing VK ID
client also returned 401 from oauth.vk.com/authorize. Public groups.getById works
and resolved faberlicglobal to 102697991; this does not prove publishing access.
VK_COMMUNITY_ID and VK_COMMUNITY_SECRET are not configured. The user's copied
service access token is not a substitute for user OAuth publishing permissions.

The browser tool explicitly prohibited opening the VK applications management
page, so no VK app was created or changed. No test post was published.
The user needs to identify a suitable VK API application before authentication
and the authorized publish/delete test in faberlicglobal can continue.
