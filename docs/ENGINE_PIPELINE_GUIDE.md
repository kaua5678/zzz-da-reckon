# 引擎管线导读（角色录入必读）

> 给后续 AI 录入角色时读的引擎数据流与钩子说明。角色口径见 `docs/MECHANICS_IMPLEMENTATION.md`，
> 中文术语→字段映射见 `docs/GAME_TERM_TO_CODE_FIELD.md`，录入流程见 `README.md` §3。
> 本文只讲"代码怎么跑"，是排查管线问题时的路线图。

## 1. 一轮计算的数据流

```
computePanelPhases(slot)         逐角色面板（局外→局内）
  └─ module.applyPanel           面板级机制（转模/面板 buff；此时 configStore 不可用）
buildCharConfig(slot)            逐角色操作配置 cfg
  └─ module.buildCharConfig      cfg 级机制（初始能量/跳过通用强特/预存倍率表）
calcTeamResources()              资源池主循环（core/resource.ts calcTeamResources）
  ├─ iterate()                   不动点：能量→强特次数→喧响→终结技→时间分配（多轮收敛）；
  │    喧响含按槽位注入的奖励（specialAction/anomalyDecibelBonusPerSlot，含伴随50%），
  │    终结技次数 = floor(totalDecibel/3000) 与 decibelSource.total 同口径；
  │    快支 20 奖励只在 specialActionBonus 计一次，bonusRegen 仅剩时光切片
  │    └─ module.estimateExSpecialTime   强特链占用的必做前台时间（每轮调用）
  ├─ buildExecutions()           招式执行计划（从收敛后的 state 生成）
  │    ├─ 通用动作（平A汇总/强特/终结/连携/闪反/弹刀/支援突击）
  │    ├─ module.buildExecutions 模块专属动作（EX 链/附伤）
  │    └─ module.patchExecutions 对最终执行列表修正（moveId 级增伤/暴伤）
  └─ module.buildResourceResult  专属资源结果（specResources/billyChain 等）
enrichExecutionPlan()            从倍率表回填 damage/daze/decibel/anomaly（见 §4 坑）
extractSkillExecutions()         失衡池/异常积蓄池输入提取
伤害池/失衡池/异常池              最终伤害与覆盖率
```

关键：**`iterate`（次数/时间）与 `buildExecutions`（执行计划）是分离的**。次数先收敛，
执行计划从收敛后的 state 生成一次；`estimateExSpecialTime` 在 iterate 每轮被调用，因此
模块在 buildExecutions 里算出的值（如最高马力星光次数）只能经 **cfg 字段**留给下一轮
estimate 使用（收敛即可，见般岳/星徽·比利模式）。

## 2. 模块钩子速查（src/mechanics/types.ts）

| 钩子 | 调用时机 | 能做什么 | 拿不到什么 |
|---|---|---|---|
| `applyPanel` | 面板计算时（最早） | 面板字段（critDmg/抗性无视/转模） | configStore、settings（滑块值） |
| `buildCharConfig` | 面板之后、资源池之前 | cfg 字段、initialEnergyGift、skipGenericExSpecial、预存倍率表 | state（轮次数） |
| `estimateExSpecialTime` | iterate 每轮 | 强特链/专属动作的必做前台时间 | state（可用 cfg 字段存上轮值） |
| `buildExecutions` | 收敛后一次 | push 专属执行（EX 链/附伤/事件执行） | — |
| `patchExecutions` | buildExecutions 末尾 | 按 moveId 补 dmgBonus/critDmgBonus | — |
| `buildResourceResult` | buildExecutions 之后 | specResources/专属展示数据 | — |
| `resourceSections` | 展示 | 资源卡片（资源利用率页） | cfg（只读 result） |
| `transformSkillExecutions` | 失衡/异常提取时 | 接管全部非平A的 daze/anomaly 提取 | — |

**定义 `transformSkillExecutions` 后，通用失衡/异常提取对全角色禁用**（`usesModuleTransform`
分支），模块必须自己把所有执行的行值补进 stunExecs/anomalyExecs——大部分角色不要定义它。

## 3. 关键文件地图

| 文件 | 内容 |
|---|---|
| `src/core/resource.ts` | calcTeamResources：资源池主循环、findExSpecial 等招式选取 |
| `src/core/resource/helpers.ts` | calcEnergySource（能量/闪能池）、buildExecutions（通用执行）、iterate |
| `src/composables/resourceCalc/helpers.ts` | computePanelPhases（面板+applyPanel 调用点）、buildCharConfig（cfg 构建）、enrichExecutionPlan（回填）、extractSkillExecutions |
| `src/composables/useResourceCalc.ts` | runCalcRound（外层不动点）、轴模式（banyueAxisEx/billyAxisEx 注入）、伤害池/直伤结算 |
| `src/specs/mechanics.ts` | specToMechanicModule：spec → 模块的通用翻译（resources/events/settings） |
| `src/specs/resources.ts` | computeSpecResources：资源解释器（gain/spend/countSource） |
| `src/specs/runtime.ts` | applySpecAttributeConversions（属性转模） |
| `src/mechanics/registry.ts` | 每 agent 一个模块；spec 无显式模块才自动注册；settings 自动合并（重名抛错） |

