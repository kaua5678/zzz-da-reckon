# 前台行时长只算一处（r738）

> 代码提交 `ae256a04`（arena-G r738）；arch CC-520；r6 §8 第 738 行。题目来自 `docs/mcp-default-suite-probes.md` §8.5（r737 交接的候选）。r739 续做截断预算的往返减法，见第 9 节（`14046a6c`，CC-521）。r740 续做 kept 由截断结果直接给出，见第 10 节（`1f0e9e1a`，CC-522）。

## 1. 问题

「一个槽的前台行加起来多长」写了 5 遍。5 处都是「对 `isFrontlineExecution` 为真的行把 `totalTime` 相加」，但负值的处理不一样：

| 位置 | 用途 | r738 前对负值的处理 |
|---|---|---|
| `composables/resourceCalc/helpers.ts#normalizeDisplayTime` | 展示层按最终行重算前台 / 后台 | 不钳 |
| `core/resource/assembleSlot.ts`（`execFrontlineTime`） | 装配时写 `timeAllocation.frontlineTime` | 不钳 |
| `core/resource/foldLoop.ts`（`rowTime`） | 折叠环测量每槽行时长（再加两项赠送时间） | `Math.max(0, totalTime)` |
| `core/resource/timeOccupation.ts#slotNetFrontline` | 单槽净占用（超时判定、欠打试探、占用拆解共用） | 净值的 rowSum 钳 `max(0, t)`；经 `tally` 出参逐行累加的毛前台不钳 |
| `composables/teamTimeSummary.ts#slotRows` | 时间分配汇总卡，按三段拆 | 每行钳 `max(0, t)` |

一旦出现负行，展示和装配会跟折叠环、净占用对不上。所以先要回答：`totalTime` 会不会为负。

## 2. `totalTime` 会不会为负

### 2.1 读生产方（cb2a1174）

- 类型注释：`totalTime` = count × actionTime（`types/resource/execution.ts`）。
- 平A行：`rowBuild.ts` 取 `state.basicAttackTime`，即 `core/resource/helpers.ts` 水填出的 basicAlloc。它从 0 起只累加非负的 give，可分配量 `availableBasicTime` 本身已取 `max(0, …)`。
- 截断与利用率：`timeTruncation.ts` 按 count × 单位时长缩；`rowAccounting.ts` 按利用率缩，比例在 [0, 1]（rate 钳在 [0, 1]，cap 钳到 ≥ 0）。都不会变负。
- 从平A行扣时间的模块都在源头钳到 0：`ultimatePromote.ts`、`liuyin.ts`、`nangong.ts`、`anby.ts` 用 `Math.max(0, …)`；`ellen.ts` 的 carve = `max(0, min(平A时长, 循环时长))`，不超过平A时长。
- 测试里没有构造负 `totalTime` 的行（`git grep 'totalTime: \?-[0-9]'` 0 命中）。
- 全库只有 `isFrontlineExecution` 判前台（直接写 `timeBucket !== 'backstage'` 的只有它自己），5 处都经过它。

### 2.2 插桩实测

在 wtG-738 临时改 `isFrontlineExecution`：遇到前台行的 `totalTime` 不满足 `>= 0`（NaN 也算），就 `console.error('NEG_ROW', moveId, t, 栈)`，返回值不变。

| 跑了什么 | 结果 |
|---|---|
| vitest 第 1 片 | NEG_ROW 只出现 1 次，是 checkGuards 在报插桩源码本身（判据 29 抓到插桩里的 `as` 断言，所以这片有 1 例失败，属预期）；stderr 块 0 |
| vitest 第 2 片 | NEG_ROW 0；stderr 块 0；262 / 2348 全过 |
| zd（全部预设 × default / c0 / c6 / w / heavy；含 1171 / 1261 / 1401 / 1581 的队另加 axis） | dump、rowsnap 两路输出 NEG_ROW 0、stderr 0；差异 0 / 0 |

vitest 会把测试里的 console 输出按「stdout | / stderr |」块打出来（两片分别有 4 / 15 个 stdout 块），所以 stderr 块为 0 就说明全套没有一次 console.error。插桩随后用 `git checkout` 撤掉。

结论：负行按构造不会出现，实测也没有。三处 `Math.max(0, …)` 是死防御，而且只防了 5 处里的 3 处。

## 3. 改法（`ae256a04`）

