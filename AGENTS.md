# AGENTS.md

> 本仓库：ZZZ 伤害计算器（Vue 3 + TypeScript + Vite + Naive UI + Pinia + Vitest）。
> **任何改动前必读本文件；"这代码怎么跑 / 该改哪"先查 §0 导航表与 `docs/ARCHITECTURE.md` §3 决策树（或直接跑 `zc brief`），定位到文件再进去读代码。**

## 0. 任务分级：先认档，再按档读文档

| 档 | 适用 | 必读 | 可跳过 |
|---|---|---|---|
| `fast` | 改 UI / 文案 / 单条测试 / 单文件小修 | 本文件 §1（含规则 15/16）+ 目标文件头注释；**改 UI/样式 → `docs/UI_THEME_GUIDE.md` 是必读**（令牌与双主题口径不在代码里，`.vue` 也基本没有头注释） | 其余 docs（涉及页面时扫一眼对应 .vue 与 AppHeader） |
| `full` | 录角色 / 补机制 / 改引擎 / 排查 buff 没生效 | 本文件 §1 + `docs/ARCHITECTURE.md` §3 + 对应管线文档 | `docs/mechanism-reference.md` 纯参考可不读 |
| `loop` | 跨多文件重构 / 批量迁移 / 数据管道改动 | `full` 全部 + 本文件 §4 长任务账本 | — |

要不要开**外部闭环**不是凭感觉——按本节末「要不要开外部闭环」表判（粗对齐：fast 不开、full 的排查类先写预测再对账、loop 至少建 goal）。

`full` / `loop` 档的**读法：步骤必读、参考按症状查**。参考文档里的具体案例（某角色某坑）换到新角色往往无法类比——按症状只读命中的那一条：

| 何时 | 读哪个 |
|---|---|
| 开工前（必读） | 本文件 §1 + 下方录入步骤 + `AGENT_RECORDING_SOP.md` §6.10 完成清单 |
| 拿到任务先查「改哪」 | `ARCHITECTURE.md` §3 决策树，只读命中那一行 |
| 实现中卡住 / 数值不对 / 报错 | `ENGINE_PIPELINE_GUIDE.md` §4 坑表，按症状查对应条 |
| 命座提升率异常 / 写测试 / 录拐力 | `AGENT_RECORDING_SOP.md` §3.5 根因表 / §5 模板 / §6 |
| 录新角色前做模式匹配 | `MECHANIC_PATTERNS.md` §2，只读命中的 1 个维度（D1–D9） |
| 中文术语→字段不确定 | `GAME_TERM_TO_CODE_FIELD.md` 对应章节 |
| **碰时间/账本/物化行/超时判定/留白** | `ENGINE_PIPELINE_GUIDE.md` §4 开头**「时间系统三本账」表** + 坑 19 **「否决记录」**（先查这行，别急着重新发明） |
| **要断言「X 的专武/归属/属性是 Y」或查实体结构** | `ENTITY_CARDS.md`（实体卡）+ 先跑 `node scripts/resolve.mjs` 查证 |

### 录入角色 / 补机制：五步（仅此类任务）

1. **读 nanoka 原文自主分析**（`data/raw/nanoka_missing/full/<id>.json`）：逻辑/资源/字段/数值原文都给了，只把「原文没数值 / 口径歧义 / 引擎缺通道」列清单一次问用户——`AGENT_RECORDING_SOP.md` §0.5。
2. **检索角色档案段**（`grep -n "角色名\|agentId" docs/MECHANICS_IMPLEMENTATION.md`）：读该段已确认口径 + 未建模项。无状态行 = 段未核对，先核现状再补状态行。
3. **模式匹配**：`MECHANIC_PATTERNS.md` §2 定位 1 个维度（D1–D9），按该维度既有做法实现，不造新乘区。
4. **实现**：卡住/数值不对/报错才按症状查 `ENGINE_PIPELINE_GUIDE.md` §4、`AGENT_RECORDING_SOP.md` §3.5。
5. **交付**：过 `AGENT_RECORDING_SOP.md` §6.10 完成清单 → `npm run verify` + `docs:status`；同步档案段与状态表。

其他任务（改引擎/排查/UI）不需读原文/档案。未收录的新角色以 spec notes + raw 数据为准。

