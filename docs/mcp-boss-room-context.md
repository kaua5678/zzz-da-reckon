# Boss 房间上下文与危局 buff 牌条件（第 360 轮，lane arena-C）

「房间上下文」指一次求值所在的那一关：敌人参数（`applyBossPreset`）、该 Boss 当期的关卡固有 buff
（`layer_buff`，写进全局 Buff 表、前缀 `layer-buff:`）、当期可选牌（3 选 1，前缀 `period-buff:` / `phase-buff:`）。
本文记录第 360 轮的审计、CC-341 的实施，以及留给下一轮的 CC-342 候选。账本条目：stun-dual-source §24.184、r6 §8 第 360 行。

## 0. 结论速览

| 项 | 状态 | 位置 |
|---|---|---|
| buff 牌条件（特性限定 / 人数分档）被两个写入方丢掉 | **CC-341 已修（`8f80b031`）**：条件随行写入，管线按当前队伍唯一解析 | §1.1、§2 |
| 房间上下文 13 处写法分裂；抽卡规划、角色兑现曲线的 `periodViews` 是死参 | **未改**，CC-342 候选（下一步） | §1.2、§3 |
| 测试服占位（testOnly）关卡牌照样写入 | 未改，记为待裁决 | §1.3 |
| 解析器把「对敌减抗」也挂上强攻限定；「全队[强攻]代理人」被近似成「队里有强攻就全队生效」 | 未改，数据侧近似 | §1.4 |

## 1. 审计（第 360 轮）

### 1.1 条件被两个写入方丢掉（CC-341 修）

数据（`public/static/boss-presets.json` 的 `phaseViews`）：50 期、159 个 Boss 简览（brief）；效果 821 条，
其中当期牌 561 条、关卡固有 260 条；带 `cond` 的 110 条（当期牌 102、关卡固有 8）。所有效果都有 `stat`。

解析器口径（`scripts/phase-buff-parser.mjs` 头注释）：特性限定 `cond.specialty` 为二元，「队伍无该特性角色则该条不生效」；
人数分档 `cond.countTier` 按队伍该特性实际人数选档。

CC-341 前，只有队伍对比在写入全局 Buff 表**之前**按预设队伍解析（`teamCompare#resolveBuffEffect`）。另外两个写入方
把 `cond` 丢掉，条件效果对任何队伍都满额生效：

- `runArchiveDeploy#applyBossLayerBuffs`：Boss 选择卡「应用 Boss」、实战部署、菲林模拟逐期都经它写关卡固有 buff；
- `runArchiveDeploy#applyPeriodBuff`：实战部署页的当期牌。

关卡固有的 8 条全在 40003（复写体·猎血清道夫）的 690431 / 690441 两期，每期 4 条「强攻限定」：
全减抗 10、暴伤 60、攻击 20、穿透率 25。

实测（第 360 轮探针，推荐配装，同一现场只切换「行上带不带 cond」；new = CC-341，old = 修前）：

| 场景 | 队伍 | new / old |
|---|---|---|
| 40003 @ 690431（690441 相同） | 雅 / 南宫羽 / 柚叶（无强攻） | −31.115% |
| 同上 | 柳 / 简 / 丽娜（无强攻） | −30.477% |
| 同上 | 朱鸢 / 青衣 / 妮可（有强攻） | 0 |
| 当期牌 690441「异变」（异常 2/3 名分档：异常伤 10/30、攻击 5/15；另有无条件全减抗 10） | 雅 / 南宫羽 / 柚叶（1 名异常） | −13.885% |
| 同上 | 柳 / 简 / 丽娜（2 名异常） | −13.745% |
| 同上 | 朱鸢 / 青衣 / 妮可（0 名异常） | −13.457% |

队伍对比（散点页）不受影响：它在写入时 store 里已经是该预设的队伍，写入期解析与计算期解析逐位相同。

### 1.2 房间上下文的写法分裂（未改，CC-342 候选）

`applyBossPreset` 有 13 处调用，只有 3 处同时处理关卡固有 buff：

