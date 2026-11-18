import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The real services the intake journey runs on: an S3 server and the ClamAV daemon, started with the Docker CLI (test support, never the app).
 * Both images are official vendor builds pinned by digest (never a tag, never a community re-publication). MinIO's own images left Docker
 * Hub and Quay: the image is Chainguard's build of it (`cgr.dev/chainguard/minio`).
 */
export const INTAKE_IMAGES = {
  s3: "cgr.dev/chainguard/minio@sha256:7618b82bba99aadd77fcf59eb6cfd89b4b8b8e01ac796c474d57a1c1abf17e79",
  clamd: "clamav/clamav@sha256:4cc4350d3fded380caf1799e76c0d1c93f3fa40af99c0cb2862ec0c9b117718a",
} as const;

/** Test credentials, valid for a throwaway container only. */
export const INTAKE_S3_KEYS = { accessKeyId: "kridoc-ci", secretAccessKey: "kridoc-ci-only-demo" } as const;

/**
 * A signature of our own for the daemon (ClamAV loads every `*.ndb` of its database folder): ClamAV flags EICAR only as a plain text file,
 * which the intake refuses by type before the scan, so the scan step is proved with a marker inside a real PDF.
 */
export const TEST_MARKER = "KRIDOC-INTAKE-TEST-MARKER";
const markerSignature = `Kridoc.Test.Marker:0:*:${Buffer.from(TEST_MARKER).toString("hex")}\n`;

export interface IntakeServices {
  s3Endpoint: string;
  clamd: { host: string; port: number };
  /** The buckets made on the S3 server. */
  buckets: readonly string[];
  stop(): void;
}

// A fixed list, never a PATH lookup: Docker's own install locations (Linux, Docker Desktop, Homebrew).
const DOCKER_CANDIDATES = ["/usr/bin/docker", "/usr/local/bin/docker", "/opt/homebrew/bin/docker"] as const;
const dockerBinary = (): string => {
  const found = DOCKER_CANDIDATES.find((path) => existsSync(path));
  if (!found) throw new Error(`the intake journey needs the Docker CLI (looked in ${DOCKER_CANDIDATES.join(", ")})`);
  return found;
};

const docker = (...args: string[]): string => execFileSync(dockerBinary(), args, { encoding: "utf8" }).trim();
const hostPortOf = (container: string, port: number): number =>
  Number(docker("port", container, String(port)).split("\n")[0]?.split(":").pop());

async function until(what: string, seconds: number, ready: () => Promise<boolean> | boolean): Promise<void> {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await Promise.resolve(ready()).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${what} was not ready within ${seconds} s`);
}

/** Starts the S3 server (one directory per bucket: MinIO serves each top-level directory as a bucket) and clamd; resolves when both answer. */
export async function startIntakeServices(buckets: readonly string[]): Promise<IntakeServices> {
  const data = mkdtempSync(join(tmpdir(), "kridoc-s3-"));
  chmodSync(data, 0o777);
  for (const bucket of buckets) {
    mkdirSync(join(data, bucket));
    chmodSync(join(data, bucket), 0o777);
  }
  const s3 = docker(
    "run", "-d", "--rm", "-p", "127.0.0.1::9000",
    "-e", `MINIO_ROOT_USER=${INTAKE_S3_KEYS.accessKeyId}`, "-e", `MINIO_ROOT_PASSWORD=${INTAKE_S3_KEYS.secretAccessKey}`,
    "-v", `${data}:/data`, INTAKE_IMAGES.s3, "server", "/data",
  ); // prettier-ignore
  const signatures = join(data, "kridoc-test.ndb");
  writeFileSync(signatures, markerSignature, { mode: 0o644 });
  const clamd = docker(
    "run", "-d", "--rm", "-p", "127.0.0.1::3310",
    "-v", `${signatures}:/var/lib/clamav/kridoc-test.ndb`, INTAKE_IMAGES.clamd,
  ); // prettier-ignore
  const stop = () => {
    for (const id of [s3, clamd]) execFileSync(dockerBinary(), ["rm", "-f", id], { stdio: "ignore" });
    rmSync(data, { recursive: true, force: true });
  };
  try {
    const s3Endpoint = `http://127.0.0.1:${hostPortOf(s3, 9000)}`;
    await until("the S3 server", 60, async () => (await fetch(`${s3Endpoint}/minio/health/live`)).ok);
    // The image's own health check answers once the signatures are loaded and clamd listens.
    await until("clamd", 240, () => docker("inspect", "-f", "{{.State.Health.Status}}", clamd) === "healthy");
    return { s3Endpoint, clamd: { host: "127.0.0.1", port: hostPortOf(clamd, 3310) }, buckets, stop };
  } catch (error) {
    stop();
    throw error;
  }
}
