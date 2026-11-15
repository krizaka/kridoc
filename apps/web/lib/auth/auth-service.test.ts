import { createSessions, hashPassword, memorySessionStore, verifyPassword } from "@krizaka/auth";
import { createLimiter, memoryLimitStore } from "@krizaka/rate-limit";
import { beforeAll, describe, expect, it } from "vitest";

import { ACCOUNT_STATUS, type AccountRecord, type AccountStore } from "./account-store";
import { type AuthServiceDeps, createAuthService, type SessionAccount } from "./auth-service";
import { AuthError } from "./errors";

const PASSWORD = "correct horse battery";
const CALLER = { ip: "203.0.113.7", userAgent: "vitest" };
const MAX = 3;

/** An in-memory account table that behaves like the SQL one (lock in the same step as the count). */
function memoryAccounts(): AccountStore & { rows: Map<string, AccountRecord> } {
  const rows = new Map<string, AccountRecord>();
  return {
    rows,
    async findByEmail(email) {
      return [...rows.values()].find((r) => r.email === email) ?? null;
    },
    async create(account) {
      if ([...rows.values()].some((r) => r.email === account.email)) return null;
      const record: AccountRecord = {
        id: `account-${rows.size + 1}`,
        email: account.email,
        passwordHash: account.passwordHash,
        locale: account.locale,
        role: account.role ?? "USER",
        status: ACCOUNT_STATUS.active,
        failedSignIns: 0,
      };
      rows.set(record.id, record);
      return record;
    },
    async recordFailure(id, max) {
      const row = rows.get(id)!;
      row.failedSignIns += 1;
      if (row.failedSignIns >= max) row.status = ACCOUNT_STATUS.locked;
      return row.status;
    },
    async recordSuccess(id) {
      rows.get(id)!.failedSignIns = 0;
    },
  };
}

let hashed = "";
beforeAll(async () => {
  hashed = await hashPassword(PASSWORD);
});

function setup(overrides: Partial<AuthServiceDeps> = {}, clock = { now: () => new Date("2026-11-16T12:00:00Z") }) {
  const accounts = memoryAccounts();
  const store = memorySessionStore<SessionAccount>((id) => {
    const row = accounts.rows.get(id);
    return row && row.status === ACCOUNT_STATUS.active
      ? { id: row.id, email: row.email, role: row.role, locale: row.locale }
      : null;
  });
  const sessions = createSessions<SessionAccount>({
    store,
    clock,
    tokenPrefix: "kd",
    secret: "s".repeat(32),
    sessionDays: 14,
  });
  const decoys: string[] = [];
  const service = createAuthService({
    accounts,
    limiter: createLimiter({
      store: memoryLimitStore(),
      clock,
      limits: { signIn: { perIp: 50, perSubject: 8, windowSeconds: 900 }, signUp: { perIp: 10, windowSeconds: 3600 } },
    }),
    hash: async () => "hash-of-" + "x",
    verify: verifyPassword,
    decoy: async () => {
      decoys.push("used");
      return hashed;
    },
    openSession: (id, caller) => sessions.create(id, caller),
    closeSession: (token) => sessions.revoke(token),
    signupOpen: false,
    maxFailedSignIns: MAX,
    ...overrides,
  });
  accounts.create({ email: "ada@example.com", passwordHash: hashed, locale: "en" });
  return { service, accounts, sessions, decoys };
}

const codeOf = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof AuthError) return error.code;
    throw error;
  }
  return "NO_ERROR";
};

