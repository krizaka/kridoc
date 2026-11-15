import type { Query } from "@krizaka/db";

export const ACCOUNT_STATUS = { active: "ACTIVE", locked: "LOCKED" } as const;
export type AccountStatus = (typeof ACCOUNT_STATUS)[keyof typeof ACCOUNT_STATUS];
export const ACCOUNT_ROLE = { user: "USER", admin: "ADMIN" } as const;
export type AccountRole = (typeof ACCOUNT_ROLE)[keyof typeof ACCOUNT_ROLE];

export interface AccountRecord {
  id: string;
  email: string;
  passwordHash: string;
  locale: "fr" | "en";
  role: AccountRole;
  status: AccountStatus;
  failedSignIns: number;
}

export interface NewAccount {
  email: string;
  passwordHash: string;
  locale: "fr" | "en";
  role?: AccountRole;
}

/** The port: the only door to the account table. The services depend on this, never on SQL. */
export interface AccountStore {
  findByEmail(email: string): Promise<AccountRecord | null>;
  /** Makes the account; `null` when the address already has one. */
  create(account: NewAccount): Promise<AccountRecord | null>;
  /** One more wrong password; the account is locked in the same statement when the count reaches `max`. Answers the new status. */
  recordFailure(id: string, max: number): Promise<AccountStatus>;
  /** A right password: the count of wrong ones starts again. */
  recordSuccess(id: string): Promise<void>;
}

interface Row {
  id: string;
  email: string;
  password_hash: string;
  locale: "fr" | "en";
  role: AccountRole;
  status: AccountStatus;
  failed_sign_ins: number;
}

const COLUMNS = "id, email, password_hash, locale, role, status, failed_sign_ins";
// @fixed: PostgreSQL's SQLSTATE for a unique violation
const UNIQUE_VIOLATION = "23505";

const recordOf = (row: Row): AccountRecord => ({
  id: row.id,
  email: row.email,
  passwordHash: row.password_hash,
  locale: row.locale,
  role: row.role,
  status: row.status,
  failedSignIns: row.failed_sign_ins,
});

/** The PostgreSQL adapter of the port, on any `Query` (the pool, or the client of a transaction). */
export function createAccountStore(query: Query): AccountStore {
  return {
    async findByEmail(email) {
      const [row] = await query<Row>(`SELECT ${COLUMNS} FROM account WHERE email = $1`, [email]);
      return row ? recordOf(row) : null;
    },
    async create(account) {
      try {
        const [row] = await query<Row>(
          `INSERT INTO account (email, password_hash, locale, role) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
          [account.email, account.passwordHash, account.locale, account.role ?? ACCOUNT_ROLE.user],
        );
        return recordOf(row!);
      } catch (error) {
        if ((error as { code?: string }).code === UNIQUE_VIOLATION) return null;
        throw error;
      }
    },
    async recordFailure(id, max) {
      const [row] = await query<{ status: AccountStatus }>(
        `UPDATE account SET failed_sign_ins = failed_sign_ins + 1,
           status = CASE WHEN failed_sign_ins + 1 >= $2 THEN 'LOCKED' ELSE status END
         WHERE id = $1 RETURNING status`,
        [id, max],
      );
      return row?.status ?? ACCOUNT_STATUS.active;
    },
    async recordSuccess(id) {
      await query(`UPDATE account SET failed_sign_ins = 0 WHERE id = $1 AND failed_sign_ins <> 0`, [id]);
    },
  };
}
