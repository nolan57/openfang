# Novel Engine 硬编码分析报告

## 概述

本报告分析 `packages/opencode/src/novel/` 模块中的所有硬编码内容，并评估是否应该像混乱表那样进行动态化处理。

---

## 硬编码分类

### 1. 类型和分类常量 ✅ 保持硬编码

**位置：** `types.ts`

```typescript
export const TRAUMA_TAGS = {
  VISUAL: "PTSD_Visual",
  NIGHTMARE: "PTSD_Nightmare",
  FLASHBACK: "PTSD_Flashback",
  PAIN: "Physical_Pain",
  // ... 20+ 种创伤类型
}

export const SKILL_CATEGORIES = {
  ANALYSIS: "Mental_Analysis",
  DEDUCTION: "Mental_Deduction",
  // ... 20+ 种技能类别
}

export const CHARACTER_STATUS = {
  ACTIVE: "active",
  INJURED: "injured",
  STRESSED: "stressed",
  // ... 10+ 种状态
}

export const ATTACHMENT_STYLES = {
  SECURE: "secure",
  ANXIOUS: "anxious",
  AVOIDANT: "avoidant",
  DISORGANIZED: "disorganized",
}
```

**分析：**

- ✅ **应该保持硬编码**
- 这些是**数据模型的 schema 定义**
- 需要与数据库、UI、API 保持一致
- LLM 生成内容时会 reference 这些固定值

**建议：** 保持不变，但可以考虑让 LLM 扩展新类型

---

### 2. 提示词模板 ⚠️ 部分动态化

**位置：** `evolution-rules.ts`, `character-deepener.ts`, 等

```typescript
// evolution-rules.ts
const STATE_CHANGE_EVALUATION_PROMPT = `You are a strict game master (GM) responsible for extracting state changes from story text.

Character State Rules:
- Skill Award: A character can only receive a new skill when they successfully overcome a specific and challenging obstacle.
- Trauma Trigger: A character receives trauma when experiencing life-threatening events...

Your task:
Analyze the story segment below. Identify ALL skill awards and trauma triggers following the rules above.

Output Format (strict JSON):
{
  "skill_awards": [...],
  "trauma_awards": [...]
}

Story Segment:
{{STORY_SEGMENT}}

Output only JSON, no other text.`
```

**分析：**

- ⚠️ **部分需要动态化**
- 核心规则应该保持（技能/创伤获取规则）
- 但提示词的语气、风格可以适配故事基调
- 当前是静态的，不考虑故事类型（奇幻/科幻/言情等）

**建议改进：**

```typescript
// 添加动态提示词生成器
async function buildStateEvaluationPrompt(storySegment: string, storyTone?: string, genre?: string): Promise<string> {
  const toneInstruction = storyTone
    ? `The story tone is "${storyTone}". Pay attention to events that match this tone.`
    : ""

  const genreInstruction = genre ? `This is a ${genre} story. Consider genre-appropriate skills and traumas.` : ""

  return `You are a strict game master...
  
${toneInstruction}
${genreInstruction}

Story Segment:
${storySegment}

...`
}
```

---

### 3. 权重和评分公式 ⚠️ 可配置化

**位置：** `branch-manager.ts`

```typescript
calculateBranchScore(branch: Branch): number {
  const weights = {
    narrativeQuality: 0.25,
    tensionLevel: 0.15,
    characterDevelopment: 0.20,
    plotProgression: 0.15,
    characterGrowth: 0.10,
    riskReward: 0.05,
    thematicRelevance: 0.10,
  }

  return (
    branch.evaluation.narrativeQuality * weights.narrativeQuality +
    branch.evaluation.tensionLevel * weights.tensionLevel +
    // ...
  )
}
```

**分析：**

- ⚠️ **应该可配置**
- 当前权重是硬编码的
- 不同类型的故事可能需要不同权重
  - 动作故事：tensionLevel 权重更高
  - 角色驱动故事：characterDevelopment 权重更高
  - 主题驱动故事：thematicRelevance 权重更高

**建议改进：**

```typescript
interface ScoringConfig {
  weights: {
    narrativeQuality: number
    tensionLevel: number
    characterDevelopment: number
    plotProgression: number
    characterGrowth: number
    riskReward: number
    thematicRelevance: number
  }
  storyType?: "action" | "character" | "theme" | "balanced"
}

const PRESET_CONFIGS: Record<string, ScoringConfig> = {
  action: {
    weights: {
      narrativeQuality: 0.2,
      tensionLevel: 0.3, // 更高
      characterDevelopment: 0.15,
      // ...
    },
  },
  character: {
    weights: {
      characterDevelopment: 0.35, // 更高
      // ...
    },
  },
  balanced: {
    /* 默认权重 */
  },
}
```

---

### 4. 阈值和限制 ⚠️ 可配置化

**位置：** 多处

```typescript
// evolution-rules.ts
private static readonly STRESS_THRESHOLD_CRITICAL = 90
private static readonly STRESS_THRESHOLD_HIGH = 70
private static readonly STRESS_DELTA_LARGE = 20
private static readonly DIFFICULTY_THRESHOLD_HIGH = 7

// branch-manager.ts
const DEFAULT_PRUNING_CONFIG: BranchPruningConfig = {
  maxBranches: 20,
  minQualityThreshold: 3,
  keepSelectedBranches: true,
  pruneAfterChapters: 5,
}

// pattern-vector-index.ts
const DEFAULT_CONFIG: VectorIndexConfig = {
  embeddingDimension: 1536,
  similarityThreshold: 0.7,
  maxResults: 10,
}
```

**分析：**

- ⚠️ **应该可配置**
- 当前是硬编码的常量
- 不同用户可能偏好不同难度/密度
- 不同类型故事需要不同阈值

