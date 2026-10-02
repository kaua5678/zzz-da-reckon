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

### 0.R2 收尾流程（2026-09-27 R2 定稿；依据与数字见 `docs/mcp-dev-process-speed.md`）

- **强度不变，顺序和并行方式变了**：全量 `npm run verify`、零差、文档提交后重跑 check-guards 三道都保留。
- ① 改代码中途要早信号时，跑 `npx vue-tsc -b` 加相关测试文件。tsconfig 已开 `incremental`：无改动 1.5 秒，改一两个文件约 9–12 秒。**工人自测仍必须包含 `vue-tsc -b`**（上面 W31 那条不变，它现在很便宜）。
- ② 触及计算路径时，跑 `bash .zc/perf/zd.sh <tag>`（基线 = HEAD 的 worktree，改后 = 工作区，四路并行约 50 秒；原来顺序执行约 176 秒）。要求 DIFF 0；不为 0 就逐条解释。**本卡改动先不要提交**。
- ③ 全量 verify **只跑一次**，放后台；等待期间在本地起草文档，**verify 结束前不要落盘**，因为 check-guards 会扫描 docs。用轮询 `grep -q '^EXIT'` 等待，不要用固定 sleep。
- ④ verify EXIT 0 后，依次：提交代码 → 落盘并提交文档 → **重跑 `node scripts/check-guards.mjs`（必须）**。
- **不要做**（会削弱保证，已列入流程文档 §6 等用户裁决）：用 `vitest --changed/--related` 代替全量；只改文档时跳过 vitest（本轮就实测到「手册 §4 行数」测试被文档打红）；纯搬迁卡跳过零差。

## 1. 长期规则（从 2026-09-27 以前的逐轮交接里提炼，压缩时逐条保留）

- **没有排定项时不造活**（第 237 轮）：REQUIREMENTS 无新条目、交接也没有下一步时，按 `docs/mcp-r6-refactor-list.md` §8 的扫描记录，只查表里没有的区域；查完仍没有满足「更通用 / 更简单」的项，就在 §8 追加扫描范围，然后收尾（写交接、push、zc done）。依据：用户明确不要只为降计数或凑工作量的改动。回退：删掉本条。
- **主档优先**（第 375 轮）：一条工作线有专属主档（如 CC-343 的 `docs/mcp-analyzer-scenario-isolation.md`）时，验证细节、决定、回退点只写主档；卡表与 r6 §8 只留一行指针，不再在 `docs/mcp-stun-dual-source.md` 另开 §24 节。依据：同一件事写四五处既费 token 又会漂移。回退：删掉本条，按旧惯例补 §24。
- **每轮收尾必须 `git push origin master`**（提示词 c2）：commit 不等于 push。2026-09-27 用户发现本地积压 436 个提交、远端停在 09-21。推送失败要写进交接，不能静默跳过。
- **登记债务、豁免或改 burn-down**：改 `scripts/lib/guard-registries.mjs`，不要改 check-guards 本体（CC-85）。
- **改角色机制实现的提交**：顺手 grep `public/static/character-mechanics.json` 和 `character-constellations.json` 里该角色的 pending，过时就同步改。状态表过时的根因，就是实现提交没回写（CC-89）。
- **新增 `record.<key>` 读取**：必须同时有写入方（buildCharConfig 或编排层注入），否则判据 25 会红（CC-91）。
- **文档提交之后至少再跑一次 `node scripts/check-guards.mjs`**：docs 里以 `@fact ` 开头的散文会被解析成 fact 声明（CC-93）。
- **drift 复核**：要看从原始口径日期到现在的全部改动（`git log <原始据日期>..HEAD -- <锚文件>`），不要只看上次 `·复核@` 之后的。另外，有些条目的竖线前没有空格（`·复核@2026-09-25| 验`），不要把戳打进「验」或「锚」段（CC-87）。
- **`src/views/TeamComparePage.vue` 只剩约 38 行结构熵余量**：给该页加功能，写到 `src/composables/teamCompare*.ts`（CC-92）。
- **反空洞下限要量「扫描面」，不要量「被扫描的问题」**（r404 CC-378）：判据 25 原先以 Record 读取数作下限，而 D2 §5 正在有意消灭这些读取，结果每推进一批就被推红一次。防「扫描器失明」的下限用扫描到的文件数这类只随仓库规模变的量。它和下一条不矛盾：下一条说的是计数**凭空**下降要追查；这里是下降原因已知、且就是重构目标。
- **等号基线（「计数下降也报错，要求下调基线」）是有意设计，不要改成「≤」**：2026-09-14 它两次抓到扫描器盲区，计数凭空下降其实是扫描器看不见了，而不是代码变好了（`scripts/check-tokens.mjs` 头注释；`docs/mcp-working-model.md` §2.5）。

