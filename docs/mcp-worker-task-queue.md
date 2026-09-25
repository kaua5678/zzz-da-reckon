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
| W17 | 补青衣(1251) 影画4 回能差分断言 | 新增测试 | `src/mechanics/__tests__/qingyiC4Energy.test.ts`、`.zc/reports/W17.md` | 进行中（09-25 派发，持重计算时段） |
| W18 | 两处纯清理：1531 spec notes 文案 + 般岳死写 | 小实现 | `src/specs/agents/1531.json`（仅 notes 字符串）、`src/mechanics/agents/banyue.ts`（仅删 1 行）、`.zc/reports/W18.md` | 待派发（W17 后，占重计算时段） |
| W19 | frontlineRowsOf 琉音赠大收敛到 `ultimateGiftOf` | 小重构 | `src/core/resource.ts` | ✅ lead 自做（`85d90c6`，全量 3489 passed；W13 drifted #15 结案） |
| W20 | 轴模式琉音送客行是否双计：取证 | 只读 + 隔离探针 | `.zc/reports/W20-axis-farewell.md`；探针只在 `/tmp/wt-W20` | 待派发（可与 W18 并行；W17 交还重计算时段后） |
| W21 | 琉音转大次数单源化（W16 契约 C） | 实现 | 见卡 | 待派发（**W20 回收后**；前置不满足则 blocked） |

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

## 2. 任务卡

<!-- card:W17 -->
### W17 · 补青衣(1251) 影画4 回能差分断言

你是执行工人，只完成本卡，不继续委派。TASK_ID=W17。
工作区 `/home/kaua/projects/zzz-calculator`。开工打印真实 HEAD 与 `git status --short`。
父目标：档案段 1251 记录「影画4 护盾刷新回 5 能量/10s」有生产写入方与消费者，但 `grep -rn qingyiC4Energy src --include=*.test.ts` 零命中；本卡补一条会对错误变红的断言。

**已知事实**：写入方 `src/mechanics/agents/qingyi.ts` `buildCharConfig`（`cfg.qingyiC4EnergyPerTrigger = cinemaLevel >= 4 ? C4_ENERGY_PER_TRIGGER : 0`，`cfg.qingyiC4TriggerInterval = C4_TRIGGER_INTERVAL`）；
消费者 `src/core/resource/resourceIncome.ts#calcEnergySource`（`qingyiC4Energy = floor(totalTime / interval) × perTrigger`，并计入能量合计）；展示 `src/components/ResourceResultCard.vue`（`energySource.qingyiC4Energy`）。

**先读**：`AGENTS.md` §1 规则 5/9/10、§3「新测试一律用 `src/test/harness.ts`」；`src/test/harness.ts`；`src/mechanics/__tests__/qingyi.test.ts`（照它的组队与取结果方式）；上面三个符号。

**允许写入**：新建 `src/mechanics/__tests__/qingyiC4Energy.test.ts`；报告 `.zc/reports/W17.md`（先 `zc claim` 这两个路径）。
**禁止**：改任何生产代码、既有测试、基线、spec；负控时对 `qingyi.ts` 的临时改动必须用备份还原（见步骤 3）。

**步骤与验收**（测试/构建时段由派发附注授予）：
1. 写测试：同一队伍青衣 C3 vs C4，断言 ① C3 时 `energySource.qingyiC4Energy === 0`；② C4 时 `=== Math.floor(totalTime / 10) * 5`，`totalTime` 从结果对象读（不要写死 180）；③ C4 能量合计比 C3 多出恰好该值（若合计还受其它 C4 效果影响，改为只断言①②并在报告说明）。
2. 正控：`VITEST_MAX_WORKERS=4 npx vitest run src/mechanics/__tests__/qingyiC4Energy.test.ts src/mechanics/__tests__/qingyi.test.ts` 全绿，记录 passed 数。
3. 负控（证明能红）：`cp src/mechanics/agents/qingyi.ts /tmp/qingyi.ts.bak` → 把 `C4_ENERGY_PER_TRIGGER` 改成 4 → 重跑新测试，**必须红**且失败断言是 ②/③ → `cp /tmp/qingyi.ts.bak src/mechanics/agents/qingyi.ts` → `git diff --stat src/mechanics/agents/qingyi.ts` 必须为空。**不要**用 `git checkout` 还原。
4. `npm run check-guards`（新测试不得新增三文件 fetch stub）+ `npm run build`（含 vue-tsc）。

