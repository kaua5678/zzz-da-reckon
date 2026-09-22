# R28-J2：副词条数值契约与 mode 可观测性

## 选题、范围与基线

- 用户授权持续自主开发、按独立范围提交，不推送、不混入其它 UI WIP。
- 当前基线 `b7071d4`：干净 Git worktree 上 `VITEST_MAX_WORKERS=4 npm run verify`，3229 passed / 29 既有 skipped，构建通过。
- 入口：`.claude/OPEN-ITEMS.md` R28-J2；已读 `core/panel.ts#applyDriveDiscConfig`、`core/buff.ts#applyStat`、`statModeParity` 与 `discSetEffects`。
- 不修改游戏数据、运行时公式、快照或验证阈值。

## 静态取证与原候选的前提修正

当前 catalog 副词条池有 10 键：六个 HP/ATK/DEF 的显式 Flat/Pct 键，以及 critRate、critDmg、anomalyProficiency、penFlat。
`applyStat` 的前六项由 `CORE_STAT_BY_BONUS` 决定语义，后四项直接加值；它们都不读传入的 mode。
因此“副词条 mode 反转后全绿”可能是**等价注入**，不是测试盲区。不能直接沿用旧候选的推论硬加一条“应当有差异”断言。
`anomalyMastery`、`energyRegen` 才是已知 mode 敏感的对照，但不在当前合法副词条池。

## 实施前预测 / Next

1. 在非零合成基础面板、真实 catalog 池/步长下，合法 10 键各取 0/1/3 步，改变 display 为 integer/percent，完整面板应逐字段相同。
2. 同时必须满足独立数值 oracle：加点/百分点 = step×count；核心 Pct = 原始 base×step×count/100。正步数必须有非零增量。
3. 主副百分比不得放大固定加点，副词条字典顺序不得影响结果。
4. 池外字段即使有非零步长也须拒绝；明确扩展池后才允许。合成扩展池的 AM/回能应能区分 flat/pct，证明测试仪器不是永远判等。
5. 用测试侧计数缩放模拟误乘 2.25，数值断言必须红；移除注入后恢复绿色。只证明新判据有辨识力，不声称旧网全盲。
6. 三组编译期限定注入的预测：步数误乘 2.25 应红 14 条，删除副词条白名单应红 1 条，副词条一律 flat 应红扩展池正控 2 条而合法池 10 条仍绿。使用临时 Vite transform，不改动生产文件。

## 实现方案

- 新增 `src/core/__tests__/discSubstats.test.ts`，复用公共 harness 加载 catalog；不用角色配装的终值猜结算来源。
- 纠正 `StatRules.statDisplay` 的过宽注释：它决定传入 mode，但字段自身的明确语义仍由 applyStat 分派，不能把所有 percent 都解释为“乘基础值”。
- 若预测成立，将 R28-J2 以“原 mode 缺陷前提不成立；真实数值/池边界已有独立契约”收口。
- 验收：定向测试、故障注入、typecheck、全量 check/verify；预期运行时与数值快照零 delta。

## 结果

- 定向新用例 **15/15 passed**；合法池十键在 0/1/3 步下分别验证独立数值式，两个 mode 注入与正常输出逐字段相同。
- 编译期真实故障注入（不改生产文件）：步数误乘 2.25 → **14 failed / 1 passed**；删除白名单 → **1 failed / 14 passed**；一律 flat → **2 failed / 13 passed**。失败位置分别对应数值、池外字段、mode 敏感扩展池，全部符合实施前预测。
- `src/core/panel.ts` 在三组注入前后 SHA 相同。没有将“合法池的等价注入全绿”夸大成旧网缺陷，也未改任何数值期望或基线。
- 已澄清 `StatRules.statDisplay` 文档：mode 的来源不等于每个字段的最终结算方式。
- 全量 check 已通过：3244 passed / 29 既有 skipped；构建发现新测试夹具没有填写 DriveDiscConfig 必需的 4/5/6 号键（TS2739）。修正为显式空字符串槽位，不改数值期望/计算代码，再复验类型与构建。
- 补齐类型必需键后，15/15 定向复验、`npm run typecheck`、`npm run build` 均通过；数值与规则阈值零改动。
- R28-J2 已收口：不把合法池的等价 mode 注入当作 bug；真实步长/计数、组合与白名单契约已具备独立正反控。提交后另用干净 HEAD 复验。
