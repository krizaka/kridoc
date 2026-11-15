import { passwordProblem } from "@krizaka/auth";

import { ACCOUNT_ROLE, type AccountRecord, type AccountStore } from "./account-store";
import { signInInput } from "./credentials";
import { AUTH_ERROR, AuthError } from "./errors";

/**
 * The first administrator (sign-up is closed, so nobody else can make one): an address and a password the operator passes in, hashed
 * here, stored as an ADMIN. An address that already has an account is refused (`EMAIL_TAKEN`), never promoted by surprise.
 */
export async function createAdministrator(
  store: AccountStore,
  hash: (password: string) => Promise<string>,
  input: { email: string; password: string },
): Promise<AccountRecord> {
  const parsed = signInInput.safeParse(input);
  if (!parsed.success) throw new AuthError(AUTH_ERROR.invalidInput);
  const problem = passwordProblem(parsed.data.password);
  if (problem) throw new AuthError(problem === "TOO_SHORT" ? AUTH_ERROR.passwordTooShort : AUTH_ERROR.passwordTooLong);
  const record = await store.create({
    email: parsed.data.email,
    passwordHash: await hash(parsed.data.password),
    locale: "fr",
    role: ACCOUNT_ROLE.admin,
  });
  if (!record) throw new AuthError(AUTH_ERROR.emailTaken);
  return record;
}
