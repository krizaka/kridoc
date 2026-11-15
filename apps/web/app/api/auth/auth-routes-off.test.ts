import { describe, expect, it } from "vitest";

import { POST as signIn } from "./sign-in/route";
import { POST as signOut } from "./sign-out/route";
import { POST as signUp } from "./sign-up/route";

/** The accounts feature is off by default: no account route answers, whatever is sent. */
describe("the account routes while AUTH_ENABLED is off (the default)", () => {
  for (const [name, post] of [
    ["sign-in", signIn],
    ["sign-up", signUp],
    ["sign-out", signOut],
  ] as const) {
    it(`${name} answers 404 and reads no body`, async () => {
      const response = await post(
        new Request(`https://www.kridoc.com/api/auth/${name}`, { method: "POST", body: "not json" }),
      );
      expect(response.status).toBe(404);
      expect((await response.json()).code).toBe("ACCOUNTS_OFF");
    });
  }
});
