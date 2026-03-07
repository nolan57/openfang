# 小说自进化引擎重构完成报告

## 📋 重构概述

基于对 OpenCodeClaw 项目架构与 10 轮实际运行数据的深度对比分析，已完成对小说自进化引擎核心逻辑的全面重构。

**核心诊断**: 系统处于"伪进化"状态

- 仅实现"永久记忆（存储）"的皮毛
- 完全缺失"模式学习"和"技能演化"的核心算法
- 无论剧情成败，每轮机械地给所有角色发放通用 Mental_Analysis 技能

## ✅ 已完成的重构任务

### 1. 类型定义系统 (`src/types/novel-state.ts`)

创建了完整的类型定义系统，包含：

```typescript
// 核心类型
OutcomeType // SUCCESS | COMPLICATION | FAILURE | NEUTRAL
TurnResult // 回合结果（含 chaos_roll, outcome_type, challenge_difficulty）
CharacterState // 角色状态（stress 0-100, trauma[], skills[], relationships）
TraumaEntry // 创伤条目（含 source_event, severity, tags）
SkillEntry // 技能条目（含 source_event, difficulty, cooldown）
ValidatedChanges // 验证后的变更（含 auditFlags）

// 验证函数
validateSkillAward(outcome, difficulty) // 只有 SUCCESS+难度≥7 才允许技能
validateTraumaSeverity(stress, event) // stress>80 或单次>20 强制创伤
calculateStressDelta(baseStress, severity) // 计算压力变化
```

### 2. 状态提取器重构 (`src/novel/state-extractor.ts`)

重写核心状态提取逻辑：

**因果逻辑实现**:

- 只有 `SUCCESS + 难度≥7` 才允许技能
- `COMPLICATION/FAILURE` → 转压力 +15
- `stress > 80` 或单次事件>20 → 强制创伤
- 审计标志检测"失败加技能"等错误并自动修正

**Turn Evaluation**:

```typescript
interface TurnEvaluation {
  outcome_type: OutcomeType
  challenge_difficulty: number
  stress_events: { character: string; intensity: number; cause: string }[]
  relationship_changes: { pair: string; delta: number; cause: string }[]
  key_events: string[]
}
```

### 3. 审计中间件 (`src/middleware/state-auditor.ts`)

独立审计中间件，在写入 story_bible.json 前执行"审计"：

**审计功能**:

- 技能冷却检查（3 回合内同类技能限制）
- 信任变化上限（±50/回合）
- 压力上限钳制（0-100）
- 自动创伤生成（高压事件无创伤时）
- 自动修正"失败加技能"错误

**审计标志类型**:

```typescript
type AuditFlagType =
  | "SKILL_IN_FAILURE" // 失败回合加技能
  | "MISSING_TRAUMA" // 高压无创伤
  | "INFLATION" // 技能通胀
  | "IMPOSSIBLE_CHANGE" // 不可能的状态变化
  | "STRESS_OVERFLOW" // 压力超限
```

### 4. 系统 Prompt 重构 (`src/prompts/state-extraction-prompt.ts`)

创建通用、固有、永久性的系统 Prompt，作为小说自进化引擎的"宪法"：

**核心特性**:

- 不依赖具体剧情（适用于任何故事）
- 基于因果律的逻辑规则
- 强制负反馈机制
- 标准化分类体系

**Mandatory Causal Laws**:

1. **Skill Acquisition Logic** - 仅 SUCCESS+难度≥7 允许技能
2. **Stress Tracking** - 使用 DELTA 值，范围 0-100
3. **Trauma Generation** - stress>80 强制创伤
4. **Relationship Dynamics** - 基于行为而非距离
5. **Contradiction Check** - 检测逻辑矛盾

**使用方式**:

```typescript
import { buildStateExtractionPrompt } from "./prompts/state-extraction-prompt"

const prompt = buildStateExtractionPrompt({
  currentStateJson: JSON.stringify(currentState),
  narrativeText: storyText,
  chaosOutcome: "COMPLICATION",
  difficultyRating: 6,
})
```

### 5. 状态校准脚本 (`scripts/calibrate-state.ts`)

修复前 10 轮历史债务的校准工具，**使用专用的 `STATE_CALIBRATION_PROMPT`**：

**校准 Prompt 说明**:

- `STATE_CALIBRATION_PROMPT` 是专用的历史债务清洗 Prompt
- 与通用系统 Prompt (`NOVEL_STATE_EXTRACTION_PROMPT`) 分工不同
- 仅用于一次性校准，不参与日常回合的状态提取

**功能**:

- 读取现有 story_bible.json 和 fullStory 文本
- 调用 LLM + `STATE_CALIBRATION_PROMPT` 进行智能分析
- 清除通用技能（"洞察"、"逻辑"等）
- 根据剧情事件计算真实压力值
- 生成创伤条目
- 量化关系信任度
- 创建备份并写入校准后状态

**使用方式**:

```bash
cd packages/opencode
bun run scripts/calibrate-state.ts
```

**输出示例**:

