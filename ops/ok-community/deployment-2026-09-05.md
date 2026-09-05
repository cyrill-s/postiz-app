# Deployment 2026-09-05

Final source: 5506541 on codex/ok-community.
Image: local/postiz:v2.23.0-vk-ok-3.
Manifest: sha256:489c478a8e9dea70637fcd28772c4a495d0faf7d3d9f804dfef2225bc05e2bb1.
Release: /opt/postiz-next/releases/vk-ok-3.

Local backend, frontend and orchestrator production builds passed. 21 OK/queue
tests and 15 VK regression tests passed. Linux provider imports passed under
512 MiB / 0.5 CPU. Prebuilt workflow bundle and production SDK versions match
(1.15.0). No dependencies or schema changed.

Initial vk-ok-1/vk-ok-2 startup reached the 3 GiB cgroup limit while starting
redundant workflow workers for every platform. PM2's pnpm wrapper can leave
orphaned child processes after restart/OOM, worsening memory pressure. The failed
rollout was rolled back temporarily; orphan orchestrator processes were stopped
before the final recreation. Do not use those intermediate images for rollback.

Final low-memory mode has workflow execution only on main; every provider queue
still runs activities. This matches all workflow starts/proxyActivities in the
source. The final image started normally, without a manual PM2 restart or runtime
Webpack compilation. Backend and worker /health/status both return 200. Queue
'ok' explicitly reached RUNNING. Observed app memory 1.304 GiB / 3 GiB; cgroup
memory.events showed max=0, oom=0, oom_kill=0 after startup.

Frontend version v2.23.0-vk-ok. Catalog includes vk, vk-community and ok-community.
Browser verified Add Channel → Одноклассники — группа, four manual fields, both
secrets rendered as password inputs. Group ID 70000035141015 is prefilled in the
handoff form, but no credentials have been submitted. Existing Telegram and VK
community channels are visible in the currently selected account.

All 17 unrelated container IDs, start times and resource limits remain unchanged.
App limits remain RAM/swap 3 GiB, CPU 1.25, shares 128, OOM score 700, pids 1024.
/auth, /api/integrations and jsia.ru/health return 200. Base compose is unchanged:
49618b31057cffa01f4f918601dcccec74a324e24cd87266ae805cb73678d24e.
Only image and two Temporal options are set in the existing app override.

Live OK authentication/posting is NOT yet verified. User confirmed email and
obtained developer access, then found https://ok.ru/app/setup. This direct form
allows an OAuth application, despite the games menu directing users to Mini Apps.
Draft app Postiz Generationl is filled with site URL, VPS IP, OAuth platform and
VALUABLE_ACCESS/GROUP_CONTENT/PHOTO_CONTENT set to required. Save is awaiting the
user's explicit confirmation; the UI also says two-factor authentication is
required. No app credentials were captured, no OK post created, no support email
sent. App setup iframe URLs contain session credentials: suppress/redact them
when inspecting later UI snapshots.

Rollback: restore image local/postiz:v2.23.0-vk-community-3 in the override and
remove the two TEMPORAL options, then recreate only app using both existing
compose files and --no-deps. The old image has no OK provider and uses more memory.
