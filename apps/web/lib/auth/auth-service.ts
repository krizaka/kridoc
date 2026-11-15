import { passwordProblem } from "@krizaka/auth";
import type { Limiter } from "@krizaka/rate-limit";

import { ACCOUNT_STATUS, type AccountRecord, type AccountStore } from "./account-store";
import type { SignInInput, SignUpInput } from "./credentials";
import { AUTH_ERROR, AuthError } from "./errors";

/** Who is asking: the address the limiter counts and what the session remembers. */
export interface Caller {
  ip: string | null;
  userAgent: string | null;
}

/** What a signed-in account is, as the session carries it (never the hash). */
export interface SessionAccount {
  id: string;
  email: string;
  role: AccountRecord["role"];
  locale: AccountRecord["locale"];
}

export interface OpenedSession {
  account: SessionAccount;
  token: string;
  expires: Date;
}

export interface AuthServiceDeps {
  accounts: AccountStore;
  limiter: Limiter;
  hash: (password: string) => Promise<string>;
  verify: (password: string, hash: string) => Promise<boolean>;
  /** A hash to verify against when the address has no account: the same work, the same time. */
  decoy: () => Promise<string>;
  openSession: (accountId: string, caller: Caller) => Promise<{ token: string; expires: Date }>;
  closeSession: (token: string | undefined) => Promise<void>;
  signupOpen: boolean;
  maxFailedSignIns: number;
}

const accountOf = (record: AccountRecord): SessionAccount => ({
  id: record.id,
  email: record.email,
  role: record.role,
  locale: record.locale,
});

export interface AuthService {
  signIn(input: SignInInput, caller: Caller): Promise<OpenedSession>;
  signUp(input: SignUpInput, caller: Caller): Promise<OpenedSession>;
  signOut(token: string | undefined): Promise<void>;
}

/** Sign-in, sign-up and sign-out of Kridoc's own accounts. Ports in, typed `AuthError` out; nothing here logs a password or a token. */
export function createAuthService(deps: AuthServiceDeps): AuthService {
  /** The password check, the lock and the count of wrong ones: one job. A locked account is named only to whoever knows its password. */
  async function authenticate(input: SignInInput): Promise<AccountRecord> {
    const record = await deps.accounts.findByEmail(input.email);
    const right = await deps.verify(input.password, record?.passwordHash ?? (await deps.decoy()));
    if (!record || !right) {
      if (record?.status === ACCOUNT_STATUS.active) await deps.accounts.recordFailure(record.id, deps.maxFailedSignIns);
      throw new AuthError(AUTH_ERROR.invalidCredentials);
    }
    if (record.status === ACCOUNT_STATUS.locked) throw new AuthError(AUTH_ERROR.accountLocked);
    await deps.accounts.recordSuccess(record.id);
    return record;
  }

  async function enforce(action: "signIn" | "signUp", caller: Caller, subject?: string): Promise<void> {
    await deps.limiter.enforce(action, { ip: caller.ip, subject });
  }

  const opened = async (record: AccountRecord, caller: Caller): Promise<OpenedSession> => ({
    account: accountOf(record),
    ...(await deps.openSession(record.id, caller)),
  });

  return {
    async signIn(input, caller) {
      await enforce("signIn", caller, input.email);
      const record = await authenticate(input);
      await deps.limiter.forget("signIn", { ip: caller.ip, subject: input.email });
      return opened(record, caller);
    },
    async signUp(input, caller) {
      if (!deps.signupOpen) throw new AuthError(AUTH_ERROR.signupClosed);
      await enforce("signUp", caller);
      const problem = passwordProblem(input.password);
      if (problem === "TOO_SHORT") throw new AuthError(AUTH_ERROR.passwordTooShort);
      if (problem === "TOO_LONG") throw new AuthError(AUTH_ERROR.passwordTooLong);
      const record = await deps.accounts.create({
        email: input.email,
        passwordHash: await deps.hash(input.password),
        locale: input.locale ?? "fr",
      });
      if (!record) throw new AuthError(AUTH_ERROR.emailTaken);
      return opened(record, caller);
    },
    signOut: (token) => deps.closeSession(token),
  };
}
