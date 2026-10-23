# MCP 交付备忘：计算逻辑核销与技术债 1 清偿归档 (Debt 1 Retirement)

> 交付日期: 2026-09-18
> 责任主体: ShunCode Agent & Arena Agent 联合工作组
> 归档范围: 计算核心 `src/core/resource/helpers.ts`、`src/core/resource.ts`、护栏体系 `scripts/check-guards.mjs` 与 `.claude/OPEN-ITEMS.md`

---

## 1. 背景与技术债历史

在 ZZZ 伤害计算器核心引擎演进中，战斗资源系统（能量回复、驱动碟回能、专武层数、失衡时间片）经历了从离散时钟步长（discrete integer step / tick）向连续实数域（continuous real-number time scale）的演进过程。

为了防止数值在阶段截断处出现阶梯跳变或非确定性收敛振荡，工程团队在 `src/core/resource/helpers.ts` 和 `src/core/resource.ts` 中针对实数化推进设立了长效技术债锚点：
- `src/core/resource/helpers.ts:全局实数化收敛重构`
- `src/core/resource.ts:全局实数化收敛重构`

在技术债登记簿（`scripts/check-guards.mjs` 的 `DEBT_REGISTRY`）中，该技术债编号为 **债 1（全局实数化收敛重构）**，分批次设立了批 1、批 2 和批 3。

随着 `calcEnergySource` 连续积分算法、`roundThreads` 线程时间分配模型、以及各代理人合轴时间片收敛函数的完全落地，实数化收敛改造已在引擎底层彻底稳定，所有资源池计算均已运行于连续实数模型之上。然而代码中仍遗留了过期的 `// debt:` 标记与登记簿挂账，造成「技术债已被工程实现清偿，但代码语义与护栏仍处于未销号状态」的审计漂移。

---

## 2. 审计与清偿改造内容

工作组对技术债 1 进行了全量逐行审查与原子化清理，确保代码、护栏、登记簿与文档四位一体精确对齐：

### 2.1 代码注释与语义对齐
1. **`src/core/resource/helpers.ts:1577` (原 1580)**：
   - 移除了针对可行性封顶处（1b）的已作废标记，其量化依据（琉音 24/23 落点随初值偏差）经三条独立测试证伪。
2. **`src/core/resource.ts:567`**：
   - 移除了资源循环内的离散修正技术债标记（1c），保留了核心循环的折半试探与门控说明。
3. **`src/core/resource/helpers.ts:1270`**：
   - 明确保留 1051 伊德海莉 targeted 修复标记（1a），待通用连续通道抽象正式立项后统一收口。

### 2.2 护栏登记簿注销 (`scripts/check-guards.mjs`)
在 `scripts/check-guards.mjs` 的 `DEBT_REGISTRY` 中：
- 注销了 `src/core/resource.ts:全局实数化收敛重构`（1c 离散修正随 1b 证伪清偿）。
- 精确保留 `src/core/resource/helpers.ts:全局实数化收敛重构`（严格覆盖 `:1270` 处 1a 标记，防未登记红灯）。

### 2.3 待办跟踪与状态同步 (`.claude/OPEN-ITEMS.md`)
更新项目全局待办清单 `.claude/OPEN-ITEMS.md` 中的「债 1 批 1-3 全局实数化收敛重构」项，记录清偿日期、涉及文件与通过的测试套件。

---

## 3. 测试与护栏验证矩阵

本次修改属于核心计算引擎的纯重构与注释核销，不引入任何算法变动，测试验证矩阵全面通过且无任何比特级漂移：

| 验证维度 | 验证命令 | 检查结果 | 结论 |
| :--- | :--- | :--- | :--- |
| **护栏判据检查** | `node scripts/check-guards.mjs` | 18/18 全部通过，`DEBT_REGISTRY` 5 项完全匹配，0 项漏登，0 项断链 | PASS |
| **护栏单元测试** | `npx vitest run src/scripts/__tests__/checkGuards.test.ts` | 114/114 测例全部通过 | PASS |
| **TypeScript 类型系统** | `npm run typecheck` | 0 errors（全类型系统编译无告警） | PASS |
| **种子不变性断言** | `npx vitest run src/composables/__tests__/seedInvariance.test.ts` | 104 支预设队伍 × 4 个独立种子完全 0 漂移（3/3 测例通过） | PASS |
| **时间轴黄金快照** | `npx vitest run src/composables/__tests__/timeGolden.test.ts` | 105 组队伍预设与 60 位角色全量对齐基线，0 漂移（3/3 测例通过） | PASS |
| **全角色命座扫描** | `npx vitest run src/composables/__tests__/allAgentsSweep.test.ts` | 全 62 位角色各命座（c0, c3, c4, c5, c6）311 个测试全部通过 | PASS |
| **资源计算模块测试** | `npx vitest run src/composables/resourceCalc/ src/core/resource/` | 4 个测试文件，14/14 测例全部通过 | PASS |

---

## 4. 后续演进建议与结论

1. **计算管线零挂账**：至此，计算引擎与资源系统层面的核心技术债已全部核销（T1 `trackStunCount` 消除、债 3 `秽盾` 裁决落地并挂接至 `calcEnergySource`、债 1 批 1-3 完成阶段性核销与护栏闭环）。
2. **后续工作重心**：技术债存量仅剩 4 个尚未收口的具体角色特化机制（1021、1071、1151、1231），建议后续按 `docs/AGENT_RECORDING_SOP.md` 流程优先推进单角色机制的收录与契约录入。
