import { createHmac } from "node:crypto";

import { isLinkToken, linkToken } from "@krizaka/auth";

// @fixed: the letters of Kridoc's storage tokens (`kst1.<43 characters>`, 256 random bits)
const TOKEN_PREFIX = "kst";

export interface ClientTokens {
  /** A fresh token, `kst1.<43>`: shown once, never stored. */
  newToken(): string;
  isToken(value: string | undefined): value is string;
  /** The keyed hash the table keeps (HMAC-SHA-256, base64url): a leaked table opens nothing. */
  hashOf(token: string): string;
}

/** The tokens of the products' clients, keyed by a secret of their own (`derivedSecretOf(root, SECRET_PURPOSE.clientToken)`). */
export function clientTokensOf(secret: Uint8Array): ClientTokens {
  return {
    newToken: () => linkToken(TOKEN_PREFIX),
    isToken: (value): value is string => isLinkToken(TOKEN_PREFIX, value),
    hashOf: (token) => createHmac("sha256", secret).update(token).digest("base64url"),
  };
}
