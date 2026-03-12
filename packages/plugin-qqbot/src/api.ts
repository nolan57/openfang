import type { QQBotPluginConfig, ResolvedQQBotAccount } from "./types.js"

const API_BASE_SANDBOX = "https://sandbox.api.sgroup.qq.com"
const API_BASE = "https://api.sgroup.qq.com"
const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken"

const tokenCacheMap = new Map<string, { token: string; expiresAt: number; appId: string }>()
const tokenFetchPromises = new Map<string, Promise<string>>()

function getApiBase(account: ResolvedQQBotAccount): string {
  return account.config.sandbox ? API_BASE_SANDBOX : API_BASE
}

export async function getAccessToken(account: ResolvedQQBotAccount): Promise<string> {
  const normalizedAppId = account.appId.trim()
  const cachedToken = tokenCacheMap.get(normalizedAppId)

  if (cachedToken && Date.now() < cachedToken.expiresAt - 5 * 60 * 1000) {
    return cachedToken.token
  }

  let fetchPromise = tokenFetchPromises.get(normalizedAppId)
  if (fetchPromise) {
    return fetchPromise
  }

  fetchPromise = (async () => {
    try {
      return await doFetchToken(normalizedAppId, account.clientSecret)
    } finally {
      tokenFetchPromises.delete(normalizedAppId)
    }
  })()

  tokenFetchPromises.set(normalizedAppId, fetchPromise)
  return fetchPromise
}

async function doFetchToken(appId: string, clientSecret: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  let response: Response
  try {
    response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId, clientSecret }),
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
  const expiresAt = Date.now() + (data.expires_in - 60) * 1000

  tokenCacheMap.set(appId, {
    token: data.access_token,
    expiresAt,
    appId,
  })

  return data.access_token
}

export function clearTokenCache(appId?: string): void {
  if (appId) {
    tokenCacheMap.delete(appId.trim())
  } else {
    tokenCacheMap.clear()
  }
}

const msgSeqTracker = new Map<string, number>()
const seqBaseTime = Math.floor(Date.now() / 1000) % 100000000

function getNextMsgSeq(_msgId: string): number {
  const timePart = Date.now() % 100000000
  const random = Math.floor(Math.random() * 65536)
  return (timePart ^ random) % 65536
}

export interface MessageResponse {
  id: string
  timestamp: number | string
}

export async function getGatewayUrl(account: ResolvedQQBotAccount): Promise<string> {
  const token = await getAccessToken(account)
  const apiBase = getApiBase(account)
  const response = await fetch(`${apiBase}/gateway/bot`, {
    headers: { Authorization: `QQBot ${token}` },
  })

  if (!response.ok) {
    throw new Error(`Failed to get gateway: ${response.status}`)
  }

  const data = await response.json()
  return data.url
}

export async function sendC2CMessage(
  account: ResolvedQQBotAccount,
  userId: string,
  content: string,
  msgId?: string,
): Promise<MessageResponse> {
  const token = await getAccessToken(account)
  const msgSeq = msgId ? getNextMsgSeq(msgId) : 1
  const apiBase = getApiBase(account)

  const response = await fetch(`${apiBase}/v2/users/${userId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `QQBot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content, msg_id: msgId, msg_seq: msgSeq }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to send C2C message: ${response.status} - ${error}`)
  }

  return response.json()
}

export async function sendGroupMessage(
  account: ResolvedQQBotAccount,
  groupId: string,
  content: string,
  msgId?: string,
): Promise<MessageResponse> {
  const token = await getAccessToken(account)
  const msgSeq = msgId ? getNextMsgSeq(msgId) : 1
  const apiBase = getApiBase(account)

  const response = await fetch(`${apiBase}/groups/${groupId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `QQBot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content, msg_id: msgId, msg_seq: msgSeq }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to send group message: ${response.status} - ${error}`)
  }

  return response.json()
}

