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
- **开工在自己的 worktree 跑一次 `npx vue-tsc -b --force`，先知道 master 本来红不红**（r424）：`c47e153b`（02:24）提交时 vue-tsc 没过（4 个错全在新测试文件里，vitest 不做类型检查所以全绿），master 类型检查红了 9 小时没人发现；r423 又记过「别人的红被归到自己头上然后 revert」。红了就修掉或在 §2b 记一行，别带着红继续、也别 revert 别人。回退：删掉本条。
- **等号基线（「计数下降也报错，要求下调基线」）是有意设计，不要改成「≤」**：2026-09-14 它两次抓到扫描器盲区，计数凭空下降其实是扫描器看不见了，而不是代码变好了（`scripts/check-tokens.mjs` 头注释；`docs/mcp-working-model.md` §2.5）。

## 2b. 并行 lane 交接（§2 「每轮替换」时**不要**连本节一起删；每个 lane 一段，过时的段压成一行指针）


> 为什么有这节：2026-09-29 实测两个会话同时在跑（本会话开工时主 lane `lead-arena-0925c` 第 315 轮正在 `wt315` 跑 verify；推断是 arena 对战模式两个模型同时收到同一份提示词）。
> §2 属于主 lane；并行会话把自己的交接写在这里，互不覆盖。任何 lane 确认本节已过时，可以整节替换成自己的。
> 开工查现场的方法见提示词第 9 条（`ps` 看 verify / vitest，`git log` 看最近提交时间，`ls -lt /home/kaua/calc-arch`）。

> **认领表**（2026-10-01 arena-D 起）：`/home/kaua/calc-arch/LANE-CLAIMS.md`（不入 git）。选好活后追加一行「时间 | lane | 文件/主题 | worktree」，收工标 `[released]`；选活前先读它，避开别人未 released 的文件。
> **在 worktree 里跑零差**：`cp -r .zc/perf <worktree>/.zc/` 后 `ZD_REPO=<worktree> bash .zc/perf/zd.sh <tag>`（`.zc/perf/zd.sh` 本轮加了 `ZD_REPO`，不设时行为同旧）。

**2026-10-03 12:01 arena-F 第 425 轮**（开工：master `c55d9c64` 干净、已推；无 verify 进程；主仓有别人 11:40 起持续在改的 `src/mechanics/agents/remielle.ts` + `remielle.test.ts` + `composables/__tests__/helpersNightC.test.ts`（无认领行；内容 = 1581 蕾米 daze 档位按「异常角色数不含本人」的 2026-09-30 用户裁决重算，tier3 在 3 人队结构性不可达），**没动它**；REQUIREMENTS.md 无新条目；worktree `wtF-r425` 已删，产物 `/home/kaua/calc-arch/arenaF/r425/`）：**CC-399 = T5 `df3e7c42` + T6 `1b771511`**，已 ff 合入 master。
- **做到哪**：r424 §3 的 T5 / T6 两张卡收口（卡已从 §3 删除）。T5 派给 dsh 工人（worktree `wt-T5`），本人同时做 T6（worktree `wtF-r425`），两边文件不相交；工人 diff 并进 `wtF-r425` 后一次性 zd + 全量 verify，再分两个提交（各自可独立 revert）。详见卡表 CC-399。
- **T6 调查结论**（卡里的未决项，已关）：`specTeamBuffToTeammateBuff` 丢 spec effect 的 `source` **无害**——`getEffectSourceValue` 的兜底链里 `source.defaultValue` 排在目标面板之后、`0` 之前，全仓只有 1541 带 `source` 且 `defaultValue = 0`，`TeamBuffEffectSpec` 也没声明它。**不补透传**。若将来有 spec 录入非 0 的 `source.defaultValue`，先在 `specs/types.ts` 声明再在 `teamBuffConvert.ts` 透传，别绕过转换器。
- **派 dsh 的实测配方**（§0 的写法照用，本轮 2 分钟收工）：
  ```bash
  BRIEF="$(awk -v c=T4 '$0=="<!-- card:" c " -->"{f=1;next} $0=="<!-- /card:" c " -->"{f=0} f' docs/mcp-worker-task-queue.md)

  补充给工人：worktree /home/kaua/calc-arch/wt-T4 已经建好（node_modules 已软链），直接在里面改；不要 git commit；零差跳过（主代理复核时跑）；报告写到 /home/kaua/calc-arch/arenaF/<轮>/worker-T4.report（首行 STATUS: done|blocked）。"
  cd /home/kaua/calc-arch/wt-T4 && setsid nohup /home/kaua/.local/node/bin/dsh --profile headless "$BRIEF" > …/worker-T4.out 2> …/worker-T4.err < /dev/null & disown
  ```
  `setsid nohup … & disown` 的 dsh **能**跨 `wsl_exec` 调用存活（与 r401 「nohup vitest 死掉」不矛盾：那次没 `setsid`）。回收：`pgrep -af '^node .*dsh --profile headless'` 为空 + report 首行 `STATUS: done`；然后**亲自** `git diff` 看是否越白名单，再 `git diff > T4.diff` 并到自己的 worktree 跑 zd + verify。
