# 低级模型任务队列（活文档）

> 给 dsh（DeepSeek Harness，子代理路由见 `AGENTS.md` §6）等低成本工人**直接执行**的自包含任务卡。
> 主代理（或用户）挑卡派发；工人只读卡里点名的文件，不需要读 `AGENTS.md` 全文或 `.claude/OPEN-ITEMS.md`。
> 每张卡 = `AGENTS.md` §5 四段式（先读 / 硬约束 / 验收 / 报告）+ §4 证伪闸门（前提假设 + 可观察失败）。
> **维护**：卡只由主代理写，工人不改本文件；卡经主代理复核合入后**删卡**，结论进提交说明，不在此留编年。
> 需要用户裁决、或需要主代理先做设计的活条目不进本队列，留在 `.claude/OPEN-ITEMS.md`。

> **🔝 置顶（R8 改序，第 120 轮更新，以 `docs/mcp-working-model.md` 为准）**：顺序是 **W1–W4（规则减负）→ R6 第 1 步（架构地图 `docs/ARCHITECTURE-OVERVIEW.md`）→ R5 第 2 刀（账本 `docs/mcp-r5-spec-impl-reconciliation.md` §6）→ R6 第 2 步（重构机会清单）**。固定的 lead / worker 分工已废除，本队列的认领纪律不再适用；W3 会把本文件压到 ≤120 行。census 从第 120 轮起冻结，不再追加 §5.x。R7（删除 timeline 死代码）已完成，提交 `8a0159c`。**R4（事件时间轴）已被用户撤销，不要再推进，也不要再提时序仿真。** 开工细节见下方「第 119 轮」交接。

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

