import { Log } from "../util/log"
import { Config } from "../config/config"

const log = Log.create({ service: "zeroclaw.router" })

export interface ToolRoutingConfig {
  shell: boolean
  file: boolean
  http: boolean
  hardware: boolean
  memory: boolean
  cron: boolean
}

export interface SecurityConfig {
  policy: "supervised" | "read_only" | "full"
  estopEnabled: boolean
}

export namespace ToolRouter {
  const toolPatterns: Record<string, keyof ToolRoutingConfig> = {
    shell: "shell",
    bash: "shell",
    exec: "shell",
    file_read: "file",
    file_write: "file",
    file_edit: "file",
    file_delete: "file",
    glob: "file",
    ls: "file",
    read: "file",
    write: "file",
    edit: "file",
    http_request: "http",
    browser: "http",
    browser_open: "http",
    url_validation: "http",
    hardware_discover: "hardware",
    hardware_board_info: "hardware",
    hardware_memory_read: "hardware",
    hardware_memory_write: "hardware",
    gpio_read: "hardware",
    gpio_write: "hardware",
    serial_read: "hardware",
    serial_write: "hardware",
    memory_store: "memory",
    memory_recall: "memory",
    memory_observe: "memory",
    memory_forget: "memory",
    cron_add: "cron",
    cron_list: "cron",
    cron_remove: "cron",
    cron_run: "cron",
    cron_update: "cron",
  }

  const defaultRouting: ToolRoutingConfig = {
    shell: false,
    file: false,
    http: false,
    hardware: false,
    memory: false,
    cron: false,
  }

  const defaultSecurity: SecurityConfig = {
    policy: "supervised",
    estopEnabled: false,
  }

  export async function shouldRoute(toolId: string): Promise<boolean> {
    const config = await getRoutingConfig()
    const routingKey = toolPatterns[toolId]
    if (!routingKey) return false
    return config[routingKey] ?? false
  }

  export async function getRoutingConfig(): Promise<ToolRoutingConfig> {
    const config = await Config.get()
    const zeroclaw = config.zeroclaw
    if (!zeroclaw?.enabled) return defaultRouting
    return {
      shell: zeroclaw.routing?.shell ?? defaultRouting.shell,
      file: zeroclaw.routing?.file ?? defaultRouting.file,
      http: zeroclaw.routing?.http ?? defaultRouting.http,
      hardware: zeroclaw.routing?.hardware ?? defaultRouting.hardware,
      memory: zeroclaw.routing?.memory ?? defaultRouting.memory,
      cron: zeroclaw.routing?.cron ?? defaultRouting.cron,
    }
  }

  export async function getSecurityConfig(): Promise<SecurityConfig> {
    const config = await Config.get()
    const zeroclaw = config.zeroclaw
    if (!zeroclaw?.enabled) return defaultSecurity
    return {
      policy: zeroclaw.security?.policy ?? defaultSecurity.policy,
      estopEnabled: zeroclaw.security?.estopEnabled ?? defaultSecurity.estopEnabled,
    }
  }

  export function getRoutingKey(toolId: string): keyof ToolRoutingConfig | undefined {
    return toolPatterns[toolId]
  }
}
