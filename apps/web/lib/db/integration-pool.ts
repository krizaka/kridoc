import pg from "pg";

import { poolConfig } from "./pool-config";

/**
 * The pools of a database test: one per database, ended together. The database tests never skip, so a missing DATABASE_URL throws
 * instead of passing by doing nothing.
 */
export function integrationPools(url: string | undefined) {
  const pools: pg.Pool[] = [];
  return {
    poolOn(database?: string): pg.Pool {
      if (!url) throw new Error("DATABASE_URL is not set: the database tests never skip");
      const target = new URL(url);
      if (database) target.pathname = `/${database}`;
      const made = new pg.Pool({ ...poolConfig({ DATABASE_URL: target.toString() }), max: 2 });
      pools.push(made);
      return made;
    },
    all: (): readonly pg.Pool[] => pools,
  };
}
