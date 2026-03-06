import { Database as BunDatabase } from "bun:sqlite"
import { drizzle, type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
export * from "drizzle-orm"
import { Context } from "../util/context"
import { lazy } from "../util/lazy"
import { Global } from "../global"
import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import path from "path"
import { readFileSync, readdirSync, existsSync } from "fs"
import * as schema from "./schema"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

export namespace Database {
  export const Path = path.join(Global.Path.data, "opencode.db")
  type Schema = typeof schema
  export type Transaction = SQLiteTransaction<"sync", void, Schema>

  type Client = SQLiteBunDatabase<Schema>

  type Journal = { sql: string; timestamp: number }[]

  function time(tag: string) {
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
    if (!match) return 0
    return Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    )
  }

  function migrations(dir: string): Journal {
    const dirs = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    const sql = dirs
      .map((name) => {
        const file = path.join(dir, name, "migration.sql")
        if (!existsSync(file)) return
        return {
          sql: readFileSync(file, "utf-8"),
          timestamp: time(name),
        }
      })
      .filter(Boolean) as Journal

    return sql.sort((a, b) => a.timestamp - b.timestamp)
  }

  export const Client = lazy(() => {
    console.error("[sqlite-vec] === Client lazy function START ===")

    const sqlite = new BunDatabase(path.join(Global.Path.data, "opencode.db"), { create: true })
    console.error("[sqlite-vec] Database opened")

    sqlite.run("PRAGMA journal_mode = WAL")
    console.error("[sqlite-vec] PRAGMA journal_mode = WAL done")

    // Load sqlite-vec extension EARLY, before any migrations
    // Use Bun's native loadExtension API with the binary file path
    try {
      const platform = process.platform
      const arch = process.arch
      let vecFileName: string
      let platformName: string

      if (platform === "darwin") {
        vecFileName = "vec0.dylib"
        platformName = "darwin"
      } else if (platform === "linux") {
        vecFileName = "vec0.so"
        platformName = "linux"
      } else if (platform === "win32") {
        vecFileName = "vec0.dll"
        platformName = "windows"
      } else {
        throw new Error(`Unsupported platform: ${platform}`)
      }

      // Construct package name for platform-specific binary
      const archSuffix = arch === "arm64" ? "-arm64" : "-x64"
      const platformPkg = `sqlite-vec-${platformName}${archSuffix}`

      // Use import.meta.dirname to find project root reliably
      // Go up from packages/opencode/src/storage/db.ts to project root (4 levels up)
      const projectRoot = path.resolve(import.meta.dirname, "../../../..")

      console.error(`[sqlite-vec] platform=${platform}, arch=${arch}, pkg=${platformPkg}, file=${vecFileName}`)
      console.error(`[sqlite-vec] projectRoot=${projectRoot}`)

      // Try multiple possible paths for sqlite-vec binary
      const possiblePaths = [
        // Bun cache path in project root
        path.join(
          projectRoot,
          "node_modules/.bun",
          `${platformPkg}@0.1.7-alpha.2/node_modules/${platformPkg}`,
          vecFileName,
        ),
        // Root node_modules
        path.join(projectRoot, "node_modules", platformPkg, vecFileName),
        // packages/opencode node_modules
        path.join(projectRoot, "packages/opencode/node_modules", platformPkg, vecFileName),
      ]

      console.error(`[sqlite-vec] checking paths:`)
      for (const p of possiblePaths) {
        console.error(`[sqlite-vec]   - ${p} (exists: ${existsSync(p)})`)
      }

      let loaded = false
      for (const vecPath of possiblePaths) {
        if (existsSync(vecPath)) {
          console.error(`[sqlite-vec] loading from: ${vecPath}`)
          sqlite.loadExtension(vecPath)
          console.error(`[sqlite-vec] loaded successfully!`)
          loaded = true
          break
        }
      }

      if (!loaded) {
        console.error(`[sqlite-vec] FAILED to find extension in any path!`)
        log.error("sqlite-vec binary not found in any expected location", { platform, arch, possiblePaths })
      }
    } catch (error) {
      console.error(`[sqlite-vec] ERROR: ${error instanceof Error ? error.message : String(error)}`)
      log.error("failed to load sqlite-vec extension", {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    const db = drizzle({ client: sqlite, schema })

    // Apply schema migrations
    const entries =
      typeof OPENCODE_MIGRATIONS !== "undefined"
        ? OPENCODE_MIGRATIONS
        : migrations(path.join(import.meta.dirname, "../../migration"))
    if (entries.length > 0) {
      console.error("[sqlite-vec] about to apply migrations, count:", entries.length)
      log.info("applying migrations", {
        count: entries.length,
        mode: typeof OPENCODE_MIGRATIONS !== "undefined" ? "bundled" : "dev",
      })
      migrate(db, entries)
    }

    return db
  })

  export function raw(): BunDatabase {
    return Client().$client
  }

  export type TxOrDb = Transaction | Client

  const ctx = Context.create<{
    tx: TxOrDb
    effects: (() => void | Promise<void>)[]
  }>("database")

  export function use<T>(callback: (trx: TxOrDb) => T): T {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
        for (const effect of effects) effect()
        return result
      }
      throw err
    }
  }

  export function effect(fn: () => any | Promise<any>) {
    try {
      ctx.use().effects.push(fn)
    } catch {
      fn()
    }
  }

  export function transaction<T>(callback: (tx: TxOrDb) => T): T {
    try {
      return callback(ctx.use().tx)
    } catch (err) {
      if (err instanceof Context.NotFound) {
        const effects: (() => void | Promise<void>)[] = []
        const result = Client().transaction((tx) => {
          return ctx.provide({ tx, effects }, () => callback(tx))
        })
        for (const effect of effects) effect()
        return result
      }
      throw err
    }
  }
}
