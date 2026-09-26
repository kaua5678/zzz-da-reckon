# CC-18 设计稿：角色专属附加直伤行迁模块能力 `extraDirectRows`

> 2026-09-26 第 24 轮 lead-arena-0925c 起草。状态：**CC-18a 定稿，待实现**（实现记录见 §8）。CC-18b / 18c 只立项，不在本稿实现。
> 上游：`docs/mcp-r22d1-batch12-field-census.md` §5.9（候选卡）。判据 22：HEAD `534c635` 读数 661，target 649。

## 1. 现状（HEAD `534c635` 实读）

`src/composables/resourceCalc/damagePoolCharExtras.ts#emitCharExtraRows`（241 行）逐角色调用，按顺序有 5 块「角色专属附加直伤行」，全部经 `env.pushDirect(row: DirectRowInput)` 写入共享 `rows`：

| # | 块 | 触发判据 | 依赖的外部量 |
|---|---|---|---|
| 1 | 柏妮思（1171）余烬 / 搅拌式 / 灼热抛接法 / C6 特殊余烬（约 :37–118） | `charResult.burniceMechanicSource` 存在（唯一写入方是 burnice.ts） | 本槽面板的 `skillLevelBonus`（经 `getSkillLevelCoef` 得出 `burniceSkillCoef`）；`axisStunFor('burnice-c6-special-ember')` |
| 2 | 琉音（1481）额外能力·重击附加（约 :120–150） | `liuyinSrc.extraAbilityActive && exHeavyCount > 0` | 前一位队友的面板和 catalog 特性（`configStore` / `catalogStore`） |
| 3 | 半月（1471）C6 摧岳附伤（约 :150–176） | 本角色某行带 `banyueC6CrushAttach`（唯一写入方是 `banyue.ts:734`） | 本槽面板（`calcPenetrationPower(panel!)`）；`axisStunFor('banyue_c6_crush_attach')` |
| 4 | 琉音非轴强特拆分（约 :178–215） | `liuyinSrc && !isAxis` | `stunPoolResult.stunCount`、`LIUYIN_EX_MOVE_IDS` |
| 5 | 琉音影画6余音（约 :217–241） | `liuyinSrc.cinemaLevel >= 6` | `liuyinPromoteCount`、机制滑块 `liuyin.c6EchoMax`、`ultimateInAxisFraction()` |

另有一处**不在本文件**：`damagePoolAnomaly.ts:293–340` 的柏妮思 C6 灼烧爆发（用 `findSlotByIdentity(..., ['1171'])` 定位，读 `burniceSrc.cinema6BurnBurst*`），属于异常侧。

判据 22 计数（`node /home/kaua/calc-arch/rf3.mjs`）：burniceSrc 36（charExtras 约 28 + anomaly 约 8）、burniceSkillCoef 7，另有 banyue* 若干。

## 2. 决定

1. **新增模块能力 `extraDirectRows`**（挂在 `AgentMechanic` 上）：由行所属角色的模块生成自己的附加直伤行，返回数组，由消费端按返回顺序逐个 `pushDirect`。
   ```ts
   // mechanics/types.ts（`import type { DirectRowInput } from '@/composables/resourceCalc/damagePoolDirect'`——判据 19 豁免 import type；types.ts 已有同类 import）
   export interface ExtraDirectRowsInput {
     charResult: CharacterResourceResult
     slot: number
     panel: PanelValues | undefined              // = panelAt(damagePanels, slot)
     isAxis: boolean
     axisStunFor: (moveId: string) => number
   }
   extraDirectRows?(input: ExtraDirectRowsInput): DirectRowInput[]
   ```
2. **分三期**：
   - **CC-18a（本稿实现）**：块 1（柏妮思直伤）+ 块 3（半月 C6 摧岳附伤）。两者只依赖本槽面板和 `axisStunFor`，输入面最小。
   - **CC-18b（立项）**：琉音块 2 / 4 / 5。需要扩展输入：前一位队友的面板与特性、`stunPoolResult`、`liuyinPromoteCount`、机制滑块、`ultimateInAxisFraction`。动手前先读 `docs/mcp-liuyin-promote-source*.md`（转大次数口径，W26 blocked 的原因），`liuyinPromoteCount` **原样透传，不要改来源**。
   - **CC-18c（立项）**：柏妮思异常侧 C6 灼烧爆发。需要另一个能力（异常侧行），或让 `extraDirectRows` 的兄弟能力 `extraAnomalyRows` 接手，届时单独设计。
