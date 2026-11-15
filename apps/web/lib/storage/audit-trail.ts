import type { AuditEntryInput } from "@krizaka/audit";

import { AUDIT_ACTOR, type StorageAudit, type StorageAuditLine } from "./storage-audit";

/** The kind of thing the tenant of a line is, for the admin's filters. */
// @fixed: the audit trail's target type of a storage act (a tenant's vault)
const TARGET_TENANT = "tenant";

/** A storage line as an entry of the trail: an account is linked by its id, a client or a job by a label only (it has no account row). */
export function trailEntryOf(line: StorageAuditLine): AuditEntryInput {
  return {
    actorId: line.actor.kind === AUDIT_ACTOR.account ? line.actor.id : null,
    actorLabel: `${line.actor.kind}:${line.actor.id}`,
    action: line.action,
    target: { type: TARGET_TENANT, id: line.tenantId },
    detail: { ...(line.keyHash ? { keyHash: line.keyHash } : {}), ...line.detail },
  };
}

/** The storage audit port over `@krizaka/audit`: written beside the act, a failure goes to the trail's own `onError`, never to the caller. */
export const storageAuditOf =
  (record: (entry: AuditEntryInput) => Promise<void>): StorageAudit =>
  (line) =>
    record(trailEntryOf(line));
