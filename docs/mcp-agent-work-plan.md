# 多 Agent 工作安排

> 2026-09-22 · 项目：`/home/kaua/projects/zzz-calculator`
> 规划基线：`efac0d73c8055707dac4d66e598482a0100d71e9`
> **这是可直接转交的派工方案，尚未启动其他 agent。** 开工前协调者必须重新核对 HEAD、租约和待办；本文不是实时进度账本。

## 1. 先做什么，为什么这样分

我的建议是 **三条并行工作线 + 一个独立集成验收角色**：先确保验收工具可信，再做有证据的正确性审计，同时补齐少量档案证据。不要同时让多个 agent 大改引擎。

| 角色 | 优先级 | 本轮任务 | 交付 | 启动条件 |
|---|---|---|---|---|
| Agent A：工具链 | P0 | UI 冒烟的失败判定与失败取证 | 可复现反例、修复、回归测试、失败报告样例 | 工作树就绪即可 |
| Agent B：计算正确性 | P1 | 四个执行级 override 标记的来源—消费审计 | 清单、行为证据、是否值得修的结论 | 第一阶段只审计；不得直接大改引擎 |
| Agent C：录入资料 | P1 | 核对 1091 / 1171 / 1431 三个缺失档案 | 有证据的档案段、覆盖边界和未核对项 | 不改角色实现与数值 |
| Agent D：集成与评审 | P0，贯穿 | 审核反例、管理共享文件、合入与统一验收 | 集成提交、完整验证记录、风险清单 | A/C 交付或 B 第一阶段报告到达后 |

### 已核对的事实

- `078c5c1` 已完成配置校验与存储失败处理；`efac0d7` 已完成撤销/重做、属性草稿隔离和倍率缓存刷新。**不重复安排这些功能。**
- 最近一次完整验收是 `3341 passed / 29 skipped`，类型检查、构建和浏览器回归通过；这是基线记录，不代表后续分支自动通过。
- 本轮规划时重新执行 `npm run verify:recording`：`189 checks passed`，仍有 **12 条档案告警**；其中目标三个 ID 是“无该角色档案段”。
- `ui-check.mjs` 的动作查找有 `NOT_FOUND` 返回路径，通用步骤未统一将其判为失败；截图与报告主要写在成功路径。**这是源码审查发现的风险，A 必须先实跑反例，不能把风险描述当成已复现缺陷。**
- `.claude/OPEN-ITEMS.md` 的 R62-J2 仍是候选，并没有证据说明全库 override 都有问题；R65-J1 的 1391 首案已结案，不重做。

## 2. 所有人共用的执行约定

### 环境、隔离与文件所有权

1. 协调者先确认共同 `BASE`，为 A/B/C 准备独立分支与工作树。建议放在已被忽略的 `.zc/worktrees/agent-a`、`agent-b`、`agent-c`；D 使用集成工作树。**这些目录现在并未由本安排创建。**
2. 本文后面的绝对路径是主目录的已核对阅读入口。进入工作树后，读写其对应副本；MCP 若仍打开主目录，文件路径必须带 `.zc/worktrees/<agent>/` 前缀，`wsl_exec.cwd` 则指向工作树的 Linux 绝对路径。路径映射不清楚就停止，不误改主目录。
3. 每人先读 `AGENTS.md`、本任务涉及的导航，再 `zc status` / `zc brief` / `zc claim`。协调者维护逻辑文件所有权表，不能只靠不同工作树中的租约防冲突。
4. **只能改任务白名单。** 新增共享文件需求先交 D 重新分配；README、架构导航、全局样式、package/锁文件、通用类型、护栏阈值和全局待办，默认不由工人顺手修改。
5. 独立工作树内可以做小提交，只 `git add <明确文件>`；不推送、不合并 master。若不得不共用主工作区，工人不操作暂存区或提交，由 D 统一收口。不得清理原有未跟踪文件。
6. 中间报告放各自工作树的 `.zc/reports/A.md`、`B.md`、`C.md`，开工时把**绝对报告路径**告知 D 并固定，不在任务执行中改路径。不得各自往 `docs/` 根目录新增报告，让 README 文档索引在别人的验证中失配。

