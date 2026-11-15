// pnpm auth:create-admin — makes the first administrator of Kridoc (sign-up is closed, krizaka-internal#3718).
// DATABASE_URL (and DATABASE_CA_CERT) point at the database; AUTH_ADMIN_EMAIL and AUTH_ADMIN_PASSWORD come from the environment,
// never from the command line (a password in argv lands in the shell history). Nothing sensitive is printed.
import { hashPassword } from "@krizaka/auth";

import { createAccountStore } from "../lib/auth/account-store";
import { createAdministrator } from "../lib/auth/admin-bootstrap";
import { AuthError } from "../lib/auth/errors";
import { databaseOf } from "../lib/db/connection";
import { readEnv } from "../lib/env";

async function main(): Promise<void> {
  const env = readEnv();
  const email = process.env.AUTH_ADMIN_EMAIL;
  const password = process.env.AUTH_ADMIN_PASSWORD;
  if (!env.DATABASE_URL || !email || !password) {
    throw new AuthError("INVALID_INPUT");
  }
  const { pool, query } = databaseOf(env);
  try {
    const admin = await createAdministrator(createAccountStore(query), hashPassword, { email, password });
    console.log(`auth:create-admin: administrator created (${admin.id})`);
  } finally {
    await pool().end();
  }
}

try {
  await main();
} catch (error: unknown) {
  console.error(
    error instanceof AuthError
      ? `auth:create-admin refused: ${error.code} (needs DATABASE_URL, AUTH_ADMIN_EMAIL, AUTH_ADMIN_PASSWORD of 12+ characters)`
      : "auth:create-admin failed (see below)",
  );
  if (!(error instanceof AuthError)) console.error(error instanceof Error ? error.name : error);
  process.exit(1);
}
