import { describe, expect, it } from "vitest";

import { preferredLocale } from "@/lib/locale";

describe("the language of an address without one", () => {
  it("is French by default", () => {
    expect(preferredLocale(undefined, null)).toBe("fr");
    expect(preferredLocale(undefined, "de-DE,es;q=0.8")).toBe("fr");
  });
  it("is English only when the browser asks for English before French", () => {
    expect(preferredLocale(undefined, "en-CA,fr;q=0.8")).toBe("en");
    expect(preferredLocale(undefined, "fr-CA,en;q=0.8")).toBe("fr");
    expect(preferredLocale(undefined, "de,en-US;q=0.5")).toBe("en");
  });
  it("keeps the visitor's earlier choice", () => {
    expect(preferredLocale("en", "fr-CA")).toBe("en");
    expect(preferredLocale("fr", "en-US")).toBe("fr");
    expect(preferredLocale("xx", "en-US")).toBe("en");
  });
});
