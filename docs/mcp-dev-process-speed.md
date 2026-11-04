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
2. **触及计算路径**：跑 `bash .zc/perf/zd.sh <tag>`（基线 = HEAD，改后 = 工作区，**约 65–74 秒**，见下方「命座采样面」）。
   - 期望 `DUMP DIFF 0` / `ROWS DIFF 0`；如果不是 0，必须逐条解释。
   - 前提：基线就是 HEAD，所以**本卡的改动不能先提交**，也不要混入无关的未提交改动。
   - **★ 命座采样面 = `{0,1,2,6}`（2026-10-10 T119 任务 B 起；原为 `{0,6}`）**：
     `dump.perf.ts` / `rowsnap.perf.ts` 顶部的 `CINEMA_SAMPLES` 常量（两文件必须逐字一致）。
     原值只采 `{c0, c6}`，而 `timeGolden.test.ts` 的 `CINEMA_LEVELS = [0,3,4,5,6]`
     ⇒ **cinema 1/2 在三个标准仪器里都没有采样点**。T118 实测后果：`yeshuguang.ts` 的自指反馈恰在
     影画1 解锁（`cinema >= 1`）⇒ 它的全部新行为落在盲区里，三次 `zd.sh` 全返回 `DIFF 0`。
     `{0,1,2,6}` 与 timeGolden 的并集**覆盖 0..6**。⇒ 这是**扩大测量面**（AGENTS 规则 17② 口径纠正），
     **不是**放宽判据。**不要**动 `timeGolden` 的 `CINEMA_LEVELS`（那会动基线，且它的面已经够用）。
     实测（§9.5）：干净树自检 `DIFF 0`；把 `yeshuguang.ts` 的 `cinema >= 1` 改成 `cinema >= 3`
     （delta 严格局限于 c1/c2）后，**旧采样面 `DIFF 0`、新采样面 `DIFF 17`**。
3. **全量 verify**：`setsid bg.sh verifyNNN 'timeout -s KILL 1500 npm run verify'`，**只跑一次**。
   - 等待期间在沙箱本地起草文档脚本（census / arch / 队列），**不要落盘**。
   - 用轮询 `grep -q '^EXIT' log` 等结果，不要用固定的 `sleep 165`。
4. verify EXIT 0 后，提交代码，再落盘文档、提交文档，**然后重跑 `node scripts/check-guards.mjs`（12 秒，必须）**。

## 5. 后续可做的不降强度优化（未做；原写「已立卡 CC-97」是过期指针，见 §8.3 第 4 条）

- **重测试文件的 CPU 开销**：`deadChannelLs.test`（96 秒）与 `zcDeadChannels.test`（46 秒）每条用例都要起 TypeScript LanguageService。可以考虑在同一文件内共享 program，或者对只读夹具做模块级 memo，这样断言不变、总 CPU 下降。
  - 由于 vitest 已经吃满 16 核，墙钟约等于 CPU 总和 ÷ 16。削掉约 100 秒 CPU，墙钟大约只少 6 秒，**性价比低**，所以排在后面。
  - 真正能缩墙钟的是**长尾文件**：当某个文件单独耗时接近墙钟时，它就是关键路径，要先确认。
- **vite build**（9–14 秒）：verify 需要它来证明能构建，不砍。

## 6. 会削弱保证的选项（**2026-10-09 T114 逐条判定：③④ 否决，② 已建成带护栏的可选快路，① 否决**）

> 判定依据 = 实测数字，命令逐条可复现。**四条都不许接进 `check` / `verify`**（棘轮在
> `src/scripts/__tests__/checkGuards.test.ts`「快速环的排除集不许腐坏」用例，含 `test:fast` 与 `test:docs`）。

| 选项 | 能省多少（实测） | 会让什么类型的错误漏过去 | T114 判定 |
|---|---|---|---|
| ① 收尾用 `vitest --changed` / `--related` 代替全量 | **省 0 秒**（见下） | ① 通过数据文件（JSON / docs）而不是 import 产生依赖的测试；② 读仓库现状的守卫类测试；③ 动态 import / `import.meta.glob` 的依赖 | **否决**（实测反例 ×3，见 §9.1） |
| ② 只改文档的提交跳过 vitest，只跑 check-guards | **省 208.9 秒**（248.2 → 39.3 秒） | 读取 docs 的测试（手册密度 / §4 行数棘轮、@fact 相关测试） | **采用**（护栏 + `npm run test:docs`，见 §9.2） |
| ③ 零差只跑 dump、不跑 rowsnap | **省 ≈0 秒**（42.8 → 41.6 秒） | 行级差异在总量上抵消的情况（总伤不变、行分布变了）；**外加 13 个 `*/axis` 预设的轴态覆盖**（原表只记了「行分布」，漏记这一项） | **否决**（见 §9.3） |
| ④ 纯改名 / 纯搬迁卡跳过零差 | 约 50 秒 | 「看起来是纯搬运」实际带出行为变化（例如搬迁时丢了副作用顺序）；判断「纯搬运」本身就没有机器依据 | **否决**（零机器判据；AST 判据立项成本见 §9.4） |

### 6.1 ① 的实测反例（三组，隔离 worktree @ `0b81c1df`，vitest 4.1.10）

