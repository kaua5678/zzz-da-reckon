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
- **派发前先查重（2026-09-25 双 lead 事故）**：开工先 `pgrep -af '^node .*dsh --profile headless' | cut -c1-60`
  （模式必须带 `^node` 锚：裸 `'dsh --profile headless'` 会匹配到 pgrep 所在 shell 自身的命令行，永远"有人在跑"）
  + `tail -3 .zc/journal.jsonl`——同名卡已有工人在跑（**无论是谁派的**）就不再派，改为轮询其
  `/tmp/worker-<卡>.out` 等首行 `STATUS:`。本日 W10/W11 被两条 lead 会话各派一次：先到者写正文、
  后到者 force-claim 后只追加独立复核（§10 模式），工人按卡面纪律自洽解决了，但浪费一个并发位、
  同路径 `/tmp/worker-*.out|.err` 相互覆盖，且若后到者不守纪会覆盖整份报告（`.zc/` 不入 git，丢了就真丢了）。

## 1. 队列

| 卡 | 标题 | 类型 | 写入白名单 | 状态 |
|---|---|---|---|---|
| W13 | drift 复核批 A：calc-core 热区（锚 core/ + resourceCalc/） | 只读复核 | `.zc/reports/W13-drift.md` | ✅ 已落盘（`8446be4`/`4f1c2f5`；drifted 2 条另见 `f6bf42e`、W19） |
| W14 | drift 复核批 B：mechanics 档案事实 | 只读复核 | `.zc/reports/W14-drift.md` | ✅ 已落盘（`bca6879`/`709e299`；余 `agent:1431/自动选轴` 待用户） |
| W15 | drift 复核批 C：composables + scripts + 杂项 | 只读复核 | `.zc/reports/W15-drift.md` | ✅ 已落盘（`a721b58`；drift 全队列 102→1，仅余 1431 自动选轴待用户） |
| W16 | 琉音(1481) 送客次数 floor 残留：预测先行取证 | 只读 + 隔离探针 | `.zc/reports/W16-predict.md`；探针只在 `/tmp/wt-W16` | ✅ 已回收（缺陷属实但当前 21 预设零影响；衍生 W20/W21） |
| W17 | 补青衣(1251) 影画4 回能差分断言 | 新增测试 | `src/mechanics/__tests__/qingyiC4Energy.test.ts`、`.zc/reports/W17.md` | ✅ 已合入（lead 重放正控 5/5、负控 5→6 变红；卡已删） |
| W18 | 两处纯清理：1531 spec notes 文案 + 般岳死写 | 小实现 | `src/specs/agents/1531.json`（仅 notes 字符串）、`src/mechanics/agents/banyue.ts`（仅删 1 行）、`.zc/reports/W18.md` | ✅ 已合入（lead 重放 banyue+billySmoke 63/63；validate:specs/check-guards/build 0；卡已删） |
| W19 | frontlineRowsOf 琉音赠大收敛到 `ultimateGiftOf` | 小重构 | `src/core/resource.ts` | ✅ lead 自做（`85d90c6`，全量 3489 passed；W13 drifted #15 结案） |
| W20 | 轴模式琉音送客行是否双计：取证 | 只读 + 隔离探针 | `.zc/reports/W20-axis-farewell.md`；探针只在 `/tmp/wt-W20` | ✅ 已回收（判定 `单计-模块`，账本多计 0s；轴声明 1481009 语义 A/B 已入 OPEN-ITEMS 待用户；W21 前置①满足） |
| W21 | 琉音转大次数单源化（W16 契约 C） | 实现 | 见卡 | ⛔ blocked（14:2x 收工，worktree 已删，零源码改动）：前置②不成立——4 调用点仅 `crossAgentSupply` 拿得到 `stunCount`；轴模式同局 3 个转大读数（planned ≤2.39 / stunPool {3,4} / promoteFixpoint 3.17–5.05）。**需 lead 先设计「转大次数唯一来源」**（已入 OPEN-ITEMS），再拆卡；本卡暂留不派。W22/W23 的「等 W21 收工」闸门已解除 |
| W22 | R62-J3 census 指纹侧过期：当前 HEAD 重跑 + 逐角色 diff | 重计算 + 隔离 worktree | `/tmp/wt-W22` 下任意文件、`.zc/reports/W22-census-refresh.md` | 待派发（**必须等 W21 收工**，独占重计算时段） |
| W23 | 爱丽丝(1401) 系留白 6.0s 归因（预测先行） | 只读 + 隔离探针 | `/tmp/wt-W23` 下任意文件、`.zc/reports/W23-1401-slack.md` | 待派发（单队探针，宜等 W21 收工） |
| W24 | 命座「未描述」6 条的原文定位与可派性分诊 | 只读普查 | `.zc/reports/W24-undescribed-triage.md` | 待派发（纯只读，可立刻与 W21 并行） |

