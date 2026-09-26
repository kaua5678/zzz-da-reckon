# CC-19 设计稿：异常侧角色块迁模块能力 `extraAnomalyRows`

> lead-arena-0925c 第 26 轮（2026-09-26），HEAD `97ed5e2` 实读。CC-18c（柏妮思异常侧）并入本卡，记为 **19a**。
> 前序：CC-18 `docs/mcp-cc18-extra-direct-rows.md`（按槽附加**直伤**行 `extraDirectRows`）。

## 1. 现状（实读 `src/composables/resourceCalc/damagePoolAnomaly.ts`，661 行）

`emitAnomalyRows(env)` 在尾部有 6 个**队伍级**角色块。每块先用 `findSlotByIdentity(configStore, catalogStore, ['<id>'])` 找槽，再往共享 `rows` 里 `rows.push({...DamagePoolRow})`，块与块之间按下表顺序：

| # | 行号 | 角色 / 块 | 行 id | 读的外部量 |
|---|---|---|---|---|
| 1 | :292–341 | 1171 柏妮思 C6 灼烧迸发 | `burnice-c6-burn-burst-${entry.slot}` | burniceMechanicSource、fire 进度、windRate、虚拟面板 + 结算分摊、axisStunFor、enemy、`remielleAnomalyMultiplier` |
| 2 | :343–391 | 1401 极性强击（爱丽丝面板） | `polar-assault-damage` | physical_polar_assault 进度、aliceSwordWillSource、ultimateInAxisFraction(slot) |
| 3 | :393–~440 | 1261 简 C6 | （19b 实读） | physical 进度、assaultCritRate、inWindowFraction、stunCoverage |
| 4 | :442–~510 | 1401 爱丽丝 C6 | （19b 实读） | aliceSwordWillSource、ultimateInAxisFraction(slot) |
| 5 | :512–~528 | 爱丽丝畏缩 DoT | （19b 实读） | `anomalyPoolResult.aliceCoweringDot` |
| 6 | :530–661 | 1581 蕾米埃尔 | （19c 实读） | remielleEntryPanels 等 |

要点：
- **行的归属槽不一定是角色自己的槽**：块 1 的行按 `buildAnomalySettlementEntries` 的 `entry.slot`（异常积蓄贡献者）归属。
- **爱丽丝占 3 块（2、4、5），与简（3）交错。**
- `rowsnap`（`.zc/perf/rowsnap.perf.ts`）对 `damagePoolRows` **按数组顺序**求 sha256，所以行顺序会影响零差判定。rowsnap 对含 1171 / 1261 / 1401 / 1581 的预设还多跑一个 `/axis` 变体。
- `findSlotByIdentity` 匹配 `a.id === id || a.teammateBuffId === id`。实测 `public/static/catalog.json` 共 62 个角色，**没有**一个的 `teammateBuffId` 和 `id` 不同。所以「逐槽按 agentId 调 `getAgentMechanic`」与「按身份找第一个槽」找到的是同一个槽（队伍里不会有重复角色）。

## 2. 决定

### 2.1 能力形状（分组 + 顺序键）

`AgentMechanicModule` 新增可选能力：

```ts
/** 异常尾段附加行（CC-19，设计稿 docs/mcp-cc19-extra-anomaly-rows.md）。返回分组，派发方跨全队按 order 稳定排序后 push。 */
extraAnomalyRows?(input: ExtraAnomalyRowsInput): ExtraAnomalyRowGroup[]

export interface ExtraAnomalyRowGroup {
  /** 取 EXTRA_ANOMALY_ROW_ORDER 的值；决定跨角色的行顺序（= 原 damagePoolAnomaly 块序） */
  order: number
  rows: DamagePoolRow[]
}

/** 原 damagePoolAnomaly.ts 尾段块序（rowsnap 按行顺序求哈希，禁止改值） */
export const EXTRA_ANOMALY_ROW_ORDER = {
  burnBurstC6: 10,     // 块 1（19a）
  polarAssault: 20,    // 块 2（19b）
  assaultCritC6: 30,   // 块 3（19b）
  decisiveC6: 40,      // 块 4（19b）
  coweringDot: 50,     // 块 5（19b）
  voidflare: 60,       // 块 6（19c）
} as const
```

