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
    log.info("opening database", { path: path.join(Global.Path.data, "opencode.db") })

    const sqlite = new BunDatabase(path.join(Global.Path.data, "opencode.db"), { create: true })

    sqlite.run("PRAGMA journal_mode = WAL")
    sqlite.run("PRAGMA synchronous = NORMAL")
    sqlite.run("PRAGMA busy_timeout = 5000")
    sqlite.run("PRAGMA cache_size = -64000")
    sqlite.run("PRAGMA foreign_keys = ON")
    sqlite.run("PRAGMA wal_checkpoint(PASSIVE)")

    // Load sqlite-vec extension for vector search
    // Use Bun's native loadExtension API with the binary file path
    try {
      const platform = process.platform
      let vecFileName: string

      if (platform === "darwin") {
        vecFileName = "libsqlite_vec.dylib"
      } else if (platform === "linux") {
        vecFileName = "libsqlite_vec.so"
      } else if (platform === "win32") {
        vecFileName = "sqlite_vec.dll"
      } else {
        throw new Error(`Unsupported platform: ${platform}`)
      }

      // Try multiple possible paths for sqlite-vec binary
      const possiblePaths = [
        path.join(import.meta.dirname, "../../node_modules/sqlite-vec/dist", vecFileName),
        path.join(
          import.meta.dirname,
          "../../node_modules/.pnpm/sqlite-vec@0.1.7-alpha.2/node_modules/sqlite-vec/dist",
          vecFileName,
        ),
        path.join(process.cwd(), "node_modules/sqlite-vec/dist", vecFileName),
      ]

      let loaded = false
      for (const vecPath of possiblePaths) {
        if (existsSync(vecPath)) {
          log.info("loading sqlite-vec extension", { path: vecPath })
          sqlite.loadExtension(vecPath)
          loaded = true
          break
        }
      }

      if (!loaded) {
        log.warn("sqlite-vec binary not found, trying JS fallback")
        // Fallback to JS wrapper (may not work in Bun)
        const { load } = await import("sqlite-vec")
        load(sqlite)
      }
    } catch (error) {
      log.warn("failed to load sqlite-vec extension", { error: error instanceof Error ? error.message : String(error) })
    }

    const db = drizzle({ client: sqlite, schema })

    // Apply schema migrations
    const entries =
      typeof OPENCODE_MIGRATIONS !== "undefined"
        ? OPENCODE_MIGRATIONS
        : migrations(path.join(import.meta.dirname, "../../migration"))
    if (entries.length > 0) {
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
