# 前台行时长只算一处（r738）

> 代码提交 `ae256a04`（arena-G r738）；arch CC-520；r6 §8 第 738 行。题目来自 `docs/mcp-default-suite-probes.md` §8.5（r737 交接的候选）。r739 续做截断预算的往返减法，见第 9 节（`14046a6c`，CC-521）。

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

### 9.7 下一轮候选（未做）

1. **kept 由截断结果直接给出，不再用 used − cut 反推。** `truncateMoveRows` 末尾已经算出 kept（Σ 保留的招式行），却只返回 `cutSeconds = max(0, used − kept)`；`assembleSlot.ts` 构造 `bySlotEntry` 时再用 `kept = max(0, usedSeconds − cutSeconds)` 反推回来。这是同一类往返：浮点下 `used − (used − kept)` 不一定逐位等于 kept，而这个 kept 正是重折环写进 rowTimeLimit 的值。
   - 做法：返回值加 `keptSeconds`，`assembleSlot` 直接用；`cutSeconds` 照旧（overflow / 难度轴都读它）。
   - 风险：rowTimeLimit 会有 ulp 变化。要用 zd 量，有差异就按 AGENTS 规则 10 逐条归因。
2. 「平A行时长」有两种写法：`types/resource/execution.ts#basicSummarySeconds`（Σ `basic_attack`，不过滤前台，`totalTime?` 可选）和 `truncateExecutionsToFrontline` / `teamTimeSummary#slotRows`（只算前台 `basic_attack`）。产出后台行的有 11 个模块（lycaon、orphie、vivian 等），粗看它们的后台行都不是 `basic_attack`，如果属实两种写法结果相同，但还没逐个核实。先核实，再决定要不要统一；收益小。
