# 逐金贪婪加金：只留一份实现（r733）

> 代码提交 `f0b3b3c8`（arena-G r733）；arch CC-515；r6 §8.0 #30 与 §8 第 733 行。
> 一句话：队伍对比与时间线的「逐金贪婪」原来各写一遍试算 / 还原 / 提交，「一步加金」有三套写法；现在共用 `src/composables/goldGreedy.ts`，候选一律用预设同形的 `GoldStep`。

## 1. 起点（origin `742116e9`）

| | 队伍对比 `teamCompare.ts#computeOptimalGoldAllocations` | 时间线 `teamTimeline.ts#computeOptimalTeamAllocation` |
|---|---|---|
| 候选来源 | 预设 goldSteps：每个槽位第一条获取步 + 各 (slot, kind) 线的下一级 | catalog：限定角色影画 +1；带限定音擎的槽位精炼 +1，否则换装该角色最佳限定音擎 |
| 步的类型 | 私有 `GoldAllocationStep`：cinema / wengine（= 精炼）/ acquire（= 换装） | 私有 `GoldStepCandidate`：cinema / wengine（= 换装）/ refine（= 精炼） |
| 试算 / 还原 / 提交 | 手写约 60 行（另有一个内联的 best 类型） | 手写约 35 行 |
| 选最优 | 第一个候选必入选，之后严格大于才换 | 读数有限、且比当前最优大 1e-9 以上才换 |
| 读数 | `teamTotalDamage` | 外层未收敛（maxIter）记 -Infinity |
| 输出 | 每档一条分配；可选收集每档全部试算（「同金分配」表） | 预算内的终态、标签、试算次数 |

预设的 `GoldStep` 用「wengine + 有没有 wEngineId」区分换装和精炼；两份私有类型各起了一套名字，wengine 在一处指精炼、在另一处指换装。两个函数的头注释本来就写着「同一口径，只是候选来源不同」。

## 2. 改法

- **`goldGreedy.ts#takeBestGoldStep(configStore, state, candidates, readDamage)`**：逐个试算候选（只写变了的字段，顺序影画 → 音擎 → 精炼）、还原、把伤害最高的那步写进 store；返回本档全部试算与选中者。读数非有限不选；伤害并列（差 ≤1e-9）取先出现的，候选顺序由调用方定。`stateAfter` 给出走一步后的配装态，换装本体时精炼回 1。
- **候选一律用 `GoldStep`**：两份私有类型删除；`GoldAllocationAlternative.step` 改为 `GoldStep`，页面只读它的 label；`nextGoldCandidates` 的精炼候选从 refine 改成不带 wEngineId 的 wengine，换装候选本来就是带 wEngineId 的 wengine。
- **调用方只留自己的部分**：
  - 队伍对比：候选来源、每档分配、限定下位计金、试算归集（赢家改用对象相等判断，不再逐字段比）；
  - 时间线：候选来源、预算、试算次数、收敛过滤。收敛过滤写成它自己的 `readDamage`，基础态和试算用同一个读法。原先试算处为绕开属性链收窄写的 `as OuterExit | undefined` 随之删除，因为闭包里没有那层收窄。
- **保留不变的语义**：两边的候选顺序各自照旧（队伍对比：获取步在前，再按各条线在 goldSteps 里首次出现的顺序；时间线：按槽位、影画在前）；写 store 的顺序与旧代码相同。store 的队伍监听是同步触发的，只写变了的字段，与旧代码逐字段写同值等价，因为写入同值不触发监听。

## 3. 顺带修的缺陷：自动下位限定槽位会重复买同一把

旧代码的获取候选条件是「槽位当前不是限定音擎，或者槽上的限定件是自动下位穿的」。买过之后，槽上就是作者声明的那把限定音擎；如果该槽也在自动下位的限定名单里，下一档还会出同一个获取候选。这次试算等于什么都没改（若该槽已精炼，还会掉回精炼 1）。其他候选用完以后就一直买到 12 金：每档总金 +1，配装不变，「同金分配」表里也多出这些行。

现在买过本体的槽位不再出获取候选。用例「有金就是金」补了一句断言：预算档只有 3、4。去掉这一行，用例报 `[3, 4, 5, …, 12]`。

**可达性**：现有 19 个带 goldSteps 的预设都没有获取步；默认装填池与 `enginePools.json` 里也没有限定音擎（14110、14121 是常驻）。所以页面按默认设置碰不到。要碰到需要两个条件同时满足：经「预设金数 → 保存到预设文件」写出了获取步，且装填池里放了限定音擎。

## 4. 验证

- **探针**（不入库，`calc-arch/g733/zz733probe.test.ts`）：同一工作区改前、改后各跑一次，JSON 逐字段比较：
  - 队伍对比：19 个带 goldSteps 的预设，目标金 0–14，开最优加金并收集试算，得到 175 个点、655 条试算。标签、全精度伤害、三项配装完全相同。
  - 时间线：6 队 × 预算 12。终态、标签、伤害、试算次数完全相同。
  - 原计划还有一组「装填池加入各预设的获取音擎」。因为没有预设声明获取步，这组退化成默认池，只跑了改前一次。
- 队伍对比选最优的规则从「严格大于」变成「读数有限、大 1e-9 以上」，只在两个候选伤害相差 ≤1e-9 时有区别。探针里 655 条试算的赢家没有一个变化。
- vue-tsc 0；guards 29（判据 28 / 29 = 0/0，扫 297 个文件）；zc.test + checkGuards.test 207；tokens 12 / data 161 / specs 462 / recording 189；vitest 261/2165 + 263/2342 = 524/4507；zd DUMP 0 / ROWS 0；build index-BAQpAIrX.js 1599.31 kB（742116e9 为 1600.49 kB）；zc drift 154/0/0。

## 5. 不做

- **时间线的 catalog 候选改成「合成一条 goldSteps，再走队伍对比的候选规则」**：两边候选顺序不同，并列时选中的步会变；时间线的确定性分配（`buildBudgetAwareGoldSteps`）不含获取步，合成的梯子也统一不了它。只省掉一个十几行的候选函数，却多一处语义变化，不值。
- **队伍对比加收敛过滤**：它的点本来就不看收敛。要加就整页一起定口径，贪婪这边只需改传给 `takeBestGoldStep` 的读数。
- **`GoldStep` 改成三值判别联合（cinema / refine / acquire）**：要迁移预设 JSON 与契约，收益只是类型上更显式。现在「有没有 wEngineId」的读法只在 `goldGreedy#stateAfter` 与 `applyGoldSteps` 两处。
- **已知未做**：自动下位穿上的限定件也会出精炼候选，用的是预设为作者声明的音擎写的那条精炼线，标签写的也是作者的音擎。现有数据碰不到，原因同 §3。触发条件见 r6 §8.0 #30 ①。

## 6. 回退

`git revert f0b3b3c8`（文档另提交）。只回退缺陷修复的话，删掉 `computeOptimalGoldAllocations` 里 `if (acquiredSlots.has(slot)) continue` 一行，并删掉「有金就是金」里的那句断言。
