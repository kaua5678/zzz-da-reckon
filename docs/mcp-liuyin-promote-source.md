# 琉音转大次数唯一来源（W21 阻塞项 · lead 设计）

> 2026-09-25 外部 lead 会话（Arena · MCP）。基于 HEAD `7b76b77` 的现场阅读，引用一律 `路径:行` / `路径#符号`。
> 输入证据：`.zc/reports/W16-predict.md`、`.zc/reports/W20-axis-farewell.md`、`.zc/reports/W21.md`（`.zc/` 不入库，用到的结论已摘进本文）。
> 交付物：本文（设计 + 否决记录）+ 队列新卡 W25（预测探针）/ W26（实现），见 `docs/mcp-worker-task-queue.md`。
> 本文**不改代码**。非轴部分不需要用户裁决；轴模式部分挂在 W20 §5-1 的待用户项上。

## 0. 结论

**「转大次数」的唯一来源 = 本轮被接受的答案层结果 `promoteFixpoint(...).promote`**（即 `CalcRoundResult.promote`，`src/composables/resourceCalc/convergence.ts:1447`）。

轮内比它更早需要这个数的消费点（送客行 / 必要时间估计 / 资源结果展示 / 赠行时间预留）一律读**上一轮**的这个值：新线程 `prevPromoteCount`，与 `prevPoolStunCount` 同款滞后注入。首轮兜底 = 零失衡下的阈值结转（数学上 ≡ 现行 `floor(G/90)`）。外层判 `stable` 时滞后值 = 本轮值，四处自然同源。轴模式先不接（生产端闸门），行为逐位不变，等用户裁决 W20 §5-1 后再拆闸。

> **2026-09-25 W25 实测后更正**：前提成立，但生产端要再加「目标槽有角色」条件；现语料上四读数重合，W26 是零 delta 重构；§5 对 `agent:1481:c0` 的具体预测不成立。详见 §8。

## 1. 问题：同一轮里「转大次数」有四个读数

| # | 读数 | 位置 | 所用失衡次数 | 消费者 |
|---|---|---|---|---|
| R1 | `promoteWindows = floor(G/90)` | `src/mechanics/agents/liuyin.ts:179` | 无（等价零失衡） | 送客行 1481009 次数（`liuyin.ts:352`）、必要时间估计（`:305-313`）、资源结果展示（`:414`、`:444-446`） |
| R2 | `crossAgentSupply` 的 `hug60 + hug90` | `liuyin.ts:537-558` | 计划值 `query.stunCount`（W21 §2.4） | 非轴：引擎赠行时间预留 `liuyinGiftTimeReserved`（`src/core/resource.ts:1121`） |
| R3 | `promoteFixpoint` 的 `promote` | `src/composables/resourceCalc/liuyinPromote.ts:271-312` | 池内不动点实数（W21 实测 3.17–5.05） | 赠行次数：`applyLiuyinPromote` 以池为准写回（`liuyinPromote.ts:117-134`；调用点 `convergence.ts:1254`） |
| R4 | 轴 `axisHug` 的 `hug60 + hug90` | `convergence.ts:649-702` | 计划值 + 轴声明的 60 档上限 | 轴模式：`axisLiuyinPromote` → 引擎四处消费点；`promoteFixpoint` 轴分支直读（`liuyinPromote.ts:274-276`）⇒ 轴模式 R3 ≡ R4 |

- 语义上它们应当恒等：`抱拳次数 = 转大次数 + 终结技次数`（等效规则，用户确认，`liuyin.ts:175-178`、`:455`）；`转大次数 = 阈值结转`（`@fact agent:1481/开窗次数`，`liuyin.ts:97`）。
- 非轴 R1 ≠ R3：好评 G 落进 `[90+60k, 90(k+1))`、且池口径下 cap60 ≥ 1 时出现。R2 ≠ R3：floor(计划值) 与 floor(池内值) 给出不同的 cap60 时出现。W21 实测 `agent:1481:c0` 同一局：floor = 3，计划值结转 = 4，池 = 3。
- 注释与实现不一致（规则 11）：`liuyin.ts:176` 写「阈值结转」，`:179` 实际是 floor。