**drift 落盘的工具坑（2026-09-25，后续 lead 必读）**：① 批量打 `·复核@` 按**锚点**选事实，而事实可能写在 docs 里（如 `GAME_TERM_TO_CODE_FIELD.md`）——提交时别只 `git add src/`，以 `git status` 为准；
② 事实行可能误写**两个「据」槽**，解析器静默取后一个 ⇒ 标签打在前一个无效，应合并为单槽（`liuyinPromote.ts` 失衡次数不动点即此例）；
③ `zc drift` 以锚**文件**修改时间判定，改同文件任一行（含 @fact 注释本身）都会让该文件其它事实入队——同批处理。

**W10–W12 已合入并删卡（2026-09-25 外部 lead 会话）**：三份草稿经 lead 复核后改写合入 `docs/MECHANICS_IMPLEMENTATION.md` 末尾六段
（1251/1391/1451/1471/1481/1531），`verify:recording` 6 warn → 0 warn。lead 独立重放 7 个定向测试文件 118/118 通过（含 W11 未跑的
`luciaElowen`/`banyue`）；抽查属实：`qingyiC4Energy` 测试零命中、`banyueSwayExCount` 零读者、`liuyin.ts` `promoteWindows=floor(G/90)`。
合入时的修正：banyue 实为 54 例（W11 静态数 55）；`4ca47db`（CC-D1）在 W12 收工后改了 `damagePool.ts`（1020 行后 +4、琉音直伤贯穿力改走
`calcPenetrationPower`）⇒ 档案改用符号/行 id 而非 damagePool 行号。派生卡：W16（W12 候选 A，lead 复核确认为真缺陷）、W17（W10 §6-T2）、
W18（W11/W12 的文案漂移与死写）。1451 梦境值 `maxValue 100 vs 500` 涉及原文语义 ⇒ 进 OPEN-ITEMS §1，不入队列。

**重计算时段串行**：W16 → W17 → W18（各自要跑 vitest/build）；W13/W14/W15 是纯静态阅读，可与其中任一张并行（总工人数仍 ≤ 2）。
headless 工人无法中途向 lead 申请时段 ⇒ 派发时在 brief 末尾追加一行「测试/构建时段已授予」。

**当前派发顺序（2026-09-25 lead 现场核实）**：W21 仍在跑（13:45 实测 `pgrep` 命中其进程、`/tmp/worker-W21.err` 1.9 MB 仍在增长、`.out` 0 字节属正常——dsh 只在收工时写 stdout；租约 `liuyin.ts` / `liuyinCarryCount.test.ts` / `.zc/reports/W21.md` 均新鲜）⇒ **只剩 1 个并发位**。
W24 纯只读普查（不跑 vitest/build）可立刻并行；W23 只跑单队探针、轻于全量但仍占测试时段，宜等 W21 收工；W22 是 62 角色 × 7 档重计算，**必须**等 W21 收工后独占重计算时段。
三张新卡都不碰 `src/mechanics/agents/liuyin.ts`（W21 白名单），符合 §5-3「同一文件不派给两个工人」。派发前照本节开头查重。

## 2. 任务卡

<!-- card:W20 -->
### W20 · 轴模式琉音送客行是否双计：取证（不实现）

