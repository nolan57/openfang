# Novel 与 Evolve 系统集成架构

## 问题解答

**问：** 如果 novel 和 evolve 是两个独立的系统，`evolve novel` 命令是如何工作的？

**答：** `novel` 和 `evolve` 并不是完全独立的系统。**Novel Engine 是 Evolve 自进化系统的一个专门应用领域**。它们的关系如下：

---

## 系统架构关系

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        OpenCode Evolution System                       │
│                         (通用自进化框架)                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────┐    ┌──────────────────────┐                  │
│  │  General Evolution   │    │   Novel Engine       │                  │
│  │  (通用自进化)         │    │   (小说引擎)          │                  │
│  │                      │    │                      │                  │
│  │  - skill.ts          │    │  - orchestrator.ts   │                  │
│  │  - prompt.ts         │    │  - pattern-miner.ts  │                  │
│  │  - memory.ts         │    │  - evolution-rules.ts│                  │
│  │  - store.ts          │    │  - character-deepener│                  │
│  │                      │    │  - relationship-...  │                  │
│  └──────────────────────┘    └──────────────────────┘                  │
│           │                              │                               │
│           └──────────────┬───────────────┘                               │
│                          │                                               │
│                          ▼                                               │
│           ┌──────────────────────────────┐                              │
│           │   Shared Components          │                              │
│           │   - getNovelLanguageModel()  │                              │
│           │   - analyzeAndEvolve()       │                              │
│           │   - PatternMiner             │                              │
│           └──────────────────────────────┘                              │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 关键集成点

### 1. `analyzeAndEvolve()` - 核心集成函数

**位置：** `novel/orchestrator.ts:1159`

这是连接 evolve 和 novel 的关键函数：

```typescript
/**
 * Standalone function to analyze and evolve patterns
 */
export async function analyzeAndEvolve(context: string, currentPatterns: any[] = []): Promise<void> {
  // 1. 调用 LLM 分析故事模式
  const languageModel = await getNovelLanguageModel()

  // 2. 提取新的叙事模式
  const prompt = `Analyze this story segment and extract unique patterns...`
  const result = await generateText({ model: languageModel, prompt })

  // 3. 保存发现的模式
  const newPatterns = JSON.parse(result.text)
  await saveDynamicPatterns([...existing, ...newPatterns])

  // 4. 检查是否需要生成技能
  await checkAndGenerateSkills(context)
}
```

**调用链路：**

```
CLI: evolve novel
  ↓
novel.ts:handleEvolve()
  ↓
orchestrator.ts:analyzeAndEvolve()
  ↓
PatternMiner: 分析故事 → 提取模式 → 保存模式
```

---

### 2. 共享组件

#### getNovelLanguageModel()

**位置：** `novel/model.ts`

两个系统共享同一个 LLM 获取函数：

```typescript
// evolution/skill.ts 使用
import { getNovelLanguageModel } from "../novel/model"

// evolution/prompt.ts 使用
import { getNovelLanguageModel } from "../novel/model"

// evolution/consistency-checker.ts 使用
import { getNovelLanguageModel } from "../novel/model"

// novel/orchestrator.ts 使用
import { getNovelLanguageModel } from "./model"
```

**这意味着：**

- Evolve 系统生成的技能使用 novel 的 LLM
- Novel 系统生成的模式可以被 evolve 使用
- 两者共享相同的模型配置和 fallback 链

---

### 3. PatternMiner - 共享模式挖掘

**位置：** `novel/pattern-miner.ts` 和 `novel/pattern-miner-enhanced.ts`

PatternMiner 是两个系统的核心交汇点：

```typescript
// Novel Engine 使用 PatternMiner
import { PatternMiner, loadDynamicPatterns } from "@/novel"

const patterns = await loadDynamicPatterns()
const miner = new PatternMiner()
await miner.extract(storySegment)

// Evolve System 也使用 PatternMiner
import { analyzeAndEvolve } from "@/novel/orchestrator"

await analyzeAndEvolve(storyContext, patterns)
```

