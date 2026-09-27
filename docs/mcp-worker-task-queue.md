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
- **工人自测必须含 `npx vue-tsc -b`（2026-09-27 W31 教训）**：vitest 不做类型检查，W31 工人只跑了 vitest，交回的文件有 TS6196（未用类型别名），导致 `npm run verify` 红。今后卡面「验收」一律写上 `timeout -s KILL 600 npx vue-tsc -b` 退出 0；lead 复核时也要单独跑。另外，测试里**不要写 `setTimeout` 等待**（`useResourceCalc` 是同步 computed，W31 工人加了 2s 空等，差点碰到 5s 默认超时）。
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
| W22 | R62-J3 census 指纹侧过期：当前 HEAD 重跑 + 逐角色 diff | 重计算 + 隔离 worktree | `/tmp/wt-W22` 下任意文件、`.zc/reports/W22-census-refresh.md` | ✅ 已回收结案（16:33 收工；lead-arena-0925c 17:50 独立复算 accept：自建 worktree@`6e4f3f6` 重跑 r62census ⇒ 62/62 活跃集零变化、新增 B 恰 4 条 1041:C4 · 1111:C2 · 1141:C4 · 1421:C4、declared 变化恰 W27 五档、白拿 1271:C1 消失、原 B 10 条无一消失，与报告逐项一致；OPEN-ITEMS R62-J3 已结案；卡已删） |
| W23 | 爱丽丝(1401) 系留白 6.0s 归因（预测先行） | 只读 + 隔离探针 | `/tmp/wt-W23` 下任意文件、`.zc/reports/W23-1401-slack.md` | ✅ 已回收（15:24；lead 复核 accept。独立负控：只去掉 `resource.ts:644` 的 1s 余量 ⇒ 本队 6→1，全库 29 队逐值复现工人 §5.3 表，另查出 2 队 stable→cycle）。归因 ① 成立但因果改写：pass0 冻 0、pass1 负 excess 19.915 不进 refund、post-fold 试探 attempt1 接受 9.958 后被内层不判稳与 1s 余量联合自锁；变体实验入坑 19 否决记录；卡已删 |
| W24 | 命座「未描述」6 条的原文定位与可派性分诊 | 只读普查 | `.zc/reports/W24-undescribed-triage.md` | ✅ 已回收（14:50；lead 复核 accept：抽查 1121 C1 先例、1271 C1 pending、3 处原文落点均属实）。5/6 原文在库且只是标签错 ⇒ lead 按图例 + 4 条先例裁定改标（问题 Q 取 A）⇒ 派生 W27；1551 C6 真·未揭示 ⇒ OPEN-ITEMS §1 待供料；卡已删 |
| W25 | 琉音转大次数四读数：预测探针 | 只读 + 隔离探针 | `/tmp/wt-W25` 下任意文件、`.zc/reports/W25-promote-readings.md` | ✅ 已回收（15:51；lead 复核 accept。重放：正控 25/25 个 key 逐字段一致；负控送客 +1 ⇒ C1 23→0）。前提成立（非轴 stable C4 25/25，闸门 0 条）；卡面 `design-gate: FAIL` 全部来自 5 个单角色 key 的空目标槽 ⇒ lead 裁定为夹具边界，设计 §8 增补生产端「目标槽有角色」条件；现语料四读数重合 ⇒ W26 改为零 delta 重构；卡已删 |
| W26 | 琉音转大次数单源化：非轴接线（替代 W21） | 实现（隔离 worktree） | 见卡 | ⛔ lead 合入时 blocked（16:20 回退，未合入；卡已删）：工人实现合格（不变量 14/14、负控 14/14 红），但 timeGolden 4 预设 12 条 delta，且全量 check 在棘轮路径红（`auto-1201-1481-1491` 留白 0→1.3s 等 4 队、`truncationRefold` ④ 样本塌缩）⇒ 滞后注入改变外层暂态、落点路径敏感。diff 存档 `.zc/reports/W26-merge-attempt.diff`；重设计方向 = 出口校验 + 校正轮（设计文档 §9） |
| W27 | 命座「未描述」5 条改标（原文已收到、防御 / 生存向不建模） | 数据订正 | 两份 JSON 各 5 / 4 档 + `docs/implementation-status.md`（生成） | ✅ 已合入（`749e047`；lead-arena-0925b 复核 accept：语义 diff 恰 5 + 4 档、效果句逐条对 `data/raw` 原文、正控 validate:data / modelingGaps 9/9 / check-guards 21、负控 1271 C1 改回 ⇒ 未描述 1→2，`cp` 还原后三文件 sha256 逐位一致；卡已删） |
| W28 | 命座镜像 `cinemaImplementation` 单源化预审（62 档 status 不一致） | 只读普查 | `/tmp/w28/`、`.zc/reports/W28-mirror-census.md` | ✅ 已回收（15:43；lead-arena-0925b 复核 accept：结论 `可删`——9 处读者逐一只取已知键、独有信息 0 条；lead 隔离 worktree 删光镜像后 validate:data / modelingGaps 9/9 / check-guards 21 全绿、状态表逐字不变。更正：带镜像的是 41 角色（非 47）；漏了复数键 `cinemaImplementations`（1481）⇒ 均写进 W29；卡已删） |
| W29 | 删命座镜像 `cinemaImplementation(s)`，单源 = constellations | 实现 | `public/static/character-mechanics.json`（只删两键）、`scripts/sync-new-role-status.mjs`、`scripts/validate-data.mjs`、`.zc/reports/W29.md` | ✅ 已合入 `798bb4d`（15:47 派发、约 6 分钟收工；lead-arena-0925b 复核：语义 diff 恰为 41 + 1 个键删除、无其它变化；正控 validate:data 366 / modelingGaps 9/9 / check-guards 21 / 状态表零 diff；负控单、复数键均红；lead 改 1 词 `信 确认→信 高`；卡已删） |
| W30 | `check-tokens` hint 指向不存在的令牌（`--text-2`/`--text-3` 应为 `--fg-2`/`--fg-3`） | 守卫文案订正 | `scripts/check-tokens.mjs`（只改字符串）、`.zc/reports/W30.md` | ✅ done `b7f5b77`（2026-09-27 第 59 轮 lead 直接做：只改 2 处字符串，不值得派工人；闸门通过，check-tokens 数字逐位不变） |
| W31 | 悠真轴模式 `stunOnlyDmgBonus` 伤害池消费端测试（CC-33a 覆盖盲区） | 新增测试 | 新测试文件 1 个 + `.zc/reports/W31.md` | ✅ done `618366b`（2026-09-27 第 59 轮 dsh 工人产出，lead 复核修 2 处；见 census §5.46） |

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