describe("sign-in", () => {
  it("opens a session for the right password", async () => {
    const { service, sessions } = setup();
    const opened = await service.signIn({ email: "ada@example.com", password: PASSWORD }, CALLER);
    expect(opened.account).toMatchObject({ email: "ada@example.com", locale: "en", role: "USER" });
    expect(opened.account).not.toHaveProperty("passwordHash");
    expect((await sessions.resolve(opened.token))?.account.email).toBe("ada@example.com");
  });
  it("refuses a wrong password and an unknown address with the same code, the unknown one checked against the decoy", async () => {
    const { service, decoys } = setup();
    expect(await codeOf(service.signIn({ email: "ada@example.com", password: "wrong" }, CALLER))).toBe(
      "INVALID_CREDENTIALS",
    );
    expect(await codeOf(service.signIn({ email: "nobody@example.com", password: "wrong" }, CALLER))).toBe(
      "INVALID_CREDENTIALS",
    );
    expect(decoys).toHaveLength(1);
  });
  it("locks the account after the allowed wrong passwords in a row, and names the lock only to the right password", async () => {
    const { service, accounts } = setup();
    for (let i = 0; i < MAX; i++) await codeOf(service.signIn({ email: "ada@example.com", password: "wrong" }, CALLER));
    expect([...accounts.rows.values()][0]!.status).toBe(ACCOUNT_STATUS.locked);
    expect(await codeOf(service.signIn({ email: "ada@example.com", password: PASSWORD }, CALLER))).toBe(
      "ACCOUNT_LOCKED",
    );
    expect(await codeOf(service.signIn({ email: "ada@example.com", password: "wrong" }, CALLER))).toBe(
      "INVALID_CREDENTIALS",
    );
  });
  it("starts the count again after a right password", async () => {
    const { service, accounts } = setup();
    await codeOf(service.signIn({ email: "ada@example.com", password: "wrong" }, CALLER));
    await service.signIn({ email: "ada@example.com", password: PASSWORD }, CALLER);
    expect([...accounts.rows.values()][0]!.failedSignIns).toBe(0);
  });
  it("is rate limited per address, before any password is checked", async () => {
    const { service } = setup({ maxFailedSignIns: 1000 });
    for (let i = 0; i < 8; i++) await codeOf(service.signIn({ email: "ada@example.com", password: "wrong" }, CALLER));
    await expect(service.signIn({ email: "ada@example.com", password: PASSWORD }, CALLER)).rejects.toMatchObject({
      name: "RateLimited",
      status: 429,
    });
  });
});

describe("sessions", () => {
  it("stop opening when they expire, and when the account is locked, and after sign-out", async () => {
    let now = new Date("2026-11-16T12:00:00Z");
    const { service, sessions, accounts } = setup({}, { now: () => now });
    const opened = await service.signIn({ email: "ada@example.com", password: PASSWORD }, CALLER);
    expect(await sessions.resolve(opened.token)).not.toBeNull();
    now = new Date("2026-11-30T12:00:01Z");
    expect(await sessions.resolve(opened.token)).toBeNull();
    now = new Date("2026-11-16T13:00:00Z");
    const second = await service.signIn({ email: "ada@example.com", password: PASSWORD }, CALLER);
    accounts.rows.get(second.account.id)!.status = ACCOUNT_STATUS.locked;
    expect(await sessions.resolve(second.token)).toBeNull();
    accounts.rows.get(second.account.id)!.status = ACCOUNT_STATUS.active;
    await service.signOut(second.token);
    expect(await sessions.resolve(second.token)).toBeNull();
  });
});

describe("sign-up", () => {
  it("is closed by default: SIGNUP_CLOSED, no account made", async () => {
    const { service, accounts } = setup();
    expect(await codeOf(service.signUp({ email: "new@example.com", password: PASSWORD }, CALLER))).toBe(
      "SIGNUP_CLOSED",
    );
    expect(accounts.rows.size).toBe(1);
  });
  it("when open, makes the account and signs it in; judges the password and the address", async () => {
    const { service, accounts } = setup({ signupOpen: true });
    expect(await codeOf(service.signUp({ email: "new@example.com", password: "short" }, CALLER))).toBe(
      "PASSWORD_TOO_SHORT",
    );
    expect(await codeOf(service.signUp({ email: "ada@example.com", password: PASSWORD }, CALLER))).toBe("EMAIL_TAKEN");
    expect(accounts.rows.size).toBe(1);
    const opened = await service.signUp({ email: "new@example.com", password: PASSWORD, locale: "en" }, CALLER);
    expect(opened.account).toMatchObject({ email: "new@example.com", locale: "en" });
    expect(accounts.rows.size).toBe(2);
  });
});
