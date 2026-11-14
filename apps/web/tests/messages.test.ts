import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";

// Kridoc is in development, not open (krizaka-internal#3595): the page says its true stage and that sign-up is closed, nothing more.
const PROMISES =
  /beta|bêta|early access|accès anticipé|waiting list|liste d'attente|launch|lancement|bientôt disponible|coming in|20\d\d/i;

describe("the words of the coming-soon page", () => {
  it("say the true stage in both languages, never « in design »", () => {
    expect(fr.home.status).toBe("En développement");
    expect(en.home.status).toBe("In development");
    expect(JSON.stringify({ en, fr })).not.toMatch(/en conception|in design/i);
  });
  it("say the page is not open, sign-up is closed, and invite to write", () => {
    expect(fr.home.notOpen).toBe("Pas encore ouvert. Inscriptions fermées. Une question, un besoin ? Écrivez-nous.");
    expect(en.home.notOpen).toBe("Not open yet. Sign-up closed. A question, a need? Write to us.");
  });
  it("make no promise: no feature list, no date, no sign-up, no waiting list", () => {
    for (const text of [...Object.values(fr.home), ...Object.values(en.home), fr.meta.description, en.meta.description])
      expect(text).not.toMatch(PROMISES);
  });
  it("never show the code name", () => {
    // the old code name, assembled so that the word itself never appears in this public repository
    expect(JSON.stringify({ en, fr })).not.toMatch(new RegExp(["kachi", "zaka"].join(""), "i"));
  });
});
