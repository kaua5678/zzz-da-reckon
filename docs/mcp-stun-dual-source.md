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
