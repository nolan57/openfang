/**
 * Authentication utilities for plugin HTTP requests.
 *
 * Provides functions for scoped token authentication with automatic
 * retry and fallback mechanisms.
 *
 * @example
 * ```typescript
 * // Basic bearer token auth with scope fallback
 * const response = await fetchWithBearerAuthScopeFallback({
 *   url: "https://api.example.com/data",
 *   scopes: ["read:data", "read:public"],
 *   tokenProvider: {
 *     getAccessToken: async (scope) => {
 *       // Your token acquisition logic
 *       return await oauthClient.getToken(scope)
 *     }
 *   }
 * })
 *
 * // With custom fetch and HTTPS requirement
 * const response = await fetchWithBearerAuthScopeFallback({
 *   url: "https://api.example.com/data",
 *   scopes: ["read:data"],
 *   tokenProvider: myTokenProvider,
 *   requireHttps: true,
 *   fetchFn: customFetch
 * })
 * ```
 */

/**
 * Token provider interface for acquiring access tokens.
 */
export interface ScopeTokenProvider {
  /**
   * Acquires an access token for the specified scope.
   *
   * @param scope - The OAuth scope or permission to request
   * @returns Access token string
   */
  getAccessToken: (scope: string) => Promise<string>
}

/**
 * Custom retry condition function.
 *
 * @param response - The HTTP response to evaluate
 * @returns true if should retry with auth, false otherwise
 */
export type RetryCondition = (response: Response) => boolean

/**
 * URL authorization check function.
 *
 * @param url - The URL being requested
 * @returns true if auth should be attempted, false otherwise
 */
export type AuthAttachmentCheck = (url: string) => boolean

/**
 * Options for fetchWithBearerAuthScopeFallback.
 */
export interface BearerAuthFetchOptions {
  /**
   * The URL to fetch.
   */
  url: string

  /**
   * OAuth scopes to try in order.
   * First successful scope will be used.
   */
  scopes: readonly string[]

  /**
   * Token provider for acquiring access tokens.
   * If not provided, no authentication will be attempted.
   */
  tokenProvider?: ScopeTokenProvider

  /**
   * Custom fetch implementation to use.
   * @default global fetch
   */
  fetchFn?: typeof fetch

  /**
   * Additional request options (headers, method, body, etc.)
   */
  requestInit?: RequestInit

  /**
   * Require HTTPS for all requests.
   * @default true
   */
  requireHttps?: boolean

  /**
   * Custom function to determine if auth should be attached.
   * @default () => true (always attempt auth on 401/403)
   */
  shouldAttachAuth?: AuthAttachmentCheck

  /**
   * Custom function to determine if retry should be attempted.
   * @default (res) => res.status === 401 || res.status === 403
   */
  shouldRetry?: RetryCondition
}

/**
 * Checks if a response status indicates an authentication failure.
 */
function isAuthFailureStatus(status: number): boolean {
  return status === 401 || status === 403
}

/**
 * Performs a fetch request with automatic bearer token authentication.
 *
 * Flow:
 * 1. Make initial request without auth
 * 2. If response is 401/403, try each scope in order:
 *    - Acquire token for scope
 *    - Retry request with Authorization header
 *    - If successful, return response
 * 3. Return original response if all scopes fail
 *
 * @param options - Authentication and request options
 * @returns Fetch response
 *
 * @example
 * ```typescript
 * // Basic usage with OAuth scopes
 * const response = await fetchWithBearerAuthScopeFallback({
 *   url: "https://api.example.com/protected",
 *   scopes: ["read:data", "read:public"],
 *   tokenProvider: {
 *     getAccessToken: (scope) => oauth.getToken(scope)
 *   }
 * })
 *
 * if (response.ok) {
 *   const data = await response.json()
 * }
 * ```
 *
 * @throws Error if URL is invalid or HTTPS is required but not used
 */
export async function fetchWithBearerAuthScopeFallback(
  options: BearerAuthFetchOptions,
): Promise<Response> {
  const fetchFn = options.fetchFn ?? fetch
  const requireHttps = options.requireHttps ?? true

  // Validate and parse URL
  let parsedUrl: URL
  try {
    parsedUrl = new URL(options.url)
  } catch {
    throw new Error(`Invalid URL: ${options.url}`)
  }

  // Enforce HTTPS requirement
  if (requireHttps && parsedUrl.protocol !== "https:") {
    throw new Error(`URL must use HTTPS: ${options.url}`)
  }

  // Initial fetch without auth
  const fetchOnce = (headers?: Headers): Promise<Response> =>
    fetchFn(options.url, {
      ...options.requestInit,
      ...(headers ? { headers } : {}),
    })

  const firstAttempt = await fetchOnce()

  // Return immediately if successful
  if (firstAttempt.ok) {
    return firstAttempt
  }

  // No token provider = can't retry with auth
  if (!options.tokenProvider) {
    return firstAttempt
  }

  // Check if we should retry
  const shouldRetry = options.shouldRetry ?? isAuthFailureStatus
  if (!shouldRetry(firstAttempt)) {
    return firstAttempt
  }

  // Check if auth should be attached to this URL
  if (options.shouldAttachAuth && !options.shouldAttachAuth(options.url)) {
    return firstAttempt
  }

  // Try each scope in order
  for (const scope of options.scopes) {
    try {
      const token = await options.tokenProvider.getAccessToken(scope)

      // Create new headers with Authorization
      const authHeaders = new Headers(options.requestInit?.headers)
      authHeaders.set("Authorization", `Bearer ${token}`)

      // Retry with auth
      const authAttempt = await fetchOnce(authHeaders)

      // Return if successful
      if (authAttempt.ok) {
        return authAttempt
      }

      // Check if we should continue trying other scopes
      if (!shouldRetry(authAttempt)) {
        continue
      }
    } catch {
      // Ignore token acquisition errors and try next scope
      // This allows fallback to less privileged scopes
    }
  }

  // All scopes failed, return original response
  return firstAttempt
}

