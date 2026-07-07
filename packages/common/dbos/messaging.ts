import type { CommandContext } from "../commands/index"
import type { IncomingCommand, PendingResponse } from "../commands/types"
import { responseQueue } from "../queue"

type MessageReply = string

export const reply = async (cmd: IncomingCommand, content: MessageReply) => {
    await responseQueue.add('sendMessage', {
        method: 'sendMessage',
        chatId: cmd.message.chat.id,
        content,
        replyToMessageId: cmd.message.id,
        platform: cmd.message.platform,
    } satisfies PendingResponse)
}
