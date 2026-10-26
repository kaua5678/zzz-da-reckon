# 大工程：失衡窗口「时间轴级」建模（从聚合近似 → 逐窗口可推演）

> 立档 2026-10-20。本文件是**待办工程的提示词/施工图**，给下一个 agent 直接开工用。
> 前情与已落地部分见 `docs/STUN_WINDOW_DURATION.md`、`.claude/OPEN-ITEMS.md`。

## 0. 一句话目标

让引擎能回答「**这 180 秒里，每一个失衡窗口什么时候开、开多久、里面打了什么、窗外还剩多少时间给谁**」，
而不是现在这样只在**聚合层**用一个 `stunCount × windowDuration` 和一组比例近似。

## 1. 为什么现在做不到（现状的事实清单）

| 环节 | 现状 | 问题 |
|---|---|---|
| 窗口时长 `W` | `enemy.stunTime + 4 + Σ panel.stunDurationBonusSeconds`（全队**常驻**求和） | 无法表达「某次窗口因为某招而更长」 |
| 窗口时间占比 | `stunWindowFraction = clamp(N×W / effTime)` | 把 N 个窗口当成**等长且连续占满**，最后一窗打不满也按整窗算 |
| 窗口内动作 | 轴栈 `calcStunAxisStack` 按 `windowDuration` 逐块门控，产出 `inAxisCount` | 只有**轴模式**有逐块时间；非轴模式纯按比例 |
| 窗口外时间 | `solveTeam` 的 `nonStunTime = effTime − N×W` 与 `totalNecessary` 比 | `totalNecessary` **含窗口内动作**，与「窗外时间」不同量纲（本批已记录，未修） |
| 决算/截断 | `verdictSecondsLost` 只在轴模式按 `endsStunWindow` 块算 | 非轴模式无决算概念 |
| 补齐（弹刀/双反） | 外层不动点按「缺口 ÷ 单价」反推，实测边际会塌缩到 0 | 与窗口时间轴无耦合 |

## 2. 用户口径（2026-10-20，逐字，最高优先级）

> 「失衡是需要计入 180s 的，通常 4 失衡中，27 秒用来打失衡和积累资源，18s 用来失衡爆发。
> 4 次就是 180s。我的捏轴就是规定了失衡期内的动作计数，这并不代表什么时间重叠和什么合轴之类。」

> 「最后一窗口要么失衡不够导致时间慢了，最后失衡窗口时间残疾，要么资源回复来不及，
> 导致动作次数残疾。」

> 「捏轴不隐含合轴的意思是，捏轴里面你看着似乎 0 秒重合，但这个数据并不能代表全局的合轴时间，
> 因为我们无法计算非失衡的合轴情况，所以此处直接用全局合轴率计算多余时间就行，
> 差值被合轴吸收那就吸收呗，合轴应得的。」

> 「（佩洛伊斯决算）大招在最后不会出窗口，不计算跨窗易伤；大招后立即决算不用算窗口时间。」

> 「没勾选自动平A填充的时间就要给队友多余技能的自动填充了……但新问题是打进来太多资源
> 会不会导致洛克茜剩余资源打失衡能力下降，以及如何评判多余资源。」

**推论（必须遵守）**：
1. 失衡窗口时间**计入** 180s（不是白送时间）；
2. 窗口内动作占**窗口时间**，不额外占窗外时间；
3. 合轴吸收是合法的（用全局合轴率算），不要为「捏轴看起来 0 重合」做特殊处理；
4. 最后一窗允许「残疾」（时间不够 / 次数不够），**如实上报**，不要用吸收或补齐抹平；
5. 窗口内的剩余时间（如 18s 窗口只用了 16s）**可以**给队友技能填充，但需评估其对资源循环的影响。

## 3. 施工分四期（每期独立可验收，别一次全做）

### 期 1：窗口时间轴（Time-axis）数据结构 —— **地基** ✅ 2026-10-20 已落地

