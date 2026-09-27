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

### 第 148 轮（2026-09-27，一个提交「fix(1541): CC-121」，提交号见 git log；上一轮 CC-120 = af31a5e）

- **做到哪**：
  1. **CC-99 重新评估：按原范围不做**（结论与重开条件写在 `docs/mcp-mechanic-dataization-census.md` §6 顶部；卡表 CC-99 行已改）。命座透传 61 处 / 56 键逐键核对，没有真 bug（仅 `rina.ts:191` 一处无害死写）。
  2. **CC-121（改数值）：普罗米娅有罪推定全队异放减防改为真正的全队生效**。
     - `src/mechanics/types.ts`：`AgentMechanicModule.releaseModifierScope?: 'self' | 'team'`。
     - `src/composables/resourceCalc/damagePool.ts`：`resolveReleaseModifier` 汇总本角色模块和在场声明 team 的模块（去重，相加）。
     - `src/mechanics/agents/promia.ts`：声明 `releaseModifierScope: 'team'`，删除「近似为自身」的注释和文案。
     - `src/specs/agents/1541.json`：2 处 note 同步更新。
     - `src/mechanics/__tests__/promiaRelease.test.ts`：新增 1 例（普罗米娅 + 薇薇安 + 蕾米埃尔：薇薇安的异放行 note 含「有罪推定」；换成月城柳后没有）。反向验证：删掉 scope 后该例失败，恢复后 cmp 一致。
     - 数值：zd 16 处变化，全部是含 1541 的预设，+0.54% ~ +4.74%，与事先用临时补丁测得的数值逐位相同。timeGolden 3 条已重生成（见卡表 CC-121），word-diff 确认只改了这 3 个数。
     - 文档口径：`docs/ENGINE_PIPELINE_GUIDE.md`（releaseModifier 行）、`docs/MECHANIC_PATTERNS.md`（结算者行）。
     - 验证：vue-tsc 0；get_diagnostics 0；CG 25/25；verify 见提交。
- **下一步（按顺序，可直接开工）**：
  1. **1471 般岳格挡嗔火 4 vs 6**（`docs/mcp-spec-resources-audit.md` §3 未决）。先读原文：`python3` 在 `public/static/catalog.json` 与 `data/raw/nanoka_missing/full/1471.json`（若存在）里搜「格挡」「不动如山」「嗔火」。
     - 原文区分普通格挡 4 / 完美格挡 6：模块正确，把 spec 的 `banyue_fury_from_block` 改成与模块一致的描述（resources 不参与计算，零差），并在审计文档 §3 标已结。
     - 原文只有一个值且与模块不同：开 CC 卡（改数值），按 CC-118 / CC-121 的流程做。
  2. **同类扫描：原文写「全队角色……」但实现只作用于本人的机制**（CC-121 的推广）。在 `src/specs/agents/*.json` 的原文段落里搜「全队角色」「队伍中所有角色」「全队」，对照实现是 teamBuff（全队）还是模块 applyPanel / releaseModifier（本人）。只登记差异、附出处，改数值的走 CC 卡。**不要**凭注释判断是否生效，先用面板或伤害池实测（见已知坑）。
- **本轮拍板**：
  - CC-99 不做（依据：没有真 bug，只降计数；回退点：重开即按 census §6 原方案）。
  - CC-121 按原文改为全队生效。依据：原文两处都明确写「全队角色」（R5：数据可信）。有罪推定状态仍按常驻近似（额外能力激活即生效），与原口径一致。多来源修正按相加处理，与面板 enemyDefReduction 的加算一致。回退点：删掉 promia 的 `releaseModifierScope: 'team'` 一行即回到旧数值（damagePool 的汇总在没有 team 模块时与旧逻辑等价）。
- **已知坑**：
  - `releaseModifier` 的派发键是**异放行的 agentId**（结算者），不是 buff 来源。原文是全队的修正必须声明 `releaseModifierScope: 'team'`。
  - 盘点命座透传这类键时，要同时搜 `setRecord(cfg, 'xxx'` 和 `cfgNum(cfg, 'xxx'` 的字符串形式，否则会误报「无写入方」。
  - 判断「spec 某段是否参与计算」用变异法（`/home/kaua/calc-arch/mut147.py` + zd + 阳性对照，见 `docs/mcp-spec-resources-audit.md` §2）。
  - 预设外的角色（zd 看不到）至少有 1121、1281、1291、1081。
  - `setupHarness` 收到裸字符串 id 会抛错，必须传 `{ agentId }` 对象。
  - 模块注释写「未接」不等于真没接（spec teamBuffs 经 catalog 合并，始终生效）。
  - zd 只有 resourceResult 哈希变、伤害不变时，先怀疑 `specResources` 里的文案字段。
  - **zd `/c6` 变体只把 0 号位设为 6 命**，非 0 号位角色的 6 命改动需要自写探针。
  - `BuffEffect` 在 `@/types/catalog`（`src/core/types.ts` 不存在）；vitest 会忽略错误的类型导入，只有 vue-tsc 能发现。
  - `zcWorkspace.test.ts` 在全量 verify 下偶发失败，单独重跑可过。
  - 工具是否齐全以 `node /tmp/mcp.js list | wc -l` 为准（16 = 有 wsl_exec）。
- **未决（数据口径，改即改数值，需 CC 卡）**：「每超过 1 点/1%」是否取整（清单 §2.4 新发现 2）；nangong / liuyin 原文「初始」是否应读局外面板（注意 zd 盲区）；1471 格挡嗔火 4 vs 6（下一步 1）。
