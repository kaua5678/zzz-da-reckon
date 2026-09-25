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
- **回收时的读法**（2026-09-25）：`wsl_exec` 只回 stdout **尾部**（开头被静默截掉）⇒ 报告 / 长日志先落 `/tmp` 再 `sed -n` 分段读；等工人收工用 WSL 端有界轮询（`pgrep -f '^node .*dsh --profile headless ### <卡>'` 每 10 s 一次，单次调用 ≤ 9 min），远程客户端别用 Node 内置 `fetch` 干等（300 s 自断），见 `docs/mcp-local-subagent-channel.md` §5。
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
| W21 | 琉音转大次数单源化（W16 契约 C） | 实现 | — | 🗑 作废（卡已删）：工人 blocked 证据成立（4 调用点仅 1 处拿得到失衡次数；同局 3 个转大读数不同源）；lead 设计 `docs/mcp-liuyin-promote-source.md` 定单源 = 答案层 `promote` 滞后注入，拆为 W25/W26 |
| W22 | R62-J3 census 指纹侧过期：当前 HEAD 重跑 + 逐角色 diff | 重计算 + 隔离 worktree | `/tmp/wt-W22` 下任意文件、`.zc/reports/W22-census-refresh.md` | 待派发（独占重计算时段；排在 W25/W26 之后，见下方派发顺序） |
| W23 | 爱丽丝(1401) 系留白 6.0s 归因（预测先行） | 只读 + 隔离探针 | `/tmp/wt-W23` 下任意文件、`.zc/reports/W23-1401-slack.md` | ✅ 已回收（15:24；lead 复核 accept。独立负控：只去掉 `resource.ts:644` 的 1s 余量 ⇒ 本队 6→1，全库 29 队逐值复现工人 §5.3 表，另查出 2 队 stable→cycle）。归因 ① 成立但因果改写：pass0 冻 0、pass1 负 excess 19.915 不进 refund、post-fold 试探 attempt1 接受 9.958 后被内层不判稳与 1s 余量联合自锁；变体实验入坑 19 否决记录；卡已删 |
| W24 | 命座「未描述」6 条的原文定位与可派性分诊 | 只读普查 | `.zc/reports/W24-undescribed-triage.md` | ✅ 已回收（14:50；lead 复核 accept：抽查 1121 C1 先例、1271 C1 pending、3 处原文落点均属实）。5/6 原文在库且只是标签错 ⇒ lead 按图例 + 4 条先例裁定改标（问题 Q 取 A）⇒ 派生 W27；1551 C6 真·未揭示 ⇒ OPEN-ITEMS §1 待供料；卡已删 |
| W25 | 琉音转大次数四读数：预测探针 | 只读 + 隔离探针 | `/tmp/wt-W25` 下任意文件、`.zc/reports/W25-promote-readings.md` | 🏃 已派发（2026-09-25 14:52，与 W23 并行：两者都只跑定向探针，不占全量时段） |
| W26 | 琉音转大次数单源化：非轴接线（替代 W21） | 实现（隔离 worktree） | 见卡 | 待派发（**必须等 W25 回收且 `design-gate: PASS`**） |
| W27 | 命座「未描述」5 条改标（原文已收到、防御 / 生存向不建模） | 数据订正 | 两份 JSON 各 5 / 4 档 + `docs/implementation-status.md`（生成） | ✅ 已合入（`749e047`；lead-arena-0925b 复核 accept：语义 diff 恰 5 + 4 档、效果句逐条对 `data/raw` 原文、正控 validate:data / modelingGaps 9/9 / check-guards 21、负控 1271 C1 改回 ⇒ 未描述 1→2，`cp` 还原后三文件 sha256 逐位一致；卡已删） |
| W28 | 命座镜像 `cinemaImplementation` 单源化预审（62 档 status 不一致） | 只读普查 | `/tmp/w28/`、`.zc/reports/W28-mirror-census.md` | ✅ 已回收（15:43；lead-arena-0925b 复核 accept：结论 `可删`——9 处读者逐一只取已知键、独有信息 0 条；lead 隔离 worktree 删光镜像后 validate:data / modelingGaps 9/9 / check-guards 21 全绿、状态表逐字不变。更正：带镜像的是 41 角色（非 47）；漏了复数键 `cinemaImplementations`（1481）⇒ 均写进 W29；卡已删） |
| W29 | 删命座镜像 `cinemaImplementation(s)`，单源 = constellations | 实现 | `public/static/character-mechanics.json`（只删两键）、`scripts/sync-new-role-status.mjs`、`scripts/validate-data.mjs`、`.zc/reports/W29.md` | ✅ 已合入 `798bb4d`（15:47 派发、约 6 分钟收工；lead-arena-0925b 复核：语义 diff 恰为 41 + 1 个键删除、无其它变化；正控 validate:data 366 / modelingGaps 9/9 / check-guards 21 / 状态表零 diff；负控单、复数键均红；lead 改 1 词 `信 确认→信 高`；卡已删） |

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

