import { createRestManager } from '@discordeno/rest'
import { MessageComponentTypes, ButtonStyles, InteractionResponseTypes, MessageFlags } from '@discordeno/types'
import type { PendingResponse } from '@girae/common/commands/types'
import { error, warn } from '@girae/common/logger'

const manager = createRestManager({
  token: process.env.DISCORD_TOKEN!,
})

const BRAND_COLOR = 0xFF94DB

function hexToDiscordColor(hex?: string): number {
  const parsed = hex ? parseInt(hex.replace('#', ''), 16) : NaN
  return Number.isNaN(parsed) ? BRAND_COLOR : parsed
}

function unescapeHtmlEntities(text?: string): string | undefined {
  return text?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

const BUTTON_COLOR_STYLES: Record<string, ButtonStyles> = {
  secondary: ButtonStyles.Secondary,
  success: ButtonStyles.Success,
  danger: ButtonStyles.Danger,
  primary: ButtonStyles.Primary,
}

function buildComponents(buttons?: PendingResponse['buttons']) {
  if (!buttons?.length) return []
  return buttons.map(row => ({
    type: MessageComponentTypes.ActionRow,
    components: row.map(b => b.url
      ? { type: MessageComponentTypes.Button, style: ButtonStyles.Link, label: b.text, url: b.url }
      : { type: MessageComponentTypes.Button, style: BUTTON_COLOR_STYLES[b.color ?? 'primary'], label: b.text, customId: b.callbackData }
    ),
  })) as any
}

function imageFileName(url: string): string {
  const ext = /\.(png|jpe?g|webp|gif)(\?|#|$)/i.exec(url)?.[1]?.toLowerCase() ?? 'png'
  return `image.${ext}`
}

async function fetchAsAttachment(photoUrl: string): Promise<{ file: { blob: Blob; name: string }; embedImageUrl: string } | undefined> {
  try {
    const res = await fetch(photoUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const name = imageFileName(photoUrl)
    const blob = await res.blob()
    return { file: { blob, name }, embedImageUrl: `attachment://${name}` }
  } catch (e) {
    warn('answerer', `Failed to fetch Discord image attachment from ${photoUrl}, falling back to direct URL: ${e}`)
    return undefined
  }
}

async function buildEmbedAndFile(content?: string, photoUrl?: string, embedColor?: string, embedFields?: PendingResponse['embedFields']) {
  const attachment = photoUrl ? await fetchAsAttachment(photoUrl) : undefined
  const embeds = [{
    description: unescapeHtmlEntities(content),
    color: hexToDiscordColor(embedColor),
    image: photoUrl ? { url: attachment?.embedImageUrl ?? photoUrl } : undefined,
    fields: embedFields,
    timestamp: new Date().toISOString(),
    footer: { text: 'Giraê' },
  }]
  return { embeds, files: attachment ? [attachment.file] : undefined }
}

function splitInteractionId(callbackQueryId: string): { interactionId: bigint; token: string } {
  const sep = callbackQueryId.indexOf(':')
  return { interactionId: BigInt(callbackQueryId.slice(0, sep)), token: callbackQueryId.slice(sep + 1) }
}

export async function sendDiscordAnswer(response: PendingResponse): Promise<string | undefined> {
  switch (response.method) {
    case 'sendMessage':
    case 'sendPhoto':
    case 'sendAnimation': {
      const { embeds, files } = await buildEmbedAndFile(response.content, response.photoUrl, response.embedColor, response.embedFields)
      const msg = await manager.sendMessage(BigInt(response.chatId), {
        embeds,
        files,
        ...(response.replyToMessageId ? {
          messageReference: {
            messageId: BigInt(response.replyToMessageId),
            failIfNotExists: false,
          }
        } : {}),
        components: buildComponents(response.buttons),
      })
      return String(msg.id)
    }
    case 'editMessageText':
    case 'editMessageCaption':
    case 'editMessageMedia': {
      const { embeds, files } = await buildEmbedAndFile(response.content, response.photoUrl, response.embedColor, response.embedFields)
      if (response.interactionToken) {
        const msg = await manager.editOriginalInteractionResponse(response.interactionToken, {
          embeds,
          files,
          components: buildComponents(response.buttons),
        })
        return String(msg.id)
      }

      const msg = await manager.editMessage(BigInt(response.chatId), BigInt(response.messageId!), {
        embeds,
        files,
        components: buildComponents(response.buttons),
      })
      return String(msg.id)
    }
    case 'deleteMessage':
      await manager.deleteMessage(BigInt(response.chatId), BigInt(response.messageId!))
      return
    case 'answerCallbackQuery': {
      const { interactionId, token } = splitInteractionId(response.callbackQueryId!)
      if (response.content) {
        await manager.sendInteractionResponse(interactionId, token, {
          type: InteractionResponseTypes.ChannelMessageWithSource,
          data: { content: unescapeHtmlEntities(response.content), flags: MessageFlags.Ephemeral },
        })
      } else {
        await manager.sendInteractionResponse(interactionId, token, {
          type: InteractionResponseTypes.DeferredUpdateMessage,
        })
      }
      return
    }
    default:
      error('answerer', `Unimplemented Discord method: ${response.method}`)
      throw new Error(`Unimplemented Discord method: ${response.method}`)
  }
}