### 要不要开外部闭环：按表判，不许凭感觉

惰性启发式总会把活判成「简单、不用开环」——所以开环是**规则判断不是 vibe 判断**。**终验与验收放行留真人**（判分器只许收紧不许放松，这是设计不是疏漏）：

| 触发条件 | 开什么 | 闭合方式 |
|---|---|---|
| `fast` 档 / 一条 `zc done --verifier` 就能交代 | **不开外部环**，走仓库轻闭环（`zc claim` → 改 → `npm run check` → `zc done`） | verifier 绿即闭 |
| `loop` 档，或跨多轮但完成判据说得清 | `create_goal`（agent 可自主推断长任务，无需用户点名）+ §4 账本 | goal 判据达成 → `update_goal complete` |
| **排查数值/机制错误**（伤害偏低、失衡次数错这类） | **预测先行**：动手前把「预测值 + 判据」写进账本 `Next`，再跑盘上实测对账（`npx vitest run <相关测试>` / `PROBE_AGENT=<id> npm run probe:panel` / `subagent` 跑一次性探针） | 实测与预测吻合才闭合；**discrepancy 即回炉，不许就地改预测** |
| 跨会话、需留痕的大项目 | 多工人派发（§5）+ 每步 `zc done` 落账 | **真人确认**后终验；agent 不得自行宣布验收 |

配套约定：**harness 的 autoStart / writeGate 保持关闭**（本仓库高频小修为主，写闸价值已被 `zc claim` + `check-guards` + 规则 13 覆盖）；**开了闭环不豁免本仓库验收链**——`npm run verify` + `zc done` 仍是交付口径。

## 1. 硬性规则

1. **基线先绿再动手**：改代码前跑 `npm run check` 确认通过；改完跑 check + `npm run build`（验收命令见 §3）。
2. **数值唯一事实源 = `public/static/catalog.json`**：改数值走 `scripts/` 导入/爬取脚本重跑，不要手改 JSON 本体。
3. **执行行匹配一律用 `moveId`**，不按 name/note（`enrichExecutionPlan` 会从倍率表回填覆盖它们）。
4. **自定义 TS 模块角色**（`src/mechanics/agents/*.ts` 注册过）的 spec 字段是死数据：adjustable 滑块/attributeConversions 必须在模块里实现，spec 只作记录（`validate:specs` 已强制：模块角色的 attributeConversions 必须可证明被消费——模块显式调用 `applySpecAttributeConversions` 或条目 note 标注「实现位置：」，否则校验失败）。
5. **每个录入的机制 = spec 字段 + 生效测试**；命座效果录完跑一次「资源利用率页·命座提升率」确认无橙色「⚠无变化」警示（效果未接进计算的信号）。该自检有自动化护栏兜底：`allAgentsSweep` 断言「声明已实现命座的角色 C6 伤害 > C0 伤害」，逐级三态判据在 `composables/cinemaUplift.ts`（页面与测试同源）——页面自检仍要跑，它能定位到具体哪一级。
6. **跨角色/队伍级机制走 `applyTeamConfig` 钩子**（三阶段 build/converge/postRound，见 `docs/ENGINE_PIPELINE_GUIDE.md` §2），禁止往 `useResourceCalc` 新增 `agentId === 'xxxx'` 分支（机器护栏：`check-guards` agentId 棘轮冻结存量基线，新增即红；存量清零后下调基线）；面板阶段的覆盖率滑块直接读 `AgentPanelInput.settings`，不要经 panel 字段走私（曾致般岳滑块静默失效）。**棘轮有 burn-down 契约**（`check-guards` 的 `RATCHET_BURNDOWN`：每条登记 frozen/target/due/plan），`zc status` 会点名「已到期且零进展」的棘轮——棘轮防变差，burn-down 防「冻结 = 永久豁免」，降了基线就同步下调 `frozen` 与进度。
7. **spec 文件名必须是 `<agentId>.json`**（`validate:specs` 强制）：拼音 slug 会与别的角色撞车（`juhufu`=朱鸢 vs `jufufu`=橘福福），改错文件代价极高。
8. **知识单一事实源在代码；手册只收协议/口径/证据三类**：改代码时同步更新受影响的文档（`docs/` 清单见 README §6）；不要新建"复述代码"的文档，优先更新决策树条目。**分层契约**——方法类文档（ENGINE_PIPELINE_GUIDE / AGENT_RECORDING_SOP / GAME_TERM_TO_CODE_FIELD / MECHANIC_PATTERNS）条目只许三类：**协议**（怎么做：步骤/模板/钩子用法）、**口径**（是什么：数值/映射/裁决，手写时按规则 16 写成 `@fact` 钉实现旁）、**证据**（一行 + 实测数字，如否决记录）。编年叙事（逐日对账、逐队归因、实验过程）进 git 历史与 `.claude/` 账本，不进手册——git log 逐字保存，手册里只留结论与指针。§4 坑条目模板 = 症状/根因/判据/否决记录（示范见坑 19）。机器面：`check-guards` 手册密度棘轮（四文档的数字 agentId 密度只降不升）+ burn-down 点名；带时效的结论挂 `⟳复核: <到点判什么> | 到期 <YYYY-MM-DD>` 触发器行，`zc drift` 点名逾期项（复核后撤标记或改写条目，别只删日期）。
9. **完成必须声明 verifier + coverage**：每个改动结束时，回复里写明——由哪个命令/测试证明它生效（verifier），以及影响范围（哪些角色/页面/文件）。没有测试覆盖的改动先补测试，不算完成。
10. **check 失败先诊断再动手**：先读失败断言/错误文件，写一句根因，再修。禁止不读输出直接重跑或直接改测试；若根因指向测试本身，先复核口径再改。**红基线不允许过夜**：曾有一条 `yixuanSmoke` 断言被当成"既存红"跨多个任务放着，而 CI 里文档漂移检查排在 `npm run verify` 之后同一 job——一红全哑、护栏整张失效（该 job 已拆开）。
    **基线是测量工具，不是开发否决权（用户裁决 2026-09-10）**：`timeGolden.baseline.json` /
    `timeFillRatchet.baseline.json` 是**在既有（可能错误）逻辑下生成的快照**，只用来回答「这次改动
    动了什么」，**不得**为了让它变绿而回退正确逻辑、也不得以「会大面积变红」为由拒绝口径修正。
    正确处置：① 先量 delta（`npx vitest run timeGolden` / `timeFillRatchet`）；② 逐条归因（哪队、
    哪个量、为什么）；③ 确认改动是**有意**的，再 `TIME_GOLDEN_UPDATE=1` / `TIME_RATCHET_UPDATE=1`
    重生成；④ 把 delta 表 + 归因写进提交说明/账本。**禁止**无归因重生成（那会把别人的漂移静默吸收）。
    长期利益优先：口径错了就改引擎，基线跟着重排。
