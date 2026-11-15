import { z } from "zod";

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
} as const;

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
