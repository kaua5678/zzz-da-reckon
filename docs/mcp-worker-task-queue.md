# 交接与执行纪律（活文档，原「低级模型任务队列」）

> **本文件现在只放四样东西**：置顶顺序、§0 执行纪律、§1 长期规则、§2 最近一轮交接和已知坑。
> 逐轮流水账已删除（W3，`docs/mcp-working-model.md` §2.4）。压缩前的全文（第 1–120 轮交接、W1–W31 卡表、2026-09-24 OPEN-ITEMS 分诊记录）
> 用 `git show 8a8db00:docs/mcp-worker-task-queue.md` 查看。每轮只**替换** §2，不追加；历史靠 git。
> **分工**：固定的 lead / worker 分工已废除（`docs/mcp-working-model.md` §1）。每个会话都是完整执行者。子代理（dsh）只外包输入输出能写死的机械活，派活时仍按 §0 的纪律。
> 需要用户裁决的事写进对应专题文档；用户的新需求在 `docs/REQUIREMENTS.md`，**每轮先读**。

> **🔝 置顶（第 121 轮更新）**：
> 1. **R6 第 1 步**：画架构地图，写 `docs/ARCHITECTURE-OVERVIEW.md`。
> 2. **R5 第 2 刀**：步骤见 §2。账本在 `docs/mcp-r5-spec-impl-reconciliation.md` §6。
> 3. **R6 第 2 步**：重构机会清单。
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

### 第 153 轮（2026-09-27，提交「fix(1621): CC-127」+ 文档提交「docs: round 153」；上一轮文档 = 9c5ef715）

- **做到哪**：
  - 「初始」原文侧反查完成（`docs/mcp-r6-refactor-list.md` §2.14，38 条）。
  - **CC-127 洛克茜真 bug**：`src/mechanics/agents/roxy.ts` 回能转模改读 `energyRegenOutOfCombat`（原读基础回能，转模从未触发）。5 个洛克茜预设伤害 +5.7%~+14.9%，timeGolden 19 叶已逐条解释并重生成（卡表 CC-127 行）。
  - **CC-128 诺姆**：`src/mechanics/agents/norma.ts` 初始暴击读局外，预设内零差。
  - 新单测 `src/mechanics/__tests__/initialRegenCritCc127.test.ts`；`src/specs/agents/1621.json` 注记同步。
  - 验证：verify / vue-tsc / CG 见提交；zd 差异只在 5 个洛克茜预设；反向验证旧实现 3 条全红。
- **下一步（按顺序，可直接开工）**：
  1. **CC-129 席德选正兵按初始攻击**：开工方案在清单 §2.14 末。
  2. 同类「字段语义误读」扫描（洛克茜的教训）：`PanelValues` 里带「基础」语义的字段（`energyRegen`、`atkBase` 类、`flashEnergyRegen` 等，见 `src/types/catalog.ts` 第 30-60 行注释）逐个 `git grep` 读取点，确认每处想要的是基础值还是总值。先读 catalog.ts 列出基础语义字段清单，再逐个查。
- **本轮拍板**：
  - 洛克茜按原文改（R5 数据可信；原实现读错字段属于 bug，不是口径选择）。数值升幅大，但每条差异都能解释到「攻击 +960 / 冲击 +76.8 双封顶」。
  - CC-129 不在本轮做：build 阶段能否拿到局外面板还没查，且只影响多强攻队伍的选人。
- **已知坑**：
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
