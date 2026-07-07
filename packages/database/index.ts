import "dotenv/config";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { DrizzleDataSource } from "@dbos-inc/drizzle-datasource";
import * as schema_cards from "./schemas/cards";
import * as schema_users from "./schemas/users";

export const config = { connectionString: process.env.DATABASE_URL! };
const pool = new Pool(config);

export const db = drizzle(pool);
export const dataSource = new DrizzleDataSource<NodePgDatabase<typeof schema_cards & typeof schema_users>>('app-db', config);
