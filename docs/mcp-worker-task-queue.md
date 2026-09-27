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

### 第 168 轮（2026-09-28，代码 `47869b28`（CC-144 零差准备）+ 文档提交「docs: round 168」；上一轮 = 44bc4c67 / 4f50c8b0）

- **做到哪**：
  - CC-144 试切 physical 默认，**结论不切**。全量 33 红，分四类：A 不变量破缺 2 条（阻塞）、B 测试写法 1 条（已修）、C 基线 3 条、D 数值钉 27 条。清单见 `docs/mcp-stun-dual-source.md` §9，日志在 WSL `/home/kaua/calc-arch/k168/vitest-default4.log`。
  - 落地零差准备：`src/core/stunPlanProjection.ts` 新增 `DEFAULT_STUN_PLAN_PROJECTION_CODE: number = 0`；`useResourceCalc.ts` 与 `calcOutputMemo.test.ts` 都读它。验证：zd `cc144prep` DIFF 0；verify195 EXIT=0；calcOutputMemo 在常量改成 4 时反向验证 6/6 通过。
- **下一步（按顺序，可直接开工）**：
  1. **CC-145：叶瞬光队赠行单一口径**。复现：临时把 `DEFAULT_STUN_PLAN_PROJECTION_CODE` 改成 4，跑 `npx vitest run timeLedgerInvariants outerCycleColdStart`（期望红：auto-1431-1481-1491 / -1341 账本 5.000 ≠ 赠行 4.000；叶瞬光 giftForms 3→4）。在 `src/mechanics/agents/yeshuguang.ts` 里找「按失衡次数乘」的赠送量，看它读的是 `stunCount`（计划值）还是 `countStun`；对照 `core/resource/tailPipeline.ts` 第 209 行（账本）与 `resourceCalc/ultimatePromote.ts` 第 107 行附近（装配）各读哪个。修成都走 `countStun`；off 下必须零差（zd）。
  2. **CC-146：auto-1591-1571-1211 种子不变性**。复现：同样临时改成 4，跑 `npx vitest run seedInvariance`。先确认是不是「首轮没有 prevPoolStunCount 回落计划值」造成的：把首轮回落改成用种子对应的物理次数估计，做原型比较。不许放宽闸门。
  3. 两张卡都绿之后，重做 CC-144：常量改成 4，逐条处理 D 类（测机制的用例显式钉 0，测缺省产出的更新期望值并写原因）；重生成两份基线；重新考虑难度阶梯 G4（§9.4 末条）；按 §8.4 做 104 队分类表（探针草稿 `k168/zzK168.test.ts`，没跑过，先校正字段名）。
  4. 洛克茜 `energyRegenOutOfCombat`；副词条优化器接入接收槽过滤（低优先）。
- **本轮拍板**：
  - 不切默认。依据：不变量破缺没有解释空间（第 167 轮交接第 4 条）。回退点：无（缺省未动）。
  - 缺省编码收成单一常量，零差。回退点：`git revert 47869b28`。
- **已知坑**（新增）：
  - `export const X = 0` 会被 TS 收窄成字面量 `0`，测试里写 `X === 2` 时 vue-tsc 报 TS2367；要显式标注 `: number`（vitest 不做类型检查，只有 verify 的 build 阶段会报）。
  - 难度阶梯的「全关」写死 0 是有意的（阶梯语义），别顺手改成读缺省常量。

### 第 167 轮（2026-09-28，代码 `44bc4c67`（CC-142）+ 文档提交「docs: round 167」；上一轮 = 98693cac / 68bd9d0c）

- **做到哪**：
  - CC-142 结清（`docs/mcp-stun-dual-source.md` §8）：残余 6 队全是轴模式。4 支希希芙队 = 轴数据没写连携（不是缺陷，`stunPlanAxisWindows.test.ts` 钉住）；2 队 = 轴内块次数分窗仍读计划值，已改为 `countStun`（`src/composables/resourceCalc/convergence.ts` 四处）。off 零差（zd `cc142` DIFF 0）。
  - 探针存档 WSL `/home/kaua/calc-arch/c167/`。
