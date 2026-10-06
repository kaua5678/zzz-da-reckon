# R2 · 开发流程提速：先量，再改（2026-09-27，lead-arena-0925c 第 115 轮）

> 用户需求见 `docs/REQUIREMENTS.md` R2。硬约束：**不得以降级验证强度换速度**；削弱保证的选项只列出、交用户裁决。
> 本文 = 测量数据 + 结论 + 已落地的零强度损失优化 + 待裁决清单。流程口径已同步到 `docs/mcp-worker-task-queue.md` §0「收尾流程（R2）」。

## 1. 结论（先看这段）

1. **验证确实是一张卡里最大的单项耗时**：清理/小改类卡墙钟 6.7–11 分钟，其中验证等待约 **4.4–5.5 分钟（50–65%）**。它是瓶颈，但**不是可以砍掉的那种**——全量 `npm run verify` 本身约 153 秒，其中 vitest 占 105 秒（跨 339 个测试文件，CPU 合计约 1400 秒，16 核并行已吃满）。
2. **必要的部分保留**：全量 verify、零差 dump/rowsnap、文档提交后重跑 check-guards 都不动（这三道各自抓到过真实红灯，见 §3）。
3. **浪费的部分已砍掉**（零强度损失，均实测）：
   - `vue-tsc -b` 没开增量：无改动重跑也要 17.3 秒 → 开 `incremental` 后 **1.5 秒**（负控：单文件类型错误、跨文件签名破坏都照报）。verify 里 build 步骤因此每次省约 19 秒。
   - 零差四路（基线 dump / 基线 rowsnap / 改后 dump / 改后 rowsnap）原来**顺序**跑，约 4×43 = 176 秒 → 新脚本 `.zc/perf/zd.sh` **并行**（基线用 git worktree）**50.7 秒**，DIFF 0 自证 + 注入改动负控 DIFF 1。
   - 文档起草与 verify 等待**重叠**（起草在沙箱本地，verify 结束后再落盘，因为 check-guards 会扫描 docs）。
   - 去掉重复：收尾时单独跑的 `check-guards` / `vue-tsc -b` 与 verify 内部那次重复；只在「需要早信号」时单独跑（见 §4 规则）。
4. **改前 → 改后（可对比数字）**：
   - 全量 verify：约 153 秒 → 约 134 秒（确定性节省 = tsc 那 19 秒；实测一次 112.2 秒，但 vitest 自身在 96–148 秒之间波动，不把噪声算作成果）。
   - 触及计算路径的卡（要零差）：零差 176 秒 → 51 秒。
   - 每张卡：小卡约省 1.5–2 分钟（约 15–20%）；计算路径卡再省约 2 分钟。
5. **剩下的是接近必要下限的开销**：vitest 105 秒、check-guards 12 秒、build 9–14 秒。再往下压要么动测试本身的 CPU 开销（§5，可做、不降强度、有工程量），要么降强度（§6，需用户裁决）。

## 2. 测量

### 2.1 数据源（都可复查）

- 卡的墙钟：相邻两轮「docs 收尾提交」的时间差，`git log --format='%ad %h %s' --date=format:'%m-%d %H:%M:%S' 037a66f~1..4191bd0`。
- verify 各步：`/home/kaua/calc-arch/t116.sh`（逐步 `date +%s.%N` 计时）→ `t116.log`。
- 历次 verify 的 vitest 时长：`/home/kaua/calc-arch/verify1*.log` 的 `Duration` 行。
- 零差四路的历史耗时：`/home/kaua/calc-arch/z{63,78,80,81,82}-{da,ra,db,rb}.out`。
- 第 113/114 轮逐步时长：lead 的工具调用耗时记录（本文 §2.3 抄录）。

### 2.2 每张卡的墙钟（第 102–114 轮）

| 卡 | 收尾提交时间 | 与上一卡间隔 |
|---|---|---|
| CC-83 | 12:51:30 | — |
| CC-85 | 12:59:24 | 7.9 分钟 |
| CC-86 | 13:07:53 | 8.5 |
| CC-87a | 13:20:34 | 12.7 |
| CC-87b | 13:38:28 | 17.9 |
| CC-88 | 13:44:24 | 5.9 |
| CC-89 | 13:59:27 | 15.1 |
| CC-90 | 14:34:16 | 34.8（8 批 dsh 并行核实） |
| CC-91a/b | 14:50:43 | 16.5 |
| CC-92 | 15:02:38 | 11.9 |
| CC-93 | 15:09:48 | 7.2 |
| CC-94 | 15:16:31 | 6.7 |
| CC-95 | 15:27:32 | 11.0 |

