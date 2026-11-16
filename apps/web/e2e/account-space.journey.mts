import { expect, type Page, test } from "@playwright/test";

import en from "../messages/en.json" with { type: "json" };
import fr from "../messages/fr.json" with { type: "json" };
import { ADMIN, MEMBER } from "./accounts.mts";

async function signIn(page: Page, who: { email: string; password: string }, locale: "en" | "fr" = "en") {
  const t = (locale === "en" ? en : fr).auth.signIn;
  await page.goto(`/${locale}/sign-in`);
  await page.getByLabel(t.email).fill(who.email);
  await page.getByLabel(t.password).fill(who.password);
  await page.getByRole("button", { name: t.submit }).click();
}

test.describe("the client space", () => {
  test("a member signs in, sees their account and an empty documents list, then signs out", async ({ page }) => {
    await signIn(page, MEMBER);
    await page.waitForURL("**/en/account");
    await expect(page.getByRole("heading", { level: 1, name: en.account.title })).toBeVisible();
    await expect(page.getByText(MEMBER.email)).toBeVisible();
    await expect(page.getByText(en.account.documents.empty)).toBeVisible();

    await page.getByRole("button", { name: en.account.signOut }).click();
    await page.waitForURL("**/en/sign-in");
    // The session is gone: the space sends back to the sign-in.
    await page.goto("/en/account");
    await page.waitForURL("**/en/sign-in?next=%2Fen%2Faccount");
  });

  test("a visitor without a session is sent to the sign-in", async ({ page }) => {
    await page.goto("/fr/account");
    await page.waitForURL("**/fr/sign-in?next=%2Ffr%2Faccount");
    await expect(page.getByLabel(fr.auth.signIn.email)).toBeVisible();
  });

  test("the space speaks French", async ({ page }) => {
    await signIn(page, MEMBER, "fr");
    await page.waitForURL("**/fr/account");
    await expect(page.getByRole("heading", { level: 1, name: fr.account.title })).toBeVisible();
    await expect(page.getByText(fr.account.documents.empty)).toBeVisible();
  });

  test("a wrong password stays on the sign-in with the catalogue's words", async ({ page }) => {
    await signIn(page, { email: MEMBER.email, password: "not-the-password-123" });
    await expect(page.getByText(en.auth.errors.INVALID_CREDENTIALS)).toBeVisible();
  });
});

test.describe("the admin", () => {
  test("an administrator signs in and lists the users with their roles", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.waitForURL("**/en/account");
    await page.getByRole("link", { name: en.account.adminLink }).click();
    await page.waitForURL("**/en/admin/users");
    await expect(page.getByRole("heading", { level: 1, name: en.usersAdmin.title })).toBeVisible();
    const table = page.getByRole("table", { name: en.usersAdmin.caption });
    await expect(table.getByText(ADMIN.email)).toBeVisible();
    await expect(table.getByText(MEMBER.email)).toBeVisible();
    await expect(table.getByText(en.usersAdmin.roles.ADMIN, { exact: true })).toBeVisible();
    await expect(table.getByText(en.usersAdmin.roles.USER, { exact: true })).toBeVisible();
    await page.getByRole("link", { name: en.usersAdmin.storageLink }).click();
    await page.waitForURL("**/en/admin/storage");
  });

  test("a member does not find the users screen", async ({ page }) => {
    await signIn(page, MEMBER);
    await page.waitForURL("**/en/account");
    expect((await page.goto("/en/admin/users"))?.status()).toBe(404);
    await page.goto("/en/account");
    await expect(page.getByRole("link", { name: en.account.adminLink })).toHaveCount(0);
  });
});
