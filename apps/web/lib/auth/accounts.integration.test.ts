import { decoyHash, hashPassword, verifyPassword } from "@krizaka/auth";
import { createTestDatabase, endPool, type TestDatabase } from "@krizaka/db/testing";
import { createLimiter, memoryLimitStore } from "@krizaka/rate-limit";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectionOf } from "@/lib/db/connection";
import { integrationPools } from "@/lib/db/integration-pool";
import { migrateDatabase } from "@/lib/db/migrations";

import { createAccountSessions } from "./account-sessions";
import { createAccountStore } from "./account-store";
import { createAdministrator } from "./admin-bootstrap";
import { type AuthServiceDeps, createAuthService } from "./auth-service";
import { parseInput, signUpInput } from "./credentials";

/**
 * Sign-up-closed and sign-in journeys on a real PostgreSQL (CI's service container; locally a throwaway one, `DATABASE_URL=… pnpm test`).
 * Never skipped: without DATABASE_URL the file fails.
 */
const url = process.env.DATABASE_URL;
const PASSWORD = "a long enough password";
const CALLER = { ip: "203.0.113.9", userAgent: "vitest" };

describe("Kridoc's accounts on a real database", () => {
  const { poolOn, all } = integrationPools(url);
  let testDatabase: TestDatabase;
  let pool: pg.Pool;
  let now = new Date("2026-11-16T12:00:00Z");

  const query = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    (await pool.query(text, values)).rows as T[];

  const build = (overrides: Partial<AuthServiceDeps> = {}) => {
    const clock = { now: () => now };
    const sessions = createAccountSessions({ query, clock, secret: () => "s".repeat(32), sessionDays: 14 });
    const service = createAuthService({
      accounts: createAccountStore(query),
      limiter: createLimiter({
        store: memoryLimitStore(),
        clock,
        limits: {
          signIn: { perIp: 100, perSubject: 100, windowSeconds: 900 },
          signUp: { perIp: 100, windowSeconds: 3600 },
        },
      }),
      hash: hashPassword,
      verify: verifyPassword,
      decoy: decoyHash,
      openSession: (id, caller) => sessions.create(id, caller),
      closeSession: (token) => sessions.revoke(token),
      signupOpen: false,
      maxFailedSignIns: 3,
      ...overrides,
    });
    return { service, sessions };
  };

  beforeAll(async () => {
    testDatabase = await createTestDatabase({
      prefix: "kridoc_auth",
      connect: (database) => connectionOf(poolOn(database)),
      migrate: async (open) => {
        await migrateDatabase(open);
      },
    });
    pool = poolOn(testDatabase.name);
    await createAdministrator(createAccountStore(query), hashPassword, {
      email: "admin@example.com",
      password: PASSWORD,
    });
  });

  afterAll(async () => {
    for (const made of all()) await endPool(made);
    await testDatabase?.drop();
  });

  it("sign-up closed: nobody makes an account, the table is unchanged", async () => {
    const { service } = build();
    await expect(service.signUp({ email: "new@example.com", password: PASSWORD }, CALLER)).rejects.toMatchObject({
      code: "SIGNUP_CLOSED",
    });
    expect(await query("SELECT 1 FROM account WHERE email = 'new@example.com'")).toEqual([]);
  });

  it("sign-in: the administrator signs in, the session resolves, the stored token is only a hash, sign-out ends it", async () => {
    const { service, sessions } = build();
    const opened = await service.signIn({ email: "admin@example.com", password: PASSWORD }, CALLER);
    expect(opened.account.role).toBe("ADMIN");
    expect((await sessions.resolve(opened.token))?.account.email).toBe("admin@example.com");
    const stored = await query<{ token_hash: string }>("SELECT token_hash FROM session");
    expect(stored.map((r) => r.token_hash)).not.toContain(opened.token);
    await service.signOut(opened.token);
    expect(await sessions.resolve(opened.token)).toBeNull();
  });

  it("an expired session opens nothing", async () => {
    const { service, sessions } = build();
    const opened = await service.signIn({ email: "admin@example.com", password: PASSWORD }, CALLER);
    now = new Date("2026-12-01T12:00:00Z");
    expect(await sessions.resolve(opened.token)).toBeNull();
    now = new Date("2026-11-16T12:00:00Z");
  });

  it("when sign-up is open, makes an account once; the same address is refused", async () => {
    const { service } = build({ signupOpen: true });
    expect(
      (await service.signUp(parseInput(signUpInput, { email: " New@Example.com ", password: PASSWORD }), CALLER))
        .account.email,
    ).toBe("new@example.com");
    await expect(service.signUp({ email: "new@example.com", password: PASSWORD }, CALLER)).rejects.toMatchObject({
      code: "EMAIL_TAKEN",
    });
  });

  it("wrong password three times locks the account: the right one is then refused, live sessions stop opening, the stored hash is never the password", async () => {
    const { service, sessions } = build({ signupOpen: true });
    await service.signUp({ email: "lock@example.com", password: PASSWORD }, CALLER);
    const live = await service.signIn({ email: "lock@example.com", password: PASSWORD }, CALLER);
    for (let i = 0; i < 3; i++) {
      await expect(
        service.signIn({ email: "lock@example.com", password: "wrong password!" }, CALLER),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    }
    await expect(service.signIn({ email: "lock@example.com", password: PASSWORD }, CALLER)).rejects.toMatchObject({
      code: "ACCOUNT_LOCKED",
    });
    expect(await sessions.resolve(live.token)).toBeNull();
    const [row] = await query<{ status: string; password_hash: string }>(
      "SELECT status, password_hash FROM account WHERE email = 'lock@example.com'",
    );
    expect(row?.status).toBe("LOCKED");
    expect(row?.password_hash.startsWith("scrypt$")).toBe(true);
    expect(row?.password_hash).not.toContain(PASSWORD);
  });
});
