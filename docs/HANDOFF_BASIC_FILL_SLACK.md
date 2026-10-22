# 交接提示词 ②：平A 填充 / 留白专项 —— **✅ 已结案（2026-10-22）**

> **结案摘要见 §六（文末）**：真因 = 交接 brief 的**方向 B**（水填法只绕正权重槽转 ⇒ 主C 贴顶后剩余池蒸发），
> 已修 `core/resource/helpers.ts#iterate`（第二层兜底），全库留白 102.5s → 42.0s、`slack>1` 14 → 12 队，
> 主队 `auto-1091-1031-1311` 33.6s → 0.00s。**本文档正文保留为历史任务 brief，勿按它重开工。**
>
> 用途：直接粘给新对话作为任务 brief。
> 背景：2026-10-21 把交互默认全 0 之后，`auto-1091-1031-1311` 的留白从 21.1s 涨到 **33.6s**，
> 破了 `timeFillRatchet` 的「留白 ≤ 30s」**绝对不变量**。用户口径：
> 「**留白正常情况是 0**，你这个平a怎么没有自动填充呢。不止这个队，其他所有空白队都应该自动填充。」

---

## 任务

让「平A 池自动填满剩余时间」真正生效 —— 目标是把全库留白压到 0（或解释清为什么某些留白是物理必然）。

## 一、已知事实（都已实测，不用重查）

### 1. 现状读数（`auto-1091-1031-1311`）

| 状态 | slack（留白） | pool | 伤害 |
|---|---|---|---|
| 交互 6/10（改动前默认） | 21.1s | 2 | 48.8M |
| 交互 0（改动后） | **33.6s** | 1 | 46.2M |

### 2. 该队的分配细节（交互 0 时）

```
weights = 1/0/0
s0[1091] nec=87.6  basic=92.4  front=176.6  back=3.4
s1[1031] nec=16.9  basic=0.0   front=16.9
s2[1311] nec=2.2   basic=0.0   front=2.2
Σnec=106.7  Σbasic=92.4  Σ=199.1 / 180
```

- `s0` 的 `front = 176.6`，**距 180 差 3.4s** —— 平A 本可以再给 3.4s 却没给。
- `s1`/`s2` 的 `weight = 0`（不接平A）。
- `Σ所有物化行 = 195.7s`（超预算 15.7s），但 `netFrontlineOccupation = 149.1`
  （扣掉轴内合轴分摊 46.6s）⇒ `slack = 180 − 149.1 = 30.9s`。

### 3. 已试过并**回退**的修法（别再走）

改 `src/core/resource/helpers.ts:828`：

```ts
// 原（正确）
const headroom = Math.max(0, totalTime - totalNecessary[i]) - basicAlloc[i]
// 试过（错）
const headroom = Math.max(0, totalTime - cappedNecessary[i]) - basicAlloc[i]
```

**假设**：「写进 state 的是 capped，headroom 却用 total ⇒ 分不出去 ⇒ 留白」。
**实测证伪**：`totalNecessary` 含 `cfg.timeBudgetExcess`（折叠残差，见 `helpers.ts:562`），
它**比 capped 大** ⇒ 改 capped 让 headroom 变大、平A 分得更多 ⇒ 更差。
实测留白 30.9s → **33.6s**。已在注释里留痕（`helpers.ts:817` 附近）。

## 二、要查的方向（按可能性排序）

### 方向 A：`netFrontlineOccupation` 的合轴分摊是否扣多了

`net = Σ前台行 − min(Σ前台行, 该槽轴内合轴分摊)`。
若某槽的 `slotOverlap` 被高估，`net` 就偏小 ⇒ 误报留白。
- 检查 `frontlineOccupationBreakdown`（`src/core/resource/timeOccupation.ts:97`）
- 对 1091 打印逐槽 `rowNet` / `slotOverlap` / `net`

### 方向 B：`weight = 0` 的槽为什么不接平A

`s1`/`s2` 的 `weight = 0`，而 `s0` 贴顶后池还有剩 ⇒ 留白。
- 检查 `effectiveWeights` 的兜底（`helpers.ts:795` 附近）：
  只有「**全队权重皆 0**」时才让 slot0 独享，**部分为 0 时不兜底**。
- 问题：`s0` 贴顶后，`s1`/`s2` 明明有余量（`back = 163.1 / 177.8`）却不接。
- **这可能就是「平A没自动填充」的真因**：水填法只在 `effectiveWeights[i] > 0` 的槽之间分配。

