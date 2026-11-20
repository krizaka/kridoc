import { STORAGE_CODE, StorageError } from "@krizaka/storage";
import { describe, expect, it } from "vitest";

import { unlessShredded } from "./shredded-reads";

describe("unlessShredded", () => {
  it("returns the value of a read that succeeds", async () => {
    expect(await unlessShredded(async () => "bytes", null)).toBe("bytes");
  });

  it("reads a shredded tenant as gone", async () => {
    const read = async (): Promise<string[]> => {
      throw new StorageError(STORAGE_CODE.shredded, "shredded");
    };
    expect(await unlessShredded(read, [])).toEqual([]);
  });

  it("throws any other failure", async () => {
    const other = new StorageError(STORAGE_CODE.unreadable, "down");
    await expect(
      unlessShredded(async () => {
        throw other;
      }, null),
    ).rejects.toBe(other);
    await expect(
      unlessShredded(async () => {
        throw new Error("boom");
      }, null),
    ).rejects.toThrow("boom");
  });
});
