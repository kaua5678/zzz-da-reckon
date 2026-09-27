# 失衡双源：规划失衡 vs 物理次数（第 162 轮测量）

> 来源：ENGINE_PIPELINE_GUIDE 坑 25「已知残差」和第 177 行「仍双源」；`docs/mcp-outer-fixedpoint-continuity.md` §5.3；队列第 161 轮交接下一步 1。
> 本轮只测量、不改数值。结论：**原计划的原型不落地；双源主因另有所在，已定位。**

## 0. 两个量

| 量 | 字段 | 谁算 | 谁用 |
|---|---|---|---|
| 规划失衡（计划窗口数，小数） | `resourceResult.plannedStunCount` | `solveTeam.ts` `runOuterLoop`（外层不动点输入） | 时间分配（非失衡时间、平 A 池） |
| 物理次数（整数） | `stunPoolResult.stunCount` = `floor(N*)` | `ultimatePromote.ts` `promoteFixpoint` 闭式 N*（池内已按自身窗口占比做时间守恒） | 伤害侧 `allocateAxisWindows(…, Math.round(stunCount))`（damagePoolDirect / damagePoolRelease）、机制行 `stunCount`（damagePoolCharExtras）、UI、对比指标 |

外层每轮的 `next` 依次过三道（`solveTeam.ts` 约 196–218 行）：
1. `next = rawNext × (1 − coverage)`，其中 `coverage = stunIn × 窗长 / 有效时间`（坑 25 所说的「第二次折算」）；
2. `maxFull` 截断（装得下的完整窗口数 + 残差系数）；
3. **必要时间约束**：`有效时间 − next × 窗长 < Σ necessaryTime` 时，`next = (有效时间 − Σ necessaryTime) / 窗长`。

## 1. 测量方法

- 探针：104 个 3 人预设（与 timeGolden 同口径 `setupHarness` + `applyTeamPreset`），每队记录总伤、物理次数、N*、规划失衡、外层退出方式、轮数、留白、超预算，以及外层最后一轮的有效时间、窗长、Σ`necessaryTime`、必要时间上限、coverage 公式值、Σ`comboAlignCredit`。
- 原型开关 `PROTO_DUAL=1`：外层第 1 步改为 `next = N*`（去掉第二次折算），第 2、3 步保留。
- 复现文件（不在仓库）：WSL `/home/kaua/calc-arch/dual162/`。
  - `proto162.py`：打补丁（池挂不可枚举属性 `__nStar`，外层加开关）；运行前先 `mkdir -p /tmp/cc138`，它会把原文件备份到那里。
  - `proto162b.py`：外层最后一轮记录到 `globalThis.__outerLast`。
  - `zzDual162.test.ts`：探针，复制到 `src/` 下跑，一次约 6s。输出在 `/home/kaua/calc-arch/dual162-{base,proto}.tsv`，分析脚本为 `an162.py` / `an162b.py`。
  - 跑完用 `.orig` 备份恢复，`git diff --quiet` 确认。

## 2. 结果

### 2.1 原型（去掉第二次折算）：不落地

| 指标 | 基线 | 原型 |
|---|---|---|
| 外层退出 | stable 100 / cycle 4 | stable 100 / cycle 4（有 1 进 1 出） |
| 规划失衡均值 | 1.35 | 1.53 |
| 物理次数变化 | — | 2 队 −1 次，其余不变 |
| 总伤 | — | 中位数 0.00%，均值 +0.06%，范围 −11.71%（yidhari-qingyi-lucia，3→2 次）到 +4.35% |
| 留白 / 超预算合计 | 94.5s / 1.2s | 87.5s / 1.3s |
| 原型下 \|N* − 规划失衡\| | — | 均值 2.05，最大 5.25 |

队列第 161 轮写的落地条件是「cycle / maxIter 明显减少，且变化能逐队解释」。cycle 没有减少，而且规划失衡与 N* 仍然差 2 左右，说明它没有解决双源，**不落地**。连带地，计划中的 a)「给 `StunPoolResult` 加 `stunCountContinuous`」也**不提交**：没有消费者的字段就是死字段。以后需要时，按 `proto162.py` 的做法挂出即可。

### 2.2 真正的主因：必要时间约束

按基线最后一轮判断规划失衡由哪一道决定（容差 0.06，与外层判稳容差 0.05 同量级）：

| 决定规划失衡的约束 | 队数 | 物理次数均值 | 规划失衡均值 |
|---|---|---|---|
| **必要时间约束（第 3 步）** | **78 / 104** | 3.00 | 1.01 |
| coverage 折算（第 1 步） | 26 / 104 | — | — |

- **17 队 Σ`necessaryTime` > 有效时间** ⇒ 规划失衡 = 0，物理次数却是 1–5 次。例：`auto-1461-1521-1361` 的 necessary 216.4s，有效时间 180s，物理 5 次，规划 0。
- Σnecessary / 有效时间 的中位数为 0.86，最大 1.20。可这些队的实际超预算合计只有 1.2s，说明 `necessaryTime` 作为约束远比物化占用松。
- **已否定的假设**：`necessaryTime` 是含合轴抵扣的毛值（`helpers.ts` 约 553 行 `cappedNecessary = 净 × feasibleScale + effectiveCredits`），而 `teamTimeSummary` / `foldLoop` 都扣掉了 `comboAlignCredit`。但按净口径重算上限后，78 支受约束的队里**有 0 支**上限会升高（有抵扣的 15 队本来就不受该约束）。所以这不是原因。
- **剩下的嫌疑**：外层代码注释明写这条约束用的是「含链的保守上界」（`solveTeam.ts` 约 210 行）。`necessaryTime` 包含连携、大招等**本来就发生在失衡窗口内**的动作（`timeOccupation.ts` 第 22 行注释：必做动作 = 强特 + 终结技 + 连携等），约束却要求它们全部挤进非失衡时间。窗口越多，窗口内能容纳的连携越多，这条约束因此系统性地压低了规划失衡。

### 2.3 口径判断（第 162 轮拍板）

- 坑 25 把双源归因于「双重折算」，**这个归因只覆盖 26/104 队**。主因是必要时间约束把窗口内动作算成了窗口外时间。已在 ENGINE_PIPELINE_GUIDE 坑 25 追记更正。
- 不在本轮改数值：改约束会让 78 队的规划失衡上升，时间分配和平 A 池随之全库变化，需要单独开卡并逐队解释。

## 3. 下一步（可直接开工）

1. **拆出窗口内必要时间**（先测量）：
   - 从每队最终 `resourceResult.characters[i]` 的物化执行行（先读 `src/types/resource` 里的执行行类型，找连携 / 终结技的标识，例如 moveId 与 `chainMoveId`，或行类别字段；前台判定用 `isFrontlineExecution`）求 Σ(连携行时长) 和 Σ(终结技行时长)。
   - 在探针里新增一列 `inWindow`，计算 `capNet = (有效时间 − (Σnecessary − inWindow)) / 窗长`，统计 78 队里有多少队的上限会升到 N* 附近，以及 17 个「规划 0」队的变化。
   - 物理上界提示：每窗可容纳的连携数 × 连携时长 ≤ 窗长，所以 inWindow 不应超过 `规划失衡 × 窗长`，这是个不动点，原型里用上一轮的 stunIn 近似即可。
