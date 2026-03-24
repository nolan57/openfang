/**
 * SSRF (Server-Side Request Forgery) protection utilities for plugins.
 *
 * Provides functions to validate URLs and hostnames against allowlists,
 * preventing malicious requests to internal network resources.
 *
 * @example
 * ```typescript
 * // Create SSRF policy with hostname allowlist
 * const policy = buildHostnameAllowlistPolicyFromSuffixAllowlist([
 *   "api.anthropic.com",
 *   "api.openai.com"
 * ])
 *
 * // Check if URL is allowed
 * if (!isHttpsUrlAllowedByHostnameSuffixAllowlist(
 *   "https://api.anthropic.com/v1/messages",
 *   ["anthropic.com"]
 * )) {
 *   throw new Error("SSRF blocked: URL not allowed")
 * }
 *
 * // Use with fetch wrapper
 * const safeFetch = createSafeFetch({
 *   allowedHosts: ["api.anthropic.com", "api.openai.com"],
 *   requireHttps: true
 * })
 *
 * await safeFetch("https://api.anthropic.com/v1/messages")
 * ```
 */

/**
 * SSRF policy configuration.
 */
export interface SsrFPolicy {
  /**
   * Allow private network addresses (10.x.x.x, 192.168.x.x, etc.)
   * @default false
   */
  allowPrivateNetwork?: boolean

  /**
   * Dangerously allow all private network addresses including
   * link-local and loopback. Use with extreme caution.
   * @default false
   */
  dangerouslyAllowPrivateNetwork?: boolean

  /**
   * Allow RFC2544 benchmark range (198.18.0.0/15)
   * @default false
   */
  allowRfc2544BenchmarkRange?: boolean

  /**
   * List of allowed hostnames (supports wildcard patterns like *.example.com)
   */
  allowedHostnames?: string[]

  /**
   * Hostname allowlist for SSRF protection
   */
  hostnameAllowlist?: string[]
}

/**
 * Normalizes a hostname suffix for comparison.
 *
 * - Converts to lowercase
 * - Removes leading wildcards (*.example.com → example.com)
 * - Removes leading/trailing dots
 * - Returns empty string for invalid input
 */
export function normalizeHostnameSuffix(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) {
    return ""
  }
  if (trimmed === "*" || trimmed === "*.") {
    return "*"
  }
  // Remove wildcard prefix
  const withoutWildcard = trimmed.replace(/^\*\.?/, "")
  // Remove leading dots
  const withoutLeadingDot = withoutWildcard.replace(/^\.+/, "")
  // Remove trailing dots
  return withoutLeadingDot.replace(/\.+$/, "")
}

/**
 * Normalizes a hostname suffix allowlist.
 *
 * - Applies normalizeHostnameSuffix to each entry
 * - Deduplicates entries
 * - Returns ["*"] if wildcard is present
 */
export function normalizeHostnameSuffixAllowlist(
  input?: readonly string[],
  defaults?: readonly string[],
): string[] {
  const source = input && input.length > 0 ? input : defaults
  if (!source || source.length === 0) {
    return []
  }

  const normalized = source.map(normalizeHostnameSuffix).filter(Boolean)

  // Wildcard allows everything
  if (normalized.includes("*")) {
    return ["*"]
  }

  return Array.from(new Set(normalized))
}

/**
 * Checks if a hostname is allowed by a suffix allowlist.
 *
 * Supports:
 * - Exact match: "example.com" allows "example.com"
 * - Suffix match: "example.com" allows "api.example.com"
 * - Wildcard: "*" allows any hostname
 */
export function isHostnameAllowedBySuffixAllowlist(
  hostname: string,
  allowlist: readonly string[],
): boolean {
  if (allowlist.includes("*")) {
    return true
  }

  const normalized = hostname.toLowerCase()

  return allowlist.some((entry) => {
    // Exact match
    if (normalized === entry) {
      return true
    }
    // Suffix match (subdomain)
    if (normalized.endsWith(`.${entry}`)) {
      return true
    }
    return false
  })
}

/**
 * Checks if an HTTPS URL is allowed by a hostname suffix allowlist.
 *
 * Requirements:
 * - URL must be valid
 * - URL must use HTTPS protocol
 * - Hostname must match allowlist
 *
 * @param url - The URL to validate
 * @param allowlist - Hostname suffix allowlist
 * @returns true if URL is allowed, false otherwise
 *
 * @example
 * ```typescript
 * // Valid HTTPS URL with matching hostname
 * isHttpsUrlAllowedByHostnameSuffixAllowlist(
 *   "https://api.anthropic.com/v1/messages",
 *   ["anthropic.com"]
 * ) // true
 *
 * // HTTP is rejected
 * isHttpsUrlAllowedByHostnameSuffixAllowlist(
 *   "http://api.anthropic.com/v1/messages",
 *   ["anthropic.com"]
 * ) // false
 *
 * // Non-matching hostname is rejected
 * isHttpsUrlAllowedByHostnameSuffixAllowlist(
 *   "https://evil.com/attack",
 *   ["anthropic.com"]
 * ) // false
 * ```
 */