- `types/resource/execution.ts` 新增：
  - `frontlineRowSeconds(rows, from = 0)`：Σ 前台行 `totalTime`，不钳；
  - `FrontlineRow = Pick<SkillExecution, 'totalTime' | 'timeBucket'>`，取代 `timeOccupation.ts` 里的 `FrontlineRowLike`（后者 `totalTime` 可选，可两个生产调用方传的都是 `SkillExecution`）；
  - `SkillExecution.totalTime` 的注释写明「≥ 0 由生产方保证，消费方直接相加、不再各自钳」。
- 5 处改成：

| 位置 | r738 后 |
|---|---|
| `normalizeDisplayTime` | `frontlineRowSeconds(c.executions)` |
| `assembleSlot` | `frontlineRowSeconds(executions)` |
| `foldLoop` | `frontlineRowSeconds(executions)` + 赠链 + 赠大（加法顺序不变） |
| `slotNetFrontline` | rowSum = `frontlineRowSeconds(rows)`；`tally` 出参删掉，改为返回 `axisCut` |
| 占用拆解 `frontlineOccupationBreakdown` | 毛前台 `gross = frontlineRowSeconds(ch.executions, gross)` 跨槽接着加；`axisOverlap += r.axisCut` |
| `teamTimeSummary#slotRows` | 三段拆分保留（要分桶，不能直接用合计），只删钳位 |

- `from` 参数只为占用拆解保留：原来毛前台是跨槽逐行累加的，用 `from` 接着加，累加顺序和原来一样。
- `assembleSlot` 的注释原来前后矛盾：先说「装配后追加的赠送行不在 Σ行里」，后面又说「赠行已在 executions 里」。按 `chainGift.ts` / `ultimatePromote.ts` 的实际行为改写：赠送行的占位行在装配时物化进 `executions`；之后编排层按池口径改写或撤掉占位行（轴模式另有 post-hoc carve），所以 `normalizeDisplayTime` 要按最终行再算一次，用的是同一个函数。
- `slotNetFrontline.test.ts`：`tally` 断言换成 `r.axisCut` 和 `frontlineRowSeconds(rows)`（后台行不计）；源码锁从「timeOccupation.ts 里恰好 1 处 `isFrontlineExecution(`」改为「1 处也没有」。
- `@fact engine:收敛环停点规范化` 的锚 `foldLoop.ts#runFoldLoop` 动过（行测量改调 helper），复核后结论仍成立，据链加「复核@2026-10-08」。

## 4. 为什么逐位不变

- 对 `t >= 0`，`Math.max(0, t) === t`；`t = -0` 时两边都只是给和加一个零。
- 后台行原来加 0（或乘 0 后加），`x + 0 === x`；现在直接跳过。
- `foldLoop` 仍是 (Σ + 赠链) + 赠大。
- 毛前台、`axisOverlap` 的累加顺序都没变（毛前台靠 `from` 接着加，`axisOverlap` 仍是逐槽加）。毛前台只进占用拆解（合轴解放秒数、难度轴），不在 zd 覆盖范围里，它的逐位不变靠的是累加顺序相同，不是靠 zd。

## 5. 验证

vue-tsc 0；check-guards 29 条通过；tokens / data / specs / recording 12 / 161 / 462 / 189；zc.test + checkGuards.test 207；vitest 258 / 2155 + 262 / 2348 = 520 文件 / 4503 例，与基线相同；zd DUMP 0 / ROWS 0；build index 1599.30 kB（gzip 465.20，原 1599.47）；zc drift 154 / 0 / 0。

## 6. 不做

- 其他对「前台时间」的 `max(0, …)` 不扩：`effectiveTime.ts`、`luciaElowen`、`lucy`、`claret`、`actionOperationRows.ts` 里钳的是账本量或状态量，不是行时长。
- 不加「行时长 ≥ 0」的运行时断言或守卫测试：生产方已在源头钳，再加就是防御性冗余。以后新增从平A行扣时间的模块，按 `SkillExecution.totalTime` 的注释在源头钳。
- `teamTimeSummary` 每槽调 4 次 `slotRows`（三段合计和 perSlot 各一次）：开销很小，不在本题。

## 7. 下一轮候选（r739 已做，见第 9 节）

