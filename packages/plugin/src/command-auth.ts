/**
 * Command authentication utilities for plugins.
 *
 * Provides functions to validate command execution permissions,
 * verify command signatures, and enforce access control policies.
 *
 * @example
 * ```typescript
 * // Check if user can execute a command
 * const result = checkCommandPermission({
 *   command: "deploy",
 *   userId: "user123",
 *   allowCommands: ["deploy", "restart"],
 *   denyCommands: ["delete"]
 * })
 *
 * if (!result.allowed) {
 *   throw new Error(`Command denied: ${result.reason}`)
 * }
 *
 * // Verify command signature
 * const isValid = verifyCommandSignature({
 *   command: "deploy production",
 *   signature: "abc123...",
 *   secret: process.env.COMMAND_SECRET
 * })
 * ```
 */

/**
 * Command permission check result.
 */
export interface CommandPermissionResult {
  /**
   * Whether the command is allowed.
   */
  allowed: boolean

  /**
   * Reason for denial if not allowed.
   */
  reason?: string

  /**
   * Matched rule pattern if applicable.
   */
  matchedPattern?: string
}

/**
 * Command authorization context.
 */
export interface CommandAuthContext {
  /**
   * The command name (e.g., "deploy", "restart").
   */
  command: string

  /**
   * Full command string including arguments.
   */
  fullCommand?: string

  /**
   * User ID requesting the command.
   */
  userId?: string

  /**
   * Session ID for the command execution.
   */
  sessionID?: string

  /**
   * Channel or source of the command.
   */
  channel?: string

  /**
   * Additional context metadata.
   */
  metadata?: Record<string, unknown>
}

/**
 * Options for checkCommandPermission.
 */
export interface CommandPermissionOptions {
  /**
   * Command name to check.
   */
  command: string

  /**
   * User ID requesting the command.
   */
  userId?: string

  /**
   * List of allowed commands (supports wildcards).
   */
  allowCommands?: string[]

  /**
   * List of denied commands (takes precedence).
   */
  denyCommands?: string[]

  /**
   * Default behavior when no rules match.
   * @default "deny"
   */
  defaultAction?: "allow" | "deny"

  /**
   * User ID that bypasses all restrictions.
   */
  adminUserId?: string
}

/**
 * Checks if a command is allowed based on allow/deny lists.
 *
 * Rules:
 * 1. Admin user always allowed
 * 2. Deny list takes precedence over allow list
 * 3. Wildcards supported (* matches any command)
 * 4. Default action applied when no rules match
 *
 * @param options - Permission check options
 * @returns Permission result with allowed status and reason
 *
 * @example
 * ```typescript
 * // Basic allow list
 * checkCommandPermission({
 *   command: "deploy",
 *   allowCommands: ["deploy", "restart", "status"]
 * })
 * // Returns: { allowed: true }
 *
 * // With deny list (takes precedence)
 * checkCommandPermission({
 *   command: "delete",
 *   allowCommands: ["*"],
 *   denyCommands: ["delete", "drop"]
 * })
 * // Returns: { allowed: false, reason: "Command is denied" }
 *
 * // Admin bypass
 * checkCommandPermission({
 *   command: "admin-only",
 *   userId: "admin123",
 *   allowCommands: ["status"],
 *   adminUserId: "admin123"
 * })
 * // Returns: { allowed: true }
 * ```
 */
export function checkCommandPermission(
  options: CommandPermissionOptions,
): CommandPermissionResult {
  const {
    command,
    userId,
    allowCommands,
    denyCommands,
    defaultAction = "deny",
    adminUserId,
  } = options

  // Admin user bypasses all restrictions
  if (adminUserId && userId === adminUserId) {
    return { allowed: true, reason: "Admin user" }
  }

  const normalizedCommand = command.trim().toLowerCase()

  // Check deny list first (takes precedence)
  if (denyCommands && denyCommands.length > 0) {
    for (const pattern of denyCommands) {
      if (matchesCommandPattern(normalizedCommand, pattern)) {
        return {
          allowed: false,
          reason: "Command is denied",
          matchedPattern: pattern,
        }
      }
    }
  }

  // Check allow list
  if (allowCommands && allowCommands.length > 0) {
    for (const pattern of allowCommands) {
      if (matchesCommandPattern(normalizedCommand, pattern)) {
        return {
          allowed: true,
          matchedPattern: pattern,
        }
      }
    }
  }

  // Apply default action
  return {
    allowed: defaultAction === "allow",
    reason: defaultAction === "allow" ? "Default allow" : "Command not in allow list",
  }
}

