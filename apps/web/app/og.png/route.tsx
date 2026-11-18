/* The social card of the site (lib/seo.ts OG_IMAGE), drawn once at build: the name, its line and its status, in French (the
   default language) and English. The colours are the dark theme's token values (@krizaka/tokens), never typed here. */
import { values } from "@krizaka/tokens";
import { ImageResponse } from "next/og";

import { brandMarkSource } from "@/lib/brand-mark";
import { getDictionary } from "@/lib/i18n";

export const dynamic = "force-static";

const SIZE = { width: 1200, height: 630 } as const;

export async function GET() {
  const fr = getDictionary("fr").home;
  const en = getDictionary("en").home;
  const c = values.dark;
  const mark = await brandMarkSource();
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 88,
        gap: 24,
        background: c.surface0,
        color: c.textPrimary,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 32, fontSize: 112, fontWeight: 700 }}>
        <div
          style={{
            width: 128,
            height: 128,
            backgroundImage: `url(${mark})`,
            backgroundSize: "128px 128px",
            backgroundRepeat: "no-repeat",
          }}
        />
        {fr.title}
      </div>
      <div style={{ fontSize: 44, color: c.textSecondary }}>{fr.lead}</div>
      <div style={{ fontSize: 32, color: c.textMuted }}>{en.lead}</div>
      <div
        style={{
          display: "flex",
          alignSelf: "flex-start",
          marginTop: 24,
          padding: "8px 20px",
          border: `3px solid ${c.borderStrong}`,
          fontSize: 32,
          color: c.textSecondary,
        }}
      >
        {`${fr.status} · ${en.status}`}
      </div>
    </div>,
    SIZE,
  );
}