| 改动 | `vitest list --changed HEAD` 选中 | 实际后果 |
|---|---|---|
| `docs/**` 加一行 | **0 个文件** | 同一改动**实测会红**：`checkGuards.test.ts` 报 `expected 728 to be less than or equal to 727`（§4 行数棘轮） |
| `public/static/catalog.json` | **0 个文件** | 仓库有 **52** 个测试文件读该数据（`grep -rl "catalog.json\|static/catalog" src --include=*.test.ts` = 52；经 `mockStaticFetch` 读的 = 64） |
| `useResourceCalc.ts` + `core/resource/helpers.ts` | **222 个文件 / 204.9 秒** | 同机同时段全量 = **242.7 秒** ⇒ 只省 37.8 秒；且**漏掉 27 个**引用 `useResourceCalc` 的测试文件（严格 import 闭包算出 254 个，`--changed` 少选 32 个） |

⇒ 三组都指向同一结论：本仓库的测试经 `setupHarness` 走全管线、不 import 被测源码，`--changed` 的 import 图**不成立**。
「造显式依赖清单」的成本已量：严格闭包口径下需维护 254 条映射（含 13 条 grep 面都看不见的传递依赖），
换来的是比全量只省 37.8 秒 —— **维护成本 > 收益**，判**不做**（提示词 §3 任务 A 末段授权此结论）。

### 6.2 ② 的护栏与快路（已落地）

- **清单**：`scripts/lib/docs-reading-tests.mjs` 的 `DOCS_READING_TESTS`（**31 条**，T114 实测派生）；
- **棘轮**：`src/scripts/__tests__/checkGuards.test.ts`（① 清单逐字等于派生集；② 条目必须真实存在；
  ③ 读 docs 且被测试覆盖的源文件必须在某条清单条目的闭包内；④ 反空洞下限：扫描面 ≥ 800、清单 ≥ 28）；
- **判定器**：`isDocsOnlyChange()`（`git diff --name-only HEAD` 全部落在 `docs/` 前缀内才为真；
  空输入判假 —— 防「没改动」被当绿灯）；
- **快路**：`npm run test:docs`（= `node scripts/test-docs.mjs`；非 docs-only 时**拒绝并退出 2**，
  要人工确认才 `--force`）；
- **红线**：`check` / `verify` 不得引用它（棘轮断言，与 `test:fast` 同规矩）。

⚠ **口径是「宁多勿漏」，不是「人工精选真读者」**：集合 = ①「import 闭包命中 docs 信号」
∪ ②「测试**自身**起子进程 / 写 `scripts/**.mjs` 路径字面量」∪ ③「测试**自身**跑仓库级扫描（`git ls-files`/`grep -r`）」。
②③ 是必要的——`child_process` 的目标与仓库级扫描对静态 import 图**不可见**，而这些测试读的正是 docs / 仓库现状。
⚠ **踩过的坑（如实记录）**：初版把 ② 写成「闭包触及 `scripts/**`」，实测把 `difficultyCurveWorker.test.ts`
只因传递 import 了纯数据模块 `presetCategories.mjs`（零 docs 引用）就捞了进来，且集合会随 `scripts/lib/`
新增数据模块**无界增长**（并行会话加一个测试文件即红）。收窄为「只认测试自身」后 35 → **31 条**，
① 仍覆盖全部直接读 docs 的测试，实测仍抓住 §4 行数红（见 §9.2）。

### 6.3 ③ 的实测数字（为什么省 ~0 秒）

`zd.sh` 四路并行（`.zc/perf/zd.sh:36`：`dump base & rowsnap base & dump after & rowsnap after &`），
WALL ≈ 最慢那一路。用已归档的 r762 四份产物读**每路自身耗时**（`__ms`）：

| 路 | 键数 | 自身耗时 |
|---|---|---|
| `dump`（base / after） | 520 | 41.6 s |
| `rowsnap`（base / after） | 533 | 42.8 s |

⇒ 砍掉 rowsnap 后 WALL = `max(2 个 dump)` = **41.6 s**，现在 = `max(4 路)` = **42.8 s** ⇒ **省 1.2 秒（2.8%）**。
代价有两项，原表只记了第一项：
1. `rowsnap.perf.ts:75` 比 `dump.perf.ts:78` 多哈希一项 `h(calc.damagePoolRows.value)`（行分布）；
2. **`rowsnap.perf.ts:92-98` 另有 dump 完全没有的失衡轴变体**——对 `1171/1261/1401/1581` 预设追加 `snap('${p.id}/axis')`，
   实测 **13 个** `*/axis` 键只存在于 rowsnap（r762 产物：dump 520 键 / rowsnap 533 键，差集 13 条全是 `auto-…/axis`）。
⇒ 1.2 秒换掉 13 个预设的轴态覆盖，**否决**。

### 6.4 ④ 的立项成本（若日后要走 AST 判据）

