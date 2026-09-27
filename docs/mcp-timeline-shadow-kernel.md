# 事件时间轴影子内核 · 设计稿（R4-A1 第 0 步）

> 🛑 **已停工（R4 已被用户撤销）**，依据见 `docs/REQUIREMENTS.md` 文末「R4 撤销说明」（用户提交 `3737419`，2026-09-27 16:47）。
> 用户的结论：收敛法没有本质错误；时序模拟需要「高手临场判断」这种引擎拿不到的决策信息。**以后不要再提时序仿真或事件时间轴内核。**
> 本文件**保留为调研记录**，不再推进。§1「两条轨现状核实」有独立价值，排查资源循环时可以参考。
> **代码已删（R7，用户 2026-09-27 16:52 决定）**：`src/core/timeline/`、`scripts/lib/timeline-isolation.*`、`src/scripts/__tests__/timelineIsolation.test.ts` 和判据 26 已在同一提交里删除（check-guards 26→25 条）。本文提到的这些文件、§7.5 的实现口径都只作历史记录；需要时可从提交 `0c0289c` 找回。

> lead-arena-0925c · 2026-09-27 第 118 轮 · 只读摸底，零代码改动。
> 需求来源：`docs/REQUIREMENTS.md` R4；方向定义：`docs/LONG-TERM-DIRECTIONS.md` 方向 A（第 22–52 行）。
> 本文件既是设计稿，也是 R4 的**进度账本**：每步做完在 §8 打勾，写提交号。

## 0. 一页结论

- **做什么**：新建 `src/core/timeline/`，把现引擎**收敛后**的执行行重放到一条 180 秒时间线上，
  跑两条轨：失衡轨、喧响轨。输出与现引擎总量的**逐项差异表加归因**。不接 UI，也不被任何既有代码 import。
- **第 1 步的输入是「重放」，不是「从头模拟」**（决定 D1）。这样差异只来自「总量口径 vs 时间线」本身，
  不会混入招式数据和模块建模上的差异，归因才干净。从动作序列独立出发推后到第 3 步以后。
- **零差怎么保证**：影子内核是新目录、零入边，并用守卫判据锁死（D6）。`timeGolden`、`zd.sh`、全量 verify
  天然不变。
- **3 支对账队伍**：T1 `auto-1471-1571-1451`、T2 `auto-1371-1481-1451`、T3 `auto-1591-1571-1211`（§5）。
- **不可逆点**：用影子内核的结果替换现引擎的任何输出。**必须等用户裁决**，本设计的全部步骤都不越过这条线。

## 1. 现引擎两条轨的现状（第 118 轮读码核实）

### 1.1 失衡轨：总量口径加外层不动点

- 失衡次数 `StunPoolResult.stunCount = floor(有效总失衡值 ÷ Boss 失衡值)`（`src/types/resource/pools.ts:39–63`，
  字段有 totalStunBuildUp、grossStunBuildUp、inAxisStunTotal、bossStunValue、stunRefundRatio / stunRefundValue、
  stunGift、perSlotStun）。
- 总失衡值又依赖前台时间预算，前台时间预算又依赖失衡窗口数，因此是**循环依赖**，靠外层不动点
  `solveTeam`（`src/composables/resourceCalc/solveTeam.ts:72`）求解：
  - 每轮 `runCalcRound(stunCount, threads)`，取 `out.stunPool.stunCount` 作为下一轮的输入（:186–253）。
  - 迭代上限 `MAX_OUTER_ITER = 20`：2026-08-24 实测到阻尼震荡，振幅约为上一轮的 0.55 倍，12 轮不够落定。
  - 有 2-循环和长环的规范选点逻辑（:119–241）：不收敛时，从环里「挑一个点」当答案。
- **双源**：`resourceResult.plannedStunCount` 是喂进本轮的输入值，不是答案。`freeCompare/metrics.ts` 头注释
  记录了 2026-09-07 的误读事故（读出 1.27，池真值是 4.00）。
