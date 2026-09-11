# 架构评审快照（2026-09-11）

> **性质：点时间快照，不是项目知识。** 本文记录一次只读架构评审的结论与建议，
> 供后续立项取舍；**不随代码维护**，与代码冲突时以代码为准。
> 结论若已落地为护栏/口径，应写进 `AGENTS.md` / `ARCHITECTURE.md` / 代码 `@fact`，
> 而不是回来改本文。
>
> 评审时的仓库状态：分支 `master`，工作区有并行会话改动；`npm run check-guards` 6 项全绿；
> 1767 测试；src 108K 行（TS/Vue），测试 187 文件 33K 行，文档 13 份。

## 0. 一句话结论

治理水平远超同规模项目，**产品代码债务集中在三处边界逆流 + 五个上帝文件**——
它们共同导致「每录一个新角色都要动引擎内核/共享类型/编排器」，这是并行开发摩擦的主源。
改进优先级应放在**加机器护栏**（成本小、复制既有棘轮范式）与**拆共享热点**（降冲突面），
而不是重写引擎。

## 1. 分层现状（`docs/ARCHITECTURE.md` §0 的五层）

| 层 | 规模 | 状态 |
|---|---|---|
| 数据层 `public/static/*.json` | catalog 1.5MB + run-archive 3.0MB | ✅ 单一事实源有 `validate:data` 牙齿 |
| 状态层 `src/stores` | 5 文件 1.8K 行 | ⚠️ `config.ts` 1299 行，派生状态靠 watcher |
| 编排层 `src/composables` | 94 文件 24.9K 行 | 🔴 `useResourceCalc.ts` 2434 行巨石 |
| 引擎层 `src/core` | 51 文件 14K 行 | 🟠 纯函数底线成立，但边界被逆流 |
| 录入层 `src/mechanics` + `src/specs` | 134 文件 38.2K 行（含 71 测试文件） | 🟠 双轨制清晰，但残留死导出 |
| 展示层 `src/views` + `src/components` | 27 文件 19K 行 | 🟠 越层直连引擎，无护栏 |

## 2. 值得保留的架构资产

1. **引擎「纯函数」底线是真的**：`src/core/` 零 Vue/Pinia/DOM/fetch 渗漏；core 内部依赖无环；
   `ConvergenceReport`（`src/types/resource.ts`）把离散 2-循环识别为合法退出而非失败。
2. **机器护栏而非文档自觉**：`check-guards`（棘轮/冻结清单）、`check-tokens`（设计令牌）、
   `verify:recording`（防「声称实现」）、`@fact` 断锚即红。
3. **诚实的债务账本**：`ENGINE_PIPELINE_GUIDE.md` §4「同一物理量多处实现」列 12 个量、
   10 个已收口 / 2 个仍双源（失衡次数、连携次数），不粉饰。
4. **测试基建单一事实源**：`src/test/harness.ts` 收口历史 40+ 份 fetch stub 样板，
   仅剩 1 个测试文件未迁移；并把「默认不应用配装推荐 → 数值系统性偏低（16.9% vs 56.3%）」
   写在注释里。
5. **数据唯一源有牙齿**：`validate:data` 强制紧凑写 + `Catalog` 顶层键白名单。

## 3. 核心问题（按严重度，带证据）

### 🔴 P0-1 边界逆流：core ↔ mechanics 双向依赖
`core/resource.ts:7-11`、`core/resource/helpers.ts:18-22`、`core/anomalyPool/helpers.ts:54`
import `@/mechanics`；`mechanics/agents/luciaElowen.ts:6` 反向 import `@/core/effectiveTime`。
**影响**：「引擎无上层依赖」承诺被打破，core 无法独立打包/树摇/脱离录入层单测。

### 🔴 P0-2 agentId 特判堆积，护栏只冻不消

| 位置 | 数量 | 护栏 |
|---|---|---|
| `src/composables/useResourceCalc.ts` | 53 | 棘轮基线 53（2026-08-30 冻结） |
| `src/core/resource.ts` + `core/resource/helpers.ts` | 36（16+20） | **无护栏（规则 6 豁免区）** |

`useResourceCalc.ts:827-1166` 是一整段 20+ 角色的 `if (merged.agentId === 'xxxx')` 阶梯。
棘轮防恶化有效，但**没有 burn-down 契约 → 基线事实上永久化**（冻结后仅清 3 处）。

### 🔴 P0-3 上帝文件群（结构熵）

