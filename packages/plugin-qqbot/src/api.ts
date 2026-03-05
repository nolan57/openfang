import type { QQBotPluginConfig } from "./types.js"

let accessToken: string | null = null
let tokenExpiresAt: number = 0

const API_BASE = "https://api.sgroup.qq.com"
const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken"

let tokenFetchPromise: Promise<string> | null = null

const msgSeqTracker = new Map<string, number>()
const seqBaseTime = Math.floor(Date.now() / 1000) % 100000000

function getNextMsgSeq(msgId: string): number {
  const current = msgSeqTracker.get(msgId) ?? 0
  const next = current + 1
  msgSeqTracker.set(msgId, next)

  if (msgSeqTracker.size > 1000) {
    const keys = Array.from(msgSeqTracker.keys())
    for (let i = 0; i < 800; i++) {
      msgSeqTracker.delete(keys[i])
    }
  }

  return seqBaseTime + next
}

export interface MessageResponse {
  id: string
  timestamp: number | string
}

export function initApiConfig(_config: QQBotPluginConfig): void {}

async function doFetchToken(config: QQBotPluginConfig): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  let response: Response
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        appId: config.appId,
        clientSecret: config.clientSecret,
      }),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timeout)
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Failed to get access token: request timed out after 10s")
    }
    throw err
  }

  clearTimeout(timeout)

  if (!response.ok) {
    const error = await response.text().catch(() => "unknown")
    throw new Error(`Failed to get access token: ${response.status} - ${error}`)
  }

  const data = await response.json()
  accessToken = data.access_token
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000

  return accessToken!
}

export async function getAccessToken(config: QQBotPluginConfig): Promise<string> {
  if (accessToken && Date.now() < tokenExpiresAt - 5 * 60 * 1000) {
    return accessToken
  }

  if (tokenFetchPromise) {
    return tokenFetchPromise
  }

  tokenFetchPromise = (async () => {
    try {
      return await doFetchToken(config)
    } finally {
      tokenFetchPromise = null
    }
  })()

  return tokenFetchPromise
}

export async function getGatewayUrl(config: QQBotPluginConfig): Promise<string> {
  const token = await getAccessToken(config)
  const response = await fetch(`${API_BASE}/gateway/bot`, {
    headers: {
      Authorization: `QQBot ${token}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to get gateway: ${response.status}`)
  }

  const data = await response.json()
  return data.url
}

export async function sendC2CMessage(
  config: QQBotPluginConfig,
  userId: string,
  content: string,
  msgId?: string,
): Promise<MessageResponse> {
  const token = await getAccessToken(config)
  const msgSeq = msgId ? getNextMsgSeq(msgId) : 1

  const response = await fetch(`${API_BASE}/v2/users/${userId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `QQBot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content,
      msg_id: msgId,
      msg_seq: msgSeq,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to send C2C message: ${response.status} - ${error}`)
  }

  return response.json()
}

export async function sendGroupMessage(
  config: QQBotPluginConfig,
  groupId: string,
  content: string,
  msgId?: string,
): Promise<MessageResponse> {
  const token = await getAccessToken(config)
  const msgSeq = msgId ? getNextMsgSeq(msgId) : 1

  const response = await fetch(`${API_BASE}/groups/${groupId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `QQBot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content,
      msg_id: msgId,
      msg_seq: msgSeq,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to send group message: ${response.status} - ${error}`)
  }

  return response.json()
}

export async function sendChannelMessage(
  config: QQBotPluginConfig,
  channelId: string,
  content: string,
  msgId?: string,
): Promise<MessageResponse> {
  const token = await getAccessToken(config)
  const msgSeq = msgId ? getNextMsgSeq(msgId) : 1

  const response = await fetch(`${API_BASE}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `QQBot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content,
      msg_id: msgId,
      msg_seq: msgSeq,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to send channel message: ${response.status} - ${error}`)
  }

  return response.json()
}

export enum MediaFileType {
  IMAGE = 1,
  VIDEO = 2,
  VOICE = 3,
  FILE = 4,
}

export interface UploadMediaResponse {
  file_uuid: string
  file_info: string
  ttl: number
  id?: string
}

export async function uploadC2CMedia(
  config: QQBotPluginConfig,
  openid: string,
  fileType: MediaFileType,
  url?: string,
  fileData?: string,
): Promise<UploadMediaResponse> {
  const token = await getAccessToken(config)

  const body: Record<string, unknown> = {
    file_type: fileType,
    srv_send_msg: false,
  }

  if (url) {
    body.url = url
  } else if (fileData) {
    body.file_data = fileData
  } else {
    throw new Error("uploadC2CMedia: url or fileData is required")
  }

  const response = await fetch(`${API_BASE}/v2/users/${openid}/files`, {
    method: "POST",
    headers: {
      Authorization: `QQBot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to upload C2C media: ${response.status} - ${error}`)
  }

  return response.json()
}

export async function uploadGroupMedia(
  config: QQBotPluginConfig,
  groupOpenid: string,
  fileType: MediaFileType,
  url?: string,
  fileData?: string,
): Promise<UploadMediaResponse> {
  const token = await getAccessToken(config)

  const body: Record<string, unknown> = {
    file_type: fileType,
    srv_send_msg: false,
  }

  if (url) {
    body.url = url
  } else if (fileData) {
    body.file_data = fileData
  } else {
    throw new Error("uploadGroupMedia: url or fileData is required")
  }

  const response = await fetch(`${API_BASE}/v2/groups/${groupOpenid}/files`, {
    method: "POST",
    headers: {
      Authorization: `QQBot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to upload group media: ${response.status} - ${error}`)
  }

  return response.json()
}

export async function sendC2CMediaMessage(
  config: QQBotPluginConfig,
  openid: string,
  fileInfo: string,
  msgId?: string,
  content?: string,
): Promise<MessageResponse> {
  const token = await getAccessToken(config)
  const msgSeq = msgId ? getNextMsgSeq(msgId) : 1

  const response = await fetch(`${API_BASE}/v2/users/${openid}/messages`, {
    method: "POST",
    headers: {
      Authorization: `QQBot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      msg_type: 7,
      media: { file_info: fileInfo },
      msg_seq: msgSeq,
      ...(msgId ? { msg_id: msgId } : {}),
      ...(content ? { content } : {}),
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to send C2C media message: ${response.status} - ${error}`)
  }

  return response.json()
}

export async function sendGroupMediaMessage(
  config: QQBotPluginConfig,
  groupOpenid: string,
  fileInfo: string,
  msgId?: string,
  content?: string,
): Promise<MessageResponse> {
  const token = await getAccessToken(config)
  const msgSeq = msgId ? getNextMsgSeq(msgId) : 1

  const response = await fetch(`${API_BASE}/v2/groups/${groupOpenid}/messages`, {
    method: "POST",
    headers: {
      Authorization: `QQBot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      msg_type: 7,
      media: { file_info: fileInfo },
      msg_seq: msgSeq,
      ...(msgId ? { msg_id: msgId } : {}),
      ...(content ? { content } : {}),
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to send group media message: ${response.status} - ${error}`)
  }

  return response.json()
}