### 方向 C：交互归零后 pool 掉到 1，失衡时间少 ⇒ nec 变小 ⇒ 平A池变大但没人接

- 交互 0 → `pool = 1`；交互 6/10 → `pool = 2`。
- `nec` 变小 ⇒ `availableBasicTime` 变大 ⇒ 但 `s0` 已贴顶、`s1`/`s2` 不接 ⇒ 留白。
- 这是**交互归零的连带效应**，不是平A机制的 bug。

### 方向 D：其他留白队是否同一根因

`grep` 全库 `slack > 1` 的队，看是否都是「只有 slot0 有权重」的形态。

## 三、执行步骤

```bash
# 1. 先复现
npx vitest run src/composables/__tests__/timeFillRatchet.test.ts 2>&1 | grep -A5 '绝对不变量被破'

# 2. 打印该队的逐槽明细（探针模板见下）
# 3. 按方向 A→B→C 逐个验证
# 4. 找到根因后，A/B 量化「修前 vs 修后」的全库留白
```

探针模板（可直接复制到 `src/zzprobeXXX.probe.test.ts`）：

```ts
import { describe, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { buildTeamTimeSummary } from '@/composables/teamTimeSummary'
import { useConfigStore } from '@/stores/config'
import { teamPresets } from '@/data/teamPresets'

describe('p', () => {
  it('probe', async () => {
    const preset = teamPresets.find(p => p.id === 'auto-1091-1031-1311')!
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    for (let i = 0; i < 3; i++) config.setAgent(i, preset.team[i])
    config.applyTeamPreset(preset.team as [string, string, string])
    const calc = useResourceCalc()
    const rr: any = calc.resourceResult.value!
    const t = buildTeamTimeSummary({ rr, battleTime: rr.totalTime, invincibleTime: config.enemy.invincibleTime ?? 0, nameOf: (_a: string, s: number) => 's' + s })
    console.log('slack=' + t.slack.toFixed(1) + ' rowsNet=' + t.rowsNet.toFixed(1) + ' budget=' + t.budget)
    for (const c of rr.characters) {
      console.log('  s' + c.slot + ' nec=' + c.timeAllocation.necessaryTime.toFixed(1)
        + ' basic=' + c.timeAllocation.basicAttackTime.toFixed(1)
        + ' front=' + c.timeAllocation.frontlineTime.toFixed(1)
        + ' weight=' + (config.team[c.slot] as any)?.basicAttackTimeWeight)
    }
  }, 900_000)
})
```

## 四、验收

- [ ] 找到留白的**确切根因**（不是「大概因为交互少了」，要指到具体那行代码）
- [ ] 给出修法 + A/B 数据（全库 `slack > 1` 的队数：修前 / 修后）
- [ ] `timeFillRatchet` 的「绝对不变量」转绿（**不允许**靠调地板值绕过 —— 那是绝对不变量）
- [ ] 若某些留白是物理必然（如该槽确实没东西可打），在测试里逐队标注理由

## 五、注意事项

1. **不要为了转绿去调 `ABS_FLOOR`（30s）** —— 注释明写「绝对不变量……不能靠重生成基线绕过」。
2. **改 `helpers.ts` 的分配逻辑前，先跑 `timeGolden`** 看全库影响面。
3. **交互全 0 是用户新裁决（`13b9f584`）**，不要回退它来让留白变小。
4. 相关文档：`docs/STUN_CONTINUOUS_LASTWINDOW.md` §45（本轮排查记录）。

---

## 六、结案记录（2026-10-22，本轮完成）

### 真因 = 方向 B（已实测证实）

`core/resource/helpers.ts#iterate` 的平A水填法只绕 `effectiveWeights[i] > 0` 的槽转：
雅（权重 1）分到的份额贴到**单人物理上限**（`totalTime − totalNecessary` = 180 − 87.60 = 92.40s）后退出，
池里剩的 **30.16s 没有任何槽能接** ⇒ 直接蒸发成留白（`timeBudgetIdleSeconds = 33.59`）。
妮可/耀嘉音的 `weight = 0` 只是**职业缺省**（`stores/config.ts#defaultBasicAttackTimeWeight`：支援/防护 = 0），
不是「不会普攻」—— 主C 时间轴满了以后，剩下的池只可能在队友身上兑现（主C 合轴窗口里队友上场平A）。

四条方向逐条判：

