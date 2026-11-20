-- Products' keys on @krizaka/api-keys (krizaka-internal#4044, design docs/design/integration.md § 2). Expand step: the library's `api_keys`
-- table (version 1 of its schema, byte for byte), owned by a storage client: the client keeps the tenant, its keys carry the scopes,
-- the expiry, the grace of a rotation and the last use. `storage_client.token_hash` (`kst1.` tokens) stays untouched: both formats are
-- accepted during the switch, and the contract step (dropping `token_hash`) is a later release, once every client has been reissued.
CREATE TABLE api_keys (
  id              uuid PRIMARY KEY,
  owner_id        uuid NOT NULL REFERENCES storage_client(id) ON DELETE CASCADE,
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  public_id       text NOT NULL UNIQUE CHECK (public_id ~ '^[0-9a-f]{12}$'),
  secret_hash     text NOT NULL CHECK (secret_hash ~ '^[0-9a-f]{64}$'),
  scopes          text[] NOT NULL CHECK (cardinality(scopes) > 0),
  expires_at      timestamptz,
  created_at      timestamptz NOT NULL,
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  rotated_from_id uuid REFERENCES api_keys(id) ON DELETE SET NULL,
  superseded_at   timestamptz
);
CREATE INDEX api_keys_owner ON api_keys(owner_id, created_at);
