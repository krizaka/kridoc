/** Where the documents' bytes live: a folder (development, tests) or an S3-compatible bucket (production, in Canada). */
export const STORAGE_PROVIDER = { local: "local", s3: "s3" } as const;
export type StorageProvider = (typeof STORAGE_PROVIDER)[keyof typeof STORAGE_PROVIDER];
