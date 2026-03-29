/**
 * Embedding 配置加载器测试
 *
 * 测试配置加载、API 调用和向量化功能
 */

import { describe, test, expect, beforeEach } from "bun:test"
import {
  EmbeddingConfigLoaderImpl,
  loadEmbeddingConfig,
  getEmbeddingApiKey,
  getEmbeddingConfigLoader,
} from "./embedding-config-loader"
import { embedWithDimensions } from "./embed-utils"
import { Log } from "../util/log"

const log = Log.create({ service: "embedding-test" })

describe("Embedding 配置加载器", () => {
  let loader: EmbeddingConfigLoaderImpl

  beforeEach(() => {
    loader = new EmbeddingConfigLoaderImpl()
  })

  describe("配置加载", () => {
    test("应该能从环境变量加载配置", async () => {
      // 保存原始环境变量
      const originalKey = process.env.DASHSCOPE_API_KEY
      const originalModel = process.env.EMBEDDING_MODEL
      const originalDim = process.env.EMBEDDING_DIM

      try {
        // 设置测试环境变量
        process.env.DASHSCOPE_API_KEY = "sk-test-key-from-env"
        process.env.EMBEDDING_MODEL = "text-embedding-v3"
        process.env.EMBEDDING_DIM = "1536"

        const config = await loader.loadConfig()

        expect(config.apiKey).toBe("sk-test-key-from-env")
        expect(config.model).toBe("text-embedding-v3")
        expect(config.dimensions).toBe(1536)
        expect(config.source).toBe("env")

        log.info("✅ 从环境变量加载配置测试通过", { source: config.source })
      } finally {
        // 恢复原始环境变量
        if (originalKey) process.env.DASHSCOPE_API_KEY = originalKey
        if (originalModel) process.env.EMBEDDING_MODEL = originalModel
        if (originalDim) process.env.EMBEDDING_DIM = originalDim
      }
    })

    test("显式参数应该覆盖环境变量", async () => {
      const originalKey = process.env.DASHSCOPE_API_KEY

      try {
        process.env.DASHSCOPE_API_KEY = "sk-env-key"

        const config = await loader.loadConfig({
          apiKey: "sk-explicit-key",
          dimensions: 3072,
        })

        expect(config.apiKey).toBe("sk-explicit-key")
        expect(config.dimensions).toBe(3072)
        expect(config.source).toBe("explicit")

        log.info("✅ 显式参数覆盖测试通过", { source: config.source })
      } finally {
        if (originalKey) process.env.DASHSCOPE_API_KEY = originalKey
      }
    })

    test("应该使用默认配置当没有提供其他配置时", async () => {
      const originalKey = process.env.DASHSCOPE_API_KEY
      const originalModel = process.env.EMBEDDING_MODEL

      try {
        delete process.env.DASHSCOPE_API_KEY
        delete process.env.EMBEDDING_MODEL

        const config = await loader.loadConfig()

        expect(config.model).toBe("text-embedding-v4")
        expect(config.dimensions).toBe(1536)
        expect(config.baseURL).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1")

        log.info("✅ 默认配置测试通过", {
          model: config.model,
          dimensions: config.dimensions,
        })
      } finally {
        if (originalKey) process.env.DASHSCOPE_API_KEY = originalKey
        if (originalModel) process.env.EMBEDDING_MODEL = originalModel
      }
    })
  })

  describe("API Key 获取", () => {
    test("应该能获取 API Key", async () => {
      const originalKey = process.env.DASHSCOPE_API_KEY

      try {
        process.env.DASHSCOPE_API_KEY = "sk-test-key"
        const apiKey = await getEmbeddingApiKey()
        expect(apiKey).toBe("sk-test-key")

        log.info("✅ API Key 获取测试通过")
      } finally {
        if (originalKey) process.env.DASHSCOPE_API_KEY = originalKey
      }
    })

    test("当没有 API Key 时应该抛出详细错误", async () => {
      const originalKey = process.env.DASHSCOPE_API_KEY

      try {
        delete process.env.DASHSCOPE_API_KEY

        try {
          await getEmbeddingApiKey()
          throw new Error("应该抛出错误")
        } catch (error) {
          expect(error instanceof Error).toBe(true)
          expect((error as Error).message).toContain("DASHSCOPE_API_KEY 未配置")
          expect((error as Error).message).toContain("环境变量")
          expect((error as Error).message).toContain(".env 文件")
          expect((error as Error).message).toContain("配置文件")

          log.info("✅ API Key 缺失错误提示测试通过")
        }
      } finally {
        if (originalKey) process.env.DASHSCOPE_API_KEY = originalKey
      }
    })
  })

  describe("配置来源追踪", () => {
    test("应该能识别配置来源", async () => {
      const originalKey = process.env.DASHSCOPE_API_KEY

      try {
        // 测试环境变量来源
        process.env.DASHSCOPE_API_KEY = "sk-test"
        const config1 = await loader.loadConfig()
        const source1 = loader.getConfigSource(config1)
        expect(source1).toBe("环境变量")

        // 测试显式参数来源
        const config2 = await loader.loadConfig({ apiKey: "sk-explicit" })
        const source2 = loader.getConfigSource(config2)
        expect(source2).toBe("显式参数")

        log.info("✅ 配置来源追踪测试通过", {
          env: source1,
          explicit: source2,
        })
      } finally {
        if (originalKey) process.env.DASHSCOPE_API_KEY = originalKey
      }
    })
  })
})

