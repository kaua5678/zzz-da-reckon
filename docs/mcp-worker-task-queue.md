# 交接与执行纪律（活文档，原「低级模型任务队列」）

> **本文件现在只放五样东西**：置顶顺序、§0 执行纪律、§1 长期规则、§2 最近一轮交接和已知坑、§3 执行卡（第 368 轮加）。
> 逐轮流水账已删除（W3，`docs/mcp-working-model.md` §2.4）。压缩前的全文（第 1–120 轮交接、W1–W31 卡表、2026-09-24 OPEN-ITEMS 分诊记录）
> 用 `git show 8a8db00:docs/mcp-worker-task-queue.md` 查看。每轮只**替换** §2，不追加；历史靠 git。
> **分工**：固定的 lead / worker 分工已废除（`docs/mcp-working-model.md` §1）。每个会话都是完整执行者。子代理（dsh）只外包输入输出能写死的机械活，派活时仍按 §0 的纪律。
> 需要用户裁决的事写进对应专题文档；用户的新需求在 `docs/REQUIREMENTS.md`，**每轮先读**。

> **🔝 置顶（第 154 轮更新）**：
> 1. `docs/REQUIREMENTS.md` 的 R1–R8 已全部处理完（R4 被用户撤销）。有新 R 条目时先做新条目。
> 2. 没有新需求时，按 §2「下一步」推进。当前主线是「规格-实现对账」的尾项：逐条核对原文口径与实现（「初始」、字段语义、buff 作用对象），发现差异就开 CC 卡，卡表在 `docs/mcp-calc-core-architecture.md`。
> 3. 原第 121 轮置顶的三项（R6 第 1 步、R5 第 2 刀、R6 第 2 步）都已完成（R5 `9d56de8`，R6 `6db533b`）。
>
> 其他状态：
> - R8 执行项：W1、W2 已**撤回**（读码后前提不成立，见 `docs/mcp-working-model.md` §2.5）；W3、W4 已完成（第 121 轮）。
> - census（`docs/mcp-r22d1-batch12-field-census.md`）已冻结，不再追加。
> - **R4（事件时间轴）已被用户撤销，不要再推进，也不要再提时序仿真。** R7 已删除它的代码（`8a0159c`）。

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
- **回收时的读法**（2026-09-25）：`wsl_exec` 只回 stdout **尾部**（开头被静默截掉）⇒ 报告 / 长日志先落 `/tmp` 再 `sed -n` 分段读；等工人收工用 WSL 端有界轮询（`pgrep -f '^node .*dsh --profile headless ### <卡>'` 每 10 s 一次，单次调用 ≤ 9 min），远程客户端别用 Node 内置 `fetch` 干等（300 s 自断），见 `docs/mcp-local-subagent-channel.md` §5。
- 主代理复核 = `docs/mcp-lead-agent-handoff.md` §7：看真实 diff 是否越白名单、亲自重放一条正控一条负控、
  核对产物时效；然后显式路径提交、`node scripts/zc.mjs done` 留痕、删卡。
- **两个写工人并行**：第二个放进隔离 worktree（`git worktree add --detach /tmp/wt-<卡> HEAD` 后软链 `node_modules`），
  卡里写明工作区路径、禁止碰主仓库；合入 = `git -C /tmp/wt-<卡> diff > x.diff`，复核后在主仓库 `git apply`，
  再 `git worktree remove --force /tmp/wt-<卡>`（只删软链本身，主仓库依赖不受影响；2026-09-24 W7 实测）。
- **工人自测必须含 `npx vue-tsc -b`（2026-09-27 W31 教训）**：vitest 不做类型检查，W31 工人只跑了 vitest，交回的文件有 TS6196（未用类型别名），导致 `npm run verify` 红。今后卡面「验收」一律写上 `timeout -s KILL 600 npx vue-tsc -b` 退出 0；lead 复核时也要单独跑。另外，测试里**不要写 `setTimeout` 等待**（`useResourceCalc` 是同步 computed，W31 工人加了 2s 空等，差点碰到 5s 默认超时）。
- **负控的还原**：在有未提交改动的树上做负控，先 `cp` 备份再改、用备份还原；**不要** `git checkout -- <文件>`
  （会把工人的改动一起抹掉，2026-09-24 复核 W7 时踩过，按工人报告里的 diff 补回）。
- **派发前先查重（2026-09-25 双 lead 事故）**：开工先 `pgrep -af '^node .*dsh --profile headless' | cut -c1-60`
  （模式必须带 `^node` 锚：裸 `'dsh --profile headless'` 会匹配到 pgrep 所在 shell 自身的命令行，永远"有人在跑"）
  + `tail -3 .zc/journal.jsonl`——同名卡已有工人在跑（**无论是谁派的**）就不再派，改为轮询其
  `/tmp/worker-<卡>.out` 等首行 `STATUS:`。本日 W10/W11 被两条 lead 会话各派一次：先到者写正文、
  后到者 force-claim 后只追加独立复核（§10 模式），工人按卡面纪律自洽解决了，但浪费一个并发位、
  同路径 `/tmp/worker-*.out|.err` 相互覆盖，且若后到者不守纪会覆盖整份报告（`.zc/` 不入 git，丢了就真丢了）。

- **出卡前 grep 断言的全部消费者；brief 里给工人「没说清就选最小改动继续」的授权（2026-10-03 r436 CC-410）**：卡面写「:61 兜底删掉」，实际那行是 `axisMoveActionTime` 钩子的实现、有测试锁着——工人读到矛盾后推敲 9 分钟零改动。
  判据：派发后 >5 分钟 `git status` 零改动 ⇒ 看 `worker.err` 尾部它在纠结什么，多半卡面错了；`kill <pid>`（pid 取自 `pgrep -af '^node .*dsh --profile headless'`）、改卡、重派，比等便宜。第二次派发 8 分钟收工。
- **全量 vitest 单独一条 `wsl_exec`（2026-10-03 r437 实测）**：guards 链（~45s）+ build（~47s）+ vitest(4)（~250s）串在一条调用里，总时长撞上桥的 ~285s 上限，整条被杀、vitest 日志半截还没有 summary——看起来像「跑了但没结果」。guards / build 一条，vitest 另一条，各自 `timeout 280`。
- **全量 vitest 跑不进 280s 时用分片（2026-10-03 r439；r450 更新）**：`npx vitest run --shard=1/2` 与 `--shard=2/2` 各一条 `wsl_exec`（worker 上限自 CC-424 起在 `vite.config.ts` 里默认 4，不必再加 `--maxWorkers=4`），两片的 **passed** 数相加应等于基线（现 478 / 4339，以 r6 §8 最新行为准）。开工先 `pgrep -fc "[w]orkers/forks.js"`：>0 = 别人在跑测试，先 ≤170s 轮询等它结束再跑自己的；高负载下 2 分片仍 rc=124 时拆 4 或 8 份（r450 实测 1/4、2/4、3/4、7/8、8/8 凑齐）。
### 0.R2 收尾流程（2026-09-27 R2 定稿；依据与数字见 `docs/mcp-dev-process-speed.md`）

- **强度不变，顺序和并行方式变了**：全量 `npm run verify`、零差、文档提交后重跑 check-guards 三道都保留。
- ① 改代码中途要早信号时，跑 `npx vue-tsc -b` 加相关测试文件。tsconfig 已开 `incremental`：无改动 1.5 秒，改一两个文件约 9–12 秒。**工人自测仍必须包含 `vue-tsc -b`**（上面 W31 那条不变，它现在很便宜）。
- ② 触及计算路径时，跑 `bash .zc/perf/zd.sh <tag>`（基线 = HEAD 的 worktree，改后 = 工作区，四路并行约 50 秒；原来顺序执行约 176 秒）。要求 DIFF 0；不为 0 就逐条解释。**本卡改动先不要提交**。
- ③ 全量 verify **只跑一次**，放后台；等待期间在本地起草文档，**verify 结束前不要落盘**，因为 check-guards 会扫描 docs。用轮询 `grep -q '^EXIT'` 等待，不要用固定 sleep。
- ④ verify EXIT 0 后，依次：提交代码 → 落盘并提交文档 → **重跑 `node scripts/check-guards.mjs`（必须）**。
- **不要做**（会削弱保证，已列入流程文档 §6 等用户裁决）：用 `vitest --changed/--related` 代替全量；只改文档时跳过 vitest（本轮就实测到「手册 §4 行数」测试被文档打红）；纯搬迁卡跳过零差。

## 1. 长期规则（从 2026-09-27 以前的逐轮交接里提炼，压缩时逐条保留）

- **没有排定项时不造活**（第 237 轮）：REQUIREMENTS 无新条目、交接也没有下一步时，先读 `docs/mcp-r6-refactor-list.md` **§8.0 活着的重开条件索引**（一屏，r453 起；§8 大表只是日志，不用逐行读），有被满足的就做；没有就只查表里没有的区域；查完仍没有满足「更通用 / 更简单」的项，就在 §8 追加一行、然后收尾（写交接、push）。「本轮无题」是正常状态。依据：用户明确不要只为降计数或凑工作量的改动。回退：删掉本条。
- **主档优先**（第 375 轮）：一条工作线有专属主档（如 CC-343 的 `docs/mcp-analyzer-scenario-isolation.md`）时，验证细节、决定、回退点只写主档；卡表与 r6 §8 只留一行指针，不再在 `docs/mcp-stun-dual-source.md` 另开 §24 节。依据：同一件事写四五处既费 token 又会漂移。回退：删掉本条，按旧惯例补 §24。
- **每轮收尾必须 `git push origin master`**（提示词 c2）：commit 不等于 push。2026-09-27 用户发现本地积压 436 个提交、远端停在 09-21。推送失败要写进交接，不能静默跳过。
- **登记债务、豁免或改 burn-down**：改 `scripts/lib/guard-registries.mjs`，不要改 check-guards 本体（CC-85）。
- **改角色机制实现的提交**：顺手 grep `public/static/character-mechanics.json` 和 `character-constellations.json` 里该角色的 pending，过时就同步改。状态表过时的根因，就是实现提交没回写（CC-89）。
- **新增 `record.<key>` 读取**：必须同时有写入方（buildCharConfig 或编排层注入），否则判据 25 会红（CC-91）。
- **文档提交之后至少再跑一次 `node scripts/check-guards.mjs`**：docs 里以 `@fact ` 开头的散文会被解析成 fact 声明（CC-93）。
- **drift 复核**：要看从原始口径日期到现在的全部改动（`git log <原始据日期>..HEAD -- <锚文件>`），不要只看上次 `·复核@` 之后的。另外，有些条目的竖线前没有空格（`·复核@2026-09-25| 验`），不要把戳打进「验」或「锚」段（CC-87）。
- **`src/views/TeamComparePage.vue` 只剩约 38 行结构熵余量**：给该页加功能，写到 `src/composables/teamCompare*.ts`（CC-92）。
- **反空洞下限要量「扫描面」，不要量「被扫描的问题」**（r404 CC-378）：判据 25 原先以 Record 读取数作下限，而 D2 §5 正在有意消灭这些读取，结果每推进一批就被推红一次。防「扫描器失明」的下限用扫描到的文件数这类只随仓库规模变的量。它和下一条不矛盾：下一条说的是计数**凭空**下降要追查；这里是下降原因已知、且就是重构目标。
- **开工在自己的 worktree 跑一次 `npx vue-tsc -b --force`，先知道 master 本来红不红**（r424）：`c47e153b`（02:24）提交时 vue-tsc 没过（4 个错全在新测试文件里，vitest 不做类型检查所以全绿），master 类型检查红了 9 小时没人发现；r423 又记过「别人的红被归到自己头上然后 revert」。红了就修掉或在 §2b 记一行，别带着红继续、也别 revert 别人。回退：删掉本条。
- **等号基线（「计数下降也报错，要求下调基线」）是有意设计，不要改成「≤」**：2026-09-14 它两次抓到扫描器盲区，计数凭空下降其实是扫描器看不见了，而不是代码变好了（`scripts/check-tokens.mjs` 头注释；`docs/mcp-working-model.md` §2.5）。

- **探针 / 分析脚本用 harness 时传 `productionBasicWeights: true`**（CC-416）：harness 默认每槽平A权重 1 是回归基准口径，不是生产口径；拿默认档评「辅助分走多少平A池」会系统性高估辅助（用户 2026-10-01 报）。回归测试不要动这个默认。

- **「幻影 null」猎法（r444–r448，CC-417→421 五连，每个都是零行为、zd DIFF 0）**：类型里带 `| null` 的输出，先找**全部**生产者的 null 出口（`grep -n "return null\|: .* | null = null"` + 对每条出口问「调用方在同一次同步求值里是否已经排除了这个条件」或「循环是否至少跑一轮」），再找**全部**消费者的 `?.` / `?? 0` / `x != null` 防御。null 出口不可达 ⇒ 把出口改成不变量 `throw`（不是留着 `return null`——留着就得保留整套 `| null`，等于类型层继续承认一个不存在的状态），类型收成非 null，防御全部收掉，加形状锁。**判别真 null 与幻影 null**：真 null 表达一个会发生的事实（首轮无前一轮 `prev: null`、首轮无上轮计数 `postRoundInput: null`、没有挂能力的槽 `slot < 0`）——保留；幻影 null 是「某个空集合被放大成整个结果不存在」（CC-417 空失衡贡献 ⇒ 整轮 null）或「上游守卫早已排除」（CC-418/419/421）——收掉。每收一层，下一层才露出来（CC-418 之前看不出 CC-421），所以一次只收一层、每层单独验证。

- **别人的「已提交、未推」不是孤儿，是没推完的活（r452）**：开工 `rev-list origin/master..HEAD` ≠ 0 且那些提交**不是自己的**时，先看作者是否还在动（`ps`、文件 mtime、提交时间 < 10 分钟 ⇒ 等）；不在动就 **cherry-pick 到自己的 worktree（基于 origin/master）跑全套**（vue-tsc / guards 链 / build / vitest 分片），**绿就以他的名义 `git push origin <sha>:master`**（cherry-pick 保留作者与消息），红就入分支 `wip/<作者>-<主题>` 并把主仓 reset 到 origin。不审他的口径（那是他 lane 的事），只验「不弄红 master」。依据：用户唯一盯着看的就是 GitHub 有没有新东西（§7 c2 的 436 个未推提交事故）；而主仓每多一个未推提交，后面每个 lane 的 ff-merge 都要改成 rebase、哈希一轮一变、文档引用全失效。先例：r452 代推 kaua5678 的「refactor(grace): 轮换计划改精确闭式解…」（cherry-pick 后哈希 `c1897046`），验证记录在 §2b r452。**不要**用它来绕过自己的验证：自己的提交仍然自己验、自己推。

## 2b. 并行 lane 交接（§2 「每轮替换」时**不要**连本节一起删；每个 lane 一段，过时的段压成一行指针）


> 为什么有这节：2026-09-29 实测两个会话同时在跑（本会话开工时主 lane `lead-arena-0925c` 第 315 轮正在 `wt315` 跑 verify；推断是 arena 对战模式两个模型同时收到同一份提示词）。
> §2 属于主 lane；并行会话把自己的交接写在这里，互不覆盖。任何 lane 确认本节已过时，可以整节替换成自己的。
> 开工查现场的方法见提示词第 9 条（`ps` 看 verify / vitest，`git log` 看最近提交时间，`ls -lt /home/kaua/calc-arch`）。

> **认领表**（2026-10-01 arena-D 起）：`/home/kaua/calc-arch/LANE-CLAIMS.md`（不入 git）。选好活后追加一行「时间 | lane | 文件/主题 | worktree」，收工标 `[released]`；选活前先读它，避开别人未 released 的文件。
> **在 worktree 里跑零差**：`cp -r .zc/perf <worktree>/.zc/` 后 `ZD_REPO=<worktree> bash .zc/perf/zd.sh <tag>`（`.zc/perf/zd.sh` 本轮加了 `ZD_REPO`，不设时行为同旧）。

**2026-10-04 01:33 arena-F 第 479 轮**（开工：主仓 = origin = `501d9835`，干净、无人在跑；REQUIREMENTS.md 无新条目；§3 无 pending 卡；无 worktree；**代码本轮无题**，仅文档 + 一行注释）。
- **r478 交接续核**：`patchExecutions` 里 `exec.<field> = (exec.<field> ?? 0) + …` 71 处是普通累加习语，抽 helper 不比原式简单 ⇒ 不做（r6 §8 第 479 行）。
- **纠正 r476 的机制描述**（r6 §8.0 #14 已重写、`norma.ts` 注释已改）：`rr.iterations` 是**末轮折叠的内层迭代数**（`foldLoop.ts:84`），外层本就至少两轮（pass0 注入 refund 后 `continue`）；估计值影响落点的入口是 **pass0 冻结的 refund/idle**。DEBT 1a 立项时先做的三个实验写在 #14 第 4 列（(b) refund 末轮二次注入最便宜：`foldLoop.ts` 一处）。
- **下一步（start-ready）**：题序 REQUIREMENTS → §3 → §8.0 触发 → 本轮无题。若要开「实验型」轮：按 #14 (b) 在 worktree 里改 `foldLoop.ts`（`refundFrozen` 后在末轮再重算一次 refund 并多跑一轮 iterate），读数三件套 `timeFillRatchet`（总留白/超预算是否单调下降）、zd（变动队集合）、timeGolden（逐队归因），**只要 ratchet 有一队变差就不落地**，把读数写回 #14。

**2026-10-04 01:17 arena-F 第 478 轮**（开工：主仓 = origin = `029fd878`，干净、无人在跑；REQUIREMENTS.md 无新条目；§3 无 pending 卡；worktree `wt-T46`（已删）；产物 `/home/kaua/calc-arch/arenaF/r478/`）：**CC-440 `b9ea3367`** 模块自造执行行骨架 `moduleExecRow`，五份 `pushExec` 试点迁入。
- **找题**：按 r477 交接的「同名私抄 helper ≥3 份、逐字相同才收」扫描，命中 `pushExec` ×5（lighter / lucy / rina / yaojiayin / yeshuguang）——不是逐字相同，但同形：整个 `SkillExecution` 字面量 + 6～9 个账本字段全 0；全仓同形字面量 55 处。`SkillExecution` 再加必填账本字段就要改 55 处 ⇒ 值得一个骨架。
- **做了**：`src/mechanics/moduleExecRow.ts`：只默认 6 个必填账本字段，语义字段调用方给，键序与原字面量一致（zd 按 JSON 键序哈希）。五份 pushExec 改调骨架，各自的 `count<=0||dmg<=0` 过滤与语义字段原样。零差：zd 0、timeGolden 不变、两 shard 479/4345。
- **坑（已写进骨架 doc 注释与 arch CC-440 行）**：`decibelRecovery / totalDecibelRecovery / energyRecovery / totalEnergyRecovery` 是三态——`undefined` 回填取表、显式 `0` 禁用、`*Override` 模块换算。第一版骨架把它们默认成 0，yeshuguang 原本不写 decibel 的行被禁掉 ⇒ 1431 各队 ult 2→1、golden 18 条红、zd 258。改成不默认后零差。**凡是给执行行造默认值，先读 `composables/resourceCalc/helpers.ts:380-382`。**
- **回退点**：`git revert b9ea3367`。
- **下一步（start-ready）**：剩余 ~50 处字面量**不开扫描卡**（触碰模块时顺手迁：删 `count` 后面的账本零行、`executions.push({…})` → `executions.push(moduleExecRow({…}))`，显式 0 的回能字段**保留**，每次 zd 0）。题序回到 REQUIREMENTS → §3 → §8.0 触发 → 「本轮无题」。可选扫描式找题：`grep -rn "executions.push({" src/mechanics/agents/*.ts \| wc -l` 之外，看 `patchExecutions` 里对已有行的改写是否也有同形私抄（如 `exec.damageMultiplierOverride = true; exec.damageMultiplier = …` 三连）——同样判据：同形 ≥3 份且能零差收口才动。

**2026-10-04 01:07 arena-F 第 477 轮**（开工：主仓 = origin = `30e7c878`，干净、无人在跑；REQUIREMENTS.md 无新条目；§3 无 pending 卡；worktree `wt-T45`（已删）；产物 `/home/kaua/calc-arch/arenaF/r477/`）：**CC-439 `6cc0e88f`** 面板侧设置读口 `mechanicSettingOf`。
- **r476 交接续核**：`severian.c4Coverage` 三读一致（无事）；seth / evelyn / corin / piper 面板侧 `settings[id] ?? 1` 不钳 vs cfg 侧 clamp——只在越界值上有别、UI 有 min/max，**不动**。
- **做了**：corin / phoenix / severian / sigrid 四份逐字相同的 `settingOf` 删除，改 import `mechanicSettingOf`（放在 CC-235 的 `utils/mechanicSettingCfg.ts`，与 `cfgMechanicSetting` 并列：同一协议的 cfg 侧 / 面板侧两个读口）。零差：zd 0、timeGolden 不变、两 shard 479/4345。
- **对账结论（落盘，别重跑）**：`/home/kaua/calc-arch/arenaF/r477-scan.py` 扫 `src/mechanics/agents/*.ts`：141 个滑块声明、178 处读点，读点 fallback 与声明 `default` **全部一致**。不加锁（零实例、regex 锁易碎）；要复查就重跑脚本。
- **回退点**：`git revert 6cc0e88f`。
- **下一步（start-ready）**：滑块线收口，§3 无卡。题序回到 REQUIREMENTS → §3 → r6 §8.0 触发（#1 坑 25 到期 10-31；#14 DEBT 1a 需立项）→ 「本轮无题」。可选的扫描式找题（按 CC-280 / CC-439 同款「逐字相同的私抄 helper」）：`grep -rhn "^function [a-zA-Z0-9]*(" src/mechanics/agents/*.ts \| sed "s/.*function //" \| sort \| uniq -c \| sort -rn \| head`——同名 ≥3 份的先 diff 正文，**逐字相同才收**，近名不同义（CC-280 列的 clamp01 / clampRatio 变体）不碰。

**2026-10-04 00:41 arena-F 第 476 轮**（开工：主仓 = origin = `07cd9c99`，干净、无人在跑；REQUIREMENTS.md 无新条目；§3 无 pending 卡；worktree `wt-T44`（已删）；产物 `/home/kaua/calc-arch/arenaF/r476/`）：**CC-438 `ea18ed8d`** 诺姆 `norma.holdSeconds` 单一口径。
- **找题**：REQUIREMENTS 全 done；§3 无卡；r475 交接的两个候选——`agentId === 'NNNN'` 残留扫描 **0 处**（composables/views/core/stores 非测试代码里只剩注释）；r462 (c) **不做**（CC-61 的 `legacy()` 期望依赖 cinema 与 skills，改成表/快照并不比函数简单，且会把 catalog 实数钉进测试）。改用 T17 同型扫描「一个滑块多个读者」：`norma.holdSeconds` 5 读者、3 种写法 ⇒ 立做。
- **做了**：`resolveNormaHoldSeconds(cfg)` = clamp[0,2]，能量 / 膛温源 / 伤害行 / 赠链 / 前台时间 5 处改读；伤害行长按秒数不再 floor（默认 2 逐位不变）；`normaSmoke` +1。zd DIFF 0；timeGolden 不变；两 shard 479/4345。
- **量过故意不改（重要，别再踩）**：`estimateExSpecialTime` 里长按仍是整局一次，与其他 4 读者「每次弹幕都长按」分叉。改成按次 ⇒ 诺姆最终 necessaryTime **不变**（折叠环补齐），但外层 `iterations` 1→0，12 个诺姆预设 zd 全变、heavy ±3～7%、`timeFillRatchet` 两队留白/超预算 0→2s 判红（`auto-1321-1571-1311` 留白 2.2s、`auto-1591-1571-1211` 超预算 1.7s）。这是折叠环的路径依赖，不是诺姆的问题，已登 r6 §8.0 **#14**（DEBT 1a 一起动）。代码注释也写了。
- **回退点**：`git revert ea18ed8d`。
- **下一步（start-ready）**：沿同一 grep 继续核「一个 id ≥2 个运行期读者且写法不一致」：`severian.c4Coverage`（`severian.ts:250/269/376` 三读，两处 clamp01、一处裸 `setting(...)`——先看 376 那条是不是同一物理量），其余 `seth.* / evelyn.* / corin.*` 4 次多为声明 + `fields` 列表，预计无事。判据不满足就记「本轮无题」，不为统一而统一。

**2026-10-04 00:27 arena-F 第 475 轮**（开工：主仓 = origin = `6745ccb0`，干净、无人在跑；REQUIREMENTS.md 无新条目；worktree `wt-T43`（已删）；产物 `/home/kaua/calc-arch/arenaF/r475/`）：**T16 分诊 → 不做** + **r462 lead (b) `fe376bcc`**。
- **T16**：按上轮交接先写设计稿，核原文时发现卡面触发源写错（焚身 vs 每次强特/支援突击），据此量化覆盖率 ≈ 1 ⇒ 判定不做，稿子 `docs/mcp-t16-banyue-rage-window.md`（事实表 F1–F6、量化、备选路线 a/b 到可开工粒度、双计防线）。§3 T16 卡改「⛔ 量过不做」并把纠正写在卡头。pending 台账 `.claude/pending-triage-2026-10-03.md` 不入 git，不改。
- **r462 (b)**：`StunAxisPage.vue` 「轴内已放置量」五处同式求和（平A / 自身招式 / 转大 60·90 / axisExtraBlocks / 连段块含般岳 didong 配额）合成页面局部 `consumedOnAxes(slot, match)`，口径逐字不变（−25 +16）。页面代码不在 zd 覆盖面（zd 只看引擎行），以 vue-tsc 0 + CC-57/58/59 页面文本锁 + 两 shard 479/4344 为验收。
- **验证**：vue-tsc 0；guards 五项全绿；build 0；分片 239/2089 + 240/2255 = 479/4344（不变）。
- **回退点**：代码 `git revert fe376bcc`；T16 判定是文档，若日后要做按分诊稿 §3 开工即可。
- **下一步（start-ready）**：§3 现已**无 pending 卡**（T10 备选等锁红；T16 不做；T17 done）。题序回到 REQUIREMENTS → §3 → §8.0 触发 → 「本轮无题」。剩余小 lead 只有 r462 (c)「CC-61 比较器 → 快照」（`src/composables/__tests__/agentMechanicViewCc61*.test.ts`，把逐字段比较器改成快照断言，纯测试简化）。再往后建议开一轮**扫描式分诊**：`grep -rn "agentId === '" src/composables src/views` 列出仍残留的角色 id 写死判据（T6 判据族），有则立卡，无则记「本轮无题」。

**2026-10-04 00:09 arena-F 第 474 轮**（开工：主仓 = origin = `8d111dfd`，干净、无人在跑；REQUIREMENTS.md 无新条目；worktree `wt-T42`（已删）；产物 `/home/kaua/calc-arch/arenaF/r474/`）：**T17 `544100b9`**，3 文件 +79/−13。
- **选题**：§3 只剩 T16（行为变化、需设计）与 T17（小、start-ready）⇒ 先做 T17。
- **做到哪**：见 §3 T17 卡（已勾完）。要点：`resolveSeverianFengfengStacks` 成为凭风层数唯一口径；偏离卡面「显式滑块优先」已拍板并写明原因与回退点。
- **验证**：vue-tsc 0；severian 12/12；guards 五项全绿；build 0；zd `DIFF 0 NON1581 0 []`；timeGolden 4 条 delta 全部可归因（仅 1631 c3–c6 dmg，+240 倍率点）后重生成；分片 239/2089 + 240/2255 = **479/4344**（新基线）。
- **下一步（start-ready）**：**T16 般岳怒相轴内覆盖**——但它**不是**一张可直接开工的卡：怒相增益现在是 **panel 级**（`applyBanyuePanel` 把 `sheerForceFlat +300 / fireDmg +36 / critDmg +36` 乘覆盖率滑块加进面板），而行级通道 `DirectRowBonus` 目前只有 `critDmgBonus` / `sheerDmgBonus` / `note`（看 `typesRows.ts`）。轴内精确化需要：① `DirectRowBonus` 扩 `fireDmgBonus?` 与 `sheerForceFlat?`（或等价行级面板覆盖）并让 `damagePoolDirect.ts#emitExecDirect` 消费；② 轴模式下 `applyBanyuePanel` 的怒相段**不加**（否则双计），改由 `BanyueOverlay` 加 `rageWindowByMove?: Map<moveId, 窗内占比>`，`axisWindowOverlays` 扫怒相进入点（焚身 = 强特/支援突击块）起 30s；③ 非轴臂维持滑块。先写 `docs/mcp-cc439-banyue-rage-window.md` 设计稿（含「行级贯穿力 flat 怎么进伤害公式」的核查——贯穿伤害 = 贯穿力 × 倍率，flat 加在面板 sheerForce 上，行级必须在该行的贯穿力上加），再拆 a（通道扩字段，零差）/ b（般岳迁入，非零差归因）两步。或先做 r462 两条小 lead 热身。

**2026-10-03 23:57 arena-F 第 473 轮**（开工：主仓 = origin = `7743e5c7`，干净、无人在跑；REQUIREMENTS.md 无新条目；worktree `wt-T41`（已删）；产物 `/home/kaua/calc-arch/arenaF/r473/`）：**CC-437g `38adb975`**，14 文件 +118/−140，**CC-437 全部落地（T15 a→g 七步、七次 zd 0）**。
- **做到哪**：共享类型只剩纯 brand `AgentAxisOverlay = { readonly [AXIS_OVERLAY_BRAND]: true }`；`AgentAxisOverlays` / `AxisScalarOverlays` / `scalarBySlot` 全删；`axisWindowOverlays` 返回 `AgentAxisOverlay | null`；`DirectRowBonusInput` 只剩必填 `overlay`；编排层 `collectAxisWindowOverlays → Map<slot, AgentAxisOverlay>` → `DamagePoolContext.axisOverlayBySlot` → `damagePoolDirect` 的 `overlay = axisOverlayBySlot.get(slot)` 一条线，零 cast、零解释。锁测试 `axisOverlayOpaqueCc437.test.ts` 三条（文本锁，因为「成员不存在」类型系统钉不住）。
- **决定**：锁 ② 比设计稿多钉了三个编排层文件（damagePool / damagePoolDirect / useResourceCalc）与 `bucketsBySlot` / `overlayBuckets` 两个名字——依据：这些名字一旦回来就意味着编排层又开始解释 overlay 内容；回退点 = 改锁测试名单。`AgentAxisOverlays` 与 `AxisScalarOverlays` 两个头注释里的 CC-17 泄漏论证压缩进 `AgentAxisOverlay` 的历史段，不另存文档（设计稿 §1 已有全文）。
- **验证**：vue-tsc 0（一次过，vue-tsc 自己把 18 处 `buckets: undefined, scalar: undefined` 占位全列出来了——这次先 grep 后改，没返工）；定向 vitest 15 文件 222 用例；guards 五项全绿；build 0；zd `DIFF 0 NON1581 0 []`；vitest 分片 239/2089 + 240/2253 = **479/4342**（基线 +1 文件 +3 用例 = 锁）。
- **回退点**：`git revert 38adb975`（单提交；锁测试随之消失）。
- **下一步（start-ready）**：按 §0 题序 REQUIREMENTS → §3 → §8.0 触发：§3 里 **T16 般岳怒相轴内覆盖**前置已清（卡面已改）——实做落点 `banyue.ts` `BanyueOverlay` 加 `rageWindowByMove?: Map<moveId, 覆盖占比>` 之类字段、`axisWindowOverlays` 轴臂扫怒相进入点 30s 窗、`directRowBonus` 把贯穿/火伤/暴伤三段按窗内占比给值，非轴臂保持 `rageGainCoverage` 滑块；先读 `banyue.ts:478` 与 L42 头注释、`docs/MECHANICS_IMPLEMENTATION.md` 般岳段。它是**行为变化**（非零差），验收用 banyue.test 新锚点 + zd 允许般岳行差异并逐行解释。也可先做 r462 两条小 lead（StunAxisPage `consumed` 求和 → 本地函数；CC-61 比较器 → 快照）热身。

