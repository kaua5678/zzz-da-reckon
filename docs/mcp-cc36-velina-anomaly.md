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
