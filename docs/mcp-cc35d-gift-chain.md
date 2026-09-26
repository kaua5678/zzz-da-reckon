# CC-35d 设计稿：诺玛 / 琉音「装配后赠送行」去角色化

> lead-arena-0925c，2026-09-27 第 49 轮。上游：census §5.35 下一步 1；架构总表 `docs/mcp-calc-core-architecture.md`。
> 判据 22（`scripts/lib/core-role-field-ratchet.mjs`）在 CC-35c-D 后为 103，本卡目标是把诺玛 / 琉音在编排层的残留（约 40 计）清掉。

## 0. 背景：已经通用的部分和还没通用的部分

赠送行有两种：诺玛「帽子把戏」赠**连携**，琉音「好评转大」赠**终结技**，都是给「上一位队友」（`resolveUltimateTargetSlot`）。

| 层 | 现状 | 备注 |
|---|---|---|
| 引擎：必要时间预留 | **已通用**：`crossAgentSupplyAt(… 'gift-chain:chain')` / `ultimateGiftOf`（CC-32）；局部变量已去角色名（CC-35c-D `dbc7e92`） | `core/resource/helpers.ts` |
| 引擎：折叠环 / 截断上限 | 已通用（同一供给通道） | `foldLoop.ts`、`tailPipeline.ts` |
| 编排：装配后补倍率与计数 | 诺玛已通用（本稿 A）；琉音**未通用**：`liuyinPromote.ts` 按 `findSlotByIdentity(['1481'])` 找槽 | 本稿 B3 |
| 编排：伤害池 | `damagePoolDirect.ts` 以 `liuyinSrc && !isAxis && LIUYIN_EX_MOVE_IDS` 跳过琉音强特行（由专用块重放） | 本稿 B2 |
| UI 出口 | `useResourceCalc` 导出 `liuyinPromoteCount` / `liuyinPromoteHug60`，`damagePool` 形参同名 | 本稿 B1 |

## A. 诺玛：模块能力 `chainGift`（CC-35d-A，**done `a1241ba`**）

- **新能力**（`src/mechanics/types.ts`）：`chainGift?(result): { count; label; note } | null`。
  - 返回 null：本轮没有来源，结果不动。
  - `count ≤ 0`：撤掉引擎的占位赠送行。
  - `label`：拼在招式名后。
  - `note`：写进技能表说明。
- **编排**：`resourceCalc/normaHatChain.ts#applyNormaHatChain` 改名为 **`resourceCalc/chainGift.ts#applyChainGift`**。
  - 提供者槽位 = `configStore.team` 中首个 `getAgentMechanic(agentId)?.chainGift` 存在的下标。
  - 原来按身份找槽 `findSlotByIdentity(['1571'])`。本库 `teammateBuffId` 全都等于自身 id（2026-09-17 实查），所以两种写法等价。
  - 数学、行补丁、兜底追加逐字保留，只把 `normaIdx` / `normaResult` / `normaSrc` 和两段诺玛文案换成能力返回值。
- **诺玛实现**（`norma.ts` 模块对象）：返回 `{ count: normaMechanicSource.hatToChainCount, label: '诺姆膛温替换', note: <原 skillTableNote 原文> }`。`Math.floor` / `max(0)` 仍在编排层做。
- **保留不改**：
  - 目标槽设置键 `'liuyin.ultimateTargetSlot'`（诺玛与琉音共用这个设置，这是现有语义，字符串也不计入判据 22）。
  - C4 喧响仍走 `cfg.normaHatToChainCount` → 资源池。
- **验收**：vue-tsc 0；相关单测；dump / rows 对 H2a 仅 `__ms` 差；反向变异（count +1）看 rowsnap / 单测是否出差；rf 下降约 10。
- **回退点**：单提交 revert。文件改名，revert 会连同删除 `chainGift.ts`、恢复 `normaHatChain.ts`。

## B. 琉音（CC-35d-B，下一轮起按 B1 → B2 → B3 顺序做，各自单独提交）

### B1：出口改名（约 11 计，纯改名，风险最低，先做）—— **done `0aa191e`**
- `useResourceCalc.ts:270-272, 590, 730-731`：`liuyinPromoteCount` → `ultPromoteCount`，`liuyinPromoteHug60` → `ultPromoteHug60`。
  - **消费方在 `src/views/*.vue` 与组件里**，必须先 `grep -rn 'liuyinPromoteCount\|liuyinPromoteHug60' src` 全量列出，一并改。
  - vue 文件不在判据 22 的扫描范围内，但不改会编译失败。
