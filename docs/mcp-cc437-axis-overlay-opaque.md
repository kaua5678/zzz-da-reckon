# CC-437 设计稿：轴窗口 overlay 改为「模块私有、编排层不透明」（去掉 `typesHooks.ts` 里 9 个角色前缀字段）

> 状态：**T15-a `f287adde`（r467）、T15-b `0f643e81`（r468）、T15-c `37e97ec9`（r469）、T15-d `3a9a8f5f`（r470）已落地，e→g 未动**（设计 arena-F r466，2026-10-03）。执行卡见 `docs/mcp-worker-task-queue.md` §3 **T15**（a→g，每步独立提交、各自 zd 0）。
> 前置设计：`docs/mcp-cc17-axis-overlay-consume.md`（CC-17：按槽归属 + `directRowBonus`）。本稿是它的下一步，不推翻它。

## 0. 一句话

CC-17 之后，`axisWindowOverlays` 的返回值已经**按槽存、按槽取、只交还给同一个模块**。
既然编排层从不解释它，`AgentAxisOverlays` / `AxisScalarOverlays` 里那 9 个角色前缀字段
（`banyueMingwangStacks` …`sigridInfectionPct`）就只是「模块私有状态借共享类型过了一道手」。
把它改成**不透明值**（模块自己定义形状、自己写、自己读），新角色加窗口机制时 **`typesHooks.ts` / `panelPhases.ts` / `damagePool*.ts` 一行不改**。

## 1. 事实（r466 逐处核过，别凭注释推断）

### 1.1 四个 moveId 桶：写与读都在同一模块内

| 字段 | 写（`axisWindowOverlays` 返回） | 读（`directRowBonus`） | 其他读者 |
|---|---|---|---|
| `banyueMingwangStacks` | `banyue.ts:946` | `banyue.ts:964` | 无 |
| `yixuanNingshenMap` | `yixuan.ts:1116` | `yixuan.ts:1133` | 无 |
| `peiluoKagerouMap` | `specPanelBuffs.ts:95`（佩洛伊斯） | `specPanelBuffs.ts:111` | 无 |
| `corinStunBonusMap` | `corin.ts:308` | `corin.ts:331` | 无 |

### 1.2 五个标量字段：同样私有，且 `scalarBySlot` **只写本槽**

| 字段 | 写 | 读 | 写入的槽 |
|---|---|---|---|
| `banyueMingwangPct` | `banyue.ts:951` | `banyue.ts:967` | `new Map([[slot, …]])` 本槽 |
| `yixuanNingshen` | `yixuan.ts:1110 / 1121` | `yixuan.ts:1132` | 本槽 |
| `peiluoKagerouPct` | `specPanelBuffs.ts:99` | `:112` | 本槽 |
| `corinStunBonusPct` | `corin.ts:312` | `:333` | 本槽 |
| `sigridInfectionPct` | `sigrid.ts:659` | `:677` | 本槽 |

`grep -rn "<字段名>" src --include=*.ts --include=*.vue | grep -v __tests__` 的全部非注释命中就是上面两表（外加 `typesHooks.ts` 的声明与注释）。

### 1.3 编排层只搬运、不解释

- 收集：`panelPhases.ts:368-391 collectAxisWindowOverlays`——对每个在队模块调 `axisWindowOverlays`，`out.bucketsBySlot.set(member.slot, res)`（**原始返回整体按槽存**），`res.scalarBySlot` 逐槽并入 `out.scalarBySlot`（因为 1.2，实际只并入本槽）。
- 下传：`useResourceCalc.ts:647-648` → `damagePool.ts:85/90 axisBucketsBySlot / axisScalarBySlot`。
- 消费：`damagePoolDirect.ts:160-173`——`overlayScalar = axisScalarBySlot.get(slot)`、`overlayBuckets = axisBucketsBySlot.get(slot)`，然后 **`getAgentMechanic(charResult.agentId)?.directRowBonus({ exec, isAxis, stunOverride, buckets, scalar })`**，即交还给**本行所属角色**的模块。
- 没有第二个消费者（`grep -rn "axisBucketsBySlot\|axisScalarBySlot\|bucketsBySlot\|scalarBySlot" src --include=*.ts --include=*.vue | grep -v __tests__` 仅上述文件）。