新增纯函数模块 `src/core/stunTimeline.ts`（**返回整份时间轴对象**，不是裸数组——窗口总数 /
窗外时间 / 是否拿到轴栈轨迹都是恒等式的组成部分，裸数组会让调用方各算一遍）：

```ts
export interface StunWindowSlot {
  index: number              // 第几个窗口（0-based）
  startSeconds: number       // 窗口开始时刻（绝对秒）
  nominalSeconds: number     // 名义窗长 W（含所有常驻延长）
  extendedSeconds: number    // 决算类按块延长（佩洛伊斯 +3s）
  effectiveSeconds: number   // 实际可用于爆发的秒数（= nominal + extended − 决算截断 − 时钟截短）
  truncated: boolean         // 是否被决算提前结束
  clippedByClock: boolean    // 是否被战斗时钟截短（「末窗时间残疾」，与 truncated 是两回事）
  actions: StunWindowAction[]// 窗内动作（来自轴；非轴模式为空 = 走比例近似）
  unusedSeconds: number      // 窗内剩余（给期 4 用；无轴轨迹时记 0 = 不可推演，不是打满）
}
export function buildStunTimeline(input: StunTimelineInput): StunTimeline
```

**接线面（期 1）**：唯一生产出口 = `useResourceCalc#stunTimeline`（惰性 `computed`，不参与任何计算
⇒ 零 delta；供结果页/探针读逐窗时间轴）。§4 纪律 3 的 `check:full` 会把 `deadChannelLs` ⑫「全仓死导出为空」
跑一遍——**新导出的纯函数必须有一个生产消费点**，只被测试引用会被判死导出（本轮实际踩到）。

**窗内内容从哪来（单一事实源）**：轴栈 `core/stunAxisStack.ts#calcStunAxisStack` **纯追加**了
`StackTraversalResult.windowTrace: StunWindowTrace[]`（逐窗：决算延长 / 截断时刻 / 执行了哪些动作
（含跨界 `inAxisCount`）/ 毛占用 / 合轴节省 / 平A填充）。时间轴只做**排布与聚合**，不重新推演窗口内容。
排布规则：窗口数 = `floor(池次数)`（与轴栈 `for (i < wins)` 同口径），逐窗**连续**排在战斗时钟上，
末窗放不下就被时钟钳短（`clippedByClock`）——**如实上报，不抹平**。

**验收**（`src/core/__tests__/stunTimeline.test.ts`，8 例全绿）：
- 6 支般岳队 + 佩洛伊斯决算队：`Σ effectiveSeconds + outsideSeconds === effectiveTime`（**零容差**，
  浮点下 `a + (T − a) === T` 恒成立）+ 逐窗无缝隙无重叠；
- 与聚合口径同源：无决算截断的队上 `windowSeconds / effTime` 与 `calc.stunCoverage` **逐位相等**
  （证明时间轴不是第三本账）；
- 反空洞：≥5 队非零窗口、≥4 队拿到轴栈轨迹、非轴队（`banyue-qingyi-lucia` 轴退化）走 `hasTrace=false` 路径；
- 佩洛伊斯队：每窗都 `truncated`、`extendedSeconds === 3`、窗内动作 = 决算块 `1551016`。

⚠ **零 delta**：期 1 不接线（无生产调用点），不改 `stunWindowFraction` / 池 / 伤害；`npm run check` 全绿。

**期 1 顺带量到的量纲错配（期 3 的直接证据）**：佩洛伊斯队的时间轴占比 `0.03806`（3 窗 × 2.2836s
决算截断）**低于**引擎 `stunCoverage` `0.04463`（= 48 − 2.3909 × 16.7164）。差的 1.18s 就是
「聚合口径按**计划实数** 2.3909 窗扣损失 vs 轴栈**物理**只填 3 窗」——期 3 要修的那条量纲错配，
测试里**有意断言「不等」**（不锁固定差值，免得把期 3 的修法锁死）。

