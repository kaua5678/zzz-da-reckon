# 默认套件只放断言：一次性探针清理（r736）

> 代码提交 `4285fce2`（arena-G r736）；arch CC-518；r6 §8.0 #33 与 §8 第 736 行。
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

## 6. 下一轮候选（未做）

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