| 调用点 | 场景 | 关卡固有 buff | 当期牌 |
|---|---|---|---|
| `components/BossSelectCard.vue#applyBoss` | 用户应用 Boss | 写（点击的 brief） | 不动 |
| `composables/runArchiveDeploy.ts#applyDeployConfig` | 实战部署 | 写（`resolveBossApply` 查 brief） | 页面另管（`applyPeriodBuff`） |
| `composables/teamTimelineFilm.ts#computeFilmSimulation` | 菲林模拟逐期（Chart 4） | 写（`applyPeriodLayerBuffs` 查 brief） | 不动（用户现场的 `period-buff:` 留着） |
| `composables/pullPlannerEngine.ts#createEngineOracle` | 抽卡规划逐房 | **不写不清** | 不动 |
| `composables/charIncrement.ts#computeIncrementPass` | 角色兑现曲线逐房 | **不写不清** | 不动 |
| `composables/teamCompare.ts#computeTeamComparePoints` | 散点对比 | 整表替换成所选当期牌（关卡固有 buff 与用户自定义行都清掉） | 写（所选牌） |
| `composables/teamTimeline.ts`（4 处） | Chart 1 / 2 / 3 / 5 | 不写不清 | 头注释：当期牌不参与 |
| `composables/difficultyCurve.ts` | 难度曲线 | 不写不清 | 不动 |
| `composables/positionCompare.ts` | 位置对比 | 不写不清 | 不动 |
| `composables/freeCompare/engine.ts` | 自由对比 | 不写不清 | 不动 |

「不写不清」= 用户现场的全局 Buff 表原样生效，包括上一次在 Boss 选择卡应用的**另一个** Boss 的关卡固有 buff。

两处入参从未被读过：

- `pullPlannerEngine.ts` 的 `EngineOracleOptions.periodViews`：头注释写「规划期内 Boss/buff 逐期应用（同 Chart 4）」，
  实际只调 `applyBossPreset`；
- `charIncrement.ts` 的 `IncrementPassOptions.periodViews`：注释写「期视图（关卡固有 buff；有数据才应用）」。

两者都是 `0f071a26`（2026-08-29）加入的，`git log -S` 查不到任何读取历史。159 个 brief 里 148 个带数值效果，
所以这两个分析器几乎每一房都缺关卡固有 buff。

brief 查找有两套写法：`resolveBossApply`（普通 + 困难，`presetId` 相等或 `monsterId` 等于预设 id）与
`applyPeriodLayerBuffs`（困难 + 普通，`presetId` 相等）。数据上 159 个 brief 都有 `presetId` 且都在 `bosses` 里，
`monsterId` 兜底命中 0 次；每个 Boss 预设内 `phaseId` 不重复（159 个阶段，重复 0），所以 `(presetId, phaseId)` 唯一定位一个 brief。

### 1.3 测试服占位的关卡牌照样写入（未改，待裁决）

解析器口径：「(Test1)TBD 测试服占位 → testOnly（不参与解析/推荐，等正式服）」。`applyPeriodBuff` 和队伍对比的自动推荐都拒收
testOnly 牌，但 `applyBossLayerBuffs` 照写，`BossCard` 也照常显示。

涉及 5 个 brief，都在 3.3 版本：690481 / 690491 / 690501。其中 690491 的 40003 与 690481 的 40008，全部数值效果都来自 testOnly 牌。

没有在 CC-341 里改。理由：这是「测试服 Boss 要不要带测试服关卡 buff」的口径问题，Boss 本身也是测试数据（如「(Test1)僭越者」），
而抽卡规划已整体剔除测试服版本。要改就在写入关卡固有 buff 的唯一入口（`applyBossLayerBuffs`）跳过 `card.testOnly`，
并让 `BossCard` 的效果标签同步标出或隐藏。

### 1.4 解析器的两处近似（数据侧，未改）

40003 在 690431 / 690441 的原文：「代理人对敌人造成[完美反制]后，敌人的全属性抗性降低10%，且全队[强攻]特性的代理人攻击力提升20%，
穿透率提升25%，造成的冰属性和以太属性伤害的暴击伤害提升60%」。

- 解析器按**段落**挂条件，所以「敌人全属性抗性降低 10%」也带上了强攻限定。原文里它是无条件的对敌减抗。
- 「全队[强攻]特性的代理人」是**按受益人**限定，只给强攻角色。解析器的口径是「队里有强攻，全队都生效」。另外暴伤只对冰 / 以太伤害，解析器记成了全元素。

CC-341 之后，非强攻队连这 10% 减抗也拿不到（偏低一点）；强攻队里的非强攻队友也吃攻击 / 穿透 / 暴伤（偏高）。两种偏差都比
CC-341 前「任何队满额生效」更接近原文。要再精确，需要：

1. 改 `scripts/phase-buff-parser.mjs`，按子句挂条件，并支持按受益人限定；
2. 用 nanoka 源数据重生成 `boss-presets.json`。

## 2. CC-341 做了什么（`8f80b031`）

- **新增 `src/utils/phaseBuff.ts`**：buff 牌进计算的唯一口径。
  - `resolvePhaseBuffValue(value, cond, teamSpecialties)`：条件解析，与原 `resolveBuffEffect` 逐分支相同。
  - `specialtyCodeOfLabel`：由 `SPECIALTY_LABEL` 反查，替换 teamCompare 手写的中文 → code 反表。
  - `teamSpecialtiesOf`。
  - `phaseBuffCondLabel`：Boss 卡效果标签与属性配置页共用。
  - `phaseBuffRows(card, idOf, name)`：牌 → 全局 Buff 行的唯一映射，带上 `cond`，跳过无 `stat` 的效果。