export function isHttpsUrlAllowedByHostnameSuffixAllowlist(
  url: string,
  allowlist: readonly string[],
): boolean {
  try {
    const parsed = new URL(url)

    // Require HTTPS
    if (parsed.protocol !== "https:") {
      return false
    }

    return isHostnameAllowedBySuffixAllowlist(parsed.hostname, allowlist)
  } catch {
    // Invalid URL
    return false
  }
}

/**
 * Converts suffix-style host allowlists into SSRF hostname allowlist patterns.
 *
 * Suffix semantics:
 * - "example.com" allows "example.com" and "*.example.com"
 * - "*" disables hostname allowlist restrictions (returns undefined)
 *
 * @param allowHosts - Hostname suffix allowlist
 * @returns SSRF policy object or undefined if allowlist is empty/wildcard
 *
 * @example
 * ```typescript
 * // Single hostname
 * buildHostnameAllowlistPolicyFromSuffixAllowlist(["sharepoint.com"])
 * // Returns: { hostnameAllowlist: ["sharepoint.com", "*.sharepoint.com"] }
 *
 * // Multiple hostnames
 * buildHostnameAllowlistPolicyFromSuffixAllowlist([
 *   "api.anthropic.com",
 *   "api.openai.com"
 * ])
 * // Returns: { hostnameAllowlist: [
 * //   "api.anthropic.com", "*.api.anthropic.com",
 * //   "api.openai.com", "*.api.openai.com"
 * // ]}
 *
 * // Wildcard disables restrictions
 * buildHostnameAllowlistPolicyFromSuffixAllowlist(["*"])
 * // Returns: undefined
 * ```
 */
export function buildHostnameAllowlistPolicyFromSuffixAllowlist(
  allowHosts?: readonly string[],
): SsrFPolicy | undefined {
  const normalizedAllowHosts = normalizeHostnameSuffixAllowlist(allowHosts)

  if (normalizedAllowHosts.length === 0) {
    return undefined
  }

  // Wildcard means no restrictions
  if (normalizedAllowHosts.includes("*")) {
    return undefined
  }

  // Expand each suffix to exact + wildcard patterns
  const patterns = new Set<string>()
  for (const normalized of normalizedAllowHosts) {
    patterns.add(normalized)
    patterns.add(`*.${normalized}`)
  }

  if (patterns.size === 0) {
    return undefined
  }

  return {
    hostnameAllowlist: Array.from(patterns),
  }
}

/**
 * Creates a safe fetch wrapper with SSRF protection.
 *
 * Features:
 * - URL validation against allowlist
 * - HTTPS enforcement
 * - Private IP blocking (optional)
 *
 * @example
 * ```typescript
 * const safeFetch = createSafeFetch({
 *   allowedHosts: ["api.anthropic.com", "api.openai.com"],
 *   requireHttps: true,
 *   blockPrivateNetwork: true
 * })
 *
 * // This will throw if URL is not allowed
 * const response = await safeFetch("https://api.anthropic.com/v1/messages")
 * ```
 */
export interface SafeFetchOptions {
  /**
   * Hostname suffix allowlist
   */
  allowedHosts?: string[]

  /**
   * Require HTTPS for all requests
   * @default true
   */
  requireHttps?: boolean

  /**
   * Block private network addresses
   * @default true
   */
  blockPrivateNetwork?: boolean

  /**
   * Custom fetch implementation to wrap
   * @default global fetch
   */
  fetchFn?: typeof fetch
}

export class SSRFBlockedError extends Error {
  constructor(
    message: string,
    public readonly url?: string,
    public readonly reason?: string,
  ) {
    super(message)
    this.name = "SSRFBlockedError"
  }
}

/**
 * Creates a fetch wrapper with SSRF protection.
 */
export function createSafeFetch(options: SafeFetchOptions) {
  const fetchFn = options.fetchFn ?? fetch
  const requireHttps = options.requireHttps ?? true
  const blockPrivateNetwork = options.blockPrivateNetwork ?? true
  const allowlist = normalizeHostnameSuffixAllowlist(options.allowedHosts)

  async function validateUrl(url: string): Promise<void> {
    let parsed: URL

    try {
      parsed = new URL(url)
    } catch {
      throw new SSRFBlockedError("Invalid URL", url, "URL parsing failed")
    }

    // Check HTTPS requirement
    if (requireHttps && parsed.protocol !== "https:") {
      throw new SSRFBlockedError(
        `URL must use HTTPS: ${url}`,
        url,
        "non-https-protocol",
      )
    }

    // Check hostname allowlist
    if (allowlist.length > 0 && !isHostnameAllowedBySuffixAllowlist(parsed.hostname, allowlist)) {
      throw new SSRFBlockedError(
        `Hostname not in allowlist: ${parsed.hostname}`,
        url,
        "hostname-not-allowed",
      )
    }

    // Block private network addresses
    if (blockPrivateNetwork && isPrivateIpAddress(parsed.hostname)) {
      throw new SSRFBlockedError(
        `Private IP addresses are not allowed: ${parsed.hostname}`,
        url,
        "private-ip-blocked",
      )
    }
  }

  return async function safeFetch(
    url: string,
    init?: RequestInit,
  ): Promise<Response> {
    await validateUrl(url)
    return fetchFn(url, init)
  }
}

