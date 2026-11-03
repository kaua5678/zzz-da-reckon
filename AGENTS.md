# AGENTS.md

> 本仓库：ZZZ 伤害计算器（Vue 3 + TypeScript + Vite + Naive UI + Pinia + Vitest）。
> **任何改动前必读本文件**；"这代码怎么跑 / 该改哪"先跑 `node scripts/zc.mjs brief "<任务一句话>"` 或查 `docs/ARCHITECTURE.md` §3 决策树，定位到文件再进去读代码。

## 0. 任务分级：先认档，再按档读文档

| 档 | 适用 | 必读 | 可跳过 |
|---|---|---|---|
| `fast` | 改 UI / 文案 / 单条测试 / 单文件小修 | 本文件 §1 + 目标文件头注释；**改 UI/样式 → `docs/UI_THEME_GUIDE.md` 必读**（令牌与双主题口径不在代码里） | 其余 docs |
| `full` | 录角色 / 补机制 / 改引擎 / 排查 buff 没生效 | 本文件 §1 + `docs/ARCHITECTURE.md` §3 + 对应管线文档 | `docs/mechanism-reference.md` 纯参考 |
| `loop` | 跨多文件重构 / 批量迁移 / 数据管道改动 | `full` 全部 + §4 长任务账本 | — |

`full` / `loop` 的读法：**步骤必读、参考按症状查**（某角色某坑换到新角色往往无法类比）。

| 何时 | 读哪个 |
|---|---|
| 开工前（必读） | 本文件 §1 + 下方录入步骤 + `AGENT_RECORDING_SOP.md` §6.10 完成清单 |
| 拿到任务先查「改哪」 | `ARCHITECTURE.md` §3 决策树，只读命中那一行 |
| 实现中卡住 / 数值不对 / 报错 | `ENGINE_PIPELINE_GUIDE.md` §4 坑表，按症状查对应条 |
| 命座提升率异常 / 写测试 / 录拐力 | `AGENT_RECORDING_SOP.md` §3.5 根因表 / §5 模板 / §6 |
| 录新角色前做模式匹配 | `MECHANIC_PATTERNS.md` §2，只读命中的 1 个维度（D1–D9） |
| 中文术语→字段不确定 | `GAME_TERM_TO_CODE_FIELD.md` 对应章节 |
| **用户说「base 更新 vN 了，你录入一下」/ 取某角色最新数据与机制** | `DATA_FETCHING.md`「★ base（gachabase）= 录角色最常用的入口」——**base = gachabase 网站**（不是基线，也不是 beta），要的是**最新构建的数据与机制**（diff 页只是人类视觉友好的辅助）；改录前先 `scripts/snapshot-agent.mjs` 冻结旧版 |
| **碰时间/账本/物化行/超时判定/留白** | `ENGINE_PIPELINE_GUIDE.md` §4 开头**「时间系统三本账」表** + 坑 19 **「否决记录」** |
| **要断言「X 的专武/归属/属性是 Y」** | `ENTITY_CARDS.md` + 先跑 `node scripts/resolve.mjs` 查证（规则 15） |

### 录入角色 / 补机制：五步（仅此类任务）

1. **先建原文证据契约再实现**：`node scripts/record-agent.mjs init <id>`，按 `AGENT_RECORDING_SOP.md` §0.5 填契约；`check <id> plan` 通过才写机制函数。已有契约先检查来源漂移；只把「原文没数值 / 口径歧义 / 引擎缺通道」一次问用户。
2. **检索角色档案段**：`grep -n "角色名\|agentId" docs/MECHANICS_IMPLEMENTATION.md`，读该段已确认口径 + 未建模项。无状态行 = 段未核对，先核现状再补状态行。
3. **模式匹配**：`MECHANIC_PATTERNS.md` §2 定位 1 个维度（D1–D9），按该维度既有做法实现，不造新乘区。
4. **实现**：卡住/数值不对/报错才按症状查 `ENGINE_PIPELINE_GUIDE.md` §4、`AGENT_RECORDING_SOP.md` §3.5。
5. **交付**：`check <id> complete` → `AGENT_RECORDING_SOP.md` §6.10 → `npm run verify` + `docs:status`；同步档案段与状态表，补录完成后移除 `data/recordings/legacy.json` 对应豁免。

其他任务（改引擎/排查/UI）不需读原文/档案。未收录的新角色以 spec notes + raw 数据为准。

