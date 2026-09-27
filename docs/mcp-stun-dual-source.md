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
- ⚠ **本条归因有误，第 174 轮已更正，见 §15**：实际是外层 2-环下资源行（4）与池 / 轴栈（5）不同源，属 A 类不变量破缺，已由 CC-150 修复。原文：曾怀疑 `liuyinAxisGiftSameSource` 闸门（雨果 0 命轴决算行 5→4）是赠行挤出：**不是**。同一用例的「零赠行、零预留」断言都过了；决算行少一条是因为 physical 下物理池只失衡 4 次，轴分窗按 CC-143 读 `countStun` ⇒ 1 块 × 4 窗。hugoVerdictLanding、stunVulnSummary B/D 同因。坑36「轴栈说 5 就必须落地 5」的前提是窗口数 = 5，在 physical 下窗口数本身变成 4，不冲突。

### 13.2 全库变化与归因
- zd（tag `cc144b`）：602 个变体条目变化；`/default` 104 队中 90 队变化 > 0.1%（>+5% 28 队、+1~5% 36、+0.1~1% 10、−0.1~−1% 6、−1~−5% 6、<−5% 4）。
- 逐队归因见 `docs/mcp-cc144-team-deltas.md`：U 76 队（K>P ⇒ 计数通道补上少算的失衡事件 ⇒ 涨）、X 19 队（K>P 但连携真实占前台、挤出更高收益动作 ⇒ 跌）、Z 9 队。**无一队 K<P**；全部变化归到同一个原因：计数通道与伤害侧统一读物理次数。

### 13.3 拍板
- **切默认**：`DEFAULT_STUN_PLAN_PROJECTION_CODE` 0 → 4。依据：§9.4 的切换条件（「某一类解释不通就不切」）现已满足——A 类为空，C/D 类每条都有归因；physical 是单一事实源（伤害侧早就用 floor(N*)），off 是双源。
- 难度阶梯 G4：缺省为 physical 时施加缺省本身（原固定 round），保证阶梯顶点 = 主结果口径；「全关」仍写死 0（旧口径基线，有意为之）。缺省改回 0 时 G4 逐位回到 round。
- C 类：timeGolden、timeFillRatchet 重生成。
- D 类 18 个文件：文件级 `vi.mock('@/core/stunPlanProjection')` 把缺省钉回 0。依据：这些精确值在 off 口径下逐条核实，测的是机制本身；钉回 0 保住原语义。代价：这些机制在 physical 口径下暂时没有精确钉 ⇒ 立卡 **CC-148** 逐条迁移（缺省产出类更新期望并写原因，机制类保持 0 钉但注明）。physical 下的缺省产出由 timeGolden / timeFillRatchet / seedInvariance / timeLedgerInvariants 覆盖。
- 回退点：常量改回 0，重生成两份基线；18 个文件里的 mock 块在缺省为 0 时是空操作，可留可删。

## 14. 第 173 轮：CC-148 前 3 个文件迁 physical（`4fb7431a`）+ 新发现 CC-149

去掉文件级 mock 后 physical 缺省下 6 红，逐条处置（**无一条放宽容差**）：

| 文件 | 红 | 性质 | 处置 |
|---|---|---|---|
| outerCycleColdStart | 4（C0/C1 整数档） | 用户实测场景在 off 下核实的整数档 | 4 条用例经夹具 `setupYsgTeam(c, 0)` 显式钉 off；新增 describe「physical 缺省」3 条：结构判据（stable、整数、分项闭合、照影 = floor(剑势/6)、短轴多一轮）+ 现值 |
| teamTimeSummary | 1（账本虚高恒等式） | **测试恒等式不完整**：实现定义 `ledgerInflation = requiredFrontline − necRows − 模块行超出部分`，测试漏了最后一项（off 下该队恰为 0，physical 下 0.489s = 差额） | 补全恒等式 |
| difficultyDescent | 1（单因素闸门） | 该用例复现的是 off 下的历史反转；physical 下对照组复现不了 | 用例内显式钉 off；physical 下的单调破缺立 CC-149 |

physical 下叶瞬光+琉音+照（1 精专武）实测（探针 WSL `/home/kaua/calc-arch/k172/zzY173.test.ts`）：C0 满轴 10 = 喧响 2 + 转大 4 + 照影 4（off 为 2/3/5），剑势 30.38→29.90 刚好跌破第 5 次照影门槛；交互档 0.5→0.0625（该队 physical 真实溢出，§7.1）；C0 axis1/axis2 = 11/12；C1 满轴/仅灭短轴 = 11/12。**用户口径「C0 = 10 次白毛」在 physical 下总数仍成立。**

