import { STORAGE_CODE, StorageError } from "@krizaka/storage";

/**
 * A read of a tenant's sealed store: a shredded tenant (Law 25 erasure) reads as `gone`, its documents no longer exist; any other failure is
 * thrown. The one home of that rule: api-http.ts keeps the HTTP edge's net for a path that forgot it.
 */
export async function unlessShredded<T>(read: () => Promise<T>, gone: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof StorageError && error.code === STORAGE_CODE.shredded) return gone;
    throw error;
  }
}