## 2b. 并行 lane 交接（§2 「每轮替换」时**不要**连本节一起删；每个 lane 一段，过时的段压成一行指针）


> 为什么有这节：2026-09-29 实测两个会话同时在跑（本会话开工时主 lane `lead-arena-0925c` 第 315 轮正在 `wt315` 跑 verify；推断是 arena 对战模式两个模型同时收到同一份提示词）。
> §2 属于主 lane；并行会话把自己的交接写在这里，互不覆盖。任何 lane 确认本节已过时，可以整节替换成自己的。
> 开工查现场的方法见提示词第 9 条（`ps` 看 verify / vitest，`git log` 看最近提交时间，`ls -lt /home/kaua/calc-arch`）。

> **认领表**（2026-10-01 arena-D 起）：`/home/kaua/calc-arch/LANE-CLAIMS.md`（不入 git）。选好活后追加一行「时间 | lane | 文件/主题 | worktree」，收工标 `[released]`；选活前先读它，避开别人未 released 的文件。
> **在 worktree 里跑零差**：`cp -r .zc/perf <worktree>/.zc/` 后 `ZD_REPO=<worktree> bash .zc/perf/zd.sh <tag>`（`.zc/perf/zd.sh` 本轮加了 `ZD_REPO`，不设时行为同旧）。

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

## 2. 最近一轮交接（每轮替换本节）

**第 407 轮（lane arena-E；无并行会话；HEAD `c4363518`；REQUIREMENTS.md 无新条目）：CC-381 `30abf0aa` + `84ec4c0b` + 文档，已 push（`git rev-list --count origin/master..HEAD` 不为 0 = push 失败，先补推）。**
- **做到哪**：**计算层（core / types / specs / utils / data / mechanics）非测试源码零 `any`**，由全目录不变式锁住（架构卡 CC-381）。
  - r406 交接列的 11 处（core 9 / types 2）都是同一个病：catalog 漏声明数据里真实存在的字段，或 core 为不依赖 store 而用 `any`（改为结构类型 `ImpactVarConfig`）。
  - 补查 `Record<string, any>` 时挖出更大的一处：**`specResources` 被 18 个模块当私有结果夹带通道**。已拆开：`specResources` 只放 spec 账本（`SpecResourceResult`），私有对象走具名结果键（`aireCycle` / `hugoAbyssEcho` / `triggerResolve` …，全表见 `.zc/perf/dump.perf.ts` 的 `SPEC_FOLD`）。
  - panYinhu `buildResourceResult` 零读者，已删除（如需展示影画 2 换能，从 `cfg.panYinhuC2EnergyTotal` 读，那才是真实通道）。
