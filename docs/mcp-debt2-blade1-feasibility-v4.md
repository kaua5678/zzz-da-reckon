# 协作者 WIP 接管备忘：债 2 刀 1（截断入口容差）+ 降配搜索 v4（绝对可行优先）（2026-09-19 round 37）

> 定位：**决策与实测记录**。口径唯一事实源在代码：`src/core/resource/helpers.ts#TIME_FOLD_CONVERGENCE_SECONDS` 头注释与其 `@fact`、
> `src/composables/resourceCalc/feasibilitySearch.ts#selectDownscaleScale` 头注释与其 `@fact`。本文只回答「拿到的是什么、为什么拆、
> 每队 delta 从哪来、没合入的那半去了哪」。

## 1. 拿到的是什么（用户 2026-09-19 授权接管，「你在规则之上」）

主工作区 8 个 tracked 改动（外部协作者 2026-09-18 22:03 – 09-19 00:51 施工，未提交、之后 9.5h 无写入）。先**原样存证**再动刀：
`git stash create` 得 `0c2f627` → 分支 `collab/wip-snapshot-20260919`（工作树未动）+ `/tmp/r37-collab-backup/`。

按 mtime 与内容分两半：

| 片段 | 文件 | 内容 | 状态 |
|---|---|---|---|
| **A**（22:03–22:49） | `feasibilitySearch.ts` / `feasibilitySearch.test.ts` / `useResourceCalc.ts` / 两份基线 + `helpers.ts`/`resource.ts` 里的容差部分 | 刀 1：S4 截断入口容差 `1e-9` → 与 S2 折叠环同一常量 `TIME_FOLD_CONVERGENCE_SECONDS = 1e-3`；降配 v4：`selectDownscaleScale` 两层字典序（绝对可行优先、相对档兜底）+ 6 条测试 + 2 条带 ⟳复核 的 `@fact` | **合入** `1cc08a8`（+ 测试归因更新 `b0f2f5b`） |
| **B**（00:46–00:51） | `resource.ts` 重折环 / `helpers.ts#feasibleRows` / `types/resource/config.ts#rowTimeLimit` | 债 2 批 2-1「截断外环回灌」 | **不合入**，见 §4 |

## 2. 为什么 B 不能合

1. **代码走不到**：重折环写入 `cfg.rowTimeLimit` 后立刻整体回滚并 `break`，作者注释自述「下面的代码路径走不到 … 真正的重折逻辑在我们把装配/终推抽出 helper 之后插入。先回滚」；
2. **类型不一致**：`rowTimeLimit` 加在 `ResourceCalcConfig`（全局）上，读的却是 `cfg.rowTimeLimit`（`CharacterOperationConfig`）⇒ 主工作区 `vue-tsc -b` 7 处红（`prevCut` 未使用 + 6 处 TS2339）；
3. **文档先于实现**（规则 16 的形态）：`engine:能量收入行级Σ` / `engine:喧响收入行级Σ` / `engine:资源账本/截断` 三条 `@fact` 与 debt 标记被改写成「外环重折已落地、最多 3 轮、只接受 Σcut 严格变小」——实现里没有这回事；
4. **潜在泄漏**：回滚用 `Object.assign(c, savedCfgs[i])` 不会删掉新加的 `rowTimeLimit` 键，被截断槽位的 cfg 会带着它进入下一轮外层不动点（cfg 对象被复用）——一旦重折环真跑起来，默认路径「0 delta」的前提就不成立。

实测：两份基线在干净树上用 A 单独重生成，`timeGolden.baseline.json` 与协作者交来的**逐字节相同** ⇒ B 对基线零贡献，A 可独立成立。

## 3. 逐队归因（规则 10）

方法：`/tmp/wt-base2`（`cb29f1a`）→ 只打 core 容差 hunk（刀 1）→ 再打 composables（v4），三态各跑一次 probe（读
`convergence.interactionScale` / `timeTruncatedSeconds` / `outerExit`，与 golden、ratchet 各自的 `measure` 语义一致）。

