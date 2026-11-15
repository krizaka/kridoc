import type { AuditEntry, AuditEntryInput, AuditFilters } from "@krizaka/audit";
import { type Actor, describeSettings, GLOBAL, type SettingDescription } from "@krizaka/settings";

import { ACCOUNT_ROLE, type AccountRole } from "@/lib/auth/account-store";

import { STORAGE_ADMIN_ERROR, StorageAdminError } from "./admin-errors";
import { STORAGE_AUDIT } from "./storage-audit";
import { STORAGE_SETTING, storageSettings, type StorageSettingsService } from "./storage-settings";

/** The person at the screen: only an administrator changes the rules. */
export interface AdminActor {
  id: string;
  label: string;
  role: AccountRole;
}

/** A change: the settings' keys (`storage.maxMb`…) and their new values, checked against the registry's bounds before anything is written. */
export type StorageSettingsChange = Readonly<Record<string, unknown>>;

export interface StorageSettingView extends SettingDescription {
  value: unknown;
}

export interface StorageSettingsAdminDeps {
  settings: Pick<StorageSettingsService, "get" | "set">;
  /** The trail (`@krizaka/audit`), written in the act: a line that cannot be written fails the change's answer, never silently. */
  record: (entry: AuditEntryInput) => Promise<void>;
  list: (filters: AuditFilters) => Promise<AuditEntry[]>;
  clock: { now(): Date };
}

export interface StorageSettingsAdmin {
  /** Every storage setting with its value now, its default and its bounds. Read by an administrator only. */
  current(actor: AdminActor): Promise<StorageSettingView[]>;
  /** @throws StorageAdminError `FORBIDDEN` (not an administrator), `INVALID_SETTING` (an unknown key or a value outside its bounds: nothing is written) */
  change(actor: AdminActor, change: StorageSettingsChange): Promise<StorageSettingView[]>;
  /** The latest storage lines of the trail, newest first. */
  recent(actor: AdminActor): Promise<AuditEntry[]>;
}

const KEYS: readonly string[] = Object.values(STORAGE_SETTING);

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function admin(actor: AdminActor): void {
  if (actor.role !== ACCOUNT_ROLE.admin) throw new StorageAdminError(STORAGE_ADMIN_ERROR.forbidden);
}

/** The values the registry accepts, or a refusal: every key is checked before the first is written, so a change is whole or not at all. */
function checked(change: StorageSettingsChange): [string, unknown][] {
  const entries = Object.entries(change);
  for (const [key, value] of entries) {
    const known = KEYS.includes(key) && storageSettings.isKey(key);
    if (!known || !storageSettings.defOf(key).schema.safeParse(value).success)
      throw new StorageAdminError(STORAGE_ADMIN_ERROR.invalid);
  }
  return entries;
}

/** The storage settings as an administrator changes them: the role first, the bounds second, the settings service third, one audit line per changed value. */
export function createStorageSettingsAdmin(deps: StorageSettingsAdminDeps): StorageSettingsAdmin {
  const view = async (): Promise<StorageSettingView[]> =>
    Promise.all(
      describeSettings(storageSettings).map(async (description) => ({
        ...description,
        value: await deps.settings.get(description.key),
      })),
    );
  return {
    async current(actor) {
      admin(actor);
      return view();
    },
    async change(actor, change) {
      admin(actor);
      const entries = checked(change);
      const by: Actor = { id: actor.id, label: actor.label };
      for (const [key, after] of entries) {
        const before = await deps.settings.get(key as typeof STORAGE_SETTING.maxMb);
        if (sameValue(before, after)) continue;
        await deps.settings.set(by, GLOBAL, key, after, deps.clock.now());
        await deps.record({
          actorId: actor.id,
          actorLabel: actor.label,
          action: STORAGE_AUDIT.settingsChanged,
          target: { type: "setting", id: key },
          detail: { before, after },
        });
      }
      return view();
    },
    async recent(actor) {
      admin(actor);
      return deps.list({ actionPrefix: "storage." });
    },
  };
}
