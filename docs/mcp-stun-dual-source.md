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

## 22. CC-158：折叠残差「只增不减」+ 收敛判据只看正溢出 ⇒ 正反馈模块账本虚高（第 180 轮定位，**第 181 轮合入**，见 §22.5）

### 22.1 机理（探针 `/home/kaua/calc-arch/k180/zzK180.test.ts`，在 foldLoop 与 yeshuguang estimate 中临时加 ZZTMP 日志，已删）
- 叶瞬光的 `estimateExSpecialTime` 与物化共用 `resolveCycle`，**估算本身同源，不是虚高来源**。
- 虚高来自 `core/resource/foldLoop.ts` 的折叠残差 `cfg.timeBudgetExcess`：
  - 正溢出（行 > 账本）用 `+=` 折入，**负溢出从不退回本槽**，只进团队 refund，而 refund 在首轮之后冻结；
  - 收敛判据 `maxExcess ≤ 1e-3` 只统计正溢出。
- 病例（CC-149 补丁下 auto-1431-1341-1311 的试算，叶瞬光剑势来自平 A，属正反馈）的最后两轮：
  - acc = 0：平 A 45.2s，行 188.67，比账本多 +17.804 → 折入；
  - acc = 17.804：平 A 被挤到 0，行 128.893，比账本少 −21.63 → 不退回，maxExcess 为 0，判为「收敛」 ⇒ 账本虚高 18.9s，留白 9.4s。
- 线性近似（行 ≈ 128.9 + 1.323·平A）的真实不动点约为平 A 15.3s、残差 8.2s。迭代 acc' = acc + excess 的收敛条件是模块行对平 A 的斜率 M' < 1（叶瞬光约 0.32）。

### 22.2 补丁（`/home/kaua/calc-arch/k180/cc158-unfold.diff`，54 行，只改 foldLoop.ts）
- 负溢出分支开头：若本槽残差 > 0 且 **−excess > UNFOLD_MIN_SECONDS（1s）**，先退回 `back = min(残差, −excess)`，计入 maxExcess（环继续迭代），剩余部分照旧走贴顶折回或团队 refund。
- 门槛 1s 的由来：不设门槛时，南宫羽 + 格莉丝手写轴（inStunAttribution 夹具）的 1181 槽整数行阶跃使 excess 在 ±0.8s 间 2-循环（acc 6.6↔7.4），被停滞判据截停在中途，留下 2.08s 截断。1s 与 foldLoop 现有的「量化残差约 1s 属合轴可覆盖」口径一致。
- 回退点：补丁未合入，HEAD 就是回退状态。

### 22.3 实测（带门槛版本）
- zd（tag c158b）：624 条中 173 条伤害变化，>1% 的 49 条，>5% 的 16 条；default 变体 23/104 队 >0.1%，范围 −1.57%（auto-1591-1161-1311）到 +8.18%（auto-1401-1411-1031），**以上升为主**。按角色平均变化：1401、1031、1341、1431 最大。
- 两份基线（不带门槛版本测得，带门槛版本未重测，方向应一致）：
  - golden：41/415 条变化，留白减少 36、增加 4（增幅 ≤ 0.53s），Σ留白 957.4→901.3，最大超预算仍为 1.665s；
  - **棘轮 Σ留白 127.8→34.6s**，50 队变化；超预算 0.1s、1.5s 两处，都在 2s 容差内；
  - 例外：auto-1431-1341-1031 在棘轮路径留白 3.4→12.8，**未查**。
- 全量测试（带门槛版本，`/home/kaua/calc-arch/t180b.log`）共 14 条失败：基线 3 条，**非基线 11 条**：
  1. inStunAttribution × 5（双属性轴摘要、异放、极性紊乱、颤音层数、爱丽丝 6 命附伤）：南宫羽 + 格莉丝手写轴夹具由保轴变为**轴回退**。已测：修前轴态账本虚高 10.6s，账本之和超预算 12.3s，但行少，净占用 176.55；修后虚高被退回，轴态净占用 185.117 > 182 ⇒ 回退，inStunAnomalyState 为 null。初判：修前是靠虚高「装下」的，修后属真超预算。需决定改夹具（缩短轴内动作次数，保住测试意图），还是认定这是回归。探针 `k180/zzL180.test.ts`。
  2. teamTimeSummary「留白被归因到账本虚高」：夹具本身依赖虚高存在，修后虚高为 0。属设计内变化，需要换一个仍有虚高的夹具，或改断言。
  3. underfillRefund ①：refund > 0 → 0（负溢出先退回本槽残差，团队 refund 变少）。需判断欠打回填试探是否仍然需要这个前提。
  4. adjustableEffect 米卡以落霜（雅 C2 夹具前提）：雅平 A 0.72s，⌊平A/2⌋ = 0，前提失效。夹具已钉 off（§18.3），需换 SETUP 配装或加长战斗时间。
  5. peiluoVerdictTruncation：覆盖率 0.0834 → 0.0788；stunVulnSummary 雨果案例 B / D：加权易伤 1.69 → 1.6888、1.7211 → 1.7198。都是快照数值小幅漂移，需逐个确认来源（平 A 时间变化导致轴内占比变化）。

### 22.4 决定与下一步
- 本轮不合入：11 条非基线失败尚未逐条归因，其中第 1 条是行为变化（手写轴从保轴变为回退）。先归因，再合入。
- 合入顺序：先 CC-158（本补丁 + 测试归因 + 两份基线），后 CC-149（`k179/cc149-attempt.diff`），两者改的是不同文件。合入 CC-149 后再验 auto-1431-1341-1311（§21.3 的 −8.34% 应消失）。
- 架构判断：补丁把折叠从「只增不减的累加器」变为「带量化门槛的不动点迭代」，账本 ≡ 行的构造性恒等式（foldLoop 头注）在正反馈模块上才真正成立，**值得做**，不是为降计数。

### 22.5 第 181 轮：合入（补丁 + refund 双计修正 + 测试归因）
**代码**：只改 `src/core/resource/foldLoop.ts`：§22.2 补丁原样应用，另在退回块内加 3 行。

**refund 双计修正**：
- 退回 `back` 秒时，若 refund 已冻结且 > 0，令 `timeBudgetRefund = max(0, refund − back)`，诊断量 `timeBudgetRefundedSeconds` 跟随实际值。
- 病例：南宫羽 + 格莉丝手写轴（inStunAttribution 夹具，§22.3 第 1 条）。pass0 时该槽的估算高估量已作为 refund 冻结，之后同一槽先折入、再退回，同一份空闲就被补偿了两次：平 A 池 = 预算 + refund + 合轴，轴态净占用 184.75 ≈ 180 + 5.1，于是被判为轴太厚而回退。
- 修后：轴保住，净占用 179.681，伤害 2849900（旧为 2832609，+0.6%）。inStunAttribution 中 4 条恢复通过，§22.3 的「缩小夹具」方案不再需要。
- 轴态仍有截断 1.99s，在 `AXIS_FALLBACK_TOLERANCE_SEC` = 2s 以内，未深查。
- 为什么只减不增：refund 是 pass0 的粗修正，逐槽退回是精修正，二者不应叠加。只减不增不会引入冻结语义要防的抖动。
- 回退点：删除这 3 行，即恢复 §22.3 的状态（手写轴回退）。

**测试归因（7 条，全部按「意图不变、前提或冻结值跟随」处理，没有放宽判据）**：
| 测试 | 变化 | 处理 |
|---|---|---|
| teamTimeSummary「留白被归因到账本虚高」 | 爱丽丝/柚叶/妮可 slack 6.0→0，虚高 15.9→0 | 修复成功，样例失效；按该用例的换样惯例改为叶瞬光/照/妮可（slack 12.8 = 虚高 12.8，见下文 CC-159），注释写明 CC-159 修好后需再换 |
| underfillRefund ① | 两个样例 refund 分别 3.72→0、2.99→0，留白 2.12→0.4、5.97→0 | 「refund > 0」钉的是手段，要守的是结果「自由时间被分完」 ⇒ 改为两个样例都钉留白地板 |
| inStunAttribution 爱丽丝 6 命 | 附伤次数 85 vs 90（SW3 进轴改变时间分配） | 判据是 perDamage（逐次量），次数改为两侧均 > 0 |
| adjustableEffect 米卡「逐条独立消费」 | disorder=2 档：落霜 50 → 强特 10 → 雅平 A 0.49s | 前提按滑块区分：只有 c2flower 需要 ⌊平A/2⌋ > 0（该档平 A ≥ 3.3s）；D/F 项只读强特 |
| peiluoVerdictTruncation | 0.0834→0.0788 | 相对断言（< 上分支 × 0.5）不变 ⇒ 重冻 |
| stunVulnSummary B/D | 1.6900/0.6900/0.6273 → 1.6888/0.6888/0.6262；1.7211/0.7211/0.6555 → 1.7198/0.7198/0.6543 | 行级易伤断言全部不变，只是权重漂移 ⇒ 重冻 |

**两份基线（已重生成）**：
- golden：36/414 条变化，留白减少 32、增加 4（最大增幅 +0.53s，yidhari-qingyi-lucia 3.20→3.73）；Σ留白 957.4→905.3；Σ超预算 3.00 不变，最大超预算 1.665s。
- 棘轮：40 队变化，Σ留白 127.8→52.9；超预算没有增加。变差的 3 队：auto-1091-1031-1511（1.7→3.4）、auto-1191-1161-1311（1.5→1.6）、**auto-1431-1341-1031（3.4→12.8）**。

**zd（tag c181）**：
- 624 条中 172 条伤害变化，>1% 的 43 条，>5% 的 13 条。
- default 变体 21/104 队 >0.1%，范围 −0.51%（auto-1401-1511-1411）到 +8.18%（auto-1401-1411-1031），以上升为主。
- 按角色平均 |Δ|：1401 2.91%、1031 1.20%、1411 0.71%。
- **1431、1341 零变化。**

**auto-1431-1341-1031 棘轮 12.8 的归因（探针 `k181/zzM181.test.ts`，foldLoop 中的临时 ZZTMP 逐槽日志已删）**：
- 该队 refund 从 pass0 起就是 0，本轮的 refund 扣减没有触发，**与双计修正无关**。
- 走棘轮路径（setAgent）时，外层环入环（基线 outerExit=cycle），规范成员是 3 次折叠调用之一。
- 这一成员的叶瞬光槽：自己折入的残差退完之后，仍剩 −1.2~−1.9s 负溢出。这部分进团队 refund，但 refund 已冻结，于是被丢弃；负溢出又不计入 maxExcess，环判为收敛。summary 口径下显示为虚高 12.8（槽 0 账本 142.98，物化行 87.28 + 42.87）。
- zd 路径与 golden 路径（HEAD 留白 0）都不受影响。
- 「冻结后残余负溢出丢失」是旧代码就有的行为，不是 CC-158 引入的；CC-158 只是改变了外层环落在哪个成员上。
- 记为 **CC-159**，不在本卡内修：修法要让冻结后的 refund 可以增长，会动冻结语义，需要单独评估抖动风险。

**其他未查项**：golden 中 auto-1401-1511-1411 留白 1.99→0，伤害却 −1.98%（zd 为 −0.51%）。§22.3 已记，属「修复同源破缺后伤害可升可降」一类，未逐行核对。

**验证**：
- `npx vue-tsc -b` 与 `npm run verify` 通过：3824 passed / 29 skipped；
- check-guards 25 项通过；
- src 下无 ZZTMP，无 zz* 探针。

## 23. CC-159 定位：叶瞬光终局整数重推无整数不动点（k↔k+1 轮 2-循环）；更正 §22.5 的归因（第 182 轮，**未合入代码**）

### 23.1 起因
第 181 轮交接预期「CC-158 合入后，CC-149 在 auto-1431-1341-1311 上的 −8.34% 会消失」。**本轮实测：不成立。** 应用 `k179/cc149-attempt.diff` 后全量测试 4 条失败，golden auto-1431-1341-1311 为 −8.46%、留白 0→12.816，与 §21.3 相同。12.816 恰好等于 CC-159 病例（棘轮 auto-1431-1341-1031）的 12.82 ⇒ CC-149 真正的阻塞项是 CC-159。补丁已原样回退（`git diff` 与 `k179/cc149-attempt.diff` 逐字节一致）。

### 23.2 更正 §22.5 的归因
§22.5 写的是「折叠环在 refund 冻结后，残余负溢出被丢弃」。**这是错的**：折叠环末轮只剩 −1.95s。12.8s 产生在折叠环**之后**的 `runPreTailFinalize`（`src/core/resource.ts:288`，执行器 `src/core/resource/finalizePasses.ts#runFinalizePasses`）。

证据（探针 `k182/zzN182.test.ts`、`k182/zzQ182.test.ts`；ZZTMP 日志脚本 `k182/zzf182.py`、`zzp182.py`、`zzy182.py`、`zzr182.py`，均已删除）：
- 叶瞬光槽，折叠末态：nec 140.168、平A 6.503，cycle 实数 7.70 轮（照影 5.70）。
- 终局后：nec 142.975、平A 3.696，装配为 7 轮。1431009 与 1431019 各少 1 次（11→10、8→7），不是时长缩放。
- 在 estimate 出口加日志可以看到：终局重推在 **7 轮（94.7s，平A 约 18）↔ 8 轮（109.3s，平A 约 3.7）之间精确 2-循环**，12 轮上限内永远到不了 bitEqual。最终停在「state.necessaryTime 按上一态平A算出 8 轮，本态平A只够 7 轮」的相位 ⇒ 账本比行多约 14.5s，扣掉其他项后 summary 显示虚高 12.8s。
- cfg 上的 `yeshuguangCycle` 缓存虽然是陈旧的实数值，但 estimate 在有 state 时会现算 cycle，**缓存不是原因**。
- 本质：「平A → 剑势 → floor(剑势/6) → 必要时间 → 平A」这个整数环的增益大于 1，迭代期正是为此改用实数（`@fact agent:1431/轮数实数化`）。终局循环重推到 bitEqual，就把这个环重新打开了，而它**没有整数不动点**：k 轮时平A够 k+1 轮，k+1 轮时平A只够 k 轮。

### 23.3 试过的 4 个变体（全部否决，脚本在 `/home/kaua/calc-arch/k182/`）
| 变体 | 做法 | 结果 | 否决理由 |
|---|---|---|---|
| A `cc159.py` | 终局期首次 resolveCycle 冻结照影上限 floor(剑势/6)，之后取 min | 两队留白 12.8→1.08；c3 −26.8%；outerCycleColdStart 照影 5→4 | 违反测试钉住的用户口径 `照影 = floor(终态剑势/6)`；首次调用可能落在瞬态上 |
| B `cc159b.py` | 棘轮：终局期取 max(floor, 历史最大)，settle 钩子冻结 | 两队 1.3；c3 −16.6%；首轮装配截断 1.4→75.6s，外层 stable→cycle 20 轮 | iterate 内有瞬态（平A 166.72、终结技 1），棘轮把照影锁到 10 |
| C `cc159c.py` | 执行器检测周期 2，取两成员中 Σ平A 较大者 | c3 −34.5%；1431-1341-1311 **超预算 19.85s** | 选中的相位装不下 k+1 轮，截断重折环也兜不住 |
| D `cc159-variantD-floorOnce.diff`（84 行） | begin 增加 state 参数，按**折叠收敛态** floor 一次作为上限 | 两队 1.1；golden 1431-1341-1311 −5.6%，c3 −15.6%；outerCycle 照影 5→4；棘轮 1431-1481-1341 留白 0→2 | 同 A：违反 `照影 = floor(终态剑势/6)`；伤害变化被外层环放大，无法逐条归因 |

### 23.4 决定
- **本轮不合入任何 CC-159 变体，源码保持 HEAD。** 依据：没有整数不动点，任何修法都是「多出的那一轮打不打」的语义选择。
  - 「不打」一侧（A/D）违反 outerCycleColdStart 钉住的用户确认口径。
  - 「打」一侧（B/C）目前的实现在引擎层会失控：B 被瞬态污染，C 超预算。
- **定下的约束**（后续方案必须满足）：
  1. `照影 = floor(终态剑势/6)`（用户确认，测试钉住）；
  2. 装配行 ≡ 账本（不允许 12.8s 这类虚高留白）；
  3. 不写 agentId，不在 useResourceCalc 加角色分支。
- **推荐方向**：保留 k+1 轮，多出的时间由**自动退轴**吸收（用户原话「这一轮的时间由合轴率和短轴承担」）。
  - `estimateExSpecialTime` 已有退轴判据：`cfg.timePressureSeconds > AUTO_AXIS_DEGRADE_THRESHOLD`（5s，yeshuguang.ts:146）⇒ full→short_pair。
  - 待查：终局 2-循环里 k+1 轮那一相的 timePressure（本槽物化行 − 战斗窗口）为什么不触发退轴。timePressure 只在折叠环里写入，终局重推不刷新它，这可能正是缺口。
  - 若终局期也按当轮物化行刷新 timePressure，k+1 相就会退到短轴，短轴每轮更省时，可能出现整数不动点。
- 回退点：无需回退，HEAD 未改动。

### 23.5 对 CC-149 的影响
CC-149 继续阻塞于 CC-159。补丁 `k179/cc149-attempt.diff` 仍能对 HEAD 干净应用（已验证）。

## 24. CC-159 + CC-149 合入：终局单量子 2-循环由模块选相 + 降配绝对可行即接受（第 183 轮）

### 24.1 更正 §23.4 的推荐方向
§23.4 推荐「终局期刷新 timePressureSeconds，触发自动退轴」。**这个方向不成立**：timePressure = **本槽**物化行 − 战斗窗口（foldLoop.ts:154），病例中叶瞬光槽的行只有 130–145s，远低于 180s，永远达不到 5s 阈值。这里的超出来自队伍总预算，不是本槽自身装不下。用户原话中的「合轴率」在引擎里对应 S3 降配（interactionScale），它由超预算触发。所以正确的组合是：终局取「k+1 轮出行」那一相，超出部分交给降配吸收。而降配能否接受可行档，正是 CC-149 修的问题。

### 24.2 代码（4 个源文件 + 2 个测试 + CC-149 补丁原样）
- `src/core/resource/finalizePasses.ts`：
  - 记录两轮前的状态；
  - 未稳定、末态与两轮前逐位相同（周期 2），且两成员**逐槽强特、终结技次数之差都 ≤ 1**（`oneQuantumApart`，单量子）时，询问第一个声明了 `finalizePass.prefersCycleMember` 的参与模块选相；
  - 无人声明时保持旧行为。
- `src/mechanics/types.ts`：finalizePass 增加可选的 `prefersCycleMember(a, b)`，入参为本槽在两个环成员中的状态。
- `src/mechanics/agents/yeshuguang.ts`：`prefersCycleMember: (a, b) => a.basicAttackTime > b.basicAttackTime`，即取平 A 不被挤的一相。这时装配出 k+1 轮行，`照影 = floor(终态剑势/6)` 成立。
- CC-149：`k179/cc149-attempt.diff` 原样应用（solveTeam.ts、feasibilitySearch.ts、difficultyDescent.test.ts）。
- 测试：
  - outerCycleColdStart 交互档 0.0625 → 0.125，这是 CC-149 的预期结果；
  - teamTimeSummary 虚高归因样例换为单人叶瞬光 4 命（依赖 CC-160）。

### 24.3 为什么要这两个门槛（实测数据，探针在 `k183/`）
- **单量子**：单人 1431 c3 也会进入周期 2，但属于跨盆振荡（强特 15↔6、终结技 3↔1、平A 6.65↔166.72）。若也选平 A 较大的一相，会落在没有终结技的虚胖相，伤害 −34.5%。
  - 病例两队的环成员：1031 队叶瞬光轮数 7↔8、照终结技 2↔1，三槽强特不变；1311 队叶瞬光强特 7↔6、照终结技 2↔1。都只差一个量子。
- **模块选相，而不是引擎统一取平 A 大者**：伊德海莉（tail 阶段）同样会进入单量子 2-循环，取平 A 大者反而使强特 17→16、留白 1.5→3.5（golden agent:1051:c0 −1.98%，yidhari-norma-lucia −1.30%）。星徽·比利 +0.1%。改为由模块声明后，这两处恢复零差。
- **必须和 CC-149 一起上**：单上选相时，1431-1341-1311 超预算 19.85s（降配相对臂③否决了可行档）；两者一起上时留白为 2.93s。

### 24.4 效果
- 棘轮：Σ留白 52.9→39.2s，3 队变化：
  - auto-1431-1341-1031：12.8→1.1（outerExit stable→cycle）；
  - auto-1431-1341-1311：12.8→2.9；
  - auto-1431-1481-1341：0→7.9（CC-149 带来，§21.3 已记录）。
- golden：5/414 条变化，Σ留白 905.3→932.6，Σ超预算 3.00→2.88。
  - preset:auto-1431-1341-1311：伤害 −0.95%，留白 0→1.30。CC-149 单独上时是 −8.46%，所以 §21.3 的阻塞已解除。
  - preset:auto-1431-1491-1341：−0.13%，留白 1.75→0.62。
  - **agent:1431:c4/c5：+17.7%，留白 1.33→12.22；c6：+18.8%，留白 1.33→6.72。** 见 24.5。
- zd（tag c183）：
  - 624 条中 15 条变化；default 变体 3 队：auto-1431-1341-1311 −7.49%、auto-1431-1341-1031 −3.05%、auto-1431-1491-1311 −0.47%；其余 37 个角色零变化。
  - **下降未逐行核对**。推测是多出的一轮由 S3 降配承担，交互动作减少。下一轮用 zd 行快照核对（`.zc/perf/` 中 c183 的 rowsnap）。

### 24.5 新缺陷 CC-160：终局跨盆振荡（单人叶瞬光 c3/c4/c5/c6）
- c4 的最终结果来自 CC-149 放行的降配档（interactionScale 0.5）。该档中折叠残差为 49.65s（靠停滞判据收敛），终局环成员强特 15↔6、16↔6，是跨盆振荡，不适用单量子选相，停在哪一相就是哪一相，结果虚高 12.2s。
- 旧代码中这个档被降配臂③（留白不增）拒绝了，所以原先没暴露。臂③拦住的其实是这个缺陷，与 §21 对叶瞬光账本虚高的结论同类。
- 为什么仍然合入：CC-149 按 `@fact engine:降配搜索/绝对可行优先` 是正确修法。c4/c5/c6 的伤害上升了（+17.7%~+18.8%），代价是留白增加。跨盆振荡是终局重推本身的缺陷，与降配无关（c3 在 HEAD 上就有），应单独修。
- 回退点：`git revert <本提交>`，一次撤回 CC-149 与 CC-159。

### 24.6 核对 zd 下降（第 184 轮；探针 `k184/zzS184.test.ts`，走 zd 同款 `applyTeamToStore` 路径；日志 `k184/s-old.log`、`s-new.log`）
新旧两版分别跑同一探针（旧版 = 5 个源文件取自 5cab16aa），两队伤害与 zd 逐位一致。

| 队 | 版本 | 伤害 | 降配档 | 叶瞬光轮数 / 强特 | 留白 |
|---|---|---|---|---|---|
| auto-1431-1341-1311 | 旧 | 74775822 | **0.5** | **8** / 7 | −0.12 |
| | 新 | 69174452（−7.49%） | 1（不降配） | 7 / 6 | 1.79 |
| auto-1431-1341-1031 | 旧 | 60980535 | 1 | 7 / 6（妮可终结技 2） | **−2.14**（超预算，略超 2s 容差） |
| | 新 | 59122834（−3.05%） | 1 | 7 / 5（妮可终结技 1） | 1.09 |

- **1031 队：可以接受。** 旧版超预算 2.14s，新版去掉超预算、留白 1.09，强特与终结技各少 1 次，是正常收缩。
- **1311 队：真实损失，是策略缺口，不是新代码算错。** §24.4 的推测（多出的一轮由降配承担 ⇒ 伤害降）**方向反了**，实际情况是：
  - 旧版在 zd 路径上是自洽的好结果：满档时终局停在「k+1 轮出行」的超预算相 ⇒ 触发 S3 降配 ⇒ 0.5 档下 8 轮能装下，存在自洽不动点。这正是用户口径「多出的一轮由合轴率承担」。
  - 新版满档时选中的相，经截断重折环收成自洽的 7 轮，没有超预算 ⇒ S3 不触发。S3 只由超预算驱动，「降配换回多出的一轮」这个选项新版根本不会尝试。
  - golden（applyTeamPreset）与棘轮路径上，旧版停在虚高 12.8s 的不自洽相，新版修好了。三条路径的初态不同，所以旧版只在 zd 路径上碰巧落到了超预算相。
- **决定**：不回退 cc53864e（它修掉了两条路径上 12.8s 的虚高，并恢复了「绝对可行优先」）；开 **CC-161**，让 S3 在「终局被迫少打一轮」时也尝试降配。本轮不改代码，原因是这涉及降配目标函数，需先设计。

### 24.7 CC-160 定位（第 185 轮；仪表已撤；探针 `k183/zzQ182.test.ts`，日志 `/home/kaua/calc-arch/k185/`）
- **第 184 轮的假设不成立（读代码即可否定）**：`innerLoop.ts#runInnerLoop` 本身**没有阻尼**，同样是裸调 `iterate`，只多了环检测，环成员按 JSON 字典序选规范停点（与数值语义无关）。把终局换成 runInnerLoop 只会换一种任意选相方式，不会消除跨盆振荡。**此方向作废。**
- **振荡机制（单人 1431 c4，逐轮仪表 `k185/c4fp.txt`、`g4fp.txt`）**：状态记为 [强特, 终结技, 平A, 必要, 前台]。
  - 默认路径（0.5 档）：入口折叠态 [12,3,0,180,180]，残差 49.65s；随后 A=[15,3,18.25,161.75] 与 B=[6,1,164.63,15.37] 交替，12 轮都没收敛。
  - 连入口残差为 0 的 0.0625 档也在 A=[15,3,31.5,148.5] 与 B=[7,1,175.1,4.9] 间交替 ⇒ **振荡是叶瞬光单人终局本身的性质，与入口态是否可行无关**。
  - 机制：Jacobi 同步迭代，本轮次数由**上一态的平A**推出。A 相平A少 ⇒ 局外剑势少 ⇒ `floor(剑势/6)` 照影轮数少，同时终结技 3→1 使喧响进轮也少 ⇒ 必要时间只剩约 5s ⇒ B 相平A约 175s ⇒ 又推回 15 次强特。映射单调递减，但增益远大于 1（一相之差约 140s）；它的实数不动点落在两相之间，整数版没有收敛路径。
  - 虚高留白的来源：停点是 A 相（账本按 15 强特 / 3 终结技记必要时间），装配按 A 自身平A 18s 推出的剑势只出 7 轮行，差额 12.2s 表现为 backstage 留白（单人没有队友可切，只能空转）。
- **本轮试过并否决的变体**（数据都在 k185/）：
  1. **终局照影轮数封顶**（ZZ_CAP=0..10）：终结技 2↔1、3↔1 的振荡依然存在；封顶还会改变降配档选择，伤害和留白随上限乱跳，没有单调结构。否决。
  2. **终局只重推一轮**（字面理解 `@fact agent:1431/终局整数化` 的「重推一次」）：c3 从 3.57M 降到 2.01M（−43%，留白 61s），c4/c5/c6 下降约 29%。原因是从入口态推一步就落进 B 盆。否决。
  3. **「绝对可行」加一条账本残差 ≤ 容差**：c4 伤害 3.543M→3.541M，但留白仍有 13.4s（最终落在 0.0625 档，照样振荡）；c6 伤害 4.49M→3.78M（−15.8%），留白从 6.7s 降到 0。**不修留白**，所以不作为 CC-160 的修法。它另外暴露一个口径问题：CC-149 的「绝对可行」判据不看账本残差，c4 的 0.5 档残差 49.65s、c6 的 0.75 档残差 5.49s 都被判为可行。此问题记在 CC-160 卡的附注里，不单独开卡，因为残差是否算「装不下」要等终局自洽之后才能判断。
  - 附带数据：c4 的 0.625 档残差 0、净占用 178.7，仅因截断 1.4s 略超 1s 容差被拒；c6 的 0.875 档同样截断 1.4s。说明 1s 容差附近有一批「几乎可行」的档，改容差属于数值调参，不做。
- **修法方向（下一步，未验证）**：必须让终局求**整数自洽解**，不能再用同步迭代碰运气。叶瞬光的结构近似一维（轮数 ↔ 平A），递减步函数必然在某处跨过对角线，即存在 n 使得 g(n) ≥ n+1 且 g(n+1) ≤ n。按用户口径「余数剑势留着不打」，应取 **n 轮 + 剩余剑势不兑现**（封顶在 n）。封顶变体 1 失败的原因是只封了照影轮、封顶值是全局常数、没有逐档求解。正确做法是**在振荡的两相之间对「照影+喧响轮数上限」二分**，找最大的自洽上限。这需要模块提供一个上限旋钮，是引擎通用接口，见 CC-160 卡的「设计草案」。

### 24.8 CC-160 根因更正：终局沿用了实数期的折叠残差（第 186 轮；源码未合入；日志 `/home/kaua/calc-arch/k185/`：n4nt.log、rf3.log、k186mx.log）
- **§24.7「虚高 = 停在不自洽的相」只说对了一半。** 逐项打印 `helpers.ts#iterate` 的必要时间（`necessary = exSpecialNecessaryTime + 终结技 + 连携 + 闪反 + 招架 + … + cfg.timeBudgetExcess`）后发现：
  - 单人 1431 c4 在终局阶段 `cfg.timeBudgetExcess = 27.93s`，这是**实数期折叠环留下的折叠残差**；
  - 整数化之后轮数变少、装配行缩短，这笔残差却原样留在账本里。账本 = 装配行 + 27.93 ⇒ 留白 28.58（0.65 是估算与行的正常差）。
  - 不含残差时，叶瞬光的必要时间估算与装配行只差 0.65s（估算和物化同源，见 `estimateExSpecialTime` 的 R37-J5 注释）⇒ 整数态下的折叠残差本应接近 0。
  - 结论：**CC-160 = 两个缺陷叠加**。(a) 终局没有重算折叠残差（主因，决定留白大小）；(b) 整数重推的跨盆 2-循环（§24.7，决定停在哪相、残差占多大比例）。
- **cycleCap 上限二分（§24.7 草案）实现后实测，否决**：
  - 做法：`finalizePass.cycleCap{measure,set}`，叶瞬光封顶照影轮数；引擎在两相之间从大到小扫，取首个收敛者。
  - 结果：c4 2.64M / 留白 28.6，c6 3.35M / 28.6，都比旧版更差。
  - 原因：扫到的收敛态确实自洽，但账本里仍带 27.93s 过期残差，留白反而全部暴露出来。封顶解决的只是 (b)，(a) 不解决就没有意义。设计草案作废。
- **终局后重折（`runPreTailFinalize` 之后再跑一次 `runFoldLoop`）**：
  - 部分有效：c2 2.79M / 2.8，c4 3.04M / 0，c6 3.81M / 0（旧版 3.27M/8.2、3.54M/12.2、4.49M/6.7）。伤害下降 = 去掉虚高后的如实值（虚高留白按平A兑现本来就不成立）。
  - **c3 回归**：3.17M / 留白 30.7，外层 20 轮入环（outerExit=cycle）。整数态下终结技 1↔3 振荡（平A 9.7 ↔ 156），折叠环跟着追，残差到 −67.5s，停在必要 180、平A 0 的相。
  - ⇒ 只修 (a) 会让 (b) 暴露在折叠环和外层里。**不合入。**
- **下一步设计（CC-160 卡已同步）**：必须同时解决 (a) 和 (b)。
  - 候选 1「一次取整 + 冻结」：实数期收敛后，按 `@fact agent:1431/终局整数化`「floor 一次」取整，并**冻结**离散次数（照影/喧响/赠轮、终结技次数），只让平A = 预算 − 必要 自由；然后重折，只剩平A和残差两个自由度，没有反馈环。
    - CC-159 变体 A「上限冻结」当初 c3 −26.8% 被否，但那次评估时账本里还带着过期残差，**需要在重折前提下重测**。
  - 候选 2：终局重折时给整数态加阻尼（沿用实数期 `exContinuous` 的 `(prev+cur)/2` 骨架）。但整数态没有中间值，可能退化为 2-循环的另一种形式，优先级低于候选 1。
  - 验收：单人 1431 c0–c6 留白 ≤ 2 且外层 stable；golden 伤害变化逐条归因（虚高去除 ⇒ 下降是预期）；zd 两队复测。

### 24.9 CC-160 修复：终局照影 floor 一次冻结 + 终局后重折（第 187 轮，提交 3db6e605）
- **修法（两处，都是能力声明，引擎不认人）**：
  1. `yeshuguang.ts#finalizePass.begin(cfg, entry)`：先在旗标未置时，用入口态 `resolveCycle(cfg, entry)` 算实数照影轮数，floor 一次写入 `cfg.yeshuguangFrozenZhaoying`，再置 `yeshuguangFinalizeForms`。`computeYeshuguangCycle` 在终局且冻结值存在时直接取它，不再从平A重推照影；`reset` 时清除。这是 `@fact agent:1431/终局整数化`「各 floor 一次、余数剑势留着不打」的字面实现，切断了整数态下「平A→剑势→轮数→必要→平A」的高增益环（§24.7）。
     - 接口变更：`finalizePass.begin(cfg, entry: IterationState)`，入参只读；比利、伊德海莉忽略第二个参数。
  2. `finalizePass.refoldAfter?: boolean`（叶瞬光声明）：`runFinalizePasses` 返回 `refold`，`resource.ts#runPreTailFinalize` 据此在终局后再跑一次 `runFoldLoop`，按整数行重算折叠残差（§24.8 主因）。截断重折环的 rerun 共用同一个包装。
     - **比利不声明**：实测若对所有参与者都重折，会改动比利 golden 和 adjustable（`billy_*_basic4_gain` rate 1/2 实到 0），且未归因 ⇒ 开 CC-162 另查。
- **对照实验（k185/k187a.log，`mx2.sh`，单人 1431 c0–c6）**：
  - 只冻结：c4–c6 留白仍为 28.8（残差还在）。
  - 冻结 + 重折：c0–c6 全部 stable、留白 0。
  - 连喧响轮数也冻结（FZ=2）：会让喧响轮脱离实际终结技次数，语义不成立，否决。
- **结果（golden 口径，伤害 / 留白）**：c2 3.27M/8.2 → 2.79M/0；c3 3.57M/8.2 → 3.04M/0；c4 3.54M/12.2 → 3.04M/0；c5 3.84M/12.2 → 3.29M/0；c6 4.49M/6.7 → 3.81M/0；c0/c1 基本不变。
  - 伤害下降 = 旧停点的虚高去除：旧停点是 2-循环的一相（强特 15、终结技 3），账本记的次数与本态平A推出的剑势不自洽；新态为强特 8、终结技 2、平A 47s 的自洽解。
  - c3 与 c4 行完全相同：4 命的效果只是开局 +1000 喧响，不够再放一次终结技（HEAD 上 c4 同样 ≤ c3）。
- **三人队（golden 34 条差异全在 1431 队，已按 TIME_GOLDEN_UPDATE / TIME_RATCHET_UPDATE 重生成）**：
  - 留白：1431-1341-1311 1.3 → 0，1481-1341 7.9 → 1.2（棘轮口径），1491-1311 1.1 → 0，1341-1031 1.1 → 0 且外层 cycle → stable；1491-1341 2.2 → 2.5（棘轮口径，+0.3，golden 口径 0.62 → 0）。
  - **zd 同款路径**（`k184/zzS184.test.ts`）：1341-1311 69.17M → 73.19M（+5.8%，留白 0；§24.6 的损失基本收回，旧版 74.78M 本身带 0.12s 超预算）；1341-1031 59.12M → 59.75M；1481-1341 115.69M → 115.55M（截断 15.63 → 15.34）；1491-1341 92.41M → 92.36M（交互档 0.375 → 0.5，留白 1.19 → 0）。
- **测试改动（逐条归因）**：
  - `teamTimeSummary`「留白归因到账本虚高」：样例（单人 1431 c4）被本修复消除，按该文件惯例换队。全库扫描（`k185/zzTS187.test.ts`）虚高最大的是爱丽丝/南宫羽/柚叶默认口径（3.98 = 留白，池已分完），阈值 10 → 2。
  - `outerCycleColdStart` C1：仅灭短轴 12 → 13 轮（仍 > 满轴 11，stable）。
  - `difficultyDescent` 单因素：闸门开启时 0.4 → 0.3 同为 0.125 档，伤害 +0.045%（留白 1.89 → 1.52，折叠停滞判据的残余）。决定：**同档**内允许 ≤0.1% 相对回升，档位变化时仍零容差（历史反转 +0.6%~+16%，都伴随档位回升，照拦不误）。回退点：删测试里的 `sameTier` 分支。
  - `truncationRefold` ④：锁窗夹具 1431-1481-1491/-1341 的重折环现在都被拒（冻结值随入口态和 rowTimeLimit 变 ⇒ kept 两态振荡，如实上报 rejected），恒等式失去样本 ⇒ 追加 `auto-1431-1491-1341`（锁窗 3，2 轮到不动点，截断 31.6s；全库扫描 `k185/zzScan187.test.ts`）。恒等式本身不放宽。
    - 代价：锁窗 3 下 -1491 最终截断 94.6 → 103.4s，-1341 则 92.8 → 91.8s。锁窗是人造夹具（默认口径用例③不受影响），记入 CC-162 附注。
