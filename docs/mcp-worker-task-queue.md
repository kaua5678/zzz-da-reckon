# 低级模型任务队列（活文档）

> 给 dsh（DeepSeek Harness，子代理路由见 `AGENTS.md` §6）等低成本工人**直接执行**的自包含任务卡。
> 主代理（或用户）挑卡派发；工人只读卡里点名的文件，不需要读 `AGENTS.md` 全文或 `.claude/OPEN-ITEMS.md`。
> 每张卡 = `AGENTS.md` §5 四段式（先读 / 硬约束 / 验收 / 报告）+ §4 证伪闸门（前提假设 + 可观察失败）。
> **维护**：卡只由主代理写，工人不改本文件；卡经主代理复核合入后**删卡**，结论进提交说明，不在此留编年。
> 需要用户裁决、或需要主代理先做设计的活条目不进本队列，留在 `.claude/OPEN-ITEMS.md`。

## 0. 派发与回收

在 WSL 仓库根（`/home/kaua/projects/zzz-calculator`）执行，`CARD` 换成卡号：

```bash
CARD=W2
BRIEF="$(awk -v c="$CARD" '$0=="<!-- card:" c " -->"{f=1;next} $0=="<!-- /card:" c " -->"{f=0} f' docs/mcp-worker-task-queue.md)"
test -n "$BRIEF" || echo "卡 $CARD 不存在"
setsid nohup /home/kaua/.local/node/bin/dsh --profile headless "$BRIEF" \
  > /tmp/worker-$CARD.out 2> /tmp/worker-$CARD.err < /dev/null & disown
```

- **必须 `setsid` 脱离会话**：经 `wsl_exec` 起的后台进程会在工具返回时收到 SIGHUP；`nohup` 挡不住
  npm 派生的子进程（子进程的信号处置会被重置为默认），2026-09-24 实测 `npm run check` 因此以 EXIT=129 被杀。
- 并发上限：同时最多 2 个工人、1 个重计算时段（全量 vitest / build / 浏览器）；同一文件不派给两个工人（§5-3）。
- 工人报告首行 `STATUS: done|blocked`，路径写在卡里；`/tmp/worker-<卡>.err` 是推理过程，报告丢失时 `tail` 它回收。
- 主代理复核 = `docs/mcp-lead-agent-handoff.md` §7：看真实 diff 是否越白名单、亲自重放一条正控一条负控、
  核对产物时效；然后显式路径提交、`node scripts/zc.mjs done` 留痕、删卡。
- **两个写工人并行**：第二个放进隔离 worktree（`git worktree add --detach /tmp/wt-<卡> HEAD` 后软链 `node_modules`），
  卡里写明工作区路径、禁止碰主仓库；合入 = `git -C /tmp/wt-<卡> diff > x.diff`，复核后在主仓库 `git apply`，
  再 `git worktree remove --force /tmp/wt-<卡>`（只删软链本身，主仓库依赖不受影响；2026-09-24 W7 实测）。
- **负控的还原**：在有未提交改动的树上做负控，先 `cp` 备份再改、用备份还原；**不要** `git checkout -- <文件>`
  （会把工人的改动一起抹掉，2026-09-24 复核 W7 时踩过，按工人报告里的 diff 补回）。

## 1. 队列

| 卡 | 标题 | 类型 | 写入白名单 | 状态 |
|---|---|---|---|---|

| W10 | 青衣(1251) / 橘福福(1391)档案取证与草稿 | 只读取证 | `.zc/reports/W10-dossier.md` | 待派发 |
| W11 | 卢西娅·艾洛温(1451) / 般岳(1471)档案取证与草稿 | 只读取证 | `.zc/reports/W11-dossier.md` | 待派发 |
| W12 | 琉音(1481) / 星徽·比利(1531)档案取证与草稿 | 只读取证 | `.zc/reports/W12-dossier.md` | 待派发 |

本批先交证据及草稿，不直接写共享档案；主代理审查后串行合入 `docs/MECHANICS_IMPLEMENTATION.md`。
R62-J3 当前 HEAD 行为指纹刷新、R37-J5 §19.6-a 留白归因仍是候选，不随本批自动启动。

