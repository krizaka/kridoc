# Kridoc's storage service

Status: design, slices 1, 3 and 5 built (krizaka-internal#3719, slice D of #3714; encryption per account krizaka-internal#3754; product API krizaka-internal#3756). Founder: « kridoc are responsable to exopse storages to all
our apps » (2026-11-14); « chaque produit est indepedant donc il mange ses users » (2026-11-15). Law 25: personal data stays in Canada.

## Résumé (français)

1. Kridoc garde deux choses : les documents de ses propres comptes, et les fichiers des autres produits (Verikora d'abord) par une API.
2. Tout passe par `@krizaka/storage` : le même port `ObjectStore`, un dossier en développement, un bucket S3 en production.
3. Production : le bucket doit être au Canada (région ET adresse) ; sinon Kridoc refuse de démarrer, comme Verikora refuse Bunny.
4. Chaque produit appelant est un locataire (tenant) à part : son propre jeton, ses clés sous son préfixe, jamais partagé.
5. Un produit ne voit jamais les fichiers d'un autre ; un compte Kridoc ne voit jamais les documents d'un autre compte.
6. Les liens signés vivent quelques minutes ; les tailles, les types et la durée de conservation sont des réglages de l'admin.
7. Chaque dépôt, lecture, suppression et changement de réglage laisse une ligne d'audit.
8. Verikora ajoute « Kridoc » comme fournisseur dans son registre (ADR-005), puis déplace ses documents avec son déplacement vérifié.
9. Tranches 1 et 3 : les documents des comptes Kridoc, derrière `MEDIA_STORAGE_ENABLED` (éteint par défaut) ; chaque compte a sa
   propre clé (enveloppe, clé racine `MEDIA_VAULT_KEY`), détruite quand le compte est effacé : ses fichiers deviennent illisibles.
   Tranche 5 : l'API des produits (`/api/storage/v1`), un jeton `kst1.` par produit et environnement, émis par `pnpm storage:client`.
10. À décider par le fondateur : le bucket canadien (fournisseur, coût) et ses clés.

## Two users of one store

| Who                                      | Door                                | Tenant                                                          | Keys under                                                      |
| ---------------------------------------- | ----------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| A person with a Kridoc account           | `/api/documents` (session cookie)   | the installation (`MEDIA_DOCUMENTS_TENANT`, e.g. `kridoc-prod`) | `t/<installation>/t/account-<accountId>/documents/<documentId>` |
| Another Krizaka product (Verikora first) | `/api/storage/v1/…` (product token) | one per product and environment (`verikora-prod`)               | `t/<installation>/t/<product tenant>/<the product's own key>`   |

Both sit on one `ObjectStore` of `@krizaka/storage` (`bucketStore` in production, `folderStore` in development and tests). The tenant
is never read from a request: the installation's comes from the environment once at the edge; a product's comes from its token.

## Rules

- **Library first.** The port, the adapters, key checks (`assertKey`), magic-number type checks (`sniffType`), upload parsing
  (`readUpload`), residency (`residencyOfConfig`), the SSRF rule (`checkEndpoint`), signed links (`signedUrl`) and later the envelope
  encryption per tenant (`tenantVault` / `tenantStore`) all come from `@krizaka/storage`. A missing function goes into the package
  first (open: a fake S3 for the testkit, `presignPut` for direct uploads).
- **Canada only.** In production the provider must be `s3`, and its region and endpoint must agree on a Canadian region
  (`residencyOfConfig`); an unmapped region is « elsewhere ». Otherwise `assertProductionEnv` refuses the boot. A folder is development
  only (an App Platform disk is wiped at each deploy and has no stated residency).
- **Isolation.** Every read starts from the owner's metadata row (`findForOwner`), so another person's document is « not found », never
  « forbidden ». A product's token opens only its tenant's prefix; a key from the request is checked by `assertKey` and joined under the
  prefix, so `..` or another tenant's name cannot be reached.
- **Keys never shared.** One token per product and environment (`kst1.<random>`), only its keyed hash stored, scoped to one tenant
  and a set of actions (`put`, `get`, `delete`, `sign`); rotated by issuing a second and revoking the first. The bucket's own keys stay
  in Kridoc's environment; no product ever holds them.
- **Signed links.** A download may be a presigned GET of at most `storage.signedUrlSeconds` (default 300 s); uploads go through Kridoc
  today, presigned PUTs once `@krizaka/storage` has `presignPut`.
- **Settings, not constants.** Largest file, accepted types, link lifetime and retention days are settings. Slice 1 reads them from
  `SETTINGS.documents` (`apps/web/lib/env.ts`); the admin slice moves them to the `@krizaka/settings` registry (the
  `storageSettings` fragment of `@krizaka/storage/settings`), per tenant for the products.
- **Audit.** `@krizaka/audit` lines: `document.uploaded`, `document.read`, `document.deleted`, `storage.object.*` (per product, by
  token id, never by key content), `storage.client.issued|revoked`, `storage.settings.changed`, and the `storage.key.*` lines of
  `tenantVault`.
- **Encryption per account (slice 3).** Each Kridoc account is a tenant of `tenantVault` (`account-<accountId>`): its own key,
  wrapped by the root key `MEDIA_VAULT_KEY` (32 bytes in base64, from the secret store: never in the database, never logged) and kept
  wrapped in `storage.tenant_keyring` / `storage.tenant_key` (`storageSchema` v2, emitted by `emitMigration`). `tenantStore` seals every
  object with a fresh data key and its full name as associated data, so the bucket holds ciphertext only and a copy under another
  account's name does not open, even for whoever holds the bucket key. Erasing an account (`eraseOwner`) shreds its key first, then
  deletes its objects: every copy, a backup included, is unreadable at once. Today the root key is held by the process
  (`memoryKeyService` with the deployment's key); a cloud KMS (`cloudKeyService`, AWS KMS ca-central-1 or OVHcloud KMS) is the same
  `KeyService` port, a founder decision.
- **Retention.** Per tenant, as data; a daily job deletes what is past it and sweeps orphans (`sweepOrphans`).

## Verikora moves to Kridoc (ADR-005)

Verikora already chooses its documents' store through its provider registry (`apps/web/lib/storage/providers.ts`, scope `org`, data
kinds `documents` / `avatars` / `backups`) and moves between providers with the verified move (ADR-005 §3: the old provider
`retiring`, reads new-then-old, retired at 0 left). Kridoc becomes one more provider kind there:

1. Kridoc ships the product API (slice 5) and issues Verikora a token for `verikora-dev`, then `verikora-prod`.
2. Verikora adds a `kridoc` provider plugin: an `ObjectStore` over Kridoc's API (endpoint + token, sealed like any provider's
   credentials), passing `objectStoreContract`. Verikora keeps its own envelope encryption, so Kridoc holds ciphertext only.
3. The admin registers it, tests it, makes it the default for `documents`, and runs the verified move from the Toronto Spaces bucket
   (#3424). The Spaces provider is retired once the move reports 0 left.

What moves when: nothing of Verikora moves before Kridoc's API is merged, tested and its bucket is in Canada; `backups` stay a second,
independent place and do not move to Kridoc.

## Slices

1. **Kridoc's own documents** (this PR): routes `/api/documents` (list, upload) and `/api/documents/[id]` (download, delete), the
   local and the bucket adapter behind the port, the owner isolation test, the bucket's contract test on a fake S3 (no live call in
   CI), `MEDIA_STORAGE_ENABLED` off by default and required settings in production only when on.
2. **Library**: a fake S3 in `@krizaka/storage/testkit` (Kridoc and Verikora drop their own), `presignPut`.
3. **Encryption per tenant**: `tenantStore` + `tenantVault` over the bucket, the tenant keyring migration, crypto-shredding on erasure.
4. **Admin**: the settings registry, audit lines, retention and the orphan sweep.
5. **Product API** (built, krizaka-internal#3756): `storage_client` (product, tenant, token hash, scopes; `2026-11-18-storage-clients.sql`),
   `/api/storage/v1/objects/{key}` (PUT, GET, HEAD, DELETE), `/api/storage/v1/objects?prefix=` (list), `/api/storage/v1/links/{key}`
   (POST signs, GET opens), a limiter per client, audit lines. The contract: [the OpenAPI document](../architecture/kridoc-storage-api.v1.openapi.yaml)
   and `objectStoreContract`, run against the routes through the reference client `apps/web/lib/storage/kridoc-api-store.ts`.
   Choices of this slice:
   - **Signed links are Kridoc's own.** The bucket holds ciphertext (`tenantStore` answers `null` to `signedUrl`), so a link is an
     HMAC over `(client, key, expiry)` to Kridoc's `links` route, which opens the object and serves it; revoking the client kills its
     links at once.
   - **No second secret.** The tokens' hash key and the links' key are derived from `MEDIA_VAULT_KEY` by HKDF-SHA-256, one per
     purpose (`lib/storage/derived-secrets.ts`). New root key material means reissuing the tokens.
   - **Types.** A client declares a type from `SETTINGS.storageApi.types`; bytes of a known type must be that type, and may not hide
     under `application/octet-stream`, the type of a product's own ciphertext (Verikora seals before it sends).
   - **Tenants.** `<product>-<environment>`, never `account-…` (checked in code and by the table); a product's tenant shares the
     installation's store and keyring with Kridoc's accounts, each under its own key.
   - **Not yet:** audit lines go to the log until `@krizaka/audit` is wired (slice 4); the limiter counts per instance
     (`dbLimitStore` when there are several); limits per tenant come with the admin's settings (slice 4); the reference client
     belongs in `@krizaka/storage` (`kridocStore`), with the bounded body reader of `lib/storage/api-http.ts`.
6. **Verikora's `kridoc` provider** and the verified move.
7. **Infrastructure** (founder): the Canadian bucket and its keys; `MEDIA_STORAGE_ENABLED` on in dev, then prod.

## Environment

`MEDIA_STORAGE_ENABLED` (`off`), `MEDIA_STORAGE_PROVIDER` (`local` | `s3`), `MEDIA_STORAGE_ROOT`, `MEDIA_DOCUMENTS_TENANT`, `MEDIA_VAULT_KEY`,
`MEDIA_S3_ENDPOINT`, `MEDIA_S3_REGION`, `MEDIA_S3_BUCKET`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY`. The
brief's `STORAGE_ENABLED` is `MEDIA_STORAGE_ENABLED`: variables are named by bounded context (`tests/env.test.ts`).
