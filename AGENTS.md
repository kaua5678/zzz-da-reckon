# AGENTS.md

> 本仓库：ZZZ 伤害计算器（Vue 3 + TypeScript + Vite + Naive UI + Pinia + Vitest）。
> **任何改动前必读本文件；"这代码怎么跑 / 该改哪"先查下面的导航文档，不要从零翻目录。**

## 0. 任务分级：先认档，再按档读文档

| 档 | 适用 | 必读 | 可跳过 |
|---|---|---|---|
| `fast` | 改 UI / 文案 / 单条测试 / 单文件小修 | 本文件 §1（含规则 15）+ 目标文件头注释 | docs 全套（涉及页面时扫一眼对应 .vue 与 AppHeader） |
| `full` | 录角色 / 补机制 / 改引擎 / 排查 buff 没生效 | 本文件 §1 + `docs/ARCHITECTURE.md` §3 + 对应管线文档 | `docs/mechanism-reference.md` 纯参考可不读 |
| `loop` | 跨多文件重构 / 批量迁移 / 数据管道改动 | `full` 全部 + 本文件 §4 长任务账本 | — |

`full` / `loop` 档的**读法：步骤必读、参考按症状查**。参考文档里的具体案例（某角色某坑）换到新角色往往无法类比——不要通读整篇参考，命中哪条读哪条：

| 何时 | 读哪个 |
|---|---|
| 开工前（必读） | 本文件 §1 + 下方录入步骤 + `AGENT_RECORDING_SOP.md` §6.10 完成清单 |
| 拿到任务先查「改哪」 | `ARCHITECTURE.md` §3 决策树，只读命中那一行 |
| 实现中卡住 / 数值不对 / 报错 | `ENGINE_PIPELINE_GUIDE.md` §4 坑表，按症状查对应条 |
| 命座提升率异常 / 写测试 / 录拐力 | `AGENT_RECORDING_SOP.md` §3.5 根因表 / §5 模板 / §6 |
| 录新角色前做模式匹配 | `MECHANIC_PATTERNS.md` §2，只读命中的 1 个维度（D1–D9） |
| 中文术语→字段不确定 | `GAME_TERM_TO_CODE_FIELD.md` 对应章节 |
| **要断言「X 的专武/归属/属性是 Y」或查实体结构** | `ENTITY_CARDS.md`（实体卡）+ 先跑 `node scripts/resolve.mjs` 查证 |

### 录入角色 / 补机制：五步（仅此类任务）

1. **读 nanoka 原文自主分析**（`data/raw/nanoka_missing/full/<id>.json`）：逻辑/资源/字段/数值原文都给了，只把「原文没数值 / 口径歧义 / 引擎缺通道」列清单一次问用户——`AGENT_RECORDING_SOP.md` §0.5。
2. **检索角色档案段**（`grep -n "角色名\|agentId" docs/MECHANICS_IMPLEMENTATION.md`）：读该段已确认口径 + 未建模项。无状态行 = 段未核对，先核现状再补状态行。
3. **模式匹配**：`MECHANIC_PATTERNS.md` §2 定位 1 个维度（D1–D9），按该维度既有做法实现，不造新乘区。
4. **实现**：卡住/数值不对/报错才按症状查 `ENGINE_PIPELINE_GUIDE.md` §4、`AGENT_RECORDING_SOP.md` §3.5。
5. **交付**：过 `AGENT_RECORDING_SOP.md` §6.10 完成清单 → `npm run verify` + `docs:status`；同步档案段与状态表。

其他任务（改引擎/排查/UI）不需读原文/档案。未收录的新角色以 spec notes + raw 数据为准。

## 1. 硬性规则

