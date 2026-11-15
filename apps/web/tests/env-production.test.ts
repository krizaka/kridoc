import { describe, expect, it } from "vitest";

import {
  assertProductionEnv,
  PRODUCTION_REQUIREMENTS,
  productionProblems,
  readEnv,
  type Requirement,
  SETTINGS,
} from "../lib/env";

const NEEDS_FEATURE_KEY: Requirement = {
  key: "FEATURE_KEY",
  check: (env) => (env.APP_SEARCH_INDEXING === "on" ? null : "FEATURE_KEY is not set"),
};
const production = (extra: Record<string, string | undefined> = {}) => readEnv({ NODE_ENV: "production", ...extra });

describe("production environment", () => {
  it("starts without any database key while the database feature is off (the default)", () => {
    expect(productionProblems(production())).toEqual([]);
    expect(productionProblems(production({ DATABASE_ENABLED: "off" }))).toEqual([]);
    expect(() => assertProductionEnv({ NODE_ENV: "production" })).not.toThrow();
  });
  it("names DATABASE_URL and DATABASE_CA_CERT when the database feature is on and they are missing", () => {
    expect(productionProblems(production({ DATABASE_ENABLED: "on" }))).toEqual([
      "DATABASE_URL is not set (the database feature is on)",
    ]);
    expect(
      productionProblems(
        production({ DATABASE_ENABLED: "on", DATABASE_URL: "postgresql://u:p@h:5432/d?sslmode=require" }),
      ),
    ).toEqual(["DATABASE_CA_CERT is not set (the database URL asks for TLS)"]);
  });
  it("needs no CA certificate when the URL asks for no TLS, and nothing once both are set", () => {
    expect(
      productionProblems(production({ DATABASE_ENABLED: "on", DATABASE_URL: "postgresql://u:p@h:5432/d" })),
    ).toEqual([]);
    expect(
      productionProblems(
        production({
          DATABASE_ENABLED: "on",
          DATABASE_URL: "postgresql://u:p@h:5432/d?sslmode=require",
          DATABASE_CA_CERT: "pem",
        }),
      ),
    ).toEqual([]);
  });
  it("refuses to boot with the database on and no URL, without showing a value", () => {
    expect(() => assertProductionEnv({ NODE_ENV: "production", DATABASE_ENABLED: "on" })).toThrow(
      /Kridoc refuses to start: DATABASE_URL is not set/,
    );
  });
  it("declares the requirements of the database and accounts features", () => {
    expect(PRODUCTION_REQUIREMENTS.map((r) => r.key)).toEqual([
      "DATABASE_URL",
      "DATABASE_CA_CERT",
      "AUTH_ENABLED",
      "AUTH_SESSION_SECRET",
      "MEDIA_STORAGE_ENABLED",
      "MEDIA_STORAGE_PROVIDER",
      "MEDIA_DOCUMENTS_TENANT",
      "MEDIA_S3_ENDPOINT",
      "MEDIA_S3_REGION",
      "MEDIA_S3_BUCKET",
      "MEDIA_S3_ACCESS_KEY_ID",
      "MEDIA_S3_SECRET_ACCESS_KEY",
    ]);
  });
  it("asks nothing for accounts while AUTH_ENABLED is off (the default)", () => {
    expect(productionProblems(production())).toEqual([]);
    expect(productionProblems(production({ AUTH_ENABLED: "off" }))).toEqual([]);
  });
  it("names the database feature and the session secret when accounts are on and they are missing", () => {
    expect(productionProblems(production({ AUTH_ENABLED: "on" }))).toEqual([
      "DATABASE_ENABLED is not on (the accounts feature needs the database)",
      "AUTH_SESSION_SECRET is not set (the accounts feature is on)",
    ]);
  });
  it("refuses a session secret shorter than the setting, without showing it", () => {
    const short = "x".repeat(SETTINGS.sessionSecretMinLength - 1);
    const problems = productionProblems(
      production({
        AUTH_ENABLED: "on",
        DATABASE_ENABLED: "on",
        DATABASE_URL: "postgresql://u:p@h/d",
        AUTH_SESSION_SECRET: short,
      }),
    );
    expect(problems).toEqual([`AUTH_SESSION_SECRET is shorter than ${SETTINGS.sessionSecretMinLength} characters`]);
    expect(problems.join(" ")).not.toContain(short);
  });
  it("starts with accounts on once the database and a long enough secret are there", () => {
    expect(
      productionProblems(
        production({
          AUTH_ENABLED: "on",
          DATABASE_ENABLED: "on",
          DATABASE_URL: "postgresql://u:p@h/d",
          AUTH_SESSION_SECRET: "s".repeat(SETTINGS.sessionSecretMinLength),
        }),
      ),
    ).toEqual([]);
  });
  it("asks for nothing in development and in tests", () => {
    expect(productionProblems(readEnv({ NODE_ENV: "development" }), [NEEDS_FEATURE_KEY])).toEqual([]);
    expect(productionProblems(readEnv({ NODE_ENV: "test" }), [NEEDS_FEATURE_KEY])).toEqual([]);
  });
  it("names what a requirement of a feature finds missing, never a value", () => {
    const env = production({ APP_SEARCH_INDEXING: "off", APP_DEV_HOST: "topsecret" });
    const problems = productionProblems(env, [NEEDS_FEATURE_KEY]);
    expect(problems).toEqual(["FEATURE_KEY is not set"]);
    expect(problems.join(" ")).not.toContain("topsecret");
  });
  it("refuses to start with the named problems", () => {
    expect(() =>
      assertProductionEnv({ NODE_ENV: "production", APP_SEARCH_INDEXING: "off" }, [NEEDS_FEATURE_KEY]),
    ).toThrow(/Kridoc refuses to start: FEATURE_KEY is not set/);
  });
});

