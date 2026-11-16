import { EmptyState } from "@krizaka/ui/empty-state";
import { PageHeader } from "@krizaka/ui/page-header";
import type { Metadata } from "next";
import Link from "next/link";

import { accountOfPage } from "@/app/account-pages-edge";
import { documentsRuntime } from "@/app/documents-edge";
import { DocumentsTable } from "@/components/DocumentsTable";
import { SignOutButton } from "@/components/SignOutButton";
import { ACCOUNT_ROLE } from "@/lib/auth/account-store";
import { readEnv } from "@/lib/env";
import { asLocale, getDictionary } from "@/lib/i18n";
import { type DocumentView, documentView } from "@/lib/storage/document-service";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getDictionary(asLocale((await params).locale));
  return { title: t.account.meta.title, robots: { index: false, follow: false } };
}

/** The person's documents; none while the documents feature is off. */
async function documentsOf(accountId: string): Promise<DocumentView[]> {
  if (readEnv().MEDIA_STORAGE_ENABLED !== "on") return [];
  return (await documentsRuntime().service.list(accountId)).map(documentView);
}

/** The client space: who is signed in, their documents (or the empty state), sign-out; an administrator also finds the way to the admin. */
export default async function AccountPage({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  const account = await accountOfPage(locale, `/${locale}/account`);
  const t = getDictionary(locale).account;
  const documents = await documentsOf(account.id);
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-10">
      <PageHeader
        title={t.title}
        description={account.email}
        actions={
          <div className="flex items-center gap-3">
            {account.role === ACCOUNT_ROLE.admin ? (
              <Link href={`/${locale}/admin/users`} className="text-sm font-medium text-fg-accent hover:underline">
                {t.adminLink}
              </Link>
            ) : null}
            <SignOutButton label={t.signOut} locale={locale} />
          </div>
        }
      />
      <section aria-labelledby="account-documents" className="flex flex-col gap-3">
        <h2 id="account-documents" className="text-lg font-semibold text-fg">
          {t.documents.title}
        </h2>
        {documents.length === 0 ? (
          <EmptyState title={t.documents.empty} description={t.documents.emptyHint} />
        ) : (
          <DocumentsTable documents={documents} labels={t.documents.table} />
        )}
      </section>
    </main>
  );
}