零机器判据属实：`git grep pureMove` **零命中**（唯一命中是本行所在的 REQUIREMENTS 自述）；
「纯搬迁」仅 3 处散文（`AGENTS.md` 无关，实际在 `docs/mcp-debt2-blade1-feasibility-v4.md` 等）。
且已有实测反例（`docs/ENGINE_PIPELINE_GUIDE.md` §4 判据①bis）：「让 materialize 直接产出行」**实测不是纯搬运**——
池提取把赠行与 `adjustStunExecs` 双计失衡、enrich 凭空补上生产侧刻意留空的字段（琉音赠行 daze 398.9 /
诺姆 skillDamageTarget）、目标槽推导 core 用 `configs.length` vs 编排层用队长。
最小 AST 判据 = 「导出符号集合 + 调用图不变」，仓库已有 `typescript`（`~5.7.3`）与先例
（`scripts/lib/dead-channel-ls.mjs` 用 `ts.createLanguageService`）。**成本估算**：语言服务全仓 program 建一次
约 20–30 秒（同文件内 `⑦`+`⑫` 合计约 43 秒量级），加符号集合 diff 与调用图比较 ≈ 1 个工人日；
而它只覆盖「纯搬迁」这一种卡（历史上不常见）。⇒ **判「待立项」，不排期**。


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
| ~~`charIncrementInt`：两个用例各跑一遍同一个全量 `computeIncrementPass`~~ **✅ 已做 2026-10-09** | 实测 tests 32.0s → 15.7s（本机单跑；用例 2 从 ~15s 降到 3ms） | 已按本行改法落地：`fullPassOnce()` memo（**不是 `beforeAll`**——本次求值 ~15s 而 vitest `hookTimeout` 默认 10s，本仓只配了 `testTimeout`；memo 走 `testTimeout` 且与用例顺序无关，`-t` 单跑用例 2 已验证）。负载本体与 r369 隔离断言不变，负控复验仍红（1.847× > 1.0×） |
| `axisFallbackReportCc457`：每个预设等 `setTimeout(40)`，3 档 × 104 个 = 312 次，约 12.5 秒纯等待（占着一个 worker） | 约 3 秒墙钟 | 先证明 `resourceResult` 能同步读（`timeLedgerInvariants` 同类读法不等待），再改成不等待或 `nextTick` |
| `zcDeadChannels`「真实 CLI」用例：起两次 CLI，各扫一遍全仓；连同 `deadChannelLs` ⑦，同一个全仓扫描每次跑 3 遍 | 约 7 秒 CPU | 文件头已写明「扫描口径由 deadChannelLs 守护，这里只验入口」⇒ 只起一次 `--json`，文本一致性用进程内的 `formatDeadChannelReport` 验 |
| setupFiles 让每个文件都导入全部机制模块（setup 占 15%） | 只能省掉不需要引擎的那些文件，估计不超过 30 秒 CPU | 要按需注册就得改 `mechanics/index.ts` 的副作用注册架构；收益不够，不做 |

4. **§5 标题里的「已立卡 CC-97」是过期指针**：CC-97 这个编号后来用在了「校准原子测量清单 v1」（`docs/mcp-calibration-atoms.md`），测试 CPU 优化从来没有立过卡。§5 点名的 `deadChannelLs`：r696 实测文件内 46 秒里，35.7 秒在 ⑫（src/core 死导出，逐个导出跑 `findReferences`），7.3 秒在 ⑦，夹具用例都不到 0.5 秒。所以大头是 ⑫ 本身的符号级查询；「共享 program」能省多少，要先核 ⑦ 与 ⑫ 是否各建了一次 program（本轮未核）。

### 8.4 什么时候再做（触发条件）

- 任一片在**干净**机器上的墙钟超过 220 秒（离单次调用上限 285 秒不到 65 秒），或全量 CPU 超过 1400 秒：按 §8.3 的表从上往下做，并按 §8.1 的测法重排名次。
- 有人要新写「全预设 / 全角色」扫描：先看 §8.3 第 2 条那 4 份能不能复用，再决定要不要另起一份。
- 除此之外，只在改到这些文件时顺手做。

## 9. T114 逐条判定的实测记录（2026-10-09，可复现）

> 环境：隔离 worktree（`git worktree add --detach /tmp/t114-wt 0b81c1df`，软链 `node_modules`），
> 16 核，vitest 4.1.10，worker 上限 4。**全量基线同机同时段实测 = 535 文件 / 4547 tests / 242.7 秒**
> （跨轮波动 96–148 秒是历史口径，本轮 4 工人并行下的读数为 242.7 秒，故下表一律用**同批次对照**，
> 不跨时段比较绝对值）。

### 9.1 ① `--changed`：三组实测（命令与读数）

```bash
# 组 1：docs-only
printf '\n<!-- probe -->\n' >> docs/mcp-dev-process-speed.md
npx vitest list --changed HEAD | sed 's/ > .*//' | sort -u | wc -l     # → 0
# 同改动的真实后果（快路清单里就抓住）：
npx vitest run src/scripts/__tests__/checkGuards.test.ts               # → 1 failed：expected 728 to be less than or equal to 727

# 组 2：数据文件
printf '\n' >> public/static/catalog.json
npx vitest list --changed HEAD | sed 's/ > .*//' | sort -u | wc -l     # → 0

# 组 3：两个核心源文件（各加一行注释）
npx vitest run --changed HEAD    # → 222 文件 / 2198 passed / 204.91 s（对照：全量 242.66 s）
```

