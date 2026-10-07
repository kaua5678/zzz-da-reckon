# drift 待复核队列分诊（⟳ 102 条）

> 2026-09-25 lead 会话建卡。基线：HEAD `4f67990`，`zc drift` 读数 = 手写事实 143 条 · 断锚/缺据 0 · 待复核 102 · 手册复核触发器逾期 0。
> 本文回答三件事：这批 ⟳ 从哪来（§1）、怎么判（§2）、谁来做（§3/§4）。
> 工人只做**只读复核**交报告；「据」/锚的落盘修正由主代理按报告分批做（§4）。

## 1. 成因

- 2026-09-24 计算核心批次 CC-1…CC-12（`e2e8ae5` → `bbbaaa4`）把大量实现搬进 `src/core/resource/*`（moveLookup / innerLoop / warmStart / timeTruncation / rowBuild 等），叠加日常改动，触发了 `zc drift` 的「锚文件在『据』之后被改过」标记——**只报不红**。
- 实现搬家 = 锚文件被改 ⇒ 事实被批量标记。预计绝大多数是 still-holds（实现搬走了、口径没变），但**必须逐条确认，禁止批量刷新日期**——无归因地刷「据」会把真漂移静默吸收（同规则 10 反对的「无归因重生成」）。
- 分布（2026-09-25 实测）：`src/core/` 26 · `src/composables/` 26（其中 resourceCalc 11）· `src/mechanics/` 31 · `scripts/` 12 · `src/{stores,types,utils,views,data}` 7。

## 2. 复核判据（四态）

| 态 | 判据 | 处置（主代理做） |
|---|---|---|
| still-holds | 实现当前形态与事实断言一致（含「实现整体搬家但语义逐位等价」） | 「据」改为复核日；锚路径/符号变了就一并改锚 |
| drifted | 实现语义与断言不再一致（实现被改且不再满足断言，或口径已被后续裁决替换） | 主代理逐条裁决：改事实 / 回滚实现 / 升级用户；**不许无归因就地改事实** |
| broken-anchor | 锚符号不存在（改名/删除） | 从报告的候选符号里确认新锚，改锚后再按 still-holds/drifted 走 |
| needs-user | drifted 且牵涉业务口径（同 `.claude/OPEN-ITEMS.md` §1 同族） | 进 OPEN-ITEMS 排队，不落盘 |

纪律：

- **只判「事实是否仍如实描述实现」，不判「机制该不该这样」**——后者是已裁决/待裁决口径，别重开（R62-J3、R65-J1、R2-E F1–F3 等不在本批范围）。
- 纯静态阅读（事实行 + 锚实现两侧），不跑 vitest、不跑构建。
- still-holds 的判据是**语义等价**，不是「符号还存在」；符号在但逻辑变了 ⇒ drifted。

## 3. 工人批次（卡在 `docs/mcp-worker-task-queue.md`，卡号 W13–W15）

| 批 | 锚范围（grep 选取） | 条数（09-25 实测） | 报告 |
|---|---|---|---|
| W13 | `锚 src/core/` + `锚 src/composables/resourceCalc/` | 26 + 11 = 37 | `.zc/reports/W13-drift.md` |
| W14 | `锚 src/mechanics/` | 31 | `.zc/reports/W14-drift.md` |
| W15 | composables 非 resourceCalc 15 + scripts 12 + stores/types/utils/views/data 7 | 34 | `.zc/reports/W15-drift.md` |

- 三批按锚路径前缀切分、互不相交，可并行；并发上限仍受队列 §0 约束（同时 ≤2 工人）。
- 条数是 09-25 的快照；工人开工先打印实际条数，不符时**按实际全集做**并在报告写明（队列会随主代理落盘修正而缩短，也可能因新改动变长）。

## 4. 主代理落盘纪律（工人不做这步）