2. 若测得 inWindow 足以解释主要差距，开 CC 卡：把约束改为 `有效时间 − next × 窗长 ≥ Σnecessary − inWindow(next)`，并跑 zd / timeGolden / timeFillRatchet / seedInvariance，逐队解释。验收：`物理次数 − 规划失衡` 的均值明显下降，不新增超预算队，外层 cycle 不增加。禁止用「更接近投稿」当理由。
3. 回退点：本轮没有代码改动。

## 4. 第 163 轮：窗口内必要时间 + 连携账本缺口（测量，无代码）

复现文件：WSL `/home/kaua/calc-arch/win163/`（`zzWin163.test.ts` 逐队按 `category|source|skillDamageTarget` 分组求 necessary 桶前台行时长；`zzOcc163.test.ts` 抽 4 队看 `frontlineOccupationBreakdown`；`an163.py` 分析）。两个探针都依赖 `dual162/proto162.py` + `proto162b.py` 的钩子，先打补丁再跑，跑完用 `/tmp/cc138/*.orig` 恢复。

### 4.1 「含链保守上界」只解释一小部分

104 队 necessary 前台行合计：强特 5292s、支援 3715s、终结技约 1999s（`skillDamageTarget=ultimate`，含 `chain|-|ultimate`）、失衡送的连携（`chain|stun`）约 720s（每队约 7s）。

在受必要时间约束的 80 队上（本轮用「规划 < N* − 0.06 且 ≈ 约束上限」判定，与第 162 轮的 78 队基本一致），把窗口内动作从 Σnecessary 里扣掉后重算上限：

| 扣掉的部分 | 上限到达 N* 的队数 | 平均缺口（N* − 规划） | 17 个规划 0 队中抬到 > 0.5 的 |
|---|---|---|---|
| 仅失衡连携 | 0 / 80 | 2.50 → 2.19 | 0 |
| + 终结技 | 18 / 80 | 2.50 → 1.35 | 6 |
| + 其余 chain | 23 / 80 | 2.50 → 1.24 | 7 |

结论：第 162 轮 §3 的假设（连携挤占）**不成立为主因**。

### 4.2 真正的矛盾：外层约束与池的时间守恒口径互斥

抽样 `auto-1461-1521-1361`：Σ前台毛 216.4s，合轴抵扣 36.4s，净占用**正好 180.0s**，平 A = 0。也就是说，动作把整场战斗占满，这完全合法，超预算为 0。

- 外层约束（`solveTeam.ts` 约 210–218 行）假定**失衡窗口与必要动作互斥**，即「非失衡时间 ≥ Σnecessary」。动作占满 180s，于是规划失衡 = 0。
- 池（`promoteFixpoint`，2026-09-01 用户口径「窗口内的招式吃易伤但不攒条」）假定**动作在窗口内照常进行、只是不攒条**，于是物理次数 = floor(5.25) = 5。
- 两个口径对同一个 180s 做了不相容的假设。第 162 轮以为是「约束太松」，其实是**约束的前提本身与池口径冲突**。

### 4.3 用户可见后果：有失衡、没连携

连携 / 喧响 / 能量的计数通道读的是规划失衡：`helpers.ts` 第 27 行 `countStunOf` → `globalCfg.stunCount`（外层计划值；C7 `stunPlanProjection` 缺省 off，只做取整，救不了 0 vs 5）。`chainCount = chainCountPerStun × countStunOf(...)`，见 `helpers.ts` 第 246、402、605 行。

| 现象 | 队数 |
|---|---|
| 物理失衡 ≥ 1 次，失衡连携时长 < 0.5s | **21 / 104**（其中 17 队规划 < 0.1） |
| 规划 / 物理 < 0.5（连携数不到物理次数所对应的一半） | **50 / 104**（中位数 0.51） |

例：`auto-1461-1521-1361` 物理 5 次，失衡连携 0s；`auto-1371-1481-1451` 物理 4 次，失衡连携 0s。伤害侧按 4–5 个窗口吃易伤，账本侧一次连携也不打，连携带来的伤害、能量和喧响全部缺失。

### 4.4 第 163 轮拍板

- 这是口径缺陷，不是调参问题。修复一定会全库动数，所以**本轮不改代码**，下一轮开 CC 卡做原型并逐队解释。
- 修复方向（按优先级；原型用环境开关，不提交，先量）：
  - **P1 计数通道改读物理次数**：`countStunOf` 改读上一外层轮的 `stunPool.stunCount`（或 N*），时间账仍读规划值。需要在 `runCalcRound` 调用时把上一轮池计数传进 `globalCfg`（例如新字段 `stunCountPhysical`；先读 `convergence.ts` 第 767 行 `stunCount: stunCountN` 那一段的传参）。
  - **P2 去掉或放宽外层必要时间约束**：让规划失衡回到池口径（`next = rawNext × (1 − coverage)` 或 N*，保留 `maxFull`）。风险：这条约束是「打法循环成立」的保护，去掉后连携变多、挤占前台，可能引起超预算或截断，要看 timeFillRatchet。
  - 两者可叠加。先单做 P1，因为它只动计数通道、不动求解器，不会把坑 25 的阶梯 2-循环请回来（`stunPlanProjection.ts` 文件头的语义边界）。
- 验收（CC 卡）：「物理 ≥ 1、失衡连携 < 0.5s」的队数从 21 降到约 0；超预算队数不增加；外层 cycle / maxIter 不增加；zd / timeGolden / timeFillRatchet / seedInvariance 逐队解释。禁止用「更接近投稿」当理由。
- 回退点：原型阶段无代码；落地后回退 = 还原 `countStunOf` 并还原三份基线。

## 5. 第 164 轮：CC-140 P1 计数通道读物理次数（`f65c07ae`，缺省 off）

### 5.1 落地了什么（零差）

- `stunPlanProjection` 新增模式 `'physical'`（机制参数 `time.stunPlanProjection` = 4）：`projectStunPlanForCounts(plan, 'physical', physical)` 返回上一外层轮池物理次数（`threads.prevPoolStunCount` = floor(N*)），首轮缺省回落计划值。
- 两个读点都接上：`helpers.ts` `countStunOf`（经 `ResourceCalcConfig.stunCountPhysical`）和 `convergence.ts` 局部 `countStun`（直接读 `threads.prevPoolStunCount`）。
- **缺省仍是 off**：zd DUMP / ROWS DIFF 0；verify189 EXIT=0。
- 测试：`src/composables/__tests__/stunPlanPhysical.test.ts`。其中一条**钉住现行缺陷**：缺省口径下 `auto-1461-1521-1361` 物理 5 次、失衡连携 0 秒。缺省口径改好后这条会红，届时改断言并更新本节，不要删。`src/core/__tests__/stunPlanProjection.test.ts` 的编码 4 从「越界」改为 physical（越界改用 5），模式表长度 4 → 5。
- 回退点：`git revert f65c07ae`。缺省 off，下游没有依赖。

