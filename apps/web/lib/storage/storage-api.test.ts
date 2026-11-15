import { randomBytes } from "node:crypto";

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
const LIMITS = { listMax: 100 };
const DEFAULT_RULES: StorageRules = {
  maxBytes: 64,
  types: ["application/pdf", "image/png", "application/octet-stream"],
  signedUrlSeconds: 300,
  retentionDays: 365,
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
      expect(await api.head(mine, "docs/lease.pdf")).toEqual({ key: "docs/lease.pdf", size: PDF.byteLength });

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
