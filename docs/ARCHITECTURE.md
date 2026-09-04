# 代码架构地图（AI 导航用）

> 本文不是代码百科全书——只回答一个问题：**"我拿到一个任务，该读哪些文件？"**
> 细节（乘区公式、钩子语义、口径）在代码注释与测试里，文档不重复。
> 配套阅读：`ENGINE_PIPELINE_GUIDE.md`（一轮计算的数据流/钩子/坑）、`AGENT_RECORDING_SOP.md`（角色录入）。
> 阅读顺序建议：本文（地图）→ ENGINE_PIPELINE_GUIDE（管线）→ 按任务进对应层。

## 0. 心智模型：五层 + 单向依赖

```
数据层   public/static/*.json        唯一事实源（倍率/属性/buff/boss/音擎/驱动盘），只经 scripts/ 导入，不手改（中间产物 data/raw/ 的目录约定见 data/raw/README.md）
状态层   src/stores/                  configStore（队伍/敌人/设置/滑块，可变）· catalogStore（只读数据快照）
编排层   src/composables/             useResourceCalc.ts（一次计算的总管线，页面与引擎之间的胶水）+ resourceCalc/ 子模块（helpers/roundThreads/liuyinPromote/normaHatChain/damagePool）
引擎层   src/core/                    纯函数引擎：resource（资源池）/ damage（伤害乘区）/ panel / stunPool / anomalyPool / buff
录入层   src/specs/ + src/mechanics/  角色机制：声明式 spec（agents/*.json）+ TS 机制模块（agents/*.ts）
展示层   src/views/ + src/components/ 页面与卡片（读编排层产物）
```

依赖方向：展示 → 编排 → 引擎；录入层被编排/引擎经 registry 消费；数据层被状态层加载。
**新 AI 读代码的捷径：从上往下读一遍调用链（页面 → useResourceCalc → core），每个文件头注释就是它的职责声明。**

## 1. 一次计算的生命周期（点「计算」→ 出图）

```
useResourceCalc()                      编排层入口（composables/useResourceCalc.ts）
  resourceConfig: buildCharConfig ×3   每角色 cfg（面板 + 招式数据 + 机制模块注入）
  calcOutput: runCalcRound             外层固定点：失衡次数 ↔ 资源池 ↔ 转大 ↔ 异常喧响奖励（收敛；跨轮反馈量集合在 resourceCalc/roundThreads.ts 的 CalcRoundThreads——新增反馈=加字段+初值+轮内读写，不动 runCalcRound 签名；`enemy.stunCountLock>=0` 时失衡次数固定不回填，其余反馈仍收敛，命座对比固定场景用）
    calcTeamResources                  core/resource.ts：iterate 多轮收敛（能量→强特→喧响→终结→时间）+ 时间预算收敛外层循环（测执行行前台时间，超出战斗时间的部分折入 necessaryTime 压缩平A池）；喧响含特殊动作/异常奖励注入（specialAction/anomalyDecibelBonusPerSlot，参与终结技次数推导）
      → buildExecutions                从收敛态生成执行计划（通用动作 + 模块专属 + patchExecutions 修正）
      → buildResourceResult            角色资源结果（specResources / 专属 cycle）
    enrichExecutionPlan                从倍率表回填 damage/daze/decibel/anomaly（覆盖 name/note！）
    extractSkillExecutions             失衡池 / 异常积蓄池输入
  → 失衡池 / 异常池 / 伤害池            最终伤害与覆盖率（damagePoolRows）
```

关键对象流转：`configStore.team` → `CharacterOperationConfig`（cfg，可被模块改写）→ `TeamResourceResult`（characters[].executions/energySource/...）→ `damagePoolRows`（展示行）。

## 2. 核心类型地图（一句话定位，全部在 src/types/）

