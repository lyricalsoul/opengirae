import { Command, CommandContext } from "@girae/common/commands";
import { DBOS } from "@girae/common/dbos";
import { findCommand } from "../loader";
import type { IncomingCommand } from "@girae/common/commands/types";

class CommandRouterService {
  @DBOS.workflow({ name: "executeCommand" })
  static async executeCommand(cmd: IncomingCommand) {
    const command = findCommand(cmd.name);
    
    if (!command) {
      DBOS.logger.info(`Got a command I can't handle: ${cmd.name}`);
      return;
    }

    const context = new CommandContext(cmd);
    await context.populateUser();

    try {
        if (command.module.info.useWorkflow) {
            await DBOS.startWorkflow<Command>(command.module, {
                workflowID: context.workflowID,
            }).execute(context);
        } else {
            await command.module.execute(context);
        }
    } catch (err: any) {
      DBOS.logger.error(`Error executing command ${cmd.name}: ` + err.stack);
      // Re-throw if you want DBOS to automatically apply exponential backoff and retry
      throw err; 
    }
  }
}
