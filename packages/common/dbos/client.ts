import { DBOSClient } from "@dbos-inc/dbos-sdk"

const client = await DBOSClient.create({ systemDatabaseUrl: process.env.DBOS_SYSTEM_DATABASE_URL! })

export { client }