**截断预算的往返减法。** `rowBuild.ts#feasibleRowsUncached` 先把前台 `basic_attack` 行加成 basicTime，只是为了调 `truncateExecutionsToFrontline(rows, basicTime + rowTimeLimit)`；后者进门又把 basicTime 算一遍，再算 `room = max(0, (basicTime + rowTimeLimit) − basicTime)`。同一个和算了两遍，room 也可能跟 rowTimeLimit 差一个 ulp。可以考虑让截断函数直接接收招式行预算。这可能改变 ulp 级结果，要用 zd 量；如有差异，按 AGENTS 规则 10 逐条归因。

## 8. 回退

`git revert ae256a04`（文档另提交）。

r739：`git revert 14046a6c`（文档另提交）。

r740：`git revert 1f0e9e1a`（文档另提交）。

## 9. r739：截断预算不再往返（`14046a6c`）

第 7 节的候选，r739 做完。

### 9.1 问题

重折环（`truncationRefold.ts`）把上一轮装配的 kept（招式行真兑现的秒数）写进 `cfg.rowTimeLimit`，账本侧 `feasibleRows` 要把招式行截到不超过这个数。可截断函数只收「可用前台（含平A）」，于是：

- `rowBuild.ts#feasibleRowsUncached` 先把前台 `basic_attack` 行加成 b，传 `b + rowTimeLimit`；
- `truncateExecutionsToFrontline` 进门再算一遍 b，`room = max(0, (b + L) − b)`。

同一个和算了两遍。rowBuild 还得照抄截断函数对「平A占位」的定义才能抵消掉，占位规则一改，这里就会悄悄失配。

### 9.2 实测

临时插桩 `feasibleRowsUncached` 的截断分支，跑一遍 zd 矩阵（全部预设 × 全部场景）：

| 项 | 值 |
|---|---|
| 截断分支被调用 | 470,768 次（1021 / 1031 / 1051 / 1161 等多个角色都有） |
| `(b + L) − b` 不逐位等于 L | 13,542 次（2.9%），例：1361，L = 28.168，b = 60 |
| 改成直接传 L 之后 | 终局 zd 0 / 0：整数装包加回时有 1e-9 的容差，把这些 ulp 噪声吸收了 |

日志在 `calc-arch/g739/rtl.log.gz`（不入库）。插桩已撤。

### 9.3 改法

- `timeTruncation.ts` 分两层：
  - `truncateMoveRows(executions, room)`：整数装包本体（招式行合计、入口容差、按比例 floor + 小数降序加回、逐行明细），逻辑逐字未动；
  - `truncateExecutionsToFrontline(executions, availableSeconds)`：只做「平A先占位」，算出 `room = max(0, available − 前台平A行)` 后交给前者。返回类型写成 `ReturnType<typeof truncateMoveRows>`，形状只写一次。
- `feasibleRowsUncached` 直接调 `truncateMoveRows(rows, rowTimeLimit)`。
- rowTimeLimit 的契约收紧。唯一写入方是重折环，写的是装配的 kept；kept 在 `assembleSlot` 已经是 `Math.max(0, used − cut)`，恒有限非负。所以：
  - 读方守卫从「`== null` / 非有限 / 负数 ⇒ 不截」收成「`=== undefined` ⇒ 不截」；
  - 重折环写入前的 `Math.max(0, e.kept)` 是重复钳位，删掉；
  - `types/resource/config.ts#rowTimeLimit` 的注释补上这条契约。
- 两条 @fact 的锚同步：`engine:时间线截断` 加上 `truncateMoveRows`；`engine:时间线截断/入口容差` 改指 `truncateMoveRows`，因为入口判据跟着装包迁过去了。同一处 ⟳复核 说明写的是「债 2 批 2-1 未落地」，其实 `truncationRefold.ts` 早已落地，已改正。
- 注释与文档里的过时描述：
  - `assembleSlot` 写的是「招式行从后往前整行丢、边界行等比缩」，跟实现正好相反（实现是整数装包，而且明确不从尾部整行丢），已改正；
  - ARCHITECTURE.md 场景表、ENGINE_PIPELINE_GUIDE.md 坑 22 写的路径还是 `core/resource/helpers.ts`（R43 起在 `timeTruncation.ts`），已改正。

### 9.4 逐位

- 装配路径不变：平A行和招式行各自的累加顺序没变，room 的算法也一样。
- 账本路径：room 从 `(b + L) − b` 变成 L，按 9.2，2.9% 的调用有 ulp 差，终局 zd 仍为 0 / 0。
- 守卫和钳位在契约下从不触发，删掉不改变任何值。

