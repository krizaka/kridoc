import { krizakaUi } from "@krizaka/config/eslint/krizaka-ui";
import { krizakaNext } from "@krizaka/config/eslint/next";
import { krizakaStack } from "@krizaka/config/eslint/stack";

const config = [
  ...krizakaNext,
  // The four UI rules of the Krizaka platform (no raw palette, no `light:`, no `[var(--…)]`, no className template).
  ...krizakaUi(),
  // The Sonar code rules (the whole eslint-plugin-sonarjs recommended set, cognitive complexity 15) fail the lint: SonarCloud
  // analyses public repositories only, so the same rules run here, in CI, with nothing recorded as debt.
  ...krizakaStack({ complexity: "error", sonar: "error", codeRules: "off" }),
  { ignores: [".next/**", "next-env.d.ts"] },
];

export default config;
