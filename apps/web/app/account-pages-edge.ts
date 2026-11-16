import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { createAccountDirectory } from "@/lib/auth/account-directory";
import { ACCOUNT_ROLE } from "@/lib/auth/account-store";
import type { SessionAccount } from "@/lib/auth/auth-service";
import { tokenOfRequest } from "@/lib/auth/session-cookie";
import { databaseOf } from "@/lib/db/connection";
import { readEnv } from "@/lib/env";

import { accountsRuntime } from "./accounts-edge";

/** The account of the page's session, or the sign-in (back to `path`); « not found » while the accounts feature is off. */
export async function accountOfPage(locale: string, path: string): Promise<SessionAccount> {
  const env = readEnv();
  if (env.AUTH_ENABLED !== "on") notFound();
  const session = await accountsRuntime(env).sessions.resolve(tokenOfRequest(await headers()));
  if (!session) redirect(`/${locale}/sign-in?next=${encodeURIComponent(path)}`);
  return session.account;
}

/** An administrator's page: the session, then « not found » for anyone else (the screen is not even named). */
export async function administratorOfPage(locale: string, path: string): Promise<SessionAccount> {
  const account = await accountOfPage(locale, path);
  if (account.role !== ACCOUNT_ROLE.admin) notFound();
  return account;
}

/** The accounts an administrator lists, on the process's pool. */
export const accountDirectory = () => createAccountDirectory(databaseOf(readEnv()).query);
