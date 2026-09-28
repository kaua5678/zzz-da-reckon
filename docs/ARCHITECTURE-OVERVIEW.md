# 架构全景（实测版）

> R6 第 1 步产出 · lead-arena-0925c · 2026-09-27 第 121 轮 · **v1**；第 138 轮补 §6（v2：生命周期核对、编排层分类、展示层边、spec↔模块），新增候选 C6 / C7。
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
| A1 ✅ 已修（第 139 轮，=C1） | 「录入层被编排 / 引擎经 **registry** 消费」 | core 直接按值 import **`@/mechanics`（index.ts）**，而 index.ts 一次性 import 全部 62 个角色模块并逐个注册。形成模块环：core → mechanics/index → agents/*.ts → core | `core/resource/` 下 11 个文件加 `core/substatOptimizer.ts` 都写 `import { getAgentMechanic } from '@/mechanics'`；全仓 core、composables、mechanics、stores 共 31 处；`src/mechanics/index.ts` 开头是 62 行 import | 精神上符合（按能力查询，不写 id），但实现上是「靠副作用注册 + 环」。后果：core 的任何单测都会加载全部角色模块；ESM 环依赖对初始化顺序敏感。**是 R6 候选**（见 §5） |
| A2 | 状态层 = 「队伍 / 敌人 / 设置 / 滑块（可变）、只读数据快照」 | `stores/config.ts` 直接调用引擎：`calcPanel`、`computeOptimalSubStats`（`core/substatOptimizer`）、`buildTeammateBuffSourceContext`，还查询 mechanics 注册表（**CC-186 第 209 轮**：随不可达的整队贪心分支删除，store 不再调 `calcPanel` / `buildTeammateBuffSourceContext`，优化器入口只剩 `computeDefaultSubStatAllocation` + `getTemplate`） | `stores/config.ts:9–14` | 状态层掺了计算。**是 R6 候选**：计算应该上移到编排层，或者明确承认 store 可以调用引擎，并写进规划 |
| A3 | `src/data/` 是「各层都可依赖的公共底」 | data 并不全是常量。`data/moveTableQueries.ts` 依赖 `logicEditor/fusion.ts` 的全局 `shallowRef`，这个状态由 `stores/logicEditor.ts` 写入（`setActiveRowFusionRules`）。「公共底」读的是运行时可变的全局状态 | `data/moveTableQueries.ts:26`、`logicEditor/fusion.ts:1`、`stores/logicEditor.ts:4` | 隐式全局状态。已核实**不成环**：`logicEditor/fusion.ts` 只依赖 vue；specs → core 只出现在校验工具 `specs/verify.ts`。影响面待 R6 第 2 步评估 |
| A4 | 编排层 = 「页面与引擎之间的胶水」 | composables 合计约 20 900 行，大于引擎层的约 11 400 行；resourceCalc/ 下有 damagePool 等计算模块 | §1 | **待查**：哪些是计算、哪些是胶水。这是 R6「可归一」最可能出现的地方 |
| A5 | 规划没有提到 `logicEditor/` | 6 个文件 383 行，被 stores、views、data、composables 依赖 | §2 | 补进规划的层次图 |

## 4. 效果管线（catalog 效果 → 面板 → 伤害），函数级

R5 对账主要用这一段。

```
public/static/catalog.json
  └─ stores/catalog.ts（加载，只读快照）
core/panel.ts
  calcPanel(...)                                   ← 5 个生产调用点（第 196 轮 CC-170 普查）：panelPhases computePanelPhases / computeEntrySnapshotPanel、core/teammateBuffSource 来源面板、core/substatOptimizer 无副词条起点、stores/config 整队贪心；其余都经 computePanelPhases 间接调用
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
局外面板展示：composables/outOfCombatPanel.ts computeOutOfCombatPanel = computePanelPhases(...).outOfCombat 的副本（CC-169 第 195 轮；全局 Buff 是局内效果，不进局外）
```

**已用这张图核实的 R5 条目**（结论写在账本 `docs/mcp-r5-spec-impl-reconciliation.md` §7）：Z2、Z6。

## 5. R6 候选（初稿，第 2 步正式评估「做 / 不做」）

> **第 2 步结论（第 139 轮）**：逐条「做 / 不做」见 `docs/mcp-r6-refactor-list.md`。**C1 已完成**（R6 验收项）：12 个 core 文件改 import `@/mechanics/registry`，注册由 `src/main.ts` 与 `vite.config.ts` `test.setupFiles` 负责，守卫测试 `src/core/__tests__/coreMechanicsRegistryOnly.test.ts`。回退点：12 处 import 改回 `@/mechanics`，删 setupFiles 一行与该测试。C7 做：1481 已完成（第 140 轮，spec 新增 `stepRounding` 字段承载连续口径），1571 不做；C6、C2 的规划条款已写进 `docs/ARCHITECTURE.md` §0（第 140 轮）；C5、C3 低优先做；C4 不做。下表保留为初稿记录。

| 候选 | 类别 | 为什么 | 初步风险 |
|---|---|---|---|
| C1 core 改为 import `@/mechanics/registry`，注册放到应用入口和测试 setup（A1） | 可结构化 | 去掉 core ↔ mechanics 模块环，core 单测不再加载 62 个模块 | 中：所有依赖「import index 即注册」的测试都要补 setup；需要确认 vite 的 tree-shaking 不会丢掉注册副作用 |
| C2 `stores/config.ts` 里的引擎调用上移到编排层（A2） | 可归一 | 状态层只存状态，计算入口集中在编排层 | 中：store 的 action 被多个页面调用 |
| C3 删除 catalog 冗余字段 `appliesToOutOfCombatPanel`，或在导入脚本里校验它和 scope 一致 | 冗余可简化 | 与 scope 100% 同义，引擎不读（R5 Z2） | 低：数据是爬取产物，改导入脚本而不是手改 JSON |
| C5 伤害基底只保留一个来源：删掉 agentSkills 行上的 `damageBasis`（导入合成字段）和 `DirectDamageInput.damageBasis` 死参数，只保留 `resolveSpecialDamageProfile` 按 specialty 决定；或者反过来让引擎读字段（R5 D6） | 可归一 | 目前字段与引擎各说一套，命破 5 人的字段值（atk）与实际计算（贯穿力）不符，会误导维护者 | 低：零差；要同步改 3 个导入脚本 |
| C4 局外判定改为读 `statRules.calculation.outOfCombatEffectFilter`，不再在 buff.ts 里写死 `scope === 'outOfCombat'` | 可结构化 | 规则数据化，同时补上 condition 条件（R5 Z6 的潜在差异） | 低：当前数据下零差 |
| C6 承认编排层实际是四层，按层分目录 / 写进规划（A4，§6.2） | 可结构化 | `composables/` 20 900 行里只有约 2 000 行是规划说的「胶水」；伤害管线后半段（约 7 200 行）与上层分析器（约 9 400 行）混在同一层名下，新人按规划找不到伤害在哪算 | 低（纯文档）→ 中（若挪目录：约 60 个文件的 import 路径，零差但 diff 大） |
| C7 spec 与模块「一处执行、一处描述」的机制归一（§6.4） | 可归一 | 26 个模块完全不调用 spec 解释器，但它们的 spec 里仍写着 resources / events / attributeConversions；例：1481 琉音、1571 诺玛的 attributeConversions 在 spec 里写了阈值 / 步长 / 上限，注释自称「非 spec runtime 执行」，模块里又硬编码一遍 | 低：先对「spec 能表达」的条目改为模块调用 `applySpecAttributeConversions`（alice / luciaElowen 已这样做），零差可验 |

## 6. v2 补全（第 138 轮，原「v1 还没画到的部分」4 项）

测量脚本在 `/home/kaua/calc-arch/`（不进 git）：`a4.mjs`（composables 逐文件 import 画像，输出 `a4.out`）、`a4b.py`（分桶求和）；§6.4 用的是临时 vitest 探针（加载 `@/mechanics` 后逐 spec 查注册的模块，用完即删，写法见 §6.4 末）。

### 6.1 一次计算的生命周期：逐函数核对

实际调用链（全部 `git grep` 定位过）：

```
useResourceCalc()                         composables/useResourceCalc.ts:87
  resourceConfig                          :104 buildCharConfig ×3（resourceCalc/helpers.ts:449）→ :113 applyTeamMechanics(phase 'build')（resourceCalc/panelPhases.ts:126）
  calcOutput（computed :207）→ solveTeam  resourceCalc/solveTeam.ts:72：失衡次数外层循环 + S3 stageResolveFeasibility（:301）
    runCalcRound                          resourceCalc/convergence.ts:104（createRunCalcRound 闭包，useResourceCalc.ts:447 注入）
      applyTeamMechanics(converge)        convergence.ts:563 / :948
      calcTeamResources                   core/resource.ts:148（外面包一层 enrichExecutionPlan，convergence.ts:658）
        S1 runInnerLoop                   core/resource/innerLoop.ts:42 → iterate
        S2 runFoldLoop                    core/resource/foldLoop.ts:47
        S3a 尾段管线 → S4 assembleSlot     core/resource/assembleSlot.ts:49（buildExecutions = core/resource/rowBuild.ts:194；模块钩子 buildResourceResult 在 :172 派发）
        截断                              core/resource/timeTruncation.ts:50 truncateExecutionsToFrontline
      extractAnomalyExecsFrom / Stun      resourceCalc/roundInputs.ts → extractSkillExecutions（helpers.ts:689）
      calcAnomalyPoolInput                convergence.ts:807 / :912
  damagePoolRows（computed :575）          → resourceCalc/damagePool.ts:94 buildDamagePoolRows
```

与 `docs/ARCHITECTURE.md` §1 的差异（本轮已同步改掉规划文档与 `core/resource.ts` 阶段表的两个过时单元格）：
- L1：规划写「calcOutput: runCalcRound」，漏了 `solveTeam` 这一层；S3 可行化决策在 `solveTeam.ts`，不在 useResourceCalc。
- L2：`core/resource.ts` 阶段表 S0 / S3 写的是 `useResourceCalc#runCalcRound` / `useResourceCalc#stageResolveFeasibility`，两者早已外提，已改。
- L3：规划把 `buildResourceResult` 画成引擎步骤，实际是模块钩子，由 `assembleSlot` 派发。
- 顺序本身与规划一致。

### 6.2 A4：编排层逐文件分类（78 个文件，20 871 行）

判据：看文件做什么（导出名 + import 画像），不是只看是否 import core。

| 桶 | 文件数 | 行数 | 是什么 | 代表文件 |
|---|---|---|---|---|
| E 伤害管线后半段 | 21 | 7 217 | 外层不动点、单轮编排、异常 / 失衡池输入、**伤害池（最终伤害在这里算）** | `resourceCalc/convergence.ts`、`solveTeam.ts`、`damagePool*.ts`、`panelPhases.ts`、`useResourceCalc.ts` |
| A 上层分析器 / 优化器 | 24 | 9 418 | 多次调用整条管线做搜索或对比（组队对比、时间权重、难度曲线、抽卡规划、位置对比……） | `teamCompare.ts`、`teamTimeline.ts`、`difficultyCurve.ts`、`pullPlannerEngine.ts`、`freeCompare/*` |
| P 展示几何 / 图表纯函数 | 17 | 2 275 | 坐标轴、SVG 命中、悬浮卡行 | `*Chart.ts`、`versionChartGeometry.ts`、`charts/hover*.ts` |
| G 胶水 | 16 | 1 961 | store ↔ 页面 / 引擎适配、导入导出、小型汇总 | `teamTimelineStore.ts`、`runArchive*.ts`（`teammateBuffContext.ts` 已于第 195 轮删除） |

结论：
- 规划说「编排层 = 胶水」，实际只有 G（约 9%）是胶水。**E 才是计算核心的后一半**：`core/` 算到执行行为止，伤害池、异常池输入、外层收敛都在 composables。「引擎层 = core」这句话只对了一半。
- A 是规划里没有的第四层（「应用层」）：它们站在整条管线之上反复调用，性质上和页面更近。
- 不算问题的：P、G 放在 composables 合理。
- 转为候选 **C6**（§5）。第 2 步评估时要回答：E 是否挪进 `core/`（它读 store 的地方要先变成参数），还是只改规划文档承认现状。

### 6.3 views / components → core 的值边

- `git grep -E "from '@/(core|mechanics)[^']*'" -- src/components src/views`，去掉 `import type` 后**为 0**（唯一命中是 `ResultPage.vue:920` 的注释，记录一次已迁走的越层）。
- 展示层只经 composables / stores 进引擎。仍存在的间接越层是 A2（`stores/config.ts` 直接调引擎），不在本项范围。
- 结论：这一条与规划一致，无候选。

### 6.4 specs ↔ mechanics：同一机制是否两处实现

实测（探针：对 62 份 spec 逐个 `getAgentMechanic(agentIds[0])`，按模块 id 找到源文件，查它是否调用 `getAgentSpec` / `specToMechanicModule` / `computeSpecResources` / `buildSpecEventExecutions` / `buildSpecAnomalyEvents`）：
- 注册规则（`mechanics/index.ts:138–142`）：**有手写模块时，spec 不会自动执行**；只有 `settings` 会合并进模块（`mechanics/registry.ts:25–33`），`teamBuffs` 由 `stores/catalog.ts#mergeSpecTeamBuffs` 并入队友 buff（与模块无关，始终生效），`additionalAbility` 由 `panelPhases.ts:448/567` 与 `stores/config.ts:408` 直接读。
- 62 份 spec 中，**26 个对应模块完全不调用 spec 解释器**。这 26 个里，spec 仍写着 resources 的有 10 个（1121、1171、1261、1281、1291、1411、1471、1511、1571、1581），写着 events 的有 3 个（1081、1331、1471），写着 attributeConversions 的有 1571（3 条）。这些 spec 条目**不被执行**，只供 `MechanicsTablePage` 与逻辑编辑器展示；真实行为在模块里手写。
- 典型：1481 琉音、1571 诺玛的 attributeConversions 在 spec 里写了 threshold / stepSize / valuePerStep / cap，note 自己写「实现位置：mechanics/agents/*.ts applyPanel，非 spec runtime 执行」。同一组常数存在两份，改一处另一处不会跟着变（CC-109 洛克茜就是 spec 注记与模块数值分叉的先例）。
- 反例（已归一）：`alice.ts:115`、`luciaElowen.ts:135` 直接调 `applySpecAttributeConversions(getAgentSpec(...).attributeConversions)`，常数只在 spec 一处。
- 转为候选 **C7**（§5）。
- **第 147 轮复核（CC-120）**：变异法实测，上述 10 份 resources 与 3 份 events **不参与计算**，只错在展示；逐条对照后只有 1581 耀变系数 1 条是真错（已修），其余不迁移。详见 `docs/mcp-spec-resources-audit.md`。
- 探针的局限：只按模块主文件的源码判断，模块若经其他文件（如 `specPanelBuffs.ts`）间接调用 spec，会被误记为「不调用」。第 2 步动手前逐个复核。
- 探针写法：`src/mechanics/__tests__/` 下临时 test，`import { getAgentMechanic } from '@/mechanics'`、`import { agentSpecs } from '@/specs/registry'`，结果写 `/tmp`，跑完删除。
