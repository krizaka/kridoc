/** The refusals of the accounts feature: a stable code each, its HTTP status said once here, its words in messages/<locale>.json (`auth.errors.<code>`). */
export const AUTH_ERROR = {
  accountsOff: "ACCOUNTS_OFF",
  invalidInput: "INVALID_INPUT",
  invalidCredentials: "INVALID_CREDENTIALS",
  accountLocked: "ACCOUNT_LOCKED",
  signupClosed: "SIGNUP_CLOSED",
  emailTaken: "EMAIL_TAKEN",
  passwordTooShort: "PASSWORD_TOO_SHORT",
  passwordTooLong: "PASSWORD_TOO_LONG",
  rateLimited: "RATE_LIMITED",
  unauthenticated: "UNAUTHENTICATED",
  internal: "INTERNAL",
} as const;
export type AuthErrorCode = (typeof AUTH_ERROR)[keyof typeof AUTH_ERROR];

export const AUTH_STATUS: Readonly<Record<AuthErrorCode, number>> = {
  ACCOUNTS_OFF: 404,
  INVALID_INPUT: 400,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_LOCKED: 403,
  SIGNUP_CLOSED: 403,
  EMAIL_TAKEN: 409,
  PASSWORD_TOO_SHORT: 400,
  PASSWORD_TOO_LONG: 400,
  RATE_LIMITED: 429,
  UNAUTHENTICATED: 401,
  INTERNAL: 500,
};

/** A typed refusal. The message is the code: never an address, a password or a token. */
export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = "AuthError";
  }
}
