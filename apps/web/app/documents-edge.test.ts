import { describe, expect, it } from "vitest";

import { readEnv } from "@/lib/env";
import { STORAGE_PROVIDER } from "@/lib/storage/providers";

import { DEV_TENANT, storageConfigOf } from "./documents-edge";

const TORONTO = {
  endpoint: "https://tor1.digitaloceanspaces.com",
  region: "tor1",
  bucket: "kridoc-documents",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
};

describe("the documents' store configuration", () => {
  it("is the local folder of the development tenant by default", () => {
    expect(storageConfigOf(readEnv({}))).toEqual({
      provider: STORAGE_PROVIDER.local,
      tenant: DEV_TENANT,
      root: ".data/documents",
    });
  });
  it("is the bucket with every setting when the provider is s3", () => {
    const env = readEnv({
      MEDIA_STORAGE_PROVIDER: "s3",
      MEDIA_DOCUMENTS_TENANT: "kridoc-prod",
      MEDIA_S3_ENDPOINT: TORONTO.endpoint,
      MEDIA_S3_REGION: TORONTO.region,
      MEDIA_S3_BUCKET: TORONTO.bucket,
      MEDIA_S3_ACCESS_KEY_ID: TORONTO.accessKeyId,
      MEDIA_S3_SECRET_ACCESS_KEY: TORONTO.secretAccessKey,
    });
    expect(storageConfigOf(env)).toEqual({ provider: STORAGE_PROVIDER.s3, tenant: "kridoc-prod", bucket: TORONTO });
  });
  it("refuses the s3 provider without its settings, never falling back to another store", () => {
    expect(() => storageConfigOf(readEnv({ MEDIA_STORAGE_PROVIDER: "s3" }))).toThrow(
      expect.objectContaining({ code: "STORAGE_BAD_CONFIG" }),
    );
  });
});