### 工具、验证与资源

- 所有项目 git/node/npm/测试/构建通过 **MCP `wsl_exec`**；不用 Windows UNC 跑项目命令。长文件分块 `apply_patch`；使用读回版本防覆盖，保持 LF 与原文件执行位。
- 新文件遇到 UNC `Add File` 不支持时，可先用 WSL 短命令独占创建占位，再用带上下文的 `apply_patch` 写入；不要用长 echo/base64 绕过。
- 语义定位用 LSP；有代码修改后调用 `get_diagnostics`。空诊断不能代替类型检查/构建，尤其不能把 `.vue` 无语言服务当成无问题。
- **工人不并发跑 `npm run check` 或 `npm run verify`**，两者都会进入大套件。共用已验 BASE，只跑自己的定向基线与回归，通常 `--maxWorkers=1`；构建也由 D 协调时段。
- UI 浏览器必须用独立 profile、输出目录和 CDP 端口；示例 A 用 9341、D 用 9344。沿用现有浏览器/依赖配置，不自动下载浏览器、字体或改系统设置。
- 全量验证只由 D 在集成后跑一轮。不得同时让多人做全库数值扫描；B 的行为探针和重型测试使用一个串行计算时段。
- MCP 长请求断线不代表命令失败，也不代表没执行：先取执行端日志/退出码；提交类命令先查 git 日志，**不盲目重放**。
- 禁止放宽断言、增加跳过、抬高超时、无归因更新数值快照或以新豁免换绿。合法的正向护栏登记也必须由 D 审核归因。
- 实际调用子代理时再读取当前模型路由配置；本安排不硬编码模型，不调用外部模型，也不把 endpoint/session/凭据写进仓库。

## 3. Agent A 任务书：让 UI 冒烟真的会失败

**给 Agent A 的开工话术：**你只负责 A1。遵守第 2 节，先证明失败判定缺口，再做最小修复；不要重写业务页面或整个自动化框架。

### ① 先读

- `/home/kaua/projects/zzz-calculator/AGENTS.md` §1、§3、§5。
- `/home/kaua/projects/zzz-calculator/scripts/ui-check.mjs`：重点是 `clickText`、`step`、各动作分支以及 catch/finally。
- `/home/kaua/projects/zzz-calculator/scripts/ui-logic-editor-check.mjs`：现有真实交互回归与静态服务生命周期。
- `/home/kaua/projects/zzz-calculator/src/scripts/__tests__/checkGuards.test.ts`：仓库脚本测试风格。

### ② 范围与硬约束

允许改：`scripts/ui-check.mjs`；允许新增 `src/scripts/__tests__/uiCheck.test.ts`；只有确有复用需要时才新增 `scripts/lib/ui-check-runtime.mjs`。后两者在规划时不存在。

不改业务页面、逻辑编辑器 store、计算公式、主题样式、package/锁文件。保持现有 CLI 参数和报告的既有字段兼容；诊断用 `eval:false` 不是动作失败，不要对所有步骤统一用 truthy 判定。

### ③ 工作步骤与验收

1. 在已知正常页面上尝试明确不存在的 tab/button/option，以及仅隐藏或禁用的目标。记录当前退出码与日志，确认到底哪些路径存在假绿。
2. 对“必须命中目标”的动作建立明确失败契约；不把 `NOT_FOUND` / 空点击坐标打印完就当成功。保留合法可见控件的正常路径；有歧义的目标不得静默点错。
3. 失败也写本轮报告：至少能定位失败步骤、目标、原始错误、URL 和 JS 错误。浏览器还能响应时保存截图；不能截图时记录原因，不覆盖最初错误。
4. 防止旧成功产物冒充本轮失败产物：报告应有本轮标识/时间，清除或标明过期截图。启动失败也应非零退出，并尽可能留下诊断；无法写产物时明确报告。
5. 正控与负控均须通过：正常现有流程退出 0；缺控件/禁用/超时/主动抛错退出非 0；负控失败必须命中目标原因，而不是 Chrome 缺依赖或路径写错。