| 方向 | 结论 | 依据 |
|---|---|---|
| A 合轴分摊扣多了 | **证伪** | 该队 `axisOverlapByAction` 为空；净占用 146.41 = Σ物化行 191.21 − 每槽 max(credit) 44.80，逐槽核对无误 |
| **B weight=0 槽不接池** | **真因** | 池 122.56s，雅只装得下 92.40s ⇒ 剩 30.16s 无主 |
| C 交互归零连带 | 触发条件，非根因 | 同形态 `auto-1401-1411-1031`（交互没动）也是 26.89s |
| D 其他留白队同因 | 只有 2 队是同形态 | 其余 12 队是量化/试探残差（见下） |

### 修法

`helpers.ts#iterate` 平A分配加**第二层兜底**：第一层（按权重水填）分完还有剩时，把剩余池**等分**给
「仍有余量的非声明槽」（水填、逐个退出、单人物理上限照旧、不写回 store）。三条边界：
① 第一层没剩 ⇒ 逐位不变；② 零权重槽之间**等分**（引擎判断不了「给谁更划算」，等分是诚实的口径，
与第三层降级同源）；③ 模块**显式声明** `defaultBasicAttackTimeWeight = 0` 的槽（蕾米埃尔后台飞行 /
薇薇安合轴快切 / 卢西娅计划内 A5）与**单人队**不接。

判据 = `src/core/__tests__/basicPoolLeftoverFill.test.ts`（5 例：主队归零 / 第二队归零 / 第一层不启动 /
声明槽不接 / 全库不制造超预算；**反向验证**：撤掉实现后前两条立刻红），并更新 `comboAlignBudget.test.ts`
那条「无队友可接时留在池里」的旧断言（口径变更，注释带用户原话）。

### A/B 实测（全库 93 队预设，`timeFillRatchet` 口径）

| 指标 | 修前 | 修后 |
|---|---|---|
| 留白合计 | 102.5s | **42.0s** |
| `slack > 1` 队数 | 14 | **12** |
| `auto-1091-1031-1311` | 33.59s（破 30s 绝对地板） | **0.00s**（`timeGolden` 预设口径：stun 1→2、伤害 46.25M→51.68M） |
| `auto-1401-1411-1031` | 26.89s | **0.00s**（同口径伤害 83.94M→85.18M = +1.5%） |
| 超预算队数 / 最大超预算 | 0 / 0.10s | **0 / 0.10s** |

`timeFillRatchet` 基线只有这 2 条进 diff（其余 91 队逐位不变）；`timeGolden` 只有这 2 条预设条目进 diff。

### 验收清单（对本文「四、验收」逐条）

- [x] 找到确切根因：`helpers.ts#iterate` 的水填循环 `if (effectiveWeights[i]! > 0 && headroom > 1e-9)`
      —— 权重 0 的槽永远进不了 `open` 列表（不是「合轴分摊扣多了」）
- [x] A/B：`slack > 1` 队数 14 → 12，留白合计 102.5s → 42.0s
- [x] `timeFillRatchet` 绝对不变量转绿（**没动** `ABSOLUTE_SLACK_FLOOR = 30`）
- [x] 剩余 12 队的留白逐类标注（物理上限 / 试探拒绝 / 量化地板），见 §五①

### 剩余 12 队为什么不是 bug（别再当留白修）

1. **池已经全部分完**：这 12 队 `poolResidual = 0`、`basicUnspent = 0` ⇒ 剩下的 `slack` 是
   `comboAlignDeduction` 与 `ledgerInflation`（负 = 物化必要行 > 净账本）相抵后的 1~5s 余量，
   即**账本口径 vs 物化口径**的差（合轴 credit 是团队预算抵扣，行侧 `slotNetFrontline` 也按同一份额减了一次，
   见坑 19③/④）。伊德海莉/比利两族的池还**物化成模块行**（`basicModuleRows` 27~57s，时间真花掉）。
2. **末轮欠打试探拒绝注入**：实测 `auto-1611-1571-1211` 四次折半试探 `trialRows` 185.9~192.5s 全部
   `fitsBudget = false`（超预算 6~12s），按「宁可留白不制造超预算」回滚 —— 这是**可行性优先于留白**那条纪律
   （`ENGINE_PIPELINE_GUIDE.md` §4 坑 19①）在起作用。
3. **1~5s 残余 = 量化地板**：整数装包 + 试探粒度（坑 12/19 口径「不追求精确 0」）。

> 若将来要让这些队的留白也归零，杠杆不是平A分配，而是**实数化专项**（模块「资源→动作套数」的 floor）
> 或**装配期模块行进账本**（判据③双算的反向）—— 两者都是另立专项的量级，别在本条重开。