**CC-149（新发现，真实缺陷，小）**：physical 缺省下该队的难度曲线沿合轴率单调性破缺。冷启动最大可行交互档随合轴率 0.4 / 0.3 / 0.2 = 0.0625 / **0.125** / 0.0625（不单调）；闸门把 0.3 档压回 0.0625 后，同交互档下剑势 29.90→29.97、伤害 26600186→26616874（+0.06%）——用户口径「合轴降低 ⇒ 伤害不升」被破。探针 `k172/zzD173.test.ts`（顺序跑）与 `zzD173b.test.ts`（冷启动）。

**坑**：`npm run verify` 不拦 TS6133（未使用的 `vi` 导入），删 mock 块后必须同时删 `vi` 导入并单独跑 `npx vue-tsc -b`。

## 15. 第 174 轮：CC-150 physical 外层 2-环的池同源（代码 `e2057bd3`）+ 更正 §13.1

### 15.1 发现
迁 CC-148 的雨果系三个文件时，`hugoVerdictLanding` 的 `poolCount ≥ 5` 在 physical 下**通过**、决算行却是 4——与 §13.1「physical 下只失衡 4 次」矛盾。探针（WSL `/home/kaua/calc-arch/k174/zzH174.test.ts` + 插桩 `instr174.py`，已还原）：

| | off | physical（修前） |
|---|---|---|
| 外层退出 | stable | **cycle** |
| 逐轮 读入物理次数 → 池 | 5→5 稳定 | 5→4、4→5、5→4 交替 |
| 池 / 轴栈决算 / 资源行决算 | 5 / 5 / 5 | **5 / 5 / 4** |

规范成员 = 「读入 4、池 5」那轮：引擎按 4 分配时间与计数（hugo 决算读 `threads.prevPoolStunCount` = 4），池与下游轴栈 / 伤害侧读 5。**同一结果两个来源，坑36 同源不变量破**。§13.1 把它当成 D 类数值钉是误判（当时只看了断言值，没对照池）。

### 15.2 修法与拍板
- 整数映射 f(5)=4、f(4)=5，无不动点（与 CC-146 同类）。取**最大自洽可行整数** K：按 K 分配时池撑得住 ≥ K（这里 K=4）。第 K+1 次没有分配时间，不兑现。
- `src/composables/resourceCalc/solveTeam.ts#runOuterLoop` 出口：physical 且 `outerExit === 'cycle'` 且规范成员池 > 读入（= `outPrev.stunPool.stunCount`）时，报告池钳到读入值，派生字段由新函数 `src/core/stunPool.ts#withStunCount` 重算（返还值、总连携、喧响奖励）。池、轴栈（`stackTraversalResult` 读 `stunPoolResult`）、伤害侧随之同源。
- 未处理的一侧：「池 < 读入」（引擎多分配了窗口）不钳，留作残差；现行 pickCanonical 在本例已选可行成员。
- 影响：zd `cc150` 全库仅 2 个变体条目变化（`auto-1201-1361-1211/c6`、`auto-1201-1361-1311/w`），伤害 0.000%，只有失衡哈希变。hugo-c0-e 是轴预设，不在 zd 队列里：physical 下决算 5→4（池 5→4）。
- 时间基线（冷启动，与 zd 顺序跑路径不同）：只有失衡次数变、伤害与时间量零变化——timeGolden 5 条（yixuan-jufufu-lucia 4→3、agent:1301 c3/c4 2→1、agent:1391 c5/c6 4→3），timeFillRatchet 4 条（auto-1091-1511-1211、auto-1091-1511-1311、auto-1021-1481-1341、auto-1191-1481-1311 均 3→2），已重生成。均为外层 2-环下报告池由 K+1 钳到读入 K。
- 回退点：删 `solveTeam.ts` 的 CC-150 块、`withStunCount` 与其 import。

### 15.3 测试（CC-148 雨果系 3 个文件）
- hugoVerdictLanding：原用例显式钉 off（精确值 5）；新增「physical 缺省：池 == 轴栈 == 资源行」（现值 4）。
- stunVulnSummary：案例 B/D 为 off 冻结快照，夹具显式钉 off。
- liuyinAxisGiftSameSource 闸门：`决算 == 5` 改为 `决算 == 轴栈决算`（坑36 的原意，模式无关，且更强）。
- 反向验证：钳位条件改 `false &&` ⇒ 恰好新 physical 用例与琉音闸门 2 条红；恢复后 18/18。

### 15.4 教训（已写进 CC-148 规程）
迁移时每条红先问「断言比较的两边是不是本应同源的两个量」——是，就按不变量处理（查机理），不是口径值。只看断言值会把不变量破缺误分为数值钉（§13.1 的错误）。

## 16. CC-151 锁定失衡次数被 physical 绕过 + CC-148 收尾（第 175 轮，`4ca262f1`）