**当前派发顺序（2026-09-25 15:35 lead-arena-0925 现场核实）**：W23 于 15:24、W24 于 14:50 回收；在跑 = W25（lead-arena-0925，14:52）+ W27（lead-arena-0925b，15:25），2 个并发位已满。
下一步：W25 回收并判 design-gate → W26（隔离 worktree）→ lead 合入（重生成基线 + 全量 verify）→ W22（独占重计算时段，等前面全部停下再派）。W27 已于 15:30 合入（`749e047`）；W28（15:43 回收）→ W29 已合入（`798bb4d`，命座镜像删除，单源 = constellations）。
W25/W26/W27 与 W22 的写入面互不相交；W26 只在 `/tmp/wt-W26` 里改 `liuyin.ts`，合入前主仓库的这个文件无人写。派发前照本节开头查重。
**双 lead 分工（2026-09-25 15:15 起）**：两条 lead 会话并行，分工单源在 `.zc/lead-coordination.md`（不入库）——W23 复核、W25 → W26 归 `lead-arena-0925`；W27、W22 归 `lead-arena-0925b`。第三条会话接手前先读它，别照本段顺序自己派。

## 2. 任务卡

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

<!-- card:W25 -->
### W25 · 琉音转大次数四读数：预测探针（只读，不实现）

你是执行工人，只完成本卡，不继续委派。TASK_ID=W25。
工作区 `/home/kaua/projects/zzz-calculator`（只读）；探针只在隔离 worktree `/tmp/wt-W25`。开工打印真实 HEAD 与 `git status --short`。
父目标：lead 设计 `docs/mcp-liuyin-promote-source.md` 要把「转大次数」统一到答案层 `promoteFixpoint(...).promote`（其余消费点读上一轮值）。本卡在**不改任何计算行为**的前提下读出现状的四个读数，检验设计的前提假设，并给 W26 提供逐 key 预测。

**先读**：`docs/mcp-liuyin-promote-source.md` 全文（§1 四读数表、§3.2、§5 闸门）；`.zc/reports/W21.md` §2.3 / §3 / §7.2（插桩手法；`/tmp/w21-probe-full.txt` 若还在可对照）；`.zc/reports/W16-predict.md` 附录 A（探针源码，可直接复用）；
`src/composables/useResourceCalc.ts:355-454`（外层循环、`outerExit`、`outPrev`）；`src/composables/resourceCalc/convergence.ts:1097-1168`、`:1442-1500`；`src/mechanics/agents/liuyin.ts:165-201`、`:534-563`；`src/core/resource.ts:1121`（`liuyinGiftTimeReserved`）；`src/composables/__tests__/timeGolden.test.ts`（key 怎么生成）。

**允许写入**：`/tmp/wt-W25` 下任意文件（`git worktree add --detach /tmp/wt-W25 HEAD` 后 `ln -s /home/kaua/projects/zzz-calculator/node_modules /tmp/wt-W25/node_modules`）；报告 `.zc/reports/W25-promote-readings.md`（先 `zc claim`）。
**禁止**：改主仓库任何文件（报告除外）；改基线；跑全量 vitest / build；worktree 内插桩只许**读出**（打印 / 写 JSON），不许改任何计算值——收工前在 worktree 里跑一次 `timeGolden` 证明插桩后仍 EXIT=0。