你是执行工人，只完成本卡，不继续委派。TASK_ID=W20。
工作区 `/home/kaua/projects/zzz-calculator`（只读）；探针只在隔离 worktree `/tmp/wt-W20`。开工打印真实 HEAD 与 `git status --short`。
父目标：W16 报告（`.zc/reports/W16-predict.md` §0/§5/§9.1）发现 2 个含琉音(1481)的**轴模式**预设 `auto-1521-1481-1311`、`auto-1531-1481-1451` 上
`promoteFixpoint.promote = 0`（`axisHug = null`），而模块送客行 `1481009` 仍按 `computeLiuyinSource`（floor 口径）出 `count = 7`；
其中 `auto-1531-1481-1451` 的轴预设「常规轴」**还声明了** `1481:1481009×1@3.7`。未证明：轴块 `1481009` 是否**另外**物化成行（= 双计），以及轴模式下送客次数的正确来源。

**先读**：`AGENTS.md` §1 规则 10/11/16/17、§5；W16 报告全文（尤其附录 A 探针源码，可直接复用）；`src/mechanics/agents/liuyin.ts#computeLiuyinSource/buildLiuyinExecutions`；
`src/composables/resourceCalc/liuyinPromote.ts#promoteFixpoint`（轴分支 `axisHug`）；轴块物化路径（从 `src/data/stunAxisPresets.ts` 追到产行处，自己找，报告写出 path:line）。

**允许写入**：`/tmp/wt-W20` 下任意文件（`git worktree add --detach /tmp/wt-W20 HEAD` 后软链 `node_modules`）；报告 `.zc/reports/W20-axis-farewell.md`（先 `zc claim`）。
**禁止**：改主仓库任何文件（报告除外）；改基线；跑全量 vitest / build。

**步骤与验收**：
1. **先写预测再跑**：报告里先写两队各自预测的「轴块 1481009 声明次数 / 模块行次数 / 最终 1481009 行数与总次数 / 是否双计」，再跑探针。
2. 探针：对两队读出最终物化行中所有 `moveId === '1481009'` 的行（count、totalTime、来源 = 模块 or 轴块），以及时间账本里送客占用的秒数；与预测逐项对照。
3. 判定四选一：`双计` / `单计-模块` / `单计-轴` / `其它（说明）`。若双计：给出账本多计秒数、应以哪一处为单一事实源（引用规则 11/16），并预测修后 `timeGolden` 受影响的 key。
4. 若结论依赖游戏语义（例如轴声明的 1481009 是否就是"全部送客"）而代码无法判定 ⇒ 标 needs-user，写成一个可以让用户二选一的问题，不自行裁决。
5. 收工：`git worktree remove --force /tmp/wt-W20`（先删 node_modules 软链），主仓库 `git status --short` 只允许有报告外的既有项。

**固定报告与收工**：首行及最终回复 `STATUS: done|blocked`。含 HEAD、预测表、探针源码全文、原始输出、判定与证据 path:line、未证明事项。
`zc done --verifier '<探针命令>' --coverage '1481 轴模式送客行' --risk '<未证明事项>'`。不提交。
<!-- /card:W20 -->

<!-- card:W21 -->
### W21 · 琉音转大次数单源化（W16 契约 C）

你是执行工人，只完成本卡，不继续委派。TASK_ID=W21。
工作区 `/home/kaua/projects/zzz-calculator`。开工打印真实 HEAD 与 `git status --short`。
父目标：`src/mechanics/agents/liuyin.ts#computeLiuyinSource` 的注释写「转大次数 = 阈值结转贪心」，代码却是 `promoteWindows = Math.floor(total / 90)`（规则 11：注释与实现不一致）；
阈值结转的唯一实现是同文件 `computeLiuyinHugCounts`。W16 实测：当前 21 个预设因 `cap60 ≤ 2` 两口径恰好相等（零影响），但 `stun ≥ 3` 时 81.8% 的输入会分歧（`.zc/reports/W16-predict.md` §4/§6 契约 C）。

**前置（不满足就 `STATUS: blocked` 并写明原因，不要硬改）**：
- W20 已回收，且其结论不是「双计」；若是双计，本卡等 W20 的修复先落地。
- `computeLiuyinSource` 的全部调用点（W16 列出 4 处：`liuyinExSpecialTime`、`buildLiuyinExecutions`、`buildLiuyinResourceResult`、跨角色供给）都能拿到**同源**的 `stunCount` 与连携窗口数；
  若某调用点（尤其 `iterate` 内的）只能拿到别的来源 ⇒ blocked，报告列出每个调用点能拿到什么。

