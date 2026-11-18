import { ActivityFeed } from "@krizaka/ui/activity-feed";
import { PageHeader } from "@krizaka/ui/page-header";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { storageAdminRuntime } from "@/app/storage-admin-edge";
import { systemClock } from "@/app/system-clock";
import { StorageSettingsForm } from "@/components/StorageSettingsForm";
import { ACCOUNT_ROLE } from "@/lib/auth/account-store";
import { AUTH_ERROR, AuthError } from "@/lib/auth/errors";
import { readEnv } from "@/lib/env";
import { asLocale, format, getDictionary, type Messages } from "@/lib/i18n";
import { storageAuditEventOf } from "@/lib/storage/storage-audit-view";
import { STORAGE_SETTING } from "@/lib/storage/storage-settings";
import type { StorageSettingView } from "@/lib/storage/storage-settings-admin";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = getDictionary(asLocale((await params).locale));
  return { title: t.storageAdmin.meta.title, robots: { index: false, follow: false } };
}

/** The signed-in administrator, or the sign-in (back to this screen) for a visitor without a session, or « not found » for anyone else. */
async function administratorOf(runtime: ReturnType<typeof storageAdminRuntime>, locale: string) {
  const here = encodeURIComponent(`/${locale}/admin/storage`);
  const actor = await runtime.actorOf(await headers()).catch((error: unknown) => {
    if (error instanceof AuthError && error.code === AUTH_ERROR.unauthenticated)
      redirect(`/${locale}/sign-in?next=${here}`);
    throw error;
  });
  if (actor.role !== ACCOUNT_ROLE.admin) notFound();
  return actor;
}

/** What the form shows: its words (the bounds in the hints, drawn from the registry) and the values now. */
function formPropsOf(t: Messages["storageAdmin"], settings: StorageSettingView[]) {
  const view = Object.fromEntries(settings.map((s) => [s.key, s]));
  const hint = (text: string, key: string) => format(text, { min: view[key]?.min ?? 0, max: view[key]?.max ?? 0 });
  const value = (key: string) => view[key]?.value;
  return {
    labels: {
      title: t.title,
      maxMb: { label: t.maxMb.label, hint: hint(t.maxMb.hint, STORAGE_SETTING.maxMb) },
      signedUrlSeconds: {
        label: t.signedUrlSeconds.label,
        hint: hint(t.signedUrlSeconds.hint, STORAGE_SETTING.signedUrlSeconds),
      },
      retentionDays: { label: t.retentionDays.label, hint: hint(t.retentionDays.hint, STORAGE_SETTING.retentionDays) },
      quotaMb: { label: t.quotaMb.label, hint: hint(t.quotaMb.hint, STORAGE_SETTING.quotaMb) },
      quotaObjects: { label: t.quotaObjects.label, hint: hint(t.quotaObjects.hint, STORAGE_SETTING.quotaObjects) },
      scanTimeoutSeconds: {
        label: t.scanTimeoutSeconds.label,
        hint: hint(t.scanTimeoutSeconds.hint, STORAGE_SETTING.scanTimeoutSeconds),
      },
      types: t.types,
      save: t.save,
      saved: t.saved,
      failed: t.errors.INTERNAL,
    },
    current: {
      maxMb: value(STORAGE_SETTING.maxMb) as number,
      signedUrlSeconds: value(STORAGE_SETTING.signedUrlSeconds) as number,
      retentionDays: value(STORAGE_SETTING.retentionDays) as number,
      quotaMb: value(STORAGE_SETTING.quotaMb) as number,
      quotaObjects: value(STORAGE_SETTING.quotaObjects) as number,
      scanTimeoutSeconds: value(STORAGE_SETTING.scanTimeoutSeconds) as number,
      types: value(STORAGE_SETTING.allowedTypes) as string[],
    },
  };
}

/**
 * The storage settings of Kridoc's administrator, on @krizaka/ui. Not found while the accounts are off, and for anyone who is not an
 * administrator (the screen is not even named); a visitor without a session goes to the sign-in.
 */
export default async function StorageAdminPage({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const locale = asLocale((await params).locale);
  if (readEnv().AUTH_ENABLED !== "on") notFound();
  const runtime = storageAdminRuntime();
  const actor = await administratorOf(runtime, locale);
  const t = getDictionary(locale).storageAdmin;
  const [settings, recent] = await Promise.all([runtime.admin.current(actor), runtime.admin.recent(actor)]);
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
      <PageHeader title={t.title} description={t.description} />
      <StorageSettingsForm locale={locale} {...formPropsOf(t, settings)} />
      <section aria-labelledby="storage-audit" className="flex flex-col gap-3">
        <h2 id="storage-audit" className="text-lg font-semibold text-fg">
          {t.auditTitle}
        </h2>
        <ActivityFeed
          aria-label={t.auditTitle}
          locale={locale}
          now={systemClock.now()}
          events={recent.map((entry) => storageAuditEventOf(entry, t.actions))}
          empty={t.auditEmpty}
        />
      </section>
    </main>
  );
}
