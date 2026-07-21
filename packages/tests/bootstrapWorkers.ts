import { DBOS } from "@girae/common/dbos"

// Starts real commandeer+answerer workers; every DBOS step must be imported before DBOS.launch() or it throws.
export async function bootstrapCommandeerWorkers(): Promise<void> {
  if (!DBOS.isInitialized()) {
    await import("@girae/commandeer/services")
    DBOS.setConfig({
      name: 'openGIRAÊ-test',
      systemDatabaseUrl: process.env.DBOS_SYSTEM_DATABASE_URL!,
      systemDatabasePoolSize: 5,
    })
    await DBOS.launch()
  }

  await import("@girae/commandeer/worker")
  await import("@girae/answerer/index")
}
