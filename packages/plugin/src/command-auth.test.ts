import { describe, it, expect } from "bun:test"
import {
  checkCommandPermission,
  matchesCommandPattern,
  createCommandValidator,
  CommandDeniedError,
  verifyCommandSignature,
  generateCommandSignature,
  parseCommand,
  type CommandPermissionResult,
} from "./command-auth"

describe("matchesCommandPattern", () => {
  it("matches exact command", () => {
    expect(matchesCommandPattern("deploy", "deploy")).toBe(true)
    expect(matchesCommandPattern("restart", "restart")).toBe(true)
  })

  it("is case insensitive", () => {
    expect(matchesCommandPattern("DEPLOY", "deploy")).toBe(true)
    expect(matchesCommandPattern("Deploy", "DEPLOY")).toBe(true)
  })

  it("handles whitespace", () => {
    expect(matchesCommandPattern("  deploy  ", "deploy")).toBe(true)
  })

  it("matches wildcard", () => {
    expect(matchesCommandPattern("anything", "*")).toBe(true)
    expect(matchesCommandPattern("deploy production", "*")).toBe(true)
  })

  it("matches prefix wildcard", () => {
    expect(matchesCommandPattern("deploy:prod", "deploy:*")).toBe(true)
    expect(matchesCommandPattern("deploy:staging", "deploy:*")).toBe(true)
    expect(matchesCommandPattern("deploy", "deploy:*")).toBe(false)
  })

  it("matches suffix wildcard", () => {
    expect(matchesCommandPattern("deploy:admin", "*:admin")).toBe(true)
    expect(matchesCommandPattern("restart:admin", "*:admin")).toBe(true)
    expect(matchesCommandPattern("deploy:user", "*:admin")).toBe(false)
  })

  it("matches contains wildcard", () => {
    expect(matchesCommandPattern("deploy-production", "*deploy*")).toBe(true)
    expect(matchesCommandPattern("pre-deploy-post", "*deploy*")).toBe(true)
    expect(matchesCommandPattern("other", "*deploy*")).toBe(false)
  })

  it("does not match different commands", () => {
    expect(matchesCommandPattern("deploy", "delete")).toBe(false)
    expect(matchesCommandPattern("deploy:prod", "delete:prod")).toBe(false)
  })
})