11. **跨文件常量只从单一来源引用**：能量/喧响/倍率/异常等共享数值必须引用 `core/`、类型定义或 `statMeta` 中的常量，禁止在模块/页面里复制字面量；改口径先改源，再跑 check。跨角色回能只改 `calcCrossAgentEnergy`（单一事实源）。
12. **最小实现阶梯（只约束「写多少」，不约束「对不对」）**：写码前停在第一档能成立的——①这功能真要建吗（YAGNI）②仓库已能复用吗（规则 11 + 决策树）③语言/平台/已装依赖能覆盖吗（ES·TS 内置 → Vue/Naive UI/Pinia 自带 → 已装包）④一行能搞定吗 ⑤才写最小可用。阶梯缩短**解法**，永不缩短**读懂**与**验证**：规则 5/9/10/11 与领域档案（`docs/MECHANICS_IMPLEMENTATION.md` 的口径与未建模项）优先于本阶梯。有意简化且砍了真实角落（O(n²) 扫描 / naive 启发式 / 全局近似 / 暂未建模）时，就地写 `debt: <天花板>, <升级路径>` 注释，供 `grep -rn 'debt:' src scripts` 回收进账本 Open 段；**新增 debt 标记必须在 `check-guards` 的 DEBT_REGISTRY 登记（since/due），还清时销号，漏登记即红**。
13. **共享工作区显式路径提交**：只 `git add <改动文件>`，把 `-A`/`--all` 当禁区（会卷走并行会话 WIP，历史事故 ×2）；`.claude/ledgers/`、`.zcode/`、`.zc/` 已 gitignore 且 `check-guards` 拒绝其被跟踪。**源码级 WIP 有机器面**：仓库根 `.git-guardrails.json` 启用插件 `dsh-git-guardrail`，在执行前拦 `git add -A/--all/./*`、`commit -a/-am`、`reset --hard`、`clean -f`、`checkout .`、`push --force`（拒绝理由直接给替代写法；`add -u`/`-p`/显式路径放行；无标记文件 = 完全不介入；临时放行往该文件写 `disabledRules: ["<规则id>"]`，详见 `~/dsh-plugins/dsh-git-guardrail/README.md`）。改共享文件后**写后即验**（`grep`/`git diff --stat` 确认落盘），不 `git checkout` 还原他人编辑中的文件。
14. **生成产物与行尾由环境强制**：`public/static/*.json` 紧凑写、`catalog.json` 顶层键 == `Catalog` 字段由 `validate:data` 强制（红 → `npm run minify:static`）；行尾统一 LF 由 `.editorconfig`/`.gitattributes` 强制，python 改文本文件用 `newline=''` 防 CRLF 翻面 churn（历史事故 ×2）。
15. **跨实体断言必须查证，派生数值必须问引擎**：凡要写「X 的专武/归属/属性/数值是 Y」（音擎↔角色、套装↔效果、id↔名字），先跑 `node scripts/resolve.mjs <类型> <名|id>`（`docs/ENTITY_CARDS.md` §0），输出引用一律用 `名字(id)` 绑定格式；歧义或未命中时工具 exit 1，**绝不凭名字联想静默选最像的**（游戏名词在训练分布里有强先验，名字联想断言能一路通过不报错——2026-08-30「心弦夜响→仪玄专武」事故 ×2 同日）。面板/暴击预算等**派生数值以引擎探针为权威**（`PROBE_AGENT=<id> npm run probe:panel`），禁止手工汇总 catalog JSON。
16. **口径必须挂在活代码上，主体必须带限定词，否决必须留痕**（三件事都是防"文档骗 agent"）：
    ① 写「X 是 Y」前先 `grep -rn "X(" src`——零调用点 = **死口径**，挂着「用户确认」的注释比没注释更危险（实测 `shortAxisFeiguangCount` 全仓零引用却标着「用户确认 4/10/5/12」，白绕一轮）。
    ② `@fact` 主体带限定词：写 `1431/局外连接段` 而不是 `1431/连接段`——无限定词的主体会被按名字联想套用（实测把「局外连接段归平A池」读成「明心境连接段不建行」，并把错误归因直接发给了用户）。
    ③ **试过又放弃的方案必须写进 `ENGINE_PIPELINE_GUIDE.md` §4 对应坑条目的「否决记录」**（一句话 + 实测数字）。最有价值的知识常常是"别这么改"，而它此前只活在代码注释里、docs 零命中（`=`/`max()` 折叠 → 溢出 186s 就是例子）。

