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
- **每轮收尾必须 `git push origin master`**（提示词 c2）：commit 不等于 push。2026-09-27 用户发现本地积压 436 个提交、远端停在 09-21。推送失败要写进交接，不能静默跳过。
- **登记债务、豁免或改 burn-down**：改 `scripts/lib/guard-registries.mjs`，不要改 check-guards 本体（CC-85）。
- **改角色机制实现的提交**：顺手 grep `public/static/character-mechanics.json` 和 `character-constellations.json` 里该角色的 pending，过时就同步改。状态表过时的根因，就是实现提交没回写（CC-89）。
- **新增 `record.<key>` 读取**：必须同时有写入方（buildCharConfig 或编排层注入），否则判据 25 会红（CC-91）。
- **文档提交之后至少再跑一次 `node scripts/check-guards.mjs`**：docs 里以 `@fact ` 开头的散文会被解析成 fact 声明（CC-93）。
- **drift 复核**：要看从原始口径日期到现在的全部改动（`git log <原始据日期>..HEAD -- <锚文件>`），不要只看上次 `·复核@` 之后的。另外，有些条目的竖线前没有空格（`·复核@2026-09-25| 验`），不要把戳打进「验」或「锚」段（CC-87）。
- **`src/views/TeamComparePage.vue` 只剩约 38 行结构熵余量**：给该页加功能，写到 `src/composables/teamCompare*.ts`（CC-92）。
- **等号基线（「计数下降也报错，要求下调基线」）是有意设计，不要改成「≤」**：2026-09-14 它两次抓到扫描器盲区，计数凭空下降其实是扫描器看不见了，而不是代码变好了（`scripts/check-tokens.mjs` 头注释；`docs/mcp-working-model.md` §2.5）。

## 2b. 并行 lane 交接（§2 「每轮替换」时**不要**连本节一起删；每个 lane 一段，过时的段压成一行指针）


> 为什么有这节：2026-09-29 实测两个会话同时在跑（本会话开工时主 lane `lead-arena-0925c` 第 315 轮正在 `wt315` 跑 verify；推断是 arena 对战模式两个模型同时收到同一份提示词）。
> §2 属于主 lane；并行会话把自己的交接写在这里，互不覆盖。任何 lane 确认本节已过时，可以整节替换成自己的。
> 开工查现场的方法见提示词第 9 条（`ps` 看 verify / vitest，`git log` 看最近提交时间，`ls -lt /home/kaua/calc-arch`）。

> **认领表**（2026-10-01 arena-D 起）：`/home/kaua/calc-arch/LANE-CLAIMS.md`（不入 git）。选好活后追加一行「时间 | lane | 文件/主题 | worktree」，收工标 `[released]`；选活前先读它，避开别人未 released 的文件。
> **在 worktree 里跑零差**：`cp -r .zc/perf <worktree>/.zc/` 后 `ZD_REPO=<worktree> bash .zc/perf/zd.sh <tag>`（`.zc/perf/zd.sh` 本轮加了 `ZD_REPO`，不设时行为同旧）。

**2026-10-01 arena-A 第 370 轮（与 arena-C 第 369 轮 `02049db9` 并行，worktree `wtA-370`）：CC-344 队列 §3 执行卡 T1/T2 完成 + `applyDeployConfig` 复用 `applyTeamToStore(autoBuild=true)` 收口跨队精炼/命座百暴泄漏，代码 `0c5e00cb`，文档见本轮 docs 提交，已 push（`git rev-list --count origin/master..HEAD` 不为 0 = push 失败，先补推）。**
- **做到哪**：
  1. **T1 完成 `0c5e00cb`（`src/composables/configSnapshot.ts` + `configSnapshot.test.ts`）**：`StoreSnapshot.globalBuffs` 从 `unknown[]` 收紧为 `GlobalBuffRow[]`，`restoreStore` 去掉 `as never[]` 并改为 `...clone(snap.globalBuffs)` 深拷贝写回（补反复恢复后原地改写不污染快照的回归测试）。全仓 `src/` 非测试代码中的 store 状态 `unknown[]` 已清零（剩余 4 处均为 `globalThis.__fold*` 调试钩子与 `modelingGaps.ts` 的通用 `SetPieceLike.effects?: unknown[] | null`）。
  2. **T2 完成 `0c5e00cb`（`src/utils/modelingGaps.ts` + `src/views/RunArchivePage.vue`）**：导出 `CinemaLedgerEntry` / `MechanicLedgerEntry`，`RunArchivePage.vue` 用 `readLedger<T>(url)` 收紧账本加载类型并去掉全部 4 处 `as any` / `as never`。
  3. **`applyDeployConfig` 装配顺序收口（`src/composables/runArchiveDeploy.ts` + `runArchiveDeploy.test.ts`）**：改调 `teamTimelineStore#applyTeamToStore(..., true)` 先写命座/精炼再走 `applyTeamPreset`，消除上一队残留高精/高命漏入 `applyBuildRecommendationForSlot` 百暴副词条计算（实测艾莲 1 精在猫又 4 精队之后部署，修前 `critRate` 副词条从 12 步掉到 6 步、总伤漂移；修后两次部署副词条与总伤完全一致），删去不再需要的尾随 `syncTeammateBuffsFromTeam()` 补丁；保留 `stunAxes.splice(0)` / `stunAxisPlans.splice(0)` 不动总开关。详见 `docs/mcp-stun-dual-source.md` §24.185 与 `docs/mcp-r6-refactor-list.md` §8 第 370 行。
  4. **验证**：rebase 到 `02049db9` 后 `npx vue-tsc -b --noEmit` 0 错；`configSnapshot.test.ts`（6/6）、`runArchiveDeploy.test.ts`（12/12）、`analysisScenario.test.ts`（5/5）、`teamCompare.test.ts`（36/36）、`moveFusion.test.ts`（24/24）、`src/utils`（16 文件 107 用例）、`checkGuards.test.ts`（143/143）全绿；`node scripts/check-guards.mjs` 25/25 通过。回退点：`git revert 0c5e00cb`。
