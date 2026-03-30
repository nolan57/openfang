import type { OpenFangAgentInfo } from "./types"
import type { AgentInfo } from "../collab/types"

export const OpenFangToOpenCodeCapabilities: Record<string, string> = {
  // OpenFang tools -> OpenCode tools
  file_read: "file:read",
  file_write: "file:write",
  file_list: "file:list",
  shell_exec: "shell:execute",
  web_search: "web:search",
  web_fetch: "web:fetch",
  memory_store: "memory:write",
  memory_recall: "memory:read",
  event_publish: "event:publish",
  knowledge_add_entity: "knowledge:add",
  knowledge_add_relation: "knowledge:add",
  knowledge_query: "knowledge:query",
  schedule_create: "schedule:create",
  schedule_list: "schedule:list",
  schedule_delete: "schedule:delete",
  browser_navigate: "browser:navigate",
  browser_click: "browser:click",
  browser_type: "browser:type",
  browser_screenshot: "browser:screenshot",
  browser_read_page: "browser:read",
  browser_close: "browser:close",
  vault_set: "vault:set",
  vault_get: "vault:get",
  vault_list: "vault:list",
  vault_delete: "vault:delete",
}

export const OpenFangToOpenCodePermissions: Record<string, string> = {
  // OpenFang capabilities -> OpenCode permissions
  ToolInvoke: "tool:invoke",
  ToolAll: "tool:all",
  MemoryRead: "memory:read",
  MemoryWrite: "memory:write",
  NetConnect: "network:connect",
  AgentSpawn: "agent:spawn",
  AgentMessage: "agent:message",
  AgentKill: "agent:kill",
  ShellExec: "shell:execute",
  OfpDiscover: "ofp:discover",
  OfpConnect: "ofp:connect",
  OfpAdvertise: "ofp:advertise",
}

export function mapCapabilities(openfangCaps: {
  tools: string[]
  network: string[]
  memory_read: string[]
  memory_write: string[]
  shell: string[]
}): string[] {
  const capabilities: string[] = []

  // Map tools
  for (const tool of openfangCaps.tools) {
    const mapped = OpenFangToOpenCodeCapabilities[tool]
    if (mapped) {
      capabilities.push(mapped)
    } else {
      capabilities.push(`tool:${tool}`)
    }
  }

  // Map network permissions
  for (const net of openfangCaps.network) {
    if (net === "*") {
      capabilities.push("network:*")
    } else {
      capabilities.push(`network:${net}`)
    }
  }

  // Map memory permissions
  for (const mem of openfangCaps.memory_read) {
    capabilities.push(`memory:read:${mem}`)
  }
  for (const mem of openfangCaps.memory_write) {
    capabilities.push(`memory:write:${mem}`)
  }

  // Map shell permissions
  for (const shell of openfangCaps.shell) {
    if (shell === "*") {
      capabilities.push("shell:*")
    } else {
      capabilities.push(`shell:${shell}`)
    }
  }

  return capabilities
}

export function mapModuleToType(module: string): AgentInfo["type"] {
  const mapping: Record<string, AgentInfo["type"]> = {
    "builtin:chat": "general",
    "builtin:coder": "build",
    "builtin:reviewer": "review",
    "builtin:tester": "test",
    "builtin:explorer": "explore",
    "builtin:researcher": "general",
    "builtin:collector": "general",
    "builtin:browser": "general",
  }
  return mapping[module] ?? "custom"
}

export function convertOpenFangAgentToOpenCode(openfangAgent: OpenFangAgentInfo): AgentInfo {
  return {
    id: openfangAgent.id,
    name: openfangAgent.name,
    type: mapModuleToType(openfangAgent.module),
    role: "worker",
    state: openfangAgent.state,
    capabilities: mapCapabilities(openfangAgent.capabilities),
    config: {
      model: {
        providerID: openfangAgent.model.provider,
        modelID: openfangAgent.model.model,
      },
      tools: openfangAgent.capabilities.tools,
      permission: {
        network: openfangAgent.capabilities.network,
        memory: {
          read: openfangAgent.capabilities.memory_read,
          write: openfangAgent.capabilities.memory_write,
        },
        shell: openfangAgent.capabilities.shell,
      },
      maxSteps: Math.floor(openfangAgent.resources.max_llm_tokens_per_hour / 1000),
      timeout: openfangAgent.resources.max_llm_tokens_per_hour,
    },
    createdAt: openfangAgent.created_at,
    lastActiveAt: openfangAgent.last_active_at,
  }
}
