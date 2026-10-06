# CC-36 设计稿与实施记录：维琳娜在 core / 编排层的残留去角色化

> lead-arena-0925c，2026-09-27 第 51 轮。上游：census §5.37 下一步 1。判据 22（`scripts/lib/core-role-field-ratchet.mjs`）开工时 63，维琳娜 29 计。

## 0. 普查结论（2026-09-27 实读）

- 风蚀状态机本身**早已能力化**：`core/anomalyPool.ts` 经 `resolveAnomalyCorrosion(input.agentMechanics, …)` 调模块能力 `anomalyCorrosion`（CC-6d），归属按 `panel.velinaEnabled` 认人（CC-D3）。
- 所以 29 计里绝大部分只是**名字**（局部变量、结果字段、配置字段、展示字符串）。真正的角色规则只剩两处：
  1. `core/anomalyPool/helpers.ts#calcTurbulenceSettlement`：`p.velinaCinema1 > 0 ? 20 : 0`（1 命乱流抗性无视 20%）。
  2. `resourceCalc/damagePoolAnomaly.ts`：读风槽面板 `velinaCinema6`，给风化事件加倍率（平均剩余时长 × 2.5%/s，上限 40%）。

## A. CC-36a：纯改名（23 计）

| 旧 | 新 | 范围 |
|---|---|---|
| `velinaCorrosionSource`（局部变量 + `AnomalyPoolResult` 结果字段） | `corrosionSource` | `core/anomalyPool.ts`、`types/resource/pools.ts`、`mechanics/agents/velina.ts`、`components/ResourceResultCard.vue`、`core/__tests__/anomalyPool.test.ts`、`composables/__tests__/ccD3D1Verdict.test.ts` |
| `velinaCinema2CorrosionRate`（异常池输入 / dmgConfig 字段） | `cinema2CorrosionRate` | `core/anomalyPool.ts`、`core/anomalyPool/helpers.ts`、`resourceCalc/roundInputs.ts`、`core/__tests__/anomalyPool.test.ts` |
| `velinaBroadFromCorrosionCount` / `velinaMicroCycloneCount`（局部量） | `broadFromCorrosionCount` / `microCycloneCount` | `core/anomalyPool.ts` |
| 事件 `fields` 展示串 `'velinaCorrosion…'` | `'corrosion…'` | `core/anomalyPool.ts`（3 处，dump / rows 实测不受影响） |

- **刻意不改**：
  - `stores/config.ts` 的同名 store 计算属性 `velinaCinema2CorrosionRate`（store API，不在判据 22 扫描范围）。
  - `velina.ts:152` 的 `panel.velinaCinema2CorrosionRate`（这是另一个面板字段，不是异常池配置）。
  - 类型名 `VelinaCorrosionSource`（大写开头，不命中判据正则）。
  - 设置 id `'velina.cinema2CorrosionRate'`（持久化键，不能改）。
- **踩坑（重要）**：`ccD3D1Verdict.test.ts` 用 `(x as any)?.velinaCorrosionSource` 读结果，**vue-tsc 拦不住**。改名后 `toBeUndefined()` 那条会变成永远通过的空断言，`toBeTruthy()` 那条会红。已同步改 43 / 44 / 57 行（26 行是修复前的实测记录，保留原样）。**以后改结果字段名，必须 `grep -rn '<旧名>' src` 查 `as any` 访问**，不能只信 tsc。
- 验证：vue-tsc 0；anomalyPool / velina / stateMachine 18 条 + ccD3D1Verdict 3 条通过；dump / rows 对 H2a 仅 `__ms` 差；判据 22 63 → 40，**target 51 达成 → 重设 28**；verify EXIT=0 3595。

## B. CC-36b：两处角色规则 → 通用面板字段 / 模块能力（6 计）

1. **1 命乱流抗性无视** → 通用面板字段 **`turbulenceResIgnore`**（%）。
   - 维琳娜 `applyVelinaPanel` 写入：1 命为 20，否则 0。
   - core 读 `p.turbulenceResIgnore ?? 0`。
   - `PanelValues` 有 `[key: string]: number` 索引签名，无需改类型。
   - 原标记 `velinaCinema1` 保留，模块内 `hasCinema1` 仍在用。
2. **6 命风化事件加成** → 新模块能力 **`windAnomalyBonus({ panel, triggerCount }) → { pct, note } | null`**。
   - 公式与说明文案逐字迁进 `velina.ts`。
   - `damagePoolAnomaly.ts` 按**风槽**的 agentId 派发：`getAgentMechanic(configStore.team[windSlot].agentId)?.windAnomalyBonus?.(…)`。
   - 等价性：原来读风槽面板的 `velinaCinema6`，风槽不是维琳娜时本来就没有加成。
- 验证：见 §D。

## C. 回退点
- 按 `git revert` CC-36b → CC-36a 的顺序（两者都改棘轮同一行）。