- 按批吸收报告：still-holds ⇒ 把「据」更新到复核日 + 搬锚；**一个 commit 只含一个批的事实行编辑，不与代码改动混批**（规则 17② 精神：delta 可归因）。
- drifted / broken-anchor / needs-user 逐条人裁，不进批量 commit。
- ⚠ 落盘编辑本身会再动锚文件（事实行大多写在实现文件里）⇒ 同文件的其他事实可能再次进 ⟳。对策：**同一文件的条目尽量同批清掉**；落盘后跑 `node scripts/zc.mjs drift` 验证条数确实下降——若同文件条目清掉后仍被标记，先查 `zc drift` 的比较口径（`scripts/zc.mjs`），搞清「动过」按文件还是按符号、严格大于还是大于等于，再继续；**不许盲目循环刷日期**。

## 5. 证伪闸门

- **前提**：这批 ⟳ 主要由「实现搬家/热区被改」触发，事实主体多数仍成立。
- **可观察失败**：任一批的 still-holds 占比 < 50%（多数真漂移）⇒ 停止其余批次的机械照搬，先归因（CC 批次是否带了未被测试抓住的语义变化），必要时升级用户；已出的报告只作取证，不直接落盘。

## 6. r715：语义对账 + drift 改按锚符号判（2026-10-07，arena-G）

> 基线：HEAD `d8bf7003`，`zc drift` = 手写事实 154 · 断锚/缺据 0 · 待复核 112（文件级）。
> 提交：`2ed99922`（3 条 drifted 订正 + 2 处过时注释）· `e531ca6a`（46 条 still-holds 记复核日）· `6f8fd957`（drift 按锚符号判）。

### 6.1 方法：先按锚符号分诊，再逐条读

- 探针 symprobe（仓外 `/home/kaua/calc-arch/g715/symprobe.mjs`，逻辑已并入 `zc.mjs#anchorCode`）：TS 编译器去注释打印锚符号，比较「据」日版本与 HEAD ⇒ 112 = 63 一字未变 + 47 变了 + 2「据」日后才建。
- 49 条（变了 / 新建）逐条读符号 diff + 事实正文；涉及数值的对数据（苍角 1131006/1131010–1131013/1131016 动作时长、洛克茜 exCost 10+30/s、朱鸢支援突击 count=parryCount、settings 声明 default 等）。§5 闸门：still-holds 46/49 = 94%。

### 6.2 结果

| 态 | 条数 | 明细 |
|---|---|---|
| drifted | 3 | `ultimatePromote.ts` engine:失衡次数不动点——轴模式（有份额提供者且未锁定）自 `bf308785`（CC-469′/469′b）起二分池自身不动点 h(N)=continuousStunCount(pool(N))−N，不再「轴/非轴统一走闭式」；`sigrid.ts` agent:1591/影画1溢出——「代码侧 fallback」自 `cfff5020`（CC-508）起不存在，缺省只在 settings 声明；`wEngineStackCoverage.ts` 折算口径——「回填覆盖率」自 `f3771bd1` 起不再写回 state |
| still-holds | 46 | 重构 / 类型收窄 / 读口收敛（CC-463/465/493/505–509 等）/ 同符号内与断言无关的改动 |
| 过时普通注释 | 2 | `ultimatePromote.ts`「两种模式统一走连续闭式求根」（与其上方 CC-469′b 注释矛盾）；`types/resource/config.ts` 消费方文件位置（已搬到 underfillProbe / tailPipeline） |

三条 drifted 都是实现被有意提交改过、事实没跟上（非实现回归，无 needs-user）；「据」链追加 `复核@2026-10-07` + 订正来由。

### 6.3 drift 判定粒度（§4 留的问题）的结论

