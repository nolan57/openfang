import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Job, executeJob, executeDirect, getNextRunTime, validateCronExpression, describeSchedule } from "@/scheduler"
import type { CronSchedule, CronPayload, JobOptions } from "@/scheduler/types"
import { lazy } from "@/util/lazy"
import { Log } from "@/util/log"

const log = Log.create({ service: "server.routes.scheduler" })

// Schema definitions
const CronScheduleSchema = z.union([
  z.object({
    kind: z.literal("cron"),
    expr: z.string().describe("Cron expression"),
    tz: z.string().optional().describe("Timezone"),
  }),
  z.object({
    kind: z.literal("interval"),
    everyMs: z.number().describe("Interval in milliseconds"),
    anchorMs: z.number().optional().describe("Anchor time for alignment"),
  }),
  z.object({
    kind: z.literal("once"),
    atMs: z.number().describe("Execution timestamp in milliseconds"),
  }),
])

const CronPayloadSchema = z.object({
  kind: z.enum(["agentTurn", "systemEvent"]),
  message: z.string(),
  deliver: z.boolean().optional(),
  channel: z.string().optional(),
  to: z.string().optional(),
  model: z.string().optional(),
})

const JobOptionsSchema = z.object({
  deleteAfterRun: z.boolean().optional(),
  retry: z.boolean().optional(),
  maxRetries: z.number().optional(),
  timeoutMs: z.number().optional(),
  requiresApproval: z.boolean().optional(),
})

const CreateJobSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  schedule: CronScheduleSchema,
  payload: CronPayloadSchema,
  options: JobOptionsSchema.optional(),
  enabled: z.boolean().optional().default(true),
})

