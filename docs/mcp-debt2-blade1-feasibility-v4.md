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

## 11. 后记 6：动态合轴第一版实测（分支 `r37-j5-dynamic-combo-align-wip` @ `078e0b7`，未落 master）

用户定操作角色 = 净必要最大的槽（选项 a）。第一版把吸收插在 `calcTimeAllocation` 的 `rawScale` 之前（每次 iterate 都会触发），实测：

| 队 | 前 | 后 | 备注 |
|---|---|---|---|
| `auto-1431-1481-1491` | 截 86.5s / 87.3M / stun 3 | **截 10.4s** / 137.2M（+57%）/ stun 4 | 队友 68.9+26.5s 全被吸收；剩余 10.4s = 叶瞬光**单人** > 180s |
| `auto-1431-1481-1341` | 截 81.2s / 89.5M | **截 0** / 140.1M（+56.5%），降配 0.875 | |
| `auto-1371-1481-1451` | 降配 0.625 / 70.9M | 降配 1 / 76.9M（+8.5%）/ 留白 0 | 交互恢复 |
| `auto-1431-1491-1341` | 降配 0.0625 / 91.5M / 留白 0.9 | 降配 1 / 99.5M / **留白 12.8s** | ⚠ 账本必要封顶 180、物化行 167、平A 池 0、欠打回填没填 |
| `auto-1531-1571-1451` | 70.9M | 70.8M（−0.1%）| |

另 15 队因**探路轮**里也会 Σ净必要 > 预算而改变降配落点：banyue 系 +15~50%、`auto-1471-1571-1451` +31.5%、yixuan/billy-roxy-lucia +5~7%、
`auto-1371-1571-1451` −2.3%……共 **20/105 队变**（而不是普查的 5 队——普查量的是终态，吸收改的是搜索过程）。

**为什么不落 master**：默认口径 ratchet 5 队留白变差（`auto-1431-1491-1311` 1.1→10.9s、`auto-1431-1481-1491` 1.3→8.3s…），预设口径三队新增 8~13s 留白。
按用户口径「留白太多 = 引擎没把资源回复消耗算完备」，这不是可归因的代价而是缺口。形态：操作角色账本 `necessaryTime` 被单角色上限封在 180
而物化行只有 167s（`timeBudgetExcess` 折叠抬高的账本虚高老形态），平A 池 0，欠打回填的 `fitsBudget`（≤ 预算 − 1s）/ 折半试探没把它填回。

下一步（在 WIP 分支上）：① 用 `PROBE13` 三态打表把 12.8s 留白归因到具体门（`frontlineRowsOf` 对被吸收队友 rowNet − credit = 0 的处理 /
`UNDERFILL_PROBE_THRESHOLD` / 单角色上限与吸收的先后）；② 终态判据「截断 ≤ 容差 ∧ 留白 ≤ 容差」进 `dynamicComboAlign.test.ts`；
③ 只有 ①② 过了才做 20 队逐队归因 + 重生成 + 钉数测试重锚（nightD / timeWeightAllocation / yixuanSmoke / claretSmoke 等都会动）。

## 12. 后记 7：留白归因（WIP 分支 `4906484`）

- **预设口径 `auto-1431-1491-1341` 12.8s → 0**：根因 = 操作角色账本 `necessaryTime` 被单角色上限封在 180，物化行只有 167.2，平A 0；
  欠打回填 4 次试探全部 `stable=false` 被拒（cap 让它一秒平A都拿不到，refund 只能流向队友并搅乱次数收敛）。修：`runFoldLoop` 负溢出分支加例外——
  贴顶槽按物化行把本槽 `timeBudgetExcess` 累加负 excess（与正向折叠同口径）。修后账本 180→167.2 = 行、留白 0.00、队友吸收缩到 19.8/17.5（= 溢出量），伤害不变。