- 验证：`npx vitest run` 3824 passed / 0 failed；`npm run verify` rc=0；`vue-tsc -b` 无新错；CG 25 项通过。`zcWorkspace` 在全量高负载下偶发失败，单跑通过，与本改动无关。
- 回退点：`git revert 3db6e605`（一次撤回代码、两份基线与 4 处测试）。

### 24.10 CC-163：删除单量子选相死分支；CC-161 关闭（第 188 轮，提交 58d0143d；日志 `/home/kaua/calc-arch/k188/`）
- **扫描**（在 `runFinalizePasses` 加临时仪表，打印所有未稳定的终局）：golden、棘轮、zd 三条路径上 1431 preTail 周期 2 共 199 次，全部是单量子环（多数在 S3 降配试算里）；另有 1531 preTail 25 次、1051 tail 44 次（这两位没有声明选相，本来就不进分支）。结论：分支**仍会触发**。
- **影响测量**（禁用分支，`ZZ_NOPICK`）：golden + 棘轮零差异；zd 路径全部 104 个预设的伤害/交互档/外层/留白/截断逐位相同（`a.txt` vs `b.txt`）；单人 1431 c0–c6 相同；全量测试 3824 条全部通过。
  - 解读：CC-160 之后，终局停在周期 2 的哪一相已不影响最终结果——`refoldAfter` 重折按整数行重算残差并收口，两相最终汇到同一结果。选相分支因此成为**死分支**（触发但无效果）。
- **决定：删除**。`finalizePasses.ts` 的 `oneQuantumApart`、周期 2 分支、`prev2` 跟踪；`finalizePass.prefersCycleMember` 接口（types.ts）及叶瞬光声明。执行器回到「≤12 轮 iterate + 逐位判稳 + refold 标志」。依据：架构更简单（少一个模块能力、少一种引擎分支），且零数值影响。回退点：`git revert 58d0143d`。
- **CC-161 关闭**：原病例 zd 1431-1341-1311 在 CC-160 后为 73.19M、留白 0、stable、满档可行。旧版 74.78M 靠「k+1 相超预算 ⇒ 降到 0.5 档」得到，而且本身带 0.12s 超预算；新口径下 S3 不触发是正确的（满档可行）。剩下 −2.1% 是「满档 7 轮自洽」与「0.5 档 8 轮微超」之间的口径差，不属于缺陷。若将来想要「满档可行时也试降配、按伤害择优」，那是新的目标函数设计（与「交互只取达成目标的最少要求」冲突），需要用户口径，不在引擎待办里。

### 24.11 CC-162 关闭（比利不声明 refoldAfter）；CC-147 删除热启动/注入种子通道（第 189 轮，代码提交 08b4d40d；日志 `/home/kaua/calc-arch/k189/`）
- **CC-162 决定：不声明，关闭**。
  - 依据：比利（1531）没有可修的虚高留白。golden 中 agent:1531 c0/c3–c6 与两支 1531 队的留白和超预算都是 0.000；zd 路径 auto-1531-1481-1451 留白 0.00、auto-1531-1571-1451 留白 1.07；棘轮 0.6 / 0。全部在容差量级，外层 stable。
  - 第 187 轮实测：给比利加 `refoldAfter` 会让 `billy_*_basic4_gain` 的 rate=1/2 实到 0，是真退化。没有收益、只有退化 ⇒ 不做。
  - 「basic4 行在重折后消失」的根因没有深挖：它只在声明重折时出现，而当前不声明，所以不是现存缺陷。以后若有比利留白病例需要重折，从这里接着查（`helpers.ts#iterate` 的 necessary 分项 + 比利 `buildExecutions` 的 basic4 行）。
  - 附带项「锁窗 3 夹具 1431-1481-1491 截断重折被拒（94.6 → 103.4s）」也不做：它只出现在人为锁定失衡次数的场景，默认口径不受影响；要修得给截断重折环加一套跨轮沿用冻结值的专门机制，架构变复杂，收益只在人造场景上，不符合判据。
- **CC-147：删除热启动缓存与 `initialStates` 注入通道**。
  - 死输入的论证：CC-146 起，折叠环 pass0 只要 `injected` 为真就改从默认种子起跑，注入值在任何路径上都不参与计算；缓存存的「规范种子」本身就等于默认种子。
  - 删除内容：
    - `core/resource/warmStart.ts` 整个文件（精确键、LRU、统计、`clearWarmStartCache` / `getWarmStartStats`）；
    - `ResourceCalcConfig.initialStates`；
    - `FoldLoopContext.injected` / `defaultSeedStates` 与 pass0 替换分支；
    - `TailPipelineContext.warmExactKey` / `warmSeedStates` 与写缓存；
    - 模块能力 `feedbackCfgKeys`（只为热启动键存在）以及卢西娅、诺姆、伊德海莉三处声明；
    - `@fact engine:热启动逐位透明` 及其 guard 豁免键；
    - 测试 `warmStart.test.ts`、`seedInvariance.test.ts`（全库四种子闸门在 CC-146 后已钉成「种子改变轮数 = 0」，删通道后没有可测对象）；
    - `yidhariInteractionGrid` 的「冷 vs 高种子」一档（保留「收敛 + 整数次数」）；
    - 11 个测试与 11 个 `.zc/perf` 脚本里的 `clearWarmStartCache` 调用。
  - **zd 结果：2 处差异，均在 auto-1431-1491-1311 的 heavy / heavyGate**，79.44M → 73.65M。
    - 归因（已实证）：HEAD 的 worktree 里让 `lookupWarmStart` 永不命中后，与改后**全部配置逐位零差**。
    - 机制：HEAD 上缓存命中时 `ctx.injected` 为真，于是 CC-160 的终局重折 `runFoldLoop(fp.states)`（以及截断重折）在 pass0 被**换成默认种子**。同一配置的结果因此依赖之前算过什么，属于缓存历史依赖缺陷，由 CC-146 的 injected 分支和 CC-160 的重折叠加而成。
    - 删除后结果恒等于冷算，golden 与棘轮不动。
  - 验证：全量测试 3812 passed（−12 为删掉的用例）；golden 与棘轮未更新就通过；`vue-tsc -b` 无新错误；CG 25 项通过；`npm run verify` rc=0。
  - 回退点：`git revert 08b4d40d`（`.zc/perf` 不入库，回退后需在 perf 脚本中补回 `clearWarmStartCache`，否则只丢缓存隔离，不影响结果）。
  - 影响面：引擎入口签名少一个可选字段；没有生产写入方（只有测试写入）。加速收益本来就是 0（CC-146 起热启动不省任何轮数）。

### 24.12 CC-156：「保底4失衡」未达成改为如实提示（第 190 轮，代码提交 e542a005）
- **复测原病例**：归档 72db6dc3（1371+1481+1451），缺省 physical 口径下现在池 = 4（有效失衡 66829 ≥ 4×16647），伤害 66.6% 击杀线。§18.3 记录的「N*=3.84、池 3」已被 CC-158…CC-147 的修复消除，原病例不再复现。
- **一般问题仍在**：把 Boss 弹刀预算压到 6 次，6 次全部反推给击破位（topUp 封顶）后池只有 3 次，页面没有任何提示，属于静默降级。`ParrySplitResult.reached` 本意是做这个诊断，但全仓零读取，而且比的是单轮池计数。
- **决定：上报，采用最小实现，不改任何数值**。
  - 依据：用户勾选了一个目标，引擎达不到时应当说明。页面已有先例：「保底4喧响」旁的 `guaranteeUltimateHint` 会如实显示取整过程。
  - 引擎行为不变：仍按实际池计数计算，不硬凑。
- **实现**：
  - `core/parrySplit.ts`：
    - 新增 `GUARANTEE_STUN_TARGET = 4`，作为单一事实源，替换 `convergence.ts` 里写死的 `targetStunCount: 4`；
    - 删除零读取的 `reached`；
    - 新增纯函数 `guaranteeStunShortfall(stunCount, split)`，按**最终**池计数判定，原因分三种：`parry-exhausted`（预算用满）/ `no-parry-budget`（拆分未激活）/ `other`。
  - `useResourceCalc`：暴露 `guaranteeStunShortfallResult`（未勾选、无池结果或已达成时为 null）。展示层不能直接 import `@/core`，这是 CG 展示层越层棘轮的要求，所以判定放在编排层。
  - `TeamConfigPage.vue`：在「保底4失衡」旁显示「（未达成：失衡池 N 次，Boss 弹刀 X 次已全部反推给击破位仍不够）」。
- **测试**：
  - `parrySplit.test.ts` 新增 4 条（三种原因 + 达成）；
  - `archiveDeployStun.test.ts` 去掉第 177 轮的 off 钉，回到缺省 physical 口径，另加「parryTotal=6 ⇒ parry-exhausted、池 3」一段。
- **验证**：全量测试 3816 passed；vue-tsc 无新错误；CG 25 项通过；`npm run verify` rc=0。
- **回退点**：`git revert e542a005`。提示只是展示，回退不影响任何数值。

### 24.13 CC-152：8 个文件级 off 钉细化为逐用例钉（第 191 轮，提交 c6795167）
- **测量（决定做之前）**：临时去掉 8 个文件的文件级钉（让 `DEFAULT_STUN_PLAN_PROJECTION_CODE` 恢复缺省），逐文件跑，共 111 条用例，physical 下只有 9 条红。
  - 文件级钉让 102 条本可以跑缺省口径的用例一直测 off，缺省路径（用户实际使用的口径）在这些文件里没有覆盖。
  - 决定：做。收益是覆盖面回到缺省口径，不是计数下降。
- **逐文件结果**（格式：用例总数 / physical 下红的条数 → 处置）：
  - convergenceNightD 24/1 → `readBanyueCfg(…, stunPlanOff)` 参数只给「补齐量精确值」用例钉 off（parry 12 为 off 录制值，physical 为 3）；
  - damagePoolBatchR17c 14/2 → `calcOf(…, { stunPlanOff })`：叶瞬光与雨果两条成对精确值；
  - damagePoolBatchR18d 16/3 → `calcOf` 的 opts 加 `stunPlanOff`：帷幕封顶 3 条 ★（C4 用例里的 c0 对照也同钉）；
  - moduleAnomalyEventRecords 11/1 → 只在 `key === 'r0'` 时钉（EXPECTED.r0 为 off 快照）；
  - timeWeightAllocation 14/1 → ⑤ 钉（依赖「均衡把失衡 4→3」这一 off 场景）；
  - nextRoundFeedback 20/1 → 露西 C6 钉（58 是「有钩子 58 / 摘钩子 30」的反向验证锚点，physical 为 60）；
  - **damagePoolDefDown 3/0、potentialAxisBatchB 9/0 → 整块删掉钉**。§16.2 写的钉的理由（颤音异放 1→0 掉档、端到端同向）在当前 HEAD 已不会让用例变红，后续轮次的修复已消除这些现象。
- **钉的写法统一**为真实开关 `config.setMechanicSetting('time.stunPlanProjection', 0)`，与 archiveDeployStun 的先例一致；不再用 `vi.mock` 改模块常量。每处钉旁都有一句「CC-152 逐用例钉：理由」。
- **没有改任何期望值或容差**：diff 中唯一的 expect 行变化是给 `readBanyueCfg` 加了钉参数。
- **执行方式**：改写派给子代理 dsh（任务书在 `/home/kaua/calc-arch/k191/task191.txt`），我复核了 diff（钉不跨用例泄漏：`readBanyueCfg` / `calcOf` 每次调用都新建 harness）。
- **验证**：8 个文件 111/111 通过；全量测试与 `npm run verify` 见提交说明；CG 25 项通过；vue-tsc 无新错误。
- **回退点**：`git revert c6795167`（只动测试文件）。
- 仓库里剩余的 `stunPlanProjection` 文件级 `vi.mock` 钉：0 处（outerCyclePick 的 mock 是接线包装，不是口径钉；它的 setupYixuanPreset 用例级 off 见 §18.3）。

### 24.14 CC-27：维琳娜风蚀利用率改由模块内闭环，删编排层到 core 的专属穿线（第 192 轮，提交 948a1444）
- **核查卡面（卡片写于 CC-6d 之前，已部分过时）**：
  - 状态机本体已由 CC-6d 迁进 `mechanics/agents/velina.ts`：core 只按能力 `anomalyCorrosion` / `anomalyCorrosionEvents` 查询，core 里 import 角色模块的地方为 0。
  - `velinaCorrosionSource` 全仓零引用。
  - core 里剩下的维琳娜专属形状只有一处：`cinema2CorrosionRate`。它从 `roundInputs` 读 store 滑块，经 `AnomalyPoolInput` → `anomalyPool.ts` → `helpers.ts`（两个接口字段 + `calcTurbulenceDamage`）→ `corrosion.ts` → 能力入参 `fallbackRate`，一路传到维琳娜模块。
- **发现**：维琳娜 `resolveVelinaCorrosion` 本来就读 `panel.velinaCinema2CorrosionRate ?? fallbackRate`，但这个面板字段**全仓零写入**，所以永远回落到穿线传入的值。面板盖章这条路从来没有接上，第 154 行一直是死读。
- **修法（让架构更简单）**：
  - 维琳娜 `applyPanel` 读 `AgentPanelInput.settings['velina.cinema2CorrosionRate']`，盖章到自己的面板字段，由自己的风蚀能力读回。写读同属一个模块，这是面板相位读滑块的既定通道（`AgentPanelInput.settings` 注释），不属于它警告的跨模块走私。
  - 删除整条穿线：`roundInputs` 一行、`AnomalyPoolInput` / 伤害配置的 `cinema2CorrosionRate` 两个字段、`anomalyPool.ts` 三处、`calcTurbulenceDamage` 的实参、`corrosion.ts` 的 `fallbackRate` 参数、能力入参 `fallbackRate`，以及 `resolveVelinaCorrosion` 的第 4 个参数。
  - 缺省值收为 `VELINA_C2_CORROSION_RATE_DEFAULT`，settings 声明的 default 也引用它。
  - 结果：异常池契约和 core 不再携带任何角色专属量；以后别的角色要给异常池能力传参数，也走同一模式（applyPanel 读 settings 盖章）。
- **不做：`CORROSION_CYCLONE_RELEASE_ID_PREFIX = 'velina-corrosion'` 留在 core**。
  - 依据：它是事件 id 契约的单一事实源。维琳娜模块（生产方）import core，编排层 `damagePoolAnomaly`（消费方）也只依赖 core，依赖方向正确。
  - 如果搬进维琳娜模块，编排层就得 import 具体角色；如果改成事件标志字段，要动事件类型和 perf 语料（id 进入伤害池行 id）。收益都不足以抵消成本。
- **测试**：
  - `agentMechanicViewCc71` 的 CC-72 用例改写。旧版用空面板（队里没有维琳娜，两边都返回 undefined）比较，没有意义；新版断言源码中 core / roundInputs 不含该字段，并用 `applyPanel` 盖章出真实的维琳娜面板，断言 `c2WindGainExpected = 9 × 利用率`，未提供滑块值时为 2/3。
  - `mechanicSettingsEffect` 新增真管线探针：1581 + 1501 + 1561 队，三点 0 / 0.5 / 1，断言 `c2WindGainExpected === 当点风化触发次数 × v`。风化次数会随利用率反馈漂移（v=1 → 8 次、v=0.5 → 7 次），所以不能断言严格比例。
    - 反向验证：把盖章改成恒等于缺省值后，三点全红（恒为 5.33）。
    - 此前该滑块唯一的覆盖是 velina.test 直调纯函数，绕开了生产注入点；守卫 settings-coverage 只按 id 字符串计数，看不出这一点。
  - `anomalyPool.test` 删掉 3 处已不存在的入参。
- **验证**：zd DUMP / ROWS 都是 0 差异（104 个预设，滑块取缺省值）；`npm run verify` rc=0（内含全量 3817 passed）；CG 25 项通过；vue-tsc 无新错误。独立并行跑的全量测试里有 3 条死通道耗时断言超限（67.9s > 60s），单跑 19/19 通过，属于负载偶发。
- **回退点**：`git revert 948a1444`。

### 24.15 CC-164 死读排查（零发现）→ 顺藤查出 CC-165：蕾米埃尔 6 命加成字段初值双计 + 特殊虚耀单位错（第 193 轮，提交 90a7eb79）
- **CC-164（CC-27 的同类排查），结论：`PanelValues` 上零死读。**
  - 扫法一（按读取点）：`src/mechanics/**`（非测试）里 `panel|p|values|pv` 的 `.字段` / `['字段']` 读取共 125 个键，逐个在 `src`（非测试）找写入（赋值 / 对象字面量键 / 简写）。零写入的只有 `aliceMasteryToProficiencyBonus`、`banyueRageCoverage` 两个，都只出现在注释里（R6 C7 与般岳早已修过），不是真读。
  - 扫法二（按声明）：`types/catalog.ts#PanelValues` 的 120 个声明字段，排除 `core/panel.ts` 缺省工厂后统计读写。结果分三类，都不是死读：
    - 敌方 `enemy<El>StunResReduction` / `AnomalyResReduction` 等：按属性拼键动态读写（`stunPool.ts:31`、`anomalyPool/helpers.ts:623`），字面扫描看不到；
    - `enemyLumiflux*` 两个：通用属性维度，目前没有来源，不算死读；
    - 蕾米埃尔 13 个专属字段：写入方是 catalog buff 的 stat 键，经 `core/buff.ts#applyStat` default 分支按键名累加（`data/agentPanelStats.ts` 头注释）。
  - 扫描脚本在 WSL `/home/kaua/calc-arch/k192/scan164.py`、`scan164b.py`（仓库外，一次性工具，不入库）。**不做 CG 判据**：零发现，写判据只会增加维护面。
- **CC-164 第二项：滑块「只有纯函数覆盖」排查，结论：无 CC-27 类风险，不补测。**
  - 口径：运行时注册表（`scripts/dump-mechanic-registry.mjs`）共 179 个滑块。引用它的测试里有 `setMechanicSetting` / `useResourceCalc` 的算真管线：160 个；其余 19 个只被模块单测引用（脚本 `k192/scan164c.py`）。
  - 逐个核对这 19 个的读法：全部走标准通道——charConfig 相位 `cfg['setting:<id>']`（由 `resourceCalc/helpers.ts:620` 盖章，含 `cfgNum` / `cfgSetting` 包装），面板相位 `input.settings[id]`。单测注入用的也是同一个键。
  - CC-27 的病因是「值作为函数参数从另一条通道传入」，这 19 个都没有这种形态。逐条补真管线测试只会让计数好看，没有架构收益，所以**不做**。
  - 旁证：CG 判据 4 只按 id 子串计数（标题 / 注释里出现也算），看不出通道对不对；但通道本身已由 `mechanicSettingsEffect` 的多条真管线探针覆盖。
  - 可归一候选（未立卡，**不做**）：滑块读取有 6 种写法并存（`cfgNum`、`cfgSetting`、`(cfg as any)['setting:x']`、`record[...]`、`settings[...]`、`getTeamMechanicSetting`）。收为一个带类型的访问器能去掉 `as any`，但要改约 50 个模块，而它们今天读得都对，收益不足以抵消改动面。若日后有人在这里踩坑，再立卡。
- **CC-165（扫法二的副产品）：蕾米埃尔 6 命三个 `*TriggerMultiplier` 字段初值双计，特殊虚耀个数单位错。**
  - 发现：初值表里 `remielleCinema6LuminizeTriggerMultiplier` / `SpecialVoidflareTriggerMultiplier` / `FleetingGraceVoidflareTriggerMultiplier` 的初值都是 1（CC-34a 原样搬自最初的 emptyPanel，头注释写着「倍率类初值为 1」），而模块一律按 `1 + max(0, x)` 读。catalog effect id 是 `remielle_c6_*_multiplier_bonus`，是加成语义 ⇒ 0 命已是 ×2，6 命（+1）成了 ×3。
  - 特殊虚耀：`remielleCinema1SpecialVoidflareCount = 1` 是**轮次**（catalog buff 描述「特殊虚耀触发轮次」），`remielleCinema4SpecialVoidflareRefillCount = 3` 是**个数**（「补充3个特殊虚曜点」），代码直接相加。
  - 口径依据（三处仓库内来源一致，不是「更接近投稿」）：
    - `character-constellations.json` 1581：1 命「开局3个特殊虚耀」，4 命「次数变为6次（6命为12次）」，6 命「惊鸿耀变次数翻倍」；
    - catalog 6 命原文「1命+4命的2轮变为4轮」；
    - 模块自己的事件公式文案 `count = (3 + 4命补充3) × 6命翻倍`。
  - 读数：

| | 规格 | 修前 | 修后 |
|---|---|---|---|
| 特殊虚耀 1 命 / 4 命 / 6 命 | 3 / 6 / 12 | 2 / 8 / 12 | 3 / 6 / 12 |
| 惊鸿耀变 0 命 / 6 命 | ×1 / ×2 | ×2 / ×3 | ×1 / ×2 |

  - 修法：
    - `data/agentPanelStats.ts` 三个字段初值 1 → 0，并改头注释（初值一律 0；按 catalog 语义和模块读法定初值，不要按名字里的 Multiplier 猜）；
    - `remielle.ts`：新增 `REMIELLE_SPECIAL_VOIDFLARE_PER_ROUND = 3`，`remielleSpecialVoidflareCount = (3×轮次 + 补充个数) × (1 + 加成)`；原先逐字相同的 `remielleSpecialVoidflareUseCount` 改为委托，两份公式收成一处；
    - 惊鸿行由 `remielleFleetingGraceMultiplier` 计算，读 FleetingGrace 字段（其声明就是「六命惊鸿关联虚耀」）；
    - 公式文案、`DebugPage` 说明、状态表同步。
  - **译名坑（已核实）**：6 命原文的「虹之终幕 / 瞬逝优雅」就是垂虹（Rainbow's End，1581007，代码字段 `remielleRainbowEnd*`）/ 惊鸿（Fleeting Grace，1581008）的另一译名，catalog 里没有叫这两个名字的招式。所以 `LuminizeTrigger` 本来就作用在垂虹 / 惊鸿上；它和另两条「翻倍」是否叠乘见 CC-166。修前惊鸿读 LuminizeTrigger 也说得通，两字段 6 命同为 +1，**6 命读数修前修后都是 ×2**。
  - 数值影响（timeGolden 9 条，全部是 1581 相关）：
    - 6 个 0 命预设伤害 −12.1% ~ −15.7%，时间账零变化：`auto-1091-1221-1581` 97.46M→84.13M、`auto-1541-1331-1581` 218.47M→192.07M、`auto-1181-1561-1581` 124.11M→104.66M、`auto-1261-1561-1581` 174.44M→148.87M、`auto-1261-1331-1581` 212.77M→184.46M、`auto-1581-1501-1561` 193.35M→167.07M；
    - 单人 1581：c3 必做动作 +1.5s（特殊虚耀 2→3，垂虹载体 +1）；c4 / c5 必做动作 −3s（8→6，载体 −2）；c6 不变（12→12）。
  - 归因（反向验证）：临时把惊鸿倍率恢复成旧的 ×2（其余修正保留），只跑 timeGolden ⇒ 6 条伤害差异全部消失，只剩 3 条 c3/c4/c5 时间差异。伤害下降 100% 来自惊鸿双计的修正。已用 `TIME_GOLDEN_UPDATE=1` 重生成基线。
  - 测试：
    - `remielle.test` 惊鸿计数 4/6 → 2/3、1 命特殊虚耀 2 → 3；新增口径用例：特殊虚耀 3/6/12、惊鸿 ×1/×2、空面板三个加成初值 `[0,0,0]`。旧公式下这两条断言分别是 `[2,8,12]`、`[1,1,1]`，反向必红。
    - `moduleAnomalyEventRecords` 4 组惊鸿块：count 减半，字段名与公式文案同步（文件头已记 CC-165）。
  - 验证：zd DUMP 36 处 / ROWS 42 处差异，全部在含 1581 的队伍（NON1581 = 0）；蕾米埃尔相关 36 个测试文件 604 条通过；全量在 timeGolden 重生成前唯一失败项为 timeGolden；`npm run verify` rc=0（内含全量 3818 passed）（首轮因状态表非紧凑 JSON 红，`minify:static` 后通过）；CG 通过；vue-tsc 无新错误。
  - 回退点：`git revert <CC-165 代码提交>`；golden 随同一提交回退。
- **CC-166（立卡，未做）**：蕾米埃尔 6 命两处未决。
  - (a) 叠乘歧义：「垂虹 / 惊鸿耀变触发2次」（LuminizeTrigger）与「特殊虚耀再次翻倍」「惊鸿关联虚耀翻倍」在同一载体上是 ×4 还是 ×2。当前 ×2、LuminizeTrigger 不读。
  - (b) 普攻第 4 段（蹁跹 #4，1581005）命中获得 3 个特殊虚耀、伤害为开局特殊虚耀的 25%（`remielleCinema6SpecialVoidflareCount` / `DamageRatio`）：零读取，未建模。要先定「每次普攻 4 段都给 3 个，还是受储存上限 3 约束」以及触发频率来源（轴里 1581005 的次数）。
  - 两项都会改数值，而且需要语义判断，原文无法消歧。按 R5（数据可信、不凭推测改数）暂缓，等有更明确的规格来源再做。状态表 1581 c6 的 pending 已登记。

### 24.16 第 194 轮：CC-167（加成初值双计推广，零发现）、洛克茜 energyRegen 旁支（读数正确，顺手让局外面板盖章）、CC-168 副词条优化器队友 buff 输入与伤害管线同源（提交 3336f873）
- **CC-167（CC-165 的推广），结论：零发现。**
  - 扫法：`core/panel.ts` 缺省工厂 + `data/agentPanelStats.ts` 共 116 个初值，非 0 的只有 `critRate` 5、`energyRegen` / `energyRegenOutOfCombat` 1.2、`energyMax` 120、`slot` −1，都是基础属性，全仓没有 `1 + (Math.max(0,)? x.<这些字段>` 的读法（脚本 WSL `/home/kaua/calc-arch/k193/scan194.py`，仓库外）。
  - 补扫 `1 + … ?? 1`（回落值 1 被 `1 +` 包住）：唯一命中 `composables/teamCompare.ts:484` `1 + max(0, (精炼 ?? 1) − 1)`，精炼从 1 起算，写法正确。
  - CC-165 是孤例，**不做 CG 判据**。
- **洛克茜 energyRegen 旁支（r6-refactor-list §2.18 末尾「旁支未决」），结论：读数正确，关闭。**
  - 临时探针（1621 + 1081 + 1031，推荐配装，已删）：局外 `energyRegenBonusPct = 160`、`BonusFlat = 0`，局内同为 160，没有混进局内回能加成；局内面板 `energyRegenOutOfCombat = 1.2 × 2.6 = 3.12` 正确。洛克茜核心被动吃满封顶（冲击 100 → 176.8）。
  - 旁支里「局外面板上是 1.2」的原因：`panelPhases.ts` 只把局外总回能盖在局内面板对象上，局外对象上一直是 emptyPanel 缺省值。
  - 维琳娜的回能转模（唯一的 `applySpecAttributeConversions` 调用方）在 applyPanel 中对局内面板执行，发生在盖章之后，读数正确；柏妮思读的也是局内面板。当时没有任何消费方从局外面板读这个字段（接收槽过滤器席德只读 `atk`，catalog / teammate-buffs 数据里没有引用）。
  - **仍然修（让架构更一致）**：局外总回能算一次，同时盖到局外 / 局内两个面板上。字段名就叫「局外总回能」，局外面板却带着陈旧的缺省值，这正是 CC-127（洛克茜读错回能字段、转模从不触发）那类陷阱：以后谁经 `getOutOfCombatPanel` 或 `sourcePanelPhase: 'outOfCombat'` 读它，就会静默拿到 1.2。
    - 测试：`roxy.test` 新增「两相一致」用例（局外 = 局内 = 基础 × (1 + 局外%) + 局外固定，且 > 1.2 以保证判别力）。反向验证：把 `panelPhases.ts` 换回 HEAD 版本后该用例红（1.2 ≠ 3.12）。
    - zd：DUMP / ROWS 均 0 差异。
- **CC-168：副词条优化器的队友 buff 输入改为与伤害管线同源（可归一，已做）。**
  - 发现：单槽优化器（`composables/substatOptimizer.ts`，ImpactChart 按钮触发，总是贪心）只取原始 `enabledTeammateBuffs`，主管线 `computePanelPhases` 在交给 calcPanel 之前做的 5 步加工它全缺：
    1. 在队模块 `adjustTeammateBuffSource`（莱特 / 耀嘉音来源面板修正）；
    2. 全局 Buff 并入；
    3. 额外能力门控（`evalAdditionalAbilityBuffGates`，14 角色 / 17 条 buff）；
    4. CC-130 接收槽过滤（席德）；
    5. 效果覆盖率表（队友 buff 覆盖率 / 音擎效果覆盖率 / 队伍驱动盘）。
    优化器因此是对着一个和伤害管线不同的面板做优化（例：席德 + 命破队友时仍给队友算「明攻」；覆盖率 50% 的拐按 100% 算）。
  - 修法：把 `computePanelPhases` 里这 67 行原样抽成导出函数 `resolveSlotPanelBuffInputs(slot, configStore, catalogStore)`（返回 `teammateBuffs` / `sourcePanelsByOwner` / `effectCoverageMap` / `team`），`computePanelPhases` 与单槽优化器共用；`OptimizeSubstatsInput.config` 新增可选 `effectCoverageMap`，由 `core/substatOptimizer.ts#computeNoSubstatPanel` 转发给 calcPanel（缺省 = 全部按 100%，与旧行为一致）。
  - 影响面：只影响 ImpactChart 的单槽优化结果；预设 / zd 走 store 层的 `useDefault` 快速路径（`optimizer.useDefault` 缺省 1，`teammateBuffs: []`），不受影响。zd：见本节「验证」。
  - 测试：
    - CC-52 等价用例（莱特 + 耀嘉音 + 丽娜）不变且仍逐值相等（整数分配对来源修正不敏感），文件头已注明。
    - 新增「与伤害管线同源」用例：席德 + 真斗（1441 命破，额外能力不触发），原始上下文里有 `seed.core_vanguard_bright_attack` 的效果，`resolveSlotPanelBuffInputs(1)` 里没有。
    - ⚠ 该用例钉的是抽出函数的过滤行为；「优化器确实调用它」靠代码接线保证，没有 spy 测试（ESM 导出不便 spy）。
  - **未决（不做，写明理由）**：
    - store 层整队贪心（`stores/config.ts` ~800 的非 useDefault 分支）仍用原始上下文。store 层不能反向依赖 composables，要统一需把 `resolveSlotPanelBuffInputs` 下沉到不依赖 store 的层（入参改为 team / 选择表 / catalog 数据），改动面大；而缺省路径不读队友 buff，只有用户手动关掉 `optimizer.useDefault` 且是输出位时才会走到。等有人要用整队贪心时再做。
    - 候选 CC-169：`composables/outOfCombatPanel.ts`（配置页「局外」面板展示）也用原始上下文，并把全局 Buff 事后加到局外面板上，而主管线把全局 Buff 当局内 buff 处理。只影响展示，未立卡实施；做之前要先确认「局外」展示页是否有意包含全局 Buff（CC-51 照搬原页面口径）。
  - 回退点：`git revert 3336f873`（CC-168 与局外回能盖章同一提交；若只退其一，手工还原 `panelPhases.ts` 对应段）。
- **验证**：两次 zd（局外回能盖章后 / CC-168 后）DUMP / ROWS 均 0 差异；`npm run verify` rc=0（内含全量 3820 passed，新增 2 条）；vue-tsc 无新错误；CG 见提交。

### 24.17 CC-169：配置页「局外」面板直接取引擎局外面板；删除无生产消费方的原始队友 buff 上下文组装（第 195 轮，提交 af1c9e86）
- **发现**：`composables/outOfCombatPanel.ts#computeOutOfCombatPanel`（唯一消费方 `TeamConfigPage.vue:1060` 的「局外」模式）是一份独立组装，和引擎局外面板 `computePanelPhases(slot).outOfCombat` 有三处口径差：
  1. 队友 buff 用原始上下文（缺额外能力门控、CC-130 接收槽过滤、`adjustTeammateBuffSource` 来源修正）；
  2. 覆盖率只含音擎效果表（缺队友 buff 覆盖率、队伍驱动盘）；
  3. 把启用的全局 Buff **事后叠加到局外**，而引擎把全局 Buff 当**局内**效果（`resolveSlotPanelBuffInputs` 中 `scope: 'inCombat'`）。
  - 20 多个模块的「初始 X」转化（applyPanel / buildCharConfig 的 `outOfCombatPanel`，如照、本、真斗、薇薇安、克拉蕾、诺姆、柚叶……）读的是引擎局外面板。所以用户在「局外」看到的「初始属性」，未必是引擎做转化用的值。
  - 历史：两种写法都来自初始提交（`git log -S` 两者都止于 1a1f8c65），CC-51 只是把页面写法原样搬进编排层，并不是后来修复时漏掉的，也没有记录说是有意的用户口径。
- **决定**：局外展示 = 引擎局外面板（`computePanelPhases(...).outOfCombat` 的副本），删掉独立组装。
  - 依据：局外展示的用途就是核对「初始属性」；展示一个引擎不用的值会误导人。这也消除了「全局 Buff 两处结算」：判据 19（statModeParity）曾经抓到过两处结算口径分裂（isPctStat）。
  - 口径变化：启用的全局 Buff 不再出现在「局外」，只出现在「局内」（与引擎一致）；队友 buff 门控 / 过滤 / 覆盖率随之一致。伤害零影响（纯展示，`computePanelPhases` 未改）。
  - 回退点：revert 本提交；或在 `outOfCombatPanel.ts` 里恢复「对 `result.outOfCombat` 逐条 `applyTargetedStat` 全局 Buff」的循环（此时要把 statModeParity ②c 的锁行加回来）。
- **连带删除**：`composables/teammateBuffContext.ts`（CC-49 的 `teammateBuffSourceContextFromStores`）。CC-168 与本卡之后它已零生产消费方；它唯一的作用就是组装缺 5 步加工的原始上下文，留着只会诱导误用。其测试 `teammateBuffContext.test.ts` 一并删除。
- **测试**：
  - `outOfCombatPanel.test` 重写：三槽与 `computePanelPhases().outOfCombat` 逐值相等；启用全局 Buff 后局外不变、局内 atk 上升；返回的是副本；空槽为 null。
  - `statModeParity` ②c 删掉 `outOfCombatPanel.ts` 的结算位锁（该文件已不结算），全局 Buff 结算位只剩 `panelPhases.ts`；判据 19 端到端组注明「预览面」现为手工复现的调用形态。
  - `substatOptimizer.test`：CC-52 内联算法改为新口径（`resolveSlotPanelBuffInputs` + `effectCoverageMap`）；「明攻」用例的原始集合改为直接调 core `buildTeammateBuffSourceContext`。
- **验证**：CC-169 部分 `npm run verify` rc=0（3821 passed）；删除 teammateBuffContext 后再跑 verify rc=0（3820 passed，少的 1 条即被删测试）；vue-tsc 无新错误；CG 25 项通过。没跑 zd：`computePanelPhases` 与伤害管线未改，本卡只动展示层。
- **已知坑**：删 src 文件要用 `git rm`（或提交后再跑 CG）。判据 25 `record-key-dead-reads.mjs` 用 `git ls-files` 列文件再 `readFileSync`，工作区已删但索引里还在的文件会让 CG 直接 ENOENT 崩溃。

### 24.18 CC-170 calcPanel 调用方口径普查 + CC-171 引擎面板漏传潜能档（第 196 轮，提交 c727c369）
- **普查**：`grep -rn "calcPanel(" src | grep -v __tests__` 实际只有 5 个生产调用点。ARCHITECTURE-OVERVIEW 原写「9 个文件」已过时（helpers / anomalyPanels / outOfCombatPanel 都已改为经 computePanelPhases 间接调用），本轮已更正。

  | 调用点 | 要的面板 | 队友 buff / 覆盖率 / 潜能 | 结论 |
  |---|---|---|---|
  | `resourceCalc/panelPhases.ts#computePanelPhases` | 引擎局外 + 局内（伤害管线 cfg.panel、配置页两种模式、转化读的 outOfCombatPanel） | `resolveSlotPanelBuffInputs` 全套；潜能**漏传**（CC-171 修复） | 基准口径 |
  | `resourceCalc/panelPhases.ts#computeEntrySnapshotPanel` | 进场记录面板（蕾米埃尔特殊虚耀）：有意**不吃**队友 buff、全局 Buff | 覆盖率 = 音擎 + 队伍驱动盘；潜能**漏传**（CC-171 修复） | 有意不同，已有注释 |
  | `core/teammateBuffSource.ts#buildTeammateBuffSourceContext` | 队友 buff 来源面板：有意不带队友 buff（防递归） | 传了潜能；**没传覆盖率表** | 疑似不一致 → CC-172 |
  | `core/substatOptimizer.ts#computeNoSubstatPanel` | 无副词条起点 | 输入全部由调用方给（单槽已同源，CC-168）；不传潜能（优化器不读面板潜能，无影响） | 有意不同，不改 |
  | `stores/config.ts` ~839 整队贪心的队友面板 | 队友伤害估值 | 原始上下文（CC-168 未决项）；缺省 useDefault 分支不走这里 | 维持未决 |