- 跨轮反馈线程 `CalcRoundThreads`（`resourceCalc/roundThreads.ts`），加上 5 个角色的 `nextRoundFeedback` 钩子。

### 1.2 喧响轨：整局总量，无上限

- 大招次数 `ultimateCount = floor(decibels[i] / cfg.ultimateCost)`（`core/resource/helpers.ts`，行号见
  `decibelCapVerdict.test.ts` 头注释），没有上限项；`ultimateCost` 是角色级的（默认 3000，佩洛伊斯 2000）。
- 种子 `src/core/resourceTrack.ts`（100 行）`simulateDecibelTrack`：单一池、均匀回复、上限 3000、进窗时够 3000 才放大招。
  **非测试代码零调用**。
- ⚠ **闸门**：`src/composables/__tests__/decibelCapVerdict.test.ts` 的「形状面」判据断言：非测试 src 中
  字符串 `simulateDecibelTrack` 只出现在 `core/resourceTrack.ts`。一旦接进主管线，就要先裁决角色级喧响上限口径
  （橘福福 1391 的「队伍喧响上限 +1000」，见 `docs/mcp-r65j1-decibel-cap-verdict.md`）。

### 1.3 轴模式：窗口内已有真实时序

- `src/data/stunAxisPresets/*.json` 共 19 份，外加 `stunAxisPresets.ts` 里的手写预设。每个 action 有
  `slot / moveId / count / startTime / sourceTag`；可以有多条轴（`count`），也可以是条件方案（`plans[].when`，
  按失衡次数、好评、闪能选轴）。
- **窗口内是时序的，窗口外仍是总量**。窗口分配 `allocateAxisWindows(resolvedAxes, stunCount)`
  （`resourceCalc/convergence.ts:157` 等 4 处）。

## 2. 决定（D1–D7）

每条都写了依据和回退点；拿不准的都选了可逆方案。

**D1 输入：重放收敛产物。**
- 做法：取 `solveTeam` 收敛后的 `CalcRoundResult`，包括每槽执行行（次数、动作时长、每次的有效失衡值和喧响）、
  已选中的轴及其窗口内 startTime、Boss 失衡值、窗口时长、战斗时长。在这些输入上跑时间线。
- 依据：R4 验收要求「每处差异可归因」。如果从头模拟，招式数据、模块钩子、时间模型的差异会叠在一起，无法归因。
- 代价：继承了现引擎单轮建模里的近似（执行行本身就是总量口径算出来的）。这是第 1 刀有意接受的，§6 的 U 类归因专门记录它。
- 回退点：输入适配层单独一个文件 `src/core/timeline/projection.ts`，以后换输入只改它。

**D2 事件模型。**
- `TimelineEvent = { t, kind, slot, moveId?, stun?, decibel? }`，kind 取 `action | stunEnter | stunExit | ultimate | end`。
- 窗口外的动作：每槽的非轴执行行按「前台占比」在窗口外时间里**均匀铺开**（近似 U1，差异表里显式标注）。
- 窗口内的动作：直接用轴预设的 startTime，加上窗口起点。

**D3 失衡轨。**
- 失衡条从 0 开始，窗口外的动作累加**引擎已算好的每次有效失衡值**（直接取 contributions，不重新建模加成）。
- 达到 `bossStunValue` 时开窗，窗口时长取引擎的窗口时长。窗口内不累加失衡。
- 出窗后失衡条 = `stunRefundValue`（返还）。
- 失衡次数 = 180 秒内开出的窗口数（整数）。末尾截断自然发生：最后一个窗口开不出来，就不算。
- **已核实（第 119 轮）**：`inAxisStunTotal` = 「失衡窗口内失效的失衡值合计」（`src/types/resource/pools.ts:44–45`，
  计算在 `src/core/stunPool.ts:157–191`）。窗口内打出的失衡值**没有其他去向**，与本节「窗口内不累加」一致。