/** The accounts on, as production has them before the documents feature can be. */
const ACCOUNTS_ON = {
  AUTH_ENABLED: "on",
  DATABASE_ENABLED: "on",
  DATABASE_URL: "postgresql://u:p@h/d",
  AUTH_SESSION_SECRET: "s".repeat(SETTINGS.sessionSecretMinLength),
};
const TORONTO = {
  MEDIA_STORAGE_PROVIDER: "s3",
  MEDIA_DOCUMENTS_TENANT: "kridoc-prod",
  MEDIA_S3_ENDPOINT: "https://tor1.digitaloceanspaces.com",
  MEDIA_S3_REGION: "tor1",
  MEDIA_S3_BUCKET: "kridoc-documents",
  MEDIA_S3_ACCESS_KEY_ID: "access-key-id",
  MEDIA_S3_SECRET_ACCESS_KEY: "secret-access-key",
};

describe("production environment of the documents feature (krizaka-internal#3719)", () => {
  it("asks nothing while MEDIA_STORAGE_ENABLED is off (the default)", () => {
    expect(readEnv({}).MEDIA_STORAGE_ENABLED).toBe("off");
    expect(productionProblems(production({ MEDIA_STORAGE_PROVIDER: "local" }))).toEqual([]);
  });
  it("names the accounts, the provider, the tenant and every bucket setting when it is on and they are missing", () => {
    expect(productionProblems(production({ MEDIA_STORAGE_ENABLED: "on" }))).toEqual([
      "AUTH_ENABLED is not on (the documents feature needs the accounts)",
      "MEDIA_STORAGE_PROVIDER must be s3 in production (a local folder has no Canadian residency)",
      "MEDIA_DOCUMENTS_TENANT is not set (the installation's tenant id, e.g. kridoc-prod)",
    ]);
    expect(
      productionProblems(production({ ...ACCOUNTS_ON, MEDIA_STORAGE_ENABLED: "on", MEDIA_STORAGE_PROVIDER: "s3" })),
    ).toEqual([
      "MEDIA_DOCUMENTS_TENANT is not set (the installation's tenant id, e.g. kridoc-prod)",
      "MEDIA_S3_ENDPOINT is not set (the documents feature is on)",
      "MEDIA_S3_REGION is not set (the documents feature is on)",
      "MEDIA_S3_BUCKET is not set (the documents feature is on)",
      "MEDIA_S3_ACCESS_KEY_ID is not set (the documents feature is on)",
      "MEDIA_S3_SECRET_ACCESS_KEY is not set (the documents feature is on)",
    ]);
  });
  it("starts with the documents on a Toronto bucket", () => {
    expect(productionProblems(production({ ...ACCOUNTS_ON, ...TORONTO, MEDIA_STORAGE_ENABLED: "on" }))).toEqual([]);
  });
  it("refuses a bucket without a Canadian residency (Law 25), whether the region or the endpoint says it, never showing a key", () => {
    const refusal = ["MEDIA_S3_REGION has no Canadian residency (Law 25: documents stay in Canada)"];
    for (const elsewhere of [
      { MEDIA_S3_REGION: "nyc3", MEDIA_S3_ENDPOINT: "https://nyc3.digitaloceanspaces.com" },
      { MEDIA_S3_REGION: "tor1", MEDIA_S3_ENDPOINT: "https://nyc3.digitaloceanspaces.com" },
      { MEDIA_S3_REGION: "us-east-1", MEDIA_S3_ENDPOINT: "https://s3.us-east-1.amazonaws.com" },
      { MEDIA_S3_REGION: "somewhere-new" },
    ]) {
      const problems = productionProblems(
        production({ ...ACCOUNTS_ON, ...TORONTO, ...elsewhere, MEDIA_STORAGE_ENABLED: "on" }),
      );
      expect(problems, JSON.stringify(elsewhere)).toEqual(refusal);
      expect(problems.join(" ")).not.toContain("secret-access-key");
    }
    expect(() =>
      assertProductionEnv({
        NODE_ENV: "production",
        ...ACCOUNTS_ON,
        ...TORONTO,
        MEDIA_STORAGE_ENABLED: "on",
        MEDIA_S3_REGION: "nyc3",
      }),
    ).toThrow(/Kridoc refuses to start: MEDIA_S3_REGION has no Canadian residency/);
  });
  it("refuses a tenant id that is not one (letters, digits, - or _)", () => {
    expect(() => readEnv({ MEDIA_DOCUMENTS_TENANT: "../other" })).toThrow();
  });
});
