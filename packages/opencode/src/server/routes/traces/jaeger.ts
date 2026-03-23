import { Log } from "@/util/log"

const log = Log.create({ service: "traces.jaeger" })

const JAEGER_URL = process.env.JAEGER_URL || "http://localhost:16686"

export interface JaegerTrace {
  traceID: string
  spans: JaegerSpan[]
  processes: Record<string, JaegerProcess>
}

export interface JaegerSpan {
  spanID: string
  traceID: string
  operationName: string
  startTime: number
  duration: number
  statusCode: number
  tags: JaegerTag[]
  logs: JaegerLog[]
  references: JaegerReference[]
}

export interface JaegerProcess {
  serviceName: string
  tags: JaegerTag[]
}

export interface JaegerTag {
  key: string
  value: unknown
  type: string
}

export interface JaegerLog {
  timestamp: number
  fields: JaegerTag[]
}

export interface JaegerReference {
  refType: string
  spanID: string
  traceID: string
}

export interface JaegerService {
  name: string
  passedSpanCount: number
  errorSpanCount: number
}

export async function fetchJaegerTraces(params: {
  service?: string
  start?: number
  end?: number
  limit?: number
  operation?: string
  minDuration?: number
  maxDuration?: number
}): Promise<JaegerTrace[]> {
  const query = new URLSearchParams()

  if (params.service) query.set("service", params.service)
  if (params.start) query.set("start", String(params.start))
  if (params.end) query.set("end", String(params.end))
  if (params.limit) query.set("limit", String(params.limit))
  if (params.operation) query.set("operation", params.operation)
  if (params.minDuration) query.set("minDuration", String(params.minDuration))
  if (params.maxDuration) query.set("maxDuration", String(params.maxDuration))

  const url = `${JAEGER_URL}/api/traces?${query}`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Jaeger API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    return data.data || []
  } catch (error) {
    log.error("fetch_jaeger_traces_failed", { url, error: String(error) })
    throw error
  }
}

export async function fetchJaegerTrace(traceId: string): Promise<JaegerTrace | null> {
  const url = `${JAEGER_URL}/api/traces/${traceId}`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Jaeger API error: ${response.status}`)
    }

    const data = await response.json()
    return data.data?.[0] || null
  } catch (error) {
    log.error("fetch_jaeger_trace_failed", { traceId, error: String(error) })
    throw error
  }
}

export async function fetchJaegerServices(): Promise<string[]> {
  const url = `${JAEGER_URL}/api/services`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Jaeger API error: ${response.status}`)
    }

    const data = await response.json()
    return data.data || []
  } catch (error) {
    log.error("fetch_jaeger_services_failed", { error: String(error) })
    throw error
  }
}

export async function fetchJaegerStats(params: { service: string; start?: number; end?: number }): Promise<{
  services: JaegerService[]
  metrics: Record<string, unknown>
}> {
  const query = new URLSearchParams()
  query.set("service", params.service)
  if (params.start) query.set("start", String(params.start))
  if (params.end) query.set("end", String(params.end))

  const url = `${JAEGER_URL}/api/metrics?${query}`

  try {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Jaeger API error: ${response.status}`)
    }

    const data = await response.json()
    return data.data || { services: [], metrics: {} }
  } catch (error) {
    log.error("fetch_jaeger_stats_failed", { error: String(error) })
    throw error
  }
}