**允许写入**：`src/mechanics/agents/liuyin.ts`；`computeLiuyinSource` 调用点所在文件中**仅调用处的实参**；新建 `src/mechanics/__tests__/liuyinCarryCount.test.ts`；报告 `.zc/reports/W21.md`（均先 `zc claim`）。
**禁止**：改基线、改既有测试断言（新增断言可以）、改 `computeLiuyinHugCounts` 的算法。

**步骤与验收**：
1. `computeLiuyinSource` 改为内部调用 `computeLiuyinHugCounts` 得到 `promoteWindows`，删除 `Math.floor(total / 90)`；轴模式行为按 W20 结论处理（报告写明）。
2. 新测试：取一个 `stun ≥ 3`、`G ∈ [360,450)` 的输入，断言 `promoteWindows === 5`（旧 floor 口径 = 4，必须会红）；再取 W16 的 G=207 用例断言不变。
3. 负控：`cp` 备份后把实现临时改回 floor，新测试必须红，用备份还原，`git diff --stat` 回到改动态。
4. 正控：`VITEST_MAX_WORKERS=4 npx vitest run src/mechanics/__tests__/liuyin*.test.ts src/composables/__tests__/timeGolden.test.ts src/composables/__tests__/timeLedgerInvariants.test.ts src/composables/__tests__/giftMoveTimeLedger.test.ts`；
   **`timeGolden` 必须逐位不变**（W16 预测当前预设 delta = 0）；若漂移 ⇒ 不改基线，blocked 并附漂移的 key 与数值。
5. `npm run check-guards` + `npm run build`。

**固定报告与收工**：首行及最终回复 `STATUS: done|blocked`。含 HEAD、diff 全文、正控/负控原始输出尾部与退出码、`git status --short`。
`zc done --verifier '<正控命令>' --coverage 'liuyin.ts computeLiuyinSource 及其调用点' --risk '<未证明事项>'`。不提交。
<!-- /card:W21 -->

<!-- card:W22 -->
### W22 · R62-J3 census 指纹侧过期：当前 HEAD 重跑 + 逐角色 diff

你是执行工人，只完成本卡，不继续委派。TASK_ID=W22。
父目标：`.claude/OPEN-ITEMS.md` §2「R62-J3」的**剩余**段——静态半场已于 2026-09-24 收口（W3，lead 独立复算一致：状态表 `implemented*` **364 条** = A 354 + B 10 + C 0，B 类 10 条恰好就是 `/home/kaua/r62-scratch/evidence/TRIAGE-r62.md` 第 16-17 行已分诊的 9 角色 / 10 档 ⇒ 零新增）。
但指纹基线 `gate-census.json` 生成于 2026-09-20 的 `3db9b32`，当前 HEAD `b9938c7` 与之相差 **86 个提交**（lead 实测 `git rev-list --count 3db9b32..HEAD`），其中含 R62-batchA 修复 `09c87e2`（1111 安东影画3/5 技能等级双计）⇒ **「此后的提交有没有把某档改成空操作」目前无结论**，本卡就是补这个结论。

**先读**：`AGENTS.md` §1 规则 10（基线是测量工具不是否决权）/ 12 / 16 / 17、§5；`.claude/OPEN-ITEMS.md` §2 R62-J3 全段（含 ✅ 静态半场与「剩余」）；
`/home/kaua/r62-scratch/teeth/src/composables/__tests__/r62census.test.ts` **全文**（⚠ 它在 teeth worktree 里是**未提交**的 `??` 文件，主仓库没有这份，必须从那里拷）；
`/home/kaua/r62-scratch/evidence/TRIAGE-r62.md` 第 16-17 行（B 类 10 条的既有分诊结论，diff 时要用它排除已知项）。

