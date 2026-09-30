# S2 折叠环的停点（第 348 轮起）

> lane arena-C（第 348 轮创建）· lane arena-A（第 349 轮补齐 §2 重折语义四变体拆解与 §4 候选 F2 实测结项），2026-09-30。
> 代码：`src/core/resource/foldLoop.ts#runFoldLoop`。对应 stun-dual-source §24.172–173、r6 §8 第 348–349 行。

## 0. 结论

- 折叠环（S2 时间预算折叠）有两种正常出口：
  - 残差 ≤ 1e-3 秒（`TIME_FOLD_CONVERGENCE_SECONDS`）；
  - 停滞判据：连续 3 轮没有比最优残差再好 1e-2 秒。
- 414 例上没有跑满上限（`TIME_FOLD_MAX_PASSES` = 32）的运行（§1）。
- **停滞计数跨运行不归零，而且是承重行为**（§2）。`diag.bestExcess` / `diag.stagnantPasses` 只在 `undefined` 时初始化，所以 CC-160 的
  终局重折（同一个 `diag`）会接着主折叠的计数判停。
  - 本轮试过改成每次运行归零（曾拟为 CC-330）：缺省配置 414 例终局不变。
  - 但在非缺省的合轴吸收率下，auto-1431-1481-1341 的结果明显变化，并让 dynamicComboAlign ② 的留白门（1.5 秒）变红。
  - **决定不改**。在代码里加注释标明承重，防止被当成遗留写法「顺手清理」。
- **候选 F2 已实测否决**（§4，第 349 轮）：停滞出口若还原到「本次运行残差最小的那一轮」，在正反馈队伍（如 `yidhari-qingyi-lucia`、`dca:auto-1431-1491-1341@0`）会把 `cfg.timeBudgetExcess` 累加器回退到前序轮次，反而把已收敛的 0 截断队打成截断（`cut: 0 → 0.95s`、留白 `0.049 → 2.19s`）或让截断暴涨 `+4.37s`。

## 1. 出口普查（探针，414 例）

- **方法**：插桩版 foldLoop.ts 在每次运行结束时记录出口（残差达标 / 停滞 / 跑满）、pass 数、末轮残差、最优残差和逐轮残差轨迹。
  每个用例「被接受的那次运行」按（用例、pass 数、残差）与 `rr.convergence` 精确匹配，414/414 匹配上。
- **面**：与 timeGolden 相同的 414 例（104 预设 + 62 角色 × c0/c3–c6），缺省配置（physical 投影、合轴吸收率 0.4），每遍约 15 秒。

| | 全部运行 | 被接受的运行 |
|---|---|---|
| 运行数 | 2968 | 414 |
| 残差达标（≤1e-3） | 1771 | 389 |
| 停滞判据 | 1197 | 25 |
| 跑满上限 | 0 | 0 |

- 被接受的 25 次停滞出口：
  - 末轮残差减最优：≤0.01 共 17 次，≤0.1 共 1 次，≤1 共 7 次。
  - 末轮残差本身：≤0.01 共 1 次，≤0.1 共 8 次，≤1 共 6 次，>1 共 10 次（>1 的主要是结构性溢出的 1431 簇）。
- 末轮残差比最优高 0.01 以上的被接受运行，见下表。轨迹第一项是 pass 0，即注入 refund 之前的测量，不参与停滞判定。

| 用例 | pass | 残差轨迹 | 末轮 | 最优 | 终局留白 / 截断 |
|---|---|---|---|---|---|
| yidhari-qingyi-lucia | 5 | 11.67, 2.2545, 2.6163, 2.61, 2.61 | 2.610 | 2.255 | 3.734 / 0 |
| auto-1431-1481-1491 | 5 | 14.138, 14.307, 14.3605, 14.379, 14.3858 | 14.386 | 14.307 | 1.611 / 19.8 |
| auto-1431-1481-1341 | 2 | 14.0575, 14.0581 | 14.058 | 13.845（主折叠留下的，见 §2） | 2.886 / 20.583 |
| agent:1051:c0 | 5 | 14.8546, 0.6847, 0.9351, 0.877, 0.8775 | 0.877 | 0.685 | 1.534 / 1.55 |
| agent:1591:c3、c4、c5 | 6 | 0.704, 0.514, 0.074, 0.074, 0.704, 0.514 | 0.514 | 0.074 | 0.514 / 0 |
| agent:1591:c6 | 6 | 1.2295, 1.8355, 0.6235, 1.8355, 0.7225, 0.74 | 0.740 | 0.6235 | 1.23 / 0 |