### 16.1 CC-151（真缺陷）
- 现象：`enemy.stunCountLock ≥ 0`（锁定失衡次数）时，physical 缺省下 `countStun` 仍读池的物理次数，锁定值被绕过。adjustableEffect 中 lock=3 与 lock=4 算出的连携数相同（都是 4）。仪玄 `lock:3`（mechanicSettingsEffect）、normaSmoke、damagePoolNightA 同源红。
- 依据：锁定的语义是「stunCount 为固定输入，计数一律用锁定值」，命座对比页的 cinemaUplift 依赖这一口径。physical 投影本身会改写计数，两者不能同时生效。
- 修法：`src/composables/useResourceCalc.ts` 读 `stunPlanProjection` 处，**锁定且投影为 physical** 时回落为 `'off'`（计数即锁定值）；其他投影（round 等）作用于锁定值本身，照常生效。
- 首版修得过宽（锁定一律强制 off），全量 verify 里 lycaonC2Contract「lock 3.6：off 用实数、round 用投影值」红，说明「锁定 + round」有明确契约，于是收窄到只处理 physical。
- 影响面：预设和数据里都不设 `stunCountLock`，zd 队列与两份时间基线**按构造零变化**（只走未锁定分支），全量 verify 基线未动。
- 回退点：删掉 IIFE 里的锁定判断。

### 16.2 CC-148 收尾（18/18 审完）
- 删 mock 后在 physical 下全绿、已迁移：damagePoolNightA、mechanicSettingsEffect、normaSmoke（依赖 16.1）；以及前几轮的 6 个文件。
- adjustableEffect：只在「17 条滑块接线」用例内显式钉 off（1351 援护狩猎增益随失衡计数变：off 5 / physical 8；该用例测接线，不测计数），其余用例在 physical 下跑。
- 8 个文件恢复文件级 off 钉，注释写明为机制钉，逐条理由：
  - convergenceNightD「保底4喧响+般岳 补齐量精确值」：parry 12 是 off 场景下的精确补齐量（physical 为 3）。
  - damagePoolBatchR17c / R18d：叶瞬光 stunMult 成对值、帷幕封顶 3 条、雨果 [2,4]，都是 off 下录制的精确锚点。
  - damagePoolDefDown「异放行吃减防」：需要存在异放的场景。physical 下以太触发 13→12，唯一一次颤音异放掉档（1→0），离散门槛事件，不是通道缺陷。
  - moduleAnomalyEventRecords r0：EXPECTED 为 off 快照。
  - timeWeightAllocation ⑤：依赖「均衡把失衡 4→3」这一 off 场景。
  - nextRoundFeedback 露西 C6：58 是「有钩子 58 / 摘钩子 30」的反向验证锚点（physical 为 60）。
  - potentialAxisBatchB②「端到端同向」：见 16.3。
- 没有任何用例放宽容差或改期望迁就。细化为逐用例钉 = CC-152（可选，低优）。

### 16.3 X 类发现：潜能更高、伤害反而更低
physical 下莱卡恩潜能 VI 比潜能 I 总伤低 0.002%。机理：冲击力更高 → 物理失衡次数更多 → 连携挤占前台时间。这是离散次数带来的真实取舍，不是缺陷；面板比值断言照常通过。端到端同向断言只在 off（连续规划）口径下成立，所以文件钉 off。

## 17. CC-153 外层环「池 < 读入」一侧：不可行成员不参选（第 176 轮，`d2c89e1e`；CC-150 残差闭合）

### 17.1 扫描（冷启动与暖序各跑一遍 104 队，结果一致）
- 出口为 cycle、且规范成员「池 < 读入」的队只有 **yixuan-trigger-lucia**：读入 4 → 池 3；资源行仪玄连携 1371013 = 4，池 / 轴栈 = 3，同源破。
- 其他环队：yixuan-jufufu-lucia 为「池 > 读入」，已由 CC-150 钳位；auto-1541-1511-1411 环内次数恒为 3（在环的是别的量）。
- 扫描方法：在 solveTeam 出口前临时插一行 `globalThis.__cc150` 记录（带 ZZTMP 标记，扫完 `sed -i '/ZZTMP/d'`）。探针在 `/home/kaua/calc-arch/k175/`：zzS176（暖序）、zzS176b（冷启动 + 执行行导出）、zzH176（zd heavy 变体）、zzK176（棘轮 setAgent 路径）、zzJ176（resourceResult 全量对比），配套 jd.py、zdcmp.py（`python3 zdcmp.py <zd tag>`）。