3. **调用点**：在 `emitCharExtraRows` 原块 1 的位置放**一次**调用：
   ```ts
   const extra = getAgentMechanic(charResult.agentId)?.extraDirectRows?.({ charResult, slot, panel: panelAt(damagePanels, slot), isAxis, axisStunFor })
   if (extra) for (const row of extra) pushDirect(row)
   ```
   块 3 原来位于块 2 之后，迁走后改由这次调用产出。**顺序论证**：块 1、2、3 按角色互斥（柏妮思、琉音、半月），同一个角色只会命中其中一块；所以对任意角色，它自己的行的相对顺序不变，`rows` 的全局顺序也不变（角色是逐个处理的）。
4. **逐字迁移**：id、name、element、source、count、multiplier、note 模板（含 `toFixed(4)` 的技能等级系数片段）、critRateBonus、resIgnore、moveId、stunOverride、skillDamageTarget、basisValueOverride / basisLabelOverride，**每个字段、每个字段的出现顺序都照抄**（对象键顺序可能进 rowsnap 哈希）。
   - 柏妮思：`burniceSkillCoef` 的 IIFE 改为读 `input.panel?.skillLevelBonus ?? 0`（原式就是 `panelAt(damagePanels, slot)?.skillLevelBonus ?? 0`，等价）。
   - 半月：原式 `panelAt(damagePanels, slot)!`（非空断言），迁移后写 `calcPenetrationPower(input.panel!)`，保持「缺面板就抛错」的原语义。
   - 原块头部的注释（2026-09-15 编排层棘轮说明等）随代码搬进模块。
   - 模块需要的 `getSkillLevelCoef`（`@/core/skillLevel`）、`calcPenetrationPower`（`@/core/damage`）从 core 导入，合规（mechanics 可以依赖 core）。
5. `emitCharExtraRows` 迁移后如果 `panelAt` / `getSkillLevelCoef` / `calcPenetrationPower` 不再使用，删掉对应 import（`calcPenetrationPower` 块 2 仍在用，要保留）。

## 3. 零差论证

- 行内容逐字相同，顺序按 §2-3 论证不变，所以 dump / rowsnap **必须 DIFF 0（除 `__ms`）**。
- 语料覆盖：柏妮思在 `auto-1561-1171-1411/*`（6 个场景）；半月在 `banyue-trigger-lucia/*`（含 c6 变体，C6 摧岳附伤只在 c6 出现）。

## 4. 反向验证（lead 做）

- 柏妮思余烬 `multiplier` 临时 ×0 → DIFF 应只落在 `auto-1561-1171-1411/*`；
- 半月摧岳附伤 `count` 临时 ×0 → DIFF 应只落在 `banyue-trigger-lucia/c6`（以及其他 1471 做 0 号位的 c6 场景，如有）。
  如果 banyue 的反向没有差异，说明 c6 场景没走到这一行，需要改用单测锁（`banyue.test.ts` 里搜 `crush`）。

## 5. 测试与验收

- 模块单测：`burnice.test.ts`（或同名 smoke 测试）加 `extraDirectRows` 用例，断言 4 种行在给定 `burniceMechanicSource` 下的 id / count / multiplier / note 逐字；`skillLevelBonus > 0` 时 note 带「技能等级系数×」。半月加一条 C6 摧岳附伤用例。
- 判据 22 以实测为准，两处常量同步下调；低于 649 时 target 改为「实测值 − 12」。
- `vue-tsc -b` 为 0；定向测试：`src/composables/__tests__/damagePool* src/mechanics/__tests__/burnice* src/mechanics/__tests__/banyue* src/scripts/__tests__/checkGuards.test.ts`。
- master 全量 verify，钉 HEAD。

## 6. 回退点

单卡单提交，`git revert <sha>`。能力是可选的；删掉模块实现、恢复 charExtras 原块即可回到旧行为。

## 7. 后续（CC-18b / 18c 的开工清单）

- 18b：扩展 `ExtraDirectRowsInput`（给出前一位队友面板与 agent、`stunCount`、`liuyinPromoteCount`、`getMechanicSetting`、`ultimateInAxisFraction`），琉音 3 块迁进 `liuyin.ts`。`damagePoolCharExtras.ts` 迁完后只剩循环外壳，可以考虑整个删掉，把调用并进 `damagePool.ts`。
- 18c：异常侧先读 `damagePoolAnomaly.ts:280–345` 全段，看 `fireProg` / `entry` 的来源，再定接口。

### 7.1 CC-18b 定稿（2026-09-26 第 25 轮 lead-arena-0925c）