严格 import 闭包（自建脚本，反向依赖图传递闭包）与 `--changed` 的对账：
`--changed` 选中 **222** ⊂ 闭包 **254**（仅 `--changed` 有的 = 0，闭包有而它漏的 = **32**）；
grep 面（`useResourceCalc` 字面引用）**242**，其中 `--changed` 漏 **27**、闭包漏 **13**
（那 13 条是经别处间接依赖的：`slotSweep` / `luciaElowen` / `configMemory` 等）。

### 9.2 ② docs-only 快路：负控与收益（同一改动，两组对照）

| 组 | 命令 | 文件 / 用例 | 墙钟 | 失败文件 |
|---|---|---|---|---|
| 全量 | `npx vitest run` | 535 / 4547 | **248.2 s** | 1（`checkGuards.test.ts`） |
| 快路 | `npm run test:docs`（31 条清单） | 31 / 551 | **≈40 s** | **1（同一条）** |

⇒ **失败集逐条相同**（`diff` 两侧 `FAIL` 行 = 空），**省 208.9 秒（84.2%）**。
撤销该 docs 改动后快路恢复 `EXIT=0`（32 passed / 2 skipped）。
判定器负控：混入一个 `.ts` 改动 ⇒ `isDocsOnlyChange` = **false**（`git diff --name-only` 见 `src/composables/useResourceCalc.ts`）。

**为什么 `check-guards` 单独跑不够**（选项②原文的"只跑 check-guards"）：同一 docs 改动下
`node scripts/check-guards.mjs` = **EXIT 0 / 29 项全绿 / 17.4 秒**，而 vitest 里那条 **红**。
根因：当时 §4 行数 burn-down 判据**只在 `checkGuards.test.ts` 里断言**（`runAllChecks` 不含它，
`zc status` 只报不红）⇒ 这就是「只跑 check-guards」会漏的那类错误。
**2026-10-30 后续（两处已堵）**：① 那条断言按审计 P1/B-2 换成**判据 34**（§4 条目预算）——判定与读数都在
`runAllChecks` 里，`node scripts/check-guards.mjs` 直接能红；② 手册类判据的自测仍在 `checkGuards.test.ts`（core 环排除）
⇒ `test-ring.mjs` 的 `RING_ADVICE` 补了「四份方法文档 → fast」规则：改手册必须跑到那条自测。

### 9.3 ③ dump/rowsnap 差异（用已归档产物读，不重复跑）

`.zc/perf/zd.sh:36` 四路并行；WALL ≈ 最慢一路。r762 归档产物（`/home/kaua/calc-arch/zd-r762-*.json`）读 `__ms`：
dump 41.6 s / 520 键，rowsnap 42.8 s / 533 键；差集 **13** 条全是 `auto-…/axis`（失衡轴变体）。
⇒ 砍 rowsnap 省 `42.8 − 41.6 = 1.2 秒`，丢 13 个预设的轴态覆盖。

### 9.4 与提示词 §2 的事实核对（发现的偏差，如实记录）

| 提示词原文 | 实测 | 处置 |
|---|---|---|
| `package.json:31` 是 verify 那行 | verify 在 **`:31`**（`check` 在 `:29`、`test:fast` 在 `:13`） | 无偏差 |
| `checkGuards.test.ts:710-712` 记 `--changed` 教训 | 逐字命中（`:710-712`） | 无偏差 |
| `docs/mcp-dev-process-speed.md:81` 第 115 轮反例 | 逐字命中 | 无偏差 |
| `docs/mcp-worker-task-queue.md:72` | 该行是「长期规则」段，**r709 那条在 `:64`** | 记偏差（不影响结论） |
| `docs/REQUIREMENTS.md:125` 登记处 | 逐字命中（`:125` 起） | 无偏差 |
| `grep -rl "docs/" src --include=*.test.ts` = **53** | 实测 **54**（`docs/` 含注释；去注释后真读者 **8**，加闭包 = **12**） | 记偏差；口径纠正为「去注释 + 闭包」 |
| `dump.perf.ts:78` / `rowsnap.perf.ts:75` / `rowsnap.perf.ts:92-98` | 逐字命中 | 无偏差 |
| `.zc/perf/zd.sh:36-40` | 逐字命中（`run` 在 `:36`、`wait` `:37`、`WALL` `:38`、`DUMP` `:39`、`ROWS` `:40`） | 无偏差 |
| `scripts/check-guards.mjs:108-109` FETCH_STUB_ALLOWLIST 已清空 | 逐字命中（`[]`） | 无偏差 |
| `check-guards.mjs` 里 `changed`/`related` 计数为 0 | 命中（`grep -c` = 0） | 无偏差 |
| `ENGINE_PIPELINE_GUIDE.md` §4 上限 **717→719** | 现为 **727**（2026-10-09 由并行会话结算上调） | 记偏差；本轮未改 §4（`countGuideSection4Lines()` 前后均 = 727） |
| `pureMove` 全仓零命中 | 命中（唯一命中是 REQUIREMENTS 自述） | 无偏差 |

⚠ **对提示词 §2.1 的一处口径提醒**：`docs:status` 不在 verify 链里（提示词已记），但**它也不在本轮快路里**——
`test:docs` 只替代那一次全量 vitest；文档批次仍须跑 `check-guards` + `npx vue-tsc -b`（若动了源码）+ `docs:status`。

