import { TelegramClient } from 'telegramsjs'
import type { PendingResponse } from '@girae/common/commands/types'
import { error, warn } from '@girae/common/logger'
import { marked } from 'marked'

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

export async function sendTelegramAnswer(response: PendingResponse) {
  const formattedContent = await processMarkdown(response.content);

  switch (response.method) {
    case 'sendMessage':
      await tg.sendMessage({
        chatId: response.chatId,
        text: formattedContent ?? '',
        parseMode: 'HTML',
        disableNotification: true,
        ...buildReplyParameters(response.replyToMessageId, false),
        ...buildReplyMarkup(response.buttons)
      })
      break
    case 'editMessageText':
      await tg.editMessageText({
        chatId: response.chatId,
        messageId: response.messageId!,
        text: formattedContent!,
        parseMode: 'HTML',
        ...buildReplyMarkup(response.buttons)
      })
      break
    case 'editMessageCaption':
      await tg.editMessageCaption({
        chatId: response.chatId,
        messageId: response.messageId!,
        caption: formattedContent,
        parseMode: 'HTML',
        ...buildReplyMarkup(response.buttons)
      })
      break
    case 'sendPhoto': {
      const photoUrl = response.photoUrl!
      if (!isValidHttpUrl(photoUrl)) {
        warn('answerer', `sendPhoto received invalid URL, falling back to sendMessage: ${photoUrl}`)
        await tg.sendMessage({
          chatId: response.chatId,
          text: formattedContent ?? '',
          parseMode: 'HTML',
          ...buildReplyParameters(response.replyToMessageId, false),
          ...buildReplyMarkup(response.buttons)
        })
        break
      }
      await tg.sendPhoto({
        chatId: response.chatId,
        photo: photoUrl,
        caption: formattedContent,
        parseMode: 'HTML',
        ...buildReplyParameters(response.replyToMessageId, true),
        ...buildReplyMarkup(response.buttons)
      })
      break
    }
    case 'sendAnimation': {
      const animationUrl = response.photoUrl!
      if (!isValidHttpUrl(animationUrl)) {
        warn('answerer', `sendAnimation received invalid URL, falling back to sendMessage: ${animationUrl}`)
        await tg.sendMessage({
          chatId: response.chatId,
          text: formattedContent ?? '',
          parseMode: 'HTML',
          ...buildReplyParameters(response.replyToMessageId, false),
          ...buildReplyMarkup(response.buttons)
        })
        break
      }
      await tg.sendAnimation({
        chatId: response.chatId,
        animation: animationUrl,
        caption: formattedContent,
        parseMode: 'HTML',
        ...buildReplyParameters(response.replyToMessageId, true),
        ...buildReplyMarkup(response.buttons)
      })
      break
    }
    case 'deleteMessage':
      await tg.deleteMessage(response.chatId,
        Number(response.messageId!))
      break
    case 'answerCallbackQuery':
      await tg.answerCallbackQuery({
        callbackQueryId: response.callbackQueryId!,
        text: response.content,
        showAlert: true,
      })
      break
    default:
      error('answerer', `Unimplemented Telegram method: ${response.method}`)
      throw new Error(`Unimplemented Telegram method: ${response.method}`)
  }
}