### 17.2 修法（纯函数 `outerCycle.ts#pickOuterCycleMember`，solveTeam 只负责算入参）
- **⓪″ 不可行成员不参选**：成员新增可选字段 `feasible`。physical 下取 `池 ≥ 读入`，其中读入为 `m.prev.stunPool.stunCount`，即 `threads.prevPoolStunCount`。有可行成员时剔除不可行成员，全员不可行时照旧参选。依据和 CC-150 相同：取「按 K 分配时池 ≥ K」的最大自洽整数。
- **⓪ 零窗判据的窗数改用读入物理次数**：成员新增可选字段 `windowsIn`，physical 下取读入 K，判据变为 `(windowsIn ?? stunIn) ≥ tol.stun`。实测 auto-1401-1511-1411 的可行成员读入 2 次，规划 stunIn 只有 0.015，被⓪误判为零窗剔除，结果仍落在不可行成员上。physical 下引擎按 K 分配窗口，规划值不代表窗数。冷启动读入为 0 的瞬态成员仍按零窗剔除（有单测）。
- 非 physical 下两个字段都不传，逐位零影响。
- 走过的弯路（勿重复）：
  - 第一版在 solveTeam 里先裁剪成员表再传给纯函数。这样 index 和 pickedEarlier 都变成相对子集，outerCyclePick 接线测试红（长环成员数 ≥3 → 2）。
  - 放进纯函数后，pickedEarlier 沿用原约定「过滤掉任何成员即 true」。
- 回退点：删掉⓪″过滤，并把⓪的 `windowsIn ??` 去掉；solveTeam 中 `feasible` / `windowsIn` 两个入参随之删除。

### 17.3 影响面（逐条已解释）
- zd（`/home/kaua/calc-arch/zd-cc153c.out`）：
  - yixuan-trigger-lucia default / c0：伤害 63.91M → 57.47M（−10.08%），连携 4→3 同源。
  - yixuan-jufufu-lucia heavy / heavyGate：66.55M → 77.74M（+16.81%）。基线落在不可行成员（读入 4 → 池 3，资源行连携 4、伤害侧失衡 3），修后落在自洽成员（读入 4 → 池 4）。伤害上升，是因为原来按 4 窗分配了时间，伤害侧却只结算 3 窗。
  - auto-1201-1361-1311/w：伤害与池零变化，只有 `convergence.outerCyclePickedEarlier` 由未设置变为 true。选中成员不变，⓪″剔除了一个本来就会输的成员，按约定记 true（用 zzJ176 实测对比 resourceResult，唯一差异就是该字段）。
- timeGolden：只有 yixuan-trigger-lucia 变。连携 4→3，1 号位强化特殊技 5→6，留白 1.133→2.267，伤害 63.63M→63.17M（golden 路径配置与 zd 不同）。已重生成。
- timeFillRatchet：auto-1091-1511-1411 留白 1.7→6（同源修正：连携 3→2 = 池 2，伤害 +7.0%）；auto-1401-1511-1411 留白 6→2（⓪误判修正：连携 3→2 = 池 2，伤害 +14.3%）。已重生成。棘轮基线的旧值受 warm-start 缓存的路径依赖影响，单跑探针的数值见 zzK176。
- 回归：新增 `outerCyclePhysicalFeasible.test.ts`，2 条同源不变量（池 == 轴栈 == 资源行 / 每人连携 == 池），各自做过反向验证。outerCycle.test.ts 新增 4 条纯函数用例。

### 17.4 教训：physical 口径下读规划值的判据是一类系统性缺陷
CC-151（锁定路径读池次数）和 17.2 的⓪（零窗读规划值）是同一类问题：**physical 下计数来自物理次数，但判据仍读规划值（或反过来）**。这类问题逐个撞见效率太低，登记 CC-154 做一次全量审计，见卡表。

## 18. CC-154 physical 下模块读计划值当次数：applyTeamConfig 与 axis.windows 改走计数通道（第 177 轮，`a0860502`）

### 18.1 审计（三组读点；原始明细 `/home/kaua/calc-arch/k177/audit-agents.md`，共 257 行，由子代理 dsflash 产出、lead 复核）
判据：读的是计划值 `stunCount`（或由它派生、或由它分配的 `axis.windows`），用途却是**计数**。physical 下计划值可以远小于池物理次数（例如 0.71 对 2），这类读点会系统性少算。
- **A. applyTeamConfig 入参 `stunCount`**（converge 与 postRound 两个派发都透传计划值）：违约读点 15 组，涉及 anby 183、corin 172、ellen 259、lycaon 238（失衡项）、nangong 168–407、norma 140/155/312/491、qingyi 191/197、sigrid 256/303、specPanelBuffs 128/134/176、xixifu 83/102、yaojiayin 210/237、yidhari 168–415、zhendou 139、starlightBilly 305/640。
  - 合规对照：lycaon 231 读 `countStun`，hugo 363 读 `prevPoolStunCount`，liuyin 631 读池物理次数，helpers 246/402/605 读 `countStunOf`。