**当前派发顺序（2026-09-25 17:50 lead-arena-0925c 现场核实）**：W22–W29 均已回收结案（W26 为 lead 合入时 blocked）；此刻无工人在跑，主仓库干净。
下一步：琉音单源化待按设计文档 §9 的「出口校验 + 校正轮」重写卡，验收必须同时覆盖 `timeGolden` / `timeFillRatchet` / `truncationRefold`；计算核心 CC 系列另走 `docs/mcp-calc-core-architecture.md` §5（lead-arena-0925c 在推）。
派发前照本节开头查重。
**双 lead 分工（2026-09-25 15:15 起）**：两条 lead 会话并行，分工单源在 `.zc/lead-coordination.md`（不入库）——W23 复核、W25 → W26 归 `lead-arena-0925`；W27、W22 归 `lead-arena-0925b`。第三条会话接手前先读它，别照本段顺序自己派。

## 2. 任务卡

### W30 · `check-tokens` 的 hint 把改样式的人指向**不存在**的令牌

- **一句话**：守卫脚本报错时推荐用 `--text-2` / `--text-3`，但仓库里没有这两个变量（只有字号用的 `--text-2xs` / `--text-2xl`）；真正的文字色语义别名是 `--fg-2` / `--fg-3`（`--fg-2` = `var(--wa-750)`）。照提示改必然失败 ⇒ 守卫在骗人，必须订正文案。
- **类型**：守卫文案订正（纯字符串）。**写入白名单**：`scripts/check-tokens.mjs`、`.zc/reports/W30.md`。**其它文件一律不许碰**。
- **先读**（只读这两个）：① `grep -nE '\-\-text-[23]\b' scripts/check-tokens.mjs`（实测约 650 行、1023 行两处 hint，**以 grep 为准，别信本卡行号**）；② 令牌定义文件里 `--fg-2` / `--fg-3` / `--text-2xs` / `--text-2xl` 的真实定义（用 `grep -rnE '^\s*--(fg-[23]|text-2(xl|xs)?):' src/` 找，别假设在 `global.css`）。
- **硬约束**：① 只改**字符串与注释**，计数逻辑、判定分支、基线常量（`VAR_TOTAL_BASELINE`=808、`WA_REF_BASELINE`=447）**一个都不许动**；② 改前先跑前提假设的证伪命令（见下），前提不成立就**停手写报告**，不许顺手改代码；③ 不许顺带重排格式、改引号风格、动缩进；④ 单卡单提交。
- **前提假设（证伪闸门）**：假设「`--text-2` / `--text-3` 在全仓既无定义也无有效引用」。
  **可观察失败** = `grep -rnE '\-\-text-[23]\b' src/ scripts/ public/ 2>/dev/null` 出现**定义**（形如 `--text-2:` 在 `:root`/主题块里）或出现被 CSS 真正消费的引用 ⇒ 前提不成立，本卡作废：不改任何文件，把 grep 原始输出贴进 `.zc/reports/W30.md` 并收工。
  （注意：`scripts/check-tokens.mjs` 自己的 hint 里出现不算「引用」，那是本卡要改的对象。）