### 5.2 打开 physical 的实测（104 队）

复现：WSL `/home/kaua/calc-arch/phys164/zzPhys164.test.ts`（依赖 `dual162/proto162.py` + `proto162b.py` 钩子；`PROTO_PHYS=1` 时设置编码 4）；分析脚本 `an164.py`。

| 指标 | off（现行） | physical | §4.4 验收 |
|---|---|---|---|
| 物理 ≥ 1、失衡连携 < 0.5s 的队 | 21 | **6** | 约 0：**未达** |
| 超预算队数 / 合计 | 5 / 1.2s | **13 / 15.9s**（11 队变差，单队最大 2.37s） | 不增加：**违反** |
| 外层退出 | stable 100 / cycle 4 | stable 102 / cycle 2 | 不增加：达标 |
| 失衡连携总时长 | 720s | 1503s | — |
| 物理次数 | — | 2 队 −1 | — |
| 总伤 | — | 均值 +2.36%，中位数 +0.22%，−9.51%（banyue-liuyin-lucia，4→3 次）到 +24.55%（auto-1501-1511-1311）；74 队变化 > 0.1% | — |

- 残余 6 队：`auto-1521-1461-1311`、`auto-1521-1361-1311`、`auto-1521-1481-1311`、`auto-1521-1251-1311`、`auto-1591-1481-1211`、`auto-1531-1481-1451`。其中 4 队含 1521（希希芙），而且几队的规划失衡有 2.4–3.5，off 下同样 0 连携，**说明与计数通道无关**，是另一个缺口（未查，可能是 `chainCountPerStun = 0` 或轴覆盖 `chainCountTotalOverride`，见 `convergence.ts` 约 428 行）。
- 超预算变差的 11 队（例 `auto-1371-1481-1451` 0 → 1.98s、`auto-1321-1481-1491` 0 → 2.37s、`auto-1201-1481-1211` 0 → 0.88s）：补上的连携进了前台时间账，而这些队的动作本来就占满 180s（平 A ≈ 0），没有平 A 可压缩。

### 5.3 第 164 轮拍板：不切默认

- 依据：§4.4 自定验收有两条没过（残余 6 队、超预算 +8 队）；74 队伤害变化需要逐队解释，本轮做不完。
- **但超预算增加不一定是回归**：off 口径靠「失衡 5 次、连携 0 次」把时间账凑平，physical 让连携真实占用时间。正确的收拾方式是可行化阶段 S3（`solveTeam.ts`「阶段 S3：可行化决策」长注释：非轴仍撑不下 ⇒ 二分缩放交互次数），而不是继续藏连携。
- 所以 §4.4 的验收条「超预算队数不增加」**修订为**：「超预算单队 ≤ S3 的触发容差，或已被 S3 收拾」。先查清 S3 为什么没接住 0.2–2.4s 的超出（多半是在容差内）。

## 6. 第 165 轮：CC-141 physical 超预算归属（`d395ba79`，缺省 off 零差）

### 6.1 S3 为什么没接住：三类，主因不是 S3

探针（WSL `/home/kaua/calc-arch/s3p165/`：`zzS3p165.test.ts` 逐队输出两模式的 budget / rowsNet / 截断 / axisFallback / interactionScale；临时钩子 `hook165.py` 在 S3 每档试算打点；`zzS3q165.test.ts` 按行拆必要时间；分析 `an165.py`）。S3 的触发 = `netOf > stunEffTime + 2s`（`AXIS_FALLBACK_TOLERANCE_SEC`）或装配截断 > 1s。

1. **超出 < 2s（7 队）**：S3 按设计不触发（在 2s 容差内）。
2. **超出 > 2s（`auto-1321-1481-1491`、`auto-1321-1481-1311`、`auto-1381-1481-1311`）**：S3 **触发了**，但 8 档交互降配试算的净占用**全部相同**（1321-1481-1491 八档都是 182.367s）⇒ 超出与交互次数无关，S3 没有杠杆，落到「相对档」兜底。
3. 11 队里 10 队含 1481（琉音）。按行拆：超出 **恰好等于一行「好评转大·队友终结技」**（1321-1481-1491：物化 5 次 11.84s，账本按 4 次预留 9.47s，差 2.37s）。

### 6.2 根因：CC-140 漏改的计数通道（选 b 的变体：不是 S3 的错，是源头口径分裂）

琉音赠大 / 诺姆赠链的次数由模块供给按 `chainCountPerStun × stunCount` 推连携窗口（`mechanics/agents/liuyin.ts` supply），属计数通道。CC-140 只把 `helpers.ts` 的 `chainCount` 切到了 `countStunOf`，下面这些**同一个量的消费点**仍读计划值 `config.stunCount`：

- `core/resource/helpers.ts` 账本预留（`crossAgentSupplyAt` 赠链、`ultimateGiftOf` 赠大）
- `core/resource/foldLoop.ts` 折叠环行测量（两处）
- `core/resource/underfillProbe.ts` 欠打探针（两处）
- `core/resource/tailPipeline.ts` 装配截断上限（两处）+ `ultimateGiftRowSpec` 赠行规格
- `core/resource.ts` 默认种子 `chainCountTotal`（没传物理次数，physical 模式下种子回落计划值）

而装配侧 `promoteFixpoint` 用池物理次数给赠大次数 ⇒ physical 模式下账本少预留一整次终结技。修法：新增 `stunCountForCountChannel(config)`（`core/stunPlanProjection.ts`，计数通道单一入口），上述各处统一改读它；`countStunOf` 也改成调它。off 下恒等。

### 6.3 实测（104 队，physical，修前 = HEAD `c9d19881`，修后 = `d395ba79`）

| 指标 | off（现行缺省） | physical 修前 | physical 修后 |
|---|---|---|---|
| 超预算队数 / 合计 / 单队最大 | 5 / 1.23s / 0.77s | 13 / 15.86s / 2.52s | **3 / 0.49s / 0.22s** |
| 装配截断 > 1s 的队 / 合计 | 0 / 0 | **4 / 274.3s** | 2 / 177.0s |
| 外层 cycle | 4 | 2 | 2 |

- off 模式 104 队逐字段不变；zd `cc141` DUMP / ROWS DIFF 0；verify190 EXIT=0（3805 passed / 29 skipped）。
- physical 伤害相对修前变化 > 0.1% 的 14 队。大头：`banyue-liuyin-lucia` +9.75%（截断 64.2→0，S3 采纳 0.5 档）、`auto-1371-1481-1451` −6.70%（S3 档 0.125→0.625，超出 1.98→0）、`auto-1431-1481-1311` +4.87%（截断 26.6→0）；其余 1481 队 −0.1%～−1.0%（少一次赠大行进账）。
- **第 164 轮探针漏看了截断**（只看了 slack），`banyue-liuyin-lucia` −9.51% 的一部分就是 64s 截断，不是计数本身。以后评估 physical 必须同时看 `rr.overflowSeconds`。
- 测试 `src/composables/__tests__/stunPlanGiftChannel.test.ts`：单元 + 两队 physical 超预算 < 0.05s。反向验证：只回退 5 个消费点文件 ⇒ 两条红（2.367 / 2.517），恢复后 cmp 一致。