- **CC-14a** ✅ done `285885b`（第 116 轮补标；以下为立卡时的原文）（架构线，lead-arena-0925c 立卡）：卡面在 `docs/mcp-r22d1-batch12-field-census.md` §5.2。**前置门：R1（`docs/REQUIREMENTS.md`）合入、src 无 cinemaUplift WIP**，未满足前不要派。（2026-09-26：R1 已完成 `ce307a0` / `4d80086`，**前置门已开**，派发前按 census 文档 §4 重新生成基线。） **2026-09-26 第 18 轮：卡面已修订为 §5.2-v2（模块能力 bonusEnergy，输入端不动），已派发，worktree /home/kaua/r67-scratch/cc14a。** ✅ **CC-14a done `285885b`（判据 22 803→775）。**
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
- **CC-64b** done `5dd0d0f`（蕾米埃尔额外能力档位 → 模块钩子 teammateBuffGate）。下一张 **CC-64c**：波可娜 1351 C6 buff 互斥 → 复用 teammateBuffGate（入参加 groupId / groupCinema；census §5.71）。
- **CC-64c** done `a2d5b9b`（波可娜 C6 互斥 → teammateBuffGate；stores/config.ts 角色 id 分支判定清零；剩 3 处交互默认值数据表并入 CC-65b）。下一张 **CC-65**：TeamConfigPage 角色专属计数输入框（1551×2 / 1471 嘲讽 / 1541 / 1371×5）→ 模块声明 characterCountInputs（census §5.72）；CC-65b 特殊型。
- **CC-65** done `0b3633f`（TeamConfigPage 角色专属计数输入框 → characterCountInputs）。下一张 **CC-65b**：页面特殊型（格挡/双反/弹刀提示/teamHasBanyue）+ config.ts :164/:165/:232 数据表（census §5.73）；其后 CC-60。
- **CC-65b** done `edae81c`（交互默认值/基准排除/格挡·双反/嗔火开关 → 模块声明；TeamConfigPage 与 config.ts 角色 id 清零）。下一张 **CC-60**：StunAxisPage :264/:266/:268（1051/1481）；其后 **CC-66** ResourceResultCard.vue:748 维琳娜（census §5.74）。
- **CC-60** done `9379369`（自动失衡轴章档位/有琉优先 → 模块声明，data 层改注入提示）；**CC-66** done `5e93c6c`（ResourceResultCard 维琳娜腐蚀 → resultCardCorrosion）。下一张 **CC-67**：panelPhases.ts:404–462 队友额外能力表与凯撒/菲欧妮激活特判；其后 CC-68 teamCompare.ts:271、CC-69 damagePoolAnomaly/roundInputs 角色专属字符串（census §5.76）。
- **CC-67** done `b942cb2`（额外能力门控凯撒/菲欧妮修正 → adjustAdditionalAbilityGates；登记表保留）；**CC-68** done `b3a4e70`（teamCompare 般岳 → compareInteractionTypes）。下一张 **CC-69**：roundInputs.ts:229 伊德海莉 1 命单重碾能耗 + damagePoolAnomaly.ts:90 维琳娜风异放事件标记（census §5.77）。
- **CC-69** done `6da5838`（单次碾 1 命能耗 → energyCostAtCinema；风蚀气旋事件 → core 单一事实源）。src 非模块的写死角色 id 只剩注释。下一张 **CC-70**（只读盘点，可派低级模型）：core/** 角色专属数学 → `docs/mcp-core-agent-math-census.md`（census §5.78 有字段与命令）。
- **CC-70/71/72** done（盘点 docs/mcp-core-agent-math-census.md；`81acc14` 气旋事件入模块；`da6f203` 删 core C2 风蚀默认值）。core 角色数学线收口。下一步无强制卡：候选 = 遗留清单里 giftedPolarAssaultCount 多槽语义、11号平A兜底 perf 夹具、specs/agents/1531.json:305 旧表名、starlightBilly.ts:333 重复兜底（均见 census §5.74–5.79）。
- **CC-73** done `074ee50`（比利交互默认值单一事实源 + 1531 spec 旧表名；§5.74 两条坑关闭）。剩余候选按优先级：① perf 夹具补「11号 + 平A兜底」（§5.69，给 CC-63 expandBasicFill 一条零差护栏）；② giftedPolarAssaultCount 多槽求和语义（需先写口径裁定再动代码）；③ teammateBuffGate 多模块同 buff id 合并语义（§5.72，现无冲突实例，可只写裁定）。
- **CC-74** done `788c035`（11号平A兜底端到端测试；候选①关闭）。下一张 **CC-75：giftedPolarAssaultCount 多槽求和语义裁定**——先 `grep -rn giftedPolarAssaultCount src` 找声明者与消费点，读消费点现在是「求和」还是「取第一个」，写裁定（同队两位声明者时的期望口径 + 依据）进 census §5.82；若现状与裁定一致只补一条多槽测试，不一致再改代码并跑 perf 零差。其后候选③ teammateBuffGate 合并语义（§5.72，可只写裁定）。
- **CC-75** done `955ddd5`（giftedPolarAssaultCount 裁定 = 求和，§5.82）。下一张 **CC-76：teammateBuffGate 多模块同 buff id 合并语义裁定**（§5.72）——先读 `src/stores/config.ts` 里调用 `teammateBuffGate` 的循环（grep `teammateBuffGate`），确认现在是「第一个返回非 undefined 的模块说了算」还是别的；再 grep 所有声明者，看有没有两个模块可能对同一 buffId 返回值。写裁定进 census §5.83 + 调用点注释；补一条临时挂第二个 gate 的测试（仿 giftedPolarAssaultCc75 的 afterEach 还原手法）。
- **CC-76** done `33dc2be`（teammateBuffGate 合并 = 逻辑与，§5.83）。下一张 **CC-77：莱特 1161 局内冲击 ×1.2 的低冲击集成覆盖**（census :1238–1241、:1495：推荐配装下冲击 278.49 已顶 75 硬顶，×1.2→×1.3 dump 零差，现在只有模块单测 + 接线测试）。做法：setupHarness 队含 1161 + 一名强攻，**把莱特音擎/驱动盘换成低冲击配装**（或直接压低面板冲击，使局内冲击 × 1.2 < 270），确认 `lighter.additional_morale_ice_fire_dmg` 门控开；然后临时把模块系数改大（仿 CC-74 缩放钩子 + afterEach 还原）断言队友伤害变化 > 0。只加测试，写 census §5.84。其后：CC-57b（§5.62）、风染挑槽无 UI 开关、CC-60 横幅「有琉」多声明者文案（均低）。
- **CC-77** done `8095ea8`（莱特 ×1.2 集成覆盖，§5.84）；CC-57b / 风染挑槽 UI 开关裁定不做（功能变更，等 REQUIREMENTS）。下一张 **CC-78：解开「赠送极性强击 ↔ anomalyPoolSetup」耦合**（§5.82 已知耦合）。
  - 改 `src/composables/resourceCalc/roundInputs.ts#calcAnomalyPoolInput`：`giftedTriggerCounts: setup && giftedPolarAssault > 0 ? … : undefined` 去掉 `setup &&`。先读 `core/anomalyPool.ts:172` 起确认 giftedTriggerCounts 在 `coweringConfig` 缺省时也能独立工作。
  - 等价性：唯一提供方爱丽丝同时声明 anomalyPoolSetup；但 `anomalyPoolSetup` 在 `cfg.aliceEnabled` 为假时返回 null——要核实此时 `aliceSwordWillSource.sparkCount` 是否一定为 0，否则行为会变（若不一定为 0，改为在 alice.ts 的 `giftedPolarAssaultCount` 内部加同一门控，保持逐值等价）。
  - 验证：perf 零差（`.zc/perf/` dump + rowsnap，`cls41.mjs` DIFF 0，流程见 census §5.69）；`giftedPolarAssaultCc75.test.ts` 第 1 条（要求声明者同时声明 anomalyPoolSetup）改为只锁声明者列表，并补一条「只声明 giftedPolarAssaultCount 的临时模块，赠送照样进异常池」的测试。写 census §5.85。
- **CC-78** done `b7168da`（赠送与 anomalyPoolSetup 解耦，§5.85，perf 零差）。下一张 **CC-79（低）：CC-60 横幅多声明者文案**——`grep -rn axisPresetChapterOwner src` 找横幅渲染处（census §5.6x CC-60 段写过「多个声明者时横幅『有琉』不准确」），改成列出实际声明者名（经 agentMechanicView 门面取模块 name），补组件或门面单测。其后队列里没有架构类待办：下一轮先做一次全仓复查（`grep -rnE "agentId ?===? ?'[0-9]{4}'" src --include=*.ts --include=*.vue | grep -v __tests__`、棘轮读数），有新发现就开卡，没有就在本行写「架构线收口」。
- **CC-79** done `03ba536`（横幅文案，§5.86）+ 全仓复查完成（§5.86 有分类表）。下一张 **CC-80：帷幕来源 → 模块能力**：
  - `src/mechanics/types.ts` 加 `teamVeilCount?(input: { exCount: number; ultimateCount: number; combatTime: number }): number`（入参已是 floor 过的整数，照原实现 `Math.max(0, Math.floor(...))` 在调用方做）。
  - 声明：aire(1501) / yeshuguang(1431) 返回 ultimateCount；1491 模块（grep `agentIds: \['1491'\]` 找文件）返回 exCount；zhao(1341) 返回 `computeZhaoVeilCount(ex, ult, combatTime)`。
  - `teamVeil.ts#computeTeamVeilCountTotal` 改为 `getAgentMechanic(mate.agentId)?.teamVeilCount?.(…) ?? 0` 求和；**先查循环依赖**：teamVeil.ts 在 mechanics 目录里，从 `@/mechanics` index 值导入可能成环（index 若 import teamVeil）——成环就让 convergence 传入 resolver，或把派发挪进 convergence（编排层可按值导入 @/mechanics）。
  - 测试：catalog 全角色 × ex/ult 若干组对照原集合实现（逐字复刻进测试）；源码锁 teamVeil.ts 无四位 id；反向变异删一个声明。跑 perf 零差（帷幕进喧响/伤害）。写 census §5.87。
  - 其后 CC-81（低，见 §5.86）。
- **CC-80** done `8b8564d`（帷幕来源改为模块能力 teamVeilCount，§5.87）。下一张 **CC-81（低）：substatOptimizer 副词条模板移出 core**：
  - `src/core/substatOptimizer.ts` 的 AGENT_TEMPLATES（约 :183-260）按 id 存了 8 个角色（1401/1581/1261/1561/1171/1451/1621/1221）的模板；`getTemplate`（约 :261）先按 id 查表，查不到再按职业兜底。
  - 方案 A：在 types.ts 加 `substatTemplate?`，由各模块声明，getTemplate 改为查 `getAgentMechanic(agent.id)?.substatTemplate`。**先查** core 能不能按值 import `@/mechanics`（§5.70 记录过 core/resource/helpers.ts 有先例），还要跑 check-guards。
  - 方案 B（A 不行时用）：把表搬到 `src/data/substatTemplates.ts`，core 从 data 导入。
  - 1621、1221 可能没有模块，用 grep `agentIds: \['1621'\]` 核实；没有模块的只能走 B。
  - 测试：8 个角色加若干非表内角色，比对 getTemplate 前后深相等；加源码锁；做反向变异。不涉及伤害管线，但仍要跑一次 perf 零差，确认副词条优化不影响 dump。写 census §5.88。
- **CC-81** done `f338b47`（副词条模板改为模块声明 substatTemplate，§5.88）。§5.86 复查发现的两处都已完成。
  - **下一步（lead 自选，写到可以直接开工）：CC-82 复查剩余的角色 id 字面量。**
    - 命令：`node scripts/report-agent-identity.mjs --md`，再加 §5.86 那条 grep（去掉测试、`src/mechanics/agents/`、`src/specs/` 和纯注释行）。
    - 把结果对照 §5.86 的分类表：已裁定不动的（数据表、ADDITIONAL_GATE_BUFFS、UI 默认值、抽卡规划）直接跳过；**出现新的计算路径集合**就照 CC-80 的套路开卡（模块能力 + 与逐字复刻的旧实现对照 + 源码锁 + 反向变异 + perf 零差）。
    - 若没有新增，就在 census 写 §5.89「复查无新增」，并把队列转到暂缓的 CC-11b，或 check-guards 棘轮 burn-down 里到期的项（`npm run zc -- status` 会点名）。
  - 已知坑：`zc done` / `release` 要带 `ZC_LANE=<本会话 lane>`（scripts/zc.mjs:629 依次取 --lane、ZC_LANE、DSH_SESSION_ID，都没有就记成 `pid-xxxx`，第 99 轮发生过）；`git commit` 要带 `-- <路径>`（AGENTS 规则 13）。
- **CC-82** done `75fced2`（复查无新增；音擎 14001 判定改为数据表，§5.89）。下一张 **CC-83：拆 `src/mechanics/types.ts`**（`npm run -s zc -- status` 结构熵点名：1928 行，超 1500 线的 4 个文件之首）：
  - 现状：:40-618 是各种 Agent*Input；:619-1319 是 `AgentMechanicModule` 接口本体（约 700 行，**不拆**，能力清单要留在一处）；:1320-1928 是卫星类型，包括 CrossAgentSupply*、AgentStunOverride*、AgentAxisOverlay*/AxisScalarOverlays、DirectRow*、ExtraDirectRows/ExtraAnomalyRow*（含值导出 `EXTRA_ANOMALY_ROW_ORDER`）、AgentAnomalyTransform/NextRoundFeedback/InteractionTopUp/ExtraNecessaryAction/AnomalyEventRecords/AxisEditorBlockMark/CharacterCountInputDecl。
  - 做法：把 :1320 之后的卫星类型按主题移到同级新文件 `src/mechanics/typesRows.ts`（直伤/异常行相关）和 `src/mechanics/typesAxis.ts`（轴、失衡覆盖、跨槽供给等其余部分）。types.ts 用 `export type { … } from './typesRows'` 转出，`EXTRA_ANOMALY_ROW_ORDER` 用普通 `export { } from`，这样 28 个 `from '@/mechanics/types'` 的导入方都不用改。**不能建 `src/mechanics/types/` 目录**，会和 types.ts 抢解析。
  - **先查锁**：`grep -rln 'mechanics/types.ts' src scripts` 目前命中 finalizePasses.ts、banyue.ts、starlightBilly.ts、panelPhases.ts、roundThreads.ts、scripts/check-guards.mjs。逐个看是注释引用还是源码锁（readFileSync）；源码锁要改成同时读新文件。check-guards 里若有「能力必须声明在 types.ts」这类判据，保持它读 types.ts（本体不动）。
  - 新文件需要的 import 从 types.ts 顶部按需复制，只用 `import type`。卫星类型若反过来引用 types.ts 里的类型，也用 `import type` 回引，类型环不影响运行时。
  - 验收：vue-tsc 0、verify 全绿、check-guards 0，types.ts 行数 < 1400。纯类型改动不需要 perf 零差（`EXTRA_ANOMALY_ROW_ORDER` 值原样搬，不改）。写 census §5.90。回退：revert。