/**
 * Checks if an IP address string is a private/special-use address.
 *
 * Blocks:
 * - Loopback (127.0.0.0/8, ::1)
 * - Private networks (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 * - Link-local (169.254.0.0/16, fe80::/10)
 * - Cloud metadata (169.254.169.254)
 * - Unspecified (0.0.0.0, ::)
 *
 * @param address - IP address or hostname to check
 * @returns true if address is private/special-use, false otherwise
 */
export function isPrivateIpAddress(address: string): boolean {
  let normalized = address.trim().toLowerCase()

  // Remove IPv6 brackets if present
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1)
  }

  if (!normalized) {
    return false
  }

  // Check for localhost
  if (normalized === "localhost" || normalized === "localhost.localdomain") {
    return true
  }

  // IPv4 checks
  if (isIpv4Address(normalized)) {
    return isPrivateIpv4Address(normalized)
  }

  // IPv6 checks
  if (isIpv6Address(normalized)) {
    return isPrivateIpv6Address(normalized)
  }

  // Unknown format - fail closed (block it)
  return true
}

/**
 * Checks if a string is a valid IPv4 address.
 */
function isIpv4Address(address: string): boolean {
  const parts = address.split(".")
  if (parts.length !== 4) {
    return false
  }
  return parts.every((part) => {
    const num = Number.parseInt(part, 10)
    return !Number.isNaN(num) && num >= 0 && num <= 255 && String(num) === part
  })
}

/**
 * Checks if a string is a valid IPv6 address (simplified).
 */
function isIpv6Address(address: string): boolean {
  // Basic IPv6 pattern check
  if (address.includes(":")) {
    return true
  }
  return false
}

/**
 * Checks if an IPv4 address is private or special-use.
 */
function isPrivateIpv4Address(address: string): boolean {
  const parts = address.split(".").map((p) => Number.parseInt(p, 10))
  const [a, b, c, d] = parts

  // 0.0.0.0 - Unspecified
  if (a === 0 && b === 0 && c === 0 && d === 0) {
    return true
  }

  // 127.0.0.0/8 - Loopback
  if (a === 127) {
    return true
  }

  // 10.0.0.0/8 - Private
  if (a === 10) {
    return true
  }

  // 172.16.0.0/12 - Private (172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) {
    return true
  }

  // 192.168.0.0/16 - Private
  if (a === 192 && b === 168) {
    return true
  }

  // 169.254.0.0/16 - Link-local (including cloud metadata 169.254.169.254)
  if (a === 169 && b === 254) {
    return true
  }

  // 100.64.0.0/10 - Carrier-grade NAT
  if (a === 100 && b >= 64 && b <= 127) {
    return true
  }

  // 192.0.0.0/24 - IETF Protocol Assignments
  if (a === 192 && b === 0 && c === 0) {
    return true
  }

  // 192.0.2.0/24 - Documentation (TEST-NET-1)
  if (a === 192 && b === 0 && c === 2) {
    return true
  }

  // 198.18.0.0/15 - Benchmark (RFC2544)
  if (a === 198 && b >= 18 && b <= 19) {
    return true
  }

  // 198.51.100.0/24 - Documentation (TEST-NET-2)
  if (a === 198 && b === 51 && c === 100) {
    return true
  }

  // 203.0.113.0/24 - Documentation (TEST-NET-3)
  if (a === 203 && b === 0 && c === 113) {
    return true
  }

  // 224.0.0.0/4 - Multicast
  if (a >= 224 && a <= 239) {
    return true
  }

  // 240.0.0.0/4 - Reserved
  if (a >= 240) {
    return true
  }

  return false
}

/**
 * Checks if an IPv6 address is private or special-use.
 */
function isPrivateIpv6Address(address: string): boolean {
  const normalized = address.toLowerCase()

  // ::1 - Loopback
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return true
  }

  // :: - Unspecified
  if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") {
    return true
  }

  // fe80::/10 - Link-local
  if (normalized.startsWith("fe80:") || normalized.startsWith("fe8:")) {
    return true
  }

  // fc00::/7 - Unique local (fc00::/8 and fd00::/8)
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true
  }

  // ::ffff:0:0/96 - IPv4-mapped IPv6 (check embedded IPv4)
  if (normalized.startsWith("::ffff:")) {
    const ipv4Part = normalized.slice(7)
    if (isIpv4Address(ipv4Part)) {
      return isPrivateIpv4Address(ipv4Part)
    }
  }

  return false
}