1. **基线先绿再动手**：改代码前跑 `npm run check` 确认通过；改完跑 check + `npm run typecheck` + `npm run build`（验收命令见 §3）。
2. **数值唯一事实源 = `public/static/catalog.json`**：改数值走 `scripts/` 导入/爬取脚本重跑，不要手改 JSON 本体。
3. **执行行匹配一律用 `moveId`**，不按 name/note（`enrichExecutionPlan` 会从倍率表回填覆盖它们）。
4. **自定义 TS 模块角色**（`src/mechanics/agents/*.ts` 注册过）的 spec 字段是死数据：adjustable 滑块/attributeConversions 必须在模块里实现，spec 只作记录（`validate:specs` 已强制：模块角色的 attributeConversions 必须可证明被消费——模块显式调用 `applySpecAttributeConversions` 或条目 note 标注「实现位置：」，否则校验失败）。
5. **每个录入的机制 = spec 字段 + 生效测试**；命座效果录完跑一次「资源利用率页·命座提升率」确认无橙色「⚠无变化」警示（效果未接进计算的信号）。该自检已有自动化护栏兜底：`allAgentsSweep` 断言「声明已实现命座的角色 C6 伤害 > C0 伤害」，逐级三态判据在 `composables/cinemaUplift.ts`（页面与测试同源）——但页面自检仍要跑，它能定位到具体是哪一级。
6. **跨角色/队伍级机制走 `applyTeamConfig` 钩子**（三阶段 build/converge/postRound，见 `docs/ENGINE_PIPELINE_GUIDE.md` §2），禁止往 `useResourceCalc` 新增 `agentId === 'xxxx'` 分支（机器护栏：`check-guards` 棘轮冻结存量基线，新增即红；存量清零后下调基线）；面板阶段的覆盖率滑块直接读 `AgentPanelInput.settings`，不要经 panel 字段走私（曾致般岳滑块静默失效）。
7. **spec 文件名必须是 `<agentId>.json`**（`validate:specs` 强制）：拼音 slug 会与别的角色撞车（`juhufu`=朱鸢 vs `jufufu`=橘福福），改错文件代价极高。
8. **知识单一事实源在代码**：改代码时同步更新受影响的文档（`docs/` 清单见 README §6）；不要新建"复述代码"的文档，优先更新决策树条目。
9. **完成必须声明 verifier + coverage**：每个改动结束时，回复里写明——由哪个命令/测试证明它生效（verifier），以及影响范围（哪些角色/页面/文件）。没有测试覆盖的改动先补测试，不算完成。
10. **check 失败先诊断再动手**：先读失败断言/错误文件，写一句根因，再修。禁止不读输出直接重跑或直接改测试；若根因指向测试本身，先复核口径再改。**红基线不允许过夜**：曾有一条 `yixuanSmoke` 断言被当成"既存红"跨多个任务放着，而 CI 里文档漂移检查排在 `npm run verify` 之后同一 job——一红全哑、护栏整张失效（该 job 已拆开）。
11. **跨文件常量只从单一来源引用**：能量/喧响/倍率/异常等共享数值必须引用 `core/`、类型定义或 `statMeta` 中的常量，禁止在模块/页面里复制字面量；改口径先改源，再跑 check。跨角色回能只改 `calcCrossAgentEnergy`（单一事实源）。
12. **最小实现阶梯（只约束「写多少」，不约束「对不对」）**：写码前停在第一档能成立的——①这功能真要建吗（YAGNI）②仓库已能复用吗（规则 11 + 决策树）③语言/平台/已装依赖能覆盖吗（ES·TS 内置 → Vue/Naive UI/Pinia 自带 → 已装包）④一行能搞定吗 ⑤才写最小可用。阶梯缩短**解法**，永不缩短**读懂**与**验证**：规则 5/9/10/11 与领域档案（`docs/MECHANICS_IMPLEMENTATION.md` 的口径与未建模项）优先于本阶梯。有意简化且砍了真实角落（O(n²) 扫描 / naive 启发式 / 全局近似 / 暂未建模）时，就地写 `debt: <天花板>, <升级路径>` 注释，供 `grep -rn 'debt:' src scripts` 回收进账本 Open 段；**新增 debt 标记必须在 `check-guards` 的 DEBT_REGISTRY 登记（since/due），还清时销号，漏登记即红**。
13. **共享工作区显式路径提交**：只 `git add <改动文件>`，把 `-A`/`--all` 当禁区（会卷走并行会话 WIP，历史事故 ×2）；`.claude/ledgers/`、`.zcode/` 已 gitignore 且 `check-guards` 拒绝其被跟踪——但**源码级 WIP 仍靠本条文字规则**（git 事后无法区分谁改的）；改共享文件后**写后即验**（`grep`/`git diff --stat` 确认落盘），不 `git checkout` 还原他人编辑中的文件。
14. **生成产物与行尾由环境强制**：`public/static/*.json` 紧凑写、`catalog.json` 顶层键 == `Catalog` 字段由 `validate:data` 强制（红 → `npm run minify:static`）；行尾统一 LF 由 `.editorconfig`/`.gitattributes` 强制，python 改文本文件用 `newline=''` 防 CRLF 翻面 churn（历史事故 ×2）。
15. **跨实体断言必须查证，派生数值必须问引擎**：凡要写「X 的专武/归属/属性/数值是 Y」（音擎↔角色、套装↔效果、id↔名字），先跑 `node scripts/resolve.mjs <类型> <名|id>`（`docs/ENTITY_CARDS.md` §0），输出引用一律用 `名字(id)` 绑定格式；歧义或未命中时工具 exit 1，**绝不凭名字联想静默选最像的**（游戏名词在训练分布里有强先验，名字联想断言能一路通过不报错——2026-08-30「心弦夜响→仪玄专武」事故 ×2 同日）。面板/暴击预算等**派生数值以引擎探针为权威**（`PROBE_AGENT=<id> npm run probe:panel`），禁止手工汇总 catalog JSON。

