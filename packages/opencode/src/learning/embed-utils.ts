import { createOpenAI } from "@ai-sdk/openai"
import { embed as originalEmbed, type EmbeddingModel } from "ai"

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
    const dashscopeApiKey = apiKey || process.env.DASHSCOPE_API_KEY
    if (!dashscopeApiKey) {
      throw new Error("DASHSCOPE_API_KEY is required")
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
      throw new Error(`DashScope API error: ${response.status} ${error}`)
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
