import { generateText, type CoreMessage } from "ai"
import { Log } from "../util/log"
import { getNovelLanguageModel } from "./model"
import { withRetry, RetryConfig } from "./validation"

const log = Log.create({ service: "novel-llm" })

export interface LLMCallOptions {
  /** 提示词 */
  prompt: string
  /** 系统提示词（可选） */
  system?: string
  /** 温度（可选，默认 0.7） */
  temperature?: number
  /** 最大 token 数（可选） */
  maxTokens?: number
  /** 停止序列（可选） */
  stopSequences?: string[]
  /** 是否使用重试（默认 true） */
  useRetry?: boolean
  /** 重试配置（可选） */
  retryConfig?: RetryConfig
  /** 调用类型标签（用于 tracing） */
  callType?: string
  /** 额外元数据（用于 tracing） */
  metadata?: Record<string, unknown>
}

export interface LLMCallResult {
  /** 生成的文本 */
  text: string
  /** 使用的 token 数 */
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  }
  /** 调用耗时（毫秒） */
  duration: number
  /** 模型 ID */
  modelId: string
  /** 是否使用了重试 */
  usedRetry: boolean
}

export interface LLMJsonCallOptions<T = unknown> extends LLMCallOptions {
  /** JSON 响应的 schema 描述 */
  schemaDescription?: string
  /** JSON 响应的示例（可选） */
  schemaExample?: T
}

export interface LLMJsonCallResult<T = unknown> extends LLMCallResult {
  /** 解析后的 JSON 对象 */
  data: T
}

/**
 * 统一的 LLM 调用包装器
 *
 * 功能：
 * - 统一的模型获取
 * - 统一的错误处理
 * - 统一的重试机制
 * - 统一的 tracing/logging
 * - 统一的速率限制
 *
 * @param options - 调用选项
 * @returns LLM 调用结果
 */
export async function callLLM(options: LLMCallOptions): Promise<LLMCallResult> {
  const startTime = Date.now()
  const callType = options.callType || "unknown"
  const useRetry = options.useRetry ?? true

  log.info("llm_call_started", {
    callType,
    promptLength: options.prompt.length,
    hasSystem: !!options.system,
    temperature: options.temperature,
  })

  let languageModel: any
  try {
    languageModel = await getNovelLanguageModel()
  } catch (error) {
    log.error("llm_model_acquisition_failed", { error: String(error) })
    throw new Error(`Failed to acquire LLM model: ${error}`)
  }

  const callWithRetry = async () => {
    const callStartTime = Date.now()

    const generateOptions: any = {
      model: languageModel,
      prompt: options.prompt,
      temperature: options.temperature ?? 0.7,
    }

    if (options.system) {
      generateOptions.system = options.system
    }

    if (options.maxTokens) {
      generateOptions.maxTokens = options.maxTokens
    }

    if (options.stopSequences) {
      generateOptions.stopSequences = options.stopSequences
    }

    const result = await generateText(generateOptions)

    const callEndTime = Date.now()
    const callDuration = callEndTime - callStartTime

    log.info("llm_call_completed", {
      callType,
      duration: callDuration,
      textLength: result.text.length,
      usage: result.usage,
    })

    return {
      text: result.text,
      usage: result.usage,
      duration: callDuration,
      modelId: languageModel.modelId || "unknown",
      usedRetry: false,
    }
  }

  try {
    const result = useRetry ? await withRetry(callWithRetry, options.retryConfig) : await callWithRetry()

    const endTime = Date.now()
    const totalDuration = endTime - startTime

    log.info("llm_call_success", {
      callType,
      totalDuration,
      textLength: result.text.length,
      usedRetry: result.usedRetry,
    })

    return {
      ...result,
      duration: totalDuration,
    }
  } catch (error) {
    const endTime = Date.now()
    const totalDuration = endTime - startTime

    log.error("llm_call_failed", {
      callType,
      totalDuration,
      error: String(error),
      prompt: options.prompt.substring(0, 200),
    })

    throw new Error(`LLM call failed: ${error}`)
  }
}

/**
 * 统一的 LLM JSON 调用包装器
 *
 * 功能：
 * - 调用 callLLM
 * - 解析 JSON 响应
 * - 验证 JSON 格式
 *
 * @param options - JSON 调用选项
 * @returns 解析后的 JSON 结果
 */
export async function callLLMJson<T = unknown>(options: LLMJsonCallOptions<T>): Promise<LLMJsonCallResult<T>> {
  const systemPrompt = options.system
    ? `${options.system}\n\nIMPORTANT: Respond with valid JSON only. Do not include any other text.`
    : "IMPORTANT: Respond with valid JSON only. Do not include any other text."

  const promptWithSchema = options.schemaDescription
    ? `${options.prompt}\n\nOutput format:\n${options.schemaDescription}`
    : options.prompt

  const result = await callLLM({
    ...options,
    prompt: promptWithSchema,
    system: systemPrompt,
    temperature: options.temperature ?? 0.3, // Lower temperature for JSON
  })

  // Extract JSON from response
  const jsonMatch = result.text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    log.error("llm_json_extraction_failed", {
      callType: options.callType,
      response: result.text.substring(0, 500),
    })
    throw new Error(`Failed to extract JSON from LLM response: ${result.text.substring(0, 200)}`)
  }

  try {
    const data = JSON.parse(jsonMatch[0]) as T

    log.info("llm_json_call_success", {
      callType: options.callType,
      dataKeys: typeof data === "object" && data !== null ? Object.keys(data) : [],
    })

    return {
      ...result,
      data,
    }
  } catch (parseError) {
    log.error("llm_json_parse_failed", {
      callType: options.callType,
      jsonText: jsonMatch[0].substring(0, 500),
      error: String(parseError),
    })
    throw new Error(`Failed to parse JSON from LLM response: ${parseError}`)
  }
}

/**
 * 批量 LLM 调用（用于并行处理多个调用）
 *
 * @param calls - LLM 调用选项数组
 * @param concurrency - 并发数（默认 3）
 * @returns LLM 调用结果数组
 */
export async function callLLMBatch(calls: LLMCallOptions[], concurrency: number = 3): Promise<LLMCallResult[]> {
  log.info("llm_batch_call_started", { count: calls.length, concurrency })

  const results: LLMCallResult[] = []
  const errors: Array<{ index: number; error: string }> = []

  // Process in batches
  for (let i = 0; i < calls.length; i += concurrency) {
    const batch = calls.slice(i, i + concurrency)
    const batchPromises = batch.map((options, index) =>
      callLLM(options).catch((error) => {
        errors.push({ index: i + index, error: String(error) })
        return null
      }),
    )

    const batchResults = await Promise.all(batchPromises)

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j]
      if (result) {
        results.push(result)
      }
    }

    // Small delay between batches to avoid rate limiting
    if (i + concurrency < calls.length) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  if (errors.length > 0) {
    log.warn("llm_batch_call_completed_with_errors", {
      total: calls.length,
      success: results.length,
      failed: errors.length,
      errors: errors.slice(0, 5), // Log first 5 errors
    })
  } else {
    log.info("llm_batch_call_completed", { total: calls.length, success: results.length })
  }

  return results
}

export const novelLLM = {
  call: callLLM,
  callJson: callLLMJson,
  batch: callLLMBatch,
}
