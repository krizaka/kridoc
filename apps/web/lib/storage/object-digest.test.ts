import { describe, expect, it } from "vitest";

import { declaredSha256, reprDigestOf, sha256Of } from "./object-digest";

const HEX = sha256Of(new TextEncoder().encode("abc"));

describe("Repr-Digest (RFC 9530)", () => {
  it("round-trips a sha-256", () => {
    expect(HEX).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(reprDigestOf(HEX)).toBe("sha-256=:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=:");
    expect(declaredSha256(reprDigestOf(HEX))).toBe(HEX);
  });

  it("ignores an absent header or another algorithm, refuses a malformed sha-256", () => {
    expect(declaredSha256(null)).toBeUndefined();
    expect(declaredSha256("sha-512=:AAAA:")).toBeUndefined();
    expect(declaredSha256(`sha-512=:AAAA:, ${reprDigestOf(HEX)}`)).toBe(HEX);
    expect(() => declaredSha256("sha-256=:short:")).toThrow();
    expect(() => declaredSha256("sha-256=abc")).toThrow();
  });
});
