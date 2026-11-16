import { describe, expect, it } from "vitest";

import { createAccountDirectory } from "./account-directory";

describe("the account directory", () => {
  it("answers each account with its document count as a number and its date as text, never a hash", async () => {
    const query = (async () => [
      {
        id: "a1",
        email: "admin@example.com",
        role: "ADMIN",
        status: "ACTIVE",
        documents: "3",
        created_at: new Date("2026-11-16T10:00:00Z"),
        password_hash: "secret",
      },
    ]) as never;
    const [account] = await createAccountDirectory(query).list();
    expect(account).toEqual({
      id: "a1",
      email: "admin@example.com",
      role: "ADMIN",
      status: "ACTIVE",
      documents: 3,
      createdAt: "2026-11-16T10:00:00.000Z",
    });
  });
});
