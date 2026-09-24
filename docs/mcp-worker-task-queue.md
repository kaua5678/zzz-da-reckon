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
| W9 | verify:recording ③ 档案段定位修正（9 条 WARN 里 3 条误报、5 条标签错） | 脚本修正 + 测试（S） | `scripts/lib/recording.mjs` · `scripts/lib/recording.d.mts` · `scripts/verify-recording.mjs` · `recording.test.ts` | 可派 |

## 2. 任务卡

### W9 · verify:recording ③ 档案段定位修正

<!-- card:W9 -->
你是执行工人：只完成本任务，不派子代理；禁止运行 npm run check / verify / test / build 与不带文件参数的 npx vitest（全量由主代理统一跑）。
TASK_ID: W9-recording-archive-locator
仓库：/home/kaua/projects/zzz-calculator（WSL）。开工先 git rev-parse --short HEAD 记为 BASE，再执行 node scripts/zc.mjs claim scripts/lib/recording.mjs scripts/lib/recording.d.mts scripts/verify-recording.mjs src/scripts/__tests__/recording.test.ts --as W9 占道。
父目标：npm run verify:recording 长期挂 9 条 WARN，被当成「已知噪音」无人处理。主代理 2026-09-24 实测，它们大多是检查器自己的错：
- 检查 ③（scripts/verify-recording.mjs 约第 88-101 行）取 agentId 在 docs/MECHANICS_IMPLEMENTATION.md 里**第一次出现**的位置，往后看 800 字符找「当前实现状态」。
- 1101 珂蕾妲、1401 爱丽丝、1551 佩洛伊斯其实都有档案段（标题分别在第 304 / 435 / 349 行），段首第一条就是状态行；但它们的 id 先在别的段落出现（第 142 / 382 / 71 行）⇒ 看错了位置 ⇒ **3 条误报**。
- 1391、1451、1471、1481、1531 根本没有档案段（没有任何标题行含这些 id），只是在别处被提到 ⇒ 报成「档案段无状态行」是**标签错**，应为「无该角色档案段」。
- 1251 青衣全文未出现 ⇒ 「无该角色档案段」是对的。
- 用「标题行含 id + 段内找状态行」的原型复算：62 个 implemented 角色 = 56 ok、6 无档案段（1251 / 1391 / 1451 / 1471 / 1481 / 1531）、0 有段无状态行。
前提假设：按标题定位后 WARN 恰为上面 6 条且全是「无该角色档案段」。可观察失败：出现别的 WARN ⇒ 有标题不含 id 的档案段，停下报 blocked 并列出（不要自行放宽匹配）。
先读：scripts/verify-recording.mjs 全文（134 行）；scripts/lib/recording.mjs 的导出列表与 scripts/lib/recording.d.mts（新增导出必须补声明，check-guards 判据 14 的 C 段会查 .d.mts 漂移）；src/scripts/__tests__/recording.test.ts 的 import 写法与现有用例风格；docs/MECHANICS_IMPLEMENTATION.md 第 1-10 行（档案段格式规则）与第 300-310 行（一个合格档案段的样子）。
要做：
1. 在 scripts/lib/recording.mjs 新增导出纯函数 locateArchiveStatus(doc, agentId)，返回 { status: 'ok' | 'no-section' | 'no-status-line', headingLine }（headingLine 为 1 起的行号，无段时为 null）。规则：
   - 档案段标题 = 匹配 ^#{2,4} 空格 开头、且含独立 token agentId 的行（左边是「（」「(」「/」或空白，右边是「）」「)」或空白；不许把 11011 当成 1101）；
   - 段体 = 标题之后直到下一个级别 ≤ 本标题级别的标题行（更深的 #### 子标题不结束本段）；
   - 段体内出现「当前实现状态」⇒ ok；有段但段体没有 ⇒ no-status-line；没有这样的标题 ⇒ no-section。下一段的状态行不算本段的。
2. scripts/lib/recording.d.mts 补声明。
3. scripts/verify-recording.mjs 检查 ③ 改用 locateArchiveStatus：no-section ⇒ 「WARN <label>: MECHANICS_IMPLEMENTATION.md 无该角色档案段（标题行须含 agentId）」；no-status-line ⇒ 保留原文案「档案段无「当前实现状态」行（未核对现状，录入时补）」。checked / warned 计数方式不变；同步改文件头注释里 ③ 的描述。
4. recording.test.ts 新增用例（合成 markdown 字符串即可）：(a) 标题含 id、段首有状态行 ⇒ ok；(b) id 先在前面别的段里出现、自己的段在后面且有状态行 ⇒ ok（本次误报的形状）；(c) id 只在正文出现、无标题 ⇒ no-section；(d) 有标题、段内无状态行、紧跟着的下一段有 ⇒ no-status-line；(e) 段内有 #### 子标题、状态行在子标题之后 ⇒ ok；(f) 查 1101 时标题只含 11011 ⇒ no-section。另加一条仓库现状用例：对真实 docs/MECHANICS_IMPLEMENTATION.md 查 1101 / 1401 / 1551 ⇒ 都是 ok。
硬约束：只许改白名单 4 个文件；不改 docs/MECHANICS_IMPLEMENTATION.md（补档案段是另一件事，要核对现状，不在本卡）；不改任何 spec / 数据文件；不加依赖；LF 行尾、无行尾空格。
验收（逐条执行，报告里贴命令、退出码与输出尾部）：
1. npm run verify:recording → EXIT=0；贴全部 WARN 行，应恰为 6 条、id 集合 = {1251, 1391, 1451, 1471, 1481, 1531}、文案全是「无该角色档案段」；末行 checks 总数与改前相同（改前 189，贴改前改后两行）。
2. npx vitest run src/scripts/__tests__/recording.test.ts → 全绿。
3. 负控：临时把 locateArchiveStatus 的段体范围改成「只看标题行本身」，跑验收 2 → (a)(b)(e) 与仓库现状用例必须变红；贴红用例名后改回，重跑验收 2 → 绿。
4. node scripts/check-guards.mjs → EXIT=0；npx vue-tsc -b → EXIT=0。
报告：写到 /tmp/worker-W9.report.md，首行 STATUS: done 或 STATUS: blocked。内容：BASE、git diff --stat、完整 git diff（只应含白名单 4 个文件）、4 条验收的原始结果、未证明事项。不要 git add / commit，不要 zc done。最终回复也以 STATUS 行开头。
停止条件：需要改白名单外的文件，或验收 1 出现 6 条之外的 WARN 时，停下写 blocked 并附证据。
<!-- /card:W9 -->

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
  W7 4 分钟、W8 6.5 分钟。7 张卡全部 `STATUS: done`，复核发现 3 张有瑕疵：W6 缺落点同一性断言（适配层吞掉返回 index 时
  原测试全绿，主代理补上并实测可红）、W2 漏判判据 18（lib 层下限测的是空目录，接不住整目录改名，并进 W8 修）、
  W4 越界用 `rm` 清了自建的临时目录（已如实披露，未碰仓库）。
  ⇒ 低级模型能把「写什么」做对，「证明它能红」仍要主代理自己变异一次。