中位数约 11.5 分钟。

### 2.3 验证在一张卡里占多少（抽样第 113、114 轮）

| 轮 | 卡墙钟 | 验证相关等待 | 占比 | 构成 |
|---|---|---|---|---|
| 113（CC-94） | 6.7 分钟 | ≈4.4 分钟 | ≈65% | tsc+dead-channels 25 秒；check-guards+scripts 测试 49 秒；verify 等待 177 秒（固定 sleep 165 秒 + 轮询）；文档后 check-guards 约 12 秒 |
| 114（CC-95） | 11.0 分钟 | ≈5.5 分钟 | ≈50% | 首次 check-guards+定向测试 45 秒（抓到 2 条红）；修后定向测试+tsc 45 秒；tsc 17 秒；verify 166 秒；文档后 check-guards 17 秒；另有一次脚本失败重跑 37 秒 |

### 2.4 verify 内部各步（`t116.log`，改前）

| 步骤 | 耗时 |
|---|---|
| check-guards | 12.4 秒 |
| check-tokens / validate-data / validate-specs / verify-recording | 0.1 / 0.2 / 0.5 / 0.7 秒 |
| vitest 全量（`npm test`） | 104.7 秒 |
| build = `vue-tsc -b`（冷） + `vite build` | 21.0 + 13.6 秒 |
| 合计 | ≈153 秒 |

补充：
- `vue-tsc -b` 无改动再跑一次仍要 17.3 秒。原因是 `tsconfig.app.json` 只有 `noEmit`，没开 `incremental`，tsbuildinfo 里只存根文件列表，每次都全量重检。
- vitest 墙钟跨轮在 96–148 秒之间波动（verify102–116），这是机器负载噪声，不是代码变化。
- 最重的测试文件（套件内并发下的耗时）：`deadChannelLs.test` 96 秒、`allAgentsGuards` 87 秒、`difficultyCurve` 76 秒、`timeGolden` 66 秒、`checkGuards.test` 66 秒。单独跑时：`deadChannelLs.test` 29.5 秒、`checkGuards.test` 22.5 秒（套件内并发时更慢，因为 16 核被其他文件占满）。

### 2.5 零差四路（改前）

z63 / z78 / z80 / z81 / z82 这五张卡，每路 42–48 秒、四路顺序执行约 176 秒。perf 配置为 `fileParallelism: false`，每路是单个测试、单线程运行（`tests 41.22s`），而机器有 16 核，并发不会互相抢占。

## 3. 为什么这些验证是必要的（不砍的依据）

- **全量 verify**：
  - 第 114 轮：代码改动让 2 条「依赖仓库清单条数」的测试变红。
  - 第 115 轮：文档改动让「手册 §4 行数」棘轮测试变红（725 > 718）。**文档改动也能打红 vitest**，所以「只改文档就只跑 check-guards」不成立。
- **文档提交后重跑 check-guards**：第 111 轮 verify 早于文档提交，漏掉了 §5.99 散文误触 @fact 解析造成的红灯。
- **零差 dump/rowsnap**：CC-63、CC-78 至 CC-82 用它证明计算路径重构逐位不变。本轮的负控也证明，一个 `/2 → /2.01` 的微小改动就能被抓到（1 队 DIFF）。

## 4. 新收尾流程（已写进队列文档 §0，工人与 lead 通用）

1. **改代码中途**：想要早信号时，跑 `npx vue-tsc -b`（增量编译，改一两个文件约 9–12 秒，无改动约 1.5 秒）和**只跑相关的**测试文件，例如 `npx vitest run <相关 test>`。这两步不再是必需，只用来尽早发现问题。
2. **触及计算路径**：跑 `bash .zc/perf/zd.sh <tag>`（基线 = HEAD，改后 = 工作区，约 50 秒）。
   - 期望 `DUMP DIFF 0` / `ROWS DIFF 0`；如果不是 0，必须逐条解释。
   - 前提：基线就是 HEAD，所以**本卡的改动不能先提交**，也不要混入无关的未提交改动。
3. **全量 verify**：`setsid bg.sh verifyNNN 'timeout -s KILL 1500 npm run verify'`，**只跑一次**。
   - 等待期间在沙箱本地起草文档脚本（census / arch / 队列），**不要落盘**。
   - 用轮询 `grep -q '^EXIT' log` 等结果，不要用固定的 `sleep 165`。