### 9.5 命座采样面 `{0,6}` → `{0,1,2,6}`（2026-10-10 T119 任务 B，实测）

**病灶**（T118 报告 §⑥ 发现）：`dump.perf.ts` / `rowsnap.perf.ts` 只采样槽 0 的 `{c0, c6}`，
而 `timeGolden.test.ts` 采样 `{0,3,4,5,6}` ⇒ **cinema 1 与 cinema 2 在三个标准仪器里都没有采样点**。
后果：任何只在影画1/2 生效的逻辑，改动后在 `zd.sh` 上显示 `DIFF 0`。

**反证实测**（同一份源码，只换仪器；注入 = `yeshuguang.ts` 的 `cfg.yeshuguangSwordInitial = cinema >= 1 ? 6 : 0`
改成 `cinema >= 3`——该自指反馈只在影画1 解锁，故 delta 严格局限于 c1/c2）：

| 仪器 | 采样面 | `dump` | `rowsnap` | WALL |
|---|---|---|---|---|
| 旧 | `{0,6}` | **`DIFF 0`**（盲区！） | **`DIFF 0`** | 55.4 s |
| 新 | `{0,1,2,6}` | **`DIFF 16`** | **`DIFF 16`** | 73.2 s |

`DIFF` 的 16 个键**逐个核对全部落在 `c1`（8 个）/ `c2`（8 个）**，`c0`/`c6`/`default`/`w`/`heavy` 一个不差 ⇒
新采样面抓到的正是旧采样面漏掉的那一段，且**没有引入任何额外漂移**。

**干净树自检**（同 `9eb11196` 两个 worktree，源码逐字相同）：`DUMP DIFF 0` / `ROWS DIFF 0`，
键数 dump 680 / rowsnap 695（原 520 / 533；每预设 +2 键 ⇒ 97 预设 + 13 轴变体 → 680/695）。

**墙钟代价**（实测，三组）：

| 场景 | 旧采样面 | 新采样面 | 增幅 |
|---|---|---|---|
| 干净树自检 | 47.5 s | 65.4 s | **+37.7%** |
| 反证（改动树） | 55.4 s | 73.2 s | **+32.1%** |
| 另一组改动树 | 48.9 s | 68.3 s | **+39.7%** |

⇒ 与立项预估的「+40%~50%」一致（实测略低）。这是**测量面扩大**的必然代价，不是「放宽判据」。

## 10. worker 上限 4 → 自适应 8（2026-10-12；CC-424 的止血值转成实测最优值）

> 用户诉求：「run full test suite 太耗时间了」。§1 结论（验证是每卡最大单项）仍然成立，
> 所以这里只动**同一套断言跑多快**，不动测什么。

**改动**：`vite.config.ts#workerCap`——`min(availableParallelism(), 内存预算能容纳的 fork 数, 8)`，
内存预算 = 总内存 × 0.6，峰值模型 ≈ `540MB + 573MB × workers`（下表拟合）。
优先级 `--maxWorkers=N` > `VITEST_MAX_WORKERS=N` > `workerCap()`。

**实测**（干净 worktree `02c0d486`，`npx vitest run --maxWorkers=N`，每档 `EXIT=0`；
5 档 passed/failed/skipped **逐位相同 = 4700 / 0 / 26** ⇒ 纯提速、零强度损失）：

| workers | 墙钟（多次） | 峰值 RSS | 判读 |
|---|---|---|---|
| 4（旧固定值） | 308 s | 2832 MB | 把 16 核用成 4 核 |
| 6 | 247 s | 4286 MB | |
| **8（新默认）** | 220 / 195 / 216 s | 4818 MB | 拿到几乎全部收益，内存余量最大 |
| 10 | 180 / 178 / **248** s | 5878 MB | 中位数略快，但方差大（248 s 那次已在换页） |
| 12 | **258 s** | 7415 MB | **反而更慢**：9.7 GB 物理内存被占满 ⇒ swap |

**拐点归因**：再往上不是被 CPU 限制——10 档实测平均并发只有 **7.56**（8 档 6.18），机器没喂饱；
是被**内存**限制。所以新默认停在 8，并按总内存 60% 设预算（留 40% 给 OS 与并行会话，
本机常态另有 dsh web ~1 GB、vite dev、mysqld；12 档 7415 MB + 其它 ≈ 物理上限，这正是它变慢的原因）。

**CI 行为不变**：用 `availableParallelism()`（尊重 cgroup / taskset 亲和性）而非 `cpus().length`，
`taskset -c 0-3` 实测该值 = 4 ⇒ GitHub Actions 4 核 runner 上 cap = 4，与改动前逐位一致。

**这一条为什么不算「降级验证强度」**：断言集合、测试文件数、passed 数全部未变（4700/0/26 五档一致），
改的只是并发调度。§6 那张「会削弱保证的选项」表里的四条（`--changed` / docs-only / 砍 rowsnap / 纯搬迁卡）
一条都没动。


## 11. 2026-11-04 复测：环的**判据**已经和实测脱离（量出来的三个死结）

> 触发：用户「测试时间较长，开发流程不顺畅」。本节是**读数**（可复现），排期与判据改法见 §12。

### 11.1 复测方法（不新建仪器）

