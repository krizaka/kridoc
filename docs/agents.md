# kridoc — detail for agents

Moved here from AGENTS.md when it took the org template (krizaka/.github `docs/standards/agents-template.md`). AGENTS.md is the short contract; this page is the repository's own detail, read by section.

Started from `krizaka/template-next-app`. The governance of the family is **krizaka-com's AGENTS.md** (theming with `var(--kz-*)`,
every string in `messages/*.json`, `@krizaka/ui` blocks, tests with every change, definition of done) — read it, do not copy it here.

- Shared things stay shared: the pipeline is `krizaka/.github` reusable workflows (`ci.yml` only wires it), deploys go through
  `krizaka-deploy`, the SEO contract is the `krizaka-seo-family` bin of `@krizaka/config`, the ast-grep rules and ratchet
  are the org's (`rules/`, `sgconfig.yml`, `scripts/sg-ratchet.mjs`: **do not edit them here**, change them in the template and in the org).
- **DO routes**: the spec lists no route one by one (App Platform has no regex): one `/` per component; fine routing is code in the
  app (`lib/dev-host.ts`, `proxy.ts`) with tests.
- Environment variables are declared once in `apps/web/lib/env.ts`, named by bounded context.
- **Database** (krizaka-internal#3717): Kridoc owns its PostgreSQL, shared with no other product. The `@krizaka/db` client sits behind a port in
  `apps/web/lib/db/` (`document-store.ts`; no query outside it); the schema is the dated files of `infra/migrations/YYYY-MM-DD-name.sql`
  (never edited once applied: a change is a new file). `pnpm db:rebuild` (DATABASE_URL, never production, `--yes` for a remote host)
  drops `public` and migrates from zero. The database tests (`lib/db/*.integration.test.ts`) need a real PostgreSQL and fail without
  `DATABASE_URL` (CI starts one; locally `docker run -p 55432:5432 -e POSTGRES_USER=kridoc_db -e POSTGRES_PASSWORD=ci-only-password postgres:16`).
  The feature is off by default (`DATABASE_ENABLED`): only when it is `on` does production require `DATABASE_URL` and `DATABASE_CA_CERT`.
- **Accounts** (krizaka-internal#3718): Kridoc's own users and sessions, on its own database, with `@krizaka/auth` and `@krizaka/rate-limit`. Tables
  `account` and `session` (`infra/migrations/2026-11-16-accounts-sessions.sql`); ports and services in `apps/web/lib/auth/` (`account-store.ts`,
  `auth-service.ts`: sign-in with the lock after `SETTINGS.maxFailedSignIns` wrong passwords, sign-up, sign-out); the composition root is
  `apps/web/app/accounts-edge.ts`; routes `app/api/auth/{sign-in,sign-up,sign-out}` are thin; every refusal is an `AuthError` with a stable code,
  mapped once in `lib/auth/http.ts` (Problem Details, words in `messages/*.json` under `auth.errors`). Off by default (`AUTH_ENABLED`): then every
  account route and page answers 404 and nothing is required. On, production requires `DATABASE_ENABLED=on` and `AUTH_SESSION_SECRET` (32+ characters).
  Sign-up is closed (`AUTH_SIGNUP=closed`, the default); the first administrator is made by `pnpm auth:create-admin` (`AUTH_ADMIN_EMAIL`,
  `AUTH_ADMIN_PASSWORD` from the environment, never argv). The rate-limit counters are in memory (one instance); a shared store is a follow-up. No password, hash or token is ever logged.
- **Documents** (krizaka-internal#3719, design in [docs/design/storage-service.md](design/storage-service.md)): Kridoc's own documents, metadata in
  `document`, bytes in an `ObjectStore` of `@krizaka/storage` (`apps/web/lib/storage/object-store.ts`: a folder `<MEDIA_STORAGE_ROOT>/<tenant>/` in
  development, a bucket under `t/<tenant>/` in production). `document-service.ts` reaches a document only through its owner's row (another's is
  « not found »); the composition root is `apps/web/app/documents-edge.ts`; routes `app/api/documents` (list, upload) and `app/api/documents/[id]`
  (download, delete) are thin; refusals are `DocumentError`s mapped once in `lib/storage/http.ts` (words under `documents.errors`). Limits are
  `SETTINGS.documents`. Off by default (`MEDIA_STORAGE_ENABLED`): every document route answers 404. On, production requires `AUTH_ENABLED=on`,
  `MEDIA_STORAGE_PROVIDER=s3`, `MEDIA_DOCUMENTS_TENANT` and the `MEDIA_S3_*` settings with a Canadian region (Law 25). No live bucket in CI: the
  bucket adapter runs `objectStoreContract` on a fake S3.
- **Storage API for the other products** (krizaka-internal#3756, slice 5 of the design note): `/api/storage/v1/objects/{key}` (PUT, GET,
  HEAD, DELETE), `/api/storage/v1/objects?prefix=`, `/api/storage/v1/links/{key}` (POST signs, GET opens). A client is a row of
  `storage_client` (`infra/migrations/2026-11-18-storage-clients.sql`); its tenant comes from its `kst1.` bearer token, never from the
  request; only the token's keyed hash is stored. Tokens are issued, listed and revoked with `pnpm storage:client` (DATABASE_URL,
  MEDIA_VAULT_KEY); the token is printed once. Services in `apps/web/lib/storage/` (`storage-clients.ts`, `storage-api.ts`), composition
  root `apps/web/app/storage-api-edge.ts`, refusals `StorageApiError` mapped once in `lib/storage/api-http.ts` (words under
  `storageApi.errors`), limits `SETTINGS.storageApi`. Same switch as the documents (`MEDIA_STORAGE_ENABLED`, off: every route 404). The
  contract with Verikora is `docs/architecture/kridoc-storage-api.v1.openapi.yaml` (Verikora generates its types from a copy) and
  `objectStoreContract`, run against the routes through `lib/storage/kridoc-api-store.ts`.
- **Storage API v1.1** (krizaka-internal#4041, OpenAPI `1.1.0`): `Repr-Digest` both ways (`lib/storage/object-digest.ts`), create-only with `If-None-Match: *`
  (200 + `Idempotent-Replayed`, or 412; atomic per tenant inside one instance through `lib/storage/tenant-write-lock.ts`), `DELETE` answers a deletion
  record (also an audit line). List pages with `after` + `limit` and answers `{ objects, next, truncated }`; `GET /ping` and `GET /usage`; the quota
  per tenant (`storage.quotaMb`, `storage.quotaObjects`, admin screen) refuses a write with `403 STORAGE_QUOTA_EXCEEDED` before any byte is kept;
  `X-Request-Id` on every answer (echoed when valid, in a refusal's `instance`). Types are generated from the OpenAPI file
  (`pnpm --filter @kridoc/web storage:types` → `lib/storage/generated/storage-api.d.ts`); `storage-api-types.test.ts` fails on drift.
- **Storage settings, audit and retention** (krizaka-internal#3755, slice 4 of the design note): the rules every upload and every link obeys are
  settings of `@krizaka/settings` (`apps/web/lib/storage/storage-settings.ts`: `storage.maxMb` 1-100, `storage.allowedTypes`, `storage.signedUrlSeconds`
  30-3600, `storage.retentionDays` 30-3650; global scope, defaults = what the code did before), read on **every** upload and link by the documents
  routes/service and by the storage API (`StorageRulesSource`, built in `app/storage-rules-edge.ts` over `dbSettings`, a 5 s cache). Only an
  `ADMIN` reads or changes them (`lib/storage/storage-settings-admin.ts`: the role, then every key against the registry's bounds so a change is whole
  or not at all, then one `storage.settings.changed` line per changed value). The screen is `/{locale}/admin/storage` (`app/[locale]/(admin)/`, on
  `@krizaka/ui`, FR and EN; not found for anyone but an administrator), its route `PUT/GET /api/admin/storage-settings`, its words under `storageAdmin`.
  Audit lines go through `@krizaka/audit` (schema `audit`, `infra/migrations/2026-11-19-settings-audit.sql`): `storage.uploaded`, `storage.read`,
  `storage.deleted`, `storage.settings.changed`, plus the API's head/list/sign and the client issue/revoke; by actor (client, account or job), tenant and
  key hash, never a token, a key's words or a title (`lib/storage/audit-trail.ts`). The **retention sweep** (`pnpm storage:sweep`, `lib/storage/retention-sweep.ts`):
  removes the documents past the retention, then the objects of an owner that have no row (each asked again right before it goes: an upload in flight
  puts its bytes before its row), a bounded batch per run (`SETTINGS.retentionSweep`, the owner cursor in `storage_sweep_cursor`); it fails closed
  (rules unreadable or a store failing: the run stops, nothing more is deleted). Only Kridoc's own documents are swept: a product's tenant
  (`verikora-prod`) keeps its objects until the product deletes them. The journey is `pnpm test:e2e` (Playwright, `apps/web/e2e/`; needs `DATABASE_URL`
  on a throwaway server: it makes and drops its own database `kridoc_e2e`).
- `dev-preview.json` is data: `devPreview` is claimed only when every criterion has fresh evidence.

## 9. Anti-slop (ADR-015)

What a model tends to write and the code does not need. Each line points at the rule that refuses it
([ADR-015](https://github.com/krizaka/.github/blob/main/docs/adr/ADR-015-ai-code-audit-measured-and-enforced.md), [docs/standards/guards.md](https://github.com/krizaka/.github/blob/main/docs/standards/guards.md)).

1. **No defensive null on `@NullMarked` code.** No `Objects.requireNonNull` or `if (x == null)` on a value the type already
   guarantees. Enforced by NullAway at compile time; a new package is `@NullMarked` (ArchUnit).
2. **A closed set is a type.** An enum, a sealed interface or an `as const` object, never a string compared by hand;
   strategies are a `Map<Kind, Strategy>` built once at startup. Enforced by PMD / ArchUnit (Java) and `no-enum-string-compare` (ast-grep).
3. **HTTP in Java is a DTO record, `@Valid` and `ProblemDetail`.** No `Map.of("error", …)`, no entity in a response, one
   `@RestControllerAdvice` per service. Enforced by ArchUnit.
4. **No `*Utils`, `*Helper` or `*Manager`.** Name the thing by what it does (§4). Enforced by ArchUnit (ADR-015 §5).
5. **`?.` and `??` in TypeScript**, not a chain of `&&` or a ternary on null. The target rules are `@typescript-eslint/prefer-optional-chain` and `prefer-nullish-coalescing`; they are not in `@krizaka/config` yet.
6. **The build is the judge.** Compile, lint and test before every push; `krizaka-edit-check` runs on each edit (below) and
   NullAway and ArchUnit run at pre-push and in CI. A rule is never silenced to get green.

**The edit hook.** Every repository adds this to `.claude/settings.json`. After each `Edit` or `Write`, the one file is
checked in under 10 s: ESLint with the repository's config for TypeScript, PMD with the Krizaka rules for Java (never Maven).
A finding comes back to the agent (exit 2); a timeout is silent.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "npx --yes -p @krizaka/config krizaka-edit-check", "timeout": 10 }]
      }
    ]
  }
}
```

In a TypeScript repository that already depends on `@krizaka/config`, use `npx --no-install krizaka-edit-check` (no download).
