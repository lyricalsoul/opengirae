import type { MessageChat, Message } from '@girae/common/commands/types'

// Telegram's own getFile can refuse a file that's simply too large (independent of any
// limit this bot enforces) - .fetch() throwing must never crash inbound processing.
// Callers downstream (e.g. /upload) still get fileSizeBytes even when the fetch itself
// failed, which is enough to reject oversized media with a real message instead of
// silently dropping the update.
async function safeFetchUrl(file: { fetch(): Promise<{ url: string | null }> }): Promise<string | undefined> {
  try {
    const fetched = await file.fetch()
    return fetched?.url ?? undefined
  } catch {
    return undefined
  }
}

export const resolveMedia = async (msg: any): Promise<{ photoUrl?: string, isAnimatedPhoto?: boolean, isVideo?: boolean, fileSizeBytes?: number }> => {
  if (msg.animation) {
    return { photoUrl: await safeFetchUrl(msg.animation), isAnimatedPhoto: true, fileSizeBytes: msg.animation.size ?? undefined }
  }

  if (msg.video) {
    return { photoUrl: await safeFetchUrl(msg.video), isVideo: true, fileSizeBytes: msg.video.size ?? undefined }
  }

  if (msg.document?.mimeType?.startsWith('image/')) {
    return { photoUrl: await safeFetchUrl(msg.document), fileSizeBytes: msg.document.size ?? undefined }
  }
  const largest = msg.photo?.[msg.photo.length - 1]
  if (!largest) return {}
  return { photoUrl: await safeFetchUrl(largest), fileSizeBytes: largest.size ?? undefined }
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