- `damagePool.ts:74` 形参 `liuyinPromoteCount` → `promoteCount`（`damagePoolCharExtras.ts:29/49` 已映射到 `promoteCount`，顺势对齐）。
- 验收：vue-tsc -b 0（vue 文件靠它兜底）+ dump / rows 零差。

### B2：伤害池跳过琉音强特行（约 4 计，要新增能力）—— **done `e9e80cd`**
- 现状：`damagePool.ts:400` 取 `charResult.liuyinMechanicSource` 作为 `liuyinSrc` 传进 `CharLocals`；`damagePoolDirect.ts:122` 在非轴模式下跳过 `LIUYIN_EX_MOVE_IDS`（1481011/12/13），由后面的专用块按融合倍率重放。
- 方案：新增模块能力 `skipGenericDirectRow?(input: { exec; charResult; isAxis }): boolean`，琉音实现为「有来源 && 非轴 && moveId ∈ 集合」，编排层改成 `getAgentMechanic(charResult.agentId)?.skipGenericDirectRow?.(…)`。
  - **先读** `damagePoolDirect.ts` 里「专用块」的位置和门控：注释说门控与本行完全一致（同一个 `liuyinSrc`、同一个 `!isAxis`）。专用块也要一起判断，它可能已由 CC-18b `extraDirectRows` 接管。**两边门控必须同源**，否则会「两边都不算」，静默少算伤害。
  - `CharLocals.liuyinSrc` 字段若只剩这两处使用，就删除。
- 验收：dump 零差 + 反向变异（能力恒返回 false，应多算伤害，dump 出差）。

### B3：好评转大编排去身份查找（约 15 计，最复杂，最后做）—— **done `840fa70`**
- 现状：
  - `liuyinPromote.ts:163-179` 用 `findSlotByIdentity(['1481'])` 取 `liuyinMechanicSource.goodReviewTotal`，构建 `LiuyinPromoteParams`，然后跑 `promoteFixpoint`（失衡池内层不动点）。
  - `convergence.ts:357-361` 同样按身份找槽，用于轴模式 `axisLiuyinPromote`。
  - `convergence.ts:748` 用 `find(c => c.liuyinMechanicSource)` 取好评。
  - `convergence.ts:36` import 路径 `'./liuyinPromote'` 计 1。
- 方案（照抄 A 的形状）：新增能力 `ultimateGift?(result): { goodReviewTotal: number } | null`，由琉音实现；编排层找提供者槽位（同 A 的 `findIndex`），三处都走它。文件改名为 `ultimateGift.ts`，函数名 `applyLiuyinPromote` → `applyUltimateGift`。
  - `computeLiuyinHugCounts`（从 `@/mechanics/agents/liuyin` 值导入）仍然保留：编排层按值 import 角色模块的**函数**不计入判据 22（判据只数标识符前缀，`computeLiuyinHugCounts` 以 compute 开头）。更干净的做法是把它挂到能力上，但**不在本卡范围内**。
  - `LiuyinPromoteParams` / `PromoteFixpointResult` 等**类型名**以大写 L 开头，不命中判据 22 的正则（要求小写前缀）。可以顺手改名，不强制。
- **风险**：好评转大有正反馈不动点（`MAX_PROMOTE_ITER = 8`），轴模式有「四处同源」约束（census / helpers.ts 里的 `@fact engine:赠送时间/轴模式四处同源`）。必须跑 `timeLedgerInvariants`、`hugoVerdictLanding`、`giftMoveTimeLedger` 以及 dump / rows 零差。
- 回退点：单提交 revert。

## C. 已知坑
- `findSlotByIdentity` 同时认 `teammateBuffId`；按 agentId 派发的等价性依赖「teammateBuffId 均等于自身 id」这一数据事实（`findSlotByIdentity.test.ts` 有记录）。数据面如果变了（出现别名 buffId），要回头复核 A / B3。
- 编排层**不要**写 `a.agentId === b.agentId`（agentId 棘轮会计数，冻结在 3）。用 `getAgentMechanic(x.agentId)` 派发，这种写法不计入。
- import 路径字符串（如 `'./liuyinPromote'`）在代码行里也会被判据 22 计数，所以文件改名本身就能降计数。