describe("checkCommandPermission", () => {
  it("allows admin user regardless of rules", () => {
    const result = checkCommandPermission({
      command: "delete",
      userId: "admin123",
      allowCommands: ["status"],
      denyCommands: ["delete"],
      adminUserId: "admin123",
    })

    expect(result.allowed).toBe(true)
    expect(result.reason).toBe("Admin user")
  })

  it("denies command in deny list", () => {
    const result = checkCommandPermission({
      command: "delete",
      allowCommands: ["*"],
      denyCommands: ["delete", "drop"],
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe("Command is denied")
    expect(result.matchedPattern).toBe("delete")
  })

  it("allows command in allow list", () => {
    const result = checkCommandPermission({
      command: "deploy",
      allowCommands: ["deploy", "restart", "status"],
    })

    expect(result.allowed).toBe(true)
    expect(result.matchedPattern).toBe("deploy")
  })

  it("denies command not in allow list with default deny", () => {
    const result = checkCommandPermission({
      command: "delete",
      allowCommands: ["deploy", "restart"],
      defaultAction: "deny",
    })

    expect(result.allowed).toBe(false)
    expect(result.reason).toBe("Command not in allow list")
  })

  it("allows command with default allow when no rules match", () => {
    const result = checkCommandPermission({
      command: "unknown",
      allowCommands: ["deploy"],
      defaultAction: "allow",
    })

    expect(result.allowed).toBe(true)
    expect(result.reason).toBe("Default allow")
  })

  it("deny list takes precedence over allow list", () => {
    const result = checkCommandPermission({
      command: "delete",
      allowCommands: ["delete", "*"],
      denyCommands: ["delete"],
    })

    expect(result.allowed).toBe(false)
  })

  it("supports wildcard in allow list", () => {
    const result = checkCommandPermission({
      command: "anything",
      allowCommands: ["*"],
    })

    expect(result.allowed).toBe(true)
  })

  it("supports wildcard patterns in deny list", () => {
    const result = checkCommandPermission({
      command: "deploy:prod",
      allowCommands: ["*"],
      denyCommands: ["deploy:*"],
    })

    expect(result.allowed).toBe(false)
    expect(result.matchedPattern).toBe("deploy:*")
  })

  it("handles empty allowCommands with default deny", () => {
    const result = checkCommandPermission({
      command: "deploy",
      allowCommands: [],
      defaultAction: "deny",
    })

    expect(result.allowed).toBe(false)
  })

  it("handles undefined lists with default deny", () => {
    const result = checkCommandPermission({
      command: "deploy",
      defaultAction: "deny",
    })

    expect(result.allowed).toBe(false)
  })
})

describe("createCommandValidator", () => {
  it("creates validator with cached config", () => {
    const validator = createCommandValidator({
      allowCommands: ["deploy", "restart"],
      denyCommands: ["delete"],
      defaultAction: "deny",
    })

    expect(validator.check("deploy").allowed).toBe(true)
    expect(validator.check("delete").allowed).toBe(false)
    expect(validator.check("unknown").allowed).toBe(false)
  })

  it("require throws on denied command", () => {
    const validator = createCommandValidator({
      allowCommands: ["deploy"],
      defaultAction: "deny",
    })

    expect(() => validator.require("deploy")).not.toThrow()
    expect(() => validator.require("delete")).toThrow(CommandDeniedError)
  })

  it("require includes reason in error message", () => {
    const validator = createCommandValidator({
      allowCommands: ["deploy"],
      defaultAction: "deny",
    })

    try {
      validator.require("delete")
      expect.fail("Should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(CommandDeniedError)
      expect(err.message).toContain("Command denied")
    }
  })

  it("getAllowCommands returns configured list", () => {
    const validator = createCommandValidator({
      allowCommands: ["deploy", "restart"],
    })

    expect(validator.getAllowCommands()).toEqual(["deploy", "restart"])
  })

  it("getDenyCommands returns configured list", () => {
    const validator = createCommandValidator({
      denyCommands: ["delete", "drop"],
    })

    expect(validator.getDenyCommands()).toEqual(["delete", "drop"])
  })
})

describe("CommandDeniedError", () => {
  it("creates error with command and reason", () => {
    const error = new CommandDeniedError("delete", "Command is denied")

    expect(error.name).toBe("CommandDeniedError")
    expect(error.command).toBe("delete")
    expect(error.reason).toBe("Command is denied")
    expect(error.message).toBe("Command denied: delete (Command is denied)")
  })

  it("creates error without reason", () => {
    const error = new CommandDeniedError("delete")

    expect(error.name).toBe("CommandDeniedError")
    expect(error.command).toBe("delete")
    expect(error.reason).toBeUndefined()
    expect(error.message).toBe("Command denied: delete")
  })
})

describe("verifyCommandSignature", () => {
  it("verifies valid signature", async () => {
    const secret = "test-secret-key"
    const command = "deploy production"

    const { signature, timestamp } = await generateCommandSignature(command, secret)

    const isValid = await verifyCommandSignature({
      command,
      signature,
      secret,
      timestamp,
    })

    expect(isValid).toBe(true)
  })

  it("rejects invalid signature", async () => {
    const isValid = await verifyCommandSignature({
      command: "deploy",
      signature: "invalid-signature",
      secret: "test-secret",
    })

    expect(isValid).toBe(false)
  })

  it("rejects signature with wrong secret", async () => {
    const secret = "correct-secret"
    const command = "deploy"

    const { signature, timestamp } = await generateCommandSignature(command, secret)

    const isValid = await verifyCommandSignature({
      command,
      signature,
      secret: "wrong-secret",
      timestamp,
    })

    expect(isValid).toBe(false)
  })

  it("rejects expired timestamp", async () => {
    const secret = "test-secret"
    const command = "deploy"

    const { signature, timestamp } = await generateCommandSignature(command, secret)

    // Use old timestamp (1 hour ago)
    const oldTimestamp = Date.now() - 60 * 60 * 1000

    const isValid = await verifyCommandSignature({
      command,
      signature,
      secret,
      timestamp: oldTimestamp,
      timestampTolerance: 5 * 60 * 1000, // 5 minutes
    })

    expect(isValid).toBe(false)
  })

  it("accepts timestamp within tolerance", async () => {
    const secret = "test-secret"
    const command = "deploy"

    const { signature, timestamp } = await generateCommandSignature(command, secret)

    const isValid = await verifyCommandSignature({
      command,
      signature,
      secret,
      timestamp,
      timestampTolerance: 5 * 60 * 1000,
    })

    expect(isValid).toBe(true)
  })

  it("returns false on invalid input", async () => {
    const isValid = await verifyCommandSignature({
      command: "",
      signature: "",
      secret: "",
    })

    expect(isValid).toBe(false)
  })
})

describe("generateCommandSignature", () => {
  it("generates signature with timestamp", async () => {
    const { signature, timestamp } = await generateCommandSignature(
      "deploy production",
      "test-secret",
    )

    expect(signature).toMatch(/^[0-9a-f]{64}$/) // SHA-256 hex = 64 chars
    expect(timestamp).toBeDefined()
    expect(typeof timestamp).toBe("number")
  })

  it("generates signature without timestamp", async () => {
    const { signature, timestamp } = await generateCommandSignature(
      "deploy",
      "test-secret",
      false,
    )

    expect(signature).toMatch(/^[0-9a-f]{64}$/)
    expect(timestamp).toBeUndefined()
  })

  it("generates consistent signatures for same input", async () => {
    const result1 = await generateCommandSignature("deploy", "secret", false)
    const result2 = await generateCommandSignature("deploy", "secret", false)

    expect(result1.signature).toBe(result2.signature)
  })

  it("generates different signatures for different timestamps", async () => {
    const result1 = await generateCommandSignature("deploy", "secret", true)
    // Small delay to ensure different timestamp
    await new Promise((resolve) => setTimeout(resolve, 10))
    const result2 = await generateCommandSignature("deploy", "secret", true)

    expect(result1.signature).not.toBe(result2.signature)
  })
})

describe("parseCommand", () => {
  it("parses simple command", () => {
    const result = parseCommand("deploy")

    expect(result.name).toBe("deploy")
    expect(result.args).toEqual([])
    expect(result.flags).toEqual({})
    expect(result.full).toBe("deploy")
  })

  it("parses command with arguments", () => {
    const result = parseCommand("deploy production us-east-1")

    expect(result.name).toBe("deploy")
    expect(result.args).toEqual(["production", "us-east-1"])
    expect(result.flags).toEqual({})
  })

  it("parses command with long flags", () => {
    const result = parseCommand("deploy --force --verbose")

    expect(result.name).toBe("deploy")
    expect(result.args).toEqual([])
    expect(result.flags).toEqual({
      force: true,
      verbose: true,
    })
  })

  it("parses command with key=value flags", () => {
    const result = parseCommand("deploy --env=production --region=us-east-1")

    expect(result.name).toBe("deploy")
    expect(result.args).toEqual([])
    expect(result.flags).toEqual({
      env: "production",
      region: "us-east-1",
    })
  })

  it("parses command with short flags", () => {
    const result = parseCommand("deploy -v -f")

    expect(result.name).toBe("deploy")
    expect(result.args).toEqual([])
    expect(result.flags).toEqual({
      v: true,
      f: true,
    })
  })

  it("parses command with mixed args and flags", () => {
    const result = parseCommand("deploy production --force --env=prod -v")

    expect(result.name).toBe("deploy")
    expect(result.args).toEqual(["production"])
    expect(result.flags).toEqual({
      force: true,
      env: "prod",
      v: true,
    })
  })

  it("handles extra whitespace", () => {
    const result = parseCommand("  deploy   production   --force  ")

    expect(result.name).toBe("deploy")
    expect(result.args).toEqual(["production"])
    expect(result.flags).toEqual({ force: true })
    expect(result.full).toBe("deploy production --force")
  })

  it("handles empty command", () => {
    const result = parseCommand("")

    expect(result.name).toBe("")
    expect(result.args).toEqual([])
    expect(result.flags).toEqual({})
    expect(result.full).toBe("")
  })

  it("handles flags with special characters in values", () => {
    const result = parseCommand("deploy --url=https://example.com:8080/path")

    expect(result.name).toBe("deploy")
    expect(result.flags).toEqual({
      url: "https://example.com:8080/path",
    })
  })
})
