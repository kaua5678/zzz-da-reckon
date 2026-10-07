# 类型只声明一次：恒等断言与结构副本（r729，判据 29）

> 2026-10-08 arena-G r729，代码提交 `bc76f28e`。判据实现在 `scripts/lib/type-restatement-gate.mjs`，与判据 28 共用一个 program（`scripts/lib/app-program.mjs`）。
> 普查脚本没进仓，放在 `calc-arch/g729/`：`census729.mjs` 给断言按类型分类，`dupshape729.mjs` 找与具名类型同形的类型字面量，`optchain729.mjs` 数死可选链（下一轮候选）。在 worktree 根目录用 node 跑，各约 3 s。

## 1. 结论速览

- 同一个类型只该在声明处写一次。在用处再写一遍有两种形态：
  - **恒等断言**：`x as T` 里 x 已经是 T；
  - **结构副本**：手写的类型字面量 `{ … }` 与某个具名类型逐字段相同。
- 这两种写法不改变任何类型，代价却是实在的：声明一改，副本不会跟着改，编译也不报错。
  - `outerExit` 的联合在 4 个读点各抄了一遍。声明里加一个取值，这 4 处会把它从类型里静默删掉。
  - `buildCharConfig` 里写了 16 遍 `skills as AgentSkills`。要是 `skills` 将来变成可缺，这些断言会把 undefined 吞掉。
  - `ReleaseRowInput` 的注释写着「单一来源，r408 删除其重复内联类型」，damagePoolAnomaly 里却还留着一份逐字相同的副本。
- 只加空的断言（`x as T | undefined`）是另一种谎：它把必填值说成可缺，后面的 `?? 默认值` 因此逃过了判据 28。
- 处理结果：
  - origin `f808afdb` 上有恒等断言 41 处（类型同一 39 处，只加空 2 处）、结构副本 14 处，全部去掉；
  - `outerExit` 的联合起名 `OuterExit`；
  - 判据 29 锁住这两种形态。改前版本在新门下命中 55 处，分布在 26 个文件。
- zd 零差，vitest 文件数和用例数不变。

## 2. 判定口径

### 2.1 恒等断言

- 形态是 `x as T` 或 `<T>x`。`as const` 和 `as unknown`（双重断言的内层）不算。
- 只比较类型不受断言影响的表达式。x 去括号后须是以下之一：
  - 标识符、属性访问、元素访问；
  - 非泛型调用；
  - 以上表达式外面再套一层 `!` 或 `await`。
- 对象 / 数组字面量和泛型调用不比较：它们拿断言目标当上下文类型，`getTypeAtLocation` 拿到的已经是被断言影响过的类型。字面量断言归判据 27 管。
- 「同一」按类型对象比较。TS 对联合等类型做了驻留，成员相同就是同一个对象。
  - 结构等价、但不是同一个对象的断言不报。例如去掉 `Readonly`，或换成带索引签名的 `Record` 以便动态取键。
- 只加空：`getNonNullableType(T)` 恰好就是 x 的类型。
  - 例外是元素访问和走索引签名的点访问。项目没开 `noUncheckedIndexedAccess`，TS 不给这类读取加 undefined，运行时却可能缺值，所以加上 `| undefined` 是如实。口径与判据 28 一致。

### 2.2 结构副本

- 类型字面量 `{ … }`：至少 3 个成员，全部是属性签名或方法签名。
- 具名类型的范围：
  - 扫描面里不带 extends、也不在 `declare module` 里的 interface；
  - 右边是 `{ … }` 的 type 别名。
  - 别名自己右边的 `{ … }` 是声明本身，不算副本。
- 逐字段相同，要同时满足：
  - 成员名集合相同；
  - 每个成员的可选性和类型文本都相同；
  - 两边互相可赋值。
- 泛型具名类型的字段类型文本里带类型参数，自然比不中。
- 为什么从 3 个成员起算：r729 的 14 处里有 6 处恰好 3 个成员（TeamGoldState ×4、StackAxisInput ×2），门槛再高就会漏；而两个成员的小形状碰巧同形的情况太多。

### 2.3 扫描面

与判据 28 相同：src 非测试 `.ts`，共 296 个文件。`.vue` 不扫，因为需要 vue-tsc 的类型信息。

## 3. 普查数字

### 3.1 断言

范围是 src 非测试 `.ts`，含 perf 文件，共 298 个。