## 2. 常见任务入口（完整决策树见 docs/ARCHITECTURE.md §3）

| 任务 | 改哪 |
|---|---|
| 录新角色 / 补机制 | `src/specs/agents/<agentId>.json`（文件名必须=agentId）+ `src/mechanics/agents/<id>.ts`（注册进 `src/mechanics/index.ts`） |
| **跨角色 / 队伍级联动** | 角色模块自己的 `applyTeamConfig`（三阶段）；派发器在 `resourceCalc/helpers.ts`，勿动 `useResourceCalc` |
| **加一个可调滑块** | 模块 `settings` 声明 + 面板阶段读 `AgentPanelInput.settings`；必须补「改滑块→结果确实变」生效测试 |
| 改伤害公式 / 乘区 | `src/core/damage.ts`（乘区顺序 = 代码顺序） |
| 改资源池 / 失衡 / 异常 | `src/core/resource*.ts`、`src/core/stunPool/`、`src/core/anomalyPool/`；跨角色回能只改 `calcCrossAgentEnergy` |
| 改面板 / 转模 / 局外局内 | `src/composables/resourceCalc/helpers.ts`（computePanelPhases） |
| 改失衡轴 / 自动轴 / 预设 | `src/data/stunAxisPresets.ts` + `src/data/stunAxisPresets/*.json` |
| 排查 buff / 命座没生效 | `docs/AGENT_RECORDING_SOP.md` §3.5 根因表；页面「命座提升率」自检 |
| **改抽卡价值 / 抽卡成本** | **UI 实际用的是期望值口径**：`src/composables/pullValue.ts`（每万菲林兑现 ROI，单一事实源 = `data/filmEconomy.ts`）+ `src/composables/pullPlannerEngine.ts`（规划器，TIER_COSTS 常量价）；`src/core/gachaCost.ts` / `src/core/acquisitionValue.ts`（保底状态定价 / 概率口径抽取价值）是**引擎层未接线**——仅测试与校准用，改它们要同时确认没有消费者声称接 UI（2026-09-01 用户裁决：模拟抽卡运气不接产品，直接用期望值） |

## 3. 验收命令

```bash
npm run verify        # check-guards + validate:data + validate:specs + verify:recording + vitest + typecheck + build（一条链）
npm run check-guards  # 机器护栏：fetch-stub 冻结（§3 harness 纪律）/ useResourceCalc agentId 棘轮（规则 6）/ 工作区状态防误提交（规则 13）
npm run verify:recording  # 录入完成判据：声称 implemented 的角色必须有测试引用 + expect 断言 + 档案状态行
npm run docs:status   # 重新生成 docs/implementation-status.md（CI 会检查漂移，漏跑即红）
npm run minify:static # 生成产物瘦身/剔 catalog 死键（幂等；validate:data 报产物膨胀时用它修）
npm run probe:calibration # 实战归档校准（真引擎批跑投稿，出误差分布/击杀混淆矩阵/分层偏差，写 .zc/calibration.json）
```

**校准只是诊断，不是判据**（用户裁决 2026-09-01）：`npm run probe:calibration` 按需跑，出误差分布/击杀混淆矩阵/分层偏差，**不进 CI、不设基线、不作拟合目标**——当前每支队伍的计算逻辑都还不准，把「距离归档分数」冻成判据会惩罚方向正确但单步之后暂时更远离实战的改动。用它找**低估**（上限低于真实发生过的成绩 = 可证伪的建模缺口，多半是机制没录完），不要用它调资源循环。

