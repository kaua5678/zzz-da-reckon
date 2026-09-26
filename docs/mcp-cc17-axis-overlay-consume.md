# CC-17 设计稿：axis overlay 消费端能力化（+ 可琳 basic_attack 轴模式泄漏修复）

> 2026-09-26 第 23 轮 lead-arena-0925c 起草。状态：**定稿，待实现**（实现记录写在文末 §8）。
> 上游：`docs/mcp-r22d1-batch12-field-census.md` §5.8（候选）。判据 22：HEAD `dfdbda1` 读数 712，target 700。

## 1. 现状（HEAD `dfdbda1` 实读）

- **产出端已模块化**：`panelPhases.ts#collectAxisWindowOverlays`（约 :337–390）遍历队员，调用
  `getAgentMechanic(id)?.axisWindowOverlays(input)`。返回值类型 `AgentAxisOverlays`（`mechanics/types.ts` 约 :1131）由两部分组成：
  - 4 个按 moveId 索引的桶：`banyueMingwangStacks` / `yixuanNingshenMap` / `peiluoKagerouMap` / `corinStunBonusMap`；
  - 1 个按槽位索引的标量表 `scalarBySlot: Map<slot, AxisScalarOverlays>`。
  collect 把 4 个桶**跨模块合并成全局表**（逐个 if 覆盖赋值），标量表按 slot 合并。
- **透传**：`useResourceCalc.ts` 约 :585–588 → `DamagePoolContext`（`damagePool.ts` 约 :79–82）。
- **消费端仍然写着角色专属计算**：`damagePoolDirect.ts#emitCharDirectRows` 的 `emitExecDirect` 闭包（约 :160–235），逐段计算：
  - 明王：轴模式用桶层数 × `MINGWANG_BASE_PER_STACK`，非轴用标量 `banyueMingwangPct`；
  - 可琳：轴模式要求 `stunOverride > 0` 才查桶，非轴用标量 `corinStunBonusPct`；
  - 希格莉德：标量 `sigridInfectionPct`，与轴模式无关；
  - 悠真：行级字段 `harumasaStunOnly`，**不属于 overlay，本卡不动**；
  - 仪玄：优先用标量 `yixuanNingshen`，否则轴模式查桶，否则取 0；
  - 佩洛：轴模式查桶，非轴用标量 × 行级配对比例；只有 `1551016` 这一行读 `peiluoKagerouPairRatio`，**角色 moveId 字面量写在编排层**。
- 汇入：`critDmgBonus += 仪玄暴伤 + 佩洛`；`dmgBonus = exec.dmgBonus + 明王 + 可琳 + 希格莉德 + 悠真`；`sheerDmgBonus += 仪玄贯穿`。
  note 片段依次为：明王、可琳、悠真、希格莉德、仪玄暴伤、仪玄贯穿（佩洛不进 note）。

## 2. 已证实的 bug：可琳扫除帮手在轴模式下泄漏给队友的普攻行

- 根因：`corin.ts#computeCorinStunBonusMoves` 把可琳槽的平A块（'basic' / catalog 普攻段）归并到键 `'basic_attack'`。
  所有角色的普攻聚合行 moveId 都是 `'basic_attack'`，而桶是**跨模块合并的全局表**，所以任何槽位的轴内（`stunOverride > 0`）`basic_attack` 行都会查到 35%。
  `types.ts` 里 AgentAxisOverlays 头注释说「moveId 全局唯一，所以不会串味」，这个前提**对 `basic_attack` 不成立**。
- 实测（临时探针 `src/mechanics/__tests__/zzProbe17.test.ts`，已删除）：
  - 场景：队伍 `[1061, 1021]`（1021 使可琳额外能力生效），`useStunAxis=true`，轴动作为 `slot0 1061011@0`、`slot0 basic×5@2`、`slot1 basic×3@7`、`slot0 1061018@10`；
  - 结果：slot 0 **和 slot 1** 的轴内 `basic_attack` 行 note 都带「失衡增伤+35.0%（buff轴）」；
  - 对照：把队友换成 1041（额外能力不生效），两边都不带。
- 其他桶不受影响：banyue / yixuan / peiluo 的桶用原始 `act.moveId` 做键，平A块的键是 `'basic'`，永远对不上执行行的 `'basic_attack'`；可琳只收自己槽的 act（`act.slot !== slot` 会跳过）。所以**泄漏面只有「可琳在队 + 额外能力生效 + 轴模式」时队友的轴内 basic_attack 行**。
- dump / rowsnap 语料**不含 1061**（dump-H2a 的键里没有任何 1061），所以这个 bug 和它的修复都**不会出现在零差比对里**，必须用单测锁住（§6）。
- 游戏口径：扫除帮手是「命中失衡敌人时**自身**伤害 +35%」（`damagePoolDirect.ts` 原注释），不该加给队友。**修复它是本卡唯一有意的行为变化。**