### 期 2 前置 · **C 项已落地（2026-10-20）：覆盖率与池次数同源**

**病灶**：`runCalcRound` 内的 `stunCoverage` 用**钳之前**的池次数，而 `solveTeam` 的 CC-150
在 `cycle + physical` 停点把池钳到读入 K ⇒ 同一份结果里两个物理量。实测 3 支队：
`auto-1051-1141-1451` / `auto-1611-1141-1211`（**池 5 / 覆盖率隐含 7 窗**）、
`auto-1501-1561-1411`（**池 2 / 隐含 3 窗**）。

**为什么这不是展示口径**：`stunCoverage` 是**伤害易伤**（`damagePoolDirect` 直接读）与
「攒条无效时间」的唯一输入——多算的窗口同时推高易伤覆盖与本轮攒条扣除。

**修法**（`solveTeam.ts` 钳位之后）：`CalcRoundResult` 新增 `stunVerdictLostSeconds`
（决算截断损失秒，原来只在 `runCalcRound` 局部可见），钳位真的发生时用
`stunWindowFraction(钳后池, W, effTime, lost)` **重算覆盖率**；stable / 未钳成员逐位不变。

**验证**：
- 新判据 `stunCoveragePoolSync.test.ts`（全库 93 预设，`覆盖率隐含窗数 == 池次数`）；
  **反证已跑**：撤掉本修复 ⇒ 判据当场红（3 条），恢复即绿。
- 修复前后对照：`mismatch 3 / 93 → 0 / 93`。

**delta 归因（规则 10 四步，已逐条量）**：

| 队/角色 | 修复前 | 修复后 | 归因 |
|---|---|---|---|
| `auto-1051-1141-1451` | 67,699,295 | 66,556,232（−1.688%） | 覆盖率 7 窗 → 5 窗，易伤覆盖少算 ⇒ 伤害降 |
| `auto-1611-1141-1211` | 87,948,999 | 86,828,522（−1.274%） | 同上 |
| `auto-1501-1561-1411` | 120,688,203 | 117,174,482（−2.911%） | 同上（3 窗 → 2 窗，差值最大） |
| `agent:1301:c3` / `:c4` | 1,678,607 | 1,610,092（−4.082%） | 单角色夹具：池 1 窗、覆盖率曾按 2 窗算 |

**全部是「少算了本该有的窗口」被纠正**（方向一致：只会降不会升），时间账零变化
（覆盖率不进时间账）⇒ 只动 `timeGolden` 的 `dmg` 字段，5 条。

### 期 2：用时间轴替换 `stunWindowFraction` 的聚合口径

把 `stunWindowFraction(N, W, effTime)` 换成 `Σ timeline[i].effectiveSeconds / effTime`。
这会改数值（最后一窗不再按整窗算）⇒ 按规则 10 四步逐队归因 + 重生成 `timeGolden`/`timeFillRatchet`。

⚠ **C 项落地后，期 2 的已知影响面从「3 支队」缩小到「0 支」**：全库比对（93 预设）
`时间轴 windowSeconds/effTime` 与 `calc.stunCoverage` 现在**逐位相同**（此前 3 支 cycle 队因钳位分叉）。
⇒ 期 2 的 delta 面只剩「末窗被时钟截短」这一类，需重新普查（本期未做）。

**⛔ 2026-10-26 已普查完毕，结论 = 差异面不可达，期 2 暂不落地**（探针 `.zc/perf/phase2Parity.probe.perf.ts`
+ `.zc/perf/clipReach.probe.perf.ts`，全库 102 队）：
- `Σ slots[].effectiveSeconds/effTime` 与 `calc.stunCoverage` **逐位相同（mismatch 0）**，恒等式残差 0；
- 换 180/120/90/60s 四种战斗时间，`clippedByClock` 与 `truncated` **恒 0 队**
  ——池窗数随 `effTime` 一起收敛，末窗永远装得下 ⇒ 「末窗残疾」在当前引擎里**构造不出来**。
