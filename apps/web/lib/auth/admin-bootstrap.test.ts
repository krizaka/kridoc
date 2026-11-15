import { describe, expect, it } from "vitest";

import type { AccountStore } from "./account-store";
import { createAdministrator } from "./admin-bootstrap";

const storeAnswering = (taken: boolean): AccountStore & { made: unknown[] } => {
  const made: unknown[] = [];
  return {
    made,
    findByEmail: async () => null,
    create: async (account) => {
      made.push(account);
      return taken
        ? null
        : ({ id: "1", failedSignIns: 0, status: "ACTIVE", role: "ADMIN", ...account, role2: undefined } as never);
    },
    recordFailure: async () => "ACTIVE",
    recordSuccess: async () => undefined,
  };
};
const hash = async (p: string) => `hashed:${p.length}`;

describe("the first administrator", () => {
  it("is stored as an ADMIN with a hashed password", async () => {
    const store = storeAnswering(false);
    await createAdministrator(store, hash, { email: "Boss@Example.com", password: "a long enough password" });
    expect(store.made).toEqual([{ email: "boss@example.com", passwordHash: "hashed:22", locale: "fr", role: "ADMIN" }]);
  });
  it("refuses a short password, a bad address and an address that has an account", async () => {
    await expect(
      createAdministrator(storeAnswering(false), hash, { email: "a@b.co", password: "short" }),
    ).rejects.toMatchObject({ code: "PASSWORD_TOO_SHORT" });
    await expect(
      createAdministrator(storeAnswering(false), hash, { email: "nope", password: "a long enough password" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      createAdministrator(storeAnswering(true), hash, { email: "a@b.co", password: "a long enough password" }),
    ).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
  });
});
