# 下一轮现场执行单（round2 已填写）

> 由本地首席协调 agent 填写，配合 `round2-intent-charter.md` 使用。
> 本文件是 round2 的**现场填写版**；原始空白模板见 git 历史（首轮由云端作者提供）。
> 填写时间基准：2026-09-22（本地首席现场核验）。

## 1. 继承哪些结论，不继承哪些操作

**继承（经本轮现场归类，来自上一轮已交付报告，非云端作者核验）：**
- 上轮 B1 已证伪"双写者"立项前提（62 角色全扫零命中），并命中唯一实例 1511 已由 B2 点修复。**不默认启动后续重构，不换名重开同一课题。**（证据：`.zc/reports/B.md`、`B2.md`）
- 上轮"先复现、再实施"切分有效（A1.a→A1.b）。保留该方法。
- 上轮工具/路由/环境描述错配。本轮**不复制其参数**；下表能力项全部为本轮**现场重新核验**的值。

**上轮任务归类（首席从可信记录归类，非全面再审）：**
| 上轮任务 | 归类 | 证据 |
|---|---|---|
| A1.a ui-check 假绿复现 | 已完成（confirmed） | `.zc/reports/A.md` |
| A1.b ui-check 失败判定修复 | 已完成，已合入 `4caca1d` | 提交 + verify EXIT 0 |
| B1 四 override 审计 | 已完成（双写者证伪 / 1511 命中） | `.zc/reports/B.md` |
| B2 1511 C4 点修 | 已完成，已合入 `dd44467` + 基线 `45fd575` | 提交 + verify EXIT 0 |
| C1 1091/1171/1431 档案段 | 已完成，已合入 `ed8777e` | 提交 + verify:recording 12→9 |
| C1 遗留 4 处"待核对"不一致 | **未收口，是本轮选题来源** | `.zc/reports/C.md` LIMITS② |
| 全库 override 泛化重构 | **已证伪，不立项，不重开** | B1 闸门结论 |

## 2. 现场事实与授权

| 项目 | 首席现场填写 | 证据出处 / 核验时间 |
|---|---|---|
| 本轮负责人及会话标识 | 本地首席协调 agent（用户称 KimiK3），DSH 会话 `session-3fc5c69a-1dc2-441e-b315-f0cc53c67ac8` | zc done lane，2026-09-22 |
| 目标项目/系统及实际位置 | ZZZ 伤害计算器（Vue3+TS+Pinia+Naive UI+Vite+Vitest），`/home/kaua/projects/zzz-calculator`（WSL 原生路径） | pwd，2026-09-22 |
| 当前修订、工作区/暂存状态 | HEAD `45fd575`（timeGolden 基线提交）；tracked 工作区干净；untracked 多为 `.claude/` 历史交接（保留，不属本轮） | `git log`/`git status`，2026-09-22 |
| 已有任务、文件归属及需保留的工作 | zc 警告的 2 个"疑似并行会话在改"文件 = `docs/round2-field-sheet.md`/`round2-intent-charter.md`，归属 = 用户经云端作者刚放入（mtime 45 分钟内），**非他人 WIP，无冲突**；其余 68 untracked 保留 | `zc status`，2026-09-22 |
| 上轮已收口与明确不立项事项 | A1.a/A1.b/B1/B2/C1 已收口；全库 override 泛化重构**已证伪不立项**；R48-J2 十五轮判死**不重做** | 见 §1 |
| 本轮仍活跃的用户需求或候选问题 | ①miyabi(1091) 额外能力漏判 `sameFactionAsSelf`；②burnice 死引用 verifier；③yeshuguang formAxis 默认值口径；④miyabi 冰焰覆盖率文案与常量矛盾 | C1 报告 LIMITS② + 本轮现场复验（见 §4） |
| 当前有效基线及其覆盖边界 | verify EXIT 0：3383 passed/29 skipped、20 guards/12 tokens/365 data/1055 specs/189 recording(9 warn)；timeGolden 已含 1511 修正。timeGolden 全盲于"有空槽队伍"（105 预设全满槽） | `zc done` 最近验证 2026-09-22T12:37 |
| 用户授权范围与现行项目规范来源 | 有边界的本地实现、独立分支小提交、经审查的本地集成；**默认不推送、不部署**。规范单源 = `AGENTS.md`（§1 硬规则/§3 验收/§5 多工人/§6 路由）+ 本 round2 意图书 | 用户指令 + AGENTS.md，2026-09-22 |
| 待用户裁决、不得夹带实施的事项 | OPEN-ITEMS D1–D4（未认领招式易伤口径/字段迁巨型接口/删 attributeRefs/跨页样式统一）；59 个 legacy 全面清空；业务口径未确认项 | AGENTS.md §5、工作规划 §7 |

