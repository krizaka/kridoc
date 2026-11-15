import { describe, expect, it } from "vitest";

import {
  assertProductionEnv,
  PRODUCTION_REQUIREMENTS,
  productionProblems,
  readEnv,
  type Requirement,
} from "../lib/env";

const NEEDS_FEATURE_KEY: Requirement = {
  key: "FEATURE_KEY",
  check: (env) => (env.APP_SEARCH_INDEXING === "on" ? null : "FEATURE_KEY is not set"),
};
const production = (extra: Record<string, string | undefined> = {}) => readEnv({ NODE_ENV: "production", ...extra });

describe("production environment", () => {
  it("starts with neither DATABASE_URL nor AUTH_SESSION_SECRET while no feature needs them", () => {
    expect(PRODUCTION_REQUIREMENTS).toEqual([]);
    expect(productionProblems(production())).toEqual([]);
    expect(() => assertProductionEnv({ NODE_ENV: "production" })).not.toThrow();
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