- **CC-84**（触发式，低）：新增第二件周期直伤音擎时再做，把 `cannonRotorDamageMultiplier/CooldownSeconds`（types/resource/config.ts:209）和 rowBuild.ts#buildAnomalyEventExecutions 的加农转子事件泛化为 `periodicDirectEvents` 数组（带 eventId/eventName/倍率/CD），并给数据表加 eventId/eventName 字段；集成测试 specialMechanics.test.ts 按行名匹配「加农」，要一起改。没到触发条件不要做。
- **CC-83** done `037a66f`（types.ts 拆分，§5.90；卫星类型文件叫 typesHooks.ts，不是 typesAxis.ts）。下一张 **CC-85：拆 `scripts/check-guards.mjs`**（1634 行，结构熵点名的第二大文件）：
  - 先读文件结构：`grep -nE '^(const|function|export|// ====)' scripts/check-guards.mjs`。大头是棘轮常量和注释里的沿革长文，比如 :200、:340 那种单行几千字的 frozen 注释。
  - 方案：把**数据**（各 BASELINE 常量、RATCHET_BURNDOWN 表、豁免表，包括 :792/:810/:836 这类到期表）移到 `scripts/lib/guard-baselines.mjs` 并 export，check-guards.mjs 改为 import，判据逻辑不动。沿革长注释原样跟着数据走，**不要删**，AGENTS 规则 17 要求保留口径沿革。
  - **先查锁**：`src/scripts/__tests__/checkGuards.test.ts` 会 import 或读 check-guards；`grep -rn 'check-guards' src scripts docs/AGENT_ID_BURNDOWN_LOG.md AGENTS.md | grep -v '^docs/mcp-'` 查有没有按文件名改常量的操作说明（例如「棘轮下调要改 check-guards 的 AGENT_BRANCH_BASELINE」）。有的话，文档要同步改成新路径。
  - 验收：`node scripts/check-guards.mjs` 输出与改前逐字相同（改前先存 `/tmp/g0.txt`，改后 diff 为空），verify 全绿，check-guards.mjs < 1000 行。写 census §5.91。
  - 其后结构熵剩下 TeamComparePage.vue（1553）和 teamTimeline.ts（1516），优先级低。
- **CC-85** done `a96ae36`（check-guards 数据表拆到 scripts/lib/guard-registries.mjs，§5.91；**以后登记债务、豁免或改 burn-down，改这个文件**）。结构熵只剩 TeamComparePage.vue 1553 行和 teamTimeline.ts 1516 行，都只比 1500 线多一点。下一张 **CC-86（低）：拆 `src/composables/teamTimeline.ts`**：
  - 先读结构：`grep -nE '^export (function|const|interface|type)|^function ' src/composables/teamTimeline.ts`，找一段自成一体的纯函数（没有 store 依赖的计算辅助），移到 `src/composables/teamTimeline/` 目录，或同级文件如 `teamTimelineMath.ts`。原文件转出，导入方不用改。
  - 先查锁：`grep -rn 'teamTimeline' src scripts | grep -i 'readFileSync\|teamTimeline.ts'`。
  - 验收：vue-tsc 0、verify 全绿、原文件 < 1400 行；只搬纯函数就不需要 perf 零差（teamTimeline 不在伤害管线里，改前先 grep 确认它不被 useResourceCalc 或 convergence 导入）。写 census §5.92。
  - TeamComparePage.vue 暂不拆（页面组件，拆了收益低），留作观察项；它再长就把一个子区块抽成组件。
  - 做完结构熵这两张后，回到功能与口径类待办：`npm run -s zc -- status` 的「待办 命座 109 条 / 机制 45 条」，以及手写事实 drift 待复核 80 条（`npm run -s zc -- drift`）。后者是低成本的保质量活，适合派给子代理逐条复核：读锚点代码，确认口径没变，就在「据」后面追加 `·复核@日期`。