- **下一步**：
  1. 配合 arena-C 的 CC-343（`02049db9`，分析器独立场景 `createAnalysisScenario` / `withAnalysisScenario`）推进剩余分析器从 `snapshotStore/restoreStore` 向独立场景的阶段迁移（见 `docs/mcp-analyzer-scenario-isolation.md`）。
  2. 复核 `docs/mcp-r6-refactor-list.md` §8 重开条件（坑 25，到期日 2026-10-31）。
  3. 待裁决项保持不变（testOnly 关卡牌 §1.3 等）。

**2026-10-01 20:00 arena-D 第 368 轮（开工 19:22 时无并行会话，HEAD `914f1fa1`；REQUIREMENTS.md 429 行无新条目）：失衡轴状态唯一读写入口，代码 `a6264cf4`，已 push（`git rev-list --count origin/master..HEAD` 不为 0 = push 失败，先补推）。**
- **做到哪**：config store 新增 `getAxisState` / `setAxisState` / `applyStunAxisPreset` + 类型 `StunAxisState`，5 处调用方改走它（configSnapshot、teamCompare、difficultyLadder、difficultyCurve、StunAxisPage）；CC-278 源码锁放宽到任意前缀。详见 r6 §8 第 368 行。
- **已拍板**：① 「每组三人只评一个规范槽序」**不做**（有损：slot0 是真实建模维度，分差 ≤ 9%），理由见 r6 §8 第 368 行；② 静态 fetch 散落已清零，关闭。回退点：`git revert a6264cf4`。
- **下一步**（按价值排序）：
  1. 本节下方 §3 执行卡 **T1 / T2**（类型逃逸收紧，卡面自足）：可派 dsh（§0 脚本，`CARD=T1`），也可自己做；做完删卡。
  2. 继续「类型逃逸 → 藏着的重复」扫描：`grep -rnP "unknown\[\]" src --include=*.ts --include=*.vue | grep -v __tests__`，看哪些是 store 状态的副本类型；本轮靠收紧类型揪出了第 5 处轴快照。只收「有重复规则或重复快照」的，单纯的 `as any` 不为降计数而改。
  3. testOnly 关卡牌照样写入（`docs/mcp-boss-room-context.md` §1.3，待裁决）。
- **已知坑**：config store 的新动作都深拷贝写入，调用方不需要再 clone；`runArchiveDeploy` 只清两表不动总开关是有意的（自动轴接管），别顺手改成 setAxisState。
- 第 367 轮（arena-D）：run-archive.json 唯一加载入口 `fb674a8a`（3 处 fetch → `catalog#loadRunArchive`，共享类型 `RunArchiveFile`）。
- 第 366 轮（arena-D）：boss-presets.json 唯一加载入口 `29aa7183`（9 处 fetch → `catalog#loadBossPresets`）。
- 第 365 轮（arena-D）：抽卡规划第 3 房恒 0 分修复 `b719ba36`（精确分房 + 免费人下限 9），探针空房 6/36 → 0/36。- 第 364 轮（arena-D）：CC-342 第 3 步 `59ea97ea`，关卡 buff 随 `BossPresetPhase.layerBuffs`，所有分析器经 `applyBossRoom`。第 363 轮：CC-342 第 1、2 步 `602c0f94`。第 362 轮：候选队友 4 → 6 `3439c9d2`。

**2026-10-01 arena-C 第 369 轮（开工 19:24；r368 已被 arena-D 19:25 认领、19:31 收工，本轮记 369；19:37 起 arena-A 第 370 轮并行，认领 configSnapshot / runArchiveDeploy / RunArchivePage / modelingGaps；REQUIREMENTS.md 429 行无新条目）：CC-343 分析器独立场景第 1 阶段，代码 `02049db9`，已 push（`git rev-list --count origin/master..HEAD` 不为 0 = push 失败，先补推）。**
- **做到哪**：底座 + 一个试点。设计、验证、迁移进度和配方都在新文档 `docs/mcp-analyzer-scenario-isolation.md`（README §6 72 → 73 份）。
  1. `createConfigModel(catalog, initialState?)`：独立场景出生态，写在全部 state ref 声明后、依赖 state 的 watcher 注册前（`config.ts`「独立场景出生态」段；键表 23 个 ref，未登记的键抛错）。
  2. `useResourceCalc.ts`：函数体改为 `createResourceCalc(config, catalog)`，`useResourceCalc()` 一行绑定；导出类型 `ResourceCalc`。
  3. 新 `composables/analysisScenario.ts`：`createAnalysisScenario` / `withAnalysisScenario` / `AnalysisContext` / `cloneConfigState`。
  4. 试点 `charIncrement#computeIncrementPass` 改收 `scenario`、删快照恢复；`CharIncrementPage` 用 `withAnalysisScenario`。
  5. 验证：`vue-tsc -b` 0；新测试 5 例（含朴素注水反例）；A/B 逐字节相同（md5 `53ecb939`，9 期 78 队）；全量 verify EXIT 0（449 文件 / 4126 测试通过，16 / 29 跳过，228.9s）。
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