**为什么用分组 + 顺序键，而不是逐槽直接 push**：逐槽派发时，行顺序会跟着队伍排列变化，而爱丽丝的 3 块和简交错，逐槽 push 无法复现原顺序，rowsnap 会报差，零差验收就失效了。分组 + 稳定排序可以对任意队伍排列逐位复现原顺序。键名描述的是机制，不带角色前缀，也不进 core。

**否决方案**：
- ① 每块各留一个「只派发给某角色」的调用点：等于把角色判定搬个地方，没有收益；
- ② 接受顺序变化，并把 rowsnap 改成对顺序不敏感：失去零差这张安全网，UI 里的行序也会变。

### 2.2 输入面（19a 所需；19b / 19c 追加字段时在本文 §7 定稿）

```ts
export interface ExtraAnomalyRowsInput {
  /** 本槽槽位号（派发循环的 slot） */
  slot: number
  /** = adjustedResourceResult?.characters.find(c => c.slot === slot)（原块 1 同式） */
  charResult: CharacterResourceResult | undefined
  /** = anomalyPoolResult?.coverage?.windCoverageRate ?? 0（尾段已有局部量 windRate） */
  windRate: number
  /** = (el) => anomalyPoolResult?.perElement.find(prog => prog.element === el) */
  anomalyProgress: (element: string) => <perElement 元素类型> | undefined
  /** = (prog) => buildAnomalyVirtualPanel(prog, damagePanels, configStore, catalogStore) */
  buildVirtualPanel: (...)
  /** = (build, count) => buildAnomalySettlementEntries(build, damagePanels, count, configStore, catalogStore) */
  buildSettlementEntries: (...)
  axisStunFor: (moveId: string) => number
  /** = configStore.enemy（只读，块内用 defense / level / stunVuln） */
  enemy: { defense: number; level: number; stunVuln: number }
  enemyDamageRes: Record<string, number>
  /** = ctx.remielleAnomalyMultiplier（全队异常伤害乘区；通用名） */
  anomalyMultiplier: number
  /** = (s) => configStore.team[s]?.agentId ?? '' */
  teamAgentId: (slot: number) => string
  /** = env.agentName */
  agentName: (agentId: string, slot: number) => string
}
```

- `buildVirtualPanel` 和 `buildSettlementEntries` 的类型用 `import type { buildAnomalyVirtualPanel, buildAnomalySettlementEntries } from '@/composables/resourceCalc/anomalyPanels'`，配合 `ReturnType<typeof …>` / `Parameters<typeof …>` 推导，**不要**手写结构体。`DamagePoolRow` 从 `./helpers` 用 `import type`，先例是 types.ts:23 的 `DirectRowInput`。
- 以闭包注入，是为了让 mechanics 不按值 import `composables/resourceCalc`（mechanics → composables 只允许 type 引用）。
- `calcAnomalyDamage` 由模块直接 `import { calcAnomalyDamage } from '@/core/damage'`（先例：liuyin.ts 引 `calcPenetrationPower`）。

### 2.3 派发点（放在原块 1 的位置，只放一次）

```ts
// 角色专属异常附加行（CC-19，设计稿 docs/mcp-cc19-extra-anomaly-rows.md §2）
const extraGroups: ExtraAnomalyRowGroup[] = []
configStore.team.forEach((char, slot) => {
  const groups = char?.agentId ? getAgentMechanic(char.agentId)?.extraAnomalyRows?.({ ...逐字段按 §2.2 注释 }) : undefined
  if (groups) extraGroups.push(...groups)
})
extraGroups.sort((a, b) => a.order - b.order) // Array.prototype.sort 稳定（ES2019）
for (const g of extraGroups) rows.push(...g.rows)
```

19b 迁块 2–5 时，派发点**不移动**。块 2–5 迁走后，派发点后面紧跟的就是块 6（仍内联，直到 19c），所以已迁的块始终构成连续前缀，顺序不变。

## 3. 零差论证（19a）

- 目前只有柏妮思实现这个能力，所以 `extraGroups` 最多一组（order 10）。柏妮思的槽与原 `burniceSlot` 相同（§1 末条），因此 push 的时机、内容、顺序都和原块 1 一致。
- 块 1 逐字搬进 `burnice.ts`（在 18a 的 `extraDirectRows` 同一个模块对象上），替换规则如下：
  - `burniceSrc` → `input.charResult?.burniceMechanicSource`（原式是 `burniceSlot >= 0 ? … : undefined`，派发循环里 slot 必然 ≥ 0，等价）；
  - `fireProg` → `input.anomalyProgress('fire')`；
  - `configStore.enemy.X` → `input.enemy.X`；
  - `remielleAnomalyMultiplier` → `input.anomalyMultiplier`；
  - `configStore.team[entry.slot]?.agentId ?? ''` → `input.teamAgentId(entry.slot)`；
  - 其余同名。
