import { expect, type Page, test } from "@playwright/test";

import en from "../messages/en.json" with { type: "json" };
import fr from "../messages/fr.json" with { type: "json" };
import { ADMIN, MEMBER } from "./accounts.mts";

const MB = 1024 * 1024;

/** A PDF of about `size` bytes: the magic number, then padding (what the upload checks is the bytes, not the name). */
const pdfOf = (size: number): Buffer => Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(size, 0x20)]);

async function signIn(page: Page, who: { email: string; password: string }, then: string) {
  await page.goto(`/en/sign-in?next=${encodeURIComponent(then)}`);
  await page.getByLabel(en.auth.signIn.email).fill(who.email);
  await page.getByLabel(en.auth.signIn.password).fill(who.password);
  await page.getByRole("button", { name: en.auth.signIn.submit }).click();
  await page.waitForURL(`**${then}`);
}

const upload = (page: Page, size: number) =>
  page.request.post("/api/documents", {
    headers: { "accept-language": "en" },
    multipart: { file: { name: "lease.pdf", mimeType: "application/pdf", buffer: pdfOf(size) } },
  });

test.describe("the storage settings of the administrator", () => {
  test("the administrator lowers the largest file, an upload above it is refused in the catalogue's words, and the audit shows the change", async ({
    page,
  }) => {
    await signIn(page, ADMIN, "/en/admin/storage");
    await expect(page.getByRole("heading", { level: 1, name: en.storageAdmin.title })).toBeVisible();

    // Before: a file of 2 MB is kept (the default limit is 25 MB).
    expect((await upload(page, 2 * MB)).status()).toBe(201);

    await page.getByLabel(en.storageAdmin.maxMb.label).fill("1");
    await page.getByRole("button", { name: en.storageAdmin.save }).click();
    await expect(page.getByText(en.storageAdmin.saved)).toBeVisible();

    // After: the same file is refused, with the words of the catalogue; a smaller one still goes through.
    const refused = await upload(page, 2 * MB);
    expect(refused.status()).toBe(413);
    expect((await refused.json()).detail).toBe(en.documents.errors.FILE_TOO_BIG);
    expect((await upload(page, MB / 2)).status()).toBe(201);

    // The audit shows who changed what, from what to what.
    await page.reload();
    const feed = page
      .getByRole("region", { name: en.storageAdmin.auditTitle })
      .or(page.getByLabel(en.storageAdmin.auditTitle));
    await expect(feed.getByText(en.storageAdmin.actions["storage.settings.changed"])).toBeVisible();
    await expect(feed.getByText("storage.maxMb: 25 → 1")).toBeVisible();
    await expect(feed.getByText(ADMIN.email)).toBeVisible();
  });

  test("a value outside its bounds is refused with the catalogue's words and changes nothing", async ({ page }) => {
    await signIn(page, ADMIN, "/en/admin/storage");
    await page.getByLabel(en.storageAdmin.maxMb.label).fill("101");
    await page.getByRole("button", { name: en.storageAdmin.save }).click();
    await expect(page.getByText(en.storageAdmin.errors.INVALID_SETTING)).toBeVisible();
  });

  test("a member does not even find the screen, and the API refuses their change", async ({ page }) => {
    await signIn(page, MEMBER, "/en");
    expect((await page.goto("/en/admin/storage"))?.status()).toBe(404);
    const change = await page.request.put("/api/admin/storage-settings", {
      headers: { "accept-language": "en" },
      data: { changes: { "storage.maxMb": 99 } },
    });
    expect(change.status()).toBe(403);
    expect((await change.json()).detail).toBe(en.storageAdmin.errors.FORBIDDEN);
  });

  test("the screen speaks French too", async ({ page }) => {
    await signIn(page, ADMIN, "/en");
    await page.goto("/fr/admin/storage");
    await expect(page.getByRole("heading", { level: 1, name: fr.storageAdmin.title })).toBeVisible();
    await expect(page.getByLabel(fr.storageAdmin.maxMb.label)).toBeVisible();
  });
});