**建议改进：**

```typescript
interface NovelConfig {
  stressThresholds: {
    critical: number // 默认 90
    high: number // 默认 70
  }
  branchConfig: {
    maxBranches: number
    minQualityThreshold: number
  }
  difficulty: "easy" | "normal" | "hard" | "nightmare"
}

const DIFFICULTY_PRESETS: Record<string, NovelConfig> = {
  easy: {
    stressThresholds: { critical: 100, high: 80 }, // 更宽容
    branchConfig: { maxBranches: 30, minQualityThreshold: 2 },
  },
  hard: {
    stressThresholds: { critical: 80, high: 60 }, // 更严苛
    branchConfig: { maxBranches: 10, minQualityThreshold: 5 },
  },
}
```

---

### 5. 关系类型和动态 ✅ 保持硬编码 + LLM 扩展

**位置：** `faction-detector.ts`, `relationship-analyzer.ts`

```typescript
export const FACTION_TYPES = [
  "alliance",
  "opposition",
  "neutral",
  "underground",
  "religious",
  "military",
  "political",
  "economic",
  "ideological",
  "familial",
  "cooperative",
]

export const RELATIONSHIP_TYPES = [
  "ally",
  "rival",
  "mentor",
  "lover",
  "enemy",
  // ...
]
```

**分析：**

- ✅ **基本类型保持硬编码**
- 这些是核心数据模型
- 但 LLM 应该能够识别和创建新的子类型

**建议改进：**

```typescript
// 基础类型硬编码，LLM 可以扩展子类型
interface Relationship {
  type: RelationshipType  // 基础类型（硬编码）
  subType?: string        // LLM 生成的子类型
  description?: string    // LLM 生成的描述
}

// 示例
{
  type: "ally",
  subType: "reluctant_ally",  // LLM 生成
  description: "Allied due to common enemy, but distrustful"
}
```

---

### 6. 生命周期阶段 ⚠️ 可动态化

**位置：** `character-lifecycle.ts`

```typescript
export const CharacterLifeStageSchema = z.enum([
  "infant",
  "child",
  "adolescent",
  "young_adult",
  "adult",
  "middle_aged",
  "elder",
  "ancient",
])
```

**分析：**

- ⚠️ **对于奇幻/科幻故事可能不够**
- 现代/现实故事：当前设置足够
- 奇幻故事：可能需要 "magical_child", "ascended", "undead" 等
- 科幻故事：可能需要 "cyborg", "digital_consciousness", "cloned" 等

**建议改进：**

```typescript
// 保持基础阶段，但允许 LLM 扩展
const BASE_LIFE_STAGES = [
  "infant", "child", "adolescent",
  "young_adult", "adult", "middle_aged",
  "elder", "ancient",
]

interface CharacterLifecycle {
  baseStage: LifeStage  // 基础阶段（硬编码）
  modifiedStage?: string  // LLM 生成的变体
  stageDescription?: string  // LLM 描述
}

// 示例
{
  baseStage: "adult",
  modifiedStage: "cursed_immortal_adult",
  stageDescription: "Physically adult but cursed with immortality"
}
```

---

### 7. 故事类型和基调 🔲 完全动态化

**当前位置：** 未明确定义，分散在各处

**分析：**

- 🔲 **应该完全由 LLM 决定**
- 当前没有明确的故事类型/基调配置
- 这应该完全由用户输入和 LLM 分析决定

**建议实现：**

```typescript
interface StoryProfile {
  genre: string // LLM 分析得出
  tone: string // LLM 分析得出
  themes: string[] // LLM 分析得出
  targetAudience: string // LLM 分析得出
  contentRating: string // LLM 分析得出
}

async function analyzeStoryProfile(
  initialPrompt: string,
  userPreferences?: Partial<StoryProfile>,
): Promise<StoryProfile> {
  // 调用 LLM 分析故事类型和基调
  // 用于调整后续所有生成的风格
}
```

---

## 总结和建议

### 保持硬编码（✅）

| 项目         | 原因                           |
| ------------ | ------------------------------ |
| 数据类型定义 | 需要与数据库、API、UI 保持一致 |
| Schema 验证  | Zod schemas 需要固定结构       |
| 核心关系类型 | 基础分类，LLM 可扩展子类型     |

### 可配置化（⚠️）

| 项目         | 建议                |
| ------------ | ------------------- |
| 评分权重     | 按故事类型预设配置  |
| 阈值限制     | 按难度等级预设配置  |
| 生命周期阶段 | 基础 + LLM 扩展变体 |

### 完全动态化（🔲）

| 项目          | 建议                 |
| ------------- | -------------------- |
| 提示词风格    | 根据故事基调动态调整 |
| 故事类型/基调 | 完全由 LLM 分析决定  |
| 具体事件生成  | 已完成（混乱表）     |
| 角色/情节细节 | 完全由 LLM 生成      |

---

## 优先级排序

| 优先级 | 项目           | 工作量 | 影响 |
| ------ | -------------- | ------ | ---- |
| 🔴 高  | 提示词动态化   | 中     | 高   |
| 🟡 中  | 评分权重可配置 | 低     | 中   |
| 🟡 中  | 阈值可配置     | 低     | 中   |
| 🟢 低  | 生命周期扩展   | 中     | 低   |
| 🟢 低  | 关系子类型     | 低     | 低   |

---

## 下一步行动

1. **实现提示词动态生成器** - 根据故事基调调整提示词风格
2. **添加难度配置** - easy/normal/hard/nightmare 预设
3. **添加故事类型预设** - action/character/theme 评分权重预设
4. **保持核心数据模型** - 类型定义保持硬编码

---

_Report generated on 2026-03-15_
_Novel Engine Hardcoding Analysis_