- **验证**：`vue-tsc -b --force` 0；guards / tokens / data / specs / recording / build EXIT 0；vitest(4) 466 文件通过（与 r424 同）；zd `r425-t5t6` DIFF 0；promia 展示值 7 点 A/B 逐字相同。
- **下一步（start-ready，按价值排）**：
  1. **§3 卡 T4**（spec 侧 8 处数据驱动字段名读写收成 `readCfgField` / `writeMechanicSettingCfg`）——按上面的配方直接派 dsh；复核时注意 r420 坑（`Number(raw ?? default)` 不要换成 `cfgMechanicSetting`）。做完 `as unknown as` 非测试面应恰为 CC-398 判合理的 14 处，**到此为止**，别再「清」那 14 处。
  2. **捏轴页「条XX%」截图验证**（r424 接通的，仍没看过真实渲染）：r416 headless 配方，切 `ui.activeTab` 到捏轴页、手动轴放 1511006 ×6 + 1181005 ×18，DOM 里应出现 `条电` / `条以太` 字样的 `.mw-l2` 块。
  3. 等 remielle 那条 lane 收工后看他有没有写交接；若 1 小时后还是未提交、无认领 ⇒ 按提示词第 9 条「孤儿」流程处理（审查 → 隔离 verify → 提交或丢弃，写清）。
  4. 主队列 §2（arena-E r420）的 TWIN 候选逐个核对不变。
- **拍板**：① T5 / T6 分两个提交、一次 verify——revert 粒度与验证成本的折中。② `source` 不透传（依据见上）。③ 工人报告里「零差跳过」是我在 brief 里允许的，不是工人偷懒；主代理复核时必须自己跑。
- **坑**：
  - 工人收工后 `wt-T5` 要用 `git worktree remove --force` 删（里面有 node_modules 软链，普通 remove 会拒）。
  - `TeamBuffEffectSpec` 没有 `source` 字段，但 1541.json 里有——JSON 未声明字段 tsc 不报。要知道「数据里有没有」只能扫 JSON（本轮用 python 扫了全部 `src/specs/agents/*.json` 的 teamBuffs effects，8 条 formula/带 source）。
- **回退点**：`git revert 1b771511`（T6）/ `git revert df3e7c42`（T5），互不依赖。

**2026-10-03 11:40 arena-F 第 424 轮**（开工：master `c47e153b` 干净、1 个未推提交（R65-J1）已补推；无 verify / vitest 进程；11:40 起另一 lane 在主仓改 `src/mechanics/agents/remielle.ts` + `remielle.test.ts`（无认领行，到本轮收尾仍未提交）⇒ 判并行，文件面不相交；REQUIREMENTS.md 无新条目；worktree `/home/kaua/calc-arch/wtF-r424`，产物 `/home/kaua/calc-arch/arenaF/r424/`）：**CC-398 `70a16851`**，已 ff 合入 master。
- **做到哪**：接 r423「下一步 1」（`as unknown as` 29 处）。**没有加锁第 7 条**，逐处读后分成四类（下表），只修了真断契约的 3 处 + 顺手修别人提交带进来的 4 个 tsc 错；详情见卡表 CC-398。
  | 类 | 处数 | 位置 | 处置 |
  |---|---|---|---|
  | 真断契约 | 3 | `StunAxisPage.vue:592` gaugeSnapshots、`rowBuild.ts:325` + `helpers.ts:638` sustainedEx、`norma.ts:573` teamStunCoverage | **本轮修掉**（`70a16851`） |
  | 等形但要抽共享代码 | 4 | `promia.ts:61`；`velina.ts:66-67`、`alice.ts:203-204` | §3 卡 **T6** / **T5** |
  | 数据驱动字段名读写 | 8 | `specs/resources.ts:113,138,196,204,216`、`specs/mechanics.ts:42,228`、`resourceCalc/helpers.ts:601` | §3 卡 **T4**（收成辅助，不是去掉） |
  | 合理，不动不锁 | 14 | 反射快照 `rowBuild.ts:44` / `truncationRefold.ts:68`；globalThis 调试钩子 `foldLoop.ts:242,244` / `core/resource.ts:347`；面板袋 `panel.ts:322` / `utils/panelStat.ts:17,21`；DOM `svgPointer.ts:37`；reactive 组装 `analysisScenario.ts:59,65,68` | 不动 |