4. verify EXIT 0 后，提交代码，再落盘文档、提交文档，**然后重跑 `node scripts/check-guards.mjs`（12 秒，必须）**。

## 5. 后续可做的不降强度优化（未做；原写「已立卡 CC-97」是过期指针，见 §8.3 第 4 条）

- **重测试文件的 CPU 开销**：`deadChannelLs.test`（96 秒）与 `zcDeadChannels.test`（46 秒）每条用例都要起 TypeScript LanguageService。可以考虑在同一文件内共享 program，或者对只读夹具做模块级 memo，这样断言不变、总 CPU 下降。
  - 由于 vitest 已经吃满 16 核，墙钟约等于 CPU 总和 ÷ 16。削掉约 100 秒 CPU，墙钟大约只少 6 秒，**性价比低**，所以排在后面。
  - 真正能缩墙钟的是**长尾文件**：当某个文件单独耗时接近墙钟时，它就是关键路径，要先确认。
- **vite build**（9–14 秒）：verify 需要它来证明能构建，不砍。

## 6. 会削弱保证的选项（**未采用，交用户裁决**）

| 选项 | 能省多少 | 会让什么类型的错误漏过去 |
|---|---|---|
| 收尾用 `vitest --changed` / `--related` 代替全量 | 视改动而定，小卡可能省 60–90 秒 | ① 通过数据文件（JSON / docs）而不是 import 产生依赖的测试，例如本轮的「手册 §4 行数」测试读的是 docs，related 图里没有它；② 读仓库现状的守卫类测试；③ 动态 import / `import.meta.glob` 的依赖 |
| 只改文档的提交跳过 vitest，只跑 check-guards | 约 105 秒 | 读取 docs 的测试（手册密度 / 行数棘轮、@fact 相关测试），本轮已实测会红 |
| 零差只跑 dump、不跑 rowsnap | 并行后几乎不省（四路同时跑） | 行级差异在总量上抵消的情况（总伤不变、行分布变了） |
| 纯改名 / 纯搬迁卡跳过零差 | 约 50 秒 | 「看起来是纯搬运」实际带出行为变化（例如搬迁时丢了副作用顺序）；判断「纯搬运」本身就没有机器依据 |

## 7. 本轮落地的改动与回退点

- `tsconfig.app.json` 增加 `"incremental": true`。
  - 回退：删掉这一行，再删 `tsconfig.app.tsbuildinfo`（已被 gitignore）。
  - 已知坑：TS 升级后首次运行会自动全量重建，属于正常现象。
- `.zc/perf/zd.sh`：本机工具，因为 `.zc/` 被 gitignore，与 perf 工具放在一起。
  - 原理：在 `/tmp/zd-base-<tag>` 建 worktree，软链 `node_modules`，把 `.zc/perf` 拷进去，四路并发运行后清理。
  - 脚本不存在时，按 §4 第 2 步的描述重建即可；原顺序模板见 lead 的 `z82.sh`。
- 队列文档 §0 增加「收尾流程（R2）」。
- 已知坑：在 bg.sh 的命令里写 `exit $rc` 会提前结束外层 shell，导致日志缺少 EXIT 行（verify116 就是这样）。需要计时时，把 `WALL` 行放在 verify 之后，不要 `exit`。

## 8. r696 复测（2026-10-06，arena-G）：vitest 逐文件耗时普查

> **结论**：测试 CPU 集中在约 40 个重文件：前 10 个占 40%，前 20 个占 61%，前 40 个占 80%。它们都是「每个探针点新建 `setupHarness` 跑真管线」或「全预设 / 全角色 × 命座 0/6 扫描」，**没有能零风险删掉的整块重复**。能做的都是单项约 1% 的顺手项（§8.3），**不单独立卡**；什么时候再做见 §8.4。
>
> **和 §1 的差别（判断值不值得时要用）**：§1 测量时 vitest 用满 16 核；CC-424（r450）之后 worker 上限是 4。现在每省 4 秒 CPU，墙钟就少 1 秒（§5 当时要省 16 秒 CPU 才少 1 秒）。

### 8.1 测法与数据

