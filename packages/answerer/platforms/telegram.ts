import { TelegramClient } from 'telegramsjs'
import type { PendingResponse } from '@girae/common/commands/types'
import { error, warn } from '@girae/common/logger'
import { parseMediaRef, resolveFilePath } from '@girae/common/media/mediaRef'
import { marked } from 'marked'
import type { SendResult } from '../handler'

const tg = new TelegramClient(process.env.TELEGRAM_TOKEN!)

async function processMarkdown(text?: string): Promise<string | undefined> {
  if (!text) return undefined;

  const html = await marked.parseInline(text, { gfm: true });

  return (html as string).trim();
}

function isValidHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const isAnimatedMediaUrl = (url: string) => /\.(gif|mp4|webm)(\?|#|$)/i.test(url)

// Telegram's two failure messages for a URL that isn't a valid silent animation.
export const isRetriableAsVideo = (e: any) =>
  /failed to get http url content|wrong type of the web page content/i.test(e?.message ?? '')

function buildReplyParameters(replyToMessageId: string | undefined, multipart: boolean): { replyParameters?: any } {
  if (!replyToMessageId) return {}
  const params = { message_id: replyToMessageId, allow_sending_without_reply: false }
  return { replyParameters: multipart ? JSON.stringify(params) : params }
}

function buildReplyMarkup(buttons?: PendingResponse['buttons']) {
  if (!buttons?.length) return {}
  return {
    replyMarkup: {
      inline_keyboard: buttons.map(row => row.map(b => {
        const btn: any = { text: b.text }
        if (b.callbackData) btn.callback_data = b.callbackData
        if (b.url) btn.url = b.url
        return btn
      }))
    }
  }
}

function buildInlineKeyboard(buttons?: PendingResponse['buttons']) {
  if (!buttons?.length) return undefined
  return buttons.map(row => row.map(b => {
    const btn: any = { text: b.text }
    if (b.callbackData) btn.callback_data = b.callbackData
    if (b.url) btn.url = b.url
    return btn
  }))
}

async function editMessageMediaRaw(params: {
  chatId: string
  messageId: string
  photoUrl: string
  isAnimated: boolean
  isVideo?: boolean
  caption?: string
  buttons?: PendingResponse['buttons']
}): Promise<string> {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/editMessageMedia`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: params.chatId,
      message_id: Number(params.messageId),
      media: {
        type: params.isVideo ? 'video' : params.isAnimated ? 'animation' : 'photo',
        media: params.photoUrl,
        caption: params.caption,
        parse_mode: 'HTML',
      },
      ...(buildInlineKeyboard(params.buttons) ? { reply_markup: { inline_keyboard: buildInlineKeyboard(params.buttons) } } : {}),
    }),
  })
  const json: any = await res.json()
  if (!json.ok) {
    // must carry .parameters/.code like telegramsjs's HTTPResponseError, or the rate-limit retry in answerer/index.ts never fires
    const err = new Error(`Bad Request: ${json.description}`) as Error & { parameters?: unknown; code?: number }
    err.parameters = json.parameters
    err.code = json.error_code
    throw err
  }
  return String(json.result?.message_id ?? params.messageId)
}

// telegram's cap on a media caption (plain messages allow 4096); measured on the html we send, so it errs toward splitting
const MAX_CAPTION_LENGTH = 1024

export async function sendTelegramAnswer(response: PendingResponse): Promise<SendResult | undefined> {
  const formattedContent = await processMarkdown(response.content);

  switch (response.method) {
    case 'sendMessage': {
      const msg = await tg.sendMessage({
        chatId: response.chatId,
        messageThreadId: response.threadId,
        text: formattedContent ?? '',
        parseMode: 'HTML',
        disableNotification: true,
        ...buildReplyParameters(response.replyToMessageId, false),
        ...buildReplyMarkup(response.buttons)
      })
      return { messageId: msg.id }
    }
    case 'editMessageMedia': {
      const photoUrl = response.photoUrl
      if (!photoUrl || !isValidHttpUrl(photoUrl)) {
        warn('answerer', `editMessageMedia received invalid URL, falling back to editMessageText: ${photoUrl}`)
        const result = await tg.editMessageText({
          chatId: response.chatId,
          messageId: response.messageId!,
          text: formattedContent!,
          parseMode: 'HTML',
          ...buildReplyMarkup(response.buttons)
        })
        return { messageId: result === true ? response.messageId : result.id }
      }
      return { messageId: await editMessageMediaRaw({
        chatId: response.chatId,
        messageId: response.messageId!,
        photoUrl,
        isAnimated: isAnimatedMediaUrl(photoUrl),
        isVideo: response.isVideo,
        caption: formattedContent,
        buttons: response.buttons,
      }) }
    }
    case 'editMessageCaption': {
      const result = await tg.editMessageCaption({
        chatId: response.chatId,
        messageId: response.messageId!,
        caption: formattedContent,
        parseMode: 'HTML',
        ...buildReplyMarkup(response.buttons)
      })
      return { messageId: result === true ? response.messageId : result.id }
    }
    case 'editMessageText': {
      try {
        const result = await tg.editMessageText({
          chatId: response.chatId,
          messageId: response.messageId!,
          text: formattedContent!,
          parseMode: 'HTML',
          ...buildReplyMarkup(response.buttons)
        })
        return { messageId: result === true ? response.messageId : result.id }
      } catch (e: any) {
        if (!/no text in the message to edit/i.test(e?.message ?? '')) throw e
        warn('answerer', `editMessageText rejected message ${response.messageId} as having no text, retrying as editMessageCaption`)
        const result = await tg.editMessageCaption({
          chatId: response.chatId,
          messageId: response.messageId!,
          caption: formattedContent,
          parseMode: 'HTML',
          ...buildReplyMarkup(response.buttons)
        })
        return { messageId: result === true ? response.messageId : result.id }
      }
    }
    case 'sendPhoto': {
      const photoUrl = response.photoUrl!
      if (!isValidHttpUrl(photoUrl)) {
        warn('answerer', `sendPhoto received invalid URL, falling back to sendMessage: ${photoUrl}`)
        const msg = await tg.sendMessage({
          chatId: response.chatId,
          messageThreadId: response.threadId,
          text: formattedContent ?? '',
          parseMode: 'HTML',
          ...buildReplyParameters(response.replyToMessageId, false),
          ...buildReplyMarkup(response.buttons)
        })
        return { messageId: msg.id }
      }
      if ((formattedContent?.length ?? 0) > MAX_CAPTION_LENGTH) {
        // over the caption cap telegram rejects the whole send, so the photo goes bare and the text follows as its own message (which keeps the buttons)
        await tg.sendPhoto({
          chatId: response.chatId,
          messageThreadId: response.threadId,
          photo: photoUrl,
          ...buildReplyParameters(response.replyToMessageId, true),
        })
        const textMsg = await tg.sendMessage({
          chatId: response.chatId,
          messageThreadId: response.threadId,
          text: formattedContent!,
          parseMode: 'HTML',
          ...buildReplyMarkup(response.buttons)
        })
        return { messageId: textMsg.id }
      }
      const msg = await tg.sendPhoto({
        chatId: response.chatId,
        messageThreadId: response.threadId,
        photo: photoUrl,
        caption: formattedContent,
        parseMode: 'HTML',
        ...buildReplyParameters(response.replyToMessageId, true),
        ...buildReplyMarkup(response.buttons)
      })
      return { messageId: msg.id }
    }
    case 'sendAnimation': {
      const animationUrl = response.photoUrl!
      if (!isValidHttpUrl(animationUrl)) {
        warn('answerer', `sendAnimation received invalid URL, falling back to sendMessage: ${animationUrl}`)
        const msg = await tg.sendMessage({
          chatId: response.chatId,
          messageThreadId: response.threadId,
          text: formattedContent ?? '',
          parseMode: 'HTML',
          ...buildReplyParameters(response.replyToMessageId, false),
          ...buildReplyMarkup(response.buttons)
        })
        return { messageId: msg.id }
      }
      try {
        const msg = await tg.sendAnimation({
          chatId: response.chatId,
          messageThreadId: response.threadId,
          animation: animationUrl,
          caption: formattedContent,
          parseMode: 'HTML',
          ...buildReplyParameters(response.replyToMessageId, true),
          ...buildReplyMarkup(response.buttons)
        })
        return { messageId: msg.id }
      } catch (e: any) {
        // real video (has audio) misclassified upstream as an animation - retry as sendVideo.
        if (!isRetriableAsVideo(e)) throw e
        warn('answerer', `sendAnimation rejected ${animationUrl} as wrong type, retrying as sendVideo: ${e.message}`)
        const msg = await tg.sendVideo({
          chatId: response.chatId,
          messageThreadId: response.threadId,
          video: animationUrl,
          caption: formattedContent,
          parseMode: 'HTML',
          ...buildReplyParameters(response.replyToMessageId, true),
          ...buildReplyMarkup(response.buttons)
        })
        return { messageId: msg.id }
      }
    }
    case 'sendVideo': {
      const videoUrl = response.photoUrl!
      if (!isValidHttpUrl(videoUrl)) {
        warn('answerer', `sendVideo received invalid URL, falling back to sendMessage: ${videoUrl}`)
        const msg = await tg.sendMessage({
          chatId: response.chatId,
          messageThreadId: response.threadId,
          text: formattedContent ?? '',
          parseMode: 'HTML',
          ...buildReplyParameters(response.replyToMessageId, false),
          ...buildReplyMarkup(response.buttons)
        })
        return { messageId: msg.id }
      }
      // same multipart reply_parameters quirk as sendPhoto/sendAnimation (see docs/agent/04-dbos.md)
      const msg = await tg.sendVideo({
        chatId: response.chatId,
        messageThreadId: response.threadId,
        video: videoUrl,
        caption: formattedContent,
        parseMode: 'HTML',
        ...buildReplyParameters(response.replyToMessageId, true),
        ...buildReplyMarkup(response.buttons)
      })
      return { messageId: msg.id }
    }
    case 'sendAudio': {
      const performer = response.audio?.performer
      const title = response.audio?.title

      const thumbnail = response.audio?.thumbnailUrl

      if (response.audioFileId) {
        const msg = await tg.sendAudio({
          chatId: response.chatId,
          messageThreadId: response.threadId,
          audio: response.audioFileId,
          caption: formattedContent,
          parseMode: 'HTML',
          performer,
          title,
          thumbnail,
          ...buildReplyParameters(response.replyToMessageId, true),
          ...buildReplyMarkup(response.buttons)
        })
        return { messageId: msg.id, telegramFileId: msg.audio?.id, telegramFileUniqueId: msg.audio?.uniqueId }
      }

      const audioUrl = response.audioUrl!
      if (!isValidHttpUrl(audioUrl) && !audioUrl.startsWith('file://')) {
        warn('answerer', `sendAudio received invalid reference, falling back to sendMessage: ${audioUrl}`)
        const msg = await tg.sendMessage({
          chatId: response.chatId,
          messageThreadId: response.threadId,
          text: formattedContent ?? '',
          parseMode: 'HTML',
          ...buildReplyParameters(response.replyToMessageId, false),
          ...buildReplyMarkup(response.buttons)
        })
        return { messageId: msg.id }
      }

      // a URL-based `audio` drops performer/title/cover - only a real upload keeps them
      let audioBuffer: Buffer
      if (audioUrl.startsWith('file://')) {
        const ref = parseMediaRef(audioUrl)
        if (ref.kind !== 'file') throw new Error(`unreachable: ${audioUrl} parsed as non-file ref`)
        // telegram-volume zero-copy send is deferred until the local bot-api server exists
        const file = Bun.file(resolveFilePath(ref))
        if (!(await file.exists()) || file.size === 0) {
          warn('answerer', `sendAudio: scratch file missing or empty at ${resolveFilePath(ref)} (SCRATCH_DIR not shared with the writer, or cleaned up already?), falling back to sendMessage`)
          const msg = await tg.sendMessage({
            chatId: response.chatId,
            messageThreadId: response.threadId,
            text: formattedContent ?? '',
            parseMode: 'HTML',
            ...buildReplyParameters(response.replyToMessageId, false),
            ...buildReplyMarkup(response.buttons)
          })
          return { messageId: msg.id }
        }
        audioBuffer = Buffer.from(await file.arrayBuffer())
      } else {
        const audioRes = await fetch(audioUrl)
        audioBuffer = Buffer.from(await audioRes.arrayBuffer())
      }

      const msg = await tg.sendAudio({
        chatId: response.chatId,
        messageThreadId: response.threadId,
        audio: audioBuffer,
        caption: formattedContent,
        parseMode: 'HTML',
        performer,
        title,
        thumbnail,
        ...buildReplyParameters(response.replyToMessageId, true),
        ...buildReplyMarkup(response.buttons)
      })
      return { messageId: msg.id, telegramFileId: msg.audio?.id, telegramFileUniqueId: msg.audio?.uniqueId }
    }
    case 'deleteMessage':
      await tg.deleteMessage(response.chatId,
        Number(response.messageId!))
      return
    case 'answerCallbackQuery':
      await tg.answerCallbackQuery({
        callbackQueryId: response.callbackQueryId!,
        text: response.content,
        showAlert: !!response.content,
      })
      return
    default:
      error('answerer', `Unimplemented Telegram method: ${response.method}`)
      throw new Error(`Unimplemented Telegram method: ${response.method}`)
  }
}
