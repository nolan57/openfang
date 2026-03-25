import type { LearningSource, LearningConfig } from "./config"
import { Log } from "../util/log"
import { Config } from "../config/config"

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
        log.info("search results", { topic, count: searchResults.length })
        items.push(...searchResults)
      }
      if (this.config.sources.includes("arxiv")) {
        const arxivResults = await this.collectFromArxiv(topic)
        log.info("arxiv results", { topic, count: arxivResults.length })
        items.push(...arxivResults)
      }
      if (this.config.sources.includes("github")) {
        const githubResults = await this.collectFromGithub(topic)
        log.info("github results", { topic, count: githubResults.length })
        items.push(...githubResults)
      }
      if (this.config.sources.includes("pypi")) {
        const pypiResults = await this.collectFromPyPI(topic)
        log.info("pypi results", { topic, count: pypiResults.length })
        items.push(...pypiResults)
      }
    }

    log.info("total collected", { total: items.length })
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
    const cfg = await Config.get()
    const apiKey = cfg.evolution?.exaApiKey

    if (!apiKey) {
      log.warn("Exa API key not configured in opencode.json evolution.exaApiKey")
      return []
    }

    try {
      const response = await fetch("https://mcp.exa.ai/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${apiKey}`,
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
        const errorText = await response.text().catch(() => "unknown error")
        throw new Error(`Exa API error: ${response.status} ${errorText.slice(0, 200)}`)
      }

      const responseText = await response.text()
      const lines = responseText.split("\n")
      const results: ExaSearchResult[] = []

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = JSON.parse(line.substring(6))

          if (data.result?.content) {
            for (const contentItem of data.result.content) {
              if (contentItem.text) {
                const text = contentItem.text
                log.info("received exa response", { textLength: text.length, preview: text.slice(0, 200) })

                // Try to parse as JSON first
                try {
                  const parsed = JSON.parse(text)
                  if (parsed.results && Array.isArray(parsed.results)) {
                    log.info("parsed json results", { count: parsed.results.length })
                    results.push(...parsed.results)
                    continue
                  }
                } catch {
                  // Not JSON, try to parse as text format
                }

                // Parse text format: "Title: ...\nURL: ...\nText: ..."
                const titleMatch = text.match(/Title:\s*(.+?)(?:\n|$)/)
                const urlMatch = text.match(/URL:\s*(.+?)(?:\n|$)/)
                const textMatch = text.match(/Text:\s*(.+?)(?:\n|$)/)

                if (titleMatch) {
                  results.push({
                    title: titleMatch[1].trim(),
                    url: urlMatch ? urlMatch[1].trim() : "",
                    text: textMatch ? textMatch[1].trim() : text,
                  })
                }
              }
            }
          }
        }
      }

      log.info("exaSearch completed", { query, resultsCount: results.length })
      return results
    } catch (e) {
      log.error("exaSearch failed", { query, error: String(e) })
      throw e
    }
  }
}