## 3. 操作能力与资源——全部现场确定

| 项目 | 首席现场填写 | 证据出处 / 核验时间 |
|---|---|---|
| 实际派工接口、schema 与结果回收方式 | **`workflow`**（JS 脚本编排 `agent(prompt,{provider,model})`，one-shot 子代理）。**`subagent` 无 provider/model 参数**（默认 follow-official→主代理模型，上轮误用被用户拦下）。结果回收：子代理 final text 随 workflow 完成通知返回，首席落盘 | 本轮现场复验（r2-route-probe + badge 账本），2026-09-22 |
| 模型选择方式、继承/覆盖规则 | `workflow` 的 `agent()` 显式 `{provider:'wb', model:'deepseek-v4.1-flash'}`；role-router 插件已移除（`~/.dsh/profiles/web/cordis.patch.yml` 零命中），声明=生效 | badge 账本 `overridden:false`，2026-09-22 |
| 能核验的实际执行身份；无法核验的部分 | 可核验：badge 账本 `~/.dsh/subagent-model-badge/ledger.json` 的 effective provider/model。本轮探针 → `wb/deepseek-v4.1-flash@max`，未覆盖。**不可核验部分：无**（路由回执可信） | r2-route-probe，2026-09-22 |
| 当前运行环境与命令入口 | DSH bash 工具**原生跑在 WSL**（cwd 即项目 Linux 路径），无需 wsl_exec/UNC。node/npm/vitest/git 直接在项目路径执行 | 本轮各命令实测，2026-09-22 |
| 工作位置、隔离方式及路径对应关系 | 主目录 `/home/kaua/projects/zzz-calculator`；工人独立 worktree `.zc/worktrees/<name>`（`.zc/` 已 gitignore），node_modules symlink 自主目录 | `git worktree list`，2026-09-22 |
| 本轮实际验证命令及各自证明范围 | 工人定向：`check-guards` + 相关 `npx vitest run <文件> --maxWorkers=1` + `vue-tsc -b`。首席统一：`VITEST_MAX_WORKERS=4 npm run verify`（全量）+ ui-check 负控重放（行为） | 本轮执行单 §5，2026-09-22 |
| 并发、重计算与费用预算及依据 | 最多 2 工人并行；最多 1 个重计算/构建/浏览器时段（全量 verify 仅首席在工人停后跑一轮）；DSFlash@max 按需 | round1 经验 + AGENTS §5，2026-09-22 |
| 日志、报告、产物位置与生命周期 | 报告固定 `.zc/reports/r2-<任务>.md`（首席落盘）；实验产物 `.zc/experiments/`（gitignore）；浏览器产物 `/tmp/zzz-r2-*`（会话后清理） | 本轮约定，2026-09-22 |
| 中断、失联或未知执行结果的核查方式 | workflow job 用 `job_output`（wait）/`job_kill`；子代理路由用 badge 账本复核；命令退出码以日志为准，断流不代表未执行（先查日志再决定重放） | DSH 工具 schema，2026-09-22 |

