import { describe, expect, it } from "vitest";

import { parseInput, signInInput, signUpInput } from "./credentials";
import { AuthError } from "./errors";

describe("the edge parsing of the credentials", () => {
  it("trims and lower-cases the address", () => {
    expect(parseInput(signInInput, { email: "  Ada@Example.COM ", password: "x" })).toEqual({
      email: "ada@example.com",
      password: "x",
    });
  });
  it("refuses anything that is not the shape, with a typed error that echoes nothing", () => {
    for (const body of [
      null,
      "x",
      {},
      { email: "not-an-address", password: "x" },
      { email: "a@b.co", password: "" },
      { email: "a@b.co" },
    ]) {
      let thrown: unknown;
      try {
        parseInput(signInInput, body);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(AuthError);
      expect((thrown as AuthError).code).toBe("INVALID_INPUT");
      expect((thrown as AuthError).message).toBe("INVALID_INPUT");
    }
  });
  it("bounds the password so a request cannot make the server hash a huge string", () => {
    expect(() => parseInput(signInInput, { email: "a@b.co", password: "x".repeat(257) })).toThrow(AuthError);
  });
  it("takes a language of the closed set only", () => {
    expect(parseInput(signUpInput, { email: "a@b.co", password: "p", locale: "en" }).locale).toBe("en");
    expect(() => parseInput(signUpInput, { email: "a@b.co", password: "p", locale: "de" })).toThrow(AuthError);
  });
});
