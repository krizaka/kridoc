# How every app connects to Kridoc: one API, one key per app, one shared client

Status: design (krizaka-internal#4036, parent #3038), 2026-11-16. Design only: no code, no migration, nothing deployed. Builds on
[storage-service.md](storage-service.md) (the storage API v1, built), the data model of krizaka-internal#3903 and revision 5 of the
direction (krizaka-internal#3883, accepted 2026-11-15). Founder, 2026-11-16: « Kridoc doit proposer rapidement aux autres apps de se
connecter à lui via une key et storer […] centralisation du code : c'est du code identique entre les apps ».

## Résumé pour le fondateur

**En une phrase :** chaque app (Verikora d'abord, puis Sovkora, Folioviv, puis les clients de l'offre Kridoc) parle à Kridoc par
**une seule API versionnée**, avec **une clé par app et par environnement**, à travers **un seul client écrit une fois** dans nos
bibliothèques (`@krizaka/storage` pour TypeScript, le starter `krizaka-storage` pour Java) ; aucune app n'écrit son propre code
d'accès à Kridoc.

**Ce qui existe déjà (vérifié dans le code) :** l'API de stockage v1 de Kridoc est construite (dépôt, lecture, liste, suppression,
liens signés), chiffrée par app, avec des jetons `kst1.` dont seule l'empreinte est gardée ; un client de référence passe le contrat
de comportement de `@krizaka/storage`. Elle est **éteinte** (`MEDIA_STORAGE_ENABLED`), et Kridoc n'a encore ni bucket de production,
ni app de développement. Il manque donc peu de code et surtout de l'infrastructure.

**Les sept décisions :**

1. **Le contrat :** on garde l'API v1 (des objets, l'app garde ses droits) et on l'enrichit sans rien casser (v1.1) : empreinte
   SHA-256 vérifiée à l'entrée et rendue à la sortie, dépôt « création seule » rejouable sans doublon, reçu de suppression, liste
   paginée, un « ping » qui teste la clé. Les dossiers, versions et droits gérés par Kridoc viendront dans une deuxième API (« Files
   API », modèle #3903), plus tard, sans bloquer Verikora.
2. **Les clés :** une clé par app et par environnement (`verikora-dev`, `verikora-prod`), avec des droits limités (déposer, lire,
   supprimer, signer), jamais stockée en clair, rotation sans coupure (deux clés valides pendant un délai de grâce), révocation
   immédiate, quotas et limites de débit par clé, chaque usage journalisé. On garde les jetons actuels pour le premier document, puis
   on passe sur `@krizaka/api-keys` (expiration, délai de grâce, dernière utilisation). Un client externe reçoit sa clé dans l'admin
   de Kridoc (K2, après cinq clients payants) ; d'ici là c'est l'opérateur qui l'émet.
3. **Un seul client :** écrit à la main une fois par langage, pas généré : l'API a sept opérations, et la valeur est dans le
   comportement (reprises, coupe-circuit, empreintes, erreurs), que les générateurs ne produisent pas. Les **types** sont générés du
   contrat OpenAPI, et un test refuse toute dérive. Pour une app TypeScript, Kridoc devient un fournisseur de plus dans le registre
   qu'elles ont déjà : l'admin le choisit, le teste, en fait le défaut. Zéro copie par app.
4. **Résilience :** délais limités, reprises avec attente aléatoire seulement sur les appels sans effet double, coupe-circuit après
   cinq échecs, empreinte de bout en bout, jamais de fichier à moitié visible. Si Kridoc est en panne : l'utilisateur reçoit un
   message clair (« réessayez dans quelques minutes ») ; les suppressions et les tâches de fond attendent dans la file d'envoi de
   l'app (`@krizaka/outbox`) et repartent seules. **Jamais de copie locale des documents** sur le disque de l'app.
5. **Sécurité et loi 25 :** données à Toronto (Kridoc refuse de démarrer sinon), chiffrement en transit et au repos, trois couches
   pour Verikora (le bucket, la clé de Kridoc par app, et le chiffrement propre de Verikora : Kridoc ne voit jamais un document de
   Verikora en clair) ; isolement par app, puis par organisation (#3903) ; reçu de suppression gardé dans un registre rejoué après une
   restauration. Kridoc journalise qui a fait quoi et quand, jamais le contenu, jamais la clé, jamais un nom.
6. **Exploitation :** un « ping » et une santé, un objectif de disponibilité, des métriques par app, l'identifiant de requête dans
   chaque erreur, et un guide d'intervention (Kridoc en panne, clé volée, quota atteint, restauration).
7. **Le chemin le plus court vers « Verikora garde son premier vrai document dans Kridoc avec sa clé » :** cinq nouveaux
   tickets (deux moyens, trois petits) et six tickets existants recentrés, dans l’ordre du § 7. **En production, il n'y a rien à déplacer** : le premier vrai document de Verikora va directement dans
   Kridoc ; le déplacement vérifié ne sert qu'aux documents fictifs de dev.

**À décider par le fondateur :** l'app de dev de Kridoc (environ 5 à 12 USD/mois, #3501) ; le bucket de production de Kridoc à
Toronto (dans le forfait Spaces actuel) qui **remplace** le bucket de production propre à Verikora prévu par #3234 ; la clé racine de
production (en mémoire du processus pour le pilote, ou un KMS au Canada) ; l'entente de traitement des données pour les clients
externes (K2).

---

## 0. What exists today (read in the code, 2026-11-16)

- **Kridoc** (`apps/web/lib/storage/`): the storage API v1 is built behind `MEDIA_STORAGE_ENABLED` (off: every route 404
  `STORAGE_API_OFF`). `PUT|GET|HEAD|DELETE /api/storage/v1/objects/{key}`, `GET /api/storage/v1/objects?prefix=`,
  `POST|GET /api/storage/v1/links/{key}`. Contract: [kridoc-storage-api.v1.openapi.yaml](../architecture/kridoc-storage-api.v1.openapi.yaml).
  - Clients: `storage_client` (product, tenant `<product>-<environment>`, scopes `put|get|delete|sign`, keyed hash of the token),
    `kst1.<43>` tokens (256 random bits, HMAC-SHA-256 under a key derived from `MEDIA_VAULT_KEY`), issued and revoked by
    `pnpm storage:client`; a limiter per client (`@krizaka/rate-limit`, per instance).
  - Every object is sealed under its tenant's key (`tenantStore` / `tenantVault`): the bucket holds ciphertext only; links are
    Kridoc's own HMAC over `(client, key, expiry)`, killed with the client.
  - Rules are settings read on every call (`storage.maxMb`, `storage.allowedTypes`, `storage.signedUrlSeconds`,
    `storage.retentionDays`), changed in Kridoc's admin and audited (#3755, partly built).
  - The reference client `kridocApiStore` (`lib/storage/kridoc-api-store.ts`) passes `objectStoreContract` against the routes.
    It has no timeout, no retry, no circuit, no digest.
- **`@krizaka/storage`** (krizaka-ts): the `ObjectStore` port, the provider registry (ADR-005: `PROVIDER_KINDS`,
  `createProviderRegistry().with(plugin)`), the testkit (`objectStoreContract`, `keyServiceContract`…), the verified move
  (`moveBatch`), `tenantVault`. No `kridoc` kind yet.
- **`@krizaka/api-keys`**: `prefix_<publicId>_<secret>` keys, SHA-256 at rest, constant-time compare, scopes, expiry (capped),
  rotation with a grace period (`supersededAt`), `lastUsedAt`, a per-owner cap. Kridoc does not use it yet.
- **`@krizaka/sovkora-client`**: the precedent of « one hand-written client for every TypeScript product »: timeout
  (`AbortSignal.timeout`), circuit breaker (`createCircuit`), `Idempotency-Key`, `Retry-After` on 429, stable error codes.
  Its circuit lives inside that package, so another client cannot reuse it today.
- **`@krizaka/outbox`**: at-least-once delivery from the product's own transaction (lease, retries, dead letters).
- **Verikora**: documents go through its provider registry (`documentsStoreOver`, data kind `documents`), sealed by Verikora before
  they leave (its own vault), with `sha256` per document in its catalogue; the verified move flips `documents.provider_id` only after
  a read-back hash match.
- **Sovkora** (Java): sealed assets on a `DurableAssetStore`; the `krizaka-storage` Spring starter (#934) does not exist.
- **Infrastructure**: `kridoc-documents-dev` (tor1, private, versioned) exists (krizaka-infra#101), to be renamed
  `kridoc-dev-documents` (#3929). No Kridoc dev app (#3758 waits on the founder, #3501). No Kridoc production bucket: #3234 plans a
  production bucket for Verikora itself.

## 1. The contract

### 1.1 Two doors, one versioning rule

- **Storage API v1 — objects** (`/api/storage/v1`, built): the product names its own keys, seals its own bytes if it wants, and
  keeps the rights to them (door 1 of #3903 § 2). This is the door of every Krizaka app now. Verikora needs nothing else.
- **Files API v1 — catalogue** (`/api/files/v1`, K1 after #3903 § 10 is approved): documents, versions, folders, retention classes,
  legal hold, rights held by Kridoc for the organisations and persons the product names. It replaces the v0 sketch
  (`kridoc-api.v0.openapi.yaml`, spaces per user), which #3903's organisations supersede. It is not on the path of the first document.
- **Versioning**: the major is in the path. A minor (v1.1, v1.2) only adds: an optional header, a field in an answer, a new route, a
  new error code. A client ignores what it does not know. A breaking change is `/v2`, with v1 served until its last client has moved
  (the clients are ours: the provider registry shows who still calls v1). `info.version` of the OpenAPI file is the minor.

### 1.2 Storage API v1.1: what is added (all additive)

1. **Integrity, both ways — RFC 9530 digest fields.** The client sends `Repr-Digest: sha-256=:<base64>:` on `PUT`; Kridoc hashes
   what it received before sealing it and refuses a mismatch (`400 STORAGE_DIGEST_MISMATCH`, nothing written). The digest is kept with
   the object's metadata, returned in `StoredObject.sha256`, in `ObjectInfo.sha256` of the list, and as `Repr-Digest` on `GET`/`HEAD`;
   the client checks it before it hands the bytes back. RFC 9530 obsoletes RFC 3230's `Digest` header.
2. **Create-only and idempotent replay.** `PUT` with `If-None-Match: *` writes only when the key is free. A retry of the same `PUT`
   (same key, same digest) answers `200` with the stored object and `Idempotent-Replayed: true`; another digest under a taken key
   answers `412 STORAGE_OBJECT_EXISTS`. Products write immutable keys (`documents/<uuid>/v<n>`), so every `PUT` of theirs is
   create-only. A `PUT` without `If-None-Match` still replaces (v1 behaviour).
3. **Why not `Idempotency-Key` on v1.** Every v1 operation is idempotent by its HTTP method (PUT on a fixed key with a fixed digest,
   GET, HEAD, DELETE); the IETF draft (`draft-ietf-httpapi-idempotency-key-header-08`) is for non-idempotent `POST`s. It is used where
   a `POST` creates something: the upload sessions of § 1.4 and the Files API's `POST /documents`, with the draft's rules: a key
   reused with another payload `422`, a key whose first request is still running `409`, the key's lifetime published (24 h), the
   request fingerprinted (method, path, digest).
4. **The deletion record.** `DELETE` answers `200` with `{ key, deletedAt, sha256, size, recordId }` (Kridoc's purge ledger,
   #3499, replayed after a restore); deleting a missing key answers `200` with `{ key, absent: true }`, still idempotent. The product
   keeps `recordId` next to its own deletion receipt (#3381). The contract kit proves it for every adapter (#3385).
5. **Pagination.** `GET /objects?prefix=&after=<key>&limit=` answers `{ objects, next }` in key order; `next` is the last key, absent
   at the end. `truncated` stays for v1 clients.
6. **Ping.** `GET /api/storage/v1/ping` (authenticated) answers `{ tenant, scopes, keyExpiresAt, api: "1.1" }`: the provider screen's
   test, the client's start-up check, a synthetic monitor.
7. **Correlation.** Every answer carries `X-Request-Id`; a refusal's Problem Details (RFC 9457, already in v1) puts it in
   `instance`. Kridoc accepts and logs a W3C `traceparent`.
8. **Quota.** Bytes and objects per tenant are settings (Kridoc's admin); a write past them answers `403 STORAGE_QUOTA_EXCEEDED`
   before any byte is kept. `GET /usage` answers `{ bytes, objects, quota }`.

### 1.3 Resources, mapped to the points of #4036

- upload: `PUT /objects/{key}` (v1.1 above); download: `GET /objects/{key}`; metadata: `HEAD /objects/{key}` and the list;
  delete with a deletion record: `DELETE /objects/{key}`; list: `GET /objects` with a cursor; retention: per tenant
  (`storage.retentionDays`, a setting) on v1 — per document, by retention class and event (closure of a file), in the Files API.
- **Versions** on v1 are the product's keys (`v<n>` in the key); Kridoc's own versions (`document_version`, #3903) belong to the
  Files API. The bucket's own versioning stays on as a safety net, not as an API.

### 1.4 Large files and direct transfer: through Kridoc, never straight to the bucket

- **Why not a presigned `PUT` to the bucket.** The bucket holds only ciphertext sealed by Kridoc under the tenant's key
  (`tenantStore`); a presigned `PUT` would put bytes there that Kridoc never sealed, outside crypto-shredding. S3 can bind a
  checksum to a presigned `PUT` (SigV4), but enforcing a size needs a presigned `POST` policy (`content-length-range`), which
  DigitalOcean Spaces does not document; Spaces also limits presigned `PUT`s through its CDN to 8,100 KiB.
- **Downloads**: Kridoc's own signed links (built), a few minutes, served by Kridoc, revoked with the client. A browser gets one link
  to one object, never a key.
- **Uploads up to `storage.maxMb`** (a setting, 1–100 MB) go in one `PUT`. Verikora's documents are at most 10 MB.
- **Above it, later**: upload sessions through Kridoc — `POST /uploads` (with `Idempotency-Key` and the final digest) →
  `PUT /uploads/{id}/parts/{n}` (each part sealed, mapped to an S3 multipart part: at least 5 MiB except the last, at most 10,000) →
  `POST /uploads/{id}/complete`. The object becomes visible only at `complete`, after the digest matches; an abandoned session is swept.
  Built when a product needs files above the limit, not before.

## 2. The keys

### 2.1 Options

- **A. Keep `kst1.` tokens (built).** 256-bit, keyed hash, scopes, revocation, rotation by issuing a second and revoking the first.
  Missing: expiry, a grace period that ends by itself, last use, a public id for an audit line and for support, an environment marker
  a secret scanner can match.
- **B. Kridoc's clients on `@krizaka/api-keys`.** Everything of A plus expiry, `supersededAt` grace rotation, `lastUsedAt`, a
  public id (`kdk_<publicId>_…` shows as `kdk_<publicId>` in every screen and log); one implementation for every Krizaka product that
  hands out keys (library first). Cost: a migration of `storage_client` and a reissue of the keys.
- **Choice: A for the first document, then B** (T6, krizaka-internal#4044), before any outside customer. A is secure enough for two internal
  clients; B removes Kridoc's second implementation of API keys. During the switch Kridoc accepts both formats; a `kst1.` key is
  refused once every client has been reissued (the admin's client list shows the format).

### 2.2 The rules (B)

- **One key per app and environment**: the tenant (`verikora-prod`) comes from the key, never from the request; a key works in one
  environment only (dev and prod are separate installations with separate databases). Format `kdk_<env>_<publicId>_<secret>`
  (`kdk_live_…`, `kdk_test_…`): a distinctive prefix lets secret scanning find a leaked key (GitHub's token formats); a checksum
  in the key is a later option.
- **Scopes**: `put`, `get` (get, head, list, usage, ping), `delete`, `sign`. Verikora's web app holds `put get delete sign`; a
  read-only worker holds `get`.
- **At rest**: the hash only; the key is shown once and goes straight into the app's secret store (`secret.sh`), never in a repo, a
  log or an issue.
- **Rotation without downtime**: issue the new key (the old one gets `supersededAt = now + grace`, a setting, default 7 days as
  Stripe's rotation flow); deploy the app with the new key; the ping shows the new key in use; the old one stops by itself at the
  end of the grace, or is revoked at once.
- **Revocation**: immediate; the key's signed links die with it.
- **Expiry**: every key ends (`maxExpiryDays`, a setting, 365 by default); the admin screen warns 30 days before.
- **Quotas and rate limits per key**: requests per minute per client (`@krizaka/rate-limit`, a shared store once Kridoc runs more than
  one instance), bytes and objects per tenant (§ 1.2-8). All are settings, per tenant, in Kridoc's admin (#3755).
- **Audit of every use**: one line per call (§ 5.4); issue, rotate, revoke and every settings change are `@krizaka/audit` lines.
- **An outside customer**: until K2, the operator creates the customer's tenant and key in Kridoc's admin and hands it over through a
  one-time link; at K2, the customer's organisation administrator creates and rotates keys in their own console (same library, same
  rules), with their plan's `maxActive`.

## 3. One client, identical everywhere

### 3.1 Options

- **A. Generated from the OpenAPI file** (openapi-generator `typescript-fetch`, a Java `restclient` / HTTP-interface generator).
  - For: every endpoint and model follows the contract by construction; `typescript-fetch` is marked stable.
  - Against: the surface is seven operations and the value is elsewhere — timeouts, retries only where safe, the circuit, the digest
    both ways, binary bodies, mapping refusals to `StorageError` codes; generators produce none of that, so every app would wrap the
    generated code again (the copy per app we want to avoid). Generated code is a large diff at each generator bump, and the result
    still has to be an `ObjectStore` to plug into the registry.
- **B. Written once per language, in the libraries.** TypeScript: `kridocStore` and a `kridoc` provider kind in `@krizaka/storage`.
  Java: a Kridoc adapter in the `krizaka-storage` starter (#934), an `@HttpExchange` interface over `RestClient`, retried with Spring
  Framework 7's core `RetryTemplate`.
  - For: the behaviour lives in one place per language and is tested once; Verikora's registry, its verified move and the contract kit
    work unchanged (Kridoc is « one more provider »); precedent: `@krizaka/sovkora-client`.
  - Against: the models can drift from the contract — closed by C.
- **Choice: C = B, with the types generated.** `openapi-typescript` generates the TypeScript types of the OpenAPI file, with no
  runtime, inside `@krizaka/storage`; a CI step regenerates them and fails on any difference (the same in Kridoc, for its routes).
  Kridoc's OpenAPI file is the one source; Verikora's copy of it disappears.

### 3.2 How the two languages stay identical

- **One behavioural contract**: `objectStoreContract` (TypeScript testkit) plus a list of contract cases as data
  (`contract-cases.json`, published with `@krizaka/storage` like `regions.json`): each case is a request, the answer Kridoc gives and
  what the client must return or throw. The Java starter's test kit runs the same file.
- **Provider side**: Kridoc's CI runs `objectStoreContract` and the cases against its real routes through the published
  `kridocStore` (not a local copy), on a real PostgreSQL and a fake S3.
- **Consumer side**: Verikora's CI runs `objectStoreContract` on its `kridoc` provider against a fake that replays the cases; the
  journey (§ 7) proves the real thing on dev.
- **Shared resilience code**: the circuit breaker, the retry with full jitter and `Retry-After`, the retry budget and the timeout
  move out of `@krizaka/sovkora-client` into one shared module of krizaka-ts; `sovkora-client` and `kridocStore` both use it.

### 3.3 What an app writes

- TypeScript app (Verikora, Folioviv): bump `@krizaka/storage`; the admin adds a `kridoc` provider (endpoint, key) on the storage
  screen, tests it, makes it the default for `documents`. No Kridoc code in the app.
- Java app (Sovkora): add the starter; `krizaka.storage.kridoc.endpoint` and the key from the vault port; inject `StoragePort`.
- Anyone else (an outside customer): the OpenAPI file and the key; our libraries are open source, so a TypeScript or Java customer can
  use the same client.

## 4. Resilience

### 4.1 The client's rules (one implementation per language)

1. **Timeouts**: connect and first byte within 5 s; the whole call within `10 s + 2 s per MB` of the body. Both are options of the
   provider, with these defaults.
2. **Retries only when safe**: on a network error, a timeout, `408`, `429`, `502`, `503`, `504`, and only for `GET`, `HEAD`,
   `DELETE`, `ping`, the list and a create-only `PUT` with its digest (§ 1.2-2) — all idempotent. Never on another `4xx`.
   At most 3 attempts, full-jitter exponential backoff (base 200 ms, cap 5 s), at least the `Retry-After` the server asked for
   (RFC 9110), and a retry budget (a token bucket: retries at most 10 % of calls) so a struggling Kridoc is not hammered.
3. **Circuit breaker**: 5 failures in a row (no answer, timeout, `5xx`) open it for 30 s, then one probe; a refusal (`4xx`) is an
   answer and never opens it. While open, a call fails at once with `STORAGE_PROVIDER_FAILED` (`circuit open`), never after a timeout.
4. **Checksums end to end**: the client hashes the bytes it sends (for Verikora, its own ciphertext), sends the digest, compares
   the one returned, and checks the digest of every download before returning it; a mismatch is `STORAGE_UNREADABLE`, never bytes.
5. **No partial file visible**: Kridoc receives the whole body, checks size, type and digest, seals, then writes once; an S3 `PUT`
   is visible only once complete; a session object only after `complete`.
6. **At-least-once with idempotency**: a product's job that writes or purges runs from `@krizaka/outbox` (lease, retries, dead
   letter), and every call it makes is idempotent (§ 1.2-2, § 1.2-4), so a duplicate delivery changes nothing.
7. **Errors**: every refusal becomes a `StorageError` with a stable code (`STORAGE_PROVIDER_FAILED`, `STORAGE_TOO_BIG`,
   `STORAGE_BAD_TYPE`, `STORAGE_UNREADABLE`, plus `STORAGE_QUOTA_EXCEEDED`); the app maps it to its catalogue's words. The message
   names Kridoc's code and the request id, never the key or a body.

### 4.2 What an app does when Kridoc is down

- **A person uploads a document**: refused at once with a clear message from the app's catalogue (« Le stockage des documents est
  momentanément indisponible ; votre fichier n'a pas été gardé. Réessayez dans quelques minutes. »). The form keeps its other
  fields. **No local staging**: an App Platform disk is wiped at each deploy and has no stated residency, and no bytes go into
  PostgreSQL (#720).
- **A person opens a document**: the metadata still shows (it is in the app's database); the download says the same message.
- **A purge** (retention, erasure): recorded in the app's transaction as an outbox message, delivered when Kridoc answers again;
  the deletion record comes back then and completes the app's receipt.
- **A generated document** (a report the app builds): the job is retried from the outbox; it holds the reference to rebuild, never
  the bytes.
- **Kridoc is slow**: the circuit and the retry budget keep the app's own pages fast; the provider screen shows the circuit's state.

## 5. Security and the law

### 5.1 Residency

- Data in Toronto: Kridoc's buckets are DigitalOcean Spaces `tor1`; Kridoc refuses to start in production when its provider's
  region and endpoint do not agree on a Canadian region (`residencyOfConfig`, built). Kridoc's database is the managed PostgreSQL
  cluster in Canada (#3717).

### 5.2 Encryption

- In transit: TLS to Kridoc and from Kridoc to the bucket; the client refuses a plain `http://` endpoint in production
  (`checkEndpoint`).
- At rest, in three layers for Verikora:
  1. Spaces' own encryption.
  2. Kridoc's envelope per tenant (`tenantStore`), whose key is wrapped by the root key.
  3. Verikora's own vault: Kridoc only ever holds Verikora's ciphertext.
- Crypto-shredding: erasing a tenant or, at K2, an organisation shreds its key first, so every copy, backups included, becomes
  unreadable at once.

### 5.3 Isolation

- Per tenant: the key gives the tenant, every key is joined under its prefix, and another tenant's object is « not found » (built).
- Per organisation and per person: on the Files API, by #3903's rights engine.

### 5.4 What Kridoc logs and keeps

- **One line per call**: time, request id, client public id, tenant, operation, a hash of the object key (never the key, which could
  carry a product's id), size, digest, status, duration.
- **Never logged**: the bytes, the key, a name, an e-mail.
- **Kept**: the audit lines and the purge ledger for a period that is a setting (default 12 months for the call lines; the purge
  ledger as long as the backups it must be replayed over).
- **Rule for products**: object keys are opaque ids (`documents/<uuid>/v<n>`), never a person's name or file name.

### 5.5 Law 25

- **Records**: Kridoc's record of processing and its privacy assessment (EFVP) are krizaka-internal#3720, which must be done before
  the first real document.
- **Role**: Kridoc is a processor for each product (the same company); for an outside customer, a data processing agreement is a
  founder decision (K2).

## 6. Operate it

### 6.1 Health

- `GET /api/health` (unauthenticated, no detail) for the platform's liveness.
- `GET /api/storage/v1/ping` (authenticated) for the caller's test and the synthetic monitor.

### 6.2 SLO for v1

- **Availability**: 99.5 % of authenticated calls answered without a `5xx` per calendar month.
- **Latency**: p95 under 1.5 s for a `PUT` of 10 MB, p95 under 300 ms for a `HEAD`.
- These figures are measured from Kridoc's logs first. A higher target needs a second instance and the shared limiter store.

### 6.3 What a caller sees

- **Metrics**: the client calls the app's hook `onCall({ operation, status, code, ms, attempt, circuit })`, so the app can log it and
  count it.
- **Trace**: the client sends `traceparent` and keeps the answer's `X-Request-Id` in its errors.
- **Provider screen**: the last test, the circuit's state and the quota use.

### 6.4 What Kridoc's operator sees

- Calls, errors by code, latency and bytes, per tenant.
- Quota use, keys close to their expiry and keys never used.

### 6.5 The runbook

`docs/runbooks/storage-api.md` (T4, krizaka-internal#4043):

- Kridoc down or slow.
- A key leaked: revoke, issue a new key, redeploy the app, check the ping.
- A tenant at its quota.
- The bucket unreachable.
- A restore: the restore drill of #3500, and the purge ledger replayed over it (#3499).

## 7. The fastest path, and the tickets

### 7.1 The path to « Verikora stores its first real document in Kridoc with its key »

1. **Kridoc storage API v1.1** (kridoc, M): the digest both ways, create-only `PUT` with idempotent replay, the deletion record on
   `DELETE`, the list cursor, `ping`, `usage`, quota, `X-Request-Id`; the OpenAPI file at 1.1; its types generated and checked.
2. **Shared resilience module** (krizaka-ts, S): timeout, full-jitter retry with `Retry-After` and a budget, and the circuit,
   lifted from `@krizaka/sovkora-client` (which then imports it).
3. **The `kridoc` provider kind and `kridocStore`** (krizaka-ts, M): in `@krizaka/storage`, moved from Kridoc's reference client,
   with § 4.1, the generated types and the contract cases; Kridoc's own contract test switches to the published client.
4. **Runbook, SLO, call log** (kridoc, S): § 5.4 and § 6, before storage is turned on with real data.
5. **Infrastructure and turning it on**:
   - Dev: Kridoc's dev bucket renamed (#3929), the dev app and storage on, and `verikora-dev`'s key issued (#3758, which needs the
     founder's dev-app decision).
   - Prod: Kridoc's production bucket in Toronto (#3234, retargeted), then storage on in production and `verikora-prod`'s key in
     Verikora's prod secret store (new ticket, S).
6. **Verikora's `kridoc` provider and the journey** (#3810, rescoped):
   - Bump `@krizaka/storage`, register Kridoc on dev, test it, make it the default for `documents`.
   - A journey proves it on dev: upload, download with the same digest, delete, deletion record.
   - Then the same on prod. Before that, the Law 25 record (#3720) and the restore proof on Kridoc's bucket (#3500) are done.

There are no real documents in production yet, so **nothing has to move in prod**. The verified move (#3811) moves only dev's
fictional documents from Bunny to Kridoc, and the planned Bunny → Spaces move on dev (#3424) is skipped.

### 7.2 Then each next app

- **Folioviv** (TypeScript): a configuration only. Bump `@krizaka/storage`, have the operator issue a key, register the provider on
  the storage screen.
- **Sovkora** (Java): the `krizaka-storage` starter with its Kridoc adapter (T7, krizaka-internal#4040), then Sovkora's sealed assets move behind
  `StoragePort`.
- **After the first document**: Kridoc's keys move to `@krizaka/api-keys` (T6, krizaka-internal#4044), before the first outside key.
- **Outside customers**: the Files API (after #3903 § 10) and the self-serve keys (K2).

### 7.3 New tickets, in build order (opened under #3038)

All are in Backlog, lane platform, children of #3038. T1 to T5 are the path; T6 and T7 come next.

1. **T1 — krizaka-internal#4041** (kridoc, M): the storage API v1.1 of § 1.2.
2. **T2 — krizaka-internal#4038** (krizaka-ts, S): the shared timeout, retry and circuit module of § 3.2 and § 4.1.
3. **T3 — krizaka-internal#4042** (krizaka-ts, M): the `kridoc` provider kind and `kridocStore`. It needs T1 and T2, and Kridoc
   drops its local reference client.
4. **T4 — krizaka-internal#4043** (kridoc, S): the call log, the SLO and the runbook of § 5.4 and § 6.
5. **T5 — krizaka-internal#4039** (kridoc, S): storage on in production with `verikora-prod`'s key. It needs #3234 retargeted,
   T1 and T4. Dev is #3758, after #3929.
6. **Then the existing #3810, rescoped**: Verikora registers Kridoc and proves it with the journey (dev, then prod, after #3720
   and #3500).
7. **T6 — krizaka-internal#4044** (kridoc, M): the keys on `@krizaka/api-keys`, managed in the admin. It comes before any outside
   key.
8. **T7 — krizaka-internal#4040** (krizaka-java, M): the `krizaka-storage` starter's port and Kridoc adapter, split from #934. It
   is for Sovkora.

### 7.4 Existing tickets: keep, merge, split, close (for the CTO to apply)

Keep:

- **#3038** (epic): keep. K1 is now « the storage API v1.1 used by Verikora with its key ». K0's « no service » line is superseded
  by the founder's decision of 2026-11-13.
- **#3714** (Kridoc on our libraries): keep, as the parent of its slices. It is not on this path.
- **#3755** (storage admin): keep. Settings and audit are partly built. The admin issuance of keys and the per-tenant quotas go into
  T6 (krizaka-internal#4044).
- **#3758** (Kridoc dev bucket and storage on in dev): keep, as step 5. It is blocked by the founder's dev-app decision (#3501),
  and #3929 comes first.
- **#3757** (Verikora in Kridoc, parent): keep, as the parent of #3810 and #3811.
- **#3720** (Law 25 record): keep, before the first real document in production.
- **#3929** (Kridoc dev bucket in the map): keep, before #3758.
- **#3925, #3926, #3927, #3928, #3931, #3932, #3933** (storage map): keep. They are infrastructure hygiene, not on the path,
  except that the production bucket must follow the map's naming (#3928).
- **#3499** (purge ledger) and **#3385** (deletion record in the contract kit): keep. T1's deletion record writes into
  #3499's ledger and is proven by #3385's kit.
- **#720** (Verikora's bytes out of PostgreSQL): keep. It is Verikora's prerequisite: no bytes in the database, so no local
  staging.

Rescope or retarget:

- **#3810** (kridoc provider kind in Verikora): keep, rescoped. Verikora writes no client: it bumps `@krizaka/storage` (T3, krizaka-internal#4042),
  registers the provider and adds the journey of § 7.1-6.
- **#3811** (verified move to Kridoc): keep, rescoped to dev's fictional documents only. Prod has nothing to move.
- **#3234** (Verikora's production documents bucket): retarget to **Kridoc's** production documents bucket
  (`kridoc-prod-documents`, tor1, private, versioned, a key scoped to it held by Kridoc only). Verikora no longer holds a
  documents bucket.
- **#3500** (restore proof): keep, retargeted to Kridoc's production bucket. It must be done before the first real document.

Merge, split or close:

- **#3930** (Verikora's production documents in `verikora-prod-documents`): merge into #3234 as retargeted, then close. Verikora's
  production documents live in Kridoc's bucket.
- **#934** (krizaka-storage Spring starter): split. The port and the Kridoc HTTP adapter are T7 (krizaka-internal#4040), which is what Sovkora
  needs. The S3 adapter and the admin's choice from the database stay in #934, later.
- **#3424** (dev: Bunny → Spaces): close, superseded. Dev goes from Bunny to Kridoc directly through #3811, and the Spaces bucket
  would be a stop nobody keeps.
- **#3719** (Kridoc storage slice): close once the CTO checks its « Done when » (slices 1, 3 and 5 landed). Its « upload via signed
  URLs » line is replaced by § 1.4: uploads go through Kridoc.
- **#3717** (Kridoc database): close once its « Done when » is checked (kridoc#50 landed).
- **restricted#311** (Kridoc V0 foundation): keep as the umbrella of the infrastructure and compliance pack, retargeted from « a
  bucket for Verikora » to « Kridoc's production bucket ». Its restore drill is #3500.

## 8. Decisions for the founder

1. **Kridoc's dev app**: about 5 to 12 USD a month (#3501). Without it, the dev journey of § 7.1-6 has nowhere to run.
   - Recommended: yes.
   - Alternative: test only against production with a fictional tenant. It mixes environments and is not recommended.
2. **Kridoc's production bucket in Toronto**: it replaces Verikora's own production documents bucket (#3234) and stays inside the
   current Spaces plan.
3. **The production root key** (`MEDIA_VAULT_KEY`):
   - In the process's memory from the secret store, for the pilot (works today).
   - Or a KMS in Canada (AWS KMS ca-central-1 or OVHcloud KMS: a cost).
   - Recommended: memory for the pilot, the KMS before K2.
4. **For outside customers (K2)**: the data processing agreement, the plans and their quotas.

## 9. Sources (Perplexity, 2026-11-16, public sources only)

- Idempotency-Key, IETF HTTPAPI draft 08 (2026-10-22): https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/
  — 422 for a reused key with another payload, 409 while the first is in flight, a published expiry, fingerprints; also
  https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Idempotency-Key
- Digest fields, RFC 9530 (obsoletes RFC 3230): https://www.rfc-editor.org/rfc/rfc9530.html
- Problem Details, RFC 9457 (already the format of v1's refusals); `Retry-After`, RFC 9110.
- API keys: Stripe, https://docs.stripe.com/keys-best-practices, https://docs.stripe.com/keys (rotation with both keys valid up to
  seven days), https://docs.stripe.com/keys/restricted-api-keys; GitHub token formats (prefix, checksum),
  https://github.blog/engineering/platform-security/behind-githubs-new-authentication-token-formats/; OWASP API Security
  (an API key identifies a client application, not a person), https://api-security.owasp.org/
- Retries and circuit breaker: AWS Architecture Blog « Exponential backoff and jitter »,
  https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/; AWS Builders' Library « Making retries safe with
  idempotent APIs », https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/; AWS SDK retry token bucket,
  https://docs.aws.amazon.com/sdk-for-kotlin/latest/developer-guide/retries.html; Azure Architecture Center « Circuit Breaker
  pattern », https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker
- Presigned uploads and limits: AWS S3 presigned URLs, https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html;
  DigitalOcean Spaces limits (presigned PUT through the CDN 8,100 KiB; multipart 5 MiB to 5 GB per part, 10,000 parts),
  https://docs.digitalocean.com/products/spaces/details/limits/; Spaces API headers, https://docs.digitalocean.com/reference/api/spaces/
- Clients: openapi-generator `typescript-fetch` (stable), https://openapi-generator.tech/docs/generators/typescript-fetch/;
  openapi-typescript (types only, no runtime), https://openapi-ts.dev/; Spring Framework 7 core resilience (`@Retryable`,
  `@ConcurrencyLimit`, `RetryTemplate`), https://docs.spring.io/spring-framework/reference/core/resilience.html

## 10. What is not proven

- **Not measured yet**: the SLO figures and the timeouts are starting values; they are measured once storage is on in dev.
- **Not tested on Spaces**: Spaces' handling of `x-amz-checksum-sha256` on a multipart upload. It does not matter for v1.1:
  Kridoc checks the digest itself.
- **Not checked by this session**: whether Kridoc's production app already has its database and secrets. T5's production
  step checks it first.
