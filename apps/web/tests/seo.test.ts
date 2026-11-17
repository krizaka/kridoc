import { describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({ value: "www.kridoc.com" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: host.value }) }));

import { GET } from "@/app/llms.txt/route";
import { llmsText } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";

describe("llms.txt", () => {
  it("names the site, links its pages and its sitemap, and leads back to Krizaka", () => {
    const text = llmsText();
    expect(text.startsWith("# ")).toBe(true);
    expect(text).toContain(`${SITE_URL}/en`);
    expect(text).toContain(`${SITE_URL}/sitemap.xml`);
    expect(text).toContain("https://www.krizaka.com");
  });
  it("is served as plain text", async () => {
    const res = GET();
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe(llmsText());
  });
});

import robots from "@/app/robots";
import { CRAWLERS, pageMetadata, siteJsonLd } from "@/lib/seo";

describe("the family SEO contract", () => {
  it("robots.txt names every welcomed crawler", async () => {
    host.value = "www.kridoc.com";
    const rules = (await robots()).rules;
    const agents = (Array.isArray(rules) ? rules : [rules]).map((r) => r.userAgent);
    for (const bot of CRAWLERS) expect(agents).toContain(bot);
  });
  it("robots.txt of the dev host shuts the door", async () => {
    host.value = "dev.kridoc.com";
    expect((await robots()).rules).toEqual({ userAgent: "*", disallow: "/" });
  });
  it("every page has a canonical, social cards and a JSON-LD that leads back to Krizaka", () => {
    const meta = pageMetadata("en");
    expect(meta.alternates?.canonical).toBe(`${SITE_URL}/en`);
    expect(meta.openGraph?.images).toBeDefined();
    expect(meta.twitter).toBeDefined();
    expect(JSON.stringify(siteJsonLd("en"))).toContain("https://www.krizaka.com/#organization");
  });
});

describe("a site for a product in development", () => {
  it("is French by default for search engines (x-default) and points every card at the drawn image", () => {
    const meta = pageMetadata("fr");
    expect(meta.alternates?.languages).toMatchObject({ "x-default": `${SITE_URL}/fr` });
    expect(JSON.stringify(meta.openGraph?.images)).toContain(`${SITE_URL}/og.png`);
    expect(SITE_URL).toBe("https://www.kridoc.com");
  });
  it("declares a WebSite published by Krizaka, and no software: nothing is built yet", () => {
    const graph = siteJsonLd("fr")["@graph"];
    expect(graph.map((n) => n["@type"])).toEqual(["WebSite"]);
    expect(graph[0].publisher["@id"]).toBe("https://www.krizaka.com/#organization");
  });
});

describe("the product names its own licence (krizaka-internal#4148)", () => {
  it("llms.txt says FSL-1.1-ALv2 with a link to LICENSE.md and makes no open-source claim", () => {
    const text = llmsText();
    expect(text).toContain("FSL-1.1-ALv2");
    expect(text).toContain("https://github.com/krizaka/kridoc/blob/main/LICENSE.md");
    expect(text).not.toMatch(/Apache|\bMIT\b|open[- ]source|\blibre\b/i);
  });
});