## 2. 常见任务入口

**决策树单源在 `docs/ARCHITECTURE.md` §3**（任务 → 先读 → 再改；`zc brief` 与 `zc ctx` 都检索它，跑一次比翻表快）。本节只收 §3 没有的口径：

| 任务 | 改哪 |
|---|---|
| **改抽卡价值 / 抽卡成本** | **只用期望值口径**（用户裁决 2026-09-01：宏观研究期望足够，模拟抽卡运气已删）：`src/composables/pullValue.ts`（每万菲林兑现 ROI，单一事实源 = `data/filmEconomy.ts`）+ `src/composables/pullPlannerEngine.ts`（规划器，TIER_COSTS 常量价）；gachaCost / acquisitionValue 引擎已整体删除，**不要再引入抽卡随机模拟** |
| **队伍有空槽（用户先填槽2 一类）时数值静默偏小 / 报 TypeError** | `characters`/`panels`/`damagePanels`/`remielleEntryPanels` **按位置压缩**（producer 跳过空槽）⇒ **槽位号 ≠ 下标**，一律禁 `arr[slot]`：自己那份 cfg 用派发器直给的 `AgentTeamConfigInput.cfg` / `AgentNextRoundFeedbackInput.cfg`，队友那份用 `.find(c => c.slot === slot)`，面板用 `panelAt(panels, slot)`（`core/panel.ts`）。扫描器 = `scripts/lib/compacted-slot-index.mjs`（判据 17，口径与实测证据在其头注释）。⚠ 本类缺陷 `timeGolden` **全盲**（105 预设全满槽）⇒ 只能手组队测（`compactedSlotIndex.test.ts`） |

