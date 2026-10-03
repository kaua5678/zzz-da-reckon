# T16 分诊稿：般岳(1471) 怒相增益「轴内精确覆盖」—— 量过，**判定不做**（滑块口径保留）

> 状态：**结项（不做，备选保留）**（arena-F r475，2026-10-04）。执行卡 `docs/mcp-worker-task-queue.md` §3 **T16** 已按本稿改为「量过不做」。
> 本稿同时纠正 T16 卡面与 pending 分诊台账（`.claude/pending-triage-2026-10-03.md` G2）里的一处**事实错误**（触发源）。

## 0. 一句话

T16 卡面写「怒相增益 = 进入怒相（焚身）起 30s 窗口」，**原文不是这样**：触发源是**每一次[强化特殊技]或[支援突击]**，30s 且重复触发刷新。
般岳的循环里强特密度极高（每次怒相 4 个山威免费强特、怒相外闪能全部打成强特连段、招架后还有支援突击），
30s 窗口几乎不会断 ⇒ 实战覆盖率 ≈ 1，现有 `banyue.rageGainCoverage` 滑块（默认 100%）**就是正确近似**。
为「开局首个强特之前的几秒」建一条行级贯穿力通道 + 轴态 panel 停加 + 双计防护，收益 ≈ 0、代价与风险实打实 ⇒ **不做**。

## 1. 事实（r475 逐处核过）

| # | 事实 | 据 |
|---|------|----|
| F1 | 核心被动 Lv.7 原文：「般岳发动**[强化特殊技]或[支援突击]**时，贯穿力提升 300 点，造成的火属性伤害提升 36%，暴击伤害提升 36%，**持续 30 秒，重复触发时刷新持续时间**」（Lv.1 150/18/18 … Lv.7 300/36/36，每级 +25/+3/+3） | `data/raw/nanoka_missing/full/1471.json` 核心被动 desc（r475 `python3` 去标签后 grep「贯穿力」） |
| F2 | 现实现：`applyBanyuePanel`（`src/mechanics/agents/banyue.ts:477-487`）把 `RAGE_BUFF_SHEER 300 → panel.sheerForceFlat`、`(RAGE_BUFF_FIRE 36 + C2 15) → panel.fireDmg`、`(RAGE_BUFF_CRIT 36 + C2 15) → panel.critDmg`，三者 × `banyue.rageGainCoverage` 滑块（默认 1）。**panel 级**，对该角色全部行同值 | `banyue.ts:89-92, 477-487`；模块头注释 L41-43 写的触发源「强特/支援突击后」是**对的**，错的只是 T16 卡面 |
| F3 | 行级通道 `DirectRowBonus`（`src/mechanics/typesRows.ts:66-72`）只有 `dmgBonus / critDmgBonus / sheerDmgBonus / note`。其中 `dmgBonus` 与元素增伤同在一个加算区（`src/core/damage.ts:252-256`：`elementDmg + dmgBonus + skillDmgBonus + input.dmgBonus`）⇒ 火伤 +36% 对火属性行 ≡ `dmgBonus +36`，**可行级化**；暴伤 ≡ `critDmgBonus`，可行级化 | `damage.ts:252-256` |
| F4 | **贯穿力 +300 flat 不可经现有行级通道表达**：贯穿力 = `atk×0.3 + hp×0.1 + sheerForceFlat`（`src/data/penetrationPower.ts:20`），只从面板读。要行级化必须走 `pushDirect` 里 `penRatioBonus` 那种「浅克隆面板」先例（`src/composables/resourceCalc/damagePool.ts:146-148`）再加一个 `sheerForceFlatBonus` 字段 | `damagePool.ts:141-148` |
| F5 | 轴扫描先例：`computeBanyueMingwangStacks`（`banyue.ts:337-375`）只认 `banyue-combo` / `banyue-combo-didong` 两个**合成块**为触发；而本增益的触发源是**每一个强特块与支援突击块**（论道/狮子吼/山摇/地动/·怒 变体 + 昂霄/冲霄 + 合成连段块），触发集合要另列 | `banyue.ts:343, 56-76 MOVE 表` |
| F6 | 一次怒相 = 焚身 → 2 组山威连段（4 强特）→ 倾山 → 摧岳；怒相外剩余闪能全部打成 60 闪能/组的强特连段；每次招架/金身弹刀带支援突击 | 模块头注释 L23-31 |

