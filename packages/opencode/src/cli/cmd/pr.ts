import { UI } from "../ui"
import { cmd } from "./cmd"
import { Instance } from "@/project/instance"
import { $ } from "bun"
import { spawn } from "child_process"
import path from "path"

/**
 * Get the command to run the current opencode instance.
 * This prevents infinite loops by using the actual binary path instead of
 * resolving "opencode" from PATH which might point to a wrapper script.
 *
 * Priority order:
 * 1. OPENCODE_BIN_PATH environment variable (authoritative source, aligns with JS launcher)
 * 2. Compiled binary detection (process.execPath not pointing to interpreter)
 * 3. Interpreter mode fallback (use same interpreter + entry script)
 *
 * Cross-platform: Works on Windows, Linux, and macOS by using path.basename
 * to detect interpreter executables regardless of path format.
 */
function getOpencodeCommand(): { cmd: string; args: string[] } {
  // 1. Priority: respect explicit environment variable configuration
  // This aligns with the JS launcher logic in bin/opencode
  if (process.env.OPENCODE_BIN_PATH) {
    return { cmd: process.env.OPENCODE_BIN_PATH, args: [] }
  }

  const execPath = process.execPath
  const entryScript = process.argv[1]

  // 2. Check if we're running a compiled binary (not bun/node interpreter)
  // Use path.basename for cross-platform executable name detection
  // This works correctly on Windows (C:\path\bun.exe), Linux (/usr/bin/bun), macOS
  const execName = path.basename(execPath).toLowerCase()
  // On Windows, remove .exe extension for comparison
  const execNameWithoutExt = execName.replace(/\.exe$/, "")
  const isInterpreter =
    execNameWithoutExt.includes("bun") ||
    execNameWithoutExt.includes("node") ||
    execNameWithoutExt.includes("deno")

  if (!isInterpreter) {
    return { cmd: execPath, args: [] }
  }

  // 3. Fallback: running via interpreter - use the same interpreter and script
  return { cmd: execPath, args: [entryScript] }
}

export const PrCommand = cmd({
  command: "pr <number>",
  describe: "fetch and checkout a GitHub PR branch, then run opencode",
  builder: (yargs) =>
    yargs.positional("number", {
      type: "number",
      describe: "PR number to checkout",
      demandOption: true,
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const project = Instance.project
        if (project.vcs !== "git") {
          UI.error("Could not find git repository. Please run this command from a git repository.")
          process.exit(1)
        }

        const prNumber = args.number
        const localBranchName = `pr/${prNumber}`
        UI.println(`Fetching and checking out PR #${prNumber}...`)

        // Use gh pr checkout with custom branch name
        const result = await $`gh pr checkout ${prNumber} --branch ${localBranchName} --force`.nothrow()

        if (result.exitCode !== 0) {
          const stderr = result.stderr.toString().trim()
          UI.error(`Failed to checkout PR #${prNumber}. Make sure you have gh CLI installed and authenticated.`)
          if (stderr) {
            UI.error(`gh error: ${stderr}`)
          }
          process.exit(1)
        }

        // Fetch PR info for fork handling and session link detection
        const prInfoResult =
          await $`gh pr view ${prNumber} --json headRepository,headRepositoryOwner,isCrossRepository,headRefName,body`.nothrow()

        if (prInfoResult.exitCode !== 0) {
          const stderr = prInfoResult.stderr.toString().trim()
          UI.println(`Warning: Could not fetch PR info (fork handling and session detection may be affected)`)
          if (stderr) {
            UI.println(`  gh error: ${stderr}`)
          }
        }

        let sessionId: string | undefined

        if (prInfoResult.exitCode === 0) {
          const prInfoText = prInfoResult.text()
          if (prInfoText.trim()) {
            // Parse PR info with error handling for malformed JSON
            let prInfo: {
              headRepository?: { name: string; nameWithOwner: string }
              headRepositoryOwner?: { login: string }
              isCrossRepository?: boolean
              headRefName?: string
              body?: string
            } | null = null
            try {
              prInfo = JSON.parse(prInfoText)
            } catch (parseError) {
              UI.error(`Failed to parse PR info: ${parseError instanceof Error ? parseError.message : String(parseError)}`)
            }

            // Handle fork PRs
            if (prInfo && prInfo.isCrossRepository && prInfo.headRepository && prInfo.headRepositoryOwner) {
              const forkOwner = prInfo.headRepositoryOwner.login
              const forkName = prInfo.headRepository.name
              const remoteName = forkOwner

              // Check if remote already exists
              const remotes = (await $`git remote`.nothrow().text()).trim()
              if (!remotes.split("\n").includes(remoteName)) {
                await $`git remote add ${remoteName} https://github.com/${forkOwner}/${forkName}.git`.nothrow()
                UI.println(`Added fork remote: ${remoteName}`)
              }

              // Set upstream to the fork so pushes go there
              const headRefName = prInfo.headRefName
              await $`git branch --set-upstream-to=${remoteName}/${headRefName} ${localBranchName}`.nothrow()
            }

            // Check for opencode session link in PR body
            if (prInfo && prInfo.body) {
              const sessionMatch = prInfo.body.match(/https:\/\/opncd\.ai\/s\/([a-zA-Z0-9_-]+)/)
              if (sessionMatch) {
                const sessionUrl = sessionMatch[0]
                UI.println(`Found opencode session: ${sessionUrl}`)
                UI.println(`Importing session...`)

                // Use the same opencode command for import to prevent PATH resolution issues
                const opencodeCmd = getOpencodeCommand()
                const importArgs = [...opencodeCmd.args, "import", sessionUrl]
                const importResult = await new Promise<{ exitCode: number; stdout: string }>((resolve) => {
                  const proc = spawn(opencodeCmd.cmd, importArgs, {
                    stdio: ["ignore", "pipe", "pipe"],
                  })
                  let stdout = ""
                  proc.stdout?.on("data", (chunk) => (stdout += chunk.toString()))
                  proc.on("close", (code) => resolve({ exitCode: code ?? 1, stdout }))
                })

                if (importResult.exitCode === 0) {
                  const importOutput = importResult.stdout.trim()
                  // Extract session ID from the output (format: "Imported session: <session-id>")
                  const sessionIdMatch = importOutput.match(/Imported session: ([a-zA-Z0-9_-]+)/)
                  if (sessionIdMatch) {
                    sessionId = sessionIdMatch[1]
                    UI.println(`Session imported: ${sessionId}`)
                  }
                }
              }
            }
          }
        }

        UI.println(`Successfully checked out PR #${prNumber} as branch '${localBranchName}'`)
        UI.println()
        UI.println("Starting opencode...")
        UI.println()

        // Launch opencode TUI with session ID if available
        // Use getOpencodeCommand() to prevent infinite loops
        const opencodeCmd = getOpencodeCommand()
        const opencodeArgs = [...opencodeCmd.args, ...(sessionId ? ["-s", sessionId] : [])]
        const opencodeProcess = spawn(opencodeCmd.cmd, opencodeArgs, {
          stdio: "inherit",
          cwd: process.cwd(),
        })

        await new Promise<void>((resolve, reject) => {
          opencodeProcess.on("exit", (code) => {
            if (code === 0) resolve()
            else reject(new Error(`opencode exited with code ${code}`))
          })
          opencodeProcess.on("error", reject)
        })
      },
    })
  },
})