**独占资源登记（本轮实际用到）：**
| 用途 | 实际资源标识/地址 | 使用者 | 隔离与冲突检查证据 | 释放责任 |
|---|---|---|---|---|
| 派工接口 | workflow（one-shot agent） | 首席 | subagent 已确认无路由参数（上轮 badge 记录 follow-official→k3） | workflow 完成即回收 |
| 工人工作树 | `.zc/worktrees/r2-*` | 各工人 | `git worktree list`，分支独立 | 首席集成后 `git worktree remove` |
| 全量 verify（重计算时段） | `VITEST_MAX_WORKERS=4 npm run verify` | 仅首席 | 工人停后、端口 93xx free 时执行 | 单轮，日志 `/tmp/lead-r2-verify.log` |
| 浏览器负控（如需） | CDP 939x + 静态 938x + `/tmp/zzz-r2-*` | 首席/工人 | `ss -ltn` 查端口、`pgrep chrome` 查残留 | 用后 pkill + 端口确认 |

**无法核验项说明**：派工接口/路由/身份本轮均可核验（见上），无授权/安全/验收关键缺口。

### 历史经验的使用记录
| 拟参考的经验 | 来源会话 / 时间 | 当时适用条件 | 可能过期之处 | 本轮是否复验及结果 |
|---|---|---|---|---|
| "workflow agent() 可路由 DSFlash，subagent 不能" | round1 本会话 / 2026-09-22 | 当时的 DSH 配置 | 路由/插件可能再变 | **已复验**：r2-route-probe → `wb/deepseek-v4.1-flash@max` 未覆盖，仍有效 |
| wsl_exec/UNC 那套（ShunCode 会话遗物） | 上一外部会话 | ShunCode MCP 环境 | **本轮 harness 原生 WSL，完全不适用** | **已复验**：bash 直跑 WSL 路径，不采用 |

## 4. 现场选题与本轮范围

| 候选编号/名称 | 当前用户收益 | 与已完成/已证伪事项的区别 | 证据缺口与最小验证代价 | 本轮选择/排除理由 |
|---|---|---|---|---|
| **R2-A：miyabi sameFactionAsSelf 漏判** | 队含悠真(1201)且无支援/异常时，霜月+60% 与 30% 冰抗无视真实丢失（aa 是活门控 L115-122）——修复让计算符合 spec 口径 | 非 B1 已证伪的双写者泛化；是单点实现与 spec 矛盾。非 R48-J2 死通道（aa 有活消费者 `if(aa)`） | 已现场复验：spec `teamConditions` 含 `sameFactionAsSelf`，模块 `isAdditionalAbilityActive` 漏该臂（L75 `member.agent.id===agent.id` 恒假）；悠真与 miyabi 同属第六课（resolve 实证）。最小验证 = 含悠真队跑 aa 判定探针 | **选择**：真实机制 bug、有 spec 原文证据、有行为影响、点修非泛化。符合云端候选一 |
| **R2-B：burnice 死引用 verifier 修正** | `@fact` 指向不存在的 `burniceCinemaTier.test.ts`，误导后继复核者 | 非重复结案检查；是唯一真源（注释）与可核对实现的偏差 | 已现场复验：文件不存在（仅 claret/grace/nekomata 三份 CinemaTier）；实际判据在 `potentialAxisBatchB.test.ts`+`burnice.test.ts:134`。最小验证 = 改一行注释引用 | **选择**：云端候选二（误导决策的陈述），低风险唯一真源修正 |
| **R2-C：yeshuguang formAxis 默认值口径核对** | 滑块注册 default 与 `@fact`/文案"默认自动(-1)"矛盾，误导对默认行为的判断 | 同上 | 已现场复验：`record[...] ?? 'auto'`(L150)、`input.formAxis ?? 'full'`(L210)、测试夹具显式注 -1。需先定**正确默认口径**再改 | **选择（先取证）**：是"文档陈述 vs 实现"偏差，但**改哪个方向需先确认口径**——先只读取证，若属实现 bug 则另授权，若属文案错则改文案 |
| **R2-D：miyabi 冰焰覆盖率文案矛盾** | 常量 `MIYABI_C0_ICEFLAME_DEFAULT_COVERAGE=0` 与滑块文案"0命无风队=60%"矛盾 | 同上 | 已现场复验：常量 0（L28）、autoDefault 逻辑（L148）。文案"60%"是错陈述 | **选择（改文案）**：数值口径以常量 0 为准（用户在案），仅订正滑块文案，不改数值 |
| 全库 override 泛化 / legacy 清空 | — | **已证伪/超范围** | — | **排除**：B1 已证伪，不重开；legacy 清空待用户裁决 |