- **验证**：vue-tsc `--force` 0；zd `r407c` 0/0（`r407a` 未加折叠时结构哈希 276 / 281 处变化，总伤害段与失衡池段全同，见下方新坑）；guards 25 / tokens 12 / data 366 / specs 1120 / recording 189；全量 458 个文件 / 4244 个测试；build 通过（日志 `arenaE/r407/`）。锁 7 条正则逐一注入 `core/panel.ts` 均红。
- **回滚点**：`git revert 84ec4c0b 30abf0aa`（按此顺序）。`.zc/perf` 的 `SPEC_FOLD` 不入 git，回滚后留着无害（只在对象含这些键时生效）。
- **开放项**：OPEN-ITEMS 的 D2 追加 r407。spec JSON 里 hugo（1291）/ piper（1281）的 `resources` 对引擎是死声明（notes 已写明由 TS 模块承担），本轮没动；如要清理，先确认 validate:specs 与 UI 有无读者。
- **下一步（按价值排）**：
  1. **`composables/resourceCalc/` 零 any 并入 CALC_DIRS**：它是计算编排层，不是纯 UI。现有 13 处（skillRows 5 / panelPhases 4 / helpers 2 / damagePoolDirect 2），先逐处判断同病与否，清零后在 `privateCfgFields.test.ts` 的 `CALC_DIRS` 加 `'composables/resourceCalc/'` 并反证。计数命令：`cd src && grep -rPn "\bas\s+any\b|:\s*any\b|<any\b|\bany\[\]|,\s*any\s*[>,\]]|\|\s*any\b" composables/resourceCalc --include=*.ts | grep -v __tests__`。
  2. 继续找「派给全部、各自认领」的同类（CC-373 / CC-377）。判据是派发处有没有给身份。
  3. UI 层（composables 其余 10 / stores 9 / components 18 / views 28）价值较低，`stores/config.ts` 的 7 处优先（store 是计算输入的源头）。
- **已知坑**：
  - 改名类重构必须同步改**反向源码锁**（`not.toMatch(/旧名/)`）：旧名消失后它永远绿，等于静默失效。
  - MCP「Duplicate JSON-RPC request id」：`rm -f /tmp/mcp.session` 后重发。
  - 源码锁写完要反证（临时撤掉被锁的改动看是否变红），r388 用 `git show HEAD:<file> > <file>` 换回旧版验证后再复原。
  - 纯类型改动的最强判据是 `vite build --outDir A` / `--outDir B` 后 `diff -r A B`（逐字节相同 ⇒ 运行时零变化），比 zd 便宜且覆盖全产物。
  - 两个 `node /tmp/mcp.js` 并行调用会撞「Duplicate JSON-RPC request id」（每个进程 id 都从 1 起、共用 session）——MCP 调用别并行。
  - **新建 `docs/*.md` 必须同步登记 README §6 文档表并改节标题份数**（守卫 `docs table`）；收尾在**文档提交之后**再跑一次 `npm run check-guards`，别只在代码提交前跑。
  - `git stash -- <路径>` 可只撤某几处改动做锁的反证，`git stash pop` 复原（r390 用过）。
  - 只做机械改写时**别**把 `Number(raw ?? x)` 换成 `cfgMechanicSetting`：后者对非有限数取 fallback，脏值行为不同（零差不保）。
  - check:fast / verify 别整条跑：拆成 guards→tokens→data→specs（一调用）/ recording / `vitest --maxWorkers=4` / build 分别前台跑。
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


## 3. 执行卡（输入输出写死的机械活，可交给执行模型或 dsh；第 368 轮新增本节）

> 用法：§0 的派发脚本按 `<!-- card:ID -->` 抽卡面。**卡面就是全部上下文**，执行者不需要读别的文档。
> 做完：主代理按 §0 复核（真实 diff、vue-tsc、相关测试）→ 提交 → 删卡，在 §2b 留一行「T? 完成 `<commit>`」。
> 写卡标准：改哪几个文件、改成什么样、怎么验收、不许碰什么，都写死；需要判断的活不写成卡。

（T1、T2 已于第 370 轮 `0c5e00cb` 完成）

（当前无待办执行卡；T1/T2 已于第 370 轮 `0c5e00cb` 完成，T3 已于第 373 轮 `851f232f` 完成）
