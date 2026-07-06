import { DBOSClient } from "@dbos-inc/dbos-sdk"
import { COMMAND_QUEUE_NAME, MESSAGE_QUEUE_NAME } from "./constants"

const client = await DBOSClient.create({ systemDatabaseUrl: process.env.DBOS_SYSTEM_DATABASE_URL! })

export { client }