**本轮范围**：R2-A（先复现取证→获准后点修）、R2-B（改注释）、R2-D（改文案）、R2-C（先只读取证，按结论分流）。不继承旧操作参数；不重复已收口/已证伪事项。

## 5. 每条任务的生效卡

### 任务 R2-A / miyabi(1091) 额外能力漏判 sameFactionAsSelf

- 任务标识、负责人：R2-A；DSFlash 工人（workflow 派，wb/deepseek-v4.1-flash@max）；首席复核
- 具体对象、用户影响、约定观察出口：`src/mechanics/agents/miyabi.ts isAdditionalAbilityActive`；影响 = 含悠真队 miyabi 面板 `enemyIceResReduction`/`skillDmgBonus__basic`；观察出口 = 面板这两个字段 + 队总伤害差分
- 已知事实及来源：spec `1091.json additionalAbility.teamConditions` 含 `{type:sameFactionAsSelf}`；模块 L72-79 三臂判 support/anomaly/`member.agent.id===agent.id`（恒假，自身槽已排除）⇒ 漏 sameFactionAsSelf；悠真(1201)与 miyabi(1091)同属第六课（resolve 实证）；aa 是活门控（L115/120 `if(aa)`）
- 仍不确定、需本任务验证：修复后含悠真队的 aa 是否变 true、面板两字段是否出现、C0/无悠真队是否零影响

**前提假设：** `isAdditionalAbilityActive` 未判 `sameFactionAsSelf` 臂，导致队含同阵营悠真（强攻、非支援/异常）且无支援/异常队友时 aa=false，使 L115-122 的 30% 冰抗无视与霜月+60% 未加进面板——与 spec 声明的额外能力激活条件不符。

**假设为假时的可观察失败：** 用 `setupHarness` 组 miyabi+悠真队（无支援/异常），若**修复前** `aa` 已判 true 且 `enemyIceResReduction`/`skillDmgBonus__basic` 已按额外能力加上 ⇒ 假设为假（漏判不存在或已被别处补偿），**停止点修**，报告证伪 + 实际门控路径，不改 miyabi.ts。若 aa 漏判但面板字段本就零消费者 ⇒ 转 R48-J2 死通道形态，同样停止并报告。

### 范围、方法与授权（R2-A）

- 本阶段：**先只读取证（复现）**，经首席审查证据后**才授权实施**；授权依据 = round2 意图书 §5"先复现/取证与后实施是两个授权阶段"
- 精确读取入口与最小文件/对象白名单：取证阶段只读 + 实验脚本 `.zc/experiments/r2-miyabi/`；实施阶段（获准后）白名单 = `src/mechanics/agents/miyabi.ts` + `src/mechanics/__tests__/miyabiCinema.test.ts`（或新增 `miyabiAdditionalAbility.test.ts`）+ `docs/MECHANICS_IMPLEMENTATION.md` 1091 段
- 禁止改动：其他角色模块/数值/spec 状态/legacy；timeGolden.baseline.json（基线由首席统一归因）；不跑全量 verify
- 正控、反控及预期原因：正控 = miyabi+悠真队修复后 aa=true、面板两字段出现；反控 = miyabi 单飞 / miyabi+非第六课队友（如非同阵营强攻）aa 仍 false；零影响面 = 不含悠真的既有队伍计算零变化
- 阶段完成判据（与立项闸门分开）：复现阶段 = 给出 aa 在含悠真队的实测真假 + 面板字段有无；实施阶段 = 修复后 aa 正确、测试先红后绿、零影响面确认
- 实际执行方法、验证命令及依赖：`setupHarness`/`setTeam` 组队读面板；`npx vitest run <miyabi 测试> --maxWorkers=1`；`check-guards`；`vue-tsc -b`；数值变化时 `npx vitest run timeGolden` 量差归因（不重生成）
- 报告/产物位置与执行证据要求：`.zc/reports/r2-A.md`（首席落盘）；含 aa 实测表、面板字段差分、先红后绿证据、零影响面
- 预算、停止条件与升级条件：若 correct 口径涉及"同阵营到底怎么定义/faction 数据来源不明"等业务歧义，或修复导致非预期大面积数值漂移，停止并升级用户

