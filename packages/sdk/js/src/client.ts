export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import type { Config } from "./gen/client/types.gen.js"
import { OpencodeClient as BaseOpencodeClient } from "./gen/sdk.gen.js"
import type { TextPartInput, FilePartInput, AgentPartInput, SubtaskPartInput } from "./gen/types.gen.js"
export { type Config as OpencodeClientConfig }

export class OpencodeClient extends BaseOpencodeClient {
  async *promptStream(parameters: {
    sessionID: string
    directory?: string
    messageID?: string
    model?: { providerID: string; modelID: string }
    agent?: string
    noReply?: boolean
    tools?: { [key: string]: boolean }
    format?: string
    system?: string
    variant?: string
    parts?: Array<TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput>
  }): AsyncGenerator<{ type: "chunk" | "done" | "error"; content?: string; messageId?: string; error?: string }> {
    const clientConfig = this._client.getConfig()
    const baseUrl = clientConfig.baseUrl || "http://localhost:4096"
    const url = new URL(`${baseUrl}/session/${parameters.sessionID}/prompt/stream`)
    if (parameters.directory) {
      url.searchParams.set("directory", parameters.directory)
    }

    const headers = new Headers(clientConfig.headers as Record<string, string>)
    headers.set("Content-Type", "application/json")

    const body = JSON.stringify({
      messageID: parameters.messageID,
      model: parameters.model,
      agent: parameters.agent,
      noReply: parameters.noReply,
      tools: parameters.tools,
      format: parameters.format,
      system: parameters.system,
      variant: parameters.variant,
      parts: parameters.parts,
    })

    const fetchFn = (clientConfig.fetch as typeof fetch | undefined) || globalThis.fetch
    const response = await fetchFn(url.toString(), {
      method: "POST",
      headers,
      body,
    })

    if (!response.body) {
      throw new Error("No response body")
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    let buffer = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() || ""

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6)
          try {
            yield JSON.parse(data)
          } catch {
            // Skip invalid JSON
          }
        }
      }
    }
  }
}

export function createOpencodeClient(config?: Config & { directory?: string }) {
  if (!config?.fetch) {
    const customFetch: any = (req: any) => {
      // @ts-ignore
      req.timeout = false
      return fetch(req)
    }
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-opencode-directory": encodeURIComponent(config.directory),
    }
  }

  const client = createClient(config)
  return new OpencodeClient({ client })
}
