// pnpm storage:client — the tokens of the products that keep files in Kridoc (krizaka-internal#3756).
//   issue <product> <tenant> <scopes>   e.g. `issue verikora verikora-prod put,get,delete,sign`: prints the token ONCE (only its hash is kept)
//   revoke <client id>                  the token stops working at once, its signed links too
//   list                                the clients, newest first (never a token, never a hash)
// DATABASE_URL (and DATABASE_CA_CERT) point at the database; MEDIA_VAULT_KEY keys the tokens' hashes. Nothing else secret is printed.
import { storageClientsOf } from "../app/storage-api-edge";
import { pool } from "../lib/db/connection";
import { readEnv } from "../lib/env";
import { StorageApiError } from "../lib/storage/api-errors";
import type { StorageProduct, StorageScope } from "../lib/storage/client-port";

// @fixed: the most clients one list prints
const LIST_LIMIT = 200;
const USAGE = "usage: storage:client issue <product> <tenant> <put,get,delete,sign> | revoke <id> | list";

async function run(clients: ReturnType<typeof storageClientsOf>, [command, ...args]: string[]): Promise<void> {
  if (command === "issue" && args.length === 3) {
    const [product, tenantId, scopes] = args as [string, string, string];
    const { client, token } = await clients.issue({
      product: product as StorageProduct,
      tenantId,
      scopes: scopes.split(",") as StorageScope[],
    });
    console.log(`storage:client: client ${client.id} issued for ${client.tenantId} (${client.scopes.join(",")})`);
    console.log("storage:client: the token, shown this once — put it in the product's secret store now:");
    console.log(token);
  } else if (command === "revoke" && args.length === 1) {
    const revoked = await clients.revoke(args[0]!);
    console.log(`storage:client: ${revoked ? "revoked" : "no active client with this id"}`);
  } else if (command === "list" && args.length === 0) {
    for (const c of await clients.list(LIST_LIMIT))
      console.log(
        `${c.id} ${c.product} ${c.tenantId} ${c.scopes.join(",")} ${c.createdAt.toISOString()} ${c.revokedAt ? "revoked" : "active"}`,
      );
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
}

const env = readEnv();
try {
  await run(storageClientsOf(env), process.argv.slice(2));
} catch (error: unknown) {
  const kind = error instanceof Error ? error.name : typeof error;
  console.error(
    error instanceof StorageApiError
      ? `storage:client refused: ${error.code} (a known product, a tenant <product>-<environment>, scopes among put,get,delete,sign)`
      : `storage:client failed (${kind}; needs DATABASE_URL and MEDIA_VAULT_KEY)`,
  );
  process.exitCode = 1;
} finally {
  await pool(env).end();
}