- `fireProg` 只在块 1 使用（`grep -n fireProg` 实测只有 :297–:301），删除后不影响后续块。

## 4. 反向验证（lead 做）

- **dump / rowsnap**：把 `burnice.ts` 里 `baseMultiplier: burniceSrc.cinema6BurnBurstDamageRatio` 改成 ×0。只有队里柏妮思达到 C6，这一行才会生效。语料里柏妮思只出现在 `auto-1561-1171-1411/*`，且在 1 号位，c6 变体只切换 0 号位。因此**预期 dump 很可能无差**。
- 若无差，就用**单测反向**：同一突变下，burnice 单测里新增的 19a 用例必须变红。本卡强制要求工人补这条单测（参照 CC-18b 余音的做法）。
- **顺序反向（单测）**：派发点的排序逻辑用 damagePool 层单测锁住：构造两个模块返回 order 20 / 10 的分组，断言 push 顺序是 10 在前。若构造困难，就改成对「排序 + 展开」小函数做纯函数测试：把它抽成 `flattenAnomalyRowGroups(groups)` 放在 damagePoolAnomaly.ts 并导出。

## 5. 测试与验收

- `burnice.test.ts`：extraAnomalyRows 用例 3 条：
  - 无 C6（`cinema6BurnBurstCount = 0`）时返回 `[]`；
  - C6 且 fire 进度 > 0 时，行的 id / count / note 逐字匹配（`buildVirtualPanel` / `buildSettlementEntries` 用桩函数返回 1–2 个条目）；
  - `windRate = 1` 时返回 `[]`。
- `flattenAnomalyRowGroups` 纯函数：稳定排序用例。
- 判据 22 预计下降约 10（burniceSlot / burniceSrc / burniceMechanicSource / remielleAnomalyMultiplier 在该块内的引用）。
- `vue-tsc -b` 为 0；master 上 `npm run verify` EXIT=0；零差 dump 625 / rowsnap 638 个键，只有 `__ms` 不同。

## 6. 回退点

`git revert <19a 提交>` 即可整体撤销：能力是可选的，删掉派发点、恢复内联块就行。`EXTRA_ANOMALY_ROW_ORDER` 只是常量，留着也无害。

## 7. 后续（19b / 19c）

- **19b**（块 2–5，爱丽丝 3 块 + 简）：开工前先实读块 3–5 的全文，把行 id 补进 §1 表。追加输入字段要写进本节，候选有：`ultimateInAxisFraction(slot)`、`inWindowFraction(el)`、`stunCoverage`、`panel`（= panelAt(damagePanels, slot)）、`cinemaLevel`、`anomalyPool`（畏缩 DoT，考虑只传 `coweringDot` 的通用名形态）、`isAxis`。
  - 爱丽丝模块返回 3 组，order 分别为 20 / 40 / 50；简返回 30。
  - 注意块 2 的槽也是 `findSlotByIdentity(['1401'])`，而且块 2 **不看命座**。
- **19c**（块 6 蕾米埃尔）：字段最多（带 entryPanels），另开设计。
- 执行方式同 18a / 18b：lead 定稿 → dsflash 工人在 worktree 里实现 → lead 做零差、反向验证、挑回。

### 7.1 CC-19b 定稿（2026-09-26 第 26 轮 lead 实读 HEAD `b14fb4a`）

19a 合入后行号：极性强击 :329–375（`polarAssaultProg` 声明在 :329，块外）、简 C6 :377–423（`jane-c6-assault-followup`）、爱丽丝 C6 :425–494（`alice-c6-decisive-extra-attack`）、畏缩 DoT :496–512（`alice-cowering-dot`）、蕾米埃尔 :514 起（19c）。

**`ExtraAnomalyRowsInput` 追加字段（一律必填，调用点每次都传全；burnice 只解构自己需要的字段，不受影响）**：