**第 359 轮（lane arena-A，承接第 358 轮下一步 1–2）：CC-340 分析器现场快照闭环（`appliedBoss` 深拷贝 + `mechanicSettings` / `timeWeightStrategy`）、空槽清音擎与时间线/自由对比装配收口（代码 `8b613145`），文档见本轮 docs 提交，已 push（若 `git rev-list --count origin/master..HEAD` 不为 0，说明 push 失败，请先补推）。现场：开工时无并行会话（`HEAD` = `7b3ed9be`，工作区干净）。**

- **CC-340（`8b613145`，分析器现场快照闭环 + 空槽清音擎 + 时间线/自由对比装配收口，见 `docs/mcp-stun-dual-source.md` §24.183）**：
  1. **分析器现场快照闭环（`src/composables/configSnapshot.ts` + `src/composables/difficultyCurve.ts` + `src/views/TeamComparePage.vue`）**：
     - `snapshotStore` / `restoreStore` 对 `appliedBoss` 改为 `clone(...)` 深拷贝，防止 `config.ts` 的 `watch([counterAssistSlot, ...], syncBossInteractionPlan, { flush: 'sync' })` 在分析器换队时原地改写 `snap.appliedBoss.parryTotal` / `parryNoFollowUpTotal`；
     - 将 `mechanicSettings` 与 `timeWeightStrategy` 纳入 `StoreSnapshot` 统一快照与恢复，防止各分析器调 `applyBossPreset` 时自动写入的 `mechanicSettings['guarantee.stun'] = 1` 泄漏到用户现场，并删去 `difficultyCurve.ts` 与 `TeamComparePage.vue` 中重复手写的 `extra = { strategy, mechanics }` 旁路备份。
  2. **空槽清空音擎与限定金统计对齐（`src/stores/config.ts#setAgent` + `src/composables/teamCompare.ts#teamGoldOf`）**：
     - `setAgent(slot, '')` 清空角色槽位时同步将 `char.wEngineId = ''` 清空（并在非 `defer` 模式下触发 `syncTeammateBuffsFromTeam()`），避免旧角色专武残留在空槽上；
     - `teamGoldOf` 在空槽位（`!agentId`）时直接跳过，与同文件 `buildGoldStepsFromConfig` 对齐，不计空槽残留音擎金数。
  3. **时间线配装顺序、收敛守卫、单队求值去重与菲林模拟去重（`src/composables/teamTimelineStore.ts` + `src/composables/teamTimeline.ts` + `src/composables/teamTimelineFilm.ts`）**：
     - `teamTimelineStore.ts#applyTeamToStore`：在调 `applyTeamPreset / syncTeammateBuffsFromTeam` 前先写入 `state.cinemas` 与 `state.wengineMods`，使 `autoBuild=true` 的默认副词条百暴计算与队友 buff 门控按目标金态求值；
     - `teamTimeline.ts`：`computeOptimalTeamAllocation` 贪婪试算步增加 `Number.isFinite(d)` 守卫；`evalTeamByBudget` 扩充返回 `state: TeamGoldState` 并复用于 Chart 3 `computeNewCharacterPoints`；
     - `teamTimelineFilm.ts#computeFilmSimulation`：复用买金 `while` 循环末次求出的 `best = searchBest(totalGold)`，消除每期退出循环后以同一 `totalGold` 重复扫描全候选池的双倍求值开销。
  4. **自由对比槽位装配顺序与下位试算计数（`src/composables/freeCompare/engine.ts`）**：
     - `applyCodeToSlot` 先写 `cinemaLevel / wEngineModLevel` 再调 `setAgent`；`pickEvaluations` 按 `n > 1 ? n : 0` 与 `pickDowngradeByDamage` 实际试算次数对齐。
- **验证**：`npx vue-tsc -b --noEmit` 0 错；相关套件（`configSnapshot.test.ts`、`teamCompare.test.ts`、`teamTimeline.test.ts`、`freeCompareEngine.test.ts`、`difficultyCurve.test.ts`、`slotSweep.test.ts`、`checkGuards.test.ts` 143/143）全绿；`node scripts/check-guards.mjs` 25/25 通过。回退点：`git revert 8b613145`。

**下一步（直接开工）**：
1. **复核 `docs/mcp-r6-refactor-list.md` §8 表的「重开条件」**。有日期的条件：坑 25，到期日 2026-10-31。
2. **审计剩余编排层工具模块（如 `runArchiveDeploy.ts`、`runArchiveImport.ts`、`substatOptimizer.ts`、`liveInteractions.ts`、`pullPlannerEngine.ts`）的状态隔离与单源化机会**：
   - 第 350–359 轮已完成 `src/mechanics/agents/`（47 个角色模块）、`src/specs/`、`src/composables/resourceCalc/`、`src/core/` 结算子模块、`cinemaUplift`、`freeCompare`、`positionCompare`、`teamCompare`、`difficultyLadder`、`configSnapshot`、`teamTimeline*` 的对账与单源化。
   - 下一步可重点检查 `runArchiveDeploy.ts` / `runArchiveImport.ts`（归档导入与部署到 `configStore` 时的槽位/Boss/机制设置清理）、`substatOptimizer.ts` 与 `pullPlannerEngine.ts` 是否还有边界泄漏或重复装配逻辑。
3. 低优先：off 投影下连携 / 窗口仍读计划实数（§24.140，默认不做）。

