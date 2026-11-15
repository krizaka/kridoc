/** A document the sweep may delete: its row's id and owner (the bytes' key is made from the id). */
export interface SweepDocument {
  id: string;
  ownerId: string;
}

/**
 * The port of the retention sweep: only the reads and the one delete it needs, every one bounded. The adapter is lib/db/retention-store.ts;
 * the sweep depends on this, never on SQL.
 */
export interface RetentionStore {
  /** Documents created before `cutoff`, oldest first, at most `limit`. */
  expired(cutoff: Date, limit: number): Promise<SweepDocument[]>;
  /** Removes one document's row; `false` when it was already gone. */
  remove(document: SweepDocument): Promise<boolean>;
  /** Owners in id order after `cursor` (`null`: from the start), at most `limit`. */
  ownersAfter(cursor: string | null, limit: number): Promise<string[]>;
  /** Which of these ids (at most a few hundred) are rows of this owner. */
  existing(ownerId: string, ids: readonly string[]): Promise<ReadonlySet<string>>;
}

/** Where the sweep stopped, so the next run starts after it (`null`: from the start). */
export interface SweepCursor {
  read(): Promise<string | null>;
  write(owner: string | null): Promise<void>;
}
