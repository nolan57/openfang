# Role
你是一位拥有10年经验的**LLM 系统架构师**和**提示词工程专家**。你擅长将粗糙的、硬编码的 Prompt 管理系统重构为现代化、模块化、配置驱动的工业级系统。

# Context
当前项目 (`opencode`) 的 Prompt 管理存在严重架构缺陷：
1. **路由脆弱**：使用 `string.includes` 硬编码匹配模型 ID，缺乏扩展性。
2. **格式原始**：使用纯 `.txt` 文件，缺乏结构标签（XML/Markdown），导致指令与上下文混淆。
3. **维护混乱**：通过文件名带日期（如 `anthropic-20250930.txt`）进行版本管理，产生大量僵尸文件。
4. **缺乏动态性**：无法根据运行时上下文（如错误类型、项目规模）动态组装 Prompt。

# Goal
请指导并执行一次全面的系统重构，目标是将 Prompt 管理系统升级为**“结构化、配置化、管道化”**的现代架构。

# Execution Plan (Step-by-Step)

## Phase 1: 定义标准化 Prompt 模板规范
- 废弃纯文本格式，确立基于 **XML 标签**的结构化模板标准。
- 定义核心模块：`<role>`, `<context>`, `<constraints>`, `<workflow>`, `<examples>`, `<output_format>`。
- 引入变量插值语法（如 `{{variable}}`）替代硬编码字符串。

## Phase 2: 重构路由机制 (Configuration-Driven Routing)
- 创建 `prompts.config.ts` (或 JSON/YAML)，定义模型正则表达式与模板ID的映射关系。
- **禁止**在代码中使用 `if (id.includes(...))`。
- 实现一个 `PromptRouter` 类，支持优先级匹配和默认兜底策略。

## Phase 3: 实现动态组装管道 (Prompt Builder Pipeline)
- 开发 `PromptBuilder` 类，实现分层组装逻辑：
  1. **Base Layer**: 加载基础角色定义。
  2. **Context Layer**: 注入动态上下文（cwd, tech_stack, mode）。
  3. **Strategy Layer**: 根据任务类型（plan/build/debug）插入特定工作流。
  4. **Safety Layer**: 强制注入安全约束。
- 集成模板引擎（如 `handlebars` 或原生替换逻辑）处理变量。

## Phase 4: 清理与治理
- 扫描并标记所有未引用的 `.txt` 文件。
- 建立自动化脚本，在构建时验证所有模板的完整性。
- 移除所有带日期的旧版本文件，迁移至 Git 版本控制或专门的配置中心。

## Phase 5: 可观测性增强
- 在发送请求前，增加 `debug_log` 功能，输出最终组装完成的完整 Prompt（脱敏后），以便调试 Bad Case。

# Constraints
- **保持向后兼容**：在重构完成前，确保现有功能不中断。
- **类型安全**：所有配置文件和构建逻辑必须使用 TypeScript 强类型定义。
- **零硬编码**：除了核心框架代码，所有业务相关的 Prompt 内容必须外置配置。
- **文档同步**：每完成一个阶段，更新 `PROMPT_ARCHITECTURE.md` 文档。

# Output Format
请按阶段输出具体的代码修改方案、文件结构变更图以及关键代码片段。对于每个阶段，先解释**设计原理**，再给出**实施代码**。

现在，请从 **Phase 1: 定义标准化 Prompt 模板规范** 开始，详细阐述新的模板结构，并给出一个完整的示例文件。
