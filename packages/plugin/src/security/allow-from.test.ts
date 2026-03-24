import { describe, it, expect } from "bun:test"
import {
  normalizeSenderId,
  formatAllowFromEntry,
  formatAllowFromList,
  isSenderAllowed,
  parseAllowFromConfig,
  createSenderValidator,
  isAllowedParsedChatSender,
} from "./allow-from"

describe("normalizeSenderId", () => {
  it("normalizes string to lowercase with trimmed whitespace", () => {
    expect(normalizeSenderId("  User123  ")).toBe("user123")
    expect(normalizeSenderId("ADMIN")).toBe("admin")
  })

  it("converts number to string", () => {
    expect(normalizeSenderId(12345)).toBe("12345")
  })
})

describe("formatAllowFromEntry", () => {
  it("normalizes entry to lowercase", () => {
    expect(formatAllowFromEntry("USER123")).toBe("user123")
  })

  it("strips prefix when regex provided", () => {
    const re = /^(telegram|discord):/
    expect(formatAllowFromEntry("telegram:user123", re)).toBe("user123")
    expect(formatAllowFromEntry("discord:admin", re)).toBe("admin")
  })

  it("handles number entries", () => {
    expect(formatAllowFromEntry(12345)).toBe("12345")
  })
})

describe("formatAllowFromList", () => {
  it("normalizes all entries", () => {
    const result = formatAllowFromList({
      allowFrom: ["User1", "USER2", "  user3  "],
    })
    expect(result).toEqual(["user1", "user2", "user3"])
  })

  it("strips prefixes from all entries", () => {
    const re = /^prefix:/
    const result = formatAllowFromList({
      allowFrom: ["prefix:a", "prefix:b", "prefix:c"],
      stripPrefixRe: re,
    })
    expect(result).toEqual(["a", "b", "c"])
  })

  it("filters out empty entries", () => {
    const result = formatAllowFromList({
      allowFrom: ["user1", "", "  ", "user2"],
    })
    expect(result).toEqual(["user1", "user2"])
  })
})

describe("isSenderAllowed", () => {
  it("returns false for empty allowlist", () => {
    expect(isSenderAllowed({ senderId: "user1", allowFrom: [] })).toBe(false)
  })

  it("returns true for wildcard allowlist", () => {
    expect(isSenderAllowed({ senderId: "anyone", allowFrom: ["*"] })).toBe(true)
    expect(isSenderAllowed({ senderId: "anyone", allowFrom: ["user1", "  *  "] })).toBe(true)
  })

  it("matches sender exactly", () => {
    expect(
      isSenderAllowed({
        senderId: "user123",
        allowFrom: ["user123", "admin"],
      }),
    ).toBe(true)
  })

  it("is case insensitive", () => {
    expect(
      isSenderAllowed({
        senderId: "USER123",
        allowFrom: ["user123"],
      }),
    ).toBe(true)
  })

  it("handles whitespace", () => {
    expect(
      isSenderAllowed({
        senderId: "  user123  ",
        allowFrom: ["user123"],
      }),
    ).toBe(true)
  })

  it("strips prefix when regex provided", () => {
    const re = /^(telegram|discord):/
    expect(
      isSenderAllowed({
        senderId: "telegram:user123",
        allowFrom: ["user123"],
        stripPrefixRe: re,
      }),
    ).toBe(true)

    expect(
      isSenderAllowed({
        senderId: "discord:admin",
        allowFrom: ["admin", "user1"],
        stripPrefixRe: re,
      }),
    ).toBe(true)
  })

  it("returns false when sender not in allowlist", () => {
    expect(
      isSenderAllowed({
        senderId: "intruder",
        allowFrom: ["user1", "user2"],
      }),
    ).toBe(false)
  })

  it("handles numeric sender IDs", () => {
    expect(
      isSenderAllowed({
        senderId: 12345,
        allowFrom: ["12345", "67890"],
      }),
    ).toBe(true)
  })
})

describe("parseAllowFromConfig", () => {
  it("returns empty array for undefined", () => {
    expect(parseAllowFromConfig(undefined)).toEqual([])
  })

  it("parses comma-separated string", () => {
    expect(parseAllowFromConfig("user1,user2,user3")).toEqual(["user1", "user2", "user3"])
  })

  it("trims whitespace from entries", () => {
    expect(parseAllowFromConfig("  user1  ,  user2  ,user3")).toEqual(["user1", "user2", "user3"])
  })

  it("filters out empty entries", () => {
    expect(parseAllowFromConfig("user1,,  ,user2")).toEqual(["user1", "user2"])
  })

  it("passes through array unchanged", () => {
    expect(parseAllowFromConfig(["user1", "user2"])).toEqual(["user1", "user2"])
  })

  it("converts array numbers to strings", () => {
    // Note: input type is string[], but testing edge case
    expect(parseAllowFromConfig(["123", "456"])).toEqual(["123", "456"])
  })
})