- 现引擎闭式公式（`stunPool.ts` calcStunPool 末段）：`1 + floor((有效总失衡 + stunGift − 上限) / (上限 × (1 − 返还比例)))`。
  它等价于「溢出失衡值**结转**到下一次」。影子失衡轨默认**丢弃**溢出（游戏里失衡触发时溢出即丢失），用
  `carryOverflow: true` 可以切换成引擎口径。两者的差异归为 **E1**。

**D4 喧响轨。**
- 每槽独立一条喧响条，上限 `cap` 做成参数，默认等于 `ultimateCost`，所以 1391 的 +1000 默认不生效，
  与闸门注释步骤 ① 一致。
- 喧响由动作事件（执行行里的喧响）加被动回复累加；超出上限的部分记入 wasted。
- 大招释放策略做成参数：默认「进窗时够就放」（与 resourceTrack 相同），备选「满即放」。
- **不 import、不引用 `simulateDecibelTrack`**：闸门判据按字符串匹配，而且影子内核按槽分开、带上限参数，
  本来就是另一套实现。

**D5 输出：差异表。**
- 列：`team | 量 | 引擎值 | 影子值 | Δ | 归因类 | 证据`。
- 量至少包括：stunCount、每个窗口的开窗时刻、每槽 ultimateCount、每槽 wasted 喧响、每槽前台时间。

**D6 隔离与零差。**
- `src/core/timeline/**` 只能 import `@/core/*` 纯函数和 types，**不 import** composables、stores、mechanics。
- 非测试 src **不得 import** `core/timeline`。第 1 步时在 `scripts/check-guards.mjs` 加判据 26
  （同步 `checkGuards.test.ts` 的 `toHaveLength`）。
- 差异报告只由测试产出：`src/core/timeline/__tests__/shadowDiff.test.ts`。默认只断言不变量（整数次数、单调、窗口不重叠）；
  设置 `TIMELINE_REPORT=1` 时把差异表写到 `docs/mcp-timeline-shadow-report.md`。

**D7 性能。**
- 引擎单次求值约 0.3–0.4 秒（`freeCompare/metrics.ts` 头注释引 `TeamComparePage.vue`）。
- 影子内核每支队伍的事件数在几百量级，预计是毫秒级。
- 第 1 步必须实测两个数：引擎单次求值耗时（取 5 次中位数）、影子单次耗时。
- **门槛**：影子耗时 < 引擎的 5%。若将来影子要替代不动点，再估「组合扫描 C(16,3)=560 队 × 每队约 10 次求值」的总耗时。
- 超过门槛就先优化事件循环，不进入第 2 步。

## 3. 目录与接口草案（第 1 步照此建）

```
src/core/timeline/
  types.ts        TimelineEvent / TimelineInput / TrackResult / DiffRow
  projection.ts   RoundProjection（结构子集，在 types.ts 声明）→ TimelineInput（唯一依赖引擎形状的文件）
  stunTrack.ts    simulateStunTrack(input) → { windows: {start,end}[], stunCount, residual }
  decibelTrack.ts simulateSlotDecibel(input, { cap, policy }) → 每槽 { ultimates, wasted, detail }
  diff.ts         buildDiffRows(engine, shadow) → DiffRow[]
  __tests__/      纯函数单测 + shadowDiff.test.ts（harness 跑 3 队）
```

**已决（第 118 轮核实）**：`src/core/**` 目前**零处** `from '@/composables…'`（`git grep` 核实）。check-guards 没有明文禁止，
但分层惯例很清楚。所以 **core 不引用 composables**：`types.ts` 声明 `RoundProjection` 结构子集（只列要读的字段），
由测试侧（harness）把 `CalcRoundResult` 传进来。按结构类型检查，只要引擎的字段改名，`vue-tsc` 就会在测试侧报错。
`fromRound.ts` 相应改名为 `projection.ts`，只负责把 RoundProjection 转成 TimelineInput。

