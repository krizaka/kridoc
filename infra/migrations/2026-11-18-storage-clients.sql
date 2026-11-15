-- The products that keep files in Kridoc (krizaka-internal#3756, slice 5 of #3719): one row per token. Each product is its own tenant
-- (`verikora-prod`), never an account's (`account-<uuid>` is reserved for Kridoc's own accounts). Only the keyed hash of a token is kept:
-- the token itself (`kst1.<43>`) is shown once at issue and is never stored. A token is rotated by issuing a second and revoking the first.
CREATE TABLE storage_client (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product     text NOT NULL CHECK (product ~ '^[a-z][a-z0-9]{1,31}$'),
  tenant_id   text NOT NULL CHECK (
    tenant_id ~ '^[A-Za-z0-9_-]{1,64}$'
    AND starts_with(tenant_id, product || '-')
    AND NOT starts_with(tenant_id, 'account-')
  ),
  token_hash  text NOT NULL UNIQUE CHECK (length(token_hash) BETWEEN 32 AND 128),
  scopes      text[] NOT NULL CHECK (
    cardinality(scopes) > 0 AND scopes <@ ARRAY['put', 'get', 'delete', 'sign']::text[]
  ),
  created_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

-- The clients of one tenant (the administrator's list, a rotation), newest first.
CREATE INDEX storage_client_tenant_idx ON storage_client (tenant_id, created_at DESC);
