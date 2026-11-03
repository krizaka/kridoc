import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

// Kridoc is in design (founder, 2026-11-03): the page says what it is and that it is being designed, nothing more.
const PROMISES =
  /beta|bêta|early access|accès anticipé|waiting list|liste d'attente|sign[ -]?up|inscri|launch|lancement|bientôt disponible|coming in|20\d\d/i;

describe("the words of the coming-soon page", () => {
  it("say the status in both languages", () => {
    expect(fr.home.status).toBe("En conception");
    expect(en.home.status).toBe("In design");
  });
  it("make no promise: no feature list, no date, no sign-up, no waiting list", () => {
    for (const text of [...Object.values(fr.home), ...Object.values(en.home), fr.meta.description, en.meta.description])
      expect(text).not.toMatch(PROMISES);
  });
  it("never show the code name", () => {
    expect(JSON.stringify({ en, fr })).not.toMatch(/kachizaka/i);
  });
});