- **CC-171 发现**：`core/panel.ts:319` 把 `config.potentialLevel ?? 6` 盖章进局外 / 局内面板。但 `computePanelPhases` 和 `computeEntrySnapshotPanel` 都不传 → 管线的 `cfg.panel.potentialLevel` 恒为 6，与潜能滑块脱钩。
  - 读它的 3 处：`burnice.ts` 的 buildBurniceResourceResult 和 burniceMechanicSourceOf（执行 / 异放入参），`jane.ts` 的 buildJaneResourceResult。它们的注释都写着「由 core/panel.ts 写入、与 applyPanel 同源同值」，这个前提实际不成立。来源面板（teammateBuffSource）一直有传，公式变量 `p` 的读数是对的。
  - 实测（修复前，队伍 1171 + 1311 + 1211，推荐配装）：柏妮思 2 潜与 6 潜的 `burniceMechanicSource` 都是掌控 +15、增伤 +12（满潜值）；修复后 2 潜为 +6 / +6（6 档 × II 档系数 1），与 R59 档位表一致。
  - **伤害影响 = 零**：2 潜总伤修复前后都是 33197215.858…。柏妮思潜能对伤害的作用走 `applyBurnicePanel`（拿的是正确的 `input.potentialLevel`）；source 里的潜能加成字段只进资源分区展示。所以本卡是**展示口径修正**：非满潜的柏妮思 / 简，资源分区显示的潜能加成此前按满潜显示。
- **修复**：两处 calcPanel 调用补传 `potentialLevel: char.potentialLevel`（钳位与缺省 6 由 panel.ts 负责）；jane.ts 注释更正。不写角色分支。
- **测试**：新增 `src/composables/__tests__/panelPotentialStamp.test.ts`：
  - 三槽（2 / 4 / 6 潜）的局外、局内、进场快照面板盖章 = 角色设置；
  - 端到端：柏妮思资源结果的潜能掌控加成 = 从 6 潜读数反推的档数 × II 档系数，且 ≠ 6 潜值。

  已确认两条在旧代码上都失败。
- **验证**：`npm run verify` rc=0（3822 passed）；vue-tsc 无新错误；CG 25 项通过；zd 零差（DUMP 与 ROWS 两段 DIFF 0，预设均为 6 潜）。
- **回退点**：revert 本提交（只是两行参数和一个新测试文件）。
- **已知坑（通用）**：calcPanel 的 config 可选字段（`potentialLevel`、`effectCoverageMap`、`sourcePanelsByOwner`）漏传不会报类型错，会被缺省值静默兜底。新增调用点要对照 `computePanelPhases` 的参数表逐项核对，有意不传的写注释说明原因。
- **CC-172（下一张）**：来源面板不传覆盖率表 → 来源角色自身的条件效果（音擎 / 驱动盘）在来源面板里按 100% 覆盖算，而同一角色在自己槽位的主面板按覆盖率算。覆盖率缺省为 100（`wEngineEffectCoverages` 空表 = 100），所以只有用户调低覆盖率，或 `mergeTeamDiscEffectCoverages` 自动算出 < 100 时才有差异。后者若在缺省配置下也生效，就会影响伤害，要跑 zd 并做归因。

### 24.19 CC-172：队友 buff 来源面板的自身条件效果按覆盖率计算（第 197 轮，提交 8bbefaed）
- **发现**（CC-170 普查遗留）：`core/teammateBuffSource.ts` 的来源面板 calcPanel 不传 `effectCoverageMap` → 来源角色自身的音擎 / 驱动盘条件效果按 100% 计算；同一角色在自己槽位的主面板和进场快照面板都按用户覆盖率计算，口径分裂。
- **影响面**：覆盖率三张表（`wEngineEffectCoverages` / `discEffectCoverages` / 队友 buff coverage）缺省都是 100，`mergeTeamDiscEffectCoverages` 只读用户记录、不会自动产生 < 100 的值 → **缺省配置下零差**（zd 零差为证）。只有用户手动调低某个自身条件效果的覆盖率时，才会影响读来源面板的队友 buff（转模类，如按来源攻击力给的 buff）。
- **决定**：来源面板改用「角色自身覆盖率表」。
  - 依据：来源面板的定义是「角色自身配置 + 音擎 + 驱动盘 + 自身 buff，不带队友 buff」（teammateBuffSource.ts 函数注释）。除了不带队友 buff，它应与该角色自身面板同口径；进场快照面板正是同一定义，而且覆盖率组装一模一样。
  - 做法：
    - `panelPhases.ts` 抽出 `selfEffectCoverageMap(configStore, catalogStore)`（音擎覆盖率记录 + 全队驱动盘效果覆盖率，每次返回新 Map），进场快照面板（原内联 IIFE）和 `resolveSlotPanelBuffInputs` 的来源上下文共用；
    - `TeammateBuffSourceDeps` 加可选 `effectCoverageMap`（缺省 = 旧行为 100%，store 层整队贪心仍不传）。
  - 主面板 effectCoverageMap 的组装顺序（音擎 → 队友 buff → 全队盘覆盖）不变。
- **测试**：`src/composables/__tests__/sourcePanelCoverage.test.ts`。
  - 队伍 1091 + 1211 + 1221（避开有 `adjustTeammateBuffSource` 钩子的 1161 / 1311），全队盘效果覆盖率设为 50%：三人来源面板局内 10 个主属性 = 进场快照面板，且至少一人与 100% 时不同。
  - 已确认旧代码失败。
  - 这条恒等式本身就是判据：来源面板 ≡ 进场快照面板（不含 skillLevelBonus 影画补正、来源修正钩子）。
- **验证**：`npm run verify` rc=0（3823 passed）；vue-tsc 无新错误；CG 25 项通过；zd 零差（DUMP 与 ROWS 两段 DIFF 0）。
- **回退点**：revert 本提交；或只删 `resolveSlotPanelBuffInputs` 里传给 buildTeammateBuffSourceContext 的 `effectCoverageMap` 一行（回到来源面板满覆盖，`selfEffectCoverageMap` 抽取保留，零差）。

### 24.20 CC-173 整队贪心不迁移（决定）+ CC-174 calcPanel 生产调用点输入契约（第 198 轮，提交 e0426398）
- **CC-173 决定：选 (c)，不迁移，允许不同源**。对象是 `stores/config.ts#applyBuildRecommendationForSlot` 的非 useDefault 分支（整队贪心，仅当 `optimizer.useDefault` = 0 且为 attack / anomaly / rupture 角色时生效），它用原始队友上下文。
  - 依据：
    1. `ARCHITECTURE.md:12`（R6 C2）规定 store 可调 core、禁调编排层；5 步加工（来源修正 / 全局 Buff / 额外能力门控 / 接收槽过滤 / 覆盖率）依赖 mechanics / specs，无法下沉 core。
    2. (a) 迁出 store：`applyBuildRecommendationForSlot` 在 store 内有 4 个调用流程（`setAgent` :645、初始化 :1274、`applyTeamPreset` :1296、优化器设置 watcher :1335），全要迁；为一个非缺省路径付出的改动面过大。
    3. (b) 注入点：多一个隐式依赖，未注册时仍回落原始路径，两条路径照旧，不更简单。
    4. 缺省路径（useDefault 分支）不读队友 buff；全部预设、zd、测试 harness 都走它，所以伤害基线不受影响。
  - 代价（已知、接受）：用户关闭默认词条后，自动分配与配置页按钮（`composables/substatOptimizer.ts`，同源但无队友估值）可能给出不同分配。
  - 重开条件：useDefault 缺省改为 0；或需要「自动分配 = 按钮」逐值一致。届时做 (a)。
  - 落地：store 分支和 composables/substatOptimizer.ts 头注释都写了决定与重开条件。顺手在两处给 calcPanel / 优化器补传角色真实潜能（估值不读面板潜能，零差）。
- **CC-174 输入契约**：CC-171、CC-172 都是 calcPanel 的 config 可选字段漏传、被缺省值静默兜底，类型拦不住。
  - 不改成类型必填（会让 25 处测试调用补 `undefined` 噪音），改为锁**生产**调用点：新增 `src/core/__tests__/calcPanelCallContract.test.ts`。
    - 生产调用点清单 = KNOWN（panelPhases × 2、teammateBuffSource、substatOptimizer、stores/config）。新增调用点会失败，要先对照 `computePanelPhases` 的参数表核对口径再登记。
    - 每个调用点必须**显式写出** `potentialLevel` 与 `effectCoverageMap`（有意不传写 `undefined` + 注释）。
    - 探测器自检。
  - 配套：`OptimizeSubstatsInput.config` 加可选 `potentialLevel`，透传给无副词条起点面板；单槽优化器与 store 两分支都传角色潜能。
  - 已确认旧代码（HEAD 版三文件）上报 3 处缺键；CC-171 / 172 修复前的状态也会被它拦下。
  - 这是判据不是棘轮：它锁的是「口径必须显式」这条结构约束，没有计数。若日后 calcPanel 的 config 改为类型必填，本测试可废。
- **验证**：`npm run verify` rc=0（3826 passed）；vue-tsc 无新错误；CG 25 项通过；zd 零差（DUMP 与 ROWS 两段 DIFF 0）。
- **回退点**：revert 本提交；契约测试可单独删除，不影响计算。

### 24.21 CC-175：core 可选入参缺省兜底普查 → calcAnomalyDamage 结算区减防 / 减抗契约统一（第 199 轮，提交 be822bc6）
- **普查方法**：脚本 `/home/kaua/calc-arch/k198/scan175.mjs`（列出 core 导出函数中被 ≥2 个生产文件调用、参数含可选字段的）。
  - 以 `CharacterOperationConfig` 为参数的（可选字段 267+）是资源管线内部的数据载体，不属于「调用方选择传不传」的配置对象，排除。
  - 剩下风险最高的是伤害函数 `calcDirectDamage`（10 个可选字段）/ `calcAnomalyDamage`（7 个），它们除伤害池外还被爱丽丝 / 简 / 柏妮思的模块直接调用。其余候选（`buildGiftRow`、`frontlineOccupationBreakdown`、`effectiveTime` 族等）本轮未逐个查，列为 CC-176。
- **发现：两个伤害函数的「结算面板减防 / 减抗」约定不同，各调用点写法混乱**。
  - `calcDirectDamage`：通用减防 / 减抗 / 固定减防**只读入参**，函数内只叠加定向额外量（`getTargetedStatExtra`）和元素量。调用方必须传面板值；伤害池、爱丽丝、简都这么做，正确。
  - `calcAnomalyDamage`（修复前）：函数内读结算面板的减抗、固定减防、异常 / 元素 / 强击专属减防，**唯独不读通用减防**；入参再叠加。结果：
    1. **减抗双计**：4 个调用点（`damagePoolAnomaly.ts` 标准异常、`damagePool.ts` 异放、`alice.ts` 极性紊乱异常、`burnice.ts` 6 命爆发）都把结算面板减抗再传一次。自初始提交 1a1f8c65 即如此。
    2. **标准异常漏通用减防**：标准异常 / 爱丽丝 / 柏妮思入参传 0，函数又不读。2026-09-08 `c56bd57d6` 修「面板减防未进直伤 / 异放」时只修了直伤和异放，护栏 `damagePoolDefDown.test.ts` 头注释认为「异常质量侧（calcAnomalyMass）本来就吃得到」——那只对紊乱 / 乱流成立，标准异常伤害行走的是 calcAnomalyDamage。
    3. **异放固定减防双计**：`c56bd57d6` 在入参里传了面板固定减防，而函数内部本来就读。
  - 参照口径：异常池紊乱 / 乱流（`roundInputs.ts:123-124` 全局减防 / 减抗入参为 0，`anomalyPool/helpers.ts` 从面板内读一次），加上 `docs/mechanism-reference.md:107` 结算区公式（减防、减抗各乘一次）。
- **决定**：calcAnomalyDamage 统一为「结算面板（settlementPanel ?? panel）上的通用减防 / 固定减防 / 减抗及元素、专属量一律由函数内读取；入参只传面板之外的额外量」（如异放 releaseModifier、柏妮思 6 命无视火抗）。
  - 依据：与异常池同一契约，调用方不可能再双计；4 个调用点中 3 个本来就传 0。
  - 不改 calcDirectDamage 的契约（其调用点都正确）。但两个函数的约定不同，已写进 `AnomalyDamageInput` 注释和 ENGINE_PIPELINE_GUIDE 口径表。
  - 改动：
    - `core/damage.ts` 防御区补 `settle.enemyDefReduction`，接口注释写契约；
    - 标准异常 / 爱丽丝：`enemyResReduction: 0`；
    - 柏妮思：只传 `cinema6FireResIgnore`；
    - 异放：`enemyDefReduction: releaseMod.enemyDefReduction ?? 0`、`enemyDefFlatReduction: 0`、`enemyResReduction: releaseMod.enemyResReduction`。
- **伤害影响（这是修复，伤害可升可降，不按方向判对错）**：
  - zd 分两步归因，基线均为 HEAD。
    - **只修 ①**：4 个预设下降，均为 6 命档，面板通用减抗来源为普罗米娅 6 命「异常 / 紊乱无视 15% 抗性」（`promia.ts:147`）等：`1511-1561-1411/c6` −8.83%、`1541-1511-1411/c6` −5.36%、`1541-1561-1411/c6` −4.81%、`1541-1331-1581/c6` −3.74%。
    - **全修**：dump 145 个变化（140 升 5 降），降的就是上面 4 个（数值与只修 ① 时逐位相同）加 `__ms` 计时键。升幅 +0.01% ～ +12.52%，最大 `1401-1411-1031/c6` +12.52%（妮可核心减防 40% 此前不进标准异常）。
  - timeGolden：90 条全部是 `dmg` 字段（52 升 38 降，−12.53% ～ +8.91%），时间账零变化。降幅最大的是 1511 南宫羽 c3+（−10% ～ −12.5%，自带 18% 通用减抗），其余下降角色都是 teammate-buffs 里的通用减抗来源：琉音 C1 15、照 C1 15、柚叶 10、耀嘉音 C1 6、青衣 C6 20、凯撒 C1 15。已按 `TIME_GOLDEN_UPDATE=1` 重生成。
- **测试**：`damagePoolDefDown.test.ts` 新增 3 条（队伍 1511 + 1411 + 1091，抗性全设 0）：
  - 标准异常行吃面板通用减防（比值 = 防御区比值）；
  - 面板通用减抗 20% 对异常行、异放行都是 ×1.2（双计时 ×1.4）；
  - 异放行固定减防只计一次。

  3 条在旧代码上全部失败。
- **验证**：`npm run verify` rc=0（3829 passed；中途一次 zcWorkspace 偶发失败，单跑 9 passed，重跑 verify 干净，含 timeGolden 新基线）；vue-tsc 无新错误；CG 25 项通过；zd 两步见上。
- **回退点**：revert 本提交（连同 timeGolden 基线）。若只想撤修 ②（通用减防），删掉 `core/damage.ts` 防御区的 `settle.enemyDefReduction` 一行，并重生成 timeGolden。

### 24.22 CC-176：CC-175 普查剩余候选 → 伤害池直伤入参拼装收口（第 200 轮，提交 542884bc）
- **发现**：`calcDirectDamage` 的契约「面板通用减防 / 减抗 / 固定减防由调用方传、函数内只加定向额外」本身没错，但**拼装**在三处各写一遍：伤害池正路 `pushDirect`、简 6 命附伤（`jane.ts` extraAnomalyRows）、爱丽丝 6 命附伤（`alice.ts`）。正路后来加了 `infectionElement`（风化染色属性，侵染区），两处模块旁路没跟上。
  - 影响：队里有风属性角色（面板侵染加成 10%，`panelPhases.ts:746`）且染色目标是简 / 爱丽丝本人（物理）时，她们的 6 命附伤漏吃侵染区 ×1.1。
  - zd：2 个预设变化，`auto-1261-1561-1411/c6` +0.02%、`auto-1261-1561-1581/c6` +0.01%（附伤占全队伤害比例小）；另一个 DIFF 项是 `__ms` 计时键。timeGolden 零变化。
- **修法（决定）**：新文件 `src/composables/resourceCalc/poolDirectDamage.ts`，`calcPoolDirectDamage(env, row)` 是伤害池直伤的**唯一入参拼装点**。
  - `PoolDirectEnv`：敌人（防御 / 等级 / 失衡易伤）、抗性表、染色属性，同一次建池内不变；由 `damagePool.ts` 构造为 `directEnv`，经 `AnomalyRowsEnv.directEnv` 传到派发点。
  - `PoolDirectRow`：面板 + 行级量；减防 / 减抗只传行级额外量（`defIgnore` / `resIgnore`），面板通用值由函数读。
  - 正路 `pushDirect` 直接调；模块经新字段 `ExtraAnomalyRowsInput.directDamage` 闭包调，`jane.ts` / `alice.ts` 不再 import `calcDirectDamage`。
  - 依据：让「新增一个环境量」只改一处（架构更简单），而不是给两处旁路各补一个参数。简 / 爱丽丝附伤注释早就写明「走标准直伤管线、其余乘区全吃」，所以补侵染区是按原意修正，不是新口径。
- **其余候选逐个核对（已查无问题）**：
  - `calcDirectDamage` 旁路其余可选字段：`specialDamageProfile` 对异常角色取缺省 normal 档，与正路 `resolveSpecialDamageProfile` 结果一致；`skillDamageTarget` 不传是有意（附伤不属于任何招式类型，不吃招式定向增伤）；`critRateBonus` 等行级加成正路也只在特定招式行上有。面板同源（派发点 `panelAt(damagePanels, slot)` 与正路一致）。
  - `buildGiftRow`（core/resource/giftRows.ts）：纯行对象构造，没有「函数内读 + 调用方传」的混合结构。引擎物化的赠行（assembleSlot.ts:139/149）不填倍率 / 喧响是有意（只定存在与行序），编排层 `chainGift.ts` / `ultimatePromote.ts` 的补丁按池口径重写全部字段（含 `decibelRecovery` / `totalDecibelRecovery`）。
  - `frontlineOccupationBreakdown`（core/resource/timeOccupation.ts:70）：读结果对象，无入参契约问题。它有「只有团队级 `axisOverlapSeconds`、无按块分摊」的兜底分支（注释写「老注入路径 / 测试」），生产是否还会走到未查，记入 CC-177 顺带项。
  - `effectiveTime` 族（`TimeBasisCfg` 缺省 180s / 无敌 0s）：生产调用都传角色 cfg，而角色 cfg 由唯一构造点 `composables/resourceCalc/helpers.ts:536` 写入 `battleTime` / `invincibleTime` / `bodySize`（:604–606，读 `configStore.enemy`），缺省值只在测试生效。
    - ⚠ 排查时踩的坑：一度以为这几个字段「全仓零写入」，原因是 grep 时用 `grep -v 'enemy\.'` 滤噪音，把构造点那几行也滤掉了。查「零写入」时不要用会命中赋值右侧的排除模式。
- **判据**：`src/mechanics/__tests__/jane.test.ts`「CC-176：附伤经 input.directDamage 拼装，染色属性=物理时吃侵染区 ×1.1，=风时不吃」。旧 `jane.ts` 上该用例失败（已验证）。四个模块测试的输入桩补了 `directDamage`（简 / 爱丽丝 / 柏妮思用真实 `calcPoolDirectDamage` + 桩环境；蕾米埃尔不产直伤，桩直接抛错）。
- **验证**：`npm run verify` rc=0（3830 passed）；vue-tsc 无新错误；CG 25 项通过；zd 见上。
- **回退点**：revert 542884bc。若只想撤掉侵染区修正而保留收口，在 `damagePoolAnomaly.ts` 派发点给 `directDamage` 传一个 `infectionElement: ''` 的 env 副本即可（零差回到旧数值）。

### 24.23 CC-177：异常伤害入参拼装收口（第 201 轮，提交 8fc869d0）
- **做了什么**：`calcAnomalyDamage` 的 4 个调用点（伤害池标准异常 `damagePoolAnomaly.ts`、异放 `damagePool.ts#pushRelease`、爱丽丝极性强击、柏妮思 6 命灼烧迸发）改走 `calcPoolAnomalyDamage(env, row)`。
  - 与 CC-176 的 `calcPoolDirectDamage` 放同一文件：`src/composables/resourceCalc/poolDirectDamage.ts` 用 `git mv` 改名为 **`poolDamage.ts`**（§24.22 里的旧文件名是历史记录，以本节为准）。
  - 环境类型 `PoolDirectEnv` 改名 **`PoolDamageEnv`**，并收进 `anomalyMultiplier`（= `globalAnomalyMultiplier`；4 处原本都传这个值）。`damagePool.ts` 的局部量 `directEnv` 改名 `poolEnv`。
  - `PoolAnomalyRow` 只带面板 / 结算面板 / 倍率 / 失衡覆盖 / 异放暴击覆盖，以及**面板之外**的 `extraDefReduction` / `extraResReduction`。敌人防御 / 等级 / 抗性 / 失衡易伤、`critMode: 'expect'`、固定减防 0 都由拼装点给出。
  - 模块经新字段 `ExtraAnomalyRowsInput.anomalyDamage` 调用；`alice.ts` / `burnice.ts` 不再 import `calcAnomalyDamage`，也不再解构 `enemy` / `enemyDamageRes` / `anomalyMultiplier`。四个模块测试共用桩环境 `STUB_ENV`（jane / alice / burnice 用真实拼装函数，remielle 桩直接抛错）。
- **依据**：CC-175 的三个 bug 都出在「各调用点自拼入参」上。收口后，异常伤害的契约（面板减防减抗由函数内读，调用方只传额外量）落在唯一一处，新增环境量只改 `PoolDamageEnv`。
- **验证**：纯重构，zd 的 dump 与 rows 都是 DIFF 0；verify rc=0（3830 passed）；vue-tsc 无新错误；CG 25 项通过。
- **回退点**：revert 8fc869d0（会连同改名一起回退；CC-176 的收口不受影响）。

### 24.24 CC-178：删除合轴节省团队级总量 `axisOverlapSeconds` 及两处兜底（第 201 轮，提交 9daca673）
- **发现**（CC-177 顺带项）：合轴节省有两份表示，团队总量 `axisOverlapSeconds` 和按块分摊 `axisOverlapByAction`。两处读取点在「分摊为空」时回落到团队总量：
  - `core/resource/timeOccupation.ts#frontlineOccupationBreakdown`：`teamLevel` 分支；
  - `core/resource/helpers.ts#iterate`：`hasByAction` 为假时，`reliefSeconds = max(Σ抵扣, 团队总量)`。
- **为什么走不到（静态证明）**：栈引擎 `core/stunAxisStack.ts:241–245` 在同一循环里同时累加 `overlapSeconds += share` 和 `overlapByAction[key] += share`（Σ 分摊 = 总量）。编排层 `convergence.ts` 把两者从同一个栈结果取出。所以生产中不存在「总量 > 0 而分摊为空」的状态：
  - `teamLevel` 分支只有 `comboAlignBudget.test.ts` 手搓的结果对象在走；
  - `iterate` 兜底在分摊为空时，团队总量也恒为 0，两个公式都退化成 Σ 抵扣，逐位等价。
- **做了什么**：删除两处兜底；删除团队总量字段（`ResourceCalcConfig` / `TeamResourceResult` 类型、`convergence.ts` 注入、`resource.ts` 上报）。删除后它只写不读，全仓（含 .vue、perf 脚本、基线 JSON）零读者。按块分摊成为唯一表示，要总量就求和。测试删掉「只有团队总量」的子用例。栈引擎内部的 `overlapSeconds`（`StackTraversalResult`）保留：它是栈的输出，探针测试在读。
- **依据**：同一物理量只留一份表示，删除只为测试存在的分支（架构更简单）。不是为了降计数。
- **验证**：
  - zd 直跑 DIFF 624。原因是 dump 第 2 段哈希覆盖整个 `resourceResult`，删字段本身就改变哈希；伤害数值和另两段哈希都没变（逐段统计：只有第 2 段变）。
  - 给 zd 加了 `ZD_DROP` 后重跑 `ZD_DROP=axisOverlapSeconds bash .zc/perf/zd.sh cc178d`：dump 与 rows 都是 DIFF 0。
  - verify rc=0（3830 passed）；vue-tsc 无新错误；CG 25 项通过。
- **回退点**：revert 9daca673（纯删除，无数值影响）。

### 24.25 普查顺带：注释自称「老路径 / 测试兜底」的缺省（第 201 轮，未改代码）
- `grep -e 老注入 -e 老路径 -e 旧路径 -e 仅测试 -e 只有测试 -e 测试兜底 -e 老调用 -e 旧调用方 src`（非测试），命中 4 处：
  - `timeOccupation.ts`：本轮 CC-178 已删，命中的是新注释本身；
  - `core/anomalyPool/helpers.ts:1189`：`calcTurbulenceDamage` 的 `agentMechanics` 缺省时不结算风蚀。生产唯一调用链是 `roundInputs.ts:118` → `calcAnomalyPool`（传 `getRegisteredAgentMechanics()`）→ `anomalyPool.ts:314`，始终会传；`corrosion.ts` 头注释已登记为「已知语义差，可接受」。无问题，但属于「缺省值静默改变结果」一类，列入 CC-179；
  - `mechanics/agents/xide.ts:150/164`：`oocAtkOf` 拿不到时回退 `level60.atkBase`，只有测试手搓 cfg 会走到。无问题。

### 24.26 CC-179：core 输入「可选只为测试方便」的字段普查（第 202 轮，8aba58f5）
- **扫描器**：`/home/kaua/calc-arch/k202/scan179.cjs`（cwd = 仓库根，`node … > scan.tsv`，约 5s）。对 core 导出函数 / 输入接口的每个可选字段，统计**全部**生产调用方是否都传（含只有 1 个生产调用方的函数——scan175 漏的那类）。分类：ALL 146（都传）/ NONE 14（都不传）/ SOME 27（部分传）/ SPREAD 15（经展开传入、静态看不出）。SOME 与 SPREAD 已逐条看完。不进 scripts/（一次性普查工具，进仓库就要维护、要过 CG；需要时从 calc-arch 复制，回退成本零）。
- **判据**（沿用卡面）：缺省会静默改变结果 ⇒ 改必填，测试显式传；缺省不改变结果 ⇒ 不动，写「不做」加理由。
- **结论 1：`AnomalyPoolInput.agentMechanics` 改必填（做）**。缺省不仅不结算风蚀，还会**静默跳过全部 `transformAnomalyPool` 钩子**（`anomalyPool.ts` 原 `?? []`）。连带：`calcTurbulenceDamage`、`corrosion.ts` 的 `resolveAnomalyCorrosionSource` / `resolveAnomalyCorrosionEvents` 参数去掉 `| undefined` 与 `if (!agentMechanics)`；`corrosion.ts` 头注释的「已知语义差」改为「已必填、已消除」。测试补 `agentMechanics: []`（onStunBuildup ×2；agentMechanicViewCc71 的 `undefined` 用例改 `[]`）。anomalyPool.test 各调用已经传了，不用补。
- **结论 2：`CrossAgentSupplyQuery.teamSize`：账本补传（做）**。
  - 现状：赠送目标槽共有四处消费。`foldLoop`、`underfillProbe`、`tailPipeline`（以及行口径 `chainGiftRowSpec` / `ultimateGiftRowSpec`）都传 `config.teamSize`；只有账本 `resource/helpers.ts#iterate` 的 `crossAgentSupplyAt` / `ultimateGiftOf` 没传，回落到 `configs.length`。
  - 两者差在哪：`configs` 是压缩数组，只含已配置角色（`useResourceCalc.ts:106`）；`teamSize = configStore.team.length`，含空槽（`convergence.ts:673`）。满编时相等；退化配置时不同。
  - 修法：`iterate` 两处传 `teamSize: globalCfg.teamSize`，四处同源，与编排层 `chainGift.ts:51`、`ultimatePromote.ts:212` 一致。顺带改正 `types/resource/config.ts#teamSize` 注释（原说「账本 / 试探仍用 configs.length」，实际只有账本如此；引用的 `giftRowTargetSlot` 已不存在）和 `tailPipeline.ts` 两处同类注释。
  - **退化配置探针**（`k202/probe202.test.ts`，临时放进仓库跑完即删；无推荐配装）：

    | 队伍 | 旧：总伤 / 艾莲 nec | 新：总伤 / 艾莲 nec | 行数 |
    |---|---|---|---|
    | 琉音 / 空 / 空 | 697096 | 697096（同） | 15 = 15 |
    | 琉音 / 艾莲 / 空 | 2040657 / 77.807 | 2041086 / 77.435 | 29 = 29 |
    | 空 / 琉音 / 艾莲 | 2040657 / 77.807 | 2041086 / 77.435 | 29 = 29 |
    | 艾莲 / 琉音 / 空 | 2302721 | 2302721（同） | 32 = 32 |

    解读：旧版账本按 2 人环绕，把琉音的赠大算给艾莲、给她扣了必要时间；行口径按 3 人环绕，目标下标 2 不存在，赠行从未出现（两版行数相同）⇒ **账本给不存在的行预留时间**。新版两边一致（都不赠），总伤 +0.02%。单角色时两版逐位相同（自赠已由别处挡住）。
  - **仍然错的部分转 CC-180**：在 `configs` 下标空间里用含空槽的队长做环绕，本身就不对（上表第 2、3 行赠送丢失；第 3 行在槽位空间里「上一位」是空槽 0，是否该环绕到槽 2 需按规格定）。修法：在槽位空间（`cfg.slot`）解析目标，再映射回下标；同批覆盖苍角 / 露西 / 丽娜的 `perTargetAmounts` 与 `neighborUltEnergy` 相关 teamSize 读法。
- **结论 3：`CrossAgentSupplyQuery.axisMode`：不做**。只有琉音 `gift-chain:ultimate` 声明了 `axisSuppressed`，`ultimateGiftOf` 的 4 处调用都传了 axisMode；`crossAgentSupplyAt` 的 4 处调用只查 `gift-chain:chain`（诺姆），不声明 axisSuppressed，缺省不改变结果。**隐患**：将来若有 chain 类提供者声明 `axisSuppressed`，这 4 处会静默失效——加这类提供者时必须同时给 4 处补传 `axisMode`（或届时改必填）。
- **余项（未判，转 CC-181）**：`calcStunPool` 输入的 `enemyStunResistance`（单数）生产从未传，疑似遗留字段；wEngine ctx 中未传的若干字段；`guaranteeStunShortfall` 的 `target` / `minGainRatio`、`decomposeSet` 的 `coverage` 为默认参数，需确认默认值合理。清单在 `k202/scan.tsv` 的 NONE / SOME 行。
- **验证**：vue-tsc 无新错误；zd（cc179）dump / rows 均 DIFF 0（满编预设 teamSize = configs.length）；verify VRC=0；CG 25 项通过。
- **回退点**：revert 8aba58f5。只回退 teamSize 部分：删 `resource/helpers.ts#iterate` 的两行 `teamSize:`。

### 24.27 CC-180：队友落点统一在编队槽位空间按已上场序列解析（第 203 轮，7f320498）
- **问题**：「上一位队友」有三套写法、两个空间混用。
  - 引擎 `crossAgentSupplyAt`：用含空槽的 `teamSize`（3）在 `configs` **压缩下标**里环绕；
  - 引擎轴分支 `ultimateGiftOf` / `ultimateGiftRowSpec`：把编排层给的**编队槽号**当成 `configs` 下标；
  - 编排层 `chainGift` / `ultimatePromote` / `convergence`：在编队槽空间用 `team.length`（3）环绕，落到空槽就赠送丢失；
  - 琉音额外能力 `buildLiuyinCharConfig`：私有的 `resolvePreviousTeammateSlot(slot, team.length, …)`，`team` 定长 3 槽，同样会落到空槽。
- **口径决定：跳过空槽**（已上场序列里的上一位，环绕）。依据：游戏换人顺序只含上场角色，没有「空槽」这一位（两人队的上一位 = 另一人）；邻位回能（苍角 / 丽娜 / 露西）本来就这样算（模块注释「两人队另一位 30」）。没有找到官方原文专门说空槽；这是按游戏机制推出的结论。**回退点**：改 `targetSlot.ts#resolveTeammateTargetSlot` 一处（例如让空槽落空），全部调用方随之改变。
- **做法**：
  - `resolveUltimateTargetSlot(own, teamLength, setting)` → `resolveTeammateTargetSlot(own, occupiedSlots, setting)`。入参和返回值都是**编队槽位**。手动设置指向空槽或自己时回落到自动；**没有队友时返回 -1（不赠）**。旧式在 teamLength=1 时返回自己；新口径下探针复现了单琉音自赠 7.2s，所以显式排除。这也保住了 ENGINE_PIPELINE_GUIDE 第 32 条「单角色诺姆不预留赠链时间」的修正。
  - 引擎：用 `cfg.slot` 与 `configs.map(c => c.slot)` 解析，再 `findIndex` 映射回下标。模块钩子 `crossAgentSupply.targetSlot` 的入参由 `{ ownSlot, teamSize }` 改为 `{ ownSlot（编队槽）, occupiedSlots }`，返回编队槽。
  - 编排层：已上场序列取资源结果的 `characters.map(c => c.slot)`，与引擎 `configs` 同源。不用 `team[i].agentId`，因为 catalog 缺角色时 `buildCharConfig` 会返回 null，两边会不一致。
  - 琉音额外能力：改走同一函数（`team.filter(m => m.agentId && m.agent)`），删除 `resolvePreviousTeammateSlot`。
  - **删除 teamSize 整条链**：`ResourceCalcConfig.teamSize`、`CrossAgentSupplyQuery.teamSize`、`CrossAgentSupplyInput.teamSize`（没有模块读它），以及 `perTargetEnergyByProvider` / `neighborUltEnergyByProvider` 的 `query` 参数（原本只为传 teamSize）。邻位回能 `perTargetAmounts.teamSize` 保留，固定为 `configs.length`（已上场人数）。§24.26 的「四处同源读 config.teamSize」由此作废：现在四处同源于 `configs[].slot`。
- **探针**（`/home/kaua/calc-arch/k202/probe202.test.ts`，无推荐配装，临时放进仓库跑完即删）：

  | 队伍 | CC-179 后 | CC-180 后 |
  |---|---|---|
  | 琉音 / 空 / 空 | 697096，预留 0 | 697096，预留 0（同） |
  | 琉音 / 艾莲 / 空 | 2041086，29 行，预留 0 | **2302721，32 行，预留 5.049** |
  | 空 / 琉音 / 艾莲 | 2041086，29 行，预留 0 | **2302721，32 行，预留 5.049** |
  | 艾莲 / 琉音 / 空 | 2302721，32 行，预留 5.049 | 2302721（同） |

  两人队三种站位现在逐位相同，原本差 12.8%。归因（`k203/probe203b.test.ts` 去掉槽号后逐行对比）：
  - 赠大 2 行：旧版落到空槽后丢失；
  - `liuyin-ex-direct`（16 次，约 127 万）：旧版琉音在槽 0 时「上一位」落到空槽 2，面板取不到，整行丢失（仅这一项就占 3.4%）。
  - 修复后剩下的差异只是行 id 里的槽位号。
- **验证**：vue-tsc 无新错误；zd（cc180b，最终代码）dump / rows DIFF 0（满编与单角色预设不变，含 `agent:1571:c0/c6`）；verify VRC=0（3832 passed）；CG 25 项通过；`targetSlot.test.ts` 改写并补了空槽用例。
- **回退点**：revert 7f320498（单提交，含 teamSize 删除）。

