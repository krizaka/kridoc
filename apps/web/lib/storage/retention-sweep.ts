import { subHours } from "@krizaka/time";

import type { OwnerObjects } from "./document-port";
import { objectKeyOf } from "./document-service";
import { accountTenantOf } from "./document-vault";
import type { RetentionStore, SweepCursor } from "./retention-port";
import { AUDIT_ACTOR, keyHashOf, STORAGE_AUDIT, type StorageAudit } from "./storage-audit";
import { unlessShredded } from "./shredded-reads";
import type { StorageRulesSource } from "./storage-settings";

/** The bounds of one run: what a run may touch at most, so a backlog is cleared over several runs and never in one unbounded pass. */
export interface SweepLimits {
  /** The most expired documents one run deletes. */
  expired: number;
  /** The most owners whose objects one run checks for orphans. */
  owners: number;
  /** The most objects of one owner one run looks at. */
  objectsPerOwner: number;
}

export interface SweepDeps {
  store: RetentionStore;
  cursor: SweepCursor;
  objects: OwnerObjects;
  /** The retention (days) is the administrator's setting, read at each run. */
  rules: StorageRulesSource;
  audit: StorageAudit;
  clock: { now(): Date };
  limits: SweepLimits;
}

export interface SweepResult {
  expired: number;
  orphans: number;
  owners: number;
}

/** The job's name in the trail. */
// @fixed: the actor of every line the sweep writes
const JOB = { kind: AUDIT_ACTOR.job, id: "retention-sweep" } as const;
const HOURS_PER_DAY = 24;
const DOCUMENT_PREFIX = objectKeyOf("");
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const deleted = (deps: SweepDeps, ownerId: string, id: string, reason: "expired" | "orphan") =>
  deps.audit({
    action: STORAGE_AUDIT.deleted,
    actor: JOB,
    tenantId: accountTenantOf(ownerId),
    keyHash: keyHashOf(objectKeyOf(id)),
    detail: { reason },
  });

/** Expired documents: the row first (nobody reaches the bytes once it is gone), then the bytes; a failure stops the run with the rest untouched. */
async function removeExpired(deps: SweepDeps, cutoff: Date): Promise<number> {
  const expired = await deps.store.expired(cutoff, deps.limits.expired);
  for (const document of expired) {
    await deps.store.remove(document);
    await deps.objects.of(document.ownerId).delete(objectKeyOf(document.id));
    await deleted(deps, document.ownerId, document.id, "expired");
  }
  return expired.length;
}

/** The ids of the document objects an owner's store holds (a key that is not `documents/<uuid>` is not ours to judge), or none for a shredded owner. */
async function objectIdsOf(deps: SweepDeps, ownerId: string): Promise<string[]> {
  const listed = await unlessShredded(() => deps.objects.of(ownerId).list(DOCUMENT_PREFIX), []);
  return listed
    .map((object) => object.key.slice(DOCUMENT_PREFIX.length))
    .filter((id) => ID.test(id))
    .slice(0, deps.limits.objectsPerOwner);
}

/** An owner's objects that have no row: each is asked again right before it goes, so a document being uploaded (bytes first, row second) is spared. */
async function removeOrphans(deps: SweepDeps, ownerId: string): Promise<number> {
  const ids = await objectIdsOf(deps, ownerId);
  if (ids.length === 0) return 0;
  const known = await deps.store.existing(ownerId, ids);
  let removed = 0;
  for (const id of ids.filter((candidate) => !known.has(candidate))) {
    if ((await deps.store.existing(ownerId, [id])).has(id)) continue;
    await deps.objects.of(ownerId).delete(objectKeyOf(id));
    await deleted(deps, ownerId, id, "orphan");
    removed += 1;
  }
  return removed;
}

/**
 * The retention sweep: removes what is past the administrator's retention, then the objects with no row, a bounded batch of owners per
 * run (the cursor remembers where it stopped, and wraps to the start). Fails closed: if the rules cannot be read, or a store fails, the
 * run stops with the error and deletes nothing more; it never falls back to a shorter retention. Safe to run twice (idempotent).
 */
export async function sweepStorage(deps: SweepDeps): Promise<SweepResult> {
  const { retentionDays } = await deps.rules();
  const cutoff = subHours(deps.clock.now(), retentionDays * HOURS_PER_DAY);
  const expired = await removeExpired(deps, cutoff);

  const owners = await deps.store.ownersAfter(await deps.cursor.read(), deps.limits.owners);
  let orphans = 0;
  for (const ownerId of owners) orphans += await removeOrphans(deps, ownerId);
  // A short batch means the end of the owners: the next run starts again from the first.
  await deps.cursor.write(owners.length < deps.limits.owners ? null : (owners.at(-1) ?? null));

  const result = { expired, orphans, owners: owners.length };
  await deps.audit({
    action: STORAGE_AUDIT.swept,
    actor: JOB,
    tenantId: "installation",
    detail: { ...result },
  });
  return result;
}