⇒ **不变量**：`directRowBonus` 读到的 `buckets` / `scalar`，恒为**同一模块**在同一帧 `axisWindowOverlays` 的返回（或 undefined）。
这正是 CC-17 的零差论证所依赖的性质；本稿只是把这个性质从「注释里的约定」变成「类型上的事实」。

### 1.4 为什么现在的形状是规则 6 要消灭的

`types.ts:940-947` 的注释自己说了：「每个新角色都要再改编排层（正是规则 6 要消灭的形状）」。CC-17 把**编排层的 if 分支**消掉了，但**类型层**还留着：
新角色加一个窗口机制 ⇒ 必须在 `typesHooks.ts` 加 1～2 个以角色名开头的字段 + 两段头注释，`AGENT_ID_BURNDOWN_LOG.md` 之类的「核心侧角色前缀字段」清单也随之变长。而这些字段除了它的主人谁也不读。

## 2. 目标形状

```ts
// src/mechanics/typesHooks.ts
/**
 * 模块私有的轴窗口 overlay（CC-437）：编排层只按槽存取、**不解释内容**；
 * 只有产出它的模块会在 `directRowBonus` 里把它读回。形状由模块自己定义，经 `axisOverlayChannel<T>()` 收窄。
 * 不变量（编排层保证）：`directRowBonus.overlay` 恒为本行所属模块在同帧 `axisWindowOverlays` 的返回或 undefined。
 */
export type AgentAxisOverlay = { readonly [AXIS_OVERLAY_BRAND]: true }
declare const AXIS_OVERLAY_BRAND: unique symbol

/** 模块侧类型收窄助手：wrap 在 axisWindowOverlays 用，read 在 directRowBonus 用。零运行时开销（两个 cast）。 */
export function axisOverlayChannel<T>() {
  return {
    wrap: (v: T): AgentAxisOverlay => v as unknown as AgentAxisOverlay,
    read: (o: AgentAxisOverlay | undefined): T | undefined => o as unknown as T | undefined,
  }
}
```

```ts
// src/mechanics/types.ts（钩子签名）
axisWindowOverlays?(input: AgentAxisOverlayInput): AgentAxisOverlay | null
// src/mechanics/typesRows.ts
export interface DirectRowBonusInput {
  exec: SkillExecution
  isAxis: boolean
  stunOverride: number
  /** 本行所属模块同帧 axisWindowOverlays 的返回（不透明）；undefined = 本模块本帧不参与 */
  overlay: AgentAxisOverlay | undefined
}
```

```ts
// 编排层
// panelPhases.ts collectAxisWindowOverlays → Map<number, AgentAxisOverlay>（单表；scalarBySlot 合并逻辑删除）
// useResourceCalc.ts:647-648 → axisOverlayBySlot: axisOverlays.value
// damagePool.ts → axisOverlayBySlot: Map<number, AgentAxisOverlay>
// damagePoolDirect.ts:160-173 → overlay: axisOverlayBySlot.get(slot)
```

```ts
// 模块侧样例（banyue.ts）
interface BanyueOverlay { stacksByMove?: ReadonlyMap<string, number>; mingwangPct?: number }
export const banyueOverlay = axisOverlayChannel<BanyueOverlay>()   // 导出：测试读返回值用
axisWindowOverlays: (…) => {
  …
  if (isAxis) { const map = computeBanyueMingwangStacks(slot, axes, cinemaLevel); return map.size > 0 ? banyueOverlay.wrap({ stacksByMove: map }) : null }
  return banyueOverlay.wrap({ mingwangPct: MINGWANG_BASE_PER_STACK * MINGWANG_MAX_STACKS * cov })
},
directRowBonus: ({ exec, isAxis, overlay }) => {
  const o = banyueOverlay.read(overlay)
  const dmg = isAxis ? (o?.stacksByMove?.get(exec.moveId ?? '') ?? 0) * MINGWANG_BASE_PER_STACK : (o?.mingwangPct ?? 0)
  …（算式与 note 逐字不动）
}
```

**删除**：`AgentAxisOverlays`、`AxisScalarOverlays` 两个接口及其 9 个字段与两大段头注释（头注释里有价值的「泄漏论证」浓缩到 `AgentAxisOverlay` 的注释 + 本稿 §1.3）。
**不变**：`AgentAxisOverlayInput`（入参）、`DirectRowBonus`（出参）、所有数值与 note 模板。

