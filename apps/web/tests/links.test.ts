import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { contactUrl, productsUrl } from "@/lib/site";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

// Réunion 6 (2026-11-05, krizaka-internal#2629): Kridoc's waiting page has one contact, « Nous écrire » (krizaka.com's form, with
// the product and this site as the source), and « Nos produits » on krizaka.com; its line is the canonical one.
describe("the links of the waiting page", () => {
  it("lead to krizaka.com in the page's language", () => {
    expect(contactUrl("fr")).toBe("https://www.krizaka.com/fr/contact?topic=kridoc&source=kridoc-com");
    expect(contactUrl("en")).toBe("https://www.krizaka.com/en/contact?topic=kridoc&source=kridoc-com");
    expect(productsUrl("fr")).toBe("https://www.krizaka.com/fr#products");
    expect(productsUrl("en")).toBe("https://www.krizaka.com/en#products");
  });
  it("are on the page, each once", () => {
    const page = readFileSync(new URL("../app/[locale]/page.tsx", import.meta.url), "utf8");
    for (const href of ["contactUrl(locale)", "productsUrl(locale)"])
      expect(page.split(`href={${href}}`).length - 1).toBe(1);
  });
  it("say « Nous écrire » and « Nos produits »", () => {
    expect([fr.home.contact, fr.home.products]).toEqual(["Nous écrire", "Nos produits"]);
    expect([en.home.contact, en.home.products]).toEqual(["Write to us", "Our products"]);
  });
  it("say the canonical line, without the jargon", () => {
    expect(fr.home.lead).toBe("Vos documents d'entreprise, rangés et retrouvés.");
    expect(en.home.lead).toBe("Your company documents, filed and found.");
    expect(JSON.stringify({ fr, en })).not.toMatch(/stockage documentaire|document storage/i);
  });
});
