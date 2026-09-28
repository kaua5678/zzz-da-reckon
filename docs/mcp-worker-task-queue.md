# 交接与执行纪律（活文档，原「低级模型任务队列」）

> **本文件现在只放四样东西**：置顶顺序、§0 执行纪律、§1 长期规则、§2 最近一轮交接和已知坑。
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

- **登记债务、豁免或改 burn-down**：改 `scripts/lib/guard-registries.mjs`，不要改 check-guards 本体（CC-85）。
- **改角色机制实现的提交**：顺手 grep `public/static/character-mechanics.json` 和 `character-constellations.json` 里该角色的 pending，过时就同步改。状态表过时的根因，就是实现提交没回写（CC-89）。
- **新增 `record.<key>` 读取**：必须同时有写入方（buildCharConfig 或编排层注入），否则判据 25 会红（CC-91）。
- **文档提交之后至少再跑一次 `node scripts/check-guards.mjs`**：docs 里以 `@fact ` 开头的散文会被解析成 fact 声明（CC-93）。
- **drift 复核**：要看从原始口径日期到现在的全部改动（`git log <原始据日期>..HEAD -- <锚文件>`），不要只看上次 `·复核@` 之后的。另外，有些条目的竖线前没有空格（`·复核@2026-09-25| 验`），不要把戳打进「验」或「锚」段（CC-87）。
- **`src/views/TeamComparePage.vue` 只剩约 38 行结构熵余量**：给该页加功能，写到 `src/composables/teamCompare*.ts`（CC-92）。
- **等号基线（「计数下降也报错，要求下调基线」）是有意设计，不要改成「≤」**：2026-09-14 它两次抓到扫描器盲区，计数凭空下降其实是扫描器看不见了，而不是代码变好了（`scripts/check-tokens.mjs` 头注释；`docs/mcp-working-model.md` §2.5）。

## 2. 最近一轮交接（每轮替换本节）

**第 206 轮（lane lead-arena-0925c）：CC-183 完成（20a47df3）；立卡 CC-184。文档见本提交。**
- CC-183：副词条优化器改为「引擎近似给起点，真实伤害挪步精修」（编排层 refine 参数，ImpactChart 已接入）。62 个角色平均 +2.96% → +4.85%，36 升 0 降。候选 ① 和 ①′ 都更差，已写「不做」加数据，见 stun-dual-source §24.30。
- 前几轮：205 CC-182（85956a53）；204 CC-181（e0fdf806）；203 CC-180（7f320498）。
- REQUIREMENTS 无新条目；提示词未改（md5 2aa1f517）。

**下一步（按顺序，直接开工）**
1. **CC-184：优化器最差个例 1611（比推荐副词条低 25%）**。
   - 跑法：`REFINE=1 /home/kaua/calc-arch/k206/probe2.sh /home/kaua/calc-arch/k206/<out>.tsv`（输出路径必须是绝对路径，脚本会先 cd 到仓库；约 18 秒）。对比：`node /home/kaua/calc-arch/k206/cmp.cjs <base.tsv> <cand.tsv>`。当前基线是 `k206/c2r.tsv`。
   - 先看推荐配装里 1611 的副词条和步数（`recommendedBuild`），和 `getTemplate` 的 stats 以及 totalSteps 对比。
2. 可选：store 整队贪心（config.ts:~802，`optimizer.useDefault=0`）还没精修。store 不能依赖 composables；如果要做，把 readDamage 从调用方注入。
3. CC-166 仍暂缓（需规格）。

**已知坑**
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
- 远端 bash 会执行 heredoc 中的反引号：代码和文档一律写成 .py 文件，用 up.sh 上传后执行。
