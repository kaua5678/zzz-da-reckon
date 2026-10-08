# 默认套件只放断言：一次性探针清理（r736）

> 代码提交 `4285fce2`（arena-G r736）；arch CC-518；r6 §8.0 #33 与 §8 第 736 行。r737 体检与门控探针索引见第 8 节（`0c1da794`，CC-519）。
> 一句话：默认套件里有 3 个一次性探针每次都跑，却不钉任何行为，重构时还得陪着改。本轮删掉它们；工具型探针 panelProbe 的门控写法改成和其余 16 个探针一样（`it.runIf`）。

## 1. 起点（origin `6509ce53`）

r735 在 `mcp-downgrade-wengine.md` §6 留下一个候选：`freeCompareDowngradeProbe.test.ts` 还在默认套件里跑。本轮把它扩成两次普查。

- **普查 a**：`src` 下文件名含 probe / diag / debug / repro 的测试文件，共 25 个。
- **普查 b**：没有 env 门控、却往控制台打印的测试文件，共 17 个。

两次普查合并后的分类：

| 类别 | 个数 | 文件 | 判定 |
|---|---|---|---|
| 门控探针 | 16 | `*Probe.test.ts`，用 `it.runIf(process.env.PROBE_X)` 或 `describe.runIf(active)` 门控，默认跳过 | 保留。不在默认套件里跑，本轮不动（见第 6 节） |
| 一次性探针，没有门控 | 3 | `zzz_ysg_probe`、`diag-stun`、`freeCompareDowngradeProbe` | **删除**（第 3 节） |
| 工具，靠早退空跑 | 1 | `panelProbe`（`npm run probe:panel`） | **改用 `it.runIf`** |
| 名字带 probe / debug / repro，但断言是真的 | 5 | `probeTrace`（CC-479 打表设施的单测）、`positionCompareDebug`（3 例真断言）、`banyue-timeoverflow.debug`（回归）、`r65j1DeadBuffProbe`（全库锁：缺口、空读数、谓词漏判都必须为 0，单文件 16 s）、`excelAxisRepro`（结构下限锁，注释写明了归因） | 保留 |
| 有打印，断言也是真的 | 其余 12 | `timeGolden`、`banyue`、`checkGuards`、`uiCheck` 等，多为 1–3 行条件打印 | 保留 |

另外，`moveFusion.test.ts` 里有一个内嵌的门控探针（`it.runIf(process.env.PROBE_FUSION)`），写法符合约定。

## 2. 判据

- 默认套件里的测试，要钉住一个真会回归的行为（反臃肿规矩：测试只为新行为和真会回归的边界写）。只打印、断言恒真的文件不算。
- 探针（打印出来给人看的）只有两条路：用 env 门控（`it.runIf` / `describe.runIf`），或者用完就删。删之前，结论要写进活代码注释或带断言的测试。
- 名字里带 probe 或 debug 不说明它就是探针，要看断言。

## 3. 改法（`4285fce2`，5 个文件，+4 / −189）

| 文件 | 来历 | 断言 | 结论现在在哪 | 处理 |
|---|---|---|---|---|
| `src/mechanics/__tests__/zzz_ysg_probe.test.ts`（67 行） | `1abba843`（2026-09-02，随「全队帷幕通道」一起提交）：叶瞬光 ATK 分解，以及按倍率加权的易伤平均（白毛招 2.1×；取不到覆盖率时退回 0.5） | 0 条，14 行 console.log | 没写成断言，只是当时看的数。叶瞬光（1431）有 40 个带断言的测试文件，`computePanelPhases` 有 79 个 | 删 |
| `src/core/__tests__/diag-stun.test.ts`（43 行） | `0cea1b12`（2026-08-31），头注释写着「[DEBUG] 临时诊断」：轴模式下 ① 兜底平 A 是否算进必要时间；② 净失衡缩放是否和轴内失效重复扣减 | 1 条：`stunPoolResult` 非空 | 同一提交里的般岳时间预算修复已经落地。轴模式下 `stunPoolResult` 非空，另有 5 个默认运行的测试文件在测（attachedAxisStunR20D1、cinemaUplift、hugoVerdictLanding、banyue、hugo） | 删 |
| `src/composables/freeCompare/__tests__/freeCompareDowngradeProbe.test.ts`（74 行） | `b3603215`（2026-09-15），三个角色分别算专武、三把 A 级、裸奔 | 1 条：`rows.length > 0`。rows 每轮无条件推入至少 4 行，所以这条恒真 | 数字（裸奔低 34–41%，三把 A 级差 3–8pp）写在 `engine.ts#applyCodeToSlot` 注释里；「挑伤害最高的那把」由 `freeCompareEngine.test` 的「★★」钉住（r735 反例：改成永远取第一件就变红） | 删；注释出处改成「探针 r736 已删，原文见 `b3603215`」 |
| `src/core/__tests__/panelProbe.test.ts` | `npm run probe:panel` 用的工具 | 没设 `PROBE_AGENT` 时跑一个早退的空测试，在默认套件里算 passed | — | 改成 `it.runIf(probing)`，默认跳过；标题改成固定文案 |

