import { type Connect, type Connection, type Query, transaction as dbTransaction } from "@krizaka/db";
import pg from "pg";

import { type DatabaseEnv, poolConfig } from "./pool-config";

const holder = globalThis as unknown as { __kridocPool?: pg.Pool };

/** One pool per process, made on first use: a server that never touches the database never opens it. The environment is passed by the edge. */
export function pool(env: DatabaseEnv): pg.Pool {
  holder.__kridocPool ??= new pg.Pool(poolConfig(env));
  return holder.__kridocPool;
}

/** A pool's connection, seen as the `Connection` of `@krizaka/db` (its rows, its release). */
export async function connectionOf(source: pg.Pool): Promise<Connection> {
  const client = await source.connect();
  return {
    query: (text, values) => client.query(text, values as unknown[] | undefined),
    release: () => client.release(),
  };
}

/** Kridoc's database as the `@krizaka/db` ports, on the process's pool. */
export function databaseOf(env: DatabaseEnv) {
  const connect: Connect = () => connectionOf(pool(env));
  const query: Query = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) =>
    (await pool(env).query(text, values)).rows as T[];
  /** The unit of work: a failure rolls back and is rethrown; a failed rollback never masks it. */
  const transaction = <T>(work: (run: Query) => Promise<T>): Promise<T> => dbTransaction(connect, work);
  return { pool: () => pool(env), connect, query, transaction };
}