### 24.28 CC-181：CC-179 普查余项（第 204 轮，e0fdf806）
逐项判定，判据同 CC-179：缺省会静默改变结果 ⇒ 改必填；缺省无人传且无意义 ⇒ 删；缺省有意义 ⇒ 不动。
- **`StunPoolInput.enemyStunResistance`（单数）：删**。注释写「兼容旧调用」，全仓零写入（生产、测试都没有），只作 `enemyStunResistances[element]` 查不到时的兜底，缺省 0。删后兜底直接写 `?? 0`，逐位等价。
- **`WEngineConditionContext.wearerAgentId / wearerSpecialty / enemyWeakness`：不做（扫描器误报）**。两个函数共用这个上下文类型，但各读一个子集：`wEngineConditionMet` 只读 `wearerAttribute` 和 `enemyWeakness`，`wEngineEffectRequirementMet` 不读 `enemyWeakness`。扫描器报的「未传」正好是对应函数不读的字段。`enemyWeakness` 可选有语义（空 = 没选 Boss，不拦截），而且 calcPanel、teammateBuffSource、collectAllBuffs 的全部生产通路都传了（scan.tsv 为 ALL）。**扫描器局限**：它按类型字段统计，不看函数实际读哪些字段；复用时 NONE 行要先查被调函数读不读。
- **`guaranteeStunShortfall(…, target = GUARANTEE_STUN_TARGET)`：删形参**。生产和测试都没传过；弹刀反推（`convergence.ts` 的 `targetStunCount: GUARANTEE_STUN_TARGET`）和诊断用的是同一个常量。留着形参只会让诊断有机会和反推用两个不同的目标，所以函数内改为固定用常量。
- **`computeOptimalSubStats` 的 `minGainRatio`：发现并修正一处不一致**。`pruneAndRankSets`（Top-K 套装排名）调 `greedyAllocate` 时漏传阈值，固定用 0.05；最终分配却用「模板 > 用户 > 0.05」（蕾米埃尔模板 0.15）⇒ 排名和最终分配按两套停止规则算。现在排名也传同一个 `minGainRatio`。
  - 这个差异从初始提交就在，没有找到说明它是有意设计的记录。
  - 影响只落在带模板覆盖的角色，目前只有蕾米埃尔。探针（`/home/kaua/calc-arch/k204/probe204.test.ts`：5 支队伍 × 有无推荐配装，`computeSubstatAllocationForSlot`）新旧**逐位相同**，所以这是零差的一致性修正。
  - 用户层 `input.minGainRatio` 生产不传，保留：它是算法调参入口，缺省 0.05 有注释。
- **`decomposeSet(…, coverage?)`：删形参**。两处调用都不传，恒为 1。**但由此暴露一处语义差，另立 CC-182**：优化器分解套装时 4 件套条件效果按 100% 生效，伤害管线按 `effectCoverageMap` 打折 ⇒ 条件型 4 件套在套装排名里被高估。本卡不修，因为修了会改变优化结果，需要单独判断。
- **不在本卡范围**：scan.tsv 的 SOME 行（`buildGiftRow` 的可选行字段、`calcStunAxisStack` 的 bySlot 等）属于「按调用场景选传」，第 202 轮已逐条看过，不改。
- **验证**：vue-tsc 无新错误；zd（cc181）dump / rows DIFF 0；verify VRC=0；CG 25 项通过。
- **顺带修复第 203 轮留下的红灯**：203 轮在 `ENGINE_PIPELINE_GUIDE.md` 第 32 条追加了 3 行，让 §4 从 718 行涨到 721 行，打红 `checkGuards.test`（判据 11 棘轮）。当轮 verify 是在**提交文档之前**跑的，所以没发现。现已把第 32 条那段就地改写（删掉过时的 teamSize 句子），行数回到 718，没有改登记表。教训已写进 worker-queue 已知坑。
- **回退点**：revert e0fdf806。三处删除都逐位等价；只有排名阈值一处会改变非零差场景的行为。

### 24.29 CC-182：副词条优化器只为已装备套装分配（第 205 轮，85956a53）
- **卡面原问题（覆盖率）核实后不成立为主因**：
  - 伤害管线的覆盖率口径 = `effectCoverageMap.get(id) ?? effect.coverage.default ?? 1`（`buff.ts#applyEffect`）。catalog 30 套驱动盘、78 个效果里有 35 个带 `coverage`，`default` **全部是 1**。
  - `mergeTeamDiscEffectCoverages` 只为**已装备**套装写 map（用户没设时是 100%）。
  - ⇒ 默认状态下，优化器「按 100% 分解」与伤害管线一致；只有用户调低已装备套装的覆盖率时才有差。
- **读代码时发现的真问题（比覆盖率大）**：`computeOptimalSubStats` 的 `basePanel = computeNoSubstatPanel(input)` 只清空副词条，**保留当前 4+2**，是带套装效果的局内面板。Top-K 套装排名和最终贪心又在它之上叠加候选套装的等效词条 ⇒
  - 当前套装在「当前组合」里被计两次；
  - 其他组合 = 已装备 + 候选两套同时生效；
  - 最终分配是为 `topCombos[0]` 算的，但 `chosenSet` **生产零读取**（grep 仅 core 自身），套装不会被换 ⇒ 按钮输出的是一个**不存在面板**的最优分配。
- **修法**：已装备任一套装 ⇒ 直接在 `basePanel`（真实面板，覆盖率已由 calcPanel 按 map 计入）上贪心，候选分解为空；`chosenSet` = 已装备。只有一件套装都没装时才走套装搜索（此时 basePanel 不含套装效果，不重复）。覆盖率问题随之消失（已装备走 calcPanel；搜索路径没有已装备套装，map 里没有条目 ⇒ 默认 1 = catalog default）。
- **影响面**：只影响贪心路径——配置页自动分配按钮（`composables/substatOptimizer.ts#computeSubstatAllocationForSlot`）、`ImpactChart.vue`、store 整队贪心（仅 `optimizer.useDefault=0`）。预设与 zd 走 `useDefault` 快速路径，zd DIFF 0。
- **按实际伤害对照**（`/home/kaua/calc-arch/k205/probe205.test.ts`：62 个角色单人队、推荐配装，把优化结果写回副词条后读 `teamTotalDamage`；数据在 `k205/old.tsv`、`k205/new.tsv`，列 = id、套装、推荐副词条伤害、优化后伤害、分配）：
  - 48 个角色分配不变；14 个变化：6 升 8 降，平均 −0.77%。最差 1091 星见雅 −5.8%、1541 普罗米娅 −3.1%；最好 1281 +0.49%。
  - 相对「推荐配装自带副词条」：旧版平均 +3.15%（36 胜 18 负），新版 +2.96%（37 胜 17 负）⇒ **整体持平**。
  - 降的 8 个里 7 个是异常角色，新版都把攻击挪去精通 ⇒ 打分函数 `computeExpectedScore` 对异常角色高估精通、低估攻击。旧版的双计恰好把它们往攻击推。
- **决定：合入**。依据：结构上正确且更简单（不再叠加幻影套装，已装备时跳过整个套装搜索）；按目的指标（实际伤害）持平；旧版在个别角色上的优势来自偶然偏差，不可依赖。打分函数与伤害管线的偏差另立 **CC-183**，用本探针做验收。
- **验证**：vue-tsc 无新错误；zd（cc182）dump / rows DIFF 0；verify VRC=0；docs 改完跑 checkGuards.test。
- **回退点**：revert 85956a53（只改 `core/substatOptimizer.ts` 一处分支）。

### 24.30 CC-183：副词条优化器以真实伤害精修（第 206 轮，20a47df3）

- **问题**：打分函数 `core/substatOptimizer.ts computeExpectedScore` 是闭式近似（直伤 = 攻击 × 暴击 × 增伤，异常 = 攻击 × 精通），和伤害管线有偏差：CC-182 探针显示它高估精通和暴击、低估攻击。
- **逐个候选实测**（探针 `k205/probe205.test.ts`：62 个角色单人队、推荐配装，读 `teamTotalDamage`；基线 `k205/new.tsv` = 相对推荐副词条平均 +2.96%、37 胜，最差 1611 −28.01%）：
  - ① 百分比副词条改乘基础值（`calcBasePanel`：角色 + 音擎基础攻击）：平均 +2.21%、21 胜，最差非 1611 个例 1581 −16.2%。**不做**。原因：伤害管线口径是「局内攻击 = 局外攻击 ×（1 + Σ局内攻击%）+ 固定」（`buff.ts recalcCoreStat`），副词条攻击% 进局外层，还会被局内攻击% 再放大一次；① 漏了这层放大，比旧版乘最终攻击偏得更远。
  - ①′ 面板增量改由 calcPanel 探针得出（每个词条 +10 步取平均，逐字段线性叠加，与伤害管线同源；补丁留在 `/home/kaua/calc-arch/k206/p206b.diff`）：平均 +2.35%、30 胜。**不做**。面板已经精确，结果还是差，说明偏差在打分式本身：它看不到技能级乘区（技能专属暴击 / 增伤 / 倍率、直伤与异常的真实占比）。
  - ②（异常线性）、③（写死的 anomalyRatio）**不再逐个校准**：它们都属于「近似式看不到的伤害管线结构」，逐项补就要把伤害管线重写一遍。
- **采用**：编排层 `composables/substatOptimizer.ts computeSubstatAllocationForSlot` 新增可选参数 `refine: { readDamage, maxEvals? }`。以引擎分配为起点，在模板词条间「挪 k 步」爬山：k 依次取 4、2、1，找到第一个改进就接受；默认最多评估 80 次。评估方式是写入分配后读 `teamTotalDamage`（惰性 computed 加 state memo，和 teamCompare 的「改 store → 读 → 恢复现场」是同一模式），结束时恢复原分配。唯一的生产调用方 `ImpactChart.vue runOptimizerForSlot0` 已接入，并把 ETA 改为 0.3 秒 / 点。
  - 实测（`k206/c2r.tsv` 与 `k206/c0r.tsv`）：平均 **+4.85%、47 胜，最差 1611 −25.17%**；36 个角色分配改变，**36 升 0 降**。最大提升：1591 +20.2%、1431 +11.3%、1581 +10.8%、1571 +10.1%、1321 +9.9%、1091 +7.7%。
  - 精修后，核心打分用旧版还是 ①′，结果只差 1 行，伤害相同 ⇒ 核心近似只影响起点，因此 ①′ 不合入。没有精修的路径（store 整队贪心，`optimizer.useDefault=0`）上 ①′ 会变差。
  - 耗时：62 个角色从 3.3 秒增到 16.1 秒，即单人队每个角色约多 0.26 秒。
- **为什么这样做更通用**：以后伤害管线怎么改，副词条分配都自动跟着走，不用再维护一套平行的近似式；core 层不感知角色，也不需要按角色校准。
- **未覆盖**：store 整队贪心（config.ts:~802，store 不反向依赖 composables，见 CC-173）和默认 useDefault 快速路径都不精修。预设和 zd 走 useDefault，zd 不受影响。1611 −25% 的原因不在打分：模板只有 critRate 和 defPct，步数预算也和推荐配装不同，另立 CC-184。
- **验证**：vue-tsc 通过；新用例 `substatOptimizer.test.ts`「refine：…」钉住以下几点：1591 严格改进、恢复原分配、步数总和不变、maxEvals 封顶。verify EXIT=0，3833 个用例通过。zd 未跑：core 和 useDefault 路径零改动，预设和 zd 都不经过 refine。
- **回退点**：revert 20a47df3（改 composable、ImpactChart、测试三个文件；core 未改）。

### 24.31 CC-184：贪心分配补满步数预算（第 207 轮，ae935755）

- **定位**（临时探针 `/home/kaua/calc-arch/k207/p1611.test.ts`）：1611 克拉蕾，模板 `[critRate, defPct, critDmg]`，锋御。推荐配装走 useDefault 快速路径，结果 `{critRate:20, defPct:19}` = 39 步；贪心结果 `{critRate:20}` 只有 **20 步**，精修只能挪步，最多挪成 11+9。1441 同理：推荐 39 步，贪心 35 步（hpPct 为 0）。
- **根因**：打分式只认攻击，克拉蕾吃防御、1441 等吃生命，这些属性的边际恒为 0。暴击填满后所有边际都是 0，`greedyAllocate` 触发 `minGainRatio` 提前终止（或每步 bestStat 为空），剩余预算就浪费了。这不是个例：凡是主属性不是攻击的角色，贪心都会少分步数。
- **修复**：`core/substatOptimizer.ts greedyAllocate` 在贪心循环结束后，把剩余预算按模板优先序补满（每个词条不超过 statCap），口径和 useDefault 快速路径「按模板优先序填到上限」一致。依据：游戏里副词条不会空着，未分配的步数在现实中必然落到某个词条；边际确实接近 0 时，补满也不会让结果变差。`minGainRatio` 保留，但语义从「停止分配」变为「停止按打分式分配」。
- **实测**（62 个角色，探针同 §24.30）：
  - 开精修（`k207/r1.tsv` 对比 `k206/c2r.tsv`）：平均 +4.85% → **+6.47%**，47 → **54 胜**，最差 1611 −25.17% → **0.00%**（所有角色都不低于推荐配装），22 个角色分配改变，10 升 0 降。1611 +35.5%；1121 +12.7%；1531、1051、1371、1471 各升 10% 以上。
  - 不开精修（`k207/n1.tsv` 对比 `k205/new.tsv`，即 store 整队贪心路径）：平均 +2.96% → +3.63%，最差 −28.01% → −10.94%（1531），3 升 0 降。
- **影响面**：只影响贪心路径（配置页按钮 / ImpactChart / store `optimizer.useDefault=0`）。useDefault 快速路径、预设、zd 都不经过 greedyAllocate，所以不跑 zd。
- **验证**：vue-tsc 通过；新用例 `substatOptimizer.test.ts`「贪心分配用满步数预算」（1611 贪心总步数 = 推荐 39 步）；verify EXIT=0。
- **回退点**：revert ae935755（core 一处循环后补段加一个测试）。

### 24.32 CC-185：编排层优化器只剩「快速分配起点 + 真实伤害精修」（第 208 轮，0e4e7ecf）

- **问题**：CC-183 / 184 之后，打分式贪心只负责给精修一个起点（§24.30 已证明换打分式对精修结果零影响）。那么起点是否还需要贪心？
- **实测**（临时开关，已删）：
  - 62 个角色单人队（`k208/g.tsv` 贪心起点、`k208/d.tsv` 快速起点，都开精修）：平均 +6.47%，54 胜，最差 0.00%，**两者完全相同**。4 个角色分配不同（1071 / 1271 / 1421：hpPct↔defPct；1621：defPct 5→3、critRate 14→16），伤害差为 0。精修评估次数合计 1244 对 1291，单个角色最多 56 对 50，均未碰到 maxEvals=80。整轮耗时 21 秒对 17 秒（快速路径省去贪心和候选套装计算）。
  - 7 支三人队、21 个槽位（`k208/p208team.test.ts`：含蕾米埃尔在前 / 在中两种站位、克拉蕾、仪玄队、1441 队等）：两种起点精修后的**真实伤害全部零差**。三人队每次精修约 0.9 秒。
- **决定**：`composables/substatOptimizer.ts computeSubstatAllocationForSlot` 只保留一种模式。起点调 `computeOptimalSubStats({ …, useDefault: true })`，然后无条件做真实伤害精修，`refine` 参数改为必填（唯一的生产调用方 ImpactChart 本来就一直在传）。编排层从此不依赖打分模型（anomalyRatio、atkWeightInAnomaly、teamAtkTransfer、套装剪枝）。队友 buff 输入（`resolveSlotPanelBuffInputs`）保留，只用于起点的百暴缺口，保持和伤害管线同源。
- **core 贪心为什么不删**：它还有真实消费者。一是 store `applyBuildRecommendationForSlot` 的 `optimizer.useDefault=0` 分支（用户可打开的设置）；二是该分支写入的 `perSlotMarginalGains`，在 ResourceUtilizationPage:528 和 MarginalUtilityCard:152 展示「词条边际收益」（这是打分模型的近似值）。删掉会砍掉一个用户可见功能，另立 CC-186 先做清点再定。
- **测试**：`substatOptimizer.test.ts` 重写。
  - 旧的「与贪心内联算法逐值相等」改为：maxEvals=1 时返回值等于 core useDefault 起点；精修后真实伤害不低于起点，且总步数不变（1161 / 1311 / 1211 三个槽位）。
  - refine 用例的对照改为推荐分配（即起点），1591 严格改进。
  - CC-184 的预算用例改为直接钉 core 贪心（store 分支仍在用它）。
  - 第 194 轮队友 buff 同源用例原样保留。
- **探针变化**：`k206/probe206.test.ts` 不设 REFINE 时会传 `undefined`，现在会抛错。所以探针一律带 `REFINE=1`，基线为 `k208/final.tsv`（等同 d.tsv）。
- **验证**：vue-tsc 通过；上述 5 个用例通过；探针 final.tsv 与 r1.tsv 伤害零差；verify EXIT=0。zd 不受影响（预设和 zd 走 store useDefault 路径，本轮未改）。
- **回退点**：revert 0e4e7ecf（改 composable、ImpactChart 注释、测试）。

### 24.33 CC-186：core 副词条打分模型退役（第 209 轮，4d6f13d0）

- **清点结论**：core 打分模型（computeExpectedScore / greedyAllocate / pruneAndRankSets / computeAtkTeamBenefit / 套装分解 / 模板里的 anomalyRatio、dmgBonusRelevant、anomalyRelevant、atkWeightInAnomaly、teamAtkTransfer、minGainRatio）的唯一生产入口，是 store `applyBuildRecommendationForSlot` 的 `optimizer.useDefault=0` 分支。
  - `optimizer.useDefault` 全仓只有这一处读取（缺省 1），**从引入起（5c087473，2026-08-30）就没有任何写入点**。ResourceUtilizationPage 只有 substatCap 和 totalSteps 两个输入框；通用设置渲染器只渲染角色模块注册的设置；mechanicSettings 没有持久化也没有导入（difficultyCurve 只是对当前 store 拍快照再还原）；`git log -S` 也只有引入那一次。⇒ **整队贪心分支生产不可达**。
  - 它写入的 `perSlotMarginalGains` 因此永远为空：ResourceUtilizationPage 的「全队边际收益」卡片和 MarginalUtilityCard 的「副词条边际效用」区，对每个角色都**永远只显示「（未计算）」**，是一块坏掉的界面。
  - 真正求最优的路径已经是编排层「默认分配 + 真实伤害精修」（§24.30–24.32）。
- **决定：退役**。依据唯一判据：删掉的是一套平行伤害模型，永远不执行却要跟着维护（每次伤害管线改口径，它都会悄悄漂移）；用户可见的部分只有一块永远显示「未计算」的界面，没有功能损失。回退点 = revert 4d6f13d0。
- **改动**（一个原子提交）：
  - `core/substatOptimizer.ts`：915 行减到约 190 行。只留 `SubstatTemplate`（stats、critRateCap）、`AGENT_TEMPLATES` 兜底、`getTemplate`、`computeDefaultSubStats`、`computeNoSubstatPanel`，以及入口 **`computeDefaultSubStatAllocation`**（原 `computeOptimalSubStats`，改名是因为「Optimal」已名不副实；输出直接是分配对象）。原 `SUBSTAT_POOL` 只剩暴击步长在用，改为常量 `CRIT_RATE_STEP = 2.4`，数值不变。
  - `stores/config.ts`：配装推荐只剩默认分配；删掉整队贪心分支、`perSlotMarginalGains` 及其导出，以及 `calcPanel`、`buildTeammateBuffSourceContext` 两个 import。这对 ARCHITECTURE-OVERVIEW 的 A2「状态层掺计算」是实际改善，已在 A2 行加注。
  - `useResourceCalc.ts`：memo 排除集删掉 `perSlotMarginalGains`。
  - 展示层：删掉 ResourceUtilizationPage 的「全队边际收益」卡片（连同 STAT_LABELS 和 statLabel）、MarginalUtilityCard 的副词条边际区（主词条替换候选仍在，statLabel 保留）；substatCap 输入框的说明文字去掉「融合贪心」。
  - 角色模块：6 个异常角色（简 1261、蕾米埃尔 1581、柏妮思 1171、维琳娜 1561、爱丽丝 1401、月城柳 1221）的 `substatTemplate` 收窄后与 anomaly 兜底完全相同，整条声明删除；卢西娅 1451、洛克茜 1621 只删三个废弃字段。
  - 编排层 `composables/substatOptimizer.ts` 改调新入口。
  - MarginalUtilityCard 模板在删除时残留一个孤立的 `</div>`，由 vite build 发现后修正。
  - 棘轮与契约同步（纯删除带来的，不是回退）：`check-tokens.mjs` 中 WA_REF_BASELINE 447→437、VAR_TOTAL_BASELINE 808→797；`calcPanelCallContract.test.ts` 的 KNOWN 删掉 `src/stores/config.ts` 一项（剩 3 个文件 4 处）。
- **测试**：
  - core 测试去掉废弃字段。
  - CC-81 测试重写：声明者只剩 1451 和 1621；新增「6 个删声明的异常角色在 anomaly 职业下 stats 不变」。
  - 编排层测试改用新入口；CC-184 的贪心预算用例随贪心删除（默认分配按设计就会填满预算，core 测试「预算不足」等用例覆盖）。
- **验证**：vue-tsc 通过；相关 18 个用例通过；探针（`k209/final.tsv` 对比 `k208/final.tsv`）变化 0；zd（cc186）DIFF 0（预设和 zd 走 store 默认分配，改写后必须零差）；verify EXIT=0。
- **以后若要「词条边际收益」展示**：不要复活打分模型。在编排层按 refine 同一模式，对每个模板词条 +1 步读 `teamTotalDamage` 的真实差分，经 useResourceCalc 或 composable 暴露（展示层禁止值导入 core）。没人要就不做。

### 24.34 CC-187：删除时间轴喧响轨原型 core/resourceTrack.ts ＋ 两份普查（第 210 轮，00e50d4e）

- **普查一：只读不写的 mechanicSetting key（第 209 轮交接指定的方向）——结果为零。**
  - 方法：列出全部 `getMechanicSetting('<字面量>'`（25 个 key），逐个查写入点（`setMechanicSetting('<key>'`、模块 `settings` 注册的 `id:`、`.vue` 输入框、`guarantee.${kind}` 等动态写入）。脚本 `/home/kaua/calc-arch/k210/ms210.sh`。
  - 25 个 key 全部有生产写入点（界面输入框或模块 settings 注册、被通用渲染器渲染）。`optimizer.useDefault` 那种「只读不写」的死开关已随 CC-186 清掉，没有第二个。⇒ 这条方向到此结束，以后不用再扫。
- **普查二：生产零引用的值导出。**
  - 方法：`/home/kaua/calc-arch/k210/dx210.cjs`（一次性，不进 CI）。对 src 非测试文件的 `export function/const/class/enum`，统计其他生产文件里的词边界引用数；本文件内也没有其他用法的才算。结果 `k210/dx.tsv`：291 个生产文件，扫出 25 个「生产零引用」，子代理复核后 **2 条是误报**（`computeDamageSourceBreakdown` 经命名空间 `ResourceCalcHelpers.xxx` 调用；`XIDE_ENCIRCLEMENT_EFFECT_IDS` 以 `...xxx` 展开使用），**实际 23 个**：`simulateDecibelTrack`（本卡删除）+ 下表 22 条（类别 T 测试钩子 6、C 平行副本 10、F 未接线功能 2、D 纯死代码 4）。
  - 注意：扫描的词边界正则排除了前导 `.`，因此看不见 `ns.foo` 命名空间访问和 `...foo` 展开，也不识别 `import.meta.glob` 动态导入（`data/stunAxisPresets.ts`、`data/teamPresets.ts`、`specs/registry.ts` 用了 glob），定性前要人工核对。
  - 逐条定性（子代理 dsh 只读产出，主会话抽查了 resourceTrack 与丽娜两条）：

# k210 · src 零生产引用导出裁定（第4列为 0 的行，24 条）

> 输入：`dx.tsv`（`export` 值导出，生产引用数 = 0）。类别：T=测试钩子（保留）｜C=生产逻辑平行副本（测试测副本，应改测生产）｜F=未接线功能（应接线）｜D=纯死代码（应删）。
> 说明：`dx210.cjs` 的 own/prod 计数用 `(?<![\w$.])` 前瞻，**会把 `...NAME` 展开与 `NS.NAME` 命名空间调用漏计**，故有 2 条误报（下表标 `—(误报)`）；其余 22 条经 `grep -rn` 复核确实零生产引用。

| 导出名 | 文件:行 | 类别 | 依据 | 建议 |
|---|---|---|---|---|
| teamHasAxisPresetPreferred | src/composables/agentMechanicView.ts:229 | C | 生产由 `axisPresetPreferredLabel`（同文件:238）内联同一判定、`AUTO_AXIS_PRESET_HINTS.isPreferred`（:220）提供谓词；本函数只被 `agentMechanicViewCc60.test.ts:48`、`axisPresetPreferredLabelCc79.test.ts:23` 当 oracle。 | 删除并把测试改测 `axisPresetPreferredLabel`/`isPreferred`（或让 :238 复用它） |
| setupCodeGold | src/composables/freeCompare/axes.ts:57 | C | 限定金口径生产单源在 `limitedGold.ts:37 memberLimitedGold` / `teamTimelineStore.ts:89 baseGoldOfTeam`；本函数只被 `freeCompare.test.ts:55-61` 测，且 gold 轴 `override.gold` 在 `freeCompare/engine.ts` 从未被消费。 | 删除并把测试改测 `memberLimitedGold`；顺带接线或删 gold 轴 |
| constraintSummary | src/composables/freeCompare/constraints.ts:51 | F | 头注释「图表副标题用」，但 `FreeComparePage.vue` 未 import、无副标题渲染，生产无等价实现。 | 接线到 FreeComparePage 图表副标题，或删除（连同 `freeCompare.test.ts:206`） |
| deflateScoreByInflation | src/composables/inflationCurve.ts:315 | F | 头注释「把膨胀接进兑现读数的展示层换算」，但 `PullValueChart.vue:291-320` 只算 `inflationCtx`/`avgInflationIndex` 文案，从不调用它。 | 接线到 PullValueChart 的兑现分数读数，或删除（连同 `inflationCurve.test.ts:260-269`） |
| setCachedFreezeEnabled | src/composables/resourceCalc/freezeCached.ts:23 | D | 全仓（含测试）零引用；`freezeCached.ts:40` 才是被 `useResourceCalc.ts:153/219/241` 消费的机制。 | 删除（若确需性能探针则补测试） |
| isCachedFreezeEnabled | src/composables/resourceCalc/freezeCached.ts:27 | D | 全仓零引用（仅 :27 声明），无任何测试或探针读它。 | 删除 |
| computeDamageSourceBreakdown | src/composables/resourceCalc/helpers.ts:152 | —(误报) | 生产经命名空间调用 `useResourceCalc.ts:708 ResourceCalcHelpers.computeDamageSourceBreakdown`，结果由 `ResultPage.vue:632` 渲染；扫描器漏计 `NS.NAME`。 | 保留（非死代码） |
| getCalcOutputMemoStats | src/composables/useResourceCalc.ts:78 | T | 记忆化命中/未命中诊断读数，仅 `calcOutputMemo.test.ts` 用来验证命中语义；生产恒开（:82）。 | 保留 |
| setCalcOutputMemoEnabled | src/composables/useResourceCalc.ts:83 | T | 记忆化 A/B 开关，被 `calcOutputMemo.test.ts`、`outerContinuity.test.ts:28`、`allAgentsGuards.test.ts:33`、`feasibleRowsMemo.test.ts:85` 做逐位对照；生产恒 true。 | 保留 |
| chart3YStepOf | src/composables/versionChartGeometry.ts:54 | T | 与 `hpRatioYStepOf` 的委托别名，`hpRatioAxis.test.ts:78` 用引用相等钉「三图同源」结构契约；生产只用 Max/Of/Grid/Label。 | 保留（结构判据需要） |
| getFeasibleRowsMemoHits | src/core/resource/rowBuild.ts:162 | T | 行物化记忆命中计数，仅 `feasibleRowsMemo.test.ts` 读它证明命中/未命中。 | 保留 |
| setRowFastPathsEnabled | src/core/resource/rowBuild.ts:172 | T | 行快路径 A/B 总开关，被 `feasibleRowsMemo.test.ts`、`allAgentsGuards.test.ts:36` 做全角色开/关逐位对照；生产恒开（:171）。 | 保留 |
| presetTeamKey | src/data/stunAxisPresets.ts:190 | D | 生产匹配走 `matchStunAxisPresets`（:198，按槽位 `every` 比较，不建 key），本函数只被 `stunAxisPresets.test.ts:33-36` 测，且文件内零自用。 | 删除（连同该测试；匹配语义已由 matchStunAxisPresets 覆盖） |
| teamPresetGroupOptions | src/data/teamPresets.ts:131 | C | 生产三页改用三级筛选 `presetGroupLabels`/`presetSubgroupLabelsFor`/`presetsForFilter`（:150/:155/:165，见 `PositionComparePage.vue:190`、`TeamComparePage.vue:811`、`TeamConfigPage.vue:809`）；本函数只被 `teamPresets.test.ts:103-121` 当生产测。 | 删除并把测试收敛到三级筛选（已有覆盖） |
| nodesFrom | src/data/versionTimeline.ts:178 | C | 生产 `teamTimeline.ts:394/405` 用 `VERSION_NODES.map` + `fullAxis.slice(mainAxisIdx)` 自建轴；本函数仅 `teamTimeline.test.ts:94/173` 当 oracle。 | 删除并把测试期望改为直接 `VERSION_NODES` 切片 |
| computeRinaCorePenRatio | src/mechanics/agents/rina.ts:69 | C | 生产数值由 `public/static/teammate-buffs.json` 的 `rina.core_pen_ratio` formula `clamp(x*0.25+12,0,30)` + `rina.cinema_1.core_pen_ratio_amplify`(×1.3) 驱动；单测 `rina.test.ts:38-40` 测的是 TS 副本。 | 删除并把测试改测 teammate-buffs→引擎管线（范式见 `specTeamBuffDeadControl.test.ts`） |
| XIDE_ENCIRCLEMENT_EFFECT_IDS | src/mechanics/agents/xide.ts:186 | —(误报) | 同文件 `xide.ts:198` 以展开 `...XIDE_ENCIRCLEMENT_EFFECT_IDS` 消费，进入 `xideTeammateBuffRecipientFilter`→`panelPhases.ts:496` 生产路径；扫描器漏计 `...NAME`。 | 保留（非死代码） |
| computeYaojiayinCoreAtkBonus | src/mechanics/agents/yaojiayin.ts:130 | C | 生产数值由 `teammate-buffs.json` 的 `yaojiayin.core_andante_atk`（derived 35%/cap1200）+ `yaojiayin.cinema_2.core_andante_atk_bonus`（`clamp(x*0.54,0,1600)-clamp(x*0.35,0,1200)`）驱动；单测 `yaojiayin.test.ts:49-53` 测的是 TS 副本。 | 删除并把测试改测 teammate-buffs→引擎管线 |
| buildSpecResourceSections | src/specs/mechanics.ts:36 | C | 生产资源区由 `specToMechanicModule(...).resourceSections`（同文件:200-228）现算；本函数只被 `specs/__tests__/mechanics.test.ts:17` 测。 | 删除并把测试改测 `specToMechanicModule(spec).resourceSections`（或让 :200 复用它） |
| verifyAllSpecs | src/specs/verify.ts:65 | T | 唯一调用者是 `specs/__tests__/verify.test.ts:7`（跑全 spec 的 panel+expected 可执行校验）；`validate:specs` 脚本只做结构校验、未接它。 | 保留（单测已在 CI 执行）；可选并入 `validate:specs` |
| STANDARD_ENEMY_DEBUFF_ELEMENTS | src/utils/enemyDebuffStats.ts:6 | D | 生产一律用 7 元素 `DAMAGE_ELEMENTS`（`statMeta.ts:150`、`buff.ts:63`）；本常量（去 lumiflux 的 6 元素）只被 `enemyDebuffStats.test.ts:103` 自测。 | 删除（连同该断言） |
| isEnemyDebuffStat | src/utils/enemyDebuffStats.ts:129 | C | 生产的归属判断在 `core/buff.ts:63-64`（GENERATED+LEGACY 集合）与 `statMeta.ts:287`（`LEGACY…includes`）另写；本函数只被 `enemyDebuffStats.test.ts:109-116` 测。 | 删除并把测试改测生产集合（或反向让 buff/statMeta 复用本函数以收敛单源） |
| interactiveTeammateBuffs | src/utils/teammateBuffRows.ts:86 | C | 渲染面 `AttributeConfigPage.vue:552` 直接用 `isTeammateBuffInteractive` 逐行过滤，未用本批处理包装；本函数只被 `teammateBuffRows.test.ts:70`、`specTeamBuffDeadControl.test.ts:123` 测。 | 删除并把测试改为直接测 `isTeammateBuffInteractive`（或让页面改用本函数） |
| declaredOnlyTeammateBuffs | src/utils/teammateBuffRows.ts:96 | C | 同上是 `isTeammateBuffInteractive` 的取反包装，生产页面逐行用 `!isTeammateBuffInteractive`；只被 `teammateBuffRows.test.ts:71`、`specTeamBuffDeadControl.test.ts:124/201` 测。 | 删除并把测试改为直接测 `isTeammateBuffInteractive` |

**最值得做的一条**：`computeRinaCorePenRatio` / `computeYaojiayinCoreAtkBonus` 这类 C —— 生产数值由 `public/static/teammate-buffs.json` 的 formula 驱动，单测却在断言这两个 TS 平行副本，JSON/公式一漂移测试仍全绿、生产静默错值（正是规则 16「死口径」风险）。
做法：删掉两个函数，把 `rina.test.ts:38-40`、`yaojiayin.test.ts:49-53` 改为跑 teammate-buffs→引擎的数值断言（管线范式见 `specTeamBuffDeadControl.test.ts`）。
同批可顺手清掉零引用的 `setCachedFreezeEnabled`/`isCachedFreezeEnabled` 与已死的 `STANDARD_ENEMY_DEBUFF_ELEMENTS`。

  - 主会话抽查结论：`computeRinaCorePenRatio`（`mechanics/agents/rina.ts`）是 `teammate-buffs.json` 里 `rina.core_pen_ratio` 公式 `clamp(x*0.25+12,0,30)` 和影画 1 `buffModifiers` ×1.3 的手抄副本，测试测的是副本不是生产。一度怀疑生产漏了影画 1——实际走 `multiplyResolvedValue` 修饰器（`core/inCombatBuffs.ts:83`），生产是对的。
- **CC-187 决定：删除 `src/core/resourceTrack.ts`（100 行）与 `src/core/__tests__/resourceTrack.test.ts`。**
  - 依据：`simulateDecibelTrack` 生产零调用；头注释自称「对轴模块第一步」，是方向 A（事件时间轴内核）的种子，而方向 A 已否决（R4 撤销）。它放在 core 里会让人误以为是引擎的一部分（LONG-TERM-DIRECTIONS 曾把它列为「种子」，ARCHITECTURE 工具表曾列为「验收读数」工具）；唯一看守它的测试只是在断言「别接它」。删掉后 core 少一个平行模型，没有功能损失。
  - `decibelCapVerdict.test.ts`：「形状面」字符串判据随之删除。闸门作用由同文件的**行为判据**承担：「大招次数 = floor(总喧响/ultimateCost)」，谁引入喧响上限口径它就会红。头注释已改口径。
  - 同步：`src/specs/agents/1391.json` note、`yixuanSmoke.test.ts` 历史注释、`docs/ARCHITECTURE.md` 工具表（删掉该项）、`mcp-r65j1-decibel-cap-verdict.md` / `mcp-timeline-shadow-kernel.md` / `LONG-TERM-DIRECTIONS.md` 加注。`mcp-r22d1-batch12-field-census.md` 是时点记录，不改。
  - 验证：vue-tsc 通过；verify EXIT=0（3827 passed，比上轮少 7 个 = 删掉的 resourceTrack 测试 6 个 + 形状面 1 个）；CG 25 项全过。纯删除、零生产调用，所以不跑 zd 和探针。
  - 回退点：`git revert 00e50d4e`。若将来真要做喧响上限口径，按 `mcp-r65j1-decibel-cap-verdict.md` §4 在新实现里建模，不要复活这个文件。

### 24.35 CC-188：删除只被测试调用的生产逻辑副本，测试改走生产通道（第 211 轮，378c1c17）

- **起点**：§24.34 定性表的类别 C（平行副本）共 10 条。按唯一判据逐条复核，**只做「副本会和生产悄悄走偏」或「会误导人」的**。其余只为减少导出数的删除一律不做，理由逐条写在下面。本节的最终结论覆盖 §24.34 表里的「建议」列。
- **做了（4 条）**：
  - `computeRinaCorePenRatio`（丽娜）、`computeYaojiayinCoreAtkBonus`（耀嘉音）：生产数值来自 `public/static/teammate-buffs.json`（丽娜 `rina.core_pen_ratio` 公式 + C1 `buffModifiers` ×1.3；耀嘉音 `core_andante_atk` 派生 35%/1200 + C2 差额公式），模块里各手抄了一份，测试测的是手抄件。**变异检验**：把 JSON 里的上限改成 31 / 1300，旧测试照样全绿，新测试两条都红。改后测试走 `collectInCombatTeamBuffs`（修饰器在这里生效）→ `applyEffect`，期望值原样搬过来。丽娜另补了 x=80 一点：原来的 x=72 算出来恰好 =30，测不出上限。
  - 新增共享测试工具 `src/test/harness.ts#resolveTeammateBuffsOnEmptyPanel(buffIds, x)`：走生产通道解一组队友 buff 的数值，叠在 `emptyPanel()` 上。以后要断言 teammate-buffs 公式的数值就用它，**不要再在模块里抄公式**。
  - `buildSpecResourceSections`（`specs/mechanics.ts`）：它是生产 `specToMechanicModule(spec).resourceSections` 在「无结果」时那个分支的逐字副本。删除后测试改调生产 `resourceSections({ result: undefined })`。
  - `teamPresetGroupOptions`（`data/teamPresets.ts`，连同只为它存在的 `TeamPresetOption` 接口和 naive-ui 类型导入）：旧的两级下拉，头注释写着「三个消费点共用」，实际零消费（三个页面早已改用三级筛选）。`FEATURES_GUIDE.md` 里同样过时的一句一并改正。它的测试里「每个预设必须有分类」保留；「分组恰好覆盖全部预设」改测生产的三级筛选：每条预设恰好落在一个（职业, 属性）格里。
