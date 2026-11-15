import { hkdfSync } from "node:crypto";

/** What a secret derived from the root key is for: one key per purpose, so a token hash never verifies a link and back. */
export const SECRET_PURPOSE = {
  clientToken: "kridoc/storage-client-token/v1",
  signedLink: "kridoc/storage-signed-link/v1",
} as const;
export type SecretPurpose = (typeof SECRET_PURPOSE)[keyof typeof SECRET_PURPOSE];

// @fixed: an HMAC-SHA-256 key is 32 bytes
const KEY_BYTES = 32;

/**
 * A key of its own for one purpose, derived from the root key of the storage feature (`MEDIA_VAULT_KEY`, already required when the
 * feature is on) by HKDF-SHA-256: no second secret to hold. New root key material means new token hashes and links: reissue the tokens.
 */
export const derivedSecretOf = (root: Uint8Array, purpose: SecretPurpose): Uint8Array =>
  new Uint8Array(hkdfSync("sha256", root, new Uint8Array(0), purpose, KEY_BYTES));