export const SchedulerRoutes = lazy(() =>
  new Hono()
    // List all jobs
    .get(
      "/",
      describeRoute({
        summary: "List scheduler jobs",
        description: "Get a list of all scheduled jobs",
        operationId: "scheduler.list",
        responses: {
          200: {
            description: "List of jobs",
            content: {
              "application/json": {
                schema: resolver(z.array(z.any())),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          enabled: z.coerce.boolean().optional(),
          limit: z.coerce.number().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const jobs = await Job.list(query)
        return c.json(jobs)
      },
    )

    // Create a new job
    .post(
      "/",
      describeRoute({
        summary: "Create scheduler job",
        description: "Create a new scheduled job",
        operationId: "scheduler.create",
        responses: {
          200: {
            description: "Created job",
            content: {
              "application/json": {
                schema: resolver(z.any()),
              },
            },
          },
        },
      }),
      validator("json", CreateJobSchema),
      async (c) => {
        const body = c.req.valid("json")

        // Validate cron expression if provided
        if (body.schedule.kind === "cron" && !validateCronExpression(body.schedule.expr)) {
          return c.json({ error: "Invalid cron expression" }, 400)
        }

        const job = await Job.create({
          name: body.name,
          description: body.description,
          schedule: body.schedule as CronSchedule,
          payload: body.payload as CronPayload,
          options: body.options as JobOptions | undefined,
          enabled: body.enabled,
        })

        log.info("job created via API", { id: job.id, name: job.name })
        return c.json(job)
      },
    )

    // Get a specific job
    .get(
      "/:id",
      describeRoute({
        summary: "Get scheduler job",
        description: "Get details of a specific scheduled job",
        operationId: "scheduler.get",
        responses: {
          200: {
            description: "Job details",
            content: {
              "application/json": {
                schema: resolver(z.any()),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          id: z.string(),
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        const job = await Job.get(id)
        if (!job) {
          return c.json({ error: "Job not found" }, 404)
        }
        return c.json(job)
      },
    )

    // Update a job
    .patch(
      "/:id",
      describeRoute({
        summary: "Update scheduler job",
        description: "Update a scheduled job",
        operationId: "scheduler.update",
        responses: {
          200: {
            description: "Updated job",
            content: {
              "application/json": {
                schema: resolver(z.any()),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          id: z.string(),
        }),
      ),
      validator(
        "json",
        z.object({
          name: z.string().optional(),
          description: z.string().optional(),
          schedule: CronScheduleSchema.optional(),
          payload: CronPayloadSchema.optional(),
          options: JobOptionsSchema.optional(),
          enabled: z.boolean().optional(),
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        const body = c.req.valid("json")

        // Validate cron expression if provided
        if (body.schedule?.kind === "cron" && !validateCronExpression(body.schedule.expr)) {
          return c.json({ error: "Invalid cron expression" }, 400)
        }

        const job = await Job.update(id, {
          name: body.name,
          description: body.description,
          schedule: body.schedule as CronSchedule | undefined,
          payload: body.payload as CronPayload | undefined,
          options: body.options as JobOptions | undefined,
          enabled: body.enabled,
        })

        if (!job) {
          return c.json({ error: "Job not found" }, 404)
        }

        log.info("job updated via API", { id: job.id })
        return c.json(job)
      },
    )

    // Delete a job
    .delete(
      "/:id",
      describeRoute({
        summary: "Delete scheduler job",
        description: "Delete a scheduled job",
        operationId: "scheduler.delete",
        responses: {
          200: {
            description: "Job deleted",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          id: z.string(),
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        await Job.remove(id)
        log.info("job deleted via API", { id })
        return c.json(true)
      },
    )

    // Enable a job
    .post(
      "/:id/enable",
      describeRoute({
        summary: "Enable scheduler job",
        description: "Enable a disabled job",
        operationId: "scheduler.enable",
        responses: {
          200: {
            description: "Enabled job",
            content: {
              "application/json": {
                schema: resolver(z.any()),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          id: z.string(),
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        const job = await Job.enable(id)
        if (!job) {
          return c.json({ error: "Job not found" }, 404)
        }
        log.info("job enabled via API", { id })
        return c.json(job)
      },
    )

    // Disable a job
    .post(
      "/:id/disable",
      describeRoute({
        summary: "Disable scheduler job",
        description: "Disable an enabled job",
        operationId: "scheduler.disable",
        responses: {
          200: {
            description: "Disabled job",
            content: {
              "application/json": {
                schema: resolver(z.any()),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          id: z.string(),
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        const job = await Job.disable(id)
        if (!job) {
          return c.json({ error: "Job not found" }, 404)
        }
        log.info("job disabled via API", { id })
        return c.json(job)
      },
    )

    // Manually trigger a job
    .post(
      "/:id/execute",
      describeRoute({
        summary: "Execute scheduler job",
        description: "Manually trigger a job execution",
        operationId: "scheduler.execute",
        responses: {
          200: {
            description: "Execution result",
            content: {
              "application/json": {
                schema: resolver(z.object({
                  status: z.enum(["success", "failed"]),
                  output: z.string().optional(),
                  error: z.string().optional(),
                  durationMs: z.number(),
                })),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          id: z.string(),
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        const result = await executeJob(id, { manual: true })
        log.info("job executed via API", { id, status: result.status })
        return c.json(result)
      },
    )

    // Get job executions
    .get(
      "/:id/executions",
      describeRoute({
        summary: "Get job executions",
        description: "Get execution history for a job",
        operationId: "scheduler.executions",
        responses: {
          200: {
            description: "List of executions",
            content: {
              "application/json": {
                schema: resolver(z.array(z.any())),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          id: z.string(),
        }),
      ),
      validator(
        "query",
        z.object({
          limit: z.coerce.number().optional().default(50),
        }),
      ),
      async (c) => {
        const { id } = c.req.valid("param")
        const { limit } = c.req.valid("query")
        const executions = await Job.getExecutions(id, limit)
        return c.json(executions)
      },
    )

    // Get execution logs
    .get(
      "/execution/:executionId/logs",
      describeRoute({
        summary: "Get execution logs",
        description: "Get logs for a specific execution",
        operationId: "scheduler.execution.logs",
        responses: {
          200: {
            description: "List of log entries",
            content: {
              "application/json": {
                schema: resolver(z.array(z.any())),
              },
            },
          },
        },
      }),
      validator(
        "param",
        z.object({
          executionId: z.string(),
        }),
      ),
      validator(
        "query",
        z.object({
          limit: z.coerce.number().optional(),
          offset: z.coerce.number().optional(),
        }),
      ),
      async (c) => {
        const { executionId } = c.req.valid("param")
        const query = c.req.valid("query")
        const logs = await Job.getLogs(executionId, query)
        return c.json(logs)
      },
    )

    // Get schedule info
    .post(
      "/describe",
      describeRoute({
        summary: "Describe schedule",
        description: "Get a human-readable description of a schedule and next run times",
        operationId: "scheduler.describe",
        responses: {
          200: {
            description: "Schedule description",
            content: {
              "application/json": {
                schema: resolver(z.object({
                  description: z.string(),
                  nextRuns: z.array(z.number()),
                })),
              },
            },
          },
        },
      }),
      validator("json", CronScheduleSchema),
      async (c) => {
        const schedule = c.req.valid("json") as CronSchedule
        const description = describeSchedule(schedule)

        // Calculate next 5 run times
        const nextRuns: number[] = []
        let current = Date.now()
        for (let i = 0; i < 5; i++) {
          const next = getNextRunTime(schedule, current)
          if (next === undefined) break
          nextRuns.push(next)
          current = next + 1
        }

        return c.json({ description, nextRuns })
      },
    )

    // Direct execute endpoint for external schedulers (e.g., mcp-cron)
    // This allows executing tasks without pre-creating a job
    .post(
      "/execute",
      describeRoute({
        summary: "Execute task directly",
        description: "Execute a task directly without creating a job. Used by external schedulers like mcp-cron.",
        operationId: "scheduler.executeDirect",
        responses: {
          200: {
            description: "Execution result",
            content: {
              "application/json": {
                schema: resolver(z.object({
                  status: z.enum(["success", "failed"]),
                  output: z.string().optional(),
                  error: z.string().optional(),
                  durationMs: z.number(),
                })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          payload: CronPayloadSchema,
          options: JobOptionsSchema.optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")

        const result = await executeDirect(
          body.payload as CronPayload,
          body.options as JobOptions | undefined
        )

        log.info("direct execution completed", {
          kind: body.payload.kind,
          status: result.status,
          durationMs: result.durationMs
        })

        return c.json(result)
      },
    ),
)