**固定报告与收工**：首行及最终回复 `STATUS: done|blocked`。含 HEAD、测试源码全文、正控/负控原始输出尾部与退出码、`git diff --stat`、`git status --short`。
`zc done --verifier '<正控命令>' --coverage 'src/mechanics/__tests__/qingyiC4Energy.test.ts' --risk '<未证明事项>'`。不提交（lead 复核后提交）。
<!-- /card:W17 -->

<!-- card:W18 -->
### W18 · 两处纯清理：星徽·比利(1531) spec notes 文案 + 般岳(1471) 死写

你是执行工人，只完成本卡，不继续委派。TASK_ID=W18。
工作区 `/home/kaua/projects/zzz-calculator`。开工打印真实 HEAD 与 `git status --short`。
父目标：2026-09-25 档案核对发现两处「文档/代码不说真话」，都不改任何数值行为。

**任务 1 · `src/specs/agents/1531.json` notes 对齐实现（实现为准）**：
- 事实：notes 某行写「默认 rockingRatio=0」，而 `src/mechanics/agents/starlightBilly.ts` 的 `DEFAULT_ROCKING_RATIO = 0.1`（滑块 default 0.1，头注释也写 0.1）⇒ 把该处改为「默认 rockingRatio=0.1（模块 DEFAULT_ROCKING_RATIO）」。
- 事实：notes 有两行把「闪反 +10%」列为回血来源，另一行写「通用闪避反击（决斗之王）执行禁用，其 10% 回血随之不计入 HP 池」，`computeBillyHpModel` 只有抓地/摇曳/普攻回血 ⇒ 在前两行的「闪反 +10%」后补「（执行禁用，不计入 HP 池，见下文银河横行条）」，不删原文。
- 只改 `notes` 数组里的这几条字符串；不动其它键、不重排、不改缩进风格。改前先 `grep -rn '\.notes' src --include=*.ts | grep -v __tests__` 确认 notes 不被计算消费，把结论写进报告。

**任务 2 · 删除 `src/mechanics/agents/banyue.ts` 的死写 `record.banyueSwayExCount = cycle.swayExCount`**：
- 事实：全仓唯一引用即该写入行（lead 已 grep）。动手前自己再 `grep -rn banyueSwayExCount src scripts public docs` 复核（含 .vue/.json/测试）；有任何读者就**停下写 blocked**，不删。
- 只删这一行；**不要**动 `cycle.swayExCount` / 类型里的 `swayExCount`（那是活字段，资源卡 summary 在用）。

**先读**：`AGENTS.md` §1 规则 4/13/14/16；上述两个文件的相关段落。`banyue.ts` 若在 `zc status` 显示被其它车道租约，只做任务 1 并在报告说明。
**允许写入**：`src/specs/agents/1531.json`、`src/mechanics/agents/banyue.ts`、`.zc/reports/W18.md`（先 `zc claim`）。其余只读；不提交。

**验收**（构建时段由派发附注授予）：
1. `npm run validate:specs`、`npm run check-guards`（含判据 21 JSON 重复键）。
2. `VITEST_MAX_WORKERS=4 npx vitest run src/mechanics/__tests__/banyue.test.ts src/mechanics/__tests__/billySmoke.test.ts src/specs/__tests__/verify.test.ts`。
3. `npm run build`。
4. `git diff` 全文贴进报告：1531.json 只有 notes 字符串行变化；banyue.ts 只有 1 行删除。

**固定报告与收工**：首行及最终回复 `STATUS: done|blocked`；含 HEAD、两次 grep 原始输出、`git diff` 全文、各验收命令退出码与结果尾部。
`zc done --verifier '<命令>' --coverage 'src/specs/agents/1531.json, src/mechanics/agents/banyue.ts' --risk '<未证明事项>'`。
<!-- /card:W18 -->

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
