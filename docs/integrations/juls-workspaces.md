# Juls Workspace access, v1

Juls implementation is tracked in [juls-ai #40](https://github.com/cyrill-s/juls-ai/issues/40).

Juls owns users, Workspace membership and onboarding consent. Postiz owns social
connections, provider tokens and publishing. One `(JULS_ISSUER, externalWorkspaceId)`
gets one Organization and isolated Workspace Principal. No email, password,
activation email, trial or separate Postiz signup is required. The principal has
organization SUPERADMIN membership, never instance-wide `isSuperAdmin` privileges.
It uses provider `JULS`, a synthetic `.invalid` email, and disabled email notifications.
Human identity remains in Juls; this is not a human account synchronization protocol.

Design follows Matt Pocock's `codebase-design` and `domain-modeling`: a small
Workspace interface hides transactions, authorization and retry handling. We
compared a minimal lifecycle interface, versioned desired-state reconciliation,
and a caller-oriented onboarding interface; v1 chooses the latter. See
[the decision](../adr/0001-juls-workspace-access.md).

## Configuration and rollout

Register a dedicated first-party OAuth app in Postiz. Juls retains its client
secret. Set these Postiz variables in secret/runtime configuration:

- `JULS_PROVISIONING_SECRET`: independent random secret, at least 32 bytes
  (`openssl rand -hex 32` is suitable; use the resulting string verbatim for HMAC).
- `JULS_ISSUER`: stable Juls installation identifier, e.g. `juls-production`.
- `JULS_OAUTH_CLIENT_ID`: the registered app's `pca_...` client id.
- `JULS_MAX_BOT_TOKEN`: token for the dedicated Juls bot from MAX for Business.
  Keep it in the Postiz backend/orchestrator runtime only; never put it in the
  Mini App, a browser payload, model context or a user's provider settings.
- Existing `JWT_SECRET`, `FRONTEND_URL` and `NEXT_PUBLIC_BACKEND_URL` must be set.
  The latter is the browser-accessible backend URL, including `/api` if proxied.
  Backend and frontend must share the existing Postiz cookie domain. Production
  requires HTTPS; `NOT_SECURED` is only for local HTTP development.

With any of the three JULS variables absent the lifecycle interface returns 503.
Do not change issuer to rename a deployment: it determines persistent identity.
Changing the OAuth client id for existing workspaces requires an explicit migration.
Rotate the HMAC secret by coordinated deployment; there is one active key in v1.

Apply `20260921120000_juls_workspace_access/migration.sql` against the existing
schema using the deployment's migration process, regenerate Prisma and deploy the
backend together. This repository has partial migration history, so do not blindly
run all historical migrations on an established database. Keep the feature disabled
until schema and backend are ready. This change does not modify production or
register an OAuth app automatically.

Only Juls server should reach the three POST routes (private routing/IP controls
can supplement HMAC). Expose the GET session redemption route to users' browsers.
Keep request/response bodies for these routes and `/oauth/token` out of logs and
error reporting; redact the `ticket` query in proxy access logs. Backend Sentry
errors and transaction traces for these credential routes are excluded. All credentials
and bootstrap URLs stay out of model context. TLS remains necessary for HMAC.

## Signed requests

Externally these routes are normally `/api/internal/juls/...`; the Nest backend
sees `/internal/juls/...`. Sign the **backend path**, without the proxy `/api`
prefix, no query, exactly as sent after proxy rewriting. Only POST is supported.

Headers:

```text
Content-Type: application/json
X-Juls-Timestamp: <UTC Unix seconds>
X-Juls-Nonce: <new random UUID for every HTTP attempt>
Idempotency-Key: <UUID of the logical bootstrap attempt; provision only>
X-Juls-Signature: v1=<lowercase HMAC-SHA256 hex>
```

Canonical UTF-8 input, separated by LF, with no final LF:

```text
v1
POST
/internal/juls/provision
<timestamp>
<nonce>
<idempotency key, or empty string when absent>
<lowercase SHA-256 hex of exact transmitted body bytes>
```

Sign with `HMAC-SHA256(JULS_PROVISIONING_SECRET, canonical)`. Use `JSON.stringify`
once and sign/send those same bytes. Clock tolerance is ±300 seconds. Nonces are
persisted and unique during the entire valid timestamp window. A repeated nonce
returns `409 request_replayed`; retry with a new nonce/timestamp/signature and the
same logical idempotency key. Workspace/user IDs allow 1–128 ASCII letters,
numbers, `_`, `-`; nonce and idempotency key require 16–128 of those characters.
Unexpected fields are rejected, including caller-selected organization/client IDs,
email and unimplemented tariff fields.

## Provision

```http
POST /internal/juls/provision
```

```json
{
  "externalWorkspaceId": "ws_123",
  "owner": { "externalUserId": "user_456", "name": "Иван" },
  "organization": { "name": "Иван — Juls" }
}
```

Response 200 (both initial creation and retries):

```json
{
  "organizationId": "postiz-organization-uuid",
  "userId": "postiz-workspace-principal-uuid",
  "authorizationCode": "opaque-single-use-code",
  "expiresAt": "2026-09-21T12:03:00.000Z",
  "alreadyExisted": false
}
```

The code lives for three minutes. A single transaction creates principal,
organization, membership, binding, first-party OAuth authorization, code and audit.
Concurrent provisioning uses a database transaction lock plus uniqueness; it
cannot create duplicate organizations. Owner identity is immutable in v1; another
owner returns `409 owner_conflict`. Profile names are creation metadata, not a sync.
No existing founder/manual Postiz organization is adopted automatically.

Same idempotency key and same normalized payload return the same unspent code.
Changed payload returns `409 idempotency_conflict`. Consumed/expired attempts
return `409 bootstrap_attempt_finished`; generate a fresh logical attempt key.
`alreadyExisted` reports whether the mapping existed at the start of this request,
so that diagnostic field can differ on replay. Distinct attempts receive independent
codes: they do not overwrite each other.

Exchange through the existing endpoint (Juls server only):

```http
POST /oauth/token
Content-Type: application/json
```

```json
{
  "grant_type": "authorization_code",
  "code": "opaque-single-use-code",
  "client_id": "pca_registered-juls-client",
  "client_secret": "pcs_server-only-secret"
}
```

Existing response shape is preserved: `{ id, cus, access_token, token_type }`.
Assert `id === organizationId` before persisting. The code is consumed atomically;
exactly one concurrent exchange succeeds. A working token is preserved when new
codes are issued; later successful bootstrap exchanges recover the **same** token.
If the response or local commit is lost, start a new attempt and recover it. This
avoids silently invalidating a credential already stored by another worker.

Juls stores only its encrypted organization OAuth token, never social provider
tokens. Existing `postiz_connections` AES-256-GCM associated data (Workspace,
instance, organization) remains valid. Configure a single Postiz instance and use
its normal Bearer MCP endpoint; never fall back to the founder key or `/mcp/<key>`.
Manual OAuth grant revocation returns `410 authorization_revoked` on provisioning;
v1 deliberately cannot silently reinstate that authorization.

## Browser handoff

```http
POST /internal/juls/handoff
```

```json
{ "externalWorkspaceId": "ws_123", "actorExternalUserId": "user_456" }
```

Juls must first authenticate the human and resolve current Workspace ownership
from its database. The actor must match the immutable provisioned owner in v1.
Response: `{ url, expiresAt }`. The URL contains a random single-use ticket valid
for 60 seconds; only its digest is stored. Open it directly in the browser, do not
prefetch it or send it through link-preview services: GET redemption consumes it.
The endpoint sets HttpOnly auth/showorg cookies, clears impersonation and redirects
to the fixed Postiz `/launches` screen. There is no caller-supplied redirect.

The session lasts 30 minutes and is pinned to the Managed Organization.
Every authenticated request rechecks active binding and membership. Changing
`showorg`, using an unscoped JWT, or revoking the Workspace prevents access. This
opens the existing channel selection UI; direct provider-specific buttons and a
return-to-Juls flow are future UX, not part of v1. It grants owner-level Postiz UI
access within this organization, not a restricted connect-only capability.
Provider consent and any required provider application approval still happen in
Postiz. Juls can determine channel readiness using MCP `integrationList`.

## Connect a MAX channel

Juls must first bind the authenticated Juls user to a MAX user identity with a
short-lived, single-use code sent in a private dialog with the dedicated bot.
The code must be random, hashed at rest, expire promptly and be consumed once.
The resulting MAX `user_id` is server evidence; do not accept it from the Mini
App or from an unsigned client request.

After that binding, Juls sends a signed server-to-server request:

```http
POST /internal/juls/max-channel/connect
```

```json
{
  "externalWorkspaceId": "ws_123",
  "actorExternalUserId": "user_456",
  "channelId": "-77691527321772",
  "maxUserId": "123456789"
}
```

The request uses the same HMAC headers and canonical form as the other Juls
POST routes. Postiz checks all of the following with its server-only bot token:

- the Workspace is active and the actor is its owner;
- `channelId` is an active MAX channel;
- the dedicated Juls bot is an administrator with publishing permission;
- the MAX identity established by the one-time code is an owner or administrator
  of that exact channel.

Only then is the channel upserted into the Workspace. The stored integration
credential contains `channelId` plus a server-token marker, not the bot token.
Publishing resolves the token from `JULS_MAX_BOT_TOKEN` inside the worker.
Response: `{ integrationId, channelId, name }`. Repeating the request is safe.

This endpoint intentionally does not implement the bot dialog itself. The Juls
service owns issuance/consumption of the one-time code and passes the resulting
MAX identity only over this authenticated server channel.

## Revoke access

```http
POST /internal/juls/revoke
```

```json
{ "externalWorkspaceId": "ws_123" }
```

Response 200: `{ "revoked": true }`, including repeats and revoke before provision.
A terminal tombstone blocks all later provisioning, codes and handoffs with
`410 workspace_revoked`. It revokes all organization OAuth grants, disables its
memberships/principal and clears its API key; already-issued browser sessions stop
working. Lifecycle and bootstrap exchange take the same transaction lock, so a
late worker cannot resurrect access. Juls must keep its own durable deletion/revoke
outbox until this response succeeds, even if its Workspace row has been removed.

This is **access revocation**, not cancellation or data erasure. Previously accepted
publishing jobs, provider-side scheduled work and stored social data are retained.
Do not present this endpoint as a complete Workspace deprovisioning operation.
Publishing cancellation and retention need an explicit follow-up contract and a
separate acceptance test before offering that guarantee.

## Errors and operations

- 400: invalid payload/idempotency key; fix input, do not blindly retry.
- 401 `invalid_signature`: fix signing, clock or key. OAuth uses its existing
  `invalid_client` / `invalid_grant` responses.
- 403 `actor_forbidden`: owner mismatch.
- 404 `workspace_not_found`: handoff before provisioning.
- 409: replay, idempotency conflict, owner conflict, or finished bootstrap attempt.
- 410: terminal workspace or grant revocation; automatic retries must stop.
- 503: missing configuration or unavailable configured OAuth app; retry only after
  configuration recovery. Network errors, 429 and transient 5xx use bounded backoff.

Audit contains binding IDs, action, actor where applicable and timestamp, never
codes, tickets, tokens, real email or HMAC secret. Nonces are pruned after expiry
on authenticated traffic. Bootstrap attempts retain their request keys to enforce
replay semantics. Handoff/audit retention is an operational follow-up; preserve
workspace tombstones and bootstrap attempt keys while old jobs can still replay.

## Explicit next contracts

- Entitlements: Juls has no approved tariff/quotas yet. Postiz's self-hosted
  permission code bypasses several limits when Stripe is disabled. V1 creates no
  paid/trial subscription and rejects tariff fields. Do not claim Juls SaaS quota
  enforcement from this interface. Define versioned effective entitlements and
  enforce them across UI, API, MCP and workers before selling quota guarantees.
- Ownership transfer, team membership sync and recovery after deliberate manual
  grant revocation require explicit authorized transitions, not a provision retry.
- Existing manually linked workspaces remain on their current connection. Migrating
  their channels needs an explicit procedure; never overwrite their binding during
  automatic onboarding.

## Verification

Run `bash scripts/test-juls.sh` with local Docker. It creates an ephemeral local
PostgreSQL instance, applies the schema and exercises the HTTP interface plus
concurrent transactions, OAuth redemption, HMAC replay, tenant isolation, browser
session scoping and revocation. `JULS_TEST_DATABASE_URL` is the only accepted test
DB variable; tests never infer a database from the developer's production settings.