| 类别 | 改前 | 改后 | 说明 |
|---|---|---|---|
| 类型同一（恒等断言） | 39 | 0 | 本轮删除 |
| 只加空 | 2 | 0 | 本轮删除，连带删掉随之失效的兜底 |
| 结构等价但不同一 | 5 | 2 | 顺手删了 3 处：去 `Readonly` 的 2 处（alice、miyabi），以及 SpecialActionBonusResult 那处。剩下 statMeta:177 和 agentMechanicView:300，都是为动态取键换成 `Record`，有用 |
| 收窄 | 49 | 49 | 如 Object.keys 收窄成键联合、split 成元组、先判过空再去掉 undefined。TS 会检查两边可比 |
| 拓宽 | 13 | 13 | 含 teamTimeline:347，见 §4.3 |
| any 源 | 9 | 9 | `res.json()` 等 JSON 入口，由 validate:data 的类型契约校验（r725） |
| 字面量 / 复合表达式 | 39 | 39 | 类型受断言上下文影响，比较不出来。三人队元组、空数组等，r719 已逐条判过 |
| 双重断言 | 17 | 17 | 由 r6 §8.0 #24 的计数看守 |
| 其他 | 3 | 3 | analysisScenario 的泛型，以及 config.ts:583 |
| 合计 | 176 | 132 | |

### 3.2 结构副本

- 至少 3 个成员的类型字面量共 300 个。成员名集合与某个具名类型相同的有 19 个，其中逐字段相同的 14 个，就是本轮改掉的那些。
- 其余 5 个只是成员名相同，形状不同：
  - `catalog.ts:426` 的 target 是 string，WEngineAdvancedStat 里是 EffectTarget；
  - `execution.ts:294` 的 id / moveId 是必填，InStunTrigger 里是可选；
  - `applyGoldAllocationToStore` 的入参放宽成只读数组，以便接受任意来源；
  - `discEffectRows.ts:47` 和 `modelingGaps.ts:23` 是有意写宽的「-Like」形状。
- 具名类型之间成员名相同的有 7 对，逐字段相同的 2 对，见 §4.2。
- 类型字面量之间逐字段相同、又不等于任何具名类型的有 28 组。本轮没处理，见 §6。

## 4. 逐处改动（`bc76f28e`）

### 4.1 恒等断言 39 处 + 只加空 2 处

| 位置 | 处数 | 改法 | 备注 |
|---|---|---|---|
| `resourceCalc/helpers.ts`（buildCharConfig） | 16 + 只加空 1 | `skills as AgentSkills` → `skills`；`(skills as AgentSkills \| undefined)?.categories ?? []` → `skills.categories` | skills 在函数开头已判过空；只加空那处的 `?.` 和 `?? []` 也随之失效 |
| `teamTimeline.ts` 458 / 906、`pullPlannerEngine.ts:180`、`teamTimelineFilm.ts:132` | 4 | 删掉 `outerExit as 'stable' \| 'cycle' \| 'maxIter' \| undefined` 的断言 | 同一个联合抄了 4 遍 |
| `teamTimeline.ts` 840–841、`difficultyCurve.ts:160` | 3 | 删掉 `x.team as [string, string, string]` 的断言 | team 的声明本来就是三元组 |
| `core/resource/foldLoop.ts` 313 / 317 / 318 | 3 | `diag.bestExcess as number` 等改为直接读 | |
| `mechanics/agents/severian.ts:392` | 2 | 删掉 `cfg as AgentCharConfigInput['cfg']`、`state as AgentResourceInput['state']` | |
| `core/buff.ts` 412 / 414 | 2 | 删掉 `effect.stat as string`、`… as StatId` | |
| 其余 9 处，各 1 处 | 9 | 删断言 | 见下方列表 |
| `mechanics/agents/evelyn.ts:152` | 只加空 1 | `Number((cfg.panel?.critRate as number \| undefined) ?? 0)` → `cfg.panel.critRate` | panel 和 critRate 都是必填；`?.`、断言、`?? 0`、`Number()` 四层都是空操作 |

「其余 9 处」逐个列出（括号里是 x 为什么已经是 T）：

- `stores/config.ts:732`：getBuildRecommendation 的返回值本来就是这个类型。
- `panelPhases.ts:449`：`b.stat` 本来就是 string。
- `claret.ts:576`：setting 本来就是 number。
- `lighter.ts:301`：moduleExecRow 的返回值本来就是 SkillExecution。
- `luciaElowen.ts:165`：`filter(Boolean)` 的结果本来就是 string[]。
- `roundInputs.ts:281`：`move?.energyCost` 的声明本来就是这个类型，见 §7。
- `useResourceCalc.ts:84`：o 已被前面的判断收窄成 object。
- `difficultyCurve3d.ts:98`：resolved 已经过 every 的谓词收窄成 number[]；只为这个断言存在的别名 idx 一并去掉。
- `freeCompare/engine.ts:324`：choice0 已由三元表达式收窄。