### 要不要开外部闭环：按表判，不许凭感觉

惰性启发式总会把活判成「简单、不用开环」——所以开环是**规则判断不是 vibe 判断**。**终验与验收放行留真人**：

| 触发条件 | 开什么 | 闭合方式 |
|---|---|---|
| `fast` 档 / 一条 `zc done --verifier` 就能交代 | **不开外部环**（`zc claim` → 改 → `npm run check` → `zc done`） | verifier 绿即闭 |
| `loop` 档，或跨多轮但完成判据说得清 | `create_goal` + §4 账本 | goal 判据达成 → `update_goal complete` |
| **排查数值/机制错误** | **预测先行**：动手前把「预测值 + 判据」写进账本 `Next`，再实测对账 | 实测与预测吻合才闭合；**discrepancy 即回炉，不许就地改预测** |
| 跨会话、需留痕的大项目 | 多工人派发（§5）+ 每步 `zc done` 落账 | **真人确认**后终验；agent 不得自行宣布验收 |

配套：harness 的 autoStart / writeGate 保持关闭；开了闭环不豁免验收链（`npm run verify` + `zc done` 仍是交付口径）。

## 1. 硬性规则

1. **基线先绿再动手**：改代码前跑 `npm run check`；改完跑 `npm run check` + `npm run build`。
   `npm run check` = **核心环**（**实测 172.7s** @2026-11-04；含 `vue-tsc -b` 增量类型检查），**不是全量**。
   要不要升环**看改动性质，不看日历**：动到计算路径/时间账/数值数据/角色模块/护栏脚本 ⇒ 先跑
   `node scripts/test-ring.mjs advise`，它给 `full` 才跑 `npm run check:full`；给 `core` 就是真的不用跑全量。
2. **数值唯一事实源 = `public/static/catalog.json`**：改数值走 `scripts/` 导入/爬取脚本重跑，不要手改 JSON 本体。
3. **执行行匹配一律用 `moveId`**，不按 name/note（`enrichExecutionPlan` 会从倍率表回填覆盖它们）。
4. **自定义 TS 模块角色**（`src/mechanics/agents/*.ts` 注册过）的 spec 字段是死数据：adjustable 滑块/attributeConversions 必须在模块里实现，spec 只作记录（`validate:specs` 强制：attributeConversions 必须可证明被消费——模块显式调用 `applySpecAttributeConversions` 或条目 note 标注「实现位置：」）。
5. **每个录入的机制 = spec 字段 + 生效测试**；命座效果录完跑一次「收益分析页·命座提升率」确认无橙色「⚠无变化」警示。自动化护栏：`allAgentsSweep` 断言「声明已实现命座的角色 C6 伤害 > C0 伤害」，逐级三态判据在 `composables/cinemaUplift.ts`（页面与测试同源）——页面自检仍要跑，它能定位到具体哪一级。
6. **跨角色/队伍级机制走 `applyTeamConfig` 钩子**（三阶段 build/converge/postRound，见 `docs/ENGINE_PIPELINE_GUIDE.md` §2），禁止往 `useResourceCalc` 新增**角色判定**分支（判据 2/3/6，新增即红）。
   - 度量口径 = AST 三形态（`agentId` / `.id` 四位数字 / `teammateBuffId`），**按行去重**；单源 `scripts/lib/agent-identity-lines.mjs`，分类报告 `node scripts/report-agent-identity.mjs --md`。
   - 面板阶段的覆盖率滑块直接读 `AgentPanelInput.settings`，不要经 panel 字段走私。
   - **当前存量 / 下一步 / 阻塞点 = `scripts/lib/guard-registries.mjs` 的 `RATCHET_BURNDOWN`（唯一事实源）**；`zc status` 会点名「到期且零进展」，降了基线就同步下调 `frozen`。
