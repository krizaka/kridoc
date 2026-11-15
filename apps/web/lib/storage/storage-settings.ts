import { defineSettings, integer, type SettingsService, subset } from "@krizaka/settings";

const GROUP = "storage";

/** The content types a Kridoc installation may be told to accept: a closed set (an administrator picks from it, never types one). */
export const STORAGE_CONTENT_TYPES = [
  "application/octet-stream",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
] as const;

/** The keys of the storage settings, one place (the admin form, the checks and the audit lines all read these). */
export const STORAGE_SETTING = {
  maxMb: "storage.maxMb",
  allowedTypes: "storage.allowedTypes",
  signedUrlSeconds: "storage.signedUrlSeconds",
  retentionDays: "storage.retentionDays",
} as const;

/**
 * What an administrator may change, within bounds (data, never constants: krizaka-internal#3755). Global only: one Kridoc installation,
 * one set of rules. The defaults are what the code did before the admin existed (25 MB, the six types, 5 minutes) and ten years of keeping.
 */
export const storageSettings = defineSettings({
  [STORAGE_SETTING.maxMb]: integer(GROUP, 25, { min: 1, max: 100, unit: "MB" }, ["global"]),
  [STORAGE_SETTING.allowedTypes]: subset(GROUP, STORAGE_CONTENT_TYPES, [...STORAGE_CONTENT_TYPES], ["global"]),
  [STORAGE_SETTING.signedUrlSeconds]: integer(GROUP, 300, { min: 30, max: 3600, unit: "s" }, ["global"]),
  [STORAGE_SETTING.retentionDays]: integer(GROUP, 3650, { min: 30, max: 3650, unit: "days" }, ["global"]),
} as const);

export type StorageSettingsService = SettingsService<(typeof storageSettings)["registry"]>;

const BYTES_PER_MB = 1024 * 1024;

/** The rules every upload and every link obeys, as the services read them. */
export interface StorageRules {
  maxBytes: number;
  /** The types the bytes (documents) or the declaration (the API) may be. */
  types: readonly string[];
  /** The longest a signed link lives. */
  signedUrlSeconds: number;
  retentionDays: number;
}

/** Where a service reads the rules: asked on every upload and every link, so a change applies at once. */
export type StorageRulesSource = () => Promise<StorageRules>;

/** The rules from the settings service (the database, with its short cache); a failed read fails the act, never falls back to a looser rule. */
export function storageRulesOf(settings: Pick<StorageSettingsService, "get">): StorageRulesSource {
  return async () => {
    const [maxMb, types, signedUrlSeconds, retentionDays] = await Promise.all([
      settings.get(STORAGE_SETTING.maxMb),
      settings.get(STORAGE_SETTING.allowedTypes),
      settings.get(STORAGE_SETTING.signedUrlSeconds),
      settings.get(STORAGE_SETTING.retentionDays),
    ]);
    return { maxBytes: maxMb * BYTES_PER_MB, types, signedUrlSeconds, retentionDays };
  };
}
