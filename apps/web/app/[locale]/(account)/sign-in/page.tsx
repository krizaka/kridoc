import { isLocalReturn } from "@krizaka/auth";
import { KridocLogo } from "@krizaka/ui";
import { AuthLayout } from "@krizaka/ui/auth-layout";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SignInForm } from "@/components/SignInForm";
import { readEnv } from "@/lib/env";
import { asLocale, getDictionary } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getDictionary(asLocale((await params).locale));
  return { title: t.auth.meta.signIn, robots: { index: false, follow: false } };
}

/** Sign-in on @krizaka/ui's auth layout. Not found while the accounts feature is off; says « Sign-up closed » while AUTH_SIGNUP is closed. */
export default async function SignInPage({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string }> }>) {
  const env = readEnv();
  if (env.AUTH_ENABLED !== "on") notFound();
  const locale = asLocale((await params).locale);
  const t = getDictionary(locale).auth.signIn;
  const { next } = await searchParams;
  // Back to where the visitor came from, only a path of this site (never another address).
  const returnTo = next && isLocalReturn(next) ? next : `/${locale}`;
  return (
    <AuthLayout
      brand={
        <Link href={`/${locale}`} className="inline-flex items-center gap-2">
          <KridocLogo size={28} /> Kridoc
        </Link>
      }
      promise={t.promise}
      title={t.title}
      description={t.description}
      footer={
        env.AUTH_SIGNUP === "open" ? undefined : (
          <>
            <strong className="block font-semibold text-fg">{t.closedTitle}</strong>
            <span className="block">{t.closed}</span>
          </>
        )
      }
    >
      <SignInForm labels={t} locale={locale} next={returnTo} />
    </AuthLayout>
  );
}