- **不做（附理由）**：
  - `interactiveTeammateBuffs` / `declaredOnlyTeammateBuffs` / `nodesFrom` / `teamHasAxisPresetPreferred`：都是 1～3 行、对生产谓词（`isTeammateBuffInteractive` / `VERSION_NODES` / `AUTO_AXIS_PRESET_HINTS.isPreferred`）的组合。测它们就等于测谓词，没有走偏风险，删了是纯折腾。
  - `isEnemyDebuffStat`：复核后不是副本。`core/buff.ts` 用的是一个更大的集合，判断的不是同一件事。它只是个没人用的 4 行谓词，删了只降计数。
  - `setCachedFreezeEnabled` / `isCachedFreezeEnabled`：头注释写明是「测试需要可写缓存时的临时开关」，属于有意留的安全阀，零成本，保留。
  - 类别 F 的 `constraintSummary` / `deflateScoreByInflation`：小、自洽、有测试。删了没有架构收益，要用时直接接上即可。
  - 类别 D 的 `presetTeamKey`、`STANDARD_ENEMY_DEBUFF_ELEMENTS`：各 1～5 行，删了只降计数，不做。
  - `setupCodeGold`：另有疑点（见交接下一步：gold 轴的 `override.gold` 可能从未被消费），留给那张卡一起看。
- **验证**：vue-tsc 通过；4 个相关测试文件 41 个用例通过；变异检验如上；CG 25 项全过；verify EXIT=0（3827 passed，与上轮相同：测试是一换一）。数值零改动（只删副本、测试改道，生产代码路径不变），所以不跑 zd 和探针。
- **回退点**：`git revert 378c1c17`。

### 24.36 CC-189：自由对比的三个假 x 轴维度 + 血量比读错 Boss（第 211→212 轮交接指定，ad9a9321）

- **查明**：自由对比页（`src/views/FreeComparePage.vue`）的「x 轴维度」下拉由 `axes.ts#axisOptions()` 列出全部 6 个维度，但求值器 `engine.ts#computeFreeCompare` 的装配段只读 `level.override.cinema / wengine`：
  - **总限定金（gold）**、**操作难度档（difficulty）**：每档装配完全相同 ⇒ 画出一条平线，用户会误以为「金数 / 难度对这队没影响」。
  - **Boss 期数（period）**：页面从不传 `axisOptions.periods` ⇒ 零个档位，图是空的；`override.periodId` 也从未被读。
  - 自 7394ce68（2026-09-15 建工作台）以来一直如此。测试只测了「按参数枚举出档位」，没测「档位真的改变了装配」。
- **顺带查出第二个 bug**：`env.hp`（「Boss 血量比」指标的分母）在循环开始前、Boss 装配之前就读死了 ⇒ 只要在条件里选了 Boss，血量比除的就是**用户页面原来那个 Boss** 的血量。
- **决定与依据**（唯一判据：让架构更诚实、更简单；不为降计数）：
  - **期数轴：接线**。boss-presets 的每个 Boss 有多期危局（`phases`，各期血量 / 抗性 / 弱点不同），「这队能打几期」语义清楚。装配复用现成的 `applyBossPreset`，引擎原本就有 `ConstraintSpec.phaseId` 这个概念（页面从没设置过）。实现：页面把所选 Boss 的 phases **按时间从旧到新**（数据里是新→旧）作为 `periods` 传入；engine 用 `level.override.periodId ?? cs.phaseId` 选期；没选 Boss 时页面直接报错提示，不画空图。
  - **金数轴、难度轴：删除**（连同 `LevelOverride.gold/difficulty`、`AxisOptions.goldRange/difficultyMax`、`setupCodeGold`，以及同样从未生效的约束字段 `ConstraintSpec.gold`）。两者都**没有现成口径**：金数要决定 g 金怎么分给三人（teamCompare 的 `computeOptimalGoldAllocations` 是另一套搜索），难度要决定 D0～D5 映射哪些旋钮（仓库里的「难度」是 G1～G6 目标阶梯，不是单一档位）。接线等于发明新口径，没人提过这个需求。删掉假选项是可逆的；要加回来，先定口径、在装配段消费 override，再往 AXES 加一行（axes.ts 的 `AxisId` 上方已写注释）。
  - `env` 改为每次读指标前、装配之后再读。
  - 页头文案「其余一切（Boss/金数/难度/队友）都是条件」改为「其余（Boss/队友/锁定角色/配装）都是条件」：金数、难度在条件区同样没有实现。
- **测试**：
  - 新增真引擎判据（`freeCompareEngine.test.ts`「★ 期数轴真的换期…」）：取 30007（死路屠夫）两期血量不同的危局作期数轴，同时跑总伤与血量比，断言每一档都满足「血量比 × 该期血量 = 总伤」。**变异检验**：让 engine 不读 `periodId`、或把 env 改回装配前读，这条都会红。
  - 删掉金数枚举与 `setupCodeGold` 的纯函数测试；约束摘要测试去掉 `gold`。
- **验证**：vue-tsc 通过；freeCompare 3 个测试文件 26 个用例通过；vite build 通过；CG 25 项全过；verify EXIT=0（3827 passed：删 1 加 1）。不碰引擎与数值，所以不跑 zd 和探针。
- **教训（已写进交接已知坑）**：「加维度 = 往注册表加一行」这种设计，很容易出现「注册表里声明了、求值器没消费」的假选项。现有死通道扫描抓的是「只读不写」，**抓不到「只写不读」**：`LevelOverride.gold` 在 AXES 里被写、从没被读。
- **回退点**：`git revert ad9a9321`。

### 24.37 CC-190：接口属性「只写不读」普查 + 删掉 5 个假契约字段（第 213 轮，f516e95f）

- **起因**：第 212 轮交接第 2 项（死通道扫描抓不到「只写不读」）。评估后发现：死通道扫描按名字计数，扩展它也抓不到 `gold` 这类常见名，所以改为另写符号级审计脚本 `scripts/audit-write-only-props.cjs`，不改 dead-channel-scan。
- **结果**：158 条高置信候选，逐条分诊了所有输入 / 契约类，**没有数值 bug**。删掉 5 个误导性字段：
  - `enemyLevel`：伤害公式固定按攻击方 60 级；
  - `AxisContext.ultimateTotalBySlot`；
  - `targetState`；
  - `includeOwner`：真实机制是 `excludeTargetAgentIds`；
  - `stunsTotal`：注释声称会缩放，实际按条目加权。

  另外修掉爱丽丝 6 命常量与字面量双源；`higherBetter` 保留，注释改实话。详表、方法和待办见 **`docs/mcp-write-only-props.md`**。
- **验证**：vue-tsc 0；zd DIFF 0（DUMP / ROWS）；verify EXIT=0（3827，用例数不变）。
- **决定**：审计脚本**不做成守卫**（需要人工分诊，红灯会逼人乱删）。T1（37 条 cfg 死暂存）和 T2（80 条结果死字段）写成低级模型可执行的待办；T3（数据类型字段）不做。
- **纠正第 212 轮交接的错误**：第 212 轮把「方向 C 第 2 刀试点（迁 1 个角色成纯 spec）」列为下一步，理由是方向 A 已否决。但这一刀就是 **CC-99，第 148 轮已评估为不做**（卡表 CC-99 行、`mcp-mechanic-dataization-census.md` §6）：
  - 否决理由与方向 A 无关：G1 / G3 统一只能降计数，G1 还会波及所有纯 spec 角色的路径，对逻辑正确性没有收益；
  - 重开条件是**新角色录入时，若能靠 G1 / G3 做到纯 spec**。
  - 第 212 轮只看了 LONG-TERM-DIRECTIONS，没看卡表。已在 LONG-TERM-DIRECTIONS 的更新注记里改正。
- **回退点**：`git revert f516e95f`（纯删除 + 注释，零差）。

### 24.38 CC-191：T1 cfg 死暂存清理 + 审计脚本漏扫 JSON 勘误（第 214 轮，9e0d4adf）

- **勘误**：第 213 轮审计脚本的名字兜底没扫 JSON。spec 解释器按字符串键读 cfg，键名只在 `src/specs/agents/*.json` 里，结果 T1 的 37 条里 17 条其实被 spec 读取。脚本已补 JSON 语料，148 条降到 100 条；T1/T2/T3 表重新生成。
  - **追查第 213 轮已删的字段**：`aliceCinema6MaxTriggers` / `DamageRatio` 出现在 1401.json，但只是 C6 事件的 `fields` 展示元数据（`specs/mechanics.ts:57` 原样透传），不参与计算，所以 CC-190 的零差结论成立。1401.json 的过期 `fields` / `note` 已改正。
- **清理**：T1 删 20 条，保留 `timeFeasibleScale`（`@fact` 登记的诊断量）。
  - 丽娜 / 苍角的 `applyTeamConfig` 整条删除：只写从无读取方的邻位回能字段，真实通道是 `crossAgentSupply`。`teamHook.test.ts` 的声明名单改为露西 / 耀嘉音 / 莱特，丽娜 / 苍角改为断言 `crossAgentSupply.kind`。
  - 诺姆 C4 的三处过期注释改正：C4 已走 `decibelPerUnit`。
  - 逐条核查了注释暗示本该被读的几条（诺姆 C4、丽娜 / 苍角 / 露西回能、琉音 60 档设置、强特资源成本），**都不是 bug**。删完后没有机制常量变成未使用。
- **验证**：
  - vue-tsc 0；CG 25。
  - zd：用 HEAD 版 1401.json 跑，DUMP / ROWS 均为 DIFF 0，证明代码零差。用新版 1401.json 跑，爱丽丝队 DIFF 24 / 28，差异来自 C6 事件展示字符串 `note` / `fields` 的哈希。
  - verify EXIT=0（3827：苍角写字段测试 −1，crossAgentSupply 声明断言 +1）。
- **回退点**：`git revert 9e0d4adf`。

### 24.39 CC-192：机制设置动态普查——安东额外能力门控缺声明（生产路径恒不触发）+ 滑块 0% 读成 100%（第 215 轮，10817931）

- **为什么做这件事而不是 T2**：T2 剩余条目只是无害的展示载荷，删除的架构收益很小（按唯一判据，适合低级模型慢慢推进）。CC-189 的教训是「注册了、但不起作用」的假选项；CC-187 的 mechanicSetting 普查是静态的（有没有被读），看不见「读了但被门控挡死」。本轮改做**动态**普查。
- **工具**：`.zc/perf/sweep.perf.ts`（本地，不入库；`PERF_OUT=<tsv> npx vitest run --config .zc/perf/vitest.perf.config.ts sweep`，约 85s）。对每个模块 `settings` 项，取含该角色的前 3 个预设（没有预设的角色：取前 3 个预设、把 0 号位换成它），在 {当前, C0, C6} 下把设置切到 min / max / default+3·step / default÷2，比对 `teamTotalDamage` 和 resourceResult / stunPool 哈希；另检查「显式写入声明 default」是否等于「不设置」（兜底一致性）。
- **结果**（179 项）：168 项有效；兜底不一致 0 项；无效 11 项，逐条分类如下。

| 设置 | 分类 | 依据 |
|---|---|---|
| `anton.additionalShockRatio` | **bug，已修** | 见下文 |
| `hugo.exVerdictRatio` / `hugo.ultimateVerdictRatio` | 轴模式下被轴覆盖（设计如此） | 单人（非轴）普查有效；放进带失衡轴的队伍后改由轴决定（hugo.ts:396 按 `!== undefined` 选通路） |
| `corin.additionalStunCoverage` | 同上 | 标签本身就写着「（非轴）」 |
| `yixuan.ningshenCoverage` | 同上 | 只有非轴分支读取（yixuan.ts:1118/1137），3 个预设都在轴模式 |
| `1521.xixifu_toxin.toxin_tuxin_stunned_bonus.rate` | 同上 | 只参与失衡内毒素占比（xixifu.ts:264，轴内分摊） |
| `banyue.autoTopUpInteractions` | 场景依赖 | 只在资源不足时才补齐；3 个预设都不缺 |
| `1531.billy_star_glow…rate` / `1531.billy_radiant_star…rate` | 饱和 | 星辉 2 层封顶、煊赫星辉按上限裁剪（starlightBilly.ts:660/701），其他来源已经能叠满 |
| `qianxia.gazeTriggerHits` | 语义为「只减不增」 | `min(markSupply, triggerHits)`（qianxia.ts:115），0 表示自动；只有设成小于标记供给的值才有效，本次试的 30 不够小 |
| `1551.peiluo_prominence.peiluo_perfect_block_gain.rate` | 场景依赖 | 完美格挡次数默认 0，换进去的队伍里没有格挡来源 |

- **修复 1（接线缺失，影响面最大）**：`src/specs/agents/1111.json` 没有 `additionalAbility` 声明 ⇒ `panelPhases.ts:646-648` 从不把 `additionalAbilityActive` 置 1 ⇒ `anton.ts` 的「通力合作·感电追加」事件在生产路径上**永远不会产生**。单测直接构造了 `panel: { additionalAbilityActive: 1 }`，所以一直是绿的。按 catalog 原文（「队伍中存在与自身属性或阵营相同的角色时触发」）补上 `teamConditions: [sameAttributeAsSelf, sameFactionAsSelf]`，写法与柯林 1061 相同。这是接线修复，不是改数值：模块算式、倍率一字未动。集成测试 `src/composables/__tests__/antonGateHarnessCc192.test.ts` 走 harness 真队伍，断言 [安东, 格莉丝, 艾莲] 门控为 1、[安东, 艾莲, 星见雅] 为 0。
- **修复 2**：`anton.ts` 原来是 `clampRatio(cfgSetting(...) || 1)`，滑块 0% 被读成 100%（`if (ratio <= 0) return` 因此是死代码）。`setting:*` 由 `resourceCalc/helpers.ts:617` 按声明 default 注入，所以改为「缺键（单测直接构造 cfg）才回落 1」。删掉了已无人使用的 `cfgSetting`。
- **结构守卫**：新增 `src/mechanics/__tests__/additionalAbilityGate.test.ts`：凡是模块源码读 `panel(?).additionalAbilityActive`，其 agentIds 的 spec 必须声明 `additionalAbility.teamConditions`（目前 35 个模块，缺失清单为空）。自带判定的模块（velina / alice / miyabi 的 `isAdditionalAbilityActive`）不读面板标记，不受约束。
- **顺带（T2 三条 + 过期说明）**：诺姆 `barrageCoverage`（恒为 1）/ `barrageSeconds` / `hatToChainCost` 只写不读，已删；1571.json 说明里的「norma.barrageCoverage 可调」「按覆盖率折算」早已过期（覆盖率滑块已移除，`git log -S`），已改正。
- **更深一层（CC-193，下一轮第 1 项）**：门控修好后总伤仍然不变。harness 实测（[安东, 格莉丝, 艾莲]，含普攻权重 3）：安东的生产执行行只有 `basic_attack`（通用普攻行）/ 1111011 / 017 / 016 / 014 / 020 / 023，**没有任何爆发状态招式行**（006-008 打桩、010/015/019 钻击）。模块里的 `ANTON_PILE_MOVE_IDS` / `ANTON_DRILL_MOVE_IDS` / `ANTON_C6_MOVE_IDS` 与 catalog 一致，但碰不到任何行 ⇒ 核心被动 +24% / +40%、C1 回能、C6 增伤、感电追加在生产路径上可能**全部不生效**，单测都是手工构造行，所以一直是绿的。要先弄清通用 `basic_attack` 行按什么展开、哪些角色会展开成逐招式行，再判断这是安东个例还是一类问题。
- **未做、记为后续**：还有 7 个 spec 没有 `additionalAbility` 声明（1141 / 1151 / 1171 / 1351 / 1441 / 1511 / 1611；1401 走自定义判定）。它们的额外能力要么无条件生效，要么走别的门控，需要逐个对照 catalog 原文的触发条件，看有没有「本该有条件却恒生效」的情况。
- **验证**：
  - vue-tsc 0。
  - zd（用 HEAD 版 1571.json，`ZD_DROP=barrageSeconds,barrageCoverage,hatToChainCost`）：DUMP / ROWS 均为 DIFF 0。预设里没有安东，所以零差符合预期；安东所在队伍的数值会变化，这正是修复本身。
  - 修复后重跑普查（k215/sweep3.tsv）：`anton.additionalShockRatio` **仍然无效**，原因见下一条。
  - verify EXIT=0（3831：安东单测 +1、门控守卫 +1、harness 门控 +2）。
- **回退点**：`git revert 10817931`。

### 24.40 CC-193：汇总平A行对模块不可见 + 新角色普攻伤害恒 0（第 216 轮，4ddd4f78）

- **起因**：§24.39 发现安东门控修好后总伤仍不变。harness 实测：普攻在引擎里恒为**一条**汇总行（`core/resource/rowBuild.ts` 的 `moveId: 'basic_attack'`，`count: 0`、按时长），倍率取「基准段」的秒均值（`skillRows.ts#getBasicComboMoves`：catalog `basicBenchmarkMoveId` → 硬编码 override → 默认第 3 个带 `#N` 的普攻段）。模块用 `SET.has(exec.moveId)` 按普攻段 id 匹配时**永远碰不到**这条行。
- **普查**（`.zc/perf/moveids.perf.ts`，本地不入库，约 50s；比对脚本 `/home/kaua/calc-arch/k216/mvcmp.py`，输出 `k216/mvcmp.out`）：全部预设 × {当前, C0, C6}，外加无预设角色的换位队伍，收集每个角色生产行里出现过的 moveId；再抽出模块源码里属于本角色的 7 位 moveId 字面量对照。结果：374 个里有 124 个从未出现在生产行，其中 75 个是普攻段。
  - **非普攻的缺失**（非强化特殊技、冲刺攻击、快速支援、部分变体）：引擎的计划本来就不排这些动作，属于「写了但碰不到、也不影响结果」，**不做**。
  - **普攻段的缺失**分两类：一类只是用来查倍率表、构造自定义行（露西、丽娜、柏妮思、叶瞬光、席德、克拉蕾等），**没问题**；另一类用来**匹配行**，这才是 bug，见下文。
- **修复 1（通用接线）**：cfg 新增 `basicBenchmarkMoveId`（`helpers.ts` 构建 cfg 时由 `getBasicComboMoves` 算出），`rowBuild` 把它写进汇总平A行的 `benchmarkMoveId`；`@/types/resource` 新增 `execMatchesMove(exec, ids)`：普通行按 moveId 匹配，汇总平A行按基准段匹配。**以后模块按普攻段匹配，一律用 `execMatchesMove`，不要写 `SET.has(exec.moveId)`。**
- **安东：先改后撤回（按用户历史裁决）**：一开始把 catalog 1111 的 `basicBenchmarkMoveId` 设成了爆发 #3（1111008）。verify 里 `cinemaAxisBatchA.test.ts` 的边界反锁测试红了，它引用的是 `docs/MECHANICS_IMPLEMENTATION.md` 安东段「已知缺口」：**用户 2026-08 裁决爆发状态建模复杂度高，暂不做**。改基准段实质上就是在建模爆发状态，所以**撤回**，只保留通用接线：安东模块的打桩 / C6 改用 `execMatchesMove`，常态基准段 1111003 不在集合里，行为与裁决一致。harness 用例改成裁决反锁（基准段 1111003、平A行打桩加成为 0）。**日后若裁决改为建模**：在 catalog 配 `basicBenchmarkMoveId = 1111008`，同时改这条用例和 cinemaAxisBatchA 的反锁即可（试算：golden 里安东单人伤害约 +105%~+128%，失衡次数 1→2）。教训：开工前除了卡表，还要查 MECHANICS_IMPLEMENTATION 的「已知缺口 / 用户裁决」。
- **修复 3（振斗）**：耗血暴伤 +50% 本来就针对胧切段，而用户在 f99751fa 里设定的基准段正是胧切 #1（烧血高伤），匹配却一直失败；改用 `execMatchesMove`。golden：振斗单人伤害 +3.5%。
- **修复 4（赛维里安 1631 / 菲欧妮 1641，影响最大）**：这两个新角色在新版 catalog 里的普攻段名不带 `#N`，`getBasicComboMoves` 返回 null ⇒ 汇总平A行**没有任何倍率** ⇒ 普攻伤害恒为 0（harness 实测：菲欧妮 45s、赛维里安 40s 的普攻时长，dm 为空）。而且旧写法把数据配置也放在 `#N` 过滤之后，连 `basicBenchmarkMoveId` 都会被否决。改为：数据配置优先，在全部 actionTime > 0 的普攻招式里查找，不受命名启发式约束；catalog 补 1631 → 1631003、1641 → 1641003（第 3 段，与模块 `*_BASIC_SEGMENT_IDS` 四段连击一致）。赛维里安 C1「普攻暴伤 +60%」同步改用 `execMatchesMove`。两个模块只用普攻时长算资源收入（流息 / 余火），不给汇总行定价，不会重复计算。harness（[x, 格莉丝, 耀嘉音]，普攻权重 3）：菲欧妮队 31.65M → 35.15M（+11%），赛维里安队 31.46M → 39.30M（+25%）。
- **结构守卫**：`src/composables/__tests__/basicBenchmarkMatchCc193.test.ts`，包括：
  - `execMatchesMove` 单测；
  - 振斗、赛维里安、菲欧妮的汇总平A行 harness 行为测试，以及安东的裁决反锁；
  - **catalog 全部角色 `getBasicComboMoves` 非空**：以后新角色的普攻名如果不带 `#N`，这条会红，此时在 catalog 里配 `basicBenchmarkMoveId` 即可。
- **数值影响面**：只影响振斗、赛维里安、菲欧妮所在的队伍（都不在预设里）。catalog 只多了 1631 / 1641 两个键（按 JSON 结构比对确认）。time golden 已重生成（`TIME_GOLDEN_UPDATE=1`），判红的 6 条全部可以解释：赛维里安 C6、菲欧妮 C5/C6 的普攻行以前连失衡值也是 0，补上后失衡 1→2、连携 +1，约 2.2–2.4s 从普攻挪到必做动作。伤害信息项：赛维里安 +31%~+44%，菲欧妮 +56%~+72%，振斗 +3.5%。
- **剩余逐角色建模欠账（未做，按优先级）**：
  0. ~~安东 C1 回能 / 感电追加 / 打桩 / C6~~：**用户 2026-08 裁决不做**（爆发状态建模），不列入待办。重开时的做法见上面「安东」一条。
  2. **千夏**凝视标记里有普攻 #4（1491004），而普攻时长不计标记供给，标记数偏少。
  3. **佩洛伊斯**按 1551006 / 007（天光 #3 / #4 连段）计 a3 / a4，但这些行从不出现，连段花费恒为 0（`specPanelBuffs.ts:263`）。
  4. **扳机**冥狱段 1361020 / 022、**爱芮**绝对音准 1501005–008 / 022、**苍角**霜染刃旗 1131004 / 005：都是状态型普攻，基准段是常态第 3 段，所以匹配不到。每个都要先判断「该状态是不是主形态」，再决定改基准段还是折算。
- **验证**：
  - vue-tsc 0。
  - zd（`ZD_DROP=benchmarkMoveId,basicBenchmarkMoveId`）：DUMP / ROWS 均为 DIFF 0。两个新键会进所有预设的哈希，所以要剔除；剔除后零差，证明预设数值没变。
  - verify EXIT=0（3837：新增 basicBenchmarkMatchCc193 共 6 例）。
- **回退点**：`git revert 4ddd4f78`。只想回退某个角色的基准段时，删掉 catalog 里对应的 `basicBenchmarkMoveId`，再跑 `npm run minify:static`。

### 24.41 CC-194：postRound 写入从未跨轮生效（第 217 轮，062af638）

- **起因**：做 §24.40「剩余逐角色建模欠账」第 4 项时，先用 harness 打印扳机队（`auto-1461-1521-1361`）的生产执行行：协奏狙杀 1361008 有 208 发，队友强特共 24 次、终结 8 次，但冥狱 1361020 / 1361022 **一行都没有**。§24.40 把它归为「状态型普攻、基准段匹配不到」，是误判：冥狱是模块自己推的后台行，问题出在次数恒为 0。
- **根因（通用通道）**：`applyTeamConfig({phase:'postRound'})` 的契约是「本轮收敛 → 下一轮注入」。但 `convergence.ts` 在**本轮末尾**对本轮的 `characters` 派发，而 `runCalcRound` 每一轮开头都会 `base.characters.map(...)` 重新克隆 cfg，所以 postRound 的写入**全部**在下一轮开始前丢失。受影响的全部 postRound 用户（`grep -rn postRound src/mechanics/agents`）：
  - **扳机 1361**：`triggerMate*Count` 恒 0 ⇒ 冥狱恒 0（2026-08-25 用户口供的「冥狱按 CD 吃满」从来没有进入计算）；
  - **安比 1011 影画4**：给后场电属性队友的电荷传导回能（`initialEnergyGift`）从未注入；
  - **千夏 1491**：`qianxiaExCount` / `qianxiaUltimateCount` **只写不读**（全仓无读点）⇒ 删除整个钩子。
  - 莱特走的是 `nextRoundFeedback` 通道（返回值 → threads），不受影响；其余 `applyTeamConfig` 都用相位守卫只响应 build 或 converge，也不受影响（抽查了卢西娅、格莉丝、蕾米埃尔、莱卡恩、佩洛伊斯）。
- **修法（通用，模块零改动）**：
  - `roundThreads.ts` 新增 `postRoundInput: { exCounts, ultimateCounts, stunCount } | null`（首轮与 null 轮为 null）；
  - 轮末**只记录**这组入参（`postRoundInputNext`），下一轮在 converge 派发**之前**，用它对新克隆的 cfg 派发 postRound；
  - 安比那种「先减去上次、再加上本次」的写法，在新克隆上依然成立（上次为 0）；
  - `outerCycle.ts#outerFeedbackSignature` 新增全队强特次数：postRound 注入读它，强特还在变、终结不变时，旧签名会在注入值落后一轮的状态下判稳。
- **守卫**：`src/mechanics/__tests__/postRoundCarryCc194.test.ts`（harness 真队伍）：冥狱终结一击行必须 > 0，且连射行 = 3 × 终结一击。**单测直调钩子看不见这类接线断点**（trigger.test.ts 12 例一直是绿的）。
- **数值影响面**（zd k217：625 条里 DIFF 92）：
  - 14 支扳机预设 × 6 个变体 = 84 条：冥狱行补回，golden 伤害 +1.2~2.9%。其中 3 队时间账有变化：`auto-1521-1361-1311`、`auto-1201-1361-1211`、`auto-1401-1361-1411`（失衡 3→4）。冥狱带失衡值，失衡累积更快，于是能量和时间重新分配。timeFillRatchet 里伊德海莉-扳机-卢西娅失衡 2→3、留白 0.6→3.6s，也是同一原因。
  - 5 个非扳机变体（伊德海莉-橘福福 / 洛克茜 / 诺姆-卢西娅、1051-1141-1451、1181-1561-1581 的 c6 或 heavy）：**来自判稳签名**。已证实：临时去掉签名那一行重跑 zd（k217b），差异只剩上面 84 条。这 5 个变体原来是在强特次数仍在变时提前停的，修正后总伤最多 +0.11%（伊德海莉-诺姆-卢西娅 c6），其余 4 个总伤不变、只有哈希变。**决定保留**：判据必须覆盖下一轮注入的输入，这是通用正确性，不是为了某个数。
  - 预设里没有安比 C4+ 配电属性队友的队伍，所以安比 C4 的效应只体现在 `adjustableEffect.test.ts`：希希芙毒素的默认队友是安比 C6 和丽娜 C6，三点实测值更新为 stage4 20→18、duya_hold@0.5 13.5→15、stunned_bonus 10→9，线性关系保持不变。
- **验证**：vue-tsc 0；verify EXIT=0（3838）；time golden 与 timeFillRatchet 已逐条归因后重生成。
- **回退点**：`git revert 062af638`。只想撤掉判稳签名的变化时，删掉 `outerCycle.ts` 里 CC-194 那一行即可（差异只剩扳机队）。
- **§24.40 剩余逐角色欠账（更新）**：
  - 扳机：已随本卡解决。
  - 千夏普攻 #4 标记（`qianxia.ts` 标记供给不含普攻时长）、佩洛伊斯 a3 / a4 连段（`specPanelBuffs.ts`）、爱芮绝对音准 1501005–008 / 022、苍角霜染刃旗 1131004 / 005：仍待做。先按「开工前查裁决」检查，再判断该状态是不是主形态。

### 24.42 CC-195：普攻汇总行 → 段命中的通用折算（第 218 轮，f5a28e56）

- **做法**：先用 harness 打印四个角色真实队伍的生产行（探针队：千夏 1491-1031-1211、佩洛伊斯 1551-1211-1311、爱芮 1501-1221-1311、苍角 1131-1191-1251），再逐个定性，不凭代码推断。
- **通用工具（新增）**：
  - `src/data/moveTableQueries.ts#basicComboCycleSeconds(skills, moveId)`：某普攻段所在「同名 `#N` 连段」打满一整套的动作时长；不带 `#N` 或找不到时返回 0。
  - `@/types/resource#basicSummarySeconds(executions)`：汇总平A行的总时长。
  - 口径：**段命中次数 = floor(汇总时长 / 整套时长)**，即「普攻时间里每打满一整套同名连段出一次该段」。它与引擎「按基准段秒均结算伤害」并存：伤害仍按基准段，这里只折算计数类副作用。
- **逐角色结论**：
  - **千夏（做）**：鬼马流星锤 #1–#4 整套 4.767s，普攻 #4 进入凝视标记供给（此前恒 0）。默认 `triggerHits = markSupply`，所以凝视次数 = 供给。实测：悠真-千夏-耀嘉音 凝视 8→14，总伤 +0.31%；雅-千夏-青衣 7→8，+0.14%；千夏-妮可-丽娜 队内没有强攻或异常触发者，不变。顺手把供给改成纯函数 `markSupplyOf`，删掉 `cfg.qianxiaMarkSupply` 回写（`AgentResourceResultInput.preModuleExecutions` 头注释点名的反模式：多 pass 下最后写入的那次与装配时的 state 不一致）。装配阶段改用 `preModuleExecutions` 重算。
  - **佩洛伊斯（做，仅展示）**：日珥账本补上余晖 #1–#3 整套回复（每套 9.13，40s 普攻约 17 套）。天光 a1–a4 **不折算**：引擎普攻基准段是余晖 #3，计划里没有天光连段，消耗恒 0 与计划一致。账本页脚本来就写明「不影响伤害」。
  - **苍角（不做）**：用户 2026-09-05 的强特循环口径只包含霜染冲刺 1131016 和霜染 #3（1131006），两者都在生产行里；1131004 / 005 按口径不录入。苍角也没有普攻汇总行。
  - **扳机**：已由 CC-194 解决（§24.41）。
  - **爱芮（未做，下一步）**：见下方「已知缺口 2」。
- **已知缺口（本轮发现，未修）**：
  1. **千夏 1491008 特别拍照技巧不计标记**：它是引擎的「额外强特行」（`src/data/exSpecialPlans.ts`，按 40s 窗口计，≤ 主强特次数），在 `core/resource/rowBuild.ts:379` 附近物化，**晚于**模块 `buildExecutions`（:317）、早于 `patchExecutions`（:540），所以千夏的计数看不到它（探针队漏 4 次）。另外这一行融合了 1491008+1491019，两段都是标记招式，每次应计 2 个标记。修法候选：
     - (a) 千夏的凝视产行挪到 `patchExecutions`。但装配阶段的 `preModuleExecutions` 仍然不含额外强特行，展示会与行不同源，需要给 `AgentResourceResultInput` 补一份「钩子全部派发后的行」。
     - (b) 模块按 `resolveExtraExCount` 自己算次数：重复了引擎逻辑，**不推荐**。
     - 倾向 (a)，并在测试 `basicSegmentFoldCc195.test.ts` 同步改 cardHits 那一行。
  2. **爱芮绝对音准直伤缺失**：异放次数 `pitchCount`（应援能量 / 2 + 全场应援）是资源驱动的、没有问题；但绝对音准 1501005–008 / 022 的**直伤行从未产出**，影画6「强化绝对音准以太伤害 +40%」（`patchAireExecutions`）因此恒不命中。这不是匹配问题，而是建模缺口：需要像扳机那样按 `pitchCount` 推表行（每次 #1+#2+#3，actionTime 1.32+1.507+1 = 3.83s 前台，挤占普攻池）。**没有用户口径**，下一轮可以按「每次异放 = 一次 #1–#3」做可逆实现，并写明回退点（删掉推行即可）。
- **验证**：vue-tsc 0；verify EXIT=0（3840）；zd k218 DUMP / ROWS 均为 DIFF 0（625 个预设里没有千夏队，佩洛伊斯的改动只影响展示）；harness 对比见上。
- **回退点**：`git revert f5a28e56`。

### 24.43 CC-196：爱芮绝对音准次数按原文订正；直伤行拆到 CC-197（第 219 轮，e862fbd3）

- **起点**：§24.42「已知缺口 2」——绝对音准直伤行从未产出，影画6「强化绝对音准 +40%」恒不命中。
- **本卡交付（均有原文依据）**：
  1. **全场应援按命座门控**。旧实现对全命座计 `floor(t/6)`（180s = 30 层），但「妄想时刻内敌人进入异常 → +1 层，6 秒一次」出自 `talent.6`（影画6 构造体之梦）。非 C6 的唯一来源是 `skill.chain`「进入妄想时刻获得 3 层」。新口径：
     - 非 C6：`3 × 终结次数`；
     - C6：`floor(t/6) + 3`。C6 下妄想时刻不退出，只有首次进入给 3 层；之后再放终结技算不算「进入」原文未明，保守不计。
     - 每层等于蓄力 +2 段或转化为 2 个应援能量，两种用法都约等于 1 次第三段。
  2. **甜心律动 #4 每次 +1 应援能量**（`skill.basic` 原文；旧注释写了但没实现）：次数 = `floor(basicAttackTime / basicComboCycleSeconds(1501004))`，沿用 CC-195 的通用口径。
  3. 次数计算抽成导出纯函数 `aireAbsolutePitchCount(cfg, state, totalTime)`，异放事件调用它；删掉未使用的局部变量；C4 注释与事件 note 同步新口径。
- **影响**（golden：105 个预设加 60 个角色；**时间账零变化**，只有爱芮相关条目的伤害变了）：

| 条目 | HEAD | 本卡 |
|---|---|---|
| auto-1501-1511-1411 | 102597794 | 92432349（−9.9%） |
| auto-1501-1511-1311 | 79821273 | 71765251（−10.1%） |
| auto-1501-1561-1411 | 82687628 | 75503069（−8.7%） |
| auto-1581-1501-1561 | 167071132 | 159238781（−4.7%） |
| agent:1501 c0 / c3 / c4 / c5 | — | −1.2% / −1.8% / −0.6% / −0.6% |
| agent:1501 c6 | 2373420 | 2625087（+10.6%） |

  - harness 探针：爱芮-柳-耀嘉音 C0 异放 55→40 次、总伤 −6.7%；C6 62→68 次、+3.1%；雅-爱芮-耀嘉音 C0 53→34 次、−7.0%。
  - C0 下降的原因是撤掉了无门控的约 30 层全场应援（按原文属于 C6 专属），不是回归。
- **直伤行为什么拆出去（CC-197）**：
  - 完整实现已经写好，备份在 WSL `/home/kaua/calc-arch/k219/aire.rows.ts`，配套测试为 `airePitchRowsCc196.test.ts` 与 `aire.test.rows.ts`。内容：推 1501007 / 1501008 两种行（`timeBucket: 'necessary'`，耗时 = 次数 × 倍率表 actionTime；回能和喧响交给倍率表回填；强化占比非 C6 取 `min(1, 终结 × 15 / t)`、C6 取 1），C6 +40% 经 `patchAireExecutions` 生效。
  - **阻塞点：模块的 necessary 行缺少团队级时间封顶**。（⚠ 第 220 轮订正：**本条是误判**，见 §24.44「订正」——213s 是逐槽毛前台，净占用恰为 180s、overflow 0。）
    - 不封顶时：每次第三段回 3.6 能量 → 强化特殊技变多 → 应援能量变多 → 第三段再变多，形成正反馈环。普攻池挤到 0 以后前台合计溢出，golden 实测 1501-1511-1411 为 213s，超过 180s；1501-1561-1411 为 219.6s。
    - 仿照 11 号先例 `min(资源, floor(state.basicAttackTime / 单次时长))` 封顶时：`basicAttackTime` 只是爱芮自己分到的份额（全队普攻池按 `timeWeight` 水填分配，helpers.ts `basicAlloc`），均衡点会把次数压到约等于自身普攻池（14–17 次），总伤 −15%~−32%。第三段是爱芮的核心输出，实际打法会优先于队友的填充普攻，所以这个上限不合理。
  - **CC-197 的设计方向**：给 `AgentResourceInput` 加通用只读字段「全队剩余普攻池秒数」（core 侧通用，不写 agentId）。上限 = (全队剩余池 + 本槽上一 pass 已折入的 `timeBudgetExcess`) / 单次时长，避免「占用后池变小 → 上限变小」导致的系统性减半。11 号、格莉丝等按 `basicAttackTime` 封顶的模块也可以受益，这是让架构更通用的改动，值得单独做。
