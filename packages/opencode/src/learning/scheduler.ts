import type { LearningConfig } from "./config"
import { Log } from "../util/log"

const log = Log.create({ service: "learning-scheduler" })

export class LearningScheduler {
  private config: LearningConfig

  constructor(config: LearningConfig) {
    this.config = config
  }

  async setup(): Promise<void> {
    if (!this.config.enabled) {
      log.info("learning disabled")
      return
    }

    if (this.config.schedule.cron) {
      log.info("cron learning configured", {
        cron: this.config.schedule.cron,
        topics: this.config.topics,
        sources: this.config.sources,
      })
      log.info("to enable scheduled learning, add mcp-cron to your config and configure cron:learn task")
    }

    if (this.config.schedule.idle_check) {
      log.info("idle check enabled", {
        thresholdMinutes: this.config.schedule.idle_threshold_minutes,
      })
    }
  }

  getNextScheduledTime(): Date | null {
    if (!this.config.schedule.cron) return null

    try {
      const [minute, hour, dayOfMonth, month, dayOfWeek] = this.config.schedule.cron.split(" ")
      const now = new Date()
      const next = new Date(now)

      // Simple next run estimation for cron "minute hour * * dayOfWeek"
      if (dayOfWeek !== "*") {
        const daysUntil = (parseInt(dayOfWeek) - now.getDay() + 7) % 7 || 7
        next.setDate(now.getDate() + daysUntil)
      }
      next.setHours(parseInt(hour) || 0, parseInt(minute) || 0, 0, 0)

      if (next <= now) {
        next.setDate(next.getDate() + 7)
      }

      return next
    } catch {
      return null
    }
  }
}
