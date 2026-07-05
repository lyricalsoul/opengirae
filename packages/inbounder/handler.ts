import { Queue } from "bullmq";
import { getAvailableCommands, onParameterRefresh } from "@girae/common/consensus";
import { COMMAND_QUEUE_NAME } from "@girae/common/constants";
import type { MessageAuthor, MessageChat, Message, IncomingCommand } from "@girae/common/commands/types";
import { warn } from "@girae/common/logger"

const commandQueue = new Queue(COMMAND_QUEUE_NAME);
let handledCommands = await getAvailableCommands();

// params refresh are emitted whenever we need to update available commands or things like that
onParameterRefresh(async () => {
  handledCommands = await getAvailableCommands();
})

const emitFakeMessage = async () => {
  const author: MessageAuthor = {
    id: "-29389323",
    name: "Test User",
    avatarUrl: ""
  };
  const chat: MessageChat = {
    id: "msg-1",
    title: "Test Message"
  };

  const message: Message = {
    id: "msg-1",
    content: "/ping This is a test message",
    author,
    chat,
    timestamp: new Date(),
    platform: 'none'
  };

  await processCommand(message);
};

export const processCommand = async (msg: Message) => {
  if (!msg.content.startsWith("/")) return;

  const [name, ...args] = msg.content.slice(1).split(" ");
  if (!name || !handledCommands.includes(name.toLowerCase())) return warn('inbounder', `Unknown command: ${name}`);

  const cmd: IncomingCommand = {
    name: name!.toLowerCase(),
    args,
    message: msg,
  };

  await commandQueue.add(`${msg.platform}: ${name} (${msg.author.name} @ ${msg.chat.title})`, cmd, {
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 }
  });
}
