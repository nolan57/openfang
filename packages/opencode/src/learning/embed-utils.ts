import { createOpenAI } from "@ai-sdk/openai"
import { embed as originalEmbed, type EmbeddingModel } from "ai"
import { getEmbeddingApiKey } from "./embedding-config-loader"

const DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"

export interface CustomEmbedOptions {
  model: string
  value: string
  dimensions?: number
  apiKey?: string
  baseURL?: string
}

export async function embedWithDimensions(options: CustomEmbedOptions): Promise<Float32Array> {
  const { model, value, dimensions, apiKey, baseURL = DASHSCOPE_BASE_URL } = options

  // 判断是否使用 DashScope
  if (model.startsWith("text-embedding-") && (apiKey?.includes("sk-") || !apiKey)) {
    // 使用 DashScope API
    // 统一配置加载：按优先级读取 explicit > env > dotenv > config-file > default
    const dashscopeApiKey = apiKey || (await getEmbeddingApiKey({ apiKey }))
    if (!dashscopeApiKey) {
      throw new Error(
        "DASHSCOPE_API_KEY 未配置！请通过以下方式之一设置:\n" +
          "  1. 导出环境变量：export DASHSCOPE_API_KEY=your-key\n" +
          "  2. 或在 opencode.jsonc 中配置 embedding.apiKey 字段",
      )
    }

    const response = await fetch(`${baseURL}/embeddings`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dashscopeApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: value,
        dimensions: dimensions || 1536,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`DashScope API 错误：${response.status} ${error}`)
    }

    const data = await response.json()
    return new Float32Array(data.data[0].embedding)
  }

  // 使用默认的 Vercel AI SDK embed
  const result = await originalEmbed({
    model: model as any,
    value,
  })
  return new Float32Array(result.embedding as unknown as number[])
}