- **验证**：vue-tsc 0（剩余报错都在其他 lane 的未跟踪文件 `catalogReadiness.test.ts` / `batchTask.test.ts` 里）；aire、inStunAttribution、timeFillRatchet 全绿；golden 逐条解释后已重生成；verify EXIT=0（3841）。
  - **全部在独立 worktree `/home/kaua/calc-arch/wt219`（HEAD + 本卡文件）中完成**：本轮主工作区的 `src/stores/catalog.ts` 被其他 lane 改到中间态，所有队伍都算不出结果（`资源池未产出结果`），主仓库不可用来验证。所以 zd 未跑（它依赖主工作区），由 golden 的 105 个预设覆盖。
- **回退点**：`git revert e862fbd3`。只想回退门控时，把 `aireAbsolutePitchCount` 里的 `cheerGain` 改回 `Math.floor(totalTime / AIRE_CHEER_CD_SECONDS)`。

### 24.44 CC-197：爱芮绝对音准直伤行接入通用「模块必做动作」通道；订正 §24.43 的溢出误判（第 220 轮，2af8c466）

- **订正（先读）**：§24.43 说直伤行「前台合计 213s > 180s，溢出」——**误判**。golden 的逐槽 `front` 是**毛时间**（necessary 按 GROSS 计入合轴段），逐槽相加本来就可以 > 180。判断超预算要看 `buildTeamTimeSummary`（留白棘轮的口径）：1501-1511-1411 动作毛前台 195s、合轴抵扣 15s、净 `rowsNet = 180`、`overflow = 0`、截断 0、外层 stable；1501-1561-1411 为 201.7 − 21.7；1581-1501-1561 为 209.1 − 29.1，都恰为 180。上一轮「不封顶版」其实也没溢出，本卡结果与它逐位相同。「按自身普攻池封顶会系统性减半」这条分析仍成立（所以不要走 11 号那种封顶）。
- **为什么仍然值得做（架构理由，不是数值理由）**：
  - 旧写法（buildExecutions 推 necessary 行）的时间要靠折叠环 `timeBudgetExcess +=` 事后追认进账本；新写法让时间**直接进入账本估计** Σnecessary（helpers.ts `iterateBody`），装不下时由团队级 `feasibleScale` 等比封顶、装配期截断——与强化特殊技等资源驱动动作走同一条路。
  - 通用通道 `extraNecessaryAction`（CC-26，原本只服务蕾米埃尔垂虹）扩展后，其他「资源驱动的额外必做动作」模块可以直接复用，不必再各写一份 buildExecutions + 自估时间。
- **通用改动**（core 里无 agentId）：
  - `mechanics/types.ts`：`extraNecessaryAction?(cfg, state?)`，可返回单个或数组。`state` 在 helpers 预留时为上一轮 prevState、在 rowBuild 补行时为本轮 state，收敛后同值。
  - `mechanics/typesHooks.ts`：`ExtraNecessaryAction.decibelRecovery` 改可选；undefined ⇒ 行不写喧响字段，展示层 enrich 与账本 rowAccounting 都回落倍率表（显式 0 仍是禁用）。
  - `core/resource/rowAccounting.ts#extraNecessaryActionOf(cfg, state?)` 统一返回数组并丢弃 count ≤ 0；`helpers.ts` 按数组累加时间与合轴时间；`rowBuild.ts` 按数组逐个补行。
  - 蕾米埃尔仍返回单个对象、显式喧响值，行为逐位不变（只加通用部分时 golden 零差已实测）。
- **爱芮**（`mechanics/agents/aire.ts`）：导出 `aireExtraNecessaryActions(cfg, state)`（无 state ⇒ null），次数 = `aireAbsolutePitchCount`（与异放事件同源），按 `aireEnhancedPitchShare` 拆成 1501007（普通 #3）与 1501008（强化，#5 642.1%）。强化占比：C6 为 1，其他命座为 min(1, 终结 × 15 / t)。动作时长在 buildCharConfig 从倍率表读取；回能和喧响交给倍率表回填（3.6 / 27.5）。影画6 +40% 经原有 `patchAireExecutions` 首次命中。1501022（#4，0s，83.1%）归属不明，不计。
- **影响**（golden 相对 CC-196 基线；时间账变化只在爱芮条目）：

| 条目 | CC-196 | CC-197 |
|---|---|---|
| auto-1501-1511-1411 | 92432349 | 111746214（+20.9%） |
| auto-1501-1511-1311 | 71765251 | 72661855（+1.2%；stun 3→2，南宫羽槽普攻 26.6→3.3s） |
| auto-1501-1561-1411 | 75503069 | 100912058（+33.7%） |
| auto-1581-1501-1561 | 159238781 | 193580797（+21.6%） |
| agent:1501 c0 / c3 / c4 / c5 | — | +6.4% / +8.1% / +8.4% / +8.8% |
| agent:1501 c6 | 2625087 | 3238461（+23.4%） |

  - harness 探针（推荐配装）：爱芮-柳-耀嘉音 C0 67.65M→63.66M（−5.9%），C6 101.27M→110.62M（+9.2%）；雅-爱芮-耀嘉音 C0 46.40M→50.62M（+9.1%）。
  - 柳队 C0 下降是真实代价：每次第三段占 1s 爱芮前台，时间从柳那里挤出来；旧模型让第三段零耗时，等于白送时间。
  - 正反馈（第三段回能 → 强特 → 应援能量 → 第三段）收敛健康：timeBudgetPasses 2、外层 stable、截断 0。
- **已知近似**：异放事件次数取资源次数，不跟随装配截断；目前各队截断均为 0，若将来出现截断，行次数会小于事件次数（新测试的「行合计 = 事件次数」会报红，届时按物理次数改事件侧）。甜心律动 #4 的应援能量按整段普攻池折算，没有扣掉第三段占用的时间，属于轻微高估。
- **验证**：独立 worktree `/home/kaua/calc-arch/wt220`（HEAD + 本卡文件；主工作区里另一个 lane 正在改 `src/stores/catalog.ts` 的加载状态，套预设的测试会抛 `buildRecsLoaded=false`）。vue-tsc 0；新测试 `src/mechanics/__tests__/airePitchRowsCc197.test.ts` 4 条（同源、C6 强化 +40%、派发器数组化、1501-1511-1411 净占用 overflow 0）；aire / inStunAttribution 全绿；golden 与留白棘轮逐条解释后重生成；`moduleAnomalyEventRecords.test.ts` 四组含爱芮的期望更新（r0 爱芮触发 10→15、lead-empty 13→17 ⇒ 蕾米虚耀池同增；j0c6 / j2c6 简 6 命附伤 10→8，爱芮第三段占前台），头注释写明归因；verify EXIT=0（3845）。
- **回退点**：`git revert 2af8c466`。只撤爱芮：删掉 aire.ts 模块里的 `extraNecessaryAction: aireExtraNecessaryActions` 一行即可（通用扩展对蕾米埃尔零差，可以保留）。

### 24.45 CC-198：千夏 1491008「特别拍照技巧」计入凝视标记——新增通用行快照 `prePatchExecutions`（第 221 轮，3d0217e3）

- **起点**：§24.42「已知缺口 1」。1491008 是引擎的额外强特行（`src/data/exSpecialPlans.ts`），在 `core/resource/rowBuild.ts` 里于模块 `buildExecutions` **之后**才物化，千夏在 buildExecutions 里数标记供给时看不到它，标记恒少计。
- **做法（方案 a）**：
  - **通用**：`rowBuild.ts#buildExecutions` 与 `phaseExecutions.ts#buildExecutionsWithPhase` 加可选出参 `patchInputRows`，在调用 `patchExecutions` 前快照；`assembleSlot.ts` 把它作为 `AgentResourceResultInput.prePatchExecutions` 传给 `buildResourceResult`。这与现有的 `moduleInputRows` → `preModuleExecutions`（buildExecutions 钩子看到的行）完全对称：「钩子在哪个阶段产行，展示层就读哪个阶段的行快照」。快照是浅拷贝（数组新建、行对象共享），只能读 moveId / count / 时长，不要读 patch 会改写的字段（类型注释已写明）。其他调用方不传就不受影响。
  - **千夏**（`mechanics/agents/qianxia.ts`）：凝视 / 泡泡产行从 `buildExecutions` 挪到 `patchExecutions`（这些行都是 backstage、totalTime 0、倍率自带，放在末尾不影响时间或计数通道）；`buildResourceResult` 改读 `prePatchExecutions`，产行与展示仍对同一批行调用同一个纯函数 `markSupplyOf`。
- **没选方案 (b)**（模块自己按 `resolveExtraExCount` 复算 1491008 次数）：重复引擎逻辑，窗口口径一改就会分叉。
- **影响**：
  - harness（推荐配装）：千夏-妮可-猫又 供给 16→20；悠真-千夏-耀嘉音 14→18、凝视 14→18、总伤 +0.21%；雅-千夏-青衣 8→12、+0.56%。
  - golden：6 支千夏队伤害 +0.05%～+0.11%（auto-1321-1481-1491、1431-1491-1341、1431-1491-1311、1431-1481-1491、1201-1481-1491、1021-1571-1491），时间账零变化，其他条目零差；留白棘轮和 moduleAnomalyEventRecords 全绿。注意：golden 的预设里**有**千夏队，zd 的 625 个预设里**没有**。
- **测试**：`qianxia.test.ts` 三处单测直调改为 `patchExecutions!`；`basicSegmentFoldCc195.test.ts` 的 cardHits 补上 1491008。后者断言「展示层供给 = 按最终行数出来的期望值」，同时守住展示与产行同源。
- **验证**：vue-tsc 0；verify EXIT=0（3845，在 worktree `/home/kaua/calc-arch/wt221` 里跑，排除主工作区里其他 lane 的未跟踪测试）；check-guards 通过。
- **事故与修正**：3d0217e3 误带了其他 lane 的 `src/stores/config.ts` 改动（未经本卡验证），已由 3cb3b846 撤回，工作区副本原样保留。3cb3b846 之后 `git diff 599be93b HEAD -- src/stores/config.ts` 为空。
- **回退点**：`git revert 3d0217e3`。（要连同 3cb3b846 一起看：单独 revert 3d0217e3 会把 config.ts 反向改一次，需先 revert 3cb3b846 或手工排除 config.ts。）只撤千夏：把 `patchExecutions: buildQianxiaExecutions` 改回 `buildExecutions:`、展示改回读 `preModuleExecutions`（通用快照没有消费者也无害，可以保留）。

### 24.46 CC-199：额外能力门控补全——通用门控改按组 id 查拥有者，1351/1141 补声明，护栏扩到全员（第 222 轮，99282fdf）

- **起点**：交接队列第 1 项「additionalAbility 声明普查」（1141/1151/1171/1351/1441/1511/1611）。普查脚本 `/home/kaua/calc-arch/k222/aa222*.cjs`。
- **现状（先读后判）**：「额外能力」buff 有两道门控——
  - ① 引擎硬门控 `ADDITIONAL_GATE_BUFFS`（`composables/resourceCalc/panelPhases.ts`），按表登记 buff id，用户开关压不过；
  - ② store 通用门控 `stores/config.ts#deriveTeammateBuffEnabled`：来源为「额外能力」的 buff，按拥有者 `spec.additionalAbility` 求值决定默认启用。
  - 护栏 `additionalGate.test.ts` 只查**已登记**角色 ⇒ 未登记的拥有者整片看不见。
- **发现的缺陷**：
  1. **1351 波可娜**：spec 无 `additionalAbility` ⇒ ② 的 `aaActive` 为 undefined ⇒ 困迹 +30%（追加攻击）、影画6 全伤害扩展、影画1 暴击率 +10% **无条件生效**。原文条件「队伍中存在[强攻]或[命破]角色或自身阵营相同的角色」。
  2. **1141 莱卡恩**：同上，失衡易伤 +35% 无条件生效。原文条件「与自身属性或阵营相同的角色或其他[异常]角色」。
  3. **1411 柚叶**：spec 有声明，但 ② 用 `buff.ownerId` 查拥有者，catalog 里她的 ownerId 是拼音 slug `youye` ⇒ 恒 undefined ⇒ 额外能力（异常伤害/紊乱/积蓄效率）无条件生效。同类 slug：1581 `remielle`（她自带 `teammateBuffGate` 且条件与声明完全一致，改后零差）、1511 `nangongyu`。
- **改法（让规则更通用，而不是再加一条登记）**：
  - ② 改按**组 id**（= 拥有者 agentId；仅队友角色的组 id 是 teammateBuffId，已同步双键）查，不再依赖数据里写法不统一的 `ownerId`。修 1411，1581 零差。
  - 1351、1141 spec 补 `additionalAbility.teamConditions`（照原文，不猜）。
  - 1351 两条 buff 登记进 ①：影画6「困迹对追加攻击以外也生效」以困迹为前提，与基础条同门控（先例 1421 cinema_1）；`pulchra.ts` 影画1 暴击率加 `additionalAbilityActive` 门控（原文「对被施加[困迹]效果的敌人」）。
  - 护栏扩到全员：`additionalGate.test.ts` 新增「拥有『额外能力』buff ⇒ 组 id 的 spec 必须声明」，例外表 `AA_OWNER_EXEMPT` 只有 1511；再加「catalog `combatBuffs.additionalAbility.effects` 全员为空」——`core/buff.ts#collectAgentBuffs` 对它**无门控施加**，目前全员为空所以无害，数据一旦填数值就会静默恒开，断言提示先接门控。另加 1351/1141/1411 三条行为测试。
- **不做 / 未决**：
  - **1511 南宫羽**：teammate-buffs `buff_ce11acbda2` 原文**没有触发条件**，只写效果。R5 硬约束「不猜数据」⇒ 不编条件，列入 `AA_OWNER_EXEMPT`；补数据时删掉例外即被护栏接管。
  - **1441 真斗**：额外能力只有「残焰回血」，无伤害/资源消费者，声明了也没人读 ⇒ 不做。
  - **1171 / 1611 / 1151 / 1401**：catalog 无额外能力条目、无「额外能力」来源 buff ⇒ 无需声明（1401 走 alice.ts 自定义判定，1151 已有声明）。
- **影响面（golden，时间账只 1 支预设变）**：
  - 单角色基准（无队友 ⇒ 条件不满足）：1141 c0 −7.6% / c3-6 −9.6%；1351 c0 −4.5% / c3-5 −8.7～−8.8% / c6 −23.0%（影画6 全伤害扩展也关）；1411 c0 −0.4% / c3-6 −1.9～−2.1%。
  - 预设 `auto-1381-1361-1411`（零号安比/扳机/柚叶：无异常、无怪啖屋 ⇒ 柚叶额外能力不触发）：−7.8%；且 slot0 终结技 4→3、普攻 +1.26s——柚叶额外能力含**属性异常积蓄效率**，关掉后异常次数变化连带喧响，属直接物理后果。
  - 其余条目零差；留白棘轮绿。golden 已用 TIME_GOLDEN_UPDATE=1 重生成（18 行）。
- **连带修的测试夹具**：`teammateBuffDerivation.test.ts` 的 `slot()` 给所有队员 slot 0，额外能力判定按 slot 排除自身 ⇒ 永远判不触发；过去因为 mkBuff 的 ownerId 为空、门控被跳过而没暴露。改为队员槽位互异。
- **测试口径订正**：`lycaonSmoke.test.ts` 原用「莱卡恩 + 安比」断言失衡易伤 +35——安比不满足额外能力条件，旧断言恰恰锁住了缺陷。改为第 3 槽放艾莲（1191，冰·维多利亚家政）使其触发，另加反向用例「只有安比：核心被动照常、+35 不给」。
- **验证**：vue-tsc 0；相关 15 文件 102 条全过；verify EXIT=0（3875）；check-guards 通过。
- **回退点**：`git revert 99282fdf`。只撤 store 按组 id：把 `aaActiveMap.get(agentId)` 改回 `buff.ownerId && … get(buff.ownerId)`（1411 恢复恒开）；只撤波可娜：删 1351.json 的 `additionalAbility` 与表里 `'1351'` 行、撤 pulchra 影画1 门控。
- **留给后续的架构观察（未做，写进队列）**：两道门控（① 硬表、② store 默认）职责重叠。② 修好后，① 中「来源＝额外能力、条件＝声明本身」的条目理论上可由一条通用规则替代，只保留跨来源（影画/核心被动随额外能力）与特殊修正（凯撒、菲欧妮 tier3）。但 ① 是「用户开关压不过」的硬门控、② 是可被用户覆盖的默认值，语义不同——合并前要先定「额外能力未触发时用户能不能手动打开」。

### 24.47 CC-200：模块必做行的时间预留普查 + 苍角强特子动作改走 `estimateExSpecialTime`（第 223 轮，d5e18595）

- **起点**：交接队列第 1 项「评估其他模块是否迁到 `extraNecessaryAction`」。
- **判据（本轮定下，写进已知坑）**：模块产的前台必做行，时间要么进账本估计，要么靠 `timeBudgetExcess` 事后折叠。折叠是外层不动点、能收敛，但账本不诚实：合轴抵扣丢失、团队 feasibleScale 看不到这部分需求。通道选择——
  - 行次数 = 强特次数（每次强特多几个子动作）⇒ `estimateExSpecialTime`（按次估时，已有 14 个模块在用）；
  - 行次数来自别的资源（绝对音准、虚耀等，与强特次数无关）⇒ `extraNecessaryAction`（CC-26 / CC-197）。
  - 所以「迁到 extraNecessaryAction」这个问题本身问窄了：普查按「残差大小」找对象，再按上面两条选通道。
- **普查方法**：临时插桩 `src/core/resource/helpers.ts` 必要时间公式处，把各槽最后一轮 `cfg.timeBudgetExcess` 写进 `globalThis.__zzex`，探针读出（脚本 `/home/kaua/calc-arch/k222/p223inst.py`，探针 `/home/user` 侧 `zzprobe223*.test.ts`；跑完 `git checkout helpers.ts` 并删探针）。
- **普查结果（残差秒 / 该槽 necessary 行合计秒）**：
  - 1131 苍角：47.9/71.6（雅-苍角-丽娜）、41.9/64.5（苍角-艾莲-耀嘉音）——**本卡处理**。
  - 1461 席德：34.7/114.5、31.2/107.6——下一张卡。
  - 1091 雅：24–31；1191 艾莲：22–25（不在 grep 清单里：它们的行没显式写 `timeBucket: 'necessary'`，但同样有残差；helpers.ts 注释提过「雅霜月架势」）——排队评估。
  - 1611 克拉蕾：2.4（量化残差，`affordableExCount` 来自锐能）⇒ 不做。
  - 1621 洛克茜、1221 月城柳：necessary 行 `totalTime` 全为 0（挂伤害的附带行，不占时间）、残差 0 ⇒ 不做。
- **苍角的问题**：通用强特行（扇子第 1 击）按 `exSpecialActionTime` 预留；模块每次强特再补扇子第 2 击 1.16 + 风团 2×0.271 + 下砸 1.25 + 霜染冲刺 0.4 + 打年糕#3 2.632（全合轴）≈ 5.98s，账本不知道，8 次强特 ≈ 47.9s 全靠折叠——与实测残差完全吻合。而且折叠路径让打年糕#3 的合轴抵扣**丢失**：模块头注释的用户口径（2026-09-05）是「全合轴，不占前台」，实际却挤了平A池。
- **改法**：`soukaku.ts` 新增纯函数 `soukakuPerExExtraTime(cfg)`（和产行按同一套读法：击数、体型、劈斩），登记 `estimateExSpecialTime` = 通用强特（实数次数）+ floor(次数) × 补行；合轴 = 通用强特合轴 + 打年糕#3。产行代码没动。
- **影响面**：
  - 苍角残差 47.9→0、41.9→0。
  - 实测：雅-苍角-丽娜 14639868→16477080（+12.6%），苍角-艾莲-耀嘉音 11625375→13463880（+15.8%）。来源：打年糕#3 的合轴抵扣回到账本，≈21s 团队预算让给队友（雅强特 13→14、丽娜 7→8）。这是把实现拉回用户口径，不是新口径。
  - golden：只有 `agent:1131:c0/c3-c6` 的 slack 0→34.216（= 13 次 × 2.632s）。单人没有队友可并行，合轴抵扣出的时间只能留白；先例：卢西娅单人 slack 163.6。伤害与逐槽时间账零差；golden/zd 的预设里没有苍角队，所以组队影响只在上面两支探针队里可见。留白棘轮绿。
- **测试**：`src/mechanics/__tests__/soukakuExTimeCc200.test.ts`：真队伍断言「模块补行 Σ时长 = 强特次数 × soukakuPerExExtraTime」（改产行不改估时会红），分支单测（劈斩 / 小体型 / 1 击），估时公式单测。
- **验证**：vue-tsc 0；verify EXIT=0（3878）；check-guards 通过。
- **回退点**：`git revert d5e18595`；或只删 `soukakuMechanic.estimateExSpecialTime` 那一段（回到折叠追认，golden 的 5 条 slack 回 0）。

### 24.48 CC-201（结论卡，无代码）：席德落华预留试做后撤回；修订 CC-200 判据——只迁「折叠会丢合轴抵扣」的行（第 224 轮）

- **起点**：§24.47 普查表里席德 1461 残差 31–35s，排在下一张。
- **试做**：落华三招次数 = floor(钢能 / 每轮消耗)，是资源驱动 ⇒ 按 CC-200 判据走 `extraNecessaryAction`。难点：钢能里的「招式攻击数据」要对**全部执行行**求和，账本阶段行还没建。试做方案：抽纯函数 `xideFallingCycles`，`extraNecessaryAction` **不带 moveId**（只预留、不补行），攻击钢能读上一轮 `buildExecutions` 写入的 `cfg.xideAttackSteel`（滞后一轮）。备份 `/home/kaua/calc-arch/k224/xide.new`。
- **实测（插桩 + 探针，改前 → 改后）**：
  - 组队 1461-1521-1031、1521-1461-1311：残差 31.2→0，**伤害完全不变**（21231260、25506765）。
  - 组队 1461-1521-1361：残差 34.7→7，+2.6%（希希芙强特 12→13，收敛路径不同）。
  - 单人 c0：3841322→3751009（−2.4%，连携 2→1）；**单人 c6：6209933→5828563（−6.1%），截断 0→48.6s**，残差 +52→−52，重戮 16 行而崩坠只剩 14 行（装配截断切掉了尾部）。
  - golden 另有 `agent:1461:c3-c6` 强特 10→12、平A +29s，两个预设 slack 0→0.6～1.2；留白棘轮红。
- **决定：撤回，席德不做。** 依据：
  1. 席德的落华行**没有合轴**（comboAlignRatio 0）。折叠路径是外层不动点，对无合轴的行只是「事后记账」，收敛结果与预留一致——两支组队伤害逐位不变就是证据。迁移的唯一收益是账本诚实，看不到结果变化。
  2. 代价是真实的：滞后估计进账本后，改变了不动点的选取，单人 c6 被推过预算触发封顶和截断（−6.1%）。要做对，得给钢能一个**不滞后**的估计，也就是在账本阶段复算「全部执行行的攻击数据」——等于复制引擎产行逻辑（CC-198 方案 (b) 的否决理由同样适用）。
- **判据修订（替代 §24.47 的「按残差大小找对象」）**：残差大**本身不是**迁移理由。折叠的真实损害只有一种：行上的**合轴抵扣丢失**（苍角打年糕#3 ⇒ 多挤 21s 平A池）。所以只迁「有 `comboAlignRatio > 0` 的模块前台行」。按这个判据预筛（探针打印非后台、totalTime>0 的行及其 comboAlignRatio）：
  - **1091 雅**：`1091029` 9 次 × 3.434s = 30.9s，**comboAlignRatio 0.709** ⇒ 约 21.9s 合轴抵扣经折叠丢失 ⇒ **值得做**，下一张卡。
  - **1191 艾莲**：模块行 1191006 / 1191011 / 1191027 / 1191029 / 1191030 合轴率全 0 ⇒ 不做。
  - 1461 席德：合轴率 0 ⇒ 不做（本卡）。
- **回退点**：无代码改动。若日后要重做席德，从 `/home/kaua/calc-arch/k224/xide.new` 起步，先解决钢能不滞后的估计，再看单人 c6 截断。

### 24.49 CC-202：雅霜月时间进账本（只预留、含合轴），合轴抵扣回归用户口径（第 225 轮，11bf2ac8）

- **起点**：§24.48 按修订判据预筛出雅 `1091029`（霜月 #3，3.434s，comboAlignRatio = (3.434−1)/3.434 ≈ 0.709）——折叠路径让「仅 1s 锁定在前台、其余合轴」的用户口径失效。
- **次数来源**：floor(spec 资源「落霜」/ 6)，落霜由 `computeSpecResources(spec, cfg, state)` 算，**不依赖当前执行行** ⇒ 没有 CC-201 席德那种滞后。
- **改法**：`miyabi.ts` 新增 `miyabiFrostMoonReserve(cfg, state)`，登记为 `extraNecessaryAction`：返回霜月 #3（带合轴率）+ C6 赠送 #1/#2（0.4s/0.567s，合轴 0），**全部不带 moveId**（引擎只预留、不补行），`decibelRecovery: 0` 显式禁用（账本只读时间与合轴，保险起见不让无 moveId 的项回落倍率表）。产行代码 `buildMiyabiExecutions` 一行没动。
- **同源守卫**：`src/mechanics/__tests__/miyabiFrostMoonReserveCc202.test.ts` 用 `vi.spyOn(miyabiMechanic, 'buildExecutions')` 截取引擎最后一次调用的 cfg/state，拿同一输入调预留函数，逐项比对实际行（次数 / 单次时长 / 合轴率，c0 与 c6），并断言预留无 moveId、每个霜月 moveId 恰好一行。改产行不改预留会红。
- **实测（插桩，改前 → 改后）**：残差全部 → 0，截断全为 0。
  - 雅-苍角-丽娜 c0：16477080 → 19056379（+15.7%，霜月 9→11 次）；c6：27025936 → 29368111（+8.7%）。
  - 雅-柳-蕾米埃尔：27210917 → 30748276（+13.0%）。
  - 雅单人 c0：4258003 → 4441059（+4.3%）；c6：9026243 不变。
- **golden（27 行）**：5 支雅队（auto-1091-1511-1211 / -1511-1411 / -1511-1311 / -1031-1511 / -1221-1581）各槽强特或终结技 +1、平A +3～6s——合轴抵扣释放的团队预算回流；`agent:1091:c0-c6` slack +31.6～34.1s（单人合轴抵扣无处可让，同苍角 / 卢西娅）。留白棘轮：auto-1091-1031-1511 留白 3.4→0（改善，零容差基线重生成）。两份基线已用 TIME_GOLDEN_UPDATE=1 / TIME_RATCHET_UPDATE=1 重生成。
- **验证**：vue-tsc 0；verify EXIT=0（3881 passed）；check-guards 通过。
- **回退点**：`git revert 11bf2ac8`；或只删 `miyabiMechanic` 里的 `extraNecessaryAction` 登记（回到折叠追认）。
- **这条线的收尾判断**：按 §24.48 判据（只迁有合轴的模块前台行），§24.47 普查表里有合轴的两处（苍角 CC-200、雅 CC-202）已处理完；席德、艾莲、克拉蕾、洛克茜、月城柳均判不做。**「模块必做行时间预留」这条线到此结束**，除非日后新模块产出带合轴的前台行——届时照 CC-202 的写法（预留函数 + spy 同源测试）。

### 24.50 CC-203：额外能力两道门控归一——一张派生表，引擎与 store 共读（第 226 轮，fb64de6f）

- **起点**：§24.46 末条的观察。两道门：① 引擎硬门控 `evalAdditionalAbilityBuffGates`（用户强行勾上也拦），按手写表 `ADDITIONAL_GATE_BUFFS`（15 角色 / 19 条）；② store 默认门控 `deriveTeammateBuffEnabled`（只决定默认勾不勾），按来源标签「额外能力」。两道门用同一个 `evalAdditionalAbility`，**只是「哪些 buff 受门控」各有一份答案**。
- **先回答的问题：未触发时用户能否手动打开？** 不能。依据：`lighterAdditionalGate.test.ts` 头注释明写既定口径「强行勾上后面板层仍拦住」（census §5.45）；手写表里的 19 条一直如此。⇒ 硬门控是口径，没进表的反而是漏网。
- **探针结论（全 catalog 分组 × 表）**：
  - 15 条「额外能力」buff 只有软门控，未触发时强行勾上照样生效：1481、1411、1581×4、1141、1451、1391、1181、1271、1331、1381、1501、1541。
  - 反方向：跨来源条目（1461 核心被动 / 影画二、1421 影画一、1351 影画六）store 不认，**默认勾上、引擎静默丢弃**（UI 显示已勾，实际不生效）。c0 下只有席德核心被动暴露（影画条目被影画门槛挡住），c6 下三处都会。
  - 1511 南宫羽：无 additionalAbility 声明，两道门都不门控（未决项不变，见 `AA_OWNER_EXEMPT`）。
- **改法**：新文件 `src/specs/additionalGate.ts`：
  - `additionalGateBuffTable(groups)`：来源（`source.zhCN ?? sourceLabel.zhCN`）为「额外能力」且拥有者（**组 id**）spec 有 `additionalAbility` 的 buff，加上跨来源登记 `ADDITIONAL_GATE_CROSS_SOURCE_BUFFS`（只剩 1461×2、1421 影画一、1351 影画六）。按 groups 数组身份 WeakMap 缓存。
  - 引擎 `evalAdditionalAbilityBuffGates(team, getCatalogAgent, groups)` 多一个 groups 参数，调用方传 `catalogStore.teammateBuffGroups`；凯撒 / 菲欧妮专属修正仍走 `adjustAdditionalAbilityGates`，不动。
  - store `deriveTeammateBuffEnabled` 的判据从「标签 === 额外能力」改成「在这张表里」。
  - `ADDITIONAL_GATE_BUFFS` 删除（helpers 壳与 panelPhasesShell 契约改为导出 `additionalGateBuffTable`）。放在 specs 层是因为 store 与 composables 都要读，specs 已被两边引用、无环。
- **为什么值得做（按唯一判据）**：更通用——新角色的「额外能力」buff 自动被两道门门控，不用再手动登记（原表头「必须在此登记，否则门控静默失效」这个陷阱没了）；更简单——「哪些 buff 随额外能力门控」只剩一份答案，两道门不可能再分叉。
- **测试**（`additionalGate.test.ts`）：
  - 表内 id 全可解析回拥有者分组、拥有者全有声明；来源「额外能力」全员在表（豁免只有 AA_OWNER_EXEMPT）。
  - 莱卡恩未触发时引擎拦、触发时放行（改前这里是放行）。
  - **同口径守卫**：全员拥有者 × 任一队友 × 影画 0/6（>1000 组）断言「引擎关 ⇒ store 默认不勾」。已知的有意偏差只有菲欧妮 tier3（引擎另需异常数≥3，store 只看额外能力），列在 `KNOWN_STRICTER`。
  - `substatOptimizer.test.ts` 席德明攻用例：原本依赖「store 默认勾上、引擎剔除」这个不一致来获得判别力；改为先断言默认不勾，再强行勾上验证引擎剔除。
- **影响面**：数值零差——默认配置下两道门结果本来一致（store 已软关的 15 条引擎也拿不到；跨来源条目引擎本来就丢）。timeGolden / 留白棘轮不变。行为变化只在两处：用户强行勾上 15 条之一时不再生效；席德 / 潘引壶 / 波可娜的跨来源条目在未触发时 UI 默认不再勾上。
- **验证**：vue-tsc 0；verify EXIT=0（3883 passed）；check-guards 通过。
- **回退点**：`git revert fb64de6f`。若日后决定「额外能力允许手动强开」：只改引擎侧（`evalAdditionalAbilityBuffGates` 只对 `ADDITIONAL_GATE_CROSS_SOURCE_BUFFS` 与专属修正生效），store 仍读表做默认。

### 24.51 CC-204：freeCompare 汇总表胜负着色 + 格式化改读结果自带的指标（第 227 轮，9aed3fc4）

- **起点**：`MetricDef.higherBetter` 零读取（write-only-props 表，第 213 轮 CC-190 保留为「方向元数据」），注释却声称已有「表格胜负着色」。二选一：实现，或把注释改成实话。**选实现**。依据：自由对比页本身就是对比工具，每档谁赢是用户读表时的第一个问题；元数据已经就位（含 3 个越小越好的时间指标），代价只有一个纯函数加一个 class。
- **改法**：
  - `metrics.ts` 新增纯函数 `bestSeriesIndexByLevel(def, series)`：每个 x 档按方向取最优系列下标集合。并列全标（相对差 ≤1e-9）；null 不参与；可比系列少于 2 个时不标（没有对手就没有胜负）；全员并列也不标。
  - `FreeComparePage.vue` 汇总表：最优格加 `fc-best`（`--c-success` 字色 + `--c-success-soft` 底色，加粗）；多系列时表上方一行说明「绿底 = 该档最优（本指标越小越好 / 越大越好）」。
  - **顺手修的真 bug**：表格、折线、纵轴的格式化原本读下拉框的**当前值** `metricId`。对比完再切换指标，旧结果会按新指标的单位和小数位显示，比如切到百分比指标后数字被 ×100。改为读 `resultDef = metricDef(result.metricId)`。着色也按结果自带的指标算，否则切换指标时方向会错。
  - `scripts/check-tokens.mjs` 的 `VAR_TOTAL_BASELINE` 797 → 799：新增两处语义令牌引用，脚本本身提示这是进步方向。
- **测试**（`freeCompare.test.ts` 3 条）：
  - 同一组数据在两个方向下结果相反；
  - 边界：并列、全员并列、null、单系列；
  - 注册表里越小越好的指标恰好是 frontlineTime / timeBudgetResidual / overflowSeconds，并用真实 `overflowSeconds` 定义跑一次。
  - 没有写组件测试：着色逻辑全在纯函数里，组件只做 class 绑定，由 vue-tsc 与 build 兜底。
- **验证**：vue-tsc 0；verify EXIT=0（3886 passed，build 通过）。
- **回退点**：`git revert 9aed3fc4`。只撤着色、保留格式化修复：删掉 td 的 `:class` 和说明行即可。

### 24.52 CC-205：T2 第 1 批——一个「死字段」其实是展示写死的真值（第 228 轮，d95a2957）

- **零号安比 `teamFollowupDmgBonus`：不删，改为让结果卡读它**。
  - 结果卡「全队追攻增伤」写死 `+25%`，anbyZero.ts 头注释和卡片说明都写着「潜能电脉冲 34-50% 档位待 teamBuff 通道支持 potentialLevel，暂以基线 25 建模」。
  - 实际上 spec `1381.json` 的 `anby_zero_extra_team_followup` 早就是 formula：`25 + min(1, max(0, x-1))·(4x+1)`（x = potentialLevel），即 25/34/38/42/46/50，引擎满潜生效 50%。卡片与注释是过时的。
  - 死字段算的恰恰是正确值（常量表 `ANBY_ZERO_TEAM_FOLLOWUP_DMG_BY_POTENTIAL` 与公式逐档相等），只是没人读。
  - 改法：卡片改读字段，未触发额外能力时显示 0；去掉字段里的 ×silverStarCoverage（引擎侧这条 teamBuff 只乘自身覆盖率，不乘银星覆盖率，原字段即使被读也是错值）；注释改实话。
  - 测试（anbyZero.test.ts 两条）：① 常量表与 spec 公式逐档相等，并锁住公式文本（公式一改就红，提醒同步展示表），字段不随银星覆盖率变化；② 真引擎：队友面板满潜比 1 潜 `dmgBonus__additionalAttack` 多 25。
  - 为什么保留两份（常量表 + spec 公式）而不做单源：让模块在展示时求 spec 公式，需要引入公式求值器的依赖，对一张 6 格的表不划算；用同源测试锁住即可。回退点：要单源时删掉常量表，卡片改为从面板读 `dmgBonus__additionalAttack` 的来源分量。
- **删除**：菲欧妮 `PhoenixCycle.c1CritDmg` 和 `emberGain`（后者恒为 0；`PHOENIX_C1_CRIT_DMG` 仍被脆弱暴击计算使用，保留）；叶瞬光 `feiguangPerForm`（`@deprecated`，等于 `feiguangFullCasts / totalForms`，零读取）。
- **影响面**：引擎数值零差（只动展示与死字段）；verify EXIT=0（3888 passed，build 通过）；vue-tsc 0。
- **教训，改变 T2 的做法**：「零读取」不等于「可删」。字段零读取，可能是因为展示层绕开它写死了一个过时的值。T2 剩余条目先分类再动手：
  - (a) 纯死字段 → 删；
  - (b) 字段对应某处**写死 / 过时的展示值或注释承诺** → 改为让展示读字段（这是真 bug）；
  - (c) 只被测试读的诊断字段 → 按第 215 轮裁决默认保留。
  - 分类方法：grep 字段名的语义关键词（label 文本、常量名），看结果卡 / 页面里有没有写死同一个量。
