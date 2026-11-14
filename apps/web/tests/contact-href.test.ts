import { readFileSync } from "node:fs";

import { org } from "@krizaka/org";
import { describe, expect, it } from "vitest";

import { LOCALES } from "@/lib/i18n";
import { contactUrl } from "@/lib/site";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

// One contact path (rule one-contact-path; réunion 6, 2026-11-05): « Nous écrire » / « Contact us » leads to krizaka.com/{fr|en}/contact
// with the topic (the product) and the source (this site). The address is the org's contact page, never typed here.
describe("one-contact-path: every contact link goes to krizaka.com's contact page with topic and source", () => {
  it.each(LOCALES)("%s: the contact href is the org's contact page, with topic and source", (locale) => {
    const url = new URL(contactUrl(locale));
    expect(`${url.origin}${url.pathname}`).toBe(org.contact.page[locale]);
    expect(url.origin).toBe("https://www.krizaka.com");
    expect(url.pathname).toBe(`/${locale}/contact`);
    expect(url.searchParams.get("topic")).toBe("kridoc");
    expect(url.searchParams.get("source")).toBe("kridoc-com");
  });
  it("the page has no other contact: no mailto, no address typed, no contact link but contactUrl", () => {
    const page = readFileSync(new URL("../app/[locale]/page.tsx", import.meta.url), "utf8");
    expect(page).not.toMatch(/mailto:|\/contact["'`]/);
    expect(page.split("contactUrl(locale)").length - 1).toBe(1);
    expect(JSON.stringify({ fr, en })).not.toMatch(/mailto:|[\w.-]+@[\w-]+\.\w+/);
  });
});
