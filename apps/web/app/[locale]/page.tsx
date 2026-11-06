/* The coming-soon page of www.kridoc.com (founder, 2026-11-03, krizaka-internal#2143): Kridoc is in design. It says what Kridoc
   is in one line, that it is being designed, and leads back to krizaka.com — no feature, no date, no sign-up, no waiting list.
   Words: messages/<locale>.json (home.*); the mark is @krizaka/ui's; colours are tokens only. */
import { KridocLogo } from "@krizaka/ui";
import { Button } from "@krizaka/ui/button";
import { LanguageSwitch } from "@krizaka/ui/language-switch";
import { languagesFor } from "@krizaka/ui/language-switch/server";
import { Page } from "@krizaka/ui/page";
import { Stamp } from "@krizaka/ui/specimen-tag";
import { ThemeToggle } from "@krizaka/ui/theme";

import { getDictionary, type Locale, LOCALES } from "@/lib/i18n";
import { siteJsonLd } from "@/lib/seo";
import { contactUrl, productsUrl } from "@/lib/site";

export default async function Home({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = (await params).locale as Locale;
  const t = getDictionary(locale);
  return (
    <Page className="flex min-h-screen flex-col py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd(locale)) }} />
      <header className="flex items-center justify-end gap-3">
        <LanguageSwitch
          variant="inline"
          label={t.home.language}
          current={locale}
          languages={languagesFor(`/${locale}`, LOCALES)}
        />
        <ThemeToggle label={t.home.theme} variant="ghost" />
      </header>
      <main className="flex flex-1 flex-col items-start justify-center gap-6 py-16">
        <KridocLogo size={88} title={t.home.title} />
        <p className="font-mono text-sm text-fg-muted">{t.home.byline}</p>
        <h1 className="font-display text-5xl text-fg sm:text-6xl">{t.home.title}</h1>
        <p className="max-w-xl text-xl text-fg-secondary">{t.home.lead}</p>
        <Stamp tone="neutral">{t.home.status}</Stamp>
        <p className="max-w-xl text-fg-secondary">{t.home.body}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="primary" size="lg">
            <a href={contactUrl(locale)} aria-label={t.home.contactAria}>
              {t.home.contact}
            </a>
          </Button>
          <Button asChild variant="secondary" size="lg">
            <a href={productsUrl(locale)} aria-label={t.home.productsAria}>
              {t.home.products}
            </a>
          </Button>
        </div>
      </main>
    </Page>
  );
}