7. **spec 文件名必须是 `<agentId>.json`**（`validate:specs` 强制）：拼音 slug 会撞车（`juhufu`=朱鸢 vs `jufufu`=橘福福）。
8. **知识单一事实源在代码；手册只收协议/口径/证据三类**：改代码时同步更新受影响的文档（清单见 README §6）；不要新建"复述代码"的文档，优先更新决策树条目。
   - 方法类文档（ENGINE_PIPELINE_GUIDE / AGENT_RECORDING_SOP / GAME_TERM_TO_CODE_FIELD / MECHANIC_PATTERNS）条目只许三类：**协议**（怎么做）、**口径**（是什么，手写时按规则 16 写成 `@fact` 钉实现旁）、**证据**（一行 + 实测数字，如否决记录）。
   - **编年叙事（逐日对账、逐队归因、实验过程）进 git log 与 `.claude/` 账本，不进手册**；§4 坑条目模板 = 症状/根因/判据/否决记录。
   - 机器面：`check-guards` 手册密度棘轮（四文档数字 agentId 密度只降不升）+ 判据 33（棘轮登记 current≤200 / history≤120）+ 判据 34（§4 每条坑条目 ≤40 行：总量行数只是读数——补证据句 / 否决记录不该红，条目膨胀才红）。
   - 带时效的结论挂 `⟳复核: <到点判什么> | 到期 <YYYY-MM-DD>`，`zc drift` 点名逾期项（复核后撤标记或改写条目，别只删日期）。
9. **完成必须声明 verifier + coverage**：回复里写明由哪个命令/测试证明生效（verifier）、影响范围（哪些角色/页面/文件）。没有测试覆盖的改动先补测试。
10. **check 失败先诊断再动手**：先读失败断言/错误文件，写一句根因，再修。禁止不读输出直接重跑或直接改测试；根因指向测试本身时先复核口径再改。**红基线不允许过夜**。
    **基线是测量工具，不是开发否决权**：`timeGolden.baseline.json` / `timeFillRatchet.baseline.json` 是在既有逻辑下生成的快照，只回答「这次改了什么」，**不得**为了变绿回退正确逻辑、也不得以「会大面积变红」为由拒绝口径修正。
    处置：① 量 delta（`npx vitest run timeGolden` / `timeFillRatchet`）② 逐条归因（哪队/哪个量/为什么）③ 确认改动有意，再 `TIME_GOLDEN_UPDATE=1` / `TIME_RATCHET_UPDATE=1` 重生成 ④ delta 表 + 归因写进提交说明。**禁止无归因重生成**。
11. **跨文件常量只从单一来源引用**：能量/喧响/倍率/异常等共享数值必须引用 `core/`、类型定义或 `statMeta` 的常量，禁止在模块/页面里复制字面量。跨角色回能只改 `calcCrossAgentEnergy`（单一事实源）。
12. **最小实现阶梯（只约束「写多少」，不约束「对不对」；不得用作"拒绝更优设计"的借口）**：写码前停在第一档能成立的——①这功能真要建吗（YAGNI）②仓库已能复用吗（规则 11 + 决策树）③语言/平台/已装依赖能覆盖吗 ④一行能搞定吗 ⑤才写最小可用。阶梯缩短**解法**，永不缩短**读懂**与**验证**。
    有意简化且砍了真实角落时，就地写 `debt: <天花板>, <升级路径>` 注释；**新增 debt 标记必须在 `check-guards` 的 `DEBT_REGISTRY` 登记（since/due），还清时销号，漏登记即红**。
13. **共享工作区显式路径提交**：只 `git add <改动文件>`，把 `-A`/`--all`/`-u` 当禁区（会卷走并行会话 WIP）；**提交也带路径**：`git commit -m … -- <路径…>`（裸 `git commit` 会把别人已 `git add` 的文件一并提交）。
    - 提交前 `git status --porcelain` **逐行确认每一行都是自己的**——出现你没碰过的文件名就是并行 WIP，从 add 列表剔掉，并在提交信息里注明。提交后 `git show --stat HEAD` 复核落盘文件集。
    - `.claude/ledgers/`、`.zcode/`、`.zc/` 已 gitignore 且 `check-guards` 拒绝其被跟踪。仓库根 `.git-guardrails.json` 启用 `dsh-git-guardrail`，执行前拦 `git add -A/--all/./*`、`commit -a/-am`、`reset --hard`、`clean -f`、`checkout .`、`push --force`（临时放行写 `disabledRules`，详见 `~/dsh-plugins/dsh-git-guardrail/README.md`）。
    - 改共享文件后**写后即验**（`grep`/`git diff --stat`），不 `git checkout` 还原他人编辑中的文件。