## 3. 验收命令

```bash
npm run verify        # check-guards + check-tokens + validate:data + validate:specs + verify:recording + vitest + build（build = vue-tsc -b && vite build，类型检查已含在内，故不再单列 typecheck）
npm run check         # 快速环（改完必跑）
npm run check-guards  # 机器护栏（条数会随加固变化，故本文不写死数字）——判据清单与实测阈值跑一次就打印，逐项口径写在 scripts/check-guards.mjs 头注释（本文不复制）
npm run verify:recording  # 录入完成判据（判据细节见下）
npm run docs:status   # 重新生成 docs/implementation-status.md（CI 会检查漂移，漏跑即红）
npm run minify:static # 生成产物瘦身/剔 catalog 死键（幂等；validate:data 报产物膨胀时用它修）
```

**UI 改动必须实机点通一次**：`npm run build` 后用 `scripts/ui-check.mjs`（起静态服务 + headless Chromium 经 CDP 点页签/控件/按钮，读回 DOM 体检：polyline/标注重叠/表格溢出/JS 错误），**零 JS 错误 + 无重叠 + 无溢出 = PASS（退出码 0）**：

```bash
node scripts/ui-check.mjs --tab 队伍对比 --radio 难度曲线 --main-c --click 计算曲线 --wait-for .curve-seg
```

（无 root 环境缺 `libnspr4/libnss3` 时，按脚本文件头的「用户态 `apt-get download` + `dpkg-deb -x` 解包」补齐，脚本会自动探测 `~/.local/chrome-deps`。）

**`verify:recording` 是机器判据**——防"写了代码改了 spec 就声称完成"：对每个 `status ∈ implemented*` 的角色查①测试文件引用 agentId（无=FAIL）②有 expect 断言（无=WARN）③档案段有状态行（无=WARN）。录入后跑它确认无 FAIL；WARN 按 SOP §6.10 第 3 项补状态行消除。

**新测试一律用 `src/test/harness.ts`**（`setupHarness` / `mockStaticFetch` / `setTeam`），禁止复制三文件 fetch stub（存量 stub 已冻结在 `check-guards` 清单里，新增即红；迁移一个就删一行）；全局回归网 = `src/composables/__tests__/allAgentsSweep.test.ts`（全角色 × 命座 0/6 不变量）。

**实战归档只做「单条部署对照」（RunArchivePage），不作误差判据**（用户裁决 2026-09，口径全文见 `ARCHITECTURE.md` §3「实战归档对拍」行）：归档是 approved 顶尖投稿（幸存者偏差、配装/操作/词条未知），预测值与其差分不度量「真实性」——不设低估/高估、不设基线、不据此拦或对冲任何录入改动。

**拿到任务先跑 `node scripts/zc.mjs brief "<任务一句话>"`**：一页检索完 §1 规则 / `ARCHITECTURE.md` §3 决策树 / `ENGINE_PIPELINE_GUIDE.md` §4 坑表 / `AGENT_RECORDING_SOP.md` §3.5 根因表 + 该 agentId 的既有口径与覆盖测试，每条带「文件:行」出处；命不中会直说，不编答案——**命不中且你做完了，就往决策树补一行**。

**开局/收工走 `zc`**（带 `--` 的参数用 node 直调，`npm run` 会吞 flag；子命令全集以 `node scripts/zc.mjs` 自述为准）：`status` 开局考古（分支/工作区改动/**疑似并行会话在改的文件**/债务/待办/最近验证）→ 动手前 `claim <文件…>` 占道（规则 13 的机器面，冲突大声失败，并带出该文件钉死的口径与职责声明；单文件完整上下文用 `ctx`）→ 收工 `done --verifier <命令> --coverage <范围> [--deps … --risk …]` 把规则 9 的声明落进 `.zc/journal.jsonl`（否则只活在聊天里，下一个 agent 继承不到）；另有 `facts`（查口径）/ `drift`（复核队列）/ `lang`（事实语法）。

