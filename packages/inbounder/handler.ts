// handler.ts
import type { Message, IncomingCommand } from "@girae/common/commands/types";
import { commandQueue } from "@girae/common/queue"

export const processCommand = async (msg: Message) => {
  if (!msg.content.startsWith("/")) return;

  const [name, ...args] = msg.content.slice(1).split(" ");
  if (!name) return

  const cmd: IncomingCommand = {
    name: name.toLowerCase(),
    args,
    message: msg,
    workflowIDToBeAssigned: Bun.randomUUIDv7()
  };

  await commandQueue.add('executeCommand', cmd);
};