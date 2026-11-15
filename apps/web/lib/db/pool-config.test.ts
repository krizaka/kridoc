import { describe, expect, it } from "vitest";

import { poolConfig } from "./pool-config";

const PEM = "-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----";

describe("poolConfig", () => {
  it("refuses a missing URL by name", () => {
    expect(() => poolConfig({})).toThrow("DATABASE_URL is not set");
  });
  it("says which variable is wrong and never shows the rejected value", () => {
    expect(() => poolConfig({ DATABASE_URL: "not a url, hunter2" })).toThrow(/DATABASE_URL is not a valid URL/);
    expect(() => poolConfig({ DATABASE_URL: "not a url, hunter2" })).not.toThrow(/hunter2/);
  });
  it("uses no TLS for a URL that asks for none", () => {
    expect(poolConfig({ DATABASE_URL: "postgresql://u:p@localhost:5432/d" }).ssl).toBeUndefined();
  });
  it("verifies the cluster against its CA, never rejectUnauthorized: false", () => {
    const config = poolConfig({ DATABASE_URL: "postgresql://u:p@h:25060/d?sslmode=require", DATABASE_CA_CERT: PEM });
    expect(config.ssl).toEqual({ ca: PEM.replaceAll(String.raw`\n`, "\n"), rejectUnauthorized: true });
    expect(config.connectionString).not.toContain("sslmode");
  });
  it("refuses a TLS URL without the CA certificate", () => {
    expect(() => poolConfig({ DATABASE_URL: "postgresql://u:p@h:25060/d?sslmode=verify-full" })).toThrow(
      "DATABASE_CA_CERT is not set",
    );
  });
});
