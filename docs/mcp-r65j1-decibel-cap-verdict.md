# R65-J1 首案裁决：橘福福「喧响上限 +1000」在整局总量口径下零消费者

> 2026-09-22，会话 mcp-r65j1（自主开发任务）。范围：R65-J1 候选
> （`.claude/OPEN-ITEMS.md`）的**具名首案** `jufufu.extra_ability_team_decibel`
> （橘福福 1391 额外能力·八面威风：「队伍中所有角色喧响值上限提升 1000 点」）。
> **裁决：不是缺口** —— 当前整局总量口径下上限没有自由度，「不做」是正确口径决策，不是缺陷。
> 配套交付：护栏判据 `src/composables/__tests__/decibelCapVerdict.test.ts`（5 例，形状面是未来闸门）。

## 1. 事项由来

- `public/static/teammate-buffs.json` 的 `jufufu.extra_ability_team_decibel`：`effects: []`（空），
  description 文本同时含「上限 +1000」与「强攻/命破终结 +300/次」。
- R65-J1 候选（R65 轮结转）的前提假设称此条「note 为空、全仓零消费点，疑似真缺口」。
- 本轮实测**前提本身不准确**：`src/specs/agents/1391.json` 的 `additionalAbility.note` 与
  `notes` **明确写着**「喧响上限 +1000 不做」——这是文档化决策，不是静默缺口；
  R65 当时「note 为空」的观察只看 teammate-buffs.json 条目、未读 spec。

## 2. 证据链（全部 2026-09-22 实测）

> ⚠ **CC-187（00e50d4e，2026-09-28）已删除 `src/core/resourceTrack.ts`**（含 `simulateDecibelTrack` / `DECIBEL_TRACK_CAP`），「形状面」判据同删，闸门改由 `decibelCapVerdict.test.ts` 的行为判据承担。下文提到它的地方是当时的记录；将来若做上限口径，要在新实现里建模上限。


### 2.1 整局总量口径无上限项（裁决核心）

- `src/core/resource/helpers.ts:391/605`：`ultimateCount = Math.floor(decibels[i] / cfg.ultimateCost)`。
- `ultimateCost` 是**角色级大招消耗**：默认 `ULTIMATE_COST_DEFAULT`（3000，
  `src/composables/resourceCalc/helpers.ts:566`），佩洛伊斯覆盖为 2000
  （`src/mechanics/agents/specPanelBuffs.ts:200`）。
- 全仓不存在任何进入该公式的「上限」字段：引擎里「喧响上限」只出现一处
  = `DECIBEL_TRACK_CAP = 3000`（`src/core/resourceTrack.ts:22`）。

### 2.2 上限的唯一建模未接入主伤害管线

- `simulateDecibelTrack`（时间轴喧响轨，头注释自述「对轴模块第一步」）在**非测试代码零调用点**
  （全仓 grep：仅 `resourceTrack.ts` 定义 + `resourceTrack.test.ts`）。
- 其模型是**时间轴口径**细化：均匀回复、到上限截断（截断记 wasted）、进窗攒满才放大招——
  服务于「第 N 个失衡窗口资源够不够」的轴视图，与当前伤害计算用的整局总量口径
  （README：「整局总量，不算逐帧时间轴」）正交。
- ⇒ 当前产品形态（总量口径）下，「上限 +1000」对任何面板读数**无观测量**：
  总量口径的大招次数 = 总喧响 ÷ 消耗，而总喧响回复不依赖上限。

### 2.3 +300/ult 那一半已接（「机制没接」的前提部分证伪）

- **门控**：`evalTeamConditions`（`src/specs/teamCondition.ts`）**自身不算**
  （`m.slot === ownSlot → false`）⇒ 1391 自身命破不触发额外能力，需**队友**中有强攻/命破。
- **接线**：`jufufuTigerRoarMechanic.applyTeamConfig`（build 相位，
  `src/mechanics/agents/specPanelBuffs.ts:646-664`）→ 队伍中每个强攻/命破角色
  （**含自身**，忠实原文「该角色获得 300 点」）：`cfg.extraSelfDecibelPerUltimate = 300`。
- **消费**：`src/core/resource/helpers.ts:327` + `src/core/resource/resourceIncome.ts:281`
  （`extraSelfDecibelPerUltimate × ultimateCount` 并入喧响总量）。
- **仪玄符法千重也算终结技**：`src/mechanics/agents/yixuan.ts:499-511`
  （`jufufuOn && prevFuFa > 0 ⇒ prevFuFa × 300`，`+=` 累进 `extraSelfDecibelReward`）；
  `threads.teamUltimateForJufufu`（`convergence.ts:1473`，刻意留编排层：全队汇总、无角色判定）
  另供 1391 的 C2 威势通道（`jufufuTeamUltimateCount`）。

