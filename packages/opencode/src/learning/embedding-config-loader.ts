/**
 * Embedding 配置加载器
 *
 * 按优先级逐级读取配置，直到找到可用配置为止：
 * 1. 显式传入的参数（最高优先级）
 * 2. 环境变量 (process.env / Bun.env)
 * 3. .env 文件（项目根目录、用户目录）
 * 4. opencode.jsonc / opencode.json 配置文件
 * 5. 默认配置（最低优先级）
 */

import { existsSync } from "fs"
import path from "path"
import { Log } from "../util/log"

const log = Log.create({ service: "embedding-config" })

export interface EmbeddingConfig {
  /** API Key */
  apiKey: string
  /** Embedding 模型名称 */
  model: string
  /** 向量维度 */
  dimensions: number
  /** API Base URL */
  baseURL: string
  /** 配置来源 */
  source: "explicit" | "env" | "dotenv" | "config-file" | "default"
}

export interface EmbeddingConfigLoader {
  /**
   * 加载 embedding 配置
   * 按优先级逐级读取，直到找到可用配置
   */
  loadConfig(overrides?: Partial<EmbeddingConfig>): Promise<EmbeddingConfig>

  /**
   * 验证配置是否可用
   */
  validateConfig(config: EmbeddingConfig): Promise<boolean>

  /**
   * 获取配置来源说明
   */
  getConfigSource(config: EmbeddingConfig): string
}

const DEFAULTS: EmbeddingConfig = {
  apiKey: "",
  model: "text-embedding-v4",
  dimensions: 1536,
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  source: "default",
}

/**
 * 尝试从 .env 文件加载配置
 */
async function loadFromDotEnv(): Promise<Partial<EmbeddingConfig> | null> {
  const candidates = [
    // 项目根目录
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), ".env.local"),
    // 用户配置目录
    path.join(process.env.HOME || "", ".config", "opencode", ".env"),
    path.join(process.env.HOME || "", ".opencode", ".env"),
  ]

  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      try {
        const content = await Bun.file(envPath).text()
        const lines = content.split("\n")
        const config: Partial<EmbeddingConfig> = {}

        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith("#") || !trimmed.includes("=")) continue

          const [key, ...valueParts] = trimmed.split("=")
          const value = valueParts.join("=").replace(/^["']|["']$/g, "")

          if (key === "DASHSCOPE_API_KEY") {
            config.apiKey = value
          } else if (key === "EMBEDDING_MODEL") {
            config.model = value
          } else if (key === "EMBEDDING_DIM") {
            config.dimensions = parseInt(value, 10)
          } else if (key === "DASHSCOPE_BASE_URL") {
            config.baseURL = value
          }
        }

        if (Object.keys(config).length > 0) {
          log.debug("已从 .env 文件加载配置", { path: envPath })
          return config
        }
      } catch (error) {
        log.debug("加载 .env 文件失败", { path: envPath, error: String(error) })
      }
    }
  }

  return null
}

/**
 * 尝试从 opencode.jsonc/json 加载配置
 */
async function loadFromConfigFile(): Promise<Partial<EmbeddingConfig> | null> {
  const candidates = [
    // 当前项目
    path.join(process.cwd(), "opencode.jsonc"),
    path.join(process.cwd(), "opencode.json"),
    // 用户配置目录
    path.join(process.env.HOME || "", ".config", "opencode", "opencode.jsonc"),
    path.join(process.env.HOME || "", ".config", "opencode", "opencode.json"),
    path.join(process.env.HOME || "", ".opencode", "opencode.jsonc"),
    path.join(process.env.HOME || "", ".opencode", "opencode.json"),
  ]

  for (const configPath of candidates) {
    if (existsSync(configPath)) {
      try {
        const content = await Bun.file(configPath).text()
        // 简单的 JSONC 解析（去除注释）
        const jsonContent = content.replace(/\/\/.*$/gm, "")
        const config = JSON.parse(jsonContent)

        if (config.embedding) {
          const embedding = config.embedding
          const result: Partial<EmbeddingConfig> = {}

          if (embedding.apiKey) result.apiKey = embedding.apiKey
          if (embedding.model) result.model = embedding.model
          if (embedding.dimensions) result.dimensions = embedding.dimensions
          if (embedding.baseURL) result.baseURL = embedding.baseURL

          if (Object.keys(result).length > 0) {
            log.debug("已从配置文件加载配置", { path: configPath })
            return result
          }
        }
      } catch (error) {
        log.debug("加载配置文件失败", { path: configPath, error: String(error) })
      }
    }
  }

  return null
}

/**
 * 从环境变量加载配置
 */
function loadFromEnv(): Partial<EmbeddingConfig> {
  const config: Partial<EmbeddingConfig> = {}

  // 支持多种环境变量命名
  const apiKey =
    process.env.DASHSCOPE_API_KEY ||
    process.env.OPENCODE_EMBEDDING_API_KEY ||
    process.env.EMBEDDING_API_KEY ||
    Bun.env.DASHSCOPE_API_KEY ||
    Bun.env.OPENCODE_EMBEDDING_API_KEY ||
    Bun.env.EMBEDDING_API_KEY

  if (apiKey) config.apiKey = apiKey

  const model = process.env.EMBEDDING_MODEL || Bun.env.EMBEDDING_MODEL
  if (model) config.model = model

  const dim = process.env.EMBEDDING_DIM || Bun.env.EMBEDDING_DIM
  if (dim) config.dimensions = parseInt(dim, 10)

  const baseURL = process.env.DASHSCOPE_BASE_URL || Bun.env.DASHSCOPE_BASE_URL
  if (baseURL) config.baseURL = baseURL

  if (Object.keys(config).length > 0) {
    log.debug("已从环境变量加载配置")
  }

  return config
}