- **最重要的发现**：捏轴页「条XX%」（每个动作块末尾的积蓄槽百分比，用户口径④）**自 2026-08-24 起从未显示过**——core 产出、页面在读、中间的摘要没透传，`as unknown as` 让 tsc 闭嘴。这和 R65-J1 的「声明了但没接进计算」是同一个病在 UI 层。现在有端到端锁（`inStunAttribution.test.ts`「摘要透传每个动作块末尾的积蓄槽快照」）。**没有截图验证**（本轮没起浏览器）；若下一轮有余量，按 r416 的 headless 配方切到捏轴页、设一条含 1511006 / 1181005 的手动轴，确认块上出现「条电NN%」字样。
- **master 在 02:24～12:00 之间类型检查是红的**：`c47e153b` 的 `r65j1DeadBuffProbe.test.ts` 带 4 个 vue-tsc 错进了 master（vitest 全绿掩盖）。本轮最小修（只改类型标注，探针逻辑不变），已在 §1 加长期规则「开工先 vue-tsc 看 master 红不红」。
- **验证**：`vue-tsc -b --force` 0 错；guards / tokens / data / specs / recording EXIT 0；vitest(4) **466 文件通过**（比 r423 多 1 个文件 = 别人新增的 r65j1 探针）；build EXIT 0；zd `r424-cc398` DUMP / ROWS DIFF 0。反证：把 `convergence.ts` 换回 HEAD，新锁红、其余 38 条绿。
- **下一步（start-ready，按价值排）**：
  1. **§3 卡 T5（velina / alice helper 形参改真类型，机械、零差）** —— 可直接派 dsh 或执行模型，卡面写死了。
  2. **§3 卡 T6（promia spec effect → BuffEffect 共享转换器）** —— 含一个调查项：`stores/catalog.ts#specTeamBuffToTeammateBuff` 把 spec effect 的 `source`（formula 变量 x 的 `defaultValue` / `min` / `max`）**丢掉了**；真实通道靠运行时注入 `dynamicSourceValue` 所以可能无害，但「formula 型 spec teamBuff 在没有 source 角色面板时回落什么值」要核。做法写在卡里。
  3. **§3 卡 T4（spec 侧数据驱动字段名读写收成 `readCfgField` / `writeMechanicSettingCfg`）** —— 机械，8 处 → 2 个辅助；注意 r420 坑：`Number(raw ?? default)` 不要换成 `cfgMechanicSetting`（非有限数行为不同）。
  4. 主队列 §2（arena-E r420）的 TWIN 候选逐个核对不变。
- **拍板**：① 不加 `as unknown as` 锁（理由见卡表）。② gaugeSnapshots 直接接通而不是先问「该不该显示」——用户口径④白纸黑字、core 测试 16 条一直在测它、页面代码一直在等它，接通是实现既定口径，不是新功能。③ `TeammateBuff` **不**补 `note` 字段：spec 的 note 是录入备注，不是展示数据，探针改读 `description` 即可。
- **坑**：
  - `TS2367` 出现在 `A || (B && A)` 的第二个 `A` 上：TS 在 `||` 右支把 `A` 的判别值收窄掉了，报「无重叠」。不是联合类型缺成员，是条件冗余。
  - `types/resource` 不 import `@/core`（本轮核实为 0 处）；core 的结果类型要给编排层摘要复用时，把类型**搬到 types** 再从 core `export type { X }` 转出，别反向 import。
  - worktree 里 `.zc` 不入 git：`mkdir -p <wt>/.zc && cp -r .zc/perf <wt>/.zc/perf`（r423 写法照用，正常）。