## 4. 验收（对应 R4 原文）

1. 对同一队伍、同一配置，输出事件序列和逐项差异表 → shadowDiff.test.ts 加 report。
2. 每处差异都有归因 → §6 的分类，report 的「归因类」列不许为空；归不了类的记为 `?`，并在本文件 §7 立项追查。
3. 至少 3 支队伍 → §5。
4. 零差 → 全量 verify、`zd.sh`、`timeGolden` 都不变（影子零入边）。
5. 性能原型 → D7 的两个实测数写进 §8。

## 5. 对账队伍

| # | 预设 | 成员 | 轴预设 | 选它的理由 |
|---|---|---|---|---|
| T1 | `auto-1471-1571-1451` | 般岳 + 诺姆 + 卢西娅 | `般诺通用.json`（12 个 action） | 有赠送连携（`sourceTag:'gift'`），失衡和连携的耦合最重 |
| T2 | `auto-1371-1481-1451` | 仪玄 + 琉音 + 卢西娅 | `仪琉通用.json`（2 条轴，19 个 action） | 多轴 |
| T3 | `auto-1591-1571-1211` | 希格莉德 + 诺姆 + 丽娜 | `希格莉德诺姆.json`（条件方案 2 个） | 按资源选轴，时间线能直接回答「第 N 窗够不够」 |
| 备选 | `auto-1051-1481-1451` | 伊德海莉 + 琉音 + 卢西娅 | `0章-琉.json` | T 队任一跑不通时替补 |

雨果（`雨果0命.json`，3 个 action，最简单）没有队伍预设，所以不选。

## 6. 归因分类（报告的「归因类」列只能从这里取值）

- **E 类：现引擎伪影**（时间线消除了它，属于方向 A 的收益）
  - E1：失衡次数的 floor 和小数计划值；
  - E2：2-循环或长环的规范选点；
  - E3：末尾截断没有回灌（DEBT）；
  - E4：喧响无上限（溢出也折算成大招）；
  - E5：后段窗口资源不足，大招却照算。
- **U 类：影子内核的已知近似**（第 1 刀有意接受）
  - U1：窗口外动作均匀铺开；
  - U2：返还值在出窗那一刻一次性给满；
  - U3：继承了执行行的总量建模（D1 的代价）。
- **B 类：影子内核的 bug**：必须修掉，不许进报告终稿。
- **?**：暂时归不了类，在 §7 立项。

## 7. 未决项与已知坑

- `inAxisStunTotal` 的语义未核实（见 D3）。
- 条件方案 T3 选轴依赖失衡次数；影子的失衡次数和引擎不同时，可能选到另一条轴。第 1 刀**沿用引擎选中的轴**，
  「影子自己选轴」的差异单列一行，归为 E 类还是 U 类要看实测。
- R3 两点用户未裁决（B 的定位、A 是否接受数值变动），影子阶段不受影响。

## 7.5 第 1 步落地口径（第 119 轮，代码即准）

- **失衡轨** `src/core/timeline/stunTrack.ts` `simulateStunTrack`：
  - 失衡值在**动作完成时**累加，满值就在那一刻开窗；
  - 窗口外按 `offWindowLoop` 顺序循环执行，出窗后从中断处续上；
  - 会越过 battleTime 的动作不完成，并置 `truncatedAction`；
  - 窗口被战斗结束截断时 `end = battleTime`，但**计入次数**（窗口已开出）；
  - 溢出在开窗那一刻决定去留，默认丢弃并记入 `overflowLost`，被截断的末窗也算；
  - 有防御性步数上限 200000，异常输入时不会死循环。
- **窗口外速率不依赖引擎答案**：速率来自动作自身的时长与失衡值，**不能**用「引擎失衡值 ÷ 引擎窗口外时间」。
  否则就用到了引擎的失衡次数，两边自然相等，属于循环论证。第 2 步的 projection 必须遵守这一点。
