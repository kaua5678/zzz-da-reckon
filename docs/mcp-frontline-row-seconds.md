# 前台行时长只算一处（r738）

> 代码提交 `ae256a04`（arena-G r738）；arch CC-520；r6 §8 第 738 行。题目来自 `docs/mcp-default-suite-probes.md` §8.5（r737 交接的候选）。

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

## 7. 下一轮候选（未做）

**截断预算的往返减法。** `rowBuild.ts#feasibleRowsUncached` 先把前台 `basic_attack` 行加成 basicTime，只是为了调 `truncateExecutionsToFrontline(rows, basicTime + rowTimeLimit)`；后者进门又把 basicTime 算一遍，再算 `room = max(0, (basicTime + rowTimeLimit) − basicTime)`。同一个和算了两遍，room 也可能跟 rowTimeLimit 差一个 ulp。可以考虑让截断函数直接接收招式行预算。这可能改变 ulp 级结果，要用 zd 量；如有差异，按 AGENTS 规则 10 逐条归因。

## 8. 回退

`git revert ae256a04`（文档另提交）。
