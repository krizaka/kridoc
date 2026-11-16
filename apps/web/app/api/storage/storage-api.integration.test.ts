import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTestDatabase, endPool, type TestDatabase } from "@krizaka/db/testing";
import type { FetchLike } from "@krizaka/storage";
import { objectStoreContract } from "@krizaka/storage/testkit";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { connectionOf, pool } from "@/lib/db/connection";
import { integrationPools } from "@/lib/db/integration-pool";
import { migrateDatabase } from "@/lib/db/migrations";
import type { StorageScope } from "@/lib/storage/client-port";
import { kridocApiStore } from "@/lib/storage/kridoc-api-store";

import { storageApiRuntime } from "../../storage-api-edge";
import { GET as readLink, POST as signLink } from "./v1/links/[...key]/route";
import { DELETE as deleteOne, GET as readOne, HEAD as headOne, PUT as putOne } from "./v1/objects/[...key]/route";
import { GET as listObjects } from "./v1/objects/route";

/**
 * The storage API of the other products through its routes, on a real PostgreSQL (CI's service container; locally a throwaway one,
 * `DATABASE_URL=… pnpm test`) and the local adapter in a temporary folder. Never skipped: without DATABASE_URL the file fails.
 */
const url = process.env.DATABASE_URL;
const ORIGIN = "https://www.kridoc.com";
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
const PDF_SHA256 = createHash("sha256").update(PDF).digest("hex");
const PDF_DIGEST = `sha-256=:${Buffer.from(PDF_SHA256, "hex").toString("base64")}:`;
const ALL: StorageScope[] = ["put", "get", "delete", "sign"];

type KeyParams = { params: Promise<{ key: string[] }> };
type KeyHandler = (request: Request, params: KeyParams) => Promise<Response>;
const OBJECT: Record<string, KeyHandler> = { PUT: putOne, GET: readOne, HEAD: headOne, DELETE: deleteOne };
const LINK: Record<string, KeyHandler> = { POST: signLink, GET: readLink };

/** The routes as an HTTP server would call them: the path's segments decoded one by one, as Next does for `[...key]`. */
async function route(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/storage/v1/objects") return listObjects(request);
  const [, table, rest] = /^\/api\/storage\/v1\/(objects|links)\/(.+)$/.exec(pathname) ?? [];
  const handler = (table === "objects" ? OBJECT : LINK)[request.method];
  if (!handler || !rest) return new Response(null, { status: 405 });
  return handler(request, { params: Promise.resolve({ key: rest.split("/").map(decodeURIComponent) }) });
}

/** The `FetchLike` of the reference client over the routes, without a server. */
const routeFetch: FetchLike = async (target, init) => {
  const response = await route(
    new Request(target, {
      method: init.method,
      headers: init.headers,
      ...(init.body ? { body: init.body.slice() } : {}),
    }),
  );
  return response;
};

