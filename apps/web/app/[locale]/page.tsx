/* The coming-soon page of www.kridoc.com (krizaka-internal#3595), shaped like krizaka-coming-soon's: Kridoc is in development, not
   open. The mark, the name, its one line, its true stage, one sentence (not open, sign-up closed, write to us), one action; then the
   family's footer. No feature, no date, no sign-up, no waiting list, no stock picture (the hero's `aside` stays empty until a reel exists).
   Words: messages/<locale>.json; the contact page and the legal line: @krizaka/org; the mark and the blocks: @krizaka/ui. */
import { org } from "@krizaka/org";
import { KridocLogo } from "@krizaka/ui";
import { Button } from "@krizaka/ui/button";
import { languagesFor } from "@krizaka/ui/language-switch/server";
import { NavBarActions, NavBarBrand, NavBarItems, NavBarLanguage, NavBarLink, NavBarRoot } from "@krizaka/ui/nav-bar";
import { PageHero } from "@krizaka/ui/page-hero";
import { SiteFooter, SiteFooterColumn, SiteFooterLink } from "@krizaka/ui/site-footer";
import { familyLabels } from "@krizaka/ui/sites";
import { Stamp } from "@krizaka/ui/specimen-tag";
import { ThemeToggle } from "@krizaka/ui/theme";

import { getDictionary, type Locale, LOCALES } from "@/lib/i18n";
import { siteJsonLd } from "@/lib/seo";
import { contactUrl, KRIZAKA_URL, LICENSE_URL, productsUrl, releaseNotesUrl, REPO_URL } from "@/lib/site";

type Dictionary = ReturnType<typeof getDictionary>;

/** The bar: the mark, a plain link to krizaka.com (no family switcher), the language and the theme. */
function Bar({ locale, t }: Readonly<{ locale: Locale; t: Dictionary }>) {
  return (
    <NavBarRoot label={t.home.navLabel} floating={false} compactAfter={false}>
      <NavBarBrand href={`/${locale}/`}>
        <KridocLogo size={24} title={t.home.title} />
        {t.home.title}
      </NavBarBrand>
      <NavBarItems>
        <NavBarLink href={`${KRIZAKA_URL}/${locale}`} aria-label={t.home.backAria}>
          {t.home.back}
        </NavBarLink>
      </NavBarItems>
      <NavBarActions>
        <NavBarLanguage label={t.home.language} current={locale} languages={languagesFor(`/${locale}`, LOCALES)} />
        <ThemeToggle label={t.home.theme} variant="ghost" />
      </NavBarActions>
    </NavBarRoot>
  );
}

/* Follow-up #3562: the footer's links come from the org JSON (`footerFor`) once Kridoc is a site of it; `org` itself is not passed
   to the client footer (47 KB of facts), only the legal links are read from it. */
function FamilyFooter({ locale, t }: Readonly<{ locale: Locale; t: Dictionary }>) {
  const legal = [
    <SiteFooterLink key="license" href={LICENSE_URL} aria-label={t.footer.licenseAria}>
      {t.footer.license}
    </SiteFooterLink>,
    ...org.footer.legal.map((l) => (
      <SiteFooterLink key={l.id} href={l.url[locale]}>
        {l.label[locale]}
      </SiteFooterLink>
    )),
  ];
  return (
    <SiteFooter
      current="krizaka"
      family={false}
      labels={familyLabels[locale]}
      aria-label={t.footer.label}
      legal={legal}
    >
      <SiteFooterColumn title={t.footer.label}>
        <SiteFooterLink href={releaseNotesUrl(locale)} aria-label={t.footer.releaseNotesAria}>
          {t.footer.releaseNotes}
        </SiteFooterLink>
        <SiteFooterLink href={REPO_URL} aria-label={t.footer.sourceAria}>
          {t.footer.source}
        </SiteFooterLink>
        <SiteFooterLink href={productsUrl(locale)} aria-label={t.footer.productsAria}>
          {t.footer.products}
        </SiteFooterLink>
      </SiteFooterColumn>
    </SiteFooter>
  );
}

export default async function Home({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = (await params).locale as Locale;
  const t = getDictionary(locale);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd(locale)) }} />
      <Bar locale={locale} t={t} />
      <main>
        <PageHero align="start" backdrop="plain" eyebrow={t.home.byline} title={t.home.title} lead={t.home.lead}>
          <div className="flex flex-col items-start gap-5">
            <Stamp tone="wip">{t.home.status}</Stamp>
            <p className="max-w-xl text-fg-secondary">{t.home.notOpen}</p>
            <Button asChild variant="primary" size="lg">
              <a href={contactUrl(locale)} aria-label={t.home.contactAria}>
                {t.home.contact}
              </a>
            </Button>
          </div>
        </PageHero>
      </main>
      <FamilyFooter locale={locale} t={t} />
    </>
  );
}