- **B. `axis.windows`**（convergence.ts `allocateAxisWindows(resolvedAxes, stunCount)`）：同一快照里 `actionCountsBySlot`、`chainTotal`、`ultimateTotal` 已经走 `countStun`，只有 windows 用计划值，**快照内部口径不一致**。7 个计数读点：harumasa 230、nangong 190、sigrid 265、starlightBilly 286、yidhari 423、yixuan 461、zhuYuan 120。
- **C. 编排层**：convergence.ts 338–342（轴 60/90 转大次数）、982（失衡内异常 v2 代表窗数）、1078（线程 stunsTotal）。三处都不经过模块契约，改动面和验证方式都不同，**拆到 CC-155**。
- 待判：zhendou 141 只写不读（死写）；lycaon 187/290 计数与时间混用；覆盖率派生（时间）再折成次数的间接影响面，随 A/B 修复一起生效。

### 18.2 方案 C（选定）
- 做法：convergence.ts 三处由 `stunCount` 改为 `countStun`，即 converge 派发、postRound 派发和 `axis.windows`；types.ts / typesHooks.ts 契约注释同步说明「模块拿到的 stunCount 就是计数通道值」。off 口径下 countStun 与计划值相同，逐位零差。
- 为什么不逐个模块改：15 组加 7 个读点逐个换成 countStun，是在调用方分散打补丁，以后新增模块还会再犯。在派发处统一，契约只剩一个口径（更简单、更通用）。需要时间口径的模块仍可读 `plannedStunCount` 等时间账字段（§4.4 口径不变：计数通道读物理次数，时间账读规划值）。
- 否决的方案：A 为逐模块替换（理由同上）；B 为在契约里新增 `countStun` 字段，让模块自选，这会让契约里有两个都叫「失衡次数」的字段，模块仍可能读错。
- **回退点**：把三处 `countStun` 改回 `stunCount`（每处都有 `CC-154` 注释），再用 TIME_GOLDEN_UPDATE / TIME_RATCHET_UPDATE 重生成两份基线，第 177 轮修订的 8 个测试文件一并 revert。

### 18.3 逐处还原定位（临时开关 ZZ_A / ZZ_W / ZZ_P，带 ZZTMP 标记，已删除）
全量测试 12 条红，逐处还原后归因如下；每条都已按「是修复带来的正确变化」或「夹具前提失效」处理，**没有为了变绿而改判据**：
- **雅 C2 滑块（readFrost）**：不是滑块缺陷。C 项为 ⌊平A时间/2⌋ × C。physical 下青衣醉花轮数按物理次数计算后，青衣必要时间从 42s 增至 55s，雅的平 A 时间从 5.8s 降到 3.5s；RICH 配装下平 A 小于 2s，C 项恒为 0，测试失去区分力。处置：readFrost 夹具钉 off，逐条补夹具前提断言（⌊平A/2⌋ > 0、强特 > 0）。
- **archiveDeployStun**（归档 72db6dc3，1371+1481+1451）：该队规划失衡为 0。修前 windows 分到 0 窗，块计数却按物理 4 次，快照自相矛盾，轴退化，池 4，伤害比 66.6%。修后轴保住，伤害比 75.4%，N* = 3.84，池 3，即弹刀 8 次预算内保底 4 不可达。处置：测试钉 off，保底是否应上报用户另开 **CC-156**。
- **outerCyclePhysicalFeasible**：现值改为 3。
- **lycaonC2Contract**：round 期望 60，即 (4+8)×5。原先连携项读 countStun、失衡项读计划值的不对称已取消。
- **adjustableEffect 振斗**：录制值改为 0/500/1000（影画6 炽心来源 75×失衡次数，改读计数通道）。
- **dynamicComboAlign ③**：旧判据「≤20 支」只是计数上限，没有语义，改为逐队检查「溢出量 > 0」这一不变量。实测吸收队 23 支；「≥5 支」和「包含 1371-1481-1451」两条保留。
- **outerCyclePick**：setupYixuanPreset 钉 off（physical 下该队变成 2-环，不再有长环，而该测试针对的是长环接线）。
- **yixuanSmoke**：队友终结 [3,3]→[3,4]，队友终结闪能 120→140（7×20）。自动 3 连一条：青衣必要时间增加，再次触发降配，有效弹刀 6→5，#2 行同步 5。

### 18.4 影响面
- 原型 zd（只改 converge 一处）：default 变体 49/104 队变化，范围 −6.64% 到 +13.51%（`/home/kaua/calc-arch/zd-c154.out`）。
- timeGolden 重生成：415 条中 119 条变化，其中 111 条伤害变化，范围 −4.45%（yidhari-qingyi-lucia）到 +16.95%（auto-1371-1251-1451）。
  - 降幅前 4：yidhari-qingyi-lucia −4.45、yixuan-trigger-lucia −2.46、auto-1051-1141-1451 −1.20、yixuan-roxy-lucia −1.06。
  - 升幅前 5：auto-1371-1251-1451 +16.95、agent 1511 c6 +15.11、banyue-qingyi-lucia +12.01、auto-1591-1481-1211 +9.52、auto-1511-1561-1411 +9.04。
  - 解释：升幅队都含南宫羽（1511）、青衣（1251）或希格莉德（1591），正是 §18.1 A 组里被少算次数的模块（physical 下物理次数大于计划值，计数随之上调）。
    - 降幅 4 队中 3 队含青衣或仪玄，推测是醉花轮数与电压需求改按物理次数后，必要时间增加，挤占主 C 前台时间。
    - auto-1051-1141-1451 含莱卡恩，推测与影画2 失衡项改读计数通道有关。
    - 以上降幅归因**未逐队插桩验证**。§17.3 已说明，伤害升降不能用来判对错。