- **不做**：把 CC-87 推广到「纯注释改动」——逐行判注释只让 1/112 出队，且全仓有 8 行以 `*` 开头的乘法续行会被误当注释（damagePool.ts:246、starlightBilly.ts:357、trigger.ts:141、velina.ts:345/346、zhao.ts:125、zhuYuan.ts:203/205）。
- **做了**（`6f8fd957`）：文件级初筛不变，之后比较锚符号去注释后的代码（`zc.mjs#anchorCode`，基线取「据」截止时刻 HEAD 线上的提交），一致即出队；定位不到符号 / 「据」日文件不存在 ⇒ 按文件留队；每行带 `basis: 'symbol' | 'file'`。反例：新代码跑 `d8bf7003` 得 49 = 47 symbol + 2 file，与探针逐条一致；当前待复核 0。同状态成本 6.2s → 7.4s。
- **量过、未采用**：「锚 + 同文件引用方」口径（仓外 refprobe.mjs）——剩下 63 条里 32 条的引用方变过；使用行本身被改的 9 条逐条核过全是等价改写（`record.`→`cfg.`、CC-506 `cinemaLevelOf`、CC-508 删与声明 default 相等的 fallback、外层包装后仅缩进变化）⇒ 加回来的基本是噪声。
- **已知盲区**（与手工「锚未变」相同）：口径行为写在锚符号之外时，使用处改动不触发。对策：**锚写在实现该行为的函数上**；常量锚只适合「口径就是这个值」的事实（例：banyue `AUTO_TOPUP_TIME_LIMIT_SEC` 的「超 200s 次数清零走轴退化」写在使用处，宜改锚）。（**r720**：改为「值 + 行为」多锚，并对 47 条非函数锚逐条处理，见 §7）
- 由此：TS/JS 锚不再需要「锚未变@」戳；§4 的「同一文件的条目尽量同批清掉」也不再必要。「不读代码不许批量补复核日」照旧（ENGINE_PIPELINE_GUIDE 坑 24 ②）。

## 7. r720：多锚 + 锚解析统一到 AST（2026-10-07，arena-G）

> 基线：origin `02be4fd5`，`zc drift` = 手写事实 154 · 断锚/缺据 0 · 待复核 0。
> 提交：`f1cda9b2`（zc 多锚 + 锚解析统一 + 测试 + noun-triage `2000002` 锚修正）· `4f56d0fd`（25 条补行为锚 + 15 条复核）。

### 7.1 普查：锚指向什么

- 探针（仓外 `/home/kaua/calc-arch/g720/factanchor720.mjs`）：复用 `zc.mjs#scanAuthoredFacts`，用 TS AST 给每个锚符号的声明分类。154 条全是 `路径#符号` 锚，没有只锚文件的：函数 107（含 1 条函数与调用结果同名）· 字面量常量 17 · 对象 / 数组常量 23 · 调用结果常量 3 · 其他变量 2 · 类型 1 · 定位不到 1（测试标题，按文件判）。
- 非函数锚 47 条逐条对照正文与使用处（仓外 `usage720.mjs` 列出锚符号在生产代码里的每处引用及所在的具名函数）：

| 处理 | 条数 | 明细 |
|---|---|---|
| 补行为锚 | 25 | 值+行为混写。潜能族 6（burnice / grace / jane / lycaon / rina / soldier11：要点「按 potentialLevel 取档、与影画无关」写在消费函数里，表常量看不出来）；克拉蕾 5（初始暴伤 floor 取整、影画分档四个值 + 门控、两态基准加权、铭刻窗口进两态时间解、锐能总量不设单次上限）；banyue 200s 判非法清零；欠打回填接受三条件；内层上限的环检测与耗尽出口；截断入口容差；折叠环上限的收敛判据；风化拆窗（windEffectiveTriggerCount / calcCoverage）；余火消耗；自动能量场三段 countsTime（两个融合组 + sustainedEx `'1031'` + fusedGroupMetrics）；手册密度公式；尼可影画1 缩放；柚叶影画4；派派影画2。anton 的 `ANTON_ID`、roxy 的 `SPIN_SECOND_MOVE_ID` 是永不变的 ID 锚（行为怎么改都不进队），换成行为锚 |
| 锚得对，不动 | 19 | 正文就是这个值 / 这张表 / 这份清单 15（融合表 7、克拉蕾反制支援配对、千夏拍照计划、MOVE_ETHER_BASE、蕾米埃尔 0.2、洛克茜等级轴、珂蕾妲×本 替换表、自指豁免清单、cinemaMirrorKeys）；锚变量本身包着判定逻辑 3（STACK_ENERGY_EVENT_EVALUATORS 求值函数表、dupTopLevel、sweepCandidates 的 computed）；测试标题锚 1（按文件判，属设计） |
| 行为在 >150 行调度函数里，不挂 | 3 | 棘轮反空洞（判定在 runAllChecks；有 checkGuards「棘轮反空洞 3 条」守行为）· ConvergenceReport（字段归属由 calcTeamResources / useResourceCalc 决定）· BOSS_BODY_SIZES（消费链在 TeamCompare） |

