/** The header that keeps a response out of every cache. */
export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/** The headers of any stored bytes handed to a browser: an attachment, sandboxed, never sniffed, never cached. */
export const storedFileHeaders = (disposition: string): Record<string, string> => ({
  "Content-Disposition": disposition,
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "X-Content-Type-Options": "nosniff",
  ...NO_STORE,
});
