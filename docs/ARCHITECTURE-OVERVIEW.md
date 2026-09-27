# 架构全景（实测版）

> R6 第 1 步产出 · lead-arena-0925c · 2026-09-27 第 121 轮 · **v1**（§6 列出还没画到的部分）。
> 与 `docs/ARCHITECTURE.md` 的分工：那份是**规划与决策树**（任务 → 文件）；本文件记录**代码实际是什么样**，由脚本测量，并逐条对照规划，差异单独列出。
> 两者冲突时，以代码为准；本文件负责把冲突写出来。

## 0. 测量方法（可复跑）

- 脚本 `.zc/perf/archmap.mjs`（`.zc/` 不进 git；丢失时按本节重写，约 40 行），输出 `.zc/perf/archmap.out`。
- 扫描面：`git ls-files` 下的 `src/**/*.{ts,vue}`，不含测试和 `.d.ts`。
- 分组：按 `src/` 下的一级目录；`core/` 和 `composables/` 再拆到二级子目录。
- 依赖边：`import` / `export … from` / 动态 `import()`；`import type` 单独计数。
- ⚠ 脚本把 `@/mechanics`（目录入口 `index.ts`）归到了 `(root)` 组。下文已人工改正：`(root)` 的入边除 `main.ts` 外全部是 `@/mechanics`，共 31 处。

## 1. 实测规模（非测试代码）

| 组 | 文件 | 行数 | 规划中的层 |
|---|---|---|---|
| mechanics | 67 | 29 759 | 录入层 |
| composables（顶层） | 50 | 12 780 | 编排层 |
| views | 19 | 12 027 | 展示层 |
| components | 21 | 9 974 | 展示层 |
| composables/resourceCalc | 20 | 6 483 | 编排层 |
| core（顶层） | 20 | 5 341 | 引擎层 |
| core/resource | 23 | 4 221 | 引擎层 |
| types | 11 | 3 817 | — |
| data | 19 | 2 060 | 「公共底」 |
| stores | 5 | 2 032 | 状态层 |
| core/anomalyPool | 2 | 1 501 | 引擎层 |
| composables/freeCompare | 4 | 1 099 | 编排层 |
| utils | 8 | 1 018 | — |
| specs | 8 | 977 | 录入层 |
| composables/charts | 4 | 509 | 编排层 |
| core/stunAxis | 1 | 383 | 引擎层 |
| logicEditor | 6 | 383 | —（规划未提） |

**读法**：
- 录入层（mechanics）是最大的一层，接近全部引擎代码（core 合计约 11 400 行）的 2.6 倍。角色知识的主体在这里，这符合「角色逻辑回模块」的方向。
- 编排层（composables 合计约 20 900 行）比引擎层还大。规划说编排层是「胶水」，实际上它承担了大量计算，§3 A4 待查。

## 2. 实测依赖方向（值依赖，括号内为 type-only 次数）

主干（与规划一致）：
- `views → composables`（51 条值边）、`views → components`（20）、`views → stores`（31）、`views → utils`（27）
- `components → composables`（40）、`components → stores`（18）
- `composables/resourceCalc → core`（31，type 9）、`→ core/resource`（6）、`→ core/anomalyPool`（4）
- `composables → core`（16）、`composables → stores`（24，type 11）、`composables → data`（28）
- `mechanics → specs`（66，spec 解释器）、`mechanics → core`（26）、`mechanics → utils`（21）、`mechanics → types`（type 76）

与规划不一致、或规划没写到的边，见 §3。

## 3. 与 `docs/ARCHITECTURE.md` §0 的差异（实测）