- **下一步（可直接开工）**：
  1. **CC-144：切 physical 为默认**。引擎阻塞项已清空，剩切换本身。
     - 找缺省：`timeout 40 git grep -n "stunPlanProjection" -- src/stores src/data src/types`，把 `time.stunPlanProjection` 的缺省编码 0 改为 4。先**只改缺省、不提交**，跑 `bash .zc/perf/zd.sh cc144`、`npx vitest run timeGolden timeFillRatchet` 看变化面。
     - 逐队解释：用 `c167/zzC167.test.ts` 的写法（两模式对比，含失衡连携秒数 / 超预算 / 截断 / 外层退出 / 总伤）出全表，按原因分四类：a) 计数通道补回连携（off 下失衡连携 0 或偏少）；b) S3 降配档变化；c) 外层退出变化（stable↔cycle）；d) 物理次数变化。每类给队数和代表队；c 类逐队看（已知 `yixuan-trigger-lucia`）。
     - 然后改 `stunPlanPhysical.test.ts` 的缺陷钉（缺省下也应有失衡连携），`TIME_GOLDEN_UPDATE=1` / `TIME_RATCHET_UPDATE=1` 重生成两份基线，全量 verify。
     - 若 c 类（cycle 增加）或某一类解释不通：不切，写明原因，保持可切换模式。
  2. 洛克茜 `energyRegenOutOfCombat` 读法疑点；副词条优化器接入 `applyTeammateBuffRecipientFilters`（低优先）。
- **本轮拍板**：
  - 希希芙单 C 轴 0 连携按轴数据口径处理，不改轴。依据：轴 note 明确列出窗内动作；「数据本身可信」（R5 硬约束）。若日后认为轴应补连携，改 `src/data/stunAxisPresets/希单c.json` 并同步改钉测试。
  - 计数用途分窗读 `countStun`，时间用途（决算截断、窗内积蓄）保持计划值。依据：`core/stunPlanProjection.ts` 的语义边界「投影不回灌时间账」。
  - 「有失衡没连携」验收修订为「除轴里没写连携块的队外为 0」。
- **已知坑**（新增）：
  - `convergence.ts` 里 `allocateAxisWindows(resolvedAxes, stunCount)` 有 6 处，锚文本不唯一；改哪处要带上相邻的唯一行做锚。
  - `c167/hook167.py` 会把当前 `convergence.ts` 备份到 `/tmp/cc142/convergence.ts.orig`，覆盖旧备份；恢复一律用 `git checkout -- <文件>`，别信那个备份。

### 第 162 轮（2026-09-28，文档提交「docs: round 162」，无代码；上一轮 = 30daa4b1 / 76a5aff6）

- **做到哪**：
  - 第 161 轮下一步第 1 项「坑 25 双源」已完成测量，结论写在 `docs/mcp-stun-dual-source.md`，卡表记为 CC-138（调研）。
  - 去掉外层第二次折算的原型**不落地**；`stunCountContinuous` 字段**不提交**（没有消费者）。
  - 主因定位：外层必要时间约束（`solveTeam.ts` 约 210–218 行）决定了 78/104 队的规划失衡，其中 17 队为 0。
  - 探针和补丁存档在 WSL `/home/kaua/calc-arch/dual162/`（用法见专项文档 §1）。
- **下一步（按顺序，可直接开工）**：
  1. **拆窗口内必要时间**（专项文档 §3 第 1 步）：在 `zzDual162.test.ts` 探针里从物化执行行求 Σ连携 / 终结技时长，得到 inWindow，算 `capNet` 并统计 78 队和 17 队的变化。只测量。若足以解释差距，按 §3 第 2 步开 CC 卡改约束。
  2. 洛克茜 `energyRegenOutOfCombat` 局内 3.12 / 局外 1.2 的读法疑点（§2.18 第 159 轮补充最后一条）。
  3. 副词条优化器接入 `applyTeammateBuffRecipientFilters`（低优先；`src/stores/config.ts` 约 819–861 行）。
- **本轮拍板**：
  - 原型不落地。依据：第 161 轮自定的落地条件（cycle / maxIter 明显减少）不满足，而且没有触及主要差距。回退点：无代码改动。
  - 坑 25 归因更正已追记到 ENGINE_PIPELINE_GUIDE，原文保留，只在后面追加。
