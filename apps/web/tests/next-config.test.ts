import { describe, expect, it } from "vitest";

import { DEV_HOST } from "@/lib/dev-host";

import nextConfig from "../next.config.mjs";

describe("next.config headers", () => {
  it("marks every address of the dev host noindex, robots.txt included", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const dev = rules.find((r) => r.has?.some((h) => h.type === "host" && h.value === DEV_HOST));
    expect(dev?.source).toBe("/:path*");
    expect(dev?.headers).toContainEqual({ key: "X-Robots-Tag", value: "noindex, nofollow" });
  });
});