**允许写入**：隔离 worktree `/tmp/wt-W22`（`git worktree add --detach /tmp/wt-W22 HEAD` 后软链 `node_modules`）下任意文件；新 census 产物写 `/tmp/wt-W22/evidence/`；报告 `.zc/reports/W22-census-refresh.md`（先 `zc claim`）。
**禁止（硬约束，违者本卡作废）**：
- **绝不许写 `/home/kaua/r62-scratch/evidence/gate-census.json` 与 `step-census.json`**：仪器的 `OUT` / `OUT2` 常量（该测试第 28-29 行）**硬编码**指向这两个路径，而它们是 09-20 的**对照基线**，一旦覆盖就没有 diff 基准、整卡结论不可复现。开工先 `sha256sum` 记录两份基线、`cp` 成 `*.pre-W22.json` 留底，再把 worktree 内副本的 `OUT`/`OUT2` 改指 `/tmp/wt-W22/evidence/`；收工时用 sha256 证明基线**逐位未变**。
- 改主仓库任何文件（报告除外）；改任何基线（`timeGolden` / `timeFillRatchet`）；改 `public/static/character-constellations.json`（它是本卡的**外部事实**，不是被测对象）。
- 跑 `npm run build` / 全量 vitest；碰 `src/mechanics/agents/liuyin.ts`（W21 在改）。

**步骤与验收**：
1. 建 worktree + 软链 `node_modules` + 从 teeth 拷入 `r62census.test.ts` + 改 `OUT`/`OUT2`；打印真实 HEAD、`git status --short`、两份基线的 sha256。
2. **先写预测再跑**（`AGENTS.md` §0 外部闭环表「排查数值」行）：报告里先写出「86 个提交中哪几类改动最可能把某档改成空操作」+ **预测新增 B 类的条数（给数字）**，再跑仪器。实测与预测不吻合 ⇒ 如实写 discrepancy，**不许就地改预测**。
3. 跑仪器：`npx vitest run r62census`（缺省全 62 角色；OOM/超时就按 `R62_ALL=<id,…>` 分 3 批，每批 ~20 角色，报告写明分批）。口径照该文件头注释：62 角色 × cinema ∈ {0..6}，真 `setupHarness` + 真 `useResourceCalc()`，队友固定 `1211`(support) + `1181`(anomaly) cinema 6。记录每批耗时。
4. 与 `/home/kaua/r62-scratch/evidence/gate-census.json` **逐角色 diff**，输出三类：① **活跃门控档位集变化**的角色（哪几档从「不活跃」变「活跃」或反之）；② **新增 B 类**（声明 `implemented*` 但指纹无变化，且不在 TRIAGE 第 16-17 行那 10 条里）；③ **消失的 B 类**（原 10 条里现在活跃了的 = 修复已生效，写明是哪条）。
5. 判定：新增 B 类 = **0** ⇒ 指纹侧收口，报告里给出可直接替换 OPEN-ITEMS R62-J3「剩余」段的**一行结论**（工人不改 OPEN-ITEMS，由 lead 落盘）；新增 B 类 **> 0** ⇒ 每条给 `角色(id)` / 档位 / 状态表声明原文 / 指纹读数 / 怀疑提交（`git log --oneline 3db9b32..HEAD -- <相关文件>`），**不自行修**。
6. 收工：`unlink /tmp/wt-W22/node_modules` → `git worktree remove --force /tmp/wt-W22`；主仓库 `git status --short` 只允许报告一项；贴出两份基线收工后的 sha256（必须与第 1 步一致）。

**证伪闸门**：前提假设 = `3db9b32..HEAD` 的 86 个提交里至少有一个把某档已声明 `implemented*` 的效果改成了空操作（或让某档从不活跃变活跃）。
假设为假时的可观察失败 = 逐角色 diff 的「活跃档位集」**零变化**且新增 B 类 = **0** ⇒ 指纹侧收口、R62-J3 整条可结案（这同样是有价值的结论，照常 `STATUS: done`）。

**固定报告与收工**：首行及最终回复 `STATUS: done|blocked`。含 HEAD、两份基线 sha256 前后对照、预测表、命令与分批耗时、diff 三类全文、未证明事项。
`zc done --verifier '<census 命令原文>' --coverage '62 角色 × cinema 0-6 指纹 vs 09-20 基线' --risk '<未证明事项>'`。**不提交**。
测试时段已授予（独占重计算位，派发方保证此时无其它工人跑 vitest/build）。
<!-- /card:W22 -->

