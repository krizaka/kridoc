import { describe, expect, it } from "vitest";

describe("the stand-in for the optional opendal binding", () => {
  it("fails to load, as a missing package does", async () => {
    await expect(import("./opendal-absent")).rejects.toThrow("opendal is not installed in Kridoc");
  });
});
