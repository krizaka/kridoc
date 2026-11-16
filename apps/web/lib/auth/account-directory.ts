import type { Query } from "@krizaka/db";

import type { AccountRole, AccountStatus } from "./account-store";

export interface AccountSummary {
  id: string;
  email: string;
  role: AccountRole;
  status: AccountStatus;
  documents: number;
  createdAt: string;
}

/** The port: the accounts as an administrator reads them (never the hash). */
export interface AccountDirectory {
  list(): Promise<AccountSummary[]>;
}

interface Row {
  id: string;
  email: string;
  role: AccountRole;
  status: AccountStatus;
  documents: string;
  created_at: Date;
}

// @fixed: the most accounts one screen lists, a bound on the read (pagination arrives with the first hundred users)
const LIST_MAX = 500;

/** The PostgreSQL adapter of the port: one read, newest first, bounded. */
export function createAccountDirectory(query: Query): AccountDirectory {
  return {
    async list() {
      const rows = await query<Row>(
        `SELECT a.id, a.email, a.role, a.status, a.created_at, count(d.id) AS documents
           FROM account a LEFT JOIN document d ON d.owner_id = a.id
          GROUP BY a.id ORDER BY a.created_at DESC, a.id LIMIT $1`,
        [LIST_MAX],
      );
      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        status: row.status,
        documents: Number(row.documents),
        createdAt: row.created_at.toISOString(),
      }));
    },
  };
}