- **已知坑**（新增，其余沿用第 161 轮）：
  - wsl_exec 只回传约 9KB 尾部，104 行的 tsv 拉回本地会截断，要在 WSL 里用 python 分析（`/home/kaua/calc-arch/an162*.py`）。
  - 判断规划失衡由哪一道约束决定时，容差要用 0.06 左右（外层判稳容差是 0.05）；用 2e-3 会把 80 队误判为「其他」。

### 第 161 轮（2026-09-28，测试 `30daa4b1`（CC-137）+ 本文档提交；上一轮 = 3adb3620 / ef6ecce6 / 2a57b241）

- **做到哪**：
  - 第 160 轮下一步第 1 项「第二种不连续」已结案：物理失衡次数的整数台阶，不修。trace、全曲线核对和判据修订见 `docs/mcp-outer-fixedpoint-continuity.md` §5。
  - 护栏 `src/composables/__tests__/outerContinuity.test.ts`（CC-137），零数值变化。
- **下一步（按顺序，可直接开工）**：
  1. **坑 25 双源：规划失衡 vs 物理次数**（ENGINE_PIPELINE_GUIDE 坑 25「已知残差」和第 177 行；专项文档 §5.3）。本轮已拍板：先量后定，只做测量、不改数值。
     - a) `promoteFixpoint`（`src/composables/resourceCalc/ultimatePromote.ts` 第 259 行；闭式 N* 在约第 332 行）目前只返回 `floor` 后的 `stunCount`。给 `StunPoolResult`（`src/types/resource/pools.ts` 第 37 行）加可选字段 `stunCountContinuous`（= N*），零差，用 zd 验 DIFF 0。
     - b) 探针原型（不提交）：`solveTeam.ts` `runOuterLoop` 里 `next = rawNext * (1 - coverage)`（约第 199–209 行）改成 `next = stunPool.stunCountContinuous`，再保留原来的时间可行截断。跑 zd，记录 125 队的规划失衡、物理次数、总伤和留白变化，以及外层 stable / cycle / maxIter 的比例变化。预期不动点更容易存在，cycle 变少。
     - c) 结论写进新文档 `docs/mcp-stun-dual-source.md`（登记 README §6 → 65 份）：选哪个口径、依据、影响面、回退点。只有「cycle / maxIter 明显减少，且变化能逐队解释」时才落地为 CC 卡。禁止用「更接近投稿」当理由。
  2. 洛克茜 `energyRegenOutOfCombat` 局内 3.12 / 局外 1.2 的读法疑点（§2.18 第 159 轮补充最后一条）。
  3. 副词条优化器接入 `applyTeammateBuffRecipientFilters`（低优先；`src/stores/config.ts` 约 819–861 行）。
- **本轮拍板**：
  - 连续性验收判据改为「同物理次数的相邻跳变 ≤1%」。依据：唯一剩下的大跳变是 floor 台阶；原判据会逼人抹平真实的整数效应。回退：恢复原判据，那就得去改 floor 口径，而这与 CC-134 / CC-135 冲突。
  - 护栏选琉音 c6 而不是扳机例：当前代码下扳机例已连续，而琉音例反向验证能红，护栏才有活性。
- **已知坑**（新增，其余沿用第 160 轮）：
  - 外层轮次历史没有对外暴露；诊断要靠临时 trace 钩子（做法见专项文档 §5.1），用完 cp 恢复并 `git diff` 确认。
  - 扫描不必关心轮数：20 轮 maxIter 在这里只是伴随现象，要看的是 `stunPoolResult.stunCount` 是否变化。

### 第 160 轮（2026-09-28，代码 `3adb3620`（CC-136）+ 文档 `ef6ecce6` + 本回填提交；上一轮 = 0028eb01 / 8e46f748 / e4cbfc51）

- **做到哪**：
  - 外层不动点连续性专项第 1 刀已落地（CC-136）：环内选点改为逐级筛选 + ③′「`stunIn` 小者」，与检出相位无关。全过程、扫描数据、逐条影响见 `docs/mcp-outer-fixedpoint-continuity.md`。
  - 琉音例（`auto-1201-1481-1211` c6）已连续；扳机例在当前代码下本来就连续（CC-135 后），在连续版 trigger.ts 下 7 轮段已连续。
