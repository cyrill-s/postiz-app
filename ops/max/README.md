# MAX deployment

Uses the existing local build/copy-layer deployment described in
`../vk-community/README.md`. Packaging includes the MAX provider in both backend
and orchestrator, the provider settings registry and the frontend catalog/icon.

Production needs the Russian Trusted Root CA to connect to platform-api2.max.ru.
`certs/russian_trusted_root_ca.pem` was downloaded over verified HTTPS from
https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt on 2026-09-06.
Source instructions: https://developers.sber.ru/docs/ru/gigachat/certificates
and https://dev.max.ru/docs-api.

SHA-256 certificate fingerprint:
D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31
Valid until 2032-02-27. This is a public CA certificate, not a private key.
The compose override sets NODE_EXTRA_CA_CERTS only in the app container; normal
TLS hostname/certificate verification remains enabled.

Requested channel: -77691527321772 (https://web.max.ru/-77691527321772).
The bot token must be entered into the deployed password field; it is not stored
in this repository. See ../../reports/max-integration.md for connection steps.

Rollback: restore image local/postiz:v2.23.0-vk-ok-9 and remove NODE_EXTRA_CA_CERTS
from the override, keeping both Temporal settings. Recreate only app with
`docker compose -f docker-compose.yaml -f docker-compose.vk-community.yaml up -d --no-deps app`.