/**
 * 合并配置，保留来源信息
 */
function mergeConfigs(
  explicit: Partial<EmbeddingConfig>,
  env: Partial<EmbeddingConfig>,
  dotenv: Partial<EmbeddingConfig>,
  configFile: Partial<EmbeddingConfig>,
  defaults: EmbeddingConfig,
): EmbeddingConfig {
  // 优先级：explicit > env > dotenv > configFile > defaults
  const result: EmbeddingConfig = {
    apiKey: explicit.apiKey || env.apiKey || dotenv.apiKey || configFile.apiKey || defaults.apiKey,
    model: explicit.model || env.model || dotenv.model || configFile.model || defaults.model,
    dimensions:
      explicit.dimensions || env.dimensions || dotenv.dimensions || configFile.dimensions || defaults.dimensions,
    baseURL: explicit.baseURL || env.baseURL || dotenv.baseURL || configFile.baseURL || defaults.baseURL,
    source: "default",
  }

  // 确定来源
  if (explicit.apiKey || explicit.model || explicit.dimensions || explicit.baseURL) {
    result.source = "explicit"
  } else if (env.apiKey || env.model || env.dimensions || env.baseURL) {
    result.source = "env"
  } else if (dotenv?.apiKey || dotenv?.model || dotenv?.dimensions || dotenv?.baseURL) {
    result.source = "dotenv"
  } else if (configFile?.apiKey || configFile?.model || configFile?.dimensions || configFile?.baseURL) {
    result.source = "config-file"
  }

  return result
}

/**
 * Embedding 配置加载器实现
 */
export class EmbeddingConfigLoaderImpl implements EmbeddingConfigLoader {
  private cachedConfig: EmbeddingConfig | null = null

  async loadConfig(overrides?: Partial<EmbeddingConfig>): Promise<EmbeddingConfig> {
    log.debug("正在加载 embedding 配置...")

    // 1. 显式参数（最高优先级）
    const explicit = overrides || {}

    // 2. 环境变量
    const env = loadFromEnv()

    // 3. .env 文件
    const dotenv = (await loadFromDotEnv()) || {}

    // 4. 配置文件
    const configFile = (await loadFromConfigFile()) || {}

    // 5. 合并所有配置
    const config = mergeConfigs(explicit, env, dotenv, configFile, DEFAULTS)

    // 缓存配置
    this.cachedConfig = config

    log.info("embedding 配置已加载", {
      model: config.model,
      dimensions: config.dimensions,
      source: config.source,
      hasApiKey: !!config.apiKey,
    })

    return config
  }

  async validateConfig(config: EmbeddingConfig): Promise<boolean> {
    // 检查必需字段
    if (!config.apiKey) {
      log.warn("embedding 配置验证失败：缺少 API Key")
      return false
    }

    if (!config.model) {
      log.warn("embedding 配置验证失败：缺少模型名称")
      return false
    }

    if (!config.dimensions || config.dimensions <= 0) {
      log.warn("embedding 配置验证失败：无效的维度")
      return false
    }

    // 可选：测试 API 连接
    try {
      const response = await fetch(`${config.baseURL}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model,
          input: "test",
          dimensions: config.dimensions,
        }),
      })

      if (!response.ok) {
        const error = await response.text()
        log.warn("embedding API 测试失败", { status: response.status, error })
        return false
      }

      log.debug("embedding API 测试通过")
      return true
    } catch (error) {
      log.warn("embedding API 连接测试失败", { error: String(error) })
      return false
    }
  }

  getConfigSource(config: EmbeddingConfig): string {
    const sources = {
      explicit: "显式参数",
      env: "环境变量",
      dotenv: ".env 文件",
      "config-file": "配置文件 (opencode.json/c)",
      default: "默认配置",
    }

    return sources[config.source] || "未知"
  }
}

// 单例实例
let globalLoader: EmbeddingConfigLoader | null = null

/**
 * 获取全局配置加载器实例
 */
export function getEmbeddingConfigLoader(): EmbeddingConfigLoader {
  if (!globalLoader) {
    globalLoader = new EmbeddingConfigLoaderImpl()
  }
  return globalLoader
}

/**
 * 快捷方法：加载 embedding 配置
 */
export async function loadEmbeddingConfig(overrides?: Partial<EmbeddingConfig>): Promise<EmbeddingConfig> {
  const loader = getEmbeddingConfigLoader()
  return loader.loadConfig(overrides)
}

/**
 * 快捷方法：获取 API Key（最常用）
 */
export async function getEmbeddingApiKey(overrides?: { apiKey?: string }): Promise<string> {
  const config = await loadEmbeddingConfig(overrides)
  if (!config.apiKey) {
    throw new Error(
      "DASHSCOPE_API_KEY 未配置！请通过以下方式之一设置:\n" +
        "  1. 环境变量：export DASHSCOPE_API_KEY=your-key\n" +
        "  2. .env 文件：在项目或 ~/.config/opencode/.env 中添加 DASHSCOPE_API_KEY=your-key\n" +
        "  3. 配置文件：在 opencode.jsonc 的 embedding.apiKey 字段中配置\n" +
        "  4. 显式参数：在代码中传入 apiKey 参数",
    )
  }
  return config.apiKey
}