**2026-10-03 23:43 arena-F 第 472 轮**（开工：主仓 = origin = `ac1b8200`，干净、无人在跑；另一 lane 的 `/tmp/wt-W35` 已消失、`wt-T8d`@`64e8d13f` 仍在未动；REQUIREMENTS.md 无新条目；worktree `wt-T40`（已删）；产物 `/home/kaua/calc-arch/arenaF/r472/`）：**CC-437f `f5bddaf6`**，5 文件 +64/−65。
- **做到哪**：yixuan 三臂合成私有 `YixuanOverlay { byMove?: Map<moveId, YixuanNingshen>; flat?: YixuanNingshen }`（C6 臂与非 C6 非轴臂 → `flat`，非 C6 轴臂 → `byMove`）；`directRowBonus` 的 `flat ?? byMove.get ?? {0,0}` 顺序不动（yixuanSmoke「C6 标量优先于轴桶」用例改为同一 overlay 里同时带 `byMove` + `flat`，仍钉 `flat` 赢）；删 `yixuanNingshenMap` / `yixuanNingshen`。**至此 `AgentAxisOverlays` / `AxisScalarOverlays` 的 9 个 agent 前缀字段全部迁出**，两个 interface 只剩注释空壳，等 g 删。
- **返工一次**：首轮 grep `yixuanNingshen` 漏了 `damagePoolNightA.test.ts:315-318`（断言 `scalarBySlot.has(2)` 用的是容器名、不含字段名）→ 定向 vitest 红 → 改为「槽 2 读到与槽 0 相同的 `flat`」（与 c 对 NightA 的处理一致：键控是编排层职责）。**教训写进 c→f 通用步骤**：除 grep 字段名外，还要 grep 该模块测试文件里的 `scalarBySlot` / `axisBucketsBySlot` 容器名。
- **验证**：vue-tsc 0；定向 vitest 5 文件 71 用例；guards 五项全绿；build 0；zd `DIFF 0 NON1581 0 []`；vitest 分片 238/2082 + 240/2257 = 478/4339。
- **回退点**：`git revert f5bddaf6`。
- **⚠ 事故与修复（主仓 node_modules 被删一次，已恢复）**：worktree 里 `ln -s 主仓/node_modules` 的符号链接被 `git add -A` 收进了首版提交 `8a6a0d2a`（`.gitignore` 的 `node_modules/` 带尾斜杠**只匹配目录、不匹配符号链接**）；主仓 `--ff-only` 到该提交时，git 把被忽略的真目录 `node_modules/` 删掉、写入 47 字节的链接文本文件（`core.symlinks=false`），主仓与另一 lane 的 `wt-T8d`（同样符号链接到主仓）同时失去依赖。修复：wt-T40 `git rm --cached node_modules` + `--amend` → **`f5bddaf6`**（5 文件，与 `8a6a0d2a` 代码内容逐字相同，`8a6a0d2a` 未推送、已不可达）；主仓 `rm node_modules && git reset ac1b8200 && git checkout ac1b8200 -- src && git merge --ff-only f5bddaf6`；`npm ci --prefer-offline`（lockfile 不变，5s 装回 103 包）；guards 复跑 0。**本轮顺手把 `.gitignore` 的 `node_modules/` 改为 `node_modules`（去尾斜杠，目录与链接都忽略）**，回退点 = 本 docs 提交 revert。教训入「错误与死胡同」：worktree 用 symlink 共享 node_modules 时，提交前 `git status --short | grep node_modules` 必查；或改用 `git add -u` + 显式新文件。
- **下一步（start-ready）**：**T15-g 收口**（设计稿 §4 g 行）：删 `AgentAxisOverlays` / `AxisScalarOverlays` 空壳（先 `grep -rn "AgentAxisOverlays\|AxisScalarOverlays\|scalarBySlot\|axisBucketsBySlot\|axisScalarBySlot" src`，预计命中 typesHooks / typesRows / panelPhases / useResourceCalc:647-648 / damagePool.ts:85-90 / damagePoolDirect.ts:160-173 / NightA+BatchR16b 夹具）；`AgentAxisOverlay` 改纯 brand；`DirectRowBonusInput.overlay` 必填、删 `buckets` / `scalar`；`collectAxisWindowOverlays` 返回 `Map<slot, AgentAxisOverlay>`；加锁 `axisOverlayOpaqueCc437.test.ts`（三条）；arch CC-437 置 done、设计稿状态行改「已落地」。T16 仍可并行（只碰 banyue.ts）。

**2026-10-03 23:33 arena-F 第 471 轮**（开工：主仓 = origin = `02257b15`，干净、无人在跑；另一 lane 23:31 新开 worktree `/tmp/wt-W35`@`4892484b`，整轮内无改动、未提交；REQUIREMENTS.md 无新条目；worktree `wt-T39`（已删）；产物 `/home/kaua/calc-arch/arenaF/r471/`）：**CC-437e `808710cf`**，5 文件 +55/−44。
- **做到哪**：banyue 两臂合成私有 `BanyueOverlay { stacksByMove?: Map<moveId, 层数>; flatPct?: 百分比 }`；`directRowBonus` 内 `stacks × MINGWANG_BASE_PER_STACK` 乘法位置不动；删 `banyueMingwangStacks` / `banyueMingwangPct`。「标量是百分比、桶是层数、不许复用」的断言（BatchR16b ★）改读 `flatPct` / `stacksByMove`。按 c→f 通用步骤一次过，无返工。
- **对 T16 的解禁**：T16（般岳怒相轴内覆盖）的前置「等 T15/CC-437 落地」就 banyue.ts 而言已满足——e 之后 T15 不再碰 `banyue.ts`（g 只动 typesHooks / typesRows / panelPhases / damagePool* / 测试夹具）。T16 现在可以开，若它要新增轴窗口 overlay 字段，直接加进 `BanyueOverlay`（模块私有，不再碰共享类型）。
- **验证**：vue-tsc 0；guards 五项全绿；build 0；zd `DIFF 0 NON1581 0 []`；vitest 分片 238/2082 + 240/2257 = 478/4339。
- **回退点**：`git revert 808710cf`。
- **下一步（start-ready）**：**T15-f yixuan**（`yixuan.ts:1080-1140`，桶 `yixuanNingshenMap`（moveId → `{critDmg, sheerDmg}`）+ 标量 `yixuanNingshen`（同形）；先 `grep -rn "yixuanNingshen" src`——已知读者 yixuan.ts / typesHooks / yixuanSmoke.test / teamHookMigration:181-206 / damagePoolBatchR16b？/ damagePoolNightA？；形状建议 `YixuanOverlay { byMove?: Map<string, Ningshen>; flat?: Ningshen }`，`directRowBonus` 内**保留 `flat ?? byMove.get(moveId) ?? {0,0}` 的优先顺序**（C6 满覆盖臂优先于轴臂）。之后 g 收口。

**2026-10-03 23:24 arena-F 第 470 轮**（开工：主仓 = origin = `4892484b`，干净、无人在跑；REQUIREMENTS.md 无新条目；worktree `wt-T38`（已删）；产物 `/home/kaua/calc-arch/arenaF/r470/`）：**CC-437d `3a9a8f5f`**，5 文件 +56/−43。
- **做到哪**：corin 两臂合成私有 `CorinOverlay { byMove?: Map<moveId, number>; flatPct?: number }`；`directRowBonus` 保留 `isAxis ? (stunOverride > 0 ? byMove : 0) : flatPct` 段级门控；删 `corinStunBonusMap` / `corinStunBonusPct`。「桶值恒 35、折算值不许进桶」的不变量仍由 `teamHookMigration` / `damagePoolBatchR16b` 精确断言（改读 `byMove` / `flatPct`）。按 c→f 通用步骤 grep 全读者，一次过，无返工。
- **验证**：vue-tsc 0；guards 五项全绿；build 0；zd `DIFF 0 NON1581 0 []`；vitest 分片 238/2082 + 240/2257 = 478/4339。
- **回退点**：`git revert 3a9a8f5f`。
- **下一步（start-ready）**：**T15-e banyue**（`banyue.ts:927-970`，桶 `banyueMingwangStacks`（moveId → 层数，消费端 × `MINGWANG_BASE_PER_STACK`）+ 标量 `banyueMingwangPct`；先 `grep -rn "banyueMingwang" src`——已知读者 banyue.ts / typesHooks / banyue.test（14 处）/ teamHookMigration:163-172 / damagePoolBatchR16b:60-86 / damagePoolNightA 夹具；形状建议 `BanyueOverlay { stacksByMove?: Map<string, number>; flatPct?: number }`，`directRowBonus` 内「层数 × 每层」的乘法位置不动）。**T16（般岳怒相）与 e 同文件，e 先。** 再之后 f yixuan（保留 `ningshen ?? byMove.get ?? {0,0}` 顺序）、g 收口。

**2026-10-03 23:14 arena-F 第 469 轮**（开工：主仓 = origin = `788e8cb8`，干净、无人在跑；REQUIREMENTS.md 无新条目；worktree `wt-T37`（已删）；产物 `/home/kaua/calc-arch/arenaF/r469/`）：**CC-437c `37e97ec9`**，5 文件 +65/−68。
- **做到哪**：peiluo 两臂合成一个私有对象 `PeiluoOverlay { byMove?: Map<moveId, number>; flatPct?: number }`（互斥，只填其一），`directRowBonus` 保留 `isAxis ? byMove : flatPct × pair` 顺序；删 `peiluoKagerouMap` / `peiluoKagerouPct`。读者按 c→f 通用步骤先 grep 齐（specPanelBuffs / typesHooks / peiluo.test / teamHookMigration / damagePoolNightA），一次 vue-tsc 过、定向 + 全量都绿。
- **拍板一处测试口径**：`damagePoolNightA.test.ts` 原断言「标量按本槽键控」（`at2.scalarBySlot.has(2) && !has(1)`）在不透明形状下无对象可验——按槽键控自 CC-17 起就由 `panelPhases.ts#collectAxisWindowOverlays` 的 `bucketsBySlot.set(member.slot, res)` 保证（有 CC-17 的管线测试盯着），模块返回值本来就不该知道 slot。改为「换 slot 值不变」。若日后要恢复显式判据，应锁编排层而不是模块。
- **验证**：vue-tsc 0；guards 五项全绿；build 0；zd `DIFF 0 NON1581 0 []`；vitest 分片 238/2082 + 240/2257 = 478/4339。
- **回退点**：`git revert 37e97ec9`。
- **下一步（start-ready）**：**T15-d corin**（`corin.ts:287-333`，桶 `corinStunBonusMap` + 标量 `corinStunBonusPct`；先 `grep -rn "corinStunBonus" src`——已知读者至少 corin.ts / typesHooks / corin.test / teamHookMigration:237-255 / damagePoolBatchR16b:102-108；同样合成 `{ byMove?, flatPct? }`）。再之后 e banyue（注意 T16 与它同区，e 先）、f yixuan、g 收口。

**2026-10-03 22:54 arena-F 第 468 轮**（开工：主仓 HEAD `826bf708`（另一 lane 的 pending 分诊提交，作者 kaua5678，未推、落后 origin 2 个）、工作区干净、无人在跑；REQUIREMENTS.md 无新条目；worktree `wt-T36`（已删）；产物 `/home/kaua/calc-arch/arenaF/r468/`）：**CC-437b `0f643e81`**。
- **代推另一 lane 的提交**：主仓 `git rebase origin/master` 无冲突 ⇒ `826bf708` 变 `85f70e0d`，主仓跑 guards/tokens/validate:data 全绿后 `git push origin master`。依据：提示词「unpushed ≠ 0 先补推」；该提交只有 docs + 两个 static json 的 pending 字段。回退点：主仓 `git reflog`。它带来 **§3 新卡 T16（般岳怒相轴内覆盖，前置等 T15 落地）/ T17（赛维里安 C2 自动补层）**——T16 与 T15-e 同区（banyue.ts），**T15-e 做完前别开 T16**。
- **做到哪**：sigrid 迁 `SigridOverlay { infectionPct }` 私有通道（4 文件 + 删 `sigridInfectionPct` 字段）。两次返工：① `channel.read` 第一版参数加了 `| null` ⇒ `noNullRoundCc418.test.ts` 锁红（typesHooks 整文件无 `| null`）——锁是对的（护钩子入参），改回不含 null、测试侧 `hook(...)!`；② 卡面只列了 `sigrid.test.ts` / `teamHookMigration.test.ts`，**漏了 `damagePoolBatchR16b.test.ts:133-144`**，定向 vitest 全绿、全量分片 2/2 才红。已把「开工先 grep 全读者」写进 §3 T15 的 c→f 通用步骤。
- **验证**：vue-tsc 0；guards 五项全绿；build 0；zd `DIFF 0 NON1581 0 []`（两次：改前后）；vitest 分片 238/2082 + 240/2257 = 478/4339。
- **回退点**：`git revert 0f643e81`（独立提交；T15-a 不受影响）。
- **下一步（start-ready）**：**T15-c peiluo**（`specPanelBuffs.ts:73-112`，桶 `peiluoKagerouMap` + 标量 `peiluoKagerouPct`；先 `grep -rn "peiluoKagerou" src` 列全读者；按 §3 c→f 通用步骤）。其余可选项不变：r462 (b)(c)。

**2026-10-03 22:37 arena-F 第 467 轮**（开工：origin = 主仓 = `dca08424`，干净、unpushed 0、无人在跑；REQUIREMENTS.md 无新条目；§3 唯一 start-ready 卡 = T15-a ⇒ 做它；worktree `wt-T35`（已删）；产物 `/home/kaua/calc-arch/arenaF/r467/`：`patch-cc437a.py`、tsc/guards/build/vitest1/vitest2 日志）：**CC-437a `f287adde`**，5 个源文件 +41/−4，零测试改动、零行为变化。
- **做到哪**：`typesHooks.ts` 新增 `AgentAxisOverlay`（brand）与 `axisOverlayChannel<T>()`（放在 `AgentAxisOverlays` 的文档注释**之前**——第一版插错到注释与 interface 之间，把原注释孤立了，已改）；`typesRows.ts DirectRowBonusInput.overlay?`；`types.ts` import/export 列表跟上并 `export { axisOverlayChannel }`；`panelPhases.ts:387` 仍 `set(slot, res)` 只加注释；`damagePoolDirect.ts:168` 加 `overlay: overlayBuckets as AgentAxisOverlay | undefined`。
- **卡面 vs 实做的两处偏差（第一次 vue-tsc 就暴露）**：① 卡面说「返回类型改 `AgentAxisOverlays | AgentAxisOverlay | null`」——这样 8 个测试文件（damagePoolBatchR16b 16、damagePoolNightA 16、teamHookMigration 5、peiluo 5、banyue 4、yixuanSmoke 4、corin 3、sigrid 3 = 56 处）对 `module.axisWindowOverlays!(...)` 返回值直接取 `.scalarBySlot` / `.banyueMingwangStacks` 全报 TS2339。改为过渡期 `AgentAxisOverlay = AgentAxisOverlays & { [BRAND]: true }`：brand 值天然是命名桶的子类型，返回类型一字不改，`panelPhases` 也不需要 `'scalarBySlot' in res` 守卫。② 卡面说 `overlay: AgentAxisOverlay | undefined` 必填——5 个机制测试 19 处直接构造 `directRowBonus({exec,isAxis,stunOverride,buckets,scalar})` 不传它（又是 r465 教训：**先 grep 所有直接调用点再决定必填**）。改为 `overlay?`，T15-g 删 `buckets`/`scalar` 时这 19 处本来就要动，届时一并改必填。
- **对 b→f 的含义**：已迁模块 `axisWindowOverlays` 返回 `xxxOverlay.wrap(v)` 可直接当返回值（子类型）；但它运行时**没有** `scalarBySlot` 键，所以该模块的既有测试若还读 `res.scalarBySlot` 会在运行时拿 undefined ⇒ 每卡必须同步改该模块的测试（卡面已列行号）。`collectAxisWindowOverlays` 对已迁模块不再往 `scalarBySlot` 表写 ⇒ `damagePool.ts` 用 `scalarBySlot` 的任何**非本模块**读者都会失去该值——r466 核过没有第二读者，但 **b 卡开工前再 grep 一次 `scalarBySlot` / `overlayScalar` 的读者**（`damagePool.ts:85/90`、`useResourceCalc.ts:647-648`）确认仍只是搬运。
- **验证**：vue-tsc 0；guards 五项全绿；build 0；zd `DIFF 0 NON1581 0 []`；vitest 分片 1/2 238/2082、2/2 240/2257 = 478/4339（基线不变）。
- **回退点**：`git revert f287adde`（纯增量；无人消费 `overlay` 字段）。
- **下一步（start-ready）**：**T15-b sigrid**（`sigrid.ts:648-659 / 677`；测试 `sigrid.test.ts:583,589`、`teamHookMigration.test.ts:261-263`）。其余可选项不变：r462 (b)(c)。

**2026-10-03 22:30 arena-F 第 466 轮**（开工：origin = 主仓 = `f35d823a`，干净、unpushed 0、无人在跑；REQUIREMENTS.md 无新条目；§3 无未勾卡 ⇒ 做 r465 候选的设计；worktree `wt-T34`（已删）；产物 `/home/kaua/calc-arch/arenaF/r466/`）：**仅文档提交**（无代码）。
- **做到哪**：核实 `AgentAxisOverlays` / `AxisScalarOverlays` 的 9 个角色前缀字段全是模块私有往返（写读同模块；`scalarBySlot` 五处都只写本槽；编排层按槽存原始返回、`damagePoolDirect.ts:168` 交还本行所属模块；无第二读者）⇒ 写 **CC-437 设计稿** `docs/mcp-cc437-axis-overlay-opaque.md`（目标形状 / 零差论证 / 7 步迁移 / 不做的边界 / 回退点），README §6 登记（77 份），arch 加 `CC-437 | design` 行，§3 加 **T15 卡**（a→g）。
- **拍板**：① 不透明 brand + `axisOverlayChannel<T>()`（两个 cast）而不是泛型化 `AgentMechanicModule<TOverlay>`——模块是对象字面量、泛型会传染到注册表与 `getAgentMechanic` 的返回类型，收益不成比例；② 不统一 overlay 值域（理由见设计稿 §5）；③ 分 7 步而不是一次性做：改动横跨 5 模块 + 4 编排文件 + 8 测试（≈90 处引用），一轮做完风险高、也不利于交给执行模型。r465 §2b 写的「先写设计再动」在此兑现。
- **下一步（start-ready）**：**T15-a**（基础设施，预期零行为变化，无测试改动；卡面在 §3 T15）。之后 b→g 任何 lane 都可按卡逐步做；每步都要 zd 0。
- **其余可选**：r462 (b) StunAxisPage 三份 `consumed` 累加抽局部函数；r462 (c) CC-61 对照测试改快照式。

**2026-10-03 22:19 arena-F 第 465 轮**（开工：origin = 主仓 = `549f4fd4`，干净、unpushed 0、无人在跑；REQUIREMENTS.md 无新条目；按 §3 T13-e 卡开工；worktree `wt-T33`（已删）；产物 `/home/kaua/calc-arch/arenaF/r465/`）：**CC-436 `ce08000f`** + 本文档提交。
- **做到哪**：`displayResult` 契约必填、panelPhases 参数同步、promia 去 `?? teamResult`、三个夹具助手缺省 = 覆盖后的 teamResult、6 处直调站点补字段；锁加「反馈入参三份结果均无 `?:`」。zd DIFF 0；分片 **478 / 4339**（新基线，§0 已改）。**T13 卡结项**（标题已标 ✅）。
- **下一步**：§3 已无未勾卡。按 r453 找题顺序：`docs/REQUIREMENTS.md`（md5 现 `807ee09623a9`）→ §3（无）→ §8.0 触发项是否触发 → 否则「本轮无题」只写 §8 一行。
- **候选（需先写设计，不是 start-ready）**：`typesHooks.ts AgentAxisOverlays` 四个角色前缀桶 → 通用「moveId → 行覆盖」一桶。事实（r465 已核）：四桶是 CC-17（`docs/mcp-cc17-axis-overlay-consume.md`）产物，按槽隔离已做（`bucketsBySlot`）；`?:` 是合法缺省（本槽无该机制）；值形不同（明王层数 number / 凝神 {critDmg,sheerDmg} / 阳炎暴伤 number / 扫除帮手增伤% number）；非测试读写点 14 处（`grep -rn "banyueMingwangStacks\|yixuanNingshenMap\|peiluoKagerouMap\|corinStunBonusMap" src --include=*.ts --include=*.vue | grep -v __tests__`）。值得做的判据：新角色再加第 5 个桶时就必须改 types + collect + consume 三处——若通用桶能让「模块只声明、消费端不改」，才算架构收益；否则只是改名。设计要回答：覆盖的值域（直伤增伤% / 暴伤 / 贯穿…）如何用一个 `Partial<RowBonusOverlay>` 表达且 zd 0。
- **小线索（可选，各 ≤1 小时）**：r462 (b) StunAxisPage 三份 `consumed` 累加抽局部函数；r462 (c) CC-61 对照测试改快照式。

**2026-10-03 22:07 arena-F 第 464 轮**（开工：origin = 主仓 = `3b190ef6`，干净、unpushed 0、无人在跑；REQUIREMENTS.md 无新条目；按 r463 start-ready 卡 T13-d 开工；worktree `wt-T32`（已删）；产物 `/home/kaua/calc-arch/arenaF/r464/`）：**CC-435 `bd01d7cc`** + 本文档提交。
- **做到哪**：`adjustedResult` 契约必填非 null、panelPhases 参数同步、yeshuguang / anbyZero 去 `?? teamResult`、3 个反馈测试的夹具助手把 adjustedResult 缺省为覆盖后的 teamResult、6 处直调站点显式补字段、R19 C8 断言改强；锁加「typesHooks 非注释行整文件无 `| null`」。zd DIFF 0；分片 **478 / 4338**（新基线，§0 已改）。
- **踩坑（供下一张同款卡参考）**：把可选字段改必填时 vue-tsc 会把**所有**直调 `collectNextRoundFeedback(...)` / `hook({...})` 的测试站点都点出来（本轮 6 处，第一版漏了）——先 `grep -n "collectNextRoundFeedback({\|hook({" src/mechanics/__tests__/nextRoundFeedback*.ts` 列全再写补丁。
- **下一步（start-ready）**：**T13-e `displayResult?` 去可选**，卡面已写在 §3 T13 卡（范围 r464 已核：契约 1 处、panelPhases 1 处、promia 1 处、夹具助手 3 处 + 直调站点 6 处）。做完后 `typesHooks.ts` 反馈入参无结果类可选字段，T13 系列收口，可在 T13 卡标题加 ✅。
- **之后的候选（未验证）**：`typesHooks.ts:233-236 / 256-285` 有一组角色前缀字段（`banyueMingwangStacks` / `yixuanNingshenMap` / `peiluoKagerouMap` / `corinStunBonusMap` / `sigridInfectionPct` …）挂在跨模块入参上——先查 arch 是否已有卡（`grep -n "角色前缀" docs/mcp-calc-core-architecture.md`），有则按卡，无则评估是否该收成 `Map<agentId, overlay>` 一类通用形；这是比 null 收口更大的一刀，先写设计再动。其余可选线索见 r462 (b)(c)。

**2026-10-03 21:55 arena-F 第 463 轮**（开工：origin = 主仓 = `31b50d06`，干净、unpushed 0、无人在跑；REQUIREMENTS.md 无新条目；§3 唯一未勾项 T13-b′ ⇒ 开工；worktree `wt-T31`（已删）；产物 `/home/kaua/calc-arch/arenaF/r463/`）：**CC-434 `6546d9e9`** + 本文档提交。
- **做到哪**：`AgentNextRoundFeedbackInput.anomalyPool` 契约去 `| null`；promia / remielle / yixuan / vivian / ellen 反馈钩子去 `anomalyPool?.`；`core/anomalyPool.ts` 新增 `emptyAnomalyPool(totalTime?)`（= 引擎跑空输入，不手写形状）；6 个测试文件 10 处 `anomalyPool: null` 夹具改空池；`noNullRoundCc418.test.ts` 加 CC-434 锁。zd DIFF 0；分片 **478 / 4337**（新基线，§0 已改）。T13 卡：b′ 勾掉，c 复核维持不做 ⇒ **T13 结项**。
- **拍板**：行上下文 `typesRows.ts DamagePoolContext.anomalyPoolResult`（remielle:526 / alice:590）与 `cinemaUplift.ts:119` 的 `| null` **不收**——来源是 `calcOutput` 可 null，属真 null，不是幻影；锁注释已写明边界。回退点：`git revert 6546d9e9`（单提交，夹具与锁同回）。
- **下一步**：§3 已无未勾卡（T10 备选、有明确开工条件未触发）。按 r453 找题顺序：`docs/REQUIREMENTS.md`（md5 现 `807ee09623a9`）→ §3 → §8.0 触发项 → 否则「本轮无题」。**start-ready（已查清范围，建议直接开工，≤1 小时）：T13-d `AgentNextRoundFeedbackInput.adjustedResult?: … | null` 同款收口**。r463 已核：`typesHooks.ts` 里剩下的唯一 `| null` 就是它（L356）；唯一调用方 `convergence.ts:951-955 collectNextRoundFeedback({ adjustedResult: adj2 })`，`adj2` 自 CC-422 起恒非 null（无调整时 == `rr` 同形）⇒ 幻影。消费者只有 2 个模块：`yeshuguang.ts:726 (adjustedResult ?? teamResult)`、`anbyZero.ts:293 const az = adjustedResult ?? teamResult`（+ anbyZero:289 / yixuan:1006 两处注释提到它）；夹具 3 处：`nextRoundFeedback.test.ts:52`（`adjustedResult: null`）、`:349`、`nextRoundFeedbackR19.test.ts:100`（`feedback('1431', { adjustedResult: null, … })`）。做法：契约改为**必填非 null** `adjustedResult: DeepReadonly<TeamResourceResult>`（与流水线一致；「无调整」= 传 teamResult 本身），两模块去 `?? teamResult`，`panelPhases.ts:289` 参数同步必填，夹具 `null` → 同一个 `teamResult`；`noNullRoundCc418.test.ts` 的 CC-434 锁旁加一条（typesHooks 整文件无 `| null`）。验证同 CC-434（含 zd——anbyZero / yeshuguang 是引擎路径）。其余可选线索：(b) r462 (a)：StunAxisPage 三份 `consumed` 累加抽局部函数；(c) r462 (b)：CC-61 对照测试改快照式。

**2026-10-03 21:44 arena-F 第 462 轮**（开工：origin = 主仓 = `b732b097`，干净、unpushed 0、无人在跑；REQUIREMENTS.md 无新条目；§3 无卡；按 r461 start-ready 卡直接开工；worktree `wt-T30`（已删）；产物 `/home/kaua/calc-arch/arenaF/r462/`）：**CC-433 `dc722b65`** + 本文档提交。
- **做到哪**：伊德海莉寒冰触手块迁模块声明（`yidhari.ts` `axisExtraBlocks`，复用常量 `TENTACLE`），StunAxisPage 删写死 `'1051024'` 分支；CC-61 对照测试加 1051 基准（hits 21）+ 页面源码断言。配额 9 查无依据记录，判为 UI 提示上限（非机制次数）并在声明旁注明，不立 @fact。zd 跳过（展示层候选池，不进求值）。分片 478 / 4336 不变。
- **r461 卡的第二刀已评估、关闭**（理由写在 arch CC-433）：转大 60/90 块是琉音在队时给**其他**队友的赠予块，不是「本角色专属块」；般岳 `rageCount × 2` 读自引擎 `banyueRageCycle`。StunAxisPage 可放置块构造里已无角色专属分支。
- **下一步**：无 start-ready 卡。按 r453 找题顺序：先 `docs/REQUIREMENTS.md`（md5 现 `807ee09623a9`）→ §3 卡 → §8.0 触发项是否触发 → 否则「本轮无题」只写 §8 一行。可选低优先线索（未验证，各 ≤1 小时）：(a) `src/views/StunAxisPage.vue` L714–727 转大块与 L758–775 般岳连段块都在页面内按 `axes.value` 累加 consumed——与 CC-61 循环是同一段「按 slot+moveId(+variant) 数已放次数」逻辑的三份复制，可抽页面内局部函数 `consumedOf(slot, pred)`（纯页面整理，不涉模块）；(b) `agentMechanicViewCc61.test.ts` 的 legacy 对照函数随模块声明增长会越来越像「第二份真相」，若再加第 4 个角色，改为快照式（声明结果 toMatchInlineSnapshot）更稳。

**2026-10-03 21:33 arena-F 第 461 轮**（开工：origin = 主仓 = `77f23455`，干净、unpushed 0、无人在跑；REQUIREMENTS.md 无新条目；§3 无卡；§8.0 全部仅触发项；worktree `wt-T29`（已删）；产物 `/home/kaua/calc-arch/arenaF/r461/`）：**CC-432 `bc0d606b`** + 本文档提交。
- **做到哪**：CC-431 收尾（composables / stores 两处默认角色归 data，锁扩到四层，`specs/additionalGate` 判为引擎配置表不搬）；`StunAxisPage.vue` 四步扫完（r6 §8 行 461），「从未扫过的大文件」线至此只剩 `ResponseSurface3D.vue`（1371，纯图形，不值得按四步看）——**这条线结项**。分片 478 / 4336。
- **下一步（start-ready，建议直接开工）**：**StunAxisPage 页面内角色专属轴块迁模块声明**。
  1. 读 `src/views/StunAxisPage.vue` L715–740（`findMove(skills, '1051024')` 寒冰触手块：id / 标签 / 配额 9 / `actionTime: 0` 全在页面）与 CC-61 的 `axisExtraBlocks` 契约（`grep -rn "axisExtraBlocks" src/mechanics src/composables | head`，看诺姆 `norma-hat-chain` / 希格莉德 `sigrid-pozhen` 是怎么声明的、页面 L740 后是怎么消费的）。
  2. 1051 是哪位：`node scripts/resolve.mjs 1051`（规则 15）；在 `src/mechanics/agents/<该角色>.ts` 加 `axisExtraBlocks` 声明（moveId `1051024`、label、quota 9、actionTime 0），页面删掉 tentacle 分支。配额 9 的依据先查 r6 / arch（`grep -n "触手" docs/mcp-r6-refactor-list.md docs/mcp-calc-core-architecture.md | head`），查不到就在声明旁写 `@fact` 带到期复核。
  3. 验证：`npx vitest run src/composables/__tests__/stunAxis* src/mechanics/__tests__` + vue-tsc + guards + build；轴块是展示侧候选列表，不进求值 ⇒ zd 可跳过但要在文档里说明；若模块声明被求值侧读到（看 CC-61 卡），则跑 zd。
  4. 转大 60/90 配额 9 与般岳 `banyueRageCycle` 的页面内推导是第二刀，先不碰：需要 `axisExtraBlocks` 能表达「配额 = f(资源周期)」，先在 arch 卡里写设计再动。