## 2. planned ≠ pool 是口径，不是缺陷

外层把池的整数答案 `rawNext = pool.stunCount` 先做「净失衡缩放」`next = rawNext × (1 − min(1, N×窗长/有效时间))`，再做时间可行性截断和非失衡时间充足性钳制（`src/composables/useResourceCalc.ts:374-397`），得到的 `next` 才是下一轮的输入。不动点收敛在 `planned = f(pool)` 上，所以 planned 系统性小于 pool（W21：21/21 个预设不等，planned ≤ 2.39，pool ∈ {3, 4}）。

仓库已有两条明文口径：

- `TeamResourceResult.plannedStunCount` 是**输入，不是答案**（`src/types/resource/team.ts:113-119`，起因是 2026-09-07 的 1.27 vs 4.00 误读事故）。
- 读失衡次数一律取 `stunPoolResult.stunCount`（`src/composables/freeCompare/metrics.ts:11-13`）。

⇒ 转大次数的来源必须站在**答案层**（R3），不能站在输入层（R2，或 W21 变体的计划值通道）。

## 3. 设计

### 3.1 单源与通道

1. **生产**（编排层，不做角色判定）：`runCalcRound` 的 `threadsNext` 加一行 `prevPromoteCount: !axisMode && sp1.targetSlot >= 0 ? sp1.promote : undefined`，紧挨 `convergence.ts:1499` 的 `prevPoolStunCount`。`src/composables/resourceCalc/roundThreads.ts` 加字段和初值 `undefined`；null 轮按头注释 `:11-14` 的「其余字段」语义重置。
2. **消费**（模块内，规则 6）：`liuyinMechanic` 新增 `applyTeamConfig`，只在 `phase === 'converge'` 时读 `threads?.prevPromoteCount`，写入本槽 `cfg.liuyinPromoteLagged`（字段在 `src/types/resource/config.ts` 与 `liuyinCinemaLevel`（`:448`）同处声明）。先例：`src/mechanics/agents/hugo.ts:363` 读 `threads.prevPoolStunCount`；`threads` 入参见 `src/mechanics/types.ts:302`。
3. `computeLiuyinSource` 入参加可选 `promoteCount`：`promoteWindows = promoteCount ?? (z.hug60 + z.hug90)`，其中 `z = computeLiuyinHugCounts(total, 0, -1)`。零失衡时 cap60 = 0、全走 90 档，所以兜底在数学上 ≡ `floor(total/90)`，同时删掉第二份阈值实现（规则 11）。四个调用点（`:305`、`:318`、`:414`、`:539`）都传 `cfg.liuyinPromoteLagged`。
4. `crossAgentSupply.supply`：`cfg.liuyinPromoteLagged` 有值时直接返回它（预留 = 上一轮赠行数）；无值时保留现式（首轮行为不变；轴模式本来就被 `axisSuppressed` 挡住）。琉音供给从此不再读 `stunCount` 参数，W21 风险项「`giftDecibelForCfg` 传 `stunCount: 0`」对琉音自动失效。
5. 把 `liuyin.ts:175-179` 的注释改写成新口径，并在 `computeLiuyinSource` 旁钉 `@fact agent:1481/转大次数·非轴单源`（据 = 本文 + 等效规则 + 答案层口径；验 = W26 新增的不变量测试）。

### 3.2 收敛与出口

- `outerFeedbackSignature`（`src/composables/resourceCalc/outerCycle.ts:10-25`）已经包含各角色 `ultimateCount.toFixed(3)`，而赠行会把 `promote` 加进目标的 `ultimateCount`（`liuyinPromote.ts:138`）。所以 `stable` 已经蕴含 promote 稳定，**不需要换尺**。这一点由 W25 实测验证（§5 闸门）。
- 环出口（2-环 / 长环的 `pickCanonical`）选中成员的滞后值来自环内另一个成员，可能 ≠ 它自己的 promote。其它滞后线程也有同样的性质，本设计不处理；不变量测试只断言 `outerExit === 'stable'` 的 key。

### 3.3 轴模式闸门（待用户）