**为什么说它们有代价**：这 3 个文件要失败只有一种可能——被测代码抛异常。而同样的入口都有带断言的测试在跑。它们留着的代价是陪改：近两周被重构改了 3 次（`0b6b973e` CC-40 改名、`0c69f4d0` r722 删别名、`5b08c0c4` r710 T24）。r710 那次是卡面漏列了 `diag-stun`，执行时临时补上的。

删掉的原文都能取回：`git show <首提交>:<路径>`。

## 4. 验证

- vue-tsc 0。
- `panelProbe` + `freeCompareEngine.test`：11 passed、1 skipped。`PROBE_AGENT=1371 npm run probe:panel` 照常输出仪玄面板，1 passed，说明工具没坏。
- check-guards 29 条（判据 28、29 都是 0/0，扫 298 个文件）；zc.test + checkGuards.test 207。
- tokens 12 / data 161 / specs 462 / recording 189。
- zd：DUMP 0 / ROWS 0。
- build：`index-D2_W00Uq.js` 1599.47 kB，哈希与 `6509ce53` 相同，运行时产物逐字节不变（engine.ts 只改了注释）。
- zc drift：154 / 0 / 0。
- **vitest 基线变化，逐条归因（规则 10）**：

| | r735（`6509ce53`） | r736 | 差 | 归因 |
|---|---|---|---|---|
| 通过的文件 | 524（261 + 263） | 520（259 + 261） | −4 | 删掉 3 个；panelProbe 从 passed 转成 skipped，1 个 |
| 通过的用例 | 4507（2165 + 2342） | 4503（2163 + 2340） | −4 | 同上，每个文件 1 个 `it` |
| 跳过的文件 / 用例 | 16 / 29 | 17 / 30 | +1 / +1 | panelProbe |
| 文件 / 用例合计 | 540 / 4536 | 537 / 4533 | −3 / −3 | 只少了删掉的 3 个 |

- 没做变异反例：本轮只删测试，被删测试唯一能失败的方式是抛异常，同一入口的覆盖见第 3 节。

## 5. 不做

- **不加守卫**。找不到便宜又准的规则来区分「一次性探针」和「带打印的真测试」：按「0 条断言」只抓到 1 个；按「没门控又有打印」会误伤 14 个真测试。3 个违例都出现在 08-31 到 09-15 之间，之后 3 周没有新的。再出现再议。
- **不改 AGENTS.md**。规矩写进 r6 §8.0 #33。
- **r65j1DeadBuffProbe 不改名**。名字不准确，但它确实是锁；改名要动 4 处文档引用，收益只有一个名字。它每次运行都会写 `.zc/reports/r65j1-dead-buff-probe.json`，这个路径在 `.gitignore` 里。
- **excelAxisRepro 的打印不删**。断言是真的，打印是对照 Excel 时看的。
- **16 个门控探针本轮不动**。它们不在默认套件里跑，另立一题（第 6 节）。

## 6. 下一轮候选（r737 已做，见第 8 节）

**有 6 个门控探针找不到入口**。下表 6 个，除了自己的测试文件，仓库里没有任何地方提到它们：没有文档，也没有 npm 脚本。它们照样要跟着重构陪改。