- **下一步（按顺序，可直接开工）**：
  1. **第二种不连续：20 轮长周期段**（专项文档 §5）。
     - 复现：`git show 0028eb01~1:src/mechanics/agents/trigger.ts` 临时覆盖 `src/mechanics/agents/trigger.ts`，扫 `auto-1201-1361-1211` 槽 0 的平 A 权重 w 1.04–1.07（步长 0.005）；w 1.05→1.055 规划失衡 2.2228→2.2190，伤害 −2.9%。扫完 `git checkout -- src/mechanics/agents/trigger.ts` 并 `git diff` 确认干净。
     - 或者不改代码：`yixuan-jufufu-lucia` 默认就是 20 轮 maxIter，给 1371 的某个 spec 数值做 ±1% 扫描。
     - 诊断：两点逐轮打印 (stunIn, rawNext, next, 签名, 各槽计数)，比对 `findOuterLongCycleLag`（`outerCycle.ts` 约第 135 行）命中的 lag 与环成员集合；嫌疑是「从 lag=3 起取第一个命中」在两点命中不同的 lag，或环成员在失衡以外的反馈状态不同。
     - 验收：扫描曲线相邻跳变 ≤1%，不靠放宽容差；三份基线变化逐条解释。
  2. 洛克茜 `energyRegenOutOfCombat` 局内 3.12 / 局外 1.2 的读法疑点（§2.18 第 159 轮补充最后一条）。
  3. 副词条优化器接入 `applyTeammateBuffRecipientFilters`（低优先；`src/stores/config.ts` 约 819–861 行）。
- **本轮拍板**：
  - ③′ 取 `stunIn` 小者而不是严格时间差最小：后者对 1e-3 级噪声敏感，等于掷骰子；前者稳定，且不高估失衡收益。代价：`auto-1431-1341-1031` 留白 2→3.2s（同级容差内），已重生成棘轮基线。
  - 两两比较改为逐级筛选：两者在 zd 全部预设上逐位相同，筛选版额外保证长周期旋转不变。
  - yixuan 语料期望 1→0：按容差语义合规；旋转不变测试只断言「容差等价」，全同级成员走 ③ 是已知残余。
- **已知坑**（新增，其余沿用第 159 轮）：
  - zd 看不到 timeGolden 独有的预设（本轮 auto-1021-1481-1341、auto-1591-1161-1311 只在 timeGolden 出现），改外层逻辑必须同时重生成并用 tgdiff 核对 timeGolden。
  - 规划失衡在同一个环里换成员时，伤害方向不固定（整数化 + 窗口装配），不要按「失衡变小 ⇒ 伤害变小」去验。

### 第 159 轮（2026-09-28，代码 `0028eb01`（CC-135）+ 文档 `8e46f748` + 本回填提交；上一轮 = ece87d0c / 2843ee97 / 68093b01）

- **做到哪**：
  - **CC-135**（`0028eb01`）：「每超过 N」floor 第二批，6 处由连续改为整步：青衣、扳机、柚叶公式、爱芮影画1、克拉蕾、洛克茜。§2.18 表内已无待改项。
  - §2.18 的两条待查已结：莱特 C6 本来就是 floor；爱芮 / 薇薇安「每 10 点 → 异放比例」判定不属本规则，保持连续，理由见 §2.18 第 159 轮补充。
  - 验证：zd `cc135` 已逐条归因（卡表 CC-135）；零差的 3 人用探针确认了原因；timeGolden 2 叶已重生成；verify184 EXIT=0（3790 passed | 29 skipped）；文档提交另跑 verify185。
