import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { LOCALES } from "@/lib/i18n";
import { contactUrl, productsUrl, releaseNotesUrl } from "@/lib/site";
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
    expect(releaseNotesUrl("fr")).toBe("https://www.krizaka.com/fr/changelog?produit=kridoc");
  });
  it("are on the page, each once: the one action, and the footer's three links", () => {
    const page = readFileSync(new URL("../app/[locale]/page.tsx", import.meta.url), "utf8");
    for (const href of ["contactUrl(locale)", "productsUrl(locale)", "releaseNotesUrl(locale)", "REPO_URL"])
      expect(page.split(`href={${href}}`).length - 1).toBe(1);
  });
  it("say « Nous écrire », and the footer's « Journal des versions · Code source · Nos produits »", () => {
    expect([fr.home.contact, fr.footer.releaseNotes, fr.footer.source, fr.footer.products]).toEqual([
      "Nous écrire",
      "Journal des versions",
      "Code source",
      "Nos produits",
    ]);
    expect([en.home.contact, en.footer.releaseNotes, en.footer.source, en.footer.products]).toEqual([
      "Contact us",
      "Release notes",
      "Source code",
      "Our products",
    ]);
  });
  it("list French first: the first language is the default one", () => {
    expect(LOCALES[0]).toBe("fr");
  });
  it("say the canonical line, without the jargon", () => {
    expect(fr.home.lead).toBe("Vos documents d'entreprise, rangés et retrouvés.");
    expect(en.home.lead).toBe("Your company documents, filed and found.");
    expect(JSON.stringify({ fr, en })).not.toMatch(/stockage documentaire|document storage/i);
  });
});
