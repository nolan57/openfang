import type { QQBotPluginConfig } from "./types.js"
import {
  sendC2CMessage,
  sendGroupMessage,
  sendC2CMediaMessage,
  sendGroupMediaMessage,
  uploadC2CMedia,
  uploadGroupMedia,
  MediaFileType,
} from "./api.js"

const replyTimestamps: Map<string, number[]> = new Map()
const MAX_REPLIES_PER_HOUR = 4
const REPLY_WINDOW_MS = 60 * 60 * 1000
const REPLY_CLEANUP_INTERVAL_MS = 5 * 60 * 1000

function cleanupReplyTimestamps(): void {
  const now = Date.now()
  for (const [key, timestamps] of replyTimestamps) {
    const recent = timestamps.filter((t) => now - t < REPLY_WINDOW_MS)
    if (recent.length === 0) {
      replyTimestamps.delete(key)
    } else if (recent.length !== timestamps.length) {
      replyTimestamps.set(key, recent)
    }
  }
}

setInterval(cleanupReplyTimestamps, REPLY_CLEANUP_INTERVAL_MS)

export async function sendText(
  config: QQBotPluginConfig,
  recipient: string,
  content: string,
  msgId?: string,
): Promise<void> {
  const key = `${recipient}:${msgId || "proactive"}`
  const now = Date.now()

  const timestamps = replyTimestamps.get(key) || []
  const recentTimestamps = timestamps.filter((t) => now - t < REPLY_WINDOW_MS)

  if (recentTimestamps.length >= MAX_REPLIES_PER_HOUR) {
    return
  }

  recentTimestamps.push(now)
  replyTimestamps.set(key, recentTimestamps)

  const qqimgRegex = /<qqimg>([^<>]+)<\/(?:qqimg|img)>/gi
  const qqimgMatches = content.match(qqimgRegex)

  if (qqimgMatches && qqimgMatches.length > 0) {
    const sendQueue: Array<{ type: "text" | "image"; content: string }> = []

    let lastIndex = 0
    const qqimgRegexWithIndex = /<qqimg>([^<>]+)<\/(?:qqimg|img)>/gi
    let match

    while ((match = qqimgRegexWithIndex.exec(content)) !== null) {
      const textBefore = content
        .slice(lastIndex, match.index)
        .replace(/\n{3,}/g, "\n\n")
        .trim()
      if (textBefore) {
        sendQueue.push({ type: "text", content: textBefore })
      }

      const imagePath = match[1]?.trim()
      if (imagePath) {
        sendQueue.push({ type: "image", content: imagePath })
      }

      lastIndex = match.index + match[0].length
    }

    const textAfter = content
      .slice(lastIndex)
      .replace(/\n{3,}/g, "\n\n")
      .trim()
    if (textAfter) {
      sendQueue.push({ type: "text", content: textAfter })
    }

    const isGroup = recipient.startsWith("group_")
    const targetId = isGroup ? recipient.replace("group_", "") : recipient

    for (const item of sendQueue) {
      try {
        if (item.type === "text") {
          if (isGroup) {
            await sendGroupMessage(config, targetId, item.content, msgId)
          } else {
            await sendC2CMessage(config, targetId, item.content, msgId)
          }
        } else if (item.type === "image") {
          await processImageForQQ(config, item.content, isGroup, targetId, msgId)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[qqbot] Failed to send ${item.type} to ${targetId}: ${message}`)
      }
    }
  } else {
    try {
      if (recipient.startsWith("group_")) {
        const groupId = recipient.replace("group_", "")
        await sendGroupMessage(config, groupId, content, msgId)
      } else {
        await sendC2CMessage(config, recipient, content, msgId)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[qqbot] Failed to send message to ${recipient}: ${message}`)
    }
  }
}

async function processImageForQQ(
  config: QQBotPluginConfig,
  imagePath: string,
  isGroup: boolean,
  targetId: string,
  msgId?: string,
): Promise<string | null> {
  let imageUrl = imagePath

  const isLocalPath = imagePath.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(imagePath)
  const isHttpUrl = imagePath.startsWith("http://") || imagePath.startsWith("https://")
  const isBase64 = imagePath.startsWith("data:")

  try {
    if (isLocalPath) {
      const file = Bun.file(imagePath)
      if (!(await file.exists())) {
        return null
      }
      const buffer = await file.arrayBuffer()
      const base64 = Buffer.from(buffer).toString("base64")
      const ext = imagePath.split(".").pop()?.toLowerCase() || "png"
      const mimeTypes: Record<string, string> = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
        webp: "image/webp",
        bmp: "image/bmp",
      }
      const mimeType = mimeTypes[ext] || "image/png"
      imageUrl = `data:${mimeType};base64,${base64}`
    } else if (!isHttpUrl && !isBase64) {
      return null
    }

    let fileInfo: string
    if (isHttpUrl) {
      const uploadResult = isGroup
        ? await uploadGroupMedia(config, targetId, MediaFileType.IMAGE, imageUrl)
        : await uploadC2CMedia(config, targetId, MediaFileType.IMAGE, imageUrl)
      fileInfo = uploadResult.file_info
    } else {
      const uploadResult = isGroup
        ? await uploadGroupMedia(config, targetId, MediaFileType.IMAGE, undefined, imageUrl)
        : await uploadC2CMedia(config, targetId, MediaFileType.IMAGE, undefined, imageUrl)
      fileInfo = uploadResult.file_info
    }

    if (isGroup) {
      await sendGroupMediaMessage(config, targetId, fileInfo, msgId)
    } else {
      await sendC2CMediaMessage(config, targetId, fileInfo, msgId)
    }

    return imageUrl
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[qqbot] Failed to process image for ${targetId}: ${message}`)
    return null
  }
}
