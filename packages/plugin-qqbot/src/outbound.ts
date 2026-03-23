import type { ResolvedQQBotAccount } from "./types.js"
import {
  sendC2CMessage,
  sendGroupMessage,
  sendC2CMediaMessage,
  sendGroupMediaMessage,
  uploadC2CMedia,
  uploadGroupMedia,
  MediaFileType,
  sendTypingIndicator,
  uploadChannelMedia,
  sendChannelMediaMessage,
  sendChannelMessage,
} from "./api.js"
import { spawn } from "child_process"
import { createWriteStream } from "fs"
import { pipeline } from "stream/promises"
import fs from "fs/promises"
import path from "path"
import os from "os"

const replyTimestamps: Map<string, number[]> = new Map()
const MAX_REPLIES_PER_HOUR = 4
const REPLY_WINDOW_MS = 60 * 60 * 1000
const REPLY_CLEANUP_INTERVAL_MS = 5 * 60 * 1000

const TEMP_DIR = path.join(os.tmpdir(), "qqbot-media")

async function ensureTempDir(): Promise<void> {
  await fs.mkdir(TEMP_DIR, { recursive: true })
}

async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath)
  } catch (err) {
    console.error(`[qqbot] Failed to cleanup temp file ${filePath}: ${err}`)
  }
}

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

interface ParsedMessage {
  type: "text" | "image" | "voice" | "video" | "file"
  content: string
  text?: string
}

function parseMessageContent(content: string): ParsedMessage[] {
  const result: ParsedMessage[] = []
  let lastIndex = 0

  const qqvoiceRegex = /<qqvoice(?:\s+text="([^"]*)")?\s*\/?>/gi
  const qqvideoRegex = /<qqvideo\s+src="([^"]+)"\s*(?:type="(image|video|file)")?\s*\/?>/gi
  const qqfileRegex = /<qqfile\s+src="([^"]+)"\s*(?:filename="([^"]+)")?\s*\/?>/gi
  const qqimgRegex = /<qqimg>([^<>]+)<\/(?:qqimg|img)>/gi

  const allTags: Array<{ match: RegExpExecArray; type: string; index: number }> = []
  let match

  while ((match = qqvoiceRegex.exec(content)) !== null) {
    allTags.push({ match, type: "voice", index: match.index })
  }
  while ((match = qqvideoRegex.exec(content)) !== null) {
    allTags.push({ match, type: "video", index: match.index })
  }
  while ((match = qqfileRegex.exec(content)) !== null) {
    allTags.push({ match, type: "file", index: match.index })
  }
  while ((match = qqimgRegex.exec(content)) !== null) {
    allTags.push({ match, type: "image", index: match.index })
  }

  allTags.sort((a, b) => a.index - b.index)

  for (const tag of allTags) {
    const textBefore = content
      .slice(lastIndex, tag.index)
      .replace(/\n{3,}/g, "\n\n")
      .trim()
    if (textBefore) {
      result.push({ type: "text", content: textBefore })
    }

    if (tag.type === "voice") {
      const text = tag.match[1] || ""
      if (text) {
        result.push({ type: "voice", content: text, text })
      }
    } else if (tag.type === "video") {
      const src = tag.match[1] || ""
      const mediaType = tag.match[2] || "video"
      if (src) {
        result.push({ type: "video", content: src, text: mediaType })
      }
    } else if (tag.type === "file") {
      const src = tag.match[1] || ""
      const filename = tag.match[2]
      if (src) {
        result.push({ type: "file", content: src, text: filename })
      }
    } else if (tag.type === "image") {
      const imagePath = tag.match[1]?.trim() || ""
      if (imagePath) {
        result.push({ type: "image", content: imagePath })
      }
    }

    lastIndex = tag.index + tag.match[0].length
  }

  const textAfter = content
    .slice(lastIndex)
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  if (textAfter) {
    result.push({ type: "text", content: textAfter })
  }

  return result
}

