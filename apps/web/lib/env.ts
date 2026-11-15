import { residencyOfConfig } from "@krizaka/storage";
import { z } from "zod";

import { STORAGE_PROVIDER } from "@/lib/storage/providers";

/** Settings as data: what the server asks of its environment, changed here and nowhere else. */
export const SETTINGS = {
  sessionSecretMinLength: 32,
  /** Days a session lives (a new session reads it). */
  sessionDays: 14,
  /** Wrong passwords in a row after which an account is locked until an administrator opens it. */
  maxFailedSignIns: 5,
  /** Sign-in tries an address may make, and one e-mail may receive, in one window. */
  signIn: { perIp: 30, perSubject: 10, windowSeconds: 900 },
  /** Sign-up tries an address may make in one window (when sign-up is open). */
  signUp: { perIp: 10, windowSeconds: 3600 },
  /** Kridoc's own documents: the largest file and the types its bytes may be (checked by magic number, never by name). */
  documents: {
    maxBytes: 25 * 1024 * 1024,
    types: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
  },
} as const;

/** An installation's tenant id: the prefix of every key (letters, digits, - or _; `assertTenantId` of @krizaka/storage). */
const TENANT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Every environment variable of the app, declared once, named by bounded context (APP_, DATABASE_, AUTH_, MAIL_, MEDIA_, ABUSE_, AI_…)
 * — never by product or vendor: the vendor is a value (`MAIL_PROVIDER=mailgun`). Add yours here; tests/env.test.ts refuses the rest.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** The public origin of the site (canonical URLs, sitemap). */
  APP_PUBLIC_URL: z.string().url().default("https://www.kridoc.com"),
  /** A development address: every page goes to www (308); only the API, /.well-known and robots.txt keep serving. Unset: no dev host (Kridoc has none). */
  APP_DEV_HOST: z.string().optional(),
  /** `off` on every dev / preview deployment: noindex everywhere. */
  APP_SEARCH_INDEXING: z.enum(["on", "off"]).default("on"),
  /** The database feature: `off` until the dev database exists, so a missing key never takes the public site down. */
  DATABASE_ENABLED: z.enum(["on", "off"]).default("off"),
  /** Kridoc's own database (each product keeps its own users): a connection string, a secret. */
  DATABASE_URL: z.string().optional(),
  /** The CA certificate of a TLS database (PEM), a secret. */
  DATABASE_CA_CERT: z.string().optional(),
  /** The accounts feature (Kridoc's own users, sessions, sign-in): `off` until the founder turns it on; off, no account route answers. */
  AUTH_ENABLED: z.enum(["on", "off"]).default("off"),
  /** Sign-up: `closed` (the default) refuses every new account; an administrator is made with `pnpm auth:create-admin`. */
  AUTH_SIGNUP: z.enum(["open", "closed"]).default("closed"),
  /** Keys the stored hash of the session tokens of Kridoc's own users, a secret (at least SETTINGS.sessionSecretMinLength characters). */
  AUTH_SESSION_SECRET: z.string().optional(),
  /** The documents feature (Kridoc's own documents in object storage): `off` until the founder turns it on; off, no document route answers. */
  MEDIA_STORAGE_ENABLED: z.enum(["on", "off"]).default("off"),
  /** `local` (a folder, development only) or `s3` (an S3-compatible bucket in a Canadian region, the only one production accepts). */
  MEDIA_STORAGE_PROVIDER: z.enum([STORAGE_PROVIDER.local, STORAGE_PROVIDER.s3]).default(STORAGE_PROVIDER.local),
  /** The folder of the `local` provider. */
  MEDIA_STORAGE_ROOT: z.string().default(".data/documents"),
  /** The installation's tenant id (`kridoc-prod`): every key lives under it. Read once at the edge, never from a request. */
  MEDIA_DOCUMENTS_TENANT: z.string().regex(TENANT_ID).optional(),
  /** The bucket of the `s3` provider: its origin (`https://tor1.digitaloceanspaces.com`), region (`tor1`) and name. */
  MEDIA_S3_ENDPOINT: z.string().url().optional(),
  MEDIA_S3_REGION: z.string().optional(),
  MEDIA_S3_BUCKET: z.string().optional(),
  /** The bucket's key, scoped to that bucket: secrets. */
  MEDIA_S3_ACCESS_KEY_ID: z.string().optional(),
  MEDIA_S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** The header the edge sets with the client's address (`do-connecting-ip` on DigitalOcean App Platform). */
  ABUSE_CLIENT_IP_HEADER: z.string().default("do-connecting-ip"),
  /** How many trusted proxies append to X-Forwarded-For. */
  ABUSE_TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(10).default(1),
});