describe("Embedding 实际调用测试", () => {
  test("应该能生成有效的向量（需要有效的 API Key）", async () => {
    const apiKey = process.env.DASHSCOPE_API_KEY

    // 如果没有 API Key，跳过实际 API 调用测试
    if (!apiKey || !apiKey.startsWith("sk-")) {
      log.warn("⚠️ 跳过实际 Embedding 测试：未配置有效的 DASHSCOPE_API_KEY")
      log.warn("💡 提示：要运行完整测试，请设置环境变量：")
      log.warn("   export DASHSCOPE_API_KEY=sk-your-actual-key")
      return
    }

    // 检查是否是测试用的假 key
    if (apiKey.includes("test") || apiKey === "sk-test-key") {
      log.warn("⚠️ 跳过实际 Embedding 测试：检测到测试用的假 API Key")
      log.warn("💡 提示：请使用真实的 DashScope API Key 运行测试")
      return
    }

    try {
      // 测试中文文本
      const chineseText = "人工智能是计算机科学的一个分支"
      const vector1 = await embedWithDimensions({
        model: "text-embedding-v4",
        value: chineseText,
        dimensions: 1536,
        apiKey,
      })

      expect(vector1).toBeInstanceOf(Float32Array)
      expect(vector1.length).toBe(1536)

      // 测试英文文本
      const englishText = "Artificial intelligence is a branch of computer science"
      const vector2 = await embedWithDimensions({
        model: "text-embedding-v4",
        value: englishText,
        dimensions: 1536,
        apiKey,
      })

      expect(vector2).toBeInstanceOf(Float32Array)
      expect(vector2.length).toBe(1536)

      // 测试语义相似性（相似的文本应该有相似的向量）
      const similarText = "AI is part of computing science"
      const vector3 = await embedWithDimensions({
        model: "text-embedding-v4",
        value: similarText,
        dimensions: 1536,
        apiKey,
      })

      // 计算余弦相似度
      const dotProduct = Array.from(vector2).reduce((sum, val, i) => sum + val * vector3[i], 0)
      const norm2 = Math.sqrt(Array.from(vector2).reduce((sum, val) => sum + val * val, 0))
      const norm3 = Math.sqrt(Array.from(vector3).reduce((sum, val) => sum + val * val, 0))
      const cosineSimilarity = dotProduct / (norm2 * norm3)

      log.info("✅ Embedding 实际调用测试通过", {
        vectorDimension: vector1.length,
        cosineSimilarity: cosineSimilarity.toFixed(4),
        note: "余弦相似度越接近 1 表示语义越相似",
      })

      // 相似文本的余弦相似度应该较高（> 0.5）
      expect(cosineSimilarity).toBeGreaterThan(0.5)
    } catch (error) {
      if (error instanceof Error) {
        log.error("❌ Embedding 调用失败", {
          message: error.message,
          hasApiKey: !!apiKey,
          apiKeyPrefix: apiKey?.substring(0, 10),
        })
      }
      throw error
    }
  })

  test("应该能处理不同维度的请求", async () => {
    const apiKey = process.env.DASHSCOPE_API_KEY

    if (!apiKey || !apiKey.startsWith("sk-")) {
      log.warn("⚠️ 跳过维度测试：未配置有效的 DASHSCOPE_API_KEY")
      return
    }

    // 检查是否是测试用的假 key
    if (apiKey.includes("test") || apiKey === "sk-test-key") {
      log.warn("⚠️ 跳过维度测试：检测到测试用的假 API Key")
      return
    }

    try {
      // 测试 1536 维度（默认）
      const vector1536 = await embedWithDimensions({
        model: "text-embedding-v4",
        value: "测试文本",
        dimensions: 1536,
        apiKey,
      })

      expect(vector1536.length).toBe(1536)

      log.info("✅ 维度配置测试通过", {
        requested: 1536,
        actual: vector1536.length,
      })
    } catch (error) {
      log.error("❌ 维度测试失败", { error: String(error) })
      throw error
    }
  })
})

describe("配置加载器单例测试", () => {
  test("getEmbeddingConfigLoader 应该返回同一个实例", () => {
    const loader1 = getEmbeddingConfigLoader()
    const loader2 = getEmbeddingConfigLoader()
    expect(loader1).toBe(loader2)

    log.info("✅ 单例模式测试通过")
  })
})