- **口径安全**：已读 `docs/mcp-liuyin-promote-source.md`。W26 被回退，是因为滞后注入改变了外层收敛的暂态读数路径。本卡**只搬运**，`promoteCount` 就是原 `ctx.liuyinPromoteCount`（来自 `useResourceCalc.ts:265` 的 `calcOutput.promote`）原样透传，读数路径不变，不涉及那条风险。
- **`liuyinSrc` 等价**：`damagePool.ts:424` 的 `const liuyinSrc = charResult.liuyinMechanicSource`，没有任何加工。模块内直接读 `charResult.liuyinMechanicSource`，等价。
- **接口扩展**：`ExtraDirectRowsInput` 新增 5 个字段，**一律必填**（唯一调用方每次都传全；18a 的 burnice / banyue 只解构自己需要的字段，不受影响）。字段名都不带角色前缀：
  ```ts
  /** 按槽位查队友：panel = panelAt(damagePanels, slot)；agent = slot >= 0 ? (team[slot]?.agentId ? agentsMap.get(team[slot].agentId) : null) : null（逐字复刻原块 2 的两行） */
  teammateAt: (slot: number) => { panel: PanelValues | undefined; agent: Agent | null | undefined }
  /** = stunPoolResult?.stunCount ?? 0 */
  stunCount: number
  /** = ctx.liuyinPromoteCount（答案层 promote，原样透传，勿改来源） */
  promoteCount: number
  /** = configStore.getMechanicSetting */
  getMechanicSetting: (key: string, dflt: number) => number
  /** = env.ultimateInAxisFraction */
  ultimateInAxisFraction: () => number
  ```
  `teammateAt` 在调用点写成闭包：`(s) => ({ panel: panelAt(damagePanels, s), agent: s >= 0 ? (configStore.team[s]?.agentId ? catalogStore.agentsMap.get(configStore.team[s].agentId) : null) : null })`。原块 2 对 `prevSlot = -1` 同样会调用 `panelAt`，保持这个行为，不加守卫。
- **迁移**：琉音块 2（重击附加）→ 块 4（非轴强特拆分）→ 块 5（影画6余音）按这个顺序写进 `liuyin.ts` 模块对象（约 :515，`agentIds: [LIUYIN_AGENT_ID]`）的 `extraDirectRows`，逐字保留（含 `'1481011'` 等字面量、note / source 模板、`isAxis ? ultimateInAxisFraction() : undefined`）。
  原块注释随代码迁移（块 2 关于 `calcPenetrationPower` 单一事实源的说明、块 5「轴模式同样生效」的说明）。
- **迁移后 charExtras**：只剩 `extraDirectRows` 的一次调用。`calcPenetrationPower`、`LIUYIN_*` 的 import 删除；`panelAt` 仍用于 `panel` 和 `teammateAt`，保留。文件保留不删（改名 / 并入 damagePool 另议，避免扩大 diff）。
- **顺序论证**：原块顺序是 块 2 →（块 3 半月，18a 已迁走）→ 块 4 → 块 5，全部属于琉音；迁移后琉音 `extraDirectRows` 内部顺序为 2 → 4 → 5，调用点在原块 1 的位置，在琉音的所有行之前，琉音本来就没有其他行夹在中间，所以 `rows` 顺序不变。
- **零差 / 反向**：琉音（1481）在语料里（dump 键中含 1481 的场景）。反向验证：块 2 的 `multiplier: ratio` ×0（应落在额外能力生效的琉音场景）；块 5 的 `count: echoCount` ×0（只影响 cinema≥6，应落在含 1481 的 c6 场景；如果 1481 从不在 0 号位，c6 变体不会切换到琉音的命座，此时预期**无差**，改用单测锁住）。

## 8. 实现记录

- **CC-18a 已落地 `23470f2`**（2026-09-26 第 24 轮）：dsflash 工人在 worktree 实现（`6e0de26`），lead 复核后 `cherry-pick -n` 挑回并重写提交信息。8 个文件。
- 判据 22：661 → **623**（-38）。target 按规则重设为 **611**（实测 −12）。
- 零差：dump 625 / rowsnap 638 个键，对 H2a **只有 `__ms` 不同**。
- 反向（§4，两处都生效）：
  - 柏妮思余烬 `multiplier` ×0 → DIFF 6，正好是 `auto-1561-1171-1411/{default,c0,c6,w,heavy,heavyGate}`；
  - 半月摧岳附伤 `count` ×0 → DIFF 6，全部是 1471 的 c6 场景（banyue-{trigger,jufufu,roxy,liuyin,qingyi}-lucia/c6、auto-1471-1571-1451/c6）。
  两处都 cp 还原，cmp 一致。
- 定向测试 298 条通过；`vue-tsc -b` 为 0；master 全量 `npm run verify` EXIT=0（290 个测试文件），HEAD `23470f2`。
- 偏离：无实质偏离。`damagePoolCharExtras` 从 `@/mechanics` import `getAgentMechanic`；`panelAt` 仍被块 2 使用，保留。
- **CC-18b / 18c 未做**，开工清单见 §7 和 census §5.10。