顺手删掉的 3 处「结构等价」断言：

- alice / miyabi 各一处 `state as IterationState`：只是去掉 Readonly，被调函数照样接受；
- `convergence.ts:1189`：calcSpecialActionBonus 的返回类型改为具名类型后，这处断言自然消失。

### 4.2 结构副本 14 处 + 具名同义 1 对

| 位置 | 副本 | 改为 |
|---|---|---|
| `stores/config.ts` applyBossPreset 的 defaults 入参 | 12 个字段 | `BossPresetDefaults` |
| `core/anomalyPool/helpers.ts` calcTurbulenceDamage 的 nonWindElements | 3 个字段 | `AnomalyElementTriggers[]`（这个文件早就 import 了它） |
| `resourceCalc/damagePoolAnomaly.ts` AnomalyRowsEnv.pushRelease 的行入参 | 13 个字段 | `ReleaseRowInput`（它的注释写着单一来源） |
| `mechanics/agents/qingyi.ts` cfg 增补里的 qingyiLoopRates | 8 个字段 | 同文件的 `LoopRates` |
| `core/anomalyPool.ts` calcSpecialActionBonus 的返回类型 | 10 个字段 | `SpecialActionBonusResult` |
| `resourceCalc/convergence.ts` 的 deps.buildStackAxes、`roundInputs.ts` 的 buildStackAxes，两处返回类型 | 各 3 个字段 | `StackAxisInput[]` |
| `useResourceCalc.ts` axisAllocation 的值类型 | 4 个字段 | `StunAxisAllocation` |
| `teamCompare.ts` 3 处（候选的 state 字段、trials 数组、recordTrial 入参），以及 `pullPlannerEngine.ts` holdingStateFor 的返回类型 | 各 3 个字段 | `TeamGoldState` |
| `charIncrement.ts` IncRun.team、`pullValue.ts` PvRun.team | 4 个字段 | `LimitedGoldMember`（limitedGold 自己的 run 类型早就这么写） |

具名类型之间逐字段相同的 2 对，处理不同：

- `core/stunAxis/inStunAnomaly.ts` 的私有 `ActiveInterval` 与 `BossStateSegment` 是同一个东西：当前段 std 就是被 push 进状态链的那一段。私有副本已删除。
- `DisorderFormula` 与 `TurbulenceFormula` 不动，理由见 §6。

### 4.3 OuterExit

- 在 `types/resource/team.ts` 给联合起名 `OuterExit`。以下三处改写成这个名字：
  - `ConvergenceReport.outerExit`；
  - solveTeam 里 runOuterLoop 的返回类型；
  - solveTeam 里的同名局部变量。
- `teamTimeline.ts:347` 这处断言是拓宽，不能删：
  - 函数开头已判过 `=== 'maxIter'` 并提前返回，所以在这个读点 TS 认定不会是 maxIter。
  - 中间改过 store，计算属性会重算，运行时确实可能再出现 maxIter。但 TS 不会因为中间的函数调用而作废属性链上的收窄。
  - 处理：断言目标改写为 `OuterExit | undefined`，注释改成真实原因。原注释说「calcOutput 里 convergence 被重建过，TS 推断丢了 maxIter 字面量」，这个解释不对。

## 5. 判据 29

- check-guards 的第 29 条叫 `type-restatement gate`，基线 0。扫描 296 个文件，下限 250，低于下限视为没扫到。
- detector 自证：在内存里建一个 noLib 小程序，共 26 行，覆盖两种形态的正例和反例。
  - 应当命中的：
    - 恒等断言，标识符和非泛型调用各一例；
    - 只加空，声明过的必填属性；
    - 结构副本，与 interface 同形、与 type 别名同形各一例。
  - 不应命中的：
    - 收窄；泛型调用；字面量；`as const`；
    - 给元素访问、索引签名加 undefined；
    - 字段类型不同、可选性不同；泛型具名类型；不足 3 个成员。
  - 命中必须恰好是：第 9 行恒等、第 10 行只加空、第 12 行恒等、第 15 行副本、第 17 行副本、第 26 行只加空。
- program 共用：
  - `appTsProgram(root)` 按仓库根缓存，判据 28 和 29 在同一进程里只建一次 program；
  - 判据 28 的扫描面函数搬进同一个文件，改名 `isAppTsScanned`；
  - check-guards 全程约 15 s。
