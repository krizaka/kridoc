/* Search engines and AI assistants (the Krizaka family contract, scripts/check-seo-family.mjs): canonical, hreflang, social cards
   and the JSON-LD of the site, every node leading back to the Krizaka Organization (the publisher). */
import type { Metadata } from "next";

import { getDictionary, type Locale } from "@/lib/i18n";
import { KRIZAKA_URL, REPO_URL, SITE_URL } from "@/lib/site";

export const ORG_ID = `${KRIZAKA_URL}/#organization`;
const ORG = { "@type": "Organization", "@id": ORG_ID, name: "Krizaka", url: KRIZAKA_URL };
/** The social card, drawn at build by app/og.png/route.tsx. */
export const OG_IMAGE = `${SITE_URL}/og.png`;

/** The search bots and AI crawlers the whole family welcomes - the same list on every site. */
export const CRAWLERS = [
  "Googlebot",
  "Google-Extended",
  "Bingbot",
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "Claude-SearchBot",
  "Claude-User",
  "ClaudeBot",
  "anthropic-ai",
  "Applebot",
  "Applebot-Extended",
  "CCBot",
] as const;

export function pageMetadata(locale: Locale): Metadata {
  const t = getDictionary(locale);
  const url = `${SITE_URL}/${locale}`;
  return {
    title: { absolute: t.meta.siteName },
    description: t.meta.description,
    alternates: {
      canonical: url,
      languages: { en: `${SITE_URL}/en`, fr: `${SITE_URL}/fr`, "x-default": `${SITE_URL}/fr` },
    },
    openGraph: {
      type: "website",
      siteName: t.meta.siteName,
      title: t.meta.siteName,
      description: t.meta.description,
      url,
      locale: locale === "en" ? "en_CA" : "fr_CA",
      images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: t.meta.siteName }],
    },
    twitter: {
      card: "summary_large_image",
      title: t.meta.siteName,
      description: t.meta.description,
      images: [OG_IMAGE],
    },
  };
}

/** The site, published by Krizaka. No SoftwareApplication: Kridoc is in design, nothing is built or offered yet. */
export function siteJsonLd(locale: Locale) {
  const t = getDictionary(locale);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: `${SITE_URL}/`,
        name: t.meta.siteName,
        description: t.meta.description,
        inLanguage: ["fr", "en"],
        publisher: ORG,
      },
    ],
  };
}

/** llms.txt (llmstxt.org): what the site is, its key pages, its source, and the way back to the family. Words come from messages/. */
export function llmsText(): string {
  const en = getDictionary("en");
  return `# ${en.meta.siteName}

> ${en.meta.description}

## Key pages

- [${getDictionary("fr").home.title} (fr)](${SITE_URL}/fr)
- [${en.home.title} (en)](${SITE_URL}/en): ${en.home.lead} ${en.home.status}.

## Source

- [Repository](${REPO_URL})

## Publisher

- [Krizaka](${KRIZAKA_URL}): the company, an open-source software studio in Montréal

Languages: French and English. Sitemap: ${SITE_URL}/sitemap.xml
`;
}