```ts
/** = panelAt(damagePanels, slot) */
panel: PanelValues | undefined
/** = configStore.team[slot]?.cinemaLevel ?? 0 */
cinemaLevel: number
isAxis: boolean
/** = ctx.stunCoverage */
stunCoverage: number
/** = env.inWindowFraction */
inWindowFraction: (element: string) => number
/** = env.ultimateInAxisFraction（模块调用时传 input.slot） */
ultimateInAxisFraction: (slot?: number) => number
/** = (key) => allocMap[key]?.inAxisUnits ?? 0（allocMap = ctx.axisAllocation；爱丽丝 C6 读 `${slot}:1401012`） */
axisInUnits: (key: string) => number
/** = (k, d) => configStore.getMechanicSetting(k, d) */
getMechanicSetting: (key: string, dflt: number) => number
/** = ctx.anomalyPoolResult（只读整体注入，模块内读 .aliceCoweringDot；避免在 core 侧出现角色前缀字段） */
anomalyPool: <anomalyPoolResult 的类型>
```

**分组**：爱丽丝模块（1401）返回最多 3 组：order 20（极性强击，**不看命座**，条件是 prog.triggerCount > 0 且 panel 存在）、40（C6，`cinemaLevel >= 6 && panel`）、50（畏缩 DoT，条件是 `coweringDot && totalDotDamage > 0`，原式的 `aliceSlot >= 0` 恒真）。简模块（1261）返回 order 30（`cinemaLevel >= 6 && panel`）。空行组可以返回，也可以不返回，两者等价。

**替换规则**：
- `polarAlicePanel` / `janePanel` / `alicePanel` → `input.panel`；
- `xxxSlot` → `input.slot`；
- `configStore.team[xxxSlot]?.cinemaLevel ?? 0` → `input.cinemaLevel`；
- `configStore.enemy` → `input.enemy`；
- `allocMap[...]?.inAxisUnits ?? 0` → `input.axisInUnits(...)`（key 模板逐字）；
- `adjustedResourceResult?.characters.find(c => c.slot === aliceSlot)` → `input.charResult`；
- `anomalyPoolResult?.aliceCoweringDot` → `input.anomalyPool?.aliceCoweringDot`；
- `remielleAnomalyMultiplier` → `input.anomalyMultiplier`；
- `calcDirectDamage` / `calcAnomalyDamage` 从 `@/core/damage` import，`fmt` 从 `@/utils/format` import，`ANOMALY_SINGLE_HIT_MULTIPLIER` 从 `@/core/anomalyPool/helpers` import。
- **注意**：`polarAssaultProg` 声明在块外（:329）。工人先 `grep -n polarAssaultProg` 确认只在块 2 使用，再随块迁走。若别处也用，保留声明，并报告。

**零差 / 反向**：
- rowsnap 对含 1261 / 1401 的预设有 `/axis` 变体。
- 反向验证点：爱丽丝 C6 `skillMultiplier: 3300` ×0、简 `skillMultiplier: 1600` ×0、畏缩 `count` ×0。
- 若语料里爱丽丝 / 简不在 0 号位，C6 两块在 dump 里多半无差，同样用单测反向（参照 19a）。畏缩和极性强击不看命座，应在含 1401 的场景出现 DIFF。
- **顺序反向**：把爱丽丝极性强击的 order 临时改成 35，rowsnap 在「同队含 1261 + 1401」的场景应出现 DIFF（证明排序生效）。若语料里没有同队的场景，就只看单测。

### 7.2 CC-19c 定稿（2026-09-26 第 27 轮 lead 实读 HEAD `3fbb326`）

块 6（蕾米埃尔耀变 / 特殊虚耀）是 `damagePoolAnomaly.ts` 里最后一个内联角色块，位置搜 `const remielleSlot`，一直到函数末尾。

**障碍（实测）**：块 6 调用 `getRemielleLevelValue` / `remielleSpecialVoidflareCount` / `calcVoidflareDamage`（定义在 `composables/resourceCalc/anomalyPanels.ts` :375–450 附近）、`findMoveById`、`elementLabel`（`composables/resourceCalc/helpers.ts:205`）。**守卫判据 19 禁止 mechanics 按值 import `@/composables`**（`import type` 豁免）。另外，`calcVoidflareDamage` 依赖 `composables/resourceCalc/skillRows.ts:40–72` 的 `ELEMENT_DMG_KEYS` / `ELEMENT_DEF_REDUCTION_KEYS` / `ELEMENT_RES_REDUCTION_KEYS`。`findMoveById` 在非 composables 的 `src/data/moveTableQueries.ts:54` 有正本，mechanics 可以直接 import。

