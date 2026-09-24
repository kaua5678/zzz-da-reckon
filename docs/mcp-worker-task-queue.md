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

## 1. 队列

| 卡 | 标题 | 类型 | 写入白名单 | 状态 |
|---|---|---|---|---|
| W2 | 扫描器判据自证普查（反空洞下限 / 正控注入） | 只读普查（M） | 仅报告 | 可派 |
| W3 | R62-J3：状态表声明 × `gate-census.json` 行为指纹对账 | 只读分析（M） | 仅报告 + `/tmp/w3/` | 可派 |
| W4 | 历史 worktree 清点（删除须用户批准） | 只读（S） | 仅报告 | 可派 |
| W5 | R35-J3：「只被本文件引用的导出」分桶量规模 | 只读普查（M） | 仅报告 + `/tmp/w5/` | 可派 |

## 2. 任务卡

### W2 · 扫描器判据自证普查

<!-- card:W2 -->
你是只读普查工人：只完成本任务，不派子代理，不修改任何仓库文件；禁止 npm run check / verify / test / build 与 npx vitest。
TASK_ID: W2-guard-selfproof-census
仓库：/home/kaua/projects/zzz-calculator（WSL）。开工先 git rev-parse --short HEAD 记为 BASE。
父目标：本仓教训「判据必须能区分『没问题』与『仪器坏了』」。只写「命中 0 处 ⇒ 绿」的扫描器，在 walker 写坏、目录改名、正则失效时会永久假绿，而读数与「真干净」完全一样。判据 21 的三件套（detector 自证 fixture + 反空洞下限 + 路径感知限定）是范式。需要一张全判据普查表，决定哪些判据值得补。
前提假设：仍有扫描器判据「零命中即绿」且既无下限也无正控注入测试。可观察失败：每条扫描器判据都已有下限或正控 ⇒ 本面收口，如实报 done（「全部已具备」是有效结论）。
先读：
1. scripts/check-guards.mjs 头注释（判据清单）与各判据的判绿条件（grep -n "ok:" scripts/check-guards.mjs）。
2. 范式：scripts/lib/json-dup-keys.mjs 头注释；scripts/lib/move-element-reconcile.mjs 第 1-60 行（下限常量 + 正控注入）。
3. 判据测试：grep -ln "check-guards\|scripts/lib/" src/scripts/__tests__/*.ts。
要做：对 check-guards 的每一条判据填一行：编号 / 名称 / 扫描面（目录或文件集）/ 判绿条件（文件:行）/ 反空洞下限（常量名 = 值，文件:行；没有写「无」）/ detector 自证或正控注入测试（测试文件:行；没有写「无」）/ 风险：高 = 零命中即绿且既无下限也无正控；中 = 缺其一；低 = 两者都有，或该判据不是扫描器（纯结构断言）。
硬约束：只读，只许写报告文件；不要修补任何判据（修补另立卡，由主代理定价）。
验收：
1. 表的行数 = 判据实际条数：运行 node scripts/check-guards.mjs（只读，约 20 秒，允许），贴它自报的判据条数与你表的行数。
2. 任选 2 条「高」风险判据，各写一段「如何注入退化能让它假绿」的具体做法（只写不改）。
报告：写到 /tmp/worker-W2.report.md，首行 STATUS: done 或 STATUS: blocked；内容 = BASE + 普查表 + 抽样 + 无法判定的判据及原因。最终回复也以 STATUS 行开头。
<!-- /card:W2 -->

### W3 · R62-J3：状态表声明 × 行为指纹对账（静态半场）

<!-- card:W3 -->
你是只读分析工人：只完成本任务，不派子代理，不修改任何仓库文件；禁止 npm run check / verify / test / build 与 npx vitest。
TASK_ID: W3-r62j3-census-join
仓库：/home/kaua/projects/zzz-calculator（WSL）。开工先 git rev-parse --short HEAD 记为 BASE。
父目标：状态表 character-constellations.json 里声明 implemented* 的影画/机制条目，是否真的改变了计算？R61 实测静态「悬空 id」扫描全是误报、R62 实测静态 B 向 44 条全是承载在别处的假阳 ⇒ 必须用行为读数。现成行为读数 = /home/kaua/r62-scratch/evidence/gate-census.json（62 角色 × 7 档全指纹，2026-09-20 生成）。本卡只做「声明 × 已有指纹」的对账，不重跑管线。
前提假设：仍有「声明已实现，但该档行为指纹相对前一档无变化」的条目。可观察失败：B 类为 0 ⇒ 本面收口，如实报 done。
先读：
1. ls -la /home/kaua/r62-scratch/evidence/ 并读其中的说明或生成脚本，弄清 gate-census.json 的结构、档位含义与生成时的 HEAD。
2. 状态表：find . -name character-constellations.json -not -path "*/node_modules/*"，读其结构。
3. .claude/OPEN-ITEMS.md 中 R62-J3 条目（grep -n "R62-J3" .claude/OPEN-ITEMS.md，只读该条）。
要做：在 /tmp/w3/ 写一次性 node 脚本：对状态表里每条声明 implemented* 的条目（角色 × 档位），查 gate-census 中该角色该档相对前一档的指纹是否变化；分三类输出：A = 声明已实现且指纹有变化（一致）；B = 声明已实现但指纹无变化（候选缺陷）；C = 对不上（id、档位映射不清，写明原因）。
⚠ 陷阱：指纹生成于 2026-09-20，之后仓库有大量提交；B 类只是「候选」，报告里必须写明「指纹来自旧 HEAD，需主代理在当前 HEAD 复测」。影画效果可能由别处承载（队友通道、模块内部），不要仅凭名字推断承载位置。
硬约束：只读仓库与 r62-scratch；脚本与中间产物只放 /tmp/w3/。
验收：A + B + C 条数之和 = 状态表中 implemented* 条目总数（贴计数命令与结果）；B 类逐条列出 角色名(id) / 档位 / 声明原文 / 指纹证据。
报告：写到 /tmp/worker-W3.report.md，首行 STATUS: done 或 STATUS: blocked；内容 = BASE + 统计 + B、C 清单 + 脚本路径。最终回复也以 STATUS 行开头。
<!-- /card:W3 -->

### W4 · 历史 worktree 清点

<!-- card:W4 -->
你是只读清点工人：只完成本任务，不派子代理；禁止任何删除、git worktree remove / prune、git branch -d、rm。
TASK_ID: W4-worktree-census
仓库：/home/kaua/projects/zzz-calculator（WSL）。
父目标：git worktree list 挂着约 45 个历史 worktree（/home/kaua/r41-scratch … r65-scratch、/tmp/zzz-mcp-continuous-verify），全部 detached。要给用户一份可以直接批准的清理清单。
先读：git worktree list；.claude/PROMPT-handoff-unattended-2026-09-22.md 第 192-201 行（「前几任的考古目录 /home/kaua/r6{1,2,3,4,5}-scratch/ 别删」）。
要做：对每个 worktree 记录：路径 / HEAD 提交 / 是否是 master 的祖先（git merge-base --is-ancestor <提交> master）/ git -C <路径> status --porcelain 的修改数与未跟踪数 / du -sh 大小 / 同一 scratch 目录下 worktree 之外的其他文件（如 evidence/，只列出）。分类：可删 = 干净且 HEAD 是 master 祖先且不在 r61–r65 保留名单；保留 = 有未提交改动、HEAD 未合入或在保留名单；待定 = 其他。
验收：清点条目数 = git worktree list 行数 − 1（主工作区）；贴计数。
报告：写到 /tmp/worker-W4.report.md，首行 STATUS: done 或 STATUS: blocked；内容 = 清单表 + 三类计数 + 可删类的总大小 + 一段「若用户批准可执行的命令」（只写不执行，用 git worktree remove <路径>，不带 --force）。最终回复也以 STATUS 行开头。
<!-- /card:W4 -->

### W5 · R35-J3：「只被本文件引用的导出」分桶量规模

<!-- card:W5 -->
你是只读普查工人：只完成本任务，不派子代理，不修改任何仓库文件；禁止 npm run check / verify / test / build 与 npx vitest。
TASK_ID: W5-overexport-census
仓库：/home/kaua/projects/zzz-calculator（WSL）。开工先 git rev-parse --short HEAD 记为 BASE。
父目标：R35 量出「导出但无其它模块具名 import」的符号 748 条，绝大多数是合法的 interface/type，噪音太高没法直接立项。现有死导出工具只覆盖「零引用」面（scripts/lib/dead-channel-ls.mjs 第 606 行 if (n > 0) continue：同文件内有引用就不算死；DEAD_EXPORT_BASELINE 已归零），「非定义引用全部落在声明文件内」= 过度导出面没人量过。本卡只量规模，给主代理定价用。
前提假设：按 kind 分桶并排除 .vue 直引与动态取用后，function/const 桶仍有值得收窄 export 的符号。可观察失败：function/const 桶为 0，或全部有合法理由（测试直引、.d.mts 对外契约）⇒ 本面收口，如实报 done。
先读：
1. scripts/lib/dead-channel-ls.mjs 第 560-624 行（scanDeadExportsLs：LanguageService 的建法、findReferences 用法、第 607-612 行的 kind 判定）。
2. .claude/OPEN-ITEMS.md 的 R35-J3 条目（grep -n "R35-J3" .claude/OPEN-ITEMS.md，只读该条）。
要做：在 /tmp/w5/ 写一次性 node 脚本（可 import 该 lib 的导出函数，或仿其建 LanguageService），对 src/ 下（排除 __tests__）每个导出符号跑 findReferences：只保留「至少 1 个非定义引用，且全部非定义引用都在声明文件自身」的符号；再排除被 .vue 文件引用的，以及名字以字符串形式出现在 src/ 或 scripts/ 动态取用处的（grep 符号名兜底，命中即排除并记录）。按 kind 分桶计数（function / const / interface / type / class / enum / other），列出 function 与 const 桶的全部符号（文件:行 + 本文件内引用次数）。
⚠ 陷阱：被测试文件（__tests__）引用的导出属于有外部引用，不在本面——先确认你的 LanguageService 程序包含测试文件，否则会把「只给测试用」的导出误判进来。
硬约束：只读仓库；脚本与产物只放 /tmp/w5/；单次脚本运行 1-3 分钟（LanguageService 冷启动）属正常，允许。
验收：1. 贴各桶计数与总数；2. 从 function 桶随机抽 3 个，用 grep -rn "<符号名>" src scripts 复核「确实只在本文件出现」，贴输出。
报告：写到 /tmp/worker-W5.report.md，首行 STATUS: done 或 STATUS: blocked；内容 = BASE + 分桶计数 + function/const 清单 + 抽样复核 + 脚本路径。最终回复也以 STATUS 行开头。
<!-- /card:W5 -->

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
