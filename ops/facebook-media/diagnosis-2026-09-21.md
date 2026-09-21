# Meta URL ingestion diagnosis — 2026-09-21

Checked production at 15:17–15:39 UTC (18:17–18:39 Europe/Istanbul).
Application, DNS, and robots configuration were not changed. Temporary proxy
routes for the single public PNG and a temporary TLS fixture server on port 8443
were removed after the experiments. No public posts were created.

## Strongest result: HTTP succeeds on the original hostname

The original PNG was temporarily served directly over HTTP on port 80, without
the normal HTTPS redirect. The same Graph API request and page token succeeded:

- `http://poster.generationl.ru/uploads/2026/09/21/f10c4632ed785194f448b3bab10ee4418f.png?http_probe=1790005021673`
- Request: 15:37:01.806–15:37:03.934 UTC; Graph HTTP 200.
- Unpublished object `122100680001484976` was successfully deleted.
- tcpdump recorded the actual inbound request from `173.252.69.48` on port 80.
  Reverse DNS: `fwdproxy-dkl-048.fbsv.net`.
- The HTTP exception was removed immediately afterward; the ordinary redirect
  is restored. This is a diagnostic result, not a recommendation to serve media
  over unencrypted HTTP in production.

This rules out an unconditional ban of the hostname or destination IP, and
demonstrates that changing the scheme changes the outcome. It does not prove
whether the HTTPS-specific rejection is a Meta cache/policy decision, a
different fetch path, or an upstream network restriction. No TLS handshake with
Meta was observed on the VPS during the failing tests, so blaming the certificate
or Caddy's TLS implementation is not supported by this evidence.

## Follow-up controls

| URL / experiment                                                                                                | Graph result                                 |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Original HTTPS PNG, including fresh query strings                                                               | 324 / 2069019, roughly 8.5 seconds           |
| Same HTTPS hostname with trailing dot or uppercase                                                              | Same failure                                 |
| Identical PNG through `postmill.185.119.58.121.sslip.io`, direct temporary proxy                                | Same failure                                 |
| Identical PNG through `185.119.58.121.sslip.io`, direct temporary proxy                                         | Same failure                                 |
| `https://pesenka.rubanana.ru/og-cover.png`, same VPS, robots permits this path                                  | Same failure                                 |
| `https://raw.githubusercontent.com/gitroomhq/postiz-app/main/apps/frontend/public/icons/platforms/facebook.png` | HTTP 200 in 1.2 seconds; test object deleted |
| Original hostname HTTPS on temporary port 8443, same certificate                                                | Same failure; no incoming packets to 8443    |

Port 8443 is not decisive: Meta may restrict nonstandard ports independently.
The alternate proxy tests preserved the nginx Host header and verified identical
456983-byte PNG bodies with SHA-256
`7cf4951a5ee781889008612d3e86642bd5f3516e87d9e2c712172b9d801eb6dc`.

Facebook Sharing Debugger, freshly scraped, reports 403 and says the response
_could_ be caused by robots.txt. Its raw scrape view says `The document returned
no data.` This is not proof of robots blocking: the tool's language is conditional,
and no corresponding origin 403 was observed.

All 16 IPv4 addresses resolved for `ns1.reg.ru` / `ns2.reg.ru` returned the same
authoritative A record. Delegation was checked with `dig +trace`; no domain DS
record is present. These checks do not expose Meta's own cached DNS answers.

The earlier conclusion that only the production hostname fails is therefore
too strong. The demonstrated distinction is HTTP versus HTTPS; the original
successful alternate URL and its scheme were not recorded in the earlier report.

## Reproduced failure

Direct `POST https://graph.facebook.com/v25.0/{page-id}/photos`, using the
existing Testforposter connection and `published=false`:

| Input                                                 | Result                                            |
| ----------------------------------------------------- | ------------------------------------------------- |
| Existing production PNG URL                           | HTTP 400, code 324, subcode 2069019               |
| Same PNG with fresh query parameters, repeated        | Same error, approximately 8.5–8.8 seconds         |
| `https://www.facebook.com/images/fb_icon_325x325.png` | HTTP 200; unpublished object successfully deleted |

Production fixture:
`https://poster.generationl.ru/uploads/2026/09/21/f10c4632ed785194f448b3bab10ee4418f.png`

Latest failing request: 15:23:10.046–15:23:18.503 UTC.
Meta trace ID: `AK8jdT4uNi4qr2Y1w84MYvy`.
Message: `Missing or invalid image file`; `is_transient=true`.
No public post was created.

## Observations

- A direct GET with the facebookexternalhit user agent returns HTTP 200,
  `image/png`, 456983 bytes, without a redirect.
- No corresponding media request appeared in nginx during the Graph probes.
- A synchronized tcpdump on all interfaces, filtering incoming TCP SYN to
  `185.119.58.121:443`, captured the deliberate local control fetch but no
  additional incoming SYN during the last Graph probe. This does not reveal
  Meta's DNS result, cache state, or traffic lost upstream of the VPS.
- Google and Cloudflare DNS returned `185.119.58.121`; no AAAA record was returned.
- The served certificate is for `poster.generationl.ru`, issued by Let's Encrypt
  YE1, valid September 4–December 3, 2026. Local HTTPS validation succeeded.
- `/robots.txt` currently returns HTTP 404 to ordinary and Meta user agents.
- Caddy's journal records deletion of temporary rule
  `postiz-robots-diagnostic-20260921` at 14:52:12 UTC (17:52:12 Istanbul).
  The on-disk site configuration has no robots handler.
- Production still runs `local/postiz:facebook-media-af1ca73e`, not `4f1612b0`.
  The local repository HEAD is `4f1612b0`; deployment rollback and Git history
  are different states.

## Initial interpretation (superseded by the HTTP experiment above)

The failure is reproducible without executing the Postiz publication code.
A fresh query did not bypass it. The earlier alternate-host success recorded
in deployment-2026-09-21.md supports a hostname-dependent failure, but was not
repeated here because that temporary route is no longer present.

The evidence does not distinguish Meta's host-level cache/policy from its DNS
resolution or a network failure before the VPS. It does not establish a domain
blacklist. A blanket VPS/IP prohibition is inconsistent with the earlier
alternate-host success, although different Meta fetch workers/routes remain possible.

Before relying on a 24-hour robots experiment, verify the intended robots file
is actually served continuously as HTTP 200 plain text. A robots 404 alone
does not prove blocking: RFC 9309 section 2.3.1.3 permits access after a 4xx.
After the wait, repeat the exact Graph probe with a fresh query and simultaneous
access-log/network observation. A controlled alternate-host test using identical
bytes remains the most useful comparison. Meta support/debugging can use the
trace ID above if no request reaches the VPS.

Reference: https://www.rfc-editor.org/rfc/rfc9309.html#section-2.3.1.3
