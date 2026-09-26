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

## 8. 实现记录

（实现后填写。）