### 本批立项证据与放行边界

- 2026-09-24，BASE `143d3233766fda256161a4cd5a93ef4553d4eaa6`：实跑 `npm run verify:recording` 为 189 passed / 6 warn，
  六条均为上述角色缺档案段；3 份 evidence contracts、59 个 legacy 未逐条复核。**缺档案不等于缺机制，补档案不等于原文验收。**
- `dsh --profile headless` 的 pong 自检通过；只读取证任务 `DOC-PREFLIGHT-1251` 已返回 done（命令退出 0）。
  本批 W10–W12 尚未派发。现场路由文件声明 `wb/deepseek-v4.1-flash`；本次未审计实际模型请求日志，不将配置冒充执行回执。
- 主代理独立读回 `qingyi.ts:373-392`、`qingyi.test.ts:45-109`、`teamHook.test.ts:165-181`，确认工人所指注册对象和断言存在；
  `resourceIncome.ts:98-100,128,180` 确有 C4 回能消费。工人未追到消费端不等于死通道。
- 不采纳工人将整个 spec 概括为死数据的建议：`1251.json:15-27` 仍有声明式额外能力条件；必须逐字段追消费者。
  状态行的“部分实现”也不能仅由测试未覆盖推导：**未证明 ≠ 未实现**，应分别写当前建模范围与验证边界。
- 前提假设：模块、活消费者与现有测试足以支持有限范围的档案草稿。
  可观察失败：发现声明与行为冲突、需新的业务裁决或无法定位消费者 ⇒ 对该结论标 unknown/blocked，不靠补一句状态行消 WARN。
- 主代理收卡：先读引用代码与真实 diff，再重放代表性测试；确认通过后逐段合入，检查告警只减少已接受角色的条数。
  两个角色均有充分证据时该卡预期减少 2 条 WARN，否则允许只接受一段或不合入。不能改 spec status、legacy 或检查器凑数。

## 2. 任务卡

<!-- card:W10 -->
### W10 · 青衣(1251)、橘福福(1391)档案取证与草稿

你是执行工人，只完成本卡，不继续委派。TASK_ID=W10。
工作区 `/home/kaua/projects/zzz-calculator`；参考 BASE `143d3233766fda256161a4cd5a93ef4553d4eaa6`。
开工打印真实 HEAD 和 `git status --short`，有漂移则按新文件重新取证，不 reset 回 BASE。
父目标：为两个缺失档案段提供可审查草稿，不实现或重新裁决机制。

**先读**（以下相对路径均相对于上述绝对工作区）：
1. `AGENTS.md` §1、§5；`docs/MECHANICS_IMPLEMENTATION.md` 前 28 行及现有相邻档案格式。
2. `src/mechanics/index.ts`，`src/mechanics/agents/` 下 qingyi.ts、specPanelBuffs.ts（jufufuTigerRoarMechanic）；`src/specs/agents/` 下 1251.json、1391.json。
3. 定向测试 `src/mechanics/__tests__/qingyi.test.ts`、`src/mechanics/__tests__/jufufu.test.ts`、`src/mechanics/__tests__/teamHook.test.ts`；`data/recordings/legacy.json`。
   只沿上述模块的字段读写链补读必要消费者；不全仓漫游。青衣 C4 追 src/core/resource/resourceIncome.ts；橘福福喧响上限先读 docs/mcp-r65j1-decibel-cap-verdict.md，不重开已裁决不做项。

**硬约束与证伪闸门**：只可写 `/home/kaua/projects/zzz-calculator/.zc/reports/W10-dossier.md`（先 mkdir -p .zc/reports 并 zc claim 此报告）。
其余一律只读，尤其档案、模块、测试、spec、catalog、legacy、规则、队列与全局配置；不提交/推送，不清理工作树，不修改快照或超时。
前提是活模块及现有断言能支撑有限档案；找不到消费者、声明行为相悖或须裁决时写 unknown/blocked，不猜新口径。
不把 notes 自述、grep 命中、测试文件存在或 C6 总伤变化当作逐条机制已验收。未测与未实现分栏。

