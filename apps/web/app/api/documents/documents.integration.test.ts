import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTestDatabase, endPool, type TestDatabase } from "@krizaka/db/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { systemClock } from "@/app/system-clock";
import { createAccountSessions } from "@/lib/auth/account-sessions";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";
import { connectionOf, pool } from "@/lib/db/connection";
import { integrationPools } from "@/lib/db/integration-pool";
import { migrateDatabase } from "@/lib/db/migrations";
import { accountTenantOf } from "@/lib/storage/document-vault";

import { documentsRuntime } from "../../documents-edge";
import { DELETE as deleteOne, GET as readOne } from "./[id]/route";
import { GET as list, POST as upload } from "./route";

/**
 * The documents journey through the routes, on a real PostgreSQL (CI's service container; locally a throwaway one,
 * `DATABASE_URL=… pnpm test`) and the local adapter in a temporary folder. Never skipped: without DATABASE_URL the file fails.
 */
const url = process.env.DATABASE_URL;
const SECRET = "d".repeat(32);
const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n");
const BASE = "https://www.kridoc.com/api/documents";

describe("Kridoc's documents through the routes", () => {
  const { poolOn, all } = integrationPools(url);
  let testDatabase: TestDatabase;
  let root: string;
  const cookie: Record<string, string> = {};

  const as = (who: string | null, init: RequestInit = {}) =>
    who ? { ...init, headers: { cookie: `${SESSION_COOKIE}=${cookie[who]}` } } : init;
  const idOf = (id: string) => ({ params: Promise.resolve({ id }) });

  beforeAll(async () => {
    testDatabase = await createTestDatabase({
      prefix: "kridoc_docs",
      connect: (database) => connectionOf(poolOn(database)),
      migrate: async (open) => {
        await migrateDatabase(open);
      },
    });
    const target = new URL(url!);
    target.pathname = `/${testDatabase.name}`;
    root = await mkdtemp(join(tmpdir(), "kridoc-journey-"));
    for (const [key, value] of Object.entries({
      MEDIA_STORAGE_ENABLED: "on",
      MEDIA_STORAGE_PROVIDER: "local",
      MEDIA_STORAGE_ROOT: root,
      MEDIA_DOCUMENTS_TENANT: "kridoc-test",
      AUTH_ENABLED: "on",
      DATABASE_ENABLED: "on",
      DATABASE_URL: target.toString(),
      AUTH_SESSION_SECRET: SECRET,
      MEDIA_VAULT_KEY: randomBytes(32).toString("base64"),
    }))
      vi.stubEnv(key, value);
    const db = poolOn(testDatabase.name);
    const query = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
      (await db.query(text, values)).rows as T[];
    await query(
      `INSERT INTO account (id, email, password_hash) VALUES ($1, 'a@example.com', 'x'), ($2, 'b@example.com', 'x')`,
      [A, B],
    );
    const sessions = createAccountSessions({ query, clock: systemClock, secret: () => SECRET, sessionDays: 14 });
    for (const [who, id] of [
      ["a", A],
      ["b", B],
    ] as const)
      cookie[who] = (await sessions.create(id, { ip: null, userAgent: "vitest" })).token;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await endPool(pool({ DATABASE_URL: url }));
    for (const made of all()) await endPool(made);
    await testDatabase?.drop();
    await rm(root, { recursive: true, force: true });
  });

  it("keeps A's document, gives it to A only, and deletes it for A only", async () => {
    const form = new FormData();
    form.set("file", new File([PDF], "bail.pdf", { type: "application/pdf" }));
    form.set("title", "Bail 2026");
    const created = await upload(new Request(BASE, as("a", { method: "POST", body: form })));
    expect(created.status).toBe(201);
    const { document } = await created.json();
    expect(document).toMatchObject({ title: "Bail 2026", mediaType: "application/pdf", sizeBytes: PDF.byteLength });
    expect(document).not.toHaveProperty("ownerId");

    expect((await (await list(new Request(BASE, as("a")))).json()).documents).toHaveLength(1);
    expect((await (await list(new Request(BASE, as("b")))).json()).documents).toEqual([]);

    const stolen = await readOne(new Request(`${BASE}/${document.id}`, as("b")), idOf(document.id));
    expect(stolen.status).toBe(404);
    expect((await stolen.json()).code).toBe("DOCUMENT_NOT_FOUND");
    const own = await readOne(new Request(`${BASE}/${document.id}`, as("a")), idOf(document.id));
    expect(own.status).toBe(200);
    expect([...new Uint8Array(await own.arrayBuffer())]).toEqual([...PDF]);

    expect(
      (await deleteOne(new Request(`${BASE}/${document.id}`, as("b", { method: "DELETE" })), idOf(document.id))).status,
    ).toBe(404);
    expect(
      (await deleteOne(new Request(`${BASE}/${document.id}`, as("a", { method: "DELETE" })), idOf(document.id))).status,
    ).toBe(204);
    expect((await readOne(new Request(`${BASE}/${document.id}`, as("a")), idOf(document.id))).status).toBe(404);
  });

  it("keeps only ciphertext on disk, and erasing A shreds A's key: A's documents never open again, B's still do", async () => {
    const send = async (who: string) => {
      const form = new FormData();
      form.set("file", new File([PDF], "bail.pdf", { type: "application/pdf" }));
      return (await (await upload(new Request(BASE, as(who, { method: "POST", body: form })))).json()).document;
    };
    const mine = await send("a");
    const theirs = await send("b");
    const folder = join(root, "kridoc-test", "t", accountTenantOf(A), "documents");
    const sealed = await readFile(join(folder, mine.id));
    expect(sealed.includes(Buffer.from("%PDF"))).toBe(false);

    await documentsRuntime().service.eraseOwner(A);

    expect(await readdir(folder)).toEqual([]);
    const db = poolOn(testDatabase.name);
    const ring = await db.query("SELECT shredded_at FROM storage.tenant_keyring WHERE tenant_id = $1", [
      accountTenantOf(A),
    ]);
    expect(ring.rows[0]?.shredded_at).toBeInstanceOf(Date);
    const left = await db.query("SELECT count(*)::int AS n FROM storage.tenant_key WHERE tenant_id = $1", [
      accountTenantOf(A),
    ]);
    expect(left.rows[0]?.n).toBe(0);
    expect((await readOne(new Request(`${BASE}/${mine.id}`, as("a")), idOf(mine.id))).status).toBe(404);
    const own = await readOne(new Request(`${BASE}/${theirs.id}`, as("b")), idOf(theirs.id));
    expect([...new Uint8Array(await own.arrayBuffer())]).toEqual([...PDF]);
  });

  it("refuses a request without a session before reading its body", async () => {
    const response = await upload(new Request(BASE, { method: "POST", body: "not a form" }));
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("UNAUTHENTICATED");
  });

  it("refuses a file that is not a document type, and a form without a file", async () => {
    const form = new FormData();
    form.set("file", new File([new TextEncoder().encode("plain words")], "fake.pdf", { type: "application/pdf" }));
    const refused = await upload(new Request(BASE, as("a", { method: "POST", body: form })));
    expect(refused.status).toBe(415);
    const empty = await upload(new Request(BASE, as("a", { method: "POST", body: new FormData() })));
    expect(empty.status).toBe(400);
    expect((await empty.json()).code).toBe("NO_FILE");
  });
});
