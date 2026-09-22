# VK review page and registration

- Published https://poster.generationl.ru/about/ as a static Caddy route.
- Enabled registration using `DISABLE_REGISTRATION: "false"` in the production
  base compose. Recreated only app, preserving image
  `local/postiz:threads-oauth-20260922`, RAM 3 GiB and CPU 1.25.
- Backup: `/opt/postiz-next/releases/vk-review-20260922T140345Z`.
- Static file: `/var/www/poster-about/index.html`.
- Browser verified page layout and CTA navigation to the visible registration
  form. No test account was created and no social post was published.
- VK community creation is blocked by browser site-safety policy. Prepared copy
  in `community-copy.md` for the user to create it manually.

## Rollback

Restore `docker-compose.yaml` from the backup to `/opt/postiz-next/`.
Restore `postmill.caddy` from the backup to `/etc/caddy/sites/postmill.caddy`.
Validate `/etc/caddy/Caddyfile` with `caddy validate`, then reload Caddy.
From `/opt/postiz-next`, run:

```sh
docker compose -f docker-compose.yaml -f docker-compose.vk-community.yaml up -d --no-deps app
```

This disables registration again without removing existing accounts. The deploy
script is a one-time operation and intentionally refuses an already modified
configuration; inspect and restore a partial deployment before retrying it.
