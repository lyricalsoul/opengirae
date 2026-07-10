import type { IncomingCommand, InlineReplyOptions, PendingResponse, StoredStep } from "../commands/types"
import { responseQueue, rawClient } from "../queue"
import { groups } from "../utilities/groups"

export interface ButtonSpec {
    text: string;
    callbackData?: string;
    url?: string;
    quickView?: { handler: string; arg: string };
    page?: { handler: string; arg: string; page: number };
    // simulates a command `/name arg1 arg2...`
    runCommand?: { name: string; args: string[] };
}

export const toPageButton = (handler: string, b: { text: string; arg: string; page: number }): ButtonSpec =>
    ({ text: b.text, page: { handler, arg: b.arg, page: b.page } })

export type MessageReply = string | {
    content?: string;
    photoUrl?: string;
    editMessageId?: string;
    buttons?: ButtonSpec[];
    buttonRows?: ButtonSpec[][];
}

const WORKFLOW_TTL_SECONDS = 1 * 60 * 60
const PENDING_TEXT_TTL_SECONDS = 1 * 60 * 60

const RESPONSE_JOB_OPTIONS = { attempts: 3, backoff: { type: 'exponential', delay: 1000 } } as const

const isAnimatedMediaUrl = (url?: string) => !!url && /\.(gif|mp4|webm)(\?|#|$)/i.test(url)

const resolveButton = (cmd: IncomingCommand, b: ButtonSpec) => ({
    text: b.text,
    url: b.url,
    callbackData: b.quickView
        ? `qv:${b.quickView.handler}:${b.quickView.arg}`
        : b.page
            ? `pg:${b.page.handler}:${b.page.page}:${cmd.message.author.id}:${b.page.arg}`
            : b.runCommand
                ? `cmd:${b.runCommand.name}:${b.runCommand.args.join(',')}`
                : b.callbackData,
})

export const reply = async (cmd: IncomingCommand, content: MessageReply | InlineReplyOptions) => {
    if (typeof content === 'string' || !('options' in content)) {
        const text = typeof content === 'string' ? content : content.content;
        const photoUrl = typeof content === 'string' ? undefined : content.photoUrl;
        const editMessageId = typeof content === 'string' ? undefined : content.editMessageId;
        const buttons = typeof content === 'string' ? undefined
            : content.buttonRows ? content.buttonRows.map(row => row.map(b => resolveButton(cmd, b)))
                : content.buttons ? [content.buttons.map(b => resolveButton(cmd, b))]
                    : undefined;

        let method: PendingResponse['method'] = 'sendMessage';
        if (editMessageId) {
            method = photoUrl ? 'editMessageCaption' : 'editMessageText';
        } else if (photoUrl) {
            method = isAnimatedMediaUrl(photoUrl) ? 'sendAnimation' : 'sendPhoto';
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
        } satisfies PendingResponse, RESPONSE_JOB_OPTIONS)
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

    const flatButtons = content.options.map((o, i) => ({
        text: o.title,
        callbackData: `${cmd.workflowIDToBeAssigned}.${content.eventName}.${i}`,
    }))
    const buttons = content.rows ? groups(flatButtons, content.rows) : [flatButtons]

    const method = content.photoUrl
        ? (content.editMessageId ? 'editMessageCaption' : (isAnimatedMediaUrl(content.photoUrl) ? 'sendAnimation' : 'sendPhoto'))
        : (content.editMessageId ? 'editMessageText' : 'sendMessage');

    await responseQueue.add('sendMessage', {
        method,
        chatId: cmd.message.chat.id,
        content: content.content,
        photoUrl: content.photoUrl,
        messageId: content.editMessageId,
        replyToMessageId: content.editMessageId ? undefined : cmd.message.id,
        platform: cmd.message.platform,
        buttons,
    } satisfies PendingResponse, RESPONSE_JOB_OPTIONS)
}

export const awaitTextReply = async (cmd: IncomingCommand, eventName: string) => {
    const key = `pendingText:${cmd.message.chat.id}:${cmd.message.author.id}`
    await rawClient.set(key, JSON.stringify({
        workflowID: cmd.workflowIDToBeAssigned,
        eventName,
    }), { EX: PENDING_TEXT_TTL_SECONDS })
}

export const deleteMsg = async (cmd: IncomingCommand, messageId: string) => {
    await responseQueue.add('sendMessage', {
        method: 'deleteMessage',
        chatId: cmd.message.chat.id,
        messageId,
        platform: cmd.message.platform,
    } satisfies PendingResponse, RESPONSE_JOB_OPTIONS)
}
