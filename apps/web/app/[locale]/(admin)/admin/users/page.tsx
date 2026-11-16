import { PageHeader } from "@krizaka/ui/page-header";
import type { Metadata } from "next";
import Link from "next/link";

import { accountDirectory, administratorOfPage } from "@/app/account-pages-edge";
import { UsersTable } from "@/components/UsersTable";
import { asLocale, getDictionary } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getDictionary(asLocale((await params).locale));
  return { title: t.usersAdmin.meta.title, robots: { index: false, follow: false } };
}

/** The administrator's users screen: every account, its role and status. Not found for anyone else; accounts are made with `pnpm auth:create-admin`. */
export default async function UsersAdminPage({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  await administratorOfPage(locale, `/${locale}/admin/users`);
  const t = getDictionary(locale).usersAdmin;
  const users = await accountDirectory().list();
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-10">
      <PageHeader
        title={t.title}
        description={t.description}
        actions={
          <Link href={`/${locale}/admin/storage`} className="text-sm font-medium text-fg-accent hover:underline">
            {t.storageLink}
          </Link>
        }
      />
      <UsersTable users={users} labels={t} />
    </main>
  );
}
