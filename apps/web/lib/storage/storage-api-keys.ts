import { type ApiKeyRules, type ApiKeys, type ApiKeyStore, type Clock, createApiKeys } from "@krizaka/api-keys";

import { STORAGE_API_ERROR, StorageApiError } from "./api-errors";
import { STORAGE_SCOPE, type StorageClient, type StorageClientStore, type StorageScope } from "./client-port";
import type { StorageClients } from "./storage-clients";

// @fixed: the length of a key's random part in bytes (256 bits, like the `kst1.` tokens)
const SECRET_BYTES = 32;
// @fixed: the environment written in a key's prefix: `kdk_<env>_<publicId>_<secret>`
const ENV = /^[a-z]{2,8}$/;

export interface StorageKeyRules {
  /** The environment written in the prefix (`prod`, `test`): a key of another environment is not recognised. */
  env: string;
  /** Settings: the longest a key may live, how long a rotated key still works, how often « last use » is written. */
  maxExpiryDays: number;
  rotationGraceHours: number;
  lastUsedEveryMinutes: number;
}

export interface StorageApiKeysDeps {
  store: ApiKeyStore;
  clients: StorageClientStore;
  /** The `kst1.` tokens, accepted while the switch lasts. */
  legacy: StorageClients;
  rules: StorageKeyRules;
  clock: Clock;
}

export interface StorageApiKeys {
  /** Issue, rotate, revoke and list: a key's owner is the id of its storage client. */
  keys: ApiKeys;
  /**
   * The client of a bearer token: a `kdk_<env>_…` key (checked for the scope, its expiry and its grace) or a `kst1.` token.
   * @throws StorageApiError `STORAGE_UNAUTHENTICATED` for anything else, all refusals alike
   */
  authenticate(token: string | undefined, scope: StorageScope): Promise<StorageClient>;
}

const rulesOf = (rules: StorageKeyRules): ApiKeyRules => ({
  prefix: `kdk_${rules.env}`,
  scopes: Object.values(STORAGE_SCOPE),
  secretBytes: SECRET_BYTES,
  maxExpiryDays: rules.maxExpiryDays,
  rotationGraceHours: rules.rotationGraceHours,
  lastUsedEveryMinutes: rules.lastUsedEveryMinutes,
});

/** The products' keys on @krizaka/api-keys, owned by a storage client; the old tokens still open the API until they are reissued. */
export function createStorageApiKeys(deps: StorageApiKeysDeps): StorageApiKeys {
  if (!ENV.test(deps.rules.env)) throw new Error("storage key environment: 2 to 8 lowercase letters");
  const keys = createApiKeys({ store: deps.store, rules: rulesOf(deps.rules), clock: deps.clock });
  const prefix = `kdk_${deps.rules.env}_`;
  return {
    keys,
    async authenticate(token, scope) {
      if (!token?.startsWith(prefix)) return deps.legacy.authenticate(token);
      const result = await keys.authenticate(`Bearer ${token}`, scope);
      const client = result.ok ? await deps.clients.findActive(result.key.ownerId) : null;
      if (!client) throw new StorageApiError(STORAGE_API_ERROR.unauthenticated);
      return client;
    },
  };
}