- timeFillRatchet 重生成：19 队变化，其中留白增加 12 队、减少 7 队，**超预算新增 0 队**。留白增加的 12 队中，含伊德海莉 5 队、仪玄 3 队、南宫羽 3 队、青衣 1 队（推测都是计数上调后必要时间增加，未逐队验证）；绝对不变量测试仍为绿。
- 对比脚本：`/home/kaua/calc-arch/k177/basecmp.py`（对比 HEAD 基线与工作区基线，提交前运行）。

### 18.5 新开卡
- **CC-155**：编排层 3 处计数读计划值（convergence.ts 338–342、982、1078），方法同本节，逐处还原定位。
- **CC-156**：archive 保底不可达（弹刀预算内达不到用户填写的保底失衡次数）目前被静默降级。是否应上报用户（诊断或提示），待定。复现：archiveDeployStun，physical 口径。

## 19. CC-155 编排层 3 处计数读计划值 → 计数通道（第 178 轮，`d030a2ff`）；新发现 CC-157

### 19.1 改动（convergence.ts，每处带 `CC-155` 注释；off 口径下 countStun ≡ stunCount，逐位零差）
- **约 342 行，轴模式琉音赠大 `promoteHugCountsOf(...)` 的连携窗口数**：`stunCount` 改为 `countStun`。
  - 旧注释说「计划值与核心侧 promoteFixpoint 入口同源」，已不成立：promoteFixpoint 按池的 `pool.stunCount` 推导窗口（ultimatePromote.ts 约 322–333 行），CC-144 缺省 physical 以后，池给出的就是物理次数。注释已同步改写。
- **约 986 行，失衡内异常 v2 代表窗分配** `allocateAxisWindows(resolvedAxes, Math.round(countStun))`。
- **约 1082 行，Boss 异常状态 `stunsTotal`**（结算端按条目失衡数加权取样事件次数）改为 `Math.round(countStun)`。
- 回退点：三处改回 `stunCount`；两份基线用 TIME_GOLDEN_UPDATE / TIME_RATCHET_UPDATE 重生成。

### 19.2 逐处定位（338 行临时环境开关 ZZ_H，带 ZZTMP 标记，已删除）
- **986 / 1082 两处**：zd（tag c155v，`/home/kaua/calc-arch/zd-c155v.out`）DUMP 和 ROWS 都是 **DIFF 0**（104 队 × 变体），timeGolden / 棘轮也零变化。结论：在现有预设上属纯同源修正，只影响后续口径。
- **342 行（琉音赠大）**：zd（tag c155all）共 7 条变化，都是含琉音 1481 的队：
  - auto-1051-1481-1451：default / c0 +2.22%，w +2.59%，**c6 −9.15%**；
  - auto-1591-1481-1311：default / c0 +0.49%，w +0.37%。
- 探针 `/home/kaua/calc-arch/k178/zzH178.test.ts`（timeGolden 的 applyTeamPreset 路径）与 `zzI178.test.ts`（zd 的 applyTeamToStore 路径，含 c0/c6）结果：
  - 三队（1591-1481-1311、1591-1481-1211、1531-1481-1451）**规划失衡为 0，池却为 3–4**。旧代码按 0 个连携窗口给琉音赠大定预算，同一快照里池却发生了 3–4 次连携，自相矛盾，与 §18.3 archiveDeployStun 同类。修后主 C 终结技 7→8（1531 队 7→9），与池同源。
  - **1051-1481-1451 c6 下降 9.15% 是对的**：旧代码规划为 0、池 3，并且**已超预算 0.867s**，伤害按时间上放不下的动作结算。修后池 4，触发轴回退（axisFallback），超预算消除（留白 +2.155s），1051 特殊技 35→31，连携 3→7。
- timeGolden 重生成：3 条变化，都含琉音。
  - auto-1051-1481-1451：留白 1.326→2.805，1051 EX 10→9、终结 7→8，伤害 +0.49%；
  - auto-1531-1481-1451：池 3→4，超预算 0.574→0，轴回退 scale 0.5，伤害 +1.56%；
  - auto-1591-1481-1311：终结 7→8，**留白 0.751 → 超预算 1.665**，伤害 +1.58%（见 CC-157）。