### 6.4 第 165 轮拍板

- §5.3 修订后的验收「超预算单队 ≤ S3 容差或被 S3 收拾」：**修后已满足**（最大 0.22s < 2s，且少于 off 的 0.77s）。
- **仍不切默认**，新阻塞 = CC-143：physical 下 `auto-1431-1481-1341`（截断 82.5s）、`auto-1431-1481-1491`（94.6s）两队（叶瞬光 + 琉音）装配截断巨大，off 下两队截断 0（off 的 1431-1481-1491 由 S3 采纳 0.125 档收拾）。S3 八档全部被拒：绝对可行要求截断 ≤ 1s，最小档 0.0625 仍截断 13s；且基线净占用已被截断压到 ≈180s ⇒ 相对臂③「留白不增」把低档全拒。S3「无人满足 ⇒ 不动」于是保留截断最大的基线态。
- 回退点：`git revert d395ba79`（off 零差，下游无依赖）。

### 6.5 CC-143 开工指引

1. 先拆需求：1431-1481-1491 physical 截断前的必要时间约 282s（off 约 227s），差 55s，远大于 3 次失衡连携（约 18s）。用 `s3p165/zzS3q165.test.ts`（改 `S3P_IDS`）看截断前行数：需要在 `tailPipeline` 截断之前打点（截断后的行已按比例砍过）。怀疑点：叶瞬光（1431）按失衡次数/连携给资源的机制放大了强特数（明心境·归尘 9→11 次），以及 `applyTeamMechanics` 仍读规划值的 `stunCount`（见下条未决）。
2. 再决定 S3 兜底：当「无人满足」且基线截断 > 容差时，是否退到「三臂中①②满足、截断最小」的档。历史否决（「最小截断优先」把结构性溢出队压到 0.0625）针对的是**首选**策略，这里只是兜底；改前必须跑 off 104 队确认零差（off 下这条路径 0 队走到）。
3. 结清后再评估切默认（第 164 轮下一步第 3 条不变）。

### 6.6 未决（沿用）

- `applyTeamMechanics` / `applyTeamConfig` 的 `stunCount`（耀嘉音按失衡次数汇总全队连携入场、诺姆 `normaStunCount`）仍读规划值。它不是「计数投影」统一入口的一部分（走编排层），physical 模式下同样是口径分裂的候选，CC-143 拆需求时一并看。

## 7. 第 166 轮：CC-143 physical 巨额截断（`98693cac`）

### 7.1 截断从哪来：真实的「资源允许的动作 > 时间」，不是账本 bug

探针 WSL `/home/kaua/calc-arch/t166/`（`zzT166.test.ts` 输出 `truncationBySlot` / `truncationCuts` / 折叠环诊断；`zzV166.test.ts` 复现 zd 变体；`an166.py` 对比 104 队）。

- `auto-1431-1481-1491` physical：槽 0（叶瞬光）物化行请求 193.2s、账本必要 131.2s；三槽截断 67.1 + 18.3 + 9.1 = 94.6s。
- 折叠环诊断 `timeBudgetConverged=true` 但 `timeBudgetResidualSeconds=71.0`：是停滞判据（连续 3 轮改善 ≤ 10ms）判的收敛。原因是 iterate 把全队必要时间压在预算内（131.2 + 56.1 + 25.2 − 合轴抵扣 32.5 ≈ 180），需求已超预算，折叠无处可折，残差必然停滞。**这不是折叠环的缺陷**，截断口径（`@fact engine:时间线截断`：180s 到点结算，资源允许但装不下的部分截掉）正是为这种情况设计的。
- physical 下需求比 off 大：3 次失衡 × 三人连携 + 连携带来的喧响 / 能量（终结技 6→7、2→3、1→2；明心境行增多）。off 口径靠「失衡 3 次、连携 0 次」把这部分藏掉了（§4.3 的老问题）。

### 7.2 真缺陷：S3「全档不可行 ⇒ 保基线」留下满交互 + 最大截断

- S3 非轴降配要求截断 ≤ 1s 才算 accepted；这两队八档全部 > 1s ⇒ `selectDownscaleScale` 返回 null ⇒ 保基线（scale 1）。结果是**交互次数最多、截断也最大**，和用户口径「交互只取达成目标的最少要求」「必须溢出才能达成目标，就不会强行往上加交互次数」相反。
- 修法（`src/composables/resourceCalc/feasibilitySearch.ts` + `solveTeam.ts`）：新增第三层「缓解档」——未 accepted，但三条相对臂都不比基线更差、截断比基线少一个容差（1s）以上、**外层 stable**；前两层落空时取其中**截断最小**者（并列取较大档）。仍无 ⇒ null 保基线（旧行为）。
- 拍板过程（都实测过）：
  - 「首个缓解档」：取到 0.875，截断只从 94.6 降到 61.6s，太弱。否决。
  - 「截断最小，不限 stable」：取到 0.0625，截断 30.3s（合计），但两队外层退出变 cycle（全库 cycle 2→4）。否决：cycle 停点是环内选点，路径依赖。
  - **采用**「截断最小 + 外层 stable」：取到 0.125。
- 与 R32 否决的「最小截断优先」不冲突：那是**首选**策略（会压过真可行的大档）；这里只在全档不可行时兜底。

### 7.3 实测

| 口径 | 变化 |
|---|---|
| off，104 个默认预设 | 逐字段 0 变化；timeGolden / timeFillRatchet 未动（verify192 EXIT=0，3810 passed / 29 skipped） |
| physical，104 队 | 2 队变：`auto-1431-1481-1491` 截断 94.6→20.0s、总伤 +2.08%；`auto-1431-1481-1341` 82.5→20.6s、+6.60%。合计截断 177.0→40.6s；超预算 3 队 / 0.49s 与 cycle 2 不变 |
| zd `cc143`（off 下的变体）DIFF 6，全部归因于第三层 | 叶瞬光 6 命：`auto-1431-1491-1341/c6` 截断 44.6→22.3s（总伤 +6.1%）、`auto-1431-1481-1491/c6` 115.6→48.2s（+6.1%）、`auto-1431-1481-1341/c6` 98.7→19.6s（+7.0%）；交互 +25：`auto-1431-1481-1491/heavy` 219.8→15.4s（+43%，旧行为保留全部 +25 次交互再截掉 220s）；`auto-1461-1521-1031/heavy` 与 `/heavyGate` 是 zd 顺序运行下的路径依赖（冷启动单跑修前修后都是 71.66M、scale 0.375），修后 zd 里两者都收敛到 71.65M，与冷启动一致 |

- 测试 `src/composables/__tests__/s3ReliefTier.test.ts`：3 条纯函数（第三层取最小、只在缓解档中选、有相对档时不生效 / 无缓解档仍 null）+ 2 条 physical 集成（scale 已定义、截断 < 40s、stable）。反向验证：回退两个源文件 ⇒ 4 红 1 绿（null 那条本来就该绿），恢复后 cmp 一致。
- 回退点：`git revert 98693cac`（默认预设零差；只影响「全档截断 > 1s」的配置）。

