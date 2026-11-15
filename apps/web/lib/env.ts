import { z } from "zod";

/** Settings as data: what the server asks of its environment, changed here and nowhere else. */
export const SETTINGS = { sessionSecretMinLength: 32 } as const;

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
  /** Kridoc's own database (each product keeps its own users): a connection string, a secret. */
  DATABASE_URL: z.string().optional(),
  /** The CA certificate of a TLS database (PEM), a secret. */
  DATABASE_CA_CERT: z.string().optional(),
  /** Signs the session cookies of Kridoc's own users, a secret. */
  AUTH_SESSION_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;
type Source = Record<string, string | undefined>;

// An empty value is an unset one (DigitalOcean keeps a key with no value).
const withoutEmpty = (source: Source): Source =>
  Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ""));

export const readEnv = (source: Source = process.env): Env => envSchema.parse(withoutEmpty(source));

/** One thing a production server cannot run without: the check returns a problem sentence (naming the key, never its value) or null. */
export type Requirement = { key: string; check: (env: Env) => string | null };

/**
 * The settings production cannot start without, as data per feature. EMPTY today: Kridoc has no database and no accounts yet,
 * so nothing is required and the server starts with the four settings it has. Each slice adds its own requirement together
 * with its feature, never before: slice B (krizaka-internal#3717) adds DATABASE_URL and DATABASE_CA_CERT (required when the URL
 * asks for TLS), slice C (krizaka-internal#3718) adds AUTH_SESSION_SECRET (at least SETTINGS.sessionSecretMinLength characters).
 * A key required here must also be exported by scripts/ci-after-build.sh and declared in .do/app.yaml (tests/ci-boot-env.test.ts).
 */
export const PRODUCTION_REQUIREMENTS: readonly Requirement[] = [];

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
