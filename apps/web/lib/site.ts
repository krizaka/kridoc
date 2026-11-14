import { org } from "@krizaka/org";

/** Addresses of the site — structure, not words (the words are in messages/). */
export const SITE_URL = new URL("https://www.kridoc.com").origin;
export const REPO_URL = "https://github.com/krizaka/kridoc";
/** The company site: the way back to the family, and the publisher of every JSON-LD node. */
export const KRIZAKA_URL = "https://www.krizaka.com";
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";
/** The one contact, « Nous écrire »: the contact page of `@krizaka/org` in the page's language, with the product as the topic and this site as the
 *  source (`kridoc-com`), so a message says where it came from. */
export const contactUrl = (locale: "fr" | "en") => `${org.contact.page[locale]}?topic=kridoc&source=kridoc-com`;
/** The products section of krizaka.com, where the family presents every product. */
export const productsUrl = (locale: string) => `${KRIZAKA_URL}/${locale}#products`;
/** The release notes of Kridoc: krizaka.com's changelog, filtered on it. */
export const releaseNotesUrl = (locale: string) => `${KRIZAKA_URL}/${locale}/changelog?produit=kridoc`;