| 探针 | 首次加入 | 最后改动 | 提交数 | 门控 env |
|---|---|---|---|---|
| `damageAuditProbe` | 2026-09-03 | 2026-10-01 | 2 | `PROBE_AUDIT` |
| `difficultyCurveProbe` | 2026-09-10 | 2026-09-10 | 2 | `PROBE_DIFF_CURVE` |
| `difficultyLadderProbe` | 2026-09-10 | 2026-10-01 | 9 | `PROBE_DIFF_LADDER` 等 |
| `specRuleDeadProbe` | 2026-09-15 | 2026-10-02 | 2 | `PROBE_SPEC_DEAD` |
| `stunTimeProbe` | 2026-09-01 | 2026-09-01 | 1 | `PROBE_STUN_TIME` |
| `ysgFormsProbe` | 2026-09-21 | 2026-10-07 | 2 | `PROBE_YSG_FORMS` 等 |

做法：

1. 先用各自的 env 跑一次，看还能不能跑。
2. 再逐个判断：
   - 调查已经收口（结论在活代码或文档里）⇒ 删；
   - 还需要复跑 ⇒ 在对应文档里登记跑法。

另外 10 个门控探针在文档或其他文件里有引用，判断时顺带核对一下引用是否还准。

## 7. 回退

`git revert 4285fce2`（文档另提交）。

r737：`git revert 0c1da794`，恢复 4 个探针（文档另提交）。

## 8. r737：门控探针体检与索引

> 代码提交 `0c1da794`（arena-G r737）；arch CC-519；r6 §8 第 737 行。接第 6 节的候选。

### 8.1 做法

16 个门控探针各带自己的主 env 实跑一次；有 `*_TOP` 的设成 2，只为缩短用时。每个都记四样：

- rc 和用时；
- 输出里 `undefined` / `NaN` 的个数。`as any` 读错对象或读到已删字段时会打出 undefined，可选字段缺省时也会，所以要逐个分辨；
- 打印出来的结论在今天的引擎里还对不对；
- 在测试文件以外有没有引用。

16 个全部能跑通（rc 0）。结论如下：

| 探针 | 实跑 env | 用时 | 体检结果 | 处理 |
|---|---|---|---|---|
| `ysgFormsProbe` | `PROBE_YSG_FORMS=1` | 3 s | 有 4 个字段读错了对象，恒为 undefined / 0；「账本合计」恒打 0.00 | **删** |
| `stunTimeProbe` | `PROBE_STUN_TIME=1` | 3 s | 三队都误报「前台超有效时间」 | **删** |
| `specRuleDeadProbe` | `PROBE_SPEC_DEAD=1` | 29 s | 报了 54 条，几乎全是观测通道和预设数据造成的假阳性 | **删** |
| `difficultyCurveProbe` | `PROBE_DIFF_CURVE=1` | 68 s | 能跑，但方法已被难度阶梯取代 | **删** |
| `difficultyLadderProbe` | `PROBE_DIFF_LADDER=1` | 35 s | 干净；打印的就是页面上的难度曲线 | 保留，登记（8.3） |
| `damageAuditProbe` | `PROBE_AUDIT=1 PROBE_AUDIT_TOP=2` | 70 s | 干净；最差两队的模型伤害只有血量的 27% / 36% | 保留，登记（8.3） |
| 另外 10 个有引用的 | 见 8.3 | 2–71 s | 干净（giftAxisProbe 唯一一处 undefined 是在回显没设的 env） | 保留 |

### 8.2 删掉的 4 个（`0c1da794`，−377 行）

原文可以取回：`git show 0c1da794^:src/composables/__tests__/<名字>.test.ts`。

- **ysgFormsProbe**（`0d1c63e4`，2026-09-21）：它查「叶瞬光 + 琉音 + 照，该队应有 10 次白毛变身」。
  - 今天照样是 10 次（喧响 2 + 转大 4 + 照影 4）。
  - 输出里有 18 处 undefined，大半是可选字段本来就缺省：这队没截断，所以 `truncationCuts` 和重折次数为空；普通行也没有 `source` / `truncatedRatio` / `timeBucket`。这些属正常。
  - 真正烂掉的是 4 个读错对象的字段：
    - `timeBudgetRefund` 和 `timePressureSeconds` 是输入配置上的字段（`ResourceCalcConfig`、`CharacterOperationConfig`），它却从计算结果上读，恒为 undefined；
    - `necessaryTime` 和 `basicAttackTime` 在 `timeAllocation` 里，它从角色结果上读，于是「账本合计」恒打 0.00，逐槽打 `?`。
  - 这些读法都套着 `as any`，所以类型检查拦不住。