- **回退点**：`git revert d95a2957`。

### 24.53 第 229 轮：T2 收尾（不做）+ CC-206 store 默认门控直接调引擎求值函数（a119557d）

- **T2 收尾**：全量分类后整体不做，理由与分类表见 `docs/mcp-write-only-props.md`「T2 收尾（第 229 轮）」。
- **CC-206 起点**：CC-203 统一了门控表，但 store `deriveTeammateBuffEnabled` 仍自己算一份 `aaActiveMap`（只看 spec `additionalAbility` 声明），不经模块修正 `adjustAdditionalAbilityGates`。结果两道门在两个方向上仍会分叉：
  - 凯撒 1071（模块把「其他可招架支援角色」近似成「有任意队友」）：配异阵营、非支援队友时，引擎放行，store 默认不勾，用户看到的伤害里没有这条；
  - 菲欧妮 1641 tier3（模块另需异常数 ≥3）：异常数不足时 store 默认勾上，引擎丢弃（UI 显示已勾、实际不生效）。
  - 第 226 轮交接写「store 侧没有 ReadonlyTeam 形态的输入」是**错的**：`deriveTeammateBuffEnabled` 里本来就构造了 `mechanicTeam: MechanicTeamMember[]`。
- **改法**：
  - `evalAdditionalAbilityBuffGates` 逐字迁到新文件 `src/mechanics/additionalAbilityGates.ts`。放 mechanics 层是因为 store 值导入 panelPhases 会成环（`resourceCalc/helpers.ts` 值导入 stores/config），而该函数的依赖两边都已在用；从 `./registry` 取 `getAgentMechanic`，避免与角色模块互相 import。panelPhases re-export，壳契约（同一绑定）不变。
  - store 删掉 `aaActiveMap` 及 `evalAdditionalAbility` / `additionalGateBuffTable` / `getAgentSpec` 三个导入，改为 `aaGates = evalAdditionalAbilityBuffGates(mechanicTeam, …, groups)`，判据 `aaGates.get(buff.id) === false ⇒ 默认不勾`。**「默认勾不勾」==「引擎认不认」**，按构造成立。
- **为什么值得做**：同一个判断只剩一处实现（更简单）；以后新模块的门控修正自动同时作用于默认值和引擎（更通用）。
- **测试**（`additionalGate.test.ts`）：同口径守卫去掉 `KNOWN_STRICTER` 豁免（全员 × 任一队友 × 影画 0/6，无例外）；新增凯撒 + 安比默认勾上、菲欧妮 + 简 tier2 勾 / tier3 不勾。CC-67 源码锁改指向新文件。
- **影响面**：timeGolden / 留白棘轮零差（现有预设里的凯撒队都满足原始声明条件）。行为变化只出现在「凯撒 + 异阵营非支援队友」（默认多勾一条）和「菲欧妮异常数不足」（tier3 默认不勾，引擎本来就丢）。verify EXIT=0（3889 passed）；vue-tsc 0。
- **回退点**：`git revert a119557d`。
- **同类遗留 → 下一轮 CC-207**：store 里还有只在 store 生效的钩子 `teammateBuffGate`（`pulchra.ts:158`、`remielle.ts:437`）。其中波可娜是**正确性约束**：6 命时基础条 `pulchra_extra_trap_followup` 必须关掉，防止与 `pulchra_cinema_6_trap_all` 重复计算。但它只作用于默认值，用户强行勾上时引擎会算两遍。与 CC-203 / CC-206 是同一类问题的镜像（默认层有约束、引擎层没有）。

### 24.54 第 230 轮：CC-207 模块钩子 teammateBuffGate 由 store 与引擎共读（fb0b8205）

- **起点**：`teammateBuffGate` 原契约是「只 store 读、只影响默认值」。现有两个实现逐个判断后，**都属于正确性约束，不是默认值偏好**：
  - 波可娜 1351（`pulchra.ts:158`）：6 命时基础条 `pulchra_extra_trap_followup` 必须关掉，否则与 `pulchra_cinema_6_trap_all` 重复计算；
  - 蕾米埃尔 1581（`remielle.ts` 的 `REMIELLE_BUFF_GATES`）：`atk_1/2/3` 是互斥档位，`refringe_3` 只在 3 档成立，prismatic 需要额外能力触发。
  - 用户强行勾上被否决的条目时，引擎照样计入：波可娜会双计，蕾米埃尔会多档叠加。与 CC-203 / CC-206 是同一类问题（默认层有约束，引擎层没有）。
- **改法**：
  - `src/mechanics/additionalAbilityGates.ts` 新增纯函数 `teammateBuffGateBlocks(team, groups) → Set<buffId>`：遍历已注册模块的钩子，按 agentId 与 teammateBuffId 建立 cinemaByGroup，多个钩子之间取逻辑与。
  - store `deriveTeammateBuffEnabled` 删掉自建的 `buffGateTeam` / `buffGates` / `resolveSpecialTeammateBuffEnabled`，改为 `!gateBlocked.has(buff.id)`；
  - 引擎 `resolveSlotPanelBuffInputs` 在额外能力门控旁边加一道同源过滤 `!gateBlockedBuffs.has(buff.id)`。
  - `mechanics/types.ts` 契约注释改为「store 与引擎共读，只放正确性约束」。默认值偏好不该放进这个钩子（用户勾选应当生效）。
- **为什么值得做**：同一个判断只剩一处实现（更简单）；以后的新钩子自动两层同时生效（更通用）。
- **测试** `teammateBuffGateEngineCc207.test.ts`：
  - 波可娜 C6 配艾莲：强行勾上基础条，队友面板逐字节不变；判别性对照：关掉影画六条后面板变化；C0 时基础条不被否决。
  - 蕾米埃尔配简：三档加 refringe_3 全部强行勾上，面板不变；判别性对照：关掉当前档后面板变化。
  - **反证**：临时去掉 panelPhases 那道过滤，波可娜和蕾米埃尔两条测试都失败（证实改前确实双计 / 叠档），随后已恢复。
- **影响面**：默认配置下 store 本来就关掉了这些条目，所以 timeGolden / 棘轮零差。行为变化只出现在用户手动强行勾选的场景：结果变得与 UI 语义一致（被否决的条目不再生效）。verify EXIT=0（3892 passed / 29 skipped）；vue-tsc 0。
- **已知限制**：UI 仍允许勾选被否决的条目，只是不生效。如需在 UI 上置灰，后续可让面板读 `teammateBuffGateBlocks`（纯展示改动，不影响计算）。
- **回退点**：`git revert fb0b8205`。

### 24.55 第 231 轮：CC-208 展示层「本槽生效的队友 buff」取引擎同一份输入（03680c60）

- **扫描**（按第 230 轮交接的「同一判断多处实现」）：
  - `evalAdditionalAbility(` 共 4 处调用点：`additionalAbilityGates.ts`（门控）、`panelPhases.ts:576`（面板 `additionalAbilityActive` 标志）、`rina.ts:297`（丽娜电属性积蓄加成）、`miyabi.ts:86`（雅自身条件）。四处都在引擎侧，而且回答的是不同问题（门控 / 面板标志 / 各自的机制条件），都调用同一个求值函数，**不算重复实现，不做**。
  - `getRegisteredAgentMechanics()`：只有 registry、roundInputs、additionalAbilityGates、agentMechanicView（轴预设展示）四处使用，没有重复求值，**不做**。
  - **命中**：展示层有两处自己拼「已启用的队友 buff」，做法是遍历 `teammateBuffGroups` 再看 `isTeammateBuffEnabled`：
    - `FinalPanel.vue` 的 `collectHpSources` 第 2 步（局内生命构成核对表）；
    - `DebugPage.vue` 的 `enabledTeammateBuffs` → `addTeamBuffRows`。
  - 引擎的面板输入 `resolveSlotPanelBuffInputs` 在勾选之后还有 6 道处理，展示层一道都没做：拥有者在队、`singleSourced` 不进数值通道、修饰器改写数值（丽娜 C1 / 莱特 C2）、额外能力门控（CC-203/206）、模块钩子否决（CC-207）、接收槽过滤（CC-130）。
  - 结果：这两个**用于核对**的界面会列出引擎实际丢弃的条目，或列出改写前的数值，核对表和面板对不上。
- **改法**：
  - `helpers.ts` 壳 re-export `resolveSlotPanelBuffInputs`（沿用 import + export 两行写法）；
  - 两个展示点改为 `resolveSlotPanelBuffInputs(slot, …).teammateBuffs.filter(b => b.sourceKind !== 'global')`，排除全局 Buff 是因为两页都另有单列。
  - 顺带修正 DebugPage 的错误备注。旧文案是「请注意现有面板计算主要读取 Buff 数据自身的默认 coverage」，已过时：滑块覆盖率经 `effectCoverageMap` 进入 `core/panel.ts` 的 `applyBuffs`。新文案是「覆盖率 X%（配置页滑块，引擎按此比例折算本条效果）」。
- **为什么值得做**：「哪些队友 buff 作用于本槽」只剩引擎一处实现（更简单），以后新增的过滤会自动出现在核对界面上（更通用）。副词条优化器第 194 轮已经这样接入，本轮是把最后两个展示点也接进来。
- **核查**：全数据只有 1 条 `singleSourced`，且没有生命类 stat，所以 FinalPanel 生命核对表不会因为排除 singleSourced 而少掉本应显示的行。
- **测试** `displayTeammateBuffsCc208.test.ts`：
  - 行为：波可娜 C6 强行勾上基础条后，store 显示已勾，引擎输入里没有这条，影画六条在；这正是旧展示口径会误列的情形。
  - 源码锁：两个展示点必须调用 `resolveSlotPanelBuffInputs(`，且不能出现「`teammateBuffGroups` 后 200 字符内跟着 `isTeammateBuffEnabled(`」的重筛写法。旧代码两处都会被这条锁拦下。
- **影响面**：只改展示，计算零改动；golden 零差。verify EXIT=0（3894 passed / 29 skipped）；vue-tsc 0。
- **回退点**：`git revert 03680c60`。

### 24.56 第 232 轮：CC-209 局内生命构成拆解迁出视图，与引擎同口径并给出差额（2a88f81d）

- **起点**（第 231 轮交接第 1 项）：`FinalPanel.vue` 的「局内生命构成」核对表是视图里约 150 行的缩小版 buff 引擎，逐项对照引擎后有 4 处分叉：
  1. **覆盖率**只读 `effect.coverage.default`，不读引擎实际用的 `effectCoverageMap`（队友滑块、音擎效果滑块、全队驱动盘滑块）。用户拖滑块后，公式行的 Σ 与引擎局内 hp 对不上。
  2. **全局 Buff** 被包成没有 `scope` 的伪分组，`hpPhase` 会把 hpPct 判为「局外」；而引擎把全局 Buff 当局内（`resolveSlotPanelBuffInputs` 的 `scope: 'inCombat'`）。
  3. **覆盖率显示**：coverage 是 0–1 的小数，旧代码 `pct(cov)` 把 50% 显示成「0.5%」。
  4. **不可列出的来源**：模块 `applyPanel` / `teamPanelEffects` 在 calcPanel 之后直接写面板，转模 / 公式条目也只标注、不计数，所以逐条相加本来就不保证等于引擎值，公式行却写成等式。
- **为什么不改成从引擎收集结果出表**：`calcPanel` 返回的 `buffs.inCombat` 是扁平的效果列表，**不带来源标签**，而这张表的用途恰恰是回答「谁提供的」。给效果加上来源元数据要改 core 的收集链路，收益只落在一张核对表上，不值得。所以采用折中：保留视图侧的来源枚举，数值口径（覆盖率、全局 Buff 的阶段、队友 buff 列表）对齐引擎，剩余差额显式列出。
- **改法**：
  - 拆解逻辑迁到新文件 `src/composables/hpSourceBreakdown.ts`，导出：
    - `collectHpSources(slot, configStore, catalogStore)`；
    - `hpBreakdownTotals(rows, outHp, inHp) → { inHpPctTotal, inHpFlatTotal, residualHp }`。
  - 覆盖率 = `effectCoverageMap.get(id) ?? coverage.default ?? 1`，与 `core/buff.ts#applyEffect` 同一个式子。
  - 队友 buff 和全局 Buff 都取 `resolveSlotPanelBuffInputs(...).teammateBuffs`（全局 Buff 按 `sourceKind === 'global'` 单列）。
  - `residualHp` = 引擎局内 hp −（局外 hp × (1 + Σ% / 100) + Σ固定）。|差额| ≥ 0.5 时，公式行追加「+ 未逐条列出」，表格也追加一行，公式恒等于引擎值。
  - FinalPanel 净删约 140 行，只负责渲染。
- **为什么值得做**：数值口径只剩引擎一处（更简单）；以后新增的覆盖率或过滤会自动生效（更通用）；逻辑离开视图后可以用 harness 测试（此前零测试）。
- **测试** `hpSourceBreakdownCc209.test.ts`，队伍为卢西娅 1451 + 11 号 1041，被测条目是 `lucia_elowen.core_dream_song`（局内 hpPct 5）：
  - 默认：差额 ≈ 0；
  - 滑块 50%：引擎局内 hp 确实下降（判别性对照），条目折半为 2.5，差额 ≈ 0；
  - 全局 Buff hpPct 10：按局内列出，差额 ≈ 0。
  - **反证**：覆盖率临时改回只读 `coverage.default`，滑块那条测试失败，随后已恢复。全局 Buff 阶段那条的反证没跑，旧代码的问题是按代码推理得出的。
  - CC-208 的源码锁随迁：锁的对象从 FinalPanel.vue 改为 hpSourceBreakdown.ts；另加一条：FinalPanel 本体不得出现 `teammateBuffGroups`，且必须经 `collectHpSources(slot, configStore, catalogStore)` 取数。
- **影响面**：只改展示，计算零改动；golden 零差。verify EXIT=0（3898 passed / 29 skipped）；vue-tsc 0。
- **已知限制**：
  - 差额行只给一个 hp 总数，不区分百分比和固定值，也不指明是哪个模块写的。要细分，得让模块钩子上报贡献，不值得为核对表做。
  - 队友 4 件套全队段落在本槽的部分，本表没有逐条列（只列本槽自己的盘），会落进差额行。
- **回退点**：`git revert 2a88f81d`。

### 24.57 第 233 轮：CC-210 展示层音擎精炼取值统一走引擎 applyWEngineModLevel（bdc03f72）

- **扫描**（第 232 轮交接第 1 项）：
  - `coverage.default`：命中 MechanicsTablePage:263 和 WEngineFieldPage:170，展示的都是**数据定义**（默认覆盖率、覆盖率范围），不代表用户当前状态，不会误导，**不做**。AttributeConfigPage:550 只判断有没有覆盖率字段，**不做**。
  - `modificationValues`：命中 3 处展示点，各自按精炼等级替换数值：
    - DebugPage `effectValue`：只替换 `value`，**漏掉 `valuePerStack`**；
    - hpSourceBreakdown `hpEffectValue`（CC-209 从 FinalPanel 照搬）：同样漏掉；
    - TeamConfigPage `effectValueText`：两个都替换，但是独立实现。
  - 引擎口径是 `core/buff.ts#applyWEngineModLevel`，两个字段都替换。数据里有 181 条音擎效果带 modificationValues，其中 **43 条按精炼改每层值**（如 13115 atkPct、14109 iceDmg）。精炼 ≠ 1 时，DebugPage 显示的是原值。
  - WEngineFieldPage:152 展示整条精炼数值序列，属于数据定义页，**不做**。
- **改法**：
  - 新增 `src/composables/wEngineEffectDisplay.ts#effectAtModLevel(effect, modLevel)`，内部就是 `applyWEngineModLevel`；modLevel 缺省时原样返回。展示层不能值导入 core，所以经 composable 暴露，与 CC-47~53 的做法相同。
  - 三处展示点改为先取「引擎实际用的 effect」再格式化，不再自己索引 modificationValues。hpSourceBreakdown 的 stacked 行也带上「（精炼N）」前缀。
- **为什么值得做**：精炼取值只剩引擎一处实现（更简单），少了一处与引擎的实际分叉（DebugPage、生命构成表的每层值）。
- **测试** `wEngineEffectDisplayCc210.test.ts`：
  - 全部按精炼改每层值的效果在精炼 5 时都取到第 5 档；判别性对照：确有条目精炼 5 与原值不同；
  - modLevel 缺省时原样返回；
  - 源码锁：三处展示点不得出现 `modificationValues?.value|valuePerStack`，且必须调用 `effectAtModLevel(`。
- **影响面**：只改展示，计算零改动；golden 零差。verify EXIT=0（3901 passed / 29 skipped）；vue-tsc 0。
- TeamConfigPage 有一处细微变化：旧写法在效果带 modificationValues.valuePerStack 时，不论 type 都显示成「× 层」；新写法按 type 格式化（与引擎 applyEffect 的分支一致）。数据里这类效果都是 stacked，实际显示不变。
- **回退点**：`git revert bdc03f72`。

### 24.58 第 234 轮：CC-211 展示层音擎发放判定与引擎同源 +「展示层 vs 引擎」线结项（b96bbaa0）

- **扫描**（第 233 轮交接第 1 项）：
  - 叠层层数 `defaultStacks ?? maxStacks ?? 1`：WEngineFieldPage、DebugPage、TeamConfigPage、hpSourceBreakdown 都与引擎 `applyEffect` 一致。AttributeConfigPage:540 的 `maxStacks ?? defaultStacks` 是滑块上限，本来就该这么取。**不做**。
  - 音擎职业匹配：引擎 `collectWEngineBuffs` 依次判断三层：职业 → 组级 `wEngineConditionMet`（目前只判断 `attributeCounter`，其余条件恒放行，由覆盖率近似）→ 效果级 `wEngineEffectRequirementMet`（数据里 4 条：3 条限以太装备者、1 条限 1551）。展示层只判断第一层：
    - DebugPage `addWEngineRows`：备注按分组写死「职业匹配，当前会生效」，限定装备者的条目在不满足时也显示「会生效」。**会误导，做**。
    - hpSourceBreakdown 第 3 步：唯一带条件的生命效果（14145 hpPct，`etherVeilStartOrExtend`）引擎恒放行，**目前零分叉**。但同一个谓词顺手统一，避免以后数据变化时分叉。
  - 另外几处 specialty 比较不属于同类问题：TeamConfigPage:358「匹配=」字面就是职业匹配；teamTimelineStore / freeCompare 是在挑选推荐音擎；helpers.ts:521 是加农转子事件，走数据表的 `requiresSpecialtyMatch`。
- **改法**：`composables/wEngineEffectDisplay.ts` 新增 `wEngineEffectBlockReason(wEngine, group, effect, wearer, enemyWeakness) → string | null`，三层判断直接调用引擎函数，不发放时返回原因。
  - DebugPage 的 `addEffectRows` 备注参数改为可接收「按单条效果生成」的函数，逐条显示「<原因>，当前计算不会生效 / 当前会生效」。
  - hpSourceBreakdown 第 3 步改为逐条过滤。
- **测试** `wEngineEffectGateCc211.test.ts`：
  - 等价性：全部音擎 × 全部角色 × {未声明弱点, 冰弱点}，`reason === null` 的效果 id 集合与引擎 `collectAllBuffs(有音擎) − collectAllBuffs(无音擎)` 逐条相等，覆盖超过 1000 个组合。判别性对照：确有「职业匹配但被组条件或效果限定拦下」的条目。
  - 源码锁：DebugPage 和 hpSourceBreakdown 必须调用 `wEngineEffectBlockReason(`，且不能出现只按职业判断的写法 `w(Engine).specialty === agent.specialty`。
- **影响面**：只改展示，计算零改动；golden 零差。verify EXIT=0（3903 passed / 29 skipped）；vue-tsc 0。
- **回退点**：`git revert b96bbaa0`。
- **「展示层 vs 引擎」线结项**（CC-208 ~ CC-211）。展示层自己重算引擎口径的点已经全部收口到引擎函数，每一步都有源码锁：
  - 队友 buff 列表 → `resolveSlotPanelBuffInputs`；
  - 覆盖率 → `effectCoverageMap`；
  - 精炼取值 → `applyWEngineModLevel`；
  - 音擎发放 → `wengineConditions`。
  - 剩下的 `coverage.default` / `modificationValues` 读取点都在数据定义页（MechanicsTablePage、WEngineFieldPage），展示的是数据本身，不代表用户当前状态，**不做**。
  - 以后若新增展示点要列「生效的效果」，先找引擎对应函数，经 composable 暴露。

### 24.59 第 235 轮：CC-212 诺姆 1571 转模常数单一来源 = spec，补齐 CC-134 floor（7b2af5ce）

- **起点**：复核 `ARCHITECTURE-OVERVIEW.md` §6.4「同一机制两处实现」。当时剩下的 1571 诺姆 3 条 attributeConversions 在第 140 轮判「不做」（r6 §2.2）：spec runtime 表达不了定向失衡落点和贯穿力来源。所以 spec 条目是纯记录，模块 `norma.ts` 另写 6 个常数。复核发现三处**已经分叉**：
  1. **步数口径**：CC-134（第 158 轮）裁决「每超过 N 一律 floor」，§2.18 表把 1571 记为「spec｜floor｜✅」。但 spec 条目不执行，模块一直是 `over × 1.7` 连续计算，**裁决从未落到 1571 的计算上**。
  2. **来源相位**：spec 两条暴击转化记着 `sourcePanelPhase: inCombat`，模块从 CC-128 起读局外面板。机制表页展示的是 spec，与计算不一致。
  3. **validate-specs 的放行条件**只是 note 里有「实现位置：」，不核对数值，漂移没人拦。
- **第三条路**：第 140 轮只考虑了「spec runtime 执行」和「模块自持常数」两种。其实可以**模块负责来源和落点，常数与步数口径从 spec 读**：不用扩展 runtime，也不会成环（mechanics → specs 是允许的方向，alice.ts 已有先例）。
- **改法**：
  - `src/specs/runtime.ts` 抽出纯函数 `specConversionAmount(conversion, sourceValue)`：超出阈值 → 步数（按 stepRounding）→ × valuePerStep → 封顶。`applySpecAttributeConversions` 改为调用它，其余调用点逐位不变。
  - `norma.ts` 删掉 6 个常数，新增 `normaConversion(id)` 从 spec 取条目（缺失即抛错），三处都走 `specConversionAmount`。
  - `1571.json`：两条暴击转化的 `sourcePanelPhase` 改为 `outOfCombat`；note 写明「常数与步数口径以本条目为唯一来源」；pen_to_atk 的 note 写明 sourceStat `penRatio` 只是占位，来源是 `calcPenetrationPower`。
- **数值变化（决定：采用 floor）**：
  - 依据：CC-134 的统一裁决明确列了 1571，这次是补执行，不是新的口径决定。
  - timeGolden 共 15 条变化，已逐条解释后用 `TIME_GOLDEN_UPDATE=1` 更新：
    - 13 个含 1571 的预设伤害下降 0.05% ~ 0.09%，时间账零变化。这是暴击率、贯穿力的小数部分不再计入的预期量级。
    - `auto-1371-1571-1451`：伤害 −3.94%，失衡 4 → 3，三槽连携 / 终结次数随之减少。原因是定向失衡加成取整后少了不到 0.8%，这个预设正好卡在失衡次数临界点，少一次失衡带出级联。这是离散失衡计数的悬崖效应，与 §2.18「外层不动点对微小输入敏感」是同类，不是改动本身有问题。
  - **回退**：在 spec 三条上加 `stepRounding: "none"` 即可逐位恢复（这正是该字段保留的用途）。
- **测试** `normaSpecSingleSourceCc212.test.ts`：
  - 暴击 67.3 时按 17 步计（旧连续写法会得 17.3 步，测试失败）；
  - 暴击 100 时封顶 85 / 40；
  - 贯穿力 400.3 取 400 步 × 1.25；
  - spec 暴击两条都声明局外来源；
  - 源码锁：norma.ts 不得出现 `CRIT_TO_ / PEN_TO_ATK`，并且恰好 3 处调用 `normaConversion('norma_`。
- **§2.18 表全量复核**：「实现 = spec」的 7 行（1401、1451 C6、1481、1511、1541、1561、1571）中，其余 6 个模块都真实调用 `applySpecAttributeConversions`，**只有 1571 这一行是假的**，现已订正。
- 1051 伊德海莉的「hp → 贯穿力 0.1」也是纯记录条目，但它记的是引擎对全体命破角色通用的贯穿力公式（`core/damage.ts#calcPenetrationPower`），不是角色模块私有的常数，**不做**。
- verify EXIT=0（3908 passed / 29 skipped）；vue-tsc 0；validate-specs 1120 项通过。
- **回退点**：`git revert 7b2af5ce`（含 golden）；或只回退口径，按上面加 `stepRounding: "none"`。

### 24.60 第 236 轮：「实现位置：」纯记录条目全量核对（无新分叉）＋ CC-213 validate-specs 逐条消费证据（cd9a7486）

**扫描范围**：`grep -n '实现位置：' src/specs/agents/*.json`，共 21 条，分布在 13 个文件：1051、1261×2、1281、1331×2、1401、1411、1481、1511×2、1541、1571×3、1581、1611×3、1621×2。覆盖 attributeConversions / events / resources / additionalAbility 全部字段。

**逐条结论**
- 模块真实执行 spec，单一来源：1261、1481、1541、1571（CC-212 后）；1511 南宫羽的展示值 `impactFromMasteryOf` 也经 spec runtime 计算。
- 散文公式但数字与模块常量逐项一致：
  - 1401 爱丽丝影画 6：3300% 对应 `C6_DAMAGE_RATIO = 33`；
  - 1331 薇薇安两条 events：每十点系数 6.15 / 3.2 / 8 / 0.75 / 1.08 / 0.32 与 `VIVIAN_RELEASE_RATIO_PER_TEN` 一致，影画 2 ×1.3、影画 6 ×5、DoT 0.55 秒 / 55% 一致；事件里的 count（6、327）只是示意值，不参与计算。
- 1051 伊德海莉：记录的是引擎通用公式 hp×0.1 → 贯穿力（`core/damage.ts#calcPenetrationPower`），与引擎一致，不是模块常数；归一已否决（见 §24.59 前后记录）。
- 1281、1611（gash 资源）、1621（wind_eye）、1261 / 1411 / 1581 的 additionalAbility：都是散文规则，没有可比对的独立常数；1281、1581 的 resources 已由 CC-120 审计（`docs/mcp-spec-resources-audit.md`，1581 耀变系数已修）。
- **结论**：除了已由 CC-212 修复的 1571，没有新的「记录说 X、执行的是 Y」。本线结项。

**顺带复核 CC-212 的悬崖**：`auto-1371-1571-1451` 失衡次数 4 → 3，属于 `docs/mcp-outer-fixedpoint-continuity.md` §5 第 161 轮已裁决的「物理失衡次数整数台阶，不是缺陷，不修」，不重开。

**CC-213（validate-specs 逐条消费证据）**
- 改动：`scripts/validate-specs.mjs` 的死数据检查，除了原有两条（模块调用 `applySpecAttributeConversions`；note 含「实现位置：」），新增 ①′：模块调用 `specConversionAmount(` **且**源码里出现该条目的 id（带引号）时，认定该条被消费。
- 为什么：1571 在 CC-212 后已真实读 spec，但检查仍只能靠 note 标记放行；note 是人写的，正是 CC-212 那次误判的源头。现在是逐条的代码证据，只有 1051 这类引擎公式条目还走 note 通道。
- 反例验证：把 1571 三条 note 的「实现位置：」去掉，检查仍然 0 FAIL（靠逐条证据）；再把 `norma.ts` 里一处 `normaConversion('norma_pen_to_atk')` 的 id 改坏，`norma_pen_to_atk` 报 FAIL。两处临时改动都已还原。
- 零数值影响（只改校验脚本）。回退点：还原 `scripts/validate-specs.mjs` 这两处（注释①′ 与 `readsById`）。

### 24.61 第 237 轮：自选扫描，没有可做项

r6 清单全部结项，交接没有排定的下一步。本轮查了 7 个区域（外层台阶、双源残差、坑 37、LONG-TERM A–E、pending 账本、轴 / 覆盖率重复、⟳ 到期），都不满足「更通用 / 更简单」的判据，不改代码。扫描表放在 `docs/mcp-r6-refactor-list.md` §8，以后无排定项的轮次都往那里追加。

### 24.62 第 238 轮：CC-214 元素 / 属性中文名映射单一来源 + Boss 效果描述去重（361abc6f）

**问题**：「元素 / 属性 code → 中文名」映射在 src 里各写了一份，共 12 处，分属 3 个语义域，同一域内的副本已经分叉：
- 伤害元素（伤害行 / 异常进度的 `element`，含变种）：resourceCalc/helpers 有全集（含 `physical_polar_assault`、`ether_ink`、`frostfire`）。ResultPage、ResourceUtilizationPage、ResourceResultCard、impactVariables 的副本缺变种，BossCard / BossSelectCard 各有一份 6 元素的 `EL_ZH`。**可见后果**：仪玄的所有执行 element 都是 `ether_ink`，ResultPage 第 305 行、ResourceResultCard 的积蓄进度直接显示原始 id。
- 角色属性（catalog `agent.attribute`）：`utils/agentLabelMaps#ATTRIBUTE_LABEL` 有全集。ResourcePage、CharacterCard 的副本缺 `lumiflux` / `frostfire`。**可见后果**：蕾米埃尔（1581，attribute = lumiflux）的角色卡与资源页显示原始 id「lumiflux」。
- 另有两种有意的其他用途：`utils/enemyDebuffStats#ELEMENT_LABEL`（「火属性」后缀，用来拼减抗标签）与 StatPanel 乘区说明（同样的后缀风格）；StunAxisPage 进窗异常下拉是有意的子集。

**改动**
- `utils/agentLabelMaps.ts` 新增 `DAMAGE_ELEMENT_LABEL` / `damageElementLabel`（从 helpers 搬过来，内容不变）。`resourceCalc/helpers#elementLabel` 改为转出它，名字保留，现有 8 个消费者不改。
- ResultPage、ResourceUtilizationPage、ResourceResultCard、impactVariables 删掉本地表，改为导入。
- ResourcePage、CharacterCard 删掉本地 ATTRIBUTE_LABEL，改为导入 `agentLabelMaps`。
- BossCard / BossSelectCard 里逐字相同的 30 行（`effectLabel` + `STAT_LABELS` + `statLabelOf` + `EL_ZH`）抽成 `utils/bossEffectLabel.ts#bossBuffEffectLabel`，元素名走 `damageElementLabel`。
- 源码锁 `src/utils/__tests__/elementLabelSingleSource.test.ts`：只允许白名单文件定义 `physical: '物理'` 映射（agentLabelMaps、enemyDebuffStats、StunAxisPage、StatPanel，理由写在测试头）；另外断言变种元素都有中文名。
- **锁的价值当场得到验证**：最初按 grep `physical: '物理'` 只找到 8 处，锁测试又抓出 BossCard、BossSelectCard、CharacterCard、StatPanel 共 4 处（紧凑写法与跨行写法都漏了）。

**口径未动**：lumiflux 在伤害元素域叫「辉光」，在角色属性域叫「流明」，enemyDebuffStats 里是「辉光/耀变」。catalog 原文两种都有（音擎原文「装备者为流明属性」；耀变相关原文「无视/降低目标50%辉光抗性」）。统一叫法属于文案口径，CC-214 不改，各域沿用原值。若日后统一，改 `agentLabelMaps.ts` 的两张表和 enemyDebuffStats 即可。

**影响**：零计算影响（只改展示文字；引擎读的 `elementLabel` 输出不变，因为用的是同一张表）。可见变化只有三类：变种元素、lumiflux、frostfire 从原始 id 变成中文名。
**回退点**：revert 本提交。

### 24.63 第 239 轮：CC-215 职业中文名映射单一来源（7eb7c11a）

**问题**：「职业 code → 中文名」除了 `utils/agentLabelMaps#SPECIALTY_LABEL`，还有 7 处副本。其中 5 份文案与单一来源一致（ResourcePage、CharacterCard、MultiplierCoeffPage、teamCompareSweep、WEngineFieldPage#specialtyLabel），另外 2 份已经分叉，用户看得见：
- `WEngineFieldPage` 的职业筛选项手写 7 项（「全部」加 6 个职业），**缺锋御**。catalog 里有 3 把锋御音擎，只能在「全部职业」下看到。
- `ResourceResultCard#SPECIALTY_MAP` 只列 5 个职业，**缺命破和锋御**，查不到时回落 `{ label: '' }`。catalog 里 5 个命破、1 个锋御角色的资源结果卡职业标签为空。

**改动**
- 5 份一致副本删掉，改为导入 `SPECIALTY_LABEL`。
- 音擎页的筛选项改由 `SPECIALTY_LABEL` 生成，顺序与原来一致，末尾多出「锋御」。
- ResourceResultCard 拆成两部分：文案走 `SPECIALTY_LABEL`；颜色留在本卡 `SPECIALTY_TAG_TYPE`，未列出的职业用 `default`。**拍板**：命破 / 锋御的颜色先用 default，这是展示选择，不是口径；回退或改色只需改这张小表。
- 源码锁 `elementLabelSingleSource.test.ts` 新增职业用例：全 src 只允许 agentLabelMaps 出现 `attack: '强攻'` / `label: '强攻'` / `attack: { label: '强攻'`，并断言表里是全部 7 个职业。
- 这次先全 src grep `'强攻'`，再写锁：多找到的两处（筛选项、组合映射）正是分叉的那两份。

**影响**：零计算影响。可见变化：音擎页多一个「锋御」筛选按钮；命破 / 锋御角色的资源结果卡显示职业标签。
**回退点**：revert 本提交。

### 24.64 第 240 轮：CC-216 有效战斗时间单一来源（95901f50）

**来源**：交接下一步「stores 与 composables 之间重复的派生计算」。扫 `stores/config.ts` 的 computed / getter 时发现 `effectiveTime` 写的是 `max(0, 180 − invincibleTime)`：**写死了 180，不读 `enemy.battleTime`**。而 `battleTime` 由 Boss 预设写入（`applyBossPreset` 取 `defaults.battleTime`），引擎经 `core/effectiveTime#effectiveBattleTime` 读它。

**现状**：23 个 Boss 预设的 battleTime 都是 180，所以这是潜在分叉，还没有表现出来。一旦出现非 180 的预设，属性配置页与结果页顶栏的「有效时间」就会和引擎的时间预算不一致。

**同一个量的副本（改前 7 份）**：stores/config `effectiveTime`（写死 180）、useResourceCalc 两处（失衡有效时长、失衡覆盖率分母）、teamTimeSummary `budget`、yixuan C1 雷击基准、yuzuha 两处。后面 6 份公式正确，只是内联抄写。**yuzuha 两处是源码锁抓出来的**，最初 grep `invincibleTime` 时漏看了。

**改动**
- 7 份副本全部改调 `effectiveBattleTime`。store 调 core 纯函数符合 C2 裁决（状态层允许调用 core 纯函数）；mechanics 调 `@/core/effectiveTime` 已有 7 个先例。
- 属性配置页说明文字「有效时间 (秒) = 180 - 无敌时间」改为「= 战斗时间 − 无敌时间」。
- 源码锁 `src/core/__tests__/effectiveTimeSingleSource.test.ts`：除 core/effectiveTime.ts 外，不允许出现 `battleTime ?? 180) - …` 或 `180 - …invincibleTime`。反例已验证：stash 掉改动后，锁报出旧代码里的全部副本文件。

**不动的**
- core 内部按参数 `ctx.totalTime - invincibleTime` 计算的几处（foldLoop ×2、underfillProbe、anomalyPool）：不读 store、没写死 180；其中 foldLoop 不夹 0 下限，换成 effectiveBattleTime 会改变病态输入（无敌 > 战斗时间）下的行为。不在本卡范围。
- RunArchivePage 与 TeamComparePage 各有一份 `战斗时长 × 100 / hpRatio` 的击杀时间（算的是另一个量）：两份公式相同，属于展示层小重复，不改。
- ResultPage 顶栏把有效时间标成「总时间」：只是文字，不改。

**影响**：现有数据下零数值差（battleTime 全是 180），golden 未变。
**回退点**：revert 本提交。

### 24.65 第 241 轮：stores/catalog、logicEditor 扫描无重复；CC-217 失衡窗口占比单一来源（3ba7af41）

**扫描（交接下一步 1）**
- `stores/catalog.ts` 的 14 个 computed 都是索引 Map、显示列表、加载状态。全 src 没有绕过 store 按 id 查 `wEngines` / `driveDiscSets` 的地方（绕过的话 legacyIds 兼容会失效）。MultiplierCoeffPage、TimeChartsPage 把完整列表交给纯函数推导，不是查表。**无重复**。
- `stores/logicEditor.ts` 的 6 个 computed 都是撤销 / 重做与草稿状态，不涉及计算。**无重复**。

