import { Log } from "../util/log"

const log = Log.create({ service: "plugin-recovery" })

interface PluginRecoveryState {
  lastCheck: number
  restartCount: number
  lastRestartTime: number
  backoffUntil: number
  exhausted: boolean
  lastError?: string
}

const state = new Map<string, PluginRecoveryState>()
const defaultConfig = {
  interval: 30000,
  maxPerHour: 10,
  maxBackoff: 600000,
}

let timer: Timer | null = null
let config = defaultConfig
let pluginList: Array<{ name: string; restart?: () => Promise<{ success: boolean; error?: string }> }> = []

export namespace PluginRecovery {
  export async function start(
    plugins: Array<{ name: string; restart?: () => Promise<{ success: boolean; error?: string }> }>,
  ) {
    if (timer) return

    pluginList = plugins
    log.info("starting-plugin-recovery", {
      totalPlugins: plugins.length,
      plugins: plugins.map((p) => ({ name: p.name, hasRestart: !!p.restart })),
    })

    timer = setInterval(async () => {
      for (const plugin of plugins) {
        await checkAndRecover(plugin)
      }
    }, config.interval)

    log.info("started", { interval: config.interval, pluginCount: plugins.length })
  }

  export async function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    log.info("stopped")
  }

  export async function restart(pluginName: string, restartFn: () => Promise<{ success: boolean; error?: string }>) {
    const now = Date.now()
    const s = state.get(pluginName)

    if (s?.exhausted) {
      return { success: false, error: "plugin exhausted, max restarts reached" }
    }

    if (s && s.restartCount >= config.maxPerHour) {
      log.warn("max-restarts-reached", {
        plugin: pluginName,
        count: s.restartCount,
        lastError: s.lastError,
        pluginList: pluginList.map((p) => p.name),
      })
      state.set(pluginName, { ...s, exhausted: true })
      return { success: false, error: "max restarts per hour reached" }
    }

    if (s && s.backoffUntil > now) {
      log.debug("in-backoff", { plugin: pluginName, until: s.backoffUntil - now })
      return { success: false, error: "in backoff period" }
    }

    log.info("attempting-restart", { plugin: pluginName })

    const result = await restartFn()

    if (result.success) {
      state.set(pluginName, {
        lastCheck: now,
        restartCount: s ? s.restartCount + 1 : 1,
        lastRestartTime: now,
        backoffUntil: 0,
        exhausted: false,
      })
      log.info("restart-success", { plugin: pluginName })
    } else {
      const newCount = s ? s.restartCount + 1 : 1
      const backoff = Math.min(config.maxBackoff, (s?.restartCount ?? 0) * 60000)
      state.set(pluginName, {
        lastCheck: now,
        restartCount: newCount,
        lastRestartTime: now,
        backoffUntil: now + backoff,
        exhausted: newCount >= config.maxPerHour,
        lastError: result.error,
      })
      log.error("restart-failed", {
        plugin: pluginName,
        error: result.error,
        restartCount: newCount,
        maxPerHour: config.maxPerHour,
        exhausted: newCount >= config.maxPerHour,
      })
    }

    return result
  }

  export function setConfig(c: Partial<typeof defaultConfig>) {
    config = { ...config, ...c }
  }

  async function checkAndRecover(plugin: {
    name: string
    restart?: () => Promise<{ success: boolean; error?: string }>
  }) {
    if (!plugin.restart) {
      log.debug("skipping-plugin-no-restart", { plugin: plugin.name })
      return
    }

    const s = state.get(plugin.name)

    if (s?.exhausted) {
      log.debug("skipping-exhausted-plugin", { plugin: plugin.name })
      return
    }

    if (s?.backoffUntil && s.backoffUntil > Date.now()) {
      return
    }

    await restart(plugin.name, plugin.restart)
  }
}