| # | 规划怎么说 | 代码实际 | 证据 | 判断 |
|---|---|---|---|---|
| A1 | 「录入层被编排 / 引擎经 **registry** 消费」 | core 直接按值 import **`@/mechanics`（index.ts）**，而 index.ts 一次性 import 全部 62 个角色模块并逐个注册。形成模块环：core → mechanics/index → agents/*.ts → core | `core/resource/` 下 11 个文件加 `core/substatOptimizer.ts` 都写 `import { getAgentMechanic } from '@/mechanics'`；全仓 core、composables、mechanics、stores 共 31 处；`src/mechanics/index.ts` 开头是 62 行 import | 精神上符合（按能力查询，不写 id），但实现上是「靠副作用注册 + 环」。后果：core 的任何单测都会加载全部角色模块；ESM 环依赖对初始化顺序敏感。**是 R6 候选**（见 §5） |
| A2 | 状态层 = 「队伍 / 敌人 / 设置 / 滑块（可变）、只读数据快照」 | `stores/config.ts` 直接调用引擎：`calcPanel`、`computeOptimalSubStats`（`core/substatOptimizer`）、`buildTeammateBuffSourceContext`，还查询 mechanics 注册表 | `stores/config.ts:9–14` | 状态层掺了计算。**是 R6 候选**：计算应该上移到编排层，或者明确承认 store 可以调用引擎，并写进规划 |
| A3 | `src/data/` 是「各层都可依赖的公共底」 | data 并不全是常量。`data/moveTableQueries.ts` 依赖 `logicEditor/fusion.ts` 的全局 `shallowRef`，这个状态由 `stores/logicEditor.ts` 写入（`setActiveRowFusionRules`）。「公共底」读的是运行时可变的全局状态 | `data/moveTableQueries.ts:26`、`logicEditor/fusion.ts:1`、`stores/logicEditor.ts:4` | 隐式全局状态。已核实**不成环**：`logicEditor/fusion.ts` 只依赖 vue；specs → core 只出现在校验工具 `specs/verify.ts`。影响面待 R6 第 2 步评估 |
| A4 | 编排层 = 「页面与引擎之间的胶水」 | composables 合计约 20 900 行，大于引擎层的约 11 400 行；resourceCalc/ 下有 damagePool 等计算模块 | §1 | **待查**：哪些是计算、哪些是胶水。这是 R6「可归一」最可能出现的地方 |
| A5 | 规划没有提到 `logicEditor/` | 6 个文件 383 行，被 stores、views、data、composables 依赖 | §2 | 补进规划的层次图 |

## 4. 效果管线（catalog 效果 → 面板 → 伤害），函数级

R5 对账主要用这一段。

```
public/static/catalog.json
  └─ stores/catalog.ts（加载，只读快照）
core/panel.ts
  calcPanel(...)                                   ← 9 个文件调用（resourceCalc/panelPhases、helpers、anomalyPanels，composables/outOfCombatPanel，stores/config …）
    ├─ calcBasePanel(agent, wEngine)               （只在 panel.ts 内部使用，导出了但没有外部调用者）
    ├─ collectAllBuffs(...)       core/buff.ts     把效果分成 outOfCombat / inCombat 两组：
    │     角色：corePassive / additionalAbility / cinema.buff 的 scope === 'outOfCombat' → 局外，否则局内（buff.ts:286–326）
    │     音擎 / 驱动盘组：group.scope === 'outOfCombat' → 局外，否则局内（buff.ts:337–353）
    ├─ outOfCombat = applyBuffs(applyDriveDiscConfig(base, 盘, statRules, 音擎副属性, buffs.outOfCombat))   （panel.ts:330）
    └─ inCombat    = applyBuffs(outOfCombat, buffs.inCombat, config.effectCoverageMap)                     （panel.ts:338，按覆盖率加权）
        applyBuffs → applyEffect / applyStat      core/buff.ts（fixed / derived / stacked 三类效果）
core/inCombatBuffs.ts  collectInCombatTeamBuffs   局内「给全队 / 队友」的 buff：角色 teammate-buffs、音擎 teamBuff、4 件套 teamBuff
  ← core/teammateBuffSource.ts buildTeammateBuffSourceContext ← resourceCalc/panelPhases.ts、stores/config.ts
伤害侧读面板：core/damage.ts getTargetedStat / getTargetedStatExtra / getSkillDmgBonus；失衡侧：core/stunPool.ts getStunBuildUpBonus
局外面板展示：composables/outOfCombatPanel.ts computeOutOfCombatPanel = calcPanel(...).outOfCombat + 启用的全局 Buff
```

**已用这张图核实的 R5 条目**（结论写在账本 `docs/mcp-r5-spec-impl-reconciliation.md` §7）：Z2、Z6。

## 5. R6 候选（初稿，第 2 步正式评估「做 / 不做」）

| 候选 | 类别 | 为什么 | 初步风险 |
|---|---|---|---|
| C1 core 改为 import `@/mechanics/registry`，注册放到应用入口和测试 setup（A1） | 可结构化 | 去掉 core ↔ mechanics 模块环，core 单测不再加载 62 个模块 | 中：所有依赖「import index 即注册」的测试都要补 setup；需要确认 vite 的 tree-shaking 不会丢掉注册副作用 |
| C2 `stores/config.ts` 里的引擎调用上移到编排层（A2） | 可归一 | 状态层只存状态，计算入口集中在编排层 | 中：store 的 action 被多个页面调用 |
| C3 删除 catalog 冗余字段 `appliesToOutOfCombatPanel`，或在导入脚本里校验它和 scope 一致 | 冗余可简化 | 与 scope 100% 同义，引擎不读（R5 Z2） | 低：数据是爬取产物，改导入脚本而不是手改 JSON |
| C4 局外判定改为读 `statRules.calculation.outOfCombatEffectFilter`，不再在 buff.ts 里写死 `scope === 'outOfCombat'` | 可结构化 | 规则数据化，同时补上 condition 条件（R5 Z6 的潜在差异） | 低：当前数据下零差 |

## 6. v1 还没画到的部分（下一轮续）

1. **§1 生命周期逐步核对**：`docs/ARCHITECTURE.md` §1 的调用链（useResourceCalc → runCalcRound → calcTeamResources → …）逐个函数确认还存在、顺序是否一致。
2. **A4**：composables/resourceCalc 与 composables 顶层按「计算 / 胶水」分类。
3. **views / components 的 fan-in**：哪些页面直接调 core 而绕过编排层（`views → core` 的值边在本次测量中为 0，要确认 components 也是如此）。
4. **specs 与 mechanics 的关系**：62 个 TS 模块和 spec JSON 是否存在同一机制两处实现（CC-98 的分档表是入口）。
