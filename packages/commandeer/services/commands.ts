import { DBOS } from "@girae/common/dbos";
import { findCommand } from "../loaders/commands";
import type { IncomingCommand } from "@girae/common/commands/types";
import type { CommandArgumentSpec } from "@girae/common/commands";
import { info, error } from "@girae/common/logger";
import { passesGuards } from "./guards";
import { UsersDB } from "@girae/database/users";
import { resolveCommandArguments } from "./commandArguments";
import { hasJoinedSupportChannel } from "./supportChannel";
import { reply } from "@girae/common/dbos/messaging";

async function runCommand(
  targetClass: any,
  methodName: string,
  useWorkflow: boolean,
  cmdCtx: IncomingCommand
) {
  const specs: CommandArgumentSpec[] | undefined = targetClass.commandArguments?.[methodName];
  const invokeArgs: unknown[] = [cmdCtx];

  if (specs) {
    const resolved = await resolveCommandArguments(specs, cmdCtx, targetClass.info.usage ?? '');
    if (!resolved) return; // resolveCommandArguments already replied with the usage/error message
    invokeArgs.push(resolved);
  }

  if (useWorkflow) {
    await (DBOS.startWorkflow(targetClass, {
      workflowID: cmdCtx.workflowIDToBeAssigned,
    }) as any)[methodName](...invokeArgs);
  } else {
    await targetClass[methodName](...invokeArgs);
  }
}

export async function executeCommand(cmd: IncomingCommand) {
  const command = findCommand(cmd.name);

  if (!command) {
    info('commandeer', `Got a command I can't handle: ${cmd.name}`);
    return;
  }

  const user = await UsersDB.ensureUser({
    platform: cmd.message.platform as 'telegram' | 'discord',
    platformId: cmd.message.author.id,
    displayName: cmd.message.author.name,
    avatarUrl: cmd.message.author.avatarUrl,
  });

  if (cmd.message.platform === 'telegram' && cmd.name !== 'start' && user) {
    if (!(await hasJoinedSupportChannel(user, cmd.message.author.id))) {
      await reply(cmd, 'Você precisa entrar no nosso canal de suporte @undergirae para usar a bot! [Entre e tente novamente](https://t.me/undergirae). 📢');
      return;
    }
  }

  if (!(await passesGuards(command.guards, cmd))) {
    return;
  }

  try {
    const subcommands = (command.module as any).subcommands;
    const firstArg = cmd.args[0];

    if (subcommands && firstArg && subcommands[firstArg]) {
      const subcmd = subcommands[firstArg];
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