- **stunTimeProbe**（`5bf8a715`，2026-09-01）：
  - 它把各行 `totalTime` 直接相加当「前台合计」，三队都超过 180 s（209.5 / 201.6 / 204.7 s），于是全部标红。
  - 引擎按净占用核预算，即 `frontlineOccupationBreakdown`：毛前台减去合轴抵扣。拿 ysgFormsProbe 那支叶瞬光队来看，毛 195.84 − 抵扣 15.84 = 净 180，正好等于预算。
  - 毛值超过 180 s 本来就正常，所以「前台超有效时间」这个判语不成立。留着它，会让下一个人去追一个不存在的 bug。
- **specRuleDeadProbe**（`2142a262`，2026-09-15）：
  - 「声明 implemented 却从未观测到」报了 52 条，分布在 19 个角色上，这 19 个全都有 TS 模块。它只从角色结果的 `specResources` 里观测，而模块角色会在内部消费规则，不一定把账本挂到结果上（比如 `alice.ts` 直接读 `computeSpecResources` 的 gains），所以它看不见。
  - 「观测到但恒 0」报了 2 条：
    - 1531 闪反那条取决于预设数据：1531 的 6 个预设都没声明闪反，`dodgeCounterCount` 本来就是 0；
    - 1551 完美格挡那条只在 2 队里出现过。
  - 它的交互映射是手抄的，没有走单一实现 `applyPresetInteractions`，漏了专属类型反查和 `tauntCancel`。
  - 它当初要找的剑仪池缺陷（1401）已经修好，并由 `src/specs/__tests__/resources.test.ts` 钉住。
  - 要重做这类全库体检，先解决三件事：观测要能看到模块内部的消费；计数源不能取决于预设；交互要走 `applyPresetInteractions`。
- **difficultyCurveProbe**（`6f1c5f7d`，2026-09-10）：
  - 这是难度曲线「只看全关 / 全开两端」的草案。当天就被逐目标贪心阶梯取代：`396d2da8` 探针 → `e667b0b6` `difficultyLadder.ts` → `a6ca58bd` `difficultyCurve.ts` 接 UI。
  - 最后一次实测：104 个预设，全关 7057.6M → 全开 7648.9M，+8.38%（首测 +9.16%）。提升幅度分布：≥30% 2 队；10–30% 35 队；2–10% 53 队；0–2% 13 队；负 1 队；中位数 7.3%。

基线：通过数不变（520 / 4503）；跳过数从 17 / 30 降到 13 / 26；合计从 537 / 4533 降到 533 / 4529。build 哈希与 `e50db007` 相同，zd 0/0。

### 8.3 门控探针索引（以本表为准；增删探针时同步）

都在 `src/composables/__tests__/` 下，跑法统一是 `<env> npx vitest run <文件>`。用时是 r737 实测。

