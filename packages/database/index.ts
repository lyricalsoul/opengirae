import "dotenv/config";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { DrizzleDataSource } from "@dbos-inc/drizzle-datasource";
import * as schema_cards from "./schemas/cards";
import * as schema_users from "./schemas/users";
import * as schema_audit from "./schemas/audit";

export const config = { connectionString: process.env.DATABASE_URL! };
const pool = new Pool(config);

const schema = { ...schema_cards, ...schema_users, ...schema_audit };

export const db = drizzle(pool, { schema });
export const dataSource = new DrizzleDataSource<NodePgDatabase<typeof schema>>('app-db', config);
