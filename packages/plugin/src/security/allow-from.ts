/**
 * Sender validation utilities for plugin allowlist management.
 *
 * Provides functions to validate message senders against configured allowlists,
 * supporting various normalization strategies and chat target types.
 *
 * @example
 * ```typescript
 * // Basic sender validation
 * const isAllowed = isSenderAllowed({
 *   senderId: "user123",
 *   allowFrom: ["user123", "admin456"]
 * })
 *
 * // With prefix stripping (e.g., remove "telegram:" prefix)
 * const isAllowed = isSenderAllowed({
 *   senderId: "telegram:user123",
 *   allowFrom: ["user123"],
 *   stripPrefixRe: /^(telegram|discord|slack):/
 * })
 *
 * // Parse allowlist from config string
 * const allowlist = parseAllowFromConfig("user1,user2,user3")
 * ```
 */

/**
 * Normalizes a sender ID to lowercase with trimmed whitespace.
 */
export function normalizeSenderId(sender: string | number): string {
  return String(sender).trim().toLowerCase()
}

/**
 * Formats an allowlist entry to lowercase with trimmed whitespace.
 * Optionally strips a prefix using the provided regex.
 */
export function formatAllowFromEntry(
  entry: string | number,
  stripPrefixRe?: RegExp,
): string {
  let result = String(entry).trim()
  if (stripPrefixRe) {
    result = result.replace(stripPrefixRe, "")
  }
  return result.toLowerCase()
}

/**
 * Formats an entire allowlist array, normalizing each entry.
 */
export function formatAllowFromList(params: {
  allowFrom: Array<string | number>
  stripPrefixRe?: RegExp
}): string[] {
  return params.allowFrom
    .map(entry => formatAllowFromEntry(entry, params.stripPrefixRe))
    .filter(Boolean)
}

/**
 * Checks if a sender ID is in the allowed list.
 *
 * @param params.senderId - The sender ID to validate
 * @param params.allowFrom - Array of allowed sender IDs
 * @param params.stripPrefixRe - Optional regex to strip prefixes from sender ID
 * @returns true if sender is allowed, false otherwise
 *
 * @example
 * ```typescript
 * // Exact match
 * isSenderAllowed({ senderId: "user123", allowFrom: ["user123", "admin"] }) // true
 *
 * // Wildcard allows all
 * isSenderAllowed({ senderId: "anyone", allowFrom: ["*"] }) // true
 *
 * // Case insensitive
 * isSenderAllowed({ senderId: "USER123", allowFrom: ["user123"] }) // true
 * ```
 */
export function isSenderAllowed(params: {
  senderId: string | number
  allowFrom: Array<string | number>
  stripPrefixRe?: RegExp
}): boolean {
  const { senderId, allowFrom, stripPrefixRe } = params

  if (allowFrom.length === 0) {
    return false
  }

  // Wildcard allows everything
  if (allowFrom.some(entry => String(entry).trim() === "*")) {
    return true
  }

  const normalizedSender = normalizeSenderId(senderId)
  const normalizedAllow = formatAllowFromList({
    allowFrom,
    stripPrefixRe,
  })

  return normalizedAllow.includes(normalizedSender)
}

/**
 * Parses an allowlist configuration from string or array format.
 *
 * String format: comma-separated values (e.g., "user1,user2,user3")
 * Array format: array of strings or numbers
 */
export function parseAllowFromConfig(config: string | string[] | undefined): string[] {
  if (!config) {
    return []
  }

  if (typeof config === "string") {
    return config
      .split(",")
      .map(s => s.trim())
      .filter(Boolean)
  }

  return config.map(String)
}

/**
 * Parsed chat allowlist target types.
 * Different messaging platforms use different identifiers.
 */
export type ParsedChatAllowTarget =
  | { kind: "chat_id"; chatId: number }
  | { kind: "chat_guid"; chatGuid: string }
  | { kind: "chat_identifier"; chatIdentifier: string }
  | { kind: "handle"; handle: string }
  | { kind: "user_id"; userId: string }
  | { kind: "username"; username: string }

