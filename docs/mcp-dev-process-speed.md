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
根因：§4 行数 burn-down 判据**只在 `checkGuards.test.ts` 里断言**（`scripts/check-guards.mjs` 只导出
`countGuideSection4Lines`，`runAllChecks` 不含它，`zc status` 只报不红）⇒ 这就是「只跑 check-guards」会漏的那类错误。

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

