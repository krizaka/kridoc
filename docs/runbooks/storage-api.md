# Runbook: the storage API

Design: [integration.md](../design/integration.md) § 5.4, § 6. Every step names the command or screen it uses.

## The call line and the SLO

- Every call leaves one JSON line on stdout: `{"kind":"storage.call", at, requestId, client, tenant, operation, keyHash, size, digest, status, ms}`. Never the bytes, the key or a token.
- Read it in the platform's log screen, filtered on `"kind":"storage.call"`. 5xx share = lines with `status >= 500` over all lines with a client.
- v1 starting values: 99.5 % of authenticated calls without a 5xx per calendar month; p95 of `PUT` 10 MB under 1.5 s; p95 of `HEAD` under 300 ms.
- Retention of the call lines: 12 months by default; a setting of Kridoc's admin (not wired yet: the platform's log retention applies until it is).

## Kridoc down or slow

1. Run `curl -fsS https://<kridoc-host>/api/health` (liveness, no detail).
2. Run `curl -fsS -H "Authorization: Bearer $TOKEN" https://<kridoc-host>/api/storage/v1/ping` with the monitor tenant's key.
3. Read the platform's log screen for `"kind":"storage.call"` with `status >= 500` and look at `ms`.
4. Redeploy the last good build from the platform's deploy screen.

## A key leaked

1. Run `pnpm storage:client revoke <client id>` (needs DATABASE_URL, MEDIA_VAULT_KEY).
2. Run `pnpm storage:client issue <product> <tenant> put,get,delete,sign`; the token is printed once.
3. Put the new token in the app's secret store and redeploy the app from the platform's deploy screen.
4. Run `curl -fsS -H "Authorization: Bearer $TOKEN" https://<kridoc-host>/api/storage/v1/ping` with the new token, then check the old one answers 401.

## A tenant at its quota

1. Run `curl -fsS -H "Authorization: Bearer $TOKEN" https://<kridoc-host>/api/storage/v1/usage` to see its use.
2. Open Kridoc's admin storage settings screen to raise the limit, or ask the product to delete objects with `DELETE /api/storage/v1/objects/<key>`.

## The bucket unreachable

1. Run `curl -fsS -H "Authorization: Bearer $TOKEN" https://<kridoc-host>/api/storage/v1/objects?limit=1` and read the status.
2. Open the provider's status screen and the bucket's screen in the provider's console.
3. Run `pnpm storage:sweep` only after the bucket answers again.

## A restore

1. Follow the restore drill of krizaka-internal#3500: restore the bucket from the provider's backup screen.
2. Replay the purge ledger over it (krizaka-internal#3499) with `pnpm storage:sweep`, so a shredded tenant does not come back.
3. Run `curl -fsS -H "Authorization: Bearer $TOKEN" https://<kridoc-host>/api/storage/v1/ping` and a `HEAD` of a known object.