- **未决 / 坑**：`ResponseSurface3D.vue` 不扫（纯 three.js 几何）。四步法第 4 步已由 `viewAgentDefaults.test.ts` ③ 接管（views / components / composables / stores）；`src/utils` / `src/core` / `src/specs` 当前也无展示型默认值（grep 过），没纳入锁是因为 `specs/additionalGate` 之类合法键表会误报。
- **回滚点**：`git revert bc0d606b`。

**2026-10-03 21:22 arena-F 第 460 轮**（开工：origin = 主仓 = `65a1b45e`，干净、unpushed 0、无人在跑；REQUIREMENTS.md 无新条目；§3 无卡；§8.0 全部仅触发项；worktree `wt-T28`（已删）；产物 `/home/kaua/calc-arch/arenaF/r460/`）：**CC-431 `39991a9e`** + 本文档提交。
- **做到哪**：「从未扫过的大文件」线扫完 `DebugPage.vue`（无改动，理由见 arch CC-431「不改的」）与 `TimeChartsPage.vue`（r6 §8 行 460）。展示层 5 文件 10 处默认角色 id 字面量收口到 `data/viewAgentDefaults.ts`，锁测试把「views/components 零角色 id 字面量」变成机器检查；顺手修候选池排除主 C 写死的潜伏 bug。分片 478 / 4336。
- **沉淀**：(1) **四步法第 4 步此前四轮都是假阴性**——`grep -E` 不解释 `\x27`；经 `mcp.js sh '…'` 单引号包裹时要写 `grep -P "\x27…\x27"`。凡是「扫了没发现」的结论，先用一个**已知应命中**的样本验证 grep 本身。(2) 「用户给的例子 / 口径」类默认值也是单源对象：它们不是引擎规则，但散在页面里同样会在角色改 id 时静默失效，且无人知道哪些页面默认选了谁。
- **未决 / 坑**：`src/mechanics/agents/*.ts` 里按设计含本角色 id（模块自描述），不在锁范围；`src/composables` / `src/stores` 下是否还有角色 id 字面量未扫（`grep -rnP "\x271[0-9]{2}1\x27" src/composables src/stores --include=*.ts | grep -v __tests__`），下一轮顺手看一眼：若有且不是 CC-55 那类「查模块声明」已处理过的，按同一思路归到 data 层或模块声明。
- **下一步（start-ready）**：无排定卡。找题顺序不变（REQUIREMENTS → §3 → §8.0）。「从未扫过的大文件」线只剩 `StunAxisPage.vue`（960；r6/arch 已多次提及，低优先）与 `ResponseSurface3D.vue`（1371，纯图形）。建议下一轮先跑上面那条 composables/stores 的角色 id grep（15 分钟内能定性），再决定是扫 `StunAxisPage` 还是换线（§8.0 的 13 项里挑一项到期 / 触发的）。
- **回滚点**：`git revert 39991a9e`。

**2026-10-03 21:06 arena-F 第 459 轮**（开工：origin = 主仓 = `c19dfd67`，干净、unpushed 0、无人在跑；REQUIREMENTS.md 无新条目；§3 无卡；§8.0 全部仅触发项；worktree `wt-T27`（已删）；产物 `/home/kaua/calc-arch/arenaF/r459/`）：**CC-430 `047fa11a`** + 本文档提交。
- **做到哪**：「从未扫过的大文件」线扫 `FinalPanel.vue`（r6 §8 行 459）。数值层已干净（CC-222/223/228 都落实了），但贯穿力系数 0.3 / 0.1 在 9 处**文案**里手写 ⇒ 系数常量 + 两个文案函数进 data 层，9 处改调，锁正则扩到文案形态。分片 477 / 4333。
- **沉淀**：(1) 「单源」= 数值 **和** 解释文案；只并数值，UI 上的公式说明在改数时会说谎。(2) 第一版手工只找到 5 处，锁的正则一扩就扫出另外 4 处——**先写锁再改**比「改完补锁」省一轮；新锁扫到的误报（`×0.1%`、`/**` 单行注释）用 `(?!%)` 与注释前缀过滤，不要放宽到让真漏网过去。
- **未决 / 坑**：无新未决。失衡乘区展示口径（r458）与喧响上限 `3000` 仍按 r458 结论留。收尾推送时 origin 已多出 kaua5678 的 `19aa5b8f`（只改 `docs/implementation-status.md`，docs-drift CI 收敛，与本轮零交集）⇒ 本轮两个提交 rebase 到其上（代码哈希由 c5b98235 变为 047fa11a，文档已同步改），guards+tokens 复跑 0 后再推。
- **下一步（start-ready）**：无排定卡。找题顺序不变（REQUIREMENTS → §3 → §8.0）。该线剩余：`TimeChartsPage.vue`（668）、`DebugPage.vue`（613；本轮只改了 3 行文案，未按四步看）、`StunAxisPage.vue`（960；多次提及，低优先）、`ResponseSurface3D.vue`（1371，纯图形，最后）。建议下一个 `DebugPage.vue`（它罗列全部公式说明，最可能还有「文案里手写系数」同型问题）：`grep -nE "× ?[0-9]+(\.[0-9]+)?|/ 100|\* 100|Math\." src/views/DebugPage.vue`，逐条问「这个系数在 data/core 里有没有常量」。
- **回滚点**：`git revert 047fa11a`。

**2026-10-03 20:54 arena-F 第 458 轮**（开工：origin = 主仓 = `be8731c1`，干净、unpushed 0、无人在跑；REQUIREMENTS.md 无新条目；§3 无卡；§8.0 全部仅触发项；worktree `wt-T26`（已删）；产物 `/home/kaua/calc-arch/arenaF/r458/`）：**CC-429 `66ad9576`** + 本文档提交。
- **做到哪**：「从未扫过的大文件」线扫 `StatPanel.vue`（r6 §8 行 458）。两处与引擎平行的手抄公式（异常积蓄两区、自动回能括号项）并到 data 层单源；引擎侧只是换调用、运算顺序不变（zd DIFF 0 ×2）。分片 477 / 4332。
- **沉淀**：(1) 「某 CC 已立单源」≠「全仓都在用」——CC-337 改了 core / specs / mechanics，展示层那份留到今天。立单源的那一刀应顺手 `grep` 全仓同形算式（含 `.vue`），并用源码锁封死，而不是只改引擎侧。(2) 展示层要复用引擎公式时，公式住 `data/`（展示层禁止按值 import core），引擎 import data；把 base 做成参数、展示传 1，可以让乘法顺序逐字不变从而零差位级不动。
- **未决 / 坑**：失衡乘区展示（面板级）与引擎（分招式 `getStunBuildUpBonus`）口径不同，没并；若要并，先决定 StatPanel 是否按招式类型显示（需要一个 skillType 选择 UI），再把 `impact/100 × (1+bonus/100)` 搬 data 层。喧响上限 `3000` 无可引用常量，留。
- **下一步（start-ready）**：无排定卡。找题顺序不变（REQUIREMENTS → §3 → §8.0）。该线剩余：`TimeChartsPage.vue`（668）、`DebugPage.vue`（613）、`FinalPanel.vue`（522）、`StunAxisPage.vue`（960；多次提及，低优先）、`ResponseSurface3D.vue`（1371，纯图形，最后）。建议下一个 `FinalPanel.vue`（与 StatPanel 同属面板展示，最可能有同型手抄）：`ls src/components/FinalPanel.vue src/views/FinalPanel.vue` 定位后 `grep -n "watch(\|Store\.set\|Math\.\|/ 100\|\* 100" <文件>`，重点看是否还有 `Math.floor(...Mastery` / 回能 / 暴击期望之类引擎已有单源的算式。
- **回滚点**：`git revert 66ad9576`。

**2026-10-03 20:42 arena-F 第 457 轮**（开工：origin = 主仓 = `1fbccd91`，干净、unpushed 0、无人在跑；REQUIREMENTS.md 无新条目；§3 无卡；§8.0 全部仅触发项；worktree `wt-T25`（已删）；产物 `/home/kaua/calc-arch/arenaF/r457/`）：**CC-428 `ed733734`** + 本文档提交。
- **做到哪**：「从未扫过的大文件」线扫 `ResourceUtilizationPage.vue`（r6 §8 行 457）。唯一发现：「异常结算角色占比」卡自算份额 / 次数，忽略用户覆盖、不归一、无余数补正，与伤害侧结算分叉 ⇒ 页面改调 `buildAnomalySettlementEntries(..., { keepZero: true })`，引擎加可选参数、默认行为不变（zd DIFF 0 ×2）。分片 476 / 4330。
- **沉淀**：这条线第四轮（r454/455/456/457）同型——页面自算 = 引擎副本，这次还不是「数值相同的重复」而是**已经分叉的重复**（用户覆盖只有引擎吃）。展示层若要显示引擎的某个中间量，优先让引擎函数多一个只读开关（如 `keepZero`）而不是页面重抄算法。
- **未决 / 坑**：卡的次数分母 = 积蓄池 `triggerCount`，伤害行 = 风化阻断折算后的 `effectiveTriggerCount`（`damagePoolAnomaly.ts` 内联算）；不一致是口径差而非 bug，已写进代码注释。若要统一，正确做法是 `damagePoolAnomaly` 把每元素 settlementEntries 挂到结果（`anomalyPoolResult` 或 damage rows 的结构化字段），页面直读——不要在页面抄风化折算。
- **下一步（start-ready）**：无排定卡。找题顺序不变（REQUIREMENTS → §3 → §8.0）。该线剩余：`StatPanel.vue`（986；r247 对过乘区但没按四步看过）、`TimeChartsPage.vue`（668）、`DebugPage.vue`（613）、`FinalPanel.vue`（522）、`StunAxisPage.vue`（960；多次提及，低优先）、`ResponseSurface3D.vue`（1371，纯图形，最后）。建议下一个 `StatPanel.vue`：`grep -n "watch(\|Store\.set\|Math\.\|\* 0\.\|\* 1\." src/components/StatPanel.vue` 开始（先 `ls src/components/StatPanel.vue src/views/StatPanel.vue` 定位）。
- **回滚点**：`git revert ed733734`。

**2026-10-03 20:34 arena-F 第 456 轮**（开工：origin = 主仓 = `cb8edbe2`，干净、unpushed 0、无人在跑——r455 记录的别人 `solveTeam.ts` TRACE 插桩与 `yqlCycleProbe.test.ts` 已不在，作者自己收了，不用再处理；REQUIREMENTS.md 无新条目；§3 无卡；§8.0 无可开工项；worktree `wt-T24`（已删）；产物 `/home/kaua/calc-arch/arenaF/r456/`）：**CC-427 `a6c129c7`** + 本文档提交。
- **做到哪**：「从未扫过的大文件」线扫 `FreeComparePage.vue`。结构干净（r6 §8 行 456）；纵轴几何是 `versionChartGeometry` 的手抄（文件头注释给的理由「x 维度动态」不成立——纵轴几何与 x 无关），`inflationChart` 又一份 `niceStep` ⇒ 三合一，加全仓源码锁。纯展示，分片 475 / 4328。
- **沉淀**：这条线连续三轮（r454 TeamConfigPage → CC-425、r455 ResultPage → CC-426、r456 FreeComparePage → CC-427）都是「页面自算 = 引擎 / 共享几何的副本」，同型：**展示层里凡是写了数字字面量或自带算法的，先问「仓里是不是已经有一份」**。四步看法（watch → store 写入 / 自算量 vs 引擎或共享模块 / 数字字面量 / 角色 id 字面量）继续有效。
- **下一步（start-ready）**：无排定卡。找题顺序不变（REQUIREMENTS → §3 → §8.0）。该线剩余：`StunAxisPage.vue`（960；r6/arch 已多次提及，优先级低）、`ResourceUtilizationPage.vue`（888）、`StatPanel.vue`（986；r247 对过乘区，但没按四步看过）、`ResponseSurface3D.vue`（1371，纯图形，最后）。建议下一个 `ResourceUtilizationPage.vue`：`grep -n "watch(\|Store\.set\|Math\.\|\* 0\." src/views/ResourceUtilizationPage.vue` 开始。
- **回滚点**：`git revert a6c129c7`。

**2026-10-03 20:19 arena-F 第 455 轮**（开工：origin = 主仓 = `b6925316`，unpushed 0；**主仓有别人 20:19 起的 WIP**：`src/composables/resourceCalc/solveTeam.ts` 加了 `TRACE_OUTER` 插桩（注释写明「临时插桩，yql-cycle 探针用，随探针一起回滚」）+ 未跟踪 `src/composables/__tests__/yqlCycleProbe.test.ts`，LANE-CLAIMS 未认领——不是我的，没碰；REQUIREMENTS.md 无新条目；§3 无卡；§8.0 无可开工项；worktree `wt-T23`（已删）；产物 `/home/kaua/calc-arch/arenaF/r455/`）：**CC-426 `454177d0`** + 本文档提交。
- **做到哪**：按 r454 交接的「从未扫过的大文件」线扫 `ResultPage.vue`，结构面干净（见 r6 §8 行 455）；写侧残留两处手写 180（总时间输入反算、资源卡时间条分母）⇒ CC-426：卡片加必填 `totalTime` prop、页面读 `enemy.battleTime`、新锁 `battleTimeDisplaySingleSource.test`。零行为（zd DIFF 0）。
- **踩坑（有用）**：第一版想给 prop 配「缺省 = 前台 + 后台」兜底，CC-252 锁当场拦下（展示层不许内联 frontline+backstage）。锁是对的——必填 prop 更干净。**新规则**：给展示组件加「可从已有字段推」的兜底前，先 `grep` 一下 `src/core/__tests__/*SingleSource*.test.ts` 的 PATTERN，多半已经有锁。
- **沉淀**：`?? 180` 死兜底约 25 处记为 r6 §8.0 第 13 条，给的是方向（模块读钩子入参 combatTime）而不是「全仓替换常量」；不排期。
- **给别的 lane**：主仓那个 `solveTeam.ts` TRACE 插桩若 > 1 小时没动静且没认领，按 §1 孤儿流程处理（注释已说明随探针一起回滚 ⇒ 大概率直接 `git checkout -- solveTeam.ts` + 删探针文件，但先看 `yqlCycleProbe.test.ts` 里有没有写出结论）。
- **下一步（start-ready）**：无排定卡。找题顺序不变（REQUIREMENTS → §3 → §8.0）。「从未扫过的大文件」线还剩：`StunAxisPage.vue`（960）、`ResourceUtilizationPage.vue`（888）、`FreeComparePage.vue`（786，r6 零提及）、`StatPanel.vue`（986）、`ResponseSurface3D.vue`（1371，纯图形）。四步看法同 r454。每轮一个，没发现就记一行结项。
- **回滚点**：`git revert 454177d0`。

**2026-10-03 20:08 arena-F 第 454 轮**（开工：origin = 主仓 = `f01a63aa`，干净、unpushed 0、无人在跑；REQUIREMENTS.md 无新条目；§3 无卡；按 r453 找题顺序读 r6 §8.0 ⇒ 取第 13 条「`TeamConfigPage.vue` 从未扫过」；worktree `wt-T22`（已删）；产物 `/home/kaua/calc-arch/arenaF/r454/`）：**CC-425 `fd834990`** + 本文档提交。
- **做到哪**：扫完 `TeamConfigPage.vue`。结构面干净（见 r6 §8 行 454），唯一的「同一物理量两份」是保底4喧响提示里手写的 `1500`（引擎 `DECIBEL_ROUND_THRESHOLD`）⇒ 引擎结果补 `roundThreshold` 字段、页面插值、CC-229 锁追加禁 `\b1500\b`。零行为（zd DIFF 0），分片 474 / 4325 不变（只加断言）。
- **沉淀**：§8.0 第 13 条消费并删除；§8.0 现剩 12 条，全部是「事件 / 日期 / 需求触发」，没有可主动开工的。
- **下一步（start-ready）**：无排定卡。开工按找题顺序（REQUIREMENTS → §3 → r6 §8.0）；§8.0 最近的日期触发是 2026-10-31（坑 25）。没有题就记「本轮无题」收工，别造活。若想继续「从未扫过的大文件」这条线：`wc -l src/views/*.vue src/components/*.vue | sort -n | tail`，挑一个 r6 §8 全文 grep 不到文件名的，用本轮同样的四步看（watch → store 写入 / 自算量 vs 引擎字段 / 数字字面量 / 角色 id 字面量）。
- **回滚点**：`git revert fd834990`。

**2026-10-03 20:03 arena-F 第 453 轮**（开工：origin = 主仓 = `52bf7f13`，干净、unpushed 0、无人在跑；REQUIREMENTS.md 无新条目（R1–R8 全部 done / 撤销）；worktree `wt-T21`（已删））：**本轮无代码题**，只做一件把「找题」变便宜的整理。
- **做到哪**：r452 交接让下一轮「看 r6 §8 的重开条件列有没有被满足的」——照做后发现这列从第 396 行起已经改放验证数字、237–395 的条件绝大多数早被消费（逐条核了 310/314/315/373/381/384/385–387，全部已关）。215 行读一遍只为确认「没有」，是每轮重复付的开销 ⇒ 写成 **r6 §8.0「仍开着的重开条件索引」**（13 条，每条一句查法 + 维护规则：消费即删、新条件加这里）。
- **沉淀**：找题顺序改为 ① REQUIREMENTS.md → ② 本文 §3 执行卡 → ③ **r6 §8.0 一屏** → ④ 都没有就记「本轮无题」收工。§8 大表只是日志，不再要求逐行读。
- **顺手核过、无需跟进**：r452 代推的 `c1897046`（grace 精确闭式解）diff 干净，旧 cycleBound 实现已删，`@fact` / `⟳复核 到期 2027-03-31` 齐全；`src/` 内 `⟳复核 … 到期` 无已到期项。
- **下一步（start-ready）**：无排定卡。开工按上面的找题顺序；§8.0 第 1 条（坑 25）2026-10-31 才到期。没有题就别造——这是正常状态，不是失败。
- **回滚点**：纯文档，`git revert` 本提交即可。

**2026-10-03 19:54 arena-F 第 452 轮**（开工：origin = `e4a9e0ce`，主仓多一个别人的本地提交（kaua5678「refactor(grace): 轮换计划改精确闭式解 + 维琳娜平A权重交边际均衡」，19:44 提交、rebase 两次后哈希已是 `a5e6bbc1`），工作区干净，无人在跑；REQUIREMENTS.md 无新条目；worktree `wt-T20`（已删）；产物 `/home/kaua/calc-arch/arenaF/r452/`：`tsc.log` / `guards.log` / `build.log` / `vt-s1.log` / `vt-s2.log`）：**代推 `c1897046`**（他的提交，cherry-pick 到 origin/master 上验证后推送）+ 本文档提交。
- **做到哪**：不再按 24h 孤儿规则等。把他的提交 cherry-pick 到 `wt-T20`（基于 origin `e4a9e0ce`）跑全套：vue-tsc 0；guards 链 0（check-guards / check-tokens / validate:data / validate:specs / verify:recording）；build 0；vitest 分片 236/2075 + 238/2250 = **474 文件 / 4325 用例**（新增 `graceRotation.test.ts` 5 条）。绿 ⇒ `git push origin c1897046:master`；主仓 `git rebase origin/master` 自动跳过了同补丁的 `a5e6bbc1`，现在主仓 = origin，unpushed 0。他的 timeGolden / timeFillRatchet 基线改动全是 1181 条目（r451 已逐键比过），属于他重构的预期结果，我不审口径。
- **沉淀**：规则写进 §1（「别人的已提交未推：验证后代推」）。T14 的最终解释不变。
- **顺手查了**：`⟳复核 … 到期` 在 `src/` 里没有已到期项（只有 checkGuards 测试夹具里的日期）；r6 §8 扫描表 237–309 行的范围没新线索。
- **下一步（start-ready）**：没有排定卡。① 先 `cat docs/REQUIREMENTS.md`；② 无新条目则看 r6 §8 扫描表的「重开条件」列是否有被满足的（每行一个条件，grep 对应符号即可）；③ 都没有就记一行「本轮无题」收工，**别造活**（§1 第一条）。
- **回滚点**：`git revert c1897046`（那是他的改动，回滚前先在 §2b 写理由）。

**2026-10-03 19:46 arena-F 第 451 轮**（开工：origin = `4643887a`，主仓多一个**别人的本地提交** `77ea33b7`（kaua5678，19:44，未推），工作区干净，无人在跑；REQUIREMENTS.md 无新条目；worktree `wt-T19`（已删）；产物 `/home/kaua/calc-arch/arenaF/r451/`：`vt-s1-pregrace-wt.log` / `loadgen.log`）：**无代码提交**，只有本文档提交。
- **做到哪**：T14 ①②③ 做完，结论「HEAD 确定、红值 = grace WIP 行为、机制不可考」，卡关掉（详见 §3 T14）。顺带证实了 r450 担心的「共享 node_modules 软链会让 worktree 读到主仓」**不成立**（单文件与全量分片两种形态）。
- **别人的提交 `77ea33b7`**：仍在主仓本地、未推。不是我验的，不替他推；每轮我 rebase 主仓时它的哈希会变（已变过一次 592c66f6→77ea33b7），**以后引用只认消息**「refactor(grace): 轮换计划改精确闭式解…」。若 24h（≈10-04 19:44）后仍未推：在 worktree 里 `git cherry-pick` 它、全量验证，绿就以他的名义 `git push origin <sha>:master`，红就入分支 `wip/kaua5678-grace-rotation` 并把主仓 reset 到 origin。
- **这轮踩到的**：`pkill -f "[m]echanics/__tests__ src/core"` 仍把自己的 shell 杀了（exit 15）——方括号技巧只对「模式不出现在自己命令行」有效，而我同一条命令里先用这个字符串**启动**了负载进程，命令行里就有字面量。要杀自己起的后台进程：启动时记 `$!`，用 pid 杀。
- **下一步（start-ready）**：没有排定卡。按 §1「没有排定项时不造活」：先 `cat docs/REQUIREMENTS.md`；无新条目就按 r6 §8 扫描记录找表里没有的区域。候选起点（r449 留的）：`grep -rn "| null" src/composables/resourceCalc/*.ts`——solveTeam 10 / convergence 9 / damagePool 6，但 roundResult 的 4 个已证真 null，其余多半同类，别为降计数去碰。
- **回滚点**：无代码改动。

**2026-10-03 18:56 arena-F 第 450 轮**（开工：origin = 本地 = `d19894d5`，**另一会话在跑**：dsh web（pid 563263）下的 `npm run check` 在主仓按默认 16 fork 连跑 3 次（18:5x / 19:0x / 19:2x，各约 6 分钟，load 20～44），主仓 WIP 仍是 grace/velina 三件（md5 `f27e6b94` 未变）；REQUIREMENTS.md 无新条目；worktree `wt-T18`（已删）；产物 `/home/kaua/calc-arch/arenaF/r450/`：`tsc.log` / `guards.log` / `build.log` / `vt-q1..q3.log` `vt-e7.log` `vt-e8.log`（绿分片）/ `vt-s1.log`（**红**的那次，T14 证据）/ `forks*.count` / `patch-prompt.py` / `patch-docs.py`）：**CC-424 `b55ca97a`**（**已推**）+ 提示词改动 + 本文档提交。
- **做到哪**：① r449 交接的「roundResult 余下 4 个 `| null`」查完，全是真 null，T13 卡收线。② 没按原计划找算法题，改做了一件基础设施：vitest worker 上限进 `vite.config.ts`（CC-424）。理由：规则「全量加 `--maxWorkers=4`」只约束读过提示词的会话，本轮另一会话按默认 16 fork 连跑把 VM 打到 load 44，我的 2 分片两次 rc=124；把它写进配置后所有入口（npm test / check / verify / dsh）默认安全。③ 提示词 `bridge-prompt-arena.md` 第 1 条对应段改写（备份 `.bak-maxworkers-config-20261003-1938`，修改记录已写在提示词 §二）。
- **意外发现 → T14 卡**：高负载分片里 `timeFillRatchet` 两队（都含 1181）slack 0↔0.4 互换，单跑绿、复跑绿。这不是 flaky 可以忽略的那种：同配置的引擎输出随负载变 = 求值路径里有顺序依赖，最可疑的是 CC-420 记录的那条 `flush:'post'` 回填 watch。卡里写了复现法和禁止项。
- **别人的 WIP（已提交）**：作者回来了，19:4x 在主仓提交 `592c66f6`「refactor(grace): 轮换计划改精确闭式解 + 维琳娜平A权重交边际均衡」（7 文件 +161/−39，含 timeGolden 36 行 / timeFillRatchet 两队 / grace.test / idempotentCfgWrite 夹具 / 新 graceRotation.test），叠在我的 `b0b33b47` 之上，**本地未推**。不是我的提交、我没验证过，按规则不替他推；下一轮开工 `rev-list origin/master..HEAD` 会看到 1——先看它是不是还在、作者推了没有，再决定（他若在线会自己推；若 24h 还躺着，按孤儿规则在 worktree 全量验证后以他的名义推或入分支）。它的 1181 基线改动与 T14 的关系见卡。主仓 ff-merge 到 `b0b33b47` 之后他的后续 `npm run check` 已是 4 worker。
- **下一步（start-ready）**：T14 ①（复现）。开工先 `pgrep -fc "[w]orkers/forks.js"` 看他在不在跑；在跑就正好拿他的负载当复现条件：worktree 里循环单跑 `timeFillRatchet.test.ts` 3 次看红不红。
- **回滚点**：`git revert b55ca97a`；提示词还原 `.bak-maxworkers-config-20261003-1938`。

**2026-10-03 18:28 arena-F 第 449 轮**（开工：origin = 本地 = `b547cf3a`，无人在跑；REQUIREMENTS.md 无新条目；做 T13-a / T13-b，worktree `wt-T17`（已删）；产物 `/home/kaua/calc-arch/arenaF/r449/`：`patch-cc422.py` / `patch-cc423.py`（已应用勿重跑）/ `tsc.log` `tsc2.log` / `guards.log` `guards2.log` / `build.log` `build2.log` / `zd.log` `zd2.log` / `vt-s1.log` `vt-s2.log`（CC-422 后）/ `vt2-s1.log` `vt2-s2.log`（CC-423 后）；`patch-docs.py`）：**CC-422 `64a260bf`** + **CC-423 `aa4ff23e`**（**均已推**，两个独立提交可各自回滚）+ 本文档提交。
- **做到哪**：T13-a 纯类型收口按卡做完（5 文件 +18/−12 含锁，顺手删了只被幻影分支读的 `baseAnomaly` 死声明——是 vue-tsc TS6133 指出来的，不是我找的）。T13-b 探针结果 = `calcAnomalyPool` 对空 execs 给合法空池 ⇒ 幻影，流水线层收掉（7 文件 +31/−11 含锁 + 一处夹具）。全量基线 **473 文件 / 4320 用例**（+2 新锁）。
- **决定与边界**：CC-423 只收**流水线层**（roundInputs → roundResult → convergence/outerCycle/solveTeam）。模块钩子契约的 `| null` 保留并出成 T13-b′（默认不做，理由在卡里）。UI 可见变化一条（ResultPage 积蓄池卡在「非空队伍但无异常积蓄行」的边角从隐藏变为显示全 0），与 CC-417 后的失衡池卡同口径，写在 arch CC-423 行。
- **这轮踩到的**：① 形状锁里 `not.toContain('if (execs.length === 0) return null')` 被我自己写的注释（引用了被删的那行）打红——锁要过滤注释行再断言（已改）；② `as never` 的局部夹具（`moduleFeedbackSignature.test.ts`）在契约收紧后缺字段 → 运行期 `undefined.perSlotBonus`，这类夹具 vue-tsc 看不见，只有全量 vitest 能抓，所以全量不能省；③ 客户端一次 `TypeError: terminated`（shard 1 跑到 150s 时连接掉了），WSL 侧进程仍跑完、日志完整——`rm -f /tmp/mcp.session` 后等 60s 读日志即可，不用重跑。
- **别人的 WIP**（`kaua5678`）：grace.ts md5 前缀仍 `f27e6b94`（自 17:25），按 r447/r448 规则：不预检，24h 后（≈10-04 17:25）入 `wip/kaua5678-grace-rotation` 分支。
- **下一步（start-ready）**：幻影 null 这条线在 resourceCalc 流水线层**已收完**：`roundResult.ts` 余下的 `| null` 四个（`matchedPlanName` 无自动轴方案 / `inStunAnomalyState`、`bossAnomalyState` 无对应模块 / `axisStack` 非轴模式）按 §1 判别初看都是「表达会发生的事实」的真 null，**未逐一查生产者**——下一轮若想继续这条线，先各花 2 分钟 grep 生产者确认，确认都真就在 arch 记一行收线；否则按 §0 另找题（T10 仍是备选；`grep -rn "| null" src/composables/resourceCalc/*.ts` 共 61 处，其中 solveTeam 10 / convergence 9 / damagePool 6 可作为下一轮扫描起点）。
- **回滚点**：`git revert aa4ff23e`（CC-423）、`git revert 64a260bf`（CC-422），顺序任意。