- **默认 setAgent 口径仍红 3 队**（`auto-1431-1491-1311` 10.9s / `auto-1431-1481-1491` 8.3s / `auto-1431-1491-1341` 5.7s）：根因不在引擎环——
  叶瞬光模块 `estimateExSpecialTime` 按可用前台规划明心境轮数（动态合轴给了它 180s ⇒ 估计 179.8），而 `buildExecutions` 受资源约束只产出 125.1s 行；
  欠打回填兑现 13.7s 后再试 unstable / `better=false`，终态账本 160.1 vs 行 149.3 = 10.85s。**估计与行不同源**是录入层缺口：1431 的 estimate 应从
  同一份行计划推导（或反过来），否则任何「给它更多时间」的机制都会露出这条缝。
- 落 master 前置条件不变：终态「截断 ≤ 1s ∧ 留白 ≤ 1s」；现在差的是 1431 模块的估计/行单源化 + 20 队逐队归因 + 钉数测试重锚。

## 13. 后记 8：「账本对账折回环」实验——否决，别再走引擎环这条路

试了 R37-J5 ③：对发生动态合轴的队，把每槽「账本前台 − 物化前台行」作 `necessaryDeficitSeconds` 注入、回 S2 重跑（与 rowTimeLimit 同骨架，
接受 = 留白严格变小且截断不增，≤3 轮）。结果：默认口径 ratchet 红 3→2，但 `auto-1431-1491-1311` 留白 **10.9→13.3s 反而变差**、
`auto-1431-1481-1491` 8.3s 不动；预设口径 20 队清单不变。⇒ 叶瞬光的估计/行关系是**非单调**的（账本必要压低 → 平A 池涨 → 剑势涨 → 轮数涨 →
行涨/估计再涨），外环折来折去不收敛。**代码已回退，不入分支**。结论不变：先把 1431 模块 `estimateExSpecialTime` 与 `buildExecutions` 单源化
（估计从同一份行计划推导），再谈动态合轴落 master。

## 14. 后记 9：叶瞬光估计/行单源化（分支 `895b976`）——留白 10.9→3.6s，最后一公里

- 修：`estimateExSpecialTime` 有 `state` 时用与 `buildExecutions` 同一份输入现算 cycle（`AgentExSpecialTimeInput.state` 的设计意图，星徽·比利同款）；
  此前读相位缓存 / 缺 basicAttackTime 的 `resolveCycle`。
- 实测：默认口径 ratchet 红 3→2，量级 10.9/8.3/5.7s → **3.6s**（`auto-1431-1491-1311`）+ 超预算 1.4s（`auto-1431-1341-1311`）；预设口径 20 队清单不变，
  1431 两队 +54.9% / +53.6%。分支上 `src/mechanics/__tests__` 3 红（`nextRoundFeedbackR20` jufufu 团大次数、`yixuanSmoke` 两条钉数）——
  都是动态合轴改变落点后的钉数重锚项，属落 master 前的第 3 步，未在分支上处理。
- 剩余：3.6s / 1.4s 已到整数装包残余 + 欠打回填 1s 门的量级，先打表再动；引擎外环对账折回（§13）已否决，别重试。

## 15. 后记 10：最后一公里两次实验——都没过闸门，否决记录（分支仍在 `895b976`）

默认口径残余：`auto-1431-1491-1311` 留白 3.6s（欠打回填三次试探 fits/better 全真却 `stable=false` 被拒——`convergeCounts` 裸循环把两态翻转判不稳）；
`auto-1431-1341-1311` 超预算 1.4s（折叠 pass0 冻结的 refund 1.19/1.41 在次数翻转后把行顶出预算；外层不动点 `exit=cycle`）。

- ⑤a 欠打回填改用折叠环同款 `runInnerLoop`（规范停点）：A 3.6→1.8s ✓，但 `auto-1591-1571-1211` 留白 0.2→1.4s ✗，另 4 队伤害出现 1e-5 级浮动
  （规范停点换了落点）。收益 1 队、代价 1 队 + 归因面扩大 ⇒ **否决回退**。
