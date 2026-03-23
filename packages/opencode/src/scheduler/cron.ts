import { CronExpressionParser, CronExpression, CronDate } from "cron-parser"
import { Log } from "../util/log"
import type { CronSchedule } from "./types"

const log = Log.create({ service: "scheduler.cron" })

/**
 * Parse a cron expression and get the next run time
 */
export function getNextRunTime(schedule: CronSchedule, from?: number): number | undefined {
  const now = from ?? Date.now()

  try {
    switch (schedule.kind) {
      case "cron": {
        const options: any = {
          currentDate: new CronDate(new Date(now)),
        }
        if (schedule.tz) {
          options.tz = schedule.tz
        }

        const expression = CronExpressionParser.parse(schedule.expr, options)
        const next = expression.next()
        return next.getTime()
      }
      case "interval": {
        const anchor = schedule.anchorMs ?? now
        const elapsed = now - anchor
        const periods = Math.floor(elapsed / schedule.everyMs)
        return anchor + (periods + 1) * schedule.everyMs
      }
      case "once": {
        if (schedule.atMs > now) {
          return schedule.atMs
        }
        return undefined // Already passed
      }
    }
  } catch (error) {
    log.error("failed to parse schedule", { schedule, error })
    return undefined
  }
}

/**
 * Validate a cron expression
 */
export function validateCronExpression(expr: string): boolean {
  try {
    CronExpressionParser.parse(expr)
    return true
  } catch {
    return false
  }
}

/**
 * Get a human-readable description of a schedule
 */
export function describeSchedule(schedule: CronSchedule): string {
  switch (schedule.kind) {
    case "cron":
      return `Cron: ${schedule.expr}${schedule.tz ? ` (${schedule.tz})` : ""}`
    case "interval": {
      const ms = schedule.everyMs
      if (ms < 1000) return `Every ${ms}ms`
      if (ms < 60000) return `Every ${ms / 1000} seconds`
      if (ms < 3600000) return `Every ${ms / 60000} minutes`
      if (ms < 86400000) return `Every ${ms / 3600000} hours`
      return `Every ${ms / 86400000} days`
    }
    case "once":
      return `Once at ${new Date(schedule.atMs).toISOString()}`
  }
}