14. **生成产物与行尾由环境强制**：`public/static/*.json` 紧凑写、`catalog.json` 顶层键 == `Catalog` 字段由 `validate:data` 强制（红 → `npm run minify:static`）；行尾统一 LF 由 `.editorconfig`/`.gitattributes` 强制，python 改文本用 `newline=""`。
    **JSON 同一对象内不得有重复键**：`JSON.parse` 让后者静默覆盖前者而结构完全合法 ⇒ `validate:data`/`validate:specs`/vitest 全看不见；判据 21（`scripts/lib/json-dup-keys.mjs`）拦。⚠ 修法必须**删掉后出现的那个键**，别跑生成脚本重写整份（它也走 `JSON.parse`）。
15. **跨实体断言必须查证，派生数值必须问引擎**：凡要写「X 的专武/归属/属性/数值是 Y」（音擎↔角色、套装↔效果、id↔名字），先跑 `node scripts/resolve.mjs <类型> <名|id>`（`docs/ENTITY_CARDS.md` §0），输出引用一律用 `名字(id)` 绑定格式；歧义或未命中时工具 exit 1，**绝不凭名字联想静默选最像的**。面板/暴击预算等**派生数值以引擎探针为权威**（`PROBE_AGENT=<id> npm run probe:panel`），禁止手工汇总 catalog JSON。
16. **口径必须挂在活代码上，主体必须带限定词，否决必须留痕**：
    ① 写「X 是 Y」前先 `grep -rn "X(" src`——零调用点 = **死口径**，挂着「用户确认」的注释比没注释更危险。
    ② `@fact` 主体带限定词：写 `1431/局外连接段` 而不是 `1431/连接段`——无限定词的主体会被按名字联想套用。
    ③ **试过又放弃的方案必须写进 `ENGINE_PIPELINE_GUIDE.md` §4 对应坑条目的「否决记录」**（一句话 + 实测数字）；最有价值的知识常常是"别这么改"。
17. **★ 永远选长期（本条优先于一切"少改/先凑合/怕数字难看"的冲动）**
    本仓库**仍在开发中**，未上线、无外部用户 ⇒ **重构规模本身不是否决理由**。**有优选优，不要思维固化。**
    ① **不要在"短期 vs 长期"之间提问**——这是**已被裁决的元问题**，答案恒为长期，直接按长期做。
    ② **度量口径纠正不适用「棘轮只减不增」**：棘轮防代码变差，不防尺子变准。发现度量漏计形态时**自主把 frozen 调到真实值**并在 history 写「这是口径纠正不是退步」。⚠ 唯一纪律 = **换尺与改代码不得混批**。
    ③ **不许为保住好看的数字而维持错误的度量**——那是"解决提问题的人"。
    ④ **顺序在两条路都必做时不是决策点**：若无依赖，按自然顺序做掉，不要问用户。
    ⑤ **"大面积重构"不写进风险栏**——风险栏写"会错/不可逆/需用户口径"，不写"改动行数多"。改动大 ⇒ 切批 + 逐批可机检。
    ⑥ **口径纠正先分类，再定计量单位**：区分业务选择、纯身份定义、待核查项；比较表达式数、去重行数、迁移批次数分别报告。**`find/filter` 回调里的身份比较仍在选择业务数据，不能仅因有 `return` 就豁免**。

## 2. 常见任务入口

**决策树单源在 `docs/ARCHITECTURE.md` §3**（任务 → 先读 → 再改；`zc brief` 与 `zc ctx` 都检索它，跑一次比翻表快）。本节只收 §3 没有的口径：

| 任务 | 改哪 |
|---|---|
| **改抽卡价值 / 抽卡成本** | 只用**期望值口径**（用户裁决 2026-09-01：宏观研究期望足够，模拟抽卡运气已删）。四处分工固定：① 成本单一事实源 = `src/data/filmEconomy.ts`（`CINEMA_GOLD_FILM` / `WEAPON_GOLD_FILM` = **期望抽数 × 160 推导**，已挂 `@fact` + `⟳复核`；页面不得另抄 15000 / 10000）；② 购买阶梯与增量成本 = `src/composables/pullPlanner.ts#PURCHASE_LADDER` / `tierCost`（**按档位差分派生**，不是常量价）；③ 价值与 ROI = `pullPlanner.ts#computeCardValuesVcg` / `cardValuePer10kFilm`（分子 = 引擎**队伍级** `calc.teamTotalDamage` 经 `scoreForDamageRatio`，走完整 `applyTeamConfig` 管线；分母 = 最优轨迹里的**实际增量投入**）；④ 引擎桥 = `src/composables/pullPlannerEngine.ts`。⚠ `pullValue.ts`（Chart 5 · 按归档统计的兑现）已于 2026-10-08 下线、`TIER_COSTS` 常量价与 gachaCost / acquisitionValue 引擎一并删除——**不要再引入抽卡随机模拟，也不要重建归档统计口径的价值图** |
| **队伍有空槽（先填槽2 一类）时数值静默偏小 / 报 TypeError** | `characters`/`panels`/`damagePanels`/`entrySnapshotPanels` **按位置压缩**（producer 跳过空槽）⇒ **槽位号 ≠ 下标**，一律禁 `arr[slot]`：自己那份 cfg 用派发器直给的 `AgentTeamConfigInput.cfg` / `AgentNextRoundFeedbackInput.cfg`，队友那份用 `.find(c => c.slot === slot)`，面板用 `panelAt(panels, slot)`（`core/panel.ts`）。扫描器 = `scripts/lib/compacted-slot-index.mjs`（判据 17）。⚠ 本类缺陷 `timeGolden` **全盲**（105 预设全满槽）⇒ 只能手组队测（`compactedSlotIndex.test.ts`） |