### 7.4 physical 现状与切默认评估（第 166 轮）

| 指标（104 队） | off（现行缺省） | physical（当前 HEAD） |
|---|---|---|
| 物理 ≥ 1、失衡连携 < 0.5s | 21 | 6（未复测，§5.2 数字） |
| 超预算队 / 合计 | 5 / 1.23s | 3 / 0.49s |
| 截断 > 1s 的队 / 合计 | 0 / 0 | 2 / 40.6s（剩余约 20s/队与交互无关，合法截断） |
| cycle | 4 | 2 |

- **仍不切默认**，剩余阻塞只剩 CC-142（希希芙系 6 队）和「切默认本身的逐队解释」（74 队伤害变化 > 0.1%，§5.2）。截断不再是阻塞：剩余 40.6s 是 §7.1 所述的真实溢出。
- 切默认时要改的：`src/stores/config` 里 `time.stunPlanProjection` 的缺省编码 0→4（先 `timeout 40 git grep -n "stunPlanProjection" -- src/stores src/data` 找缺省定义），`stunPlanPhysical.test.ts` 的缺陷钉（改为「缺省下也有失衡连携」），两份时间基线重生成并逐队解释。

## 8. 第 167 轮：CC-142「有失衡、没连携」残余 6 队（`44bc4c67`，off 零差）

探针 WSL `/home/kaua/calc-arch/c167/`（`zzC167.test.ts` 逐队输出两模式的失衡连携秒数、每槽 `axisActive` / `chainOverride` / `chainCountPerStun`，需配合临时钩子 `hook167.py`（改 `convergence.ts`，用完 `git checkout` 恢复）；`AX=1` 时额外输出生效轴的块列表；`an167.py` 对比 `out-head` / `out-fix`）。

### 8.1 复测与归类

CC-141 / CC-143 之后复测 physical：仍是 §5.2 那 6 队，**全部是轴模式**（off 的 21 队里另外 15 队是非轴，physical 已修好）。轴模式下连携总次数 = Σ(轴内连携块 × 该轴分到的窗口数)（`convergence.ts` `axisChainTotal`，口径「轴即最终次数，未列连携块的槽位 = 0 次」），不走 `chainCountPerStun`。

1. **4 支希希芙队不是缺陷**（`auto-1521-1461-1311`、`auto-1521-1361-1311`、`auto-1521-1481-1311`、`auto-1521-1251-1311`）：生效轴是 `src/data/stunAxisPresets/希单c.json`「希希芙循环」，note 写明每次失衡窗内打「长按毒牙 + 大招 + 2 蛇吻 + 长按毒牙」，**没有连携块**。其中 `1521-1361-1311` 计划 3.48、分到 3 窗，连携照样是 0，证明与计数口径无关。按「数据本身可信」，这是轴作者的写法。
2. **2 队是 physical 漏切的计数通道**（`auto-1591-1481-1211`、`auto-1531-1481-1451`）：轴里有连携块，但窗口数 `allocateAxisWindows(resolvedAxes, stunCount)` 读的是计划值（0.18 / 0），而伤害侧（`damagePoolDirect` / `damagePoolRelease`）按池物理次数分窗。

### 8.2 修法

`convergence.ts` 四处**计数用途**的分窗改读 `countStun`（本函数第 146 行已有，off 下 ≡ `stunCount`）：`computeAxisActionCountsFor`（块计数）、`axisChainTotal` / `axisUltimateTotal`、轴模式转大 `axisHug`、补齐需求 `axisUltimateNeed`。**时间用途**的分窗（决算截断 `verdictSecondsLost`、窗内异常积蓄 `Math.round(stunCount)`）保持实数计划值，与 `core/stunPlanProjection.ts` 的语义边界一致。

### 8.3 实测（104 队，修前 = `68bd9d0c`）

| 指标 | off | physical 修前 | physical 修后 |
|---|---|---|---|
| 物理 ≥ 1、失衡连携 < 0.5s | 21 | 6 | **4**（全是 §8.1 第 1 类） |
| 超预算队 / 合计 / 单队最大 | 5 / 1.23s / 0.77s | 3 / 0.49s / 0.22s | 6 / 4.35s / 1.93s |
| 截断 > 1s 的队 / 合计 | 0 / 0 | 2 / 40.6s | 2 / 40.6s |
| cycle | 4 | 2 | 3（`yixuan-trigger-lucia` stable→cycle） |
| 失衡连携总时长 | 720s | 1517s | 1612s |

- off 104 队逐字段不变；zd `cc142` DUMP / ROWS DIFF 0。
- physical 变化 21 队，全是轴队，失衡连携都增加。总伤多数 +1%～+6%；大的：`auto-1531-1481-1451` +22.9%（0→7.2s 连携）、`yixuan-jufufu-lucia` +31.0%（物理 3→4、cycle 不变）、`yixuan-trigger-lucia` +17.8%（变 cycle）；降的：`auto-1591-1571-1211` −5.96%、`auto-1041-1571-1031` −0.71%。
- 超预算增加的 3 队（`yixuan-roxy-lucia` 1.93s、`auto-1591-1481-1211` 1.36s、`auto-1531-1481-1451` 0.57s）都在 S3 的 2s 容差内，满足 §5.3 修订后的验收。
- 测试 `src/composables/__tests__/stunPlanAxisWindows.test.ts`：`auto-1531-1481-1451` physical 失衡连携 > 3s（修前 0）；另一条钉住希希芙单 C 轴的数据前提（0 连携）。反向验证：回退 `convergence.ts` ⇒ 第一条红（0 > 3 失败），恢复后 cmp 一致。
- 回退点：`git revert 44bc4c67`（off 零差）。

### 8.4 拍板与切默认评估

- 「有失衡没连携」这条验收**修订**为：「除轴里没写连携块的队以外为 0」。依据：§8.1 第 1 类是轴数据口径，不是引擎缺陷；physical 下已达到。
- 切 physical 默认的**引擎阻塞项已清空**（CC-141 / 142 / 143）。剩下的是切换本身：约 80 队伤害变化需要按原因分类解释（下一张 CC-144）。
- 未决：
  - 栈引擎路径（`axisExecutedStack` 非空时 `axisUltimateTotal` / 块计数取栈的实际执行集合）里窗口数的来源没核，是否也读计划值待查；本轮 21 队变化说明主路径是 `computeAxisActionCountsFor` 分支。
  - `yixuan-trigger-lucia` physical 下变 cycle：切默认时逐队看。
  - `applyTeamMechanics` / `applyTeamConfig` 的 `stunCount`（耀嘉音、诺姆）仍读计划值（§6.6）。

## 9. 第 168 轮：CC-144 试切 physical 默认——不切（代码 `47869b28`，零差）

### 9.1 做法
把缺省编码（原 `useResourceCalc.ts` 第 125 行 `getMechanicSetting('time.stunPlanProjection', 0)`）临时改成 4，跑全量 vitest（未提交）。结果 **33 红 / 3779 绿**，涉及 23 个文件。日志存档在 WSL `/home/kaua/calc-arch/k168/vitest-default4.log`。