验证顺序：

```bash
npm run check-guards
npx vitest run src/scripts/__tests__/uiCheck.test.ts --maxWorkers=1
npm run build
LOGIC_UI_CDP_PORT=9341 LOGIC_UI_OUT=/tmp/zzz-agent-a-logic node scripts/ui-logic-editor-check.mjs
```

`uiCheck.test.ts` 创建后再执行对应命令。负控另用自己的静态服务运行 `ui-check.mjs --step 'click:__MISSING_CONTROL__'` 等；报告必须填入实际 URL、完整命令、非零退出码与新生成报告的位置，不能把“预期失败”混报成所有测试通过。

### ④ 必交报告

缺口复现表（动作/BASE 行为/修后行为）、兼容性说明、改动路径、正反控完整命令与摘要、一次失败产物样例、浏览器是否清理。若前提不成立，给反证并停下，不造缺陷凑任务。

## 4. Agent B 任务书：执行级 override 来源审计

**给 Agent B 的开工话术：**你先完成 B1 审计，不是接到“全部 override 都要重构”的命令。允许结论为没有值得修的缺陷。

### ① 先读

- `/home/kaua/projects/zzz-calculator/.claude/OPEN-ITEMS.md` 的 R62-J2 与相关否决记录。
- `/home/kaua/projects/zzz-calculator/src/types/resource/execution.ts`。
- `/home/kaua/projects/zzz-calculator/src/composables/resourceCalc/helpers.ts` 中回填与 override 消费处。
- `/home/kaua/projects/zzz-calculator/src/core/resource/rowBuild.ts`。
- `/home/kaua/projects/zzz-calculator/src/core/resource/giftRows.ts`。
- `/home/kaua/projects/zzz-calculator/scripts/lib/dead-channel-ls.mjs`。
- `/home/kaua/projects/zzz-calculator/src/scripts/__tests__/deadChannelLs.test.ts`。
- `/home/kaua/projects/zzz-calculator/src/test/harness.ts`。
- `/home/kaua/projects/zzz-calculator/docs/ENGINE_PIPELINE_GUIDE.md` 的对应管线说明。

### ② 范围与硬约束

本轮只查四个 **boolean 标记**：`damageMultiplierOverride`、`dazeMultiplierOverride`、`anomalyBuildUpOverride`、`decibelRecoveryOverride`。不扩到所有名字含 Override 的字段，不顺手迁移巨型 interface。

B1 生产代码只读。优先利用现有工具；必要的实验脚本留 `.zc/experiments/exec-overrides/`。若需要可持续复用的索引工具，先向 D 申请 `scripts/audit-exec-overrides.mjs` 和 `src/scripts/__tests__/execOverrideAudit.test.ts` 两个新文件，禁止默认扩大范围。

### ③ 工作步骤、证伪闸门与验收

1. 产出四个标记的表：所属符号/对象、写入方、写入阶段、对应值字段、消费者、优先级或缩放规则、现有测试。生产写点与测试写点分开。
2. 同名字段、不同执行行、默认初始化加合法覆盖，不自动算双写缺陷。符号级引用不足时标明盲区，不把 grep 次数当数据流证明。
3. 对风险最高的少量候选做真实管线正反控：使用 `setupHarness`，按 `moveId` 识别行，记录消费阶段的值/来源和最终相关读数；不能只比较总伤害。
4. 先核对各通道的 0、负值、缺省值以及合法的后续缩放口径。不能把“值变化”都判为覆盖失效，也不能把不同效果一律相加/相乘。
5. 闸门：证明有错误覆盖、绕过消费者或重复计量，才提出 B2 定点修复。只有一例就点修；至少多个独立同形实例且噪声可控，才讨论通用护栏。没有真缺陷时 B1 正常交付，B2 不立项。