`verify:recording` 是**机器判据**——防止"写了代码改了 spec 就声称完成"：对每个 `status ∈ implemented*` 的角色，检查①测试文件引用 agentId（无=FAIL）②有 expect 断言（无=WARN）③档案段有状态行（无=WARN）。录入角色后跑它确认无 FAIL；WARN（档案无状态行）按 SOP §6.10 第 3 项补状态行后消除。

新测试一律用 `src/test/harness.ts`（`setupHarness` / `mockStaticFetch` / `setTeam`），禁止复制三文件 fetch stub（机器护栏：存量 stub 已冻结在 `scripts/check-guards.mjs` 清单里，新增即红；迁移一个到 harness 就删一行）；全局回归网 = `src/composables/__tests__/allAgentsSweep.test.ts`（60 角色 × 命座 0/6 不变量）。

**拿到任务先跑 `node scripts/zc.mjs brief "<任务一句话>"`**：它检索既有结构化表格（AGENTS §1 硬性规则 / §2 与 ARCHITECTURE §3 决策树 / ENGINE_PIPELINE_GUIDE §4 坑表 / AGENT_RECORDING_SOP §3.5 根因表）+ 任务里提到的 agentId 的既有口径与覆盖测试，**每条带「文件:行」出处**，一页顶替扫 650KB 散文。命不中会直说「决策树没命中 → 自己读 ARCHITECTURE §3」，不编答案；命不中且你做完了，就往决策树补一行。

**开局/收工走 `zc`（agent 专属入口，v0；带 `--` 参数一律用 node 直调，npm run 会吞掉 flag）**：`node scripts/zc.mjs status` 一条命令给全开局考古（分支/未推送/工作区改动/**疑似并行会话在改的文件**/债务/待办/最近验证记录）；动手前 `node scripts/zc.mjs claim <文件…>` 占道（规则 13 的机器面，冲突大声失败）；收工 `node scripts/zc.mjs done --verifier <命令> --coverage <范围>` 把规则 9 的声明落进 `.zc/journal.jsonl`（否则它只活在聊天里，下一个 agent 继承不到）；查口径 `node scripts/zc.mjs facts agent:<id>`、查质量缺口 `--gaps`、打印事实语法 `node scripts/zc.mjs lang`（语法唯一定义在 `scripts/zc.mjs` 的解析器里，不另写文档）。

**定了新口径就写成一行 `@fact` 钉在实现旁边**（不要再写成段落散文）：`@fact <主体> <种类>: <内容> | 据 <谁定的@日期> | 验 <测试> | 锚 <路径>#<符号> | 信 <确认/高/中/低>`。机器判据（`check-guards` 判据 6）：手写事实必须有「据」且「锚」解析得到，**断锚即红**（锚符号被改名/删除 = 口径已过期）；锚文件在「据」之后被改过的口径进 `node scripts/zc.mjs drift` 复核队列（只报不红——红了会逼人改日期作弊）。既有 spec notes/模块注释里的散文口径是存量，`zc facts` 会自动抽取（当前 630 条 / 结构化率 10%），不必回头迁移。

查证与探针（规则 15 的工具面，详见 `docs/ENTITY_CARDS.md` §0）：`node scripts/resolve.mjs <音擎|角色|专武|套装|boss|buff|spec|audit> <名|id>` 实体解析（歧义大声失败）；`PROBE_AGENT=<id> npm run probe:panel` 面板探针（副词条/音擎/命座/套装可经 `PROBE_SUBSTATS/ENGINE/MOD/CINEMA/FOUR/TWO` 覆盖，默认口径=专武精炼1·命座0·配装推荐主词条）。

## 4. 长任务账本（loop 档）

`loop` 档任务开工时，在当前工作区维护 `.claude/task-ledger.md`（已 gitignore，不提交；属于工作状态，不是项目知识）。固定四段：

- `Goal`：完成定义（用户可验证的结果）
- `Next`：当前唯一的下一个动作
- `Checkpoint`：已完成且已通过验证的步骤（每条写 verifier + coverage）
- `Open`：未决问题与待确认口径 + 代码 `debt:` 标记回收（`grep -rn 'debt:' src scripts`，防「later = never」）

每完成一个文件/模块，更新一次 `Next`；跨会话/长间隔恢复时先读账本再接续。短任务不建账本。
