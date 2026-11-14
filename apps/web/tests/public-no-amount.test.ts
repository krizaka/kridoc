import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

// No price anywhere on a public page (founder, 2026-11-03; rule public-no-amount of krizaka/.github): no money amount, no currency,
// no « à partir de », no « sur devis ». The catalogues and the page's source are read; there is no exemption on this site.
const AMOUNT = /\d\s?\$|\$\s?\d|\d\s?€|€\s?\d|\b(?:CAD|USD|EUR)\b/;
const PRICE_WORDS = /à partir de|sur devis|\bfrom \$|on quote|\bprix\b|\bprice\b|\bpricing\b|\btarif/i;

const strings = (node: unknown): string[] =>
  typeof node === "string" ? [node] : node && typeof node === "object" ? Object.values(node).flatMap(strings) : [];

const offending = (texts: string[]) => texts.filter((t) => AMOUNT.test(t) || PRICE_WORDS.test(t));

describe("public-no-amount: no money amount in the public words", () => {
  it("the guard sees an amount, a currency and a price word", () => {
    expect(offending(["120 $", "$29", "99 €", "10 CAD", "À partir de 5", "Sur devis", "Pricing"])).toHaveLength(7);
    expect(offending(["Your company documents, filed and found."])).toEqual([]);
  });
  it.each([
    ["en", en],
    ["fr", fr],
  ])("%s: the catalogue carries no amount", (_locale, messages) => {
    expect(offending(strings(messages))).toEqual([]);
  });
  it("the page and the site's addresses carry no amount either", () => {
    for (const file of ["../app/[locale]/page.tsx", "../lib/site.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(
        source.split("\n").filter((l) => AMOUNT.test(l)),
        file,
      ).toEqual([]);
    }
  });
});