## 3. 验收命令

### 3.1 三环：**每个对话跑 core，不是跑全量**

| 环 | 命令 | 何时跑 | 实测 |
|---|---|---|---|
| **core** | `npm run check` | **每个对话收工**（规则 1） | **172.7s**（2026-11-04） |
| **fast** | `npm run check:fast` | 合并前 / 半天的活收尾 | 未复测（估 250~300s） |
| **full** | `npm run check:full` / `npm run verify` | **改到危险面时** / 合并前 / CI | **946~1143s**（2026-11-01 全量）+ build 19s |

**三环里都含 `npm run typecheck:inc`（`vue-tsc -b` 增量）**：类型错是编译期就死的那类错，不该等到全量才发现。⚠ 别换成非增量的 `npm run typecheck`（每次 ~17s）。

⚠ **表里的秒数是实测值，不是预算**（2026-11-04 复测：core 曾因**单个测试文件** `interactionSurface` 扫 5 遍而达到 **648.9s**，已修成共扫一次 ⇒ 172.7s）。读数为「一个文件吃掉整环」时的根因分析与剩余排期见 `docs/mcp-dev-process-speed.md` §11–§12。**环划分的判据是「改动性质」，秒数只用于判断这次量到的墙钟是否异常**（异常先查最长文件，别先怀疑机器）。

清单与嵌套关系的单一事实源 = `scripts/test-ring.mjs`（core ⊂ fast ⊂ full 由 `check-guards` **判据 32** 断言，默认环不许改回全量也是它守）。**改了东西先问要不要升环**：

```bash
node scripts/test-ring.mjs advise   # 按 git status 的路径提示「这次该跑到哪一环」
```

判据（不是按时长拍的）：动到 **计算路径 / 时间账 / 数值数据 / 角色模块 / 护栏脚本** ⇒ 必须 **full**；动**展示层** ⇒ fast；只改 **docs / 文案 / 单条测试** ⇒ core 够用。**全量的触发条件是改动性质，不是日历。**

```bash
npm run verify        # check-guards + check-tokens + validate:data + validate:specs + verify:recording + vitest + build
npm run check         # 核心环（改完必跑；不是全量）
npm run check:fast    # 快环（合并前）
npm run check:full    # 全量（advise 说动到危险面时 / 合并前）
npm run check-guards  # 机器护栏（条数会随加固变化，逐项口径见 scripts/check-guards.mjs 头注释）
npm run verify:recording  # 录入完成判据
npm run docs:status   # 重新生成 docs/implementation-status.md（CI 会检查漂移，漏跑即红）
npm run minify:static # 生成产物瘦身/剔 catalog 死键（幂等）
```

**UI 改动必须实机点通一次**：`npm run build` 后用 `scripts/ui-check.mjs`（起静态服务 + headless Chromium 经 CDP 点页签/控件/按钮，读回 DOM 体检：polyline/标注重叠/表格溢出/JS 错误/未格式化数值），**零 JS 错误 + 无重叠 + 无溢出 + 无未格式化数值 = PASS（退出码 0）**（未格式化数值 = 页面出现 ≥7 位小数的浮点噪声或 NaN / Infinity，即展示处漏了 `fmt`）：

```bash
node scripts/ui-check.mjs --tab 队伍对比 --radio 难度曲线 --main-c --click 计算曲线 --wait-for .curve-seg
```

