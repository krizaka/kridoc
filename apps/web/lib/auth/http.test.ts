import { RateLimited } from "@krizaka/rate-limit";
import { describe, expect, it, vi } from "vitest";

import { AuthError } from "./errors";
import { refusal } from "./http";

const asking = (headers: Record<string, string> = {}) =>
  new Request("https://www.kridoc.com/api/auth/sign-in", { headers });

describe("the one mapping of a refusal to HTTP", () => {
  it("takes the status from the code and the words from the catalogue, in the visitor's language", async () => {
    const fr = refusal(new AuthError("SIGNUP_CLOSED"), asking());
    expect(fr.status).toBe(403);
    expect(await fr.json()).toMatchObject({
      code: "SIGNUP_CLOSED",
      status: 403,
      detail: "Inscriptions fermées. Kridoc n'est pas encore ouvert.",
    });
    const en = refusal(new AuthError("SIGNUP_CLOSED"), asking({ "accept-language": "en-CA" }));
    expect((await en.json()).detail).toBe("Sign-up closed. Kridoc is not open yet.");
    expect(en.headers.get("cache-control")).toBe("private, no-store");
  });
  it("answers the limiter's refusal with 429 and Retry-After", async () => {
    const response = refusal(new RateLimited(42, "ip"), asking());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect((await response.json()).code).toBe("RATE_LIMITED");
  });
  it("hides anything unexpected behind INTERNAL and logs only its kind, never its message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = refusal(new Error("password=hunter2 token=abc"), asking());
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("hunter2");
    expect(log.mock.calls.flat().join(" ")).not.toContain("hunter2");
    log.mockRestore();
  });
});