- ⇒ 期 2 现在做是**纯换尺、零收益**；应等「窗内没牌」前向约束（`TASK-continuous-stun.md` §8g 可行方向 2）
  能真产生末窗残疾之后再一起做，否则只是把两把永远相等的尺合成一把。

**风险点**：`stunWindowFraction` 是全仓唯一实现（CC-217），有源码锁
`effectiveTimeSingleSource.test.ts`；改它要同步该锁。

### 期 3：修「`totalNecessary` vs 窗外时间」的量纲错配

`solveTeam.ts` 的 `nonStunTime < totalNecessary` 里，`totalNecessary` 含窗口内动作。
正确式（用户口径 2）：`窗外动作时间 = totalNecessary − 窗口内动作时间`，与 `effTime − Σ窗口` 比。

⚠ 本批试过两种写法都失败（cycle 队 5→9），**必须先有期 1 的时间轴**才能算对
「窗口内动作时间」——这正是分期的原因。

### 期 4：窗口剩余时间给队友填充（用户最后那条问题）

窗口内 `unusedSeconds > 0` 且**未勾选**平A填充时，把这段时间分给队友技能。
需要设计：
- **谁有资格**：队友的「多余技能」（辅助上buff / 击破招式），不攒失衡值但吃易伤；
- **如何评判多余资源**：用户明确提出的开放问题——打进来太多资源会不会让洛克茜的
  资源不足以打下一次失衡？建议先做**只读评估**（算出「若填充 X 秒，队友资源 +Y，
  主C 资源 −Z」），由用户裁决是否启用，不要自动开启。

## 4. 纪律（违反即回滚）

1. **不许**用「钳位/单调夹住/棘轮」掩盖环——本仓已登记 7 条否决记录（见 `docs/STUN_WINDOW_DURATION.md` §6 与 `.claude/OPEN-ITEMS.md`）。
2. **不许**为了变绿改判据；判据与实现冲突时按规则 10 四步归因（量 delta → 根因 → 确认有意 → 处置）。
3. 每期结束必须：`npm run check` 全绿 + `check-guards` 32/32 + `vue-tsc` 干净 + 定向测试。
4. 基线（`timeGolden` / `timeFillRatchet`）重生成前**必须先跑比对**，把 delta 表写进提交说明。
5. 全库 cycle 队数量**不得高于基线**（当前基线 5；本批已降到 4）。

## 5. 起点指针

- 口径与缺口：`docs/STUN_WINDOW_DURATION.md`（含 §7 佩洛伊斯按块延长）
- **期 1 已落地**：`core/stunTimeline.ts#buildStunTimeline`（+ `core/stunAxisStack.ts` 的
  `StackTraversalResult.windowTrace` 逐窗轨迹）⇒ 期 2 从这里接：把 `stunWindowFraction` 的调用点
  换成 `buildStunTimeline(...).windowSeconds / effectiveTime`，注意源锁
  `core/__tests__/effectiveTimeSingleSource.test.ts`（WINDOW_FRACTION 正则）要同步。
- 现状代码：`core/effectiveTime.ts#stunWindowFraction`、`core/stunAxisStack.ts`、
  `composables/resourceCalc/solveTeam.ts`（外层不动点 + 非失衡时间约束）、
  `composables/resourceCalc/ultimatePromote.ts`（`runPool`/`windowFractionAt`）
- 探针模板：`.zc/perf/stunAudit3.perf.ts`（正确判据 = 跑 `computePanelPhases` 读真实面板值）；
  时间轴探针 `.zc/perf/stunTimelinePhase1.perf.ts`（6 般岳队 + 佩洛伊斯队的逐窗 dump，跑法
  `npx vitest run --config .zc/perf/vitest.perf.config.ts .zc/perf/stunTimelinePhase1.perf.ts`）
- 本批已落地的能力声明：`mechanics/types.ts#stunWindowExtendOnEnd`（佩洛伊斯决算按块延长）