- ⑤b 回填过头则按超出量退回 refund 重收敛（接受 = 少超且 ≤1s 容差）：B −1.4 → **+3.7s**（退回后外层不动点落到另一态）⇒ 没有变好，**否决回退**。
- 结论：这两队的 ±1.5~3.6s 是**外层不动点振荡**（stun 次数 ↔ 资源 ↔ 时间）的落点差，不是守恒式缺口；再往下要么在外层不动点的环规范化上做文章
  （`runCalcRound` 的 cycle 选点），要么接受 ratchet 容差从 1s 放到 2s（需用户裁决）。**不要再在欠打回填里加分支**。

分支 `r37-j5-dynamic-combo-align-wip` 终态 = ① 动态合轴 + ② 贴顶槽折回 + ④ 叶瞬光估计/行单源（`895b976`）。落 master 剩：
`dynamicComboAlign.test.ts` 终态判据 → 20 队逐队归因 + timeGolden/ratchet 重生成 → 钉数测试重锚（分支 mechanics 3 红）→ 干净 worktree verify；
默认口径两队残余按上面结论处理（外层环规范化 or 容差裁决）。

## 16. 后记 11：外层不动点 cycle 停点规范化（分支 `953214a`，用户裁决「治本」）

- 改：`runOuterLoop` 判 `cycle`（2-循环 / 长环）后不再返回碰巧最后算的那轮，而是环内成员按**时间自洽度**（|预算 − Σ物化净占用| + 截断秒数）
  取最小者，相等取最后一轮；诊断 `convergence.outerCyclePickedEarlier`。
- 实测（**更正**：当时只看了变化条数，没看数值）：默认口径 ratchet 的两队残余不变（`auto-1431-1341-1311` −1.4s 成员优于另一成员 +3.7s），
  但预设口径有几队因取点换成了另一环成员：`auto-1431-1481-1311` −24.3%、`yidhari-qingyi-lucia` −12.2%、`yixuan-jufufu-lucia` −4.0%、
  `auto-1371-1571-1451` −9.4%（stun 3↔4 / 2↔3 互为映射的环，时间最自洽成员失衡少一次）。价值 = 落点从运气变判据，但**不是零 delta**。
- 因此两队残余的定性：**1.4s 超预算**是该振荡队在当前语义下最自洽的落点（要再压只能动外层映射本身，如 stun 次数投影 / 窗口覆盖公式）；
  **3.6s 留白**是欠打回填对两态翻转的 stable 判据（⑤a 的规范停点能修到 1.8s，但会让 `auto-1591-1571-1211` 0.2→1.4，需要先把那队归因清楚再决定）。

分支终态 = ① 动态合轴 ② 贴顶槽折回 ④ 叶瞬光估计/行单源 ⑥ cycle 规范停点（`953214a`）。落 master 流程不变（终态判据测试 → 20 队归因 + 重生成 →
钉数重锚 → 干净 worktree verify）。

## 17. 后记 12：叠加态满套件（分支 `6aef5de`）——20 红 / 11 文件，未合入

`dynamicComboAlign.test.ts` ①②③ 绿；timeGolden / ratchet 已重生成（预设 25 队、单人 sweep 数十条：留白 20~40s → 0、伤害 +0.03%~+37.6%，
机制 = ② 贴顶槽账本折回对单人槽恒生效——单人必要+平A 恒贴 180；ratchet 两条存量漂移保持）。但干净 worktree `npm run verify` **20 红**：

| 类别 | 用例 | 性质 |
|---|---|---|
| **不变量（必须修，不能重锚）** | `warmStart.test` 1431 系同配置二次调用逐位一致 → false | 冷/热启动落点不再一致：新环（重折 / 吸收 / cycle 取点）让结果依赖种子 |
| 合轴模型语义 | `comboAlignBudget.test` ×2（Σnecessary>180 可行、端到端净占用同口径）、`comboAlignRelief.test` 诚实面 | 动态吸收改变了「净占用 ≤ 预算」与「合轴匀出」的口径，要么口径升级要么实现有漏 |
| 钉数重锚 | `damagePoolBatchR17c/R18d` 次数锚 16.206→7.29、`teamTimeSummary` ×2、`timeWeightAllocation` ⑥b/⑥c/⑦、`truncationRefold` ①③④（1431 队不再截断）、`banyue.test` 轴退化、`nextRoundFeedbackR20`、`yixuanSmoke` ×4 | 数值随口径变，逐条归因后重锚 |

