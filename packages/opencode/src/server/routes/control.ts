import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { resolver, validator } from "hono-openapi"
import { errors } from "../../server/error"
import z from "zod"
import { Installation } from "../../installation"
import { Log } from "../../util/log"
import { getController } from "../../zeroclaw/controller"

const log = Log.create({ service: "control" })

export function ControlRoutes() {
  const app = new Hono()

  app.use("*", async (c, next) => {
    const token = c.req.header("X-ZeroClaw-Token")
    const expectedToken = process.env.OPENCODE_CONTROL_TOKEN

    if (!expectedToken) {
      return c.json({ error: "Control token not configured" }, 503)
    }

    if (token !== expectedToken) {
      return c.json({ error: "Invalid token" }, 401)
    }

    await next()
  })

  app.get(
    "/status",
    describeRoute({
      summary: "Get OpenCode status",
      description: "Get current status of OpenCode",
      operationId: "control.status",
      responses: {
        200: {
          description: "OpenCode status",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  status: z.string(),
                  version: z.string(),
                  uptime: z.number(),
                  sessionCount: z.number(),
                }),
              ),
            },
          },
        },
        ...errors(401, 503),
      },
    }),
    async (c) => {
      return c.json({
        status: "running",
        version: Installation.VERSION,
        uptime: process.uptime(),
        sessionCount: 0,
      })
    },
  )

  app.post(
    "/zeroclaw/update",
    describeRoute({
      summary: "Update ZeroClaw",
      description: "Update ZeroClaw to a specific version",
      operationId: "control.zeroclaw.update",
      responses: {
        200: {
          description: "Update result",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  success: z.boolean(),
                  version: z.string().optional(),
                  target: z.string(),
                  error: z.string().optional(),
                }),
              ),
            },
          },
        },
        ...errors(401, 503),
      },
    }),
    validator(
      "json",
      z.object({
        target: z.union([z.literal("local"), z.string()]).default("local"),
        version: z.string().optional(),
        channel: z.enum(["stable", "beta", "nightly"]).optional(),
      }),
    ),
    async (c) => {
      const { target, version, channel } = c.req.valid("json")
      const controller = getController()
      const result = await controller.update(target, { version, channel })
      return c.json(result)
    },
  )

  app.post(
    "/zeroclaw/restart",
    describeRoute({
      summary: "Restart ZeroClaw",
      description: "Restart ZeroClaw service",
      operationId: "control.zeroclaw.restart",
      responses: {
        200: {
          description: "Restart result",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  success: z.boolean(),
                  target: z.string(),
                  error: z.string().optional(),
                }),
              ),
            },
          },
        },
        ...errors(401, 503),
      },
    }),
    validator(
      "json",
      z.object({
        target: z.union([z.literal("local"), z.string()]).default("local"),
      }),
    ),
    async (c) => {
      const { target } = c.req.valid("json")
      const controller = getController()
      const result = await controller.restart(target)
      return c.json(result)
    },
  )

  app.get(
    "/zeroclaw/status",
    describeRoute({
      summary: "Get ZeroClaw status",
      description: "Get current status of ZeroClaw",
      operationId: "control.zeroclaw.status",
      responses: {
        200: {
          description: "ZeroClaw status",
          content: {
            "application/json": {
              schema: resolver(
                z.object({
                  status: z.string(),
                  version: z.string(),
                  uptime: z.number(),
                  memory: z.string(),
                  tools: z.array(z.string()),
                }),
              ),
            },
          },
        },
        ...errors(401, 503),
      },
    }),
    async (c) => {
      const controller = getController()
      try {
        const status = await controller.getStatus()
        return c.json(status)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return c.json({ error: message }, 500)
      }
    },
  )

  return app
}