## D. 实施记录
- **CC-35d-A done `a1241ba`**（2026-09-27 第 49 轮）：vue-tsc 0；dump / rows 对 H2a 仅 `__ms` 差；反向变异（norma `count + 1`）rowsnap **73 键**出差（`auto-1041-1571-1031/*` 等）、giftMoveTimeLedger / norma 单测红 4；还原后判据 22 读数 **92**（103 → 92）；verify EXIT=0（`/home/kaua/calc-arch/verify35da.log`）。脚本 `/home/kaua/calc-arch/cc35da.py`、`z35da.sh`。
- 顺手：`src/specs/agents/1571.json` 两条 notes 里的函数名同步为 `applyChainGift`（文本，不参与计算）。
- **CC-35d-B1 done `0aa191e`**（第 50 轮）：`liuyinPromoteCount` → `ultPromoteCount`、`liuyinPromoteHug60` → `ultPromoteHug60`（perl 词界替换 6 文件 23 处：`useResourceCalc.ts`、`views/ResultPage.vue`、`damagePool.ts`、`damagePoolCharExtras.ts`、`mechanics/types.ts` 注释、`mechanicSettingsEffect.test.ts`）。**偏离设计稿**：`damagePool` 的 ctx 字段也叫 `ultPromoteCount`（不是 `promoteCount`）——上下游同名便于 grep，`damagePoolCharExtras` 仍映射到能力输入的 `promoteCount`。纯改名：vue-tsc 0、单测 129/129、dump / rows 仅 `__ms` 差。判据 22 92 → 83，**target 91 达成 → 重设 71**。verify EXIT=0 3592。
- **CC-35d-B2 done `e9e80cd`**：新能力 `skipsGenericDirectRow({ charResult, moveId, isAxis })`，琉音实现（来源存在 && `!isAxis` && `LIUYIN_EX_MOVE_IDS`），与重放它的 `extraDirectRows` 强特拆分块同在 `liuyin.ts`、门控同源。`damagePoolDirect.ts` 改为 `getAgentMechanic(charResult.agentId)?.skipsGenericDirectRow?.(…)`；删 `CharLocals.liuyinSrc`、`damagePool.ts` 本槽级 `liuyinSrc`、`LIUYIN_EX_MOVE_IDS` 值导入。新单测 3 条（`liuyin.test.ts` 末尾）。**反向变异（能力恒 false）dump 107 键出差**（`auto-1371-1481-1451` 等伤害上升 = 双计）。判据 22 83 → 76。verify EXIT=0 3595。
- **CC-35d-B3 done `840fa70`**：新能力 `ultimateGiftSource(result) → { goodReviewTotal } | null`，琉音实现；`liuyinPromote.ts` 新导出 `ultimateGiftProviderSlot(configStore)` / `ultimateGiftSourceOf(configStore, rr)`，替换三处：`buildPromoteParams` 的 `findSlotByIdentity(['1481'])` + 直读来源、`convergence.ts` 轴模式 `axisLiuyinPromote` 的身份查找、`convergence.ts` `goodReview` 的 `find(c => c.liuyinMechanicSource)`。单测 58/58（含 timeLedgerInvariants / hugoVerdictLanding / giftMoveTimeLedger / mechanicSettingsEffect）；dump / rows 仅 `__ms` 差；**反向变异（能力恒 null）dump 119 键出差**（伤害下降 = 不转大）。判据 22 76 → 63，**target 71 达成 → 重设 51**。verify 见 `/home/kaua/calc-arch/verify35db3.log`。
- **未做（有意）**：`liuyinPromote.ts` 文件未改名（import 路径 `'./liuyinPromote'` 还计 1）；`LiuyinPromoteParams` 等类型名、`computeLiuyinHugCounts` 值导入保留（不计判据 22）。可作为顺手小卡 CC-35d-B4：`git mv` 成 `ultimateGift.ts` + 改 convergence / 测试 import。
- 脚本：`/home/kaua/calc-arch/z35db.sh`（B1 含改名）、`cc35db2.py` / `z35db2.sh`、`cc35db3.py` / `z35db3.sh`。回退点：按 B3 → B2 → B1 顺序 `git revert`（三者都改棘轮同一行）。