export async function sendText(
  account: ResolvedQQBotAccount,
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

  const parsedMessages = parseMessageContent(content)

  if (parsedMessages.length > 0) {
    const isGroup = recipient.startsWith("group_")
    const isChannel = recipient.startsWith("channel_")
    const targetId = isGroup ? recipient.replace("group_", "") : isChannel ? recipient.replace("channel_", "") : recipient

    for (const item of parsedMessages) {
      try {
        if (item.type === "text") {
          if (isGroup) {
            await sendGroupMessage(account, targetId, item.content, msgId)
          } else if (isChannel) {
            await sendChannelMessage(account, targetId, item.content, msgId)
          } else {
            await sendC2CMessage(account, targetId, item.content, msgId)
          }
        } else if (item.type === "image") {
          await processImageForQQ(account, item.content, isGroup, isChannel, targetId, msgId)
        } else if (item.type === "voice") {
          await processVoiceForQQ(account, item.text || "", isGroup, isChannel, targetId, msgId)
        } else if (item.type === "video") {
          await processVideoForQQ(account, item.content, item.text || "video", isGroup, isChannel, targetId, msgId)
        } else if (item.type === "file") {
          await processFileForQQ(account, item.content, item.text, isGroup, isChannel, targetId, msgId)
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[qqbot] Failed to send ${item.type} to ${targetId}: ${message}`)
        if (item.type === "voice") {
          const fallbackText = item.text || "[Voice message]"
          if (isGroup) {
            await sendGroupMessage(account, targetId, fallbackText, msgId)
          } else if (isChannel) {
            await sendChannelMessage(account, targetId, fallbackText, msgId)
          } else {
            await sendC2CMessage(account, targetId, fallbackText, msgId)
          }
        }
      }
    }
  } else {
    try {
      if (recipient.startsWith("group_")) {
        const groupId = recipient.replace("group_", "")
        await sendGroupMessage(account, groupId, content, msgId)
      } else if (recipient.startsWith("channel_")) {
        const channelId = recipient.replace("channel_", "")
        await sendChannelMessage(account, channelId, content, msgId)
      } else {
        await sendC2CMessage(account, recipient, content, msgId)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[qqbot] Failed to send message to ${recipient}: ${message}`)
    }
  }
}

async function processImageForQQ(
  account: ResolvedQQBotAccount,
  imagePath: string,
  isGroup: boolean,
  isChannel: boolean,
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
        ? await uploadGroupMedia(account, targetId, MediaFileType.IMAGE, imageUrl)
        : isChannel
          ? await uploadChannelMedia(account, targetId, MediaFileType.IMAGE, imageUrl)
          : await uploadC2CMedia(account, targetId, MediaFileType.IMAGE, imageUrl)
      fileInfo = uploadResult.file_info
    } else {
      const uploadResult = isGroup
        ? await uploadGroupMedia(account, targetId, MediaFileType.IMAGE, undefined, imageUrl)
        : isChannel
          ? await uploadChannelMedia(account, targetId, MediaFileType.IMAGE, undefined, imageUrl)
          : await uploadC2CMedia(account, targetId, MediaFileType.IMAGE, undefined, imageUrl)
      fileInfo = uploadResult.file_info
    }

    if (isGroup) {
      await sendGroupMediaMessage(account, targetId, fileInfo, msgId)
    } else if (isChannel) {
      await sendChannelMediaMessage(account, targetId, fileInfo, msgId)
    } else {
      await sendC2CMediaMessage(account, targetId, fileInfo, msgId)
    }

    return imageUrl
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[qqbot] Failed to process image for ${targetId}: ${message}`)
    return null
  }
}

async function processVoiceForQQ(
  account: ResolvedQQBotAccount,
  text: string,
  isGroup: boolean,
  isChannel: boolean,
  targetId: string,
  msgId?: string,
): Promise<void> {
  if (!account.config.enableVoice) {
    const fallbackText = text || "[Voice message]"
    if (isGroup) {
      await sendGroupMessage(account, targetId, fallbackText, msgId)
    } else if (isChannel) {
      await sendChannelMessage(account, targetId, fallbackText, msgId)
    } else {
      await sendC2CMessage(account, targetId, fallbackText, msgId)
    }
    return
  }

  await ensureTempDir()
  const mp3Filename = `voice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.mp3`
  const mp3Path = path.join(TEMP_DIR, mp3Filename)

  try {
    const ttsVoice = account.config.ttsVoice || "zh-CN-XiaoxiaoNeural"
    await runEdgeTts(text, mp3Path, ttsVoice)

    const file = Bun.file(mp3Path)
    if (!(await file.exists())) {
      throw new Error("TTS file not generated")
    }
    const buffer = await file.arrayBuffer()
    const base64 = Buffer.from(buffer).toString("base64")
    const fileData = `data:audio/mpeg;base64,${base64}`

    const uploadResult = isGroup
      ? await uploadGroupMedia(account, targetId, MediaFileType.VOICE, undefined, fileData)
      : isChannel
        ? await uploadChannelMedia(account, targetId, MediaFileType.VOICE, undefined, fileData)
        : await uploadC2CMedia(account, targetId, MediaFileType.VOICE, undefined, fileData)

    const fileInfo = uploadResult.file_info

    if (isGroup) {
      await sendGroupMediaMessage(account, targetId, fileInfo, msgId)
    } else if (isChannel) {
      await sendChannelMediaMessage(account, targetId, fileInfo, msgId)
    } else {
      await sendC2CMediaMessage(account, targetId, fileInfo, msgId)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[qqbot] TTS failed for ${targetId}: ${message}, falling back to text`)
    await cleanupTempFile(mp3Path)
    throw err
  }

  await cleanupTempFile(mp3Path)
}