export async function sendChannelMessage(
  account: ResolvedQQBotAccount,
  channelId: string,
  content: string,
  msgId?: string,
): Promise<MessageResponse> {
  const token = await getAccessToken(account)
  const msgSeq = msgId ? getNextMsgSeq(msgId) : 1
  const apiBase = getApiBase(account)

  const response = await fetch(`${apiBase}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `QQBot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content, msg_id: msgId, msg_seq: msgSeq }),
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
  account: ResolvedQQBotAccount,
  openid: string,
  fileType: MediaFileType,
  url?: string,
  fileData?: string,
): Promise<UploadMediaResponse> {
  const token = await getAccessToken(account)

  const body: Record<string, unknown> = {
    file_type: fileType,
    srv_send_msg: false,
  }

  if (url) body.url = url
  else if (fileData) body.file_data = fileData
  else throw new Error("uploadC2CMedia: url or fileData is required")

  const apiBase = getApiBase(account)
  const response = await fetch(`${apiBase}/v2/users/${openid}/files`, {
    method: "POST",
    headers: { Authorization: `QQBot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to upload C2C media: ${response.status} - ${error}`)
  }

  return response.json()
}

export async function uploadGroupMedia(
  account: ResolvedQQBotAccount,
  groupOpenid: string,
  fileType: MediaFileType,
  url?: string,
  fileData?: string,
): Promise<UploadMediaResponse> {
  const token = await getAccessToken(account)

  const body: Record<string, unknown> = {
    file_type: fileType,
    srv_send_msg: false,
  }

  if (url) body.url = url
  else if (fileData) body.file_data = fileData
  else throw new Error("uploadGroupMedia: url or fileData is required")

  const apiBase = getApiBase(account)
  const response = await fetch(`${apiBase}/v2/groups/${groupOpenid}/files`, {
    method: "POST",
    headers: { Authorization: `QQBot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to upload group media: ${response.status} - ${error}`)
  }

  return response.json()
}

export async function sendC2CMediaMessage(
  account: ResolvedQQBotAccount,
  openid: string,
  fileInfo: string,
  msgId?: string,
  content?: string,
): Promise<MessageResponse> {
  const token = await getAccessToken(account)
  const msgSeq = msgId ? getNextMsgSeq(msgId) : 1
  const apiBase = getApiBase(account)

  const response = await fetch(`${apiBase}/v2/users/${openid}/messages`, {
    method: "POST",
    headers: { Authorization: `QQBot ${token}`, "Content-Type": "application/json" },
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
  account: ResolvedQQBotAccount,
  groupOpenid: string,
  fileInfo: string,
  msgId?: string,
  content?: string,
): Promise<MessageResponse> {
  const token = await getAccessToken(account)
  const msgSeq = msgId ? getNextMsgSeq(msgId) : 1
  const apiBase = getApiBase(account)

  const response = await fetch(`${apiBase}/v2/groups/${groupOpenid}/messages`, {
    method: "POST",
    headers: { Authorization: `QQBot ${token}`, "Content-Type": "application/json" },
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

export async function sendTypingIndicator(
  account: ResolvedQQBotAccount,
  channelId: string,
  type: "C2C" | "GROUP" | "CHANNEL",
): Promise<void> {
  const token = await getAccessToken(account)
  const apiBase = getApiBase(account)

  let url: string
  if (type === "C2C") {
    url = `${apiBase}/v2/users/${channelId}/typing`
  } else if (type === "GROUP") {
    url = `${apiBase}/v2/groups/${channelId}/typing`
  } else {
    url = `${apiBase}/channels/${channelId}/typing`
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `QQBot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: 0 }),
    })

    if (!response.ok) {
      console.error(`[qqbot] Failed to send typing indicator: ${response.status}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[qqbot] Error sending typing indicator: ${message}`)
  }
}

export async function uploadChannelMedia(
  account: ResolvedQQBotAccount,
  channelId: string,
  fileType: MediaFileType,
  url?: string,
  fileData?: string,
): Promise<UploadMediaResponse> {
  const token = await getAccessToken(account)

  const body: Record<string, unknown> = {
    file_type: fileType,
    srv_send_msg: false,
  }

  if (url) body.url = url
  else if (fileData) body.file_data = fileData
  else throw new Error("uploadChannelMedia: url or fileData is required")

  const apiBase = getApiBase(account)
  const response = await fetch(`${apiBase}/channels/${channelId}/files`, {
    method: "POST",
    headers: { Authorization: `QQBot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to upload channel media: ${response.status} - ${error}`)
  }

  return response.json()
}

export async function sendChannelMediaMessage(
  account: ResolvedQQBotAccount,
  channelId: string,
  fileInfo: string,
  msgId?: string,
  content?: string,
): Promise<MessageResponse> {
  const token = await getAccessToken(account)
  const msgSeq = msgId ? getNextMsgSeq(msgId) : 1
  const apiBase = getApiBase(account)

  const response = await fetch(`${apiBase}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `QQBot ${token}`, "Content-Type": "application/json" },
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
    throw new Error(`Failed to send channel media message: ${response.status} - ${error}`)
  }

  return response.json()
}