轴模式下 R3 ≡ R4（赠行与预留已四处同源，见 `@fact engine:赠送时间/轴模式四处同源`），只有送客行仍走 R1。轴模式送客行要不要改成 `axisHug + 终结技`，取决于 W20 §5-1 的用户裁决：轴声明 `1481:1481009×N` 是本局送客总数，还是只是窗内的那一部分。裁决前生产端对轴模式写 `undefined`，轴模式逐位不变。裁决后拆闸 = 删掉那个三元条件，再重排基线。

## 4. 否决记录（规则 16③）

| 方案 | 实测 | 否决理由 |
|---|---|---|
| A. 计划值通道：converge 写 `cfg.liuyinStunCount`（计划值），四处都按它做阈值结转（W21 变体 1/2） | `timeGolden` 7 条 / 6 条 delta（`auto-1201-1481-1311`、`auto-1381-1481-1311`、`agent:1481:c0`）；隔离对照证明漂移来自换源本身 | 站在输入层。R1/R2 合一后仍 ≠ R3（赠行）：`agent:1481:c0` 的送客会从 3 被推到 4，而赠行仍是 3 |
| B. 事后按池改写送客行（仿 `applyLiuyinPromote` 以池为准去 patch 1481009 行） | 未实施。同型先例：赠行的旧 post-hoc carve 在 `auto-1591-1481-1311` 破坏守恒、净占用 +7.2s（`liuyinPromote.ts:104-108`） | 送客时间记在 iterate 的必要时间账里，事后只改行不改账 ⇒ 时间守恒破坏 |
| C. 把 `promoteFixpoint` 搬进 iterate | 未实施 | 池需要完整的执行计划，会形成轮内循环依赖；滞后注入在出口处给出的是同一个不动点，搬家没有收益 |

## 5. 预测与证伪闸门

- **前提假设**：非轴、`stable` 出口时，上一轮 `promote` = 本轮 `promote`（滞后已沉降），所以接线后四个读数在出口处逐位相等。
- **可观察失败**：W25 探针在某个非轴 `stable` key 上读到 `outPrev.promote ≠ out.promote` ⇒ 签名守不住 promote。那就要先给 `outerFeedbackSignature` 显式加 promote（换尺，单独一批；规则 17②「换尺与改代码不得混批」），再做 W26。
- **一阶预测**（W25 逐 key 量化，W26 实测对账）：
  - 轴模式 key：零 delta。
  - `agent:1481:c0`：送客行不变（滞后 promote = 3 = 现行 floor）；预留从 4 变成 3。**这一条待 W25 证实**：由 W21 数据 `planned=1.68, fixpointPromote=3` 推出现行预留 4 ≠ 赠行 3，也就是现状账本有一次目标终结技时长的缺口。
  - 非轴含琉音的 key：送客行按 `outPrev.promote − floor(G/90)` 变化，预留按 `outPrev.promote − R2` 变化。二阶反馈（送客时长 → 平A池 → 能量 → 强特 → G）由 W26 实测报告。

## 6. 拆卡与顺序

1. **W25 · 预测探针**（只读 + 隔离 worktree）：对全部 25 个含 1481 的 `timeGolden` key（5 个 `agent:1481:cN` + 20 个预设）逐一读出 R1–R4、`outPrev.promote`、`outerExit`、赠行行数、预留秒数，产出一致性四判据表和 W26 的逐 key 预测。
2. **W26 · 实现**（隔离 worktree，等 W25 回收且闸门 PASS）：§3.1 五步 + 不变量测试（非轴 `stable` key 上 `farewellCount − ownUltimateCount == promote == 预留次数 == 赠行次数`）+ 实测 delta 与 W25 预测逐 key 对账。**不改基线**：由 lead 按规则 10 归因后用 `TIME_GOLDEN_UPDATE=1` 重生成。
3. **lead**：复核 diff；变异负控（兜底改回 floor 且忽略滞后值 ⇒ 不变量必须红）；重生成基线并在提交说明写 delta 表；合入前跑全量 `npm run verify`。
4. **待用户**：W20 §5-1 裁决后拆 §3.3 的轴模式闸门。