- **喧响轨** `src/core/timeline/decibelTrack.ts` `simulateSlotDecibel`：
  - 每槽独立，上限 cap 和消耗 cost 分开设置；cap < cost 时按 cost 兜底；
  - 放完大招**保留余量**；
  - 瞬时获得时**先按上限截断再判定释放**（喧响条不会超过上限）；
  - `whenFull` 策略下，被动回复的越线时刻按线性解析求出。
- **性能（D7 的影子一半）**：30 个动作的循环、180 秒、返还 10%，实测 **0.019 ms/次**（2000 次取平均，第 119 轮单独跑
  `npx vitest run src/core/timeline` 时的输出，平均每次 5 个窗口；verify 全量并发时会更慢，但量级不变）。比引擎单次求值（约 300 ms，待第 2 步实测）小 4 个数量级以上，D7 门槛（< 5%）显然满足。
  引擎耗时那一半在第 2 步用 harness 实测补上。
- **判据 26** `scripts/lib/timeline-isolation.mjs`：
  - 入边：非测试 src 对 `core/timeline` 零引用，含类型导入、动态导入和 `export … from`；
  - 出边：只允许依赖 `@/core`、`@/types`、`@/utils`；
  - 反空洞：影子目录下非测试文件 ≥ 3；
  - 有检测器自证；行为锁在 `src/scripts/__tests__/timelineIsolation.test.ts`。
- **零差证据**：`.zc/perf/zd.sh r119` 的 DUMP 与 ROWS 都是 `DIFF 0`（基线为 HEAD 28f721c，改动未提交时跑的）。

## 8. 进度账本

- [x] 第 0 步：本设计稿（第 118 轮，`e8aebae`）。
- [x] 第 1 步：`src/core/timeline/` 骨架 + 失衡轨 + 喧响轨纯函数单测 + 判据 26 + 影子性能数（第 119 轮，`0c0289c`；口径见 §7.5）。引擎性能数移到第 2 步。
- [ ] ~~第 2 步~~（**作废：R4 已撤销**）：`projection` 适配 + shadowDiff 跑通 T1 + 引擎单次求值耗时（取 5 次中位数）。开工要点：
  1. 用法范例：`src/composables/__tests__/timeGolden.test.ts`（`setupHarness` + `useResourceCalc` + `teamPresets`），
     轴相关可参考 `axisPresetPreferredLabelCc79.test.ts`。先确认 T1 预设加载后 `useStunAxis` 已开启、并命中「般诺通用」轴。
  2. 读 `calc.stunPoolResult.value.contributions`（逐招 `perHitStun`、`count`、`slot`、`moveId`、`inAxisFraction`）和每槽执行行
     （动作时长、`decibelRecovery`），在 `types.ts` 声明 `RoundProjection` 结构子集。`projection.ts` 把它转成
     `offWindowLoop`：每招的窗口外次数 = count × (1 − inAxisFraction)，按次数比例交错排成一个循环（近似 U1）。
  3. 窗口模板取自已选中轴的 actions（`startTime` 作为 offset），喧响取执行行的 `decibelRecovery`。被动回复和开窗奖励
     （`STUN_DECIBEL_BONUS` / `CHAIN_DECIBEL_BONUS`，见 `stunPool.ts`）的来源先读码核实，再决定是否进入 `onStunEnter`。
  4. `diff.ts` 输出 D5 的差异行；shadowDiff.test.ts 默认只断言不变量，`TIMELINE_REPORT=1` 时写报告。
- [ ] ~~第 3 步~~（**作废：R4 已撤销**）：T2、T3，差异表全部归因，写出 `docs/mcp-timeline-shadow-report.md`。
- [ ] ~~第 4 步~~（**作废：R4 已撤销**）：对账结论和「是否值得进入模块事件钩子（方向 A 第 3 刀）」的建议，**交用户裁决**。
