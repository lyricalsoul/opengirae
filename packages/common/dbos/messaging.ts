import { DBOS } from "@dbos-inc/dbos-sdk"
import type { IncomingCommand, InlineReplyOptions, PendingResponse, StoredStep, ButtonColor, InlineOption } from "../commands/types"
import { responseQueue, responseQueueEvents, rawClient } from "../queue"
import { groups } from "../utilities/groups"
import { error as logError } from "../logger"
import { db } from "@girae/database/index"
import { users, userProfiles, linkedAccounts } from "@girae/database/schemas/users"
import { eq, and } from "drizzle-orm"
import { maybeStep } from "./maybeStep"

async function settleReply(job: Awaited<ReturnType<typeof responseQueue.add>>): Promise<string | undefined> {
    try {
        return await job.waitUntilFinished(responseQueueEvents)
    } catch (e) {
        logError('messaging', `reply job ${job.id} failed: ${e}`)
        return undefined
    }
}

export interface ButtonSpec {
    text: string;
    callbackData?: string;
    url?: string;
    color?: ButtonColor;
    quickView?: { handler: string; arg: string };
    page?: { handler: string; arg: string; page: number };
    // simulates a command `/name arg1 arg2...`
    runCommand?: { name: string; args: string[] };
}

export const toPageButton = (handler: string, b: { text: string; arg: string; page: number }): ButtonSpec =>
    ({ text: b.text, page: { handler, arg: b.arg, page: b.page } })

export function pageNavSteps(page: number, hasNext: boolean, totalPages: number | undefined): { text: string; page: number }[] {
    const lastPage = (totalPages ?? 1) - 1
    return [
        ...(page > 1 ? [{ text: '⏮️', page: 0 }] : []),
        ...(page > 0 ? [{ text: '⬅️', page: page - 1 }] : []),
        ...(hasNext ? [{ text: '➡️', page: page + 1 }] : []),
        ...(lastPage - page > 1 ? [{ text: '⏭️', page: lastPage }] : []),
    ]
}

export function pageNavRow(handler: string, arg: string, page: number, hasNext: boolean, totalPages: number | undefined): ButtonSpec[] {
    return pageNavSteps(page, hasNext, totalPages).map(s => toPageButton(handler, { text: s.text, arg, page: s.page }))
}

export type MessageReply = string | {
    content?: string;
    photoUrl?: string;
    editMessageId?: string;
    buttons?: ButtonSpec[];
    buttonRows?: ButtonSpec[][];
    captionOnly?: boolean;
    embedFields?: { name: string; value: string; inline?: boolean }[];
}

const WORKFLOW_TTL_SECONDS = 1 * 60 * 60
const PENDING_TEXT_TTL_SECONDS = 1 * 60 * 60

const RESPONSE_JOB_OPTIONS = { attempts: 3, backoff: { type: 'exponential', delay: 1000 } } as const

