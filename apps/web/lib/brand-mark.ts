/* The Kridoc mark of @krizaka/ui as a file (krizaka-internal#4212): `app/icon.svg` is the favicon (Next serves it), and the social card
   (`app/og.png/route.tsx`) draws the same file. The file is the still mark rendered from the package; `tests/brand-logo.test.ts` fails
   when it drifts from the installed @krizaka/ui (`UPDATE_BRAND_MARK=1 pnpm --filter @kridoc/web test` rewrites it). */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const BRAND_MARK_FILE = join(process.cwd(), "app", "icon.svg");

export function brandMarkSource(): string {
  return `data:image/svg+xml;base64,${readFileSync(BRAND_MARK_FILE).toString("base64")}`;
}
