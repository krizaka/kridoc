import { createHash, randomBytes } from "node:crypto";

import { createLimiter, memoryLimitStore, RateLimited } from "@krizaka/rate-limit";
import {
  memoryKeyService,
  memoryObjectStore,
  memoryTenantKeyStore,
  type ObjectStore,
  tenantStore,
  tenantVault,
} from "@krizaka/storage";
import { beforeEach, describe, expect, it } from "vitest";

import { STORAGE_API_ERROR } from "./api-errors";
import type { StorageScope } from "./client-port";
import { clientTokensOf } from "./client-tokens";
import { memoryStorageClientStore } from "./memory-client-store";
import { signedLinksOf } from "./signed-links";
import { createStorageApi, STORAGE_API_ACTION, type StorageApi } from "./storage-api";
import type { StorageAuditLine } from "./storage-audit";
import { createStorageClients, type StorageClients } from "./storage-clients";
import type { StorageRules } from "./storage-settings";

const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const PDF_SHA256 = createHash("sha256").update(PDF).digest("hex");
const LIMITS = { listMax: 100 };
const DEFAULT_RULES: StorageRules = {
  maxBytes: 64,
  types: ["application/pdf", "image/png", "application/octet-stream"],
  signedUrlSeconds: 300,
  retentionDays: 365,
  quotaBytes: 10_000,
  quotaObjects: 100,
};
let rules: StorageRules = DEFAULT_RULES;