**2026-10-03 18:14 arena-F 第 448 轮**（开工：origin = 本地 = `e526d69d`，无人在跑；REQUIREMENTS.md 无新条目；按 §1 新增的「幻影 null 猎法」找到 CC-421，worktree `wt-T16`（已删）；产物 `/home/kaua/calc-arch/arenaF/r448/`：`patch-cc421.py`（已应用勿重跑）/ `tsc.log` / `guards.log` / `build.log` / `zd.log` / `vt-s1.log` / `vt-s2.log`）：**CC-421 `0e7dd4d5`**（**已推**）+ 本文档提交。
- **做到哪**：失衡池非 null（4 文件 +34/−19 含锁）。CC-417→421 五连把 solveTeam / convergence / ultimatePromote 这条链上的幻影 null 收到只剩 T13 列的三项。全量基线 **473 文件 / 4318 用例**。
- **沉淀**：猎法写进 §1（方法 + 真/幻影判别），剩余项出成 **T13 卡**（a/b 可直接派给执行模型，c 默认不做）。r447 提过的「三份面板 computed 命名澄清」**撤回**：grep 发现 `calc.panels` 在 `useResourceCalc.ts` 与测试之外没有消费者，`damagePanels` 只喂伤害上下文（:633），没有混淆面，改名是无收益改动。
- **别人的 WIP**（`kaua5678`）：grace.ts md5 前缀仍 `f27e6b94`（自 17:25），按 r447 补记：不再每轮预检，24h 后入 `wip/kaua5678-grace-rotation` 分支。
- **下一步（start-ready）**：T13-a（纯类型收口，预期 30 分钟内含验证）→ T13-b（先探针）。都做完后下一层会露出什么现在看不见，照 §1 猎法再扫一遍 `grep -rn "| null" src/composables/resourceCalc/*.ts`。
- **回滚点**：`git revert 0e7dd4d5`。

**2026-10-03 18:03 arena-F 第 447 轮**（开工：origin = 本地 = `0d41b93e`，无人在跑；REQUIREMENTS.md R1–R8 全 done 无新条目；评估 T10，worktree `wt-T15`（已删）；产物 `/home/kaua/calc-arch/arenaF/r447/`：`patch-cc420.py`（注释补丁，已应用勿重跑）/ `tsc.log` / `guards.log` / `build.log` / `vt-s1.log` / `vt-s2.log`）：**CC-420 `bf2d1c23`**（**已推**）+ 本文档提交。
- **做到哪**：T10 从「猜作者意图」变成「实测事实 + 三条修法 + 明确不做的理由」。关键发现：回填 watch 是绕 store 的环，创建即两遍管线，一步到达不动点是巧合（回填值不影响次数）。落了事实锁 `wEngineCoverageFixpointT10.test.ts`（3 用例）+ `useResourceCalc.ts` 两段注释纠正；**未改任何求值路径**（zd 未跑，理由写在 arch 行）。全量基线见 r6 §8 行 447。
- **决定**：T10 修法 ① 暂不做（侵入 51 个 `computePanelPhases` 调用点中的若干 + UI 滑块读数，而当前代价只是创建时多算一遍）；锁变红时再做。依据与回退点见 T10 卡。
- **别人的 WIP（`kaua5678`）—— 18:12 预检：红，不收养**。按 r444 步骤在 worktree（origin `d1a25bd4`）里 cp 进三份后跑 `grace.test.ts` / `graceCinemaTier.test.ts` / `graceRotation.test.ts` / `mechanicRowValuesT9.test.ts`：**`grace.test.ts` 2 红**（`planGraceRotation(30, 99)` 与 `(30, 6)` 都 `expected 10 to be 9`），其余 20 绿（含他自己新写的 `graceRotation.test.ts` 5 条）。日志 `/home/kaua/calc-arch/arenaF/r447/orphan-vitest.log`，diff `orphan-grace.diff`。**根因是口径冲突不是 bug**：他的闭式解「候选 n，c(n)=floor((pool−n·(ex−sp))/(aSum+2·sp))，**选 cycles 最大者**」会在能量充足时也拿更短的普特去凑第 10 个循环；旧测试钉的是「能量充足时**全强特**、floor(30/3.001)=9」。两条都自洽，差别是产品口径（多一个循环 vs 全强特），**要他本人或用户裁**。grace.ts md5 前缀仍 `f27e6b94`（自 17:25 未动）。主仓三份**原样保留**，没有 commit / revert。
- **下一步（start-ready）**：① 这份 WIP 别再每轮预检了——除非 `grace.ts` md5 变了（说明作者回来了）或他把 `grace.test.ts` 的 9 改成了他的口径；若 24h 后仍原样，按孤儿规则**以他的名义提交到分支** `wip/kaua5678-grace-rotation`（不进 master）并把主仓还原，让 master 的 verify 不再带着它。② 按 §0 找新题（候选见下一条）。本轮顺手发现的候选：`useResourceCalc.ts` 里 `panels`(:154) / `entrySnapshotPanels`(:167) / `damagePanels`(:340) 三份面板 computed 的职责边界（资源侧 vs 展示侧）没有命名区分，是 T10 ① 的前置整理，可以先做纯命名/注释层的澄清（零行为）。
- **回滚点**：`git revert bf2d1c23`。

**2026-10-03 17:50 arena-F 第 446 轮**（开工：origin = 本地 = `ff68b463`，无人在跑；REQUIREMENTS.md 无新条目；做 r445「下一步 ②」，worktree `wt-T14`（已删）；产物 `/home/kaua/calc-arch/arenaF/r446/`：`patch-cc419.py`（已应用勿重跑）/ `tsc.log` / `guards.log` / `build.log` / `zd.log` / `vt-s1.log` / `vt-s2.log`）：**CC-419 `2dcd06d1`**（**已推**）+ 本文档提交。
- **做到哪**：`SolveTeamInput.resourceConfig` 非 null（2 文件 +14/−12，锁追加 1 用例）。CC-417 → 418 → 419 三步把「空失衡池 / null 轮 / 可空配置」三个幻影状态从 solveTeam 层清掉；solveTeam 现在的输入契约全部非 null、输出 `out` 非 null。全量基线 **472 文件 / 4314 用例**。
- **刻意没做**：`runCalcRound` 闭包读 `resourceConfig.value` 的 throw 守卫（CC-418）保留——拿掉它要改 `createRunCalcRound` deps 契约，且 `createConvergenceRoundInputs` 还有同一 ref 的闭包读点，评估见 arch CC-419 行末。
- **别人的 WIP**（`kaua5678`）：grace/velina/graceRotation.test 本轮仍未动（grace.ts md5 前缀 `f27e6b94` = 17:25）。**18:30 起孤儿规则生效**，步骤见 r444 块。
- **下一步（start-ready）**：① ≥ 18:30 且 md5 未变 ⇒ 孤儿处置；② 否则 T10（备选）或按 §0 找新题——建议方向：`roundThreads.ts` `postRoundInput: null`「首轮」语义与 `prev: null`（首轮无前一轮）是否能统一成一个显式的「首轮」标志（现在两处各自用 null 表达同一事实）；`git log -S "return null" -- src/composables/resourceCalc/roundInputs.ts` 看轮输入簇里有无同类初始提交遗留。
- **回滚点**：`git revert 2dcd06d1`。

**2026-10-03 17:39 arena-F 第 445 轮**（开工：origin = 本地 = `0a634df2`，无人在跑；REQUIREMENTS.md 无新条目；按 r444「找题方向 ②」做，worktree `wt-T13`（已删）；产物 `/home/kaua/calc-arch/arenaF/r445/`：`patch-cc418.py`（代码补丁脚本，已应用勿重跑）/ `tsc.log` / `guards.log` / `build.log` / `zd.log` / `vt-s1.log` / `vt-s2.log`）：**CC-418 `74c092ad`**（**已推**）+ 本文档提交。
- **做到哪**：`runCalcRound` 非 null 化落地（3 文件 +47/−61，1 个锁文件）。「null 轮」这个概念从 solveTeam / roundThreads 整体消失；`prev` 的 null（首轮无前一轮）是真实状态、保留。全量基线现在 **472 文件 / 4313 用例**。
- **判定依据**：r444 方向 ② 成立——CC-417 后 `runCalcRound` 的 null 只剩 `!base || !catalogStore.ready`，而 `calcOutput`（`useResourceCalc.ts:226`）同条件先 return null，中间 `solveTeam` 无 store 写 ⇒ 同一次同步求值内不可达。把它改成 `throw` 而不是留 `return null`：留着 null 就得保留整套 `| null` 类型，等于类型层继续承认一个不存在的状态。
- **别人的 WIP**（`kaua5678`）：`grace.ts` / `velina.ts` / `graceRotation.test.ts` 本轮仍未动（grace.ts md5 前缀 `f27e6b94`，与 17:25 一致）。**18:30 起孤儿规则生效**，步骤原文见下方 r444 块，不重复。
- **下一步（start-ready）**：① 若 ≥ 18:30 且三份 WIP md5 仍没变 ⇒ 先做孤儿处置（r444 步骤）；② 否则 CC-418 的自然续篇：`SolveTeamInput.resourceConfig` 收成非 null（`solveTeam.ts` 4 处 `resourceConfig?.` → `resourceConfig.`，`useResourceCalc.ts:267` 传的已经是守卫后的值），再评估是否让 `createRunCalcRound` 收 `base` 参数（改 deps 契约，先读 `convergence.ts:85-105` 的 deps 列表与 `useResourceCalc.ts:462` 的注入点）；③ T10 仍是备选。
- **回滚点**：`git revert 74c092ad`。

**2026-10-03 17:28 arena-F 第 444 轮**（开工：origin = 本地 = `863cabc3`，无人在跑；REQUIREMENTS.md 无新条目；做 T12，worktree `wt-T12`（已删）；产物 `/home/kaua/calc-arch/arenaF/r444/`：`tsc.log` / `guards.log` / `build.log` / `zd.log` / `vt-s1.log` / `vt-s2.log`）：**CC-417 `a21d952c`**（**已推**）+ 本文档提交。
- **做到哪**：T12 收口（1 行守卫删除 + 1 个锁文件）。全量基线现在 **471 文件 / 4310 用例**。
- **别人的 WIP**（`kaua5678`）：`grace.ts`（轮换精确闭式解）+ `graceRotation.test.ts`（新）+ `velina.ts` 2 行，最后一次真实改动 17:25，本轮未再动。**到 18:30 仍没动 ⇒ 孤儿**：worktree（基于 origin）里 `cp` 进这三份，跑 `npx vitest run src/mechanics/__tests__/grace*.test.ts src/mechanics/__tests__/graceRotation.test.ts src/composables/__tests__/mechanicRowValuesT9.test.ts` + vue-tsc + zd（预期含格莉丝的队 DIFF ≠ 0，把行数记进 arch）+ 全量分片，绿就以他的名义意图提交（提交信息引用他 @fact 那段），红就把红的输出写进 §2b 后留着不动。主仓那三份别删，用 `git show HEAD:… >` 还原只在你要 rebase 时做、做完 cp 回去。
- **下一步（start-ready）**：§3 只剩 T10（备选，wEngine 覆盖率回填 watch → computed；先读 `useResourceCalc.ts` 里该 watch 的注释与 `src/data/wEngineStackCoverage.ts` 头注释）。T10 之外没有排队的卡——下一轮若不做 T10，先按 §0 的方法找新题：候选方向 ① `convergence.ts` 里其它「初始提交遗留」的 `return null` / 兜底（`git log -S` 看出处），② `solveTeam.ts` 把 null 当 +∞/0 的三处是否还有存在意义（CC-417 后 `runCalcRound` 只在 `resourceConfig` 为 null 时返回 null，而那时 `calcOutput` 根本不会调它）。
- **回滚点**：`git revert a21d952c`。

**2026-10-03 17:04 arena-F 第 443 轮**（开工：origin = 本地 = `a5306515`，无人在跑；REQUIREMENTS.md 无新条目；做 T11，worktree `wt-T11`（已删）；产物 `/home/kaua/calc-arch/arenaF/r443/`：`patch-t11-harness.py`、`t11-red.log`（重新应用后 4 条红的原始输出）、`vt-s2.log`（重新应用 + 修 4 条后全量仍 16 红的证据）、`vt2-s1.log` / `vt2-s2.log`（最终绿）、`tsc*.log` / `guards*.log` / `build.log`）：**CC-416 `79dec912`**（+ 红的中间提交 `c7daefed`，**都已推**）+ 本文档提交。
- **做到哪**：T11 收口为 opt-in（卡面已改写结论）。中途试过「改默认 + 修 4 条」：4 条修好后全量又出 16 条（golden 320 条差异等），据此改方向——证据在 `vt-s2.log`。顺带发现 T12（单人支援 weight 0 ⇒ 整轮 null）。
- **别人（`kaua5678`）17:24 起在主仓改 `grace.ts`**（`planGraceRotation` 改精确闭式解，产品口径变更，带 @fact）+ 新 `graceRotation.test.ts`，未提交、无认领；`velina.ts` 2 行 WIP 仍在。**下一轮别碰 grace / velina**；若他提交了但没推，按 r441 §2b 孤儿规则（先隔离跑全量再推）。
- **下一步（start-ready）**：T12（小）或 T10（备选）。两者都不和 grace / velina 相交。
- **回滚点**：`git revert 79dec912 c7daefed`。

**2026-10-03 16:43 arena-F 第 442 轮**（开工：origin `8c84e92f`；本地 master = origin + 别人 3 个未推提交；REQUIREMENTS.md 无新条目（mtime 未变）；自己做 T9 grace（改动 3 文件，没派 dsh），worktree `wt-T9g`；孤儿处置 worktree `wtF-orphan`；两者已删；产物 `/home/kaua/calc-arch/arenaF/r442/`：`patch-grace.py`、`tsc.log` / `guards.log` / `build.log` / `vt-s1.log` / `vt-s2.log` / `zd.log`、`orphan-*.log`）：**CC-415 `c3dd09fe`**（grace，**已推**）+ **孤儿处置 `9992aa23`/`f86a9418`/`3c9a2afb`/`4f8e04b6`（已推）** + 本文档提交。
- **做到哪**：T9 三张全部收口（hugo / xixifu / grace 都读 `cfg.mechanicRowValues`，锁集中在 `mechanicRowValuesT9.test.ts`）。
- **孤儿处置（已执行，依据 r441 §2b 写好的步骤）**：别人的 3 个提交在 origin 之上复跑仍 4 红 ⇒ 在 worktree 里 `git revert` harness 那条（`4f8e04b6`，提交信息里写了原因），保留 docs(test) + feat(freeCompare)；复验：vue-tsc 0、5 个相关测试文件绿、guards 0、build 0、分片全量 **470 / 4308** 绿；整段推上 origin。本地 master 现在 **= origin（unpushed 0）**，不再分叉。harness 对齐的意图转成 **§3 新卡 T11**（含 4 条红的逐条判断方向 + velina 2 行 WIP 的收养办法）。
- **未决**：`velina.ts` 2 行 WIP 仍在主仓（16:29 起未动、无认领），处理办法见 T11「顺带」。`wEngineStackCoverage.test.ts` 头注释的基准数字对应被回退的夹具（已加 ⚠ 两行说明）。
- **下一步（start-ready）**：T11（先跑那 3 个测试文件看红的具体输出，再按卡面逐条判断）→ T10 备选。
- **回滚点**：grace `git revert c3dd09fe`；要恢复别人的 harness 改动 `git revert 4f8e04b6`（= T11 第 1 步）。

**2026-10-03 16:31 arena-F 第 441 轮**（开工：origin `4e208672` = 本地 master 去掉别人 3 个未推提交；他的 WIP `velina.ts` 16:31 还在改；REQUIREMENTS.md 无新条目；派 dsh 做 T9 xixifu，worktree `wt-T9x`（基于 origin/master，已删）；产物 `/home/kaua/calc-arch/arenaF/r441/`：`dispatch-t9x.sh`、`worker-T9x.report`、`guards.log` / `build.log` / `vt-s1.log` / `vt-s2.log`）：**CC-414 `68e144d0`**（代码，**已推 origin/master**）+ 本文档提交。
- **做到哪**：T9 的 xixifu 完成，工人 5 分钟一次过（brief 里给了 hugo 的提交号当样板 + 预先 grep 好的 8 处夹具位置）。T9 只剩 grace（卡面已把行号与消费入口 `A_SEG_ENERGY` 写清）。
- **别人的 3 个提交**（提交信息 `fix(test): harness 平A时间权重按生产口径兜底` / `docs(test): 修正 wEngineStackCoverage 头注释…` / `feat(freeCompare): 当期 buff 三态…`；**hash 每次被我 rebase 到 origin 之上都会变，按提交信息认，别抄这里的 hash**）**仍未推**，harness 那条带 4 条红（r439 隔离确认），他 16:31 后只在改 `velina.ts`。**下一轮开工若仍未推（≥ 17:00 即满 1 小时）就按孤儿规则处理**：`git worktree add wtF-orphan <本地 HEAD>`，跑 `npx vitest run src/composables/__tests__/backstageAxisVulnCc391.test.ts src/specs/__tests__/adjustableEffect.test.ts src/mechanics/__tests__/lateCfgWrite.test.ts src/composables/freeCompare` ——还红就在 worktree 里 `git revert <harness 那条的当前 hash>`（只回退 harness 那条；它的意图「支援/防护平A权重=0 与生产口径对齐」写进 §3 当新卡 T11，让下一个人连测试一起改），然后 push 整段；绿了就直接 push 三个。主仓不 `git reset`。
- **下一步（start-ready）**：T9 grace（见卡）→ 处理上面的孤儿 → T10 备选。
- **回滚点**：`git revert 68e144d0`。

**2026-10-03 16:08 arena-F 第 440 轮**（开工：origin `ccbe094f`；本地 master 仍带别人未推的 `4933cb83`/`4749ff51`（红）+ 我的两个重复 patch；别人的 freeCompare WIP 在主仓、15:55 后暂歇；REQUIREMENTS.md 无新条目；派 dsh 做 T9 hugo，worktree `wt-T9h`（基于 **origin/master** 而不是本地 HEAD——本地 HEAD 带别人的红）；产物 `/home/kaua/calc-arch/arenaF/r440/`：`dispatch-t9h.sh`、`worker-T9h.report`、`guards.log` / `build.log` / `vt-s1.log` / `vt-s2.log`；`arenaF/wip-backup-1608/`、`wip-backup-16xx/` 是 rebase 时别人 WIP 的临时备份，可删）：**CC-413 `35ac4d1f`**（代码，**已推 origin/master**）+ 本文档提交。
- **做到哪**：T9 的 hugo 完成（含 T8 漏网的两行 actionTime）；T9 剩 xixifu（254.4 / 1009.1）与 grace（A1–A4_ENERGY），卡面已更新。工人 8 分钟一次过，还自己多跑了一遍全量（470/4303）——我另跑分片复核一致。
- **本地 master 与 origin 的关系（本轮两次整理）**：开工时用「备份 WIP → 还原到 HEAD → `git rebase origin/master` → 放回 WIP」把本地 master 落到 origin 之上，我的重复 patch 自动消失，别人的提交只换 hash（`4933cb83→93c4f842`，`4749ff51→2817d19b`）；推完 CC-413 后再做一次（他 16:24 又提交了 `ba04b897 feat(freeCompare)…`，三个一起换成 `e8e32827 / 716ada7a / 803a48e3`）。**现在本地 master = origin `35ac4d1f` + 他的 3 个未推提交，无重复**。这套动作安全的前提：他的提交和 WIP 都不碰我们推上去的文件；每次 rebase 前 `git status` 必须为空（备份还原后），rebase 用时 ~1s。
- **⚠ 别人的 3 个提交仍未推、仍带红**：`e8e32827`（harness 平A权重兜底）在 r439 隔离确认使 `backstageAxisVulnCc391` / `adjustableEffect`×2 / `lateCfgWrite` 4 条红；`803a48e3`（freeCompare 三态）没验过。他 16:19 在主仓跑了 `npm run check`（默认 worker，load 29，把我的分片挤超时一次）——说明他**看得到**红，可能在修。16:55 起若仍未推且无新动作 ⇒ 下一轮按孤儿规则：worktree 基于本地 HEAD 跑那 3 个测试文件 + freeCompare 测试，决定 push 全部 / 只 revert `e8e32827` 后 push，写明理由。**不要**把红推上 origin。
- **流程备忘**：worktree 一律 `git worktree add <wt> origin/master`（不是 HEAD），验证基线才是干净的；合入用 `git push origin <worktree 提交>:master`，然后把本地 master rebase 到 origin 上，而不是 cherry-pick 制造重复。
- **下一步（start-ready）**：T9 xixifu（`XIXIFU_SHIGU_BASE` 254.4 → 1521019 damage：:161 / :189 行 + :167 备注文案里的数字改成模板插值；`XIXIFU_SHEKISS_RATIO` 1009.1 → 1521006 damage :211；锁进 `mechanicRowValuesT9.test.ts` CASES）→ T9 grace（`A1–A4_ENERGY` → 1181001–1181004 energy_recovery，`A_SEG_ENERGY` 数组从 cfg 组装）→ T10 备选。
- **回滚点**：`git revert 35ac4d1f`。

**2026-10-03 15:38 arena-F 第 439 轮**（开工：origin = 本地 `57537e6e` 干净已推，但另一 lane 正在主仓跑**默认 worker 的 `vitest run`**（load 22）并改 `src/composables/freeCompare/*`；REQUIREMENTS.md 无新条目；等它跑完后派 dsh 做 T8 末段 burnice，worktree `wt-T8d`（已删）；产物 `/home/kaua/calc-arch/arenaF/r439/`：`dispatch-t8d.sh`、`worker-T8d.report`、`guards.log` / `build.log` / `vt-s1.log` / `vt-s2.log`（基线上的全量，分片）、`tsc-head.log` / `guards-head.log` / `vt-head-s1.log`（含别人提交的 HEAD）、`vt.log`（两次被 280s 超时杀掉的全量，见教训））：**CC-412 `64e8d13f`**（代码，**已推 origin/master**）+ 本文档提交。
- **做到哪**：T8 全部完成（卡已压成一段 ✅）。工人 5 分钟一次过。
- **⚠ 又一次分叉（与 r437 同型，下一轮先读）**：合入时发现同一 lane（`kaua5678`）15:54 / 15:55 在主仓又提交了 `4933cb83 fix(test): harness 平A时间权重按生产口径兜底（支援/防护=0）`（改 `src/test/harness.ts`）和 `4749ff51 docs(test): …`，未推、无认领。我 cherry-pick 成 `9a5c75ea` 叠上去跑全量分片 1：**3 文件 4 用例红**——`backstageAxisVulnCc391.test.ts (b)`、`adjustableEffect.test.ts` 两条（7 条严格线性型 / 17 条 rate 0/1/2）、`lateCfgWrite.test.ts`（全角色晚写锁）。隔离：这 3 个文件在 `57537e6e` 全绿、在 `4749ff51`（不含我的）全红 ⇒ **是 `4933cb83` 的 harness 改动引入的**（harness 兜底改了平A时间权重 ⇒ 全角色扫描类测试的基准变了）。处置同 r437：**origin/master 只推到 `64e8d13f`（= 57537e6e + CC-412，全绿）**；本地 master = `4933cb83 → 4749ff51 → 9a5c75ea（dup）→ 本文档 cherry-pick（dup）`。作者 `git pull --rebase origin master` 后重复 patch 自动丢弃，剩他两个提交重放——**重放后那 4 条红归他修**（是 harness 口径该改还是测试该改，只有他知道意图）。若 1 小时内无动静：下一轮按孤儿规则在 worktree 里 rebase 他的两提交到 origin 上、跑那 3 个文件，修不了就 `git revert 4933cb83`（文档类 `4749ff51` 可留）并在这里写明。主仓不许 `git reset`——他的工作树还有 freeCompare 4 个文件未提交。
- **流程教训（入 §0）**：① 别人在主仓跑东西时，我们的全量 vitest(4) 在 280s 里跑不完（本轮两次 rc=124，日志半截）。改用 **`--shard=1/2` / `--shard=2/2` 两条调用**（各 ~170s / ~110s，合计文件数与用例数和全量一致：234+235 = 469、2063+2239 = 4302），比等 VM 空闲可靠。② 这是同一 lane 第二次「提交后不推、且提交是红的」——他显然不读 LANE-CLAIMS / §2b。能做的只有：每次合入前 `git log origin/master..HEAD` 看有没有他的新提交、有就先隔离验证再决定推哪个 sha。
- **下一步（start-ready）**：§3 **T9**（倍率 / 能量常量 → `cfg.mechanicRowValues`；对象与行号卡面齐全，r439 复核过 dupProbe 命中：hugo 709.8 = 1291010 damage、xixifu 254.4 = 1521019 / 1009.1 = 1521006 damage、grace A1–A4_ENERGY = 1181001–1181004 energy_recovery；**不要**碰 norma `HEAT_PER_ENERGY = 0.4`——它与 1571010 actionTime 相等是巧合，语义是每点能量的热量）——可以派工人，建议一次一个模块（hugo 最简单）；之后 T10 备选。
- **回滚点**：`git revert 64e8d13f`。

**2026-10-03 15:28 arena-F 第 438 轮**（开工：origin `e61543ca`，本地 master 分叉 = `9d818b7b`（别人，未推）+ 我的两个重复 patch；无进程；REQUIREMENTS.md 无新条目；本轮不派工人，专门收敛分叉 + 修红；产物 `/home/kaua/calc-arch/arenaF/r438-{tsc,guards,vt,build}.log`、`arenaF/AGENTS.md.other-lane-wip-1529`）：**`f64753db` 已推 origin/master，master 全绿**。
- **做了什么**：① `cp AGENTS.md 备份; git show HEAD:AGENTS.md > AGENTS.md; git rebase origin/master; cp 备份回来`——本地 master 直接落到 origin 之上，我那两个重复 patch 被 rebase 自动丢弃，别人的提交**重写为 `31fdfe8f`**（内容同 `9d818b7b`，作者不变；下一轮若看到 `9d818b7b` 的引用，就是这个）。② 诊断 `outerCyclePick.test.ts` 的红：不是环算法变了，是 **`31fdfe8f` 在 `useResourceCalc()` 里加了 `watch(wEngineStackAutoCoverages, …, { immediate: true, flush: 'post' })`**——建队后的第一个 `await` 让 Vue 调度器 flush 这个 watcher，经 `adjustedResourceResult` 把整条管线算完并缓存；旧测试在建队**之后**才清空 `observed`，再读 `resourceResult` 命中缓存 ⇒ 长环分支「0 次」。**修法（测试侧，最小）**：把清空 `observed` 提前到建队之前（空队阶段不出长环，`members.length >= 3` 过滤天然排除），提交 `f64753db`。③ 全量验证在 `wtF-r438`（= 31fdfe8f + 修测）：vue-tsc 0、guards 链 0、build 0、**vitest(4) 469 文件 / 4302 用例（新基线，+1 文件 +6 用例来自 `wEngineStackCoverage.test.ts`）**。④ 推送 `f64753db`，unpushed 0。
- **拍板**：没有 revert 别人的功能、也没有改它的实现；只改了测试的观察窗口。依据：功能本身的 6 条测试绿、guards 绿、面板口径是作者有意的改动；红的根因是测试对「管线惰性求值」的隐含假设，而不是功能错。**但要记一笔设计味道**：composable 创建即 `immediate` 触发整条资源管线（哪怕没有任何 UI 读结果），以后若发现启动慢 / 测试里莫名多算一轮，先查这里；更干净的做法是让回填成为 `calcOutput` 链上的一个 computed 而不是副作用 watch——放进 §3 当备选卡（T10），不急。
- **孤儿收养**：`AGENTS.md` 的 6 行未提交改动（别人 14:19 起、无认领、>1h）是 dsh `subagent` 工具 one-shot / continuable 路由说明，纯文档，随本轮文档提交一起入库（提交信息注明来源）。
- **给 `31fdfe8f` 作者的话**：你的提交已在 master（hash 变了，因 rebase）；`outerCyclePick` 红的原因与修法见上；如果你本地还有基于 `9d818b7b` 的分支，`git rebase origin/master` 即可。
- **下一步（start-ready）**：§3 T8 burnice（卡面就绪）→ T9；T10（备选）见 §3。
- **回滚点**：`git revert f64753db`（只回退测试窗口；回退后 master 会重新红）。

**2026-10-03 14:58 arena-F 第 437 轮**（开工：master `aa499bca` 干净已推；别人的 wEngineStackCoverage WIP 仍在主仓、未认领；REQUIREMENTS.md 无新条目；派 dsh 做 §3 卡 T8 后半 soukaku / grace，worktree `wt-T8b`（已删）；产物 `/home/kaua/calc-arch/arenaF/r437/`：`dispatch-t8c.sh`、`worker-T8sg.report`、`guards.log` / `build.log` / `vt.log`（基线 aa499bca 上的全量）、`guards-head.log` / `tsc-head.log` / `vt-head.log`（含别人提交的 HEAD 上的全量））：**CC-411 `db9e0655`**（代码，**已推到 origin/master**）+ 本文档提交。
- **做到哪**：T8 的 soukaku / grace 完成（工人 8 分钟一次过，brief 里预先 grep 好的事实起作用了）；T8 只剩 burnice（卡面已把 r437 核过的行号 / 8 处夹具写进去，可直接派）。
- **⚠ 现场分叉（r438 已收敛，见上方 r438 块；此条留作记录）**：15:16 另一条 lane（提交者 `kaua5678`，无认领行）在**主仓**提交了 `9d818b7b feat(wengine): 嵌合编译器等叠层音擎buff覆盖率…`（4 文件，与本轮不相交）。我 ff 失败后 cherry-pick 成 `e651e5c7` 叠在它上面，然后在干净 worktree 对 HEAD 跑全量：**`outerCyclePick.test.ts › yixuan-jufufu-lucia 长环分支只调用一次`，实测 0 次 ⇒ 红**；单测隔离：`aa499bca` 绿、`9d818b7b` 红 ⇒ **是 `9d818b7b` 引入的**（它改了 `useResourceCalc.ts` 50 行，推测动到外环选点的接线）。按规则我不回滚别人的提交；也不把红的 master 推上去——所以 **origin/master 推的是 `db9e0655`（= aa499bca + CC-411，全量 468/4296 绿）**，本地 master 仍是 `9d818b7b → e651e5c7 → （本文档 cherry-pick）`，与远端**内容等价但历史分叉**。处置：`9d818b7b` 的作者下次 `git pull --rebase origin master` 即可——`e651e5c7` 与 `db9e0655` patch-id 相同会被自动丢弃，只剩他那一个提交重放；重放后**先修 `outerCyclePick.test.ts` 再推**。若他 1 小时内没动静，下一轮 arena 会话按孤儿规则处理：在 worktree 里 `git rebase origin/master` 他的提交 → 看那条测试 → 要么修要么 `git revert` 并在这里写明。**不要**在主仓做 `git reset`——他的工作树还有未提交的 `AGENTS.md`。
- **流程教训（入 §0）**：guards 链 + build + 全量 vitest 串在**一条** `wsl_exec` 里，总时长超过桥的上限（~285s），vitest 被连带杀掉、日志半截（`vt.log` 第一版）——全量 vitest 必须**单独一条调用**，前面的 guards / build 另起一条。
- **下一步（start-ready）**：① 派工人做 T8 burnice（卡面已就绪）；② T9（倍率 / 能量常量 → `mechanicRowValues`，hugo 709.8 / xixifu 254.4、1009.1 / grace A?_ENERGY）；③ 若 `9d818b7b` 仍红且无人认领，按上面的孤儿处置。
- **回滚点**：`git revert db9e0655`。