- **下一步（按顺序，可直接开工）**：
  1. **外层不动点连续性专项**（新开文档 `docs/mcp-outer-fixedpoint-continuity.md`，同一提交登记到 README §6）。
     - **问题**：输入的微小变化让结果大幅跳变。两个复现：
       - 琉音例：`auto-1201-1481-1211`，槽 0 设 6 命。琉音冲击 208.8 → 208 时，`plannedStunCount` 0.70 → 1.12，总伤 +5.34%。
       - 扳机例：`auto-1201-1361-1211`，槽 0 设 0 命。`plannedStunCount` 2.98 → 2.34，总伤 −1.74%。
     - **第 1 步（只测量，不改代码）**：扫描曲线。探针模板在本地 `/home/user/w/up/zzProbe158.test.ts`，环境变量 `PROBE_PRESET`、`PROBE_C` 控制预设和命座；放到 `src/composables/__tests__/` 跑，用完删掉。
       - 扫描方法：在探针里直接改内存中的 spec 对象，例如把 `getAgentSpec('1481').attributeConversions[0].valuePerStep` 从 1.90 扫到 2.10，步长 0.005。
       - 每点记录：总伤、`resourceResult.plannedStunCount`、`convergence.outerRounds`、外层退出方式（stable / cycle / maxIter）、`stunPoolResult.totalStunBuildUp`。
       - 预期能看到分段常数加跳变。记下跳变点，以及跳变前后的退出方式。
     - **第 2 步（诊断）**：外层循环在 `src/composables/resourceCalc/solveTeam.ts` 约 177–240 行。嫌疑按优先级排：
       - a) `rawNext = stunPool.stunCount` 是向下取整的整数（ENGINE_PIPELINE_GUIDE 第 145 行：答案 = floor(有效总失衡 ÷ boss 失衡值)），外层映射因此本身不连续。
       - b) `maxFull = Math.floor(stunEffTime / stunWindowDur)` 的截断。
       - c) 二周期判定加 `pickCanonical` 选点：选到环里的哪一个成员，取决于路径。
       - d) `OUTER_STUN_TOLERANCE` 提前收敛。
       - 在跳变点两侧打印每轮的 (stunCount 输入, rawNext, next, 签名)，定位是哪一条。
     - **第 3 步（出方案，逐个跑 zd）**：候选方向包括外层映射用连续的失衡次数估计、只在发布时取整、固定选点规则、加阻尼。
       - 验收判据：输入扰动 ε 时输出变化有界，即在扫描曲线上不再出现超过 1% 的跳变，而且不靠放宽容差实现。
       - 禁止用「更接近投稿」当理由；timeGolden、timeFillRatchet、seedInvariance 的变化都要逐条解释。
       - 历史背景：`docs/mcp-outer-feedback-regression.md`（二周期判环的相位修复）。
  2. 洛克茜 `energyRegenOutOfCombat` 局内 3.12 / 局外 1.2 的读法疑点（§2.18 第 159 轮补充最后一条）。
  3. 副词条优化器接入 `applyTeammateBuffRecipientFilters`（低优先；`src/stores/config.ts` 约 819–861 行）。
- **本轮拍板**：
  - 爱芮 / 薇薇安异放比例保持连续：比率句式不是分步句式，依据和回退见 §2.18。
  - 洛克茜攻击去掉 `Math.round`：floor 之后步数是整数，乘 5 仍是整数，`Math.round` 已经多余。
  - 下一步第一优先从「数据口径」换成「求值器连续性」：两轮连续出现由求值器引起、与改动本身不成比例的跳变（+5.34%、−1.74%）。不解决它，以后每一张数值卡的 zd 归因都会被它污染。
- **已知坑**（新增，其余沿用第 158 轮）：
  - zd 里「输入变小、伤害却大幅变化」先查 `plannedStunCount` 和外层轮数，§2.18 已记两例。
  - teammate-buffs 公式求值器（`src/core/buff.ts` 约 591 行 `evalFormulaExpression`）用 JS `Function` 执行，作用域只有 `clamp`、`floor`、`max`、`min` 和变量 `x`、`s`、`p`。字符白名单允许字母，所以 `1e-9` 能用；写其他函数名（如 `round`、`abs`）会抛异常，被捕获后**静默返回 0**。

### 第 158 轮（2026-09-28，代码 `ece87d0c`（CC-134）+ 文档 `2843ee97` + 本回填提交；上一轮 = df8523f9 / 366212b7 / 057f0c3b）

- **做到哪**：
  - **「每超过 N」取整口径定了：统一 floor 整步**。依据、全量清单（26 条机制、实现位置、现状）写在清单 §2.18。
  - **CC-134**（`ece87d0c`）：spec 里 4 条 `stepRounding: "none"`（简 / 琉音 / 南宫羽 / 普罗米娅）回到缺省 floor；verifications 按 floor 重算。`src/specs/types.ts`、`src/specs/template.json`、`liuyin.ts` 的注释同步写明新口径（新录入不要写 none）。
  - zd、timeGolden 的逐条归因见卡表 CC-134 与 §2.18。
  - 验证：verify181 EXIT=1，唯一失败是 seedInvariance 活性自检，归因和改写见 §2.18 末段；改写后 verify182 EXIT=0（3790 passed | 29 skipped）；CG 25 项通过；文档提交另跑 verify183。
