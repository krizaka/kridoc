import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { hashPassword } from "@krizaka/auth";
import pg from "pg";

import { ADMIN, MEMBER } from "./accounts.mts";

const NAME = "kridoc_e2e";
const MIGRATIONS = fileURLToPath(new URL("../../../infra/migrations/", import.meta.url));

/** Before the journeys: a fresh database with Kridoc's migrations and two accounts (an administrator and a member). Never the production one. */
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set: the journeys never skip");
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query("DROP DATABASE IF EXISTS kridoc_e2e WITH (FORCE)");
  await admin.query("CREATE DATABASE kridoc_e2e");
  await admin.end();

  const target = new URL(url);
  target.pathname = `/${NAME}`;
  const db = new pg.Pool({ connectionString: target.toString(), max: 2 });
  // Kridoc's own dated files, in name order: the same schema the app's runner makes (each file is one transaction there).
  for (const file of (await readdir(MIGRATIONS)).sort((a, b) => a.localeCompare(b)))
    await db.query(await readFile(`${MIGRATIONS}${file}`, "utf8"));
  for (const [who, role] of [
    [ADMIN, "ADMIN"],
    [MEMBER, "USER"],
  ] as const)
    await db.query(`INSERT INTO account (email, password_hash, role) VALUES ($1, $2, $3)`, [
      who.email,
      await hashPassword(who.password),
      role,
    ]);
  await db.end();
}