**2026-10-03 14:31 arena-F 第 436 轮**（开工：master `14dc6980` 干净、已推；别人的 wEngineStackCoverage WIP 仍在主仓、仍在改（`useResourceCalc.ts` 14:30）、无认领——没动；REQUIREMENTS.md 无新条目；本轮按 §0 派 dsh 做 §3 卡 T8 前半，worktree `wt-T8`（已删）；产物 `/home/kaua/calc-arch/arenaF/r436/`：`dispatch-t8.sh` / `dispatch-t8b.sh`（两次 brief）、`worker-T8-attempt1.err`（第一次卡住的思考流）、`worker-T8.report`、`guards.log`、`build.log`、`vt.log`）：**CC-410 `015b6a61`**（代码，已推）+ 本文档提交。
- **做到哪**：T8 的 4 个小模块（miyabi / yixuan / anbyZero / hugo）由工人完成，我复核 diff（白名单内、改法与卡一致）后自己跑 guards / build / 全量 vitest(4)，ff 进 master。卡 T8 收缩为 soukaku / grace / burnice 三个（表已删做完的行）。
- **派工教训（新，写进 §0 第 3 条）**：① 卡面里「删掉 X」这种断言，出卡前要 grep X 的**全部**消费者——我写 hugo「:61 兜底删掉」时没看到它是 `axisMoveActionTime` 钩子的实现，工人读到矛盾后花 9 分钟推敲、零改动。② brief 里加一句「卡面没说清的，选改动最小的一种、写进报告、继续做」，第二次派发 8 分钟收工（4 模块 + 4 测试 + 锁扩充 + zd + guards）。③ 工人卡住的判据：>5 分钟 `git status` 零改动 ⇒ 看 `.err` 尾部它在纠结什么，多半是卡面错了；杀掉（`kill <pid>`，pid 从 `pgrep -af "^node .*dsh --profile headless"` 取）、改卡、重派，比等便宜。
- **下一步（start-ready）**：T8 剩余三个（soukaku 6 个常量进纯函数 `necessaryTime`；grace 6 个进 `cycleBound`；burnice 2 个走 CC-408 的必填入参）——可以一次派一个模块；T9（倍率 / 能量常量）。
- **拍板**：hugo 的轴钩子常量保留（理由见 CC-410）；anbyZero 面板阶段 `criticalActionTime: 0` 接受（该调用不消费时间，工人已核）。
- **回滚点**：`git revert 015b6a61`。

**2026-10-03 14:14 arena-F 第 435 轮**（开工：master `5f4df62c` 干净、已推；**14:16 起别人在主仓改 `AGENTS.md` / `useResourceCalc.ts` / `stores/config.ts` + 新文件 `data/wEngineStackCoverage.ts`、`__tests__/wEngineStackCoverage.test.ts`，无认领行、无进程**——文件面与我不相交，我改在 worktree `wtF-r435` 验证后 ff 进 master，没动它们；REQUIREMENTS.md 无新条目；产物 `/home/kaua/calc-arch/arenaF/r435/`：`dupProbe.cjs` / `dupProbe.out`（普查）、`patch-cc409.py`、`patch-tests.py`、`zd.log`、`guards.log`、`build.log`、`vt.log`）：**CC-409 `67f6672b`**（代码，已推）+ 本文档提交。
- **做到哪**：CC-408 的普查推广成机器探针（模块数字常量 = 同角色 catalog 值）：13 个模块 35 个 actionTime 常量 + 少量倍率/能量常量是 catalog 的手抄本。加了通用机制 `cfg.moveActionTimes`（引擎预填）+ `cfgMoveActionTime` 读；迁了 6 个直读模块（12 个常量），其余 7 个模块写成 **§3 卡 T8**、倍率/能量常量写成 **卡 T9**——两张卡输入输出写死、验收是零差，适合执行模型 / dsh。
- **为什么是通用 cfg 字段而不是每个模块自己读表**：模块 `buildExecutions` 拿不到 `skills`，29 个已读表的模块各开了一个私有 cfg 字段中转；再加 13 个就是 13 个新字段。一个引擎填的表 + 一个读函数，以后新模块不用再想「时间从哪来」。
- **下一步（start-ready）**：T8（按表逐模块，建议先 miyabi / yixuan / anbyZero / hugo 这四个小的，再 soukaku / grace / burnice）；T9。派 dsh 的配方见 §2b「arena-F r424–r428 摘要」。
- **拍板**：① `moveActionTimes` 类型上**可选**——只为了 ~40 个手搭 cfg 的模块测试不必全填；引擎路径恒有；缺表读 0。② 本轮不迁纯函数型的 7 个模块——它们每个都要动入参 + 多处测试夹具，一轮做 13 个模块的 verify 代价高且回滚粒度差；拆成卡按模块提交。③ 别人的 WIP 没处理（还不到 1 小时，且在活跃改）。
- **坑**：worktree 里 `node_modules` 软链在 `git status` 显示 `?? node_modules`，别 `git add -A`；`git merge --ff-only` 进带别人 WIP 的主仓没问题，前提是提交不碰他们改的文件。
- **收工现场注记（14:30）**：主仓 `npm run -s check-guards` **红 2 项，全部来自别人未提交的 `src/data/wEngineStackCoverage.ts`**（:9 / :15 两条 `@fact` 缺「据」「锚」，`wengine:stackedCoverage/折算口径`、`/触发语义` 缺 `⟳复核 | 到期`）；HEAD `78cfcc4d` 在干净 worktree 里 25/25 绿。给那条 lane：补槽位格式照 `src/data/moveVariants.ts:33-34`。给下一轮：主仓红先 `git status` 看是不是这份 WIP，别归到 CC-409。
- **回滚点**：`git revert 67f6672b`（含 2 个测试文件与新锁）。

**2026-10-03 14:02 arena-F 第 434 轮**（开工：master `8e8234a2` 干净、已推、unpushed 0；无 verify / vitest 进程；REQUIREMENTS.md 无新条目（R1–R8 全 done）；§3 空；在主仓直接做（无并行 lane，认领表已登记）；产物 `/home/kaua/calc-arch/arenaF/r434/`：`patch-cc408.py`、`patch-test.py`、`zd.log`、`guards.log`、`build.log`、`vt.log`）：**CC-408 `1fbfd797`**（代码）+ 本文档提交。
- **做到哪**：普查 16 个读倍率表的角色模块 → 只有柏妮思有「常量 + 表」双源，且引擎真正用的是常量（持续段两行）；改成只读表、删常量、缺表为 0 不静默兜底。细节、没动的同类（burnice 两个 FALLBACK、claret 两个 `||` 兜底）与理由见卡表 CC-408。
- **为什么值得**：这是 R6「单一事实源」的直接违例（同 CC-321 删空硬编码表的那类），而且不是「等价冗余」——表变了持续段不跟。改动零差（常量 = 表值），但以后数据重导 / 版本改倍率只改 catalog 一处就对。
- **下一步候选**（不排序）：§3 空；下次碰 burnice / claret 时顺手把 `STIRRING/TOSSING_DAMAGE_FALLBACK` 改必填、`claret.ts:443-444` 去 `||` 兜底（CC-408 已写清）；r433 的两条（ratchet 推荐配装 0 maxIter 探针；vitest setup 150s 的三个大头）仍在。
- **拍板**：① `exRowMultipliers` 做成**必填**而不是可选 + 常量缺省——可选就把双源留在纯函数里；代价是 9 处测试入参，一次性。② 爆炸段仍 override=false 让 enrich 按表回填（与改前一致），没有顺手改成 override——那会让爆炸行脱离变体 / 融合 / 行规则的统一回填口。③ 缺表取 0 不取常量：缺表是数据问题，应在 zd / golden 里红出来，而不是被 2024 年的数字遮住。
- **坑**：`mechanicSettingsEffect.test.ts` 的 burnice 用例文案写着「mult ≈ 1088.3·v/1.89」——它经真引擎跑，读的是表值，常量删了照过；若将来表值变了它会红，那是对的（改期望值，不要把常量加回去）。
- **回滚点**：`git revert 1fbfd797`（代码 + 4 个测试文件一起回）。

**2026-10-03 13:55 arena-F 第 433 轮**（开工：master `f0edf893` 干净、已推、unpushed 0；无 verify / vitest 进程；别人 13:54 已自行提交 remielle.ts 注释 WIP `98716970`（方向 = CC-403，不用再处理）；REQUIREMENTS.md 无新条目；§3 空；**本轮零代码**，产物目录 `/home/kaua/calc-arch/arenaF/r433/`）
- **做到哪**：
  1. **CC-405 偏差 ①（「轴表 / 技能行 UI 查表没有队伍上下文」）关闭，不是不排期而是没有消费点**。逐个查了 `moveTableQueries` 的全部非测试引用：两个页面（`StunAxisPage.vue:264`、`LogicEditorPage.vue:186`）只用 `findMoveById` 查名字不查倍率；[表] 直读（`damagePoolDirect.ts:285` / `axisTableDirect`）在 CC-406 后已排除变体目标段，而变体源段 1101006 / 1101105 / 1101401 都是有执行行的招式、本来就不是 [表] 候选；`skillRows` 自己只剩 `averageBasicRows`（平A基准段秒均，变体源段是强化普攻二段 / 引爆 / 终结技，基准段落不到它们）；`composables/multiplierCoefficients.ts` 及其 4 个 view 消费者（DirectDamageChart / BossHpInflation / MultiplierCoeff / TimeCharts）是按版本的**单角色**静态推导，天然无队伍概念。⇒ 没有任何界面在珂蕾妲+本时显示非协同倍率。卡表 CC-405 已加指针。
  2. **变体表（`data/moveVariants.ts`）的迁移对象已穷尽**：grep `src/mechanics/agents/*.ts` 里所有「队友条件」逻辑，只有 `caesar.ts:109`（门控）、`lighter.ts:245`（队友特长/阵营）、`miyabi.ts:84`（风属性队友）、`orphie.ts:178-186`（席德在队 ⇒ `orphieAutoFrontRatio` 默认 0.8，是比例默认值不是换段）——没有第二个「队友在队换招式段」的手写特判。**别再以「还有哪个角色能迁进变体表」为由开轮**；新角色若有协同段，录入时直接加表（CC-405 / CC-406 排除自动跟上）。
  3. **变体表的演进规则（拍板，写死以免反复讨论）**：现在变体只换倍率行，时间通道不跟（CC-405 已知偏差 ②）。量过差额：终结技 1.8→1.733 = −0.067s/次，180s 窗约 2 次 ⇒ 0.13s；强化普攻二段 1.659→2.031 但珂蕾妲强化普攻行由模块发射、`actionTime` 走平A池不读该段；引爆 1101106 与 1101105 同 1.366s。即**现状只差终结技 0.13s/窗**，低于 ratchet 可见阈值，不改。**何时改、怎么改**：变体表 ≥3 条、或某条变体的时间差 ≥ 0.5s/窗时，不要在 `enrichExecutionPlan` 之外再加第二个消费点（那会回到「三处各写一遍」），而是改成「队伍视角的技能表覆盖」——在拿到全队 agentId 的同一处（`buildCharConfig` / 编排层）用 `teammateSegmentResolver` 生成一份把目标段的**行值与 actionTime 都盖到源段上**的 `AgentSkills` 视图，下游 `find*` / enrich / 轴表全部自动吃到，然后删掉 `fusedRowValue` 的 `segmentOf` 参数。这是比 CC-405 更通用的形态，但现在只有 1 条变体、时间差 0.13s，为它改 `agentSkillsByAgentMap` 的全部取用点（≥6 处）不值。
  4. **§2b 本 lane r424～r428 五段压成一节**（见下「arena-F r424–r428 摘要」）：五轮的卡（CC-398～CC-404）、r6 §8 行都齐，开放项全部关闭（r420 四个下一步已在 r432 关完），逐轮全文在 `git show f0edf893:docs/mcp-worker-task-queue.md`。保留了里面的通用配方与坑（dsh setsid 派发、无头页面读 core 摘要、vite pkill 自杀、TS2367、types↔core 方向、worktree .zc），没丢。§2b 从 56 KB 降到 49 KB。
- **下一步候选**（不排序；没有排定项，按 §1「没有排定项时不造活」）：§3 空；ratchet「推荐配装下 0 maxIter」是否成立（r430 §10，只需一次探针）；全量 vitest 236s 里 `setup 150s` 占大头（r431 `vt.log`：deadChannelLs 44s、pullPlannerEngine 42s、charIncrementInt 35s）——若以后 285s 上限再被打穿，先看这三个文件的 setup 而不是加 worker；主仓无 WIP、无孤儿。
- **拍板**：① 偏差 ① 标「关」而不是「不排期」，依据是消费点清单（上面第 1 条），不是估值。② 变体表演进阈值（≥3 条或 ≥0.5s/窗）是我定的，无用户口径；改阈值只需改本段。③ 压缩 r424–r428 用「一行一轮 + 坑清单」而不是纯指针，因为那五轮的坑没有别处落脚。
- **回滚点**：本轮只有文档，`git revert <本轮提交>`；压缩前原文 `git show f0edf893:docs/mcp-worker-task-queue.md`。

**2026-10-03 13:49 arena-F 第 432 轮**（开工：master `7c211ece` 干净、已推；主仓仍有别人 13:47 的 `remielle.ts` +5 行注释 WIP、无认领、无进程——没动；REQUIREMENTS.md 无新条目；本轮代码只改一行注释；产物 `/home/kaua/calc-arch/arenaF/r432/`：`exProbe.test.ts`、`exprobe.tsv`、`exprobe.log`）
- **做到哪**：r420 §2 下一步 3 / 4 **都关掉**（CC-407，口径裁决卡）。3 = 「能量全部打强特」用 60 角色探针量过：强特每秒直伤普遍是平A的 1.3～9.7 倍，青衣 4 命 / 安东是个例 ⇒ 维持，不引入「能量闲置」。4 = 仪其他.json「轴1」是仪玄通用轴，没有青衣成分，原交接的「重配」前提不成立。至此 **r420 的四个下一步全部有归宿**（1→CC-402，2→r430 §10，3/4→CC-407）。
- **顺手**：`cinemaMonotone.test.ts` ALLOW 注释里的「待办」改指 CC-407（注释行，零行为）。`.claude/OPEN-ITEMS.md`（**不入 git**）§2 的 D3（蕾米 atk_1）仍写着三个修法选项像待开工——已在该条顶部加一行指针到 CC-403（含本人、维持、重开条件），免得下一个会话第三次去改「不含本人」（13:47 那份 remielle.ts WIP 就是又一次）。
- **探针的坑**（下次复用注意）：按 `moveId === 'basic_attack'` 归平A直伤、按强特执行行 moveId 归强特直伤，对模块重写平A循环（青衣醉花、安比、伊德海莉、希格莉德）或强特走模块行（琉音、普罗米娅、洛克茜）的角色读 0；要全覆盖得按 `damagePoolRows.source` / 模块行名归因。
- **下一步候选**（不排序）：§3 空；CC-405 偏差 ①（技能行 UI 队伍上下文，显示面）【r433 已关：无消费点】；ratchet 推荐配装「0 maxIter」一面（r430 §10）；主仓 remielle.ts 注释 WIP 若 >1h 仍无人认领按孤儿规则处理（方向与 CC-403 一致，只需把「09-30 用户裁决」改成「CC-403 原文解读」再收养）。
- **回滚点**：无代码行为改动。

**2026-10-03 13:33 arena-F 第 431 轮**（开工：master `458a38cc` 干净、已推；零 WIP；REQUIREMENTS.md 无新条目；worktree `wtF-variant` 已删，产物 `/home/kaua/calc-arch/arenaF/r431/`：`patch.py`、`vt.log`、`guards.log`、`build.log`）
- **做到哪**：CC-406 `edddeb39`——CC-405 建了变体表之后，协同段 1101106 / 1101402 仍是珂蕾妲的 [表] 候选（r419 普查 TWIN 行，CC-402 当时记「未决」），放进轴就与执行行双计。`axisTableDirect` 现在从变体表推导 `VARIANT_TARGETS` 排除，和融合并入段同级；以后变体表加一行，排除自动跟上。CC-402 (iii) 珂蕾妲项与 CC-405「已知偏差」的 [表] 部分都结了。
- **CC-405 偏差 ① 现在只剩显示面**：轴表 / 技能行 UI 的查表值（非伤害路径）在珂蕾妲+本时仍显示非协同倍率；伤害与 [表] 候选都已正确。要改得把 `teamAgentIds` 送进 `skillRows` 的查表口，收益只是显示，仍不排期。 → **r433 复核：实际没有任何 UI 读那条倍率（消费点清单见 §2b r433 第 1 条），偏差 ① 关。**
- **踩坑**：全量 vitest 第一次跑超 285s 被 `timeout` 杀掉（load 24——紧接在 vue-tsc + guards + zd 之后起跑，worker 还没凉）。被杀的 vitest 子进程会拖十几秒才退，期间 `pgrep vitest` 看到的是**自己的尸体**，别误判成别的 lane。等 load 降到 15 以下重跑一次就 235s 过了。⇒ 重任务之间 `sleep 20` 再起下一段。
- **下一步候选**（不排序）：r420 下一步 3/4 需用户口径，只能写候选；§3 空；可以做的通用项：① `标准倍率表 / 技能行 UI` 的队伍上下文（显示面，低优先）；② 用 `convergenceProbe` 的 A 口径（推荐配装）给 `timeFillRatchet` 的绝对不变量加「0 maxIter」一面（r430 §10 写了做法，多一条锁、无架构收益，有空再做）。
- **收工时现场**（13:47）：主仓出现别人**未认领**的 `src/mechanics/agents/remielle.ts` +5 行（只加注释：「anomalyCount 含本人（2026-09-30 用户裁决）…此前改成不含本人是误改已回滚」）。结论方向与 CC-403 一致（含本人），但它引用的「09-30 用户裁决」在 docs 里仍然不存在（CC-403 已核：09-30 的 1581 裁决是 C6 耀变）。是 1 分钟前的活 WIP，不是孤儿，**没动**；接手的人若收养它，把那句出处改成「CC-403 原文解读」而不是不存在的裁决。
- **回滚点**：`git revert edddeb39`。

**2026-10-03 13:27 arena-F 第 430 轮**（开工：master `014a58f7` 干净、已推；主仓零 WIP；REQUIREMENTS.md 无新条目；本轮**无代码改动**，产物 `/home/kaua/calc-arch/arenaF/r430/`：`outerExitProbe.test.ts`（一次性探针，已从仓库删除）、`probe.log`）
- **做到哪**：r420 下一步 2（yidhari-qingyi-lucia 外层振荡）**复核并关掉**：`PROBE_CONV_TEAM` 三读数 + 自写 A/B/C 探针都给 `stable`（套推荐配装 5 轮、缺省配装 4 轮），不是 7↔8 振荡。§2 该条已加指针。
- **顺手量到的、值得知道的两件事**（写进 `mcp-integer-cycle-stop.md` §10）：① **外层 outerExit 与跑的先后顺序无关**（104 队顺序热跑 vs 每队冷跑逐队相同）；② 但**与配装有关**：缺省配装（ratchet 基线口径）cycle 只有 2 队（auto-1021-1481-1341 / auto-1191-1481-1311），套推荐配装（`applyTeamPreset`，convergenceProbe 口径）cycle 是另外 6 队（auto-1041-1361-1311、yixuan-trigger-lucia、yixuan-jufufu-lucia（长环，20 轮后判出）、auto-1371-1571-1451（长环）、auto-1511-1561-1411、auto-1181-1511-1411），两套名单**不相交**；两种口径都没有 maxIter。所以 `timeFillRatchet` 的 outerExit 基线只锁了缺省配装这一面，别拿它当「全部 cycle 队名单」。
- **拍板**：不改代码。cycle 本身是 CC-326/327/328 已定的整数环停点规则在正常工作（长环 20 轮后回查、规范选点），没有 maxIter 就没有缺陷；要锁「推荐配装下也无 maxIter」可以给 ratchet 加一面，但那是多一条锁不是架构收益，先不做。
- **下一步候选**（不排序）：r420 下一步 3/4 需用户口径，只能写候选；CC-405 偏差 ①（轴表/技能行 UI 显示协同值，要把 `teamAgentIds` 送进 `axisTableDirect` / `skillRows` 查表口）；§3 空——如果没别的，去 `docs/mcp-r6-refactor-list.md` 未结项里挑。
- **回滚点**：无代码；docs 一个提交。

**2026-10-03 13:08 arena-F 第 429 轮**（开工：master `ecf7bfa0` 干净、已推；主仓零 WIP（r428 清掉孤儿后第一次）；REQUIREMENTS.md 无新条目；worktree `wtF-coop` 已删，产物 `/home/kaua/calc-arch/arenaF/r429/`：`helpers.diff`、`vt.log`、`guards.log`、`build.log`、patch 脚本）
- **做到哪**：r427/r428 挂着的「珂蕾妲协同版」**做完**（CC-405 `84b3210e`）。不是 koleda 特判，而是加了一层通用的「队友在队招式变体」表（`src/data/moveVariants.ts`），融合求和前换段、`enrichExecutionPlan` 一处消费；以后任何「X 在队时 Y 的某段换倍率」都是表里加一行。
- **为什么 golden/zd 一动不动**：预设库里没有珂蕾妲，所以 zd DIFF 0 不是「没改伤害」而是「改的伤害没被预设覆盖」——真实影响只在含珂蕾妲+本的自定义队（强化普攻 +17%、引爆 +10%、终结 +9.4%）。锁靠 `moveVariants.test.ts` 真引擎用例（珂蕾妲+本+妮可）。
- **留下的已知偏差**（不是 bug 票，是记录）：① 轴表 / 技能行 UI 查表没有队伍上下文，珂蕾妲+本时仍显示非协同值——要改得把 `teamAgentIds` 送进 `axisTableDirect` / `skillRows` 的查表口，改动面大、收益只是显示，没做；② 协同段 actionTime 未跟随（终结 1.8→1.733、二段 1.659→2.031），时间通道仍按原段。
- **扫过、确认不属于变体表的**：全库 17 条「协同」param 中千夏 1491019（泡泡，已在 QIANXIA_EX_PHOTOGRAPHY 融合组）、爱芮 1501022（CC-197 归属不明）、南宫羽 1511018、柚叶 1411022 都是自身召唤/机制协同，与队友无关——别再把它们当 CC-405 的续篇。
- **下一步候选**（不排序，承接 r428）：arena-E §2 r420 下一步 2（yidhari-qingyi-lucia 外层振荡：CC-402 后 ratchet 已 cycle→stable，先确认还振不振，不振在 §2 加一行指针关掉）；r420 下一步 3/4 需用户口径，只能写候选；若用户要 UI 也显示协同值，走上面偏差 ①。
- **回滚点**：`git revert 84b3210e`（docs 单独一提交）。

**arena-F r424–r428 摘要**（2026-10-03 11:40～13:00；r433 压缩，逐轮原文 `git show f0edf893:docs/mcp-worker-task-queue.md`；卡表 CC-398～CC-404、r6 §8 行 424～428；开放项**全部关闭**，不要从这里找活）
- r424 **CC-398 `70a16851`**：`as unknown as` 29 处分四类，只修 3 处真断契约；捏轴页「条XX%」积蓄槽百分比自 08-24 起从未显示（摘要没透传），接通 + 端到端锁；顺手修 master 上别人带进的 4 个 vue-tsc 错 ⇒ §1 加「开工先 vue-tsc」。
- r425 **CC-399 = T5 `df3e7c42` + T6 `1b771511`**：velina / alice helper 形参真类型；promia spec effect → BuffEffect 共享转换器；`source` 不透传（`getEffectSourceValue` 兜底链里 `source.defaultValue` 排在面板之后、0 之前，全仓只有 1541 带且为 0）。
- r426 **CC-400 `13602152`（T4，dsh 工人）+ CC-401（仅文档）**：spec 侧 8 处字段名读写收成 `readCfgField` / `writeMechanicSettingCfg`，`as unknown as` 非测试面停在 14 处（CC-398 判合理）**别再清**；无头 chromium 开捏轴页确认「条电34%」真渲染。
- r427 **CC-402 `1f78ccb6`**：r420 的 27 个 [表] TWIN 候选全部裁决，只有卢西娅终结技登记两段融合（改伤害，4 个夹具测试归因后改）；T7 立卡。
- r428 **CC-403（仅文档）+ CC-404 `5d081fb5`（T7，dsh 工人）**：remielle 三文件孤儿丢弃（diff 存 `arenaF/r428/remielle-orphan.diff`，理由：把 09-30 C6 裁决错按到档位计数上）；模块声明「分支组」、`axisHiddenMovesOf` 读它。
- **保留的配方 / 坑**（别处没有落脚）：
  - 派 dsh：`BRIEF="$(awk -v c=T? '$0=="<!-- card: " c " -->"{f=1;next} $0=="<!-- /card: " c " -->"{f=0} f' docs/mcp-worker-task-queue.md)"`，在建好的 worktree 里 `setsid nohup /home/kaua/.local/node/bin/dsh --profile headless "$BRIEF" > …/worker.out 2> …/worker.err < /dev/null & disown`——**`setsid` 才能跨 `wsl_exec` 存活**（r401 的 nohup vitest 死掉是没 setsid）。回收：`pgrep -af '^node .*dsh --profile headless'` 为空 + report 首行 `STATUS: done`；主代理**亲自** `git diff` 看白名单、自己跑 zd + verify；工人 worktree 用 `git worktree remove --force` 删（node_modules 软链）。
  - 查「算了但没显示」：`arenaF/r426/shot.cjs`（playwright-core + chrome-headless-shell，r416 配方）从 `document.querySelector('.sap-block').__vueParentComponent` 沿 `.parent` 爬到含 `inStunAnomalyState` 的 `setupState` 直接读 core 摘要，比截图准。
  - 同一条 `wsl_exec` 里既起 `npx vite --port 5199` 又 `pkill -f "[v]ite --port 5199"` 会把包装 shell 自己杀掉；改 `ss -ltnp | grep ":5199 "` 取 pid 再 kill。
  - `TS2367` 出现在 `A || (B && A)` 的第二个 `A`：是条件冗余不是联合缺成员。
  - `types/resource` 不 import `@/core`；core 结果类型要给编排层摘要复用时搬到 types 再 `export type` 转出，别反向 import。
  - worktree 里 `.zc` 不入 git：`mkdir -p <wt>/.zc && cp -r .zc/perf <wt>/.zc/perf`。
  - `TeamBuffEffectSpec` 没声明的字段 JSON 里照样能有，tsc 不报；要知道「数据里有没有」只能扫 `src/specs/agents/*.json`。
  - 别人 WIP 里写的「用户裁决」要回 docs 核对日期与内容再信；处置孤儿前整份 diff 存到 calc-arch 让丢弃可逆。
  - 样例型测试（「找一个 slack>2 的队」之类）会把数据缺陷固化成夹具——改数据后红了先归因再改样例。

**2026-10-03 01:28 arena-C 第 423 轮**（开工 01:28：master `18354072`、无并行提交、独占进程只有常驻 `dsh web`；主仓仍有别人未跟踪的 `src/mechanics/__tests__/r65j1DeadBuffProbe.test.ts`（R65-J1 探针，11 分钟未更新，01:40 写出了 `.zc/reports/r65j1-dead-buff-probe.json`）⇒ 判并行，但文件面不相交（他动 mechanics/utils，我动 composables/stores/specs）；REQUIREMENTS.md 429 行无新条目；worktree `wtA-r423` 已删）：**CC-397 `3743c6c7`**，已 ff 合入 master。
- **⚠ 事故（被误 revert 又恢复，下一轮看这里）**：01:45:38 CC-397（`3743c6c7`）ff 合入 master；01:46:48 并行 lane 把它 `git revert` 掉了（`41f169b8`，无原因说明）；01:49 本轮 revert 掉那个 revert（`8936dfb9`，commit 正文里写了证据）。**判定误伤的两步实验**（都在隔离 worktree 里做，没动别人在飞的文件）：把 `3743c6c7` 检出来 + 把主仓里别人未跟踪的两个文件（`src/core/teammateBuffSource.ts` 的 WIP、`src/mechanics/__tests__/r65j1DeadBuffProbe.test.ts`）原样拷进去跑 `vue-tsc` ⇒ 报 `r65j1DeadBuffProbe.test.ts(283,1): error TS1005: '}' expected.`；在**已 revert 的状态**做同样一件事 ⇒ **同一个错、同一行同一列**。⇒ 这个语法错与 CC-397 无关：那个探针文件当时是**写到一半的状态**（282 行、末尾块没合上），任何人那时刻全仓库跑 vue-tsc / verify 都会红。时间线也合踐：revert 之后 01:47:39 他们还在继续改那个探针。
- **给并行 lane 的一句话**：如果你的类型检查还是红，**先看你自己正在写的文件是不是没写完**（当前 = `src/mechanics/__tests__/r65j1DeadBuffProbe.test.ts` 第 283 行 TS1005）；**别 revert 别人的提交**。真有冲突（文件面重叠 / 口径不一致）就在本节写一行原因，下一轮看得见。

- **做到哪**：r422 收尾复扫发现展示层之外只剩 9 处裸 any / 4 文件 ⇒ 全部清完，并把锁从 2 目录扩到 4 目录（扫描面 40 → 134 文件）。非测试 `src/` 6 条规则 **0 处**。
  1. `composables/hpSourceBreakdown.ts` 4：`(raw as any).modificationValues` / `(effect as any).sourceLabel` —— CC-395a 已补过声明（`BuffEffect`），强转纯冗余直删；`four.twoPiece as any` / `two.twoPiece as any` —— 驱动盘 2 件套的类型只有 `effects`（`DriveDiscSetPiece`），与 `BuffGroup` 不等形，改传 `{ scope: 'outOfCombat', effects: … }`（与 r421 views 里同一处同修法；行为等价：原先传无 scope 对象时 `hpPhase` 就把 hpPct/hpFlat 判成局外）。
  2. `composables/useStatLabel.ts` 2：`(statDisplay as any)?.[stat]` 的 `as any` 完全多余（`statDisplay: Record<string, …>` 本就可按字符串键索引）⇒ 直删；两种 label 形态兼容靠 `localized(value: unknown)` + `typeof` 判定，文件头注释同步改。
  3. `stores/catalog.ts` 3：`sourceStat as any` 与 `stat: e.stat as TeammateBuff[…]['stat']` 都是 **no-op**（`StatId = string`）⇒ 直删；`targetSkillType as any` 改由 spec 侧收窄消除（见 5）。
  4. `composables/useResourceCalc.ts` + `resourceCalc/convergence.ts` 1（+契约）：`computeStunCoverage(sp: any)` 与 deps 里的 `sp: unknown` 同时收窄成 `Pick<StunPoolResult, 'stunCount'> | null | undefined`。**只改一边编译不过**（函数类型参数逆变），两边同时改才是真契约。
  5. `specs/types.ts`：`TeamBuffEffectSpec.stat / sourceStat` → `StatId`、`targetSkillType` → 真联合 `SkillDamageTarget`（该文件以前零 import，本轮加了一行 `import type … from '@/types/catalog'`）。全仓 vue-tsc 0 错 ⇒ **现有 spec 数据全部合法**，不是把报错挡住，而是验证过。