基础核对可运行：

```bash
npm run check-guards
npx vitest run src/core/__tests__/giftRows.test.ts src/scripts/__tests__/deadChannelLs.test.ts --maxWorkers=1
```

这些既有测试**不代表审计已完成**。每条候选还须有实际执行的探针/相关测试命令和结果；新测试若需要落到 src，先取得明确文件授权。B1 不自动提交一次性实验工具，不强行造一个长期维护的扫描器。

B2 必须另拿到：已确认的缺陷编号、精确写入白名单、先写下的预测值、负控、预期影响范围。涉及数值变化要量差并解释，不能先重生成基线。

### ④ 必交报告

四标记覆盖表、候选分类（已确认/正常覆盖/证伪/待裁决）、最小行为证据、未覆盖边界、B2 是否立项及精确文件提案。**B1 完成与 B2 获准是两回事。**

## 5. Agent C 任务书：三份角色档案的证据核对

**给 Agent C 的开工话术：**你只核对三个缺失档案，不做“为了清告警而宣布实现完整”的工作。

### ① 先读

- `/home/kaua/projects/zzz-calculator/docs/AGENT_RECORDING_SOP.md`。
- `/home/kaua/projects/zzz-calculator/docs/MECHANICS_IMPLEMENTATION.md`。
- `/home/kaua/projects/zzz-calculator/scripts/verify-recording.mjs`：明确机器检查能证明什么、不能证明什么。
- `/home/kaua/projects/zzz-calculator/src/specs/agents/1091.json`。
- `/home/kaua/projects/zzz-calculator/src/specs/agents/1171.json`。
- `/home/kaua/projects/zzz-calculator/src/specs/agents/1431.json`。
- `/home/kaua/projects/zzz-calculator/src/mechanics/registry.ts`，再读实际注册的角色模块；不凭名字猜模块归属。
- `/home/kaua/projects/zzz-calculator/src/mechanics/__tests__/miyabiCinema.test.ts`。
- `/home/kaua/projects/zzz-calculator/src/mechanics/__tests__/burnice.test.ts`。
- `/home/kaua/projects/zzz-calculator/src/mechanics/__tests__/yeshuguang.test.ts`，以及引用链需要的相关用例。

### ② 范围与硬约束

仅允许修改 `docs/MECHANICS_IMPLEMENTATION.md` 的这三个角色段，外加自己的报告。其余 9 条告警留后续批次，避免多人抢同一文档。

不得改实现、数值、spec 状态、`data/recordings/legacy.json` 或验证脚本；不手改生成的 `implementation-status.md`。未审阅原文契约的角色仍属于 legacy，不因补了一段档案就改成“完整验收”。

### ③ 工作步骤与验收

1. 用 `node scripts/resolve.mjs agent <ID>` 查证实体；记录 spec → 注册模块 → 活消费者 → 行为测试的证据路径。
2. 给每个目标写清“当前实现状态”、已核对范围、已知近似/未建模项、待核对部分。引用具体文件/符号/测试，不复制一大份易漂移的倍率表。
3. 不把“文件有 expect”当作机制已经生效。能证明到哪里就写到哪里；证据不足时保留不确定性并报阻塞，不猜数值或补空话。

```bash
npm run verify:recording
npx vitest run src/mechanics/__tests__/miyabiCinema.test.ts src/mechanics/__tests__/burnice.test.ts src/mechanics/__tests__/yeshuguang.test.ts --maxWorkers=1
npm run check-guards
```

目标是三个指定缺档案告警有依据地消除、不新增 FAIL；其他内容不变时总 WARN 预计 12→9。**总数不是口径真假的替代品**，并行变动或证据不足必须逐项说明，不硬凑数字。纯文档工作无需单独占用全量构建时段。