## 3. 决定

1. **overlay 按槽位归属存放**：collect 不再把 4 个桶跨模块合并，改为 `bucketsBySlot: Map<slot, AgentAxisOverlays>`（存各模块 hook 的原始返回值，key = `member.slot`）。
   `scalarBySlot` 的合并保持原样（它本来就按槽位，已经是安全的）。
2. **新增模块能力 `directRowBonus`**（挂在 `AgentMechanic` 上，与 `axisWindowOverlays` 同族），由行所属角色的模块把**自己的** overlay 换算成行级加成：
   ```ts
   export interface DirectRowBonusInput {
     exec: SkillExecution          // 当前行（读 moveId；佩洛读 peiluoKagerouPairRatio）
     isAxis: boolean
     stunOverride: number          // 本段是否轴内（>0 = 敌人失衡），可琳的段级门控用
     buckets: AgentAxisOverlays | undefined   // = bucketsBySlot.get(本行 slot)，即本槽模块 hook 的原始返回
     scalar: AxisScalarOverlays | undefined   // = scalarBySlot.get(本行 slot)（与原 overlayScalar 同一个值）
   }
   export interface DirectRowBonus {
     dmgBonus?: number
     critDmgBonus?: number
     sheerDmgBonus?: number
     note?: string                 // 已拼好的片段，含前导「 · 」，顺序与原模板一致
   }
   directRowBonus?(input: DirectRowBonusInput): DirectRowBonus | null
   ```
   消费端写法：`const rb = getAgentMechanic(charResult.agentId)?.directRowBonus?.({ exec, isAxis, stunOverride, buckets: bucketsBySlot.get(slot), scalar: overlayScalar }) ?? null`。
3. **悠真 `harumasaStunOnly` 留在原地**（行级字段、不属于 overlay、悠真没有 axisWindowOverlays），它的 note 片段放在 `rb.note` 之后。
4. `MINGWANG_BASE_PER_STACK` 的 import、以及 `'1551016'` 字面量，都随明王和佩洛的逻辑迁进各自模块。

## 4. 逐模块迁移表（逐字搬，别改算式）

| 模块 | directRowBonus 返回 | note |
|---|---|---|
| banyue.ts | 轴模式：`stacks = buckets?.banyueMingwangStacks?.get(moveId) ?? 0`，`stacks > 0` 时 `dmg = stacks * MINGWANG_BASE_PER_STACK`；非轴：`dmg = scalar?.banyueMingwangPct ?? 0`。返回 `{ dmgBonus: dmg }` | `dmg > 0` 时为 `` ` · 明王+${dmg.toFixed(1)}%${isAxis ? '（轴内覆盖）' : '（覆盖率近似）'}` `` |
| corin.ts | 轴模式：`stunOverride > 0 ? (buckets?.corinStunBonusMap?.get(moveId) ?? 0) : 0`；非轴：`scalar?.corinStunBonusPct ?? 0` | `` ` · 失衡增伤+${v.toFixed(1)}%${isAxis ? '（buff轴）' : '（覆盖率近似）'}` `` |
| sigrid.ts | `scalar?.sigridInfectionPct ?? 0`（与轴模式无关） | `` ` · 浸染增伤+${v.toFixed(1)}%（风化覆盖率×15%）` `` |
| yixuan.ts | `ns = scalar?.yixuanNingshen ?? (isAxis ? buckets?.yixuanNingshenMap?.get(moveId) : undefined) ?? { critDmg: 0, sheerDmg: 0 }`，返回 `{ critDmgBonus: ns.critDmg, sheerDmgBonus: ns.sheerDmg }` | 暴伤片段 `` ` · 凝神暴伤+${ns.critDmg.toFixed(0)}%${isAxis ? '（buff轴）' : '（覆盖率近似）'}` ``（critDmg > 0）+ 贯穿片段 `` ` · 凝神贯穿+${ns.sheerDmg.toFixed(0)}%` ``（sheerDmg > 0），**先暴伤后贯穿** |
| specPanelBuffs.ts（`peiluoProminenceMechanic`） | `pair = exec.moveId === '1551016' ? (exec.peiluoKagerouPairRatio ?? 0) : 1`；`crit = isAxis ? (buckets?.peiluoKagerouMap?.get(moveId) ?? 0) : (scalar?.peiluoKagerouPct ?? 0) * pair`，返回 `{ critDmgBonus: crit }` | 无 |