- **CC-86** done `4b685c7`（teamTimeline 拆三个文件，§5.92）。结构熵只剩 TeamComparePage.vue，不拆。下一张 **CC-87：手写事实 drift 复核**（`npm run -s zc -- status` 显示「⟳ 待复核 80」）：
  - 取清单：`npm run -s zc -- drift 2>&1 | grep '⟳' > /tmp/drift.txt`。每行格式是「⟳ <subject> 据 <日期>，锚 <文件#符号> 于 <日期> 动过（<@fact 所在文件:行>）」。
  - 逐条做：打开「@fact 所在文件:行」读事实原文，再读锚点符号的**当前**代码，判断事实说的口径是否还成立。
    - **成立**：在该行 `| 据 …` 段末尾追加 `·复核@<今天>`（范例见 check-guards.mjs 的 `engine:guards/自指豁免`，CC-85 打过），不要改别的字。
    - **不成立**：按代码现状改写事实正文，并把「据」改成 `实测@<今天>`；同时检查「验」指向的测试是否还覆盖它。拿不准就**不打戳**，在 census 里记一行「未复核：原因」，留给 lead。
  - 按锚点文件分批，每批不超过 15 条。多数集中在 panelPhases.ts、ultimatePromote.ts、teamCompare.ts 等最近被重构碰过的文件，大部分是纯搬运，只是被动触发了 drift。
  - 适合派子代理：`/home/kaua/.local/node/bin/dsh --profile headless '<带上面规则和一批 15 条清单的任务>'`。派活前先自检，应输出 pong；**同一时间只派一批**，lead 不要同时编辑这些文件。
  - 每批验收：`node scripts/check-guards.mjs` 为 0（判据 6 会校验锚点和「据」的格式），`npx vitest run src/scripts/__tests__/checkGuards.test.ts src/scripts/__tests__/zc.test.ts` 通过，zc status 的待复核数下降。提交只带改过的文件路径。
  - 全部做完写 census §5.93，记下总数、改写了几条、未复核几条及原因。