**已知坑**：
- **「只在 undefined 时初始化」的求解状态可能是承重的**：折叠环的 `diag.bestExcess` / `stagnantPasses` 跨运行不归零，CC-160 重折依赖它（第 348 轮归零试验让 dynamicComboAlign ② 变红）。清理这类写法前，先跑全量 verify，并在非缺省机制参数下对照（合轴吸收率 0 / 1）。
- **get_diagnostics 的 path 必须是仓库相对路径**（如 `src/core/resource.ts`）；传绝对路径会报「Path must be workspace-relative」，传 `paths` 会报 INVALID_ARGUMENT。
- **golden 基线的下游读者**：`cinemaMonotone.test.ts` 读的是 `timeGolden.baseline.json`，不是现算结果。数值卡要在**重生成 golden 之后**再跑一遍 cinemaMonotone（或整轮 verify）；重生成之前跑的全量看不到它的变化（第 344 轮第一次全量是绿的，重生成后的 verify 才红）。同类的还有 teamTimeSummary「账本虚高」样例：每修掉一处留白，它就可能失效，按用例注释里的惯例换队（已经换过多次）。
- **主工作区里有另一个会话在并行改动**（2026-09-29 实测：arena 可能同时跑两个会话，见提示词第 9 条与本文件 §2b；原先那批 pullPlanner 改动已由 arena-B 提交）。主工作区里随时可能有别人的未提交改动，verify 会被弄红。做法：`git worktree add -q --detach /home/kaua/calc-arch/wtNNN HEAD`，拷入自己改的文件，`ln -s <项目>/node_modules wtNNN/node_modules`，用 `bg.sh vNNNw 'cd /home/kaua/calc-arch/wtNNN && npm run verify'` 跑；只 add 自己的文件；用完执行 `git worktree remove --force`。
- **钩子调用次数**：buildCharConfig 每个 base 调用一次；applyTeamConfig 每轮每相位对新克隆调用一次；其余钩子可能在同一份 cfg 上调用多次。往 cfg 累加必须扣 prev；有条件写入要在所有路径上覆盖（hookReplay 锁会拦）。
- 包住模块钩子的测试写法：`getRegisteredAgentMechanics()` 拿模块对象，直接替换属性，afterAll 恢复（引擎每次按 `getAgentMechanic(id)?.hook` 取，替换立即生效）。
- 探针数字会带 ANSI 颜色，先用 sed 去掉再 grep；`TIME_GOLDEN_FILTER=<agentId>` 只跑单个角色；探针前后 cp 备份与恢复，最后 `grep -c __probe` 为 0。
- 新增模块 cfg 写入必须有读者（cfgWriteOnlyKeys 锁）；verify 跑的时候不要往被验证的目录写文件；杀进程只 kill 具体 pid；上传一律用提示词自带客户端 `node /tmp/mcp.js put <本地文件> <WSL 路径>`（base64 分块 + sha256 校验；`/home/user/mcp-tools/up.sh` 只在部分沙箱里有）；GitHub 偶尔不通，push 失败记进交接。

**未决项**（依赖游戏事实或审美，不开卡）：lumiflux 属性标签颜色（§24.120）；1511 南宫羽 `AA_OWNER_EXEMPT`；辉光 / 流明命名（§24.62）；命破 / 锋御标签颜色（§24.63）；失衡 +20 喧响（§24.79 ①）；赠送 S 是否计限定金（§24.109）。

**探针（优化器相关改动的验收）**
- `REFINE=1 /home/kaua/calc-arch/k206/probe2.sh /home/kaua/calc-arch/k209/<out>.tsv`，基线 `k209/final.tsv`。必须带 REFINE=1，输出路径必须是绝对路径。对比：`node /home/kaua/calc-arch/k206/cmp.cjs <base> <cand>`。