```
TimeChartsPage.vue      3049 行（script 1280 行 / ~205 个响应式声明）
types/resource.ts       2567 行（20 个域 / 417 个可选字段）
useResourceCalc.ts      2480 行（单函数 / ~40 computed / 7+ 种职责）
resourceCalc/helpers.ts 1946 行 · TeamConfigPage.vue 1850 行
```
最致命两处：
- `calcTeamResources` **单函数 763 行**（暖启动/种子/时间折叠环/内层不动点/赠链预留/finalize）
- `CharacterOperationConfig` **单接口 643 行、~151 个角色专属前缀字段**；
  `CharacterResourceResult` 再挂 15 个 `xxxSource?`

每录一个角色必改这两个共享类型文件 → 并行会话合并冲突热点。

### 🟠 P1-1 展示层越层直连引擎（本次已加护栏）
24 处（23 运行时 + 1 类型）；见 §5 判据 7。此前只有文字规则、零机器检查。

### 🟠 P1-2 状态层派生状态靠 watcher 手工同步
`stores/config.ts:1165-1182` 用 3 个 watcher 同步 `teammateBuffSelections`（本质从 `team` 派生）；
时序窗口已有真实竞态前科（`useResourceCalc.ts:76-78`）。`config.ts:522-556` 另硬编码
~30 个角色专属 setter。

### 🟠 P1-3 过度导出与工具误报（评审首版结论有误，此处已更正）
- **首版说「13 个死导出、其中 4 个是 applyTeamConfig 迁移残留」——实测为误**：这 13 个函数
  **全部在各自文件内被真实调用**（claret 三函数活在 `buildClaretResourceSource` 内、
  `lighter`/`lucy`/`yaojiayin` 的 `apply*TeamFlags` 活在各自 `applyTeamConfig` 内）。
  它们是**过度导出**（export 了但无外部消费者），不是死代码，也不是迁移残留。
- 真问题是**扫描器口径**：`scripts/zc.mjs` 的 `scanDeadClaims` 按「除自身文件外零引用」判死口径，
  把"模块内部私有实现但被 export"误判为死。2026-09-11 已修：拆成 `dead`（全仓含本文件零调用，
  规则 16 原意）与 `overExported`（仅本文件内用，整洁性提示）。
- **自指陷阱**（修这个 bug 时当场踩到 ×2）：扫描器/测试的注释里写出被扫函数的**真实符号名**，
  就等于给它制造一次「跨文件引用」，该函数从清单里凭空消失。首次修复后 `computeClaret*` 就
  因注释里写了名字而消失；测试里写期望清单字面量同样让它消失（改用字符串拼接后正常）。
  已在扫描器注释与测试里各留一处警示。
- `.freebuff/project-id` 曾被 git 跟踪且不在 `.gitignore` / 禁跟踪清单（本次已修）。

### 🟡 P2-1 测试网与验收链（评审首版部分结论已更正）
- ~~`composables/__tests__` 67 文件中 14 个是 probe/debug 探针（~20%），与保护性断言混跑~~
  **更正**：13 个 probe 文件**全部已用 `describe.runIf`/`it.runIf` 门控**，默认 vitest run
  下自动 skip（实测 26 skipped）；它们不污染回归语义，只是仍参与 transform/collect。
  分离价值仅剩一点 collect 开销（全量约 74~100s，probe 占比未单独测出），**不建议为此改动**。
- **verify 链 typecheck 去重（已做，但与首版判断相反）**：首版说「build 里的 `vue-tsc -b` 与
  `typecheck` 重复，删掉 typecheck」。实测结论相反——两者**不是重复**：
  `typecheck`（`vue-tsc -p tsconfig.app.json --noEmit`）只覆盖 app project；
  `vue-tsc -b` 覆盖 **app + node 两个 project**（实测：往 `vite.config.ts` 注入类型错，
  `typecheck` 报 0 条、`-b` 报 1 条），且失败时同样非零退出（隔离目录实测 exit=1）。
  故删掉的是 verify 链里那次**更弱且重复**的 `typecheck`，保留 `build` 内的 `-b`
  （正确的做法是保留更强的那个）。`npm run typecheck` 本身作为"单跑更快"的入口保留。
- UI 样式层：27 个 .vue / 4085 行 scoped CSS，只有颜色令牌（`check-tokens` 头部自述）。

### 🟡 P2-2 文档漂移
评审时 `README.md` §6 写「共 11 份」、「以本表为准（10 份）」，表 11 行，`docs/` 实有 13 份
（缺 `DATA_FETCHING.md`、`multiplier-record.md`）。CI 只检查 `implementation-status.md`。