## 3. 零差论证

每个模块的 `directRowBonus` 读到的值 = 同模块同帧 `axisWindowOverlays` 的返回（§1.3 不变量，迁移前后都成立）；
迁移只改**容器**（命名字段 → 模块私有对象），不改任何算式、不改 moveId 键、不改槽归属。
`isAxis ? 桶 : 标量` 的分支顺序在每个模块内逐字保留（仪玄的 `scalar ?? 桶 ?? 0` 优先级也保留：私有对象里 `ningshen ?? stacksByMove.get(moveId)`）。
⇒ `ZD_REPO=<wt> bash .zc/perf/zd.sh <tag>` 期望 `DIFF 0 NON1581 0 []`；每步各跑一次。

## 4. 分步迁移（每步独立绿、独立 zd、独立提交；允许中途停）

过渡期的关键技巧：**先加 `overlay` 字段、保留 `buckets` / `scalar`**，让编排层把「原始返回」同时作为 `overlay` 传下去（它本来就是 `bucketsBySlot.get(slot)`），模块就能一个一个迁，最后一步再删旧字段。

| 步 | 做什么 | 文件 | 验收 |
|---|---|---|---|
| **T15-a** | ✅ `f287adde`（r467）。**实做偏差两处**：① 过渡期 `AgentAxisOverlay = AgentAxisOverlays & { [BRAND]: true }`（交叉），钩子返回类型**不改**（改联合会让 8 个测试文件 56 处返回值属性访问报 TS2339），`panelPhases` 不需要 `in` 守卫；② `overlay` 过渡期**可选**（5 个测试文件 19 处直接调用不传）。两者 T15-g 归位：brand 独立、返回类型 `AgentAxisOverlay \| null`、`overlay` 必填。原卡面 → `typesHooks.ts` 加 `AgentAxisOverlay` brand 类型 + `axisOverlayChannel<T>()`（并从 `mechanics/index.ts` 导出）；`typesRows.ts DirectRowBonusInput` 加 `overlay: AgentAxisOverlay \| undefined`；`axisWindowOverlays` 返回类型改为 `AgentAxisOverlays \| AgentAxisOverlay \| null`（过渡联合）；`damagePoolDirect.ts` 传 `overlay: overlayBuckets as unknown as AgentAxisOverlay \| undefined`；`panelPhases.ts` 收集处：若返回值不是旧形状（没有 `scalarBySlot` 且没有四个桶名之一）则不做 scalar 合并（用 `'scalarBySlot' in res` 判） | typesHooks / typesRows / types / mechanics index / damagePoolDirect / panelPhases | vue-tsc 0；全量分片基线不变；zd 0（行为未变） |
| **T15-b** | ✅ `0f643e81`（r468）。实做补充：`sigridInfectionPct` 字段**随手删了**（无读者，不等 g）；`channel.read` 参数过渡期并上 `AgentAxisOverlays`（不含 `\| null`，守 noNullRoundCc418 锁；测试写 `read(hook(...)!)!`）；卡面漏列读者 `damagePoolBatchR16b.test.ts:133-144`。原卡面 → 迁 **sigrid**（最小：只有标量）：定义 `SigridOverlay { infectionPct: number }`，导出 `sigridOverlay` channel，`axisWindowOverlays` 返回 `sigridOverlay.wrap(...)`，`directRowBonus` 读 `sigridOverlay.read(overlay)`；测试 `sigrid.test.ts:583/589` 的 `scalar: {...} as never` 改 `overlay: sigridOverlay.wrap({ infectionPct: 7.5 })`；`teamHookMigration.test.ts:261-263` 改读 `sigridOverlay.read(res)?.infectionPct` | sigrid.ts + 2 测试 | 定向 + zd 0 |
| **T15-c** | ✅ `37e97ec9`（r469）。形状 `PeiluoOverlay { byMove?: Map; flatPct?: number }`（两臂互斥）；两字段已删；NightA 的「按槽键控」断言改为「模块对 slot 无感」（键控是编排层职责）。原卡面 → 迁 **peiluo**（`specPanelBuffs.ts`：桶 + 标量）；测试 `peiluo.test.ts`、`teamHookMigration.test.ts:216-233` | specPanelBuffs.ts + 2 测试 | 同上 |
| **T15-d** | ✅ `3a9a8f5f`（r470）。形状 `CorinOverlay { byMove?: Map; flatPct?: number }`；两字段已删；「桶值恒 35」断言改读 `byMove`。原卡面 → 迁 **corin**；测试 `corin.test.ts`、`teamHookMigration.test.ts:251-255` | corin.ts + 2 测试 | 同上 |
| **T15-e** | 迁 **banyue**；测试 `banyue.test.ts`（14 处）、`teamHookMigration.test.ts:163-168`、`damagePoolNightA.test.ts` / `damagePoolBatchR16b.test.ts` 里构造 `axisBucketsBySlot` / `axisScalarBySlot` 的般岳夹具改 `axisOverlayBySlot`（见 T15-g 说明：这两份测试在 g 之前仍可用旧字段名，但建议在 e 时一并改成 `overlay`，少跑一次） | banyue.ts + 4 测试 | 同上 |
| **T15-f** | 迁 **yixuan**（桶 + 标量，C6 臂与非轴臂都进私有对象 `{ ningshen?: {critDmg, sheerDmg}; ningshenByMove?: Map }`，读取优先级保持 `ningshen ?? (isAxis ? ningshenByMove.get(moveId) : undefined) ?? {0,0}`）；测试 `yixuanSmoke.test.ts`、`teamHookMigration.test.ts:181-206` | yixuan.ts + 2 测试 | 同上 |
| **T15-g** | **收口**：删 `AgentAxisOverlays` / `AxisScalarOverlays` 与 9 个字段；`axisWindowOverlays` 返回类型只剩 `AgentAxisOverlay \| null`；`DirectRowBonusInput` 删 `buckets` / `scalar`；`collectAxisWindowOverlays` 返回 `Map<number, AgentAxisOverlay>`（删 scalar 合并）；`useResourceCalc.ts:647-648` / `damagePool.ts:85-90` 合成 `axisOverlayBySlot`；`damagePoolDirect.ts` 删 `overlayScalar`；`damagePoolNightA.test.ts` / `damagePoolBatchR16b.test.ts` 的输入夹具改 `axisOverlayBySlot`；加形状锁 `src/composables/__tests__/axisOverlayOpaqueCc437.test.ts`：① `typesHooks.ts` 非注释行不含 `MingwangStacks\|NingshenMap\|KagerouMap\|StunBonusMap\|MingwangPct\|StunBonusPct\|KagerouPct\|InfectionPct`；② `panelPhases.ts` 不含 `scalarBySlot`；③ `DirectRowBonusInput` 无 `buckets` / `scalar` 成员 | 见左 | vue-tsc 0 / guards / build / zd 0 / 全量分片；arch 卡 CC-437 置 done；本稿状态行改「已落地」 |

