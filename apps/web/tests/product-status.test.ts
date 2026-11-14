import { org } from "@krizaka/org";
import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

// One public status per product, the same word everywhere and equal to krizaka.com's (rule product-status-word; réunion 6, 2026-11-05).
// The status itself is the org's (`@krizaka/org` products[].status); until the org carries the words, this table is krizaka.com's
// `site.nav.status.<status>.label` (messages/<locale>.json), keyed by that status.
const WORDS = {
  design: { fr: "En conception", en: "In design" },
  development: { fr: "En développement", en: "In development" },
  paused: { fr: "En pause", en: "Paused" },
} as const;

describe("product-status-word: the status word of the page is krizaka.com's for the org's status", () => {
  const status = org.products.find((p) => p.id === "kridoc")?.status;
  it("the org carries the product with a status that has a word", () => {
    expect(status).toBeDefined();
    expect(Object.keys(WORDS)).toContain(status);
  });
  it("the page says that word, in both languages", () => {
    const word = WORDS[status as keyof typeof WORDS];
    expect([fr.home.status, en.home.status]).toEqual([word.fr, word.en]);
  });
});