**步骤与验收**（WSL 内执行；不得跑全量 check/verify/build）：
1. 对 1251 / 1391 分别执行 `node scripts/resolve.mjs agent <id>` 核对实体；核对是否已有档案，已补则报告漂移，不重复造段。
2. 列出每项草稿结论的“声明 → 注册/钩子 → 实际消费者 → 断言”证据，每项附路径:行与符号。
3. 向主代理确认取得唯一测试时段后执行 `VITEST_MAX_WORKERS=4 npx vitest run src/mechanics/__tests__/qingyi.test.ts src/mechanics/__tests__/jufufu.test.ts src/mechanics/__tests__/teamHook.test.ts`，记录退出码及 passed/skipped。
   未获时段则交纯取证报告并明确测试未运行，不自行并发重计算。测试红则读错误并报告，不改代码/断言。
4. 草稿每段标题含 agentId；状态行遵照档案格式，日期用实际核对日；分列建模范围、已验证范围、未证明事项。
   不因 legacy 豁免而宣称原文已验；不凭无测试宣布未建模。足以写结论才写，证据不足可不交状态行。

**固定报告与收工**：报告首行及最终回复均为 `STATUS: done|blocked`。正文含 HEAD、实际阅读范围、证据矩阵、
两段可合入草稿、原始命令/退出码/结果摘要、测试未覆盖项、所有写入路径及未做事项。done 仅表示取证完成，不表示机制验收。
用 `zc done --verifier '<实际运行命令或只读取证>' --coverage '.zc/reports/W10-dossier.md' --risk '<未证明事项>'` 释放本卡租约。
主代理独立审查后才串行写入共享档案；工人不得自行消 WARN 或删任务卡。
<!-- /card:W10 -->

<!-- card:W11 -->
### W11 · 卢西娅·艾洛温(1451)、般岳(1471)档案取证与草稿

你是执行工人，只完成本卡，不继续委派。TASK_ID=W11。
工作区 `/home/kaua/projects/zzz-calculator`；参考 BASE `143d3233766fda256161a4cd5a93ef4553d4eaa6`。
开工打印真实 HEAD 和 `git status --short`，有漂移则按新文件重新取证，不 reset 回 BASE。
父目标：为两个缺失档案段提供可审查草稿，不实现或重新裁决机制。

**先读**（以下相对路径均相对于上述绝对工作区）：
1. `AGENTS.md` §1、§5；`docs/MECHANICS_IMPLEMENTATION.md` 前 28 行及现有相邻档案格式。
2. `src/mechanics/index.ts`，`src/mechanics/agents/` 下 luciaElowen.ts、banyue.ts；`src/specs/agents/` 下 1451.json、1471.json。
3. 定向测试 `src/mechanics/__tests__/luciaElowen.test.ts`、`src/mechanics/__tests__/banyue.test.ts`；`data/recordings/legacy.json`。
   只沿上述模块的字段读写链补读必要消费者；不全仓漫游。banyue.ts 已见其他车道租约，只读不接管；涉及时间口径先读 docs/ENGINE_PIPELINE_GUIDE.md §4 时间三本账及坑19。

**硬约束与证伪闸门**：只可写 `/home/kaua/projects/zzz-calculator/.zc/reports/W11-dossier.md`（先 mkdir -p .zc/reports 并 zc claim 此报告）。
其余一律只读，尤其档案、模块、测试、spec、catalog、legacy、规则、队列与全局配置；不提交/推送，不清理工作树，不修改快照或超时。
前提是活模块及现有断言能支撑有限档案；找不到消费者、声明行为相悖或须裁决时写 unknown/blocked，不猜新口径。
不把 notes 自述、grep 命中、测试文件存在或 C6 总伤变化当作逐条机制已验收。未测与未实现分栏。