⇒ 合入 master 的门槛没过：先解 warmStart 决定性（怀疑 `runInnerLoop` 的 `injectedStates` 分支 / 重折与吸收对 warm 种子的敏感），再裁决合轴模型语义
两条测试的口径，最后才重锚。分支保留全部实测，master 不动。

## 18. 后记 13：warmStart「冷/热分叉」是误诊——真病灶是内层不动点在 20 轮上限处撞顶（分支 `4838870`）

§17 把 `warmStart.test` 1431 系的红归为「冷/热启动落点不再一致」。复核（2026-09-19）：该用例只在 `expect(hot.converged).toBe(true)`
一行红，前一行 `fingerprint(hot) == fingerprint(cold)`（含 `converged`）**通过**——冷/热逐位一致从未被破坏，破坏的是 `converged`。

### 18.1 归因（bisect + iterate 逐轮打表）

| 提交 | 1431/1341/1031 冷算 | 备注 |
|---|---|---|
| `078e0b7` ① / `4906484` ② | `converged=true iter=11` | 与 master 同 |
| **`895b976` ④** | `converged=false iter=20` | 首次出现；⑥ `953214a` 同 |

④ 让叶瞬光估计用 `state.basicAttackTime` 现算 cycle（估计/行单源，本身正确），等于把「平A→局外剑势→明心境轮数→必要时间→平A」这条
**连续**反馈边搬进了内层。逐轮打表：ρ≈0.17 的几何收缩（bat 残差 16.7→4.4→0.75→0.13→…），第 14 轮起 9 位小数不动，但浮点复合映射
**没有精确不动点**——第 21 轮起 `bat 25.94937036135673 ↔ …728`（1 ulp）、`nec` 差 2 ulp 的精确 2-循环。`runInnerLoop` 判稳是严格相等、
上限 20：在进入精确环之前就到顶 ⇒ 停点 = 上限处瞬态、`clean=false`；即使上限更大，旧环检测也会把这个环报成 `clean=false`。

104 预设普查 `converged=false`：master 3 队（`auto-1431-1481-1491` / `auto-1591-1161-1211` / `auto-1331-1561-1411`，都是 iter=3~4
经真整数环退出、无人断言）；分支 5 队 = 其中 2 队 + **3 支 1431 队 iter=20 撞顶**（`auto-1431-1491-1311` / `-1341-1311` / `-1481-1311`
——正是 §14–§16「最后一公里」残余那几队）。§15 说的「`convergeCounts` 裸循环把两态翻转判不稳」也是同一病灶：那不是两态翻转，是 ulp 微环。

### 18.2 修法（引擎级、窄范围）与两次反例

1. `INNER_LOOP_MAX_ITERATIONS = 100` 单源（`useResourceCalc` 此前写死 `maxIterations: 20`，`core/resource.ts` 的缺省值形同虚设）。
2. `core/resource/floatNoiseCycle.ts`：环成员逐槽逐字段相对 1e-9 内 = **浮点噪声环 = 已收敛**（规范停点仍取字典序最小成员、数值一位不差，
   只改 `clean`）。判稳**不改 ε**：ε 判稳会让不同种子在到达同一浮点不动点之前各自停下，破坏 1051/1531 队 seedInvariance 逐位档。
3. **两层预算**（`INNER_LOOP_OSCILLATOR_STOP = 20`）：第 20 轮之后只用于收敛尝试，真整数环 / 耗尽 ⇒ **回到第 20 轮状态**，非收敛轨迹与旧口径
   逐位一致。反例 = 单纯放大上限时单人 `agent:1431:c6`：它是 ex 6↔10 / ult 1↔2 的整数量子振荡器（环增益 >1），走到精确环后取字典序成员，
   其账本是「本轮次数 + 上轮平A」估出的混相位量，行与账本差 21s，折叠环随之在 84/49/29/78s 间摆、靠停滞规则退出 ⇒ 留白 **0→29.0s**。
   非收敛轨迹没有「更对」的停点，只有历史已钉的停点；真解仍是 DEBT「全局实数化收敛重构」。
