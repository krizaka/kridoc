import { describe, expect, it } from "vitest";

import { assertProductionEnv, productionProblems, readEnv, SETTINGS } from "../lib/env";

const GOOD = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://user:pw@db.example:25060/kridoc",
  AUTH_SESSION_SECRET: "s".repeat(SETTINGS.sessionSecretMinLength),
};
const problemsOf = (extra: Record<string, string | undefined>) => productionProblems(readEnv({ ...GOOD, ...extra }));

describe("production environment", () => {
  it("accepts a complete production environment", () => {
    expect(problemsOf({})).toEqual([]);
  });
  it("asks for nothing in development and in tests", () => {
    expect(productionProblems(readEnv({ NODE_ENV: "development" }))).toEqual([]);
    expect(productionProblems(readEnv({ NODE_ENV: "test" }))).toEqual([]);
  });
  it("names a missing DATABASE_URL", () => {
    expect(problemsOf({ DATABASE_URL: undefined })).toEqual(["DATABASE_URL is not set"]);
  });
  it("names a too short or missing AUTH_SESSION_SECRET", () => {
    const expected = [`AUTH_SESSION_SECRET must be at least ${SETTINGS.sessionSecretMinLength} characters`];
    expect(problemsOf({ AUTH_SESSION_SECRET: "short" })).toEqual(expected);
    expect(problemsOf({ AUTH_SESSION_SECRET: undefined })).toEqual(expected);
  });
  it("asks for DATABASE_CA_CERT when the database requires TLS", () => {
    const url = "postgres://u:p@db.example:25060/kridoc?sslmode=require";
    expect(problemsOf({ DATABASE_URL: url })).toEqual(["DATABASE_CA_CERT is required for a TLS database"]);
    expect(problemsOf({ DATABASE_URL: url, DATABASE_CA_CERT: "-----BEGIN CERTIFICATE-----" })).toEqual([]);
  });
  it("lists every problem at once, never a secret value", () => {
    const problems = productionProblems(readEnv({ NODE_ENV: "production", AUTH_SESSION_SECRET: "topsecret" }));
    expect(problems).toHaveLength(2);
    expect(problems.join(" ")).not.toContain("topsecret");
  });
  it("refuses to start with the named problems", () => {
    expect(() => assertProductionEnv({ NODE_ENV: "production" })).toThrow(
      /Kridoc refuses to start: DATABASE_URL is not set; AUTH_SESSION_SECRET must be at least/,
    );
    expect(() => assertProductionEnv(GOOD)).not.toThrow();
  });
});