- **CC-87a** done `023bab6`（§5.93）：机械筛查后，62 条锚点符号没变的事实打了 `·锚未变@2026-09-27`；zc 不再把只改 `@fact` 行的改动当成锚改动。待复核 80→18。下一张 **CC-87b：剩下 18 条人工复核**：
  - 清单见 census §5.93 末尾，也可以现取：`npm run -s zc -- drift 2>&1 | grep '⟳'`。
  - 每条做法：先 `grep -n '<subject>' <事实所在文件>` 找到事实行；再看锚点代码从「据」日期到现在的改动，命令是 `git diff $(git rev-list -1 --before="<据日期> 23:59:59" HEAD) HEAD -- <锚文件>`，然后读锚点的**当前**代码。
    - 口径成立：在 `| 据 …` 段末尾（第一个 `|` 前）追加 `·复核@<今天>`，别的字不动。**注意有些条目竖线前没空格**（`·复核@2026-09-25| 验`），不要把戳打进「验」或「锚」段。
    - 口径不成立：按代码现状改写事实正文，「据」改成 `实测@<今天>`，同时检查「验」指向的测试是否还覆盖它。
    - 拿不准：不打戳，在 census §5.93 下面补一行「未复核：原因」。
  - 特殊的几条：ultimatePromote.ts 的 2 条，锚文件在「据」日期那天还不存在（是后来拆出来的），要用 `git log --follow` 或到拆出前的原文件里对照；helpers.ts#iterate 的 2 条要读被包装的 iterateBody，不是 iterate；teamVeil 那条的「据」是 2026-09-02，跨度最大，要仔细看。
  - 可以分两批派 dsh（按锚文件分：resourceCalc/* 共 9 条一批，core/*、mechanics/*、stores/*、docs 共 9 条一批），每批验收：`node scripts/check-guards.mjs` 为 0，`npx vitest run src/scripts/__tests__/checkGuards.test.ts src/scripts/__tests__/zc.test.ts` 通过，待复核数下降。
  - 做完之后回到功能类待办：命座 109 条、机制 45 条（`npm run -s zc -- status`）。
- **CC-87b** done `7481adf`（§5.94）：drift 待复核清零。以后复核的流程有一条补充：**要看从原始口径日期到现在的全部改动**（`git log <原始据日期>..HEAD -- <锚文件>`），不要只看上次 `·复核@` 之后的——资源账本那条就是 09-25 的复核漏掉了 09-19 的口径变更。
- **下一张 CC-88：状态表「部分实现」机制核实**（lead 自己挑的，依据如下）。
  - 为什么选它：`zc status` 里的「命座 109 / 机制 45 待办条目」并**不是**工作队列。它们是 `public/static/character-constellations.json`、`character-mechanics.json` 里各条目的 `pending` 数组，内容几乎全是「已实现但用了近似」的说明（例如「不做 50s 时间轴模拟」），多数是有意为之，不需要做。真正可能在误导人的，是状态标成 `partially_implemented` 的条目：比如 1401 爱丽丝「剑心双虹」写着「极性强击与物理异常持续伤害追加未建模」，而 CC-19b 早已把爱丽丝极性强击迁成模块能力 `extraAnomalyRows`（alice.ts 里有极性强击的回复剑意逻辑）——状态表很可能已经过时。
  - 范围：`character-mechanics.json` 里 7 条 `partially_implemented`：1271 core_passive_1271（守望者护盾，防御向，大概率维持现状）、1401 sword_heart_dual_rainbow、1401 seek_odd_hunt_ghost（pending 为空）、1561 broad_cyclone、colored_buildup（pending 为空）、floria_sleeves、tea_party_etiquette（pending 为空）。命座的 2 条 1111 partially_implemented（爆发状态未建模，用户已裁决暂不做）和 1551 影画6、1101 潜能觉醒两条 not_described（官方未揭示）都**不要动**。
  - 列出清单：`node -e "const c=require('./public/static/character-mechanics.json');for(const[id,ch]of Object.entries(c.characters))for(const it of ch.mechanics||[])if(it.status==='partially_implemented')console.log(id,it.id,JSON.stringify(it))"`
  - 每条做法：读条目的完整 JSON（说明、pending），到 `src/mechanics/agents/<角色>.ts` 和相关测试里找对应实现（grep 机制关键词和 moveId），逐句判断 pending 里说的「未建模」现在是否仍然成立。
    - 已全部实现：status 改为 `implemented`，pending 里删掉已不成立的句子。如果还有保留的近似，改成 `implemented_approximation`，只留仍然成立的近似说明。
    - 仍是部分实现：pending 为空的要补一句具体缺什么，不许留空。
    - 拿不准：维持原状，在 census 新开一节记原因。
  - 改完跑 `npm run docs:status` 重新生成 `docs/implementation-status.md`（这个文件头写着自动生成，不要手改），再跑 `node scripts/check-guards.mjs`（判据含 catalog-raw 对账、名词表三态）和 `npx vitest run src/mechanics`。先 grep 有哪些测试读这两个 JSON 的 status 字段（`grep -rln "character-mechanics" src scripts`），一并跑。
  - 适合一次派一个 dsh 做（7 条、一个 JSON 文件）。lead 验收时要逐条核对它给出的「代码证据」。
- **CC-88** done `11706a1`（§5.95）：机制维度「部分实现」清零，7 条里有 5 条的 pending 早已不成立。
- **下一张 CC-89：机制维度剩余 42 条 pending 说明核实**（lead 选的，依据：CC-88 的过时率是 5/7，状态表的 pending 普遍比代码落后；运行档案页的建模缺口列表直接展示这些 pending，过时就是在给用户看错的缺口）。
  - 列清单：`node -e "const c=require('./public/static/character-mechanics.json');for(const[id,ch]of Object.entries(c.characters))for(const k of ['mechanics','specialResources'])for(const m of ch[k]||[])if((m.pending||[]).length)console.log(id,k,m.id,m.status,JSON.stringify(m.pending))"`
  - 分布（共 42 条）：1041:3 1051:2 1061:2 1081:2 1091:1 1101:1 1111:1 ｜ 1201:3 1211:3 1221:2 1261:1 1271:2 1281:2 1321:2 ｜ 1381:2 1471:1 1501:1 1531:2 1561:1 1581:5 1591:2 1631:1。
  - **排除**：1101 珂蕾妲（占位数据，用户说还在改）、1111 安东（爆发状态没建模，用户已裁决暂不做）、1271 守望者和 1561 风华盈袖（CC-88 刚判为有意近似）。
  - 分三批派 dsh，每批不超过 15 条，**同一时间只派一批**：A = 1041–1091，B = 1201–1321，C = 1381–1631。任务书要写明：只允许改 `public/static/character-mechanics.json`，而且要用 node 脚本改（照抄 `/home/kaua/calc-arch/cc88.mjs` 的往返断言写法，**不要手编这个单行 JSON**）；每条给出「仍成立 / 已不成立（附代码文件:行号证据）/ 拿不准」；报告写到 /tmp/cc89-<批>.md。
  - 判定规则：
    - pending 说的「未建模」已被代码实现：原文和证据移进 `implemented` 数组，清空 pending/pendingParts；status 视剩下的近似情况改为 implemented 或 implemented_approximation，`implementation` 字段同步改。
    - 仍成立：不动。
    - 是有意的近似或防御向说明：保留 pending，status 用 implemented_approximation。
  - lead 验收：抽查每批至少 3 条的代码证据；`npm run docs:status` 重新生成；validate-data、check-guards、`npx vitest run src/utils/__tests__/modelingGaps.test.ts` 都要通过；最后跑一次 verify。
  - 做完之后才轮到命座维度的 109 条（同一方法，量更大，多数是有意近似，优先级更低）。
- **CC-89** done `d6ef3af`（§5.96）：38 条里 8 条过时并已更正。**以后改角色机制实现的提交，顺手 grep 一下 `public/static/character-mechanics.json` 和 `character-constellations.json` 里该角色的 pending，过时就同步改**（这次过时的根因就是实现提交没回写状态表）。
- **下一张 CC-90：命座维度 109 条 pending 核实**（`public/static/character-constellations.json`，`characters.<id>.cinemas[]`，每条带 cinema 档位、status、pending）。
  - 流程照搬 CC-89（§5.96）：
    1. 复制 `/home/kaua/calc-arch/t89.txt` 为 t90.txt，把 JSON 文件名、`mechanics/specialResources` 改成 `cinemas`，报告里的条目标识改成 `<id> 影画<cinema>`。
    2. 列出含 pending 的角色：`node -e "const c=require('./public/static/character-constellations.json');const o={};for(const[id,ch]of Object.entries(c.characters))for(const m of ch.cinemas||[])if((m.pending||[]).length)o[id]=(o[id]||0)+m.pending.length;console.log(JSON.stringify(o))"`，按条数切成每批不超过 15 条，约 8 批。
    3. 并行派 dsh（只读），**同时跑的不要超过 4 个**（WSL 负载），报告写 `/tmp/cc90-<批>.md`。
    4. lead 每批抽查至少 2 条 STALE 的证据，再写一个 cc90.mjs 统一写入（照抄 cc89.mjs 的往返断言、`rewrite()` 写法，status 与 implementation 同步改——命座条目如果没有 implementation 字段就只改 status）。
  - 排除：1111 安东影画1/6（爆发状态没建模，用户已裁决暂不做）、1551 影画6（官方未揭示）。
  - 命座里「防御/生存向不建模」按 W27 惯例属 APPROX，保留。
  - 验收：`npm run docs:status`；validate-data、check-guards、`npx vitest run src/utils/__tests__/modelingGaps.test.ts` 都要通过（命座下限目前是 104，清掉 pending 就同步下调并在注释里写明是哪几条）；最后跑 verify。
  - 做完 CC-90 以后，状态表线就收尾了。之后的方向写在 arch 文档，没有新卡时，先跑 `npm run -s zc -- status` 看有没有新的漂移、债务或需求。
- **CC-90** done `e1ef565`（§5.97）：命座 109 条里 11 条过时并已更正，状态表线到此收尾。**pending 里不许写「已建模/已接入」，这类内容应写进 implemented。**
- **下一张 CC-91：薇薇安死通道 + dead-channels 盲区**（R 需求优先；没有 R 时先做这张）。
  - 事实：`src/mechanics/agents/vivian.ts` 中 `danceHitCount: Number(record.vivianDanceHit ?? 0)` 与 `assistCount: Number(record.vivianAssistCount ?? 0)` 全仓零写入（`grep -rn 'vivianDanceHit\|vivianAssistCount' src scripts public` 只有这两行），所以飞羽里「舞步命中 / 极限闪避 +1」和「支援突击」两个来源恒为 0。`zc dead-channels` 只扫类型里声明过的字段，这两个是从无类型记录按字符串键读取的，扫不到。
  - 步骤：
    1. 先读 `src/specs/agents/1331.json` 原文，确认飞羽的各个来源。
    2. 支援突击次数：检查 state 或 cfg 里有没有现成的 parry/assist 计数（参考 zhendou.ts 的 `parryCount` 来源），有就直接接上并补测试；没有就删掉这个读取，把这一来源写进 1331 机制 pending。
    3. 舞步命中：按原文判断能否从动作序列派生，不能就删掉读取，并如实登记 pending（影画6 那条已改为「未建模…见 CC-91」，处置后同步改写）。
    4. 在 `scripts/zc-dead-channels.mjs` 或 check-guards 中补一个检测：`src/mechanics/agents/*.ts` 里 `record.<camelKey> ??` 这类读取的键，如果全仓（src、scripts、public/static）没有任何写入或声明，就报出来。先用这两个已知键自证能检出，再看有没有其他命中；已有存量进基线（guard-registries.mjs）。
  - 验收：vitest、vue-tsc -b、check-guards、verify 全部通过；状态表 1331 同步更新。
  - 回退：分两次提交（先修 vivian，再改守卫），出问题各自 revert。
- **CC-91** done `61fce8b` `5476250`（§5.98）：支援突击飞羽已接通；舞步命中确认无法派生，登记为未建模；新增判据 25。**以后新增 `record.<key>` 读取时，必须同时有写入方（buildCharConfig 或编排层注入），否则 check-guards 会红。**
- **下一张 CC-92：`src/views/TeamComparePage.vue` 拆分**（`zc status` 结构熵唯一超标：1553 行，线是 1500）。
  - 先读 `git show 00873b3 --stat` 和提交说明，那是 R44 的纯搬运先例（逐字节保真）。
  - 再读 `scripts/lib/guard-registries.mjs:404` 的登记项「TeamComparePage.vue sweepPage:第三人候选圈定」，确认它在判据里引用的是哪个锚点；搬运后锚点路径要同步改，否则对应判据会红。
  - 拆法：把一段自成一体的 `<script setup>` 逻辑（例如 sweep 或第三人候选相关的 computed/函数）抽成 `src/views/teamCompare/` 下的 composable，模板不动。目标 ≤1450 行，留出余量。
  - 验收：vue-tsc -b、check-guards（含 scoped 样式可达性判据）、verify；`npm run -s zc -- status` 不再报超标。
  - 回退：单个提交，`git revert`。
- **CC-92** done `50e313e`（§5.99）：TeamComparePage.vue 降到 1462 行（余量 38 行），**之后给该页加功能，写到 `src/composables/teamCompare*.ts`**。结构熵超标已清零。
- **下一张 CC-93：债务「`src/specs/types.ts`:声明了 team/enemy/both 定向」裁决与销号**（登记在 `scripts/lib/guard-registries.mjs` DEBT_REGISTRY，since 2026-09-25，写的是「裁决走向后销号」）。
  - **已拍板**（lead 2026-09-27 第 111 轮）：**保留字段，不做运行时分流，改为加校验消费者**。依据：
    1. 全库 38 条 teamBuffs 中 team 29 条、enemy 9 条、both 0 条。
    2. enemy 的 9 条用的都是敌方侧字段（`enemyXxxResReduction` / `enemyDefReduction`），或「等效全队拐力」字段（如薇薇安的预言下异常伤害 +16% 记为 `anomalyDamageBonus`）。这类 debuff 本来就对所有攻击者等效生效，运行时分流后结果不变，白增复杂度。
    3. team 的 29 条没有一条用 `enemy*` 字段。说明这个字段的分类是准确的，是有价值的元数据；删掉会丢失「这是敌方 debuff」这层可读信息。
    4. 缺的只是一个消费者，所以给它加校验规则，把死通道变成受校验的元数据，这和规则 16 的精神一致。
  - 步骤：
    1. 先读 `src/core/inCombatBuffs.ts#collectInCombatTeamBuffs`，确认 team 与 enemy 条目的收集方式确实相同（owner 是否计入由 `includeOwner` 决定，与 target 无关）。**如果发现 enemy 条目被错误地排除了 owner，或有别的差异，就停下，改为立卡修引擎。**
    2. 在 validate:specs（`npm run validate:specs` 对应的脚本，先 `grep -n validate:specs package.json`）里加规则：任何 effect 的 stat 以 `enemy` 开头 ⇒ 所在 buff 的 target 必须是 `enemy` 或 `both`。再加反空洞：全库至少有 1 条 enemy 条目被检查到。用一个临时改坏的 spec 验证规则能红，验完还原。
    3. 改 `src/specs/types.ts` 中 `target` 上方的 debt 注释：写明它现在是「受 validate:specs 校验的元数据：运行时不分流，因为敌方 debuff 对全体攻击者等效」。
    4. 从 DEBT_REGISTRY 删掉这一条。check-guards 里有 debt 注册表判据，**先 grep 这张表是否有计数或基线常量需要同步下调**。
  - 验收：validate:specs、check-guards、verify 全部通过。
  - 回退：单个提交，直接 revert。
- **CC-93** done `2299223`（§5.100）：target 字段现在由 validate:specs 校验，债务已销号。**流程约定（新增）：文档提交之后至少再跑一次 `node scripts/check-guards.mjs`**，因为 docs 里以 `@fact ` 开头的散文会被解析成 fact 声明（上一轮因此遗留一次红灯）。
- **下一张 CC-94：清理 `zc dead-channels` 的 LS 基线存量（12 条）**。
  - 先跑 `ZC_LANE=lead-arena-0925c npm run -s zc -- dead-channels` 拿到清单。基线常量是 `DEAD_CHANNEL_LS_BASELINE`，位于 `scripts/lib/dead-channel-ls.mjs`。判据 14 另有 `DEAD_CHANNEL_ALLOWLIST`（在 `scripts/lib/dead-channel-scan.mjs`），可能也登记了同一批字段，要一并检查。
  - **dead-both**（零读零写，例如 `CharacterOperationConfig` 里的 `claretMaimBurialMoveId` / `claretMaimBurialDamageMultiplier` / `claretSharpnessCost` / `roxyWindCannonMoveId` / `roxyWindEyeMoveId`，`catalog.ts` 里的 `agentSkillId` / `skillLevelBonuses`）：
    - 逐条 `git grep -nw <字段>`，确认只命中声明行，以及基线和豁免表里的登记；
    - 再看 `git log -S<字段> --oneline | tail -3`，弄清当初为什么加这个字段。
    - 确认无用就删掉声明，同时删掉两张基线/豁免表里的条目。
    - **`catalog.ts` 的字段如果对应 `public/static/catalog.json` 里真实存在的数据键，就不要删**（类型声明是在描述数据形状）。这种情况改为登记「数据形状字段」豁免，并写明理由。
  - **dead-input**（例如 `pullPlannerEngine.ts` 的 `freePoolPerSpecialty`：读取时走 `?? 默认`，全仓调用方都不传）：
    - 如果默认值就是现行口径，就删掉这个选项，把默认值内联；
    - 如果是有意保留的扩展点，就留着，把基线里的理由改写清楚。
    - 逐条写下裁决。
  - 验收：`zc dead-channels` 报「新增 0 · 待核销 0」且基线条数下降；vue-tsc -b、check-guards、verify 全部通过。
  - 回退：按字段族分几次提交（claret 族、roxy 族、catalog、dead-input），出问题各自 revert。
- **CC-94** done `0a7e2a8`（§5.101）：LS 死通道基线只剩 `freePoolPerSpecialty` 1 条（有意保留的调参旋钮）。
- **下一张 CC-95：判据 14 豁免表 `DEAD_CHANNEL_ALLOWLIST` 的 8 条存量复核**（`scripts/lib/dead-channel-scan.mjs:38` 起；check-guards 行显示「A 零读零写 2 / B 只读不写 6」）。
  - 清单：
    - A：`runArchiveImport.ts weaknesses`、`runArchiveImport.ts hpTotal`；
    - B：`difficultyLadder.ts minGain`、`pullPlannerEngine.ts freePoolPerSpecialty`（CC-94 已裁决保留，跳过）、`timeWeightBalancer.ts minWeight`、`runArchiveImport.ts resistances`、`core/damage.ts isRupture`、`core/effectiveTime.ts blockSeconds`。
  - 注意 `minGain`：豁免表注释写着「修好 scanReadOnlyOptionalProps（补简写识别）后自然不再命中」，但条目仍在表里、判据也仍然计入。先确认它现在是否还会被扫出来：临时注释掉这条豁免，跑 `node scripts/check-guards.mjs`，看是否报红。若不报红，说明是过期豁免，直接删；RATCHET_BURNDOWN 里「死通道豁免清单」的 frozen 值可能要同步下调（下调要在 AGENT_ID_BURNDOWN_LOG.md 记一笔）。
  - 每条的处理方法：
    - `git grep -nw <字段>` 看读写点；
    - A 类（零读零写）通常直接删字段。`runArchiveImport.ts` 是导入外部跑档数据的，**先确认字段是否对应外部 JSON 的键**（`data/raw/zzz-run-archive/runs.json`）；如果是描述外部数据形状，就保留，把豁免理由改写清楚。
    - B 类（只读不写）按 CC-94 的口径：默认值就是现行口径的，删掉选项并内联；是调参入口的，保留并写清理由。`core/damage.ts isRupture` 属于伤害核心，改动前先跑 timeGolden，确认数值零变化。
  - 验收：check-guards 显示的 A/B 计数下降，且 frozen 值与计数一致；vue-tsc -b、verify 全部通过。
- **CC-95** done `cb169a3`（§5.102）：判据 14 死通道只剩 freePoolPerSpecialty 1 条。LS 基线与判据 14 两套死通道存量现在都只剩这 1 条，它是有意保留的调参旋钮。
  - 已知坑：扫描器会跳过「行首栈顶是 `(` 且行以 `,` 或 `)` 收尾」的声明，视为函数形参。以后如果出现「括号内多行对象类型、属性行以 `,` 收尾」的写法，会被漏扫。这是有意接受的取舍，测试钉住了不以逗号收尾的形态。
- **下一张 CC-96：`docs/ENGINE_PIPELINE_GUIDE.md` §38「静默不算」清单复算对账**（第 772 行附近，⟳ 触发器 2026-10-15 到期，是 `zc drift` 里最早到期的一条）。
  - 做法：
    - 逐条执行该节给出的复算命令，拿新数字和节里的快照数字对比；
    - 已清完的条目标「已销号 + 日期 + 依据」；
    - 数字变了就更新快照并注明日期；
    - 发现新的静默缺口就补条，同样附复算命令。
  - 完成后把触发器的到期日顺延（例如 2026-12-31），并写清下次到点要判断什么。
  - 注意：
    - 这是纯文档加只读命令的活，不改 src。
    - 如果某条复算命令本身已失效（路径搬家等），先修命令再对账，把「命令已修」写进条目。
    - 可以用 dsh 只读并行跑命令，但写文档由 lead 独自完成。
    - 文档提交后必须重跑 check-guards（手册密度棘轮、@fact 解析都会扫 docs）。
- **第 115 轮（2026-09-27）**：CC-96 done `4191bd0`（§5.103）；用户新增 R2、R3，**均已完成**。R2 `d91bcf8` 见流程文档；R3 见 `docs/LONG-TERM-DIRECTIONS.md`，只提案。
  - **收尾流程已改**，见本文 §0.R2：tsc 已开增量；零差用 `.zc/perf/zd.sh`（并行，约 50 秒）；verify 只跑一次，等待期间起草文档，EXIT 后再落盘；文档提交后必须重跑 check-guards。
  - **下一步优先级**：
    1. 先读 `docs/REQUIREMENTS.md`。如果用户已经针对 R3 挑了方向或回答了裁决点，按他的选择立卡。
    2. ~~否则派或做 CC-14a~~ ——**更正（第 116 轮）：CC-14a 早已完成 `285885b`（第 18 轮），上一轮照着过时条目误写了**。
    3. 再否则做 **CC-97**：方向 B 的「测量清单 v1」，纯文档，写进 `docs/mcp-calibration-atoms.md`（新文件，要在 README §6 登记）。
       - 每个原子写：测什么、训练场怎么测（配装快照、敌人、动作）、预期区间与引擎当前输出（用一次性 vitest 探针读取）、对应的 @fact 或 ⟳ 行号。
       - 驱动盘 `basis`（雷暴重金属 28% 攻击力，按局外攻击力还是基础攻击力）排第一。
  - 已知坑：
    - 手册 §4 行数棘轮 frozen 718，`ENGINE_PIPELINE_GUIDE.md` §4 净增 1 行就会打红 `checkGuards.test`。取证写 census，手册只写口径。
    - 在 bg.sh 的命令里写 `exit` 会导致日志缺少 EXIT 行。
- **第 116 轮（2026-09-27）**：CC-97 done（`docs/mcp-calibration-atoms.md`，提交号见 arch 卡表），内容是 13 个校准原子，A1 = 局内攻击力%基底。**更正了队列里 3 处把 CC-14a 写成「可派」的过时条目**（它早在 `285885b` 就完成了）。
  - **下一步优先级**：
    1. 先读 `docs/REQUIREMENTS.md`。如果用户对 R3 挑了方向、裁决了 B 或 A 的问题、或者交回了测量数据，按他的选择走。交回测量数据时，按测量清单 §2 录入。
    2. 否则做 **CC-98：方向 C 第 1 刀，机制模块盘点（只读）**。产出 `docs/mcp-mechanic-dataization-census.md`（新文件，要在 README §6 登记）：
       - 对 `src/mechanics/agents/*.ts` 的 62 个模块，逐个列出实现了 `AgentMechanicModule` 的哪些能力（读 `src/mechanics/types.ts` 的能力清单）、行数，以及是否有对应的 spec JSON；
       - 按「可纯数据化 / 部分 / 不可」三档归类，并写依据：只用条件 buff、叠层、固定倍率的算「可」；有跨轮反馈、自定义执行行、时序的算「不可」；
       - 汇总覆盖率，挑出 5 个最适合迁成纯 spec 的候选（方向 C 第 2 刀用）。
       - 适合派 dsh 只读并行（例如每人 15 个模块），lead 抽查。**不改 src**。
  - 维护约定：以后的交接段落插在这一条之上。**写「下一步」之前，先在 arch 卡表里 grep 核实那张卡的状态**，上轮就是没核实才写错的。
- **第 120 轮交接（2026-09-27，接在第 119 轮之后；以本条为准）**：
  - **⚠ 改序**：用户随后在 `2259a17` 新增了 R8，lead 已答复（`docs/mcp-working-model.md`）。下面写的「R5 第 2 刀」**顺延到 W1–W4 和 R6 第 1 步之后**，步骤本身仍然有效。
  - **做到哪**：
    - `ee5e751`：R4 撤销落盘。
    - `8a0159c`：R7 原子删除 timeline 死代码，判据 26 删除，check-guards 26→25，verify 339 files / 3714 tests。
    - 本轮文档提交（提交号见 arch 卡表 R5 行）：R5 第 1 刀粗筛。新文档 `docs/mcp-r5-spec-impl-reconciliation.md`，README §6 共 59 份。
    - 用户在轮中途连着提交了 `3737419`（R4 撤销 + R5）和 `1ba7b83`（R6 + R7），都已处理。
  - **下一步（R5 第 2 刀，可以直接开工）**：
    1. 复跑 `node .zc/perf/r5scan.mjs > .zc/perf/r5scan.out`（脚本丢了就按账本 §1 重写）。
    2. 先核实 **Z4 `stackGroup`**：
       - 用 `node -e` 列出 catalog 里全部带 stackGroup 的效果（23 条），按组聚合；
       - `timeout 40 git grep -n stackGroup -- src` 确认零读取；
       - 读 `src/core/buff.ts` 和 `src/core/inCombatBuffs.ts` 的叠加逻辑，看同组效果会不会重复计入；
       - 写成 D1 条目，格式见账本 §5。
    3. 再核实 **Z6 `outOfCombatEffectFilter`**、**Z2 `appliesToOutOfCombatPanel`** 和 **K0 `basis`**：
       - 读 statRules.calculation 的规则原文；
       - 找引擎决定「局外面板计入哪些效果」的代码（从 `core/panel.ts`、`utils/discEffectRows.ts` 和 CC-96 的 census §5.103 起步）；
       - 判断三者是不是同一个根因。如果是，合并成一个 D 条目。
    4. 215 种字段按账本 §2 归 S / D / M 类，写进账本（可以作为 §7 附表）。
    5. **只登记不修**。修复在第 4 刀转成 CC 卡。
  - **R5 之后**：R6 前置步骤是通读 ARCHITECTURE / ENGINE_PIPELINE_GUIDE / FEATURES_GUIDE / GAME_TERM_TO_CODE_FIELD / AGENTS.md 和 src 目录结构，写出实际分层全景。注意用户原话：**不要为降计数做无架构收益的改动**。
  - **未决项**：CC-99 排在 R5、R6 之后，届时按 R6 清单重新评估，可能被清单吸收；CC-97 暂缓。
  - **已知坑**：
    - 删文件后，要先 `git add -A <路径>` 再跑 check-guards。判据 25 的扫描器用 `git ls-files` 取清单，已删但未暂存的文件会让它报 ENOENT。
    - 提交前务必 `git log --oneline -3`。本轮用户中途提交了两次。
- **第 119 轮补记（R4 撤销，以本条为准，下面第 119 轮原交接里的「下一步第 2 步」已作废）**：用户在 `3737419`（16:47）撤销了 R4，并新增 R5。本轮的 R4 第 1 步提交 `0c0289c` 落在撤销之后，已按用户的处置表保留为死代码（不接线、不扩展，删不删由用户决定），相关文档都已标为停工或作废。方向 B（CC-97 实测清单）按 R5 口径暂缓。CC-99 的阻塞已解除，但排在 R5 之后。**下一步是 R5**，开工说明见第 120 轮交接（若没有，就按 REQUIREMENTS R5「要做的事」从 `effects[]` 字段做起）。
- **第 119 轮（2026-09-27）**：R4-A1 第 1 步完成，内容是影子内核骨架、失衡轨、喧响轨和判据 26（提交号见 arch 卡表 R4-A1 行；口径见设计稿 §7.5，记录在 census §5.107）。
  - **下一步（第 2 步，直接开工）**：设计稿 §8「第 2 步」下写了 4 条开工要点：先用 harness 跑 T1 `auto-1471-1571-1451`，再写 projection 和 diff，最后做 shadowDiff.test.ts 并测引擎耗时。
  - **已知坑**：
    - projection 算窗口外速率时**不许用引擎的失衡次数或前台时间预算**，否则是循环论证（§7.5）；
    - 新测试只能放在 `src/core/timeline/__tests__/` 或其他测试目录，非测试代码引用影子内核会让判据 26 变红；
    - 代码里不要出现字符串 `simulateDecibelTrack`（喧响上限闸门）；
    - 在 WSL 里新建目录后再用 `up.sh` 上传，它不会自动建目录；
    - `zd.sh` 必须带 tag 参数。
- **第 118 轮（2026-09-27）**：R4-A1 第 0 步完成，产出设计稿 `docs/mcp-timeline-shadow-kernel.md`（提交号见 arch 卡表 R4-A1 行）。只读，src 零改动。
  - **下一步（第 1 步，直接开工）**，按设计稿 §3 建目录：
    1. 新建 `src/core/timeline/types.ts`、`stunTrack.ts`、`decibelTrack.ts`，写纯函数；再写 `__tests__/stunTrack.test.ts` 和 `decibelTrack.test.ts`。用手搓的小输入验证：整数次数、截断、返还、上限溢出记入 wasted、两种释放策略。
    2. 在 `scripts/check-guards.mjs` 加判据 26：非测试 src 不得 import `core/timeline`；`core/timeline` 不得 import composables、stores、mechanics。同步修改 `checkGuards.test.ts` 的 `toHaveLength`，并做检测器自证。
    3. 性能两数：先用小输入测影子耗时，引擎耗时放到第 2 步用 harness 测，都写进设计稿 §8。
    4. 跑全量 verify 和 `vue-tsc -b`。影子零入边，所以 `zd.sh` 和 `timeGolden` 必然零差，但仍要跑一次 zd.sh 作证。
  - **已知坑**：代码和注释里都不要出现字符串 `simulateDecibelTrack`（闸门按字符串匹配）；`inAxisStunTotal` 的语义要在第 1 步核实后写回设计稿 D3。
- **第 117 轮（2026-09-27）**：CC-98 done（`docs/mcp-mechanic-dataization-census.md`，提交号见 arch 卡表）。用户在 `19c3a13` 新增了 **R4（方向 A 影子内核）**，已接单并置顶。
  - **下一步（第 118 轮，直接开工 R4-A1）**，全部只读，产出设计稿 `docs/mcp-timeline-shadow-kernel.md`：
    1. 读 `docs/REQUIREMENTS.md` R4 全文，以及 `docs/LONG-TERM-DIRECTIONS.md` 方向 A（第 22–52 行）。
    2. 摸清现引擎的两条轨：喧响轨读 `src/core/resourceTrack.ts`（种子，约 100 行）和 `src/composables/resourceCalc/` 里的喧响、大招次数；失衡轨读失衡次数的两个来源（R3 称为「失衡次数双源」），用 `timeout 40 git grep -n 'stunCount\|dazeCount' -- src/core src/composables` 定位。另外读 `resourceCalc/roundThreads.ts`（CalcRoundThreads）。
    3. 确定 3 支对账队伍：从轴模式已覆盖的队伍里选，用 `timeout 40 git grep -ln 'axis' -- src/**/__tests__` 找现有轴测试的队伍。
    4. 设计稿写清：事件类型、两条轨的状态机、影子内核的输入（复用现引擎的 executions 还是自己从动作序列出发）、差异表的列、归因三分类（近似 / 现引擎伪影 / 新内核 bug），以及**性能原型的测法**（单队耗时，加 16 角色组合扫描的外推值）。
    5. 第 2 步起才写代码：新建 `src/core/timeline/`，不接 UI，不被 src 既有代码 import（可考虑加一条守卫判据保证这一点），差异报告只在测试或脚本里产出。
  - **硬约束（R4 原文）**：影子阶段零差，不改变任何现有输出；**用新内核替换现引擎、或任何全库数值变动，都必须回来找用户裁决**。
  - **未决项**：R3 的两点用户仍未裁决（B 是否属于「实战归档不作误差判据」的范围；A 是否接受数值变动）。R4 已明确「切换须裁决」，影子阶段不受影响。
  - **已知坑**：CC-99（方向 C 第 2 刀）被方向 A 第 3 刀阻塞，不要提前做 G1 或 G4；只有 G3 可以在空档期做。`.zc/perf/mc98.*` 不进 git。
- **CC-14a ✅ 已完成 `285885b`（以下为历史派单记录，勿再派；CC-14b 至 CC-14e 也都已完成，见 arch 卡表）**。原文：CC-14a 前置门已于 2026-09-26 打开（lead 现场核实）：R1 已合入（提交号见 `docs/REQUIREMENTS.md` R1 行末 `[done <sha>]`；方案与证据见 `docs/mcp-cinema-uplift-multi-metric.md`），`git status --short src/` 干净、无 cinemaUplift WIP。
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