- **回退点**：`git revert 70a16851`。

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

## 2. 最近一轮交接（每轮替换本节）

**第 420 轮（lane arena-E；无并行会话；起点 `2dcdc2bf`（外来 docs 提交，已补推）；REQUIREMENTS.md 无新条目）：CC-394 `497aaa27` + 文档，已 push。**
- **做到哪**：r419 下一步 1 的两条优先项。
  - ① 青衣 1251021 / 1251022 = 情形 (ii)：nanoka param.desc 明写强特 = 三段和，模块无引用 ⇒ `data/moveFusions.ts` 加 `QINGYI_EX_MOONLIT`。**改伤害**：修前强特只算 #1（301.4% / 0.383s），修后 1206.7% / 1.533s。
  - ② 莱卡恩 1141016 = 情形 (i)：`lycaon.ts` 点按路线已出它的执行行 ⇒ `axisHiddenMoves`（零差）。
- **验证**：vue-tsc `--force` 0；guards 链 EXIT 0；vitest(4) 464 文件 / 4275 测试（+2）；build 通过；zd `r420a` changed 31/625 全是含青衣的队；timeGolden 35 行、timeFillRatchet 2 队重生成（逐队解释见 CC-394）；cinemaMonotone 登记 1251:c3->c4；yixuanSmoke 期望 3 处更新。
- **回滚点**：`git revert 497aaa27`。
- **拍板**：① auto-1371-1251-1451 −9.86% 接受：不是融合算错，是更真实的强特时长让仪玄自动轴超预算、引擎按既定「轴太厚 ⇒ 退化非轴」口径处理（探针 `/home/kaua/calc-arch/arenaE/r420/probe2.test.ts`，两侧输出 `p2-*.out`：master 轴「轴1」、stun 3；修后轴空、stun 4）。② 「长按追加连打」不建模：原文只说「提升连打次数」，没有次数 / 倍率，凭空猜会引入无据数字。
- **下一步（按价值排）**：
  1. **剩余 TWIN 候选逐个核对**（方法同 r419：读模块 + `data/raw/nanoka_missing/full/<id>.json` param.desc，三选一 (i) 隐藏 / (ii) 融合 / (iii) 不动；清单出处 `/home/kaua/calc-arch/arenaE/r419/tbl-census2.out`）：1071012、1101106、1101402、1121008 / 1121009（ben.ts 有引用）、1131013 / 1131014（soukaku.ts 引用 013）、1151013、1161015、1181018、1201023、1271009、1321012、1351005、1381009、1401007、1451017、1461022、1541007 / 1541011 / 1541012（promia.ts 引用 011）、1561010、1571009 / 1571012（norma.ts 有引用）、1611011 / 1611012、1621019（roxy.ts 有引用）。r419 `fusions.out` 里能找到 nanoka 求和式的只有青衣、莱卡恩、雨果、雅（均已处理）⇒ 余下大概率是 (i) 或 (iii)，零差为主。
  2. **yidhari-qingyi-lucia 外层收敛 cycle**（r420 新增，第 4 支 cycle 队）：先用 `.zc/perf` 打印外层每轮的青衣强特次数，看是否 7↔8 振荡；若是，属整数环停点问题（参考 `docs/mcp-integer-cycle-stop.md` CC-326），别加容差。
  3. **「能量全部打强特」口径复核**：青衣 4 命回能后强特 +1 反而降伤（每秒收益低于平A）。若别的角色也出现同类下降，再评估引擎是否该按每秒收益决定能量用途（要用户口径，先写进 OPEN-ITEMS 候选，不要直接改）。
  4. 仪玄自动轴预设（`stunAxisPresets/仪其他.json` 的「轴1」）是在青衣强特 0.383s 时代配的；4 次失衡下轴太厚而退化。要不要按新时长重配，看用户是否在意该队走轴。
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

（T1、T2 已于第 370 轮 `0c5e00cb` 完成）

（T1/T2 已于第 370 轮 `0c5e00cb` 完成，T3 已于第 373 轮 `851f232f` 完成。T4–T6 由第 424 轮（arena-F，CC-398）写出；T5 `df3e7c42` / T6 `1b771511` 已于第 425 轮完成并删卡，T5 是 dsh 工人做的。）

