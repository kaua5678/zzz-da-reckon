# MCP 积压治理交付备忘：T1 冗余字段核销与债 3（秽盾）结案注销

**文档标识**：`docs/mcp-backlog-triage-t1-debt3.md`
**执行周期**：2026-09-18
**责任主体**：Arena.ai Agent Mode / ShunCode MCP 协作者
**对账基准**：`.claude/OPEN-ITEMS.md`（待办账本）、`scripts/check-guards.mjs`（17 项工程护栏）

---

## 1. 背景与治理目标

根据 `.claude/OPEN-ITEMS.md` 积压项清单及工程守则（`AGENTS.md`）：
1. **项 T1（`trackStunCount` 死字段核销）**：
   - 历史背景：喧响轨与失衡池收敛重构时的中间过渡字段。
   - 现状：在 `src/composables/resourceCalc/convergence.ts` 存在赋值（`sp1.pool?.stunCount ?? 0`），在 `src/composables/resourceCalc/roundThreads.ts` 存在类型声明与初始值注入，但在全仓范围内**零读取**。
   - 目标：彻底拔除冗余声明与赋值，保留唯一真源 `prevPoolStunCount`（坑 36：轴内失衡落地与池同源机制），消除静态死通道。
2. **债 3（秽盾机制结案销号）**：
   - 历史背景：`data/raw/nanoka_missing/noun_3.2.3.json` #2000002 登记的名词「秽盾」曾被挂账在 `src/core/effectiveTime.ts:秽盾机制`，判定为高额防御/减伤/抗打断且不会失衡、攻击削盾、打破回能/闪能等四通道模型。
   - 用户裁决：2026-09-18 用户裁决确认「**秽盾我认为很简单…boss 实测数据录入过秽盾数量，他仅仅让全队获得额外能量和闪能而已**」。其余削盾量、防御减伤乘区、破盾净除伤害按用户口径明确不建。
   - 目标：注销 `scripts/check-guards.mjs` 中的 `DEBT_REGISTRY` 对应债务；升级 `scripts/lib/noun-triage.json` 词条 2000002 为 `modeled` 并指向 `src/core/resource/helpers.ts#calcEnergySource` 真实落地锚点；清理 `src/core/effectiveTime.ts` 的 debt 标记；同步 `docs/MECHANICS_IMPLEMENTATION.md` §3.05 挂账表。

---

## 2. 审计与落地方案

### 2.1 项 T1 审计与清理

- **全仓读写搜索验证**：
  - `trackStunCount` 历史匹配点仅 3 处（声明 1 处、初始值 1 处、写入 1 处），下游没有任何组件、组合式函数或测试消费。
  - `prevPoolStunCount` 在 `src/composables/resourceCalc/convergence.ts` 中正常执行收敛与窗口分配，具备完备单元测试覆盖。
- **改动范围**：
  - `src/composables/resourceCalc/roundThreads.ts`：移除 `trackStunCount?: number` 及 `trackStunCount: undefined`。
  - `src/composables/resourceCalc/convergence.ts`：移除 `trackStunCount: sp1.pool?.stunCount ?? 0`。

### 2.2 债 3 审计与闭环

- **锚点可达性验证**：
  - 执行 `node -e "import('./scripts/zc.mjs').then(m => console.log(m.resolveAnchor('src/core/resource/helpers.ts#calcEnergySource')))"`，确认锚点成功命中符号 `calcEnergySource`。
  - 通道代码 `src/core/resource/helpers.ts:246-247`：
    ```typescript
    const shieldBreakGift = (settings.shieldCount ?? 0) * 60
    const energyShieldBreakGift = (settings.energyShieldCount ?? 0) * 30
    ```
    已完备实现破盾奖励能量与闪能折算。
- **改动范围**：
  - `src/core/effectiveTime.ts`：移除 `debt: 秽盾机制` 注释标识，保留事实注释 `@fact engine:time/无敌≠秽盾`，说明经用户 2026-09-18 裁决已正式结案。
  - `scripts/check-guards.mjs`：从 `DEBT_REGISTRY` 中移除 `'src/core/effectiveTime.ts:秽盾机制'`（从 8 条降为 7 条）。
  - `scripts/lib/noun-triage.json`：将名词 `2000002` 状态由 `deferred` 变更为 `modeled`，设定 `anchor: "src/core/resource/helpers.ts#calcEnergySource"`，移除旧挂账 `registeredAt`。
  - `docs/MECHANICS_IMPLEMENTATION.md`：§3.05 词条 2000002 状态由「已挂账」改为「已建模（用户口径）」。
  - `.claude/OPEN-ITEMS.md`：更新待办项状态为已结案。

---

## 3. 验证与护栏合规结果

在 WSL 生产运行环境下执行全套验证：
1. **工程护栏（`node scripts/check-guards.mjs`）**：
   - `ok debt registry (规则 12: debt: 标记防「later = never」) 7/7 登记`（严格守恒，无失效挂账与未登记项）。
   - `ok @fact anchors (语言层: 手写口径必须有据 + 锚得住) 105/105`（无死锚）。
   - `ok 名词表三态对账 (data/raw/nanoka_missing/noun_3.2.3.json: 68 条 → modeled 28 / deferred 40 / unhandled 0)`（`modeled` 从 27 上升至 28，`unhandled` 归零）。
   - `17 guard checks passed` 全项通过。
2. **类型检查（`npm run typecheck`）**：
   - `vue-tsc -p tsconfig.app.json --noEmit` 0 报错通过。
3. **单元回归测试（`npx vitest`）**：
   - 资源管线测试套件及护栏关联用例全数通过。

---

## 4. 结论与交付确认

本次治理完成了 T1 历史技术债务清理与债 3 的正式销号闭环，完全符合项目规范 `AGENTS.md` 规定的守恒律、三态对账及交付落盘要求。