- 棘轮重生成：3 队变化。
  - auto-1531-1481-1451：留白 6.1→11.7；
  - auto-1591-1481-1311：留白 0.3→1.8；
  - auto-1591-1481-1211：**超预算 0→0.5**（见 CC-157）。
- 全量测试除两份基线外无其他失败（3821 通过，3 条基线红，重生成后见 verify）。

### 19.3 新发现 CC-157：琉音赠送的终结技没有进入时间预算（**⚠ 第 179 轮更正：此推测是错的，见 §20**）
- 证据：auto-1591-1481-1311 修后主 C 多 1 次终结，必要时间 +2.406s，留白从 +0.751 变为 −1.665；但 `convergence.timeBudgetIdleSeconds` 前后都是 0.766，**没变**。
- 旧代码下已有同类现象：auto-1531-1481-1451 超出 0.574s，而 timeBudgetIdle 为 27.9s；1051-1481-1451 c6 超出 0.867s。
- 推测：赠大加出的终结技行是在时间预算器之后物化的（ultimatePromote / tailPipeline 赠行）。时间预算器看不到，所以超预算无法被降配吸收。
- 本轮决定：**不在 CC-155 里修**。CC-155 只让计数同源，它把这个既有缺陷多暴露了 1–2 个队，没有制造新缺陷。两份基线如实记录现状（超预算写进基线），由 CC-157 修复后回收。
- 回退点：若判定 CC-155 暴露出的超预算不可接受，可单独回退 342 行（986/1082 零影响，可以保留）。

## 20. CC-157 结案：不是缺陷，是轴模式 2s 设计容差内的量化残差（第 179 轮，无代码改动；**更正 §19.3**）

### 20.1 §19.3 的推测是错的
§19.3 推测「琉音赠送的终结技没进入时间预算」，依据是 `timeBudgetIdleSeconds` 前后不变。这个依据读错了字段：idle 只记录负溢出（账本 > 物化行）的最大值，和「是否超预算」无关。
- 探针 `/home/kaua/calc-arch/k178/zzJ179.test.ts`（applyTeamPreset 路径）输出 teamTimeSummary 的四项闭合分解：`slack = ledgerInflation + basicUnspent + poolResidual + comboAlignDeduction`。
- auto-1591-1481-1311 在 CC-155 之前 / 之后：
  - slot0 账本 `necessaryTime` 106.037 → 108.443，物化必要行 53.646 → 56.062（+2.416）。**赠大终结技进了账本，也进了行**（ultimateGiftOf 四处同源成立）。
  - ledgerInflation 0.802 → 0.792，几乎不变。
  - **poolResidual = 180 − Σ必要 − 平A = −0.051 → −2.457**：必要时间之和本身超出预算，平 A 已为 0。
- 所以超预算来自「整数次终结技（一次约 2.4s）装不进剩余时间」，是量化问题，不是赠行漏记。

### 20.2 为什么没被截断或回退（均为设计）
- 核心 iterate（`core/resource/helpers.ts`，rawScale 一行）：`!axisMode && Σ吸收后必要 > 预算` 时才做可行化封顶，**轴模式不封顶**，由编排层负责。
- 装配截断（`assembleSlot.ts#truncateExecutionsToFrontline`）的上限是每槽自己的账本，行 ≤ 账本就不截。
- 编排层 `solveTeam.ts#stageResolveFeasibility` 的轴回退判据：`净占用 > 有效时间 + AXIS_FALLBACK_TOLERANCE_SEC`，其中 `AXIS_FALLBACK_TOLERANCE_SEC = 2`，注释说明为「收敛后仍留约 2s 合轴可覆盖的量化残差（与 timeLedger 测试口径一致）」。
  - 1.665s 与 0.5s 都 < 2s，按设计不回退。
  - auto-1531-1481-1451 修后超过 2s，于是触发了回退（§19.2），说明判据在工作。
- 全库复核：timeGolden 415 条中 over > 0 的有 10 条，**最大 1.665s，全部 ≤ 2s**。棘轮的绝对不变量测试为绿。

### 20.3 决定
- CC-157 **不做**（设计内）。基线里的 over 如实保留，不是待回收的债。
- 顺带记录，**不改**：非轴降配用 `TIME_BUDGET_TOLERANCE_SECONDS = 1`（core/resource.ts），轴回退用 `AXIS_FALLBACK_TOLERANCE_SEC = 2`（solveTeam.ts），两个容差并存。
  - 统一成一个会改变行为：轴队在 1–2s 区间会改为回退，丢掉轴。
  - 这是口径问题，没有架构收益（常量只是少一个），不做。若日后要统一，从 solveTeam.ts 第 78 行入手，并重生成两份基线。
- 教训（写进交接已知坑）：用 `timeBudgetIdleSeconds` 判断「预算是否看见某行」是错的，要用 teamTimeSummary 的四项分解。