/**
 * Checks if a sender is allowed based on parsed chat target types.
 *
 * This function supports multiple identification strategies:
 * - By numeric chat ID
 * - By globally unique identifier (GUID)
 * - By chat identifier (platform-specific)
 * - By user handle/username
 *
 * @param params.allowFrom - Array of allowed entries
 * @param params.sender - The sender's handle/username
 * @param params.chatId - Optional numeric chat ID
 * @param params.chatGuid - Optional chat GUID
 * @param params.chatIdentifier - Optional platform-specific chat identifier
 * @param params.normalizeSender - Function to normalize sender ID for comparison
 * @param params.parseAllowTarget - Function to parse allowlist entries into target types
 * @returns true if sender is allowed, false otherwise
 *
 * @example
 * ```typescript
 * // Custom parser for Telegram-style allowlist
 * const result = isAllowedParsedChatSender({
 *   allowFrom: ["chat:12345", "@username", "handle:user1"],
 *   sender: "user1",
 *   chatId: 12345,
 *   normalizeSender: s => s.toLowerCase(),
 *   parseAllowTarget: (entry) => {
 *     if (entry.startsWith("chat:")) {
 *       return { kind: "chat_id", chatId: Number(entry.slice(5)) }
 *     }
 *     if (entry.startsWith("@")) {
 *       return { kind: "username", username: entry.slice(1).toLowerCase() }
 *     }
 *     if (entry.startsWith("handle:")) {
 *       return { kind: "handle", handle: entry.slice(7).toLowerCase() }
 *     }
 *     return { kind: "handle", handle: entry.toLowerCase() }
 *   }
 * })
 * ```
 */
export function isAllowedParsedChatSender<TParsed extends ParsedChatAllowTarget>(params: {
  allowFrom: Array<string | number>
  sender: string
  chatId?: number | null
  chatGuid?: string | null
  chatIdentifier?: string | null
  normalizeSender: (sender: string) => string
  parseAllowTarget: (entry: string) => TParsed
}): boolean {
  const {
    allowFrom,
    sender,
    chatId,
    chatGuid,
    chatIdentifier,
    normalizeSender,
    parseAllowTarget,
  } = params

  const normalizedAllowFrom = allowFrom.map(entry => String(entry).trim())

  if (normalizedAllowFrom.length === 0) {
    return false
  }

  // Wildcard allows everything
  if (normalizedAllowFrom.includes("*")) {
    return true
  }

  const senderNormalized = normalizeSender(sender)
  const chatGuidTrimmed = chatGuid?.trim()
  const chatIdentifierTrimmed = chatIdentifier?.trim()

  for (const entry of normalizedAllowFrom) {
    if (!entry) {
      continue
    }

    const parsed = parseAllowTarget(entry)

    switch (parsed.kind) {
      case "chat_id":
        if (chatId !== undefined && parsed.chatId === chatId) {
          return true
        }
        break

      case "chat_guid":
        if (chatGuidTrimmed && parsed.chatGuid === chatGuidTrimmed) {
          return true
        }
        break

      case "chat_identifier":
        if (chatIdentifierTrimmed && parsed.chatIdentifier === chatIdentifierTrimmed) {
          return true
        }
        break

      case "handle":
        if (senderNormalized && parsed.handle === senderNormalized) {
          return true
        }
        break

      case "username":
        if (senderNormalized && parsed.username === senderNormalized) {
          return true
        }
        break

      case "user_id":
        if (senderNormalized && parsed.userId === senderNormalized) {
          return true
        }
        break
    }
  }

  return false
}

/**
 * Creates a sender validator with cached normalization.
 * Useful when validating multiple senders against the same allowlist.
 */
export function createSenderValidator(params: {
  allowFrom: Array<string | number>
  stripPrefixRe?: RegExp
}) {
  const normalizedAllow = formatAllowFromList(params)
  const allowWildcard = normalizedAllow.includes("*")

  return {
    /**
     * Check if a sender is allowed.
     */
    isAllowed(senderId: string | number): boolean {
      if (allowWildcard) {
        return true
      }
      if (normalizedAllow.length === 0) {
        return false
      }
      const normalized = normalizeSenderId(senderId)
      return normalizedAllow.includes(normalized)
    },

    /**
     * Get the normalized allowlist.
     */
    getAllowlist(): string[] {
      return [...normalizedAllow]
    },
  }
}