### 3.1 `timeGolden`（预设配置口径：`applyTeamPreset` + 构筑推荐）

| 队 | 归因 | 机制 | 读数 |
|---|---|---|---|
| `auto-1591-1481-1311` | 刀 1 | 假截断 0.906s（连携整次）消失，scale 不变 | dmg +0.945%，slack 0.905→0.000，over 0→0.001（毫秒残差如实上报） |
| `auto-1591-1161-1211` | 刀 1 | 假截断 0.580s 消失，外层不动点微移 | dmg +1.196%，chain 1.464→1.487 |
| `auto-1461-1521-1031` | 刀 1 | 假截断 0.434s（5 行）消失，scale 0.875 不变 | dmg −0.014%，slack 1.530→1.096 |
| `auto-1431-1491-1341` | 刀 1 | 基线态 8 档试算**全部**被假截断误拒 ⇒ 停在 scale=1、结构性截断 **40.07s**；刀 1 后 0.0625 档可行（cut 0） | dmg **+17.742%**，slack 2.804→0.920，槽1/2 ult 2→1 |
| `billy-roxy-lucia` | v4 | 0.75 档「相对更好」但超预算 4.99s；v4 选真装进 180s 的 0.375 档 | over 4.990→0.076，stun 5→4，dmg −2.869% |

`yixuan-roxy-lucia` 在此口径三态恒 scale 0.375、零 delta。

### 3.2 `timeFillRatchet`（默认配置口径：只 `setAgent`，不 apply 预设；容差 1s）

| 队 | 归因 | 机制 | 读数 |
|---|---|---|---|
| `auto-1431-1481-1311` | 刀 1 | scale 0.625→0.75 | 留白 2.4→1.9 |
| `auto-1461-1521-1361` | 刀 1 | scale 0.625→0.75 | 留白 1.7→1.3 |
| `banyue-roxy-lucia` | 刀 1 | scale 0.5→0.625（cut 0.674s / 超预算 0.375s 均在 1s 量化容差内，v4 判绝对可行故保留） | 超预算 0.1→0.4 |
| `yixuan-roxy-lucia` | 刀 1 ⟂ v4 | 刀 1 单独：0.625→0.875（超预算 0.2→1.7s，棘轮红）；v4 复位 0.625 | 零 delta（= v4 的立项证据） |

### 3.3 顺手量到：ratchet 基线在 HEAD 已有 2 条存量漂移

`cb29f1a` 干净树 `TIME_RATCHET_UPDATE=1` 重生成即与提交版不同：`claret-roxy-rina` outerExit stable→cycle、`yidhari-roxy-lucia` 留白 1.6→1.7。
与本刀无关（三态恒定），容差内从未红。本次**沿用协作者版本**（= HEAD + §3.2 三条），不顺手抹平；登记为 OPEN-ITEMS R37-J3。

## 4. 片段 B 的去向与下一步（OPEN-ITEMS R37-J2）

- 原文：分支 `collab/wip-snapshot-20260919`（已推 origin）。`feasibleRows` 的形状（平A先占位、`available = basic + rowTimeLimit`）是可复用的。
- 作者自己的结论也是正解：**先把装配段抽成 `runAssemble()`**（`calcTeamResources` 内折叠→比利终推→欠打回填→伊德海莉终推→装配是线性 `const` 段，
  无法二次进入），再在其外做「初装截断 > 容差 ⇒ 按 kept 设 rowTimeLimit ⇒ 重折」的循环。
- 证伪闸门（写进账本）：前提 =「默认路径（cut ≤ 1s 队）零分支零写入」；若抽 `runAssemble()` 这一步本身让 `timeGolden` 出现任何非零 delta
  ⇒ 抽取不是纯搬迁，先停下归因；若重折环跑起来后 `rowTimeLimit` 在返回前没被删干净（`allAgentsSweep` 命座对比 / 热启动第二轮读数变）⇒ 泄漏，
  回滚。

## 5. 验证与「协作者没跑满套件」的代价