## D. 实施记录
- **CC-36a done `8af6ca2`**：数字见 §A。
- **CC-36b done `1ea574e`**：
  - vue-tsc 0；anomalyPool / velina / damagePool / ccD3D1Verdict 101 条通过；dump / rows 对 H2a 仅 `__ms` 差。
  - 反向变异（两处同改）：rowsnap 只有 `auto-1561-1171-1411/c6` 1 键出差——perf 语料里维琳娜 1 命只在 c6 档与 6 命同时生效，分不开，旧单测也没有红。
  - 因此在 `velina.test.ts` 末尾**补 3 条单测**：1 命写 `turbulenceResIgnore = 20`，6 命加成公式与文案逐字，null 分支。两处变异**单独**施加时各红 1 条，还原后 10/10。
  - 读侧（core 读 `turbulenceResIgnore`、编排层派发 `windAnomalyBonus`）由 rowsnap 的 c6 键覆盖。
  - 判据 22 40 → **34**，维琳娜在判据 22 中**清零**。verify 见 `/home/kaua/calc-arch/verify36b.log`。
- 脚本：`/home/kaua/calc-arch/z36a.sh`（含改名）、`cc36b.py`、`z36b.sh`、`t36b.py`、`z36bt.sh`。

## E. r711：双风队路由（CC-36b「风槽 = 维琳娜」前提失效）
- **缺陷**：CC-36b 把 6 命风化加成迁成模块能力 `windAnomalyBonus` 时，仍按「队里第一个风属性槽」派发，注释称「风槽非维琳娜时原本就无加成，派发与之等价」——只在队里至多一个风角色时成立。洛克茜 1621 / 赛维里安 1631 上线后，双风队里维琳娜排后 ⇒ 查到对方模块（无此能力）与对方面板（无 `velinaCinema6`）⇒ 加成整个丢失。同一函数（`damagePoolAnomaly.ts#emitAnomalyRows`）里维琳娜专属的气旋异放行（微域气旋风异放 / 风蚀替换广域气旋）也按该槽归属 ⇒ 挂到对方名下、用对方面板结算。CC-D3 只修了「队里没有维琳娜」一侧；两处都违反其裁决「风蚀是维琳娜专属资源，专属资源不给人」。
- **实测**（探针 `loadBuildRecommendations` + `applyTeamPreset`，维琳娜在槽 1，不入库）：

| 队 | 命 | 全队总伤 修前 → 修后 | 主要归因 |
|---|---|---|---|
| 1621-1561-1411 | 0 | 56,019,589 → 56,418,300（+0.7%） | 气旋两行改用维琳娜面板：119,156 → 331,314、104,775 → 291,328 |
| 1621-1561-1411 | 6 | 103,458,733 → 126,188,252（+22.0%） | 两条风化行恢复 6 命 +36.2%；替换广域 871,074 → 3,690,555 |
| 1631-1561-1411 | 0 | 92,612,821 → 92,947,416（+0.4%） | 同上（赛维里安） |
| 1631-1561-1411 | 6 | 117,009,077 → 133,724,014（+14.3%） | 同上 |

  修后 6 命替换广域 3,690,555 与维琳娜站槽 0 时逐位相同；洛克茜减少 223,931 = 原挂错两行之和。单风队 1181-1561-1411 与维琳娜站首个风槽的队逐位不变；预设库 105 队无双风队 ⇒ 金样 / 棘轮无变化。
- **改法**：`43d6a6bf`——`core/anomalyPool/corrosion.ts` 抽 `corrosionOwner`（首个声明 `anomalyCorrosionEvents` 的在队模块），事件生产与伤害池气旋行归属共用一个判定；风化加成派发给挂出 `windAnomalyBonus` 的在队模块，面板取其自身槽位。`bd4423fd`——删模块钩子入参 `AgentAnomalyTransformInput.windCharSlot`（爱丽丝 / 维琳娜都不读，vue-tsc 证实；它是 CC-D3 与本轮同类误路由的诱因），模块钩子只拿 `self`。回归用例在 `ccD3D1Verdict.test.ts` CC-D3 组（修前红 `expected [0,'1621'] to deeply equal [1,'1561']`，修后绿）。
- **验证**：两刀各跑一遍全量 vitest 263+265 = 528 文件 / 4529 例；zd r711 / r711b DUMP/ROWS DIFF 0；vue-tsc 0；guards 26；build OK。不改 `.vue` ⇒ 未跑 ui-check。
- **回退**：`git revert bd4423fd 43d6a6bf`（两刀独立，可只退第二刀）。
- **未决**：① 乱流是通用风队机制，双风队里由第一个风属性槽结算并记账（`AnomalyPoolInput.windCharSlot` → `calcTurbulenceDamage` 的面板与 `perSlotTurbulenceTriggers`）；该由哪位风角色结算属建模决策，未改。乱流里「吃风蚀 +150%」的次数来自维琳娜状态机，结算面板却可能是洛克茜的。② `damageElement === 'wind'` 判定在编排层有 5 处各写一份（`anomalyPanels#resolveWindInfectionPick`、`damagePool`、`panelPhases` 侵染区、`roundInputs.windInfo`、`useResourceCalc.damagePanels`），语义有 some / findIndex 两种；收拢收益小，记为低优先候选。