### 追问②（同日）：「雅/爱丽丝的合轴时间只能给队友」—— 说对了，且就是同一个修法的另一半

用户原话：「**雅和爱丽丝这种自带基础合轴率的，其合轴时间只能给队友分配，这部分时间是空余的原因吗。
那只能默认设置给队友吃了，没有权重也得战场。**」

**结论：这不是另一个 bug，是第二层兜底顺带修掉的同一件事。**

`comboAlignCredit` 的物理含义 = 本槽动作**与队友前台并行**的秒数。修前 `auto-1091-1031-1311`：

| 槽 | 角色 | 合轴抵扣 | 队友前台合计 | 差额（幻觉） |
|---|---|---|---|---|
| s0 | 星见雅（1091） | **38.94s** | **14.65s** | **24.30s** |
| s1 | 妮可（1031） | 4.99s | 178.73s | — |
| s2 | 耀嘉音（1311） | 0.87s | 189.04s | — |

队友不上场 ⇒ **没有并行对象** ⇒ 这份抵扣同时把平A池扩大、又把净占用减掉（两次白拿）。
全库只有 2 队有这种形态（`auto-1091-1031-1311` 24.30s + `auto-1401-1411-1031` 13.00s = 37.30s），
而它们正是留白最大的 2 队 —— 因为队友不上场，主C 独自也吃不完那么多时间。

**修后全库恒等式成立**（逐队零容差）：`∀槽 i：comboAlignCredit_i ≤ Σ_{j≠i} frontlineTime_j`。
判据 = `basicPoolLeftoverFill.test.ts` 的「合轴只能与队友并行」用例（修前 2 队违反、修后 0 队）。

### 追问③（同日）：妮可的平A 时间 —— **0.5 权重已撤回**，改由「平A 行的合轴率」承载

用户一段话两个判断，第二段推翻了第一段的实现方式：

> 「**嘉音不能a，妮可可以a，妮可本身就是速切玩法，需要一定平a时间才能覆盖减防buff。可以把妮可单独给0.5权重。**」
> 「妮可通常会和主c合轴，所以这里减防基本是偷的合轴时间，并且妮可合轴平a得到一点能量也可以覆盖其招式的能量场。
> 所以这里固定0.5权重其实不严谨」

**说得对，是同一件事的两种实现，而权重是错的那个。** 关键区别：

| | 权重 0.5（已撤回） | 合轴平A（正确载体） |
|---|---|---|
| 时间从哪来 | **从平A 池里切一块给妮可**（主C 少打） | 与主C **并行**，不占团队预算 |
| 减防覆盖 | 靠这段独立前台时间 | **偷合轴时间**（用户实战就是这样） |
| 回能 | 独立回能 | 合轴回能，够覆盖能量场 |
| 代价 | 主C 让出 3~25s ⇒ **总伤下降** | 不抢主C 时间 ⇒ 无此代价 |

**实测撤回前后（预设口径）**：

| 队 | 权重 0.5 | 职业缺省 0（现状） | 差 |
|---|---|---|---|
| `auto-1091-1031-1311` | 18,002,572 | **18,882,899** | **−4.7%** |
| `auto-1401-1411-1031` | 22,981,964 | **24,129,465** | **−4.7%** |
| 全库 11 队合计 | 2,061,562,225 | **2,075,741,241** | **−0.7%** |

留白代价：全库留白 40.46s → **42.03s**、`slack > 1` 11 → **12**（`auto-1021-1031-1491` 1.57s，
本身是账本口径差不是池没分完，见 §45）。**这是可接受的**：那 1.57s 换 11 队 −0.7% 总伤，方向反了。

**嘉音 `defaultBasicAttackTimeWeight: 0` 保留**（「嘉音不能a」是机制事实，与权重口径无关，且它同时是第二层兜底的
排除条件）。妮可 `defaultBasicAttackTimeWeight` 保持职业缺省 0（支援 = 0）。

⏳ **剩下的活（未做，需用户裁决要不要做）**：引擎目前**没有「平A 行合轴率」通道** ——
`rowBuild.ts#buildExecutions` 的 `basic_attack` 汇总行 `comboAlignRatio: 0` 写死，
`CharacterOperationConfig` 也没有 `basicComboAlignRatio` 字段。要落地这条口径需要：
① 新增 cfg 字段 + 模块声明（妮可 = 某比例）；② 该比例进入 `comboAlignCredits`（团队预算抵扣）
而不是只写行上（写行上 = 死数据，CC-454 有机器判据拦）；③ 妮可的平A 时间便不再需要从池里分。

