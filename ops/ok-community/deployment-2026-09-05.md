# Deployment 2026-09-05

Source: f4bace0 on codex/ok-community.
Image: local/postiz:v2.23.0-vk-ok-1.
Manifest: sha256:7af0c4f99fa4f8bfd60ad8fd36193c0bebc395687f0a71dc952b2102c5050ae5.
Release: /opt/postiz-next/releases/vk-ok-1.

Local backend and frontend production builds passed. 17 OK provider tests and
15 VK regression tests passed. Offline Linux imports passed for backend and
orchestrator under 512 MiB / 0.5 CPU. No dependencies or schema changed.

Frontend version v2.23.0-vk-ok. Provider catalog includes vk, vk-community and
ok-community. Browser verified Add Channel → Одноклассники — группа, four manual
fields, both secrets rendered as password inputs. Group ID 70000035141015 is
prefilled in the handoff form, but no credentials have been submitted. Existing
Telegram and VK community channels are visible in the currently selected account.

All 17 unrelated container IDs, start times and resource limits remain unchanged.
Postiz app limits remain RAM/swap 3 GiB, CPU 1.25, shares 128, OOM score 700,
pids 1024. Base compose checksum is unchanged:
49618b31057cffa01f4f918601dcccec74a324e24cd87266ae805cb73678d24e.
/auth, /api/integrations and jsia.ru/health return 200; Docker healthy, no OOM.
The orchestrator initially stalled before Nest startup; restarted only that PM2
process to complete startup. Explicit worker health verification is required in
addition to Docker health, which can pass while the worker is not ready.

Live OK authentication/posting is NOT yet verified. The user is completing email
confirmation in OK before application setup. App credentials and permissions are
still needed. No OK test post was created and no email was sent to support.

Rollback: restore image local/postiz:v2.23.0-vk-community-3 in
/opt/postiz-next/docker-compose.vk-community.yaml, then recreate only app using
both existing compose files and --no-deps. The older image has no OK provider.
