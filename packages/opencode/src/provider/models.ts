import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import z from "zod"
import { Installation } from "../installation"
import { Flag } from "../flag/flag"
import { lazy } from "@/util/lazy"
import { Filesystem } from "../util/filesystem"

// Try to import bundled snapshot (generated at build time)
// Falls back to undefined in dev mode when snapshot doesn't exist
/* @ts-ignore */

export namespace ModelsDev {
  const log = Log.create({ service: "models.dev" })
  const filepath = path.join(Global.Path.cache, "models.json")

  export const Model = z.object({
    id: z.string(),
    name: z.string(),
    family: z.string().optional(),
    release_date: z.string(),
    attachment: z.boolean(),
    reasoning: z.boolean(),
    temperature: z.boolean(),
    tool_call: z.boolean(),
    interleaved: z
      .union([
        z.literal(true),
        z
          .object({
            field: z.enum(["reasoning_content", "reasoning_details"]),
          })
          .strict(),
      ])
      .optional(),
    cost: z
      .object({
        input: z.number(),
        output: z.number(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
        context_over_200k: z
          .object({
            input: z.number(),
            output: z.number(),
            cache_read: z.number().optional(),
            cache_write: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    limit: z.object({
      context: z.number(),
      input: z.number().optional(),
      output: z.number(),
    }),
    modalities: z
      .object({
        input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
        output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
      })
      .optional(),
    experimental: z.boolean().optional(),
    status: z.enum(["alpha", "beta", "deprecated"]).optional(),
    options: z.record(z.string(), z.any()),
    headers: z.record(z.string(), z.string()).optional(),
    provider: z.object({ npm: z.string().optional(), api: z.string().optional() }).optional(),
    variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  })
  export type Model = z.infer<typeof Model>

  export const Provider = z.object({
    api: z.string().optional(),
    name: z.string(),
    env: z.array(z.string()),
    id: z.string(),
    npm: z.string().optional(),
    models: z.record(z.string(), Model),
  })

  export type Provider = z.infer<typeof Provider>

  function url() {
    return Flag.OPENCODE_MODELS_URL || "https://models.dev"
  }

  export const Data = lazy(async () => {
    log.info("Data_loading_started", { stage: "begin" })
    
    // Step 1: Try to read from cache file
    log.info("Data_trying_cache", { filepath: Flag.OPENCODE_MODELS_PATH ?? filepath })
    const result = await Filesystem.readJson(Flag.OPENCODE_MODELS_PATH ?? filepath).catch(() => {})
    if (result) {
      log.info("Data_loaded_from_cache", { stage: "cache_success" })
      return result
    }
    log.info("Data_cache_miss", { stage: "cache_failed" })
    
    // Step 2: Try to load bundled snapshot
    log.info("Data_trying_snapshot", { stage: "snapshot_start" })
    // @ts-ignore
    const snapshot = await import("./models-snapshot")
      .then((m) => m.snapshot as Record<string, unknown>)
      .catch(() => undefined)
    if (snapshot) {
      log.info("Data_loaded_from_snapshot", { stage: "snapshot_success" })
      return snapshot
    }
    log.info("Data_snapshot_miss", { stage: "snapshot_failed" })
    
    // Step 3: Check if fetch is disabled
    if (Flag.OPENCODE_DISABLE_MODELS_FETCH) {
      log.info("Data_fetch_disabled", { stage: "fetch_disabled" })
      return {}
    }
    
    // Step 4: Fetch from remote - THIS IS THE POTENTIAL HANG POINT
    const fetchUrl = `${url()}/api.json`
    log.info("Data_fetching_remote", { stage: "fetch_start", url: fetchUrl })
    console.log("[DEBUG] ModelsDev: Starting fetch to", fetchUrl)
    
    const fetchStartTime = Date.now()
    try {
      const json = await fetch(fetchUrl).then((x) => x.text())
      const fetchDuration = Date.now() - fetchStartTime
      log.info("Data_fetch_complete", { stage: "fetch_success", duration_ms: fetchDuration })
      console.log("[DEBUG] ModelsDev: Fetch completed in", fetchDuration, "ms")
      return JSON.parse(json)
    } catch (error) {
      const fetchDuration = Date.now() - fetchStartTime
      log.error("Data_fetch_failed", { stage: "fetch_error", duration_ms: fetchDuration, error: String(error) })
      console.log("[DEBUG] ModelsDev: Fetch failed after", fetchDuration, "ms:", error)
      throw error
    }
  })

  export async function get() {
    const result = await Data()
    return result as Record<string, Provider>
  }

  export async function refresh() {
    const result = await fetch(`${url()}/api.json`, {
      headers: {
        "User-Agent": Installation.USER_AGENT,
      },
      signal: AbortSignal.timeout(10 * 1000),
    }).catch((e) => {
      log.error("Failed to fetch models.dev", {
        error: e,
      })
    })
    if (result && result.ok) {
      await Filesystem.write(filepath, await result.text())
      ModelsDev.Data.reset()
    }
  }
}

if (!Flag.OPENCODE_DISABLE_MODELS_FETCH && !process.argv.includes("--get-yargs-completions")) {
  ModelsDev.refresh()
  setInterval(
    async () => {
      await ModelsDev.refresh()
    },
    60 * 1000 * 60,
  ).unref()
}