/**
 * Checks if a command matches a pattern.
 *
 * Pattern syntax:
 * - Exact match: "deploy" matches "deploy"
 * - Wildcard: "*" matches any command
 * - Prefix wildcard: "deploy:*" matches "deploy:prod", "deploy:staging"
 * - Suffix wildcard: "*:admin" matches "deploy:admin", "restart:admin"
 */
export function matchesCommandPattern(command: string, pattern: string): boolean {
  const normalizedCommand = command.trim().toLowerCase()
  const normalizedPattern = pattern.trim().toLowerCase()

  // Exact wildcard matches everything
  if (normalizedPattern === "*") {
    return true
  }

  // Exact match
  if (normalizedCommand === normalizedPattern) {
    return true
  }

  // Prefix wildcard (e.g., "deploy:*")
  if (normalizedPattern.endsWith(":*")) {
    const prefix = normalizedPattern.slice(0, -2)
    return normalizedCommand.startsWith(prefix + ":")
  }

  // Suffix wildcard (e.g., "*:admin")
  if (normalizedPattern.startsWith("*:")) {
    const suffix = normalizedPattern.slice(1)
    return normalizedCommand.endsWith(suffix)
  }

  // Contains wildcard (e.g., "*deploy*")
  if (normalizedPattern.includes("*")) {
    const regexPattern = normalizedPattern.replace(/\*/g, ".*")
    const regex = new RegExp(`^${regexPattern}$`)
    return regex.test(normalizedCommand)
  }

  return false
}

/**
 * Creates a command validator with cached configuration.
 */
export function createCommandValidator(options: {
  allowCommands?: string[]
  denyCommands?: string[]
  defaultAction?: "allow" | "deny"
  adminUserId?: string
}) {
  return {
    /**
     * Check if a command is allowed.
     */
    check(command: string, userId?: string): CommandPermissionResult {
      return checkCommandPermission({
        command,
        userId,
        ...options,
      })
    },

    /**
     * Check and throw if not allowed.
     */
    require(command: string, userId?: string): void {
      const result = this.check(command, userId)
      if (!result.allowed) {
        throw new CommandDeniedError(command, result.reason)
      }
    },

    /**
     * Get the allowlist.
     */
    getAllowCommands(): string[] {
      return options.allowCommands ?? []
    },

    /**
     * Get the denylist.
     */
    getDenyCommands(): string[] {
      return options.denyCommands ?? []
    },
  }
}

/**
 * Error thrown when a command is denied.
 */
export class CommandDeniedError extends Error {
  constructor(
    public readonly command: string,
    public readonly reason?: string,
  ) {
    super(`Command denied: ${command}${reason ? ` (${reason})` : ""}`)
    this.name = "CommandDeniedError"
  }
}

/**
 * Options for command signature verification.
 */
export interface CommandSignatureOptions {
  /**
   * Full command string to verify.
   */
  command: string

  /**
   * Signature to verify (hex string).
   */
  signature: string

  /**
   * Secret key for HMAC verification.
   */
  secret: string

  /**
   * Expected timestamp tolerance in milliseconds.
   * @default 300000 (5 minutes)
   */
  timestampTolerance?: number

  /**
   * Optional timestamp from the signature payload.
   */
  timestamp?: number
}