| 探针 | 主 env（可选 env） | 用途 | 用时 | 其他入口 |
|---|---|---|---|---|
| `panelProbe`（在 `src/core/__tests__/`） | `PROBE_AGENT=<id> npm run probe:panel`（`PROBE_ENGINE` / `PROBE_MOD` / `PROBE_CINEMA` / `PROBE_FOUR` / `PROBE_TWO` / `PROBE_SUBSTATS`） | 面板事实源：暴击预算、局内外面板 | 秒级 | AGENTS.md |
| `difficultyLadderProbe` | `PROBE_DIFF_LADDER=1`（`PROBE_DIFF_TEAMS=<预设id,…>` / `PROBE_DIFF_ALL=1` / `PROBE_DIFF_COUNTS_DUMP=1`） | 页面同款难度曲线的文字版：每队阶梯、关键次数跃迁、伤害归因 | 35 s（默认 10 队样本） | 本表 |
| `damageAuditProbe` | `PROBE_AUDIT=1`（`PROBE_AUDIT_TOP` / `PROBE_AUDIT_GOLDWINDOW`） | 实战前沿里模型伤害对血量比最差的队，逐行审计区值一致性和总倍率吞吐 | 70 s | 本表 |
| `lowGoldFrontierProbe` | `PROBE_LOWGOLD=1`（`_TOP` / `_GOLDWINDOW`） | 低金前沿按伤害 / 血量比升序 | 69 s | ENGINE_PIPELINE_GUIDE |
| `damageSplitFrontierProbe` | `PROBE_DMGSPLIT=1`（`_TOP` / `_GOLDWINDOW`） | 前沿队按角色拆直伤 / 异常 | 70 s | ENGINE_PIPELINE_GUIDE |
| `anomalyFrontierProbe` | `PROBE_ANOMALY=1`（`_TOP` / `_GOLDWINDOW`） | 前沿队的积储 / 紊乱 / 乱流 | 69 s | arch CC 表 |
| `archiveStunVulnProbe` | `PROBE_ARCHIVE_STUN=1`（`PROBE_ARCHIVE_TOP`） | 实战部署的加权易伤信用和行级分布 | 71 s | mcp-stun-dual-source |
| `hugoStunVulnMatrixProbe` | `PROBE_HUGO_MATRIX=1` | 雨果非轴白名单 / 0 命轴 / 2 命轴三态逐行易伤 | 3 s | ENGINE_PIPELINE_GUIDE、mcp-stun-dual-source |
| `nonAxisStunVulnProbe` | `PROBE_NONAXIS=1` | 非轴失衡易伤的生效性和覆盖率折扣 | 2 s | AGENT_ID_BURNDOWN_LOG |
| `convergenceProbe` | `PROBE_CONV_SCAN=1` 全库（`PROBE_CONV_TEAM=<预设id>` 单队，另有 16 个开关见文件） | 收敛体检 | 11 s / 3 s | ARCHITECTURE、mcp-integer-cycle-stop 等 |
| `countFractionProbe` | `PROBE_COUNT_FRAC=1`（`PROBE_STUN_PROJ`） | 终局小数次数与失衡计划值投影 | 9 s | `core/stunPlanProjection.ts` |
| `giftAxisProbe` | `PROBE_GIFT_TEAM=<预设id,…>`（`PROBE_INCLUDE_1591`） | 琉音赠大跨层对账 | 3 s（1 队） | 字段普查文档 |
| `ysgLoopTraceProbe` | `PROBE_YSG_LOOP=1`（`PROBE_YSG_TEAM` / `PROBE_YSG_AXIS` / `PROBE_YSG_CINEMA` / `PROBE_YSG_PRESET` / `PROBE_YSG_SCALE`） | 叶瞬光循环逐轮打印 | 3 s | arch CC 表 |
| `moveFusion.test.ts` 内嵌一条 | `PROBE_FUSION=1` | 雅队飞雪 / 春临融合后的倍率与总伤害 | — | — |

`r65j1DeadBuffProbe` 不在表里：它名叫探针，实际是默认运行的锁（见第 5 节）。

### 8.4 不做

- **specRuleDeadProbe 不修，直接删**。要修就得让观测看见模块内部的消费，等于给引擎加埋点。为一个打印工具改引擎不值，坑已记在 8.2。
- **另外 10 个只体检到「能跑、输出干净」**，打印的结论没逐条复核对错。它们各有文档入口，用到时再核。
- **4 个前沿探针各抄一份「读实战存档 → 取前沿」的开头，不合并**。它们都是可选工具，合并只省几十行，还会让它们互相牵连。

### 8.5 下一轮候选（r738 已做，见 `docs/mcp-frontline-row-seconds.md`）

**单槽前台行时长有 5 处各算一遍，负值口径不一致。** 都是「对 `isFrontlineExecution` 的行把 `totalTime` 相加」：

| 位置 | 负值怎么处理 |
|---|---|
| `composables/resourceCalc/helpers.ts#normalizeDisplayTime` | 不钳 |
| `core/resource/assembleSlot.ts`（`execFrontlineTime`） | 不钳 |
| `core/resource/foldLoop.ts`（`rowTime`） | 钳到 0（`Math.max(0, …)`，另加赠送时间） |
| `core/resource/timeOccupation.ts`（行求和） | 毛值不钳、净值钳 |
| `composables/teamTimeSummary.ts#slotRows` | 钳，并按桶拆 |

做法：

1. 先确认 `totalTime` 会不会为负。
   - 不会 ⇒ 这些 `Math.max(0, …)` 都是死防御，删掉。
   - 会 ⇒ 各处口径不一致就是 bug，统一成一个。
2. 再看能不能收成一个「单槽前台行时长」函数，供这 5 处共用。
3. 改动会碰到 foldLoop / assembleSlot，必须跑 zd 零差。