### 任务 R2-B+D / burnice 死引用 + miyabi 冰焰文案（唯一真源修正）

- 任务标识、负责人：R2-BD；DSFlash 工人；首席复核
- 具体对象、约定观察出口：`burnice.ts:56` `@fact` 「验」槽位死引用；`miyabi.ts` 滑块 `iceFlameCoverage` 文案"60%"与常量 0 矛盾
- 已知事实：`burniceCinemaTier.test.ts` 不存在（实际判据在 `potentialAxisBatchB.test.ts`+`burnice.test.ts:134`）；`MIYABI_C0_ICEFLAME_DEFAULT_COVERAGE=0`（L28，用户在案口径）

**前提假设：** burnice.ts 的 `@fact` 「验」槽位引用不存在的测试文件，且 miyabi 冰焰滑块文案与实际常量矛盾——两处都是会误导后继复核者的"陈述与可核对实现/真源不一致"。

**假设为假时的可观察失败：** 若 `burniceCinemaTier.test.ts` 实际存在（本轮复验已确认不存在）或 `potentialAxisBatchB` 不含 1171 潜能判据，或冰焰文案并非错误 ⇒ 停止修改，报告证伪。复验已排除，故本任务为低风险的唯一真源/指针修正。

### 范围、方法与授权（R2-BD）

- 本阶段：**已获准实施**（纯注释/文案修正，无数值影响，风险极低）；授权依据 = round2 候选二"成立时只修正唯一真源或必要指针"
- 白名单：`src/mechanics/agents/burnice.ts`（仅 `@fact` 「验」槽位一行）、`src/mechanics/agents/miyabi.ts`（仅滑块 `iceFlameCoverage` 的 description 文案）
- 禁止改动：实现逻辑、数值、其他 `@fact` 槽位（据/锚/信不动）；check-guards 不得因改 `@fact` 而红（锚符号必须仍解析得到）
- 正控、反控：正控 = 改后 `@fact` 「验」指向真实存在的判据文件；反控 = `check-guards` 仍 20/20（不断锚）
- 阶段完成判据：死引用消除、文案与常量一致、check-guards 绿
- 验证命令：`check-guards`；`npx vitest run src/mechanics/__tests__/burnice.test.ts src/mechanics/__tests__/miyabiCinema.test.ts --maxWorkers=1`（确认纯注释/文案改动无行为影响）
- 报告位置：`.zc/reports/r2-BD.md`
- 停止条件：若改 `@fact` 触发 check-guards 锚断，或发现"验"槽位修正牵涉口径争议，停止并报告

### 任务 R2-C / yeshuguang formAxis 默认值口径（先只读取证）

- 任务标识、负责人：R2-C；DSFlash 工人；首席复核后分流
- 具体对象、约定观察出口：`yeshuguang.formAxis` 滑块注册 default 与 `@fact`/文案/测试夹具对"默认档"的表述；观察出口 = 未动滑块时 `helpers.ts:632` 写入 cfg 的实际默认值
- 已知事实：`record[...] ?? 'auto'`（L150）、`input.formAxis ?? 'full'`（L210）、测试夹具显式注 -1（`yeshuguang.test.ts:254`）；`@fact agent:1431/自动选轴` 称"默认自动(-1)"

