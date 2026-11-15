import { createSessions, dbSessionStore } from "@krizaka/auth";
import { type Clock, type Query } from "@krizaka/db";

import type { SessionAccount } from "./auth-service";

// @fixed: the letters of Kridoc's session tokens (`kd1.<43 characters>`)
const TOKEN_PREFIX = "kd";

/** Kridoc's web sessions over its `session` and `account` tables: a locked account opens nothing at once. The clock, the secret and the length are passed in. */
export function createAccountSessions(deps: { query: Query; clock: Clock; secret: () => string; sessionDays: number }) {
  return createSessions<SessionAccount>({
    store: dbSessionStore(deps.query, {
      sessions: "session",
      accounts: "account",
      columns: ["id", "email", "role", "locale"],
      toAccount: (row) => ({
        id: String(row.id),
        email: String(row.email),
        role: row.role as SessionAccount["role"],
        locale: row.locale as SessionAccount["locale"],
      }),
      active: { column: "status", equals: "ACTIVE" },
    }),
    clock: deps.clock,
    tokenPrefix: TOKEN_PREFIX,
    secret: deps.secret,
    sessionDays: deps.sessionDays,
  });
}