/**
 * Verifies a command signature using HMAC-SHA256.
 *
 * Signature format:
 * - Payload: `{command}:{timestamp}`
 * - Signature: HMAC-SHA256(payload, secret) as hex string
 *
 * @param options - Signature verification options
 * @returns true if signature is valid, false otherwise
 *
 * @example
 * ```typescript
 * // Generate signature (server-side)
 * const timestamp = Date.now()
 * const payload = `${command}:${timestamp}`
 * const signature = crypto
 *   .createHmac("sha256", secret)
 *   .update(payload)
 *   .digest("hex")
 *
 * // Verify signature
 * const isValid = verifyCommandSignature({
 *   command: "deploy production",
 *   signature,
 *   secret: process.env.COMMAND_SECRET,
 *   timestamp
 * })
 * ```
 */
export async function verifyCommandSignature(
  options: CommandSignatureOptions,
): Promise<boolean> {
  const { command, signature, secret, timestampTolerance = 5 * 60 * 1000 } = options

  try {
    // Encode secret and command as UTF-8
    const enc = new TextEncoder()
    const keyData = enc.encode(secret)
    const payload = options.timestamp
      ? `${command}:${options.timestamp}`
      : command

    // Import key
    const key = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    )

    // Compute expected signature
    const signatureBytes = await crypto.subtle.sign(
      "HMAC",
      key,
      enc.encode(payload),
    )

    // Convert to hex string
    const expectedSignature = Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")

    // Constant-time comparison
    if (!constantTimeCompare(signature, expectedSignature)) {
      return false
    }

    // Check timestamp if provided
    if (options.timestamp && timestampTolerance > 0) {
      const now = Date.now()
      const age = Math.abs(now - options.timestamp)
      if (age > timestampTolerance) {
        return false
      }
    }

    return true
  } catch {
    return false
  }
}

/**
 * Generates a command signature.
 *
 * @param command - Command string to sign
 * @param secret - Secret key for signing
 * @param includeTimestamp - Whether to include timestamp in payload
 * @returns Object with signature and timestamp
 */
export async function generateCommandSignature(
  command: string,
  secret: string,
  includeTimestamp: boolean = true,
): Promise<{ signature: string; timestamp?: number }> {
  const timestamp = includeTimestamp ? Date.now() : undefined
  const payload = timestamp ? `${command}:${timestamp}` : command

  const enc = new TextEncoder()
  const keyData = enc.encode(secret)

  // Import key
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )

  // Sign payload
  const signatureBytes = await crypto.subtle.sign("HMAC", key, enc.encode(payload))

  // Convert to hex string
  const signature = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  return { signature, timestamp }
}

/**
 * Performs constant-time string comparison to prevent timing attacks.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }

  return result === 0
}

/**
 * Parses a command string into components.
 */
export interface ParsedCommand {
  /**
   * Base command name.
   */
  name: string

  /**
   * Command arguments.
   */
  args: string[]

  /**
   * Full command string.
   */
  full: string

  /**
   * Command flags (e.g., --force, -v).
   */
  flags: Record<string, string | true>
}

/**
 * Parses a command string into structured components.
 *
 * @param command - Command string to parse
 * @returns Parsed command object
 *
 * @example
 * ```typescript
 * parseCommand("deploy production --force --env=prod -v")
 * // Returns:
 * // {
 * //   name: "deploy",
 * //   args: ["production"],
 * //   full: "deploy production --force --env=prod -v",
 * //   flags: { force: true, env: "prod", v: true }
 * // }
 * ```
 */
export function parseCommand(command: string): ParsedCommand {
  const trimmed = command.trim()
  const parts = trimmed.split(/\s+/)
  const name = parts[0] || ""
  const args: string[] = []
  const flags: Record<string, string | true> = {}

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]

    if (part.startsWith("--")) {
      // Long flag (--flag or --key=value)
      const flagMatch = part.match(/^--([^=]+)(?:=(.+))?$/)
      if (flagMatch) {
        const [, key, value] = flagMatch
        flags[key] = value ?? true
      }
    } else if (part.startsWith("-") && part.length === 2) {
      // Short flag (-v)
      flags[part[1]] = true
    } else {
      // Regular argument
      args.push(part)
    }
  }

  return {
    name,
    args,
    full: trimmed,
    flags,
  }
}