- 逐文件耗时：`.zc/full-ring.log`（2026-11-01 18:42 全量，649 文件 / 6345s CPU）。
- 今日环的实际构成：`/tmp/check4.log`（2026-11-04 00:23 的 `npm run check`，
  `Duration 648.87s`，2 红）。两者交叉核对过：**612 个文件的耗时对得上**。
- 单次引擎求值：探针（`zzEvalCost.probe.test.ts`，跑完即删）= 首算 440ms、稳态 **202ms/次**。

### 11.2 死结 A：core 环 99.4% 的墙钟 = 一个文件

| 量 | 实测 |
|---|---|
| core 环（`npm run check`）今日墙钟 | **648.87s** |
| 其中 `interactionSurface.test.ts` | **645.2s** |
| 该文件在 `.zc/full-ring.log` 里的耗时 | **1139s**（全量并发下更慢） |
| 它为什么这么贵 | 5 条 `it` 各调一次 `runInteractionSurface`，每次 176 格 × 202ms ≈ **113s** |

⇒ 「五条判据读的是同一张面」——参数逐字相同（`maxCount 40 / countStep 4 / ratioSteps 4`，
同一队同一 Boss），却扫了 5 遍。

**已修**（`53fb6cf7`）：`beforeAll` 扫一次、五条判据共享同一份结果。判据一字未改。
实测该文件 **568s → 93.9s**（单跑，空载 16 核）。

### 11.3 死结 B：`CORE_EXCLUDES` 的判据（≥20s）自 2026-10-18 定下后没再量过

`test-ring.mjs` 写着「单文件 ≥ `CORE_MAX_SECONDS`(20s) ⇒ 出 core」，但清单是**手写死的**。
今日实测：**core 里仍有 12 个 ≥20s 的文件**（合计 1623s CPU），其中最贵的六个都不是新加的：

| 文件 | 实测 | 什么时候进的 core |
|---|---|---|
| `interactionSurface.test.ts` | 1139s（今 93.9s） | 2026-10-19 加入，**从未进过排除集** |
| `interactionSurfaceWorker.test.ts` | 75s | 同上 |
| `allAgentsGuards.test.ts` | 72s | 早于 T186 |
| `substatCritOverflow.test.ts` | 63s | 2026-10-18 加入（与 T186 同一天） |
| `basicPoolLeftoverFill.test.ts` | 45s | 2026-10-22 |
| `curvePointPool.test.ts` | 39s | 2026-10-16 |

反向的腐坏也有：三条排除项如今已 **<20s**（`cinemaUplift` 34→14s、`claretGashTiming` 24→10s、
`interactionSweep` 23→14s）——**没人下调就一直是排除的**。

⇒ 问题不在「阈值定错」，在**阈值没有执行机构**：`CORE_MAX_SECONDS` 是一个**导出常量**，
全仓引用它做判断的代码 = **0 处**（`grep -rn 'CORE_MAX_SECONDS'` 只命中定义与一条「≥」断言）。

### 11.4 死结 C：一条 `npx vitest run` 打满是 8 核，而队里有 46 个「>3 分钟」的文件

全量 649 文件的耗时分布（`.zc/full-ring.log`）：

| 阈值 | 文件数 | CPU 占比 |
|---|---|---|
| ≥60s | 18 | **72.1%** |
| ≥30s | 40 | 85.8% |
| ≥20s | 46 | 88.1% |
| ≥5s | 84 | 93.5% |

**墙钟下限由最长的那个文件决定**（vitest 只做文件级并行）：即使 CPU 完全均分，
1139s 的文件也把全量墙钟钉在 1139s 以上。这不是「再并行一点」能解决的。

### 11.5 复核触发器

⟳复核: 本节三条读数（core 墙钟 / core 内 ≥20s 文件数 / 首五名文件的实测秒数）任何一条变化超过 20% 时重测 | 到期 2027-02-04

## 12. 2026-11-04：开发流程的帕累托最优（按「每小时省下的墙钟 / 改动行数」排序）

> 前提事实（§11 已量）：一条 `npm run check` = **648.87s**，其中 **645.2s 是一个文件**；
> 全量 = **665s 理想 / 实测 946~1143s**，其中 18 个文件占 72% CPU。**先把「一个文件吃掉整环」
> 修掉，再谈环的划分**——这是帕累托序，不是风格选择。

### 12.1 三档分层（判据随实测走，不是手写死清单）

今天的实测值（16 核 / 9.4GB，vitest 8 workers）：

| 档 | 范围 | 文件 | CPU | 理想墙钟 | 实测 |
|---|---|---|---|---|---|
| **L1 每对话** | <20s ∪ 不变量 | 604 | 783s | 98s | **136.3s**（§12.2 已实测） |
| **L2 合并前** | <60s ∪ 不变量 | 631 | 1773s | 222s | 待测（估 250~300s） |
| **L3 全量 / CI** | 全部 | 649 | 5324s | 665s | 946~1143s |

**当前 core 环 = 612 文件 / 2328s CPU / 实测 648.87s**——它卡在 L1 与 L2 之间：
比 L1 贵 4.8 倍，却仍有 12 个 ≥20s 的文件（§11.3）。**这就是「开发流程不顺」的算术原因。**

