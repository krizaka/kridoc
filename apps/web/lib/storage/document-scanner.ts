import { type MalwareScanner, type ObjectStore, scanDaemon } from "@krizaka/storage";
import { tcpScanTransport } from "@krizaka/storage/node";

/** Where the ClamAV daemon listens (`MEDIA_SCAN_CLAMD_HOST`, `MEDIA_SCAN_CLAMD_PORT`), or nothing when no scanner is configured. */
export interface ScannerConfig {
  host: string | undefined;
  port: number;
}

/** A scanner that is not configured never says « clean »: every scan is an error, so every upload stays in quarantine (503). */
const unconfiguredScanner: MalwareScanner = {
  scan: async () => ({ status: "error", reason: "no malware scanner is configured" }),
};

/** The scanner of the documents: clamd over TCP on the quarantine store; without an address, the one that refuses everything. */
export function documentScannerOf(config: ScannerConfig, quarantine: ObjectStore): MalwareScanner {
  if (!config.host) return unconfiguredScanner;
  return scanDaemon({ store: quarantine, transport: tcpScanTransport({ host: config.host, port: config.port }) });
}
