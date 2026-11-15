import type { AuditEntry } from "@krizaka/audit";

/** A line of the trail as the admin's feed draws it: the act in words (the catalogue's, or the action itself when it has none), who, when, and what changed. */
export function storageAuditEventOf(entry: AuditEntry, actions: Readonly<Record<string, string>>) {
  const { before, after } = entry.detail;
  const change =
    entry.targetId && before !== undefined && after !== undefined
      ? `${entry.targetId}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`
      : undefined;
  return {
    id: entry.id,
    at: entry.at,
    title: actions[entry.action] ?? entry.action,
    // The feed draws no actor of its own text: who acted leads the description, then what changed.
    description: [entry.actorLabel, change].filter(Boolean).join(" · "),
  };
}