判据（三条同时成立才留在 L1）：① 覆盖**维度**而非功能点（全角色 × 命座、全预设 × 时间账）；
② 它红了说明别处也错了；③ 实测 <20s。**「全角色 / 全预设扫描」即使 >20s 也留 L1**——
它们是录入与口径改动的总网，砍掉就等于把「改了角色没人发现」变成常态。
§12.2 实测这一批（allAgentsGuards + timeGolden + 时间账三条 + allAgentsSweep + hookReplay + lateCfgWrite）
= **339 用例 / 36.7s**，可以整批放进 L1。

### 12.2 落地顺序（每步都带实测收益与验收命令）

| # | 做什么 | 实测收益 | 验收 |
|---|---|---|---|
| **P0** | `interactionSurface.test.ts` 五条判据共扫一次（**已做并复测，`53fb6cf7`**） | 该文件 单跑 **568 → 93.9s**、套件内 **645.2 → 169.6s**；**core 环 648.87 → 172.72s（3.76×）** | `npx vitest run src/composables/__tests__/interactionSurface.test.ts`（5/5，<120s） |
| **P1** | ✅ **已做（`f3ff23ce`）**：`CORE_EXCLUDES` 改由 `scripts/lib/test-durations.json`（671 文件实测秒数）**派生**——≥`CORE_MAX_SECONDS` 且非不变量 ⇒ 自动出 core；`CORE_INVARIANTS` 1→5（补 allAgentsGuards / timeGolden / timeFillRatchet / timeLedgerInvariants）；新增 `measured` 子命令与三条派生判据（⑩⑪⑫，负控实测会红） | core **180.4s vitest / 169.3s WALL**（含 5 条不变量，覆盖比改前更强）；环内新增 timeGolden + 时间账三条 | `node scripts/test-ring.mjs measured`（core 635 / fast 657 / full 671 文件） |
| **P2** | ✅ **已做（`0129c554`）**：死通道扫描 A/B 段加「子串预筛」（577 声明 × 1114 文件 × 4 路 regex = 128 万次 → 一次 `includes` 短路）。另测：`--no-isolate` 已否决；`zc status` 的 603 次 git 子进程仍未改（见 §12.4） | 死通道 **19.3s → 2.8s**；护栏链 **28.9s → 15.7s**（A/B 输出逐字节相同） | `node scripts/check-guards.mjs`，34/34 且 <20s |
| **P3** | 把 L1 拆成 `check`（纯 vitest）+ `guards`（护栏链）两条并行链；本地一条命令并行起两个进程 | 每轮再省一个 `check-guards` 的墙钟 | `npm run check` 墙钟；两条链 exit 0 |
| **P4** | L2 = 20~60s 那 28 个文件（1021s CPU / 138s 理想）：只在 `git status` 命中危险面时跑，复用 `test-ring advise` 的路径规则 | 合并前 665s → ~250s | `node scripts/test-ring.mjs fast` |
| **P5** | 长尾并行化（见 12.3）：`difficultyCurve` 515s、四个 burnShard 1440s、`truncationCountDeduction` 325s | 全量 **665 → ~480s**（估） | 全量 passed 数不变 |

**P0-P2 是帕累托**：core 环 **648.87s → 169.3s（3.8 倍）**，判据一条没少，环内反而多了 4 条跨切面不变量
（allAgentsGuards / timeGolden / timeFillRatchet / timeLedgerInvariants 此前都在环外）。
改动面 = 1 个测试文件（共扫）+ 1 份实测数据与 1 个生成器（环清单）+ 1 个扫描器的 9 行预筛。

**★ 本轮最重要的方法结论（可以当公式用）**：环的墙钟 ≈ **max(最长文件, CPU 总和 / workers)**。

| 现场 | wall | 最长文件 | CPU/8 | 谁在卡 |
|---|---|---|---|---|
| core（改前，含 surface） | 189s | **141s** | 178s | 两者接近 |
| core（去掉 surface） | 171s | 71s | 161s | **纯 CPU** |
| core（P1 后） | 169s | 54s | ~97s | **纯 CPU**（最长文件不再是瓶颈） |
| full（改前） | 1143s | **1139s** | 905s | **纯长尾**：单文件钉死 |

⚠ **这张表里 core 三行要按「全 CPU」重算**（见 §12.6 的更正）：环的总 CPU 是
`transform + setup + import + tests` 四项之和，我最初只累计了 `tests`，于是把「97s 下界」算低了。
按全 CPU 重算：core 的 `CPU/8` = **153~171s**，实测墙钟 164~183s ⇒ **worker 利用率 92~93%**，
**没有 68s 的调度浪费**（§12.6 有 A/B 实测）。「最长文件钉死 full」那条不受影响。

⇒ 判断先后：先算 `CPU / workers`，再看最长文件，取大者。存在一个比 `CPU/workers` 更长的文件时，
**其它一切优化收益为 0**；反过来 CPU-bound 时，摘掉一批文件只买到「它们那部分 CPU / workers」。
**先找最长文件，再谈清单**——顺序反了就白改。
**P2~P5 是第二阶**：收益递减，且 P5 要动测试结构（分片/共享扫描器），必须逐条 A/B。

### 12.3 长尾的正确修法（不是「加并行」）

