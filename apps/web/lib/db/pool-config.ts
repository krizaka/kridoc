import type { PoolConfig } from "pg";

/** Settings as data: the pool's technical bounds. */
export const POOL = { maxConnections: 5, idleTimeoutMs: 30_000 } as const;

/**
 * Reads a connection string. A bad one says WHICH variable is wrong and never shows any part of it: Node's `Invalid URL`
 * error keeps the rejected input, so it is dropped here, not rethrown.
 */
function parseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL (expected postgresql://user:password@host:port/database)");
  }
  if (!url.hostname) {
    throw new Error("DATABASE_URL has no host");
  }
  return url;
}

/**
 * The pool configuration of Kridoc's database. TLS to the cluster is verified against its CA (DATABASE_CA_CERT), never
 * `rejectUnauthorized: false`; the URL's `sslmode` is read here, not by the driver, so the rule lives in one place.
 */
/** What the pool needs of the environment: the edge (lib/env.ts) reads it and passes it in. */
export interface DatabaseEnv {
  DATABASE_URL?: string;
  DATABASE_CA_CERT?: string;
}

export function poolConfig(env: DatabaseEnv): PoolConfig {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  const url = parseUrl(env.DATABASE_URL);
  const mode = url.searchParams.get("sslmode");
  url.searchParams.delete("sslmode");
  const tls = mode === "require" || mode === "verify-ca" || mode === "verify-full";
  if (tls && !env.DATABASE_CA_CERT) {
    throw new Error("DATABASE_CA_CERT is not set (the database URL asks for TLS)");
  }
  return {
    connectionString: url.toString(),
    max: POOL.maxConnections,
    idleTimeoutMillis: POOL.idleTimeoutMs,
    ...(tls ? { ssl: { ca: env.DATABASE_CA_CERT?.replaceAll(String.raw`\n`, "\n"), rejectUnauthorized: true } } : {}),
  };
}