export type Env = z.infer<typeof envSchema>;
type Source = Record<string, string | undefined>;

// An empty value is an unset one (DigitalOcean keeps a key with no value).
const withoutEmpty = (source: Source): Source =>
  Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));

export const readEnv = (source: Source = process.env): Env => envSchema.parse(withoutEmpty(source));

/** One thing a production server cannot run without: the check returns a problem sentence (naming the key, never its value) or null. */
export type Requirement = { key: string; check: (env: Env) => string | null };

/** A connection string that asks for TLS (`sslmode=require`, `verify-ca`, `verify-full`): then the cluster's CA certificate is needed. */
export const asksForTls = (url: string): boolean => /[?&]sslmode=(require|verify-ca|verify-full)(&|$)/.test(url);

/**
 * The settings production cannot start without, as data per feature. The database feature (slice B, krizaka-internal#3717) asks
 * for DATABASE_URL and, when the URL asks for TLS, DATABASE_CA_CERT — only when DATABASE_ENABLED is `on`, so kridoc.com
 * never goes down for a key a feature does not use yet. Slice C (krizaka-internal#3718): when AUTH_ENABLED is `on`, the database feature must be on and AUTH_SESSION_SECRET (at least
 * SETTINGS.sessionSecretMinLength characters) must be set. A key required here must also be exported by scripts/ci-after-build.sh and
 * declared in .do/app.yaml (tests/ci-boot-env.test.ts).
 */
/** The documents feature is on with the bucket provider: then the bucket's coordinates and keys are needed. */
const usesBucket = (env: Env): boolean =>
  env.MEDIA_STORAGE_ENABLED === "on" && env.MEDIA_STORAGE_PROVIDER === STORAGE_PROVIDER.s3;

/** A bucket setting the documents feature needs: named when it is missing. */
const bucketSetting = (
  key: "MEDIA_S3_ENDPOINT" | "MEDIA_S3_BUCKET" | "MEDIA_S3_ACCESS_KEY_ID" | "MEDIA_S3_SECRET_ACCESS_KEY",
): Requirement => ({
  key,
  check: (env) => (usesBucket(env) && !env[key] ? `${key} is not set (the documents feature is on)` : null),
});

/** Law 25: the region AND the endpoint must be Canadian (`residencyOfConfig` of @krizaka/storage), never a guess in Canada's favour. */
const canadianRegion = (env: Env): string | null => {
  if (!usesBucket(env)) return null;
  if (!env.MEDIA_S3_REGION) return "MEDIA_S3_REGION is not set (the documents feature is on)";
  if (!env.MEDIA_S3_ENDPOINT) return null;
  return residencyOfConfig({ provider: "s3", endpoint: env.MEDIA_S3_ENDPOINT, region: env.MEDIA_S3_REGION }) ===
    "canada"
    ? null
    : "MEDIA_S3_REGION has no Canadian residency (Law 25: documents stay in Canada)";
};