- 主工作区：`check-guards` 19 ok（判据 15 已挂 16 / 待补 0，三条豁免行重新生效）、`check-tokens` 12 ok、`vue-tsc -b` **首次转绿**；
  `feasibilitySearch` / `timeTruncation`（+1 条入口容差 discriminating pair）/ `timeGolden` / `timeFillRatchet` / `teamTimeSummary` /
  `underfillRefund` / `comboAlignBudget` / `energyRowParity` / `decibelRowParity` 9 文件 66 条全绿。
- 干净隔离 worktree `/tmp/wt-r37c` @ `1cc08a8` 跑 `npm run verify`：**红 4 条**（协作者交来的 WIP 从未过满套件）。逐条归因后全部是
  「测试钉住了假截断时代的读数」，以 `b0f2f5b` 收口：

| 用例 | 现象 | 归因 | 处置 |
|---|---|---|---|
| `damagePoolBatchR17c` / `R18d`「1431013 → stunMult 1.5」 | 次数锚 `toBe(14)` 实测 16.206 | 默认配置下 `auto-1431-1481-1311` 刀 1 前 scale 0.625（0.75 档被假截断误拒）→ 刀 1 后 0.75 | 锚改 `toBeCloseTo(16.206, 3)` + 注释；stunMult 成对判据未动 |
| `timeWeightAllocation` ⑥b/⑥c | 前置 `truncated > 0` 失败 | 样本 `auto-1591-1481-1311` 的 0.906s 正是被刀 1 消灭的假截断 | 样本换 1431 簇结构性溢出队 `auto-1431-1481-1491`（108.8s，唯一同类还有 `auto-1431-1481-1341` 100.1s） |
| `timeWeightAllocation` ⑥c | 新样本走「部分拉回」（108.79→87.41s），原断言只认「归零 / 拉不回来」两态 | 实现有三个出口 | 断言补第三态：含「可行性优先：截断 a→b」且不含「拉不回来」 |

- `/tmp/wt-r37c` @ `b0f2f5b` 复跑 `npm run verify`：读数见 `.claude/PROMPT-handoff-round37.md` §1.4。

## 6. 后记：批 2-1 已按正解落地（同日，R37-J2）

- ① `703290f`：`calcTeamResources` 尾段（欠打回填 → 伊德海莉终推 → 热启动落缓存 → 赠链/帷幕 → S4 装配）纯搬迁为 `runTailPipeline`
  （`git diff -w` 仅 17+/2−），timeGolden / timeFillRatchet / allAgentsSweep / seedInvariance 等 337 条零 delta。
- ② `1b21a16`：重折环 + `feasibleRows`。与 §2 列的四条缺陷逐一对应的设计差异：字段落 `CharacterOperationConfig`（不是全局 config）；
  重折**回到 S2 入口**重跑（cfg 清键还原 + 规范种子 + 诊断量归零），不在被第一遍尾段改写过的 cfg 上叠跑；回滚用「清键 + assign」
  （`Object.assign` 删不掉新加键）；返回前恒 `delete cfg.rowTimeLimit`，`WARM_KEY_OMIT_CFG` 亦排除；重折环真的执行且有注入反验
  （`ROW_REFOLD_MAX_PASSES` 3→0 ⇒ `truncationRefold.test.ts` ① 红）。
- 读数（timeGolden 重生成仅 2 条变）：`auto-1431-1481-1491` cut 108.79→86.86、dmg −8.72%、每槽少 1 次终结/强特；
  `auto-1431-1481-1341` cut 100.09→81.62、dmg −14.37%。伤害下降 = 原读数虚高的回吐（靠装不下的行的收入撑起来的次数，180s 里本就打不出）。
- 未销号：结构性溢出队重折后仍残留 80+s 截断（如实上报），「直到截断为 0」要等实数化专项 + 用户终验；debt 标记保留并追加进度段。

## 7. 后记 2：重折暴露的截断装包老 bug（`6a64278`）

