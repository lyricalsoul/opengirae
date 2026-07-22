import type { MessageChat, Message } from '@girae/common/commands/types'

export const resolveMedia = async (msg: any): Promise<{ photoUrl?: string, isAnimatedPhoto?: boolean }> => {
  if (msg.animation) {
    const file = await msg.animation.fetch()
    return { photoUrl: file.url ?? undefined, isAnimatedPhoto: true }
  }

  if (msg.document?.mimeType?.startsWith('image/')) {
    const file = await msg.document.fetch()
    return { photoUrl: file.url ?? undefined }
  }
  const largest = msg.photo?.[msg.photo.length - 1]
  if (!largest) return {}
  const file = await largest.fetch()
  return { photoUrl: file.url ?? undefined }
}

export async function buildReplyTo(msg: any, chat: MessageChat): Promise<Message | undefined> {
  const isTopicAnchorReply = !!msg.originalMessage?.forumCreated
  if (!msg.originalMessage || isTopicAnchorReply) return undefined

  return {
    content: msg.originalMessage.content ?? msg.originalMessage.caption ?? '',
    id: String(msg.originalMessage.id),
    author: {
      id: msg.originalMessage.author!.id.toString(),
      name: msg.originalMessage.author!.firstName,
      avatarUrl: ''
    },
    chat,
    timestamp: new Date(msg.originalMessage.createdTimestamp),
    platform: 'telegram',
    ...await resolveMedia(msg.originalMessage)
  }
}