async function runEdgeTts(text: string, outputPath: string, voice: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const escapedText = text.replace(/"/g, '\\"').replace(/\n/g, " ")
    const args = [
      "--text", escapedText,
      "--write-media", outputPath,
      "--voice", voice,
    ]

    // Cross-platform: use platform-specific shell or direct execution
    const isWindows = process.platform === "win32"
    const proc = isWindows
      ? spawn("cmd.exe", ["/c", "edge-tts", ...args], {
          stdio: ["ignore", "pipe", "pipe"],
          shell: false,
        })
      : spawn("edge-tts", args, {
          stdio: ["ignore", "pipe", "pipe"],
          shell: false,
        })

    let stderr = ""
    proc.stderr.on("data", (data) => {
      stderr += data.toString()
    })

    proc.on("close", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`edge-tts exited with code ${code}: ${stderr}`))
      }
    })

    proc.on("error", (err) => {
      reject(new Error(`Failed to run edge-tts: ${err.message}`))
    })

    setTimeout(() => {
      proc.kill()
      reject(new Error("edge-tts timeout after 60s"))
    }, 60000)
  })
}

async function processVideoForQQ(
  account: ResolvedQQBotAccount,
  src: string,
  mediaType: string,
  isGroup: boolean,
  isChannel: boolean,
  targetId: string,
  msgId?: string,
): Promise<void> {
  if (!account.config.enableVideo) {
    console.log(`[qqbot] Video feature disabled, skipping ${src}`)
    return
  }

  const isLocalPath = src.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(src)
  const isHttpUrl = src.startsWith("http://") || src.startsWith("https://")
  const isBase64 = src.startsWith("data:")

  try {
    let fileData: string | undefined
    let url: string | undefined

    if (isLocalPath) {
      const file = Bun.file(src)
      if (!(await file.exists())) {
        throw new Error(`Video file not found: ${src}`)
      }
      const buffer = await file.arrayBuffer()
      const base64 = Buffer.from(buffer).toString("base64")
      const ext = src.split(".").pop()?.toLowerCase() || "mp4"
      const mimeType = `video/${ext === "mp4" ? "mp4" : ext}`
      fileData = `data:${mimeType};base64,${base64}`
    } else if (isHttpUrl) {
      url = src
    } else if (isBase64) {
      fileData = src
    } else {
      throw new Error(`Invalid video source: ${src}`)
    }

    const fileType = mediaType === "image" ? MediaFileType.IMAGE : MediaFileType.VIDEO

    const uploadResult = isGroup
      ? await uploadGroupMedia(account, targetId, fileType, url, fileData)
      : isChannel
        ? await uploadChannelMedia(account, targetId, fileType, url, fileData)
        : await uploadC2CMedia(account, targetId, fileType, url, fileData)

    const fileInfo = uploadResult.file_info

    if (isGroup) {
      await sendGroupMediaMessage(account, targetId, fileInfo, msgId)
    } else if (isChannel) {
      await sendChannelMediaMessage(account, targetId, fileInfo, msgId)
    } else {
      await sendC2CMediaMessage(account, targetId, fileInfo, msgId)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[qqbot] Failed to process video for ${targetId}: ${message}`)
  }
}

async function processFileForQQ(
  account: ResolvedQQBotAccount,
  src: string,
  filename: string | undefined,
  isGroup: boolean,
  isChannel: boolean,
  targetId: string,
  msgId?: string,
): Promise<void> {
  if (!account.config.enableFile) {
    console.log(`[qqbot] File feature disabled, skipping ${src}`)
    return
  }

  const isLocalPath = src.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(src)
  const isHttpUrl = src.startsWith("http://") || src.startsWith("https://")
  const isBase64 = src.startsWith("data:")

  try {
    let fileData: string | undefined
    let url: string | undefined

    if (isLocalPath) {
      const file = Bun.file(src)
      if (!(await file.exists())) {
        throw new Error(`File not found: ${src}`)
      }
      const buffer = await file.arrayBuffer()
      const base64 = Buffer.from(buffer).toString("base64")
      const ext = src.split(".").pop()?.toLowerCase() || "bin"
      const mimeTypes: Record<string, string> = {
        pdf: "application/pdf",
        doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        xls: "application/vnd.ms-excel",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ppt: "application/vnd.ms-powerpoint",
        pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        zip: "application/zip",
        rar: "application/vnd.rar",
        txt: "text/plain",
        md: "text/markdown",
        json: "application/json",
        xml: "application/xml",
        csv: "text/csv",
      }
      const mimeType = mimeTypes[ext] || "application/octet-stream"
      fileData = `data:${mimeType};base64,${base64}`
    } else if (isHttpUrl) {
      url = src
    } else if (isBase64) {
      fileData = src
    } else {
      throw new Error(`Invalid file source: ${src}`)
    }

    const uploadResult = isGroup
      ? await uploadGroupMedia(account, targetId, MediaFileType.FILE, url, fileData)
      : isChannel
        ? await uploadChannelMedia(account, targetId, MediaFileType.FILE, url, fileData)
        : await uploadC2CMedia(account, targetId, MediaFileType.FILE, url, fileData)

    const fileInfo = uploadResult.file_info

    if (isGroup) {
      await sendGroupMediaMessage(account, targetId, fileInfo, msgId, filename)
    } else if (isChannel) {
      await sendChannelMediaMessage(account, targetId, fileInfo, msgId, filename)
    } else {
      await sendC2CMediaMessage(account, targetId, fileInfo, msgId, filename)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[qqbot] Failed to process file for ${targetId}: ${message}`)
  }
}

export async function sendTyping(
  account: ResolvedQQBotAccount,
  recipient: string,
): Promise<void> {
  if (!account.config.enableTyping) {
    return
  }

  const type = recipient.startsWith("group_") ? "GROUP" : recipient.startsWith("channel_") ? "CHANNEL" : "C2C"
  const channelId = recipient.replace(/^group_/, "").replace(/^channel_/, "")

  await sendTypingIndicator(account, channelId, type)
}