## 2. 停滞计数跨运行不归零（承重，不改）

- **机理**：`diag.bestExcess` / `diag.stagnantPasses` 只在 `undefined` 时初始化，这是 CC-4 外提时逐字保留的闭包时代写法。同一个 `diag` 上的
  第二次运行，也就是 CC-160 的终局重折（`resource.ts#runPreTailFinalize`），会接着主折叠的最优残差与计数：主折叠已经停滞 3 轮时，重折的
  第一个判定轮只要没比主折叠的最优好 1e-2，就直接判停。重折的 refund 冻结旗标却每次归零（pass 0 重新测量、重新注入 refund）。
  截断重折环每次换新 `diag`，不受影响。
- **覆盖面**：2968 次运行中有 404 次带着上一次的计数开跑，全部落在 12 个 1431（叶瞬光，声明 `refoldAfter`）用例里；被接受的运行里有 12 次。
- **试验：改成每次运行归零**（refund 冻结旗标、最优残差、无改善计数都改为 `runFoldLoop` 局部变量，`SolveDiagnostics` 删掉三个字段）：
  - 缺省配置 414 例：出口分布不变（1771 / 1197，被接受 389 / 25），总 pass 数 11016 → 11160（+1.3%）。终局只有 auto-1431-1481-1341 被接受
    那次重折 pass 2 → 5、残差 +2e-4 秒；伤害、次数、失衡、留白、超预算、截断逐位不变，`rr.characters` 只有亚毫秒级时间量变化。
  - 全量 verify **红 1 条**：`dynamicComboAlign.test.ts` ②（合轴吸收率 = 1），auto-1431-1481-1341 留白 1.882 > 1.5。
  - 5 支时间压力队 × 吸收率（缺省 0.4 / 1 / 0）逐一对照，只有 auto-1431-1481-1341 变：

| 吸收率 | 旧（计数续跑） | 新（每次归零） |
|---|---|---|
| 0.4（缺省） | 伤害 116,116,175；留白 2.886；截断 20.583；重折 pass 2，残差 14.0581 | 同左，只有重折 pass 5、残差 14.0583 |
| 1 | 伤害 155,476,546；留白 1.01；截断 0；重折 pass 2，残差 4.0403 | 伤害 155,294,980（−0.12%）；**留白 1.882**；截断 0；pass 5，残差 0 |
| 0 | 伤害 94,144,137；留白 1.617；截断 82.666；降配档 0.75；残差 51.51 | 伤害 97,013,370（+3.05%）；留白 1.772；**截断 63.856**；降配档 0.5；残差 40.03 |

- **判读**：重折跑到自己的收敛后，账本更自洽（吸收率 1 时残差 4.04 → 0；吸收率 0 时截断少 18.8 秒），但吸收率 1 时留白从 1.01 涨到 1.88。
  按用户口径「留白太多 = 引擎没把资源回复消耗算完备」，这不能算纯改进；dynamicComboAlign ② 的门是拦机制失效的，不应为这次改动放宽。
- **决定**：不改。计数续跑等于把 CC-160 重折当成主折叠的「续跑」（没比主折叠更好就停），虽然不是有意设计，但结果依赖它。
  已在 `foldLoop.ts`（初始化处）和 `solveDiagnostics.ts`（两个字段）加注释标明承重（`5363d20a`，只改注释）。
