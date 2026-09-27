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

### 第 128 轮（2026-09-27，一个提交，提交号见 git log 中的「fix(CC-102)」）

- **做到哪**：
  - R5 第 3 刀完成 `condition`（账本 §7 **D18**）与 `requirement`（**D19**）。
  - **CC-102 完成**（D19）：音擎 effect 级 requirement 生效。改动 `src/core/wengineConditions.ts`（`wEngineEffectRequirementMet`、ctx 新增 `wearerSpecialty`）、`src/core/buff.ts`、`src/core/inCombatBuffs.ts`；新测试 `src/core/__tests__/wengineEffectRequirement.test.ts`（修前简装 14150 异常增伤 +10 复现，修后 0）。zd.sh DIFF 0。回退点见账本 §9 CC-102。
  - 立卡 **CC-103**（D18，14155 佩洛伊斯限定），方案写在账本 §9。
  - 第 127 轮的产出：`fa9087b`（CC-101，D8）。
- **下一步（按顺序，每项都可以直接开工）**：
  1. **CC-103**：按账本 §9 方案做。先 `sed -n` 读 `scripts/check-guards.mjs` 中 agentId 相关判据，确认读数据字段不触发；再写测试（朱鸢 1241 装 14155 → `enemyEtherResReduction` 不含 16；佩洛伊斯 1551 含 16），先红后绿；改 `src/types/catalog.ts` `EffectRequirement`、`wengineConditions.ts`、`collectAllBuffs` 传 `wearerAgentId`，catalog.json 14155 该 effect 补 `requirement.wearerAgentIds`（单行 JSON，用 node/python 解析改写并比对只有一处变化）。跑 `zd.sh cc103`。
  2. **R5 第 3 刀续**：§8「S 待第 3 刀」剩余 50 个字段，建议顺序 `coverage` → `target` → `buffModifiers` → `formula` / `expression`。方法同本轮：先用 Python 在 WSL 里统计取值 × 位置（参考 `/home/kaua/calc-arch/cond1.py`、`req1.py`），再逐个读取方读码，每类写 D 条目。
  3. **R5 第 4 刀其余**：D7 滑块、D3 覆盖率按组联动、D14 蕾米埃尔一致性单测（都是零差）。
  4. **R6 第 1 步续**：全景 §6 的 4 项；然后是 R6 第 2 步。
- **未决项**：
  - D18 的潜在风险：新数据若把属性 / 特化限定只写进 condition 散文，会静默生效；录入时应写 requirement（音擎 effect 级 requirement 现已生效）。
  - 旁注待查：`helpers.ts:905` 把 turbulence 并入 anomalyDmgBonus，是否与 statRules 口径一致未核。
  - 34100 谶羽之誓 `modelingNotes` 写「15% 流明异常增伤不参与计算」，但 effects 里有 `anomalyDmgBonus 15`（requirement lumiflux）且引擎会计入。按 R5「数据可信」以 effects 为准，notes 疑似过时；未改，第 3 刀查 `modelingNotes` 时一并确认。
  - CC-100 之后，基础掌控 86 的角色（1111 / 1121 / 1271 / 1291）装 6 号位掌控不再达到折枝剑歌 115 门槛，是应有结果；
  - D7 的 2 个驱动盘效果是否另有入口可调未核（`panelPhases.ts:728`）；D10 两份 Boss 数据是否一致未比对；
  - CC-99 排在 R6 清单之后重新评估；CC-97 暂缓；CC-84 触发式。
- **已知坑**（长期有效的放在这里，每轮替换时保留仍然有效的条目）：
  - 删文件后，先 `git add -- <路径>` 暂存删除，再跑 check-guards。判据 25 的扫描器用 `git ls-files` 取清单，已删未暂存的文件会让它报 ENOENT。按 AGENTS.md 规则 13，不要用无路径的 `git add -A`。
  - 用户会在轮中途提交，而且和我共用同一个工作区。**提交前务必 `git log --oneline -3`**；新文件 `git add` 和 `git commit` 放在同一条命令里，否则暂存的文件可能被用户的提交顺带卷走（第 119 轮 `2259a17` 发生过）。
  - `grep -r` 在仓库里会超时，一律用 `timeout 40 git grep`。
  - **MCP 的 `apply_patch` 在 WSL 的 UNC 路径上不可靠**（第 126 轮实测）：新建文件因依赖硬链接失败（ENOTSUP），且会把同一 patch 里其他已存在文件的权限从 755 改成 644，同时报告「nothing was written」。新建文件用 `up.sh` 上传，编辑用上传的 Python 脚本（先断言再写盘）；事后 `git status` / `git diff` 检查权限变化（`old mode 100755`）。
  - 长任务（verify 约 150 秒）用 `setsid /home/kaua/calc-arch/bg.sh <名> '<命令>'` 放后台，轮询日志末行 `EXIT=`。verify 期间不要改 docs 和 src。
  - vitest 通过不等于类型正确，要跑 `npx vue-tsc -b`。
  - 触及计算路径的改动要做零差：`bash .zc/perf/zd.sh <tag>`，必须带 tag，要求 DIFF 0。