- 反例验证：
  - 改前版本（`f808afdb`）在新门下命中 55 处，分布在 26 个文件：恒等 39、只加空 2、副本 14；
  - 往改后版本注入 3 处（恒等、只加空、副本各一），全部报出，还原后干净。
- 报错怎么改，详见门的头注释。要点：
  - 删掉断言；
  - 改为引用具名类型，跨层引用不到就把具名类型下沉到 types/；
  - 同形不同义就改字段名，不加豁免。

## 6. 不做的事与下一步候选

| 事项 | 为什么本轮不做 | 重开条件 / 将来怎么做 |
|---|---|---|
| 结构等价但不同一的 2 处断言（statMeta:177、agentMechanicView:300） | 为了动态取键换成 `Record`，有用 | 无 |
| 拓宽 13 处、收窄 49 处 | 拓宽是安全的；收窄时 TS 会检查两边可比，多数是 Object.keys、split 成元组、先判空再去掉 undefined | 无 |
| 类型字面量之间的副本 28 组（至少 3 个成员、逐字段相同、不等于任何具名类型） | 要给每组起名，本轮先收「已有名字却不用」的。最值得收的几类：①mechanics 钩子的入参 / 返回类型被角色模块抄写，`{enemyDefReduction, enemyResReduction, note}` ×4、`{element, note, source}` ×4，types.ts 的 1095 / 1253 / 1275 行各与一个模块同形；②`{slot, moveId, count}` ×7，分布在 stunAxisStack / convergence / roundInputs；③`{block, dodge, dual, parry}` ×4；④teamCompare 的候选步骤 `{slot, kind, value, label}` ×3 | 下一轮可选题：先在 types.ts 给钩子入参 / 返回类型起名，模块改为引用名字；再给判据 29 加「字面量 ≡ 字面量」形态，门槛建议「≥3 个成员且出现在 ≥2 个文件，或同一文件 ≥3 次」 |
| 具名同形的 DisorderFormula / TurbulenceFormula | 两张表用同一个公式。真正的重复在两处计算同一公式的代码，以及两张表里重合的 tick 列（还与 STANDARD_DOT_CONFIG 的 tick 数字重合）。只合并类型名是表面功夫 | 要收就连数据一起收：tick 参数按元素建一张表，两个基础倍率各一列，配一个计算函数。数值零差用 zd 验证。**r730 已收**（`6cd14032`）：一跳表 + 两张基础倍率表 + 两个计算函数，zd 零差，见 mcp-calc-core-architecture.md CC-512 |
| 死可选链：`a?.b` 里 a 的类型不含 null / undefined。src 非测试 .ts 共 321 处（91 个文件），按链头分：声明过的属性 105、标识符 94、元素访问 122 | 道理与判据 28 相同（把必填说成可缺）。但元素访问那 122 处运行时真可能缺值；标识符里也有一部分来自 `arr[i]`，同样可能缺。需要像 r723 那样逐类判断 | 下一轮可选题：判据 28 扩展到 `?.`，先收「链头是声明过的必填属性」的 105 处。**r731 已做**（`e20d824c`）：判据 28 扩到 `?.`，链头与链内共 244 处收口；下标取值的别名同下标取值不判，见 mcp-dead-nullish-census.md §4.6 |
| `.vue` | 需要 vue-tsc 的类型信息 | 与判据 28 相同 |

## 7. 更正

- `docs/mcp-dead-nullish-census.md` §4.5 把 `roundInputs.ts` 的 `move?.energyCost as Record<string, string> | undefined` 归为「动态键访问，有意边界」。这不对：energyCost 的声明本来就是这个类型，断言是空操作，已删除。
- r6 §8.0 #24 说「剩下的才是收窄到命名类型」。其中 44 处其实不收窄（类型同一 39、只加空 2、结构等价 3），已删除。
- `teamTimeline.ts:346` 原注释对断言原因的解释不对，见 §4.3。

## 8. 验证

| 项 | 结果 |
|---|---|
| vue-tsc | 0 错 |
| check-guards | 29 条（判据 29 = 0/0，扫 296 个文件） |
| zc.test + checkGuards.test | 207 |
| tokens / data / specs / recording | 12 / 161 / 462 / 189 |
| vitest | 261/2165 + 263/2342 = 524 / 4507 |
| zd | DUMP 0 / ROWS 0 |
| build | index 1602.26 → 1602.23 kB（gzip 465.90 → 465.91） |
| zc drift | 154 / 0 / 0 |

回退：`git revert bc76f28e`。
