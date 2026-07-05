import { Queue } from "bullmq";
import type { IncomingCommand, PendingResponse } from "../commands/types";
import { COMMAND_QUEUE_NAME, RESPONSE_QUEUE_NAME } from "../constants";

/// Queue for processing incoming commands (inbounder > commandeer)
export const commandQueue = new Queue<IncomingCommand>(COMMAND_QUEUE_NAME)

/// Queue for responses to be sent (commandeer > answerer)
export const responseQueue = new Queue<PendingResponse>(RESPONSE_QUEUE_NAME)