**步骤与验收**（WSL 内执行；不得跑全量 check/verify/build）：
1. 对 1451 / 1471 分别执行 `node scripts/resolve.mjs agent <id>` 核对实体；核对是否已有档案，已补则报告漂移，不重复造段。
2. 列出每项草稿结论的“声明 → 注册/钩子 → 实际消费者 → 断言”证据，每项附路径:行与符号。
3. 向主代理确认取得唯一测试时段后执行 `VITEST_MAX_WORKERS=4 npx vitest run src/mechanics/__tests__/luciaElowen.test.ts src/mechanics/__tests__/banyue.test.ts`，记录退出码及 passed/skipped。
   未获时段则交纯取证报告并明确测试未运行，不自行并发重计算。测试红则读错误并报告，不改代码/断言。
4. 草稿每段标题含 agentId；状态行遵照档案格式，日期用实际核对日；分列建模范围、已验证范围、未证明事项。
   不因 legacy 豁免而宣称原文已验；不凭无测试宣布未建模。足以写结论才写，证据不足可不交状态行。

**固定报告与收工**：报告首行及最终回复均为 `STATUS: done|blocked`。正文含 HEAD、实际阅读范围、证据矩阵、
两段可合入草稿、原始命令/退出码/结果摘要、测试未覆盖项、所有写入路径及未做事项。done 仅表示取证完成，不表示机制验收。
用 `zc done --verifier '<实际运行命令或只读取证>' --coverage '.zc/reports/W11-dossier.md' --risk '<未证明事项>'` 释放本卡租约。
主代理独立审查后才串行写入共享档案；工人不得自行消 WARN 或删任务卡。
<!-- /card:W11 -->

<!-- card:W12 -->
### W12 · 琉音(1481)、星徽·比利(1531)档案取证与草稿

你是执行工人，只完成本卡，不继续委派。TASK_ID=W12。
工作区 `/home/kaua/projects/zzz-calculator`；参考 BASE `143d3233766fda256161a4cd5a93ef4553d4eaa6`。
开工打印真实 HEAD 和 `git status --short`，有漂移则按新文件重新取证，不 reset 回 BASE。
父目标：为两个缺失档案段提供可审查草稿，不实现或重新裁决机制。

**先读**（以下相对路径均相对于上述绝对工作区）：
1. `AGENTS.md` §1、§5；`docs/MECHANICS_IMPLEMENTATION.md` 前 28 行及现有相邻档案格式。
2. `src/mechanics/index.ts`，`src/mechanics/agents/` 下 liuyin.ts、starlightBilly.ts；`src/specs/agents/` 下 1481.json、1531.json。
3. 定向测试 `src/mechanics/__tests__/liuyin.test.ts`、`src/mechanics/__tests__/billySmoke.test.ts`；`data/recordings/legacy.json`。
   只沿上述模块的字段读写链补读必要消费者；不全仓漫游。星徽·比利不是普通比利：只接受明确绑定 1531 的断言，不能按 billy 文件名推定覆盖；liuyin.ts 的他人租约不得接管。

**硬约束与证伪闸门**：只可写 `/home/kaua/projects/zzz-calculator/.zc/reports/W12-dossier.md`（先 mkdir -p .zc/reports 并 zc claim 此报告）。
其余一律只读，尤其档案、模块、测试、spec、catalog、legacy、规则、队列与全局配置；不提交/推送，不清理工作树，不修改快照或超时。
前提是活模块及现有断言能支撑有限档案；找不到消费者、声明行为相悖或须裁决时写 unknown/blocked，不猜新口径。
不把 notes 自述、grep 命中、测试文件存在或 C6 总伤变化当作逐条机制已验收。未测与未实现分栏。

**步骤与验收**（WSL 内执行；不得跑全量 check/verify/build）：
1. 对 1481 / 1531 分别执行 `node scripts/resolve.mjs agent <id>` 核对实体；核对是否已有档案，已补则报告漂移，不重复造段。
2. 列出每项草稿结论的“声明 → 注册/钩子 → 实际消费者 → 断言”证据，每项附路径:行与符号。
3. 向主代理确认取得唯一测试时段后执行 `VITEST_MAX_WORKERS=4 npx vitest run src/mechanics/__tests__/liuyin.test.ts src/mechanics/__tests__/billySmoke.test.ts`，记录退出码及 passed/skipped。
   未获时段则交纯取证报告并明确测试未运行，不自行并发重计算。测试红则读错误并报告，不改代码/断言。