### 9.2 33 条红分四类

| 类 | 文件（红条数） | 处置 |
|---|---|---|
| **A 不变量破缺（阻塞）** | `seedInvariance`（1）、`timeLedgerInvariants`（1） | 必须先修，见 9.3 |
| B 测试写法 | `calcOutputMemo`（1）：回滚时写死 0，不是真回到缺省 | 本轮已修（读缺省常量），并反向验证：常量改成 4 时该用例 6/6 通过 |
| C 基线 | `timeGolden`（1）、`timeFillRatchet`（2） | 真切时用 `TIME_GOLDEN_UPDATE=1` / `TIME_RATCHET_UPDATE=1` 重生成 |
| D 数值钉（缺省口径下录的精确值） | `outerCycleColdStart`（4）、`adjustableEffect`（3）、`damagePoolBatchR18d`（3）、`stunVulnSummary`（2）、`damagePoolBatchR17c`（2），以及以下各 1 条：`potentialAxisBatchB`、`normaSmoke`、`nextRoundFeedback`、`mechanicSettingsEffect`、`timeWeightAllocation`、`teamTimeSummary`、`moduleAnomalyEventRecords`、`liuyinAxisGiftSameSource`、`hugoVerdictLanding`、`difficultyDescent`、`damagePoolNightA`、`damagePoolDefDown`、`convergenceNightD` | 真切时逐条看：用例要测的是机制本身时，显式设 `time.stunPlanProjection = 0` 钉住旧口径；要测的是缺省产出时，更新期望值并写明原因 |

### 9.3 两个阻塞项（A 类）
1. **赠行单一口径破**（`timeLedgerInvariants` ④）：`auto-1431-1481-1491`、`auto-1431-1481-1341` 在 physical 下账本预留 5.000s，装配出的赠行只有 4.000s。同一次试切中 `outerCycleColdStart` 叶瞬光的 `giftForms` 从 3 变成 4，两者指向同一处：叶瞬光（1431）有一个由失衡推出的赠送次数消费点，**没有走** CC-141 的计数单一入口（`core/stunPlanProjection.ts` 的 `countStun`）。账本侧的来源是 `core/resource/tailPipeline.ts` 第 209 行 `ultimateGiftFinal.time`（到 `core/resource.ts` 第 396 行），装配侧是 `resourceCalc/ultimatePromote.ts` 第 107 行附近；模块在 `src/mechanics/agents/yeshuguang.ts`。**立卡 CC-145。**
2. **种子落点不变性破**（`seedInvariance`）：`auto-1591-1571-1211` 用校准种子时，槽 0（1591）的 `basicAttackTime` 与 `necessaryTime` 同向减少（Δ和 −0.99s），属于非守恒式再分配。对应已知坑：physical 首轮没有 `prevPoolStunCount`，会回落计划值，因此结果依赖初值路径。该用例是证伪闸门（规则：不许放宽容差、不许改基线）。**立卡 CC-146。**

### 9.4 拍板
- **不切默认**。依据：第 167 轮交接写明「某一类解释不通就不切」；A 类是不变量破缺，不是数值变化，没有解释空间。physical 仍是可切换模式（编码 4）。
- **本轮落地的零差准备**：新增 `core/stunPlanProjection.ts` 的 `DEFAULT_STUN_PLAN_PROJECTION_CODE`（缺省编码单一来源，显式标注 `number`，否则 vue-tsc 会把 `=== 2` 判成无重叠）；`useResourceCalc` 与 `calcOutputMemo.test.ts` 都读它。验证：zd `cc144prep` DIFF 0。以后切默认只改这个常量。回退点：`git revert 47869b28`。
- **没做的**：104 队 × 两模式的逐队分类表（交接第 2 步）。阻塞项先出现，分类要等 CC-145/146 修完再做才有意义（修完 physical 的数值还会动）。探针草稿 `/home/kaua/calc-arch/k168/zzK168.test.ts`（**未跑过**，字段名按记忆写的，用前先对照 `c167/zzC167.test.ts` 校正）。
- 难度阶梯 `difficultyLadder.ts`：「全关」置 0、G4 置 2 是阶梯自己的语义（「全关」= 旧口径基线），不跟缺省走。真切 physical 时要重新想 G4：round 投影的是计划值，放在 physical 之上是退步，大概率应让 G4 在缺省为 physical 时空转（增益 0 被阶梯自然丢弃）。这件事留给切默认那一轮定。

## 10. 第 169 轮：CC-145 叶瞬光队赠行单一口径（`6d2984ce`，off 零差）

### 10.1 根因（插桩实测，探针与插桩脚本存档在 WSL `/home/kaua/calc-arch/g169/`）
- 引擎账本侧 `ultimateGiftOf` 与赠行规格 `ultimateGiftRowSpec` 都已读 `countStun`（CC-141），两者本身一致：physical 下 auto-1431-1481-1491 的计数失衡为 3，琉音供给算出 60 转大 3 次加 90 转大 2 次，预留 5s。
- 编排层 `applyUltimatePromote` 用 `promoteFixpoint` 的 `promote` 覆盖赠行次数。`promoteFixpoint` 的目标连携数是 `min(cps × stun, chainExecCount)`，其中 `chainExecCount` 取自上一轮**装配后**的目标连携行。
- physical 下叶瞬光的失衡连携被装配截断，iterate 状态里是 3，行上只剩 2（后续轮次甚至 1），于是 60 转大窗口只有 2 个。好评 363 够 2×60+2×90=300，不够 2×60+3×90=390，所以 promote=4 是真实值，账本多留了 1s。外层迭代中 chainExec 在 3 和 2 之间交替，也是这个反馈环造成的（预留 5s 挤占时间 → 连携被截断 → 转大变少）。
- `-1341` 在显式切到模式 4 时一致（5=5），只在不变量测试的冷路径（推荐配装）下红过；本修法同样覆盖。

### 10.2 修法（拍板：退还，不改引擎预留）
- `applyUltimatePromote`：当引擎预留 > `promote × 终结技时长` 时：
  - 目标有 `basic_attack` 聚合行 → 差额退回该行（与 carve 对称）；
  - 没有 → 差额留作空闲（叶瞬光的平 A 全是模块分段行，`basicAttackTime` = 0，前台本来就小于账本，「行 ≤ 账本」仍成立）；
  - 两种情况下，输出的 `ultimateGiftTimeReserved` 都改为实际用量。
- 反方向（promote > 引擎次数）不在这里处理：那会让行超出账本，交给截断口径。
- 否决的方案：
  - ① 让赠行跟随账本取 5 次：好评量不可行；
  - ② 让引擎按截断后的连携数预留：装配在预留之后，会形成循环依赖；
  - ③ 把编排层 promote 注入引擎（仿照轴模式的 `axisUltimatePromote`）：外层本身在 3↔2 间交替，注入的是上一轮的值，仍会分叉。
- 回退点：`git revert 6d2984ce`。