- 基线提交 `9c21390c`，在独立 worktree 里跑：`npx vitest run --shard=k/2 --reporter=default --reporter=json --outputFile.json=<文件>`。两片 2171 + 2336 = 4507 passed，等于基线（527 个文件）。
- **有干扰**：两片运行时用户会话也在跑 vitest（片 2 开跑时 `pgrep -fc "[w]orkers/forks.js"` = 4，load 约 9）。片 1 墙钟 216 秒、片 2 162 秒；r694 干净时是 170 秒、111 秒。所以下表的绝对秒数大约偏大 1.3–1.5 倍，**只用排名**。
- 干净时的 CPU 构成（r694 两片 vitest 汇总行相加）：
  - tests 848 秒（78%）；
  - setup 161 秒（15%）：setupFiles `src/mechanics/index.ts` 在每个测试文件里重新导入全部机制模块；
  - import 52 秒（5%），transform 21 秒（2%）；
  - 合计 1082 秒，÷ 4 个 worker ≈ 270 秒，与两片墙钟之和 281 秒吻合。
- 原始数据与脚本在 `/home/kaua/calc-arch/`（不入库）：`g696-s{1,2}.json`；`g696-vt.py`（逐文件排名）、`g696-vt2.py`（文件内逐用例）、`g696-vt3.py`（下表）。

### 8.2 前 20 个文件（有干扰时的秒数）

| 文件墙钟 s | 用例数 | 文件（`src/` 下） | 文件内最重的用例 |
|---|---|---|---|
| 77.4 | 23 | `mechanics/__tests__/mechanicSettingsEffect.test.ts` | 18.7s「sigrid.cinema4Coverage：Δpane…」 |
| 56.8 | 28 | `composables/__tests__/difficultyCurve.test.ts` | 32.8s「切轴档（altAxes，2026-09-13）：作为 A…」 |
| 54.3 | 1 | `composables/__tests__/axisFallbackReportCc457.test.ts` | 54.3s「① 吸收比 0 → 0.4 → 1：弃轴集合单调不增（子…」 |
| 46.7 | 6 | `mechanics/__tests__/roxyWindEyeTiming.test.ts` | 14.6s「① 结构性不变量：`spinSeconds` ≥ 65/…」 |
| 46.0 | 15 | `scripts/__tests__/deadChannelLs.test.ts` | 35.7s「⑫ 仓库级棘轮：实测死导出 ⊆ 冻结基线（新增即红；改善…」 |
| 44.7 | 8 | `composables/__tests__/pullPlannerEngine.test.ts` | 31.2s「成型号起点 3 期规划：总分 > 0、金数守恒、调用方 …」 |
| 42.2 | 9 | `mechanics/__tests__/adminRulingEffect.test.ts` | 12.0s「乙-1/乙-2 两条 rate **互相独立**（风能率…」 |
| 38.3 | 9 | `composables/__tests__/timeGolden.test.ts` | 20.8s「105 预设：伤害 / 失衡 / 留白 / 逐槽时间账…」 |
| 38.1 | 2 | `composables/__tests__/charIncrementInt.test.ts` | 22.4s「全量 pass：秒级完成、期规模合理、账号分不超上限、调…」 |
| 33.0 | 2 | `core/__tests__/allAgentsGuards.test.ts` | 20.7s「历史无关：B → A 与全新直达 A 逐位相同（面板 /…」 |
| 29.4 | 1 | `mechanics/__tests__/hookReplay.test.ts` | 29.4s「全角色 × 命座 0/6 + 全部三人预设：① 重放一致…」 |
| 28.4 | 143 | `scripts/__tests__/checkGuards.test.ts` | 10.5s「★ 新增棘轮的 current 必须是「剩余工作量」而不…」 |
| 27.3 | 1 | `mechanics/__tests__/r65j1DeadBuffProbe.test.ts` | 27.3s「interactive 条逐条拨动 ⇒ 读数必须变化；d…」 |
| 27.3 | 5 | `core/__tests__/dynamicComboAlign.test.ts` | 15.6s「③ 吸收只发生在溢出队：全库预设口径（缺省上限）终态里带…」 |
| 26.0 | 5 | `composables/__tests__/difficultyDescent.test.ts` | 7.5s「C0 默认 6 档：首档最优、至少一档真降伤害、档数与回…」 |
| 23.8 | 15 | `composables/__tests__/timeWeightAllocation.test.ts` | 5.2s「⑦ 用户约束「弹刀多了也不能超过总时间」：越界配置被硬门…」 |
| 22.5 | 1 | `mechanics/__tests__/lateCfgWrite.test.ts` | 22.5s「全角色 × 命座 0/6 + 全部三人预设：除允许名单外…」 |
| 20.5 | 3 | `core/__tests__/feasibleRowsMemo.test.ts` | 20.3s「端到端 A/B：多预设 × 命座 0/6 × 降配扫描，…」 |
| 19.3 | 8 | `specs/__tests__/adjustableEffect.test.ts` | 4.7s「1 条收敛反馈型（1591）：rate×截断前出枪式行计…」 |
| 19.3 | 11 | `composables/__tests__/cinemaUplift.test.ts` | 11.1s「防死数据：状态表声明已实现的命座级别不得被判为 unim…」 |