- **第 349 轮四变体拆解实测（结项：维持 `base` 现状）**：
  为回答「CC-160 终局重折改成纯续跑或纯重跑是否自洽」，第 349 轮在 429 例（414 例 + 5 支时间压力队 × 吸收率 0.4/1/0，产物 `/home/kaua/calc-arch/arenaA/fold-cand-sub.json`）上对照了四个正交变体：
  1. `cont`（纯续跑：重折不重置 `refundFrozen`，也不重置 `bestExcess / stagnantPasses`）与 `cont_reset_stag`（重折不重置 `refundFrozen`，仅重置停滞计数）：两者在 429 例上**逐位相同**，均改变 **14 例**并显著恶化时间账：
     - `preset:auto-1431-1491-1341`：残差 `0.0004 → 4.3996s`，留白 `-0.011 → 1.367s`，伤害 `-1.57%`；
     - `preset:auto-1431-1341-1311`：refund `1.085 → 0s`，留白 `0 → 1.085s`；
     - 5 个 1431 预设（`1431-1341-1031`、`1431-1391-1341`、`1431-1471-1341`、`1431-1511-1341`、`1431-1341-1211`）从 `passes=2, over=0` 退化为 `passes=1, over=0.037..0.218s`；
     - `dca:auto-1431-1481-1341@0`：截断 `82.666 → 92.178s`（`+9.51s`），伤害 `-6.36%`。
     - **根因**：`foldLoop.ts` 中 `if (!diag.refundFrozen) { ... continue }` 同时承担两件事：① 在 `preTail` 把叶瞬光 1431 的冥心轮数取整后，按整数态重新测量支援槽可退还秒数 `teamRefund`；② 充当 Pass 0 的必过门控，强制 CC-158 在重折入口展开的 `cfg.timeBudgetExcess` 至少跑完一轮后续 `runInnerLoop`（`passes >= 2`）。若重折保持 `refundFrozen = true`，Pass 0 既丢掉整数态 refund，又在 `maxExcess <= bestExcess` 时立刻单轮早退，导致 CC-158 展开的时间债来不及回流平 A 池。
  2. `restart_both`（纯重新迭代：重折重置 `refundFrozen = false` 与 `bestExcess / stagnantPasses`，保留前序写入的 `timeBudgetRefund`）与 `restart_zero_refund`（同上且重折入口清零 `cfg.timeBudgetRefund`）：两者在 429 例上**逐位相同**（因为 `timeBudgetRefund` 只写 `timeWeight = 0` 的支援槽，其 `basicAttackTime === 0`，Pass 0 测量的 `-excess` 与旧 `timeBudgetRefund` 无关），均只改变上表的 3 例 `auto-1431-1481-1341`（其中吸收率 1 时留白 `1.01 → 1.882 > 1.5`，红 `dynamicComboAlign ②`）。
  3. **结论**：`refundFrozen`（单次调用内「Pass 0 测量 + CC-158 展开后必跑 Pass 1」门控）与 `bestExcess / stagnantPasses`（跨主折叠与重折的停滞地板）职责正交，不能按单一「续跑 / 重跑」二元语义合并。本项**结项，维持现状**。

## 3. 本轮代码

- 只改注释（`5363d20a`）：`src/core/resource/foldLoop.ts` 停滞判据初始化处、`src/core/resource/solveDiagnostics.ts` 两个字段的说明。
- 验证：`vue-tsc -b` 0 错；get_diagnostics 0；隔离 worktree `wtA-fl` 全量 verify EXIT=0（442 个文件、4066 个测试）。

## 4. 候选 F2：停滞出口取本次运行残差最小的那一轮（第 349 轮实测否决）

- **问题**：停滞判据只数「没有比最优好 1e-2」的轮数，不管当前轮离最优多远，于是振荡中的折叠环会停在任意一相。例如 1591 c3–c5 在
  0.514 / 0.074 的振荡里停在 0.514，终局留白正好是 0.514。
- **第 349 轮探针实测**（429 例，产物 `/home/kaua/calc-arch/arenaA/fold-cand-sub.json`）：
  实现两个开关变体：`f2_min_excess`（按单轮 `maxExcess` 最小快照 `states + cfg(timeBudgetExcess, timePressureSeconds, timeBudgetRefund) + diag`，停滞出口时还原）与 `f2_min_sum`（按 `maxExcess + maxIdle` 最小快照还原）。两者在 429 例上结果**完全一致**，共改变 **13 例**：

