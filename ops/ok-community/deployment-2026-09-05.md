# Deployment 2026-09-05

Final source: 8931b8c on codex/ok-community.
Image: local/postiz:v2.23.0-vk-ok-5.
Manifest: sha256:60c4b40efd1a3dc541c7f1eae16d15d9698242746b38bb94f02f08556fe90c85.
Release: /opt/postiz-next/releases/vk-ok-5.

Local backend, frontend and orchestrator production builds passed. 22 OK/queue
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
secrets rendered as password inputs. Group 70000035141015 connected successfully
as Книжная лавка Дядюшки ОМа and is visible beside the existing Telegram and VK
channels. Authentication verified current user, required API permissions and
administrator/moderator membership before persisting the channel.

All 17 unrelated container IDs, start times and resource limits remain unchanged.
App limits remain RAM/swap 3 GiB, CPU 1.25, shares 128, OOM score 700, pids 1024.
/auth, /api/integrations and jsia.ru/health return 200. Base compose is unchanged:
49618b31057cffa01f4f918601dcccec74a324e24cd87266ae805cb73678d24e.
Only image and two Temporal options are set in the existing app override.

Live OK authentication is verified; no OK post was created or published.
The direct https://ok.ru/app/setup form created OAuth app poster.genL,
ID 512004900971, shortname postergenl, with required
VALUABLE_ACCESS/GROUP_CONTENT/PHOTO_CONTENT. External metadata does not mention
the underlying software, as requested. Public and secret app keys arrived by
email. The creator UI supplies an access token, not a session secret.

The connection accepts an opaque application secret (not necessarily hex).
It derives MD5(access_token + application_secret) and stores only the derived
session secret in the encrypted credential bundle. Application secret is not
persisted. A regression test covers a non-hex application secret. Clipboard
insertion and browser inspection were performed without printing the secret.
No support email was sent. Suppress/redact credential-bearing setup iframe URLs
and filled password fields during later browser inspection.

Rollback: restore image local/postiz:v2.23.0-vk-community-3 in the override and
remove the two TEMPORAL options, then recreate only app using both existing
compose files and --no-deps. The old image has no OK provider and uses more memory.