两刀各跑过一次 zd，都是 0 / 0。

### 9.5 验证

vue-tsc 0；check-guards 29；zc.test + checkGuards.test 207；tokens / data / specs / recording 12 / 161 / 462 / 189；vitest 258 / 2155 + 262 / 2348 = 520 文件 / 4503 例，与基线相同；zd DUMP 0 / ROWS 0；build index 1599.23 kB（gzip 465.17，原 1599.30）；zc drift 154 / 0 / 0。

### 9.6 不做

- 不为 `truncateMoveRows` 单独加测试：装包规则由 `timeTruncation.test.ts` 经装配入口覆盖，重折环行为由 `truncationRefold.test.ts` 覆盖。
- `assembleSlot` 里 kept 的反推（见 9.7）本轮不动：它会改动 rowTimeLimit 的 ulp，要单独量。

### 9.7 下一轮候选（r740：① 已做，② 核实后不做，见第 10 节）

1. **kept 由截断结果直接给出，不再用 used − cut 反推。** `truncateMoveRows` 末尾已经算出 kept（Σ 保留的招式行），却只返回 `cutSeconds = max(0, used − kept)`；`assembleSlot.ts` 构造 `bySlotEntry` 时再用 `kept = max(0, usedSeconds − cutSeconds)` 反推回来。这是同一类往返：浮点下 `used − (used − kept)` 不一定逐位等于 kept，而这个 kept 正是重折环写进 rowTimeLimit 的值。
   - 做法：返回值加 `keptSeconds`，`assembleSlot` 直接用；`cutSeconds` 照旧（overflow / 难度轴都读它）。
   - 风险：rowTimeLimit 会有 ulp 变化。要用 zd 量，有差异就按 AGENTS 规则 10 逐条归因。
2. 「平A行时长」有两种写法：`types/resource/execution.ts#basicSummarySeconds`（Σ `basic_attack`，不过滤前台，`totalTime?` 可选）和 `truncateExecutionsToFrontline` / `teamTimeSummary#slotRows`（只算前台 `basic_attack`）。产出后台行的有 11 个模块（lycaon、orphie、vivian 等），粗看它们的后台行都不是 `basic_attack`，如果属实两种写法结果相同，但还没逐个核实。先核实，再决定要不要统一；收益小。

## 10. r740：kept 由截断结果直接给出（`1f0e9e1a`）

第 9.7 节的候选 ①，r740 做完；候选 ② 核实后不做，见 10.6。

### 10.1 问题

`truncateMoveRows` 末尾已经算出 kept（Σ 截断后招式行的 totalTime），却只返回 `cutSeconds = max(0, used − kept)`；`assembleSlot.ts` 构造 `bySlotEntry` 时，又用 `kept = max(0, usedSeconds − cutSeconds)` 把它反推回来，重折环再把这个值写进 `cfg.rowTimeLimit`。同一个量算了两遍，中间还隔着两个 `max(0, ·)`。

### 10.2 改法

- `truncateMoveRows` 的返回值加 `keptSeconds`：不截断时等于 used，截断时就是末尾算出的 kept。
- `assembleSlot` 的 `bySlotEntry.kept` 直接用 `truncated.keptSeconds`。
- `cutSeconds` 改成 `used − kept`，去掉 `max(0, ·)`。kept ≤ used 由装包规则保证：
  - 没改的行原样返回；
  - 改过的行次数严格变少（② 加回不越原次数），`u.count × perUnit` 小于原 totalTime；
  - 砍到 0 次的行整行消失，相当于少加一个非负项；
  - 两个和按同一顺序累加，浮点加法单调，所以 `used − kept ≥ +0`。

  头注释里的恒等式「Σ 逐行 cutSeconds == used − kept」现在和代码字面一致。
- 返回值形状仍只写在 `truncateMoveRows` 一处。`truncateExecutionsToFrontline` 的返回类型是 `ReturnType<typeof truncateMoveRows>`，自动带上新字段。

### 10.3 逐位（规则 10：先量后判）

做了两次临时插桩（测完已还原，`git status` 干净），都跑 zd 矩阵（104 个预设 × 5 个场景）：