`moveId` 一律写成 `exec.moveId ?? ''`（与原式一致）。

## 5. 零差论证（为什么除 §2 的修复外逐位不变）

- **每一行只有一个模块会被调用**（行所属角色的模块），读的是本槽的桶和标量。原式里别的角色的项对这一行本来就是 0：
  - 标量只在所属槽位存在；
  - 桶的 moveId 除 §2 的 `basic_attack` 外互不相交（角色招式 id 以 agentId 开头）。
- **浮点加法**：原式 `(((e + m) + c) + s) + h`，其中 m / c / s 对同一行至多一个非零，h 只在悠真行非零（此时 m / c / s 为 0）。新式 `(e + b) + h`，b 就是那一个非零项；`x + 0 === x` 严格成立，结果逐位相等。
  critDmg 的原式 `(c0 + y) + p` 同理，y 和 p 不会同时非零。
- **note**：原模板里 明王 / 可琳 / 悠真 / 希格莉德 / 仪玄 这几段对同一行至多一段非空（仪玄的两段属于同一个模块，模块内保持先暴伤后贯穿）。所以 `base + extra + rb.note + 悠真片段` 与原串逐字相同。
- **唯一的差异**：§2 的泄漏行（队友轴内 basic_attack 不再 +35%，note 不再带「失衡增伤…（buff轴）」）。语料不含 1061，所以 dump / rowsnap 必须 **DIFF 0（除 `__ms`）**；若出现任何差异，说明论证有漏洞，**停下排查，不要硬合**。

## 6. 测试与验收

- 更新引用旧 ctx 字段或 collect 返回形状的测试：`damagePoolNightA.test.ts`、`damagePoolBatchR16b.test.ts`、`teamHookMigration.test.ts`（grep `banyueMingwangStacks|yixuanNingshenMap|peiluoKagerouMap|corinStunBonusMap|collectAxisWindowOverlays`）。
  只测模块 hook（`xxxMechanic.axisWindowOverlays!(...)`）返回值的断言**不用改**，因为 `AgentAxisOverlays` 的形状不变。
- **新增泄漏锁**（放进 `src/mechanics/__tests__/corin.test.ts` 的「可琳额外能力 buff 轴」describe）：用 §2 的场景断言
  - (a) slot 0 可琳的轴内 basic_attack 行 note 含「失衡增伤+35.0%（buff轴）」（正对照）；
  - (b) slot 1 队友的**所有** basic_attack 行 note **都不含**「失衡增伤」。
  （b 在旧代码上必须是红的：实现前先在旧代码上跑一次，确认它确实红，再做实现。）
- 各模块的 `directRowBonus` 单测至少各一条：轴 / 非轴两臂、note 片段逐字断言。
- 判据 22 以实测为准，下调两处常量（`scripts/lib/core-role-field-ratchet.mjs` 的 BASELINE、`scripts/check-guards.mjs` 的 frozen）；低于 target 700 时同步重设 target。
  预计能消掉 banyueMingwangStacks 10、yixuanNingshenMap 10、corinStunBonusMap 10、corinStunBonus 6、yixuanNingshen 8 这几处中的大部分。
- `vue-tsc -b` 为 0；定向测试：`src/composables/__tests__/damagePool* src/mechanics/__tests__/{corin,banyue,yixuan,sigrid,teamHookMigration}* src/scripts/__tests__/checkGuards.test.ts`。
- lead 负责：零差比对（对 H2a，dump 和 rowsnap 都带 `PERF_KEY_ALIAS=1`）和反向验证（仪玄 `critDmgBonus` 临时 ×0，DIFF 须全在含 1371 的场景）。master 全量 verify 钉 HEAD。

## 7. 回退点

- 单卡单提交，`git revert <sha>` 即可整体回退，泄漏会一并回来。
- 如果只想回退泄漏修复、保留结构：在 `corin.ts#directRowBonus` 里让轴模式对非本槽也生效，但新结构下拿不到别的槽，所以**实际上没法只回退修复**。如果游戏口径日后证明扫除帮手确实惠及全队，应改为在可琳模块的 `teamBuffs` 里声明，而不是恢复全局桶。

## 8. 实现记录

（实现后填写：提交号、判据读数、零差 / 反向结果、偏离设计之处。）
