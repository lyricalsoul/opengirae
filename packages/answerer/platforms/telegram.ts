import { TelegramClient } from 'telegramsjs'
import type { PendingResponse } from '@girae/common/commands/types'
import { error } from '@girae/common/logger'
import { marked } from 'marked'

const tg = new TelegramClient(process.env.TELEGRAM_TOKEN!)

async function processMarkdown(text?: string): Promise<string | undefined> {
  if (!text) return undefined;

  const escapedText = text
    .replace(/&(?!#?[a-zA-Z0-9]+;)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const html = await marked.parseInline(escapedText, { gfm: true });

  return (html as string).trim();
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
        replyParameters: response.replyToMessageId ? {
          message_id: response.replyToMessageId,
          allow_sending_without_reply: false
        } : undefined,
        ...(response.buttons?.length ? {
          replyMarkup: {
            inline_keyboard: [
              response.buttons.map(b => {
                const btn: any = { text: b.text }
                if (b.callbackData) btn.callback_data = b.callbackData
                if (b.url) btn.url = b.url
                return btn
              })
            ]
          }
        } : {})
      })
      break
    case 'editMessageText':
      await tg.editMessageText({
        chatId: response.chatId,
        messageId: response.messageId!,
        text: formattedContent!,
        parseMode: 'HTML',
        ...(response.buttons?.length ? {
          replyMarkup: {
            inline_keyboard: [
              response.buttons.map(b => {
                const btn: any = { text: b.text }
                if (b.callbackData) btn.callback_data = b.callbackData
                if (b.url) btn.url = b.url
                return btn
              })
            ]
          }
        } : {})
      })
      break
    case 'editMessageCaption':
      await tg.editMessageCaption({
        chatId: response.chatId,
        messageId: response.messageId!,
        caption: formattedContent,
        parseMode: 'HTML',
        ...(response.buttons?.length ? {
          replyMarkup: {
            inline_keyboard: [
              response.buttons.map(b => {
                const btn: any = { text: b.text }
                if (b.callbackData) btn.callback_data = b.callbackData
                if (b.url) btn.url = b.url
                return btn
              })
            ]
          }
        } : {})
      })
      break
    case 'sendPhoto':
      await tg.sendPhoto({
        chatId: response.chatId,
        photo: response.photoUrl!,
        caption: formattedContent,
        parseMode: 'HTML',
        ...(response.replyToMessageId ? {
          replyParameters: {
            message_id: response.replyToMessageId,
            allow_sending_without_reply: false
          }
        } : {}),
        ...(response.buttons?.length ? {
          replyMarkup: {
            inline_keyboard: [
              response.buttons.map(b => {
                const btn: any = { text: b.text }
                if (b.callbackData) btn.callback_data = b.callbackData
                if (b.url) btn.url = b.url
                return btn
              })
            ]
          }
        } : {})
      })
      break
    case 'deleteMessage':
      await tg.deleteMessage(response.chatId,
        Number(response.messageId!))
      break
    default:
      error('answerer', `Unimplemented Telegram method: ${response.method}`)
      throw new Error(`Unimplemented Telegram method: ${response.method}`)
  }
}