| 项 | 值 |
|---|---|
| `bySlotEntry` 构造 | 43,822 次 |
| 其中 cut > used/2 | 286 次 |
| 旧反推 `max(0, used − cut)` 不逐位等于 `keptSeconds` | 4 次，全在上一行的 286 次里；最大差 1.42e-14（slot 0，used = 267.645，kept = 119.33900000000001，旧反推得 119.339） |
| `truncateMoveRows` 截断分支调用 | 487,573 次 |
| 其中 `used − kept` 为负或为 −0 | 0 次 |

为什么只在「砍掉过半」时有差：kept ≥ used/2 时，按 Sterbenz 引理 `used − kept` 是精确的，再减回去必然得到 kept；kept < used/2 时第一次减法可能舍入，才可能差 1 ulp。实测与此吻合。

那 4 次差异没有进入终局结果：zd 的 DUMP 哈希包含 `convergence.truncationBySlot`，结果仍为 0。三次 zd 都是 DUMP 0 / ROWS 0：第一刀对 d7b75255、第二刀对第一刀、合并后的提交整体对 d7b75255。新口径下 rowTimeLimit 逐位等于「Σ 保留的招式行」，不再是反推出来的近似值。

### 10.4 验证

vue-tsc 0；check-guards 29；zc.test + checkGuards.test 207；tokens / data / specs / recording 12 / 161 / 462 / 189；vitest 258 / 2155 + 262 / 2348 = 520 文件 / 4503 例，与基线相同；zd DUMP 0 / ROWS 0；build index 1599.22 kB（gzip 465.16，原 1599.23）；zc drift 154 / 0 / 0。

### 10.5 不做

- 不为 `keptSeconds` 加测试：它就是函数里原有的 kept。装包规则由 `timeTruncation.test.ts` 覆盖，重折环行为由 `truncationRefold.test.ts` 覆盖。
- `engine:时间线截断` 的 @fact 口径没变（只多返回一个字段），据链不追加。

### 10.6 候选 ② 核实：两种「平A行时长」是不同的量，不统一

r739 记的前提「后台行模块都不产 `basic_attack` 行」不成立。全仓 15 处 `timeBucket: 'backstage'`（11 个模块）里，`lycaon.ts:366` 的「普通攻击（围猎·后台蓄力 #2→#4→#6）」就是 `moveId: 'basic_attack'`、`count: 0`、`totalTime = huntBasicTotal` 的后台行；其余 14 处都是具体招式。所以：

- `basicSummarySeconds`（不过滤前台）回答「打了多少秒平A」。调用方是千夏标记供给（`qianxia.ts#markSupplyOf`）和佩洛余晖（`specPanelBuffs.ts`），按平A时长折算整套命中，后台蓄力平A算进去是对的。
- 截断和 `teamTimeSummary#slotRows`（只算前台）回答「平A占了多少前台」，后台行不占前台。

两者对莱卡恩的结果不同，语义也不同，合并会让其中一方算错。不统一。

### 10.7 下一轮候选（未做）

1. **count = 0 的可截断行。** `truncateMoveRows` 第 ① 步写的是 `keep = u.count > 0 ? floor(target) : (target >= 0.5 ? 1 : 0)`，注释说 count = 0 的行「按整行一个单位处理」。但 `target = u.count × scale`，count 为 0 时 target 恒为 0，后一支永远得 0；第 ② 步加回要求 `u.count + 1 ≤ 原次数`，也进不去。实际效果是：count = 0 的行永远原样保留，它的时长也不从 room 里扣。一旦出现「count = 0 且 totalTime > 0」的前台招式行，截断后 kept 就会超过 room。
   - 插桩实测（zd 矩阵）：截断分支里 count = 0 的可截断行出现 106,913 次，totalTime 全部为 0（1471012 / 1471013 / 1471014 / 1471017、1051025、1511013 等），所以终局不受影响。
   - 做法二选一：(a) 契约写明「可截断行 count = 0 ⇒ totalTime = 0」，删掉死分支、改注释；(b) 真按「整行一个单位」实现。先静态核实所有产出方（包括不在预设里的角色）有没有 count = 0、totalTime > 0 的前台招式行，没有就选 (a)。
2. `liveInteractions.ts:28` 的 `Math.max(0, Math.min(1, s.kept / s.requested))`：kept 在 [0, requested] 之内（10.2），这两个钳位在契约下不会触发。收益小，可以和 1 一起看。
