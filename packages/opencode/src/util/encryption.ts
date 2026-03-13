/**
 * Encryption utilities for sensitive memory storage
 * 
 * Uses Web Crypto API (SubtleCrypto) for AES-GCM encryption.
 * No external dependencies required.
 */

import { Log } from "./log"

const log = Log.create({ service: "encryption" })

// Algorithm configuration
const ALGORITHM = "AES-GCM"
const KEY_LENGTH = 256
const IV_LENGTH = 12 // 96 bits for AES-GCM
const SALT_LENGTH = 16

/**
 * Encryption error types
 */
export class EncryptionError extends Error {
  override readonly cause?: unknown
  
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = "EncryptionError"
    this.cause = cause
  }
}

/**
 * Get or derive the encryption key
 * 
 * Security strategy:
 * 1. If MEMORY_ENCRYPTION_KEY env var is set, use it directly (base64 encoded)
 * 2. Otherwise, throw error - sensitive memory storage requires explicit key configuration
 * 
 * This prevents accidental data loss from randomly generated keys.
 */
async function getEncryptionKey(): Promise<CryptoKey> {
  const envKey = process.env.MEMORY_ENCRYPTION_KEY
  
  if (!envKey) {
    throw new EncryptionError(
      "MEMORY_ENCRYPTION_KEY environment variable not set. " +
      "Sensitive memory storage requires explicit key configuration. " +
      "Generate a key with: openssl rand -base64 32"
    )
  }

  try {
    // Decode base64 key
    const keyData = Buffer.from(envKey, "base64")
    
    // Import as raw key for AES-GCM
    return await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: ALGORITHM, length: KEY_LENGTH },
      false, // not extractable
      ["encrypt", "decrypt"]
    )
  } catch (error) {
    throw new EncryptionError(
      "Failed to import encryption key. Ensure MEMORY_ENCRYPTION_KEY is a valid base64-encoded 256-bit key.",
      error
    )
  }
}

// Cache the key to avoid repeated imports
let cachedKey: CryptoKey | null = null

async function getKey(): Promise<CryptoKey> {
  if (!cachedKey) {
    cachedKey = await getEncryptionKey()
  }
  return cachedKey
}

/**
 * Encrypt sensitive content
 * 
 * @param plaintext - The content to encrypt
 * @returns Base64-encoded encrypted content (IV + ciphertext)
 */
export async function encrypt(plaintext: string): Promise<string> {
  const key = await getKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encoder = new TextEncoder()
  const data = encoder.encode(plaintext)

  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: ALGORITHM, iv },
      key,
      data
    )

    // Combine IV and ciphertext
    const combined = new Uint8Array(iv.length + ciphertext.byteLength)
    combined.set(iv, 0)
    combined.set(new Uint8Array(ciphertext), iv.length)

    // Return as base64
    return Buffer.from(combined).toString("base64")
  } catch (error) {
    log.error("encryption_failed", { error: String(error) })
    throw new EncryptionError("Failed to encrypt content", error)
  }
}

/**
 * Decrypt sensitive content
 * 
 * @param encryptedBase64 - Base64-encoded encrypted content (IV + ciphertext)
 * @returns Decrypted plaintext
 */
export async function decrypt(encryptedBase64: string): Promise<string> {
  const key = await getKey()
  
  try {
    const combined = Buffer.from(encryptedBase64, "base64")
    
    // Extract IV and ciphertext
    const iv = combined.slice(0, IV_LENGTH)
    const ciphertext = combined.slice(IV_LENGTH)

    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      ciphertext
    )

    const decoder = new TextDecoder()
    return decoder.decode(decrypted)
  } catch (error) {
    log.error("decryption_failed", { error: String(error) })
    throw new EncryptionError("Failed to decrypt content", error)
  }
}

/**
 * Check if encryption is available
 * 
 * @returns true if MEMORY_ENCRYPTION_KEY is configured and valid
 */
export async function isEncryptionAvailable(): Promise<boolean> {
  try {
    await getKey()
    return true
  } catch {
    return false
  }
}

/**
 * Generate a new encryption key
 * 
 * Run this to create a new key for MEMORY_ENCRYPTION_KEY:
 * ```bash
 * node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * ```
 */
export function generateKey(): string {
  const key = crypto.getRandomValues(new Uint8Array(32))
  return Buffer.from(key).toString("base64")
}

/**
 * Hash content for integrity verification
 * Uses SHA-256 for fast, deterministic hashing
 */
export async function hash(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  return Buffer.from(hashBuffer).toString("hex")
}