- 现象：`teamTimeSummary`「Σ 逐行 cutSeconds == overflow」在重折态差 1.9s（HEAD 上一直有 0.244s 残差，被当量化噪声容忍）。
- 根因（探针逐行打表定位）：`truncateExecutionsToFrontline` 第 ② 步加回只判 `u.count < u.e.count`，小数次数行 8.249 floor 到 8 后仍放行 +1 = 9
  ⇒ 截断后的计划比截断前**多打** 0.751 次、kept 虚高、该行不进 cuts。修：`u.count + 1 <= u.e.count + 1e-9`，恒等式容差 1s → 1e-6。
- 读数：两条 1431 预设 dmg +1.6% / +4.4%（重折收敛点微移）；`agent:1051:c3` slack 1.41→3.50（虚的 0.x 次去掉后 2.1s 未被欠打回填吃满）；
  ratchet 默认口径 `auto-1431-1481-1341` 留白 1.6→3.1（77.5s 截断归零的粗粒度残余）、`auto-1431-1481-1491` 3.5→1.3。

## 8. 后记 3：重折接受判据从「严格变小」放宽到「不增」+ 不动点停机 + 诊断量

- 动机：批 2-1 的终点是「账本 == 展示层」。探针（`PROBE7`：逐槽账本 skillRegen vs 保住行 Σ）显示 `auto-1431-1481-1341`
  两轮后**逐槽精确相等**，而 `auto-1431-1481-1491` 停在账本 < 保住行（1481 喧响 2072 vs 2446）——第二轮 Σcut 相等就被「严格变小」拒掉，
  账本再也没机会按真 kept 重算。般岳保底队（nightD）同理：72.8→68.1 后一轮等值被拒，放宽后第三轮到 64.9。
- 改法（`resource.ts` 重折环）：接受 = Σcut ≤ 上次 + 1e-6；停机 = 本轮 kept 与上一轮写入的 rowTimeLimit 逐槽 |Δ| ≤ 1e-3（不动点）
  或 3 轮用尽；Σcut 变大仍整体回滚。新增 `convergence.truncationRefoldPasses` / `truncationRefoldRejected`（如实上报振荡队）。
- 否决：折半阻尼（limit ← last + ½(kept − last)）实测对 1491 队不改变最终装配、只多跑一轮，删。
- 读数：两条 1431 预设不变（1341 两轮到不动点；1491 第三轮反弹被拒 → `rejected=true`，账本与保住行仍差一截，如实上报）；
  `agent:1051:c4/c5/c6` 槽0 basic/nec 各移 0.097s（等值轮被接受后账本按 kept 重算，伤害不变）；nightD 般岳补齐量 4→3 弹刀。
- 判据：`truncationRefold.test.ts` ④（不动点队账本 == 保住行 Σ，能量按 energyRowParity 同款规格锁、喧响按 Σ totalDecibelRecovery；
  振荡队断言 rejected=true）；`timeTruncation.test.ts` 新增加回不越次数的 discriminating pair（a=8.249 次：旧条件给 9）。

## 9. 后记 4：结构性溢出的真根因是「合轴率数据缺位」，用户口径已定（R37-J5 任务书）

用户裁决（2026-09-19）：**必要时间只约束单人 ≤ 180s；三人前台总和可以 > 180s（合轴）**。「最后一点时间先进行合轴包容，有限包容后才截断」：
时间只剩 2s 时要塞十几秒的必要动作 ⇒ **动态上调队友合轴率**让这次完整打出来（允许一次），而不是丢掉留白。

实测（`PROBE9/11`）：
- 引擎已有合轴抵扣（团队可 > 180、单人 ≤ 180，`@fact engine:合轴预算抵扣` / `单角色前线上限`），只消费 7 类招式的 `*ComboAlignRatio`；
- **全库 1352 招只有 1 招 `comboAlignRatio > 0`**，叶瞬光 34 招全 0 ⇒ 1431 队被当纯串行截 86s，这不是「边界一次动作」而是 ~30 次动作；
- 把队友（1481/1491）合轴率拉满：credit 31.5+11.5s，1431 必要 118.6→139.9，**截断 86.5→44.2s**，伤害 +12.6%；三人全拉满：截断 28.1s、伤害 +48%、
  单人前台 169.4 ≤ 180 仍守住。⇒ 用户描述的机制通过既有管线成立；今天 UI 已能手动做（结果页「合轴率调节」）或用难度阶梯 G5 自动 +50%/档。
