import { DBOS } from "@dbos-inc/dbos-sdk";
import { dataSource, db } from "./index";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export type DrizzleClient = NodePgDatabase<any>;

export function maybeTransaction<Args extends unknown[], Return>(
  name: string,
  fn: (client: DrizzleClient, ...args: Args) => Promise<Return>
): (...args: Args) => Promise<Return> {
  const dbosWrapped = dataSource.registerTransaction(
    (...args: Args) => fn(dataSource.client, ...args),
    { name }
  );

  return (...args: Args) => {
    return DBOS.isInitialized() ? dbosWrapped(...args) : db.transaction((tx) => fn(tx, ...args));
  };
}