4. 草稿每段标题含 agentId；状态行遵照档案格式，日期用实际核对日；分列建模范围、已验证范围、未证明事项。
   不因 legacy 豁免而宣称原文已验；不凭无测试宣布未建模。足以写结论才写，证据不足可不交状态行。

**固定报告与收工**：报告首行及最终回复均为 `STATUS: done|blocked`。正文含 HEAD、实际阅读范围、证据矩阵、
两段可合入草稿、原始命令/退出码/结果摘要、测试未覆盖项、所有写入路径及未做事项。done 仅表示取证完成，不表示机制验收。
用 `zc done --verifier '<实际运行命令或只读取证>' --coverage '.zc/reports/W12-dossier.md' --risk '<未证明事项>'` 释放本卡租约。
主代理独立审查后才串行写入共享档案；工人不得自行消 WARN 或删任务卡。
<!-- /card:W12 -->

## 3. 本队列的来源：2026-09-24 OPEN-ITEMS 分诊

- `.claude/OPEN-ITEMS.md` 分诊前 1810 行 / 63 条：47 条标题已写结案却没删（`scanOpenItemsHygiene` 在原件上的读数）；
  另有标题没写结案、实际早已完成或被证伪的条目仍被当现状——R23-N1（`7d8b7d4` + `69c4bd4`，判据 18 已接线）、
  §1 的 D3（`69310ba` 已删文件）、R22-E1（`10174d8`）、R21-N1/N2、R31-J2、R48-J2（各自证伪闸门已成立）。
  8 条状态不明的条目由 2 个只读 dsh 工人逐条取证（报告带提交号与文件:行），lead 各抽查 2–3 处后接受；
  其中 R35-J3 被工人纠正为「仍活」（现有死导出工具只量零引用面，与该条的过度导出面正交）⇒ 写成 W5。
- 处置：结案条目**逐字**移到 `.claude/archive/`（每条注原行号与分诊证据，否决全文可检索），主文件只留活条目：
  分诊后 125 行 = §1 用户裁决 8 项（补登 09-22 交接升级的 R2-E F1–F3、R2-C 与 R37-J5 同族口径包）+
  §2 活条目 5 条（R22-D1、R37-J5 按核实结果改写）+ §3 否决摘要 11 条。
- 根因：删条目是纯手工步骤、没有机器提示 ⇒ 已接进 `zc status`（`scanOpenItemsHygiene`：只看标题行，只报不红），
  由本队列首张卡 W1 经 dsh 工人实现、lead 复核后合入。
- 顺带：`AGENTS.md` §4 称 OPEN-ITEMS「已 gitignore」，实际 `.gitignore` 只忽略了 `task-ledger*.md` 与 `ledgers/`，
  66 项 `.claude/*` 工作文件（`git status` 口径）一直计入 `zc status` 的「工作区改动」，淹没并行会话信号
  ⇒ 已按 §4 原意补忽略（工作区改动 80 → 11）。
- 工人实测耗时：只读取证 4 条 / 卡用了 19–28 分钟（逐条翻 git 历史与历轮交接），边界清晰的实现卡 W1 约 5 分钟
  ⇒ **卡越窄，低级模型越快越准**；取证类任务宜每卡 ≤ 2 条。
- 第 2 轮（2026-09-24）实测：只读普查 W2（21 条判据）22 分钟、W3 / W4 / W5 各约 5 分钟；实现卡 W6 约 10 分钟、
  W7 4 分钟、W8 6.5 分钟、W9 3.5 分钟。8 张卡全部 `STATUS: done`，复核发现 3 张有瑕疵：W6 缺落点同一性断言（适配层吞掉返回 index 时
  原测试全绿，主代理补上并实测可红）、W2 漏判判据 18（lib 层下限测的是空目录，接不住整目录改名，并进 W8 修）、
  W4 越界用 `rm` 清了自建的临时目录（已如实披露，未碰仓库）。
  ⇒ 低级模型能把「写什么」做对，「证明它能红」仍要主代理自己变异一次。