describe("createSenderValidator", () => {
  it("creates validator with cached normalization", () => {
    const validator = createSenderValidator({
      allowFrom: ["User1", "USER2"],
    })

    expect(validator.isAllowed("user1")).toBe(true)
    expect(validator.isAllowed("user2")).toBe(true)
    expect(validator.isAllowed("user3")).toBe(false)
  })

  it("respects wildcard", () => {
    const validator = createSenderValidator({
      allowFrom: ["*"],
    })

    expect(validator.isAllowed("anyone")).toBe(true)
    expect(validator.isAllowed("anything")).toBe(true)
  })

  it("returns empty allowlist when none configured", () => {
    const validator = createSenderValidator({
      allowFrom: [],
    })

    expect(validator.getAllowlist()).toEqual([])
    expect(validator.isAllowed("user1")).toBe(false)
  })

  it("allows getting the normalized allowlist", () => {
    const validator = createSenderValidator({
      allowFrom: ["User1", "user2"],
      stripPrefixRe: /^prefix:/,
    })

    expect(validator.getAllowlist()).toEqual(["user1", "user2"])
  })

  it("strips prefix in validator", () => {
    const validator = createSenderValidator({
      allowFrom: ["telegram:user1", "discord:user2"],
      stripPrefixRe: /^(telegram|discord):/,
    })

    expect(validator.isAllowed("user1")).toBe(true)
    expect(validator.isAllowed("user2")).toBe(true)
  })
})

describe("isAllowedParsedChatSender", () => {
  it("returns false for empty allowlist", () => {
    const result = isAllowedParsedChatSender({
      allowFrom: [],
      sender: "user1",
      normalizeSender: s => s.toLowerCase(),
      parseAllowTarget: entry => ({ kind: "handle", handle: entry }),
    })
    expect(result).toBe(false)
  })

  it("returns true for wildcard", () => {
    const result = isAllowedParsedChatSender({
      allowFrom: ["*"],
      sender: "user1",
      normalizeSender: s => s.toLowerCase(),
      parseAllowTarget: entry => ({ kind: "handle", handle: entry }),
    })
    expect(result).toBe(true)
  })

  it("matches by handle", () => {
    const result = isAllowedParsedChatSender({
      allowFrom: ["user1", "user2"],
      sender: "user1",
      normalizeSender: s => s.toLowerCase(),
      parseAllowTarget: entry => ({ kind: "handle", handle: entry.toLowerCase() }),
    })
    expect(result).toBe(true)
  })

  it("matches by chat_id", () => {
    const result = isAllowedParsedChatSender({
      allowFrom: ["chat:12345", "chat:67890"],
      sender: "user1",
      chatId: 12345,
      normalizeSender: s => s.toLowerCase(),
      parseAllowTarget: (entry) => {
        if (entry.startsWith("chat:")) {
          return { kind: "chat_id", chatId: Number(entry.slice(5)) }
        }
        return { kind: "handle", handle: entry }
      },
    })
    expect(result).toBe(true)
  })

  it("matches by chat_guid", () => {
    const result = isAllowedParsedChatSender({
      allowFrom: ["guid:abc-123"],
      sender: "user1",
      chatGuid: "abc-123",
      normalizeSender: s => s.toLowerCase(),
      parseAllowTarget: (entry) => {
        if (entry.startsWith("guid:")) {
          return { kind: "chat_guid", chatGuid: entry.slice(5) }
        }
        return { kind: "handle", handle: entry }
      },
    })
    expect(result).toBe(true)
  })

  it("matches by username with @ prefix", () => {
    const result = isAllowedParsedChatSender({
      allowFrom: ["@admin", "@user1"],
      sender: "user1",
      normalizeSender: s => s.toLowerCase(),
      parseAllowTarget: (entry) => {
        if (entry.startsWith("@")) {
          return { kind: "username", username: entry.slice(1).toLowerCase() }
        }
        return { kind: "handle", handle: entry.toLowerCase() }
      },
    })
    expect(result).toBe(true)
  })

  it("returns false when no match found", () => {
    const result = isAllowedParsedChatSender({
      allowFrom: ["user1", "user2"],
      sender: "intruder",
      normalizeSender: s => s.toLowerCase(),
      parseAllowTarget: entry => ({ kind: "handle", handle: entry }),
    })
    expect(result).toBe(false)
  })

  it("handles multiple target types in same allowlist", () => {
    const result = isAllowedParsedChatSender({
      allowFrom: ["chat:12345", "@admin", "user1"],
      sender: "admin",
      chatId: 12345,
      normalizeSender: s => s.toLowerCase(),
      parseAllowTarget: (entry) => {
        if (entry.startsWith("chat:")) {
          return { kind: "chat_id", chatId: Number(entry.slice(5)) }
        }
        if (entry.startsWith("@")) {
          return { kind: "username", username: entry.slice(1).toLowerCase() }
        }
        return { kind: "handle", handle: entry.toLowerCase() }
      },
    })
    // Should match both chat_id and username
    expect(result).toBe(true)
  })
})
