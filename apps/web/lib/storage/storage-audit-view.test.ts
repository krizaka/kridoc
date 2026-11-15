import type { AuditEntry } from "@krizaka/audit";
import { describe, expect, it } from "vitest";

import { storageAuditEventOf } from "./storage-audit-view";

const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: "7",
  at: new Date("2026-11-15T12:00:00Z"),
  actorId: null,
  actorLabel: "admin@example.com",
  action: "storage.settings.changed",
  targetType: "setting",
  targetId: "storage.maxMb",
  detail: { before: 25, after: 1 },
  ip: null,
  ...over,
});

describe("a trail line as the admin's feed draws it", () => {
  it("names the act in the catalogue's words, who did it, and what changed from what", () => {
    expect(storageAuditEventOf(entry({}), { "storage.settings.changed": "Setting changed" })).toEqual({
      id: "7",
      at: new Date("2026-11-15T12:00:00Z"),
      title: "Setting changed",
      description: "admin@example.com · storage.maxMb: 25 → 1",
    });
  });

  it("falls back to the action itself for an act the catalogue does not name, with no change to show", () => {
    expect(
      storageAuditEventOf(entry({ action: "storage.future", detail: {}, actorLabel: "job:retention-sweep" }), {}),
    ).toMatchObject({ title: "storage.future", description: "job:retention-sweep" });
  });
});