- **`stores/config.ts`**：`GlobalBuffRow` 增加可选的 `cond`。
- **`composables/resourceCalc/panelPhases.ts#resolveSlotPanelBuffInputs`**：全局 Buff 转 TeammateBuff 时，按 `configStore.team` 的特性解析 `cond`。条件不成立的行不进面板；人数分档取生效档。这是唯一解析点。
- **写入方**：`applyBossLayerBuffs`、`applyPeriodBuff`、`teamCompare#applyBuffToStore` 一律走 `phaseBuffRows`。
  - 行 id 与名称格式不变。
  - teamCompare 删除 `resolveBuffEffect`、`specialtyOf`、`SPECIALTY_ZH_EN`、`specialtyEn`；`applyBuffToStore` / `pickBestBuff` 去掉 `preset` 参数。
- **展示**：
  - 调试页的全局 Buff 行改取引擎实际收下的条目（同 CC-208 的队友 buff 做法），不再列条件不成立的行；值为生效档。
  - 属性配置页带条件的行显示条件说明（如「强攻限定」）。
- **测试与锁**：
  - `src/utils/__tests__/phaseBuff.test.ts`：
    - 解析分支；
    - 反查覆盖数据里出现的全部特性名（解析器出现新词时会红）；
    - 行映射；
    - 源码锁：除 `utils/phaseBuff.ts` 与类型定义外，`src` 不出现 `countTier`。
  - `src/composables/__tests__/phaseBuffCond.test.ts`：
    - 管线按当前队伍解析：同一组行换队后自动换档；
    - `applyPeriodBuff` 带 cond；
    - 真数据 40003 @ 690431：强攻队与非强攻队之差恰为 4 条限定效果。
  - `statModeParity.test.ts` ②c：调试页锚点随新调用形态更新，结算位仍须是 `statSettlementMode`。
  - 原 `teamCompare.test.ts`「buff 条件（resolveBuffEffect）」并入上面的管线测试，队伍与断言相同。
- **反例**：
  - 管线忽略 `cond` ⇒ 管线测试 5 条红 4 条。剩下那条是「3 异常取满编档」，忽略条件时恰好也取满额。
  - 写入方回到 HEAD 版（丢 cond）⇒ 两条写入测试红。

**决策记录**：

- 依据：解析器头注释已定义条件语义；队伍对比是唯一按此执行的通道。
- 影响：§1.1 的数值。golden 与队伍对比零差。
- 回退点：`git revert 8f80b031`。

## 3. 下一步：CC-342 候选「房间上下文写入单源化」

前提已由 CC-341 满足：关卡固有 buff 行自带 `cond`，批处理逐队求值时不需要重新解析。

提议的函数（放 `runArchiveDeploy.ts` 旁边，或新建 `composables/bossRoom.ts`）：

- `findBossBrief(phaseViews, phaseId, presetId)`：困难 + 普通，按 `presetId` 匹配，替换 §1.2 的两套查找；
- `applyBossRoom(configStore, boss, phase, phaseViews)`：等于 `applyBossPreset` 加上 `applyBossLayerBuffs(findBossBrief(...))`。

分三步：

1. **已正确的 3 处改调它**：BossSelectCard、`applyDeployConfig`、菲林模拟，预期零差。`resolveBossApply` 的 `monsterId` 兜底是死分支，可删。
2. **抽卡规划与角色兑现曲线改调它**：用它们现成的 `periodViews`，属于数值卡。
   - 改后每房带上关卡固有 buff，也不再泄漏用户现场的 `layer-buff:`。
   - 需要小规模规划的前后对比，比如固定持有集、2–3 期，看期分与 VCG 值的变化。
   - 头注释和 FEATURES_GUIDE §4.5 的「Boss/buff 逐期应用」随之成真。
3. **其余分析器要先定口径再改**：Chart 1 / 2 / 3 / 5、难度曲线、位置对比、自由对比。
   - 选项 a：页面把 `phaseViews` 传进来，改调 `applyBossRoom`。符合 FEATURES_GUIDE 第 15 行「应用 Boss 时……自动写关卡固有 buff」。
   - 选项 b：显式清掉 `layer-buff:` 行，按「不含关卡 buff」求值。
   - 缺省建议 a，依据是文档已写明的规则。队伍对比「整表替换成所选牌」是它自己的口径，保持不动。

**不要做**：

- 把 `cond` 的解析搬回写入方，或在分析器里按预设队伍预解析。CC-341 的源码锁会拦。
- 在 `applyBossPreset`（store）里直接写关卡 buff。store 拿不到 `phaseViews`，而且这会把展示数据塞进 store 层。