**前提假设：** 未动 `formAxis` 滑块时，实际默认落"打满(0/full)"而非 `@fact`/文案所述"自动(-1)"——即"文档陈述的默认行为"与"真实默认路径"不一致。

**假设为假时的可观察失败：** 若追踪 `helpers.ts:632` 注册 default 写入链后，证明未动滑块时实际落在"自动(-1)"（即 L150/L210 的 `??` 回落不被触发、或注册 default 本就是 -1）⇒ 假设为假，**无文档/实现偏差**，停止并报告真实默认链，不改任何文件。

### 范围、方法与授权（R2-C）

- 本阶段：**仅只读取证**（默认值口径是"特性还是 bug"需先定方向）；实施授权待首席按取证结论分流（若属实现 bug 改 yeshuguang.ts，若属文案错改文档，两者不同时做）
- 白名单：只读 + 实验脚本 `.zc/experiments/r2-yeshuguang/`；本阶段**不改生产文件**
- 禁止改动：本阶段一切生产/测试/文档文件
- 正控、反控：正控 = 实测未动滑块时 cfg 的实际 formAxis 值；反控 = 显式设 -1 / 0 的对照
- 阶段完成判据：给出"未动滑块时的真实默认值"+ 该值与 `@fact`/文案/测试夹具三者的一致性判定 + 分流建议
- 验证命令：实验探针 `npx vitest run --config <实验config> --maxWorkers=1`；只读 grep
- 报告位置：`.zc/reports/r2-C.md`
- 停止条件：若默认口径涉及"自动选轴是否应为默认"的业务取舍（非纯事实核对），停止并升级用户裁决

## 6. 首席的派发与回收检查

派发前已确认：操作字段（workflow 路由）本轮现场复验有效；任务卡含两行闸门 + 白名单 + 反控 + 停止条件；只传相关现场信息。回收时首席将独立核对：真实变更是否符合授权、证据是否属本次源码与本次运行、反例是否命中目标原因、合法对照是否仍正确、结论是否越过覆盖范围、已证伪方向是否真停。

## 7. 本轮最终回报

| 任务 | 结果：改进/有效否决/阻塞 | 核心证据与范围 | 未证明事项 | 已停止的后续工作 | 重开所需新证据 |
|---|---|---|---|---|---|
| R2-A miyabi 额外能力漏判 sameFactionAsSelf | **改进（已修复并合入）** | 悠真(1201)同阵营强攻队 aa=0→1、enemyIceResReduction 0→30、skillDmgBonus__basic 无→60；单源收敛到 evalAdditionalAbility；先红后绿亲验；提交 `63114dc` | 全队总伤增幅（仅量了雅槽 +28.95%/+30.53% 单行/槽级） | 泛化到 jane/remielle/norma/lighter/velina/alice 的同形手写实现（需另证共同原因） | 其他角色出现同类 sameFactionAsSelf 漏判的实测证据 |
| R2-BD burnice 死引用 + miyabi 冰焰文案 | **改进（已修复并合入）** | burnice.ts:56 @fact「验」+:54 注释死引用改指 potentialAxisBatchB；miyabi 冰焰文案 60%→0%；check-guards 20/20 锚 141/141；提交 `9017574` | 其他角色是否还有同形死引用（「验」槽位机器面不设防，无法自动发现） | 给「验」槽位加机器校验（R32-J3/R34 已裁决刻意不做判据，弱启发式假阳性 33%） | 出现具体某条死引用误导了实际决策的证据 |
| R2-C yeshuguang formAxis 默认值口径 | **阻塞（升级用户裁决）** | 我亲自核：滑块注册 default:0(打满)、description 自述「暂不作默认」（auto 有未闭环收敛债务 DEBT_REGISTRY 在案）、`@fact agent:1431/自动选轴` 写「默认自动(-1)」——**@fact 陈述与实现矛盾，实现是对的（有意默认打满）**；但 @fact 的「据」是用户裁决，改口径需用户确认 | — | 改实现把默认改回 auto（会引入未闭环的 auto 收敛债务） | 用户对「@fact 应改述为默认打满」或「auto 是否应重新作为默认」的裁决 |
| R2-E 1091.json 重复 teamBuffs 键 | **改进（已修复并合入）** | 全库唯一重复键（我亲扫）；L143 系 2f4cc8b 误加；口径有 C1 原文依据（talent.1 第二分句，我亲核）；删 L143 恢复 C1 全队积蓄+20%；先红后绿（on/off 都 0=静默丢失签名）；C1 队雅/队友各+20、C0/无雅队零变化；提交 `45b0f64` | coverage=1 对 uptime 的高估（全库口径，交用户滑块）；F1 雅叠加口径（升级用户） | 删 L110 的孤儿声明（误——L110 才是有意声明）；改 coverage=0.67（会红 specs.test.ts）；把 runArchiveDeploy ≥3 当既存红放过（夜） | — |