- **下一步（按顺序，可直接开工）**：
  1. **CC-135：模块和公式里剩下的 6 处连续实现改成 floor**（§2.18 表中标「CC-135 待改」的行）：
     - `src/mechanics/agents/qingyi.ts` 约 127 行：`over` 改为 `Math.floor(over + 1e-9)`。
     - `src/mechanics/agents/trigger.ts` 约 212 行：`overCrit` 同上。
     - `public/static/teammate-buffs.json` 柚叶 `1411.additional_ability.anomaly_damage_bonus`：公式改为 `clamp(floor(max(0, x - 100) + 1e-9) * 0.2, 0, 20)`。先确认公式求值器支持 `floor` 和 `max`（照、莱特的公式已在用）。改前断言「读→写」逐字节还原。
     - 爱芮影画1：`src/composables/resourceCalc/damagePool.ts` 约 260 行，`max(0, mastery - threshold)` 外套 floor。
     - `src/mechanics/agents/claret.ts` 195 行：`initialCritDmg` 改为 `Math.floor(initialCritDmg + 1e-9)`。
     - `src/mechanics/agents/roxy.ts` 305–306 行：`regen / 0.01` 改为 `Math.floor(regen / 0.01 + 1e-9)`，攻击去掉 `Math.round`。注意 0.01 的浮点问题，例如 1.23 − 1.2 = 0.0299999…，所以一定要加 1e-9。
     - 每处跑 `bash .zc/perf/zd.sh <tag>` 并逐条归因。遇到「输入变小、伤害大涨」按 §2.18「已知坑」先查 `plannedStunCount`。两份时间基线逐条解释后重生成。
  2. §2.18 两条「待查」：莱特「每超过 1 点冲击力，火焰冲击倍率 +5%」的实现；爱芮 / 薇薇安「每 10 点掌控 / 精通 → 异放比例」要先核薇薇安原文措辞，再决定是否 floor。
  3. 副词条优化器接入 `applyTeammateBuffRecipientFilters`（低优先；`src/stores/config.ts` 约 819–861 行）。
- **本轮拍板**：
  - 取整口径选 floor，依据见 §2.18 四条。可逆性靠保留 `stepRounding` 字段和逐条回退。
  - 分两批：先做只改数据的 spec 四条（CC-134）；模块和公式六处留给 CC-135，每处都要单独归因。
  - `seedInvariance` 活性自检改写（§2.18 末段）：旧判据靠浮点噪声变绿，按 R8「已成形式的判据直接改」处理，新判据做了反向验证。
  - `auto-1201-1481-1211/c6` 的 +5.34% 不算 CC-134 的错：它是外层不动点路径依赖，已记为已知坑，不在本卡修。
- **已知坑**（新增，其余沿用第 157 轮）：
  - spec JSON 的 note 里**不要写未转义的双引号**。第 158 轮写入 `"stepRounding": "none"` 字样导致 JSON 解析失败，zd 的 after 两路 rc=1，报 ENOENT 找不到 after.json。zd 出现 ENOENT 时先看 `/home/kaua/calc-arch/zd-<tag>-dump-after.out`。
  - zd 的 dump 只有哈希；要看细节就用探针（§2.18 末尾）。

### 第 157 轮（2026-09-28，代码 `df8523f9`（CC-132）+ `366212b7`（CC-133）+ 文档 `057f0c3b` + 回填 `5da9f22c` 及其修正提交；上一轮文档 = 7090a58d / 77212f3e）

- **做到哪**：
  - **队友 buff 数值与原文对账完成**（清单 §2.17）：106 个数值字段只有 1 条对不上；15 个 formula 的常数逐条核过，都是推导值。
  - **CC-132 柚叶**（`df8523f9`）：「狸之愿」增伤 15.04 → 15（原文 15%）。19 个柚叶预设 −0.013%~−0.019%，timeGolden 24 叶已重生成。
  - **新常驻测试** `src/mechanics/__tests__/teammateBuffRawNumbers.test.ts`：队友 buff 数值必须能在原文找到（反向验证：放回 15.04 时精确报出该条）。
  - **CC-133 潘引壶**（`366212b7`）：通窍排除本人，逐位零差。
  - 验证：verify179 EXIT=0（3790 passed | 29 skipped，本轮 +1 条常驻测试，基于代码最终状态）；CC-132 中间状态单独复验 teammateBuffRawNumbers + timeGolden 10/10；CG 通过；文档提交另跑 verify180。
