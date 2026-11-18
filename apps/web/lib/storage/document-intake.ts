import { type MalwareScanner, type ObjectStore, type ScanResult, sniffType } from "@krizaka/storage";

import { DOCUMENT_ERROR, DocumentError, type DocumentErrorCode } from "./errors";
import type { StorageRulesSource } from "./storage-settings";

/** The quarantine's key of one pending upload: under its owner, by id (never a name the client chose). */
export const quarantineKeyOf = (ownerId: string, id: string): string => `quarantine/${ownerId}/${id}`;

/** What the intake did to a file that did not reach the documents: the step that refused it, or the scanner that could not answer. */
export const INTAKE_OUTCOME = { refused: "refused", held: "held" } as const;
export type IntakeOutcome = (typeof INTAKE_OUTCOME)[keyof typeof INTAKE_OUTCOME];

export interface IntakeDeps {
  /** The quarantine: plain bytes nobody reads but the intake (a bucket of its own, expired after a day). */
  quarantine: ObjectStore;
  scanner: MalwareScanner;
  /** Read at each intake: the size and the scan timeout are the administrator's settings. */
  rules: StorageRulesSource;
  /** One line per file that was refused or held: the step's code, never a byte. */
  note: (outcome: IntakeOutcome, code: DocumentErrorCode) => Promise<void>;
}

/** A file that passed every step of the intake: its bytes as the quarantine held them, and the type they say they are. */
export interface ScreenedFile {
  bytes: Uint8Array;
  mediaType: string;
}

/**
 * The intake's steps on a file already in quarantine: size from a HEAD (before any byte is read), type by magic number, then the scanner.
 * A refused file is deleted from the quarantine; a scanner that cannot answer keeps it there and the upload is not published.
 * @throws DocumentError `FILE_TOO_BIG`, `FILE_TYPE_REFUSED`, `FILE_INFECTED` (deleted), `SCANNER_UNAVAILABLE` (kept), `DOCUMENT_NOT_FOUND`
 */
export async function screenQuarantined(deps: IntakeDeps, key: string): Promise<ScreenedFile> {
  const refuse = async (code: DocumentErrorCode): Promise<never> => {
    await deps.quarantine.delete(key);
    await deps.note(INTAKE_OUTCOME.refused, code);
    throw new DocumentError(code);
  };
  const rules = await deps.rules();
  const info = await deps.quarantine.head(key);
  if (!info) throw new DocumentError(DOCUMENT_ERROR.notFound);
  if (info.size === 0 || info.size > rules.maxBytes) return refuse(DOCUMENT_ERROR.tooBig);
  const found = await deps.quarantine.get(key);
  if (!found) throw new DocumentError(DOCUMENT_ERROR.notFound);
  const mediaType = sniffType(found.bytes);
  if (mediaType === null || !rules.types.includes(mediaType)) return refuse(DOCUMENT_ERROR.badType);
  const verdict = await deps.scanner.scan({ key }, { timeoutMs: rules.scanTimeoutSeconds * 1000 });
  // One answer per verdict, checked exhaustive by the type: only « clean » publishes; an error keeps the file in quarantine.
  const onVerdict: Record<ScanResult["status"], () => Promise<ScreenedFile>> = {
    clean: () => Promise.resolve({ bytes: found.bytes, mediaType }),
    infected: () => refuse(DOCUMENT_ERROR.infected),
    error: async () => {
      await deps.note(INTAKE_OUTCOME.held, DOCUMENT_ERROR.scannerUnavailable);
      throw new DocumentError(DOCUMENT_ERROR.scannerUnavailable);
    },
  };
  return onVerdict[verdict.status]();
}