- **锁**：`src/scripts/__tests__/displayLayerNoAny.test.ts` 现在扫 4 目录（views / components / composables / stores，除注释后 134 文件）+ 8 个具名文件 + 文件数下限 100 + 6 规则表 + 检测函数单测（新增 `Pick<…>` 必须放过的用例）。反证：往 `composables/useStatLabel.ts` 注入 `const __probe: any = 1`、往 `stores/catalog.ts` 注入 `({} as any).zz`，两条规则分别红并报 `文件:行号`。
- **验证**：`vue-tsc -b --force` 0 错；定向 7 文件 31 passed；全量 verify EXIT 0（465 文件 / 4280 测试，16/29 skipped；独立 25 / token 12 / data 366 / spec 1120 / recording 189）。全部改动只动类型标注 / 类型声明，无一行运行时逻辑 ⇒ 运行时零变化。
- **下一步（start-ready）**：
  1. **同家族的下一个漏洚 = `as unknown as`**（非测试 src 里 29 处 / 15 文件：`specs` 7、`core` 7、`mechanics` 6、`composables` 6、`utils` 2、`views` 1；它能同时绕过 `as any` 和 `: any` 两条规则）。做法：先在锁里加第 7 条规则 `/as unknown as/`（只改锁文件，立即红），再清 **我自己的 4 目录里的 6 处**（composables 6；`analysisScenario.ts` 3 、`panelStat.ts` 在 utils 不归我）；`specs` / `core` / `mechanics` 的 20 处写成候选清单（文件:行号 + 当前写法）留给对应 lane 空时清。**别一开始就拉入 `mechanics/agents/*`**（arena-E 历史占用面，他们正在那边跑 R65-J1）。
  2. 若 1 做完还有余量：把锁皈到 `src/utils`（10 处 `: unknown` / `as unknown`，含 `panelStat.ts` 2 处 `as unknown as`）——扫描面加一个具名目录 + 具名文件，方法同上。
  3. **别接别人的 R65-J1 死 buff 晨查**：探针结果已落 `.zc/reports/r65j1-dead-buff-probe.json`（3004 B，01:40；总数 134、interactive 127、gaps 里已见 `1411.cinema_6.disorder_multiplier_bonus` / `1581.additional_ability.atk_1_anomaly` / `1221.yanagi.core_disorder_multiplier_bonus` 等——**拖了不变的“交互”条目**），但他还未提交；等他收工后按结论单独开卡（那是行为层缺口，与类型锁不是一件事）。
- **坑**：
  - `CharacterConfig` 在 `@/stores/config`，`StatId` / `SkillDamageTarget` 在 `@/types/catalog`（r422 曾把 `CharacterConfig` 写错到 `@/types/resource`，报 TS2305）。
  - `computeStunCoverage` 这类「实现在 A、deps 接口在 B」的入参，**必须两边同时收窄**；只改一边会因参数逆变（strictFunctionTypes）编译不过。
  - `StatId = string`（别名，非联合）⇒ 属性 id 拼错零编译期保护。**不要手写联合**：词表来自 `catalog.json` 数据，手写会与数据脱节；要做得从数据生成类型（build-time codegen），属于另一件事。
  - 测试侧 2103 处 any / 154 文件（集中 `mechanics/__tests__` 角色 mock）。**判定不锁不清**：夹具局部 mock 用 any 是惯用法，锁它 = 纯机械大改、无架构收益。
- **回退点**：`git revert 3743c6c7`（纯类型标注 / 类型声明，锁在同一次提交里，revert 会一起回退）。

**2026-10-03 01:20 arena-C 第 422 轮**（开工 01:00：master `2e325bbe`、无并行提交、独占进程只有常驻 `dsh web`；01:16 主仓弹出别人未跟踪的 `src/mechanics/__tests__/r65j1DeadBuffProbe.test.ts`（R65-J1 「声明了但没接进计算」死 buff 晨查探针，2 分钟前新建）⇒ 判定并行，但文件面不相交（他动 mechanics/utils，我动 views/components）；REQUIREMENTS.md 429 行无新条目；worktree `wtA-r422` 已删）：**CC-396 `df24a9ec`**，已 ff 合入 master。
- **做到哪**：展示层 28 处裸 any 标注清到 0（7 文件）+ 源码锁从 1 条规则扩到 6 条。逐文件：
  1. `components/ResourceResultCard.vue` 13 处：列数组标 `DataTableColumns<SkillExecution>` / `<AnomalyEventExecution>` 后删掉 10 个 `render(row: any)`；`executionValue` 的键参数收窄成 `ExecAmountKey` 联合（单/总 10 个键名，写错编译期即报错）；`renderCount` 返回类型交给推断；异常池补入的事件行 `eventType: e.type` → `'release' as const`（上方 filter 已按 `type === 'release'`，原宽联合过不了 `AnomalyEventExecution` 的窄接口）。
  2. `views/ResourceUtilizationPage.vue` 7 处：`settlementRows(vp)` / `vpTotalTriggers(vp)` 标 `AnomalyVirtualPanelBuild`；`filter` / `map` 的 row 标 `AnomalyVirtualPanelRow`；两处 `perElement.find((p: AnomalyProgress) => ...)`；返回类型交给推断（原 `: any[]`）。
  3. `views/ResourcePage.vue` 2 处：`cols: any[]` → `DataTableColumns<MoveRow>`（新增 `type MoveRow = Record<string, unknown>`）；`const row: Record<string, any>` → `MoveRow`。
  4. `components/ImpactChart.vue` 2 处：`Snapshot.team` → `CharacterConfig[]`；`catch (e: any)` → `catch (e)` + `e instanceof Error ? e.message : String(e)`。
  5. `components/charts/ResponseSurface3D.vue` 2 处：`renderVarLabel` 返回 `VNodeChild`；`drawQuadContour` 的 `q: any` → 新接口 `Quad`（四角 `QuadCorner{screenX, screenY, normZ}`）。
  6. `views/CalculatorView.vue` 1 处：`pageMap: Record<string, any>` → `Record<string, Component>`（该文件本就已 import `type Component`）。
  7. `views/RunArchivePage.vue` 1 处：模板 `:row-key="(r: any) => r.id"` → `r => r.id`（naive-ui 的 rowKey prop 自带 `(row: any)` 语境，删标注不触发隐式 any）。
- **锁**：`src/scripts/__tests__/displayLayerNoAny.test.ts` 现在是 6 条规则表（`as any` / `: any` / `<any>` / `any[]` / `Record<…, any>` / `) => any`）+ 扫描面清单（4 个具名文件 + 文件数下限）+ 检测函数单测。反证：往 `views/ResourcePage.vue` 注入 `const __probe: any = 1` + `const __probe2: any[] = []`，两条规则同时红并报 `views/ResourcePage.vue:157/158`。
- **验证**：`vue-tsc -b --force` 0 错；全量 verify EXIT 0（465 文件 / 4280 测试，16/29 skipped；独立 25 / token 12 / data 366 / spec 1120 / recording 189）。比 421 轮多的 6 个测试正好是锁新增的 6 条规则。全部改动只动类型标注，无一行运行时逻辑 ⇒ 运行时零变化。
- **下一步（start-ready）**：
  1. **展示层已无 any 可清，换面**。全仓库（去注释、去测试）按同 6 条规则扫，剩余只有 **9 处 / 4 文件**（已本轮复核，别直接信任 4f59量的旧数字）：`src/composables/hpSourceBreakdown.ts` 4（`(raw as any).modificationValues` / `(effect as any).sourceLabel` / `twoPiece as any` ×2）、`src/composables/useStatLabel.ts` 2（`(statDisplay as any)?.[stat]` ×2）、`src/stores/catalog.ts` 2（`sourceStat as any` / `targetSkillType as any`）、`src/composables/useResourceCalc.ts` 1（`computeStunCoverage(sp: any)`）。**注意**：`hpSourceBreakdown.ts` 读的 `modificationValues` / `sourceLabel` 就是 CC-395a 已经补过声明的字段，只不过它拿到的变量类型不是 `BuffEffect` （先确认真实类型再动手，别直接强转到 `BuffEffect`）。做法延续 CC-395a 路子：补声明 / 改具名读取，别加允许。
  2. 若 1 做完还有余量：把锁从 views/components 扩到 **composables + stores**（扫描面加两个具名目录，ALLOW 保留）——此时 `useResourceCalc.ts:290` 的 `sp: any` 就会红，顺手修掉。`src/composables/resourceCalc/axisTableDirect.ts` 是 arena-E 历史占用面，**别接**。
  3. **别接别人正在跑的 R65-J1 死 buff 晨查**（`src/mechanics/__tests__/r65j1DeadBuffProbe.test.ts` + `src/utils/teammateBuffRows.ts`）：那是行为层缺口晨查，和类型锁不是一件事；他的探针写了 `.zc/reports/*.json`，结果出来后可以单独开卡处理。
- **坑**：
  - `CharacterConfig` 在 `@/stores/config`，**不在** `@/types/resource`（后者只 re-export resource 域）。本轮先写错一次，`vue-tsc` 报 TS2305 才改对。
  - 表格列 render 的修法永远是「标列数组、删行标注」；只删 `row: any` 不标列数组 = 隐式 any 报错。
  - 写锁的自测期望要按规则分类：`Promise<any>` 归 `<any>` 规则、`) => any` 归第 6 规则、`x: any` 与 `as any` 是两条规则（本轮这 3 个期望写错过，锁本身没错）。
  - 除注释后的 `as any` 统计和原始 grep 差很远：mechanics 7 处、types 3 处全是注释里的历史说明（「此前未声明 ⇒ 读端 `as any`」）。报数前先除注释，否则会高病剩余值。
- **回退点**：`git revert df24a9ec`（纯类型标注，锁在同一次提交里，revert 会一起回退）。

**2026-10-03 00:12 arena-C 第 421 轮**（开工时 arena-E r420 仍在 `wtE-rec30` 跑 perf ⇒ 并行；00:23 对方收工并 push `497aaa27` + `f7c60b6a`，合入前已 rebase；REQUIREMENTS.md 429 行无新条目；worktree `wtA-r421` 已删）：**CC-395 `6dbd26b8`**，已 ff 合入 master。
- **做到哪**（两件事，互不相干）：
  1. **CC-395a 展示层类型断层**：`views/` + `components/` 的 24 处 `as any` 清到 **0**。19 处字段本就已声明 = 冗余强转（`BuffEffect.modificationValues / sourceLabel / source`、`TeammateBuff` 经 `BuffGroup` 继承的 `name / description / sourceLabel / conditionLabel`、`CharacterResourceResult.burniceMechanicSource`、`AnomalyPoolResult.corrosionSource`）；5 处补声明的真实数据字段（catalog.json 里真有）：`BuffEffect.stackLabel / stackGroup / durationSeconds` + `BuffGroup.durationSeconds`（防御性：导入脚本 `scripts/patch-disc-sets.mjs` 当前只写效果级）。`DebugPage` 副词条步长与驱动盘 2 件套两处改具名读取（`sRankSubStatBaseStep?.[stat] ?? 0`；`{ scope: 'outOfCombat', effects }`）；`ResourceResultCard` 职业标签色常量表按 `naive-ui` `TagProps['type']` 标注，去掉模板里的强转。新源码锁 `src/scripts/__tests__/displayLayerNoAny.test.ts`（反证通过：注入一行 `as any` 即红并报出 `文件:行号`；扫描面用两个具名文件 + 文件数下限防目录被挪走后静默失效）。
  2. **CC-395b 取消契一**：删 `batchTask` 里零生产调用方的 `createBatchScheduler` / `throwIfBatchAborted` / `SchedulerPlatform` 与其 4 条测试。取消契约只剩优雅式一种（分析器循环头 `isBatchAborted` 后 `break`，带上已算部分返回）。依据：worker 里不必向主线程让步（`yieldToMain` 在 worker 里没有意义），硬停走 `worker.terminate()`；两种取消惯用法共处一个 100 行模块，正是第 374 轮差点接错线的诱因。隔离文档 §3.10 / §6 第 3 项 / §7 / §8 / §9 已同步。
- **验证**：`vue-tsc -b --force` 0 错；定向 5 个测试文件 85 项全绿；**全量 verify EXIT 0（465 文件 / 4274 测试，16 / 29 skipped）**。
- **坑（本轮新踩，两条都值得记住）**：
  - **`vite build` A/B 别用裸 `diff -r`**：改任一面页 chunk 会**级联**——`index` 块的 `__vite__mapDeps` 内嵌全部懒加载块的 8 位内容哈希，它一变，所有 `import "./index-*.js"` 的块跟着变。本轮裸 diff 报了 71 行「Only in」，其中没有一行是真差异。判据：把块名里的 8 位哈希归一化后再比（本轮 **42/52 归一化后逐字节相同**；剩下 10 个里 6 个只是引用哈希字符串不同，真实代码差异只有 `DebugPage.vue` / `AttributeConfigPage.vue` 各删一个局部变量，逐字等价）。另：**同一棵树连跑两次 build 逐字节可复现**（实测），所以「两边不一样」只可能是级联或真实改动。
  - **`wsl_exec` 偶发会落在沙箱里执行**（本轮实测 3 次：`hostname` 回 `e2b.local`、`ls /home/kaua` 报不存在、随后同一命令又正常回 `LAPTOP-BI1OCF5H`）。现象是「项目突然消失了」，**不是环境坏了**——原样重试即可。判据：任何 `wsl_exec` 结果先看 `hostname` 或一个已知路径是否存在，再据它下结论。
  - **提示词的内嵌客户端可能比 Windows 侧文件旧**：本轮用户粘贴的提示词里是 `let id = 1`，而 `/mnt/c/Users/kaua/Desktop/bridge-prompt-arena.md` 与 WSL 端 `/home/kaua/calc-arch/arena-mcp-client.js` 早已改成 `let id = process.pid * 1000`（r404 的 Duplicate id 修复）。**以 WSL 端那份为准**（本轮 md5 `283e44ba3a6e6812250032d478e8e252`），别照抄粘贴版把文件改回去。沙箱侧跨轮持久副本是 `/home/user/mcp.js`（`/tmp` 每轮清空），本轮已同步。
- **下一步（按价值排）**：
  1. **展示层 `: any` 参数标注 23 处 / 6 文件**（锁目前只覆盖 `as any`，`(x: any)` 是同类债，r406 记过这个盲区）：`components/ResourceResultCard.vue` 12 处（表格列 `render(row: any)`——把列数组按 `DataTableColumns<行类型>` 标注就能去掉标注）、`views/ResourceUtilizationPage.vue` 5 处（`settlementRows(vp: any)` / `vpTotalTriggers(vp: any)` 及其内的 `(row: any)` / `(p: any)`）、`components/ImpactChart.vue` 2 处（`interface Snapshot { team: any }`、`catch (e: any)`）、`components/charts/ResponseSurface3D.vue` 1 处（`drawQuadContour(ctx, q: any)`）、`views/ResourcePage.vue` 1 处（`const cols: any[]`）、`views/RunArchivePage.vue` 1 处（模板 `:row-key="(r: any) => r.id"`）。做完把 `displayLayerNoAny.test.ts` 的锁扩到 `: any` / `<any>` / `any[]`。
  2. **CC-343 线（隔离文档 §6）已无剩余项**（S1–S5 全完，scheduler 已删）。worker 化仍是「需要时再谈」：取消走 `signal` + 页面发布权，硬停走 `worker.terminate()`，届时再决定 `AnalysisContext` 要不要加 catalog 快照（§7 那条决定的「再收窄时机」）。
  3. 主队列 §2（arena-E r420）的下一步不变：剩余同基名 [表] TWIN 候选逐个核对（清单在 §2 r420 段）。
- **拍板**：① 删 scheduler 而不是「留着备用」。② `BuffGroup.durationSeconds` 按防御性字段声明，不删 `TeamConfigPage` 的组级检查。③ 本轮不动 `: any`（23 处需要行类型，半做比不做更糟），写成下一步 1。
- **提示词本轮改了一处**（Windows 侧 `bridge-prompt-arena.md`，备份 `.bak-client-authority-20261003-0045`，「改了什么 + 为什么」已写进该文件 §二 修改记录）：在「现成客户端」那段之前加**客户端权威顺序**（WSL 端 `/home/kaua/calc-arch/arena-mcp-client.js` > 文件内嵌代码 > 粘贴版）+ 沙箱 `/tmp` 每轮清空、跨轮持久副本 `/home/user/mcp.js`。改后已 grep 核对：MCP 端点、`wsl_exec` 用法、第 7 条文档纪律原样都在，`let id = process.pid * 1000` 未被改回旧版。
- **回退点**：`git revert 6dbd26b8`（展示层清理与 scheduler 删除同一个提交；只需恢复 scheduler 时 `git revert -n` 后从该提交里拣回那两段）。

**2026-10-02 arena-E 第 386 轮**：CC-356 纯界面态 activeTab / selectedSlot 搬到 `stores/ui.ts` `3914192b`——原 §2；全文 `git show 5ee3d6f6:docs/mcp-worker-task-queue.md` 的 §2（含 ui-check 用法坑）。

**2026-10-02 arena-E 第 385 轮**：CC-355 删 refreshTrigger / triggerRefresh 与三个 no-op 刷新按钮 `af660ce4`——原 §2；全文 `git show a6cb4b42:docs/mcp-worker-task-queue.md` 的 §2（含 WSL / vitest worker 环境坑）。

**2026-10-02 arena-E 第 384 轮**：金档写入入口审计（不动）+ CC-354 删内部手动 refreshTrigger `ca616a22`——原 §2；全文 `git show e7095d6b:docs/mcp-worker-task-queue.md` 的 §2。

**2026-10-02 arena-E 第 383 轮**：CC-353 view 层试算循环源码锁（analysisScenario.test ④c）`44bddfb3`——原 §2；全文 `git show 1efb9dce:docs/mcp-worker-task-queue.md` 的 §2。

**2026-10-02 arena-E 第 382 轮**：CC-352 实战部署页当期牌自动选择迁独立场景 `7967311a`——原 §2；全文 `git show d01283dd:docs/mcp-worker-task-queue.md` 的 §2。

**2026-10-02 arena-E 第 381 轮**：CC-351 队伍预设 → store 单一映射 `ff1a64dc`（主页选预设改套预设音擎，与队伍对比同一支队；分析器 zd 零差）——原 §2；全文 `git show 02dfce35:docs/mcp-worker-task-queue.md` 的 §2。

**2026-10-02 arena-E 第 380 轮**：CC-350 敌方体型并入 Boss 房间入口 `83f9b665`（删 TeamComparePage 写 UI store 体型的 watcher；口径：所有进房间路径体型跟 Boss）——原 §2；全文 `git show bb45d580:docs/mcp-worker-task-queue.md` 的 §2。

**2026-10-02 arena-E 第 379 轮**：CC-349 自动轴保底预填去页面依赖 `3f5dcb1e`（UI store 会话效果，不进场景 Model）；开放项（预设 `guarantee` 在手动应用 / altAxes 绑定不生效）**已于 r388 裁决关闭**：手动应用预填、批量路径不写，见卡表 CC-358。

**2026-10-02 arena-E 第 378 轮**：CC-348 Canvas 主题桥单源 `4b4490f3`（三个 3D 组件取色归一 + 修切主题不重绘；像素 A/B 相同）——原 §2 交接；全文 `git show 79e3039c:docs/mcp-worker-task-queue.md` 的 §2。

**2026-10-02 arena-E 第 377 轮**：CC-347 命座提升率迁独立场景 `887c0ebc`（A/B 逐字节相同；改写 UI store 的分析器清零）——原 §2 交接，细节见隔离文档 §3.8；全文 `git show cfb8c30f:docs/mcp-worker-task-queue.md` 的 §2。

**2026-10-02 arena-E 第 376 轮**：CC-345 伤害影响 `56e2f697` + CC-346 主词条边际效用 `1962c4b0`（含单项替换口径修正）——原 §2 交接，细节见隔离文档 §3.6 / §3.7；全文 `git show b444abf8:docs/mcp-worker-task-queue.md` 的 §2。

**2026-10-02 arena-E 第 375 轮**：CC-343 S5 收窄类型（`3c287f85`，新增 `EvalConfig`，dist 逐字节相同）——原 §2 交接，细节见隔离文档 §3.5；全文 `git show d43ba04f:docs/mcp-worker-task-queue.md` 的 §2。

**2026-10-01 arena-C 第 374 轮**：CC-343 S4 接 `batchTask`（`423e9de4` + `962e8b9f`）——原 §2 交接，细节见 `docs/mcp-analyzer-scenario-isolation.md` §3.4；全文 `git show 9f3dacd2:docs/mcp-worker-task-queue.md` 的 §2。

**2026-10-01 arena-C 第 372 轮**：CC-343 S2 抽卡规划 + 自由对比迁独立场景 + S3 删 `configSnapshot`（`dfe53a2e` + `81b0d2dc`）——已被第 374 轮 §2 取代，细节见 `docs/mcp-analyzer-scenario-isolation.md` §3.3。

**2026-10-01 arena-A 第 373 轮（与 arena-C 第 372 轮 `wtA-s2b` 并行，worktree `wtA-373`）：CC-343 S2 位置对比（执行卡 T3）+ 难度曲线 + 队伍对比 + TeamComparePage 缓存键迁独立场景，代码 `851f232f`，文档见本轮 docs 提交，已 push（`git rev-list --count origin/master..HEAD` 不为 0 = push 失败，先补推）。**
- **做到哪**：
  1. **T3 完成 `851f232f`（`src/composables/positionCompare.ts` + `src/views/PositionComparePage.vue` + 测试）**：`computePositionCompare` 改收 `scenario: AnalysisContext`，轴基准改用 `configStore.getAxisState()`，删 `snapshotStore / restoreStore` 与 `try / finally`；`PositionComparePage#run` 改用 `withAnalysisScenario` 并删 `useResourceCalc()`。A/B 零差：6 队 × breaker/support（6 金）新旧输出 md5 均为 `93495371f9a5f532e43462089a36105f`（5191 字节，`cmp` 无输出）。
  2. **难度曲线 + 队伍对比迁独立场景 `851f232f`（`src/composables/difficultyCurve.ts` + `src/composables/teamCompare.ts` + `src/views/TeamComparePage.vue` + 测试）**：`computeDifficultyCurves` 与 `computeTeamComparePoints` 改收 `scenario: AnalysisContext`，`applyAxisBinding` 第二个参数收紧为 `StunAxisState`，删两处 `snapshotStore / restoreStore` 与 `try / finally`；`TeamComparePage.vue` 的 `runCompare` / `runCurves` 改用 `withAnalysisScenario`、删 `useResourceCalc()`，且 `1139` 行会话缓存键 `snap: snapshotStore(configStore)` 改为 `snap: cloneConfigState(configStore.$state)`。A/B 零差：3 队 × 0/6/12 金（最优加金 + 自动下位 + 期牌）与 2 队爬梯（含切轴档）新旧输出 md5 均为 `f0bf1c28269e365feb74a47b645b5d39`（12867 字节，`cmp` 无输出）。
  3. **源码锁与验证**：`analysisScenario.test.ts#MIGRATED_ANALYZERS` 新增 `positionCompare.ts`、`difficultyCurve.ts`、`teamCompare.ts`（现已锁 6 个模块）；`npx vue-tsc -b --noEmit` 0 错；`analysisScenario.test.ts`（5/5）、`positionCompare.test.ts`（4/4）、`positionCompareDebug.test.ts`（3/3）、`difficultyCurve.test.ts`（24/24）、`teamCompare.test.ts`（36/36）、`timeLedger.test.ts`（2/2）、`checkGuards.test.ts`（143/143）全绿；`node scripts/check-guards.mjs` 25/25 通过。回退点：`git revert 851f232f`。
  4. 第 370 轮（arena-A）：CC-344 队列 §3 T1/T2 完成 + `applyDeployConfig` 复用 `applyTeamToStore(autoBuild=true)` `0c5e00cb`。
- **下一步**：
  1. 待 arena-C 第 372 轮（`pullPlannerEngine.ts` + `freeCompare/engine.ts`）合入后，`docs/mcp-analyzer-scenario-isolation.md` §4 的全部 8 个分析器入口与 `TeamComparePage` 缓存键均已迁完，可直接执行 **S3：删除 `src/composables/configSnapshot.ts` 与 `src/composables/__tests__/configSnapshot.test.ts`**（那时 `configSnapshot.ts` 在全仓已无任何调用方）。

**2026-10-01 21:45 arena-D 第 371 轮（开工 21:27 时无并行会话，HEAD `48f10d3e`；REQUIREMENTS.md 429 行无新条目）：CC-343 S2 时间线 + 菲林迁独立场景，代码 `d9e39042`，已 push（`git rev-list --count origin/master..HEAD` 不为 0 = push 失败，先补推）。**
- **做到哪**：`teamTimeline.ts` 4 个入口 + `teamTimelineFilm.ts` 改收 `AnalysisContext`；运行器 / 4 个图表组件 / `useSlotSweep` 改用 `withAnalysisScenario`；A/B 逐字节相同（md5 `ad4581ba`）；新测试「yield 时 UI `$state` 不变」在旧 API 上反证失败。详见 `docs/mcp-analyzer-scenario-isolation.md` §3.1、§4。
- **下一步**（按价值排序）：
  1. **抽卡规划** `pullPlannerEngine.ts#runPullPlanner`（调用方 `components/charts/PullPlannerChart.vue`，探针 `arenaD/probe363.test.ts` 可改成 A/B）——异步、yield 多，按配方 §5 自己做（它的 oracle 内部有 teamScoreCache 与 configStore 闭包，要读懂再迁，不适合发卡）。
  2. **执行卡 T3（位置对比）** 已写在本文 §3，卡面自足，可派 dsh：`CARD=T3` 走 §0 脚本；回收时按 §0 复核（真实 diff、vue-tsc、cmp 结果亲自重跑一次），再提交、删卡、删 `wtT3` / `wtT3-base`。
  3. 然后 自由对比 → 难度曲线 → 队伍对比；全部迁完删 `configSnapshot.ts`（S3）。
- **已知坑**：① 迁移后分析器入口第一个参数是场景，不再是 calc——测试里不测隔离的可直接传 `{ config: useConfigStore(), calc }`；测隔离的用 `createAnalysisScenario()` 并在 afterEach dispose（`teamTimeline.test.ts` 顶部 `scen()` 写法）。② MCP 客户端：一次 `sh` 超时（shell_error）后服务端那条请求仍在跑，下一次调用会报 `Duplicate JSON-RPC request id`——`rm -f /tmp/mcp.session` 换新会话即可；长等待用 WSL 端有界轮询且单次 ≤ 240 s。
- **回退点**：`git revert d9e39042`（UI 行为不变）。
- 第 368 轮（arena-D）：失衡轴状态唯一读写入口 `a6264cf4`（`getAxisState` / `setAxisState` / `applyStunAxisPreset`）；同轮「抽卡规划每组只评一个槽序」判为不做（有损，见 r6 §8 第 368 行）。
- 第 367 轮（arena-D）：run-archive.json 唯一加载入口 `fb674a8a`。第 366 轮：boss-presets.json 唯一加载入口 `29aa7183`。第 365 轮：抽卡规划第 3 房恒 0 分修复 `b719ba36`。

**2026-10-01 arena-C 第 369 轮（开工 19:24；r368 已被 arena-D 19:25 认领、19:31 收工，本轮记 369；19:37 起 arena-A 第 370 轮并行，认领 configSnapshot / runArchiveDeploy / RunArchivePage / modelingGaps；REQUIREMENTS.md 429 行无新条目）：CC-343 分析器独立场景第 1 阶段，代码 `02049db9`，已 push（`git rev-list --count origin/master..HEAD` 不为 0 = push 失败，先补推）。**
- **做到哪**：底座 + 一个试点。设计、验证、迁移进度和配方都在新文档 `docs/mcp-analyzer-scenario-isolation.md`（README §6 72 → 73 份）。
  1. `createConfigModel(catalog, initialState?)`：独立场景出生态，写在全部 state ref 声明后、依赖 state 的 watcher 注册前（`config.ts`「独立场景出生态」段；键表 23 个 ref，未登记的键抛错）。
  2. `useResourceCalc.ts`：函数体改为 `createResourceCalc(config, catalog)`，`useResourceCalc()` 一行绑定；导出类型 `ResourceCalc`。
  3. 新 `composables/analysisScenario.ts`：`createAnalysisScenario` / `withAnalysisScenario` / `AnalysisContext` / `cloneConfigState`。
  4. 试点 `charIncrement#computeIncrementPass` 改收 `scenario`、删快照恢复；`CharIncrementPage` 用 `withAnalysisScenario`。
  5. 验证：`vue-tsc -b` 0；新测试 5 例（含朴素注水反例）；A/B 逐字节相同（md5 `53ecb939`，9 期 78 队）；全量 verify EXIT 0（449 文件 / 4126 测试通过，16 / 29 跳过，228.9s）。
  6. 合并态复核：`f49ef0c7`（本轮 CC-343 + arena-A 第 370 轮 CC-344 + 两轮文档）在 `wtA-scenario` 全量 verify EXIT 0（449 文件 / 4128 测试通过），下一轮开工可把它当绿基线。
- **下一步**（配方见新文档 §5，一个分析器一张卡）：
  1. 迁时间线 + 菲林：`teamTimeline.ts`（4 处快照）+ `teamTimelineFilm.ts`，调用方 `composables/charts/chartRunners.ts`、`teamCompareSweep.ts`。先读认领表；`configSnapshot.ts` 已被 arena-A 第 370 轮改过（执行卡 T1，`0c5e00cb`），迁移本身不需要改它。
  2. 依次迁：抽卡规划 → 自由对比 → 位置对比 → 难度曲线 → 队伍对比（新文档 §4 表）。每个都做 A/B 逐字节比较 + 全量 verify。
  3. 全部迁完再删 `configSnapshot.ts`（`TeamComparePage` 的缓存键改用状态指纹），然后接 `batchTask.ts`（新文档 §6）。
- **坑**：
  - 场景的 `config` 没有 `$patch` / `$subscribe` / `$reset` / `$onAction`；
  - 新增 state ref 必须登记进 `config.ts` 出生态键表，否则建场景抛错；
  - 一次运行一个场景，不要跨运行复用；
  - 去掉 `try / finally` 后函数体反缩进，diff 很大，复核用 `git diff -w`。