### 🟡 P2-3 产物体积
主 chunk 1.60MB（gzip 428KB）+ naive-ui 653KB（gzip 176KB）；
`src/mechanics/index.ts` 静态 import 全部 59 个模块，而一次计算只用 3 个角色。

## 4. 改进建议（按投入产出比）

### 第一梯队：小成本（本次已做 #1/#2/#5；#3/#6 经实测撤销）
| # | 事项 | 状态 |
|---|---|---|
| 1 | `check-guards` 判据 7：views/components 越层 import 棘轮（基线 23，只减不增） | ✅ 本次 |
| 2 | 仓库卫生：`.freebuff/` 进 `.gitignore` + `git rm --cached` + 扩禁跟踪清单 | ✅ 本次 |
| 3 | ~~清理 13 个零外部引用导出~~ | ❌ **撤销**：实测它们全在本文件内活跃调用，非死代码；真问题是扫描器误报，已修扫描器（见 P1-3） |
| 4 | README 文档表补齐并统一份数 | ✅ 本次 |
| 5 | verify 去重 typecheck | ✅ 本次（删弱留强：删 `typecheck`，保留 `build` 内的 `vue-tsc -b`，后者覆盖 app+node） |
| 6 | ~~probe 测试与回归网分离~~ | ❌ **撤销**：13 个 probe 全部已有 `runIf` 门控、默认 skip，语义上早已分离 |

### 第二梯队：中成本（建议开 goal 管理）
| # | 事项 | 收益 | 成本 |
|---|---|---|---|
| 7 | 按 section banner 拆 `types/resource.ts` + barrel re-export | 缩小并行冲突面，下游零改动 | 中 |
| 8 | 零行为重拆 `calcTeamResources`（种子/折叠环/finalize） | 763 行函数可局部阅读；golden 基线兜底 | 小-中 |
| 9 | `config.ts` 派生状态收口 + 角色 setter 泛化 `setActionCount` | 消灭一类竞态 + 减 ~200 行 | 中 |
| 10 | 抽 `resourceCalc/convergence.ts`（`runCalcRound`/`runOuterLoop` 移出） | 50 处 agentId 分支 80% 在其中，先有落点才能清零棘轮 | 中-大 |
| 11 | 棘轮加 burn-down 契约（每季下调目标 + 到期日，进 `zc status`） | 把「冻结合同」变成「还款计划」 | 小 |

### 第三梯队：需先验证前提
| # | 事项 | 证伪闸门 | 成本 |
|---|---|---|---|
| 12 | 解 core↔mechanics 环（纯函数下沉 + hook 注入） | 迁移后新角色若仍需改 core，则收益不成立 | 中-大 |
| 13 | `CharacterOperationConfig` 角色字段迁出（模块自声明子接口） | 统计最近 20 次提交 `types/resource.ts` 改动占比 | 大 |
| 14 | TimeChartsPage 拆分 + 抽 `useChartGeometry` | 该页有并行会话，需先 `zc claim` 排期 | 小-中 |
| 15 | 录入层按角色动态 import | 本机计算器 428KB gzip 可接受 → 无抱怨则不做 | 大 |

## 5. 本次落地的机器判据（判据 7）口径

- **规则**：`src/views/` 与 `src/components/` 不得 `import`（或 `export ... from`）
  `@/core`、`@/mechanics`、`@/specs` —— 展示层只读编排层产物
  （`AGENTS.md` §0 分层、`ARCHITECTURE.md` §0「依赖方向：展示 → 编排 → 引擎」）。
- **豁免**：`import type`（纯类型不产生运行时依赖）与注释行。
- **棘轮**：`EXHIBITION_LAYER_IMPORT_BASELINE` 冻结存量，`只减不增`；
  迁走一处就从基线减一（护栏会提示下调，与 agentId 棘轮同款）。
- **为什么用棘轮而不是一次清零**：24 处里多数是常量/纯函数（`sharpCritMultiplier`、
  `ULTIMATE_COST_DEFAULT`、`scoreForDamageRatio`），正确解法是下沉到 `src/data/` 或
  经编排层透出——逐条改属独立任务，先冻结防恶化（复制 agentId 棘轮的成功范式）。

## 6. 明确不建议做的（YAGNI，对齐规则 12）

- 不重写引擎、不引入 DI/状态管理框架 —— core 的纯函数 + 显式收敛已验证有效。
- 不为 630 条存量散文口径做结构化迁移 —— 仓库「新口径才强制 `@fact`」的策略是对的。
- 不推倒 `zc.mjs` / `check-guards.mjs` 判据体系 —— 它正是不让上述债务恶化的屏障。
- 不为包体做 SSR/预渲染 —— 单机计算器无首屏时长压力。
