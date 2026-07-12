import type { Message, IncomingCommand } from "../commands/types";
import { commandQueue, resumeQueue, rawClient } from "../queue"

export const processCommand = async (msg: Message) => {
  if (!msg.content.startsWith("/")) {
    await processPendingTextInput(msg);
    return;
  }

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

const processPendingTextInput = async (msg: Message) => {
  const key = `pendingText:${msg.chat.id}:${msg.author.id}`;
  const raw = await rawClient.get(key);
  if (!raw) return;

  await rawClient.del(key);
  const { workflowID, eventName } = JSON.parse(raw);

  await resumeQueue.add('resume', {
    workflowID,
    eventName,
    value: msg.content,
    messageId: msg.id,
  });
};