<!-- card:W23 -->
### W23 · 爱丽丝(1401) 系留白 6.0s 归因（预测先行，不实现）

你是执行工人，只完成本卡，不继续委派。TASK_ID=W23。
父目标：`.claude/OPEN-ITEMS.md` §2「R37-J5」的**需先归因**项——`src/composables/__tests__/timeFillRatchet.baseline.json` 里 `auto-1401-1411-1031` 实测 `slack: 6, over: 0, stun: 2, outerExit: "stable"`（lead 核实该键在第 322-327 行），是留白最大的一队；
原怀疑写成「疑为折叠环 refund 一次性冻结追不上正反馈行」，**未证明**。本卡只做归因取证，不写修法。

**先读**：`AGENTS.md` §1 规则 10 / 16 / 17、§0 外部闭环表「排查数值/机制错误」行、§5；
`docs/ENGINE_PIPELINE_GUIDE.md` §4 开头**「时间系统三本账」表** + 坑 19**「否决记录」**（规则要求：碰时间/账本/留白先查这两处，别急着重新发明）；
`src/composables/__tests__/timeFillRatchet.test.ts`（`slack` 究竟怎么算出来的）；折叠环 refund 的实现段（从 `src/core/resource.ts` 自己定位，报告写 `path:line`）；
`docs/mcp-debt2-blade1-feasibility-v4.md` §19.4 / §20.5 中与留白/refund 有关的段落。

**允许写入**：隔离 worktree `/tmp/wt-W23`（建法同 W22）下任意文件；报告 `.zc/reports/W23-1401-slack.md`（先 `zc claim`）。
**禁止**：改主仓库任何文件（报告除外）；**改 `timeFillRatchet` / `timeGolden` 基线**（规则 10：基线不是否决权，但归因阶段更不许动它）；改 `slack` 判据或删断言；跑全量 vitest / build；碰 `src/mechanics/agents/liuyin.ts`（W21）。

**步骤与验收**：
1. 建 worktree，打印真实 HEAD 与 `git status --short`。
2. **先写预测再跑**：报告里先给出「6.0s 留白的构成预测」——落在第几轮、涉及哪个折叠环、refund 冻结多少秒、正反馈行需要多少秒，写成**可对账的数字表**；再跑探针。
3. 探针：对 `auto-1401-1411-1031` 打印**逐轮**时间账本（每轮 收入 / 支出 / 冻结 / refund / 轮末 slack），定位这 6.0s 具体落在哪几轮、由谁产生。
4. 归因**三选一**并给证据 `path:line`：① `折叠环 refund 冻结时序`（原假设成立，写清是哪一次冻结追不上哪一行）；② `1401 机制本身的设计留白`（说明为什么该有）；③ `其它（说明）`。
5. 若判为缺陷：只给**修法方向** + 预测受影响的 baseline key 与数值走向，**不实现**、不改基线。若结论依赖游戏语义（代码无字段可判）⇒ 标 `needs-user`，写成一个能让用户二选一的问题，不自行裁决（照 W20 §5-1 的先例格式）。
6. 收工：`unlink /tmp/wt-W23/node_modules` → `git worktree remove --force /tmp/wt-W23`；主仓库 `git status --short` 只允许报告一项。

**证伪闸门**：前提假设 = 这 6.0s 由「refund 一次性冻结追不上正反馈行」造成，属**可修的实现时序**问题。
假设为假时的可观察失败 = 逐轮账本显示留白**均匀分布**在多轮、或落在**不涉及折叠环**的轮次 ⇒ 假设证伪，改判 ② 或另立归因，并如实写「原假设被证伪」。

**固定报告与收工**：首行及最终回复 `STATUS: done|blocked`。含 HEAD、预测数字表、探针源码全文、逐轮账本原始输出、归因判定与 `path:line`、未证明事项。
`zc done --verifier '<探针命令原文>' --coverage 'auto-1401-1411-1031 时间账本' --risk '<未证明事项>'`。**不提交**。
测试时段已授予（只跑单队定向探针）。
<!-- /card:W23 -->

