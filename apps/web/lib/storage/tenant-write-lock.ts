/**
 * One write at a time per tenant, in this process: the check (does the key exist, is there room) and the write that follows it cannot
 * be interleaved with another write of the same tenant. A port has no conditional put, so this is what makes create-only and the quota
 * exact inside one instance; several instances would need the store's own condition (a follow-up, said in docs/design/storage-service.md).
 */
export interface TenantWriteLock {
  run<T>(tenantId: string, work: () => Promise<T>): Promise<T>;
}

export function tenantWriteLock(): TenantWriteLock {
  const tails = new Map<string, Promise<unknown>>();
  return {
    run(tenantId, work) {
      const turn = (tails.get(tenantId) ?? Promise.resolve()).then(work, work);
      const tail = turn.catch(() => undefined);
      tails.set(tenantId, tail);
      // Forget the tenant once nobody waits behind this turn, so the map does not grow with every tenant ever seen.
      void tail.then(() => {
        if (tails.get(tenantId) === tail) tails.delete(tenantId);
      });
      return turn;
    },
  };
}