/**
 * Creates a fetch wrapper with automatic bearer token authentication.
 *
 * @param defaultScopes - Default scopes to use for all requests
 * @param tokenProvider - Token provider for acquiring access tokens
 * @param options - Additional options
 * @returns Fetch wrapper function
 *
 * @example
 * ```typescript
 * // Create authenticated fetch wrapper
 * const authFetch = createAuthFetch(
 *   ["read:data"],
 *   { getAccessToken: (scope) => oauth.getToken(scope) }
 * )
 *
 * // Use like normal fetch
 * const response = await authFetch("https://api.example.com/data")
 * const data = await response.json()
 * ```
 */
export function createAuthFetch(
  defaultScopes: readonly string[],
  tokenProvider: ScopeTokenProvider,
  options?: Partial<BearerAuthFetchOptions>,
) {
  return async function authFetch(url: string, init?: RequestInit): Promise<Response> {
    return fetchWithBearerAuthScopeFallback({
      url,
      scopes: defaultScopes,
      tokenProvider,
      requestInit: init,
      ...options,
    })
  }
}

/**
 * Options for multi-provider token acquisition.
 */
export interface MultiProviderTokenOptions {
  /**
   * Primary token provider.
   */
  primary: ScopeTokenProvider

  /**
   * Fallback token providers tried in order.
   */
  fallbacks?: ScopeTokenProvider[]

  /**
   * Preferred scopes for each provider.
   */
  providerScopes?: Record<string, readonly string[]>
}

/**
 * Token provider that tries multiple providers in order.
 */
export class MultiProviderTokenProvider implements ScopeTokenProvider {
  private primary: ScopeTokenProvider
  private fallbacks: ScopeTokenProvider[]
  private providerScopes: Record<string, readonly string[]>

  constructor(options: MultiProviderTokenOptions) {
    this.primary = options.primary
    this.fallbacks = options.fallbacks ?? []
    this.providerScopes = options.providerScopes ?? {}
  }

  async getAccessToken(scope: string): Promise<string> {
    // Try primary first
    try {
      const primaryScopes = this.providerScopes.primary ?? [scope]
      for (const s of primaryScopes) {
        try {
          return await this.primary.getAccessToken(s)
        } catch {
          // Try next scope
        }
      }
    } catch {
      // Fall through to fallbacks
    }

    // Try fallbacks in order
    for (let i = 0; i < this.fallbacks.length; i++) {
      const fallback = this.fallbacks[i]
      const fallbackScopes = this.providerScopes[`fallback_${i}`] ?? [scope]

      for (const s of fallbackScopes) {
        try {
          return await fallback.getAccessToken(s)
        } catch {
          // Try next scope/provider
        }
      }
    }

    throw new Error("All token providers failed")
  }
}

/**
 * In-memory token cache for reducing token acquisition calls.
 */
export class TokenCache implements ScopeTokenProvider {
  private cache = new Map<string, { token: string; expires: number }>()
  private provider: ScopeTokenProvider

  /**
   * Time before expiry to refresh token (ms).
   * @default 5 minutes
   */
  refreshThresholdMs: number = 5 * 60 * 1000

  constructor(provider: ScopeTokenProvider) {
    this.provider = provider
  }

  async getAccessToken(scope: string): Promise<string> {
    const cached = this.cache.get(scope)
    const now = Date.now()

    // Return cached token if still valid
    if (cached && now < cached.expires - this.refreshThresholdMs) {
      return cached.token
    }

    // Acquire new token
    const token = await this.provider.getAccessToken(scope)

    // Cache with 1 hour default expiry
    // (actual expiry should be set by the provider)
    this.cache.set(scope, {
      token,
      expires: now + 60 * 60 * 1000,
    })

    return token
  }

  /**
   * Sets a token with explicit expiry.
   */
  setToken(scope: string, token: string, expiresAt: Date): void {
    this.cache.set(scope, {
      token,
      expires: expiresAt.getTime(),
    })
  }

  /**
   * Clears cached tokens for a scope.
   */
  invalidate(scope: string): void {
    this.cache.delete(scope)
  }

  /**
   * Clears all cached tokens.
   */
  clear(): void {
    this.cache.clear()
  }
}
