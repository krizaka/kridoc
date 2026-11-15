/**
 * What the bundler loads for `opendal`, the optional binding of @krizaka/storage's OpenDAL providers (next.config.mjs, `resolveAlias`):
 * Kridoc's bucket and folder adapters never use it and it is not installed, so loading it fails exactly as a missing package does, and
 * the library answers its own `STORAGE_BAD_CONFIG` (« this provider needs the optional dependency »). Follow-up: the library's optional
 * import should be ignored by bundlers, then this alias goes.
 */
// A module (no export of its own), whose evaluation fails.
export {};

throw new Error("opendal is not installed in Kridoc");
