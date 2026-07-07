import { DBOS } from "@girae/common/dbos";
import { findCommand } from "../loader";
import type { IncomingCommand } from "@girae/common/commands/types";
import { info, error } from "@girae/common/logger";

export async function executeCommand(cmd: IncomingCommand) {
  const command = findCommand(cmd.name);

  if (!command) {
    info('commandeer', `Got a command I can't handle: ${cmd.name}`);
    return;
  }

  try {
    if (command.module.info.useWorkflow) {
      await (DBOS.startWorkflow(command.module as any, {
        workflowID: cmd.workflowIDToBeAssigned,
      }) as any).execute(cmd);
    } else {
      await command.module.execute(cmd);
    }
  } catch (err: any) {
    error('commandeer', `Error executing command ${cmd.name}: ` + err.stack);
    throw err;
  }
}