/**
 * Slice D (krizaka-internal#3719): when MEDIA_STORAGE_ENABLED is `on`, production needs the accounts feature (a document has an owner), the
 * `s3` provider (a folder has no residency, and an App Platform disk is wiped at each deploy), its settings with a Canadian region, and the
 * installation's tenant id.
 */
const DOCUMENTS_REQUIREMENTS: readonly Requirement[] = [
  {
    key: "MEDIA_STORAGE_ENABLED",
    check: (env) =>
      env.MEDIA_STORAGE_ENABLED === "on" && env.AUTH_ENABLED !== "on"
        ? "AUTH_ENABLED is not on (the documents feature needs the accounts)"
        : null,
  },
  {
    key: "MEDIA_STORAGE_PROVIDER",
    check: (env) =>
      env.MEDIA_STORAGE_ENABLED === "on" && env.MEDIA_STORAGE_PROVIDER !== STORAGE_PROVIDER.s3
        ? "MEDIA_STORAGE_PROVIDER must be s3 in production (a local folder has no Canadian residency)"
        : null,
  },
  {
    key: "MEDIA_DOCUMENTS_TENANT",
    check: (env) =>
      env.MEDIA_STORAGE_ENABLED === "on" && !env.MEDIA_DOCUMENTS_TENANT
        ? "MEDIA_DOCUMENTS_TENANT is not set (the installation's tenant id, e.g. kridoc-prod)"
        : null,
  },
  bucketSetting("MEDIA_S3_ENDPOINT"),
  { key: "MEDIA_S3_REGION", check: canadianRegion },
  bucketSetting("MEDIA_S3_BUCKET"),
  bucketSetting("MEDIA_S3_ACCESS_KEY_ID"),
  bucketSetting("MEDIA_S3_SECRET_ACCESS_KEY"),
];

export const PRODUCTION_REQUIREMENTS: readonly Requirement[] = [
  {
    key: "DATABASE_URL",
    check: (env) =>
      env.DATABASE_ENABLED === "on" && !env.DATABASE_URL
        ? "DATABASE_URL is not set (the database feature is on)"
        : null,
  },
  {
    key: "DATABASE_CA_CERT",
    check: (env) =>
      env.DATABASE_ENABLED === "on" && env.DATABASE_URL && asksForTls(env.DATABASE_URL) && !env.DATABASE_CA_CERT
        ? "DATABASE_CA_CERT is not set (the database URL asks for TLS)"
        : null,
  },
  {
    key: "AUTH_ENABLED",
    check: (env) =>
      env.AUTH_ENABLED === "on" && env.DATABASE_ENABLED !== "on"
        ? "DATABASE_ENABLED is not on (the accounts feature needs the database)"
        : null,
  },
  {
    key: "AUTH_SESSION_SECRET",
    check: (env) => {
      if (env.AUTH_ENABLED !== "on") return null;
      if (!env.AUTH_SESSION_SECRET) return "AUTH_SESSION_SECRET is not set (the accounts feature is on)";
      return env.AUTH_SESSION_SECRET.length < SETTINGS.sessionSecretMinLength
        ? `AUTH_SESSION_SECRET is shorter than ${SETTINGS.sessionSecretMinLength} characters`
        : null;
    },
  },
  ...DOCUMENTS_REQUIREMENTS,
];

/** What a production server cannot run without — named, never shown. Nothing is asked outside production. */
export function productionProblems(env: Env, requirements: readonly Requirement[] = PRODUCTION_REQUIREMENTS): string[] {
  if (env.NODE_ENV !== "production") {
    return [];
  }
  return requirements.flatMap((r) => r.check(env) ?? []);
}

/** Called once at server start: production does not boot with a problem. */
export function assertProductionEnv(
  source: Source = process.env,
  requirements: readonly Requirement[] = PRODUCTION_REQUIREMENTS,
): void {
  const problems = productionProblems(readEnv(source), requirements);
  if (problems.length) {
    throw new Error(`Kridoc refuses to start: ${problems.join("; ")}`);
  }
}