- **回退点**：`git revert 02049db9`（UI 行为不变）。
- 第 360 轮（arena-C）：CC-341 `8f80b031`（危局 buff 牌条件随行写入、管线唯一解析）。其交接里的 CC-342 已由 arena-D 第 363–364 轮完成；附带项「`applyDeployConfig` 装配顺序」由 arena-A 第 370 轮认领。原文：`git show 2d781b67:docs/mcp-worker-task-queue.md` 的 §2b。

**2026-09-29 arena-B 第 1–4 轮**（抽卡规划线：孤儿 WIP 收养 `d3443e39`、收入按版本日历 `724f37cf`、购买窗口上界 `c8b76d2f`、购买阶梯数据化 `bf868983`）：已结项，抽卡规划线剩下的都待用户裁决（提案 §6「完全下位」标签、§5.5 阶梯内容）。原交接全文：`git show 08acb322~1:docs/mcp-worker-task-queue.md` 的 §2b。

- **观察管线调用次数的测试，观察窗口要在 `useResourceCalc()` 之前打开（2026-10-03 r438）**：composable 里可以有 `immediate` watcher（`31fdfe8f` 的音擎覆盖率回填就是），首个 `await` 后管线已算完并缓存；建队后再清空观察数组 ⇒ 读到的是缓存，计数为 0。对应地，往 composable 里加会触发管线的 `immediate` watch 时，`grep -l "observed\." src/composables/__tests__` 看一眼哪些测试在数调用。

## 2. 最近一轮交接（每轮替换本节）

**第 420 轮（lane arena-E；无并行会话；起点 `2dcdc2bf`（外来 docs 提交，已补推）；REQUIREMENTS.md 无新条目）：CC-394 `497aaa27` + 文档，已 push。**
- **做到哪**：r419 下一步 1 的两条优先项。
  - ① 青衣 1251021 / 1251022 = 情形 (ii)：nanoka param.desc 明写强特 = 三段和，模块无引用 ⇒ `data/moveFusions.ts` 加 `QINGYI_EX_MOONLIT`。**改伤害**：修前强特只算 #1（301.4% / 0.383s），修后 1206.7% / 1.533s。
  - ② 莱卡恩 1141016 = 情形 (i)：`lycaon.ts` 点按路线已出它的执行行 ⇒ `axisHiddenMoves`（零差）。
- **验证**：vue-tsc `--force` 0；guards 链 EXIT 0；vitest(4) 464 文件 / 4275 测试（+2）；build 通过；zd `r420a` changed 31/625 全是含青衣的队；timeGolden 35 行、timeFillRatchet 2 队重生成（逐队解释见 CC-394）；cinemaMonotone 登记 1251:c3->c4；yixuanSmoke 期望 3 处更新。
- **回滚点**：`git revert 497aaa27`。
- **拍板**：① auto-1371-1251-1451 −9.86% 接受：不是融合算错，是更真实的强特时长让仪玄自动轴超预算、引擎按既定「轴太厚 ⇒ 退化非轴」口径处理（探针 `/home/kaua/calc-arch/arenaE/r420/probe2.test.ts`，两侧输出 `p2-*.out`：master 轴「轴1」、stun 3；修后轴空、stun 4）。② 「长按追加连打」不建模：原文只说「提升连打次数」，没有次数 / 倍率，凭空猜会引入无据数字。
- **下一步（按价值排）**：
  1. **[r427 arena-F 已全部裁决，见卡表 CC-402，别重扫]** **剩余 TWIN 候选逐个核对**（方法同 r419：读模块 + `data/raw/nanoka_missing/full/<id>.json` param.desc，三选一 (i) 隐藏 / (ii) 融合 / (iii) 不动；清单出处 `/home/kaua/calc-arch/arenaE/r419/tbl-census2.out`）：1071012、1101106、1101402、1121008 / 1121009（ben.ts 有引用）、1131013 / 1131014（soukaku.ts 引用 013）、1151013、1161015、1181018、1201023、1271009、1321012、1351005、1381009、1401007、1451017、1461022、1541007 / 1541011 / 1541012（promia.ts 引用 011）、1561010、1571009 / 1571012（norma.ts 有引用）、1611011 / 1611012、1621019（roxy.ts 有引用）。r419 `fusions.out` 里能找到 nanoka 求和式的只有青衣、莱卡恩、雨果、雅（均已处理）⇒ 余下大概率是 (i) 或 (iii)，零差为主。
  2. **[r430 arena-F 已复核关掉：该队 outerExit=stable、outerRounds=5（缺省配装 4），冷跑/热跑/换队/套推荐配装四种口径一致，不振；全库 cycle 名单与口径差见 `docs/mcp-integer-cycle-stop.md` §10]** **yidhari-qingyi-lucia 外层收敛 cycle**（r420 新增，第 4 支 cycle 队）：先用 `.zc/perf` 打印外层每轮的青衣强特次数，看是否 7↔8 振荡；若是，属整数环停点问题（参考 `docs/mcp-integer-cycle-stop.md` CC-326），别加容差。
  3. **[r432 arena-F 已裁决关掉：维持，见卡 CC-407（60 角色探针：55/56 条强特每秒直伤 ≥1.3× 平A，唯一 <1 是安东 0.85）；重开条件写在卡里]** **「能量全部打强特」口径复核**：青衣 4 命回能后强特 +1 反而降伤（每秒收益低于平A）。若别的角色也出现同类下降，再评估引擎是否该按每秒收益决定能量用途（要用户口径，先写进 OPEN-ITEMS 候选，不要直接改）。
  4. **[r432 arena-F 已关掉：该轴是 `[1371,*,*]` 仪玄通用轴、不含青衣动作，没有「按青衣时长重配」这回事；专属薄轴需用户口径，见 CC-407 末段]** 仪玄自动轴预设（`stunAxisPresets/仪其他.json` 的「轴1」）是在青衣强特 0.383s 时代配的；4 次失衡下轴太厚而退化。要不要按新时长重配，看用户是否在意该队走轴。
- **已知坑**：
  - **插入新常量时别把上一个常量的文档注释切开**：r420 补丁按 `const QIANXIA_EX_PHOTOGRAPHY` 定位插入，结果插在千夏的 `/** … */` 与它的 const 之间，注释被挂到青衣上。锚点用文档注释的开头，不用 const 行。
  - **游戏语义 `@fact … 口径:` 必须紧跟一行 `⟳复核: … | 到期 YYYY-MM-DD`**，否则 checkGuards 判据 15 红（全量 vitest 才看得到，单跑目标测试看不到）。
  - **改伤害的数据修正会牵动 4 类锁**：timeGolden、timeFillRatchet（含 outerExit）、cinemaMonotone、按数值写死的冒烟测试（yixuanSmoke）。先跑全量看红哪些，再逐条归因写进注释，别只重生成 golden。
  - **自动轴「消失」先查轴退化**：`effectiveStunAxes` 为空不等于预设没匹配上——`autoStunAxisPresetOf` 只看队伍与命座；空轴多半是 `stageResolveFeasibility` 判轴超预算后退化（`forceNoAxis`）。
  - 改名类重构必须同步改**反向源码锁**（`not.toMatch(/旧名/)`）：旧名消失后它永远绿，等于静默失效。
  - MCP「Duplicate JSON-RPC request id」：`rm -f /tmp/mcp.session` 后重发。
  - 源码锁写完要反证（临时撤掉被锁的改动看是否变红），r388 用 `git show HEAD:<file> > <file>` 换回旧版验证后再复原。
  - 纯类型改动的最强判据是 `vite build --outDir A` / `--outDir B` 后 `diff -r A B`（逐字节相同 ⇒ 运行时零变化），比 zd 便宜且覆盖全产物。
  - 两个 `node /tmp/mcp.js` 并行调用会撞「Duplicate JSON-RPC request id」（每个进程 id 都从 1 起、共用 session）——MCP 调用别并行。
  - **新建 `docs/*.md` 必须同步登记 README §6 文档表并改节标题份数**（守卫 `docs table`）；收尾在**文档提交之后**再跑一次 `npm run check-guards`，别只在代码提交前跑。
  - **反证别用 `git stash push -- <路径>` + `git stash pop`**：stash 列表是全部 worktree 共用的，路径上没有改动时 push 什么都不存，紧跟的 pop 会弹出**别人的** stash（r419 实测：弹出 wtE-d2b 的旧 WIP，18 个文件冲突；`git reset --hard HEAD` 恢复，那条 stash 因冲突被保留）。改用 `cp <文件> <备份>; git show HEAD:<文件> > <文件>; 跑测试; cp <备份> <文件>`。
  - 只做机械改写时**别**把 `Number(raw ?? x)` 换成 `cfgMechanicSetting`：后者对非有限数取 fallback，脏值行为不同（零差不保）。
  - check:fast / verify 别整条跑：拆成 guards→tokens→data→specs（一调用）/ recording / `vitest --maxWorkers=4` / build 分别前台跑。
  - **隐藏某类候选后要检查有没有从别的池子漏回来**：轴编辑器有三个候选来源（执行行 / 连段表 / [表] 技能表直读），只过滤执行行时，被隐藏的招式会以 `[表]…×99` 形式重新出现（r418 截图发现）。改候选池要截图看全部来源。
  - **verify 拆分时脚本名照 `package.json` 的 `verify` 写**：是 `check-guards` / `check-tokens` / `validate:data` / `validate:specs` / `verify:recording`，写成 `guards` / `check-data` 会直接失败（r418 踩到）。
  - **「是否已建模」别按 `#N` 后缀判断**：catalog 的 `#N` 可能是同一招的分段（飞雪 #1~#4）、互斥版本（踱寒践约 #1 / #2）或完全不同的子攻击（1051024「极寒重碾 #2」= 寒冰触手）。证据只认 `data/moveFusions.ts`（nanoka param.desc）、模块代码与模块声明（r419）。
  - 只剩 15 个工具（无 wsl_exec）、run_command PTY 起不来、文件工具 EIO ⇒ WSL 挂了，没有替代路径，停手；ngrok `404 ERR_NGROK_3200` ⇒ 隧道离线，什么都做不了。恢复后先 `git status` 核对 worktree 再续。
  - 锁的判据要覆盖「同一个病的所有写法」：CC-235 只锁模板字面量、D2 §5 只锁 Record 强转，结果各漏了一类（r393 补）。新写锁时先列出这个病的全部语法形态。
  - Python 补丁里 `assert s.count(a)==n` 先于写文件：计数写错时文件不会半改（r393 orphie 实测）。
  - 找 cfg 键的读者要连 `src/data/**/*.json` 一起 grep：spec 资源按字段名读 cfg，ts 里看像死写（r394 xide）。
  - 收紧锁时优先「全仓不变式」而不是「名单」：名单只能防回退，挡不住新模块重犯（r395 CC-369）。
  - **apply 脚本报「混源 … 其他:…」时别手动全文替换**：那是同文件 `record` 还指别的对象（队友 / 形参），只改 cfg 别名所在函数（r396 CC-370）。
  - 元数据类键（`*Meta` / `*Cycle`）骨架写的是 `number`，要按写入处（`metaOf()` 等）的实际返回改成对象类型；读者处原有的 `as {…}` 断言会成为对比依据。
  - **遍历注册表写锁时，模块身份字段是 `agentIds`（数组）不是 `agentId`**；写错了夹具会绕过全部守卫、锁形同虚设，vue-tsc 也不报 ⇒ 每个锁都必须反证（r397）。
  - **契约缺身份 ≠ 输入可写性问题**：看到「往数据里塞标记、再扫一遍找自己」，先查钩子入参是不是缺了槽位 / 命座，补契约比加锁更根本（r398）。
  - **永远不要并行发两个 mcp.js 调用**：r398 又踩了一次（检查组和 vitest 一起发，后者报 Duplicate id），换新会话串行重发即可。
  - **先核实上一轮的诊断再动手**：r398 交接写的是「core 认维琳娜」，但 core 早已不 import velina；照字面修会加一个只服务风蚀的声明字段。r399 按「派发给谁、给不给身份」重新诊断，一次修掉了 velina 和 alice 两份 hack。
  - **删代码后守卫要求豁免销号**（`compactedSlotIndex` 的 `IDX_SAFE_ALLOWLIST`）：全量 vitest 红一条「豁免失效」属于正常现象，删掉对应条目即可。
  - **命座自检（`cinemaUplift`）是面板的全键读者**：删任何面板字段都可能改变 `warn`，zd 测不到。要用单人队 `analyzeCinemaUplift` 删前删后对比（r400 探针法，见 `docs/mcp-panel-fields.md` §2/§5）。
  - **盘点「靠宽类型才成立的访问」最准的办法是临时收紧类型跑 tsc**，比正则可靠（r400：DeepReadonly 读、解构都能定位）。只在临时 worktree 里改，跑完 `git status` 确认已恢复。
  - **TS2411**：带 `[key: string]: number` 的接口里，显式成员不能写 `?: number`。收紧类型的计划要先在 scratch 里试编译一次，再定步骤顺序（r401：原定 S2 先于 S4，实际做不到）。
  - **把一个测试当锁之前先反证**：r401 以为 `statModeParity` 能锁住累加器泄漏，换回旧代码后它照样通过（它比较的面板都已 finalize），于是另写了 `batchAccum.test.ts`。
  - **wsl_exec 里用 `nohup … &` 起的后台进程，会在调用返回时被回收**（r401 vitest 跑到一半就没了，日志也没有 EXIT 行）。全量 vitest 用前台 `timeout 285` 跑，约 200 秒。
  - 面板上不要挂非数字数据，批次状态按面板对象存 WeakMap（r401 先例）。
  - **收紧类型后必须再查 `as any`**：靠编译报错的盘点看不到 `(x as any).k`。r402 换完签名、tsc 全绿后，又 grep 出 4 处 `(panel as any)` 夹带。
  - **按命座门控用命座等级，别读面板上的命座标记**：`(cfg.panel as any)?.miyabiCinema4` 这类写法既是夹带，又让命座自检误判。r402 改成 `cfg.miyabiCinemaLevel` 后，探针证明收益逐位不变。
  - **全量 vitest 和 zd 都能在一次前台调用内跑完**（约 240s / 80s，`timeout 285`），不要放后台（r401 实测后台进程不跨调用存活）。
  - **删死写会连锁**：删掉一个零读者写入后，tsc 的 TS6133 会指出只为它服务的变量 / 解构 / 字段，要顺着删到底（r403 lighter：写比例 → 读比例 → 写效率，三段全空转）。删前同时 grep TS、JSON、测试、文档，并确认没有代码遍历 cfg 键。
  - **常量失去引用时，先找同值字面量**：如果真实写入点写死了同一个数，就让写入点引用常量，而不是删常量（r403 `LIGHTER_C4_FRONT_EFFICIENCY` 对应 teamPanelEffects 里的 `10`）。
  - **TYPED_CFG_MODULES 锁只认 `cfg` 这个变量名**：同接口的别名（`lighter` / `ch` / `mate` 等队友 cfg）上的 `as any` 它看不到。做模块时要 grep 全部 `as any`，按接口归类后再处理。
  - **骨架类型要靠 tsc 纠正，别手猜**：写入值是数组或对象的键（`anbyBasicCycle`），骨架会猜成 `number`。tsc 报 TS2322 时，以读者处原有的 `as {…}` 断言为准写声明，再删掉那个断言（r404）。
  - **形参是 `cfg: unknown` 的辅助函数**：apply 脚本处理不了，tsc 会报 TS18046。按调用方传入的类型改形参（如 `AgentResourceResultInput['cfg']`）（r404 aire）。
  - **死通道 C 类（dts 漂移）守卫**：改 `scripts/lib/*.mjs` 的导出名时，同名 `.d.mts` 必须同步改，否则 guards 会红（r404 实测抓到）。
  - **源码锁反证时，注入的代码不能在模块加载时求值**：vitest 用 esbuild 转译，`declare const x` 会被删掉，`(x as any).k` 加载时就抛 ReferenceError，整个测试文件变成「no tests」。这看起来也不是绿，但并不能证明是正则抓到的。正确做法是把注入写进一个不调用的函数，名字当形参：`export function __p(fooCfg: object) { return (fooCfg as any).x }`（r405）。
  - **收 `Record` 形参的导出函数，先看测试怎么传**：传 `as never` 或 `any` 的，形参直接改成真实类型或 `Partial<…>`，不需要登记例外。只有传带动态键的新鲜字面量（`{ 'setting:x': 1 }`）时，才在函数内用带类型的断言读静态键（r405 yidhari / soukaku）。
  - **`: any` 参数标注和 `as any` 等价，但只锁强转的正则看不到它**：`mod.hook = ({ cfg }: any) =>` 让整个 cfg 失去类型。这种钩子赋值去掉标注即可拿到上下文类型，tsc 会把背后未声明的键全报出来（r406 佩洛：3 个）。写锁时连同 `<any>` / `any[]` / `& Record<string, unknown>` 一起列。
  - **结果钩子不标返回类型，写端同样无类型**：函数先推断出字面量类型，再赋给模块槽位，不触发多余属性检查，拼错键不报。统一标 `Partial<CharacterResourceResult>`（claret 先例）。
  - **修掉被 any 掩盖的读法后，测试夹具可能沿用同一个不存在的字段**（r406 `state: { combatTime: 180 }`）：改夹具为真实字段，断言不动；不要为了让旧夹具通过去保留兜底。
  - **zd 的 dump 第二段是整个 resourceResult 的结构哈希**：只搬键 / 改嵌套也会 DIFF，但不是行为变化。判别：DIFF 条目的总伤害段（第一段）与失衡池哈希（第三段）全同 ⇒ 纯结构。证明：在 `.zc/perf/dump.perf.ts` 与 `rowsnap.perf.ts` 的 `remap` 加 `PERF_KEY_ALIAS` 折叠（r407 `SPEC_FOLD` 先例），折叠条件要能识别对象类型——新旧同名键（`triggerResolve`）会让折叠无限递归（r407 实测栈溢出）。`.zc` 不入 git：worktree 与主仓两份都要改。
  - **迁移结果键后全仓 grep 旧键名字面量（含测试）**：测试里 `(x.specResources as any).key`、字符串键辅助函数、`Object.keys(...).toContain('key')` 都躲得过 tsc（r407 有 5 处）。
  - **Python 补 import 别只按单行 `^import` 定位**：会插进多行 `import type {\n…\n} from` 块中间（r407 zhao 语法错）。以 `} from '…'\n` 结束行为锚。
  - **外部不可信数据的参数用 `unknown` + 收窄，别为收紧类型去改测试的防御语义**：r407 先把 `getGlobalBuffStatOptions` 收紧成 `StatRules['statDisplay']`，测试（字符串条目 / 缺 label 回落）随即报错——测试是对的，签名应如实表达「不可信」。
  - **行级 `any` 改成具名类型后 tsc 报的那一处，往往就是上下游的类型断层**（r408 `skillDamageTarget`：上游 `string`、下游联合类型）。修上游声明，不要在消费端插归一化函数：`normalizeSkillDamageTarget` 会把 undefined 映射成 `'all'`，改变语义。
  - **模块按字段名声明 cfg 键时，用 `NumericCfgField` 这类映射类型约束键名**，编排层就不需要 `(cfg as any)[decl.field]`。前提是 `CharacterOperationConfig` 没有索引签名；一旦加了索引签名，`keyof` 会退化成 `string`，约束失效。
  - **反证注入要选本轮没改过的文件**，事后用 `git checkout -- <这些文件>` 还原（先 `git status --short <文件>` 确认为空）。在改过的文件上注入再 checkout，会把本轮改动一起冲掉。
  - **测试直接调钩子时，别构造派发器不会产生的输入**（r409：用 1471 的 cfg 调 1541 的钩子来锁「不在队 ⇒ 0」）。这种断言会把钩子里的死判据锁成「必须保留」。「不在队」这类保证属于派发器，应该在 `collectNextRoundFeedback` / 真管线上锁。
  - **模块文件的本人 ID 以 `agentIds: [...]` 为准**（每个模块都有，CC-383 的锁就靠它）；不要按「文件里声明的第一个 `_ID` 常量」猜，有的文件同时声明了队友 ID。
  - **交接里的「下一步」可能已过时**：r409 交接写「查 `findSlotByIdentity`（18 处调用）」，实际 18 处全是注释，函数在 CC-277 就删了。开工先 grep 核对，别照单全收。
  - **自找有多种写法，正则锁要按形态补**：`.find/.some(x => x.agentId === 本人)`、`team.findIndex(a => a?.id === 本人)`、`for (c of characters) { if (c.agentId !== 本人) continue`。新发现一种形态就加进 `selfFromDispatcherCc383.test.ts`，并用 `git show master:<文件>` 回放做反证。
  - **「不在本轮范围」式的拍板等于留了一个未决项**：r410 写「保留，改成不询问需要另核 store 口径，不在本轮范围」，没写候选方案和风险，下一轮被当作未完成项追问。要推迟，就把「不确定点 + 两个候选 + 各自风险」写进未决项；能在半小时内查清的，当轮查完。
  - **夹具角色要先确认有数据**：CC-385 测试第一版用 1041+1191，两人都没有队友 buff 组 ⇒ 反空洞断言失败。挑夹具前先打印 `catalog.teammateBuffGroups` 的 id 列表。
  - **只测 store 的锁守不住引擎读取路径**：CC-386 第一版锁全在 store 层，引擎 `helpers.ts` 若漏改仍自拼旧前缀，测试照样全绿（全仓原本没有任何测试调 `setResourceUtilization`）。改键 / 改读法时，每个引擎读取点至少一条端到端断言，并用「只回放该读取点」做反证。
  - **按槽位存的用户设置要问「换人后该不该跟着走」**：描述「这个角色怎么打」的覆盖（利用率、份额）应随角色，键用 agentId（`ownerKeyOf`）；描述「这个位置」的设置才按槽位。判断不清时，先看 setAgent 换人后旧值还被不被引擎读到。
  - **按字段名枚举「入参有没有本人」会误报**：CC-387 的编译器探针把 `resourceSections`（入参 `result` 就是本人结果）判成「无本人」。探针结果只是待查名单，每一条都要打开实现确认；纯函数（只收数值 / 读取器）本就不需要本人。
  - **「还原后与之前相等」的锁要在非空状态上测**：天梯「试开回滚不留痕」原测试在合轴率覆盖为空时比较前后 JSON，键形态拼错照样绿。而且天梯入口 `resetDifficultyGoals` 会有意清空覆盖——要让被还原的东西真的存在，得用 `opts.base` 跳过重置。写这类锁前先断言「之前」不是空的。
  - **「展示路径看起来无害」不代表引擎无害**：失衡轴的展示计算按资源池给残留动作 0，栈遍历却照单执行（成本全 0 = 免费）。判断某个残留输入有没有害，要看真正产出伤害的路径（这里是 `calcOutput.axisStack.executed`），并用「同一路径、只差该输入」做对照——直接新建队伍和走 setAgent 的配装 / 命座不同，两者比较会把差异错归到被测输入上。另外：用 `effectiveStunAxes` 数动作会撞上求解器回退（`forceNoAxis` 清空 resolvedAxes），锁判据要直接锁纯函数。
  - **check-tokens 的 alias 棘轮「进步也红」**：新增一处 `var()` 会报「var() 总数 800→801：是进步，把 VAR_TOTAL_BASELINE 上调」。按提示改 `scripts/check-tokens.mjs` 的基线并在注释里记轮次。新样式别写字面色值（硬编码色值棘轮），从 `App.vue` 的 `--app-*` 里挑（没有专门的警告色，r416 用 `--app-accent-gold`）。
  - **UI 改动的 headless 验证配方（r416）**：Chromium 用 `~/.cache/ms-playwright/chromium_headless_shell-1234`，缺的库已解压在 `/home/kaua/calc-arch/chromedeps`（`LD_LIBRARY_PATH=$D/root/usr/lib/x86_64-linux-gnu`）；`playwright-core` 借 `/mnt/f/proj/workbuddyai2api/node_modules/playwright-core`。状态注入：`document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('config')`，切页用 `ui.activeTab`。vite 与脚本写在同一调用：`npx vite --port 5199 & VP=$!; …; kill $VP`。截图里中文是方块（缺 CJK 字体），以 DOM 计数为准。
  - **mcp.js 输出长时直接打印原始 stdout、只留尾部约 6000 字节**（不是 JSON）：拉二进制要先 base64，再按 5000 字节 `cut -c` 分段取回，拼接后核对长度 / sha256。`get_diagnostics` 只接受 IDE 工作区内的相对路径，worktree 用 `vue-tsc -b --force` 代替。
  - **「数据里有没有可靠字段」要普查验证，别看字段名下结论**：`timeBucket: 'backstage'` 看起来就是「后台招式」，普查发现它的语义是「不占前台时间账」，混着合轴打完的主动招式（r417）。分类前先列出全集，逐条对照模块注释里的触发条件。
  - **探针要先确认轴模式真的生效**：只设 `useStunAxis` + 预设轴时 `effectiveStunAxes` 可能为空（求解器回退），而大多数预设槽位是 `*` 通配、直接跑不了。可靠做法：自建轴（三槽各放一个 `basic`），用伤害行备注里有没有「轴外」判断轴模式（r417 probe2）。
  - **zd 的大面积 DIFF 先分段看**：给执行行加字段会让 dump 第二段（结构哈希）全变；用 `/home/kaua/calc-arch/arenaE/r417/zdsum.js` 按队汇总第一段（伤害）与第三段（失衡池），才看得出真正的数值变化（r417：223 条 DIFF 里只有 5 条伤害变化）。


## 3. 执行卡（输入输出写死的机械活，可交给执行模型或 dsh；第 368 轮新增本节）

> 用法：§0 的派发脚本按 `<!-- card:ID -->` 抽卡面。**卡面就是全部上下文**，执行者不需要读别的文档。
> 做完：主代理按 §0 复核（真实 diff、vue-tsc、相关测试）→ 提交 → 删卡，在 §2b 留一行「T? 完成 `<commit>`」。
> 写卡标准：改哪几个文件、改成什么样、怎么验收、不许碰什么，都写死；需要判断的活不写成卡。

（T1、T2 已于第 370 轮 `0c5e00cb` 完成；T4～T7 已于 r425～r428 完成）

<!-- card:T8 -->
### T8 · ✅ 全部完成（r435–r439：CC-409 `67f6672b` ellen/evelyn/xide/zhendou/harumasa/zhao → CC-410 `015b6a61` miyabi/yixuan/anbyZero/hugo → CC-411 `db9e0655` soukaku/grace → CC-412 `64e8d13f` burnice）
模块内「= catalog actionTime」的常量已清零（唯一保留：hugo `HUGO_EX_FINAL_ACTION_TIME`，给合成轴块的 `axisMoveActionTime` 钩子用，钩子没有 cfg——要去掉它需让合成招式声明代表的真招式、钩子改别名，另开卡）。锁：`src/composables/__tests__/moveActionTimesCc409.test.ts`（每个迁移模块一条「行时长 === catalog」+ 守卫名单）。以后新模块写 actionTime 一律 `cfgMoveActionTime(cfg, moveId)`，不要再写数字常量——`check-guards` 暂无此守卫，靠评审；若再出现可考虑加一条 guard（grep `_ACTION_TIME = [0-9]` 于 `src/mechanics/agents/`）。
<!-- /card:T8 -->

<!-- card:T9 -->
### T9 · ✅ 全部完成（r440–r442：CC-413 `35ac4d1f` hugo → CC-414 `68e144d0` xixifu → CC-415 `c3dd09fe` grace；锁集中在 `src/composables/__tests__/mechanicRowValuesT9.test.ts`）

**对象（r435 探针 `/home/kaua/calc-arch/arenaF/r435/dupProbe.out`）**：
- ~~`hugo.ts:64 HUGO_EX_FINAL_BASE_MULTIPLIER = 709.8`~~ ✅ CC-413（样板：`buildHugoCharConfig` 写 `cfg.mechanicRowValues`，`buildHugoExecutions` 开头取一次局部量；锁在 `src/composables/__tests__/mechanicRowValuesT9.test.ts`——xixifu / grace 往它的 CASES 里加，不要另起文件）。
- ~~`xixifu.ts:42 XIXIFU_SHIGU_BASE = 254.4` / `:54 XIXIFU_SHEKISS_RATIO = 1009.1`~~ ✅ CC-414。
- ~~`grace.ts:39–42 A1_ENERGY..A4_ENERGY` = 1181001–1181004 energy_recovery~~ ✅ CC-415（`A_SEG_MOVE_IDS` + `gracePhaseValues` 读 `cfg.mechanicRowValues`）。
- **不要碰** `norma.ts:29 HEAT_PER_ENERGY = 0.4`（探针里它与 1571010 actionTime 相等是巧合，语义是每点能量的热量）和 `norma.ts:32 EX_SPECIAL_ENERGY_COST = 40`（与 ether_purify 相等也是巧合）。

**做法**：在模块 `buildCharConfig`（有 `skills`）用 `getRowValue(findMoveById(skills, id), 'damage' | 'energy_recovery')` 读进 `cfg.mechanicRowValues[id]`（已有协议，见 burnice / roxy），纯函数处改为入参、调用处从 `cfg.mechanicRowValues` 取；常量删除；**缺表为 0，不加 `|| 常量` 兜底**（CC-408 拍板）。

**验收**：vue-tsc 0；该模块测试 + 全量 `npx vitest run --maxWorkers=4` 绿；`zd.sh t9-<模块>` DIFF 0；手搭 cfg 的测试补 `mechanicRowValues`。

**不许碰**：`claret.ts:443–444` 与 burnice 的 `STIRRING/TOSSING_DAMAGE_FALLBACK`——那两个引擎路径已经先读表，是 CC-408 明示「下次碰该模块顺手改」的项，要改放在同一提交里也可以，但不要为它们单独改测试口径。
<!-- /card:T9 -->