- 全库 105 预设默认口径 + 单人 sweep 扫描：**没有** 1s < cut ≤ 25s 的「边界一次动作」样本；该规则目前只会在用户自定义场景触发。

R37-J5 引擎落地方案（未实施，待用户定「一次」之外是否允许继续上调）：
1. `CharacterOperationConfig.comboAlignBoostSeconds?`（迭代量，返回前删）加进 `calcTimeAllocation` 的 `comboAlignCredits[i]` / `comboAlignTimes[i]`；
2. 重折环之后加「边界包容 pass」：某槽 cut 中整次动作只有 1 次（其余为小数残余）⇒ X = cutSeconds；队友可上调容量 = Σ 7 类招式 count×actionTime×(1−ratio)；
   容量 ≥ X 则按比例给队友 boost、回 S2 入口重跑；接受 = Σcut ≤ 容差 且各槽 frontline ≤ 战斗时间；否则整体回滚；
3. 诊断 `convergence.comboAlignBoostSeconds`；判据：合成样本（缩短战斗时间造边界溢出）红/绿对 + 1431 队不受影响（非边界）+ 105 预设零 delta。

## 10. 后记 5：用户把 R37-J5 改成「动态合轴」（引擎级，任务书 v2）

用户口径（2026-09-19，原话要点）：多名角色同场时**指定一名操作角色**，其余队友的**总前台时间自动缩水**（= 被合轴吸收），
缩多少由**溢出量**决定——不录死的合轴率（录死了下次溢出还是不会解）；引擎循环算到最后**应当只溢出一点或不溢出**，
溢出太多或留白太多都是引擎「资源回复/消耗没算完备」。

⇒ R37-J5 v2 = 把「合轴」从静态 ratio 数据改成 **S1 第 4 步的动态抵扣**：
1. 位置：`core/resource/helpers.ts#calcTimeAllocation`，在 `feasibleScale` 封顶**之前**：若 Σ(净必要) > 预算，把超出量 X 按容量分给
   非操作角色作为动态 credit（`dynamicComboAlignCredit[j]`，容量 = 该槽 gross 必要 − 已有 credit，即「队友前台被合轴吸收」），
   操作角色不吸收；只有 X 超过 Σ 容量的剩余部分才走 feasibleScale / 装配截断。单人 ≤ 战斗时间的上限不变。
2. 操作角色：缺省 = 必要前台最大的槽（溢出发生的那槽），可由队伍配置指定（待用户定，见下）。
3. 平A 池：动态吸收释放出的团队预算按既有权重回到平A池（欠打回填不变）；收敛终态判据 = 截断 ≤ 容差 **且** 留白 ≤ 容差，
   否则是引擎缺口（不是可容忍残差）。
4. 诊断量：`convergence.dynamicComboAlignSeconds`（Σ 动态吸收）、逐槽吸收量进 `timeAllocation`（展示层「合轴节省」同源）。
5. 判据：预设口径实测**只有 5/104 队**处于时间压力态（Σ必要 ≈ 预算、平A 池 ≈ 0、Σcredit = 0）：`auto-1371-1481-1451`（降配 0.625）、
   `auto-1431-1491-1341`（降配 0.0625、几乎清空交互）、`auto-1431-1481-1491`（截 86.5s）、`auto-1431-1481-1341`（截 81.2s）、
   `auto-1531-1571-1451`（降配 0.875）——其余 99 队必须逐位 0 delta；这 5 队逐队归因（预期：截断→0、交互档位回升、伤害上升）。
6. 证伪闸门：前提 =「队友前台可被全额合轴吸收」——若某队吸收后单人前台 > 战斗时间、或 allAgentsSweep 出现失衡 0 盆 / maxIter，
   说明容量上限写宽了，先收容量再谈；99 队任何非零 delta = 触发条件写宽，回滚。

