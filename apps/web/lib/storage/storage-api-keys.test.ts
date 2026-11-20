import { memoryApiKeyStore } from "@krizaka/api-keys";
import { describe, expect, it } from "vitest";

import { STORAGE_API_ERROR } from "./api-errors";
import { STORAGE_PRODUCT, STORAGE_SCOPE } from "./client-port";
import { clientTokensOf } from "./client-tokens";
import { memoryStorageClientStore } from "./memory-client-store";
import { createStorageApiKeys } from "./storage-api-keys";
import { createStorageClients } from "./storage-clients";

const HOUR = 3_600_000;
const PLAN = { maxActive: 2 };

async function setup() {
  let now = new Date("2026-11-20T12:00:00Z");
  const clock = { now: () => now };
  const clients = memoryStorageClientStore();
  const legacy = createStorageClients({
    store: clients,
    tokens: clientTokensOf(new Uint8Array(32).fill(7)),
    clock,
    audit: async () => {},
  });
  const api = createStorageApiKeys({
    store: memoryApiKeyStore(),
    clients,
    legacy,
    clock,
    rules: { env: "test", maxExpiryDays: 365, rotationGraceHours: 168, lastUsedEveryMinutes: 5 },
  });
  const { client, token } = await legacy.issue({
    product: STORAGE_PRODUCT.verikora,
    tenantId: "verikora-test",
    scopes: [STORAGE_SCOPE.put, STORAGE_SCOPE.get],
  });
  const advance = (ms: number) => {
    now = new Date(now.getTime() + ms);
  };
  const create = (scopes: string[], expiresInDays = 30) =>
    api.keys.create(client.id, { name: "k", scopes, expiresInDays }, PLAN);
  return { api, client, legacyToken: token, advance, clients, create };
}

const refused = (p: Promise<unknown>) =>
  expect(p).rejects.toMatchObject({ message: expect.stringContaining(STORAGE_API_ERROR.unauthenticated) });

describe("the products' keys", () => {
  it("issues a key `kdk_<env>_<publicId>_<secret>` that opens the API as its client", async () => {
    const { api, client, create } = await setup();
    const { key } = await create(["put"], 90);
    expect(key).toMatch(/^kdk_test_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
    expect((await api.authenticate(key, "put")).id).toBe(client.id);
  });

  it("refuses an expired key", async () => {
    const { api, advance, create } = await setup();
    const { key } = await create(["get"], 1);
    advance(25 * HOUR);
    await refused(api.authenticate(key, "get"));
  });

  it("refuses a scope the key does not carry", async () => {
    const { api, create } = await setup();
    const { key } = await create(["get"]);
    await refused(api.authenticate(key, "delete"));
  });

  it("keeps a rotated key working until the end of its grace, then stops it", async () => {
    const { api, client, advance, create } = await setup();
    const first = await create(["put"], 90);
    const second = await api.keys.rotate(client.id, first.record.id, PLAN);
    advance(167 * HOUR);
    expect((await api.authenticate(first.key, "put")).id).toBe(client.id);
    expect((await api.authenticate(second.key, "put")).id).toBe(client.id);
    advance(2 * HOUR);
    await refused(api.authenticate(first.key, "put"));
    expect((await api.authenticate(second.key, "put")).id).toBe(client.id);
  });

  it("moves lastUsedAt on use", async () => {
    const { api, client, advance, create } = await setup();
    const { key, record } = await create(["get"]);
    advance(HOUR);
    await api.authenticate(key, "get");
    const stored = (await api.keys.list(client.id)).find((r) => r.id === record.id);
    expect(stored?.lastUsedAt).toEqual(new Date("2026-11-20T13:00:00Z"));
  });

  it("refuses a revoked key at once, and the key of a revoked client", async () => {
    const { api, client, clients, create } = await setup();
    const a = await create(["get"]);
    const b = await create(["get"]);
    await api.keys.revoke(client.id, a.record.id);
    await refused(api.authenticate(a.key, "get"));
    await clients.revoke(client.id, new Date("2026-11-20T12:30:00Z"));
    await refused(api.authenticate(b.key, "get"));
  });

  it("still accepts a `kst1.` token during the switch, and refuses a garbage token", async () => {
    const { api, client, legacyToken } = await setup();
    expect((await api.authenticate(legacyToken, "put")).id).toBe(client.id);
    await refused(api.authenticate("kdk_test_nope", "put"));
    await refused(api.authenticate(undefined, "put"));
  });
});
