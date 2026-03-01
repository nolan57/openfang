import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"

export const SchedulerJobStarted = BusEvent.define(
  "tui.scheduler.job.started",
  z.object({
    id: z.string(),
    name: z.string().optional(),
  }),
)

export const SchedulerJobCompleted = BusEvent.define(
  "tui.scheduler.job.completed",
  z.object({
    id: z.string(),
    name: z.string().optional(),
  }),
)

export const SchedulerJobFailed = BusEvent.define(
  "tui.scheduler.job.failed",
  z.object({
    id: z.string(),
    name: z.string().optional(),
    error: z.string().optional(),
  }),
)

export const TuiEvent = {
  SchedulerJobStarted,
  SchedulerJobCompleted,
  SchedulerJobFailed,
  PluginStatus: BusEvent.define(
    "tui.plugin.status",
    z.object({
      plugin: z.string(),
      status: z.enum(["connected", "disconnected", "connecting", "error", "disabled", "pending"]),
      log: z
        .object({
          type: z.enum(["info", "message", "warning", "error", "status", "execution"]),
          message: z.string(),
        })
        .optional(),
      error: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  PromptAppend: BusEvent.define("tui.prompt.append", z.object({ text: z.string() })),
  CommandExecute: BusEvent.define(
    "tui.command.execute",
    z.object({
      command: z.union([
        z.enum([
          "session.list",
          "session.new",
          "session.share",
          "session.interrupt",
          "session.compact",
          "session.page.up",
          "session.page.down",
          "session.line.up",
          "session.line.down",
          "session.half.page.up",
          "session.half.page.down",
          "session.first",
          "session.last",
          "prompt.clear",
          "prompt.submit",
          "agent.cycle",
        ]),
        z.string(),
      ]),
    }),
  ),
  ToastShow: BusEvent.define(
    "tui.toast.show",
    z.object({
      title: z.string().optional(),
      message: z.string(),
      variant: z.enum(["info", "success", "warning", "error"]),
      duration: z.number().default(5000).optional().describe("Duration in milliseconds"),
    }),
  ),
  SessionSelect: BusEvent.define(
    "tui.session.select",
    z.object({
      sessionID: z.string().regex(/^ses/).describe("Session ID to navigate to"),
    }),
  ),
  Log: BusEvent.define(
    "tui.log",
    z.object({
      source: z.string(),
      level: z.enum(["info", "warning", "error"]),
      message: z.string(),
    }),
  ),
  MemoryConfirm: BusEvent.define(
    "tui.memory.confirm",
    z.object({
      sessionID: z.string(),
      memories: z.array(
        z.object({
          key: z.string(),
          value: z.string(),
          context: z.string().optional(),
        }),
      ),
    }),
  ),
  SessionExiting: BusEvent.define(
    "tui.session.exiting",
    z.object({
      sessionID: z.string(),
      reason: z.enum(["new_session", "switch_session", "session_end"]),
    }),
  ),
}