```
📊 CALIBRATION SUMMARY
   林墨：stress=75, trauma=2, skills=3
   陈雨薇：stress=45, trauma=0, skills=2

   Average Stress: 60/100
   Total Trauma Entries: 2
   Total Skills (pruned): 5
```

### 6. 辅助文件更新

- `src/prompts/system-prompts.ts` - 导出新 prompt，保留 STATE_CALIBRATION_PROMPT
- `src/novel/types.ts` - 添加缺失的创伤标签（PSYCHOLOGICAL_FEAR 等）
- `src/novel/orchestrator.ts` - 修复类型错误，使用新的 skills/trauma 数组格式
- `src/novel/evolution-rules.ts` - 使用正确的创伤标签常量

## 🔧 核心缺陷修复对照表

| 缺陷         | 原行为                                    | 修复后行为                                                 |
| ------------ | ----------------------------------------- | ---------------------------------------------------------- |
| **技能通胀** | 每轮所有角色获得通用 Mental_Analysis 技能 | 仅 SUCCESS+难度≥7 允许技能，COMPLICATION/FAILURE转压力 +15 |
| **创伤缺失** | 10 轮无任何 trauma 生成                   | stress>80 或单次>20 强制创伤，审计器自动补发               |
| **压力跟踪** | stress 始终为 0                           | 基于事件类型计算 DELTA（审讯 +30-50，失败 +20-35）         |
| **关系空洞** | relationships 数组为空                    | 量化信任值（-100~100），背叛 -20~-50，合作 +10~+20         |
| **通用技能** | "洞察突破"、"逻辑专精"                    | "Bypassed_Neural_Firewall"、"Interrogation_Resistance_Lv4" |
| **混沌无效** | 掷骰结果仅文本描述                        | 直接影响数值（压力/创伤/信任）                             |
| **无审计**   | 无验证机制                                | StateAuditor 强制校验，自动修正错误                        |

## 📊 验收标准

- ✅ 编译无 TypeScript 错误
- ✅ 逻辑上完全杜绝"失败回合加技能"
- ✅ 强制要求在高压事件中生成 trauma 对象
- ✅ 技能名称生成逻辑包含事件来源引用（source_event）
- ✅ 关系数值变化有明确的计算依据
- ✅ 审计标志可追踪所有修正

## 🚀 后续操作

### 立即执行（修复历史债务）

```bash
cd /Users/lpcw/Documents/opencode/packages/opencode
bun run scripts/calibrate-state.ts
```

**注意**: 校准脚本使用专用的 `STATE_CALIBRATION_PROMPT`，与日常使用的通用系统 Prompt 分工不同。

### 继续生成（使用新逻辑）

校准后，现有生成命令将自动使用新的 `NOVEL_STATE_EXTRACTION_PROMPT` 提取器逻辑。

### 监控审计标志

查看生成的 story_bible.json 中：

```json
{
  "last_turn_evolution": {
    "auditFlags": [
      {
        "type": "SKILL_IN_FAILURE",
        "description": "...",
        "corrected": true
      }
    ]
  }
}
```

## 📝 Prompt 分工说明

系统有两种不同的 Prompt，用途不同：

| Prompt                          | 用途                     | 调用时机             |
| ------------------------------- | ------------------------ | -------------------- |
| `STATE_CALIBRATION_PROMPT`      | 历史债务清洗（一次性）   | 运行校准脚本时       |
| `NOVEL_STATE_EXTRACTION_PROMPT` | 日常回合状态提取（永久） | 每回合生成后自动调用 |

**校准完成后**，`STATE_CALIBRATION_PROMPT` 任务结束，后续仅使用 `NOVEL_STATE_EXTRACTION_PROMPT`。

## 🎯 架构对比

### 重构前

```
剧情生成 → 机械加技能 → story_bible（空关系/无创伤）
           ↓
       技能通胀，无负反馈
```

### 重构后

```
剧情生成 → Turn Evaluation (outcome/difficulty)
           ↓
    StateExtractor (因果逻辑)
           ↓
      StateAuditor (审计修正)
           ↓
story_bible（压力/创伤/关系/具体技能）
```

## 📚 关键文件清单

| 文件                                     | 类型 | 说明             |
| ---------------------------------------- | ---- | ---------------- |
| `src/types/novel-state.ts`               | 新建 | 完整类型定义系统 |
| `src/novel/state-extractor.ts`           | 重构 | 核心状态提取逻辑 |
| `src/middleware/state-auditor.ts`        | 新建 | 审计中间件       |
| `src/prompts/state-extraction-prompt.ts` | 新建 | 通用系统 Prompt  |
| `scripts/calibrate-state.ts`             | 新建 | 历史状态校准脚本 |
| `src/prompts/system-prompts.ts`          | 更新 | 导出新 prompt    |
| `src/novel/orchestrator.ts`              | 修复 | 类型错误修复     |
| `src/novel/evolution-rules.ts`           | 修复 | 创伤标签修复     |

---

**系统现已从"普发奖金机"转变为真正的"因果演化引擎"。**