**步骤与验收**：
1. 从 `src/composables/__tests__/timeGolden.baseline.json` 枚举含 `1481` 的 key（lead 实测 25 个：`agent:1481:c0/c3/c4/c5/c6` + 20 个 `preset:auto-*-1481-*`），数目不一致就写 discrepancy。
2. 每个 key 读出**最终被接受那一轮**的：`axisMode`、`outerExit`、`plannedStunCount`、`stunPool.stunCount`、`G`（`liuyinMechanicSource.goodReviewTotal`）、`ownUltimateCount`、1481009 行 `count`、`floor(G/90)`、`promote` / `promoteHug60`、目标槽 `source==='gift'` 行 `count`、`liuyinGiftTimeReserved` 与目标终结技单次时长（二者之比 = 预留次数）、**上一轮**（`outPrev`）的 `promote`。
3. 一致性四判据（每 key 一行）：C1 `1481009 count − ownUlt == promote`；C2 `预留次数 == promote`（仅非轴）；C3 `赠行 count == promote`；C4 `outPrev.promote == promote`。
4. 设计闸门：列出所有「非轴 且 `outerExit==='stable'` 且 C4 不成立」的 key。**非空 ⇒ 设计前提被证伪**，照写，不要解释成通过。
5. 一阶预测表（W26 对账用）：非轴 key 写 `送客行Δ = outPrev.promote − floor(G/90)`、`预留Δ = outPrev.promote − 预留次数`；轴 key 写 0。
6. 专项核对 `agent:1481:c0`（设计 §5 的具体预测：预留 4、赠行 3、送客 = 3 + ownUlt），逐项写实测值与是否吻合。
7. 收工：`unlink /tmp/wt-W25/node_modules` → `git worktree remove --force /tmp/wt-W25`；主仓库 `git status --short` 只允许既有项。

**证伪闸门**：前提假设 = 非轴 stable 出口上 C4 恒成立（滞后已沉降），C1/C2 的不成立只来自 floor / 计划值这两个旧读数。
可观察失败 = 步骤 4 列表非空，或存在 C3 不成立的 key（赠行与答案层自身不一致 = 设计之外的缺陷）。两种情况都照实报告，仍是 `STATUS: done`，第二行写 `design-gate: FAIL`。

**固定报告与收工**：首行及最终回复 `STATUS: done|blocked`，第二行 `design-gate: PASS|FAIL`。含 HEAD、key 总数、探针源码全文、逐 key 原始表、四判据汇总、闸门列表、预测表、`agent:1481:c0` 专项、未证明事项。
`zc done --verifier '<探针命令原文>' --coverage '含 1481 的 timeGolden key 全集' --risk '<未证明事项>'`。**不提交**。
测试时段已授予（只跑探针与一次 timeGolden 自检）。
<!-- /card:W25 -->

<!-- card:W26 -->
### W26 · 琉音转大次数单源化：非轴接线（替代 W21）

你是执行工人，只完成本卡，不继续委派。TASK_ID=W26。
工作区：隔离 worktree `/tmp/wt-W26`（`git worktree add --detach /tmp/wt-W26 HEAD` + 软链 `node_modules`），**禁止改主仓库源码**。开工打印两边 HEAD 与 `git status --short`。
父目标：按 `docs/mcp-liuyin-promote-source.md` §3.1 把非轴模式下的「转大次数」统一到答案层（上一轮 `promote` 滞后注入）。
**前置**：`.zc/reports/W25-promote-readings.md` 存在且第二行为 `design-gate: PASS`；否则立即 `STATUS: blocked`，不要动手。

**先读**：`docs/mcp-liuyin-promote-source.md` 全文；`.zc/reports/W25-promote-readings.md`（逐 key 预测表、取数方式）；`AGENTS.md` §1 规则 6 / 10 / 11 / 16、§5；
`src/composables/resourceCalc/roundThreads.ts`（头注释 + `prevPoolStunCount` 的定义与初值）；`src/composables/resourceCalc/convergence.ts:1097-1110`、`:1442-1500`；`src/mechanics/agents/hugo.ts:330-370`（converge 相位读 `threads` 的先例）；`src/mechanics/types.ts:230-310`（`applyTeamConfig` 入参、`phase`、`threads`）；`src/mechanics/agents/liuyin.ts` 全文。