每步的 arch 行写 `CC-437<步>`；r6 §8 一行；T15 卡勾对应项。**谁做都行**（可交给执行模型，卡面 = 本稿 §2 + §4 对应行 + 常规验收）。

## 5. 不做的 / 边界

- **不把 overlay 值域规范化**（如统一成 `{dmgPct, critDmg, sheerDmg}`）：般岳桶存的是**层数**（消费端再 × 每层）、可琳桶存的是「恒 35」、仪玄存的是对子——这些是各机制自己的中间量，强行统一 = 把换算搬回编排层，倒退到 CC-17 之前。
- **不动 `AgentAxisOverlayInput`**（入参侧 `additionalAbilityActive / windInfectionRate / settings` 等是编排层真正提供的事实，不是私有状态）。
- **不动 `stunOnlyDmgBonus`（悠真）**：行级字段，不属 overlay（CC-17 §3 第 3 条）。
- 若将来真的出现「模块 A 的窗口要加成到模块 B 的行」（跨槽 overlay），不透明值做不到——那时应另开**显式**的跨角色供给钩子（`crossAgentSupply` 一族已有先例），而不是回到共享命名桶。本稿把这条写进 `AgentAxisOverlay` 注释。

## 6. 回退点

每步一个提交，`git revert <该步>` 即可；T15-g 之前旧字段一直存在，回退任一模块步不影响其他模块。