### ④ 必交报告

三个 ID 各一行证据清单、已确认/未确认边界、实际通过的测试及其覆盖范围、告警前后差异。明确写出“本轮是档案核对，不是三个角色完整录入验收”。

## 6. Agent D 任务书：独立评审与统一集成

**给 Agent D 的开工话术：**你负责可信合入，不用“测试全绿”替代证据审查，不替作者偷改实现凑绿。

### ① 先读

- `/home/kaua/projects/zzz-calculator/AGENTS.md` §5。
- `/home/kaua/projects/zzz-calculator/docs/mcp-workspace-integrity.md`。
- `/home/kaua/projects/zzz-calculator/docs/mcp-logic-editor-history.md`。
- 本安排和 A/B/C 的固定报告路径；提交的真实 diff，而不只是作者总结。

### ② 权限与约束

管理 BASE、分支/工作树、逻辑文件所有权、重计算时段及报告路径。共享 README/导航/待办统一更新；不改工人白名单之外的实现替其兜底。需要扩范围就退回原作者或另立任务。

独立核查 A 的失败是否真的可被检测、产物是否属于本轮；核查 C 是否把机器告警清零误当语义完成；核查 B 的候选是否已被旧记录裁决或证伪。发现重复立项立即停止。

### ③ 合入顺序与放行门槛

1. **A → C → 可选 B2**。B1 的研究结论可以单独接受，不应阻塞已完成的 A/C；B2 不会因为 B1 写了长报告而自动获准。
2. 每个任务一笔或少量清晰提交；禁止混入无关 WIP。合并冲突交原作者确认，不做看不懂的机械选择。
3. 运行相关定向测试，再在其他工人停止重计算后执行一次：

```bash
VITEST_MAX_WORKERS=4 npm run verify
LOGIC_UI_CDP_PORT=9344 LOGIC_UI_OUT=/tmp/zzz-agent-d-logic node scripts/ui-logic-editor-check.mjs
```

4. A 的缺控件/禁用/抛错负控必须仍非零，并有新失败报告。源码/测试如有改动，复核诊断与本轮验证文件指纹；全绿后不得再悄悄改源码而不补验。
5. 对照 BASE 的 3341 个通过用例与 29 个既有跳过：解释新增/减少/跳过变化；未授权不得删除测试或提高预算。保留真实告警，不能靠修改阈值作假。
6. `zc done --verifier ... --coverage ... --risk ...` 留痕并释放租约。推送和涉及业务口径的最终裁决仍留给用户，不自动执行。

### ④ 必交报告

纳入与未纳入的提交、实际改动范围、定向/全量/浏览器命令及退出码、测试数量变化、已保留告警、剩余风险和下一批建议。明确区分“已实现”“审计完成但不立项”“等待用户裁决”。

## 7. 暂不派工的事项

- D1：未认领招式的易伤回落口径；D2：角色字段迁出巨型接口；D3：删除 `core/attributeRefs.ts`；D4：跨页控制面板/图表样式统一。都已有等待用户裁决的记录，不夹带实施。
- 不重做已结案的逻辑编辑器安全与历史功能、1391 喧响上限首案、R35-J1 已证伪重构或 R48-J2 泛化机械扫描。
- 不因一次测试耗时变化就宣布性能退化。本轮不派盲目性能重写；若另立性能任务，先固定提交、线程数和场景，做可比重复测量与 profile，不能直接放宽超时。
- 不同时全面清空 59 个 legacy、372 条历史状态表或所有待复核事实。先用小批次建立证据与可复用判据。

## 8. 统一汇报模板与检查点

每个 agent 最初回复：确认 BASE / 自己的工作树 / 已认领文件 / 绝对报告路径 / 首个证伪实验。只有这些明确后才开始写。

第一个检查点交**复现或反证**，第二个检查点交**实现或不立项结论**；不许跳过第一步，直接交大 diff。工时随现场而变，不以到点必须产出代码为目标。

