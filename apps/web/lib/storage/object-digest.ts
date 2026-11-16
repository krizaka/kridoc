import { createHash } from "node:crypto";

import { STORAGE_API_ERROR, StorageApiError } from "./api-errors";

/** The SHA-256 of an object's bytes, in hex: how the service names a digest. */
export const sha256Of = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const SHA256_MEMBER = /^sha-256=:([A-Za-z0-9+/]{43}=):$/;

/** The `Repr-Digest` header value (RFC 9530) of a hex SHA-256: `sha-256=:<base64>:`. */
export const reprDigestOf = (sha256: string): string => `sha-256=:${Buffer.from(sha256, "hex").toString("base64")}:`;

/**
 * The hex SHA-256 a `Repr-Digest` header declares, `undefined` when the header is absent or names no sha-256 member (other algorithms are
 * ignored). @throws StorageApiError `STORAGE_INVALID_INPUT` when a sha-256 member is malformed
 */
export function declaredSha256(header: string | null): string | undefined {
  const member = header
    ?.split(",")
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith("sha-256="));
  if (member === undefined) return undefined;
  const match = SHA256_MEMBER.exec(member);
  if (!match) throw new StorageApiError(STORAGE_API_ERROR.invalidInput);
  return Buffer.from(match[1]!, "base64").toString("hex");
}