describe("the storage API for products (krizaka-internal#3756)", () => {
  let now: Date;
  let clients: StorageClients;
  let api: StorageApi;
  let inner: ObjectStore;
  let audit: StorageAuditLine[];
  let rate = { perSubject: 1000, windowSeconds: 60 };
  const clock = { now: () => now };

  const build = () => {
    const secret = randomBytes(32);
    const vault = tenantVault({
      kms: memoryKeyService({ name: "test", root: randomBytes(32) }),
      keys: memoryTenantKeyStore(),
      clock,
      audit: async () => {},
    });
    const record = async (line: StorageAuditLine) => {
      audit.push(line);
    };
    clients = createStorageClients({
      store: memoryStorageClientStore(),
      tokens: clientTokensOf(secret),
      clock,
      audit: record,
    });
    api = createStorageApi({
      clients,
      objectsOf: (tenantId) => tenantStore(inner, vault, tenantId),
      limiter: createLimiter({ store: memoryLimitStore(), clock, limits: { [STORAGE_API_ACTION]: rate } }),
      links: signedLinksOf(randomBytes(32)),
      clock,
      audit: record,
      limits: LIMITS,
      rules: async () => rules,
    });
  };

  beforeEach(() => {
    rules = DEFAULT_RULES;
    now = new Date("2026-11-15T12:00:00Z");
    inner = memoryObjectStore();
    audit = [];
    rate = { perSubject: 1000, windowSeconds: 60 };
    build();
  });

  const issue = (tenantId = "verikora-prod", scopes: readonly StorageScope[] = ["put", "get", "delete", "sign"]) =>
    clients.issue({ product: "verikora", tenantId, scopes: [...scopes] });

  describe("tokens", () => {
    it("are `kst1.` and random, shown once: only a keyed hash is kept", async () => {
      const { token, client } = await issue();
      expect(token).toMatch(/^kst1\.[A-Za-z0-9_-]{43}$/);
      expect(client).not.toHaveProperty("tokenHash");
      expect(JSON.stringify(client)).not.toContain(token);
      expect((await api.authenticate(token)).id).toBe(client.id);
      expect(JSON.stringify(audit)).not.toContain(token);
      expect(audit.map((l) => l.action)).toContain("storage.client.issued");
    });

    it("refuses a missing, malformed, unknown or revoked token alike", async () => {
      const { token, client } = await issue();
      for (const bad of [undefined, "", "kst1.short", `kd1.${"a".repeat(43)}`, `kst1.${"a".repeat(43)}`])
        await expect(api.authenticate(bad)).rejects.toMatchObject({ code: STORAGE_API_ERROR.unauthenticated });
      expect(await clients.revoke(client.id)).toBe(true);
      await expect(api.authenticate(token)).rejects.toMatchObject({ code: STORAGE_API_ERROR.unauthenticated });
      expect(audit.map((l) => l.action)).toContain("storage.client.revoked");
    });

    it("are issued only to a known product, for a tenant of its own, never an account's, with at least one scope", async () => {
      await expect(
        clients.issue({ product: "other" as "verikora", tenantId: "other-prod", scopes: ["get"] }),
      ).rejects.toMatchObject({
        code: STORAGE_API_ERROR.invalidInput,
      });
      for (const tenantId of ["folioviv-prod", "account-x", "verikora-", "verikora prod", "verikora-../x"])
        await expect(clients.issue({ product: "verikora", tenantId, scopes: ["get"] })).rejects.toMatchObject({
          code: STORAGE_API_ERROR.invalidInput,
        });
      await expect(clients.issue({ product: "verikora", tenantId: "verikora-prod", scopes: [] })).rejects.toMatchObject(
        {
          code: STORAGE_API_ERROR.invalidInput,
        },
      );
      await expect(
        clients.issue({ product: "verikora", tenantId: "verikora-prod", scopes: ["admin" as "get"] }),
      ).rejects.toMatchObject({ code: STORAGE_API_ERROR.invalidInput });
    });
  });

  describe("objects", () => {
    it("are kept for the client's own tenant only, sealed: another tenant reaches nothing", async () => {
      const mine = await api.authenticate((await issue("verikora-prod")).token);
      const theirs = await api.authenticate((await issue("verikora-dev")).token);
      await api.put(mine, "docs/lease.pdf", PDF, "application/pdf");

      const got = await api.get(mine, "docs/lease.pdf");
      expect([...got.bytes]).toEqual([...PDF]);
      expect(got.contentType).toBe("application/pdf");
      expect(await api.head(mine, "docs/lease.pdf")).toEqual({
        key: "docs/lease.pdf",
        size: PDF.byteLength,
        sha256: PDF_SHA256,
      });

      await expect(api.get(theirs, "docs/lease.pdf")).rejects.toMatchObject({ code: STORAGE_API_ERROR.notFound });
      await expect(api.head(theirs, "docs/lease.pdf")).rejects.toMatchObject({ code: STORAGE_API_ERROR.notFound });
      expect((await api.list(theirs, "")).objects).toEqual([]);
      await api.remove(theirs, "docs/lease.pdf");
      expect((await api.get(mine, "docs/lease.pdf")).bytes.byteLength).toBe(PDF.byteLength);

      const stored = await inner.list("");
      expect(stored.map((o) => o.key)).toEqual(["t/verikora-prod/docs/lease.pdf"]);
      const raw = await inner.get("t/verikora-prod/docs/lease.pdf");
      expect(Buffer.from(raw!.bytes).includes(Buffer.from("%PDF"))).toBe(false);
    });

    it("refuses a key that climbs out of the tenant or names another", async () => {
      const mine = await api.authenticate((await issue()).token);
      for (const key of ["../verikora-dev/x.pdf", "a/../../b.pdf", "/abs.pdf", "a//b.pdf", "", "a\\b.pdf", "a/b/"])
        await expect(api.put(mine, key, PDF, "application/pdf")).rejects.toMatchObject({
          code: STORAGE_API_ERROR.keyRefused,
        });
      for (const prefix of ["../", "a/../../", "a\\"])
        await expect(api.list(mine, prefix)).rejects.toMatchObject({ code: STORAGE_API_ERROR.keyRefused });
      // A key that looks like another tenant's path is only a name inside this tenant.
      await api.put(mine, "t/verikora-dev/x.pdf", PDF, "application/pdf");
      expect((await inner.list("")).map((o) => o.key)).toEqual(["t/verikora-prod/t/verikora-dev/x.pdf"]);
    });

    it("refuses an oversize object and a type the settings do not accept or the bytes contradict", async () => {
      const mine = await api.authenticate((await issue()).token);
      await expect(api.put(mine, "big.bin", new Uint8Array(65), "application/octet-stream")).rejects.toMatchObject({
        code: STORAGE_API_ERROR.tooBig,
      });
      await expect(api.put(mine, "empty.bin", new Uint8Array(0), "application/octet-stream")).rejects.toMatchObject({
        code: STORAGE_API_ERROR.tooBig,
      });
      await expect(api.put(mine, "page.html", PDF, "text/html")).rejects.toMatchObject({
        code: STORAGE_API_ERROR.typeRefused,
      });
      await expect(api.put(mine, "fake.pdf", PNG, "application/pdf")).rejects.toMatchObject({
        code: STORAGE_API_ERROR.typeRefused,
      });
      await expect(api.put(mine, "hidden.bin", PDF, "application/octet-stream")).rejects.toMatchObject({
        code: STORAGE_API_ERROR.typeRefused,
      });
      // A product's own ciphertext: opaque bytes, declared as such.
      await api.put(mine, "sealed.bin", new Uint8Array([1, 2, 3]), "application/octet-stream");
    });

    it("refuses what the token's scopes do not allow", async () => {
      const reader = await api.authenticate((await issue("verikora-prod", ["get"])).token);
      await expect(api.put(reader, "a.pdf", PDF, "application/pdf")).rejects.toMatchObject({
        code: STORAGE_API_ERROR.scopeRefused,
      });
      await expect(api.remove(reader, "a.pdf")).rejects.toMatchObject({ code: STORAGE_API_ERROR.scopeRefused });
      await expect(api.sign(reader, "a.pdf")).rejects.toMatchObject({ code: STORAGE_API_ERROR.scopeRefused });
      expect((await api.list(reader, "")).objects).toEqual([]);
    });

    it("lists the tenant's objects under a prefix, at most the settings' bound", async () => {
      const mine = await api.authenticate((await issue()).token);
      for (const key of ["a/one.pdf", "a/b/two.pdf", "other/three.pdf"])
        await api.put(mine, key, PDF, "application/pdf");
      expect((await api.list(mine, "a/")).objects.map((o) => o.key)).toEqual(["a/b/two.pdf", "a/one.pdf"]);
      expect((await api.list(mine, "a/")).truncated).toBe(false);
    });

    it("audits each act by client and tenant, never by the key's words", async () => {
      const { token, client } = await issue();
      const mine = await api.authenticate(token);
      await api.put(mine, "secret-name/lease.pdf", PDF, "application/pdf");
      await api.get(mine, "secret-name/lease.pdf");
      await api.remove(mine, "secret-name/lease.pdf");
      const lines = audit.filter((l) => /^storage\.(uploaded|read|deleted)$/.test(l.action));
      expect(lines.map((l) => l.action)).toEqual(["storage.uploaded", "storage.read", "storage.deleted"]);
      expect(
        lines.every((l) => l.actor.id === client.id && l.actor.kind === "client" && l.tenantId === "verikora-prod"),
      ).toBe(true);
      expect(JSON.stringify(audit)).not.toContain("secret-name");
    });
  });

  describe("v1.1 second half: pages, ping, usage, quota, atomic create-only (krizaka-internal#4041)", () => {
    const putMany = async (client: Awaited<ReturnType<typeof issue>>["client"], keys: string[]) => {
      for (const key of keys) await api.put(client, key, PDF, "application/pdf");
    };

    it("lists in pages: `after` is the last key seen, `next` is null on the last page, `truncated` is kept", async () => {
      const { client } = await issue();
      await putMany(client, ["p/a.pdf", "p/b.pdf", "p/c.pdf", "p/d.pdf", "p/e.pdf"]);
      const first = await api.list(client, "p/", { limit: 2 });
      expect(first.objects.map((o) => o.key)).toEqual(["p/a.pdf", "p/b.pdf"]);
      expect(first).toMatchObject({ next: "p/b.pdf", truncated: true });
      const second = await api.list(client, "p/", { limit: 2, after: first.next! });
      expect(second.objects.map((o) => o.key)).toEqual(["p/c.pdf", "p/d.pdf"]);
      const last = await api.list(client, "p/", { limit: 2, after: second.next! });
      expect(last.objects.map((o) => o.key)).toEqual(["p/e.pdf"]);
      expect(last).toMatchObject({ next: null, truncated: false });
      // no limit: the settings' bound; a limit above it is capped
      expect((await api.list(client, "p/", { limit: 10_000 })).objects).toHaveLength(5);
    });

    it("refuses a limit that is not a positive whole number, and an `after` that is not a key", async () => {
      const { client } = await issue();
      for (const limit of [0, -1, 1.5, Number.NaN])
        await expect(api.list(client, "", { limit })).rejects.toMatchObject({ code: STORAGE_API_ERROR.invalidInput });
      await expect(api.list(client, "", { after: "../x" })).rejects.toMatchObject({
        code: STORAGE_API_ERROR.keyRefused,
      });
    });

    it("ping tells the tenant, the scopes, the key's expiry (none yet) and the API version", async () => {
      const { client } = await issue("verikora-prod", ["get"]);
      expect(api.ping(client)).toEqual({
        tenant: "verikora-prod",
        scopes: ["get"],
        keyExpiresAt: null,
        api: "1.1.0",
      });
    });

    it("usage counts the tenant's bytes and objects and says the quota (the settings', never a constant)", async () => {
      const { client } = await issue();
      const other = (await issue("verikora-dev")).client;
      await putMany(client, ["u/a.pdf", "u/b.pdf"]);
      await putMany(other, ["u/c.pdf"]);
      // the bytes are what the store holds for the tenant (sealed: what `list` reports as sizes)
      const held = (await api.list(client, "")).objects.reduce((sum, o) => sum + o.size, 0);
      expect(held).toBeGreaterThanOrEqual(2 * PDF.byteLength);
      expect(await api.usage(client)).toEqual({
        bytes: held,
        objects: 2,
        quota: { bytes: 10_000, objects: 100 },
      });
      rules = { ...rules, quotaBytes: 777, quotaObjects: 5 };
      expect((await api.usage(client)).quota).toEqual({ bytes: 777, objects: 5 });
    });

    it("refuses a write past the object quota before any byte is kept; replacing a key is not a new object", async () => {
      rules = { ...rules, quotaObjects: 2 };
      const { client } = await issue();
      await putMany(client, ["q/a.pdf", "q/b.pdf"]);
      const before = await inner.list("");
      await expect(api.put(client, "q/c.pdf", PDF, "application/pdf")).rejects.toMatchObject({
        code: STORAGE_API_ERROR.quotaExceeded,
      });
      expect(await inner.list("")).toEqual(before);
      await expect(api.put(client, "q/a.pdf", PDF, "application/pdf")).resolves.toMatchObject({ key: "q/a.pdf" });
    });

    it("refuses a write past the byte quota (replacing counts only the difference), and another tenant is not counted", async () => {
      const { client } = await issue();
      await putMany(client, ["q/a.pdf", "q/b.pdf"]);
      const held = (await api.usage(client)).bytes;
      rules = { ...rules, quotaBytes: held };
      await putMany((await issue("verikora-dev")).client, ["z/a.pdf"]);
      await expect(api.put(client, "q/c.pdf", PDF, "application/pdf")).rejects.toMatchObject({
        code: STORAGE_API_ERROR.quotaExceeded,
      });
      await expect(api.put(client, "q/a.pdf", PDF, "application/pdf")).resolves.toBeDefined();
    });

    it("a create-only replay is answered even when the tenant is at its quota (nothing is written)", async () => {
      rules = { ...rules, quotaObjects: 1 };
      const { client } = await issue();
      await api.put(client, "r/a.pdf", PDF, "application/pdf", { createOnly: true });
      await expect(api.put(client, "r/a.pdf", PDF, "application/pdf", { createOnly: true })).resolves.toMatchObject({
        replayed: true,
      });
    });

    it("create-only is atomic: two concurrent writes of one key with different bytes, exactly one wins and the other is 412", async () => {
      const { client } = await issue();
      for (let round = 0; round < 20; round++) {
        const key = `race/${round}.bin`;
        const a = new Uint8Array([1, 2, 3, round]);
        const b = new Uint8Array([4, 5, 6, round]);
        const outcomes = await Promise.allSettled([
          api.put(client, key, a, "application/octet-stream", { createOnly: true }),
          api.put(client, key, b, "application/octet-stream", { createOnly: true }),
        ]);
        const won = outcomes.filter((o) => o.status === "fulfilled");
        const lost = outcomes.filter((o) => o.status === "rejected");
        expect(won, `round ${round}`).toHaveLength(1);
        expect(lost[0]).toMatchObject({ reason: { code: STORAGE_API_ERROR.objectExists } });
        const kept = await api.get(client, key);
        expect([...kept.bytes]).toEqual([...(outcomes[0]!.status === "fulfilled" ? a : b)]);
      }
    });
  });

  describe("v1.1: digest, create-only and the deletion record (krizaka-internal#4041)", () => {
    const wrong = "0".repeat(64);

    it("keeps the digest of what it received and returns it on put, get and head", async () => {
      const mine = await api.authenticate((await issue()).token);
      const stored = await api.put(mine, "d/a.pdf", PDF, "application/pdf", { sha256: PDF_SHA256 });
      expect(stored).toMatchObject({ sha256: PDF_SHA256, size: PDF.byteLength, replayed: false });
      expect((await api.get(mine, "d/a.pdf")).sha256).toBe(PDF_SHA256);
      expect((await api.head(mine, "d/a.pdf")).sha256).toBe(PDF_SHA256);
      expect((await api.put(mine, "d/b.pdf", PDF, "application/pdf")).sha256).toBe(PDF_SHA256);
    });

    it("refuses a wrong digest and writes nothing", async () => {
      const mine = await api.authenticate((await issue()).token);
      await expect(api.put(mine, "d/a.pdf", PDF, "application/pdf", { sha256: wrong })).rejects.toMatchObject({
        code: STORAGE_API_ERROR.digestMismatch,
      });
      expect(await inner.list("")).toEqual([]);
    });

    it("create-only: the same key with the same digest is a replay, another digest is refused, a free key is created", async () => {
      const mine = await api.authenticate((await issue()).token);
      const first = await api.put(mine, "d/a.pdf", PDF, "application/pdf", { createOnly: true });
      expect(first.replayed).toBe(false);
      const again = await api.put(mine, "d/a.pdf", PDF, "application/pdf", { createOnly: true, sha256: PDF_SHA256 });
      expect(again).toMatchObject({ replayed: true, sha256: PDF_SHA256, key: "d/a.pdf" });
      await expect(api.put(mine, "d/a.pdf", PNG, "image/png", { createOnly: true })).rejects.toMatchObject({
        code: STORAGE_API_ERROR.objectExists,
      });
      expect([...(await api.get(mine, "d/a.pdf")).bytes]).toEqual([...PDF]);
      // without create-only, v1 behaviour: the key is replaced
      await api.put(mine, "d/a.pdf", PNG, "image/png");
      expect((await api.get(mine, "d/a.pdf")).contentType).toBe("image/png");
    });

    it("deletes with a record: key, time, digest, size and an id; the ledger line carries no key", async () => {
      const mine = await api.authenticate((await issue()).token);
      await api.put(mine, "secret-name/a.pdf", PDF, "application/pdf");
      const record = await api.remove(mine, "secret-name/a.pdf");
      expect(record).toMatchObject({
        key: "secret-name/a.pdf",
        deletedAt: now.toISOString(),
        sha256: PDF_SHA256,
        size: PDF.byteLength,
      });
      expect(record).toHaveProperty("recordId");
      const line = audit.find((l) => l.action === "storage.deleted");
      expect(line?.detail).toMatchObject({ recordId: (record as { recordId: string }).recordId, sha256: PDF_SHA256 });
      expect(JSON.stringify(audit)).not.toContain("secret-name");
      expect(await inner.list("")).toEqual([]);
    });

    it("deleting a missing key says it is absent and is not an error", async () => {
      const mine = await api.authenticate((await issue()).token);
      expect(await api.remove(mine, "d/none.pdf")).toEqual({ key: "d/none.pdf", absent: true });
    });
  });

  describe("the administrator's rules", () => {
    it("apply to the next upload and the next link, without a restart", async () => {
      const mine = await api.authenticate((await issue()).token);
      await api.put(mine, "a/one.pdf", PDF, "application/pdf");

      rules = { ...rules, maxBytes: PDF.byteLength - 1 };
      await expect(api.put(mine, "a/two.pdf", PDF, "application/pdf")).rejects.toMatchObject({
        code: STORAGE_API_ERROR.tooBig,
      });

      rules = { ...rules, maxBytes: 64, types: ["image/png"] };
      await expect(api.put(mine, "a/three.pdf", PDF, "application/pdf")).rejects.toMatchObject({
        code: STORAGE_API_ERROR.typeRefused,
      });

      rules = { ...rules, signedUrlSeconds: 60 };
      const link = await api.sign(mine, "a/one.pdf", 10_000);
      expect(link.expiresAt).toEqual(new Date(now.getTime() + 60_000));
    });

    it("fail closed: when the rules cannot be read, nothing is stored", async () => {
      const mine = await api.authenticate((await issue()).token);
      rules = undefined as never;
      await expect(api.put(mine, "a/one.pdf", PDF, "application/pdf")).rejects.toThrow();
      expect(await api.head(mine, "a/one.pdf").catch((e: unknown) => e)).toMatchObject({
        code: STORAGE_API_ERROR.notFound,
      });
    });
  });

  describe("signed links", () => {
    it("open one object of the tenant until they expire, at most the settings' lifetime", async () => {
      const mine = await api.authenticate((await issue()).token);
      await api.put(mine, "docs/lease.pdf", PDF, "application/pdf");
      const link = await api.sign(mine, "docs/lease.pdf", 10_000);
      expect(link.expiresAt).toEqual(new Date(now.getTime() + 300_000));
      expect([...(await api.readLink(link.query)).bytes]).toEqual([...PDF]);
      expect(audit.map((l) => l.action)).toContain("storage.object.signed");

      now = new Date(now.getTime() + 301_000);
      await expect(api.readLink(link.query)).rejects.toMatchObject({ code: STORAGE_API_ERROR.linkRefused });
    });

    it("are refused when changed, when the client is revoked, or for a missing object", async () => {
      const { token, client } = await issue();
      const mine = await api.authenticate(token);
      await api.put(mine, "a.pdf", PDF, "application/pdf");
      await api.put(mine, "b.pdf", PDF, "application/pdf");
      const link = await api.sign(mine, "a.pdf", 60);
      for (const changed of [
        { ...link.query, key: "b.pdf" },
        { ...link.query, expires: String(Number(link.query.expires) + 1) },
        { ...link.query, signature: "x".repeat(43) },
        { ...link.query, client: "00000000-0000-4000-8000-000000000000" },
        { ...link.query, expires: "soon" },
      ])
        await expect(api.readLink(changed)).rejects.toMatchObject({ code: STORAGE_API_ERROR.linkRefused });

      const missing = await api.sign(mine, "gone.pdf", 60);
      await expect(api.readLink(missing.query)).rejects.toMatchObject({ code: STORAGE_API_ERROR.notFound });

      await clients.revoke(client.id);
      await expect(api.readLink(link.query)).rejects.toMatchObject({ code: STORAGE_API_ERROR.linkRefused });
    });
  });

  it("limits each client's requests (the settings' window), not its neighbour's", async () => {
    rate = { perSubject: 2, windowSeconds: 60 };
    build();
    const a = (await issue("verikora-prod")).token;
    const b = (await issue("verikora-dev")).token;
    await api.authenticate(a);
    await api.authenticate(a);
    await expect(api.authenticate(a)).rejects.toBeInstanceOf(RateLimited);
    await api.authenticate(b);
    now = new Date(now.getTime() + 61_000);
    await api.authenticate(a);
  });
});