**允许写入**（除报告外只在 worktree 内）：`src/composables/resourceCalc/roundThreads.ts`（加字段 + 初值）；`src/composables/resourceCalc/convergence.ts`（**只加** `threadsNext.prevPromoteCount` 一行及注释）；`src/mechanics/agents/liuyin.ts`；`src/types/resource/config.ts`（只在 `liuyinCinemaLevel`（`:448`）附近加 `liuyinPromoteLagged?: number` 及注释）；新建 `src/mechanics/__tests__/liuyinPromoteSource.test.ts`；报告 `.zc/reports/W26.md`（主仓库，先 `zc claim`）。
**禁止**：改任何基线（`timeGolden` / `timeFillRatchet`）；改既有测试断言；改 `computeLiuyinHugCounts` / `promoteFixpoint` / `applyLiuyinPromote` 的算法；改 `outerFeedbackSignature`；改变轴模式行为（生产端必须带 `!axisMode` 条件）；跑全量 vitest / `npm run verify` / build。

**步骤与验收**：
1. 接线：照设计 §3.1 第 1–5 步逐条做。`@fact` 行格式照 `liuyin.ts:96-97` 的既有写法，「验」指向新测试。
2. 新测试 `liuyinPromoteSource.test.ts`（用 `src/test/harness.ts` 的 `setupHarness` / `setTeam`，不许复制 fetch stub）：
   ① 纯函数：不传 `promoteCount` 时 `promoteWindows === Math.floor(G/90)`（取 W21 报告的 G=363、G=207 两例）；传 `promoteCount: 5` 时 `promoteWindows === 5`、`farewellCount === 5 + ownUltimateCount`。
   ② 管线不变量：对 W25 表里全部「非轴 且 stable」的琉音 key，断言 `1481009 count − ownUlt === promote === 预留次数 === 赠行 count`（取数方式复用 W25）。
3. 负控（必做，写进报告）：`cp` 备份 `liuyin.ts` → 把 `promoteWindows` 临时改回忽略 `promoteCount` 的 floor → 测试②必须红（贴失败断言）→ 用备份还原 → `git diff --stat` 回到改动态。②在负控下仍绿 ⇒ 测试没咬住，`STATUS: blocked`。
4. 正控：`VITEST_MAX_WORKERS=2 npx vitest run src/mechanics/__tests__/liuyin src/composables/resourceCalc/__tests__/liuyinPromote.test.ts src/composables/__tests__/timeLedgerInvariants.test.ts src/composables/__tests__/giftMoveTimeLedger.test.ts src/composables/__tests__/timeGolden.test.ts`。
   除 `timeGolden` 外必须全绿。`timeGolden` 预期会红：逐条列出 delta，与 W25 预测表**逐 key 对账**——轴 key 必须零 delta；非轴 key 的方向和一阶量必须吻合，二阶偏差逐条归因。**有任何无法归因的 delta ⇒ `STATUS: blocked`**。
5. worktree 内 `npm run check-guards` 必须 EXIT=0。
6. `git -C /tmp/wt-W26 diff > /tmp/W26.diff`，报告贴全文。**不** `git apply` 到主仓库、不提交。确认 `/tmp/W26.diff` 已落盘后收工：`unlink /tmp/wt-W26/node_modules` → `git worktree remove --force /tmp/wt-W26`。

**证伪闸门**：前提假设 = 接线后非轴 stable key 上四读数逐位相等、轴 key 零 delta。可观察失败 = 不变量在某 key 上红、轴 key 出现 delta、或某琉音 key 的 `outerExit` 从 stable 变成 cycle ⇒ 照实报告 blocked，附 key 与数值，不许改测试迁就。

**固定报告与收工**：首行及最终回复 `STATUS: done|blocked`。含两边 HEAD、`/tmp/W26.diff` 全文、负控 / 正控原始输出尾部与退出码、timeGolden delta 全表及与 W25 预测的逐 key 对账、每个琉音 key 的 `outerExit` 前后对照、未证明事项。
`zc done --verifier '<正控命令>' --coverage 'liuyin 转大次数四读数（非轴）' --risk '<未证明事项>'`。**不提交**。
测试时段已授予（定向测试 + check-guards；不跑 build 与全量）。
<!-- /card:W26 -->

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