<!-- card:W24 -->
### W24 · 命座「未描述」6 条的原文定位与可派性分诊（只读普查，不录入）

你是执行工人，只完成本卡，不继续委派。TASK_ID=W24。
父目标：`node scripts/zc.mjs status` 报「待办 命座：已实现 364 / **未描述 6** / 待办条目 115」。lead 已用 `docs/implementation-status.md`（表头第 87 行，「命座未描述」是**第 6 列**）定位到 6 个角色各 1 档：
**莱卡恩(1141) 第 106 行 · 潘引壶(1421) 第 115 行 · 11号(1041) 第 121 行 · 安东(1111) 第 127 行 · 赛斯(1271) 第 132 行 · 佩洛伊斯(1551) 第 147 行**（awk 按列求和 = 6，与 `zc status` 一致）。
口径：`not_described_not_implemented` = 尚未收到机制描述、不视为已实现（该文档第 117 行）。**未知**：各是哪一档、原文在不在仓库里、能不能不经用户裁决就实现 ⇒ 本卡只做分诊，**不录入**。

**先读**：`AGENTS.md` §0「录入角色 / 补机制：五步」（本卡只用到第 1、2 步的口径）、§1 规则 4 / 5 / 15、§5；
`docs/implementation-status.md` 第 82 / 87 / 117 行（三处口径定义）；`public/static/character-constellations.json` 里这 6 个角色的条目（找 `status` = `not_described_not_implemented` 的那一档）；
`data/raw/README.md` + `data/raw/gachabase/<id>.json` + `data/raw/nanoka_missing/full/<id>.json`（原文来源；lead 实测 `1141` 在这两处都存在）。

**允许写入**：报告 `.zc/reports/W24-undescribed-triage.md`（先 `zc claim`）。
**禁止**：改任何 `src/` / `public/static/` / `data/` 文件（本卡纯分诊）；跑 vitest / build；**挖 git 历史**（每项 ≤ 3 处 grep，查不到就写 `missing`，不要像 W13-W15 那样翻历轮交接）；凭名字联想编原文（规则 15：歧义或未命中就如实写未命中）；碰 `src/mechanics/agents/liuyin.ts`（W21）。

**步骤与验收**：
1. 对 6 个角色逐个输出：`名字(id)`、未描述的是**第几档**（C 几）、`character-constellations.json` 里该条目有哪些字段、`description` / 原文槽是否为空。
2. 在 `data/raw/` 定位该档原文：给 `path:line` + **逐字摘录**（引用格式一律 `名字(id)` 绑定，规则 15）；查不到写 `missing`，并写清查过哪 3 处。
3. 每条判**可派性**三选一 + 一句理由：`可直接录入`（原文有数值、口径无歧义、引擎有现成通道）/ `需用户裁决`（把问题写成可二选一的形式）/ `缺原文`（需用户供料）。判据引 `AGENTS.md` §0 五步第 1 步「只把『原文没数值 / 口径歧义 / 引擎缺通道』一次问用户」。
4. 汇总成一张表，并给出**后续卡的切分建议**（按本文件 §3 的实测教训「取证类任务宜每卡 ≤ 2 条」，且录入卡要走 §0 五步、与本卡不同型）。
5. 顺带核实：`docs/implementation-status.md` 是 `npm run docs:status` 生成的产物——报告里写明这 6 条的**上游数据文件**是哪个（改产物无效，要改源），供 lead 派后续卡时用。

**证伪闸门**：前提假设 = 这 6 条里**至少有 1 条**「原文在仓库内且可直接录入」（即本队列能消化它）。
假设为假时的可观察失败 = 6 条**全部** `missing` 或全部 `需用户裁决` ⇒ 本队列消化不了，整批升级 `.claude/OPEN-ITEMS.md` §1 待用户供料（这仍是 `STATUS: done`，不是失败）。

**固定报告与收工**：首行及最终回复 `STATUS: done|blocked`。含 HEAD、6 条表格、原文逐字摘录与 `path:line`、可派性判定与理由、上游数据文件、未证明事项。
`zc done --verifier '<grep/awk 命令原文>' --coverage '6 角色命座未描述档' --risk '<未证明事项>'`。**不提交**。
<!-- /card:W24 -->

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