| 类型 | 职责 | 谁产生 / 谁消费 |
|---|---|---|
| `PanelValues` | 角色面板（属性/乘区/敌方减益全字段，索引签名） | computePanelPhases 产生 → cfg.panel / 伤害池消费 |
| `CharacterOperationConfig` | 单角色计算配置（可被机制模块改写） | buildCharConfig 产生 → 引擎 + 模块钩子消费 |
| `IterationState` | 单轮迭代状态（次数/时间分配） | iterate 产生/消费 |
| `SkillExecution` | 执行计划一行（moveId/倍率/时间/增伤字段） | buildExecutions 产生 → enrich 回填 → 各池消费 |
| `TeamResourceResult` | 队伍资源结果（characters[] + executions + specResources） | calcTeamResources 产生 → 页面/池消费 |
| `CharacterResourceResult` | 单角色资源结果（energySource/decibelSource/专属字段） | 同上 |
| `StunAxis` / `StunAxisAction` | 失衡轴定义（槽位/动作/转大变体） | 用户/预设产生 → 轴引擎消费 |
| `ResourceCalcConfig` | 全局计算配置（totalTime/stunCount/盾数） | useResourceCalc 产生 |

## 3. 任务 → 文件决策树（本文件的核心）

| 任务 | 先读 | 再改 |
|---|---|---|
| 录新角色 / 补机制 | README §3 → `AGENT_RECORDING_SOP.md` → `ENGINE_PIPELINE_GUIDE.md` | `src/specs/agents/<agentId>.json`（**文件名必须 = agentId**，validate:specs 强制）+ `src/mechanics/agents/<id>.ts`（注册进 `mechanics/index.ts`） |
| **跨角色 / 队伍级联动**（邻位回能、后场全队增益、入场次数汇总） | `ENGINE_PIPELINE_GUIDE.md` §2 的 `applyTeamConfig` 三阶段表 | **只改角色模块自己的 `applyTeamConfig`**；派发器 `applyTeamMechanics`（composables/resourceCalc/helpers.ts）无需改。禁止往 `useResourceCalc` 加 agentId 分支 |
| **加一个可调滑块（覆盖率/次数近似）** | `src/mechanics/types.ts` 的 `MechanicSetting`；面板阶段读法见 `AgentPanelInput.settings` | 模块 `settings: [...]` 声明 → 面板阶段 `input.settings['<id>']`、cfg 阶段 `configStore.getMechanicSetting`。**必须补一条「滑块改了面板/结果确实变」的生效测试**（般岳 rageGainCoverage 曾静默失效） |
| 改伤害公式 / 乘区 | `core/damage.ts`（乘区顺序 = 代码顺序：基础→增伤→锐化→贯穿→防御→抗性→易伤→失衡→暴击） | core/damage.ts；执行级字段在 `types/resource.ts` SkillExecution |
| 改资源池（能量/闪能/时间/连携/转大） | `core/resource.ts`（主循环）→ `core/resource/helpers.ts`（calcEnergySource/iterate） | 同上 + `types/resource.ts`；**跨角色回能只改 `calcCrossAgentEnergy`**（单一事实源，iterate 与最终装配共用） |
| 改合轴率/时间预算抵扣/超时判定 | `core/resource/helpers.ts` 的 `iterate`（抵扣+池+单角色≤180 cap）与 `netFrontlineOccupation`（超时判定单一事实源） | 口径见 `ENGINE_PIPELINE_GUIDE.md` §4 坑 21；生效测试 `comboAlignBudget.test.ts`；NET 模块必标 `comboAlignIncludedInNecessary: false` |
| 排查「界面能量总额和次数不对应」 | `types/resource.ts` 的 `CrossAgentEnergy` / `derivedEnergy` 注释 | 看 `energySource.total`（展示，含 crossAgent）vs `derivedEnergy`（驱动次数）；两口律试已对齐（iterate 连携次数同口径，`timeSliceChainEnergy.test.ts` 锁定），差值 ≠ 0 即回归 |
| 排查「算出来没收敛 / 数值抖动」 | `types/resource.ts` 的 `ConvergenceReport`；结果页计算状态条 | `convergence.timeBudgetConverged` / `outerExit`（`cycle` 正常、`maxIter` 可疑）；全角色断言在 `allAgentsSweep` |
| 改失衡 / 异常 / 紊乱 | `core/stunPool/`、`core/anomalyPool/` | 同上 |
| 改面板计算 / 局外局内 / 转模 | `composables/resourceCalc/helpers.ts`（computePanelPhases，applyPanel 调用点在此）→ `core/panel.ts` | 同上 |
| 改页面 / 结果展示 | `views/` + `components/`；伤害行数据源 `calc.damagePoolRows` | 对应 .vue |
| 命座提升率 / 死数据自检 | `composables/cinemaUplift.ts`（`analyzeCinemaUplift`，页面与测试同源） | 同上；全角色红灯在 `allAgentsSweep`「命座有效性不变量」 |
| Excel 导出（结果页按钮） | `utils/exportExcel.ts`（buildExportWorkbook 纯组装 / exportExcelFile 动态加载 xlsx + Blob 下载；sheet：操作表/资源表/伤害行明细/异常池） | 同上；测试 `utils/__tests__/exportExcel.test.ts` |
| 改失衡轴 / 自动轴 / 预设 | `data/stunAxisPresets.ts` + `data/stunAxisPresets/*.json` | 同上（自动匹配 `selectAutoStunAxisPreset`） |
| 改队伍预设 | `data/teamPresets/*.json`（目录自动加载） | 同上 |
| **时间图表页（队伍随版本演变）** | `composables/teamTimeline.ts`（精确增量搜索 + 预算感知排名 + 逐金贪婪最优加金 + maxIter 收敛过滤 + 换人上位/平替判定 `classifySwapUplift` + Boss 排期标记 `composables/bossSchedule.ts`）；**Chart 7 同槽位角色对比 = `teamTimeline.ts` `findSlotComparePairs`/`computeSlotComparePoints`**（预设中其余两槽相同、所选槽位 A/B 两队的成对求值）+ `data/versionTimeline.ts`（版本节点/S级实装版本）；**Chart 5 抽卡价值 = `composables/pullValue.ts`**（实战归档配对差分 → 累计兑现/ROI/T0-T3 分级/效率前沿，纯函数零引擎）；**Chart 6 抽卡规划器 = `composables/pullPlanner.ts`**（beam search 序贯购买 + 3-Boss 不重叠匹配 + VCG 价值归因，纯逻辑 oracle 注入）+ `composables/pullPlannerEngine.ts`（引擎桥：伤害→分数映射/期轴/快照恢复） | `views/TimeChartsPage.vue`；口径见 `FEATURES_GUIDE.md` §4（Chart 5 算法口径 §4.4） |
| **倍率表系数演算记录（角色系数推导）** | `data/standardMultiplierTable.ts`（标准职业稀有度倍率表：1级A级基准式 + 等级×2/×1.5 引用 `core/skillLevel.ts` + 限定S×1.1/常驻S×1.05/命破伤害×0.8；常驻S名单单一来源在此）+ `composables/multiplierCoefficients.ts`（招式分类/期望值/纵向系数中位数/支援突击直伤锚点/招式特定偏差，纯函数页面测试同源） | `views/MultiplierCoeffPage.vue`；口径与待确认项见 `FEATURES_GUIDE.md` §5 |
| 改数据导入 / 校验 / 文档生成 | `scripts/`（validate-specs / docs:status / 各类 import） + `data/raw/README.md`（中间产物目录约定与消费链路表） | 同上 |
| 排查"某 buff / 命座没生效" | `AGENT_RECORDING_SOP.md` §3.5 根因表；页面「命座提升率」自检打标 | 按根因表定位字段消费端 |
| 改音擎 / 驱动盘 / 敌人 / Boss | `public/static/catalog.json`（编译期快照，改数据走 scripts/ 导入脚本，勿手改） | scripts/ + catalogStore |
| 改 Boss 预设默认值（无敌时间/秽盾/弹刀总数） | `scripts/import-nanoka-bosses.mjs` `BOSS_DEFAULTS`（重跑生成 `public/static/boss-presets.json`） | 弹刀「保底4失衡」反推运行时拆分：`core/parrySplit.ts`（纯函数）+ `useResourceCalc` 外层不动点线程 `prevParrySplit`（般岳 `prevBanyueTopUp` 同款收敛）；口径见 `ENGINE_PIPELINE_GUIDE.md` §4 坑 18 |

