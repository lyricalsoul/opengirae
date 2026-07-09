import { DBOS } from "@girae/common/dbos";
import { findCommand } from "../loader";
import type { IncomingCommand } from "@girae/common/commands/types";
import { info, error } from "@girae/common/logger";
import { passesGuards } from "./guards";

async function runCommand(
  targetClass: any,
  methodName: string,
  useWorkflow: boolean,
  cmdCtx: IncomingCommand
) {
  if (useWorkflow) {
    await (DBOS.startWorkflow(targetClass, {
      workflowID: cmdCtx.workflowIDToBeAssigned,
    }) as any)[methodName](cmdCtx);
  } else {
    await targetClass[methodName](cmdCtx);
  }
}

export async function executeCommand(cmd: IncomingCommand) {
  const command = findCommand(cmd.name);

  if (!command) {
    info('commandeer', `Got a command I can't handle: ${cmd.name}`);
    return;
  }

  if (!(await passesGuards(command.guards, cmd))) {
    return;
  }

  try {
    const subcommands = (command.module as any).subcommands;
    const firstArg = cmd.args[0];

    if (subcommands && firstArg && subcommands[firstArg]) {
      const subcmd = subcommands[firstArg];
      // Strip the subcommand name from the args so the handler receives clean arguments
      const args = [...cmd.args];
      args.shift();
      const subCtx = { ...cmd, args };

      await runCommand(command.module, subcmd.methodName, !!subcmd.isWorkflow, subCtx);
    } else {
      // Fall back to main execute
      await runCommand(command.module, 'execute', !!command.module.info.useWorkflow, cmd);
    }
  } catch (err: any) {
    error('commandeer', `Error executing command ${cmd.name}: ` + err.stack);
    throw err;
  }
}