vitest 只按**文件**并行，墙钟 = 最长文件。所以对 ≥60s 的 18 个文件只有两条路：

1. **同一个文件里的 N 次扫描 → 1 次**（P0 已验证：1139→94s，**12 倍**）。普查口径：
   同一份 (队, Boss, 参数) 被多条 `it` 各跑一遍的就是候选。
2. **一个文件 → N 个文件**（`ladderBurnShard.ts` 已验证：592s 的单条用例拆成 4 片后 102~146s）。
   只对「N 条 `it` 各扫全库」的形态有效，且必须配覆盖完全性的静态断言
   （`difficultyLadderBurnCoverage.test.ts` 是范本）。

**明确否决**（2026-11-04 复测）：
- `--no-isolate` / `pool: 'threads'`：实测 **617/625 文件直接失败**（`setupHarness` 依赖每文件独立的
  pinia + 模块级 `calcOutputMemo`），不是提速是破坏。EXIT 1，16.77s 就全红。
- 加 worker 上限：已是 8（`workerCap`，内存预算 60%）；12 档实测**更慢**（换页）。
- 只提高 `testTimeout` 或 `--bail`：不改变墙钟。
- 只跑 `vitest --changed`：§6.1 三组反例已否决（数据文件/doc 改动选中 0 个文件）。

### 12.4 流程面（不是测试面）的两个帕累托项

| 项 | 现状实测 | 改法 | 收益 |
|---|---|---|---|
| **`zc status` 18.4s** | 603 次 git 子进程（`driftQueue` 对每条 fact 调一次 `git show`） | 一次 `git log --name-only` + 进程内缓存 | 开局体检 18s → <3s |
| **`vue-tsc -b` 已增量** | 空跑 1.6s / 改一文件 ~3s（AGENTS §1 的 17.3s 是历史的非增量值） | 无需改 | — |

### 12.5 复核触发器

### 12.6 更正：我一开始把「调度浪费」算大了（按全 CPU 重算 + A/B 实测）

§12.2 那张表里 core 的三行，最初用 `Duration` 里 **只** `tests` 那项当 CPU（97s 下界），
得出「默认序白扔 68s / 41%」的结论，并据此加了 LPT sequencer。**这个结论是错的**：
环的总 CPU 是 `transform + setup + import + tests` 四项之和（每个文件都要付 setup 与 import）。

按全 CPU 重算，并做了一次**同机 A/B**（`VITEST_SEQUENCER=off` 关闭排序，其余完全相同，空载 8 workers）：

| 对照组 | wall | 全 CPU | CPU/8 | 利用率 |
|---|---|---|---|---|
| 默认序（关排序） | 176.8s | 1295s | 162s | **92%** |
| LPT 排序（开） | 174.4s | 1301s | 163s | **93%** |
| 另两次参考（默认序） | 164.4 / 176.8s | 1224 / 1295s | 153 / 162s | 93 / 92% |

⇒ **真实收益约 2.4s（1.4%），落在轮次波动内**；worker 本来就被喂饱了（92~93%），
不存在「长尾大量空转」。LPT 保留（排序是零成本的正确做法，且让长尾在**中断时**更早暴露），
但**不要把它当成提速项**，也不要再引用「68s」这个数字。

**这条记录本身是规则 16③ 的例子**：错误结论 + 实测反证一起留下，比只留结论有用。
教训 = **算 CPU 要把 Duration 括号里的四项全加**；只看 `tests` 会高估并行浪费。

### 12.7 收口读数（2026-11-04，全部同机、HEAD 可查）

| 现场 | HEAD | load | vitest wall | 全 CPU | 通过 |
|---|---|---|---|---|---|
| 改前（core，含 surface 5 次扫描） | 5de83444 | ~10 | **648.87s**（WALL）/ 189.16s（另一次） | 1420s | 5216 / 2 红 |
| P0 后 | 9217001b | ~2 | 172.72s | 1224s | 5216 / 0 红 |
| P1 后（派生清单 + 5 不变量） | 0129c554 | ~1 | **164.38s** | 1224s | 5243 / 0 红 |
| P2 后（护栏 −13s） | 0129c554 | ~1 | 164.38s（vitest 不变；WALL 204→169s） | — | — |
| LPT 排序（A/B on/off） | a1e41cb2 | ~3 | 174.4 / 176.8s | 1301 / 1295s | 5249 / 0 红 |
| 最终验收 | a1e41cb2 | 9~12（并行会话） | 201.07s | 1366s | 5249 / 0 红 |

**读法**：646→165s 的主因是 P0（一个文件扫 5 遍 → 1 遍）+ P1（清单派生 ⇒ 128s 的 surface 第一次真的出 core）。
P2 省在 **WALL**（护栏链 28.9→15.7s），不在 vitest 里。LPT 是 1.4%（见 §12.6）。
最后一行的 201s 是**并行会话抢 CPU**（load 9~12）时的读数，不是回归——同一 HEAD 上 164s 与 201s 的差
全部落在 `transform/setup/import` 三项（41/410/139 vs 33/314/103），与测试内容无关。

⟳复核: core 环墙钟、L1 实测值、`CORE_EXCLUDES` 生成器的输出三者任一变化 >20% 时重测 | 到期 2027-02-04