W21 原卡作废：它的「`computeLiuyinSource` 内调 `computeLiuyinHugCounts`、失衡次数取同源」被本设计取代，失衡次数不再进入 `computeLiuyinSource`。

## 7. 未证明事项

- `agent:1481:c0` 现行预留 4 次，是从 W21 变体的计算推出来的，不是对现网 `liuyinGiftTimeReserved` 的直接读数（W25 补上）。
- 送客次数变化可能让个别队从 `stable` 变成环出口（送客 ↔ 强特 ↔ 好评之间的整数反馈）。W26 必须报告每个琉音 key 的 `outerExit` 前后对照，一旦出现 stable → cycle 就回炉。
- （观察，未核实）`promoteFixpoint` 内的池已按窗口时间占比扣减攒条（`liuyinPromote.ts:252-263`，闭式解 `:306-311`），外层又对池的答案乘了 `(1 − 覆盖率)`（`useResourceCalc.ts:377-379`）。两处是否对同一段窗口时间重复折扣，本文没有核实；两条口径各有用户裁决出处。要立项的话，先写只读取证卡，不要顺手改。

## 8. W25 实测增补（2026-09-25 15:51 回收，lead 复核 accept）

- 读数全表：`.zc/reports/W25-promote-readings.md` §3（25 个 key，`.zc/` 不入库）。lead 重放：正控 25/25 个 key 逐字段一致；负控（`liuyin.ts:179` 临时 +1）送客行 25/25 个 key 都 +1，C1 通过数 23 → 0。
- **前提成立**：非轴 `stable` 出口上 C4（滞后已沉降）25/25 成立，闸门列表为空。§3.2「签名已守住 promote，不需要换尺」成立。
- **现语料上四个读数重合**：20 个预设 `floor(G/90) = promote = 预留次数 = 上一轮 promote = 4`（轴模式 `auto-1521-1481-1311` / `auto-1531-1481-1451` 的 promote = 0 属 §3.3 闸门之内）。原因：目标队友的连携执行数小，cap60 ≤ 2；而 G ∈ {363, 370.5} 时，cap60 ≤ 2 的阈值结转恰好等于 floor。
  ⇒ 分歧是潜伏的（W16：stun ≥ 3 时纯函数层 81.8% 的输入会分歧）。W26 在现语料上是**零 delta 重构**，价值 = 消掉三源并存 + 规则 11 注释矛盾 + 把不变量钉进测试。
- **空目标槽边界**（C3 的 5 个失败全部来自这里）：`agent:1481:cN` 单角色夹具的队伍是 `[1481, '', '']`，转大目标 = 空槽 2。`promoteFixpoint` 仍按全 90 档算出 promote = 3/4，而 `crossAgentSupplyAt` 在 `!targetCfg` 处返回 0、`applyLiuyinPromote` 找不到目标 ⇒ 预留 = 赠行 = 0。这是夹具的结构性边界，不是滞后未沉降。
  - **设计修正**：§3.1 第 1 步的生产端条件加「目标槽有角色」——`prevPromoteCount: !axisMode && rr.characters.some(c => c.slot === sp1.targetSlot) ? sp1.promote : undefined`（通用判定，不涉及角色身份）。空目标 ⇒ `undefined` ⇒ 走兜底 ⇒ 单角色 key 逐位不变。
  - 单角色场景下转大次数该是 0 还是 floor（琉音独自一人时送客是否仍按好评推），属于游戏语义 + 合成夹具，本设计不裁，保持现状。
- **§5 预测更正**：`agent:1481:c0` 的「现行预留 4 / 赠行 3 / 接线后预留 4 → 3」三项**不成立**。实测预留 = 赠行 = 0（空目标），接线后仍为 0。错因是把 W21 变体的计算当成了现网读数（§7 第一条已声明未证）。
- **W26 验收据此改为**：timeGolden 25 个 key **逐位不变**；不变量只断言「非轴 且 `stable` 且目标槽有角色」的 14 个预设（`auto-1021-1481-1341` 是 cycle 出口，排除）；负控用「生产端注入 `promote + 1`」的变异——换源前后在现语料上不可分辨，改回 floor 的变异不会变红。