（无 root 环境缺 `libnspr4/libnss3` 时，按脚本文件头的「用户态 `apt-get download` + `dpkg-deb -x` 解包」补齐。）

**`verify:recording` 是机器判据**——防"写了代码改了 spec 就声称完成"：对每个 `status ∈ implemented*` 的角色查①测试文件引用 agentId（无=FAIL）②有 expect 断言（无=WARN）③档案段有状态行（无=WARN），并校验 `data/recordings/*.json` 的原文覆盖与来源漂移。录入后跑它确认无 FAIL。

**新测试一律用 `src/test/harness.ts`**（`setupHarness` / `mockStaticFetch` / `setTeam`），禁止复制三文件 fetch stub（存量已冻结在 `check-guards` 清单里，新增即红；迁移一个就删一行）；全局回归网 = `src/composables/__tests__/allAgentsSweep.test.ts`。

**实战归档只做「单条部署对照」（RunArchivePage），不作误差判据**（用户裁决 2026-09，口径全文见 `ARCHITECTURE.md` §3「实战归档对拍」行）：归档是 approved 顶尖投稿（幸存者偏差、配装/操作/词条未知），预测值与其差分不度量「真实性」——不设低估/高估、不设基线、不据此拦任何录入改动。

**开局/收工走 `zc`**（带 `--` 的参数用 node 直调，`npm run` 会吞 flag）：
- `status` 开局考古（分支/工作区改动/**疑似并行会话在改的文件**/债务/待办/最近验证）
- `claim <文件…>` 动手前占道（规则 13 的机器面，冲突大声失败；单文件上下文用 `ctx`）
- `brief "<任务一句话>"` 一页检索完 §1 规则 / 决策树 / 坑表 / 根因表 + 该 agentId 的口径与覆盖测试，每条带「文件:行」；**命不中且你做完了，就往决策树补一行**
- `done --verifier <命令> --coverage <范围>` 把规则 9 的声明落进 `.zc/journal.jsonl`
- `facts`（查口径）/ `drift`（复核队列）/ `lang`（事实语法）

**定了新口径就写成一行 `@fact` 钉在实现旁边**（不写成散文；完整语法 `zc lang`）：
`@fact <主体·限定词> <种类>: <内容> | 据 <谁定的@日期> | 验 <测试> | 锚 <路径>#<符号> | 信 <确认/高/中/低>`
机器判据：必须有「据」且「锚」解析得到，**断锚即红**；锚符号的代码在「据」之后变过的进 `zc drift` 队列（只报不红）。

## 4. 长任务账本（loop 档）

`loop` 档任务开工时，**工作状态写 `.claude/OPEN-ITEMS.md`**（已 gitignore，不提交；属于工作状态，不是项目知识）：

- **不要建编年账本**（用户裁决 2026-09-16：`task-ledger.md` 曾累积到 4404 行，多份互相矛盾的「盘上实测」并存，实测误导过后继会话 ⇒ 已瘦身为索引并删除全部分线账本）。
- `OPEN-ITEMS.md` 只收**仍然活着**的条目（未决口径 / 待开工 / 已裁决不做），**做完一条删一条**；编年叙事（逐轮对账、逐队归因、实验过程）进 **git log 与提交说明**，不进这里。
- 机器面状态（分支/租约/债务/待办/最近验证）**不要手抄**——`node scripts/zc.mjs status` 实时给。
- 候选想法（尚未决定做的方案）须带**证伪闸门**两行——依赖的**前提假设** + 假设为假时的**可观察失败**（AI 是论证机器不是检验机器，防「精致的垃圾」），过不了闸门不进「可开工」段。
- 跨会话/长间隔恢复时先读 `OPEN-ITEMS.md` + `zc status` 再接续。短任务不写。
- **⚠ 写 `OPEN-ITEMS.md` 只能用 `edit` 局部替换或 shell 追加，禁止「`read` 全文 → 拼接 → `write` 回盘」**（`read` 对 >2000 行的文件会**静默截断**，而该文件在 .gitignore 内、git 无兜底）。改前先 `cp .claude/OPEN-ITEMS.md .claude/OPEN-ITEMS.md.bak-$(date +%Y%m%d)`。看到 `<!-- LOST: ... -->` 标记不要当成「本来就没有」。

## 5. 多工人协作（把活派给别的会话时，派活方与接活方都读这段）