- **下一步（按顺序，可直接开工）**：
  1. **未决项「每超过 X 是否取整」定口径**（拖了很多轮，本轮起排第一）：
     a) `timeout 40 git grep -n "每超过" -- src/specs public/static/teammate-buffs.json data/raw/nanoka_missing/full` 找全部原文措辞；再在实现里找对应代码（spec `attributeConversions` 的 `stepRounding`，见 `src/specs/types.ts`；teammate formula 里的 `floor(`；模块里的 `Math.floor` / `Math.round`，如洛克茜 roxy.ts 约 302 行）。
     b) 列表写进清单新节 §2.18：机制 / 原文措辞 / 现行取整（floor / round / 不取整）/ 出处行号。
     c) 定口径并写依据。建议默认：原文「每超过 N，提升 M」⇒ `floor`（游戏常规按整步计），除非原文给了连续公式；和现行不一致的开 CC 卡，逐条 zd。拿不准的条目保持现状并写明。
  2. 副词条优化器接入 `applyTeammateBuffRecipientFilters`（低优先，只影响优化建议；`src/stores/config.ts` 约 819-861 行）。
- **本轮拍板**：
  - 对账脚本固化为常驻测试，而不是只留一次性报告：依据是 CC-131 / CC-132 都是初始提交时的录入问题，后续录入新角色时同类错误会再发生。变红时的处理写在测试头注释里（先查原文，不许加白名单绕过）。
  - CC-133 零差也做：纯正确性修改，成本低，避免后来者被「本人也吃」误导；单独提交，不和有数值变化的 CC-132 混在一起。
- **已知坑**（新增，其余沿用第 156 轮）：
  - **不要执行 `git add -N .` / `git add .`**：会把不属于本 lane 的 `docs/devlog/` 一并加入（第 157 轮误操作，已用 `git reset -q -- docs/devlog` 撤回）。一律按路径 add。
  - zd 永远比较 HEAD 与工作区：同一轮叠了两处改动时，要单独看后一处，就直接比较两次 zd 的 after 文件（`/home/kaua/calc-arch/zd-<tag>-{dump,rowsnap}-after.json`）。
  - teammate-buffs.json 是单行紧凑 JSON（`separators=(',', ':')`、`ensure_ascii=False`），改它先断言「读→写」逐字节还原，再改；同文件两处改动要分提交时，用临时副本分两次放回。

### 第 156 轮（2026-09-28，代码 `4d657d75` + 文档 `7090a58d` + 本回填提交；上一轮文档 = 6acea376 / bdd3d21b）

- **做到哪**：
  - 卢西娅影画2「破暗」核对：原文就是全队，**不改**（清单 §2.16）。
  - **全库队友 buff 作用对象实测**（29 组，清单 §2.16 第 156 轮补充）：来源本人普遍吃自己那组；原文单体 / 非全队的条目逐条判断。
  - **CC-131 克拉蕾**（`4d657d75`）：删除 v12 原文里不存在的测试服残留 buff `claret.gleaming_edge_teammate`。2 个克拉蕾预设 −15.3%~−15.6%、单人克拉蕾 −10.9%~−22.1%，每条可解释；timeGolden 9 条 + timeFillRatchet 2 条已重生成；新单测 `src/mechanics/__tests__/claretStaleBuffCc131.test.ts`。
  - 验证：verify178 EXIT=0（3789 passed）；CG 通过。
- **下一步（按顺序，可直接开工）**：
  1. **teammate buff 数值 ↔ 原文对账**（找更多测试服残留）：写脚本遍历 `public/static/teammate-buffs.json` 每组每个效果：取 `value`（或 `ratio` / `cap` / `valuePerStack`），在 `data/raw/nanoka_missing/full/<组id>.json` 去掉 `<color>` 标签后的文本里搜「<值>%」「<值>点」及 `{CAL:...}` 模板（CAL 模板里的数值要按技能 12 级算，搜不到时先列为嫌疑，不要直接判错）。输出嫌疑表写进清单 §2.17，逐条人工核；确认是残留的开 CC 卡删除 / 订正（同 CC-131 的做法与回退点）。
  2. 1421 潘引壶通窍排除本人（§2.16 表），预计零差。
  3. 副词条优化器接入 `applyTeammateBuffRecipientFilters`（低优先，只影响优化建议）。
  4. 未决项「每超过 X 是否取整」。