const isAnimatedMediaUrl = (url?: string) => !!url && /\.(gif|mp4|webm)(\?|#|$)/i.test(url)

async function getEmbedColor(cmd: IncomingCommand): Promise<string | undefined> {
    if (cmd.message.platform !== 'discord') return undefined
    const row = await db
        .select({ favoriteColor: userProfiles.favoriteColor })
        .from(userProfiles)
        .innerJoin(users, eq(userProfiles.userId, users.id))
        .innerJoin(linkedAccounts, eq(linkedAccounts.userId, users.id))
        .where(and(eq(linkedAccounts.platform, 'discord'), eq(linkedAccounts.platformId, cmd.message.author.id)))
        .limit(1)
        .then(rows => rows[0])
    return row?.favoriteColor
}

export function buildInteractiveButtons(workflowID: string, eventName: string, options: InlineOption[], rows?: number[]): ButtonSpec[][] {
    const flatButtons = options.map((o, i) => ({
        text: o.title,
        callbackData: `${workflowID}.${eventName}.${i}`,
        color: o.color,
    }))
    return rows ? groups(flatButtons, rows) : [flatButtons]
}

const resolveButton = (cmd: IncomingCommand, b: ButtonSpec) => ({
    text: b.text,
    url: b.url,
    color: b.color,
    callbackData: b.quickView
        ? `qv:${b.quickView.handler}:${b.quickView.arg}`
        : b.page
            ? `pg:${b.page.handler}:${b.page.page}:${cmd.message.author.id}:${b.page.arg}`
            : b.runCommand
                ? `cmd:${b.runCommand.name}:${b.runCommand.args.join(',')}`
                : b.callbackData,
})

export const reply = maybeStep('reply', async (cmd: IncomingCommand, content: MessageReply | InlineReplyOptions): Promise<string | undefined> => {
    if (typeof content === 'string' || !('options' in content)) {
        const text = typeof content === 'string' ? content : content.content;
        const photoUrl = typeof content === 'string' ? undefined : content.photoUrl;
        const editMessageId = typeof content === 'string' ? undefined : content.editMessageId;
        const captionOnly = typeof content === 'string' ? false : !!content.captionOnly;
        const embedFields = typeof content === 'string' ? undefined : content.embedFields;
        const buttons = typeof content === 'string' ? undefined
            : content.buttonRows ? content.buttonRows.map(row => row.map(b => resolveButton(cmd, b)))
                : content.buttons ? [content.buttons.map(b => resolveButton(cmd, b))]
                    : undefined;

        const targetMessageId = editMessageId ?? (cmd.message.platform === 'discord' ? cmd.message.id : undefined);
        const interactionToken = targetMessageId === cmd.message.id ? cmd.message.interactionToken : undefined;

        let method: PendingResponse['method'] = 'sendMessage';
        if (targetMessageId) {
            method = photoUrl ? (captionOnly ? 'editMessageCaption' : 'editMessageMedia') : 'editMessageText';
        } else if (photoUrl) {
            method = isAnimatedMediaUrl(photoUrl) ? 'sendAnimation' : 'sendPhoto';
        }

        const job = await responseQueue.add('sendMessage', {
            method,
            chatId: cmd.message.chat.id,
            content: text,
            photoUrl,
            messageId: targetMessageId,
            replyToMessageId: targetMessageId ? undefined : cmd.message.id,
            platform: cmd.message.platform,
            buttons,
            interactionToken,
            embedColor: await getEmbedColor(cmd),
            embedFields,
        } satisfies PendingResponse, RESPONSE_JOB_OPTIONS)
        return settleReply(job)
    }

    const stored: StoredStep = {
        options: content.options.map((o, i) => ({ id: String(i), data: o.data })),
        authorIds: content.authorIds ?? [cmd.message.author.id],
        restricted: content.restricted,
        multiUse: content.multiUse ?? false,
    }
    const redisKey = `workflow:${cmd.workflowIDToBeAssigned}`
    await rawClient.hSet(redisKey, content.eventName, JSON.stringify(stored))
    await rawClient.expire(redisKey, WORKFLOW_TTL_SECONDS)

    const buttons = buildInteractiveButtons(cmd.workflowIDToBeAssigned, content.eventName, content.options, content.rows)

    const targetMessageId = content.editMessageId ?? (cmd.message.platform === 'discord' ? cmd.message.id : undefined);
    const interactionToken = targetMessageId === cmd.message.id ? cmd.message.interactionToken : undefined;

    const method: PendingResponse['method'] = targetMessageId
        ? (content.photoUrl ? 'editMessageMedia' : 'editMessageText')
        : content.photoUrl
            ? (isAnimatedMediaUrl(content.photoUrl) ? 'sendAnimation' : 'sendPhoto')
            : 'sendMessage';

    const job = await responseQueue.add('sendMessage', {
        method,
        chatId: cmd.message.chat.id,
        content: content.content,
        photoUrl: content.photoUrl,
        messageId: targetMessageId,
        replyToMessageId: targetMessageId ? undefined : cmd.message.id,
        platform: cmd.message.platform,
        buttons,
        interactionToken,
        embedColor: await getEmbedColor(cmd),
    } satisfies PendingResponse, RESPONSE_JOB_OPTIONS)
    return settleReply(job)
})

export const awaitTextReply = maybeStep('awaitTextReply', async (cmd: IncomingCommand, eventName: string) => {
    const key = `pendingText:${cmd.message.chat.id}:${cmd.message.author.id}`
    await rawClient.set(key, JSON.stringify({
        workflowID: cmd.workflowIDToBeAssigned,
        eventName,
    }), { EX: PENDING_TEXT_TTL_SECONDS })
})

export const deleteMsg = maybeStep('deleteMsg', async (cmd: IncomingCommand, messageId: string) => {
    await responseQueue.add('sendMessage', {
        method: 'deleteMessage',
        chatId: cmd.message.chat.id,
        messageId,
        platform: cmd.message.platform,
    } satisfies PendingResponse, RESPONSE_JOB_OPTIONS)
})

export async function awaitMultiPartyChoice<T>(
    cmd: IncomingCommand,
    eventName: string,
    content: { content: string; photoUrl?: string; editMessageId?: string; rows?: number[] },
    options: Array<{ title: string; data: T; color?: ButtonColor }>,
    authorIds: string[],
    isValid: (choice: { data: T; clickerUserId: string }) => boolean,
    timeoutSeconds?: number,

    onProgress?: (choice: { data: T; clickerUserId: string }, buttons: ButtonSpec[][]) => void | Promise<void>,
): Promise<{ data: T; clickerUserId: string; messageId?: string } | null> {
    const buttons = buildInteractiveButtons(cmd.workflowIDToBeAssigned, eventName, options, content.rows)

    await reply(cmd, {
        content: content.content,
        photoUrl: content.photoUrl,
        editMessageId: content.editMessageId,
        rows: content.rows,
        eventName,
        restricted: 'author',
        authorIds,
        multiUse: true,
        options: options.map(o => ({ title: o.title, data: o.data, color: o.color })),
    })

    const deadline = timeoutSeconds ? Date.now() + timeoutSeconds * 1000 : undefined
    while (true) {
        const remainingSeconds = deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : undefined
        const received = await DBOS.recv<{ value: T, messageId?: string, clickerUserId?: string }>(eventName, remainingSeconds)
        if (!received) return null

        const clickerUserId = received.clickerUserId ?? authorIds[0]!
        const choice = { data: received.value, clickerUserId }
        if (!isValid(choice)) {
            await onProgress?.(choice, buttons)
            continue
        }

        await rawClient.hDel(`workflow:${cmd.workflowIDToBeAssigned}`, eventName)
        return { ...choice, messageId: received.messageId }
    }
}
