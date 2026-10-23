# MCP 交付备忘：判据 18 模块化接线与 Backlog 待办消减 (Guard 18 Reconcile & Backlog Burndown)

> 交付日期: 2026-09-18
> 责任主体: ShunCode Agent & Arena Agent 联合工作组
> 归档范围: 护栏体系 `scripts/check-guards.mjs`、`scripts/lib/move-element-reconcile.mjs`、引擎规范 `docs/ENGINE_PIPELINE_GUIDE.md`、配置契约 `src/types/resource/config.ts` 与项目账本 `.claude/OPEN-ITEMS.md`

---

## 1. 背景与待办分诊

在项目长效债务治理与护栏演进中，工作组针对 `.claude/OPEN-ITEMS.md` 中的高优先级可直接开工项与护栏积压进行了深入分诊与集中清偿：

1. **R26-J1（接线判据 18）**：
   - 首版招式伤害属性 ↔ nanoka raw 对账逻辑内联在 `scripts/check-guards.mjs` 中（~60 行），存在三处结构性缺陷：缺少全局反空洞下限（解析器静默返回空不报错）、行级 `damageElement` 为 `undefined` 时被 `filter(Boolean)` 吞掉、且缺乏 catalog 招式体系的 orphan move 漂移检测。
   - 补强逻辑此前已独立落地于 `scripts/lib/move-element-reconcile.mjs`（10 项单测覆盖），但未接进主护栏执行链。
2. **R26-J2（DEBT_REGISTRY 登记簿闭环）**：
   - 审查了 `src/core/resource/helpers.ts:1270` 处的 1a 标记（伊德海莉 targeted 修复）。按 R24 结论，通用连续通道抽象未开工前该标记严禁擅删，因此 `DEBT_REGISTRY` 必须精准覆盖此标记，确保 5/5 登记完全匹配。
3. **R25-J2（引擎诊断量残留读法防线）**：
   - 盘点引擎写回 `cfg` 的副作用诊断量（`timeFeasibleScale` / `overflowSeconds`）。证明调用前读取恒为 `undefined ?? 1`（此前报的"封顶不激活"实为残留读法伪特征）。按决策走降级闭环，固化工程手册与 `@fact` 契约约束。

---

## 2. 核心改造与实施细节

### 2.1 判据 18 模块化接线 (`scripts/check-guards.mjs`)
- 将 `scripts/check-guards.mjs` 中内联的 ~60 行对账代码重构为统一调用 `scripts/lib/move-element-reconcile.mjs` 的 `reconcileMoveElements`。
- 保留 `auditMoveElementsAgainstRaw(root)` 作为统一入口，严格遵从单一事实源原则。
- 引入三项关键质量防护：
  1. **反空洞下限**：`MOVE_ELEMENT_MIN_SCANNED = 1000`（实测扫码 1049 招，低于下限直接红灯报警，防止解析器失效或数据源丢失）。
  2. **行级字段缺失检出**：区分 `row-wrong`（属性值不符）与 `row-undefined`（属性缺失），违规读数精确对齐行级实际值。
  3. **孤立招式检测**：严格比对 nanoka raw 与 catalog `moveId` 集合，防止招式 ID 体系脱节。
- 保持 `scripts/check-guards.d.mts` 导出面与运行时完全一致，0 死通道告警。

### 2.2 诊断量残留读法防线落位 (R25-J2)
- **文档化归档**：在 `docs/ENGINE_PIPELINE_GUIDE.md` §4 踩坑清单新增「坑 42：『引擎写回 cfg 的诊断量』的残留读法陷阱」，阐明生命周期克隆机制与读点语义。
- **类型定义防线**：在 `src/types/resource/config.ts:792` 中，为 `timeFeasibleScale` 与 `overflowSeconds` 补充明显的副作用警告注释，标明外部消费者读截断秒数必须走 `convergence.timeTruncatedSeconds`。
- **事实与触发器契约**：在 `src/core/resource/helpers.ts:1606` 挂载 `@fact engine:cfg/诊断量写回` 及其配套的 `⟳复核: 检查是否有外部模块误读 timeFeasibleScale 或 overflowSeconds | 到期 2026-12-31` 触发器。

### 2.3 待办账本同步 (`.claude/OPEN-ITEMS.md`)
- 将 R26-J1、R26-J2 与 R25-J2 正式标记为已完成并结案，移除历史未结状态。

---

## 3. 测试与护栏验证矩阵

全部校验在 WSL 原生 Linux 环境下执行，全量通过：

| 校验层级 | 验证命令 | 结果与覆盖面 | 结论 |
| :--- | :--- | :--- | :--- |
| **护栏判据总检** | `node scripts/check-guards.mjs` | **18/18 全绿**（判据 18 报 1049/1049 招达标，判据 5 debt 5/5 完全对齐，口径复核触发器 14/14） | PASS |
| **护栏单元测试** | `npx vitest run src/scripts/__tests__/checkGuards.test.ts` | 114/114 测例全部通过 | PASS |
| **对账器独立测试** | `npx vitest run src/scripts/__tests__/moveElementReconcile.test.ts` | 10/10 测例（含 6 组注入反向证伪与 1 组负控）全部通过 | PASS |
| **TypeScript 编译** | `npm run typecheck` | 0 errors（全类型系统编译无告警） | PASS |
| **资源计算模块测试** | `npx vitest run src/composables/resourceCalc/ src/core/resource/` | 4 个测试文件，14/14 测例全部通过 | PASS |

---

## 4. 后续演进建议

1. **判据 18 全局防护已牢固**：招式属性对账已具备完备的防空洞与行级属性防护，未来新增角色或 nanoka 数据源更新时可自动防范静默属性退化。
2. **待办清偿进展**：随着 R26-J1、R26-J2 与 R25-J2 结案，OPEN-ITEMS 中剩余的纯工程可直接开工项已显著收敛，后续建议继续推进单角色契约录入（如 1041 苍角、1051 伊德海莉等）。