const bearer = (token: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` },
});
const objectUrl = (key: string) => `${ORIGIN}/api/storage/v1/objects/${key}`;

describe("the storage API for products through its routes (krizaka-internal#3756)", () => {
  const { poolOn, all } = integrationPools(url);
  let testDatabase: TestDatabase;
  let db: pg.Pool;
  let root: string;
  let tenants = 0;

  const issue = async (tenantId: string, scopes: StorageScope[] = ALL) =>
    storageApiRuntime().clients.issue({ product: "verikora", tenantId, scopes });

  beforeAll(async () => {
    testDatabase = await createTestDatabase({
      prefix: "kridoc_store_api",
      connect: (database) => connectionOf(poolOn(database)),
      migrate: async (open) => {
        await migrateDatabase(open);
      },
    });
    const target = new URL(url!);
    target.pathname = `/${testDatabase.name}`;
    root = await mkdtemp(join(tmpdir(), "kridoc-store-api-"));
    for (const [key, value] of Object.entries({
      MEDIA_STORAGE_ENABLED: "on",
      MEDIA_STORAGE_PROVIDER: "local",
      MEDIA_STORAGE_ROOT: root,
      MEDIA_DOCUMENTS_TENANT: "kridoc-test",
      DATABASE_ENABLED: "on",
      DATABASE_URL: target.toString(),
      MEDIA_VAULT_KEY: randomBytes(32).toString("base64"),
      APP_PUBLIC_URL: ORIGIN,
    }))
      vi.stubEnv(key, value);
    db = poolOn(testDatabase.name);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await endPool(pool({ DATABASE_URL: url }));
    for (const made of all()) await endPool(made);
    await testDatabase?.drop();
    await rm(root, { recursive: true, force: true });
  });

  it("keeps only the token's keyed hash, and refuses a product's tenant that is another's or an account's", async () => {
    const { token, client } = await issue("verikora-prod");
    const rows = await db.query("SELECT * FROM storage_client WHERE id = $1", [client.id]);
    expect(rows.rows).toHaveLength(1);
    expect(JSON.stringify(rows.rows)).not.toContain(token);
    expect(rows.rows[0].token_hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    for (const [product, tenant] of [
      ["verikora", "folioviv-prod"],
      ["verikora", "account-00000000-0000-4000-8000-000000000001"],
      ["account", "account-x"],
    ])
      await expect(
        db.query(
          "INSERT INTO storage_client (product, tenant_id, token_hash, scopes, created_at) VALUES ($1, $2, $3, '{get}', now())",
          [product, tenant, "h".repeat(43)],
        ),
      ).rejects.toThrow(/check constraint/);
  });

  it("gives a client its own tenant's objects only, sealed on disk", async () => {
    const mine = (await issue("verikora-a")).token;
    const theirs = (await issue("verikora-b")).token;
    const put = await route(
      new Request(
        objectUrl("docs/lease.pdf"),
        bearer(mine, { method: "PUT", body: PDF, headers: { "content-type": "application/pdf" } }),
      ),
    );
    expect(put.status).toBe(201);
    expect((await put.json()).object).toEqual({
      key: "docs/lease.pdf",
      size: PDF.byteLength,
      contentType: "application/pdf",
      sha256: PDF_SHA256,
    });
    expect(put.headers.get("repr-digest")).toBe(PDF_DIGEST);

    const own = await route(new Request(objectUrl("docs/lease.pdf"), bearer(mine)));
    expect(own.status).toBe(200);
    expect(own.headers.get("content-disposition")).toBe("attachment");
    expect(own.headers.get("x-content-type-options")).toBe("nosniff");
    expect([...new Uint8Array(await own.arrayBuffer())]).toEqual([...PDF]);
    expect(
      (await route(new Request(objectUrl("docs/lease.pdf"), bearer(mine, { method: "HEAD" })))).headers.get(
        "content-length",
      ),
    ).toBe(String(PDF.byteLength));

    const stolen = await route(new Request(objectUrl("docs/lease.pdf"), bearer(theirs)));
    expect(stolen.status).toBe(404);
    expect((await stolen.json()).code).toBe("STORAGE_OBJECT_NOT_FOUND");
    const listed = await route(new Request(`${ORIGIN}/api/storage/v1/objects?prefix=docs/`, bearer(theirs)));
    expect((await listed.json()).objects).toEqual([]);

    const sealed = await readFile(join(root, "kridoc-test", "t", "verikora-a", "docs", "lease.pdf"));
    expect(sealed.includes(Buffer.from("%PDF"))).toBe(false);
  });

  it("refuses a key outside the tenant, a type the settings refuse, a missing token and a revoked one", async () => {
    const { token, client } = await issue("verikora-c");
    const climb = await putOne(
      new Request(
        objectUrl("x"),
        bearer(token, { method: "PUT", body: PDF, headers: { "content-type": "application/pdf" } }),
      ),
      { params: Promise.resolve({ key: ["..", "verikora-a", "docs", "lease.pdf"] }) },
    );
    expect(climb.status).toBe(400);
    expect((await climb.json()).code).toBe("STORAGE_KEY_REFUSED");
    const html = await route(
      new Request(
        objectUrl("page.html"),
        bearer(token, { method: "PUT", body: "<html></html>", headers: { "content-type": "text/html" } }),
      ),
    );
    expect(html.status).toBe(415);

    const anonymous = await route(new Request(objectUrl("a.pdf")));
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("www-authenticate")).toContain("Bearer");
    expect(await storageApiRuntime().clients.revoke(client.id)).toBe(true);
    const revoked = await route(new Request(objectUrl("a.pdf"), bearer(token)));
    expect(revoked.status).toBe(401);
    expect((await revoked.json()).code).toBe("STORAGE_UNAUTHENTICATED");
  });

  it("hands out a signed link that opens one object for a few minutes, and refuses it once changed", async () => {
    const { token } = await issue("verikora-d");
    await route(
      new Request(
        objectUrl("a.pdf"),
        bearer(token, { method: "PUT", body: PDF, headers: { "content-type": "application/pdf" } }),
      ),
    );
    const signed = await route(
      new Request(
        `${ORIGIN}/api/storage/v1/links/a.pdf`,
        bearer(token, { method: "POST", body: JSON.stringify({ ttlSeconds: 60 }) }),
      ),
    );
    expect(signed.status).toBe(201);
    const { url: link } = await signed.json();
    expect(link).toMatch(/^https:\/\/www\.kridoc\.com\/api\/storage\/v1\/links\/a\.pdf\?client=/);
    expect(link).not.toContain(token);
    const opened = await route(new Request(link));
    expect([...new Uint8Array(await opened.arrayBuffer())]).toEqual([...PDF]);
    const changed = await route(new Request(link.replace("a.pdf", "b.pdf")));
    expect(changed.status).toBe(403);
    expect((await changed.json()).code).toBe("STORAGE_LINK_REFUSED");
    const bad = await route(
      new Request(`${ORIGIN}/api/storage/v1/links/a.pdf`, bearer(token, { method: "POST", body: "{" })),
    );
    expect(bad.status).toBe(400);
  });

  it("v1.1: refuses a wrong Repr-Digest, replays a create-only write, refuses another body, and answers a deletion record", async () => {
    const { token } = await issue("verikora-d");
    const put = (headers: Record<string, string>, body: Uint8Array<ArrayBuffer> = PDF.slice()) =>
      route(
        new Request(
          objectUrl("v/a.pdf"),
          bearer(token, { method: "PUT", body, headers: { "content-type": "application/pdf", ...headers } }),
        ),
      );
    const wrong = await put({ "repr-digest": `sha-256=:${Buffer.alloc(32).toString("base64")}:` });
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).code).toBe("STORAGE_DIGEST_MISMATCH");
    expect((await route(new Request(objectUrl("v/a.pdf"), bearer(token)))).status).toBe(404);

    const created = await put({ "repr-digest": PDF_DIGEST, "if-none-match": "*" });
    expect(created.status).toBe(201);
    expect(created.headers.get("idempotent-replayed")).toBeNull();
    const replay = await put({ "if-none-match": "*" });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect((await replay.json()).object.sha256).toBe(PDF_SHA256);
    const other = await put({ "if-none-match": "*" }, new TextEncoder().encode("%PDF-1.7\nother\n%%EOF\n"));
    expect(other.status).toBe(412);
    expect((await other.json()).code).toBe("STORAGE_OBJECT_EXISTS");

    const read = await route(new Request(objectUrl("v/a.pdf"), bearer(token)));
    expect(read.headers.get("repr-digest")).toBe(PDF_DIGEST);
    const removed = await route(new Request(objectUrl("v/a.pdf"), bearer(token, { method: "DELETE" })));
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({
      key: "v/a.pdf",
      sha256: PDF_SHA256,
      size: PDF.byteLength,
      recordId: expect.stringMatching(/^del_[0-9a-f]{24}$/),
    });
    const absent = await route(new Request(objectUrl("v/a.pdf"), bearer(token, { method: "DELETE" })));
    expect(await absent.json()).toEqual({ key: "v/a.pdf", absent: true });
  });

  // The contract shared with Verikora: the reference client over the routes passes the same `objectStoreContract` as every adapter.
  objectStoreContract("Kridoc's storage API (kridocApiStore over the routes)", async () => {
    tenants += 1;
    const { token } = await issue(`verikora-contract${tenants}`);
    return kridocApiStore({ endpoint: ORIGIN, token, fetch: routeFetch });
  });
});