**派活方**：
1. **brief 四段式**（缺哪段工人就自己猜哪段）：① 先读哪几个文件（**绝对路径**）② 硬约束（哪些文件**不许**碰、哪些语义**必须逐位保留**）③ 验收命令（逐条，含期望输出）④ 报告必须包含什么。
2. **不许让工人跑全量**（`npm run verify` / `check:full`）：多工人并发会互相拖慢，且三环已分好——工人验收面 = `npm run check`（core）+ 相关 `npx vitest run <文件>`；fast/full 由派活方在合并前统一跑一次。
3. **同一文件不派给两个工人**：用 `dependsOn` 串行化，或让两个工人改完全不相交的文件集。
4. **要求工人 `zc claim` 它要改的文件**，收工时 `zc done`——否则它的声明只活在它的对话里。
5. **工人说不许做时就停下**：工人报「不能盲搬 / 需要裁决」是**有效结论**，不是失败。验收时重点看它**没做什么**以及理由。

**接活方**：
1. 先读派活 brief 点名的文件；brief 没写的**不要自己扩范围**，发现了问题写进报告。
2. 收工报告**必须包含可复现的验证输出**（命令 + 实测结果尾部），不是「已完成」三个字。
3. 判据红/做不到/前提被证伪时：如实写 `blocked` + 阻塞点，**不要**为了让数字好看而放宽判据（尤其不许改 `timeGolden`/`timeFillRatchet` 基线、不许删断言、不许改 `frozen` 常量以求绿）。
4. **棘轮红了怎么处置：先归因，再动基线——绝不由 delta 的方向决定动作**。第一步永远是问「**尺子对吗**」：

   | 归因 | frozen 动作 |
   |---|---|
   | 真修好了（代码变更，扫描面正常） | 下调到实测值 |
   | 真退步（代码变更） | **不动**，改代码 |
   | 换尺：新尺量出**更多**存量 | **上调**到实测值，注明「口径纠正不是退步」 |
   | 换尺：新尺量出更少 | 下调到实测值 |
   | **扫描面塌了 / detector 失效** | **不动**，去修扫描器——这不是进步，是判据瞎了 |

5. 报告文件写在派活指定的路径（第一行 `STATUS: done|blocked`），**最后一条回复也带一行 STATUS**（双通道）。

## 6. 子代理模型路由

**子代理统一用 `wb/deepseek-v4.1-flash`**（用户裁决 2026-09-23）。派发时不必选档、不必查白名单：`subagent` / `subagent_fork` / `workflow` 的 `agent()` 省略 `provider`/`model` 即走这条。单一事实源 = `~/.dsh/model-routing.yaml`。

- **要临时换模型**：只有 `workflow` 的 `agent(prompt, { provider, model })` 能改子代理路由。`subagent` 能否换，取决于本会话有没有模型选择白名单。可选路由见 profile 的 `llm-pi-ai` 段（`~/.dsh/profiles/web/cordis.patch.yml`）；**不必**在此维护可用性清单。
- **⚠ `subagent` 工具的两种模式路由不同**：`one-shot`（一次性勘察，`run_in_background: true`）走 `model-routing.yaml` 的 `route`；`continuable`（默认）继承**父代理的 `modelSelection.lastUsed`**。**快速勘察/找东西/读代码用 `one-shot`**；需要多轮续跑才用 `continuable`。
- **子代理不能再派子代理**（`maxDepth: 1`）。要再拆，由你回收上下文后另开任务。
- **怎么知道子代理实际跑了哪个模型**：① badge 工具 `_dsh_external_subagent_model_badge_status`；② 直接读子代理 session 的 `modelSelection.lastUsed`（最可靠）。

## 开发环境与工具链（Windows ↔ WSL）

> **⚠ 先认 harness**：本仓库**真身在 WSL**（`/home/kaua/projects/zzz-calculator`）。Windows 侧存在若干副本（`/f/trae_output/`、`/f/claude code/` 等），**一律不要用**——它们是历史遗留，改错副本不生效。
>
> **DSH 读者**（bash 直接落在 WSL）：§1 的 `wsl_exec` 换成直接 `bash`，§2 整节跳过，§3/§4 与你无关。
> **ShunCode 读者**（`run_command` = Windows Git Bash + UNC）：全节照读。

### 1. 命令必须走 wsl_exec，不要 run_command（⚠ 仅 ShunCode harness）