## 4. 数据流速查（谁写谁读，防"录了没消费"）

- **cfg**：composables 构建 → 模块 `buildCharConfig` 改写 → **模块 `applyTeamConfig` 改写全队**（跨槽位联动，三阶段 build/converge/postRound）→ 引擎 iterate / buildExecutions 读。模块想在下一轮读自己的值 → 写 cfg 字段（`record.<key>`）。
- **跨角色回能**：`calcCrossAgentEnergy`（core/resource/helpers.ts）是唯一事实源，被 iterate（参与次数推导）与 calcTeamResources 最终装配（写 `energySource.crossAgent` 并计入 total）共用。新增跨角色回能只改这一处 + `CrossAgentEnergy` 加字段。
- **收敛诊断**：`TeamResourceResult.convergence` 由 core（时间预算层）+ useResourceCalc（失衡外层）共同回填 → 结果页计算状态条 + `allAgentsSweep` 断言。
- **特殊动作/异常喧响奖励**：`calcSpecialActionBonus`（弹刀215/闪反10/连携10/快支20，含伴随50%）每轮即时结算、`anomalyPool.perSlotBonus`（异常/紊乱/乱流，含伴随）上一轮回填 → `ResourceCalcConfig` 按槽位注入 → iterate `totalDecibel` 与 `decibelSource` 同口径（`ultimateCount = floor(total/3000)`，界面喧响总览 = `decibelSource.total`，不再页面外拼）。失衡触发 20/次归属（每人/全队）无出处，未接入。
- **panel**：`computePanelPhases` 产生（applyPanel + 硬编码块在此）→ `cfg.panel` → 伤害池。**applyPanel 阶段拿不到 configStore/settings**（见 ENGINE_PIPELINE §4 坑 1）。
- **executions**：buildExecutions 产生 → `enrichExecutionPlan` 回填（**覆盖 name/note**，匹配一律用 moveId）→ 失衡/异常/伤害池。
- **teammate-buffs**：`public/static/teammate-buffs.json`（采集）+ spec `teamBuffs`（人工）→ `stores/catalog.ts` 合并（spec 优先按 id 去重）→ 面板。
- **数值唯一事实源**：`public/static/catalog.json`。改数值 = 改爬取/导入脚本重跑，不是改 JSON 本身。
- **生成产物不变量（2026-08-27，机器强制）**：`public/static/*.json` 必须紧凑写（无缩进），且 `catalog.json` 顶层键必须 == `src/types/catalog.ts` 的 `Catalog` 字段白名单（白名单单一事实源在 `scripts/lib/catalog-fields.mjs`，改字段两侧同步）。护栏在 `scripts/validate-data.mjs`，被 `check`/`verify` 覆盖；再膨胀/再引入 legacy 死键即红，修复入口 `npm run minify:static`（幂等，剔死键 + 紧凑写）。历史：import 脚本全部 `JSON.stringify(x, null, 2)` 回写使 catalog 膨胀到 ~5.2MB 且「读整份→改→写整份」循环永久携带 25 个无人消费的 legacy 字段。

## 5. 导航技巧（减少迷宫感的操作习惯）

1. **用 grep 找符号，不翻目录**：`grep -rn "computePanelPhases" src/` 一条命令定位生产/消费端，比逐层读文件快一个数量级。
2. **测试是最好的行为文档**：`banyue-preset-int.test.ts`（轴+机制集成）、`teamCompare.test.ts`（全管线）、`billySmoke.test.ts`（新角色冒烟模板，已用 `src/test/harness.ts` 装配）、`allAgentsSweep.test.ts`（60 角色 × 命座 0/6 全局不变量回归网）、`specialMechanics.test.ts`（机制模块单元）。看"怎么调"比看"怎么实现"快。
3. **每个 core/ 文件头部都有职责注释**——先读头注释，再决定进不进。
4. **改完必跑 `npm run verify`**（validate:data + validate:specs + vitest + typecheck + build 一条链），再 `npm run docs:status`（CI 检查漂移）。
5. **新 AI 第一次任务前**：跑一遍 `npm test` + 用测试 stub 模板（`AGENT_RECORDING_SOP` §7）搭一个全管线冒烟，建立"改哪 → 在哪验证"的闭环。
