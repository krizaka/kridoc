import { describe, expect, it } from "vitest";

import { NO_STORE, storedFileHeaders } from "./stored-file";

describe("storedFileHeaders", () => {
  it("is an attachment, sandboxed, never sniffed and never cached", () => {
    expect(storedFileHeaders("attachment")).toEqual({
      "Content-Disposition": "attachment",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
  });

  it("carries the given disposition", () => {
    expect(storedFileHeaders('attachment; filename="a.pdf"')["Content-Disposition"]).toBe('attachment; filename="a.pdf"');
  });

  it("NO_STORE is the one never-cached header", () => {
    expect(NO_STORE).toEqual({ "Cache-Control": "private, no-store" });
  });
});