**共享的数据存储：**

```
.opencode/novel/patterns/dynamic-patterns.json
├─ patterns: [...]       // Novel 发现的模式
├─ skills: [...]         // Evolve 生成的技能
└─ lastUpdated: timestamp
```

---

## CLI 命令流程

### `opencode novel evolve` 命令

**文件：** `cli/cmd/novel.ts:88-95`

```typescript
async function handleEvolve() {
  console.log("Triggering PatternMiner evolution...")

  // 1. 加载已有的模式
  const patterns = await loadDynamicPatterns()

  // 2. 获取 orchestrator 和故事状态
  const engine = await getOrchestrator()
  const state = engine.getState()

  // 3. 调用 analyzeAndEvolve 分析整个故事
  await analyzeAndEvolve(state.fullStory || "", patterns)

  console.log("✓ Evolution complete!")
}
```

**执行流程：**

```
1. opencode novel evolve
   ↓
2. novel.ts:handleEvolve()
   ↓
3. Load patterns from .opencode/novel/patterns/dynamic-patterns.json
   ↓
4. Get full story from orchestrator state
   ↓
5. analyzeAndEvolve(fullStory, patterns)
   ↓
6. LLM 分析故事 → 提取新模式
   ↓
7. 保存新模式到 dynamic-patterns.json
   ↓
8. checkAndGenerateSkills() → 可能生成新技能
   ↓
9. ✓ Evolution complete!
```

---

### `opencode novel start [prompt]` 命令

**文件：** `cli/cmd/novel.ts:28-68`

```typescript
async function handleStart(args: any) {
  // 1. 加载提示词
  let promptContent = "Starting new creative session..."
  if (args.prompt) {
    promptContent = await readFile(args.prompt, "utf-8")
  }

  // 2. 创建 orchestrator
  const engine = await getOrchestrator()

  // 3. 运行自进化循环
  for (let i = 0; i < loops; i++) {
    // 每轮之间分析模式
    if (i > 0) {
      await analyzeAndEvolve(promptContent, await loadDynamicPatterns())
    }

    // 生成故事
    const result = await engine.runNovelCycle(promptContent)
  }
}
```

**执行流程：**

```
1. opencode novel start prompt.md
   ↓
2. Load prompt from prompt.md
   ↓
3. Create EvolutionOrchestrator
   ↓
4. Loop N times:
   a. analyzeAndEvolve() → 提取模式
   b. runNovelCycle() → 生成故事
   c. StateExtractor → 提取状态变更
   d. EvolutionRules → 应用规则
   e. Save state to .opencode/novel/state/story_bible.json
   ↓
5. ✓ Complete!
```

---

## 数据流图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Novel/Evolve Data Flow                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  User Input (prompt.md)                                                 │
│       │                                                                 │
│       ▼                                                                 │
│  ┌─────────────────────────┐                                           │
│  │  EvolutionOrchestrator  │                                           │
│  │  - runNovelCycle()      │                                           │
│  │  - generateStory()      │                                           │
│  └─────────────────────────┘                                           │
│       │                                                                 │
│       ▼                                                                 │
│  Story Output (fullStory)                                              │
│       │                                                                 │
│       ├──────────────────────────────────┐                             │
│       │                                  │                             │
│       ▼                                  ▼                             │
│  ┌──────────────────┐         ┌──────────────────┐                    │
│  │ StateExtractor   │         │ analyzeAndEvolve │                    │
│  │ - Extract state  │         │ - Extract patterns│                   │
│  │ - Apply rules    │         │ - Generate skills │                   │
│  └──────────────────┘         └──────────────────┘                    │
│       │                                  │                             │
│       ▼                                  ▼                             │
│  story_bible.json              dynamic-patterns.json                   │
│  - characters                  - patterns[]                            │
│  - world                       - skills[]                              │
│  - relationships               - lastUpdated                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 共享数据存储