### 7.2 做法

- **多锚**：锚槽可写多个锚点，用 ` + ` 连接，与「验」同一写法（`zc.mjs#anchorList`）。判据 6 逐锚解析，任一断锚即红；`driftQueue` 逐锚判，任一锚变即进队，行的 anchor 只列变过的锚；`zc where` 任一锚路径命中即列出。`parseFactLine` / `formatFact` 不变（anchor 仍是原样字符串），单锚事实的行为一字不变。
- **锚解析统一到 AST**：`resolveAnchor` 对 TS/JS 改用与 drift 同一个声明定义（`anchorDecls`，`anchorCode` 也由它打印）。旧正则连 `符号(` 调用处、re-export 里的名字都认——审计绿，而 drift 定位不到声明、静默退回按文件判；带引号的对象键 anchorCode 认、正则反而不认（sustainedEx 的 `'1031'` 就是这种）。全仓 182 个锚（154 条事实 + 28 条 noun-triage modeled）实测（仓外 `anchorcmp720.mjs`）：180 个定位到声明、1 个测试标题、1 个 re-export 壳锚（noun-triage `2000002` → `core/resource/helpers.ts#calcEnergySource`），已改指声明处 `resourceIncome.ts`。非 TS/JS 文件仍走正则（现无此类锚）。
- **写法规则**（`zc lang` 语法自述已同步）：口径同时讲「值」和「怎么用」就两处都锚；行为锚取包含该行为的**最小具名声明**；最小的也是 >150 行的调度函数时不挂——那等于按文件判，噪声盖过信号——靠「验」守行为。
- **成本**：`auditAuthoredFacts` 单独计时 192 → 958ms（含首次加载 typescript）；check-guards 整体约 +0.25s（判据 27 本来就加载 typescript），两次实测 13.7 / 11.4s → 14.0 / 11.7s；`zc drift` 8.2s（r715 同状态 7.4s）。不加解析缓存。

### 7.3 结果

- 补行为锚后进复核队列 15 条，逐条看「据」日版本到现在的锚符号 diff（仓外 `review720.mjs`）：全是等价重构（potentialLevelOf / cinemaLevelOf / additionalAbilityActiveOf / settingOf 归一、去 cfg 强转、slotNetFrontline 单一来源、MoveTableLike 类型名）；anton 的 applyDefaultCinemaSkillLevelBonus、roxy 的 resolveRecoveryPerCount 是「据」日之后抽出的新函数，按现版本逐行核过 ⇒ 15/15 仍成立，「据」链追加 `复核@2026-10-07`。另 10 条的新锚在「据」日之后没变过。现状：154 条 · 断锚 0 · 待复核 0。
- 顺手：anton 正文与头注释里过时的 `computePanelPhases:658 / :711` 改指 `applyDefaultCinemaSkillLevelBonus`（computePanelPhases 与 computeEntrySnapshotPanel 两处调用）。
- 余火这条核出的不是漂移：catalog 的 `attack_data_0` 存的已是 14.7634（导入时 ÷10000），代码按行值直接计余火；标度本身的变化属数据变化，由该条的 ⟳复核 触发器管。
- 验证：vue-tsc 0；check-guards 27；tokens 12 / data 367 / specs 1120 / recording 189；vitest 263/2180 + 265/2356 = 528/4536（+2 例：多锚语法、临时 git 仓 drift 端到端）；build 去哈希比对 65/65 逐字节相同（src 只改了注释）。

### 7.4 剩余盲区与不做的事（重开条件见 r6 §8.0 #25）

- 行为在 >150 行调度函数里的 3 条（见 7.1 表）；行为在锚函数调用的跨文件 helper 里时仍会漏（banyue「走轴退化」在 solveTeam 的 topUpIllegal、jane「乱流不继承」在引擎侧、自动能量场的强特路径在 235 行的 helpers#buildCharConfig）。
- 不做：「锚 + 同文件引用方」自动扩展（r715 量过，加回来的基本是噪声）；函数锚自动带上同文件常量的值（会改 107 条函数锚的既有基线，收益未证）。