**定了新口径就写成一行 `@fact` 钉在实现旁边**（不写成散文；完整语法 `zc lang`，本文不复制）：
`@fact <主体·限定词> <种类>: <内容> | 据 <谁定的@日期> | 验 <测试> | 锚 <路径>#<符号> | 信 <确认/高/中/低>`。
机器判据：必须有「据」且「锚」解析得到，**断锚即红**（锚符号被改名 = 口径已过期）；锚文件在「据」之后被改过的进 `zc drift` 队列（只报不红——红了会逼人改日期作弊）。

## 4. 长任务账本（loop 档）

`loop` 档任务开工时，**工作状态写 `.claude/OPEN-ITEMS.md`**（已 gitignore，不提交；属于工作状态，不是项目知识）：

- **不要建编年账本**（2026-09-16 用户裁决：`task-ledger.md` 曾累积到 4404 行，
  多份互相矛盾的「盘上实测」并存，实测误导过后继会话 ⇒ 已瘦身为索引并**删除全部分线账本**）。
- `OPEN-ITEMS.md` 只收**仍然活着**的条目（未决口径 / 待开工 / 已裁决不做），**做完一条删一条**；
  编年叙事（逐轮对账、逐队归因、实验过程）进 **git log 与提交说明**，不进这里。
- 机器面状态（分支/租约/债务/待办/最近验证）**不要手抄**——`node scripts/zc.mjs status` 实时给。
- 候选想法（尚未决定做的方案）须带**证伪闸门**两行——依赖的**前提假设** + 假设为假时的**可观察失败**
  （AI 是论证机器不是检验机器，防「精致的垃圾」），过不了闸门不进「可开工」段。
- 跨会话/长间隔恢复时先读 `OPEN-ITEMS.md` + `zc status` 再接续。短任务不写。

## 5. 多工人协作（把活派给别的会话时，派活方与接活方都读这段）

本仓库常有多条会话并行（有租约系统兜底），也会把独立任务派给**别的 agent 会话**（「工人」）跑。
双向纪律——**踩过的坑都在这里，别重新发明**：

**派活方（写 brief 的人）**：
1. **brief 四段式**（实测有效，缺哪段工人就自己猜哪段）：① 先读哪几个文件（给**绝对路径**）② 硬约束
   （哪些文件**不许**碰、哪些语义**必须逐位保留**）③ 验收命令（逐条，含期望输出）④ 报告必须包含什么。
2. **不许让工人跑 `npm run verify`**：全量套件 12min+，且多工人并发跑会互相拖慢/抢 CPU。
   工人的验收面 = `npm run check-guards` + 相关 `npx vitest run <文件>` + `npm run build`；
   **全量 `verify` 由派活方在合并前统一跑一次**。
3. **同一文件不派给两个工人**（规则 13 的租约解决不了跨会话的 brief 冲突）：用 `session_admin add_task`
   的 `dependsOn` 串行化，或让两个工人改完全不相交的文件集。
4. **要求工人 `zc claim` 它要改的文件**，收工时 `zc done`——否则它的声明只活在它的对话里，下一个会话继承不到。
5. **工人说不许做时就停下**：工人报「不能盲搬 / 需要裁决」是**有效结论**，不是失败。派活方验收时
   重点看它**没做什么**以及理由，别逼它硬做（硬做的产物通常是把语义改错且测试不红）。

**接活方（被派活的工人）**：
1. 先读派活 brief 点名的文件；brief 没写的**不要自己扩范围**，发现了问题写进报告。
2. 收工报告**必须包含可复现的验证输出**（命令 + 实测结果尾部），不是「已完成」三个字。
3. 判据红/做不到/前提被证伪时：如实写 `blocked` + 阻塞点，**不要**为了让数字好看而放宽判据
   （尤其不许改 `timeGolden`/`timeFillRatchet` 基线、不许删断言、不许改 `frozen` 常量以求绿——
   这些正是护栏要拦的）。
4. 报告文件写在派活指定的路径（第一行 `STATUS: done|blocked`），**最后一条回复也带一行 STATUS**
   （双通道，报告丢了管理员还能从对话里回收）。

## 6. 子代理模型路由（派发 workflow/subagent 前必读）

派发子代理前先读 `~/.dsh/model-routing.yaml`（**它是单一事实源**，本节只是摘要；两者冲突以 yaml 为准）：

