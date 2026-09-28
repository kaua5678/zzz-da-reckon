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

- **每轮收尾必须 `git push origin master`**（提示词 c2）：commit 不等于 push。2026-09-27 用户发现本地积压 436 个提交、远端停在 09-21。推送失败要写进交接，不能静默跳过。
- **登记债务、豁免或改 burn-down**：改 `scripts/lib/guard-registries.mjs`，不要改 check-guards 本体（CC-85）。
- **改角色机制实现的提交**：顺手 grep `public/static/character-mechanics.json` 和 `character-constellations.json` 里该角色的 pending，过时就同步改。状态表过时的根因，就是实现提交没回写（CC-89）。
- **新增 `record.<key>` 读取**：必须同时有写入方（buildCharConfig 或编排层注入），否则判据 25 会红（CC-91）。
- **文档提交之后至少再跑一次 `node scripts/check-guards.mjs`**：docs 里以 `@fact ` 开头的散文会被解析成 fact 声明（CC-93）。
- **drift 复核**：要看从原始口径日期到现在的全部改动（`git log <原始据日期>..HEAD -- <锚文件>`），不要只看上次 `·复核@` 之后的。另外，有些条目的竖线前没有空格（`·复核@2026-09-25| 验`），不要把戳打进「验」或「锚」段（CC-87）。
- **`src/views/TeamComparePage.vue` 只剩约 38 行结构熵余量**：给该页加功能，写到 `src/composables/teamCompare*.ts`（CC-92）。
- **等号基线（「计数下降也报错，要求下调基线」）是有意设计，不要改成「≤」**：2026-09-14 它两次抓到扫描器盲区，计数凭空下降其实是扫描器看不见了，而不是代码变好了（`scripts/check-tokens.mjs` 头注释；`docs/mcp-working-model.md` §2.5）。

## 2. 最近一轮交接（每轮替换本节）

**第 230 轮（lane lead-arena-0925c）：CC-207 完成（fb0b8205）。文档见本提交。push 结果见 git log / rev-list。**
- CC-207：`teammateBuffGate` 改为 store 与引擎共读，详见 `docs/mcp-stun-dual-source.md` §24.54。
- 前几轮：229 CC-206（a119557d）加 T2 收尾；228 CC-205（d95a2957）；227 CC-204（9aed3fc4）。
- REQUIREMENTS 无新条目（md5 807ee096）；提示词未改（md5 2aa1f517）。主工作区干净（只有别人未跟踪的 `docs/devlog/`，不要 add）。

**下一步（直接开工）**
1. 找下一个「同一判断多处实现」的点：`grep -rn 'evalAdditionalAbility(' src`、`grep -rn 'getRegisteredAgentMechanics()' src/stores src/composables`，逐个看 store 层和引擎层是否各算一份、其中一层带修正而另一层不带。找到就立 CC-208，按 CC-206 / CC-207 的同构方式合并到 mechanics 层的纯函数（store 不能值导入 composables/resourceCalc）。零差判据：默认配置下 golden 不变。
2. 若找不到值得做的点，写「本轮扫描无可做项」加扫描范围，不要为了降计数硬做。
3. 可选的纯展示小项：UI 对被 `teammateBuffGateBlocks` 否决的条目置灰（§24.54「已知限制」）。展示层禁止值导入 mechanics，要经 store 暴露。
- 开工前**先查卡表**（`docs/mcp-calc-core-architecture.md`）。
- **未决项**：1511 南宫羽额外能力无触发条件（`AA_OWNER_EXEMPT`）。

**探针（优化器相关改动的验收）**
- `REFINE=1 /home/kaua/calc-arch/k206/probe2.sh /home/kaua/calc-arch/k209/<out>.tsv`，基线 `k209/final.tsv`。必须带 REFINE=1，输出路径必须是绝对路径。对比：`node /home/kaua/calc-arch/k206/cmp.cjs <base> <cand>`。

**已知坑**
- **修 bug 的测试要做反证**：临时撤掉修复（先 cp 备份），确认新测试失败，再恢复。否则测试可能在修复前也能通过（CC-207 做过）。
- **wsl_exec 里后台起 dsh**：`nohup bash -c '…' &` 会随调用退出被杀、连日志都不生成。要写成脚本文件，用 `setsid nohup script.sh >/dev/null 2>&1 < /dev/null &` 启动（第 229 轮）。dsh 做 66 条的只读分类约需 30 分钟。
- **store 值导入 composables/resourceCalc 会成环**（helpers.ts 值导入 stores/config）。两边共用的函数放 mechanics 或 specs 层（CC-206）。
- **「零读取」≠「可删」**：先 grep 字段语义对应的展示文本或常量，看有没有写死的过时值（CC-205 零号安比 +25% 实为 50%）。
- **沙箱重置后 `/home/user/mcp-tools/*.sh` 会丢执行权限**：先 `chmod +x`，或用 `bash up.sh ...` 调用。
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
- 远端 bash 会执行 heredoc 中的反引号：代码和文档一律写成 .py 文件，用 up.sh 上传后执行。