- **本轮拍板**：
  - 删 buff 而不是把 coverage 调成 0：原文不存在的效果不应留在数据里误导后来者；1611 组保留为空组，避免组 id 消失影响界面。依据写进单测的「依据仍成立」断言，原文若更新会提示重评。
  - 不顺手做 1421：零差的纯正确性修改单独做，避免和有数值变化的卡混在一个提交里。
- **已知坑**：
  - **来源本人会吃自己那组 teammate buff**（第 156 轮实测）：原文写「队友 / 其他」的拐要声明 `excludeTargetAgentIds`，单体拐走 `teammateBuffRecipientFilter`。
  - zd 结果文件在 `/home/kaua/calc-arch/zd-<tag>-dump-{base,after}.json`（不是 `.zc/perf/`）。
  - Python 里 `'...%s...' % x` 的模板若含「−8%~」这类百分号会报错，要写成 `%%` 或改用 f-string / 拼接。
  - **teammate buff 没有接收者字段**：同一份 enabledTeammateBuffs 下发给每个槽（含来源本人）。单体拐必须走模块能力 `teammateBuffRecipientFilter`（CC-130），不要在编排层按 agentId 过滤。
  - teammate buff 默认**关闭**（`teammateBuffEnabledOf` 无记录 = false），预设会打开；探针里要手动 `config.teammateBuffSelections[id] = { enabled: true, coverage: 100 }`。
  - **往 wsl_exec 命令里内联含反引号的文本会被外层 shell 当命令替换吞掉**（第 153 轮卡表行丢字）：改文档一律写成脚本文件上传后执行，不要内联 heredoc。
  - **改到失衡 / 时间分配的数值时有两份基线**：timeGolden（`TIME_GOLDEN_UPDATE=1`）和 `timeFillRatchet.baseline.json`（`TIME_RATCHET_UPDATE=1 npx vitest run timeFillRatchet`），两份都要逐条解释后重生成；后者只在全量 verify 里才暴露。
  - `PanelValues.energyRegen` 是**基础**回能（恒 1.2，柏妮思 1.56）；总回能看 `energyRegenOutOfCombat` / `energyRegenTotal`。
  - **zd 输出怎么读**：`value = 总伤害|resourceResult哈希|失衡池哈希|闸门`；数值变化看第 1、3 段。
  - zd dump 起手裸装，但 `applyTeamToStore(preset)` 会装上预设装备，所以预设装备下的差异能看到；timeGolden 的 `agent:*:cN` 是单人裸装，`preset:*` 才带装备。
  - 不要用 `pgrep -f` / `pkill -f` 杀 dsh（会匹配自身 shell）；用 `ps -eo pid,etimes,args | grep '[.]local/node/bin/dsh'` 找 pid 再 `kill -9`。pid 8958 的 `dsh web --port 3080` 是用户常驻服务，不要杀。
  - dsh 大批量任务要分批、边做边写结果文件（1500s 超时）。
  - `releaseModifier` 的派发键是异放行的 agentId（结算者），原文是全队的修正必须声明 `releaseModifierScope: 'team'`。
  - 盘点 cfg 键时要同时搜 `setRecord(cfg, 'xxx'` / `cfgNum(cfg, 'xxx'` 的字符串形式。
  - 预设外的角色（zd 看不到）至少有 1121、1281、1291、1081；`setupHarness` 必须传 `{ agentId }` 对象。
  - vitest 会忽略错误的类型导入，只有 vue-tsc 能发现。
  - `zcWorkspace.test.ts` 在全量 verify 下偶发失败，单独重跑可过。
  - 工具是否齐全以 `node /tmp/mcp.js list | wc -l` 为准（16 = 有 wsl_exec）。
- **未决（数据口径，改即改数值，需 CC 卡）**：「每超过 1 点/1%」是否取整（清单 §2.4 新发现 2）；洛克茜 `Math.round` 攻击取整也属同一问题。CC-27 维琳娜风蚀状态机仍是「待设计」。
