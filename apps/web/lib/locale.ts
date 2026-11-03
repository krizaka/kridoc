import { asLocale, type Locale } from "@/lib/i18n";

/**
 * The language of an address that has none (Quebec's Charter of the French language, Loi 96): the visitor's earlier choice
 * (the `NEXT_LOCALE` cookie), else English only when the browser asks for English before French, else French.
 */
export function preferredLocale(cookie: string | undefined, acceptLanguage: string | null): Locale {
  if (cookie === "en" || cookie === "fr") return asLocale(cookie);
  const asked = (acceptLanguage ?? "")
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase() ?? "")
    .find((tag) => tag.startsWith("en") || tag.startsWith("fr"));
  return asked?.startsWith("en") ? "en" : "fr";
}
