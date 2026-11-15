import { z } from "zod";

import { AUTH_ERROR, AuthError } from "./errors";

// @fixed: RFC 5321's longest address; the table's check says the same
const EMAIL_MAX = 254;
// @fixed: bounds the work a request makes the server do (the same bound as @krizaka/auth's PASSWORD_MAX_LENGTH)
const PASSWORD_MAX = 256;

const email = z.string().trim().toLowerCase().pipe(z.email().max(EMAIL_MAX));
const locale = z.enum(["fr", "en"]).optional();

export const signInInput = z.object({ email, password: z.string().min(1).max(PASSWORD_MAX) });
/** A new password is judged by its length in the service (typed codes), so the edge only bounds it. */
export const signUpInput = z.object({ email, password: z.string().max(PASSWORD_MAX + 1), locale });

export type SignInInput = z.infer<typeof signInInput>;
export type SignUpInput = z.infer<typeof signUpInput>;

/** The edge: a body that is not the shape is `INVALID_INPUT`, never a cast and never an echo of what was sent. */
export function parseInput<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AuthError(AUTH_ERROR.invalidInput);
  return parsed.data;
}
