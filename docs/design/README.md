# Kridoc's design notes

Design notes say what will be built and why, before the code. Each names its ticket and says what is built and what is not.

- [storage-service.md](storage-service.md): Kridoc's storage service. It covers Kridoc's own documents, encryption per account and
  the storage API v1 for the other products (krizaka-internal#3719, #3754 and #3756; slices 1, 3 and 5 built).
- [integration.md](integration.md): how every app connects to Kridoc with an API key through one shared client. It covers the
  contract (v1.1), the keys, the client in `@krizaka/storage` and the Spring starter, resilience, security and Law 25, operations,
  and the fastest path to Verikora's first real document (krizaka-internal#4036; design only).

The API contracts themselves are in [../architecture/](../architecture/README.md).
