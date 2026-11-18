import { readFileSync, writeFileSync } from "node:fs";

import { KridocLogo } from "@krizaka/ui";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GET as socialCard } from "@/app/og.png/route";
import { BRAND_MARK_FILE } from "@/lib/brand-mark";

/* krizaka-internal#4212: kridoc.com shows the current Kridoc mark of @krizaka/ui (the sapphire crane: neck, beak, two wings, a lit
   eye), never the older glyph. The mark's own paths carry the proof: a gradient neck stroke, a beak, wings, an eye core. */
const still = () => renderToStaticMarkup(createElement(KridocLogo, { size: 64, animated: false }));

describe("the Kridoc logo", () => {
  it("is the crane mark of the latest @krizaka/ui", () => {
    const svg = renderToStaticMarkup(createElement(KridocLogo, { size: 24, title: "Kridoc" }));
    expect(svg).toContain("<linearGradient");
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg.match(/<path/g)?.length).toBeGreaterThanOrEqual(4);
    expect(svg.match(/<circle/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("is the favicon file (app/icon.svg), in step with the installed package", () => {
    if (process.env.UPDATE_BRAND_MARK === "1") writeFileSync(BRAND_MARK_FILE, `${still()}\n`);
    expect(readFileSync(BRAND_MARK_FILE, "utf8").trim()).toBe(still());
  });

  it("is on the social card", async () => {
    const res = await socialCard();
    expect(res.headers.get("content-type")).toBe("image/png");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(5000);
  });
});
