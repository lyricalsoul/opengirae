const bucket = new Bun.S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || "auto",
  bucket: process.env.S3_BUCKET!,
  accessKeyId: process.env.S3_ACCESS_KEY_ID!,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
})

export async function uploadBytes(bytes: Uint8Array, keyPrefix: string, ext: string, contentType: string): Promise<string> {
  const key = `${keyPrefix}/${Bun.randomUUIDv7()}.${ext}`
  await bucket.write(key, bytes, { type: contentType })
  return `${process.env.S3_PUBLIC_URL}/${key}`
}

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  mp4: "video/mp4", webm: "video/webm",
}

function guessImageType(headerType: string | null, sourceUrl: string): { contentType: string, ext: string } {
  if (headerType?.startsWith("image/") || headerType?.startsWith("video/")) {
    return { contentType: headerType, ext: headerType.split("/")[1]!.split("+")[0]! }
  }

  const urlExt = sourceUrl.split(/[?#]/)[0]!.split(".").pop()?.toLowerCase()
  const mime = urlExt ? EXT_MIME[urlExt] : undefined
  if (mime) return { contentType: mime, ext: urlExt! }

  return { contentType: headerType ?? "application/octet-stream", ext: urlExt ?? "bin" }
}

export async function uploadFromUrl(sourceUrl: string, keyPrefix: string): Promise<string> {
  const res = await fetch(sourceUrl)
  if (!res.ok) throw new Error(`uploadFromUrl: failed to fetch source (${res.status})`)

  const { contentType, ext } = guessImageType(res.headers.get("content-type"), sourceUrl)

  return uploadBytes(new Uint8Array(await res.arrayBuffer()), keyPrefix, ext, contentType)
}