**决定：拆两步，放在同一个 worktree 里，分两个提交（任一步都可单独 revert）**

**19c-1 准备步（零行为）**：
1. 新建 `src/core/elementKeys.ts`，把 skillRows.ts 的 3 个 `ELEMENT_*_KEYS` 常量逐字搬过去。skillRows.ts 改成 `import { … } from '@/core/elementKeys'`，并 `export { … }` 转发，所有旧的 import 点不用改。
2. 把 `getRemielleLevelValue`、`remielleSpecialVoidflareCount`、`VoidflareDamageInput`（interface）、`calcVoidflareDamage` 逐字搬进**现有的** `src/mechanics/agents/remielle.ts`。不新建 agents 下的文件，理由是先查清 registry 有没有用 glob 自动加载 agents/*.ts；工人先 `grep -n "glob" src/mechanics/registry.ts src/mechanics/index.ts`，若没有 glob，新建文件也可以，但仍优先放进 remielle.ts。
   依赖只有 `@/core/skillLevel` 的 `getSkillLevelCoef`、`@/core/elementKeys`、`@/utils/format`、`@/types/catalog` 类型。
   anomalyPanels.ts 删掉这些定义，改成 `export { getRemielleLevelValue, remielleSpecialVoidflareCount, calcVoidflareDamage } from '@/mechanics/agents/remielle'` 和 `export type { VoidflareDamageInput } from …`。helpers.ts :271/:290、useResourceCalc.ts :86/:610、damagePoolAnomaly.ts 的 import 都不用改。注意 anomalyPanels.ts:29 已经从 remielle.ts import 了 `isRemielleAgent`，不会形成新环。
3. 这一步 rows 不变，dump / rowsnap 应当逐位零差。判据 22 会因为 anomalyPanels 里的 remielle* 字段减少而下降，按规则同步 frozen。

**19c-2 迁块步**：块 6 逐字迁入 `remielle.ts` 模块对象（:167 附近，`agentIds: [REMIELLE_AGENT_ID]`）的 `extraAnomalyRows`，order = `EXTRA_ANOMALY_ROW_ORDER.voidflare`（60）。`ExtraAnomalyRowsInput` 追加以下字段（必填，名字不带角色前缀）：

```ts
/** = panelAt(remielleEntryPanels, slot)（进场快照面板；ctx.remielleEntryPanels 原样） */
entryPanel: PanelValues | undefined
/** = catalogStore.agentSkillsByAgentMap.get(configStore.team[slot]?.agentId ?? '') */
skills: AgentSkills | undefined
/** = (s) => panelAt(damagePanels, s) */
panelOf: (slot: number) => PanelValues | undefined
/** = (s) => catalogStore.agentsMap.get(configStore.team[s]?.agentId ?? '')?.damageElement ?? 'physical' */
teamElement: (slot: number) => string
/** = (k, d) => configStore.getTeamMechanicSetting(k, d) */
getTeamMechanicSetting: (key: string, dflt: number) => number
/** = elementLabel（helpers.ts:205，闭包注入以绕开判据 19） */
elementLabel: (element: string) => string
```

**替换规则**：
- `remiellePanel` → `input.panel`；`remielleEntryPanel` → `input.entryPanel`；`remielleSkills` → `input.skills`；`remielleSlot` → `input.slot`（原式 `remielleSlot >= 0 ?` 在模块内恒真）；
- `anomalyPoolResult?.perSlotAnomalyTriggers ?? []` → `input.anomalyPool?.perSlotAnomalyTriggers ?? []`；
- `catalogStore.agentsMap.get(...)?.damageElement ?? 'physical'` → `input.teamElement(slot)`；
- `panelAt(damagePanels, slot)` → `input.panelOf(slot)`；
- `configStore.getTeamMechanicSetting` → `input.getTeamMechanicSetting`；
- `configStore.enemy` → `input.enemy`；`configStore.team[x]?.agentId ?? ''` → `input.teamAgentId(x)`；
- `findMoveById` 从 `@/data/moveTableQueries` import。工人先确认 skillRows.ts:38 转发的就是这个函数；若不是同一实现，就停下报告。
- 行对象字段、字段顺序、id / name / source / note 模板逐字不变；`[0, 1, 2]` 字面量不变。

**零差 / 反向**：
- 语料里含 1581 的预设有 `auto-1261-1561-1581`、`auto-1261-1331-1581`（蕾米埃尔在 2 号位），另有 `/axis` 变体。
- 反向验证点：耀变 `totalDamage: result.damage * count` ×0，应在这两组预设的全部变体出现 DIFF。
- 特殊虚耀需要 C1，而 c6 变体只切换 0 号位，dump 看不到，改用单测反向。
- 19c-2 完成后，`damagePoolAnomaly.ts` 里不再有内联角色块；派发点是异常尾段唯一的角色出口。

**预计**：判据 22 两步合计下降约 30–40（damagePoolAnomaly 里的 remielleSlot / remiellePanel / remielleEntryPanel，加上 anomalyPanels 里 3 个函数体内的 remielle* 面板字段）。useResourceCalc.ts:610 的 remielle 引用不在本卡范围内。

## 8. 实现记录

- **CC-19a 已落地 `b14fb4a`**（2026-09-26 第 26 轮 lead-arena-0925c）：设计稿 `c7f2068`。dsflash 工人在 worktree `r69-scratch/cc19a` 实现（`7be6233`），lead 逐行复核后 `cherry-pick -n` 挑回。7 个文件：types / burnice / damagePoolAnomaly / burnice.test / 新增 `src/composables/__tests__/damagePoolAnomalyGroups.test.ts` / 2 个棘轮常量。
- 判据 22：613 → **601**（-12）；低于 target 611，按规则**重设 target 589**。
- 零差：dump 625 / rowsnap 638 个键，只有 `__ms` 不同。
- 反向：灼烧迸发 `baseMultiplier` ×0 → rowsnap **无差**（语料无 1171 C6，与 §4 预判一致）。`burnice.test.ts` 红 2 条（模块逐字用例 + 真管线「派发点接线」集成用例），还原后绿。
- 全量：master `npm run verify` EXIT=0（291 个测试文件 / 3543 条测试，22 条守卫通过），HEAD `b14fb4a`。
- **CC-19b 已落地 `3fbb326`**（2026-09-26 第 27 轮 lead-arena-0925c）：dsflash 工人在 worktree `r69-scratch/cc19b` 实现（`d1dd95a`），lead 逐行复核后 `cherry-pick -n` 挑回。9 个文件：types / alice / jane / damagePoolAnomaly / alice、jane、burnice 测试 / 2 个棘轮常量。
  - 判据 22：601 → **545**（-56）；低于 target 589，**重设 target 533**。
  - 零差：dump 625 / rowsnap 638 个键，只有 `__ms` 不同。本次 `__ms` 从约 39s 涨到 53s，是后台多个 vitest 同时跑造成的负载波动；随后全量 verify 耗时 122s，属正常。
  - 反向（rowsnap，5 个突变，均 cp 还原并 cmp 一致）：
    - 爱丽丝 C6 `skillMultiplier: 3300` ×0 → DIFF 4，是 4 组「1401 在 0 号位」预设的 c6 变体；
    - 简 C6 `1600` ×0 → DIFF 4，是 4 组「1261 在 0 号位」预设的 c6 变体；
    - 畏缩 `count` ×0 → DIFF 28（4 组 1401 预设 × 7 个变体，含 `/axis`）；
    - **畏缩 order 50→15 → DIFF 28**：纯顺序变化，证明派发排序确实决定行序；
    - 极性强击 order 20→35 → 无差：同队的 `auto-1401-1261-1411` 里简在 1 号位、命座不到 6，没有 order 30 的行可以换位，预期内。
  - 全量：master `npm run verify` EXIT=0（291 个测试文件 / 3551 条测试，22 条守卫通过），HEAD `3fbb326`。
  - 偏离：块内用 `const aliceSlot = slot` / `alicePanel = panel` 等局部别名，以保持块体文本逐字不变（等价）；jane.ts 多了一个 `import type { DamagePoolRow }`。
- 19a 偏离（均合理）：`buildVirtualPanel` 定型为单参闭包 `(prog) => ReturnType<typeof buildAnomalyVirtualPanel>`；`buildSettlementEntries` 定型为 `(build, count)`，类型用 `Parameters` / `ReturnType` 推导。派发点用 `for (const r of flattenAnomalyRowGroups(extraGroups)) rows.push(r)`。