## 21. CC-149 定位完成：降配相对臂③否决了绝对可行档；修复被叶瞬光账本虚高阻塞 → CC-158（第 179 轮，**未合入代码**）

### 21.1 现象（当前 HEAD 仍复现）
- 探针为 `k172/zzD173b.test.ts` 的扩展版 `/home/kaua/calc-arch/k179/zzD179.test.ts`：叶瞬光 + 琉音 + 照，1 精专武，formAxis 0，physical，闸门开，逐个合轴率冷启动。
- 合轴率 0.5 / 0.4 / 0.3 / 0.2 / 0.1 时，最大可行交互档为 0.125 / **0.0625** / 0.125 / 0.0625 / 0.0625，呈锯齿。
- 同一交互档下伤害逐位相同（0.125 档 26715938，0.0625 档 26600186），合轴率只通过选档影响伤害。

### 21.2 根因（solveTeam.ts `stageResolveFeasibility` 降配试算回调，临时 ZZTMP 日志，已删）
- 合轴率 0.4 时，0.125 档的试算：净占用 173.049 < 180，截断 0，**绝对可行**。但它被拒了：
  - HEAD 写法是 `feasible = accepted && downscaleTrialFeasible(...)`，绝对可行被相对三臂门控；
  - 第③臂「试算留白 ≤ 基线留白 + 1s」：试算留白 6.951，基线留白 3.627，上限 4.627，不通过；
  - 于是落到 0.0625 档（净占用 180.208）。
- 基线态截断 52.645s，它的「留白」是截断之后的残量，不代表真实余量。
- 合轴率 0.3 时基线留白 1.925，0.125 档留白 1.011，通过。锯齿由此产生。
- 这与 feasibilitySearch.ts 的 `@fact engine:降配搜索/绝对可行优先`（两层字典序：绝对可行优先，相对臂只是兜底）不一致。推导：绝对可行意味着臂①②必然满足，所以差别只在臂③。

### 21.3 尝试的修复（已回退；补丁全文 `/home/kaua/calc-arch/k179/cc149-attempt.diff`，共 61 行）
- 代码（solveTeam.ts 试算回调）：
  ```ts
  const feasible = downscaleTrialFeasible({ trialNet: netOf(trial), trialTruncation, stunEffTime, toleranceSeconds: TIME_BUDGET_TOLERANCE_SECONDS })
  const accepted = feasible || (acceptsTrial(trial) && trialTruncation <= TIME_BUDGET_TOLERANCE_SECONDS)
  ```
  另外把 feasibilitySearch.ts 中 `DownscaleOutcome.feasible` 的注释改为「feasible ⇒ accepted（调用方约定）」。
- 效果：
  - CC-149 队的 physical 冷启动曲线变为 0.25/0.125/0.125/0.125/0.0625（合轴率 0.6 到 0.2），锯齿消失。
  - difficultyDescent 单因素用例去掉 off 钉后通过：闸门开时伤害 26.767→26.716→26.600→26.360→25.556M，严格下降；闸门关时仍复现 0.2→0.1 回升。
- **全库副作用（拒绝合入的原因）**：
  - timeGolden 4 条变化：
    - agent:1431:c6 +18.78%，留白 1.3→6.7；
    - agent:1431:c4 / c5 −0.13%，留白 1.3→8.3；
    - **preset:auto-1431-1341-1311 −8.34%，留白 0→9.444**。
  - 棘轮：auto-1431-1481-1341 留白 0→7.9。
  - outerCycleColdStart「S3 真实溢出降配」现值 0.0625→0.125。
- auto-1431-1341-1311 的四项分解（探针 `k179/zzJ179.test.ts`，`ZZ_IDS=<队>`）：
  - 修前：ledgerInflation 1.302，slack −0.122；
  - 修后：**ledgerInflation 18.889**，slack 9.444，idle = refund = 9.444，poolResidual −9.444；
  - slot0 叶瞬光账本必要时间 143.465，实际物化行 81.702 + 42.875 = 124.577。
- 结论：更大的交互档让**叶瞬光模块的必要时间估算比物化行虚高约 19s**，refund 又冻结，回填不了，全部变成留白。第③臂拦的其实是这个虚高，只是拦的理由（与截断后的基线比较）不对。

### 21.4 决定
- **不合入**。原因：直接合入会让 1 个预设伤害 −8.34%、留白 +9.4s，它用一种错误（选档）换出了另一种错误（账本虚高）的暴露。
- 先修 CC-158（叶瞬光账本虚高），再重新应用 §21.3 的补丁（`git apply /home/kaua/calc-arch/k179/cc149-attempt.diff`）。届时预期虚高消失，第③臂不再有东西可拦，两层字典序与实现一致。
- CC-149 状态改为「阻塞于 CC-158」。difficultyDescent 用例仍钉 off（未改）。
- 回退点：本轮无代码改动，无需回退。
