import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/healthz", () => {
  it("is ready when the environment is complete", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgres://user:pw@db.example/kridoc");
    vi.stubEnv("AUTH_SESSION_SECRET", "s".repeat(40));
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", problems: [] });
  });
  it("answers 503 naming what is missing, never a value", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AUTH_SESSION_SECRET", "hunter2");
    const response = GET();
    expect(response.status).toBe(503);
    const text = JSON.stringify(await response.json());
    expect(text).toContain("DATABASE_URL is not set");
    expect(text).not.toContain("hunter2");
  });
});
