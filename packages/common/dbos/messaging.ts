import type { IncomingCommand, InlineReplyOptions, PendingResponse, StoredStep } from "../commands/types"
import { responseQueue, rawClient } from "../queue"

export type MessageReply = string | {
    content?: string;
    photoUrl?: string;
    editMessageId?: string;
    buttons?: Array<{ text: string; callbackData?: string; url?: string }>;
}

const WORKFLOW_TTL_SECONDS = 1 * 60 * 60

export const reply = async (cmd: IncomingCommand, content: MessageReply | InlineReplyOptions) => {
    if (typeof content === 'string' || !('options' in content)) {
        const text = typeof content === 'string' ? content : content.content;
        const photoUrl = typeof content === 'string' ? undefined : content.photoUrl;
        const editMessageId = typeof content === 'string' ? undefined : content.editMessageId;
        const buttons = typeof content === 'string' ? undefined : content.buttons;

        let method: PendingResponse['method'] = 'sendMessage';
        if (editMessageId) {
            method = photoUrl ? 'editMessageCaption' : 'editMessageText';
        } else if (photoUrl) {
            method = 'sendPhoto';
        }

        await responseQueue.add('sendMessage', {
            method,
            chatId: cmd.message.chat.id,
            content: text,
            photoUrl,
            messageId: editMessageId,
            replyToMessageId: editMessageId ? undefined : cmd.message.id,
            platform: cmd.message.platform,
            buttons,
        } satisfies PendingResponse)
        return
    }

    const stored: StoredStep = {
        options: content.options.map((o, i) => ({ id: String(i), data: o.data })),
        authorIds: content.authorIds ?? [cmd.message.author.id],
        restricted: content.restricted,
    }
    const redisKey = `workflow:${cmd.workflowIDToBeAssigned}`
    await rawClient.hSet(redisKey, content.eventName, JSON.stringify(stored))
    await rawClient.expire(redisKey, WORKFLOW_TTL_SECONDS)

    const buttons = content.options.map((o, i) => ({
        text: o.title,
        callbackData: `${cmd.workflowIDToBeAssigned}.${content.eventName}.${i}`,
    }))

    const method = content.editMessageId ? 'editMessageText' : 'sendMessage';

    await responseQueue.add('sendMessage', {
        method,
        chatId: cmd.message.chat.id,
        content: content.content,
        messageId: content.editMessageId,
        replyToMessageId: content.editMessageId ? undefined : cmd.message.id,
        platform: cmd.message.platform,
        buttons,
    } satisfies PendingResponse)
}

export const deleteMsg = async (cmd: IncomingCommand, messageId: string) => {
    await responseQueue.add('sendMessage', {
        method: 'deleteMessage',
        chatId: cmd.message.chat.id,
        messageId,
        platform: cmd.message.platform,
    } satisfies PendingResponse)
}
