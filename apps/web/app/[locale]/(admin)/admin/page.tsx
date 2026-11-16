import { redirect } from "next/navigation";

import { asLocale } from "@/lib/i18n";

/** The admin's front door is its users list. */
export default async function AdminIndex({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  redirect(`/${asLocale((await params).locale)}/admin/users`);
}