```text
STATUS: done | blocked
TASK: A1 / B1 / B2 / C1 / D-INT
BASE: <实际提交>
WORKTREE / BRANCH: <实际路径与分支>
CLAIMED / CHANGED: <认领与真正改动的文件，分别列>
VERDICT: fixed | confirmed | disproved | needs-decision
EVIDENCE: <前提、最小反例、反控、观测结果、代码/测试引用>
VERIFICATION: <cwd、命令、退出码、摘要、原始日志/产物路径>
LIMITS: <没有证明什么、保留告警、未覆盖场景>
COMMITS: <提交或明确说明只交报告>
NEXT: <是否需要新授权、下一步具体建议>
```

报告首行和最终回复都带 STATUS。这是报告模板，交付时必须填实际信息，不能原样留占位符。若 B1 证伪：B1 可以完成，但明确标记 B2 不立项；若需要业务裁决则写 blocked 并列出精确问题。

---

本文初版只编制工作安排；以下为后续实际开发的独立范围，不把初版任务状态当作当前现场。

## 7. UI 冒烟启动阶段补漏（2026-09-24）

### 已复现缺口与方案

- 前提：A1.b 已覆盖页面动作失败，但浏览器发现、spawn 和 CDP 握手仍在报告 finally 之外。
- 实测反例：`node scripts/ui-check.mjs --chrome <不存在的路径> --out <隔离目录>` 退出 1，
  stderr 为未处理的 spawn ENOENT；目录只剩旧成功报告的 stale 副本，没有本轮失败 JSON。
  浏览器发现失败直接 process.exit；进程提前退出仍等待 CDP。这些不是页面业务缺陷。
- 修复：启动移入既有 try/finally；捕获进程 error/早退，连接请求有界；缺浏览器时也建输出目录与写报告。
  旧成功和失败产物统一改名；报告增加 phase、screenshot、artifactError，保留旧字段与成功文件名。
  截图请求最多等 5 秒；无法截图时写明失败，不拿旧失败 PNG 充数；启动失败即使 --keep-open 也清理子进程。
- 证伪闸门：真实 CLI 在缺浏览器、spawn ENOENT、提前退出三种情形都必须非零退出、写本轮 fail JSON、
  不残留旧的当前文件名；正常浏览器正控必须保持 PASS，页面动作负控仍须 FAIL。

### 验证入口与边界

- `src/scripts/__tests__/uiCheckStartup.test.ts`：不依赖安装 Chromium，直接运行 CLI；新增三例在旧代码下全部失败，修复后通过。
- `VITEST_MAX_WORKERS=4 npx vitest run src/scripts/__tests__/uiCheckStartup.test.ts src/scripts/__tests__/uiCheck.test.ts`：41/41 通过。
- 改动前 `VITEST_MAX_WORKERS=4 npm run check`：3472 passed / 29 skipped；原始日志 `.zc/ui-startup/baseline.log`。
- 改动后同命令：3475 passed / 29 skipped（恰好新增 3 条 CLI 回归），日志 `.zc/ui-startup/final-check.log`；
  `npm run build` 通过（保留大 chunk 提示）；`npm run verify:recording` 189 passed / 6 warn，未降低档案要求。
- 真实 Chromium 同目录连续正反控：`--step eval:false` 退出 0 / pass；`--step click:__ARENA_MISSING_BUTTON__`
  退出 1 / fail，两轮均有对应截图与报告，phase 均为 page；产物 `.zc/ui-startup/browser/`。
- 两个改动代码文件的 `get_diagnostics` 均无 error/warning；`git diff --check` 通过。
- 影响范围仅 UI 验收脚本及其测试，不改计算公式、角色数据或页面。输出目录不可写时无法承诺磁盘报告，必须非零退出并报 stderr。
- 最终集成验证以本轮 `.zc/journal.jsonl` 的 verifier 为准；共享工作区其他车道改动不属于本修复。
