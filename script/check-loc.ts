#!/usr/bin/env bun
/**
 * Check TypeScript file line counts.
 *
 * Reports files exceeding the maximum line count limit.
 * Used to enforce code organization and prevent overly large files.
 *
 * Usage:
 *   bun run script/check-loc.ts
 *   bun run script/check-loc.ts --max 500
 *
 * Exit codes:
 *   0 - All files under limit
 *   1 - One or more files exceed limit
 */

import { execSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"

type Args = {
  maxLines: number
}

function parseArgs(argv: string[]): Args {
  let maxLines = 700
  const maxIdx = argv.indexOf("--max")
  if (maxIdx !== -1 && argv[maxIdx + 1]) {
    const value = Number(argv[maxIdx + 1])
    if (!Number.isNaN(value) && value > 0) {
      maxLines = value
    }
  }
  return { maxLines }
}

function gitLsFiles(): string[] {
  try {
    const stdout = execSync("git ls-files --cached --others --exclude-standard", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    })
    return stdout.split("\n").map((l) => l.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function countLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, "utf8")
    return content.split("\n").length
  } catch {
    return 0
  }
}

async function main() {
  // Handle EPIPE for `... | head` safety
  process.stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") {
      process.exit(0)
    }
    throw error
  })

  const { maxLines } = parseArgs(process.argv.slice(2))

  const files = gitLsFiles()
    .filter((f) => existsSync(f))
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .filter((f) => !f.includes(".test.") && !f.includes(".spec."))
    .filter((f) => !f.includes("node_modules/") && !f.includes("migration/"))

  if (files.length === 0) {
    console.log("No TypeScript files found")
    return
  }

  const results = await Promise.all(
    files.map(async (f) => ({ file: f, lines: countLines(f) })),
  )

  const offenders = results
    .filter((r) => r.lines > maxLines)
    .sort((a, b) => b.lines - a.lines)

  if (offenders.length === 0) {
    console.log(`✓ All ${files.length} TypeScript files under ${maxLines} LOC`)
    return
  }

  console.log(`\n❌ ${offenders.length} files exceed ${maxLines} LOC limit:\n`)
  console.log("Lines\tFile")
  console.log("─".repeat(80))

  for (const o of offenders) {
    console.log(`${o.lines.toString().padStart(5)}\t${o.file}`)
  }

  console.log()
  process.exit(1)
}

main()