### 8.3 判读

1. **重是设计决定的，不是写法浪费**。`mechanicSettingsEffect` 与 `roxyWindEyeTiming` 的文件头口径②写明：同一个 harness 跨取值复用，会因收敛态污染产出假的 no-delta，所以每个探针点必须新建。一次真管线求值约 0.5–1.5 秒，这类文件的耗时 ≈ 探针点数 × 单次求值。
2. **跨文件的「全预设、默认设置」扫描至少有 4 份**：`timeGolden`「105 预设」20.8 秒、`timeLedgerInvariants` 14.5 秒、`timeFillRatchet` 9.6 秒、`axisFallbackReportCc457` 的 0.4 档。但它们的装配路径各不相同（`applyTeamPreset` / `applyTeamToStore` / 逐槽 `setAgent`），合并会改变各自测的东西 ⇒ **不合并**。`hookReplay` 与 `lateCfgWrite` 扫的是同一个场景集（全角色 × 命座 0/6 + 全部三人预设），但用的仪器不同（钩子重放 / cfg 写入陷阱），合在一起只会把两个判据耦合 ⇒ 不合并。
3. **顺手项**：有人改到这些文件时再做。省时按干净数据估，÷ 4 折成墙钟。

| 项 | 估计省 | 改法与前提 |
|---|---|---|
| `charIncrementInt`：两个用例各跑一遍同一个全量 `computeIncrementPass`（同一队、同一输入，独立场景求值） | 干净约 14 秒 CPU，约 3.5 秒墙钟 | 文件内只跑一次全量，中途 store 检查的记录交给用例 1 断言，用例 2 只读结果 |
| `axisFallbackReportCc457`：每个预设等 `setTimeout(40)`，3 档 × 104 个 = 312 次，约 12.5 秒纯等待（占着一个 worker） | 约 3 秒墙钟 | 先证明 `resourceResult` 能同步读（`timeLedgerInvariants` 同类读法不等待），再改成不等待或 `nextTick` |
| `zcDeadChannels`「真实 CLI」用例：起两次 CLI，各扫一遍全仓；连同 `deadChannelLs` ⑦，同一个全仓扫描每次跑 3 遍 | 约 7 秒 CPU | 文件头已写明「扫描口径由 deadChannelLs 守护，这里只验入口」⇒ 只起一次 `--json`，文本一致性用进程内的 `formatDeadChannelReport` 验 |
| setupFiles 让每个文件都导入全部机制模块（setup 占 15%） | 只能省掉不需要引擎的那些文件，估计不超过 30 秒 CPU | 要按需注册就得改 `mechanics/index.ts` 的副作用注册架构；收益不够，不做 |

4. **§5 标题里的「已立卡 CC-97」是过期指针**：CC-97 这个编号后来用在了「校准原子测量清单 v1」（`docs/mcp-calibration-atoms.md`），测试 CPU 优化从来没有立过卡。§5 点名的 `deadChannelLs`：r696 实测文件内 46 秒里，35.7 秒在 ⑫（src/core 死导出，逐个导出跑 `findReferences`），7.3 秒在 ⑦，夹具用例都不到 0.5 秒。所以大头是 ⑫ 本身的符号级查询；「共享 program」能省多少，要先核 ⑦ 与 ⑫ 是否各建了一次 program（本轮未核）。

### 8.4 什么时候再做（触发条件）

- 任一片在**干净**机器上的墙钟超过 220 秒（离单次调用上限 285 秒不到 65 秒），或全量 CPU 超过 1400 秒：按 §8.3 的表从上往下做，并按 §8.1 的测法重排名次。
- 有人要新写「全预设 / 全角色」扫描：先看 §8.3 第 2 条那 4 份能不能复用，再决定要不要另起一份。
- 除此之外，只在改到这些文件时顺手做。