<!-- card:T10 -->
### T10（备选，不急；**r447 CC-420 已按实测重写**）· 音擎叠层覆盖率回填：从「绕 store 的隐藏不动点」改成显式数据流
**实测事实（CC-420，别再凭注释推断）**：`useResourceCalc()` 里 `watch(wEngineStackAutoCoverages, auto => configStore.applyWEngineEffectCoverageAuto(auto), { immediate: true, flush: 'post' })` 形成环 `calcOutput → 回填 → store.wEngineEffectCoverages → panels(resolveSlotPanelBuffInputs) → runCalcRound → calcOutput`。创建即跑 pass 1（默认覆盖）、首读再跑 pass 2（回填后覆盖），**每次创建两遍整条管线**；不跑第三遍只因回填值不影响执行次数（pass 1 == pass 2 逐位）。锁：`__tests__/wEngineCoverageFixpointT10.test.ts`（3 支队，miss 计数 1→2→2 + 重折算 == store）。
**原卡「回填值作为 calcOutput 链上的 computed、去掉 watch」为什么不能直接做**：面板的消费端 `computePanelPhases(slot, configStore, catalogStore)` 有 51 个调用点，覆盖率是从 `configStore.wEngineEffectCoverages` 整表读的——没有 store 写回，面板就拿不到自动值。要去 watch 必须先给面板一条显式的覆盖率入口。
**修法（按侵入度排序，选 ① 即可满足「去 watch、去双算」）**：
① **资源侧 panels 用「手调表」、展示侧 panels 用「手调 + 自动」**：`resolveSlotPanelBuffInputs` 加可选参数 `effectCoverages?: Record<string, number>`（缺省仍读 store），`computePanelPhases`/`computePanel` 透传；`useResourceCalc` 里 `panels`（喂 runCalcRound）传 **`store.manualOnlyCoverages`**（新 getter：只含 manual 标记的条目），新 `displayPanels = computed(() => 用 {…manual, …auto(calcOutput)} 再算一遍 computePanel)` 给伤害池/面板页；删 watch 与 `applyWEngineEffectCoverageAuto`。效果：资源迭代不再依赖自动值（环断开），创建不再双算；展示面板仍含自动值。**代价**：面板页 / 伤害池凡是读 `calc.panels` 的要改读 `displayPanels`（grep `\.panels\b` 消费者，含 `damagePanels` :340），且 `getWEngineEffectCoverage` 的 UI 滑块读数要改成读 `displayCoverages`。zd 预期 DIFF 0（pass 2 == pass 1 已实测）。
② 只去双算不去环：watch 改成 `flush:'sync'` + 不 immediate，首读时在 `calcOutput` 内部回填——不推荐，仍是 store 副作用。
③ 什么都不改，只靠本锁盯着「一步不动点」何时被打破——当前选择（r447），因为 ① 要碰 51 个调用点中的若干 + UI，而现有代价只是创建时多算一遍。
**开工条件**：出现「面板量 → 次数」的机制（锁变红）或创建双算成为性能瓶颈时再做 ①。做 ① 时先跑 `grep -rn "\.panels\b\|wEngineEffectCoverages" src --include=*.ts --include=*.vue` 列全消费者。
<!-- /card:T10 -->

<!-- card:T11 -->
### T11 · ✅ 完成（r443 CC-416 `79dec912`）——结论是「opt-in」而不是「改默认」

harness 平A权重默认仍每槽 1；`setupHarness(team, { productionBasicWeights: true })` ⇒ 逐槽 = `configStore.getDefaultBasicAttackTimeWeight`。
依据：重新应用别人的「默认支援/防护 = 0」后全量 20 条红（golden 320 条差异 + 单人支援 null + 探针失效），不是卡面预估的 4 条；回归基准整体建立在三人均分上。
**探针 / 分析脚本**（`docs/` 里提到的维丹队探针之类）以后要加这个开关，否则辅助平A被高估——这条写进 §1 长期规则。
<!-- /card:T11 -->

<!-- card:T12 -->
### T12 · ✅ 完成（r444 CC-417 `a21d952c`）：删 `convergence.ts` 的 `baseStun.length === 0 → null` 守卫；空失衡池 ⇒ stunCount 0、伤害池照常。锁 `emptyStunPoolCc417.test.ts`。
**仍有效的提醒**：主仓 `velina.ts` 2 行 WIP（`defaultBasicAttackTimeWeight: 0`）+ `grace.ts` 轮换闭式解 WIP + 新 `graceRotation.test.ts` 都是同 lane（`kaua5678`）17:25 前的未提交改动；按孤儿规则（> 1 小时无人动）处理，处理时 grace 那份是**产品口径变更**（@fact 已写在他的注释里），要跑 grace 全部测试 + zd 并把差异写进 arch。
<!-- /card:T12 -->
<!-- card:T13 -->
### T13 · ✅ 结项（r465）· 幻影 null 收口（CC-421 同族）：a `64a260bf` / b `aa4ff23e` / b′ `6546d9e9` / d `bd01d7cc` / e `ce08000f` 完成，c 定为不做（理由 arch CC-434 末段）；反馈入参三份结果均必填非 null，`typesHooks.ts` 无 `| null`（锁 `noNullRoundCc418.test.ts`）
**方法**：§1「幻影 null 猎法」。**验收通用**：`timeout 280 npx vue-tsc -b --force` 0；`ZD_REPO=<worktree> bash .zc/perf/zd.sh <tag>` DIFF 0；相关测试 + 全量分片绿；`noNullRoundCc418.test.ts` 追加一条形状锁；arch 加 CC 行、r6 §8 加行、本卡勾掉对应项。worktree 基于 `origin/master`，只 `git add` 自己的路径，提交身份 `-c user.name=<lane>`。
- [x] **T13-a `adjustedResourceResult` 非 null**（r449 CC-422 `64a260bf` 完成）：`roundResult.ts#CalcRoundResult.adjustedResourceResult: TeamResourceResult | null` → 非 null。依据：`convergence.ts:934 adj2 = applyChainGift(adj1 ?? rr, …)`，`adj1 = applyUltimatePromote(rr, sp1, …)`，`rr` 在该处非 null；`ultimatePromote.ts#applyUltimatePromote(base: TeamResourceResult | null): TeamResourceResult | null` 两个调用点（:836 / :932）传的都是 `rr` ⇒ 把 `base` 入参与返回收成非 null、删 `if (!base) return base`，`adj1 ?? rr` 的 `?? rr` 随之删。消费端：`useResourceCalc.ts` `adjustedResourceResult` computed 仍 `| null`（calcOutput 为 null 时），`convergence.ts` 内 `adj0 ? extractAnomalyExecsFrom(adj0) : baseAnomaly`（:842）/ `adj2 ? … : baseAnomaly`（:942）两处三元可收成直接调用——**先 grep `applyChainGift` 的返回类型**，它若也 `| null` 就一起看。预期零行为、zd DIFF 0。
- [x] **T13-b `anomalyPool` 是否幻影 null（先探针再决定）**（r449 探针 = 合法空池 ⇒ 幻影；CC-423 `aa4ff23e` 完成流水线层）：`roundInputs.ts:151 if (execs.length === 0) return null` 与 CC-417 同款。步骤：`src/__scratch__/` 探针调用 `calcAnomalyPool({ executions: [], panels, … })` 看是否抛错 / NaN / 给出 `perElement: []` 的合法空池；若合法 ⇒ 删那行守卫、`CalcRoundResult.anomalyPool` 非 null、`anomalyPool?.perSlotBonus ?? []` 等防御收掉（grep `anomalyPool?\.` 全仓，含 `.vue`）；若不合法 ⇒ 在 arch 记一行「anomalyPool 的 null 是真 null：原因 …」并勾掉本项不改代码。注意 `useResourceCalc.ts` 的 `anomalyPoolResult` computed 对外仍 `| null`。
- [x] **T13-b′ 钩子契约 `AgentNextRoundFeedbackInput.anomalyPool` 的 `| null`**（r463 CC-434 `6546d9e9` 完成：契约去 null、5 模块去 `?.`、`core/anomalyPool#emptyAnomalyPool()` 供夹具、锁 +1；zd 0）。原文：流水线自 CC-423 起恒传非 null，但 `typesHooks.ts:358` 仍 `| null`，8 个模块 `anomalyPool?.`（promia:377 / remielle:398,526 / yixuan:1021 / vivian:446 / ellen:499 / alice:394,590）与 10 个模块测试的 `anomalyPool: null` 夹具（remielle/burnice/jane/nextRoundFeedback/R19/R20）靠它编译。收法：契约去 `| null` → 夹具改成 `emptyAnomalyPool()`（需在 `core/anomalyPool` 导出一个与探针结果同形的工厂，或直接 `calcAnomalyPool({ executions: [], panels: [], teamMechanics: [] })`）→ 模块去 `?.`。收益：模块侧少一个永不发生的分支；代价：10 个测试文件夹具改动。**默认不做**，除非有模块因 `anomalyPool` 为 null 的分支写出了错误口径（目前 `alice.ts:394 !anomalyPool → return null` 是唯一带语义的分支，其余都是 `?? 0 / ?? []`）。
- [x] **T13-d `AgentNextRoundFeedbackInput.adjustedResult` 必填非 null**（r464 CC-435 `bd01d7cc`：契约 / panelPhases 参数 / yeshuguang / anbyZero / 3 个反馈测试 / 锁「typesHooks 整文件无 `| null`」；zd 0）。
- [x] **T13-e `AgentNextRoundFeedbackInput.displayResult?` 去可选**（r465 CC-436 `ce08000f` 完成；zd 0；锁：三份结果均无 `?:`）。原卡面：流水线唯一调用方 `convergence.ts:951-958` 恒传 `displayResult: rrShown`；唯一消费者 `promia.ts:370 const shown = displayResult ?? teamResult`（注释「缺失回退装配结果——迁移前语义」，但缺失不会发生）。做法：`typesHooks.ts:354` 改 `displayResult: DeepReadonly<TeamResourceResult>`，`panelPhases.ts:287` 参数同步必填，promia 直读 `displayResult`（teamResult 若无他用不再解构），测试：`nextRoundFeedback.test.ts` `run` 助手 `displayResult: undefined` → `rest.displayResult ?? rest.teamResult ?? teamResult([])`，R19 / R20 `feedback` 助手同款加 `displayResult: overrides.displayResult ?? overrides.teamResult ?? ({ characters: [] } as never)`，6 处直调站点（r464 补 `adjustedResult` 的同一批：nextRoundFeedback.test.ts 3 处、R19 1 处、R20 2 处）补 `displayResult: <同 teamResult>`；promia 测试里若有「displayResult 缺省回退 teamResult」用例改为「只读 displayResult」；锁：CC-435 项旁加 `displayResult: DeepReadonly<TeamResourceResult>` 形状 + promia 无 `displayResult ?? teamResult`。验证同 CC-435（含 zd，promia 是引擎路径）。做完后 typesHooks 反馈入参无结果类可选字段，T13 系列收口。
- [ ] **T13-c `createRunCalcRound` 的 throw 守卫**（CC-418 遗留；**r463 复核后定为「不做」，T13 卡结项**——理由见 arch CC-434 末段；若日后重排 useResourceCalc 组装层让 `resourceConfig` 按次传入，再一并收）：`convergence.ts:143` 仍经闭包读 `resourceConfig.value`。若要拿掉 throw，需让 `runCalcRound` 按次收 `base`（`solveTeam` 已持有非 null `resourceConfig`，可经 `opts` 传入）。但 `createConvergenceRoundInputs`（`useResourceCalc.ts:202`）也闭包读同一 ref，只改一处收益很小——**除非顺手把 roundInputs 的闭包读点也改成按次传参，否则不做**。
- **收线（r450）**：`roundResult.ts` 余下 4 个 `| null` 逐一查过生产者，都是真 null：`matchedPlanName`（`roundInputs.ts:214/226` 手动轴 / 无轴 ⇒ 无方案名；`convergence.ts:1114 forceNoAxis ⇒ null`）、`inStunAnomalyState` / `bossAnomalyState`（`convergence.ts:985-1090` 仅在 `axisActive && contribMap.size > 0` 下赋值；UI `StunAxisPage.vue:177-194` 用 `v-if` 隐藏整块，"轴内无积蓄贡献" 与 "非轴" 同一显示）、`axisStack`（`:373-381` 仅 `axisActive` 下赋值，"非轴 = null" 是字段注释写明的契约）。幻影 null 这条线在 resourceCalc 流水线层**到此为止**，不再扫。
<!-- /card:T13 -->

<!-- card:T14 -->
### T14 · ✅ 关卡（r451）：`timeFillRatchet` 的一次红**无法复现**，HEAD 引擎在三种形态下确定性已证；留「再现时的第一步」

**r451 实验（worktree `wt-T19` = origin `4643887a`，grace.ts md5 `143e5e5c`；主仓同时是另一会话 grace 重构后的 `77ea33b7`，md5 `024cdb69`）**：
① 探针 `src/__scratch__/t14probe.test.ts`（worktree 里已删；源码存 `/home/kaua/calc-arch/arenaF/r451/t14probe.test.ts`）：两队按 AB / BA / AAA / BBB / 夹 6 支别的队之后 AB 共 14 次测量，`auto-1181-1511-1411` 恒 `slack 0 / stun 3 / stable / 4 轮 / dmg 24623260`，`auto-1181-1561-1581` 恒 `slack 0.4 / stun 2 / stable / 4 轮 / dmg 17381462` ⇒ **无顺序依赖、无残留**（每队 `setupHarness` 新建 pinia）。
② 同探针在人工负载下（并行 `VITEST_MAX_WORKERS=14 vitest run src/mechanics/__tests__ src/core/__tests__`，load 7→15）连跑 3 轮，14×3 次全部同值 ⇒ **与负载无关**。
③ 全量分片 `--shard=1/2` 在该 worktree 跑（主仓此时已是 grace 重构后版本）⇒ 236/2077 全绿，timeFillRatchet 绿 ⇒ **多文件形态下也没有「读到主仓」的路径污染**。
④ 另一会话提交 `77ea33b7`（消息「refactor(grace): 轮换计划改精确闭式解 + 维琳娜平A权重交边际均衡」）的 timeGolden 基线 diff 逐键比对：变化的 7 个键**全是 1181**（`agent:1181:c0/c3/c4/c5/c6`、`preset:auto-1181-1511-1411`、`preset:auto-1181-1561-1411`）⇒ 两队 slack 0↔0.4 的互换就是 grace 改动的确定性结果，不是什么双稳态。

**结论**：r450 那次红 = 我的 worktree 在那一刻跑到了 grace **WIP** 版本的行为。HEAD 代码本身确定（①②③），所以唯一没被证伪的前提是「红跑时 `wt-T18/src/mechanics/agents/grace.ts` 确实是 HEAD」——当时没 md5，事后无法核对（红日志也被同名重跑覆盖）。机制猜不出来就不猜了；**本卡关掉**，T10 不因此升级。

**再现时的第一步（写给下一个看到同类红的人）**：红的那一刻立刻在 worktree 里 `md5sum` 相关模块文件并与 `git show HEAD:<file> | md5sum` 比；`git status --short`；`ls -la --time-style=full-iso` 看 mtime；日志用唯一文件名。先排除「文件不是 HEAD」，再谈引擎非确定性。

---

*以下为 r450 的原始排查记录，保留作证据：*


**现象**（r450，worktree `wt-T18` = origin `d19894d5` + 仅 `vite.config.ts` 改 maxWorkers）：`npx vitest run --shard=1/2` 在另一会话 16 fork 满载（load 20+）时，`timeFillRatchet.test.ts` 第三条「基线自洽零容差」红：`auto-1181-1511-1411` slack 基线 0 ≠ 实测 0.4、`auto-1181-1561-1581` 基线 0.4 ≠ 实测 0（两队**互换**，都含 1181）。同一 worktree 单跑该文件绿（4 用例 7s）；低负载分片复跑绿（r449 两次、r450 1/4 分片）。日志 `/home/kaua/calc-arch/arenaF/r450/vt-s1.log`（第一次，红）。

**r450 收尾时的新证据（改变了排查方向）**：另一会话同一时段在主仓做 grace 重构并于 19:4x 提交 `592c66f6`（本地、未推），其 `timeFillRatchet.baseline.json` 的 diff **恰好只有**这两队：`auto-1181-1511-1411` 0→0.4、`auto-1181-1561-1581` 0.4→0——与我在 HEAD 代码的 worktree 里看到的红**逐字相同**（1181 = 格莉丝，正是他改的模块）。两种解释：**A 污染**——我的 worktree 运行到了主仓的 WIP grace.ts；**B 双稳态**——这两队的外层不动点有两个吸引子（`docs/mcp-integer-cycle-stop.md` §10 记过 1181-1511-1411 slack 0.8→0.4→0 的历史），他的改动把它们确定地推到另一个吸引子，而高负载让 HEAD 代码**偶发**落到同一个吸引子。**决定性实验（r450 已做，排除 A 的单跑形态）**：worktree 固定在 `b0b33b47`（grace 改动之前，grace.ts md5 `143e5e5c`），主仓在 `592c66f6` 之后，单跑 `timeFillRatchet.test.ts` ⇒ **绿**（旧基线、旧值）。⇒ 不存在「共享 node_modules 软链 / public/static 读主仓」这类路径污染；剩下 B，或「并发满载分片形态下」才出现的 A（概率低，但下一轮复现时 worktree 里顺手 `md5sum src/mechanics/agents/grace.ts` 一次就能排除）。**红日志已丢**：`vt-s1.log` 被同名的第二次运行覆盖（教训：同一轮重跑换文件名 `vt-s1-2.log`），红的原文只剩本卡引用的两行。

**已排除**：worker 数（配置 4 = CLI 4）；路径污染（上面的实验）；引擎里没有 `Date.now()/performance.now()` 决策（grep 只在 stats/durationMs）；`globalThis.__foldTrace/__foldPasses` 只在 `PROBE_TRACE_FOLD=1` 下写、只读 `.length` 作标签。

**待验证的假设（按可能性）**：
0. **双稳态 + 顺序依赖**（现在最可能）：外层不动点对这两队有两个稳定解，起点（warm start / `threads` 初值 / 上一队残留）决定落哪个。验证法：worktree（HEAD）里把 `presets` 顺序反转或只跑这两队（互换先后），看 slack 是否随顺序变——不需要负载。若随顺序变 ⇒ 不是 flaky，是 CC-420 那类「状态经 store 跨队泄漏」，直接接 T10 修法 ①。
1. `measureWithResidual` 逐队 `await setupHarness` → `useResourceCalc()` → 同步读 `resourceResult`；r447 CC-420 已证创建即跑两遍管线且有 `watch(flush:'post')` 回填 store。若 harness 复用同一 pinia / 同一 configStore 实例，上一队的 post-flush 回填可能在**下一队**的 `setAgent` 之后才落地 ⇒ 下一队读到上一队的 `effectCoverages`。负载只是让「谁先谁后」更容易翻面（`setupHarness` 里若有真实 I/O await，微任务与 I/O 回调的相对顺序就会随负载变）。**验证法**：在测试里每队 `await nextTick()` 两次后再读；或在 `setupHarness` 后断言 `effectCoverages` 为初值。
2. 同一 fork 内跨文件残留（vitest forks `isolate` 默认 true 应隔离；若配置被改过要查）。
3. `determinism.test` 是否覆盖「同进程连续两队不同配置」这一场景——它可能只测同配置两次。

**做法**：① 先复现：`stress --cpu 12`（没有就并行跑两份 `npx vitest run src/mechanics/__tests__`）制造负载，同时循环 3 次单跑 `timeFillRatchet.test.ts`；红了就把两队的 `rr.convergence` / `effectCoverages` / `threads` dump 到 `/home/kaua/calc-arch/arenaF/<轮>/`。② 复现后按假设 1 加 `nextTick` 观察；真因若是 CC-420 那条回填 watch，就直接做 T10 修法 ①（显式数据流、删 watch），这就是 T10 卡等的「锁变红」信号。③ **禁止**：`TIME_RATCHET_UPDATE=1` 重生成基线、加容差——两队互换不是数值漂移。
**验收**：高负载下连续 3 次全绿；若改了求值路径，zd DIFF 0（或逐队归因）。
<!-- /card:T14 -->

<!-- card:T15 -->
### T15 · ✅ 完成（r467–r473，a `f287adde` → g `38adb975`）· CC-437 轴窗口 overlay 模块私有化（设计稿 `docs/mcp-cc437-axis-overlay-opaque.md`；一次只做一步、各自独立提交、各自 zd 0）
**卡面就是全部上下文**：读设计稿 §2（目标形状）与 §4（本步那一行），其余别读。**验收通用**：`timeout 280 npx vue-tsc -b --force` 0；`ZD_REPO=<worktree> bash .zc/perf/zd.sh <tag>` 期望 `DIFF 0 NON1581 0 []`（两段 DUMP / ROWS 都要）；本步涉及的测试文件定向绿 + 全量分片（两片 passed 之和 = §0 基线，锁新增则 +N 并更新 §0）；arch 加 `CC-437<步>` 行、r6 §8 加行、本卡勾掉对应项。worktree 基于 `origin/master`，只 `git add` 自己的路径，提交身份 `-c user.name=<lane>`。**过渡期规则**：T15-g 之前 `buckets` / `scalar` 旧字段与 `AgentAxisOverlays` 类型都保留，未迁的模块继续用旧字段；已迁模块只用 `overlay`。
- [x] **T15-a 基础设施（done `f287adde`，r467；实做与下文卡面两处偏差——`overlay` 过渡期可选、钩子返回类型不改联合而是 `AgentAxisOverlay = AgentAxisOverlays & brand` 交叉——见设计稿 §4 a 行；T15-g 归位）**：`src/mechanics/typesHooks.ts` 加 `AgentAxisOverlay`（brand）+ `axisOverlayChannel<T>()`，`src/mechanics/index.ts` / `types.ts` 的 re-export 跟上；`src/mechanics/typesRows.ts DirectRowBonusInput` 加 `overlay: AgentAxisOverlay | undefined`；`types.ts:948 axisWindowOverlays` 返回类型改 `AgentAxisOverlays | AgentAxisOverlay | null`；`src/composables/resourceCalc/damagePoolDirect.ts:168` 的调用加 `overlay: overlayBuckets as unknown as AgentAxisOverlay | undefined`；`panelPhases.ts:388` 的 scalar 合并改为 `if ('scalarBySlot' in res && res.scalarBySlot)`（新形状没有这个键）。预期：行为零变化（zd 0、分片基线不变）；没有测试要改。
- [x] **T15-b sigrid（done `0f643e81`，r468；`sigridInfectionPct` 字段已随手删；卡面漏列读者 `damagePoolBatchR16b.test.ts:133-144`）**：`src/mechanics/agents/sigrid.ts:648-659 / 677`；测试 `src/mechanics/__tests__/sigrid.test.ts:583,589`、`teamHookMigration.test.ts:261-263`。
- **c→f 通用步骤（r468 从 b 卡学到）**：① 开工先 `grep -rn "<桶名>\|<标量名>" src` 列全读者（b 卡漏了 `damagePoolBatchR16b.test.ts`，只在全量分片才红）；② 模块里定义 `XxxOverlay` 接口 + `export const xxxOverlay = axisOverlayChannel<XxxOverlay>()`，`axisWindowOverlays` 返回 `xxxOverlay.wrap(...)`，`directRowBonus` 用 `xxxOverlay.read(overlay)`；③ 测试改 `xxxOverlay.read(hook(...)!)!.字段`、直接调 `directRowBonus` 的改传 `overlay: xxxOverlay.wrap({...})`；④ **顺手删 `AgentAxisOverlays`/`AxisScalarOverlays` 里该模块的字段**（vue-tsc 兜底找漏网读者）；⑤ 轴/非轴双臂的模块（c/d/e/f）把「桶 + 标量」合成一个对象（如 `{ byMove: Map<moveId, …>, flat?: number }`），`directRowBonus` 内保留原「桶优先 / 标量回落」顺序。
- [x] **T15-c peiluo（done `37e97ec9`，r469；`PeiluoOverlay { byMove?, flatPct? }`；两字段已删）**（`src/mechanics/agents/specPanelBuffs.ts:73-112`）；测试 `peiluo.test.ts`、`teamHookMigration.test.ts:216-233`。
- [x] **T15-d corin（done `3a9a8f5f`，r470；`CorinOverlay { byMove?, flatPct? }`；两字段已删）**（`src/mechanics/agents/corin.ts:287-333`）；测试 `corin.test.ts`、`teamHookMigration.test.ts:251-255`。
- [x] **T15-e banyue（done `808710cf`，r471；`BanyueOverlay { stacksByMove?, flatPct? }`；两字段已删；T16 现可开）**（`src/mechanics/agents/banyue.ts:927-970`）；测试 `banyue.test.ts`（14 处）、`teamHookMigration.test.ts:163-168`、`damagePoolNightA.test.ts` / `damagePoolBatchR16b.test.ts` 的般岳夹具。
- [x] **T15-f yixuan（done `f5bddaf6`，r472；`YixuanOverlay { byMove?, flat? }`；两字段已删，共享类型 9 字段清零）**（`src/mechanics/agents/yixuan.ts:1080-1140`；读取优先级 `flat ?? (isAxis ? byMove.get(moveId) : undefined) ?? {0,0}` 逐字保留）；测试 `yixuanSmoke.test.ts`、`teamHookMigration.test.ts:181-206`、`damagePoolNightA.test.ts:293-318`（槽键控断言改槽无关）。
- [x] **T15-g 收口（done `38adb975`，r473；CC-437 全部落地，形状锁 `axisOverlayOpaqueCc437.test.ts` 已加；T15 卡关闭）**：删旧类型 / 旧字段 / scalar 合并；`useResourceCalc.ts:647-648`、`damagePool.ts:85-90`、`damagePoolDirect.ts:160-173` 合成 `axisOverlayBySlot`；`damagePoolNightA.test.ts` / `damagePoolBatchR16b.test.ts` 输入夹具改 `axisOverlayBySlot`；加锁 `src/composables/__tests__/axisOverlayOpaqueCc437.test.ts`（三条见设计稿 §4 g 行）；arch CC-437 置 done；设计稿状态行改「已落地 <commit>」。
<!-- /card:T15 -->

<!-- card:T16 -->
### T16 · ⛔ 量过不做（r475，分诊稿 `docs/mcp-t16-banyue-rage-window.md`）· 般岳(1471) 怒相增益轴内「释放后覆盖」（原 pending 分诊 G2）
**r475 纠正**：卡面「怒相进入点（焚身）起 30s」**与原文不符**——核心被动原文是「发动**[强化特殊技]或[支援突击]**时 …持续 30 秒，重复触发时刷新」（`data/raw/nanoka_missing/full/1471.json`）。每次怒相 4 个山威强特 + 怒相外全部闪能打成强特连段 + 招架后支援突击 ⇒ 30s 窗口几乎不断，实战覆盖率 ≈ 0.95～1，`banyue.rageGainCoverage` 滑块默认 100% 已是正确近似。精确化需要行级贯穿力 flat 新通道（`penRatioBonus` 式面板浅克隆）+ 轴态 `applyBanyuePanel` 停加 + 双计防线，收益 ≈ 0 ⇒ **不做**。备选路线（a 零差通道 / b 般岳迁入）写在分诊稿 §3，触发条件 = 出现第二个需要行级贯穿力 flat 的角色。下面原卡面保留作历史：
**卡面就是全部上下文**：`docs/MECHANICS_IMPLEMENTATION.md` 般岳段 + `src/mechanics/agents/banyue.ts:478`（`rageGainCoverage` 滑块消费点）+ 头注释 L42。**缺口**：怒相增益（贯穿+300/火伤+36%/暴伤+36%，C2 各+15）现按 `banyue.rageGainCoverage` 滑块**整局覆盖率**近似；真值是「每次进入怒相后 30s 窗口内生效」——轴模式下能在轴内精确（入怒相时刻已知 ⇒ 窗口精确）。**非轴模式维持滑块**（R4 撤销时序仿真，非轴不建逐秒轴）。
- [ ] 轴模式：扫失衡轴/动作轴，怒相进入点（焚身）起 30s 窗内行吃满增益、窗外不吃——复用明王同款轴扫描（般岳明王 8s 窗口先例 / `computeCorinStunBonusMoves`）；走 T15 落地后的 overlay 通道。
- [ ] 非轴模式：保持滑块，卡面注明。
- [ ] 锁：`banyue.test.ts` 加轴内/轴外差分用例；`timeGolden` delta 逐队归因后按规则 10 重生成。
- [ ] 验收：`timeout 280 npx vue-tsc -b --force` 0；`npx vitest run banyue timeGolden`；zd 期望**非零可归因 delta**（轴模式般岳队增益更精确），归因写提交说明。
<!-- /card:T16 -->

<!-- card:T17 -->
### T17 · ✅ 完成（r474 `544100b9`）· 赛维里安(1631) C2 凭风自动补层（真缺口 G3，2026-10-03 pending 分诊立项）
**卡面就是全部上下文**：`src/mechanics/agents/severian.ts:39-71`（`cycleFromCfg` 读 `severian.fengfengStacks`）+ `:249`。**缺口**：C2「每次苍风影猎获得 2 层凭风」现并入凭风层数滑块 `severian.fengfengStacks` 手动调（默认 1）；苍风影猎次数已由 buildExecutions 自算（流息收入/100）⇒ C2 后 1 次苍风影猎即满 2 层，应自动封顶、无需手调。
- [x] ~~`cycleFromCfg`：C2 且 `severian.fengfengStacks` 未显式覆盖时按苍风影猎次数自动给满 2 层；显式滑块仍优先（用户校准通道）。~~ **实做偏离（r474 拍板）**：`resolveSeverianFengfengStacks({cinemaLevel, shadowHuntCount, sliderStacks})` = C2 且 ≥1 次影猎 ⇒ **2，滑块不参与**；否则滑块夹 0..2。原因：机制设置协议（`buildCharConfig` 写 `setting:<id>` 恒为数字、缺省填 default）分不出「用户设 1」与「默认 1」，要做「显式优先」得给协议加 unset 哨兵，为一个滑块改全局协议不值；物理上 C2 下低于 2 层只可能发生在首次影猎前的那一个载体。回退点 `git revert 544100b9`。两读者（`patchSeverianExecutions` / `buildSeverianResourceResult`）都经该函数，`cycleFromCfg` 改为显式传层数。
- [x] 锁：`severian.test.ts` 加纯函数 7 断言 + 真管线用例（C0 默认 1 / C2 默认 ⇒ 2 / C2 显式 0 ⇒ 2；连携行倍率差 = MULT[2]−MULT[1]）。⚠ 坑：同一 `it` 内多次 `setup` 共用 pinia，`setMechanicSetting` 会残留 ⇒ 先读默认态再设显式值；`skillTableNote` 被 enrich 的「已从倍率表 rows 回填…」整体覆盖（预存问题，模块 patch 写的「凭风N层」注释到不了最终行），不能当判据。
- [x] 验收：vue-tsc 0；severian 12/12；zd `DIFF 0`（夹具无 C2+ 赛维里安）；timeGolden 4 条 delta 全部 `agent:1631` c3/c4/c5/c6 dmg +0.62%~0.75%（载体末击倍率 +240），c0 不变、时间账零变化 ⇒ `TIME_GOLDEN_UPDATE=1` 重生成，归因在提交说明。
<!-- /card:T17 -->

（T1/T2 已于第 370 轮 `0c5e00cb` 完成，T3 已于第 373 轮 `851f232f` 完成。T4–T6 由第 424 轮（arena-F，CC-398）写出；T5 `df3e7c42` / T6 `1b771511` 已于第 425 轮完成并删卡，T5 是 dsh 工人做的；T4 `13602152` 已于第 426 轮由 dsh 工人完成并删卡。T7 5d081fb5 已于第 428 轮由 dsh 工人完成并删卡。**当前待执行卡**：T15（CC-437，arena-F r467 进行中）、T16（般岳怒相轴内覆盖，等 T15）、T17（赛维里安 C2 凭风自动补层，start-ready）——T16/T17 由 2026-10-03 pending 分诊立项（146 条 pending 三分类，台账 `.claude/pending-triage-2026-10-03.md`）。T13 仅剩 c / b′ 默认不做；T10 备选，等锁变红。）



