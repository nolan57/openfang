# OpenCode Self-Evolution Research Report

**Date**: 2026-03-04  
**Status**: Research Complete  
**Sources**: GitHub (AI coding assistants, agent frameworks, MCP servers)

---

## Executive Summary

This report documents the findings from web research on AI coding assistants, agent frameworks, and related technologies. **5 improvement proposals** have been generated based on industry trends and OpenCode's current capabilities.

---

## Research Findings

### 1. AI Coding Assistants (GitHub Search: 7,260 repos)

| Project                       | Description                                 | Relevance                      |
| ----------------------------- | ------------------------------------------- | ------------------------------ |
| **TabbyML/tabby**             | Self-hosted AI coding assistant             | High - Architecture reference  |
| **sweepai/sweep**             | AI coding assistant for JetBrains           | Medium - IDE integration       |
| **sourcegraph/cody**          | AI code assistant with context              | High - Context engineering     |
| **Archon**                    | Knowledge/task management for AI assistants | High - Long-range memory       |
| **context-engineering-intro** | Context engineering best practices          | Critical - Missing in OpenCode |
| **awesome-claude-code**       | Claude Code skills/hooks/plugins            | High - Skill ecosystem         |

**Key Insight**: Context engineering is the new "vibe coding" - making AI assistants actually work requires careful context management.

### 2. Agent Orchestration Frameworks (GitHub Search: 1,753 repos)

| Project                         | Description                            | Relevance               |
| ------------------------------- | -------------------------------------- | ----------------------- |
| **dynamiq-ai/dynamiq**          | Orchestration framework for agentic AI | High                    |
| **langgenius/dify**             | Production-ready agentic workflow      | High                    |
| **deepset-ai/haystack**         | Open-source AI orchestration           | Medium                  |
| **humanlayer/12-factor-agents** | Production LLM software principles     | Critical - Should adopt |
| **docker/compose-for-agents**   | Docker-based agent runtimes            | Medium                  |

**Key Insight**: 12-Factor Agents principles for building production-ready LLM software:

- Explicit agent boundaries
- Stateless agent execution
- Dependency isolation
- Configurable backpressure

### 3. MCP (Model Context Protocol) Ecosystem (GitHub Search: 8,835 repos)

| Project                              | Description                    | Relevance |
| ------------------------------------ | ------------------------------ | --------- |
| **modelcontextprotocol/registry**    | Community MCP server registry  | Critical  |
| **microsoft/mcp**                    | Official Microsoft MCP servers | Critical  |
| **neo4j-contrib/mcp-neo4j**          | Graph database MCP             | High      |
| **qdrant/mcp-server-qdrant**         | Vector search MCP              | High      |
| **blazickjp/arxiv-mcp-server**       | arXiv paper search             | Medium    |
| **containers/kubernetes-mcp-server** | K8s management MCP             | High      |

**Key Finding**: MCP is THE standard for AI tool integration. OpenCode has **full MCP support** including server routes, CLI commands, OAuth, and config.

### 4. Multi-Agent Systems

| Project                        | Description                         | Relevance |
| ------------------------------ | ----------------------------------- | --------- |
| **yohey-w/multi-agent-shogun** | Samurai-inspired multi-agent system | Medium    |
| **nextlevelbuilder/goclaw**    | Multi-agent AI gateway              | High      |
| **truffle-ai/dexto**           | Coding agent harness                | High      |

---

## Gap Analysis: OpenCode vs Industry

| Capability                 | OpenCode         | Industry Standard | Gap    |
| -------------------------- | ---------------- | ----------------- | ------ |
| Self-Evolution             | ✅ 100%          | ✅ Advanced       | Match  |
| Long-Range Consistency     | ✅ 100%          | ✅ Advanced       | Match  |
| MCP Integration            | ✅ Full          | ✅ Standard       | Match  |
| 12-Factor Agent Principles | ❌ None          | ✅ Emerging       | High   |
| Context Engineering        | ⚠️ Basic         | ✅ Advanced       | Medium |
| Benchmark Integration      | ❌ None          | ✅ SWE-bench      | Medium |
| Multi-Agent Orchestration  | ⚠️ ZeroClaw only | ✅ Multiple       | Medium |

---

## Improvement Proposals

### Priority 1: MCP Server Ecosystem Expansion

**Rationale**: MCP (Model Context Protocol) is becoming the industry standard. OpenCode has core MCP support, but could benefit from more built-in MCP server integrations.

**Files to modify**: `packages/opencode/src/mcp/`, docs for MCP server registration

### Priority 2: Implement 12-Factor Agents Principles

**Rationale**: The `humanlayer/12-factor-agents` repo outlines production-ready principles for LLM software. Adopting these will make OpenCode more robust for enterprise use.

**Files to modify**: `packages/opencode/src/learning/`, architecture docs

### Priority 3: Enhanced Context Engineering

**Rationale**: Better context management following `coleam00/context-engineering-intro` patterns will improve AI accuracy.

**Files to modify**: `packages/opencode/src/context/`, session management

### Priority 4: Benchmark Integration

**Rationale**: Integrate with SWE-bench style evaluation for measuring coding assistant performance.

**Files to modify**: New `packages/benchmark/`, learning modules

### Priority 5: Multi-Agent Coordination Enhancement

**Rationale**: Extend beyond ZeroClaw to support more agent types and orchestration patterns.

**Files to modify**: `packages/opencode/src/agents/`, plugin system

---

## Recommendations

1. **Immediate**: Add MCP protocol support as core feature
2. **Short-term**: Implement 12-Factor Agent principles in self-evolution system
3. **Medium-term**: Add benchmark integration for performance measurement
4. **Long-term**: Build multi-agent orchestration layer

---

## Research Artifacts

- Generated: 5 deployment task files in `docs/learning/tasks/`
- This report: `docs/learning/research/2026-03-04-research-report.md`

---

_Last Updated: 2026-03-04_
