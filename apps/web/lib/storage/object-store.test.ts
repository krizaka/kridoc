import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FetchLike } from "@krizaka/storage";
import { objectStoreContract } from "@krizaka/storage/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type BucketConfig, objectStoreOf, platformFetch } from "./object-store";
import { STORAGE_PROVIDER } from "./providers";

const CLOCK = { now: () => new Date("2026-11-15T10:00:00Z") };
const TORONTO: BucketConfig = {
  endpoint: "https://tor1.digitaloceanspaces.com",
  region: "tor1",
  bucket: "kridoc-documents",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
};
const offline: FetchLike = async () => {
  throw new Error("the local adapter never calls the network");
};

/**
 * A tiny S3 in memory (path-style): PUT, GET, HEAD, DELETE on `<origin>/<bucket>/<key>` and ListObjectsV2, refusing any request that is
 * not signed (Signature V4). No live bucket is called in CI: the contract proves the adapter's behaviour behind the port.
 * Follow-up: this fake belongs in `@krizaka/storage/testkit` (Verikora has a smaller one), see the slice plan of #3719.
 */
function fakeS3(bucket: string) {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const hosts = new Set<string>();
  const reply = (status: number, body: Uint8Array | string = "", headers: Record<string, string> = {}) => ({
    ok: status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    arrayBuffer: async () => (typeof body === "string" ? new TextEncoder().encode(body) : body).slice().buffer,
    text: async () => (typeof body === "string" ? body : new TextDecoder().decode(body)),
  });
  const listing = (prefix: string) =>
    `<ListBucketResult><IsTruncated>false</IsTruncated>${[...objects.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, o]) => `<Contents><Key>${key}</Key><Size>${o.bytes.byteLength}</Size></Contents>`)
      .join("")}</ListBucketResult>`;
  const fetchLike: FetchLike = async (url, init) => {
    const target = new URL(url);
    hosts.add(target.host);
    if (!(init.headers.authorization ?? "").startsWith("AWS4-HMAC-SHA256")) return reply(403);
    if (target.searchParams.get("list-type") === "2")
      return reply(200, listing(target.searchParams.get("prefix") ?? ""));
    const key = decodeURIComponent(target.pathname.slice(`/${bucket}/`.length));
    const found = objects.get(key);
    switch (init.method) {
      case "PUT":
        objects.set(key, { bytes: init.body ?? new Uint8Array(), contentType: init.headers["content-type"] ?? "" });
        return reply(200);
      case "GET":
        return found ? reply(200, found.bytes, { "content-type": found.contentType }) : reply(404);
      case "HEAD":
        return found ? reply(200, "", { "content-length": String(found.bytes.byteLength) }) : reply(404);
      case "DELETE":
        objects.delete(key);
        return reply(204);
      default:
        return reply(405);
    }
  };
  return { objects, hosts, fetchLike };
}

describe("the documents' object stores", () => {
  objectStoreContract("the local adapter (a folder per tenant)", async () =>
    objectStoreOf(
      { provider: STORAGE_PROVIDER.local, tenant: "kridoc-test", root: await mkdtemp(join(tmpdir(), "kridoc-store-")) },
      { fetch: offline, clock: CLOCK },
    ),
  );

  objectStoreContract("the Canadian bucket adapter (Spaces tor1, a fake S3)", () =>
    objectStoreOf(
      { provider: STORAGE_PROVIDER.s3, tenant: "kridoc-test", bucket: TORONTO },
      { fetch: fakeS3(TORONTO.bucket).fetchLike, clock: CLOCK },
    ),
  );

  it("keeps every object of the bucket under t/<tenant>/, signed, encrypted at rest, on the configured host only", async () => {
    const s3 = fakeS3(TORONTO.bucket);
    const calls: Record<string, string>[] = [];
    const store = objectStoreOf(
      { provider: STORAGE_PROVIDER.s3, tenant: "kridoc-prod", bucket: TORONTO },
      {
        fetch: (url, init) => {
          calls.push(init.headers);
          return s3.fetchLike(url, init);
        },
        clock: CLOCK,
      },
    );
    await store.put("documents/a/b", new Uint8Array([1, 2]), { contentType: "application/pdf" });
    expect([...s3.objects.keys()]).toEqual(["t/kridoc-prod/documents/a/b"]);
    expect(calls[0]?.["x-amz-server-side-encryption"]).toBe("AES256");
    expect([...s3.hosts]).toEqual(["tor1.digitaloceanspaces.com"]);
    expect(await store.signedUrl("documents/a/b", 60)).toMatch(
      /^https:\/\/tor1\.digitaloceanspaces\.com\/kridoc-documents\/t\/kridoc-prod\/documents\/a\/b\?.*X-Amz-Signature=/,
    );
  });

  it("refuses an endpoint on our own network (the SSRF rule of @krizaka/storage)", () => {
    expect(() =>
      objectStoreOf(
        {
          provider: STORAGE_PROVIDER.s3,
          tenant: "kridoc-test",
          bucket: { ...TORONTO, endpoint: "http://169.254.169.254" },
        },
        { fetch: offline, clock: CLOCK },
      ),
    ).toThrow(expect.objectContaining({ code: "STORAGE_BAD_ENDPOINT" }));
  });
});

describe("the platform's fetch as the adapters see it", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("passes the method, the headers and a copy of the body, and no body when there is none", async () => {
    const seen: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      seen.push(init);
      return new Response("ok");
    });
    const body = new Uint8Array([1, 2, 3]);
    await platformFetch("https://tor1.digitaloceanspaces.com/b/k", { method: "PUT", headers: { a: "1" }, body });
    await platformFetch("https://tor1.digitaloceanspaces.com/b/k", { method: "GET", headers: {} });
    expect(seen[0]).toMatchObject({ method: "PUT", headers: { a: "1" } });
    expect([...(seen[0]?.body as Uint8Array)]).toEqual([1, 2, 3]);
    expect(seen[0]?.body).not.toBe(body);
    expect(seen[1]).not.toHaveProperty("body");
  });
});
