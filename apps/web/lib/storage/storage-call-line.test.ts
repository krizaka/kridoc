import { describe, expect, it } from "vitest";

import { callLineOf, keyHashOf } from "./storage-audit";

const call = {
  at: new Date("2026-11-20T12:00:00Z"),
  requestId: "req-1",
  client: { id: "cli_1", tenantId: "verikora-prod" },
  method: "put",
  route: "objects",
  key: "documents/3f2a/v1",
  status: 201,
  ms: 812.4,
  size: 10_485_760,
  digest: "sha-256=:AAAA:",
};

describe("the line one storage API call leaves", () => {
  it("carries time, request, client, tenant, operation, key hash, size, digest, status and duration", () => {
    expect(JSON.parse(callLineOf(call))).toEqual({
      kind: "storage.call",
      at: "2026-11-20T12:00:00.000Z",
      requestId: "req-1",
      client: "cli_1",
      tenant: "verikora-prod",
      operation: "PUT objects",
      keyHash: keyHashOf("documents/3f2a/v1"),
      size: 10_485_760,
      digest: "sha-256=:AAAA:",
      status: 201,
      ms: 812,
    });
  });

  it("never holds the key, a token or a byte, and is one line", () => {
    const line = callLineOf({ ...call, key: "documents/3f2a/v1" });
    expect(line).not.toContain("documents/3f2a");
    expect(line).not.toMatch(/kst1\.|Bearer/);
    expect(line).not.toContain("\n");
  });

  it("is still a line when the token was refused: no client, no key", () => {
    expect(JSON.parse(callLineOf({ ...call, client: undefined, key: undefined, status: 401 }))).toMatchObject({
      client: null,
      tenant: null,
      keyHash: null,
      status: 401,
    });
  });
});
