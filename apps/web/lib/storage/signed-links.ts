import { createHmac, timingSafeEqual } from "node:crypto";

/** What a link names: the client that signed it (its tenant follows), the object's key, and when it ends (seconds since 1970). */
export interface LinkClaim {
  clientId: string;
  key: string;
  expiresAt: number;
}

export interface SignedLinks {
  signatureOf(claim: LinkClaim): string;
  /** In constant time; `false` for anything that is not this claim's signature. */
  verify(claim: LinkClaim, signature: string): boolean;
}

// @fixed: the version of the signed text; a new layout is v2
const VERSION = "v1";

/**
 * Kridoc's own signed links: the bucket holds ciphertext (`tenantStore`), so a presigned bucket link would be useless; Kridoc signs a
 * link to itself, opens the object and serves it. Keyed by a secret of their own (`derivedSecretOf(root, SECRET_PURPOSE.signedLink)`).
 */
export function signedLinksOf(secret: Uint8Array): SignedLinks {
  const signatureOf = (claim: LinkClaim): string =>
    createHmac("sha256", secret)
      .update([VERSION, claim.clientId, String(claim.expiresAt), claim.key].join("\n"))
      .digest("base64url");
  return {
    signatureOf,
    verify(claim, signature) {
      const expected = Buffer.from(signatureOf(claim));
      const given = Buffer.from(signature);
      return given.length === expected.length && timingSafeEqual(given, expected);
    },
  };
}