**补充（实际执行过的验证、纳入的变更、保留的风险、待用户决定的精确问题）：**

- **纳入的变更**（本地提交，默认不推送）：`63114dc`（R2-A miyabi 修复 + 5 测试）+ 合并提交；`9017574`（R2-BD 死引用+文案+档案段）+ 合并提交。R2-E 修复待回收后补。
- **保留的风险**：① R2-A 改 miyabi 计算，但 timeGolden/timeFillRatchet/allAgentsSweep 对其**全盲**（105 预设无雅队、60 角色单飞 aa=false），仅靠新增手组队测试（miyabiAdditionalAbility.test.ts 5 例）覆盖悠真队——这是 timeGolden「105 预设全满槽但无雅队」的已知盲区，非本次引入。② R2-E 的 C1 全队积蓄+20% 恢复生效后，**F1（雅本人是否叠加核心被动霜灼+20 与 C1+20=+40）是未裁决口径**，可能影响雅本人面板。
- **待用户决定的精确问题**：
  1. **R2-C**：yeshuguang formAxis 的 `@fact agent:1431/自动选轴` 写「默认自动(-1)」，但实现注册 default:0(打满)且 description 自述「暂不作默认」（auto 有未闭环收敛债务）。实现是对的，@fact 陈述错。是否把该 @fact 口径改述为「默认打满(0)，auto(-1) 为未闭环实验档」？（据=用户裁决，需您确认）
  2. **R2-E F1**：miyabi C1 时，核心被动霜灼「所有单位+20%(Lv.7)」与 C1 影画一「全队+20%(10s)」是否应在雅本人身上**叠加(+40)**？原文是两条独立效果（核心被动 vs 影画一、不同触发、不同数值），但模型把霜灼近似 100% 常驻可能导致虚叠加（C1 触发即消霜灼）。选「叠加(+40)」则删 L143 即完整；选「排除雅(+20)」需给 effect 加 excludeTargetAgentIds 字段+透传。
  3. **R2-E F2**（另立项）：核心被动霜灼「**所有单位**+20%」原文明写全队，但 miyabi.ts:159 只写雅自己 panel，队友拿不到霜灼的+20。是否另立任务用 teamPanelEffects 先例补传给队友？
  4. **R2-E F3**（登记）：tb.target/includeOwner 是死通道（37 条 spec teamBuff 一律含施放者）。是否登记为债务？
  5. **R2-E 护栏**：是否把 dupkey-guard-proto2.mjs（路径感知重复键扫描，~90行零依赖，正控5/5）接进 validate-specs.mjs？

报告位置：`.zc/reports/r2-{A,A-impl,BD,BD-fin,E}.md`。zc done 已落 `.zc/journal.jsonl`。
