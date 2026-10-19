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

### 期 1：窗口时间轴（Time-axis）数据结构 —— **地基**

新增一个纯函数模块 `src/core/stunTimeline.ts`：

```ts
export interface StunWindowSlot {
  index: number              // 第几个窗口（0-based）
  startSeconds: number       // 窗口开始时刻（绝对秒）
  nominalSeconds: number     // 名义窗长 W（含所有常驻延长）
  extendedSeconds: number    // 决算类按块延长（佩洛伊斯 +3s）
  effectiveSeconds: number   // 实际可用于爆发的秒数（= nominal + extended − 决算截断）
  truncated: boolean         // 是否被决算提前结束
  actions: StunWindowAction[]// 窗内动作（来自轴；非轴模式为空 = 走比例近似）
  unusedSeconds: number      // 窗内剩余（给期 4 用）
}
export function buildStunTimeline(input: {...}): StunWindowSlot[]
```

**验收**：对 6 支般岳队 + 佩洛伊斯队输出窗口时间轴，`Σ effectiveSeconds + 窗外时间 == 180`
（恒等式，零容差）。新测试 `stunTimeline.test.ts` 锁这条恒等式。

⚠ **不要**在这一期改动任何既有数值；只新增模块 + 测试（零 delta）。

### 期 2：用时间轴替换 `stunWindowFraction` 的聚合口径

把 `stunWindowFraction(N, W, effTime)` 换成 `Σ timeline[i].effectiveSeconds / effTime`。
这会改数值（最后一窗不再按整窗算）⇒ 按规则 10 四步逐队归因 + 重生成 `timeGolden`/`timeFillRatchet`。

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
- 现状代码：`core/effectiveTime.ts#stunWindowFraction`、`core/stunAxisStack.ts`、
  `composables/resourceCalc/solveTeam.ts`（外层不动点 + 非失衡时间约束）、
  `composables/resourceCalc/ultimatePromote.ts`（`runPool`/`windowFractionAt`）
- 探针模板：`.zc/perf/stunAudit3.perf.ts`（正确判据 = 跑 `computePanelPhases` 读真实面板值）
- 本批已落地的能力声明：`mechanics/types.ts#stunWindowExtendOnEnd`（佩洛伊斯决算按块延长）