### 2.4 原文两半 vs 引擎现状

| 原文 | 引擎现状 | 裁决 |
| --- | --- | --- |
| 队伍喧响值上限 +1000 | 总量口径无上限项；唯一上限建模（时间轨）未接入 | **零消费者，「不做」正确** |
| 强攻/命破角色终结技，该角色 +300 喧响 | `extraSelfDecibelPerUltimate = 300`（含自身；门控 = 队友有强攻/命破） | **已接**（含符法千重延伸） |

## 3. 本轮落地

1. **护栏判据** `src/composables/__tests__/decibelCapVerdict.test.ts`（5 例，行为面 + 形状面，5/5 绿）：
   - 门控语义：自身不算 / 队友强攻（1081 比利）触发（用 1391 真 spec 走 `evalAdditionalAbility`）；
   - 行为面：build 钩子给全体强攻/命破角色（含自身）写 300、支援（1451）不得；门控关时无人得；
   - 行为面：converge 相位全队终结总次数递 1391（>0 注入、≤0 写 undefined 不覆盖 build 初值）；
   - 行为面：真管线 [1391, 1081, 1451] 每角色大招次数 = floor(总喧响/ultimateCost)（±1、gift 剔除）
     —— 把「无上限项」钉在**行为出口**（未来引入 cap 项 ⇒ 本条红）；
   - **形状面（★未来闸门）**：非测试 src 中 `simulateDecibelTrack` 零调用点。
     本条红 = 有人把时间轨接进主管线 ⇒ 先按 §4 裁决角色级上限口径，再删本条。
2. **spec note**（`src/specs/agents/1391.json` 两处）：「喧响上限 +1000 不做」升级为
   「不做（2026-09-22 裁决：整局总量口径零消费者，不是缺口）」+ 指针；
   +300 的接线指针从过时的 `useResourceCalc` 订正为现落点（规则 8：知识单一事实源在代码/注释）。
3. **账本**（`.claude/OPEN-ITEMS.md`）：R65-J1 的 jufufu 条结案；该候选余 6 条
   （「note 自称已并入模块通道」类，含 `grace_c1_team_energy` 等），未决、待下一轮定价。
4. **附带基线稳态化**：`difficultyCurve.test.ts` 切轴档（altAxes）超时预算 300s → 420s。
   本轮基线检查（`npm run check`）唯一红 = 该条在全套并行负载下超 300s；单独复跑 24/24 绿、
   实测 242.5s ⇒ 负载性超时非逻辑红。只抬本条（同文件其余 6 条 300_000 实测余量充足），
   归因注释已写进代码。

## 4. 未来接入喧响时间轨时的步骤（形状面判据会先红）

> ⚠ **CC-187（00e50d4e，2026-09-28）已删除 `src/core/resourceTrack.ts`**（含 `simulateDecibelTrack` / `DECIBEL_TRACK_CAP`），「形状面」判据同删，闸门改由 `decibelCapVerdict.test.ts` 的行为判据承担。下文提到它的地方是当时的记录；将来若做上限口径，要在新实现里建模上限。


1. **先裁决角色级上限口径**：`simulateDecibelTrack` 加 `cap` 参数（默认
   `DECIBEL_TRACK_CAP`；大招判定从「攒满清空」改为「≥ 消耗(3000) 即放、余量保留」——
   cap=3000 时与现状**逐位相同**，存量角色零漂移，可被 `timeGolden`/`allAgentsSweep` 验证）。
2. **橘福福通道**：`jufufuTigerRoarMechanic.applyTeamConfig`（build 相位，与 +300 同门控）
   给队伍三人写 `cfg.decibelCap = 4000`（团队级机制走规则 6 钩子，
   **不**往 `useResourceCalc` 加角色判定分支）。
3. **行为判据**：jufufu 队 cap 3000 vs 4000 的 A/B 窗口大招放行率
   （正控：回复慢/窗口早的配置放行率必须上升；负控：cap=3000 两臂零 delta）；
   更新 `1391.json` 两处 note；删 `decibelCapVerdict.test.ts` 形状面判据。
4. 同步 `docs/ENGINE_PIPELINE_GUIDE.md` §4 坑表（新增「时间轨接入」条目，带上限口径）。

## 5. 验证（2026-09-22 实测）

| 项 | 结果 |
| --- | --- |
| `npx vitest run decibelCapVerdict` | 5/5 passed（213ms） |
| `npx vitest run jufufu + decibelUltimateCount` | 12/12 + 3/3 passed（零回归） |
| `npx vitest run difficultyCurve`（改后单跑） | 24/24 passed（EXIT=0） |
| `npm run check`（全套，含 difficultyCurve） | 见提交前终验 |