**CC-217（顺着 CC-216 的有效时长找到的同族问题）**
- `core/effectiveTime.ts` 的 `@fact engine:stun/时间守恒` 写明：失衡窗口占比「同时是易伤覆盖率与攒条无效时间的占比——同一段时间只能算一次」。可「次数 × 单窗 ÷ 有效时长（上限 1）」在代码里有 5 份：core `stunWindowFraction`（攒条折算用）、useResourceCalc `computeStunCoverage`（易伤覆盖率，多扣决算截断秒）、solveTeam 外层净失衡缩放、core/stunAxis 轴模式覆盖率、difficultyRatio 回退近似（注释自称「本地等价实现，避免引 core 依赖」）。
- 改动：`stunWindowFraction` 加可选参数 `lostSeconds`（缺省 0，原调用逐位不变），其余 4 份改调它。stunAxis 与 difficultyRatio 顺带把自算的有效时长换成 `effectiveBattleTime`；difficultyRatio 那处写成 `enemy.battleTime ?? rr.totalTime ?? 180`，躲过了 CC-216 的锁。
- 等价性逐条核对：
  - computeStunCoverage：次数 ≤ 0 / 有效时长 ≤ 0 时原先提前返回 0，新实现也是 0；单窗 ≤ 0 时原先 max(0, 非正 − lost) = 0，新实现直接返回 0。**严格等价**。
  - stunAxis：只在次数或单窗为负时不同（原先会返回负数），这两个量不会为负。
  - solveTeam：外层已保证单窗 > 0、有效时长 > 0，次数是规划失衡（≥ 0）。等价。
  - difficultyRatio：原本就是 stunWindowFraction 的逐字复制。
- difficultyRatio 头注释要求本模块是「无依赖叶子」：`core/effectiveTime.ts` 只依赖 `@/types/resource`，引入后仍然是叶子。
- 源码锁：`src/core/__tests__/effectiveTimeSingleSource.test.ts` 新增 CC-217 用例（`stunCount * …window/Dur… /` 与 `Math.min(1, stunSeconds /`）。**反例验证**：只撤源码、保留新测试时，锁报出全部 4 份旧副本。（第一次反例做错了：`git stash` 把测试文件也撤了，跑的是旧测试。要用 `git stash push -- <源码文件>`。）

**影响**：零数值差（verify 的 golden 在「catalog 未改 ⇒ 纯伤害回归判据」下通过）。**回退点**：revert 本提交。

### 24.66 第 242 轮：CC-218 失衡窗口时长 / 扣无敌秒单一来源；effectiveTime.ts 收口（90f51ade）

**副本**
- `useResourceCalc#computeWindowDuration` 手写 `(stunTime ?? 12) + 4 + 全队延时加成`，而 ultimatePromote 的攒条折算走 core `stunWindowDuration`。两处是同一个窗口时长：一处用于覆盖率 / 轴编辑器，一处用于攒条折算。
- `yuzuha.ts:154`（影画 2 强制连携）手写 `max(0, combatTime − invincibleTime)`，即 core `minusInvincibleTime`。

**等价性**：core 版比手写版多两层夹紧（延时加成夹到 ≥ 0，结果夹到 ≥ 0）。`stunDurationBonusSeconds` 只有三处写入（面板初始化 0、buff `+= value`、莱特溃败加成），数据来源都是正值，所以严格等价。yuzuha 那处逐字等价。

**改动**：两处改调 core；锁测试（`effectiveTimeSingleSource.test.ts`）新增 `?? 12) + 4` 与 `Math.max(0, x - (….invincibleTime ?? 0))` 两条特征。注释里写的是 `stunTime + 4 +`，不会误报；foldLoop 那处没有 `Math.max`，它按 §24.64 登记为不动。**反例**：`git stash push -- 两个源码文件` 后，两条新用例分别报出 useResourceCalc 与 yuzuha。

**收口**：`core/effectiveTime.ts` 的 5 个函数（effectiveBattleTime、stunWindowDuration、stunWindowFraction、effectiveBackstageTime、minusInvincibleTime）在 core 以外都不再有手写副本，4 类特征都有锁。

**顺带核对（没有副本）**：暴击期望 `1 + 暴击率 × 暴伤` 全仓只在 `core/damage.ts:129` 出现一次。core 的 `@fact` 锚点大多是行为口径（判稳、截断、热启动），没有可 grep 的算式；沿 @fact 找副本这条路到此收益递减。

**影响**：零数值差（golden 严格判据通过）。**回退点**：revert 本提交。

### 24.67 第 243 轮：CC-219 防御 / 抗性乘区单一来源（257e042c）

**副本（3 份）**
- `core/damage.ts`（直伤）：本地 `LEVEL_COEFF_60 = 794`、`calcDefenseMultiplier`（返回 {multiplier, effectiveDef}）、`calcResistanceMultiplier(base, red, ignore)`。
- `core/anomalyPool/helpers.ts`（异常 / 紊乱 / 乱流）：导出的 `LEVEL_COEFF_60`、`LEVEL_MULT_60 = 2`、`calcDefenseMultiplier`（返回 number，表达式与 damage.ts 逐字相同）、`calcResistanceMultiplier(base, red)`。
- `mechanics/agents/remielle.ts`（耀变 calcVoidflareDamage）：手写 `794 / (794 + effectiveDef)`、`levelMult = 2`、`1 - (baseRes - red) / 100`。

**改动**：新增叶子模块 `src/core/damageMultipliers.ts`（`LEVEL_COEFF_60`、`LEVEL_MULT_60`、`defenseMultiplierDetail`、`resistanceMultiplierDetail(base, red, ignore = 0)`），三处都改为调用它。helpers 保留 `calcDefenseMultiplier` / `calcResistanceMultiplier` 的导出名与签名（内部转调 `.multiplier`），常量也原名转出，调用方不用改。源码锁在 `src/core/__tests__/damageMultipliersSingleSource.test.ts`，两条特征：`794 / (794` 或 `LEVEL_COEFF_60 /(`、`= 1 - effectiveRes / 100` 或 `= 1 - (xRes - y) / 100`。锁跳过注释行，另附一条逐位数值断言。

**等价性**：防御表达式逐字相同，包括 remielle 的 `penFlat + 固定减防` 加法顺序；抗性区 `x - 0 === x`。**反例**：`git stash push -- 三个源码文件` 后，两条锁都报出 damage / helpers / remielle。

**不归一（裁决）**：异常积蓄抗性区（`anomalyPool/helpers.ts` 的 `afterEff * (1 - effectiveRes / 100)`）和失衡抗性区（`core/stunPool.ts:139`）式子同形，但属于另一套游戏机制（积蓄 / 失衡值，不是伤害）。合并只会把互不相关的口径耦合在一起，所以不做，锁正则也刻意不覆盖这两处。

**影响**：零数值差（verify golden 严格判据通过）。**回退点**：revert 本提交。

### 24.68 第 244 轮：CC-220 耀变失衡易伤区改调 calcStunMultiplier（修覆盖率被当布尔；dc096e98）

**起点**：按第 243 轮交接查增伤区 / 精通区。`1 + x/100` 是百分比转乘数的通用写法，直伤、异常、耀变的增伤组成各不相同（直伤含招式类型增伤，异常只含通用和元素增伤），抽函数只会降计数，不带来架构收益，所以**不做**。精通区 `精通/100` 同理。沿耀变 `calcVoidflareDamage` 逐项与 `calcAnomalyDamage` 对照，发现其失衡易伤区是手写的：

- 旧：`stunned ? max(0, vuln + min(bonus+always, cap)/100) : 1`。
- 调用点（remielle.ts extraAnomalyRows 两处）传 `stunned: stunCoverage`，是 0-1 的全局失衡覆盖率 ⇒ **覆盖率 > 0 就吃满额失衡易伤**。接口自己的字段注释写的是「是否失衡或失衡易伤覆盖率（0-1）」，全仓其他伤害行也都按 `calcStunMultiplier` 加权。另外，非失衡时它漏掉了 Always 通道（扳机类）。
- 查过裁决：MECHANICS 蕾米节、卡表、测试都没有「耀变按全程失衡」的口径，属于未登记的分叉。

**改动**：耀变改为调用 `calcStunMultiplier(vuln, bonus, always, cap, stunned)`，面板仍取蕾米面板，与旧版一致。`stunned === true` 时与旧式逐位相等。锁测试 `damageMultipliersSingleSource.test.ts` 新增「失衡易伤区单一来源」describe：除 `core/anomalyPool/helpers.ts` 外，不许出现 `Math.max(0, xStun + y/100)` 或 `stunned ? Math.max`。叶瞬光帷幕 `veilStunBase` 是 min(…, 2.1/3.0) 的另一套封顶机制，不在锁内。remielle.test 的特殊虚耀参照值改传 `calc.stunCoverage.value`，另新增一条覆盖率加权回归（0.3 覆盖 = 1 + 0.7×0.3，旧实现会等于满额）。

**数值影响（golden 逐条解释后以 TIME_GOLDEN_UPDATE=1 重生成）**：6 个含蕾米的预设伤害下降，时间账零变化。
| 预设 | 旧 | 新 | Δ |
|---|---|---|---|
| auto-1091-1221-1581 | 92133945 | 80192618 | −12.961% |
| auto-1541-1331-1581 | 192067706 | 170515219 | −11.221% |
| auto-1181-1561-1581 | 104658004 | 88248787 | −15.679% |
| auto-1261-1561-1581 | 148867252 | 128212281 | −13.875% |
| auto-1261-1331-1581 | 184460111 | 161348655 | −12.529% |
| auto-1581-1501-1561 | 193580797 | 167196106 | −13.630% |

解释：虚耀行在蕾米队总伤中占比高，旧口径下失衡区恒为满额（约 ×1.5 起），新口径按覆盖率加权。其余预设零差。

**决定与依据**：这不属于 R5「不顺手改数值」的范围（那条针对 catalog 数据对账）。这里是引擎内部同一乘区出现两种口径，而且旧口径违背了函数自身声明的输入语义；先例有 CC-175 和 CC-212（修复后写明数值影响）。**回退点**：revert 代码提交即可（golden 基线在同一提交里）。**若日后有实测证明耀变只在失衡窗口内触发**（例如虚耀集中于失衡期），正确做法是给虚耀行传行级覆盖率（像轴模式直伤那样），而不是恢复布尔用法。

### 24.69 第 245 轮：CC-221 失衡乘区分解展示按乘数判定（零数值影响；253257e4）

**起点（第 244 轮交接第 1 步）**：`grep -rnE 'function calc\w*Damage' src/mechanics` 只命中耀变 `calcVoidflareDamage`（CC-219/220 已收）。改按伤害字段（易伤、暴击、异常增伤、抗性降低、穿透）搜 mechanics 与 composables/resourceCalc：命中的都是往面板或 exec 写 buff，或是把行参数透传给 core，**没有另一份手写伤害公式**。`yidhari.ts#loopMove` 的 `damage × (1 + dmgBonusPct/100)` 是循环规划时对倍率的缩放，不是结算公式，不动。

**CC-220 同类残留（`stunned` 被当真假值判断）**：全仓 `stunned ?` / `if (stunned)` 只剩 core/damage.ts 两处展示：
- 直伤分解 `formula: input.stunned ? fmt(stunMult) : '1 (未失衡)'`；
- 异常分解 `if (stunned) breakdown.push(失衡乘区)`。

未失衡时 `calcStunMultiplier` 仍返回 Always 通道 `1 + always/100`（扳机 35% / 55%），所以直伤文案与实际乘数不符，异常分解在这一格累积值会无说明地跳变。计算本身一直是对的。

**改动**：直伤文案改为 `!stunned && stunMult === 1 ? '1 (未失衡)' : fmt(stunMult)`；异常的出行条件改为 `stunned || stunMult !== 1`，原来会出的行照样出，标签顺序测试不受影响。`core/__tests__/damage.test.ts` 新增 describe「失衡乘区分解展示与乘数一致（CC-221）」3 例。**反例**：`git stash push -- src/core/damage.ts` 后 2 例变红（第 3 例守护旧文案，两边都应通过）。

**影响**：只影响分解展示，零数值差（golden 通过）。**回退点**：revert 本提交。

**结论**：角色模块自带伤害公式的排查到此结束，没有剩余。`boolean | number` 参数（9 处全是 `stunned`）都只经 `calcStunMultiplier` 消费。**新发现（留给 CC-222）**：暴击期望算式在 damage.ts 与 anomalyPool/helpers#calcAnomalyCritExpect 各有一份，§24.66 的「只有 1 处」系漏搜。

### 24.70 第 246 轮：CC-222 暴击率钳制 / 期望暴击单一来源 `src/data/critMultiplier.ts`（f4e45890）

**副本（按算式形状搜，比第 245 轮预查多出 4 份）**
- 期望暴击 `1 + clamp(率)/100 × 暴伤/100`：
  - `core/damage.ts#calcCritMultiplier` 的 expect 分支（直伤）；
  - `core/damage.ts#calcAnomalyDamage` 的 anomalyCritOverride expect 分支（异放等）；
  - `core/anomalyPool/helpers.ts#calcAnomalyCritExpect`；
  - `components/StatPanel.vue` critMultiplier；
  - `components/FinalPanel.vue` 直伤与异常两份：只钳上限（负暴击率不按 0），运算顺序为 `(率/100 × 暴伤)/100`，与引擎不同。
- 暴击率钳制 `min(100, max(0, 率))`：`mechanics/agents/jane.ts` 两处（6 命强击暴击次数 = 物理强击次数 × 强击暴击率，钳后作为概率）。

**改动**：新增 `src/data/critMultiplier.ts`，导出 `clampCritRatePct` 与 `expectedCritMultiplier`（后者调用前者）。放在 data 层与 `sharpCritMultiplier.ts` 同理：展示层禁止 import core。以上 8 处都改为调用它。锁测试 `damageMultipliersSingleSource.test.ts` 新增 describe「暴击期望单一来源」：除 `data/critMultiplier.ts` 外，不许出现 `Math.min(100, [Math.max(0,] xCrit…` 或 `xCritRate / 100 [)] *`。「必暴」分支的 `1 + 暴伤/100` 只是百分比换算，不在锁内。另附逐位数值断言。**反例**：`git stash push -- 5 个源码文件` 后锁报出全部 5 个文件。

**等价性**：引擎侧 3 处与新函数的浮点运算顺序完全相同（`clamp/100` 后乘 `暴伤/100`），golden 零差。FinalPanel 只影响展示：暴击率 < 0 时改按 0，另有末位浮点差异，经 fmt 四舍五入后不可见。锋御锐暴仍走 `sharpCritMultiplier`。

**更正**：§24.66 的「暴击期望只在 damage.ts 一处」是按变量名搜导致的漏搜。**教训**：查副本要按**算式形状**搜（钳制、百分比乘积），不要按变量名搜。

**影响**：零数值差。**回退点**：revert 本提交。

### 24.71 第 247 轮：CC-223 展示层乘区与引擎对账（元素积蓄效率单一来源 + 风异常增伤单列；7eb4eace）

**对账范围**：`components/FinalPanel.vue` 的「乘区数值汇总」（约 296-320 行）与 `components/StatPanel.vue` 的各乘区 computed，逐项对照 `core/damage.ts` / `core/anomalyPool/helpers.ts` 实际读取的字段。

**修（展示与引擎算的不是同一个量）**
1. **StatPanel「异常积蓄乘区」只认 electric**：旧写法 `damageElement === 'electric' ? electricAnomalyBuildUpEfficiency : 0`。引擎 `calcPerHitBuildUp` 经 `getElementAnomalyBuildUpEfficiency` 读 electric / physical / ether 三种，并先把变种元素归到基础元素。而物理与以太字段都有真实写入方：简 `jane.ts` +15～60，派派 `piper.ts` 最多 +120，爱丽丝 `alice.ts`，薇薇安 `vivian.ts` C2 +25。⇒ 这些角色的积蓄乘数显示偏低。
   **改**：新增 `src/data/anomalyElement.ts`，内含 `VARIANT_ELEMENT_TO_BASE`、`getBaseElement`、`elementAnomalyBuildUpEfficiency`，由 helpers.ts 原样迁来。helpers 以原名转出前两个，core 里既有的 import 零改动；本地函数删除，改为调用 data 版。StatPanel 也改为调用它。
2. **FinalPanel 异常链把 `windAnomalyDmgBonus` 无条件并入异常增伤**：引擎在 damage.ts:586 / helpers.ts:899 **按异常元素**判定 `element === 'wind'`。薇琳娜会把这项写进队友面板，非风属性角色也可能打出风属性异常（风染），所以不能改成按角色元素判定。**改**：从通用异常增伤里拿出来，单列为「风属性异常另 +X%」。

**不修（有依据）**
- 失衡易伤合计未按 `stunDmgMultiplierBonusCapAlways` 封顶：这个字段在 catalog 里 0 处、specs 里 0 处，只有 buff.ts 能接收，全仓没有数据写入，展示与引擎不会出现可见差异。等以后有写入方再补，届时要把 `calcStunMultiplier` 的纯部分下沉到 data。
- FinalPanel 直伤增伤区只列「通用 + 元素 + 全招式」：标题写明了范围，定向增伤另起行列出，属于有意为之的口径。
- FinalPanel `resTotal` 已含元素抗性降低，已核实。
- StatPanel 失衡积蓄乘数 `impact/100 × (1 + stunBuildUpBonus/100)` 是面板侧部分，受失衡提升、失衡抗性在 Boss 侧，文案里已说明。

**锁**：新增 `src/data/__tests__/anomalyElement.test.ts`，是结构锁：从 `emptyPanel()` 枚举所有 `<元素>AnomalyBuildUpEfficiency` 字段，逐个断言 `elementAnomalyBuildUpEfficiency` 都能读到。以后新增元素字段却忘改函数时，引擎和展示会一起漏读，这条测试会变红。另附变种归并断言，以及「helpers 转出的是同一对象」断言。

**影响**：引擎零数值差（函数逐字迁移，golden 通过）；只有展示变化。**回退点**：revert 本提交。

**结论**：展示层乘区对账到此收尾，伤害公式与展示两条线都已结项。

### 24.72 第 248 轮：CC-224 元素 → 面板字段名单一来源 `src/utils/elementStatKeys.ts`（f1db965e）

**副本（10 份）**
- `core/elementKeys.ts` 三张表（伤害 / 减防 / 减抗），经 `composables/resourceCalc/skillRows.ts` 和 `resourceCalc/helpers.ts` 两层壳转出。表里**缺 ether_ink 和 frostfire**。
- `core/damage.ts#getElementDmgBonus` 局部表；`core/anomalyPool/helpers.ts#getElementDmgKey` switch。这两处已经先经 `resolveStatElement` 解析元素。
- `components/FinalPanel.vue` 4 张：伤害、减抗、贯穿、锐化。
- `components/StatPanel.vue` 2 张：伤害、贯穿。
- `views/ResourceUtilizationPage.vue` 1 张：减抗。
- `views/DebugPage.vue` 1 张：伤害；另有一处 `${element}SheerDmg` 直接拼接，没有先解析元素。

**口径依据**：`resolveStatElement` 的注释写明（用户口径 2026-09-05），烈霜在一切「元素 → 数值」查找里都按冰读，变种元素读基础元素。core 的两处遵守了这条，而 `core/elementKeys.ts` 与展示层副本没有。

**实际缺陷**：`composables/resourceCalc/anomalyPanels.ts#buildAnomalyVirtualPanel` 用 `ELEMENT_DMG_KEYS[prog.element]`。遇到仪玄玄墨 `ether_ink` 或雅烈霜 `frostfire` 时键为 undefined，于是虚拟面板的增伤漏掉元素增伤，元素减抗也读成 0。影响面已查：标准异常伤害池 `damagePoolAnomaly.ts` 的 `anomalyDamageSpecs` 只含 6 个基础元素，这两个元素不走该路径；`buildVirtualPanel` 能力只有柏妮思在用（火）。⇒ 实际只影响 `useResourceCalc.ts:644` 的异常虚拟面板**展示**。
**潜在缺陷**：FinalPanel `?? 'dmgBonus'` / `?? 'enemyResReduction'` 的回落，一旦元素查不到，就会把通用增伤、全属性减抗算两遍（`dmgTotal`、`resTotal`，以及 dmgRows、debuffRows 里重复的行）。

**改动**
- `resolveStatElement` 自 helpers 逐字迁入 `src/data/anomalyElement.ts`（helpers 原名转出）。
- 新增 `src/utils/elementStatKeys.ts`：`elementStatKey(kind, element)`，kind 为 dmg / critDmg / sheerDmg / sharpDmg / enemyRes / enemyDef；另有 `panelElementStat(panel, kind, element)`。两者都先经 `resolveStatElement`，减抗、减防的键复用 `utils/enemyDebuffStats#enemyDebuffElementStatId`。查不到时返回 undefined 或 0，**不回落通用字段**。
- 放在 utils，是因为 core（damage.ts 已在 import utils/enemyDebuffStats）、mechanics 和展示层都能 import utils。
- 10 份副本都改为调用它。`core/elementKeys.ts` 以及两层壳里的转出已删除，壳测试 `skillRowsShell.test.ts` 的符号表同步删掉这 3 项。
- `getElementDmgKey` 保留导出与未知元素的旧回落 `${statElement}Dmg`：面板上没有这个字段，读到的仍是 0，逐位等价。
- DebugPage 保留 `?? 'dmgBonus'` 回落（调试页，不改其语义）。

**锁**：`src/utils/__tests__/elementStatKeys.test.ts` 含三部分：①7 个基础元素 × 5 类键逐字断言，且字段在 `emptyPanel()` 里真实存在；②变种、烈霜、未知元素；③源码锁，除本来源外不许出现 `physical: 'physicalDmg' | 'enemyPhysicalResReduction' …` 形式的对照表，或 `case 'physical': return 'physicalDmg'`。**反例**：`git stash push -- DebugPage.vue FinalPanel.vue` 后，锁报出这两个文件。

**影响**：verify 全绿（3932 passed），golden 零差（catalog 未改，R23-N2 纯伤害回归判据启用），引擎数值零变化；只修展示层。**回退点**：revert 本提交（`core/elementKeys.ts` 会随之恢复）。

### 24.73 第 249 轮：CC-225 元素字段名手拼并入 `utils/elementStatKeys`，元素线收尾（f361972f）

**排查**（按 §24.72 交接）：用 grep 搜 `${…}(Dmg|CritDmg|SheerDmg|SharpDmg|AnomalyBuildUpEfficiency|ResReduction|DefReduction)` 这类手工拼接，共 9 处：
- `core/damage.ts` getElementCritDmgBonus / getElementSheerDmgBonus / getElementSharpDmgBonus：已先经 `resolveStatElement`，语义正确；
- `stores/config.ts:114` defaultDriveDisc 的 `` `${element}Dmg` || 'atkPct' ``：`||` 是死代码，模板串恒为真；调用方只传 `'physical'`，所以没有实际错误；
- `stores/config.ts:615`：选角色时自动设 5 号位主词条；
- `StatPanel.vue`：699 行的积蓄效率过滤，742、749 行的元素减防、减抗摘要。

**真 bug 数量：0。** 依据：`public/static/catalog.json` 里所有 `damageElement` 取值只有 7 个基础元素（physical 1071、fire 776、electric 677、ice 555、ether 506、wind 176、lumiflux 65），变种元素不会进入这些拼接。

**仍然做了**：CC-224 的锁只防对照表，防不住手拼，元素字段名因此仍有两种写法。统一后元素 → 字段名只有一个来源。
- damage.ts 3 处改为 `elementStatKey(kind, element)`，键为空时返回 0（旧写法拼出 `undefinedCritDmg` 再读到 0，逐位等价）。
- config.ts 2 处改为 `elementStatKey('dmg', …)`；`?? 'atkPct'` 回落从此真正生效。
- StatPanel：
  - 删除 `ELEMENT_FIELD_PREFIX_BY_ELEMENT`（`utils/enemyDebuffStats#ELEMENT_FIELD_PREFIX` 的副本，改为 import 原表）；
  - 删除 `ELEMENT_DEBUFF_LABELS`（旧写法遍历 7 元素后过滤出当前元素，等价于直接读当前元素）；
  - 两个减益摘要改用 `panelElementStat` 加 `damageElementLabel`。`DAMAGE_ELEMENT_LABEL` 的 7 个基础元素标签与旧表逐字相同，lumiflux 仍为「辉光」，不触及 §24.62 未决项。

**锁**：`elementStatKeys.test.ts` 新增第 4 例，逐行扫描、跳过注释行：
- 禁止 `${…}(Dmg|CritDmg|SheerDmg|SharpDmg)`；
- 禁止 `enemy${…}(Res|Def)Reduction`；
- 禁止出现 `physical: 'Physical'` 或 `['Physical',` 形式的前缀表。
- 白名单：elementStatKeys.ts、enemyDebuffStats.ts。
- **反例**：只 stash 三个源码文件（保留新测试），锁逐行报出全部 9 处。

**不做**
- StatPanel `isOtherElementSpecificField` 里硬编码元素名的正则：这是按字段名形状匹配，不是元素 → 数值的查找表，改成动态拼正则只会更难读。
- StatPanel:699 的 `${props.damageElement}AnomalyBuildUpEfficiency`：同属字段名过滤，积蓄效率的取值已走 `data/anomalyElement#elementAnomalyBuildUpEfficiency`。

**影响**：verify 全绿（3933 passed），golden 零差，引擎数值零变化。**回退点**：revert f361972f。

**元素相关的单一来源线至此结项。**已有来源：
- `data/anomalyElement`：变种 → 基础、resolveStatElement、积蓄效率；
- `utils/elementStatKeys`：字段名；
- `utils/enemyDebuffStats`：敌方减益字段与前缀；
- `utils/agentLabelMaps`：标签。

### 24.74 第 250 轮：CC-226 失衡易伤可见化按行取引擎实值（f9be411d）

**来源**：§24.73 交接的「展示层重算与 core 口径一致性」。
- `composables/difficultyRatio.ts` 已直调 `core/effectiveTime`，无重复实现，不动。
- `composables/stunVulnSummary.ts`、`composables/stunVulnDisplay.ts` 有问题，见下。

**问题**：伤害池 `damagePool.ts` 写入的行级 `stunMult = 1 + (stunBase − 1) × stunForThis`。其中 `stunBase` 平时是 Boss 的 `stunVuln`，叶瞬光（1431）的帷幕行取 `panel.veilStunVulnBase = min(boss + 加成, 封顶) − 加成`（`mechanics/agents/yeshuguang.ts#veilStunBase`），触顶时小于 stunVuln。展示层按 `(stunMult − 1) / (stunVuln − 1)` 反推覆盖率，这个式子在 `stunVulnSummary.rowAppliedStunMult` 和 `stunVulnDisplay.stunVulnTitleOf` 里各写了一遍。反推的基数假设错误，导致：
1. 帷幕行覆盖率被压低。例：基数 1.1、stunVuln 1.5 时，满覆盖被读成 20%。
2. 生效易伤用 stunVuln 重算，封顶语义完全丢失。

**实测**：探针为临时测试，已删除。用 `setupHarness` 加 `recommendedBuild` 跑 4 支叶瞬光队伍，各测 0 命和 6 命，共 8 种情况。
- **1431-1481-1491，0 命**（strongTeamPresets 里有这支）：加成 90%，帷幕基数 1.200，13 行受影响。
  - 全队加权生效易伤：旧 1.5101，新 1.9585；
  - 覆盖率 0.3 的示例行：旧 1.168，新 1.330。
- 其余 7 种情况（未触顶；6 命封顶为 3.0 时不触顶）新旧逐位相同。
- 叶瞬光位于槽 0，与展示约定的「面板加成取槽 0」一致，所以新值等于引擎实际乘上的值。

**改动**
- `DamagePoolRow` 新增两个可选字段：`stunCoverage`（= damagePool 的 stunForThis）和 `stunVulnBase`（= stunBase），直伤行照实写入。
- `stunVulnSummary.ts`：
  - 反推收成**唯一**一个私有回落函数 `coverageFromStunMult`，只在行没带 `stunCoverage` 时用（测试夹具、旧数据）；
  - 新增 `rowStunCoverage`、`rowAppliedStunMultOf`、`rowFullStunMultOf`，用行自己的基数和覆盖率；
  - 旧签名 `rowAppliedStunMult` 保留，现有测试不改。
- `stunVulnDisplay.ts`：appliedVulnOf、stunVulnClassOf（判断「满额」改用行自己的满覆盖值）、stunVulnTitleOf、stunVulnAppliedRows 全部改调新函数。
- 全队满额参照 `full` 仍为 `calcStunMultiplier(stunVuln, 槽 0 加成, …, true)`，不变。

**锁**：`stunVulnSummary.test.ts` 新增 3 例：
- 帷幕行触顶得 2.1，并附反例：去掉新字段后只有 20%；
- 普通行上，新旧两条路径逐位等价；
- 源码锁：全 src 中 `(…stunMult − 1) / (… − 1)` 只允许出现在 stunVulnSummary.ts 一处。**反例**：stash stunVulnDisplay.ts 后，锁报出该文件。

**影响**：verify 全绿（3936 passed），golden 零差；引擎伤害零变化，只改 ResultPage 的失衡易伤列和全队 / 逐人加权易伤展示。**回退点**：revert f9be411d。

**不做（已评估）**
- 行级生效易伤改用「本行所属槽位的面板加成」，而不是槽 0：槽 0 是 @fact 记录在案的展示约定（与逐招矩阵探针同口径）；失衡易伤加成多为全队 buff，各槽大多相同。等出现「非槽 0 成员自带失衡易伤加成」的具体队伍再评估。
- 从引擎结果里直接取失衡乘数（calcDirectDamage 只写在 breakdown 文案里）：得改 core 的返回类型，收益与本卡重叠。

### 24.75 第 251 轮：CC-227 特殊动作喧响展示直读引擎（661133cd）

**排查**（接 §24.74）：
- `composables/difficultyCurve.ts` 全部委托 `computeDifficulty`、`stunWindowRatioOf`、`interactionSurvivalBySlot`，关键计数读的是引擎结果（resourceResult、stunPool、anomalyPool、模块自报的 resourceSections），**没有自己重算，不动**。
- 顺着交互次数查到了本卡的问题。

**问题**：特殊动作喧响（弹刀 215 / 连携 10 / 闪反 10 / 快支 20，含伴随 50%）的每槽输入次数被组装了**两份**：
- **引擎**：`composables/resourceCalc/convergence.ts`（约 660-675 行）。弹刀取注入后 cfg 的 `parryCount + parryNoFollowUpCount + parryDecibelOnlyCount`（含交互缩放 `Math.round(x × scale)`、Boss 弹刀反推拆分、只给喧响弹刀、般岳补齐）；连携取 `chainCountTotalOverride ?? chainCountPerStun × countStun`。
- **展示**：`useResourceCalc.ts#specialActionBonus` 用 store 原值、topUp、parrySplit 另拼每槽弹刀，规则是 `s === 0 && parryCount <= 0` 时才采用主 C 的拆分结果；连携取结果里的 chainCountTotal。
- 另外，ResultPage 弹刀、闪反、快支的「(N次)」标签读的是第三份，即 store 配置合计。

**实测**：临时探针，已删除。5 支队伍 × 4 个 Boss 场景（默认、30033、30009、30038）共 20 种情况，**11 种不一致**：

| 队伍 / Boss | 每槽弹刀：引擎 vs 旧展示 | 喧响合计：引擎 vs 旧展示 | 原因 |
|---|---|---|---|
| 1431-1481-1491 / 默认 | 1/1/0 vs 6/6/0 | 900 vs 3050 | 旧展示没考虑交互缩放 |
| 1431-1481-1491 / 30009 | 0/0/0 vs 6/6/0 | 470 vs 3050 | 同上 |
| 1371-1471-1311 / 默认 | 3/3/0 vs 6/6/0 | 1730 vs 3020 | 同上 |
| 1291-1481-1161 / 30033 | 13/14/6 vs 6/14/6 | 7725 vs 6220 | 主 C 配了 6 次弹刀，旧规则不采用拆分结果 13 |

- 1091-1221-1581、1611-1411-1311 两队在 4 个场景下都一致。
- 连携在全部 20 种情况下都一致（这些情况里规划值等于结果值），但两处的口径定义不同，属于潜在漂移。

**改动**
- `CalcRoundResult` 新增 `specialActionBonus`；convergence 保留 `calcSpecialActionBonus` 的整份结果并随本轮返回。
- `useResourceCalc#specialActionBonus` 改为直接读 `calcOutput.value?.specialActionBonus`，删除展示侧的拼装。
- ResultPage 喧响卡的 4 个次数标签改为 `sumOf(specialActionBonus.perSlotXxx)`，与喧响值同源。参数区只读框（`totalParryCount` 等）仍显示**输入侧**配置值，注释已标明。

**锁**：新增 `src/composables/__tests__/specialActionBonusSingleSource.test.ts`：
- ①源码锁：`calcSpecialActionBonus(` 只允许在 convergence.ts 调用；
- ②雨果队配 30033：主 C 的 `perSlotParry` 等于拆分结果 13，且不等于配置值 6。
- **反例**：stash useResourceCalc.ts 后两例都失败。
- 现有 `parrySplitInt.test.ts` 的 `perSlotParry[1] = 8 / 5` 两个断言在引擎值下照常通过。

**影响**：verify 全绿（3936 passed，golden 零差）；新测试单跑 2/2 通过，parrySplitInt、calcOutputMemo 同跑共 18 例通过。引擎零变化，只改结果页「特殊动作喧响」卡的数值与次数。**回退点**：revert 661133cd。

**不做**
- 喧响卡的说明文字 `215/次 · 伴随107.5` 仍然写死在页面上：视图层禁止值导入 core（`PARRY_DECIBEL_BONUS` 在 core/anomalyPool.ts）；常量变动时锁测试不会报。如果要做，可以让 `SpecialActionBonusResult` 带上单价字段。收益小，暂不做。

### 24.76 第 252 轮：ultimatePromote 读 store 原值「不做」；「展示把 store 当引擎用量」线结项；CC-228 贯穿力下沉 data（2ba355d0）

**① `composables/resourceCalc/ultimatePromote.ts:286`（§24.75 交接第 1 项）：不做。** 它读 `configStore.team.reduce(… chainCountPerStun …)`，不读 cfg。理由：
1. store 与 cfg 的差异只在 store 字段缺失（`undefined`）时出现：store 取 `?? 0`，cfg 取 `buildCharConfig` 的 `?? (isSupport ? 0 : 1)`（`composables/resourceCalc/helpers.ts:553`）。store 默认值为 `0`（`stores/config.ts:156`），而 `0 ?? 1 === 0`，所以显式为 0 时两份相同。
2. 「chainCountPerStun 必须读 store 原值」是 round 20 C-γ 的书面契约（`mechanics/types.ts` 的 `AgentInteractionSnapshot` 注释，含受控实验），莱卡恩、仪玄同属这一族。
3. 在 `calcStunPool` 中它只进入输出的 `chainCountTotal = stunCount × chainCountPerStun`，不影响失衡次数。

**② 系统扫描 `configStore.team` 读交互次数的地方**（composables、views、components，convergence 除外）：
- `timeWeightAllocation.ts`：时间权重优化器，本来就读写 store 次数，属于输入侧；
- ResultPage:873-879 和 AttributeConfigPage:94：参数区只读框；
- BossCard：读 agentId。
- **全部合理 ⇒ 「展示把 store 原值当引擎用量」这条线结项**（CC-226、CC-227 是其中的真 bug）。

**③ CC-228**：贯穿力 `atk × 0.3 + hp × 0.1 + sheerForceFlat` 共 4 份。
- 引擎有一份 `core/damage.ts#calcPenetrationPower`；
- 展示层手写 3 份：FinalPanel:168、StatPanel:576、DebugPage:346。视图层禁止值导入 core，所以只能复制。
- 与 CC-222（暴击）、CC-223（异常元素）同一种情况，做法相同：
  - 下沉到 `src/data/penetrationPower.ts`，入参用最小结构类型 `{ atk; hp; sheerForceFlat? }`；
  - `core/damage.ts` 以原名转出，琉音、般岳、诺姆模块的 import 路径不变；
  - 3 处展示副本改为调用它。
- 锁：`src/data/__tests__/penetrationPower.test.ts`，包括公式断言、core 转出与 data 为同一函数，以及源码锁（除 data 外不许出现 `atk * 0.3`）。**反例**：stash 3 个展示文件后，锁报出 FinalPanel:168、StatPanel:576、DebugPage:346。
- **影响**：verify 全绿（3940 passed，golden 零差），零数值差。**回退点**：revert 2ba355d0。

**常量粗扫（为下一轮找线索）**：在 views、components 里搜 1.2、0.5、1.5、0.35、215、1.1、2.1 等与 core 共有的常量，命中基本是注释、界面文字或绘图参数。唯一可疑的是 `views/TeamConfigPage.vue:956-964` 的「保底4喧响」提示：展示层自己算 `⌈缺口 ÷ 215⌉` 次补弹刀。
