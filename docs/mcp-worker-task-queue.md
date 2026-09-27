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

### 第 144 轮（2026-09-27，一个提交「refactor(C7): CC-117」，提交号见 git log）

- **做到哪**：清单 §2.5-② 完成，attributeConversions 归一收尾（`docs/mcp-r6-refactor-list.md` §2.7）。
  - `src/specs/runtime.ts`：先封顶再乘覆盖率；单测 3 例追加到 `src/specs/__tests__/runtimeSourcePhase.test.ts`。
  - 1261 简：`src/specs/agents/1261.json` 新增 `jane_proficiency_to_atk` 与 2 条 verification；`src/mechanics/agents/jane.ts` 面板（coverage = frenzyFactor）、展示值（探针）、机制卡文案都从 spec 来，删三个常数。
  - 验证：zd `c7e` DIFF 0；两项反向验证；validate:specs 1120；verify EXIT 0；vue-tsc 0；CG 25/25；get_diagnostics 0。
- **下一步（按顺序，可直接开工）**：
  1. **CC-118（改数值）：卢西娅 6 命 `lucia_c6_hp_to_atk` 改读局外生命**（清单 §2.4 新发现 1）。依据：spec `src/specs/agents/1451.json` 声明 `sourcePanelPhase: outOfCombat`，原文「按初始最大生命值（局外生命）的 2%」，而 `src/mechanics/agents/luciaElowen.ts:131–136` 现按局内面板执行并注释「近似接受」——这是规格与实现不一致（R5 口径：数据可信），不是「更接近投稿」。做法：
     - `applyLuciaPanel` 的解构加上 `outOfCombatPanel`，调用改为 `applySpecAttributeConversions(panel, getAgentSpec(LUCIA_AGENT_ID)?.attributeConversions ?? [], 1, { outOfCombat: outOfCombatPanel })`；删掉「近似接受」注释，改写为依据。
     - 跑 `bash .zc/perf/zd.sh cc118`（**预期非零**），用 `node /home/kaua/calc-arch/zdan.mjs <base.json> <after.json>` 列出差异预设：必须**只**出现含 1451 且 6 命的预设（名字里有 `/c6`），伤害应**下降**约 5%×攻击力占比（局内生命含涌泉 +5%）。出现任何其他预设的差异都要先解释清楚再继续。
     - 跑全量 verify；若 `src/composables/__tests__/timeGolden.test.ts` 或其他 golden 变红，逐条写出新旧值与原因再更新期望值，不加容差。
     - spec 1451 该条 note 补上「实现：luciaElowen.ts 传 sources.outOfCombat（CC-118）」；清单 §2.4 新发现 1 标已修；卡表登记 CC-118。
  2. **CC-119（改数值）：普罗米娅每点掌控 +0.35% 全队异放伤害接入计算**（清单 §2.6 末）。先读异放伤害怎么结算（`releaseModifier`，`promia.ts` 已有 releaseModifier 钩子处理「有罪推定」减防），确定承载字段后再动；是否全队生效、是否受 `outOfCombatPanel` 掌控约束都要按原文写。
  3. 评估「10 个模块 spec resources 与模块账本重复」（全景 §6.4），再 CC-99。
- **本轮拍板**：runtime 改为先封顶再乘覆盖率。依据：覆盖率是时间占比，满额值按时间加权才对；旧顺序在覆盖率 < 1 且超上限时偏高。改动时全仓覆盖率恒为 1，零差。回退点见清单 §2.7。
- **已知坑**：
  - `sourcePanelPhase` 只对传了 sources 的调用点生效（目前只有 promia）。
  - `specs/verify.ts` 的 verification 只有一张面板，不传 sources、不传 coverage。
  - spec verifications 只经 runtime 执行；已迁条目：alice、luciaElowen、velina、1481、1511、1541、1261。
  - 注册不再由「import core」隐式触发（C1）。新增 Worker 或 node 直跑 src 的脚本必须自己 `import '@/mechanics'`。
  - `zcWorkspace.test.ts` 租约过期用例在全量 verify 下偶发失败过 1 次（第 139 轮），单独重跑可过。
  - 工具是否齐全以 `node /tmp/mcp.js list | wc -l` 为准（16 = 有 wsl_exec）。
- **未决（数据口径，改即改数值，需 CC 卡）**：「每超过 1 点/1%」是否取整（清单 §2.4 新发现 2）；nangong / liuyin 原文「初始」是否应读局外面板（有 sources 能力，一行修正，但改数值）。
