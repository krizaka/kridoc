import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "@/proxy";

const call = (host: string, path = "/fr") => proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }));

describe("the proxy on the dev host", () => {
  it("marks every answer of dev.kridoc.com noindex", () => {
    expect(call("dev.kridoc.com").headers.get("x-robots-tag")).toContain("noindex");
    expect(call("dev.kridoc.com", "/").headers.get("x-robots-tag")).toContain("noindex");
  });
  it("leaves www indexable", () => {
    expect(call("www.kridoc.com").headers.get("x-robots-tag")).toBeNull();
  });
});
