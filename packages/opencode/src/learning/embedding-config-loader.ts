/**
 * Embedding 配置加载器
 *
 * 配置来源（按优先级）：
 * 1. 显式传入的参数（最高优先级）
 * 2. opencode.jsonc / opencode.json 配置文件
 * 3. 默认配置（最低优先级）
 *
 * 注意：环境变量和 .env 文件支持已移除，避免配置冲突
 */

import { existsSync } from "fs"
import path from "path"
import { Log } from "../util/log"
import * as JSONC from "jsonc-parser"

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
 * 注意：已移除 .env 文件支持，配置只能从 opencode.jsonc/json 读取
 */
async function loadFromDotEnv(): Promise<Partial<EmbeddingConfig> | null> {
  // .env file support removed - use opencode.jsonc instead
  return null
}

/**
 * 查找项目根目录（包含 opencode.jsonc/json 的目录）
 * 向上遍历目录树，直到找到配置文件或到达根目录
 */
function findProjectRoot(startDir: string = process.cwd()): string | null {
  let currentDir = startDir
  const rootRegex = /^[A-Z]:\\$/i.test(startDir) ? /^[A-Z]:\\$/i : /^\/$/i

  while (true) {
    // 检查当前目录是否有配置文件
    if (existsSync(path.join(currentDir, "opencode.jsonc")) || existsSync(path.join(currentDir, "opencode.json"))) {
      return currentDir
    }

    // 检查是否到达根目录
    if (rootRegex.test(currentDir)) {
      return null
    }

    const parentDir = path.dirname(currentDir)
    // 如果父目录与当前目录相同，说明已到达根目录
    if (parentDir === currentDir) {
      return null
    }

    currentDir = parentDir
  }
}

/**
 * 尝试从 opencode.jsonc/json 加载配置
 */
async function loadFromConfigFile(): Promise<Partial<EmbeddingConfig> | null> {
  const candidates: string[] = []

  // 1. 首先查找项目根目录的配置文件
  const projectRoot = findProjectRoot()
  if (projectRoot) {
    candidates.push(path.join(projectRoot, "opencode.jsonc"), path.join(projectRoot, "opencode.json"))
  }

  // 2. 当前工作目录（兼容旧代码）
  candidates.push(path.join(process.cwd(), "opencode.jsonc"), path.join(process.cwd(), "opencode.json"))

  // 3. 用户配置目录
  const home = process.env.HOME || ""
  if (home) {
    candidates.push(
      path.join(home, ".config", "opencode", "opencode.jsonc"),
      path.join(home, ".config", "opencode", "opencode.json"),
      path.join(home, ".opencode", "opencode.jsonc"),
      path.join(home, ".opencode", "opencode.json"),
    )
  }

  // 4. 全局配置目录
  try {
    const { Global } = await import("../global")
    candidates.push(path.join(Global.Path.config, "opencode.jsonc"), path.join(Global.Path.config, "opencode.json"))
  } catch (error) {
    log.debug("无法加载 Global 模块", { error: String(error) })
  }

  for (const configPath of candidates) {
    if (existsSync(configPath)) {
      try {
        const content = await Bun.file(configPath).text()
        // 使用 jsonc-parser 解析（支持注释和尾随逗号）
        const errors: JSONC.ParseError[] = []
        const config = JSONC.parse(content, errors)

        if (errors.length > 0) {
          log.debug("配置文件解析警告", {
            path: configPath,
            errors: errors.map((e) => JSONC.printParseErrorCode(e.error)),
          })
        }

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
 * 注意：已移除环境变量支持，配置只能从配置文件读取
 */
function loadFromEnv(): Partial<EmbeddingConfig> {
  // 环境变量支持已移除，避免与配置文件冲突
  // 配置只能从 opencode.jsonc/json 文件中读取
  return {}
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
  // 优先级：explicit > dotenv > configFile > defaults
  // 注意：环境变量支持已移除，避免与配置文件冲突
  const result: EmbeddingConfig = {
    apiKey: explicit.apiKey || dotenv.apiKey || configFile.apiKey || defaults.apiKey,
    model: explicit.model || dotenv.model || configFile.model || defaults.model,
    dimensions: explicit.dimensions || dotenv.dimensions || configFile.dimensions || defaults.dimensions,
    baseURL: explicit.baseURL || dotenv.baseURL || configFile.baseURL || defaults.baseURL,
    source: "default",
  }

  // 确定来源
  if (explicit.apiKey || explicit.model || explicit.dimensions || explicit.baseURL) {
    result.source = "explicit"
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

    // 2. 配置文件
    const configFile = (await loadFromConfigFile()) || {}

    // 3. 合并配置（环境变量和 .env 支持已移除）
    const config = mergeConfigs(explicit, {}, {}, configFile, DEFAULTS)

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
