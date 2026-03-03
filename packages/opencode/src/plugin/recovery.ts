import { Log } from "../util/log"

const log = Log.create({ service: "plugin-recovery" })

interface PluginRecoveryState {
  lastCheck: number
  restartCount: number
  lastRestartTime: number
  backoffUntil: number
}

const state = new Map<string, PluginRecoveryState>()
const defaultConfig = {
  interval: 30000,
  maxPerHour: 10,
  maxBackoff: 600000,
}

let timer: Timer | null = null
let config = defaultConfig

export namespace PluginRecovery {
  export async function start(
    plugins: Array<{ name: string; restart?: () => Promise<{ success: boolean; error?: string }> }>,
  ) {
    if (timer) return

    timer = setInterval(async () => {
      for (const plugin of plugins) {
        await checkAndRecover(plugin)
      }
    }, config.interval)

    log.info("started", { interval: config.interval })
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

    if (s && s.restartCount >= config.maxPerHour) {
      log.warn("max-restarts-reached", { plugin: pluginName, count: s.restartCount })
      return { success: false, error: "max restarts per hour reached" }
    }

    if (s && s.backoffUntil > now) {
      log.info("in-backoff", { plugin: pluginName, until: s.backoffUntil - now })
      return { success: false, error: "in backoff period" }
    }

    const result = await restartFn()

    if (result.success) {
      state.set(pluginName, {
        lastCheck: now,
        restartCount: s ? s.restartCount + 1 : 1,
        lastRestartTime: now,
        backoffUntil: 0,
      })
      log.info("restart-success", { plugin: pluginName })
    } else {
      const backoff = Math.min(config.maxBackoff, (s?.restartCount ?? 0) * 60000)
      state.set(pluginName, {
        ...(s ?? { lastCheck: now, restartCount: 0, lastRestartTime: 0 }),
        backoffUntil: now + backoff,
      })
      log.error("restart-failed", { plugin: pluginName, error: result.error })
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
    if (!plugin.restart) return

    const s = state.get(plugin.name)
    const now = Date.now()

    if (s?.backoffUntil && s.backoffUntil > now) {
      return
    }

    await restart(plugin.name, plugin.restart)
  }
}