| 用例 | 现行 `base` | F2（还原最小残差轮） | 判读 |
|---|---|---|---|
| `agent:1591:c3–c5` | `res: 0.514s, slack: 0.514s`, dmg 14.37M–17.87M | `res: 0.074s, slack: 0.074s`, dmg +0.18% | 2-周期振荡取中低残差相（正向） |
| `agent:1591:c6` | `res: 0.74s, slack: 1.23s` | `res: 0.6235s, slack: 1.23s`（终局不变） | 仅诊断残差变 |
| `agent:1051:c0` | `res: 0.8775s, slack: 1.534s, cut: 1.55s` | `res: 0.6847s, slack: 0.045s, cut: 1.883s`，dmg +3.57% | 截断增加 `+0.333s` |
| `preset:yidhari-qingyi-lucia` | `res: 2.61s, idle: 0.049s, cut: 0s` | `res: 2.2545s, idle: 2.190s, cut: 0.95s`，dmg +4.81% | **破坏性退化**：原本 0 截断的队伍出现 `0.95s` 截断，留白暴涨 |
| `preset:auto-1431-1481-1491` | `res: 14.386s, cut: 19.8s` | `res: 14.307s, cut: 20.119s` | 截断增加 `+0.319s` |
| `dca:auto-1431-1491-1341@0` | `res: 36.22s, cut: 10.507s` | `res: 36.22s, cut: 14.875s`，dmg −1.03% | **破坏性退化**：截断恶化 `+4.37s`，伤害下降 |

- **根因（为什么「最小 `maxExcess` 轮」在S2折叠环里不是最优解）**：
  `cfg.timeBudgetExcess` 是跨 pass 的**累加器**（每轮 `cfg.timeBudgetExcess += excess`），而 `maxExcess` 是**当轮增量** $\Delta\text{excess}_p = \max(0, \text{occupied}_p - \text{allocated}_p)$。
  在含正反馈（如 1051 闪能返还、1431 冥心）的队伍里，轨迹 `11.67 → 2.2545 → 2.6163 → 2.61 → 2.61` 的每一轮都在继续向 `timeBudgetExcess` 累加正的超出量（第 1 轮加 2.25s，第 2–4 轮合计再加 7.84s），逐步把超出的前台动作压回预算内。
  若按「当轮增量最小」还原到第 1 轮（`2.2545s`），就等于**丢弃了第 2–4 轮累计折叠掉的 `7.84s` 时间债**，导致终局动作总时长反而超出战斗时长，触发截断（`cut: 0 → 0.95s`、`10.51 → 14.88s`）。
- **裁决**：**否决 F2，结项不做**。

## 5. 产物（`/home/kaua/calc-arch/arenaC/`）

- 普查：`fl.json`（第一次）、`fl-base.json` / `fl-f1.json`（现行代码与开关 `FL_RESET=1` 的对照）、`fl-cc330.json`（归零试验代码，只有用例结果）。
- 单例导出：`ch-base.json` / `ch-cc330.json`（auto-1431-1481-1341 的 `rr.characters` 与 convergence），`diffjson.js` 做逐叶比较。
- 合轴吸收率对照：`dca-base.json` / `dca-cc330.json`（5 队 × 缺省 / 1 / 0），探针 `zzDca.test.ts`。
- 插桩版 `foldLoop.flprobe2.ts`（以 f87b348e 为底；设 `FL_RESET=1` 即每次运行归零）、`zzFlProbe.test.ts`、`zzChDump.test.ts`，分析脚本 `an_fl.js` / `an_fl2.js`。
- 日志：`cc330-verify.log` 是归零试验的全量 verify（红 1 条）；`c348-verify.log` 是本轮只改注释的全量 verify。
- 运行脚本 `arenaC-fl.sh`、`arenaC-fl2.sh`、`arenaC-cc330.sh`、`arenaC-chdump.sh`、`arenaC-dca.sh`、`arenaC-cc330-verify.sh`（现已改成写 `c348-verify.log`），
  都 cd 到已删除的 wtA-fl，复用时要改路径。
- 第 349 轮产物（`/home/kaua/calc-arch/arenaA/`）：`fold-cand-sub.json`（`base / cont / cont_reset_stag / restart_both / restart_zero_refund / f2_min_excess / f2_min_sum` 七模式 × 429 例完整对照）、`zzFoldCandProbe.test.ts`、插桩版 `foldLoop.probe.ts`。
