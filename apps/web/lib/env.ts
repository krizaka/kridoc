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

const requiresTls = (url: string) => /sslmode=(require|verify)/.test(url);

/** What a production server cannot run without — named, never shown. Nothing is asked outside production. */
export function productionProblems(env: Env): string[] {
  if (env.NODE_ENV !== "production") {
    return [];
  }
  const problems: string[] = [];
  if (!env.DATABASE_URL) {
    problems.push("DATABASE_URL is not set");
  }
  if (!env.AUTH_SESSION_SECRET || env.AUTH_SESSION_SECRET.length < SETTINGS.sessionSecretMinLength) {
    problems.push(`AUTH_SESSION_SECRET must be at least ${SETTINGS.sessionSecretMinLength} characters`);
  }
  if (env.DATABASE_URL && requiresTls(env.DATABASE_URL) && !env.DATABASE_CA_CERT) {
    problems.push("DATABASE_CA_CERT is required for a TLS database");
  }
  return problems;
}

/** Called once at server start: production does not boot with a problem. */
export function assertProductionEnv(source: Source = process.env): void {
  const problems = productionProblems(readEnv(source));
  if (problems.length) {
    throw new Error(`Kridoc refuses to start: ${problems.join("; ")}`);
  }
}
