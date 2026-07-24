import sharp from "sharp"
import { uploadBytes } from "@girae/common/utilities/storage"
import type { IncomingCommand } from "@girae/common/commands/types"

// sharp can't decode a gif-as-video/real video - route those through uploadFromUrl instead
export function isAnimatedCardMedia(ctx: IncomingCommand): boolean {
  const source = ctx.message.photoUrl ? ctx.message : ctx.message.replyTo
  return !!(source?.isAnimatedPhoto || source?.isVideo)
}

export const CARD_WIDTH = 900
export const CARD_HEIGHT = 1260

export async function prepareCardImage(source: Uint8Array): Promise<Buffer> {
  return sharp(source)
    .resize(CARD_WIDTH, CARD_HEIGHT, { fit: "cover", position: "centre", kernel: sharp.kernel.lanczos3 })
    .webp({ quality: 98, effort: 6 })
    .toBuffer()
}

export async function uploadCardImage(sourceUrl: string): Promise<string> {
  const res = await fetch(sourceUrl)
  if (!res.ok) throw new Error(`uploadCardImage: failed to fetch source (${res.status})`)

  const cropped = await prepareCardImage(new Uint8Array(await res.arrayBuffer()))
  return uploadBytes(cropped, "cards", "webp", "image/webp")
}
