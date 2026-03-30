# OpenFang Hands 系统状态确认

## ✅ 当前保留的 5 个 Hands

根据 `/home/urio/Documents/openfang/crates/openfang-hands/bundled/` 目录确认：

| Hand               | 文件路径                  | 功能描述                                           | 类别         |
| ------------------ | ------------------------- | -------------------------------------------------- | ------------ |
| **Collector**      | `bundled/collector/`      | 24/7 情报收集，监控目标，构建知识图谱，变化检测    | Data         |
| **Researcher**     | `bundled/researcher/`     | 深度研究，跨源验证，CRAAP 可信度评估，生成引用报告 | Productivity |
| **Browser**        | `bundled/browser/`        | Web 自动化，导航/填写表单/点击，**购买审批保护**   | Productivity |
| **Trader**         | `bundled/trader/`         | 市场分析，多信号分析，交易信号生成，风险管理       | Data         |
| **Infisical-Sync** | `bundled/infisical-sync/` | 密钥同步，Infisical 集成，凭证管理，保险库操作     | Security     |

### 代码验证

```rust
// crates/openfang-hands/src/bundled.rs:6-33
pub fn bundled_hands() -> Vec<(&'static str, &'static str, &'static str)> {
    vec![
        ("collector", include_str!("../bundled/collector/HAND.toml"), ...),
        ("researcher", include_str!("../bundled/researcher/HAND.toml"), ...),
        ("browser", include_str!("../bundled/browser/HAND.toml"), ...),
        ("trader", include_str!("../bundled/trader/HAND.toml"), ...),
        ("infisical-sync", include_str!("../bundled/infisical-sync/HAND.toml"), ...),
    ]
}
```

**测试确认**: `bundled_hands_count()` 测试断言 `hands.len() == 5`

---

## ❌ 已移除的 Hands

根据记忆记录和代码搜索，以下 Hands 已被移除：

| Hand          | 移除原因                                    | 替代方案                  |
| ------------- | ------------------------------------------- | ------------------------- |
| **Clip**      | 依赖复杂（FFmpeg + yt-dlp + 5 个 STT 后端） | 可能需要重新实现          |
| **Lead**      | 功能重叠                                    | Researcher + 自定义工作流 |
| **Predictor** | 功能被 Trader 覆盖                          | Trader Hand               |
| **Twitter**   | 平台政策风险                                | 使用 Channel 系统         |

---

## 📊 Hands 功能对比

### Collector Hand

- **核心能力**: 持续监控、变化检测、知识图谱构建
- **工具**: `event_publish`, `memory_store`, `memory_recall`, `knowledge_add_entity`, `knowledge_add_relation`, `knowledge_query`, `schedule_*`
- **使用场景**: 竞争对手监控、技术趋势追踪、舆情分析
- **整合优先级**: ⭐⭐⭐⭐⭐ (最高)

### Researcher Hand

- **核心能力**: 深度研究、跨源验证、可信度评估、引用生成
- **工具**: `web_search`, `web_fetch`, `memory_store`, `memory_recall`, `schedule_*`
- **最大迭代次数**: 25 次
- **使用场景**: 市场调研、文献综述、竞品分析
- **整合优先级**: ⭐⭐⭐⭐⭐ (最高)

### Browser Hand

- **核心能力**: Web 自动化、表单填写、多步骤工作流
- **工具**: `browser_navigate`, `browser_click`, `browser_type`, `browser_screenshot`, `browser_read_page`, `browser_close`
- **依赖**: Python3 + Chromium
- **最大迭代次数**: 60 次
- **安全保护**: 购买前必须审批
- **使用场景**: 数据抓取、自动化测试、在线预订
- **整合优先级**: ⭐⭐⭐⭐

### Trader Hand

- **核心能力**: 市场分析、信号生成、风险管理、投资组合管理
- **工具**: `event_publish`, `memory_store`, `memory_recall`, `knowledge_*`, `schedule_*`
- **最大迭代次数**: 80 次
- **使用场景**: 股票/加密货币分析、市场预测、风险评估
- **整合优先级**: ⭐⭐⭐

### Infisical-Sync Hand

- **核心能力**: 密钥管理、凭证同步、保险库操作
- **工具**: `vault_set`, `vault_get`, `vault_list`, `vault_delete`, `shell_exec`, `knowledge_*`
- **依赖**: INFISICAL_URL, INFISICAL_CLIENT_ID, INFISICAL_CLIENT_SECRET
- **温度设置**: <0.2 (安全关键)
- **使用场景**: 密钥轮换、凭证备份、团队密钥共享
- **整合优先级**: ⭐⭐⭐⭐ (安全敏感)

---

## 🎯 整合建议

### 阶段 1 (优先级最高)

1. **Researcher Hand** - 直接可用，无外部依赖
2. **Collector Hand** - 直接可用，增强监控能力

### 阶段 2 (中等优先级)

3. **Browser Hand** - 需要 Playwright 集成
4. **Infisical-Sync Hand** - 需要 Infisical 账号

### 阶段 3 (可选)

5. **Trader Hand** - 特定领域，可能需要定制

---

## 📝 更新整合方案

原方案中提到的 7 个 Hands 应更新为 5 个：

```typescript
// packages/opencode/src/integration/hands-registry.ts
export const AvailableHands = {
  // ✅ 可用
  collector: {
    /* ... */
  },
  researcher: {
    /* ... */
  },
  browser: {
    /* ... */
  },
  trader: {
    /* ... */
  },
  "infisical-sync": {
    /* ... */
  },

  // ❌ 已移除 - 如需使用需自定义实现
  // clip: { /* 需要重新实现 */ },
  // lead: { /* 使用 Researcher + 工作流替代 */ },
  // predictor: { /* 使用 Trader 替代 */ },
  // twitter: { /* 使用 Channel 系统替代 */ },
}
```

---

## 🔍 验证命令

```bash
# 在 openfang 目录
cd /home/urio/Documents/openfang

# 查看 bundled hands 目录
ls crates/openfang-hands/bundled/
# 输出：browser collector infisical-sync researcher trader

# 运行 hands 测试
cargo test -p openfang-hands -- bundled_hands_count
# 输出：test result: ok. 1 passed

# 查看 HAND.toml 内容
cat crates/openfang-hands/bundled/researcher/HAND.toml
```

---

## 📞 影响评估

### 对整合方案的影响

1. **工作量减少**: 从 7 个减少到 5 个，减少约 30% 集成工作
2. **功能缺口**:
   - Clip (视频处理) - 需要额外集成
   - Lead (销售线索) - 可用 Researcher + 定制工作流替代
   - Twitter (社交媒体) - 可用 Channel 系统替代
3. **时间线调整**: 阶段 2 可从 2 周缩短到 1.5 周

### 推荐行动

1. ✅ **立即整合**: Researcher + Collector (无依赖，高价值)
2. ⚠️ **评估需求**: Browser (是否需要 Web 自动化)
3. ⚠️ **评估需求**: Infisical-Sync (是否使用 Infisical)
4. ⚠️ **评估需求**: Trader (是否需要交易分析)
5. 🔨 **自定义开发**: Clip/Lead/Twitter (如确实需要)

---

**结论**: OpenFang 当前包含**5 个成熟的自主 Hands**，聚焦于核心功能（研究、收集、浏览、交易、安全）。相比原计划的 7 个，减少了视频处理和社交媒体管理功能，但核心能力保持完整。建议优先整合 Researcher 和 Collector，根据实际需求评估其他 Hands。
