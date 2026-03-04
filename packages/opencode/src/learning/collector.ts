import type { LearningSource, LearningConfig } from "./config"
import { Log } from "../util/log"

const log = Log.create({ service: "learning-collector" })

export interface CollectedItem {
  source: LearningSource
  url: string
  title: string
  content: string
}

interface ExaSearchResult {
  title: string
  url: string
  text: string
}

export class Collector {
  private config: LearningConfig

  constructor(config: LearningConfig) {
    this.config = config
  }

  async collect(): Promise<CollectedItem[]> {
    const items: CollectedItem[] = []

    for (const topic of this.config.topics) {
      if (this.config.sources.includes("search")) {
        const searchResults = await this.collectFromSearch(topic)
        items.push(...searchResults)
      }
      if (this.config.sources.includes("arxiv")) {
        const arxivResults = await this.collectFromArxiv(topic)
        items.push(...arxivResults)
      }
      if (this.config.sources.includes("github")) {
        const githubResults = await this.collectFromGithub(topic)
        items.push(...githubResults)
      }
      if (this.config.sources.includes("pypi")) {
        const pypiResults = await this.collectFromPyPI(topic)
        items.push(...pypiResults)
      }
    }

    return items.slice(0, this.config.max_items_per_run)
  }

  private async collectFromSearch(topic: string): Promise<CollectedItem[]> {
    try {
      const results = await this.exaSearch(`${topic} 2024 2025`, 5)
      return results.map((r) => ({
        source: "search" as LearningSource,
        url: r.url,
        title: r.title,
        content: r.text,
      }))
    } catch (e) {
      log.error("search collection failed", { topic, error: String(e) })
      return []
    }
  }

  private async collectFromArxiv(topic: string): Promise<CollectedItem[]> {
    try {
      const results = await this.exaSearch(`site:arxiv.org ${topic}`, 3)
      return results.map((r) => ({
        source: "arxiv" as LearningSource,
        url: r.url,
        title: r.title,
        content: r.text,
      }))
    } catch (e) {
      log.error("arxiv collection failed", { topic, error: String(e) })
      return []
    }
  }

  private async collectFromGithub(topic: string): Promise<CollectedItem[]> {
    try {
      const results = await this.exaSearch(`site:github.com ${topic} language:typescript`, 3)
      return results.map((r) => ({
        source: "github" as LearningSource,
        url: r.url,
        title: r.title,
        content: r.text,
      }))
    } catch (e) {
      log.error("github collection failed", { topic, error: String(e) })
      return []
    }
  }

  private async collectFromPyPI(topic: string): Promise<CollectedItem[]> {
    try {
      const response = await fetch(`https://pypi.org/simple/`)
      if (!response.ok) {
        throw new Error(`PyPI API error: ${response.status}`)
      }

      const text = await response.text()
      const packages = text.split("\n").filter((l) => l.includes(topic.toLowerCase()))

      const items: CollectedItem[] = []
      for (const pkg of packages.slice(0, 5)) {
        const pkgName = pkg.trim()
        if (!pkgName) continue

        try {
          const infoResponse = await fetch(`https://pypi.org/pypi/${pkgName}/json`)
          if (infoResponse.ok) {
            const info = await infoResponse.json()
            items.push({
              source: "pypi" as LearningSource,
              url: `https://pypi.org/project/${pkgName}/`,
              title: `${pkgName} v${info.info.version}`,
              content: `${info.info.summary}\n\n${info.info.description?.slice(0, 2000) || ""}`,
            })
          }
        } catch {
          log.warn("failed to fetch pypi package info", { package: pkgName })
        }
      }

      if (items.length === 0) {
        const searchResults = await this.exaSearch(`site:pypi.org ${topic}`, 3)
        return searchResults.map((r) => ({
          source: "pypi" as LearningSource,
          url: r.url,
          title: r.title,
          content: r.text,
        }))
      }

      return items
    } catch (e) {
      log.error("pypi collection failed", { topic, error: String(e) })
      return []
    }
  }

  private async exaSearch(query: string, numResults: number): Promise<ExaSearchResult[]> {
    const response = await fetch("https://mcp.exa.ai/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "web_search_exa",
          arguments: {
            query,
            numResults,
            type: "auto",
            livecrawl: "fallback",
            contextMaxCharacters: 10000,
          },
        },
      }),
    })

    if (!response.ok) {
      throw new Error(`Exa API error: ${response.status}`)
    }

    const responseText = await response.text()
    const lines = responseText.split("\n")

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = JSON.parse(line.substring(6))
        if (data.result?.content?.[0]?.text) {
          const text = data.result.content[0].text
          try {
            return JSON.parse(text)
          } catch {
            log.warn("failed to parse Exa response as JSON", { text: text.slice(0, 100) })
            return []
          }
        }
      }
    }

    return []
  }
}