- **验收（四条全绿才算完）**：
  1. `npm run check-tokens` 12 项全绿，且**输出的数字与改前逐位相同**（基线没被碰动的证据）——贴改前、改后两段命令输出尾部；
  2. `grep -nE '\-\-text-[23]\b' scripts/check-tokens.mjs` 返回 **0 行**；
  3. `git diff --stat` 只有 1 个文件，`git diff` 里每一行改动都是字符串/注释（**贴完整 diff**，预期 ≤ 20 行；超了说明改多了）；
  4. `npm run check-guards` 全绿（确认没碰坏别的守卫）。
- **报告**：`.zc/reports/W30.md` 按 `AGENTS.md` §5 四段式写，**每条验收都附真实命令输出的尾部**（转述不算数）。若走了证伪分支，报告里写清「前提不成立 + grep 原文」即可收工。

### W31 · 悠真轴模式 `stunOnlyDmgBonus` 在伤害池里被消费：补单测

- **一句话**：`SkillExecution.stunOnlyDmgBonus`（CC-33a 从 `harumasaStunOnly` 改名而来）只在轴模式下由悠真写入，伤害池 `damagePoolDirect.ts` 按段直加（轴内段 `stunOverride > 0` 才加）。perf 语料没有走到这条路径（census §5.28 反向变异实测 0 个 1201 键出差），**读取侧目前没有任何测试**。
- **类型**：新增测试。**写入白名单**：`src/composables/__tests__/harumasaStunOnlyAxis.test.ts`（新建）、`.zc/reports/W31.md`。**其它文件一律不许碰**（尤其不许为了能测而改源码）。
- **先读**：① `grep -n 'stunOnlyDmgBonus' src -r`（写入点 `harumasa.ts`，读取点 `damagePoolDirect.ts`）；② `grep -rln 'axis' src/composables/__tests__ | head`，找一个已有的「开轴模式跑整条管线」的测试照抄它的 harness 写法（`setupHarness` / `applyTeamToStore` / 轴相关开关）；③ 悠真预设 `src/data/teamPresets/auto-1201-*.json`。
- **前提假设（证伪闸门）**：假设「用现有 harness 能跑出轴模式下悠真的直伤行，且其中存在 note 含 `失衡增伤+` 的行」。**可观察失败** = 照抄已有轴模式测试的写法后，悠真槽位的直伤行里一条含 `失衡增伤+` 的都没有 ⇒ 停手，把你尝试过的配置和行 note 样本贴进报告，不许改源码凑结果。
- **断言**：① 至少一条悠真直伤行 note 含 `失衡增伤+`，且该行 id **不以** `-out` 结尾；② 所有 id 以 `-out` 结尾的悠真直伤行 note **都不含** `失衡增伤+`。
- **验收**：新测试绿；**负控**：把 `damagePoolDirect.ts` 里 `stunOnlyDmgBonus = stunOverride > 0 ?` 临时改成 `>= 0 ?`，新测试必须变红，然后还原（`git diff src/composables/resourceCalc/` 为空）。报告按 `AGENTS.md` §5 四段式写，附正控、负控两段命令输出的尾部。