## 4. 常见坑（实测踩过）

1. **面板滑块拿不到 settings**：`applyPanel` 早于 cfg 构建，模块内读不到 `configStore`。
   两种既有解法：① 在 `computePanelPhases` 里硬编码块（简 passionCoverage / 琉音 goodReviewAtkCoverage /
   星徽·比利 1531 块）；② buildCharConfig 把滑块值写进 panel 字段，后续 transform/patch 钩子读取
   （雅 iceFlameCoverage 模式）。
2. **state.exSpecialCount 由闪能池驱动**：`resolveExSpecialCount` 用 `exSpecialEnergyConsume` 除。
   模块接管 EX 链时设 `skipGenericExSpecial = true` + `exSpecialCountFloor = true` + 一个合理 cost，
   让 state.exSpecialCount 表达"付费强特数"，再在 buildExecutions 里 push 自己的执行（般岳/星徽·比利模式）。
3. **执行计划的 moveId 必须是 catalog 倍率表编号**（1531010 才是最高马力星光），不是游戏技能列表编号，
   也不是模块自己的键名。曾把事件 carrierMoveId 写成 1531002（骑士斗技#2）导致倍率/失衡全错。
4. **enrichExecutionPlan 会改写执行**：`damageMultiplierOverride=true` 的执行保留自定义倍率，
   其余从行回填；**找不到 moveId 的执行会被替换 skillTableNote**（"未在倍率表中找到..."），
   所以测试不要按 `skillTableNote` 找执行，按 moveId。
5. **override 执行的 daze/anomaly 仍从 move 行读**：合成附伤（如 C6 煊赫星辉）不要用真实 moveId，
   用假 id（`1531_c6_radiant`），否则 daze/anomaly 双计；假 id 不进失衡/异常池、元素回退到 agent.damageElement。
6. **事件执行（spec event）actionTime=0**：不计时间。需要占时间的动作（如最高马力星光 3.1s）
   在 `estimateExSpecialTime` 里补，跨轮次经 cfg 字段传递次数（`billyFullThrottleCount` 模式）。
7. **命破贯穿力基底**：`atk×0.3 + hp×0.1 + sheerForceFlat`（core/damage.ts）。角色被动写
   "每点生命提高0.1贯穿力"只是复述基底，**不要**再在 spec 里声明 hp→sheerForce 转模（会双计；般岳 1471 历史遗留）。
8. **countSource 枚举有限**（src/specs/resources.ts）：招式命中类计数（如 attack_data_0）没有现成源，
   已扩展 `countSource: 'cfgField'` + `countField`——模块把合计写进 cfg，解释器读取。
9. **失衡轴模式**：轴内动作计数由 useResourceCalc 注入 cfg（`banyueAxisEx` / `billyAxisEx`，
   组合块已展开成 moveId），模块读 cfg 决定轴内次数；轴外剩余资源模块自行分配。
   轴内动作时间/能量由 `calcStunAxisStack` 的 combos（`module.combos`）定义，`buildStackAxes` 消费。
10. **进场闪能**：`cfg.initialEnergyGift` 默认 40（composables 构建），命破角色需模块设为 60（伊德海莉/星徽·比利）。
11. **星辉类"指定招式增伤"**：不要加全局 panel.dmgBonus，在 patchExecutions 按 moveId 集合加 exec.dmgBonus
    （星徽·比利 6 个目标招式 / 般岳 C4 / 诺姆弹头行 override 同款）。

## 5. 验收命令

```bash
npm run verify      # validate:data + validate:specs + vitest + typecheck + build（一条链）
npm run docs:status # 重新生成 docs/implementation-status.md（勿手改；CI 检查漂移）
```

新增机制后同步 `public/static/character-mechanics.json` / `character-constellations.json`
（实现状态 + codePaths；`validate:data` 有状态表同步护栏——新角色缺条目即红），并补一条全管线冒烟测试
（参考 `src/mechanics/__tests__/billySmoke.test.ts` 的 harness：`src/test/harness.ts` 的
`setupHarness` + `useResourceCalc().resourceResult`；三文件 fetch stub 不再复制，用 `mockStaticFetch()`）。