**已知坑**
- **源码锁的反例验证用 `git stash push -- <源码文件>`**：直接 `git stash` 会把新测试也撤掉，跑的是旧测试，看起来「通过」，其实什么都没验证（第 241 轮踩过）。
- **单一来源改造先写源码锁再收尾**：CC-214 与 CC-216 都是锁测试抓出了 grep 漏掉的副本（紧凑写法、另一个模块）。写锁时顺便 stash 掉改动跑一次，确认锁能报出旧代码（反例）。
- **找映射副本别只靠一种 grep 写法**：CC-214 按 `physical: '物理'` 只找到 8 处，紧凑的单行写法和跨行写法又藏了 4 处，是源码锁测试扫全 src 才抓出来的。先写锁测试，再以它的失败清单为准。
- **validate-specs 的 note 通道**：note 含「实现位置：」就直接放行，不核对代码。新的归一条目应该走能被逐条证明的读取方式（`applySpecAttributeConversions` 或按 id 调 `specConversionAmount`），不要只靠 note（CC-213）。
- **结论表里「实现 = spec」要核对模块是否真的调用 spec 解释器**：带「实现位置：」note 的 spec 条目不执行，依据它下的结论可能从未落到计算上（CC-212：CC-134 的 floor 裁决漏了 1571 长达 77 轮）。
- **catalog store 没有 `wEngines` 数组**，要用 `catalog.wEnginesMap.values()`（含 legacyIds 别名，会有重复条目）。
- **覆盖率单位**：`effect.coverage.default` 和 `effectCoverageMap` 的值都是 0–1 的小数（applyEffect 直接相乘），队友滑块 store 值是 0–100。展示时用 `pct(cov * 100)`（CC-209 修过一次「0.5%」误写）。
- **「已勾选」≠「生效」**：展示层要列生效的队友 buff，一律取 `resolveSlotPanelBuffInputs(slot, …).teammateBuffs`（经 helpers 壳导入），不要遍历 `teammateBuffGroups` 再看 `isTeammateBuffEnabled`（CC-208 有源码锁）。
- **修 bug 的测试要做反证**：临时撤掉修复（先 cp 备份），确认新测试失败，再恢复。否则测试可能在修复前也能通过（CC-207 做过）。
- **wsl_exec 里后台起 dsh**：`nohup bash -c '…' &` 会随调用退出被杀、连日志都不生成。要写成脚本文件，用 `setsid nohup script.sh >/dev/null 2>&1 < /dev/null &` 启动（第 229 轮）。dsh 做 66 条的只读分类约需 30 分钟。
- **store 值导入 composables/resourceCalc 会成环**（helpers.ts 值导入 stores/config）。两边共用的函数放 mechanics 或 specs 层（CC-206）。
- **「零读取」≠「可删」**：先 grep 字段语义对应的展示文本或常量，看有没有写死的过时值（CC-205 零号安比 +25% 实为 50%）。
- **沙箱重置后 `/home/user/mcp-tools/*.sh` 会丢执行权限**（仅对有这套脚本的沙箱）：先 `chmod +x`，或用 `bash up.sh ...` 调用。没有这套脚本时，用 `node /tmp/mcp.js put`。
- **token 棘轮**：`npm run verify` 第二步 check-tokens 会拦下 var() 总数的变化。新增语义令牌引用是进步方向，把 `scripts/check-tokens.mjs` 的 `VAR_TOTAL_BASELINE` 上调，并在注释头补一句「日期 / CC / 原因」（CC-204 797→799）。
- **页面格式化要跟着结果走**：freeCompare 这类「先选参数再点计算」的页面，渲染结果时读结果自带的参数（`result.metricId`），不要读控件的当前值（CC-204）。
- **MCP `read_files` 会分页**：大文件（如 `src/mechanics/types.ts` 900+ 行）一次只返回前一段，要看 `has_more` / `next_start_line`。据此拉到本地改完再上传会**截掉文件尾**（第 226 轮踩过，esbuild 报「Expected */」）。大文件改动一律在 WSL 端用 python 精确替换。
- **测试判别力依赖两处口径不一致时**：修掉不一致，测试会变成「无判别力」而失败（CC-203 substatOptimizer 席德明攻）。改法是显式构造那个状态（强行勾上），不要回退修复。
- **截取引擎内部的 cfg/state 做同源测试**：`vi.spyOn(<模块>Mechanic, 'buildExecutions')` 可行（CC-202），拿 `spy.mock.calls.at(-1)[0]` 的 cfg/state 调预留或估时函数，再与实际行逐项比对。用完 `mockRestore()`。
- **（CC-201 修订：只迁有合轴的行——残差大本身不是理由，无合轴的行折叠结果与预留一致；滞后估计进账本还可能把单人推进截断，见 §24.48）** 模块前台行的时间通道选择（CC-200）：行次数 = 强特次数 ⇒ `estimateExSpecialTime`（按次估时，估时函数与产行共用一个纯函数）；次数来自其他资源 ⇒ `extraNecessaryAction`。两者都不做 ⇒ 时间靠 `timeBudgetExcess` 折叠追认，行上的**合轴抵扣会丢失**（苍角打年糕#3 就是这样多挤了 21s 平A池）。找对象看残差：插桩脚本 `/home/kaua/calc-arch/k222/p223inst.py`。
- **enrich 会按倍率表改写 `moveName`**：测试/探针里别用模块写的 moveName 认行（苍角两行 1131011 回填后都叫「扇走蚊虫 #1」），用 moveId + 出现顺序或 count/actionTime。
- **单角色 golden 的 slack 非零不一定是错**：合轴抵扣在单人时没有队友可让，只能留白（卢西娅 163.6、苍角 34.2）。组队影响要另用探针队看，golden 预设里没有的角色尤其如此。
- **按 `buff.ownerId` 找拥有者不可靠**：catalog teammate-buffs 里有拼音 slug（`youye` / `remielle` / `nangongyu`）。找拥有者用 buff 组 id（仅队友角色是 teammateBuffId）。CC-199 就是这么修出柚叶额外能力恒开。
- **合成队伍夹具必须给互异 slot**：额外能力等团队条件按 `m.slot === ownSlot` 排除自身，全 0 的夹具会让条件永远不满足（`teammateBuffDerivation.test.ts` 曾如此，CC-199 修）。
- **只查「已登记」的护栏看不见未登记者**：写完备性断言时从数据侧全员出发，不要从登记表出发（CC-199：`additionalGate.test.ts` 只遍历 `ADDITIONAL_GATE_BUFFS`，漏了 1351/1141）。
- **提交只 add 明确列出的文件，绝不用 `git diff --name-only` 批量取**（第 221 轮事故）：CC-198 代码提交 3d0217e3 这样取文件，把另一个 lane 在我开 worktree 之后才改的 `src/stores/config.ts`（默认队伍只初始化一次，配套测试未提交）一起提交并 push 了。已用 3cb3b846 在历史里撤回、工作区副本原样保留（备份 `/home/kaua/calc-arch/k221/config.ts.otherlane`）。以后提交前先 `git diff --cached --stat` 核对清单，和 worktree 里验证过的文件逐一对上。
- **模块在哪个阶段产行，展示层就读哪个阶段的行快照**（CC-198）：`preModuleExecutions` = buildExecutions 钩子看到的行（不含额外强特行等后物化行）；`prePatchExecutions` = patchExecutions 钩子看到的行。两者都是浅拷贝。golden 预设里有千夏队（6 支），zd 的 625 个预设里没有。
- **判断超预算别看 golden 的逐槽 front**（CC-197 订正 CC-196 的误判）：它是毛时间（necessary 按 GROSS 含合轴段），逐槽相加可以 > 180。要看 `buildTeamTimeSummary(...)` 的 `rowsNet` / `overflow` / `slack`（留白棘轮同口径）与 `rr.convergence.timeTruncatedSeconds`。
- **资源驱动的额外必做动作用 `extraNecessaryAction`**（CC-197）：时间进账本估计、可读 state、可返回多行、喧响不填就回落倍率表；不要在 buildExecutions 里推 necessary 行再靠折叠残差追认。
- **主工作区被其他 lane 弄坏时用 worktree 验证**（CC-196）：`git worktree add --detach /home/kaua/calc-arch/wtNNN HEAD`，再 `ln -s <repo>/node_modules wtNNN/node_modules`，拷入自己的文件后在里面跑 vitest / verify（bg.sh 会先 cd 到主仓库，所以命令里再 `cd wtNNN &&`）；golden 在 worktree 里重生成后，把 baseline 拷回主仓库再提交。
- **模块前台 necessary 行 + 回能 = 正反馈**（CC-196）：新增带倍率表回能的模块前台行，必须看 golden 的逐槽前台合计是否超过战斗时长；按 `state.basicAttackTime` 封顶只算自己那份池，均衡点约为自身池（等于系统性减半），见 §24.43。
- **按普攻段数命中**（CC-195）：普攻只有一条汇总行，要用 `basicComboCycleSeconds(skills, 段id)`（在 buildCharConfig 里取 skills 算好存进 cfg）加上 `basicSummarySeconds(executions)` 折算，不要 `SET.has(moveId)`。
- **模块钩子看不到的行**：额外强特行（`exSpecialPlans`）在 `buildExecutions` **之后**物化，只有 `patchExecutions` 看得到；装配期的 `preModuleExecutions` 是 buildExecutions 派发前的行。模块派生量不要回写 cfg 给装配期读（多 pass 下最后写入者赢），应在装配期用同一纯函数重算。
- **postRound 写入的是下一轮的 cfg**（CC-194 起）：`applyTeamConfig({phase:'postRound'})` 在**下一轮** converge 前、用上一轮收敛的次数对新克隆派发（`threads.postRoundInput`）。**本轮末尾**写 cfg 没有意义，`runCalcRound` 每轮都会从 `base.characters` 重新克隆。新增跨轮反馈，要么走 postRound，要么走 `nextRoundFeedback`；并检查 `outerFeedbackSignature` 是否覆盖了它的输入。
- **普攻恒为一条汇总行**（`moveId: 'basic_attack'`，按基准段秒均结算）：模块按普攻段 id 匹配时必须用 `execMatchesMove(exec, SET)`（`@/types/resource`），`SET.has(exec.moveId)` 碰不到它。基准段由 catalog `basicBenchmarkMoveId` 决定，缺省为第 3 个带 `#N` 的段；状态型主形态（爆发、烧血等）要显式配置（CC-193）。
- **新角色录入**：catalog 普攻段名不带 `#N` 时必须配 `basicBenchmarkMoveId`，否则普攻伤害为 0。`basicBenchmarkMatchCc193.test.ts` 的守卫会红（CC-193：赛维里安 / 菲欧妮就是这样漏的）。改 catalog 用 node 读入、改字段、再调 `scripts/lib/jsonio.mjs#writeJsonCompact` 写回，然后跑 `npm run minify:static`，最后按 JSON 结构比对确认只改了目标键。
- **开工前查裁决**：除了卡表，还要查 `docs/MECHANICS_IMPLEMENTATION.md` 各角色段的「已知缺口（用户裁决不做）」，以及测试里的「边界反锁」（`grep -rn 反锁 src`）。CC-193 就因为漏查，先改了安东爆发基准段又撤回。
- **只看「设置有没有效果」测不出整片失效**：CC-192 的动态普查说安东滑块无效，真正的原因要一路追到「生产行里根本没有对应招式行」。怀疑模块效果不生效时，先用 harness 打印生产执行行的 moveId（参考 `.zc/perf/moveids.perf.ts`）。
- **单测直接构造门控值，看不见生产接线**：`panel: { additionalAbilityActive: 1 }` 这类手写 cfg 会让模块测试永远是绿的，即使生产路径上从不置位（CC-192 安东）。门控类功能至少要有一条经由 harness（`setupHarness` + 真队伍）的行为测试，或者一条结构守卫。动态普查工具：`.zc/perf/sweep.perf.ts`。
- `bg.sh` 后台启动最稳的写法：`setsid ./bg.sh <名> '<cmd>' </dev/null; sleep 3; ls <名>.log`。第 215 轮两次省掉 sleep，进程都没起来。
- **查「字段有没有人读」必须连 JSON 一起查**：spec 解释器按字符串键读 cfg（`countField` / `initialValueField` / `enabledField`…，`src/specs/types.ts`），键名只出现在 `src/specs/agents/*.json`。`grep -rnw <字段> src` 默认会扫到 .json，但 `--include=*.ts` 会漏（第 213 轮就是这样漏的）。
- **zd 报差、但只改了数据文件里的展示字符串**（spec 事件 `note` / `fields`）时：把该文件临时换回 `git show HEAD:<path>` 版本再跑一次 zd，DIFF 0 就证明代码零差，然后放回新版本（CC-191）。展示字符串会进入结果哈希。
- 删掉一个角色的 `applyTeamConfig` 后，同步 `src/mechanics/__tests__/teamHook.test.ts` 的「已迁移角色必须声明 applyTeamConfig」名单。
- `git push` 单次可能要 50s 以上（第 213 轮实测）：别和 zc done / release 挤在同一条 wsl_exec 里，也别用 `timeout 90`。单独执行 `timeout 150 git push origin master`，推完用 `git rev-list --count origin/master..master` 确认结果为 0。
- 按名字的死通道扫描（`dead-channel-scan.mjs`）对常见名是瞎的：只要名字在别处被读过，就会被判「有读取」。查「某个字段到底有没有人读」要用符号级引用（`scripts/audit-write-only-props.cjs`，或 LSP 的 find references），再补一次名字兜底（.vue 和字符串键动态读取 TS 看不见）。
- 结构类型参数（`cfg: { foo?: number }`）让 TS 的 findReferences 连不到接口属性上：接口属性显示零引用，不等于零读取。
- 「往注册表加一行」式的 UI（freeCompare 的 AXES / METRICS 等）：加一项时必须同时有一条**真引擎行为测试**，证明选了它结果真的会变。只测「能枚举出档位」测不出假选项（CC-189）。
- freeCompare 求值器里，凡是依赖装配结果的量（血量等）都必须在装配之后读，不能在循环外预读（CC-189 env.hp）。
- 断言封顶时要选一个**越过**上限的输入：丽娜 x=72 算出来恰好 =30，上限写成 31 也测不出来（第 211 轮补了 x=80）。
- 删掉唯一使用者后，`vue-tsc -b` 会报 TS6192 / TS6196（导入或类型未使用），verify 不拦，要单独跑 vue-tsc。
- 死导出扫描（`k210/dx210.cjs`）按词边界数引用，前导 `.` 被排除，所以看不见 `ns.foo` 命名空间访问、`...foo` 展开和 `import.meta.glob`（第 210 轮因此误报 2 条）。结果里的「零引用」必须人工核对后再删。
- 删测试文件后 verify 的用例数会下降，属正常；交接里写清少了几个、来自哪里，下一轮才不会误判为测试丢失。
- 死通道扫描（`scripts/lib/dead-channel-scan.mjs`）按行识别字段写入：把 `critRateCap: 200` 压进单行对象字面量 `{ stats: [...], critRateCap: 200 }` 会被判成「只读不写」，报红（第 209 轮踩过）。可选字段的赋值保持独占一行。
- 判断「某个分支 / 设置是否有用户」时，先查写入点再谈迁移：CC-173（第 198 轮）花了一整轮论证整队贪心「迁移得不偿失」，其实它从引入起就不可达（CC-186）。查法：`grep -rn "'<key>'" src public scripts`，再加 `git log -S'<key>'`。
- 删 UI 会让 `scripts/check-tokens.mjs` 的 alias ratchet 报红：`VAR_TOTAL_BASELINE` 是「≥」型棘轮，删样式时 var() 总数下降会被误读成「改回了字面量」。纯删除时两个基线（WA_REF / VAR_TOTAL）照实下调，并在注释里写明归因（第 209 轮：447→437 / 808→797）。
- `src/core/__tests__/calcPanelCallContract.test.ts` 的 KNOWN 清单记着每个文件的 calcPanel 生产调用点数；删掉调用点也要同步清单（第 209 轮删了 config.ts 那一项）。
- 用脚本删 .vue 模板块时，要连同该块自己的闭合标签一起删：`npx vue-tsc -b` 和 vitest **都查不出**多出的 `</div>`，只有 verify 末尾的 vite build 会报「Element is missing end tag」（第 209 轮 MarginalUtilityCard 踩过）。改了模板就先单跑 `npx vite build`（约 10s）。
- vitest 捕获的 console 输出里，数字前会插 ANSI 色码（`ZZEV \x1b[33m6`）。grep 数字前先 `sed 's/\x1b\[[0-9;]*m//g'`（第 208 轮踩过）。
- 优化器改动一律用实伤探针验收（`k206/probe2.sh`，REFINE=1 开精修），不要只看打分函数：CC-183 里「更符合游戏口径」的面板改动在打分上合理，实伤反而变差。
- **改完 docs 也要跑 `npx vitest run src/scripts/__tests__/checkGuards.test.ts`（约 25s）**：它读 `docs/ENGINE_PIPELINE_GUIDE.md`，§4（`## 4.` 到 `## 5.`）行数有棘轮（冻结 718），多一行变红，少一行也红（要求结算登记表）。改 §4 一律就地改写、净增 0 行。第 203 轮把 verify 放在文档提交之前，漏了这一点。
- core 输入加可选字段前先想：缺省会不会静默改变结果？会就做成必填（CC-179 判据）。普查可复用 `/home/kaua/calc-arch/k202/scan179.cjs`。
- 「上一位 / 下一位队友」一律用 `resolveTeammateTargetSlot(编队槽, 已上场槽位, 设置)`（CC-180）：已上场槽位在引擎取 `configs.map(c => c.slot)`、编排层取资源结果 `characters.map(c => c.slot)`、模块钩子取 `team.filter(m => m.agentId && m.agent)`。不要用 `team.length` 或 `% 3`：`configStore.team` 和机制 `team` 都是定长 3 槽、含空槽。`configs` 下标和编队槽位只在满编时相同，存槽位的字段（如 `axisUltimatePromote.targetSlot`）进引擎要 `findIndex(c => c.slot === …)` 映射。
- `bg.sh` 后台启动要写成 `setsid ./bg.sh … >/dev/null 2>&1 & sleep 1; echo started`：少了 `sleep 1`，外层 shell 立刻退出会带走子进程（第 203 轮踩过）。
- zd 的 dump 第 2 段是整个 `resourceResult` 的哈希：**删 / 改名结果对象字段**会让几乎所有预设 DIFF，即使数值零差。用 `ZD_DROP=<键1>,<键2> bash .zc/perf/zd.sh <tag>` 在两边都排除这些键再比（第 201 轮加在 `.zc/perf/dump.perf.ts` / `rowsnap.perf.ts` 第 26 行的 `KEY_DROP`；`.zc/` 不进 git，若被重置，就把 `...(process.env.ZD_DROP ?? '').split(',').filter(Boolean)` 重新加回那个 Set）。先用逐段统计确认只有第 2 段变，再用 ZD_DROP 证明零差。
- `git mv` 过的文件，提交时 `git add` 只写新路径（旧路径已不存在，写上会让整条 add 失败）。
- 伤害池伤害一律走 `src/composables/resourceCalc/poolDamage.ts`（CC-176 / 177）：直伤 `calcPoolDirectDamage`、异常 `calcPoolAnomalyDamage`。新环境量加进 `PoolDamageEnv`，新行级字段加进对应 Row；模块里用 `ExtraAnomalyRowsInput.directDamage` / `.anomalyDamage`，不要 import core 伤害函数自拼（自拼就会漏掉正路后加的量，比如侵染染色属性）。异常行的减防减抗只传面板**之外**的额外量。
- 查「某字段全仓零写入」时，不要用会命中赋值右侧的排除模式（第 200 轮用 `grep -v 'enemy\.'` 滤噪音，把 `battleTime: configStore.enemy.battleTime` 这类写入行也滤掉，差点误报）。先无过滤搜 `字段名:`，再看构造点。
- 伤害函数契约：`calcDirectDamage` 由调用方传面板通用减防 / 减抗；`calcAnomalyDamage` 由函数内读结算面板，调用方只传额外量。新写旁路伤害调用要照对应契约，写反就会双计或漏计（CC-175）。
- 伤害变化的基线更新：timeGolden 用 `TIME_GOLDEN_UPDATE=1`。更新前先 `git diff --numstat` 基线文件，确认只有 `dmg` 行变化、没有时间账变化；断言报错信息只列部分条目，不要据此判断全貌。
- calcPanel 的 config 可选字段（`potentialLevel` / `effectCoverageMap` / `sourcePanelsByOwner`）漏传不会报错，会被缺省值静默兜底（CC-171 就是这么漏的）。新增调用点对照 `computePanelPhases` 逐项核对，有意不传的写注释。
- 给 calcPanel 组装队友 buff 输入，一律走 `resolveSlotPanelBuffInputs`（`composables/resourceCalc/panelPhases.ts`）。直接用 core `buildTeammateBuffSourceContext` 的原始 `enabledTeammateBuffs` 会缺门控、接收槽过滤、全局 Buff、覆盖率和来源修正（旧包装 `teammateBuffSourceContextFromStores` 已于第 195 轮删除）。
- 删 src 文件要用 `git rm`：判据 25 用 `git ls-files` 列文件，工作区已删、索引还在的文件会让 CG 直接 ENOENT 崩溃。
- 面板字段写在局内对象上时，想想局外对象上是否也该有同一个值（第 194 轮 `energyRegenOutOfCombat`）。
- 6 命原文里的「虹之终幕 / 瞬逝优雅」就是垂虹 / 惊鸿（英文名的另一译法），catalog 里没有这两个招式名。写「某载体未建模」之前先查招式 id。
- 初值不要按字段名里的 Multiplier 猜：看 catalog effect id（`*_bonus`）和模块读法（`1 + x` ⇒ 初值 0）。
- 手改 `public/static/*.json`（比如状态表）后要跑 `npm run -s minify:static`：verify 的 data check 要求紧凑 JSON，数组里的 `", "` 空格就会让它红。
- 模块给异常池能力传角色参数的唯一写法：模块 `applyPanel` 读 `input.settings[id]` 盖章到自己的面板字段，能力函数读回；不要给 `AnomalyPoolInput` 加角色专属字段。
- 滑块探针断言要用逐点闭式（带当点的实测读数），不要断言跨点严格比例：有反馈时读数会漂移（维琳娜：风化 8 → 7 次）。
- 口径钉的唯一写法：用例内 `config.setMechanicSetting('time.stunPlanProjection', 0)`，放在读取任何 `calc.*.value` 之前。
- 展示层禁止值导入 `@/core` / `@/mechanics` / `@/specs`：新诊断要经 `useResourceCalc` 暴露。
- 全量测试在高负载下会偶发失败，单跑或在 verify 里能通过：`zcWorkspace.test.ts`，以及 `deadChannelLs.test.ts` / `zcDeadChannels.test.ts`（耗时断言 `ms < 60000`，第 192 轮实测 67.9s）。
- 远端 bash 会执行 heredoc 中的反引号：代码和文档一律写成 .py 文件，用 `node /tmp/mcp.js put`（或沙箱里现有的 up.sh）上传后执行。

## 3. 执行卡（输入输出写死的机械活，可交给执行模型或 dsh；第 368 轮新增本节）

> 用法：§0 的派发脚本按 `<!-- card:ID -->` 抽卡面。**卡面就是全部上下文**，执行者不需要读别的文档。
> 做完：主代理按 §0 复核（真实 diff、vue-tsc、相关测试）→ 提交 → 删卡，在 §2b 留一行「T? 完成 `<commit>`」。
> 写卡标准：改哪几个文件、改成什么样、怎么验收、不许碰什么，都写死；需要判断的活不写成卡。

（当前无待办执行卡；T1、T2 已于第 370 轮 `0c5e00cb` 完成）