## 2. 量化：精确模型相对滑块=1 的差在哪里

精确模型 = 「每条轴上，般岳每个动作块是否落在最近一次强特/支援突击的 30s 窗内」。
由 F1+F6：
- 怒相内：4 个强特块间隔 ≪ 30s，焚身自身在首个强特之前（**1 块**，221.7%，不吃）；倾山/摧岳在最后一个强特之后 ≪ 30s（吃）。
- 怒相外：连段 = 强特，每组自刷新；连段之间的普攻/闪反/招架块都在 30s 内（一局 120s 内般岳的闪能产出保证连段密度；哪怕 60s 只打 1 组也只断 30s）。
- 开局：首个强特/支援突击之前的块不吃——实战里开局第一个动作通常就是强特或支援突击（招架触发）。

⇒ 覆盖率 ≈ 1 − (开局前导 + 每次焚身) / 总动作时间 ≈ **0.95～1.0**。当前滑块默认 1；用户若在意可手动设 0.95。
对比实现代价（§3），**不值**。这与 T17（赛维里安 C2 凭风）不同——那个是「默认值必然错 + 一行能修」。

## 3. 若日后要做（备选路线，写到可开工粒度）

只有当出现**第二个**需要行级贯穿力 flat 的角色时再做（规则 of three：`penRatioBonus` 是第一个行级面板覆盖，本条会是第二个）：

- **a 步（零差，通道）**：`DirectRowBonus` / `DirectRowInput` 加 `sheerForceFlatBonus?: number`；`damagePool.ts#pushDirect` 的面板浅克隆改成「有任一行级面板覆盖就克隆」：`{ ...basePanel, penRatio: +penRatioBonus, sheerForceFlat: +sheerForceFlatBonus }`；`damagePoolDirect.ts#emitExecDirect` 把 `rb.sheerForceFlatBonus` 透传。锁：`damagePool` 一条「行级 sheerForceFlat 只影响该行贯穿力、不影响同槽其他行」。zd 期望 0。
  - 更通用的替代：把 `penRatioBonus` + `sheerForceFlatBonus` 合成 `panelAdd?: Partial<Record<'penRatio' | 'sheerForceFlat', number>>`——到那时再决定，现在不为未来抽象。
- **b 步（非零差，般岳迁入）**：`BanyueOverlay` 加 `rageByMove?: Map<moveId, 窗内占比 0..1>`；`axisWindowOverlays` 轴臂扫 F5 的完整触发集合（强特全部 moveId + 昂霄/冲霄 + 两个合成连段块），**触发块自身也吃**（原文「发动时提升」，与明王「释放后」不同——这点要在实现时再读一次原文定）；`directRowBonus` 返回 `{ dmgBonus: (36+c2)×占比, critDmgBonus: (36+c2)×占比, sheerForceFlatBonus: 300×占比 }`；`applyBanyuePanel` 在 **`isAxis` 时不加**怒相段（`AgentPanelInput` 目前没有 `isAxis`——要加，或改成「轴态下模块把滑块视为 0 并由 overlay 全接管」，二选一在 b 步开工时定）；非轴臂保持滑块。zd 允许般岳行差异，逐行解释；`timeGolden` 般岳队 delta 归因后重生成。
- **双计防线**：锁一条「轴态下般岳行 note 含『怒相（buff轴）』时面板 `sheerForceFlat` 不含 300」。

## 4. 本轮对文档的处置

- 队列 §3 **T16**：标题改「量过不做（备选）」，卡面触发源纠正为「强特/支援突击」，指向本稿 §3 作为备选路线。
- pending 分诊台账 `.claude/pending-triage-2026-10-03.md` 不入 git（`.claude/*` 被忽略），不改；G2 的纠正以本稿与队列为准。
- arch 表不加 CC 行（没有代码改动）。

回退点：本稿与队列 T16 卡的改动都是文档；若日后决定做，按 §3 a/b 开工即可，不需要撤销任何东西。