<!-- card:T4 -->
### T4 · spec 侧「按数据给的字段名读写 cfg」收成两个辅助（机械、零差）

**仓库** `/home/kaua/projects/zzz-calculator`（先 `git worktree add --detach /home/kaua/calc-arch/wt-T4 HEAD && ln -s /home/kaua/projects/zzz-calculator/node_modules /home/kaua/calc-arch/wt-T4/node_modules`，在 worktree 里做；**不许碰主仓库**）。

**背景**：spec JSON 用 `valueField` / `initialValueField` / `enabledField` / `carrierField` / `bonusEnabledField` 这类字段名指定「去 cfg 的哪个键读」，所以这些读取天然是动态键，代码里写成 8 处各自的 `cfg as unknown as Record<string, unknown>`。目标不是去掉动态读取，而是让「spec 按字段名读 cfg」只有一个入口。

**改法**：
1. 新建 `src/specs/cfgField.ts`，内容只有两个导出：
   ```ts
   import type { CharacterOperationConfig } from '@/types/resource'
   /** spec 数据按字段名读 cfg（valueField / enabledField / carrierField …）。唯一入口：动态键只在这里出现。 */
   export function readCfgField(cfg: CharacterOperationConfig, field: string): unknown {
     return (cfg as unknown as Record<string, unknown>)[field]
   }
   /** 机制可调设置写入 cfg（键 = mechanicSettingCfgKey(id)）；读端是 utils/mechanicSettingCfg.ts 的 cfgMechanicSetting*。 */
   export function writeMechanicSettingCfg(cfg: CharacterOperationConfig, settingId: string, value: unknown): void {
     ;(cfg as unknown as Record<string, unknown>)[mechanicSettingCfgKey(settingId)] = value
   }
   ```
   （`mechanicSettingCfgKey` 从 `@/utils/mechanicSettingCfg` import。）
2. 把下面 8 处改成调用辅助，**表达式其余部分逐字不变**（尤其 `Number(... ?? default)`、`Math.max(0, …) || 0`、`Boolean(...)`、`String(... ?? '')` 原样保留）：
   - `src/specs/resources.ts` 113 / 196 / 204 / 216：`record[X]` → `readCfgField(cfg, X)`，删掉对应的 `const record = …` 行；
   - `src/specs/resources.ts` 138：`record[mechanicSettingCfgKey(adjustable.id)]` → `readCfgField(cfg, mechanicSettingCfgKey(adjustable.id))`（**不要**换成 `cfgMechanicSetting`：它对非有限数取 fallback，和现有 `Number(raw ?? default)` + `isFinite` 判定不同，r420 踩过）；
   - `src/specs/mechanics.ts` 42 / 228：同上；
   - `src/composables/resourceCalc/helpers.ts` 601：`record[mechanicSettingCfgKey(setting.id)] = …` → `writeMechanicSettingCfg(cfg, setting.id, configStore.getMechanicSetting(setting.id, setting.default))`，删掉 `const record = …`。
3. 改完 `grep -n "as unknown as Record" src/specs src/composables/resourceCalc/helpers.ts` 应只剩 `src/specs/cfgField.ts` 里的 2 处。

**验收**（都在 worktree 里，前台跑）：
- `timeout 280 npx vue-tsc -b --force` 退出 0；
- `timeout 280 npx vitest run --maxWorkers=2 src/specs src/composables/__tests__/sustainedEx.test.ts src/composables/__tests__/moveFusion.test.ts` 全绿；
- 零差：`cd /home/kaua/projects/zzz-calculator && mkdir -p /home/kaua/calc-arch/wt-T4/.zc && cp -r .zc/perf /home/kaua/calc-arch/wt-T4/.zc/perf && ZD_REPO=/home/kaua/calc-arch/wt-T4 timeout 280 bash .zc/perf/zd.sh T4` 输出 `DUMP DIFF 0` 且 `ROWS DIFF 0`。

**不许**：改任何 JSON；改 `utils/mechanicSettingCfg.ts`；动 `rowBuild.ts:44` / `truncationRefold.ts:68`（那两处是整对象反射快照，不是字段读取）。

**报告**：首行 `STATUS: done|blocked`，然后贴 `git -C /home/kaua/calc-arch/wt-T4 diff --stat` 与三条验收的最后 3 行输出。
<!-- /card:T4 -->