### 1. 故事圣经 (Story Bible)

**路径：** `.opencode/novel/state/story_bible.json`

```json
{
  "characters": {
    "Alice": {
      "status": "active",
      "stress": 45,
      "skills": [...],
      "trauma": [...]
    }
  },
  "relationships": {...},
  "world": {...},
  "fullStory": "Chapter 1: ...\nChapter 2: ...",
  "chapterCount": 2
}
```

**使用者：**

- Novel: 更新状态
- Evolve: 读取状态进行模式分析

---

### 2. 动态模式 (Dynamic Patterns)

**路径：** `.opencode/novel/patterns/dynamic-patterns.json`

```json
{
  "patterns": [
    {
      "keyword": "tragic_backstory",
      "category": "character_trait",
      "description": "Character motivated by past trauma"
    },
    {
      "keyword": "reluctant_alliance",
      "category": "plot_device",
      "description": "Enemies forced to cooperate"
    }
  ],
  "skills": [...],
  "lastUpdated": 1710518400000
}
```

**使用者：**

- Novel: 指导故事生成
- Evolve: 生成新技能的基础

---

### 3. 技能库 (Skills)

**路径：** `.opencode/novel/skills/*.md`

```markdown
# Auto-Generated Narrative Skill

Generated: 2024-03-15T10:00:00.000Z

## Trigger

Character faces impossible moral choice

## Guidelines

1. Present both sides of the dilemma fairly
2. Show internal conflict through action
3. Avoid easy solutions

## Examples

- "I can't save both of them..."
- She hesitated, hand trembling over the switch
```

**生成者：**

- Evolve: `checkAndGenerateSkills()` 自动生成

**使用者：**

- Novel: 指导叙事决策

---

## 总结

### Novel 和 Evolve 的关系

| 特性         | Novel Engine            | Evolve System           | 关系                       |
| ------------ | ----------------------- | ----------------------- | -------------------------- |
| **目的**     | 小说故事生成            | 通用自进化              | Novel 是 Evolve 的应用领域 |
| **核心组件** | EvolutionOrchestrator   | Skill/Prompt/Memory     | 共享 analyzeAndEvolve      |
| **LLM 获取** | getNovelLanguageModel() | getNovelLanguageModel() | **完全相同**               |
| **模式挖掘** | PatternMiner            | PatternMiner            | **完全相同**               |
| **数据存储** | story_bible.json        | dynamic-patterns.json   | **相互读写**               |
| **CLI 命令** | `opencode novel`        | `opencode evolve`       | Novel 是子命令             |

### 答案

**Novel 和 Evolve 不是独立系统，而是：**

1. **Novel Engine 是 Evolve 自进化框架在小说创作领域的专门应用**
2. **两者共享核心组件：**
   - `getNovelLanguageModel()` - LLM 获取
   - `analyzeAndEvolve()` - 模式分析
   - `PatternMiner` - 模式挖掘
   - `Skill` - 技能生成
3. **共享数据存储：**
   - Novel 生成的故事 → Evolve 分析的输入
   - Evolve 生成的技能 → Novel 使用的指导
   - 共同维护的模式库

### `evolve novel` 的工作原理

```
用户执行：opencode novel evolve
         ↓
CLI: novel.ts:handleEvolve()
         ↓
加载：.opencode/novel/patterns/dynamic-patterns.json
         ↓
读取：orchestrator.getState().fullStory
         ↓
调用：analyzeAndEvolve(fullStory, patterns)
         ↓
LLM 分析故事 → 提取新模式 → 保存到模式库
         ↓
检查是否需要生成技能 → 保存到技能库
         ↓
完成！
```

**这就是为什么 Novel 和 Evolve 可以无缝协作的原因！** 🎯

---

_Document generated on 2026-03-15_
_Novel-Evolve Integration Architecture_