### 10.3 验证
- zd `cc145` DIFF 0（缺省 off）。
- 新测试 `src/composables/__tests__/ultimateGiftRefund.test.ts`（physical 下预留 == 赠行 == 4；off 下 == 4）。反向验证：换回 HEAD 的 `ultimatePromote.ts` 后，physical 用例报「5 ≠ 4」。
- 缺省临时改为 4：`timeLedgerInvariants` 变绿；`outerCycleColdStart` 4 条和 `liuyinAxisGiftSameSource` 1 条仍红，都属于 §9.2 的 D 类（physical 下叶瞬光轮数 / 雨果决算次数变化），留给 CC-144。
- verify196 EXIT=0（3814 passed / 29 skipped）；CG 25；vue-tsc 0；诊断 0。

### 10.4 CC-146 调研（未修，第 169 轮）
- CC-145 之后仍复现：缺省临时改为 4 时 `seedInvariance` 红，只有 auto-1591-1571-1211 一队，而且**次数 0 条、时间账 1 条**——三类次数逐位相同，只有槽 0（1591）的 `necessaryTime` 在校准种子下少 0.76s（平 A 少 0.23s）。
- **更正第 168 轮的假设**：`seedInvariance` 是引擎层测试（用同一份最终 cfg 调 `calcTeamResources`，只换 `initialStates`），不经过外层，所以与「外层首轮没有 prevPoolStunCount」无关。
- 次数相同而必要时间不同 ⇒ 必要时间里有一项不由 ex/ult/chain 次数决定。候选：
  - a) 诺姆（1571）膛温换连携的赠连携预留 `chainGiftTimeReserved`：落点通常是上一位队友 = 1591；由诺姆 state 决定，可能是连续量；
  - b) `exSpecialNecessaryTime(cfg, exForTime, ultForTime, prevStates[i])` 对 prevStates 的依赖（`core/resource/helpers.ts` 约 396–405 行，含 `(prev + new) / 2` 阻尼分支）；
  - c) 模块专属必做动作 `extraNecessaryActionOf(cfg)`。

## 11. 第 170 轮：CC-146 根因定位（未改代码）

探针、插桩日志和 dump 存档在 WSL `/home/kaua/calc-arch/s170/`：`zzS170c.test.ts` 是原测试副本，加了 dump 和插桩开关；`instr-seed.log` 是逐轮估时日志；`dump-c4.json` 是冷启动 / 校准种子的完整结果；`an170.py` 是分析脚本。

### 11.1 复现口径（重要）
- **只有跑完整的全库顺序才复现**。单独跑这一队、或者「先配队再设模式」都不红，因为被测 cfg（`acceptedCall.before`）依赖前面各队在同一 store 上留下的历史。复现时要么临时把缺省常量改成 4 跑原测试，要么用 `s170/zzS170c.test.ts`（放到 `src/` 下、缺省改 4、`S170=1` 开插桩）。
- 第 170 轮曾写过一版改了预设筛选的探针，结果「变绿」，原因没查清，已作废。别再用那种写法。

### 11.2 现象
- 冷启动与校准种子：槽 0（1591 希格莉德）的**物化行逐条相同**，前台都是 97.927 = Σ行；三类次数逐位相同。
- 不同的只有账本字段：冷启动 `necessaryTime` 97.925（≈ Σ行），校准 97.1645（比行少 0.76）；平 A 1.574 对 1.348（槽 0 和槽 1 平分剩余平 A 池，两槽同步变化）。

### 11.3 机理
- 希格莉德的必要时间里含敛枪式时长，来自模块的 `estimateExSpecialTime`（`src/mechanics/agents/sigrid.ts` 的 `sigridChuqiangFromState`）。机会数里有一项 `countBasicFinisherHits(state.basicAttackTime, ...)`（同文件第 195 行），把**上一轮的剩余平 A** 换算成**整数**终结命中数。
- 实测估时是 prevBasic 的阶梯函数：prevBasic ≈ 0.7–1.57 → nec 52.8；1.74–4.62 → 53.584；≥ 5.79 → 54.884。
- 负反馈：剩余平 A 多 → 命中 +1 → 必要时间 +0.784 → 平 A 池变小 → 剩余平 A 少 → 命中 −1。阈值落在 1.574 和 1.966 之间，这个区间里**没有不动点**，内层迭代就在 (b=1.574, nec 52.8) ↔ (b=1.966, nec 53.584) 之间做精确 2-循环。`runInnerLoop`（`src/core/resource/innerLoop.ts`）判稳要求平 A 严格相等，检出环后取字典序最小的成员。不同种子会进入不同的环或相位，所以账本相位随种子变化；而物化行读的是停点 state 的平 A，两个停点的平 A 都在同一档，所以行相同。
- **这不是 physical 引入的**：off 下同一队的校准种子本来就会移动落点（`seedInvariance.test.ts` 第 310 行注释：平 A −0.74 / 必要 +0.39，反向，判为允许）。physical 只是改变了剩余平 A 所在的位置，让两个相位的差变成同向，被判据②拦下。

### 11.4 修法候选与拍板
- **A（推荐，下一轮做）迭代期连续松弛 + 终局取整**：按伊德海莉的先例（`helpers.ts` 的 `(prev + new) / 2` 阻尼，加上 `runFinalizePasses(..., 'tail')` 终局整数化），估时里的 `countBasicFinisherHits` 在迭代期改用实数版（剩余平 A / 段循环时长，按同一个事件模型取连续值），终局 / 物化仍取整数。阶梯变成连续函数后，不动点唯一存在，种子依赖随之消失。
  - 影响：off 下所有剩余平 A 不在整数边界上的希格莉德队，必要时间都会变，所以**不是零差**。需要 zd 全量 + 逐队解释，并重生成 timeGolden / timeFillRatchet。
  - 风险：物化行取整数、账本取实数，会出现 < 1 次命中的差额（≤ 0.784s），要确认 `timeLedgerInvariants`「行 ≤ 账本」不破。
- B「在环里挑自洽成员」：**否决**。实测环里两个成员都不自洽（prev 档 ≠ 停点档），没有可挑的。
- C「改判据②」：**否决**。该用例注释明确写了不许为变绿放宽；而且实际问题（账本相位随种子变化）是真的，只是 off 下恰好反向。
- 本轮不改代码。依据：A 会改变默认口径的数值，需要一整轮做 zd 归因；本轮上下文已大量用于定位。

## 12. 第 171 轮：CC-146 修复（代码 `f848f72c`，off 全库零差）

### 12.1 先试的 A′（估时线性插值）——否决
- 做法：`sigridExSpecialTime` 在相邻命中阈值之间线性插值，把阶梯改成连续函数（物化行不变，行 ≤ 账本，差额 < 一档）。
- zd（tag `cc146a`）：26 个变体条目、5 支 1591 队变化；冷启动探针（5 队 × default/c6/w，15 个变体）显示：
  - 外层 `exit=cycle` 从 3 个增加到 6 个（1161-1311/c6、1571-1211/default、1481-1211/c6 由 stable 变为 cycle）；
  - 内层迭代数从 1–5 涨到 15–42，多处顶到 `oscillatorStop`=20 后返回瞬态；
  - auto-1591-1161-1311/c6 希格莉德 ex 12→11、ult 4→3，伤害 −6.72%（次数真的掉了，不是相位噪声）。
