import { Agent } from "../agent/agent"
import { Provider } from "../provider/provider"
import { Log } from "../util/log"

const log = Log.create({ service: "novel-model" })

export interface NovelModelResult {
  providerID: string
  modelID: string
}

/**
 * 获取 novel 模块使用的模型
 *
 * 优先级：
 * 1. 从默认 agent 获取配置的模型
 * 2. 从会话历史获取最近使用的模型
 * 3. 从全局配置获取 model
 * 4. 从最近使用的模型列表获取
 * 5. 从第一个可用的 provider 获取
 *
 * @returns 可用的模型信息
 * @throws 当没有任何可用模型时抛出错误
 */
export async function getNovelModel(): Promise<NovelModelResult> {
  // 尝试 1: 从默认 agent 获取模型配置
  try {
    const agentName = await Agent.defaultAgent()
    const agent = await Agent.get(agentName)
    if (agent?.model) {
      log.info("using_agent_model", { agent: agentName, model: `${agent.model.providerID}/${agent.model.modelID}` })
      return agent.model
    }
  } catch (error) {
    log.warn("agent_model_unavailable", { error: String(error) })
  }

  // 尝试 2: 从 Provider.defaultModel() 获取（会检查全局配置和最近使用）
  try {
    log.debug("attempting_provider_defaultModel")
    const configured = await Provider.defaultModel()
    log.debug("provider_defaultModel_success", { model: `${configured.providerID}/${configured.modelID}` })

    // 验证模型是否真正可用
    log.debug("validating_model", { model: `${configured.providerID}/${configured.modelID}` })
    await Provider.getModel(configured.providerID, configured.modelID)
    log.info("using_configured_model", { model: `${configured.providerID}/${configured.modelID}` })
    return configured
  } catch (error) {
    log.warn("configured_model_unavailable", {
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
  }

  // 尝试 3: 获取任意可用的 provider 和模型
  try {
    log.debug("attempting_fallback_provider_list")
    const providers = await Provider.list()
    log.debug("provider_list_result", { count: Object.keys(providers).length, providers: Object.keys(providers) })

    const providerEntries = Object.values(providers)

    if (providerEntries.length > 0) {
      // 查找有模型的第一个 provider
      for (const provider of providerEntries) {
        const models = Object.values(provider.models)
        log.debug("checking_provider", { provider: provider.id, modelCount: models.length })

        if (models.length > 0) {
          // 使用排序选择最佳模型
          const sorted = Provider.sort(models)
          const selected = sorted[0]
          if (selected) {
            log.info("using_fallback_provider_model", {
              provider: provider.id,
              model: selected.id,
            })
            return {
              providerID: provider.id,
              modelID: selected.id,
            }
          }
        }
      }
    } else {
      log.warn("no_providers_available")
    }
  } catch (error) {
    log.warn("fallback_provider_search_failed", {
      error: String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
  }

  throw new Error(
    "No AI model available. Please configure a model in .opencode/opencode.jsonc or set up a provider with API keys.",
  )
}

/**
 * 获取模型并返回 language model 实例
 *
 * @returns AI SDK 的 language model 实例
 * @throws 当模型不可用时抛出错误
 */
export async function getNovelLanguageModel() {
  const model = await getNovelModel()
  const modelInfo = await Provider.getModel(model.providerID, model.modelID)
  return Provider.getLanguage(modelInfo)
}
