import type { CommandContext } from "../commands/index"
import type { IncomingCommand, PendingResponse } from "../commands/types"
import { DBOS } from "./index"
import { client } from "./client"
import { MESSAGE_QUEUE_NAME, MESSAGE_SENDER_WORKFLOW_NAME } from "./constants"


type MessageReply = string 
interface AdvancedReplyOptions {
    content: MessageReply
}

export const reply = DBOS.registerStep(async (cmd: IncomingCommand, content: MessageReply) => {
    await client.enqueue({
        workflowName: MESSAGE_SENDER_WORKFLOW_NAME,
        queueName: 'main',
        workflowClassName: 'BotResponseService'
    }, {
        method: 'sendMessage',
        chatId: cmd.message.chat.id,
        content,
        replyToMessageId: cmd.message.id,
        platform: cmd.message.platform,
    } as PendingResponse)
})