- 结论：连续化让内层从「整数跳变的精确环」变成「慢收敛的几何逼近」，副作用超出门槛，否决。原型备份在 WSL `/home/kaua/calc-arch/s170/sigrid.planA.ts`，未提交。

### 12.2 真正的根因（插桩实测，推翻 §11.3 的一半）
- §11 认为「希格莉德估时阶梯 ⇒ 内层 2-循环，停在哪个相位随种子变」。插桩 `foldLoop` 各 pass 与 `runInnerLoop` 出口后发现：
  - 冷 / 高 / 低种子：pass0 进非噪声 2-环 {b=7.104, 4.6205}，规范取 4.6205，之后 pass1 clean、pass2 进环 {1.966, 1.574}；
  - **校准种子：pass0 clean 收敛到真不动点 b=5.7875**，之后 pass1 进另一个环 {1.348, 1.740}。
  - 两组环的状态 diff 只有派生量（平 A、nec、能量、喧响），没有隐藏携带字段；nec 在间隔 0.78 的三档（≈96.38 / 97.15 / 97.93）上分别占「中–高」与「低–中」。
- 即：同一个确定性迭代映射**同时有不动点和 2-环**，冷种子到不了那个不动点。旧规则 ③「正常收敛（clean）直接接受——不动点唯一」的前提不成立，注入种子把落点带进了另一个吸引子。希格莉德的阶梯只是让共存成为可能，病根在 ③。

### 12.3 修法 ②′（拍板）
- `src/core/resource/foldLoop.ts#runFoldLoop`：pass0 若带注入种子，**一律**从 `defaultSeedStates` 起跑（原 ② 只在种子轨迹非 clean 时重跑）。pass0 停点 = f(默认种子, 映射)，与注入种子在构造上无关；pass>0 起点冷热相同，归纳保持。
- 依据：消灭的是整类问题（任何角色的共存吸引子），不是只修希格莉德；只在 core 层，不含角色判定；不改任何估时口径。
- 影响：
  - zd（tag `cc146e`）**dump / rowsnap 全库 DIFF 0**——off 下所有生产预设本来就走冷路径或注入种子恰好与冷落点相同。
  - 性能：seedInvariance + outerCycleColdStart 两次 A/B，全库档 E 5.98/6.14s vs HEAD 6.01/5.90s，噪声内。热启动在 pass0 本来就几乎不省轮数。
  - 注入的 initialStates 在 `calcTeamResources` 里已**无任何读取点**（只剩 `injected` 标志）⇒ 热启动通道是死输入。清理（删参数与缓存）列为 CC-147，未做：牵涉 composables 的缓存与多个测试入口，另开一轮。
- 测试口径变更：seedInvariance 的「种子通道活性自检」由 `seedPathExercised > 0` 反转为 `=== 0`，钉住 ②′ 的构造保证。反向验证：foldLoop 回到 HEAD ⇒ 精确红（expected 1 to be +0）。判据①② 原样保留（外层 cfg 通道仍可能带种子）。`@fact engine:收敛环停点规范化` 口径同步更新，验证清单加入 seedInvariance。
- 验证：缺省常量临时改 4 跑 seedInvariance ⇒ 绿（CC-146 在 physical 下转绿）；缺省 0 全量 verify 绿；vue-tsc -b 0；get_diagnostics 0。
- 回退点：`foldLoop.ts` 还原为「`let inner = runInnerLoop(st, …)`；非 clean 且 pass0 且 injected 时重跑」，同时把 seedInvariance 那条改回 `> 0`、`@fact` 改回旧口径。
- 已知坑：若以后恢复热启动（为性能），必须同时给出「clean 落点与冷落点一致」的证明或检查，否则 CC-146 复发。

## 13. 第 172 轮：CC-144 切 physical 默认（代码 `71452ad2`）

### 13.1 试切复测
- 缺省常量临时改 4 跑全量：**30 红 / 3784 绿**（第 168 轮 33 红）。A 类不变量（seedInvariance、timeLedgerInvariants）已全部转绿（CC-145、CC-146 生效），calcOutputMemo 已在第 168 轮修好。剩下：C 类基线 3 条（timeGolden 1、timeFillRatchet 2），D 类数值钉 27 条（18 个文件）。日志 WSL `/home/kaua/calc-arch/k172/vitest-default4.log`。
- 曾怀疑 `liuyinAxisGiftSameSource` 闸门（雨果 0 命轴决算行 5→4）是赠行挤出：**不是**。同一用例的「零赠行、零预留」断言都过了；决算行少一条是因为 physical 下物理池只失衡 4 次，轴分窗按 CC-143 读 `countStun` ⇒ 1 块 × 4 窗。hugoVerdictLanding、stunVulnSummary B/D 同因。坑36「轴栈说 5 就必须落地 5」的前提是窗口数 = 5，在 physical 下窗口数本身变成 4，不冲突。

### 13.2 全库变化与归因
- zd（tag `cc144b`）：602 个变体条目变化；`/default` 104 队中 90 队变化 > 0.1%（>+5% 28 队、+1~5% 36、+0.1~1% 10、−0.1~−1% 6、−1~−5% 6、<−5% 4）。
- 逐队归因见 `docs/mcp-cc144-team-deltas.md`：U 76 队（K>P ⇒ 计数通道补上少算的失衡事件 ⇒ 涨）、X 19 队（K>P 但连携真实占前台、挤出更高收益动作 ⇒ 跌）、Z 9 队。**无一队 K<P**；全部变化归到同一个原因：计数通道与伤害侧统一读物理次数。

### 13.3 拍板
- **切默认**：`DEFAULT_STUN_PLAN_PROJECTION_CODE` 0 → 4。依据：§9.4 的切换条件（「某一类解释不通就不切」）现已满足——A 类为空，C/D 类每条都有归因；physical 是单一事实源（伤害侧早就用 floor(N*)），off 是双源。
- 难度阶梯 G4：缺省为 physical 时施加缺省本身（原固定 round），保证阶梯顶点 = 主结果口径；「全关」仍写死 0（旧口径基线，有意为之）。缺省改回 0 时 G4 逐位回到 round。
- C 类：timeGolden、timeFillRatchet 重生成。
- D 类 18 个文件：文件级 `vi.mock('@/core/stunPlanProjection')` 把缺省钉回 0。依据：这些精确值在 off 口径下逐条核实，测的是机制本身；钉回 0 保住原语义。代价：这些机制在 physical 口径下暂时没有精确钉 ⇒ 立卡 **CC-148** 逐条迁移（缺省产出类更新期望并写原因，机制类保持 0 钉但注明）。physical 下的缺省产出由 timeGolden / timeFillRatchet / seedInvariance / timeLedgerInvariants 覆盖。
- 回退点：常量改回 0，重生成两份基线；18 个文件里的 mock 块在缺省为 0 时是空操作，可留可删。