| 档 | 用途 | 默认路由（按序顺延） | effort 上限 |
|---|---|---|---|
| review | 代码审查、架构/接口设计、疑难诊断、验收评审、spec 拆分把关 | `wb/deepseek-v4.1-flash` → `wba/deepseek-v4.1-flash` → `wba/hy4-preview-f` | max |
| fast | 批量机械改动、跑测试、日志/数据汇总、文档生成 | `wb/deepseek-v4.1-flash`@low → `wba/deepseek-v4.1-flash`@low → `mimo/xiaomi/mimo-pro` | low~high |
| default | 未匹配到以上两档的兜底 | `wb/deepseek-v4.1-flash` → `wba/deepseek-v4.1-flash` → `mimo/xiaomi/mimo-pro` | high |

**可用性实测（2026-09-16 逐条真调，别再凭记忆）**：
- ❌ **`b-ai/qwen3.8-flash` 余额耗尽**（HTTP 400 `credit insufficient balance: balance=0`）⇒ **已从全部档位移除**。
  它此前是"最稳"保底，现已不可用；不要再把它当兜底。
- ✅ `wb/deepseek-v4.1-flash` · `wba/deepseek-v4.1-flash` · `wba/hy4-preview-f` · `wb/hy4-preview` · `mimo/xiaomi/mimo-pro`
- ⚠ `wba`(7865) 上游**要求首条消息是 system prompt**：裸调（首条为 user）会被
  `400 upstream_rejected: blocked by security policy` 拦下；带 system 立刻 200。
  **DSH 调用天然满足**，所以 DSH 内无需担心——但**手写 curl 探活时别据此误判"wba 挂了"**。
- ⚠ 探活踩坑：推理模型先吐 `reasoning_content`，`max_tokens` 给小（如 16）时 `content` 会是空串
  ⇒ 别把「空 content」当成「模型坏了」（加大到 200 后全部正常）。

- 显式钉档：`workflow` 的 `agent(prompt, { provider, model })`；同一 workflow 可按 phase 分档
  （如调研用 fast、实施用 review）。
- 白名单：模型须在 settings.yaml `subagent-model-selection.allowedModels` 内，否则界面上选不到。
- effort 必须落在该模型 `reasoningEfforts` 声明内；`max` **wb / wba 有，mimo 没有**（上限 high）。
  ⚠ 且**档位 ≠ 强度**：2026-09-14 四模型横评实测「四款全部不随 effort 档位单调缩放」（`~/.dsh/model-routing.yaml` 头），
  别把 `max` 当"更聪明"用；hy4-preview-f 另有下限（思考预算 3k 会截断失败、12k OK）。
- 档内 candidates 按序优先，失败（402 / 余额不足 / UNSUPPORTED / 连接失败）顺延下一个；全失败降级 default 并写明原因。
- `wb`(7863,wb2api) 与 `wba`(7865,wbai-server) 是两个不同网关；hy4-preview-f 仅 wba 有。
- ⚠ **`@snowamberx/dsh-role-router` 已彻底移除（2026-09-16，用户裁决"整体关掉也行"）**。
  它曾按角色强制改写路由（`subagent` 角色被写死为 mimo-pro@high），由此产生的
  「派子代理会被强制改路由到 mimo 并夭折」**已彻底失效** ⇒ **子代理现在完全按你指定的 provider/model 跑**。
  移除面（4 处，全部已清）：`~/.dsh/profiles/web/` 的 `package.json`（依赖 + `dsh.profile.bundles`）、
  `cordis.yml`（composition 条目）、`cordis.patch.yml`（patch 段，现为合法空数组 `[]`）、
  `pnpm-lock.yaml`、`node_modules/@snowamberx/`。
  （顺带清掉了 `dsh-codearts-auth` 的卸载残留条目。）
  **若将来又想按角色分流**：装回该插件即可，但记住它的优先级**高于** `model-routing.yaml`。
- **怎么知道子代理实际跑了哪个模型**（前端不显示）：① 工具 `_dsh_external_subagent_model_badge_status`
  （badge 插件账本，权威）；② 直接读子代理 session log 的 `request/header.data.header.config`。
  实测 badge 账本可能不含最新记录（按需拉取非轮询）⇒ 要精确值就读 log。
- 想换档位模型：改 `~/.dsh/model-routing.yaml`，不要改本节。