经 UNC（`\\wsl$\...`）访问 Linux 文件系统极慢（实测 `git status` **85s vs 2s**）。因此 `git / node / npm / 测试 / 构建` 一律用 **`wsl_exec`** 工具（位于 `.shuncode/mcp-tools/wsl_exec/`，参数经 `SHUNCODE_TOOL_ARGS` 传入，超时 10min）。

> 根因：ShunCode 的 `run_command` PTY 硬编码为产品内置 Git Bash，所以工作区在 WSL 时它只能是「Windows Git Bash + UNC 访问」。ShunCode **没有** remote-wsl 扩展，装不上也别折腾。

**`wsl_exec` 缺失时的退路**（工具清单 15 个而不是 16 个）：`run_command` 包一层，命令仍在 WSL 内执行——`wsl -d Ubuntu -e bash -lc "cd /home/kaua/projects/zzz-calculator && <命令>"`；不要让 `run_command` 直接读写 UNC 路径。汇报里注明「本轮走 run_command 退路」。

**⚠ 环境安全硬规则（全仓停摆约 6 小时的事故后定）**：
- **禁止 `wsl --terminate` / `wsl --shutdown`**（lead / 工人都不许）。杀进程只杀具体进程：先 `ps -eo pid,etime,cmd | grep <模式>` 取 pid，再 `kill -9 <pid>`（`pkill -f` 会匹配到发出命令的 shell 自身）。
- 可能耗时的 node / vitest 脚本**禁止前台跑**：`setsid bash -c 'timeout -s KILL <秒> <命令>' > <log> 2>&1 &`，再轮询 log。普查类脚本用 `git ls-files` 取文件清单，不递归 stat、不跟随符号链接。
- **并行 lead 共用同一工作区 ⇒ 全量检查必须钉 HEAD**：跑前后各记一次 `git rev-parse --short HEAD`；两者不同 ⇒ 本次结果**不可归因**（源码在测试进程脚下被换），等树静下来重跑。看到红时第一步：`git log -1 --format='%h %ad %s' --date=format:'%H:%M' -- <失败文件>`，看时间戳是否落在自己检查窗口内。
- 详细经过：`docs/mcp-r22d1-batch12-field-census.md` 附录 A。

### 2. 写长文件用 apply_patch 分块（⚠ 仅 ShunCode harness；DSH 用 write/edit，整节跳过）

Windows 命令行有 **8191 字符上限**，用 `echo` / `base64` 拼长内容会被**静默截断**。长文件一律 `apply_patch` 分块写入。

**⚠ 新建文件的坑**：`apply_patch` 的 `*** Add File:` 在本环境**必然失败**（报 `ENOTSUP: operation not supported on socket, link ...`——UNC 路径不支持原子 link，与内容无关，重试无用）。
绕法：先用 `wsl_exec` 执行 `printf '<!-- SEED -->\n' > <路径>` 建文件并留一行种子，再用 `*** Update File:` 把种子行当上下文删掉、换成正文。两条附带约束：① `*** Update File:` **至少要有一行旧内容**（种子行就是为此存在）；② 用脚本生成多个 hunk 时，务必 `-` 行在 `+` 行之前。

### 3. ShunCode 设置（`%APPDATA%\ShunCode\User\settings.json`）

```json
{ "shuncode.bridge.persistentMode": true, "shuncode.bridge.tunnelProvider": "ngrok",
  "shuncode.bridge.ngrokDomain": "paver-deskbound-angles.ngrok-free.dev",
  "shuncode.bridge.ngrokUseHttpProxy": false, "security.workspace.trust.enabled": false }
```

- `ngrokUseHttpProxy` **必须 false**（免费版走 HTTP 代理会被 `ERR_NGROK_9009` 拒绝）。固定域名是刚需：扩展宿主崩溃（0xC0000374）后桥会停，Quick Tunnel 每次换域名会让 Arena 里的旧地址全失效；`persistentMode:true` 让 Chat 重渲染后自动起桥。
- `security.workspace.trust.enabled:false` —— 否则受限模式禁用扩展，表现为「打开文件夹后账号/授权消失、命令 not found」。

### 4. 给新对话的提示词要短

ShunCode 握手会**自动下发 3687 字符的 instructions**，重复写规则纯属浪费。给新 AI 的提示词只需 MCP URL + 两点环境事实（用 wsl_exec、apply_patch 分块）。