4. 欠打回填 `convergeCounts` 复用 `runInnerLoop`（原裸循环无环检测）。与 ⑤a 的区别：噪声环才算稳，真整数环仍拒 ⇒ 没有 ⑤a 的 1591 副作用。
5. `dynamicComboAlign` ①「credit == 净必要」是全额吸收的特例（中间实验里出现过 1431 落 179.12、溢出 90.71 < 容量 91.59 的部分吸收落点，
   63.77+26.94 = 90.71 精确成立）⇒ 升级为「吸收总量 == min(溢出, 容量)」恒等式，两种落点都过。

### 18.3 实测

- 预设 `converged=false` 5→**2** 队（剩余 = master 既有真整数环）；`warmStart` 4/4、`seedInvariance` 3/3、`floatNoiseCycle` 3/3、`dynamicComboAlign` 3/3、
  vue-tsc、check-guards 绿。
- 默认口径 ratchet **绿**且改善：`auto-1431-1341-1031` 留白 4.3→**1.1s**、`auto-1431-1491-1311` 3.6→**1.8s**（⑤a 想要的收益）；
  `auto-1431-1341-1311` 超预算 1.4s 不变（§16 定性不变）。
- 预设口径 golden 重生成 14 条 / 5 队：4 支 1431 队 = 停点从 20 轮瞬态移到收敛点（最大 `auto-1431-1491-1341` ex 5→6 / nec +7.2s / dmg +2.2%，
  其余 ≤0.07s）；`auto-1561-1171-1411` 0.04s 级；**单人 sweep 零变化**。
- **同一补丁套 master**：golden 3 条（`auto-1561-1171-1411`，同上）+ ratchet `claret-roxy-rina` exit stable→cycle（留白 0.1 不变）/
  `yidhari-roxy-lucia` 留白 1.6→1.7s；allAgentsSweep 311 / seedInvariance / warmStart 绿 ⇒ 这一修可**独立先落 master**（与 R37-J5 解耦、归因面最小），
  分支再 rebase。是否这样做待用户拍板。
- 分支 `4838870` 干净 worktree 满套件（`npx vitest run`）：**19 红 / 10 文件**（3051 用例）= §17 的 20 红去掉 `warmStart`；
  其余逐条同 §17 分类：合轴模型语义 3（`comboAlignBudget` ×2、`comboAlignRelief` ×1，见 18.4）+ 钉数重锚 15
  （`damagePoolBatchR17c/R18d`、`teamTimeSummary` ×2、`timeWeightAllocation` ×3、`truncationRefold` ×3、`banyue`、`nextRoundFeedbackR20`、`yixuanSmoke` ×4）。

### 18.4 仍待用户裁决的口径（不代裁）

- `comboAlignBudget.test` ×2：两条都断言「无静态合轴率 ⇒ `overflowSeconds > 0`」的对照组——动态合轴口径下 Σ净必要 > 预算就会被队友吸收，
  对照组本身不再溢出（overflow 0 是机制生效，不是漏）。若用户确认「自动吸收是缺省语义」，两条重锚为「对照组 dynamicComboAlignSeconds > 0、
  overflow 0；静态合轴率仍额外产生 credit」；若用户要保留「不设合轴率时不吸收」的可观测面，动态合轴需加 opt-out 开关（口径升级）。
- `comboAlignRelief.test` 诚实面：`1191/1481/1311` 走 joint 档后 stun 4→3（硬不变量「失衡不降」红）。动态吸收改变了 joint 试探期间的落点，
  需先归因是「吸收让某轮 stun 落到相邻整数」还是接受判据漏了动态 credit，再决定重锚还是修判据。

