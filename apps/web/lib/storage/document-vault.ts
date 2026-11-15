import {
  type Clock,
  type KeyAuditNote,
  memoryKeyService,
  type ObjectStore,
  parseVaultKey,
  type TenantKeyStore,
  tenantStore,
  type TenantVault,
  tenantVault,
} from "@krizaka/storage";

import type { OwnerObjects } from "./document-port";

/** The vault's tenant of one Kridoc account: its id, never a value from a request (`account-<uuid>`, 44 characters). */
export const accountTenantOf = (accountId: string): string => `account-${accountId}`;

export interface DocumentVaultDeps {
  /** The root key (`MEDIA_VAULT_KEY`, 32 bytes in base64), passed by the edge from the secret store: never in the database, never logged. */
  rootKey: string;
  /** Where the accounts' wrapped keys live (`storage.tenant_keyring` / `storage.tenant_key`, `dbTenantKeyStore`). */
  keys: TenantKeyStore;
  clock: Clock;
  /** Every key event (`storage.key.created|rotated|rewrapped|shredded`): the tenant and the version, never a key. */
  audit: (note: KeyAuditNote) => Promise<void>;
}

/**
 * The installation's vault: one keyring for its tenants, Kridoc's accounts (`account-<uuid>`) and the other products (`verikora-prod`).
 * @throws StorageError `STORAGE_BAD_SECRET_KEY` for a root key that is not 32 bytes (the message never carries it)
 */
export function installationVaultOf(deps: DocumentVaultDeps): TenantVault {
  // The root key held by this process, from the secret store (a cloud KMS is the same `KeyService` port: krizaka-internal#3754).
  const kms = memoryKeyService({ name: "media-vault-key", root: parseVaultKey(deps.rootKey) });
  return tenantVault({ kms, keys: deps.keys, clock: deps.clock, audit: deps.audit });
}

/**
 * Envelope encryption per account, all from @krizaka/storage: the root key wraps each account's key (one per account, kept wrapped in
 * the keyring), which wraps a fresh data key per object (AES-256-GCM, the object's full name as associated data). The bucket only ever
 * holds ciphertext; a copy under another account's name does not open; shredding an account's key makes all of it unreadable.
 * @throws StorageError `STORAGE_BAD_SECRET_KEY` for a root key that is not 32 bytes (the message never carries it)
 */
export function ownerObjectsOf(installation: ObjectStore, deps: DocumentVaultDeps): OwnerObjects {
  const vault = installationVaultOf(deps);
  return {
    of: (ownerId) => tenantStore(installation, vault, accountTenantOf(ownerId)),
    shred: (ownerId) => vault.shredTenant(accountTenantOf(ownerId)),
  };
}