- **CC-14a**（架构线，lead-arena-0925c 立卡）：卡面在 `docs/mcp-r22d1-batch12-field-census.md` §5.2。**前置门：R1（`docs/REQUIREMENTS.md`）合入、src 无 cinemaUplift WIP**，未满足前不要派。（2026-09-26：R1 已完成 `ce307a0` / `4d80086`，**前置门已开**，派发前按 census 文档 §4 重新生成基线。） **2026-09-26 第 18 轮：卡面已修订为 §5.2-v2（模块能力 bonusEnergy，输入端不动），已派发，worktree /home/kaua/r67-scratch/cc14a。** ✅ **CC-14a done `285885b`（判据 22 803→775）。**
- **CC-14c** ✅ `ba6db48`、**CC-14d** ✅ `e94b896`（lead 直接实现，判据 22 →763）。**CC-14e** ✅ `1e3dc99`（判据 22 →759）：适合派 dsflash 工人，在 worktree 里做，零差/反向由 lead 复核。
- **CC-15** ✅ `b1ed48e`（判据 22 →733，target 重设 720；lead 直接实现，没派工人）。
- **CC-16** ✅ `fe8fb90`（判据 22 →712，target 重设 700）。
- **CC-17** ✅ `18bfd88`（判据 22 →661，target 重设 649；dsflash 工人 df83ebd，修可琳 basic_attack 轴模式泄漏）。
- **CC-18a** ✅ `23470f2`（判据 22 →623，target 重设 611；dsflash 工人 6e0de26）。
- **CC-18b**（琉音 3 块附加直伤行）**done** `a936127`（判据 22 623→613）。**CC-18c** 并入 **CC-19**：**CC-19a done** `b14fb4a`（判据 22 613→601，target 589）；**CC-19b done** `3fbb326`（判据 22 601→545，target 533）；**CC-19c done** `b45652c` + `de1cc8d`（判据 22 →499）。**CC-20 done** `ea61032`（口径纠正 →462，target 450）。**CC-21 done** `3d000d0`（判据 22 →447，target 435）。**CC-22 done** `05bb382`（修订版，判据 22 →430，target 418；原改名方案作废，见 census §5.16）。**CC-23 done** `8ecd5f2`（判据 22 →420，target 418）。**CC-24 done** `1d1d823`（判据 22 →410，target 398）。**CC-25 done** `7cef9c8`（判据 22 →403，target 398）。**CC-26 done** `8b7d9db`（判据 22 →363，target 351）。**CC-26b done** `0d65f59`（判据 22 →357，target 351）。**CC-28 done** `69e85c4`（判据 22 →340，target 328）。**CC-29 done** `69b53f9`（判据 22 →332）。**CC-30 done** `371a2c1`（判据 22 →326，target 314）。**CC-31 done** `0b8a28a`（判据 22 →270，target 258）。**CC-32a done** `0671c4c`（判据 22 →254，target 242）。**CC-32b done** `a276399`（判据 22 →231，target 219；census §5.27）。**CC-33 done** `e882b9f`（判据 22 →219，target 207；census §5.28，衍生 W31）。**CC-34a done** `7de5847`（普查 + 面板属性表驱动，判据 22 →171，target 159；census §5.29）。**CC-34b done** `db01cb6`（判据 22 →155，target 143；census §5.30）。**CC-34c①+34d done** `372bbed`（判据 22 →149；census §5.31）。**CC-34c② done** `99b945a`（判据 22 →148；census §5.32）。**CC-35a done** `c684126`、**CC-35b done** `084a4e7`（判据 22 →134，target 122；census §5.33）。**CC-35c-A done** `d40a62d`、**CC-35c-B done** `b7b0d81`（判据 22 →125；census §5.34）。**CC-35c-C done** `c763f5a`、**CC-35c-D done** `dbc7e92`（判据 22 →103，target 91；census §5.35）。**CC-35d-A done** `a1241ba`（判据 22 →92；设计稿 `docs/mcp-cc35d-gift-chain.md`，census §5.36）。**CC-35d-B1/B2/B3 done** `0aa191e` / `e9e80cd` / `840fa70`（判据 22 →63，target 51；census §5.37）。**CC-36a/36b done** `8af6ca2` / `1ea574e`（维琳娜清零，判据 22 →34，target 28；census §5.38）。**CC-37 done** `f67c0ab`、**CC-39a done** `a87da93`（判据 22 →22，target 10；census §5.39）。**CC-38 done** `7b865bf`（判据 22 →7，target 0；census §5.40）。**CC-39b done** `a1eb71e`（判据 22 →5；census §5.41）。**CC-40 done** `0b6b973`（**判据 22 清零 = 硬门**；census §5.42）。**CC-39c done** `0f9f329`。下一步 **CC-41**（蕾米埃尔 1 命花羽轮舞喧响次数无写入方 ⇒ 效果恒 0；卡片见 census §5.43），再做 §5.43 列的调研项；调研待派：花羽轮舞次数没有写入方（census §5.31 未决）；CC-27（维琳娜风蚀）待设计。
- **CC-41**（蕾米埃尔 1 命花羽轮舞喧响）**done** `8b2a1d2`：moduleFeedback `remielleFlowerFeatherDanceCasts` 跨轮接通，perf 仅 `auto-1581-1501-1561/c6` 出差（预期），新基线 dump-41/rows-41；详见 census §5.44。
- **CC-42**（风化浸染挑槽排除 → 模块能力 `excludeFromWindInfectionPick`）**done** `d57c0c3`，零差。**莱特额外能力 buff 默认生效性**已核实：生效，推荐配装顶在 75，回归测试 `edecb55`。**CC-35d-B4** 已并入 CC-40，不要再开工。详见 census §5.45。
- **CC-43a** done `d573b4a`（纯命名去角色名，零差）、**CC-43b** done `6a6c6d7`（判据 23 基线 13）。还款卡 CC-43c–f 待做，下一张 **CC-43d**（`computeRemielleEntryPanel` 先读后改名）。详见 census §5.47。
- **CC-43d** done `afc6003`、**CC-43e** done `7ae18b5`（判据 23 13→6，均零差）。下一张 **CC-43f**（希格莉德破阵展开 → 模块钩子），见 census §5.48。
- **CC-43f** done `cf5f270`（希格莉德破阵展开 → 模块钩子 expandAxisAction，零差；判据 23 6→4）。下一张 **CC-43c**（最后一张），见 census §5.49。
- **CC-43c** done `4f3d1ea`（琉音转大次数 → 模块能力 promoteHugCounts，零差；判据 23 4→0 转硬门）。CC-43 系列全部完成；下一步见 census §5.50（resolveUltimateTargetSlot 迁移 / 补测）。
- **CC-44** done `50f09d7`（resolveUltimateTargetSlot 迁 core/resource/targetSlot.ts，零差）。下一步见 census §5.51（补测 / 判据 24 候选）。
- **CC-45** done `bf971b3`（判据 24 硬门：编排层 + core 禁按值依赖 mechanics/agents/*，多行语句感知）。⚠ check-guards.mjs 新增转出须同步 scripts/check-guards.d.mts。下一步见 census §5.52。
- **CC-46** done `d655e9c`（补测：无琉音时跳过转大轴块，直测 buildStackAxes；双向反向变异红）。下一步见 census §5.53（判据 7 展示层越层 14）。
- **CC-47** done `79f0f6b`（判据 7 14→10：展示层 getAgentMechanic×4 → composables/agentMechanicView.ts）。下一步见 census §5.54（StunAxisPage 的 banyue/yixuan 导入 → 模块能力）。
- **CC-48** done `d98cfaf`（判据 7 10→8：StunAxisPage banyue/yixuan → 模块能力 axisEditorBlockMarks / axisMoveMeta）。下一步见 census §5.55（buildTeammateBuffSourceContext ×2）。
- **CC-49** done `b285a4f`（判据 7 8→6：两页面相同的 buff 来源依赖组装 → composables/teammateBuffContext.ts）。下一步见 census §5.56（allocateAxisWindows）。
- **CC-50** done `7cf440d`（判据 7 6→5：allocateAxisWindows → composables/stunAxisView.ts，纯转发如实标注）。下一步见 census §5.57（TeamConfigPage 局外面板 → computeOutOfCombatPanel，−2）。
- **CC-51** done `baceb72`（判据 7 5→3：TeamConfigPage 局外面板 → composables/outOfCombatPanel.ts）。下一张 **CC-52**：ImpactChart 副词条优化器 → 编排层（见 census §5.58，含剩余 3 处评估表）。
- **CC-52** done `789a27e`（判据 7 3→2：ImpactChart 副词条优化器 → composables/substatOptimizer.ts）。下一张 **CC-53**：ImpactChart 影响变量 → composables/impactVariables.ts（见 census §5.59，注意写死的 1171）。
- **CC-53** done `eee038f`（判据 7 2→1：ImpactChart 影响变量 → composables/impactVariables.ts）。下一张 **CC-54**：剩下的 agentSpecs 拍板为永久保留，只改守卫配置，把 target 改为 1 并写明理由（见 census §5.60，单独成批）。其后：写死角色 ID 声明化（从柏妮思占比变量开始）。
- **CC-54** done `cae6624`（判据 7 收尾：agentSpecs 永久保留，target 0→1）。下一张 **CC-55**：柏妮思异放占比声明化，消掉 impactVariables 和 ResourceUtilizationPage 里两份写死的 1171（调研与步骤见 census §5.61）。
- **CC-55** done `8fec4fb`（柏妮思异放占比声明化：模块声明 releaseShare 加门面 teamReleaseShares，两份写死的 1171 已消掉）。下一张 **CC-56**：展示层写死角色 ID 普查，先量后改（粗查结果和步骤见 census §5.62）。候选 CC-57b：其他 dominant 异放角色开放占比调节，属功能变更，暂不做。
- **CC-56** done `3978312`（展示层写死角色 ID 普查表见 census §5.63；ResourceUtilizationPage 两处 1581 已还，改为 teammateSplit 和 excludeFromWindInfectionPick 声明）。下一张 **CC-57**：StunAxisPage 招式级写死（1051012 隐藏、1371022/026 标签）改为模块声明 axisHiddenMoves / axisMoveSuffix。
- **CC-57** done `de68f86`（StunAxisPage 招式级写死改为 axisHiddenMoves / axisMoveSuffix）。下一张 **CC-58**：StunAxisPage 的 liuyinSlot（1481）改走已有声明 ownsPromoteVariantAxisBlocks，与引擎 buildStackAxes 同源（见 census §5.64 剩余表）。
- **CC-58** done `f7d1a1a`（StunAxisPage 转大块拥有者改走 ownsPromoteVariantAxisBlocks）。下一张 **CC-59**：般岳怒相连段 comboId 改为模块声明 axisRageCombos（census §5.65 方案 A）。CC-60，优先级低：自动轴预设自带档位标签，消掉有琉和伊德海莉章节的写死。
- **CC-59** done `e2e5d37`（般岳怒相连段 comboId → 模块声明 axisRageCombos，门面 agentAxisRageCombos）。下一张 **CC-61**：StunAxisPage 诺姆 1571 / 希格莉德 1591 专属轴块 → 模块声明 axisExtraBlocks（census §5.66 有可直接开工的步骤）。之后 CC-62 专属窗口 lane（banyueSlot/yixuanSlot）；CC-60 低优先级。
- **CC-61** done `c73f7ab`（诺姆 / 希格莉德专属轴块 → 模块钩子 axisExtraBlocks，门面 agentAxisExtraBlocks）。下一张 **CC-62**：StunAxisPage banyueSlot/yixuanSlot → 模块声明 axisWindowLane（'mingwang'/'ningshen'）+ 门面 teamAxisWindowLaneSlot（census §5.67）。CC-60 低优先级。
- **CC-62** done `737b2c4`（StunAxisPage lane 拥有者 → axisWindowLane，门面 teamAxisWindowLaneSlot；StunAxisPage 系列收口）。下一张 **CC-63**：编排层 roundInputs.ts 平A兜底写死 1051 / 1041 → 模块钩子 expandBasicFill（计算路径，需 perf 零差；census §5.68）。之后 CC-64 stores/config.ts 写死、TeamConfigPage 13 处；CC-60 低优先级。
- **CC-63** done `51b1cb3`（roundInputs 平A兜底 1051/1041 → 模块钩子 expandBasicFill；perf dump/rowsnap DIFF 0；agentId 棘轮 3→1）。下一张 **CC-64**：stores/config.ts defaultBasicAttackTimeWeight 写死 1581/1331 → 模块声明（census §5.69 步骤 1）；CC-64b 蕾米埃尔额外能力、CC-64c 波可娜 C6 buff 互斥（低）。
- **CC-64** done `ac4e8d3`（stores/config.ts 默认平A权重 1581/1331 → 模块声明 defaultBasicAttackTimeWeight；store 首次按值 import @/mechanics）。下一张 **CC-64b**：蕾米埃尔额外能力档位（config.ts getRemielleAdditionalState + 5 个 buff 门控）→ 模块钩子 teammateBuffGate（census §5.70）。
- **CC-14a 前置门已于 2026-09-26 打开（lead 现场核实，可直接派）**：R1 已合入（提交号见 `docs/REQUIREMENTS.md` R1 行末 `[done <sha>]`；方案与证据见 `docs/mcp-cinema-uplift-multi-metric.md`），`git status --short src/` 干净、无 cinemaUplift WIP。
  **相交点已核，派单时必须带这三句**：① R1 的「能量」栏读的是 `energyTotal`，**不是** CC-14a 要删的 6 个键之一，但 CC-14a 的零差闸门（dump 624 / rowsnap 637）覆盖 `energyTotal` ⇒ 该栏受零差保护；② R1 新增的另 6 个指标（`totalStunBuildUp`/`anomBuildUp`/`decibelTotal`/`exSpecial`/`anomTriggers`/`coverage`）**不在 perf 语料里**，其回归网 = `src/composables/__tests__/cinemaUplift.test.ts`（11 测试，其中「不恒 0」「锁下仍会动」两条专门钉口径）+ `allAgentsSweep.test.ts`（311）⇒ **CC-14a 收尾必须额外跑这两个文件**，只跑 perf 零差会漏；③ R1 已把命座分析的「锁定场景读数」收敛到 `cinemaUplift.ts` 的 `readScene()` 一处，CC-14a 若动 `EnergySource` 结构，改动面就在那一个函数里，别全文件搜。
  **④ 卡面已被修订，派单前先读 §5.2-v2**（`docs/mcp-r22d1-batch12-field-census.md`，2026-09-26 第 18 轮 lead-arena-0925c，**取代旧 §5.2 的「输入端 / core / 零差验证」三条**）：改用模块能力 `bonusEnergy`、**输入端不动**；`EnergySource` 要删的 6 键是 `hatTrickEnergy`/`qingyiC4Energy`/`lycaonC2Energy`/`billyC1Energy`/`yixuanFlashBonus`/`antonC1EnergyGift`，新增 `bonusEntries`；零差基线换成 `/home/kaua/calc-arch/{dump,rows}-H1a.json`（在 `66ba89a` 上带 `PERF_KEY_ALIAS=1` 生成，remap 已按旧键序原位展开 `bonusEntries`）。上面 ①②③ 在 v2 下**仍然成立**（`energyTotal` 不在被删 6 键里、新 6 指标仍不在 perf 语料、改动面仍收敛在 `readScene()`），故不必重写，只需连 ④ 一起交给工人。
- **CC-14b** ✅ done `6d8a995`（架构线，lead-arena-0925c）：卡面在 `docs/mcp-r22d1-batch12-field-census.md` §5.4。在 worktree `/home/kaua/r66-scratch/cc14b` 里做，不碰主仓库；与 R1 不相交。

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
