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
- **已知盲区**（与手工「锚未变」相同）：口径行为写在锚符号之外时，使用处改动不触发。对策：**锚写在实现该行为的函数上**；常量锚只适合「口径就是这个值」的事实（例：banyue `AUTO_TOPUP_TIME_LIMIT_SEC` 的「超 200s 次数清零走轴退化」写在使用处，宜改锚）。
- 由此：TS/JS 锚不再需要「锚未变@」戳；§4 的「同一文件的条目尽量同批清掉」也不再必要。「不读代码不许批量补复核日」照旧（ENGINE_PIPELINE_GUIDE 坑 24 ②）。
