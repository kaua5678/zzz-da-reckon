# MCP 架构升级与清债交付备忘：判据 18（招式属性对账）与 1031（妮可）契约录入

**文档标识**：`docs/mcp-guard18-and-1031-recording.md`
**执行周期**：2026-09-18
**责任主体**：Arena.ai Agent Mode / ShunCode MCP 协作者
**对账基准**：`.claude/OPEN-ITEMS.md`（待办账本）、`scripts/check-guards.mjs`（18 项工程护栏）、`data/recordings/legacy.json`（历史遗留名单）

---

## 1. 架构升级：工程判据 18（招式伤害属性 ↔ nanoka raw 散文对账）

### 1.1 背景与静默盲区（R23-N1）
在 R23 周期中，全库依据 nanoka raw 散文解析重刷了 102 招 / 262 处伤害属性字段（覆盖 43 名角色）。但由于 `timeGolden` 将纯伤害变动（dmg）归类为 `info` 而非 `fail`，导致全库除 1011（安比，拥有行级定制判据）外的其余 42 名角色处于无测试保护的盲区——若其元素被误写死或静默回退，常规单元测试与黄金用例均不会报错。

### 1.2 落地防护实现
1. **单一事实源复用**：直接复用 `scripts/lib/move-elements.mjs` 的 `resolveMoveElements` 与 `ELEMENT_ROW_KINDS`，不重复定义口径。
2. **护栏检测实现**：
   - 在 `scripts/check-guards.mjs` 引入 `auditMoveElementsAgainstRaw(root = ROOT)`；
   - 遍历 `data/raw/nanoka_missing/full/` 下全量角色数据，对照 `public/static/catalog.json` 的 `agentSkills`；
   - 对每一个招式的 `move.damageElement` 及包含属性的行（`row.damageElement`）进行双向比对；
   - 任何改回、缺失或失配直接在 CI/本地 `check-guards` 环节大声报错（EXIT 1）。
3. **TypeScript 类型与双向契约**：
   - 在 `scripts/check-guards.d.mts` 中补齐 `MoveElementViolation` 接口与 `auditMoveElementsAgainstRaw` 声明，确保判据 14-C（dts 漂移）持续零报错。
   - 在 `src/scripts/__tests__/checkGuards.test.ts` 升级判据总数为 18 条，并追加专属测试套件。

---

## 2. 持续清债：1031（妮可）角色契约规范录入

### 2.1 原文证据与六大核心机制解构
基于 `data/raw/nanoka_missing/full/1031.json` 原文 58 个条目进行全量梳理与处置：
- **`nicole-core-def-shred`（D3 减防 / L1 确定性）**：强化子弹与能量场命中防御力 -40%（3.5s 默认满覆盖）；锚定 `src/mechanics/agents/nicole.ts#nicoleMechanic`。
- **`nicole-additional-ether-dmg`（D2 增伤 / L1 确定性）**：同属性/同阵营门控，核心减益期间全队以太伤 +25%；锚定 `src/specs/agents/1031.json#/additionalAbility`。
- **`nicole-c1-ex-bonus`（D2 增伤 / L1 确定性）**：影画1 强化特殊技四段伤害与异常积蓄 +16%；锚定 `src/mechanics/agents/nicole.ts#NICOLE_C1_EX_BONUS`。
- **`nicole-c1-charge-field`（D6 动作缩放 / L2 近似）**：影画1 蓄力延长能量场，倍率行等比放大（`scale = 1 + 1.5 * tCharge / tField`）；锚定 `src/mechanics/agents/nicole.ts#NICOLE_C1_FIELD_SECONDS_PER_CHARGE_SECOND`。
- **`nicole-c2-energy-refund`（D4 资源循环 / L2 近似）**：影画2 触发核心减益回 5 能量（15s CD），整局总量折算 `floor(t/15)*5` 注入初始能量；锚定 `src/mechanics/agents/nicole.ts#NICOLE_C2_ENERGY`。
- **`nicole-c6-crit-rate`（D2 增伤 / L1 确定性）**：影画6 能量场叠暴击 +1.5%×10 层（满层 15%）；锚定 `src/mechanics/agents/nicole.ts#nicoleMechanic`。
- 其余 52 条招式与天赋条目均按 SOP 明确标记 `out_of_scope` 并阐明排除理由与影响。

### 2.2 验证结果与清单销号
- `node scripts/record-agent.mjs check 1031 plan`：PASS（58 条目 / 6 机制）。
- `node scripts/record-agent.mjs check 1031 complete`：PASS（静态 AST 追踪全部命中，测试用例全部断言匹配）。
- `data/recordings/legacy.json`：移除 `1031`，遗留待复核角色从 60 降至 59。
- `node scripts/verify-recording.mjs`：全仓 189 项校验全绿。

---

## 3. 护栏与棘轮自洽保障

1. **名词表棘轮（`RATCHET_BURNDOWN`）同步**：
   - 秽盾移至 `modeled` 后，未处理存量（`unhandled + deferred`）由 41 实质下降至 40；
   - 同步下调 `RATCHET_BURNDOWN` 中 `名词表未处理` 的 `frozen: 40`，保证 `computeBurndown` 进度断言严格通过。
2. **扫描自指陷阱清理**：
   - `src/core/resource/helpers.ts:1580` 注释中的字面量调整为 `debt-marker`，避免被正则表达式误判为未登记的活债务。
3. **全仓验证读数**：
   - `node scripts/check-guards.mjs`：18 guard checks passed（1049/1049 招式属性达标）。
   - `npx vitest run src/scripts/__tests__/checkGuards.test.ts`：114 passed。
   - `npx vitest run src/mechanics/__tests__/nicole.test.ts`：6 passed。
   - `npm run typecheck`：0 error。
