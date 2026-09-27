# R22-D1 批 1-2 裁决 + core 角色专属字段普查（交接文档）

> lane `lead-arena-0925c`，2026-09-26。本文件的结论在 MCP 隧道断线期间（ERR_NGROK_3200，跨多轮会话）推出，
> 恢复后原样落盘。**下一个会话只读本文件 + `docs/mcp-calc-core-architecture.md` 即可接着干。**

## 1. 做到哪一步

- **最新交接（2026-09-27 第 40 轮，lead-arena-0925c）**：**CC-32a 已落地 `0671c4c`**：`core/resource/crossAgentEnergy.ts` 席德正兵回能内联块 → 席德模块 `crossAgentSupply`（`kind: 'vanguard-energy'`，`perTargetAmounts` 出落点量 + 新可选钩子 `onOwnSlotCrossAgentEnergy` 回写 `xideVanguardEnergySpent`）；派发器泛化为 `perTargetEnergyByProvider(…, kind)`（`neighborUltEnergyByProvider` 保留为包装）。判据 22 从 270 降到 **254**，**target 258 已达成 → 重设 242**。verify EXIT=0。详见 §5.26。
  **下一步（可以直接开工）**：**CC-32b**（`CrossAgentEnergy` 5 个角色具名展示字段 → `byDisplayKey` 字典 + 结果卡按字典渲染；顺带补上席德正兵回能在结果卡**缺失的展示行**），开工清单见 §5.26。
- **上一轮交接（2026-09-27 第 39 轮，lead-arena-0925c）**：**CC-31 已落地 `0b8a28a`**：`CalcRoundThreads` 的 14 个模块下一轮反馈具名字段 → 通用 `moduleFeedback` 字典（键类型 `mechanics/types.ts#ModuleFeedback`，缺键 = 0）；21 文件（10 模块 + convergence/roundThreads/panelPhases/types + 5 测试 + 2 棘轮）。判据 22 从 326 降到 **270**（−56），**target 314 已达成 → 重设 258**。verify EXIT=0。详见 §5.25。
  **下一步（可以直接开工）**：**CC-32**（`core/resource/crossAgentEnergy.ts` 席德正兵回能块 → 模块能力；该文件簇判据 22 合计 29），开工清单见 §5.25。
- **上一轮交接（2026-09-27 第 38 轮，lead-arena-0925c）**：**CC-30 已落地 `371a2c1`**（`remielleEntryPanels` → `entrySnapshotPanels` 纯改名，13 文件 21 处；判据 17 的 `COMPACTED_ARRAYS` 名单与其 fixture 测试同步改名 ⇒ 新名仍受槽位索引守卫；AGENTS.md / ARCHITECTURE.md / ENGINE_PIPELINE_GUIDE.md / MECHANICS_IMPLEMENTATION.md 现行规则文档同步）。判据 22 从 332 降到 **326**，**target 328 已达成 → 重设 314**。verify EXIT=0。详见 §5.24。
  **下一步（可以直接开工）**：**CC-31**（`CalcRoundThreads` 里 14 个「模块下一轮反馈」具名字段 → 通用 `moduleFeedback` 字典；判据 22 最大一簇，预计 −40 以上），开工清单见 §5.24。
- **上一轮交接（2026-09-27 第 37 轮，lead-arena-0925c）**：**CC-29 已落地 `69b53f9`**。useResourceCalc `anomalyDamageEvents` 末尾按身份 `findSlotByIdentity(['1261'])` 的简 6 命事件分支 → jane 模块 `anomalyEventRecords`（入参扩 `cinemaLevel` / `perElementTriggerCounts`）；**useResourceCalc 已无 `findSlotByIdentity`**。判据 22 从 340 降到 **332**（target 328 未达成，维持）。verify EXIT=0。详见 §5.23。
  **下一步（可以直接开工）**：**CC-30**（`remielleEntryPanels` → 通用名纯改名，判据 22 预计 −6，可达成 target 328），开工清单见 §5.23。
- **上一轮交接（2026-09-27 第 36 轮，lead-arena-0925c）**：**CC-28 已落地 `69e85c4`**。useResourceCalc 的 `remielleVoidflareEvents`（按身份 `['1581']` 的编排层角色分支）改为通用的 `moduleAnomalyEventRecords` + 蕾米埃尔模块能力 `anomalyEventRecords`；ResultPage 同步改名；新增展示层单测 `moduleAnomalyEventRecords.test.ts`，期望值为迁移前旧实现的输出。判据 22 从 357 降到 **340**，target 重设 **328**。verify EXIT=0。详见 §5.22。
  **下一步（可以直接开工）**：**CC-29**（useResourceCalc 里简 6 命「强击暴击附伤」事件是同类编排层角色分支 → 复用 `anomalyEventRecords`），开工清单见 §5.22。
- **上一轮交接（2026-09-27 第 35 轮，lead-arena-0925c）**：**CC-26b 已落地 `0d65f59`**（rowBuild 里蕾米埃尔「光辉回转」后台行 → 模块能力 `backstageAutoRows`，在原位置派发）。判据 22 从 363 降到 **357**，target 351 未达成，维持不变。verify EXIT=0。详见 §5.21。
  **下一步（可以直接开工）**：**CC-28**（`useResourceCalc.ts` 的 `remielleVoidflareEvents` computed 是**编排层角色分支**，直接违反 AGENTS.md「禁止在 useResourceCalc 加角色分支」→ 模块能力），开工清单见 §5.21。
- **上一轮交接（2026-09-27 第 34 轮，lead-arena-0925c）**：**CC-26 已落地 `8b7d9db`**。core/resource 里蕾米埃尔「垂虹」必做动作行和时间合计改走模块能力 `extraNecessaryAction`（派发口 `rowAccounting.ts#extraNecessaryActionOf`）；「特殊虚耀」异常事件逐字迁入蕾米埃尔 `buildAnomalyEvents`。判据 22 从 403 降到 **363**（−40，core 内 `cfg.remielleRainbowEnd*` 读点一并消失），target 重设 **351**。verify EXIT=0。详见 §5.20。
  **下一步（可以直接开工）**：**CC-26b**（rowBuild 里蕾米埃尔「光辉回转」后台行 → 模块能力，**必须在原位置派发**），开工清单见 §5.20。
- **上一轮交接（2026-09-27 第 33 轮，lead-arena-0925c）**：**CC-25 已落地 `7cef9c8`**。爱丽丝畏缩配置迁为模块能力 `anomalyPoolSetup`；roundInputs 的 `aliceInfo` 改名 `anomalyPoolSetupInfo`，按能力找槽，不再用 `findSlotByIdentity(['1401'])`，也不再直读 `cfg.alice*`。判据 22 从 410 降到 **403**，target 398 未达成，维持不变。verify EXIT=0。详见 §5.19。
  **下一步（可以直接开工）**：**CC-26**（core/resource 里蕾米埃尔「垂虹」必做动作行 → 模块能力），开工清单见 §5.19；**先实读 §5.19 第 1 条列出的 4 个读点**。
- **上一轮交接（2026-09-27 第 32 轮，lead-arena-0925c）**：**CC-24 已落地 `1d1d823`**（畏缩配置通用化：`aliceCoweringConfig` → `coweringConfig`，`AliceCoweringConfig` → `CoweringConfig`，纯改名）。判据 22 从 420 降到 **410**，target 重设 **398**。verify EXIT=0。详见 §5.18。
  **下一步（可以直接开工）**：**CC-25**（roundInputs 的 `aliceInfo` 按身份找槽 + 直读 `cfg.alice*` → 爱丽丝模块能力 `anomalyPoolSetup`），开工清单见 §5.18。
- **上一轮交接（2026-09-27 第 31 轮，lead-arena-0925c）**：**CC-23 已落地 `8ecd5f2`**。般岳交互补齐的找槽从按身份 `findSlotByIdentity(['1471'])` 改为声明式 `producesInteractionTopUp`，补齐求解改走模块能力 `computeInteractionTopUp`，补齐量类型提到 `mechanics/types.ts#InteractionTopUp`；convergence / roundThreads / roundResult 不再 import 般岳模块。判据 22 从 430 降到 **420**，target 仍为 418（未达成）。verify EXIT=0。详见 §5.17。
  **下一步（可以直接开工）**：**CC-24**（`aliceCoweringConfig` 改名为通用的 `coweringConfig`：畏缩是物理强击附带的通用状态），开工清单见 §5.17。
- **上一轮交接（2026-09-27 第 30 轮，lead-arena-0925c）**：**CC-22（修订版）已落地 `05bb382`**。§5.15 原定的「纯改名为 teamAssaultCount」**作废**：实读 `aliceExternalCountsOf` 后确认，assault 是**爱丽丝自己**触发的 physical 强击，不是全队次数。改为走通用通道：爱丽丝 `nextRoundFeedback` 负责产出，`applyTeamConfig` 从 `threads` 读取，同时删掉 `AgentTeamConfigInput` 和 panelPhases 的专用字段，convergence 不再 import `aliceExternalCountsOf` / `aliceSlotOf`。判据 22 从 447 降到 **430**，target 重设 **418**。verify EXIT=0。详见 §5.16。
  **下一步（可以直接开工）**：**CC-23**（般岳交互补齐：convergence 里 `banyueSlot` 改为声明式找槽 + `computeBanyueInteractionTopUp` 升格为模块能力），开工清单见 §5.16。
- **上上轮交接（2026-09-26 第 29 轮，lead-arena-0925c）**：**CC-21 已落地 `3d000d0`**（全队异常乘区做成模块能力 `globalAnomalyMultiplierFactor`，并通用改名为 `globalAnomalyMultiplier`；lead 自做，没派工人，因为改动面只有约 17 处机械改名 + 1 个 computed + 1 个模块方法）。判据 22 从 462 降到 **447**，target 重设 **435**。master 上 `npm run verify` EXIT=0（291 个测试文件 / 3559 条测试），HEAD `3d000d0`（docs 提交在其后）。详见 §5.15。
  **下一步（可以直接开工）**：**CC-22**（回合线程字段 `aliceTeamAssaultCount` / `aliceDisorderCount` 通用改名为 `teamAssaultCount` / `teamDisorderCount`，纯改名），开工清单见 §5.15。
- **上一轮交接（2026-09-26 第 28 轮，lead-arena-0925c）**：**CC-19 全部完成**。19c-1 `b45652c`、19c-2 `de1cc8d`（蕾米埃尔块 6 迁 `extraAnomalyRows`），判据 22 545→535→**499**（target 重设 487）。**CC-20 `ea61032`**：判据 22 口径纠正，5 个 trigger* 触发者通用名加入豁免，读数 499→**462**，target 平移到 **450**（换尺，规则 17②，单独提交）。master 上 `npm run verify` EXIT=0，HEAD `ea61032`（docs 提交在其后）。详见 §5.14。
  **下一步（可以直接开工）**：**CC-21**（全队异常乘区 `remielleAnomalyMultiplier` 做成模块能力，并通用改名为 `globalAnomalyMultiplier`），开工清单见 §5.14。
- **上一轮交接（2026-09-26 第 27 轮，lead-arena-0925c）**：**CC-19b 已落地 `3fbb326`**（爱丽丝极性强击 / C6 / 畏缩 + 简 C6 迁 `extraAnomalyRows`，工人 `d1dd95a`）。判据 22 从 601 降到 **545**，target 重设 **533**。master 上 `npm run verify` EXIT=0，HEAD `3fbb326`。19c 已实读并定稿（设计稿 §7.2）。详见 §5.13。
  **下一步（可以直接开工）**：**CC-19c**（蕾米埃尔块 6，分 19c-1 准备步 + 19c-2 迁块步，同一 worktree 里两个提交），开工清单见 §5.13。
- **上一轮交接（2026-09-26 第 26 轮，lead-arena-0925c）**：CC-19 设计稿 `docs/mcp-cc19-extra-anomaly-rows.md`（`c7f2068`，README §6 已登记为 48 份），**CC-19a 已落地 `b14fb4a`**（柏妮思 C6 灼烧迸发迁 `extraAnomalyRows`，工人 `7be6233`）。判据 22 从 613 降到 **601**，target 重设 **589**。master 上 `npm run verify` EXIT=0，HEAD `b14fb4a`。详见 §5.12。
  **下一步（可以直接开工）**：**CC-19b**（爱丽丝极性强击 / C6 / 畏缩 + 简 C6 迁 `extraAnomalyRows`）。接口已在设计稿 §7.1 定稿，不需要再设计，直接派工人：提示词以 `/home/kaua/calc-arch/cc19a.prompt` 为模板，块号、替换规则按 §7.1 改。
- **上一轮交接（2026-09-26 第 25 轮，lead-arena-0925c）**：CC-18b 已落地 `a936127`（设计定稿见设计稿 §7.1，`583f2ea`；dsflash 工人实现 `1a8c98e`，lead 复核）。判据 22 从 623 降到 **613**，target 611 不变。master 上 `npm run verify` EXIT=0，HEAD `a936127`。详见 §5.11。
  **下一步（可以直接开工）**：**CC-19 设计**（异常侧角色块能力化；CC-18c 柏妮思异常侧是它的第一片）。开工清单见 §5.11。
- **上一轮交接（2026-09-26 23:1x，lead-arena-0925c 第 24 轮）**：CC-18a 已落地 `23470f2`（设计稿 `docs/mcp-cc18-extra-direct-rows.md`，`3b9e75c`，README 已登记；dsflash 工人实现 `6e0de26`，lead 复核）。判据 22 从 661 降到 **623**，target 重设 **611**。master 上 `npm run verify` EXIT=0，HEAD `23470f2`。
  **下一步（可以直接开工）**：**CC-18b**（琉音 3 块附加直伤行迁 `extraDirectRows`），开工清单见 §5.10。它是同一设计稿的第二期，不需要新设计稿，只需在设计稿 §7 补接口扩展。
- **最新交接（2026-09-26 22:4x，lead-arena-0925c 第 23 轮）**：CC-17 已落地 `18bfd88`（设计稿 `docs/mcp-cc17-axis-overlay-consume.md`，`6038a70`；dsflash 工人实现 `df83ebd`，lead 复核）。判据 22 从 712 降到 **661**，target 重设 **649**。**顺带修了一个真 bug**：可琳扫除帮手在轴模式下经全局桶泄漏给队友的普攻行（设计稿 §2，已加泄漏锁）。master 上 `npm run verify` EXIT=0，前后 HEAD 都是 `18bfd88`。
  **下一步（可以直接开工）**：**CC-18 设计稿**（柏妮思 `burniceSrc` 簇，43 处），卡面见 §5.9。**新文档必须登记进 README §6**（坑见 §5.9）。
- **最新交接（2026-09-26 22:0x，lead-arena-0925c 第 22 轮）**：CC-16 已落地 `fe8fb90`（lead 直接做，纯改名）。判据 22 从 733 降到 **712**，**提前达成 target 720 → 已重设 target 700**。master 上 `npm run verify` EXIT=0，前后 HEAD 都是 `fe8fb90`。
  **下一步（可以直接开工）**：**CC-17 设计稿**（axis overlay 消费端的模块能力化，合计约 30 处），范围、现状和设计要点见 §5.8。先出设计稿并落盘（`docs/mcp-cc17-axis-overlay-consume.md`），再实现。如果本轮时间不够出设计，可以先做 §5.8 列出的零散小项（每项 1–2 处）。
- **最新交接（2026-09-26 21:4x，lead-arena-0925c 第 21 轮）**：CC-15 已落地 `b1ed48e`（lead 直接实现：纯改名，用 sed 按词边界批量替换，19 个文件，另加注释 2 处和常量 2 处）。判据 22 从 759 降到 **733**，**提前达成 target 740 → 已重设 target 720**（due 2026-12-31）。master 上 `npm run verify` EXIT=0，前后 HEAD 都是 `b1ed48e`。
  **下一步（可以直接开工）**：**CC-16**（`banyueTopUp` 改为 `interactionTopUp`，A 类纯改名），卡面见 §5.7。零差基线 H2a 仍然有效（CC-15 对它零差；alias 映射只作用于新键名）。
- **最新交接（2026-09-26 21:1x，lead-arena-0925c 第 20 轮）**：CC-14e 已落地 `1e3dc99`（dsflash 工人实现 `ee0bd8b`，lead 复核、零差、反向验证，重写提交信息）。判据 22 从 763 降到 **759**；target 740，还差 19。master 上 `npm run verify` EXIT=0，前后 HEAD 都是 `1e3dc99`。
  **下一步（可以直接开工）**：派 **CC-15**（赠行通用命名，A 类改名，预计减少约 25–30 处，可达成 target 740），卡面见 §5.6。零差基线 H2a（`007a6b7`）经 CC-14c/d/e 传递仍然有效；但 CC-15 要给 KEY_ALIAS 加新条目，**基线须在加 alias 之后、在原始 worktree 上带 `PERF_KEY_ALIAS=1` 重新生成**（alias 对原始代码不起作用，所以 H2a 其实也能用；稳妥起见重新生成 H3a）。
- **最新交接（2026-09-26 20:5x，lead-arena-0925c 第 19 轮）**：CC-14c 已落地 `ba6db48`，CC-14d 已落地 `e94b896`（卡面在 §5.5，都由 lead 直接实现，每卡改 4–8 个文件）。判据 22 从 775 降到 766，再降到 **763**，**提前达成原 target 765**。因为棘轮测试要求 target < frozen，**已重设 target 740、due 2026-12-31**（决定与依据见 §5.5）。两张卡在 master 上都跑了 `npm run verify`，EXIT=0，前后都钉了 HEAD。
  **下一步（可以直接开工）**：CC-14e，卢西娅帷幕写回迁模块，卡面见 §5.5 末尾。零差基线须在当前 HEAD 的原始 worktree 上重新生成（§4 口径）；H2a 生成于 `007a6b7`，CC-14c/d 已证明零差，所以 H2a 对 `e94b896` 仍然有效，可以直接复用。
- **最新交接（2026-09-26 20:2x，lead-arena-0925c 第 18 轮）**：CC-14a 已落地，提交 `285885b`（修订卡 §5.2-v2 = `a16d9ae`）。判据 22 从 803 降到 **775**，距 target 765 还差 10。master 上 `npm run verify` EXIT=0，前后 HEAD 都是 `285885b`，按 AGENTS「钉 HEAD」规则可归因。
  **下一步（可以直接开工）**：立 CC-14c 卡，范围如下（§5.4 末尾已登记）：
  - `core/resource/assembleSlot.ts:57–60` 把外部治疗写回 `cfg.yidhariExternalHealPct`；
  - ctx 里的 `yidhariSlot`（`tailPipeline.ts` 中 `configs.findIndex(c => c.yidhariDecibelPerHpPct !== undefined)`）。
  做法：改成模块能力，例如 `onFinalAssemble({ cfg, providerUltCount })`。立卡前先 `grep -rn yidhariSlot src/core` 找全消费点，用判据 22 的读数估算降幅；若够 10 处，就能提前达成 target 765。
  零差口径沿用 §4（两侧 `PERF_KEY_ALIAS=1`，基线在当前 HEAD 的原始 worktree 上重新生成）。
- **最新交接（2026-09-26 19:5x，lead-arena-0925c 第 17 轮）**：CC-14b 已落地，提交 `6d8a995`（卡 `b88b1a6`，§5.4）。判据 22 从 821 降到 **803**。R1 已由并行会话完成（`ce307a0` / `4d80086`），所以 **CC-14a 的前置门已经打开**。
  **下一步（可以直接开工）**：派 CC-14a（§5.2）。派发前在当前 HEAD 按 §4「零差基线口径」重新生成基线，`dump-A` / `rows-A` / `*-H0*` 都已过期（`H0a` 生成于 `f0df0cb`，之后 R1 改了 src）。CC-14a 与 CC-14b 不交叠：CC-14a 动的是 resourceIncome 的命座能量段，以及 `EnergySource` / `ResourceResultCard`。
  再下一步：CC-14c（§5.4 末尾，登记未立卡），以及 B 类里不涉及能量的槽位变量卡。
  worktree `/home/kaua/r66-scratch/cc14b`、`/home/kaua/r66-scratch/h0` 已于收工时 `git worktree remove` 删除。
- **最新交接（2026-09-26 19:2x，lead-arena-0925c）**：WSL 停摆恢复；事故落档 + AGENTS 环境安全规则 = `24bb4e9`。普查已完成，结果、分类和 CC-14a 卡见 §5。**下一步**：① CC-14a 等 R1 合入后派发（前置门见 §5.2）；② ~~实现 §5.3 计数棘轮~~ 已落地（判据 22，基线 821）；③ 架构文档 §5 与 OPEN-ITEMS R22-D1 标注「批 1-2 不做」并链到本文件 §2。R1（`docs/REQUIREMENTS.md`）由并行会话在做，本 lane 不碰。
- HEAD（断线前最后实测）= `d983b5a` refactor(resource): CC-13 generic continuous-EX channel（R22-D1 批 1-1）。
  前序：`5c82c16`（CC-13 v2 卡）、`3cc3953`（CC-13 卡）、`4dd4961`（CC-D2）。工作区只有与本线无关的 `?? docs/devlog/`。
- 架构卡（`docs/mcp-calc-core-architecture.md` §5）：CC-0…CC-13、CC-D1…D4、CC-T1 均 done；CC-5e / CC-9c 不做；CC-11b 暂缓。
- 基线（WSL `/home/kaua/calc-arch/`，不入库）：`dump-A.json` 624 场景、`rows-A.json` 637 场景，已按 CC-13 新键名在
  `d983b5a` 重生成（旧版 `old/*-pre13.json`）。
- 无在跑工人；租约已清空。

## 2. 本轮拍板：R22-D1「批 1-2」= 不做（lead 自主裁决）

- **原设想**：把比利 `billyFinalizeChain`、叶瞬光 `yeshuguangFinalizeForms` 并入 CC-13 的通用连续通道（`exFinalize`）。
- **实测依据**（`grep -rn 'billyFinalizeChain\|yeshuguangFinalizeForms' src`，排除 __tests__）：
  - 两个旗标**只被各自模块读写**（`mechanics/agents/starlightBilly.ts`、`yeshuguang.ts`）；core / resourceCalc **零读取**。
  - 引擎经通用 `finalizePass` 能力（`core/resource/finalizePasses.ts#runFinalizePasses / resetFinalizePasses`，CC-6c 落地）
    调用它们的 `begin/reset` ⇒ 架构上**已经通用**。
  - 语义也不同：`exFinalize` = 强特次数终局取整；比利 = 连携链数；叶瞬光 = 形态轮数。强并会混淆口径。
- **影响**：OPEN-ITEMS R22-D1 条目里「下一步候选批 1-2」作废；债 1a 本体（全局实数化松弛推广 + 逐模块重校准）仍在，
  属改数值，需另立项。
- **回退点**：纯文档裁决，无代码改动；若日后要做，按 CC-13 卡的范式重开即可。

## 3. 下一步（优先级最高，可直接开工）：core 角色专属字段普查 → CC-14 系列

**问题**：`core/**` 不写 agentId 判定已有棘轮，但**直接读角色前缀字段**（如 `cfg.billyC1Energy`）不受任何棘轮约束，
CC-13 已证明这类读取可以零 delta 通用化。断线前已观测到的样本：

| 位置 | 字段 |
|---|---|
| `core/resource/resourceIncome.ts` 能量合计 | `qingyiC4Energy`、`lycaonC2Energy`、`billyC1Energy`、`yixuanFlashBonus`、`antonC1EnergyGift`、`zhenyuanEnergy`、`hatTrickEnergy` 等 |
| `core/resource/resourceIncome.ts` / `helpers.ts` | 伊德海莉其余字段约 60 处（`yidhariBurnDecibel`、`yidhariDecibelPerHpPct`、`yidhariChargeSlam`、`yidhariBasicFollow`、`yidhariExternalHealPct`…） |
| `core/resource/underfillProbe.ts` | `yeshuguangAutoAxis` |
| `composables/resourceCalc/damagePool.ts` | `yeshuguangStunCapMult`、`yeshuguangVeilStunBase` |
| `composables/resourceCalc/convergence.ts` | `yeshuguangGiftUlt*` |

**步骤**：
1. 跑普查脚本（WSL `/home/kaua/calc-arch/census.sh`；若不存在，按下方附录重建），产出「文件 × 字段 × 次数」全表，
   写入本文件 §5。
2. 逐字段分三类：**A 通用化**（数学通用、只是名字专属 → 同 CC-13 改通用字段）；**B 迁模块能力**（逻辑本身角色专属 →
   `getAgentMechanic(cfg.agentId)?.<能力>`，同 CC-6 系列）；**C 保留**（写明理由）。
3. 按簇拆卡 CC-14a/b/…（每卡 ≤ 1 个角色或 1 个通道），卡面照 CC-13 v2：字段映射表 + 闸门 grep + `PERF_KEY_ALIAS` 映射表更新
   + 反向验证。首选 CC-14a = `resourceIncome.ts` 能量合计的命座能量项（最集中、最机械）。
4. 在 `scripts/check-guards.mjs` 加计数棘轮「core 读角色前缀字段 ≤ 现值」（只许降），基线取步骤 1 的总数。

## 4. 已知坑（务必照做）

- 纯改名会让 dump 哈希全变（结果对象的键名进哈希）⇒ 用 `.zc/perf/{dump,rowsnap}.perf.ts#enc` 的 `PERF_KEY_ALIAS=1`
  开关，映射表 `KEY_ALIAS` / `KEY_DROP` 随卡追加；证明零差后不带开关重生成基线。
- 复核脚本里别把函数命名为 `cmp`（遮蔽 `/usr/bin/cmp`）；用 `cmpj`。
- `pkill -f <模式>` 会杀掉执行它的 shell；按 pid `kill`。
- `bg.sh` 会先 `cd` 到仓库 ⇒ 传**绝对路径**；`a && b && setsid ... &` 会把整条链丢后台被杀，写文件与起后台分开。
- 工人被中途停掉时不会 `zc release`：`.zc/leases.json` 按 lane 逐个 `ZC_LANE=<lane> node scripts/zc.mjs release --all`。
- 工人在跑时 lead 不碰 `src/`。
- **`wsl_exec` 返回时会结束它派生的后台进程**：`setsid bash -c '...' &` 起的任务活不下来（2026-09-26 实测：log 文件都没生成）。要在后台存活，必须用 `setsid /home/kaua/calc-arch/bg.sh <名> '<命令>'`（内部走 `nohup`），结果在 `<名>.log` 末尾的 `EXIT=` 行。
- `git diff` 里可能混有并行会话的 WIP（本轮见到 `cinemaUplift*` / `ResourceUtilizationPage.vue` / `check-tokens.mjs`，属于 R1），提交一律按规则 13 带路径。
- **零差基线口径必须两侧对齐（2026-09-26 CC-14b 实测踩坑）**：`PERF_KEY_ALIAS=1` 会把 CC-13 的新键名映射回旧名，并剔除 `exRefundFreeCap`。基线如果不带这个开关生成、新代码却带开关跑，全部 624 个场景都会显示 DIFF。正确做法：在一个停在基线提交的 detached worktree 里，用**同一份** `.zc/perf`（已加上本卡的 alias），两侧都带 `PERF_KEY_ALIAS=1` 生成快照。脚本见 WSL `/home/kaua/calc-arch/verify14b.sh`，比对用 `node /home/kaua/calc-arch/cmp.mjs A B`，其中 `__ms` 是耗时元数据，出现差异属正常。
- **dsflash 工人可能在验证中途退出**（CC-14b：改完代码、正在排查口径时 EXIT=0，没有提交）。lead 必须自己复核 diff、跑完验证再提交；不要因为工人「EXIT=0」就判定完成。
- worktree 惯例：`git worktree add --detach /home/kaua/rNN-scratch/<名> <提交>`，然后把 `node_modules` 软链到主仓库，并 `cp -r .zc/perf`（gitignored，不会随 checkout 带过来）。派工人用 `/home/kaua/calc-arch/run-wt.sh <key>`（cd 目录已改成 cc14b，换 worktree 时改 sed）。
- **dump 覆盖盲区（2026-09-26 CC-14a 实测）**：dump 只对 0 号位切换命座（default/c0/c6）。非 0 号位角色的高命座效果（例如青衣影画 4，青衣在所有预设里都不在 0 号位）**不在零差覆盖面内**。反向验证必须挑在 dump 里真实生效的项：CC-14a 先挑青衣得到 DIFF 0，改挑仪玄 1371 后 DIFF 36。覆盖面外的项靠单元测试兜底（`qingyiC4Energy.test.ts`）。若要补覆盖面，可给 `.zc/perf/dump.perf.ts` 加「全队 c6」变体（会改变基线键集）。
- **并行 lead 的 src 提交会让对方的全量检查假红**（AGENTS.md「钉 HEAD」规则，`585dcf3`）。本线挑回 master 的 src 提交（`6d8a995` 19:41、`285885b` 20:12）都写进了 `.zc/lead-coordination.md`，方便对方归因。
- 工人提交信息会照抄模板里的占位符（「803->实测值」），lead 用 `git cherry-pick -n` 加 `-F msgN.txt` 重写提交信息。
- 工人遵守仓库规则 13，不用 `git add -A`，改为显式路径。以后提示词里直接写显式路径。

## 5. 普查结果

（2026-09-26 19:1x，HEAD `24bb4e9`，lead-arena-0925c 实测）

**脚本与口径**：WSL `/home/kaua/calc-arch/census.mjs`（不入库；已改为用 `git ls-files` 取清单，后台 + `timeout -s KILL 30` 跑，秒级完成）。
- 扫描范围：`git ls-files 'src/core/*.ts' 'src/composables/resourceCalc/*.ts' src/composables/useResourceCalc.ts`，排除 `__tests__`，共 64 个文件、约 1MB。
- 匹配规则：`\b(<角色前缀>)[A-Z]\w*\b`，前缀取 `src/mechanics/agents/*.ts` 文件名开头的小写词，共 58 个。
- 代码与注释分开计数。完整明细用 `node census.mjs --json` 生成。

**局限（下一个会话务必知道）**
1. **只认角色前缀**。`zhenyuanEnergy`、`hatTrickEnergy` 这类不带角色前缀的专属字段会漏计。
2. **有误报**。`triggerCount`（84 处）是通用的「异常触发次数」（`core/anomalyPool.ts:80` 的 `simulateTriggerCount(...).triggerCount`），不是角色扳机（Trigger）的字段，统计时必须排除。
3. 预检时既没有超过 300k 的文件，也没有符号链接，所以第一次失控的根因**仍未查明**，见附录 A。

**总量**：代码引用 **905** 处（其中误报 `triggerCount` 84 处 ⇒ 真实约 **821**），注释引用 192 处；代码里出现 185 个不同字段，分布在 33 个文件。其中 `src/core/**` 有 334 处、87 个字段。

**按角色前缀（代码引用 ≥ 10）**：

| 前缀 | 引用 | 字段数 |
|---|---|---|
| remielle | 202 | 37 |
| trigger（含误报 triggerCount 84） | 121 | 6 |
| alice | 90 | 23 |
| liuyin | 59 | 11 |
| burnice | 48 | 4 |
| banyue | 44 | 7 |
| norma | 42 | 14 |
| yixuan | 37 | 9 |
| jane | 33 | 5 |
| velina | 29 | 9 |
| yidhari | 28 | 9 |
| xide | 19 | 5 |
| lighter | 18 | 5 |
| corin | 17 | 3 |
| promia | 14 | 4 |
| hugo | 11 | 5 |

**按文件（前 10）**：

| 文件 | 引用 | 字段数 |
|---|---|---|
| `composables/resourceCalc/damagePoolAnomaly.ts` | 140 | 28 |
| `composables/resourceCalc/convergence.ts` | 86 | 33 |
| `composables/useResourceCalc.ts` | 53 | 23 |
| `core/anomalyPool.ts` | 53 | 9 |
| `composables/resourceCalc/damagePoolCharExtras.ts` | 50 | 6 |
| `core/anomalyPool/helpers.ts` | 48 | 8 |
| `composables/resourceCalc/damagePoolDirect.ts` | 43 | 16 |
| `core/resource/crossAgentEnergy.ts` | 39 | 11 |
| `core/resource/helpers.ts` | 37 | 17 |
| `core/resource/resourceIncome.ts` | 37 | 16 |

### 5.1 分簇归类（A 通用化 / B 迁模块能力 / C 保留）

| 簇 | 代表字段 | 类 | 依据 | 卡 |
|---|---|---|---|---|
| resourceIncome 命座能量 | 周期型：`normaC2TriggerInterval/EnergyPerTrigger`、`qingyiC4TriggerInterval/EnergyPerTrigger`；定值型：`lycaonC2Energy`、`billyC1Energy`、`yixuanFlashBonus`、`antonC1EnergyGift` | **A** | core 里只有「间隔×每次」和「定值」两种算式，全部由模块写入（qingyi.ts:145、lycaon.ts:238、billy.ts:114、yixuan.ts:373、anton.ts:79），core 只负责求和 | **CC-14a**（首选） |
| 伊德海莉燃血喧响（resourceIncome + helpers 两处同式） | `yidhariBurnDecibel`、`yidhariDecibelPerHpPct`、`yidhariExHealMissingHpPct`、`yidhariExternalHealPct`、`yidhariChargeSlam`、`yidhariBasicFollow` | **B**（2026-09-26 读码改判，见 §5.4） | 与 CC-13 同一角色、同一类「模块写数值、core 求和」的形状 | CC-14b（§5.4） |
| 槽位定位变量 | `remielleSlot`、`aliceSlot`、`janeSlot`、`triggerSlot`、`triggerPanel`、`banyueSlot`、`xideIdx`、`liuyinIdx`、`burniceSrc`、`liuyinSrc` | **B** | 本质是在编排层按角色找槽位，等于变相的 agentId 判定 | 按角色逐卡，先从引用最少的起 |
| 蕾米尔 remielle 机制 | `remielleCinema*`、`remielleSpecialVoidflare*`、`remielleRainbowEnd*`、`remielleRefringe*`，散布在 `core/buff.ts`、`core/panel.ts`、`core/resource/rowBuild.ts`、`rowAccounting.ts` | **B** | 角色专属逻辑深入 core 面板和行构建，引用最多（202 处、37 个字段） | 需要单独做设计稿再拆卡，不直接派 |
| 爱丽丝 alice / 琉音 liuyin / 般岳 banyue / 诺玛 norma 专用流程 | `aliceCoweringConfig`、`aliceDisorderCount`、`liuyinPromote*`、`banyueTopUp`、`normaGiftChain` | B | 已有专用文件（`liuyinPromote.ts`、`normaHatChain.ts`），属于能力接口的下一阶段 | ⚠ `liuyinPromote` 与 `docs/mcp-liuyin-promote-source.md` W26 重设计线相交，要等那条线结束 |
| 误报 | `triggerCount` | 排除 | 通用异常触发次数 | 棘轮计数时加入豁免表 |

**结论**：CC-14a 可以直接开卡。B 类里的 remielle 和 liuyin 两簇不直接派，需要先有设计稿，或等并行线结束。

### 5.2 CC-14a 任务卡：resourceIncome 命座能量项通用化（A 类，零差）

- **前置门（必须满足才派）**：R1（`docs/REQUIREMENTS.md`，命座提升率多指标）已合入，且工作区里没有 `cinemaUplift.ts` 的 WIP。依据：R1 的「能量」栏很可能读取 `energySource`，两边会相交。先 `git status --short src/` 确认干净。
- **目标**：core 不再出现 `qingyiC4*`、`normaC2*`、`lycaonC2Energy`、`billyC1Energy`、`yixuanFlashBonus`、`antonC1EnergyGift` 这些名字。
- **输入端**：`CharacterOperationConfig` 新增 `bonusEnergyEntries?: Array<{ key: string; label: string; flat?: number; interval?: number; perTrigger?: number }>`。
  - 模块改成往里 push：qingyi、norma 用周期型；lycaon、billy、yixuan、anton 用定值型。
  - 每轮必须先清空，避免跨轮累加。先读 `finalizePasses.ts` 的 reset 时机，照同款处理。
- **core**：`resourceIncome.ts` 统一求和，`floor(totalTime / interval) * perTrigger + flat`。对照原算式：interval ≤ 0 或 perTrigger ≤ 0 时记 0，不能改变取整口径。
- **输出端**：`EnergySource` 删掉这 6 个键，新增 `bonusEntries: Array<{ key; label; value }>`。
  - `ResourceResultCard.vue` 原来的 6 个固定行改成 `v-for`，中文标签照搬现有文案。
  - `zhenyuanEnergy` 不属于角色前缀字段，本卡不动。
- **闸门**：`grep -rnE 'qingyiC4|normaC2|lycaonC2Energy|billyC1Energy|yixuanFlashBonus|antonC1EnergyGift' src/core src/composables/resourceCalc src/composables/useResourceCalc.ts` 结果为 0 行（注释也要清掉或改写）。
- **零差验证**：在 `.zc/perf/{dump,rowsnap}.perf.ts#enc` 里把 `bonusEntries` 按 key 展开回旧键名（映射加进 `KEY_ALIAS`），然后带 `PERF_KEY_ALIAS=1` 跑 dump（624 场景）和 rowsnap（637 场景），与 `dump-A` / `rows-A` 零差。
  - 反向验证：临时把 qingyi 的 perTrigger 改成 0，DIFF 必须只出现在含青衣的场景。
- **收尾**：`npm run build`、check-guards 全绿；带 `--verifier --coverage` 执行 `zc done`；lead 复核后不带开关重新生成基线。
- **回退点**：单卡单提交，`git revert <sha>` 即可。
- **派给**：dsflash 工人。提示词要求附上真实命令输出的尾部。

#### 5.2-v2 CC-14a 修订卡（2026-09-26 第 18 轮 lead-arena-0925c，**取代上文「输入端 / core / 零差验证」三条**）

> **已落地 `285885b`（2026-09-26 20:12）**。实现由工人在 worktree 提交 `de3be8d`，lead 复核后 cherry-pick 并重写提交信息。
> 验证：
> - dump 624 / rowsnap 637 零差（两侧 `PERF_KEY_ALIAS=1`，基线 H1a @ `66ba89a`）；
> - 反向验证：仪玄 value×0 共 36 处 DIFF，全部在 1371 场景。卡面原写的青衣反向得到 DIFF 0，原因是覆盖盲区，见 §4；
> - 定向 10 个测试文件 254 条通过，`vue-tsc -b` 为 0，master 全量 verify EXIT=0；判据 22 从 803 降到 775。
> 工人偏离卡面两处，lead 认可：
> - `src/core/__tests__/cinemaSkillLevel.test.ts` 的诺玛断言改成经 `normaMechanic.bonusEnergy` 取值（9×25），按 label 取，避开闸门字面量；
> - 没用 `git add -A`（规则 13），改为显式路径。

**决定：改用「模块能力」方案，输入端不动。**
- **依据（读码实测）**：
  - 如果输入端改成 `bonusEnergyEntries` 列表，6 个模块的内部契约要全部重写：`yixuanFlashBonus` 是跨阶段 `+=` 累加通道，有 record 归一化（`yixuan.ts:373/540`）；`lycaonC2Energy` 在收敛期按失衡次数写入（`lycaon.ts:238`）。另有 9 个测试文件直接读写这些 cfg 字段。
  - 判据 22 只数 core 对角色前缀字段的读取，模块写自己 cfg 上的私有字段不违规。
  - 与 CC-14b（`selfBurnDecibel`）同款，符合规则 6「引擎按能力查询」。
- **回退点**：单卡单提交，`git revert`。日后若仍想统一输入端，可以在模块能力内部改，不影响 core。

**做法**
1. `src/types/resource/energy.ts`：
   - 新增并导出 `export interface BonusEnergyEntry { key: string; label: string; value: number; detail?: string }`。
   - `EnergySource` 删去 `hatTrickEnergy`、`qingyiC4Energy`、`lycaonC2Energy`、`billyC1Energy`、`yixuanFlashBonus`、`antonC1EnergyGift` 这 6 个键。
   - 在原 `hatTrickEnergy` 的位置新增 `bonusEntries: BonusEnergyEntry[]`，注释写「角色专属能量项，由模块能力 bonusEnergy 声明，已计入 e0/total」。
2. `src/mechanics/types.ts` 的 `AgentMechanicModule` 新增可选能力：
   `bonusEnergy?(input: { cfg: CharacterOperationConfig; totalTime: number }): BonusEnergyEntry[]`
   注释写明：值为最终能量（未乘任何系数），调用方直接计入 e0；每个模块只报告自己 cfg 的项。
3. 6 个模块各自实现，都只返回 1 个条目。本地定义 `const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : 0`，与 `resourceIncome.ts:37` 同式。

   | 模块 | key | value（与 `resourceIncome.ts` 现有算式逐字相同） | label | detail |
   |---|---|---|---|---|
   | norma.ts | `hatTrickEnergy` | `n(per)>0 && interval>0 ? Math.max(0, Math.floor(totalTime/interval)) * n(per) : 0`，其中 per=`cfg.normaC2EnergyPerTrigger`，interval=`n(cfg.normaC2TriggerInterval)` | 帽子把戏 | 影画2：25/次 × 20s 冷却（按战斗时间触发） |
   | qingyi.ts | `qingyiC4Energy` | 同上式，用 `qingyiC4EnergyPerTrigger` 和 `qingyiC4TriggerInterval` | 稳态电弧屏障 | 青衣影画4：5/次 × 10s 冷却（护盾刷新回能） |
   | lycaon.ts | `lycaonC2Energy` | `n(cfg.lycaonC2Energy)` | 能量回馈 | 莱卡恩影画2：(失衡次数 + 队伍连携总次数) × 5 |
   | billy.ts | `billyC1Energy` | `n(cfg.billyC1Energy)` | 闪亮登场 | 比利影画1：冲刺/闪反命中按 5s ICD 封顶 |
   | yixuan.ts | `yixuanFlashBonus` | `n(cfg.yixuanFlashBonus)` | 额外闪能 | 仪玄：完美格挡 +10/次、极限闪避 +5/次、影画1落雷 +5/次 |
   | anton.ts | `antonC1EnergyGift` | `n((cfg as any).antonC1EnergyGift)` | 影画1回能 | 安东影画1：钻击招式回能（每招上限） |

   key 故意沿用旧 EnergySource 键名，方便零差展开和测试迁移。
4. `src/core/resource/resourceIncome.ts`：
   - 删除第 92–119 行的 6 段，改成：
     `const bonusEntries = getAgentMechanic(cfg.agentId)?.bonusEnergy?.({ cfg, totalTime }) ?? []`
     `let bonusEnergyTotal = 0; for (const e of bonusEntries) bonusEnergyTotal += e.value`
     import 写法照 `import { getAgentMechanic } from '@/mechanics'`（文件第 18 行已有）。
   - e0 里在原 `+ hatTrickEnergy` 的位置换成 `+ bonusEnergyTotal`，并删掉另外 5 项。浮点逐位不变：每个 cfg 至多 1 项非零，x + 0 = x。
   - 返回对象在原 `hatTrickEnergy` 的位置写 `bonusEntries: [...bonusEntries]`，删掉另外 5 个键。**不要调换其他键的顺序**，零差展开依赖键序。
   - 所有提到这 6 个名字的注释都要改写，闸门连注释一起数。
5. `src/components/ResourceResultCard.vue`：把「帽子把戏」「稳态电弧屏障」两个固定行替换成
   `<div v-for="e in result.energySource.bonusEntries.filter(x => x.value > 0)" :key="e.key" class="breakdown-row">`，里面用 bd-label/bd-value(`fmt(e.value)`)/bd-detail（`v-if="e.detail"`）。
   其余 4 项因此首次在卡片上显示，这是有意为之：它们本来就计入总账，符合「记账 == 展示」。
6. 测试迁移：
   - `src/mechanics/__tests__/qingyiC4Energy.test.ts` 第 52/57 行、`lycaonC2Contract.test.ts` 第 446/469 行，读法改成 `energySource.bonusEntries.find(e => e.key === 'qingyiC4Energy')?.value ?? 0`（莱卡恩同理）。
   - 其余测试只读 cfg 字段，不用改；如果 `vue-tsc` 报别的构造点，照同法修。
7. 判据 22 会下降，以实测为准。把 `scripts/lib/core-role-field-ratchet.mjs` 的 `CORE_ROLE_FIELD_BASELINE` 和 `scripts/check-guards.mjs` 里 RATCHET_BURNDOWN「core 角色前缀字段」的 frozen（当前 803）同步改成实测值，frozen 的注释前面加上「2026-09-26 CC-14a 803→实测」。

**闸门**
`grep -rnE 'qingyiC4|normaC2|lycaonC2Energy|billyC1Energy|yixuanFlashBonus|antonC1EnergyGift|hatTrickEnergy' src/core src/composables/resourceCalc src/composables/useResourceCalc.ts` 结果为 0 行（注释也算）。

**零差（口径见 §4「零差基线口径」）**
- `.zc/perf/{dump,rowsnap}.perf.ts` 的 remap 已由 lead 加入 `bonusEntries` 按旧键序原位展开：展开到 `bonusEntries` 的位置时依次输出 hatTrick、qingyi、lycaon、billy，`exRefundEnergy` 之后输出 yixuan、anton。
- 基线 `/home/kaua/calc-arch/{dump,rows}-H1a.json` 在 `66ba89a` 的原始 worktree 上带 `PERF_KEY_ALIAS=1` 生成；新代码同样带 `PERF_KEY_ALIAS=1`。
- 比对：`node /home/kaua/calc-arch/cmp.mjs <基线> <新>`，只允许 `__ms` 不同。
- 反向验证：把 qingyi 模块里的 perTrigger 临时乘 0，DIFF 必须全部落在键名含 `1251` 或 `qingyi` 的场景（青衣 agentId = 1251）。

### 5.3 计数棘轮（已落地，2026-09-26 lead-arena-0925c）

- **实现**：`scripts/lib/core-role-field-ratchet.mjs` 提供纯函数 `rolePrefixesFrom` / `findRoleFieldRefs`、扫描器 `scanCoreRoleFields`、基线常量 `CORE_ROLE_FIELD_BASELINE = 821`、豁免表 `ROLE_FIELD_EXEMPT = ['triggerCount']`；接入 `check-guards` 成为**判据 22**，guards 共 22 项。
  - `RATCHET_BURNDOWN` 登记「core 角色前缀字段」：frozen 821，target 765（A 类完成后的读数），due 2026-11-30。
  - `scripts/zc.mjs` 的 measure 映射已加这一项；`check-guards.d.mts` 已补类型声明。
- **口径**：与普查脚本逐字一致。判据要求读数「等于」基线：变大表示新增，要改通用字段或迁模块能力；变小表示有进展，要把常量和 frozen 同步下调。误报加进豁免表，并写明理由。
- **验证**：
  - `checkGuards.test.ts` 共 135 条全过，新增 3 条：frozen 与基线同步；检测器正负控（注释、块注释、豁免词）；实测读数等于基线。「二十一条判据」锁同步改为 22。
  - `check-guards` 22/22 通过；`vue-tsc -b` 退出码 0。
  - 反向验证：往 `src/core/damage.ts` 临时追加 `c.billyNegControl`，判据变红（822/821），还原后该文件无 diff。
- **卡 CC-14a 完成后**：读数应降到 821 − 该卡清掉的引用数，届时同步下调常量和 frozen。
- **2026-09-26 CC-14b 后**：基线与 frozen 都下调到 **803**（`6d8a995`）；target 765 不变，还差 38。
- **2026-09-26 CC-14a 后**：基线与 frozen 都下调到 **775**（`285885b`）；target 765，还差 10。
- **2026-09-26 CC-14c / CC-14d 后**：766（`ba6db48`）→ **763**（`e94b896`），原 target 765 已提前达成；重设 target 740、due 2026-12-31（§5.5）。
- **2026-09-26 CC-14e 后**：**759**（`1e3dc99`）；target 740，还差 19。下一张 CC-15（§5.6）。
- **2026-09-26 CC-15 后**：**733**（`b1ed48e`）；已低于 target 740，重设 target **720**。下一张 CC-16（§5.7）。
- **2026-09-26 CC-16 后**：**712**（`fe8fb90`）；已低于 target 720，重设 target **700**。下一张：CC-17 设计（§5.8）。
- **2026-09-26 CC-17 后**：**661**（`18bfd88`）；已低于 target 700，重设 target **649**。下一张：CC-18 设计（§5.9）。
- **2026-09-26 CC-18a 后**：**623**（`23470f2`）；已低于 target 649，重设 target **611**。下一张：CC-18b（§5.10）。
- **2026-09-26 CC-18b 后**：**613**（`a936127`）；target 611 不变。下一张：CC-19 设计（§5.11）。
- **2026-09-26 CC-19a 后**：**601**（`b14fb4a`）；已低于 target 611，重设 target **589**。下一张：CC-19b（§5.12）。
- **2026-09-26 CC-19b 后**：**545**（`3fbb326`）；已低于 target 589，重设 target **533**。下一张：CC-19c（§5.13）。
- **2026-09-26 CC-19c 后**：535（`b45652c`，19c-1）→ **499**（`de1cc8d`，19c-2）；已低于 target 533，重设 target **487**。
- **2026-09-26 CC-20 口径纠正**：**462**（`ea61032`）= 499 − 37 个误报（trigger* 触发者通用名），**不是进步**；target 同口径平移 487→**450**。下一张：CC-21（§5.14）。
- **2026-09-26 CC-21 后**：**447**（`3d000d0`）；已低于 target 450，重设 target **435**。下一张：CC-22（§5.15）。
- **2026-09-27 CC-22 后**：**430**（`05bb382`）；已低于 target 435，重设 target **418**。下一张：CC-23（§5.16）。
- **2026-09-27 CC-23 后**：**420**（`8ecd5f2`）；target 418 未达成，维持不变。下一张：CC-24（§5.17）。
- **2026-09-27 CC-24 后**：**410**（`1d1d823`）；已低于 target 418，重设 target **398**。下一张：CC-25（§5.18）。
- **2026-09-27 CC-25 后**：**403**（`7cef9c8`）；target 398 未达成，维持不变。下一张：CC-26（§5.19）。
- **2026-09-27 CC-26 后**：**363**（`8b7d9db`）；已低于 target 398，重设 target **351**。下一张：CC-26b（§5.20）。
- **2026-09-27 CC-26b 后**：**357**（`0d65f59`）；target 351 未达成，维持不变。下一张：CC-28（§5.21）。
- **2026-09-27 CC-28 后**：**340**（`69e85c4`）；已低于 target 351，重设 target **328**。下一张：CC-29（§5.22）。
- **2026-09-27 CC-29 后**：**332**（`69b53f9`）；target 328 未达成，维持。下一张：CC-30（§5.23，预计 −6 → 326 达成）。
- **2026-09-27 CC-30 后**：**326**（`371a2c1`）；target 328 已达成 → 重设 **314**（326 − 12）。下一张：CC-31（§5.24）。
- **2026-09-27 CC-31 后**：**270**（`0b8a28a`）；target 314 已达成 → 重设 **258**（270 − 12）。下一张：CC-32（§5.25）。
- **2026-09-27 CC-32a 后**：**254**（`0671c4c`）；target 258 已达成 → 重设 **242**（254 − 12）。下一张：CC-32b（§5.26）。

### 5.4 CC-14b 任务卡：伊德海莉燃血喧响迁模块能力（B 类，零差）

> **已落地 `6d8a995`（2026-09-26）**。验证：dump 624 / rowsnap 637 零差（两侧 `PERF_KEY_ALIAS=1`，基线 H0a @ `f0df0cb`）；反向验证 75→76 共 42 处 DIFF，全部在伊德海莉场景；定向 6 个测试文件 181 条通过；`vue-tsc -b` 为 0；check-guards 22/22；判据 22 从 821 降到 803。合入 master 后全量 `npm run verify` EXIT=0（check-guards 22/22；测试文件 290 过、16 跳过；build 成功）。
> ⚠ 本卡「验收」一节原文要求「带 `PERF_KEY_ALIAS=1` 与 dump-H0 比」，**这个口径有误**（H0 生成时没带开关），正确口径见 §4。

> 2026-09-26 lead-arena-0925c 立卡。**更正 §5.1**：这一簇原先标「A（待核实）」，逐行读码后改判 **B**。
> 依据：算式本身是伊德海莉独有的，包括缺失生命折算、蓄力重碾加普攻追击的循环、外部治疗；它不是「只有名字带角色」的通用算式。

**现状（三处连成一条链，读码实测）**

| 位置 | 作用 | 外部治疗项 |
|---|---|---|
| `core/resource/helpers.ts:304–320` `yidhariBurn` | 迭代期算喧响，进终结技次数 | `externalHealPct + externalHealPerUltPct × 提供者终结技次数`（`curtain.providerSlot` 的 `prevStates[..].ultimateCount`） |
| `core/resource/assembleSlot.ts:57–60` | 最终装配时把「每次 × 次数」**累加写回** `cfg.yidhariExternalHealPct` | —（写回） |
| `core/resource/resourceIncome.ts:264–280` `yidhariBurnDecibel` | 结果装配，读写回后的值；输出键 `DecibelSource.yidhariBurnDecibel`（`types/resource/energy.ts:110`） | 只用 `externalHealPct`（已含写回） |

**做法**
1. `src/mechanics/types.ts` 的 `AgentMechanicModule` 新增可选能力：
   `selfBurnDecibel?(input: { cfg: CharacterOperationConfig; basicAttackTime: number; exSpecialCount: number; providerUltCount: number }): number`
   注释写明：它是不可分享的自身喧响，调用方负责乘效率；`providerUltCount` 是帷幕提供者的终结技次数，已经写回 cfg 的调用方传 0。
2. `src/mechanics/agents/yidhari.ts` 实现该能力，把两段算式**原样**搬过去，常量 75 / 33 / 10 和取整方式都不改：
   - 判别：`cfg.yidhariDecibelPerHpPct === undefined` 时返回 0，保留原有防御；
   - `external = max(0, (cfg.yidhariExternalHealPct ?? 0) + (cfg.yidhariExternalHealPerUltPct ?? 0) * providerUltCount)`。
3. `helpers.ts` 的调用改成 `getAgentMechanic(cfg.agentId)?.selfBurnDecibel?.({ cfg, basicAttackTime: prev.basicAttackTime ?? 0, exSpecialCount: prev.exSpecialCount ?? 0, providerUltCount: curtain.providerSlot >= 0 ? (prevStates[curtain.providerSlot]?.ultimateCount ?? 0) : 0 }) ?? 0`。
4. `resourceIncome.ts` 同样改，传 `providerUltCount: 0`（外部治疗已由 assembleSlot 写回）。输出键 `yidhariBurnDecibel` 改名为 `selfBurnDecibel`，同步 `energy.ts:110`，以及所有读这个键的测试（`src/core/__tests__/decibelRowParity.test.ts`、`energyRowParity.test.ts` 等，用 grep 找全）。
5. `import { getAgentMechanic } from '@/mechanics'` 按 `core/resource/finalizePasses.ts:33` 的同款写法。**禁止** import 具体角色模块，否则判据 12 会红。
6. **不在本卡范围**：`assembleSlot.ts:57–60` 的写回（依赖槽位定位变量 `yidhariSlot`，留给 CC-14c）；`luciaElowen.ts` 写 `yidhariExternalHealPerUltPct` 的那一行。

**验收（零差）**
- 闸门：`grep -nE 'yidhari[A-Z]' src/core/resource/resourceIncome.ts` 为 0 行；`src/core/resource/helpers.ts` 的 304–330 段不再出现 `yidhari` 前缀字段（其余行不动）。
- `.zc/perf/dump.perf.ts` 与 `rowsnap.perf.ts` 的 `KEY_ALIAS` 各追加 `selfBurnDecibel: 'yidhariBurnDecibel'`，然后带 `PERF_KEY_ALIAS=1` 跑 dump 和 rowsnap，与**新基线** `/home/kaua/calc-arch/dump-H0.json`、`rows-H0.json`（在 `f0df0cb` 上生成）零差。**不要**用 `dump-A` / `rows-A`：它们生成于 `d983b5a`，已经过期。
- 反向验证：临时把模块里的 75 改成 76，DIFF 必须只出现在含伊德海莉(1051) 的场景；改完用 cp 备份还原。
- `npx vitest run src/mechanics/__tests__/yidhari.test.ts src/core/__tests__/decibelRowParity.test.ts src/core/__tests__/energyRowParity.test.ts src/scripts/__tests__/checkGuards.test.ts` 全过；`npx vue-tsc -b` 退出码 0。
- 判据 22 读数会下降，预计约 18 处（`resourceIncome.ts` 约 9 处、`helpers.ts` 约 9 处）。以实测为准，把 `scripts/lib/core-role-field-ratchet.mjs` 的 `CORE_ROLE_FIELD_BASELINE` 和 `scripts/check-guards.mjs` 里 RATCHET_BURNDOWN「core 角色前缀字段」的 frozen **同步下调到实测值**。

**环境**
- 在 worktree `/home/kaua/r66-scratch/cc14b` 里做（基于 `f0df0cb` 的 detached HEAD，`node_modules` 软链到主仓库，`.zc/perf` 已复制）。
- 主仓库有 R1 并行会话的 WIP，**一律不碰主仓库**。
- 做完在 worktree 里 `git commit`，由 lead 复核后 cherry-pick 到 master。
- **回退点**：单卡单提交，`git revert` 即可。

**CC-14c（登记，未立卡）**：`assembleSlot.ts` 的外部治疗写回，以及 ctx 里的 `yidhariSlot`，改成模块能力，比如 `onFinalAssemble({ cfg, providerUltCount })`。之后 `resourceIncome` 就可以不依赖写回。

### 5.5 CC-14c / CC-14d 落地记录 + CC-14e 卡（2026-09-26 第 19 轮 lead-arena-0925c）

**CC-14c（`ba6db48`，判据 22 775→766）装配期外部回血写回迁模块能力**
- `AgentMechanicModule.onFinalAssemble?({ cfg, providerUltCount }): void`，由 `assembleSlot` 逐槽开头调用，前提是 `curtain.providerSlot >= 0`，槽序即写序。
- `yidhari.ts#yidhariOnFinalAssemble` 逐字迁入原写回算式，并保留 `yidhariDecibelPerHpPct === undefined` 守卫，与原 `findIndex` 选槽等价。
- `AssembleSlotContext.yidhariSlot` 和 `tailPipeline.ts` 的按字段找槽已删除。
- 验证：
  - dump / rowsnap 零差，基线 H2a @ `007a6b7`；
  - 反向验证把写回乘数改成 `providerUltCount + 1`，DIFF 42，全部在 `yidhari-*-lucia` 场景；
  - 定向 37 个测试文件 389 条通过，`vue-tsc -b` 为 0，master 全量 verify EXIT=0（HEAD `ba6db48` 前后一致）。
- **决定：lead 直接实现，不派工人**。依据：只改 4 个文件、约 30 行，派工的往返成本比改动本身还高（AGENTS 子代理规则：不要为一步能做完的小事派活）。

**CC-14d（`e94b896`，判据 22 766→763）热启动反馈字段改模块声明**
- `AgentMechanicModule.feedbackCfgKeys?: readonly string[]`。yidhari 声明 `yidhariExternalHealPct`，luciaElowen 声明 `luciaCurtainTriggerCount`，norma 声明 `normaHatToChainCount`。
- `warmStart.ts` 的 `WARM_KEY_OMIT_CFG` 只保留通用字段 `timeBudgetExcess` 和 `rowTimeLimit`；`sanitizeWarmKeyCfg` 按 `getAgentMechanic(cfg.agentId)?.feedbackCfgKeys` 剔除角色字段。warmStart.ts 因此新增了 `@/mechanics` 依赖，与 assembleSlot 等同层文件一致。
- 语义差异：旧实现对**任意** cfg 剔除这 3 个名字；新实现只对声明它的模块所属 cfg 剔除。这 3 个字段只会写在各自角色的 cfg 上（已读码核实：诺玛写自己的 cfg；卢西娅字段由 assembleSlot 在提供者槽写回；伊德海莉字段由自身模块写回），所以缓存键实际上不变。热启动只做精确键命中，本来就不影响计算结果。
- 验证：
  - `warmStart.test.ts` 新增 CC-14d 用例：声明字段值不同仍同键；未声明字段照常进键；通用字段对任意角色剔除；
  - 反向验证：删掉 yidhari 的声明后，该用例变红；
  - dump / rowsnap 零差（H2a）；master 全量 verify EXIT=0。
- 顺带发现，**未修**：`luciaCurtainSelfCount`、`luciaCurtainTeammates` 同样是装配期写回，但旧清单里就没有，会让下次精确键假未命中。只影响缓存命中率，不影响结果。CC-14e 做完后可以一并加进卢西娅的 `feedbackCfgKeys`（届时须补测试，并确认计算结果仍零差）。

**决定：重设判据 22 的 target**
- 原 target 765（due 2026-11-30）已被 CC-14d 提前达成（763）。
- `checkGuards.test.ts` 的两条用例要求 `target < frozen`，所以必须重设：target 改为 **740**，due 改为 **2026-12-31**，plan 写成「CC-14e → B 类槽位定位变量按角色逐卡；remielle 需先出设计稿」。
- 依据：剩下的是 B 类工作，每卡都需要设计，节奏比 A 类慢；约 23 处需要 CC-14e 加上首批槽位变量卡来完成。
- 回退点：`scripts/check-guards.mjs` RATCHET_BURNDOWN 中该条目的 target 和 due 可以随时改，改完同步跑 checkGuards.test。

**CC-14e 卡：卢西娅帷幕写回迁模块能力（B 类，零差）**
- 现状：`core/resource/assembleSlot.ts` 约第 64–91 行的 `if (i === curtain.providerSlot) { ... }` 块。core 直接写 `cfg.luciaCurtainTriggerCount`、`cfg.luciaCurtainSelfCount`（调用模块能力 `curtainTriggers`，teammateOpenCount 为 0）和 `cfg.luciaCurtainTeammates`（按 `findCrossAgentSupplySlots(configs, 'curtain-open')` 收集队友 rawCount，并按比例分摊 `curtainTriggers - selfCount`）。
- 做法：
  1. 扩展 `onFinalAssemble` 入参，全部为可选新增字段，yidhari 实现不用改：
     `isCurtainProvider: boolean`、`curtainTriggers: number`、`state: IterationState`、`totalTime: number`、`curtainOpeners: Array<{ agentId: string; rawCount: number }>`。
     其中 `curtainOpeners` 由 core 用原 `raw` 算式收集，包括 `.filter(m => m.rawCount > 0)`。
  2. `luciaElowen.ts` 实现 `onFinalAssemble`：在 `isCurtainProvider` 为真时逐字执行原块内的三个写回；自开次数调用本模块的 `curtainTriggers` 实现，入参 `{ cfg, state, teammateOpenCount: 0, totalTime }`。
  3. assembleSlot 删掉整块，并入 CC-14c 的同一个调用点。
     - **调用条件要注意**：原卢西娅块的条件是 `i === curtain.providerSlot`，不要求别的；而 CC-14c 调用点的外层条件是 `curtain.providerSlot >= 0`。提供者槽存在时两者恒成立，逐位等价。
     - 顺序：卢西娅块原在伊德海莉写回之后，两者写的是不同槽的 cfg，而且卢西娅块只读 states/curtain/configs，合并到同一个调用点后顺序无关。
  4. 预计判据 22 降约 4–5 处，以实测为准，同步下调两处常量。
- 验收：
  - `grep -n 'luciaCurtain' src/core/resource/assembleSlot.ts` 只剩注释；
  - dump / rowsnap 两侧 `PERF_KEY_ALIAS=1` 零差；
  - 反向验证：把队友分摊临时乘 0，DIFF 须只出现在含卢西娅(1451) 的场景。若 DIFF 为 0，说明展示字段不进 dump 哈希，应改为在 `luciaElowen.test.ts` 里断言 `luciaCurtainTeammates`；
  - `luciaElowen.test.ts` 通过，`vue-tsc -b` 为 0，master 全量 verify 钉 HEAD。
- 回退点：单卡单提交，`git revert`。

### 5.6 CC-14e 落地记录 + CC-15 卡（2026-09-26 第 20 轮 lead-arena-0925c）

**CC-14e（`1e3dc99`，判据 22 763→759）卢西娅帷幕写回并入 `onFinalAssemble`**
- **对卡面的修订**：`onFinalAssemble` 新增入参 `isCurtainProvider`、`curtainTriggers`、`state`、`totalTime`、`curtainOpeners` 一律改为**必填**。依据：唯一调用方是 core，每次都传全；yidhari 的实现只解构 `cfg` 和 `providerUltCount`，不受影响。
- `luciaElowen.ts#luciaOnFinalAssemble`：`isCurtainProvider` 为假时直接返回；三个写回逐字迁入。自开次数调用 `luciaElowenMechanic.curtainTriggers`。原写法是 `getAgentMechanic(provider).curtainTriggers`，已用 grep 核实 luciaElowen 是唯一实现者，两者等价。若将来出现第二个帷幕提供者模块，它需要自己实现 `onFinalAssemble`。
- assembleSlot：每个槽都按原 `raw` 算式（含 filter）收集 `curtainOpeners` 后传入。原来只在提供者槽收集，现在每槽一次；这是纯函数，3 槽开销可忽略。
- `luciaElowen.test.ts` 新增断言：自开次数 + 队友分摊之和 = 触发总次数（toBeCloseTo 精度 6）。
- 验证：
  - dump 624 / rowsnap 637 零差（H2a）；
  - 反向验证：队友分摊临时乘 0，DIFF 42，全部在卢西娅场景，说明这些展示字段**会**进 dump 哈希；同一改动下新断言变红；
  - 定向 384 条测试通过，`vue-tsc -b` 为 0，master 全量 verify EXIT=0。
- **遗留（低优先级，只影响缓存命中率）**：`luciaCurtainSelfCount`、`luciaCurtainTeammates` 仍不在卢西娅的 `feedbackCfgKeys` 里（见 §5.5）。加进去时，需要在 `warmStart.test.ts` 的 CC-14d 用例表里补两行。

**剩余分布（HEAD `1e3dc99`，判据 22 共 759 处）**
- 按文件：damagePoolAnomaly 121、convergence 79、useResourceCalc 51、damagePoolCharExtras 50、damagePoolDirect 43、crossAgentEnergy 39、resourceCalc/helpers 35、rowBuild 35、roundThreads 32，其余小于 30。
- 按前缀：remielle 202、alice 90、liuyin 59、burnice 48、banyue 44、norma 38、trigger 37、jane 33、yixuan 33，其余小于 30。
- 统计脚本在 WSL `/home/kaua/calc-arch/rf.mjs`（按文件、按前缀）和 `rf2.mjs`（列出 ≤6 处的小文件的字段与行号），都调用 `scanCoreRoleFields`。

**CC-15 卡：赠行通用命名（A 类，纯改名，零差）**
- 依据：引擎已有通用的赠行概念（`tailPipeline.ts` 的 `chainGiftFinal` / `ultimateGiftFinal`、`crossAgentSupply` 的赠链供给）。对外字段和执行行标记却仍挂着角色名，其实指的就是「赠连携 / 赠终结」。
- 改名表（**先 `grep -rn` 找全再改**，测试一起改）：

  | 旧 | 新 | 位置（HEAD `1e3dc99` 实测） |
  |---|---|---|
  | 团队结果 `liuyinGiftTimeReserved` | `ultimateGiftTimeReserved` | `types/resource/team.ts:156`；`core/resource.ts:396`；`composables/resourceCalc/liuyinPromote.ts:105/109`；测试 liuyinAxisGiftSameSource、timeLedgerInvariants、giftMoveTimeLedger、giftAxisProbe |
  | 团队结果 `normaGiftTimeReserved` | `chainGiftTimeReserved` | `team.ts:162`；`resource.ts:398`；测试 timeLedgerInvariants、giftMoveTimeLedger |
  | 尾段 `tail.liuyinGiftTimeTotal` 与 `resource.ts` 局部变量 `liuyinGiftTimeTotal` | `ultimateGiftTime` | `tailPipeline.ts:50/208`；`resource.ts:364/396` |
  | 执行行标记 `SkillExecution.normaGiftChain` | `chainGift` | `types/resource/execution.ts:102`；`giftRows.ts:37/75`；`assembleSlot.ts:156`；useResourceCalc 2 处、resourceCalc/helpers 3 处、normaHatChain 4 处、liuyinPromote 2 处、damagePoolDirect 2 处；测试 giftRows、normaSmoke、moveFusion |
  | assembleSlot 局部变量 `normaC4Decibel` | `giftDecibel` | `assembleSlot.ts:113/118` |

- `execution.ts` 里 `chainGift` 的注释改写为：「赠送的连携行（引擎赠链供给产出；当前唯一来源 = 诺姆膛温换连携）。失衡捏轴下吃易伤的次数由提供者槽的 'norma-hat-chain' 轴内块决定（见 useResourceCalc）」。轴块 id `'norma-hat-chain'` 是数据标识，**不改**。
- **不在本卡范围**：`luciaC4DecibelPerTrigger`（assembleSlot:116，属于帷幕能力，另议）；`banyueTopUp`（outerCycle/solveTeam/roundResult，另议）；`normaHatChain.ts` 文件名。
- 零差：
  - lead 在 `.zc/perf/{dump,rowsnap}.perf.ts` 的 KEY_ALIAS 里加上 `ultimateGiftTimeReserved: 'liuyinGiftTimeReserved', chainGiftTimeReserved: 'normaGiftTimeReserved', chainGift: 'normaGiftChain'`（键位置不变，纯改名）；
  - 在原始 worktree 上带 `PERF_KEY_ALIAS=1` 生成基线 H3a，新代码同样带开关；用 `cmp.mjs` 比对，只允许 `__ms` 不同。
- 反向验证：纯改名卡没有算式可改，改用「临时把 `giftRows.ts` 的 `chainGift: true` 删掉」，DIFF 须出现在含诺姆(1571) 的场景，证明这个标记进了哈希。
- 预计判据 22 降约 25–30 处，以实测为准，两处常量同步下调。若读数 < 740，**同步重设 target**（`checkGuards.test` 要求 target < frozen），参考 §5.5 的重设写法，并在本节记录新 target 的依据。
- 验收：`vue-tsc -b` 为 0；`npx vitest run src/core/__tests__ src/composables/__tests__/liuyinAxisGiftSameSource.test.ts src/composables/__tests__/timeLedgerInvariants.test.ts src/composables/__tests__/giftMoveTimeLedger.test.ts src/mechanics/__tests__/normaSmoke.test.ts src/scripts/__tests__/checkGuards.test.ts` 全过；master 全量 verify 钉 HEAD。
- 派给：dsflash 工人（worktree，提示词写显式 git add 路径）。回退点：单卡单提交，`git revert`。

### 5.7 CC-15 落地记录 + CC-16 卡（2026-09-26 第 21 轮 lead-arena-0925c）

**CC-15（`b1ed48e`，判据 22 759→733）赠行通用命名**
- 按 §5.6 改名表执行，**没有派工人**：纯改名，sed 一步完成（`\b` 词边界，`normaGiftChainInfo` / `normaGiftChainTime` 这类更长的标识符不受影响）。依据：AGENTS 子代理纪律「一步能做完的不派」。
- 实际改动：19 个文件（卡面列的全部，加上 `scripts/lib/agent-branch-ratchet.mjs:165` 的注释）。`execution.ts` / `team.ts` 的字段注释改写为「通用赠行字段、原名 xxx、当前唯一来源 = 诺姆/琉音」。
- **自决：`src/specs/agents/1571.json:192` 说明文字里的 `normaGiftChain` 不改。** 依据：那是角色规格数据（给人读的机制确认记录），不是代码引用，不在判据扫描范围；改了反而动了数据文件。若要统一，直接改那一行字符串即可，无副作用。
- `.zc/perf/{dump,rowsnap}.perf.ts` 的 KEY_ALIAS 追加 3 条（CC-15 注释标出；`.zc` 不入库，下一个 lead 若重建语料要手动补上）。
- 验证：
  - `vue-tsc -b` 为 0；守卫 22/22；定向测试 39 个文件、400 条通过（core/__tests__、liuyinAxisGiftSameSource、timeLedgerInvariants、giftMoveTimeLedger、giftAxisProbe、moveFusion、normaSmoke、checkGuards）；
  - 零差：对 H2a，dump 625 个键、rowsnap 638 个键（均含 `__ms`），**只有 `__ms` 不同**；
  - 反向：`giftRows.ts` 的 `{ chainGift: true }` 临时改成 `{}`，dump DIFF 72（不算 `__ms`），**全部是含 1571 的场景**，伤害总值也变了（该标记参与易伤处理），证明标记进了计算和哈希；cp 还原后 `cmp` 字节一致；
  - master 全量 `npm run verify` EXIT=0（290 个测试文件，build 通过），前后 HEAD 都是 `b1ed48e`。
- **target 重设 740→720（可逆）**。依据：剩余可见的小候选有 `banyueTopUp`（CC-16，判据内约 10+ 处，以实测为准）、`luciaC4DecibelPerTrigger`（assembleSlot 1 处）、`janeAssaultCritDmgBonus`（damage.ts 1 处）、remielle 的 `rowAccounting` 4 处 + `substatOptimizer` 4 处（需设计稿）。减 13 是保守可达值。不合适就改 `scripts/check-guards.mjs` 的 target 一行（须 < frozen）。

**分簇阻塞理由更正（本轮现场核实 `docs/mcp-worker-task-queue.md` 第 56–57 行）**：旧记录写「alice/liuyin/banyue 等 W26 线结束」。实际 W26（琉音转大次数单源化）已在 lead 合入时 blocked、卡已删除，**这条线已经结束**，且 W26 只涉及琉音，从来不涉及 banyue。
- 决定：`banyueTopUp` 改名（CC-16）不受 W26 影响，立即可做。
- liuyin 前缀的字段（59 处）中，若涉及转大次数的读数，仍须先读 `docs/mcp-liuyin-promote-source*.md` 的结论再动，免得和 W26 blocked 的原因（timeGolden 口径）撞上。alice（90 处）没有已知阻塞，下一次挑卡时按普查分簇重新评估。

**CC-16 卡：`banyueTopUp` 通用命名（A 类，纯改名，零差）**
- 依据：它是轮内持久线程里的「交互补齐量」（`{ parry, dual, requiredSeconds, illegal }`），由模块 `banyue.ts` 产出。编排层（convergence / roundThreads / roundResult / solveTeam / useResourceCalc）只是搬运和读取，却挂着角色名。与 CC-13（yidhari ex*）同类处理。
- 改名（**先 `grep -rnw` 找全**，含测试）：
  - `banyueTopUp` → `interactionTopUp`（`CalcRoundResult` 字段、`RoundThreads` 字段、`calcOutput` 读数）；
  - convergence 的局部变量 `prevBanyueTopUp` → `prevInteractionTopUp`，`banyueTopUpNext` → `interactionTopUpNext`；
  - 类型 `BanyueInteractionTopUp` 与函数 `computeBanyueInteractionTopUp`：**先确认判据是否计入**（用 `node /home/kaua/calc-arch/rf2.mjs` 或 `scanCoreRoleFields` 看字段列表）。若计入，一并改为 `InteractionTopUp` / `computeInteractionTopUp`；若不计入，也可以改，但要写明是顺手改的。
  - **不改**：`banyue.ts` 模块内部的实现细节，以及交互栏中文文案「弹刀 +N / 双反 +M」。
- 零差：在 `.zc/perf/{dump,rowsnap}.perf.ts` 的 KEY_ALIAS 加 `interactionTopUp: 'banyueTopUp'`（如果 dump 哈希里出现这个键）。对 H2a 带 `PERF_KEY_ALIAS=1` 比对，只允许 `__ms` 不同。模板：`/home/kaua/calc-arch/v15.sh`（把输出名 15 改成 16）。
- 反向：临时让 `banyue.ts:487` 的 topUp 恒为 `{ parry: 0, dual: 0 }`，DIFF 须全部落在含般岳的场景（agentId 先查 `src/specs/agents/` 或 `banyue.ts` 的 `agentId`）。模板：`/home/kaua/calc-arch/r15.sh`。
- 判据 22 以实测为准，两处常量同步下调（`scripts/lib/core-role-field-ratchet.mjs` 的 BASELINE、`scripts/check-guards.mjs` 的 frozen）。若低于 720，同步重设 target。
- 验收：`vue-tsc -b` 为 0；定向测试 `npx vitest run src/composables/__tests__ src/mechanics/__tests__/banyue* src/scripts/__tests__/checkGuards.test.ts` 全过；master 全量 verify，钉 HEAD。
- 执行方式：纯改名一步能完成，lead 直接做即可（CC-15 实测约 10 分钟）。回退点：单卡单提交，`git revert`。

### 5.8 CC-16 落地记录 + CC-17 设计候选（2026-09-26 第 22 轮 lead-arena-0925c）

**CC-16（`fe8fb90`，判据 22 733→712）`banyueTopUp` 通用命名**
- 实际范围比卡面（§5.7）**多一项、少两项**，均为现场核实后的决定：
  - **多**：`useResourceCalc` 对外的 computed `banyueInteractionTopUp` 改为 `interactionTopUp`（计入判据 3 处）。它的实现已经是通用的，槽位由模块声明 `producesInteractionTopUp` 驱动。同步改了消费方 `src/views/TeamConfigPage.vue:1052/1054` 和 `banyue.test.ts` 里的 `calc.xxx`。
  - **少**：类型 `BanyueInteractionTopUp`、函数 `computeBanyueInteractionTopUp` **不改**。判据正则是 `\b(角色前缀)[A-Z]…`，大写开头或以 `compute` 开头的标识符都不计入；而且它们是 banyue 模块自己的导出，改名没有收益。`convergence.ts:54` 直接从模块 import `computeBanyueInteractionTopUp`，这是编排层对角色模块的直接调用，**属于 B 类遗留**，要消除得设计一个能力（例如 `computeInteractionTopUp` 挂到 mechanic 上），不在本卡范围。
  - **同名异物，不改**：cfg 槽位字段 `banyueInteractionTopUp`（`types/resource/agentResources.ts:714`，由 `banyue.ts:492` 写入，`banyue.ts:743/776` 的展示层读取，convergenceNightD 测试断言它）。它和上面那个 computed 同名，但含义不同。它在 types 目录里，不计入判据；改了会改变 dump 的角色结果键，收益为 0。**别对这个名字做全仓 sed。**
- 改名：`banyueTopUp` → `interactionTopUp`，`banyueTopUpNext` → `interactionTopUpNext`，`prevBanyueTopUp` → `prevInteractionTopUp`（按词边界全仓替换，不含 `specs/agents/1471.json` 说明文字和 `check-guards.mjs`，后者的 target 注释是整行重写的），共 12 个文件。
- 验证：
  - `vue-tsc -b` 为 0；守卫 22/22；定向测试 6 个文件、234 条通过；
  - 零差：对 H2a（alias 追加 `interactionTopUp: 'banyueTopUp'`），dump 625 / rowsnap 638 个键**只有 `__ms` 不同**；
  - **反向**：`banyue.ts:487` 的 topUp 临时恒为 `{parry:0,dual:0}` → **dump 无差**，convergenceNight* / banyue 单测 **6 条红**。
  - master 全量 `npm run verify` EXIT=0，前后 HEAD 都是 `fe8fb90`。
- **新发现的 dump 覆盖盲区（已知坑补充）**：般岳的轴模式保底交互补齐（`interactionTopUp` 线程）**不在 dump/rowsnap 语料里**，语料没有覆盖「般岳 + 轴模式 / 保底喧响」的场景。以后改这条线，反向验证必须看单测（convergenceNightB/D、banyue.test），不能只看 dump 零差。
- **target 重设 720→700（可逆）**：依据见下面的零散小项和 CC-17 规模。改 `scripts/check-guards.mjs` 的 target 一行即可（须 < frozen）。

**剩余分布（HEAD `fe8fb90`，712 处，153 个字段）**：前几名是 burniceSrc 36、remielleSlot 20、liuyinSrc 18、triggerPanel 16、aliceSlot 16、remiellePanel 14、remielleAnomalyMultiplier 14、triggerSlot 13、janeSlot 13、janePanel 12。**大头是 `*Slot` / `*Panel` / `*Src` / `*Idx` 这类槽位定位变量**（B 类：编排层要知道「谁是 XX」，才去拿 XX 的面板和数据），需要逐角色设计能力，不能靠改名解决。统计命令：见 §5.6 的 `rf.mjs`，按字段统计用 WSL `/home/kaua/calc-arch/rf3.mjs [前N名]`（仓库外脚本；丢了就照 rf.mjs 按 field 聚合重写，10 行）。

**CC-17 设计候选：axis overlay 消费端能力化（约 30 处）**
- 现状：
  - 产出端**已经模块化**：`panelPhases.ts:360+` 的 `collectAxisWindowOverlays` 遍历成员，调 `getAgentMechanic(id)?.axisWindowOverlays(...)`，把返回值里的 `banyueMingwangStacks` / `yixuanNingshenMap` / `peiluoKagerouMap` / `corinStunBonusMap`（逐个 if 拷贝，`panelPhases.ts:379-382`）装进固定形状的 overlay 对象（`panelPhases.ts:344-354`）；
  - 透传：`useResourceCalc.ts:585-588` → `damagePool.ts:79-82` 的入参类型；
  - 消费端**仍是角色专属计算**：`damagePoolDirect.ts:93` 解构，`:169` 冥网层数，`:183` 柯林失衡加成，`:211` 仪玄凝神。
- 判据计数：banyueMingwangStacks 10、yixuanNingshenMap 10、corinStunBonusMap 10（peiluo 不是 agents 目录里的前缀，不计入）。
- 设计方向（供设计稿取舍，**本轮未定稿**）：
  - (a) overlay 改成按 agentId 分组的不透明包 `Map<agentId, unknown>`，模块新增能力 `modifyDirectRow(exec, overlayOfSelf, ctx)`，由 damagePoolDirect 在逐行循环里对「本行所属角色」调用；
  - (b) 只做形状通用化 `moveOverlays: Record<string, Map<string, unknown>>`，消费端的计算留在原地（只减少透传层的计数，消费端的计数还在，收益约 2/3）。
  - 倾向 (a)，但要先核实 `damagePoolDirect` 那三段计算的输入是否都能从 exec + 自身 overlay + 面板拿到（例如 `:183` 依赖 `stunOverride`）。
- 零差风险：直伤是 dump 覆盖最好的部分，零差可证。反向验证可以对任一 overlay 乘 0。

**零散小项（每项 1–2 处，可以作为 CC-17 之前的热身）**：
- `luciaC4DecibelPerTrigger`（assembleSlot:116，可以考虑并入卢西娅的 `onFinalAssemble` 或 `bonusDecibel` 类能力）；
- `janeAssaultCritDmgBonus`（core/damage.ts:178）；
- remielle 的 `rowAccounting.ts` 4 处、`substatOptimizer.ts` 4 处（remielle 整体需要设计稿，**别单独动**）。

### 5.9 CC-17 落地记录 + 新坑 + CC-18 卡（2026-09-26 第 23 轮 lead-arena-0925c）

**CC-17（`18bfd88`，判据 22 712→661）**：完整记录在设计稿 `docs/mcp-cc17-axis-overlay-consume.md` 的 §8，这里只列要点。
- 结构变化：
  - `collectAxisWindowOverlays` 改为返回 `bucketsBySlot`，不再跨模块合并；
  - 新增模块能力 `AgentMechanic.directRowBonus`，由 banyue / corin / sigrid / yixuan / peiluo 各自实现；
  - `damagePoolDirect` 只负责合并加成，悠真的行级字段保留在原地。
- **修复的 bug**：可琳平A块在桶里的键是 `'basic_attack'`，与所有角色普攻聚合行的 moveId 相同，经全局桶泄漏给了队友的轴内普攻行（+35% 增伤）。这是本卡唯一有意的行为变化。dump / rowsnap 语料不含 1061，比对里看不到这处修复，已用 `corin.test.ts` 泄漏锁锁住（旧代码红、新代码绿）。
- **发现过程值得记住**：当初以为风险是零差，查到 `corin.ts:140` 的键归并注释才起疑；最初的探针还跑在另一个未还原的变异上，结果被污染。
  **教训：后台变异脚本跑着的时候，别在同一个工作区跑别的探针**。要么等它 RESTORED，要么在 worktree 里跑。
- 零差：对 H2a 只有 `__ms` 不同。反向：仪玄 critDmg ×0 → DIFF 36，全部是仪玄场景。

**新坑：新增 `docs/*.md` 必须登记进 README §6**
- 要在文档表里加一行，并更新节标题里的「N 份」。否则 `src/scripts/__tests__/checkGuards.test.ts` 的判据 9（docs 表一致性）会红。
- `node scripts/check-guards.mjs` 本身**不查这一项**：守卫显示 22/22 通过，不代表 checkGuards.test 也是绿的。
- 本轮 `6038a70` 就漏了这一步，master 红到 `18bfd88` 才修好（工人的提交里带了修复）。**写设计稿时同一提交里就把 README 一起改掉。**

**剩余分布（HEAD `18bfd88`，661 处）前几名**：burniceSrc 36、remielleSlot 20、liuyinSrc 18、triggerPanel 16、aliceSlot 16、remiellePanel 14、remielleAnomalyMultiplier 14、triggerSlot 13、janeSlot 13、janePanel 12、banyueSlot 10、aliceCoweringConfig 10。统计用 `node /home/kaua/calc-arch/rf3.mjs [N]`。

**CC-18 卡：柏妮思 `burniceSrc` 簇（设计优先，约 43 处）**
- 现状（第 23 轮实读）：
  - `damagePoolCharExtras.ts:37` 的 `const burniceSrc = charResult.burniceMechanicSource`，接着在 `:40–72` 用它拼出「余烬」「搅拌式」等额外伤害行（count / multiplier / note / critRateBonus 全部取自 burniceSrc，另乘 `burniceSkillCoef`，这个变量在同一文件计 7 处）；
  - `damagePoolAnomaly.ts:294` 先用 `burniceSlot` 定位柏妮思，再取 burniceSrc（另有异常侧的用法）。
- 设计方向（参照 CC-17 的「按归属调用模块能力」）：
  - 新增模块能力，例如 `extraDamageRows(charResult, ctx) => DamagePoolRow[]`，由行所属角色的模块生成自己的额外行；`damagePoolCharExtras` 只负责遍历和 push。
  - **先查**同文件里 `liuyinSrc`（18 处，分布在 damagePool / damagePoolCharExtras / damagePoolDirect / liuyinPromote）是否是同一种模式；如果是，同一个能力一并覆盖，收益更大。但 liuyin 涉及转大次数的读数，**先读 `docs/mcp-liuyin-promote-source*.md`**（§5.7 的阻塞提醒）。
  - 异常侧（damagePoolAnomaly 的 burniceSlot / burniceSrc）可以拆成第二阶段。
- 流程：lead 先写设计稿 `docs/mcp-cc18-*.md`（**同一提交里登记 README §6**），列出现状行号、接口、逐字迁移表、零差论证，再派 dsflash 工人在 worktree 实现（CC-17 的 `calc-arch/cc17.prompt` 可以作模板）。
- 零差：柏妮思在 dump 语料里有没有，**先查**：`python3 -c` 读 `dump-H2a.json` 的键，看有没有含 1291 或 burnice 的（agentId 以 `src/specs/agents/` 为准）。如果没有，反向验证只能靠单测（dump 盲区）。
- 另有小遗留（CC-16）：`convergence.ts:54` 直接 import `computeBanyueInteractionTopUp`，属于 B 类，可以设计一个能力 `computeInteractionTopUp` 挂到 mechanic 上。不急。

### 5.10 CC-18a 落地记录 + CC-18b 开工清单（2026-09-26 第 24 轮 lead-arena-0925c）

**CC-18a（`23470f2`，判据 22 661→623）**：完整记录在设计稿 `docs/mcp-cc18-extra-direct-rows.md` §8。
- 新能力 `AgentMechanic.extraDirectRows`：模块按归属生成附加直伤行，`damagePoolCharExtras` 调用一次，按返回顺序 `pushDirect`。
- 本轮迁了柏妮思 4 行和半月 C6 摧岳附伤。零差对 H2a 只有 `__ms` 不同；两个反向验证都精确落在对应角色的场景。
- **更正 §5.9**：那里写「柏妮思 agentId 1291」是错的，**实际是 1171**（`src/specs/agents/1171.json`，`burnice.ts` 的 `BURNICE_AGENT_ID`）。柏妮思**在** dump 语料里（`auto-1561-1171-1411/*`，6 个场景）。
- 本轮流程：设计稿与 README 登记在同一提交（`3b9e75c`），checkGuards.test 全程没红。§5.9 的坑已按要求执行。
- 小坑：wsl_exec 偶尔把 stdout 整段吞掉，只剩 stderr 的「screen size is bogus」警告。办法是把命令包成 `{ …; } > /tmp/x.txt 2>&1; cat /tmp/x.txt`。

**CC-18b 开工清单（琉音块 2 / 4 / 5，约 18 处 liuyinSrc 中 charExtras 那部分）**
1. 先读 `docs/mcp-liuyin-promote-source.md`（转大次数口径；W26 blocked 的原因是 timeGolden 口径）。本卡**只搬运，不改任何读数来源**：`liuyinPromoteCount` 仍来自 `useResourceCalc.ts:265` 的 `calcOutput.promote`，经 ctx 原样透传。
2. 在设计稿 §7 补上接口扩展，推荐在 `ExtraDirectRowsInput` 上加可选字段（加可选字段不影响 18a 的两个实现）：
   - `prevTeammate?: { slot: number; panel: PanelValues | undefined; agent: Agent | null | undefined }`（块 2 用，原式见 `damagePoolCharExtras.ts` 块 2 的 prevSlot / prevPanel / prevAgent 三行，`previousTeammateSlot` 来自 liuyinSrc，所以更好的做法是传 `resolveTeammate(slot) => { panel, agent }` 查询函数，让模块自己拿 slot）；
   - `stunCount: number`（块 4，原式 `stunPoolResult?.stunCount ?? 0`）；
   - `promoteCount: number`（块 5，原式 `liuyinPromoteCount`）；
   - `getMechanicSetting: (key: string, dflt: number) => number`（块 5 的 `liuyin.c6EchoMax`）；
   - `ultimateInAxisFraction: () => number`（块 5）。
   字段名不要带角色前缀，否则判据 22 又会记上。
3. 琉音模块对象在 `src/mechanics/agents/liuyin.ts:515`（`agentIds: [LIUYIN_AGENT_ID]`）。`LIUYIN_EX_MOVE_IDS`、`CINEMA6_ECHO_MAX`、`CINEMA6_ECHO_RATIO` 本来就定义在这个文件里。
4. **顺序**：原块顺序是 2 → (3 半月) → 4 → 5，且都属于琉音自己；迁移后在琉音的 `extraDirectRows` 里保持 2 → 4 → 5 的顺序。调用点只有一个（18a 已放好），不用改。
5. `liuyinSrc` 另有上提到 `damagePool.ts` 槽位循环头的声明（与「跳过通用强特行」共用判据，见 charExtras 块 2 上方注释）。**18b 不要动那处**，只改 charExtras 里的 3 块；damagePool / damagePoolDirect / liuyinPromote 里的 liuyinSrc 另议。
6. 零差：琉音在语料里（例如 `banyue-liuyin-lucia/*`，以及 dump 键里其他含 1481 的场景）。反向验证：琉音余音 `count` ×0（只影响 cinema≥6，应落在 c6 变体），重击附加 `multiplier` ×0。
7. 执行方式同 18a：lead 在设计稿补 §7 接口，再派 dsflash 工人，提示词模板 `/home/kaua/calc-arch/cc18.prompt`（worktree 路径和块号要改）；lead 做零差、反向和挑回。

### 5.11 CC-18b 落地记录 + CC-19 开工清单（2026-09-26 第 25 轮 lead-arena-0925c）

**CC-18b（`a936127`，判据 22 623→613）**：完整记录在设计稿 `docs/mcp-cc18-extra-direct-rows.md` §7.1 / §8。琉音 3 块已迁入 `liuyin.ts` 的 `extraDirectRows`。`ExtraDirectRowsInput` 新增 teammateAt / stunCount / promoteCount / getMechanicSetting / ultimateInAxisFraction 5 个字段（必填）。

**rf3 读数（HEAD `a936127`，613 处 / 142 个字段）前列**：remielleSlot 20、triggerPanel 16、aliceSlot 16、remiellePanel 14、remielleAnomalyMultiplier 14、triggerSlot 13、janeSlot 13、janePanel 12、banyueSlot 10（convergence.ts）、aliceCoweringConfig 10。**大头集中在 `damagePoolAnomaly.ts`**。

**CC-19 开工清单（异常侧角色块能力化，新设计稿 `docs/mcp-cc19-extra-anomaly-rows.md`，须登记 README §6）**
1. `damagePoolAnomaly.ts`（661 行，HEAD `a936127` 实测）中的角色块都是**队伍级**写法：`findSlotByIdentity(configStore, catalogStore, ['<id>'])` 找槽，再算一整块。行号（开头）如下：
   - 柏妮思 C6 燃爆 :293（= CC-18c 范围 :293–340）；
   - 极地爱丽丝强击 :348（polarAssault*）；
   - 简 C6 :393；
   - 爱丽丝 C6 :442；
   - 爱丽丝畏缩 DoT :512（读 `anomalyPoolResult.aliceCoweringDot`）；
   - 瑞米尔 :530（带 `remielleEntryPanels`）。
   另有 triggerSlot / triggerPanel 散在 helpers.ts / damagePool*.ts，**不在 CC-19 的范围内**。
2. 与 CC-18（按槽 `extraDirectRows`）的区别：块内会读**异常进度**（`fireProg` / `physicalProg` / `polarAssaultProg` 的 triggerCount 与 entries）、`windRate`、`inWindowFraction(element)`、`stunCoverage`、`anomalyPoolResult`、`adjustedResourceResult`。推荐的能力形状：`extraAnomalyRows(input)`，按队伍各槽 `getAgentMechanic(agentId)` 在**原第一个角色块的位置**派发。先读各块的 push 目标（是 anomaly 行还是 direct 行，push 函数叫什么），再定 input 面（字段名不带角色前缀）。
3. **顺序风险（设计时必须论证）**：原顺序是 柏妮思 → 极地爱丽丝 → 简 → 爱丽丝 C6 → 畏缩 → 瑞米尔，按**角色**分块，不按槽序。改成按槽派发后，行顺序会随队伍排列变化。rows 顺序是否进入 rowsnap 或 UI，要先查 cmp 的判据（18a 设计稿 §3 有论证方法）。若顺序敏感，可选「按固定角色序派发」（模块声明 `anomalyRowsOrder`），或先只迁柏妮思一块（18c）试水。
4. 建议拆分：19a = 柏妮思（即 18c，约 48 行，最独立）；19b = 简 + 爱丽丝 C6 + 畏缩；19c = 瑞米尔（字段最多，含 entryPanels，另议）。极地爱丽丝是否为「角色块」待查（可能按元素，而非按角色）。
5. 执行方式同 18a/18b：lead 写设计稿并提交 → worktree `r69-scratch/cc19a` → 提示词以 `/home/kaua/calc-arch/cc18b.prompt` 为模板 → `run-wt.sh` 改 cd → 零差用 `v18b.sh`，反向用 `r18b.sh`（改路径与突变点）→ cherry-pick -n → verify → 文档 → zc done。
6. 反向注意：柏妮思 1171 只在 `auto-1561-1171-1411/*` 这一组（18a 实测 DIFF 6）；C6 相关突变只有 0 号位是柏妮思时 c6 变体才会触发，否则用单测锁住（参考本轮余音的做法）。

### 5.12 CC-19a 落地记录 + CC-19b 开工清单（2026-09-26 第 26 轮 lead-arena-0925c）

**CC-19a（`b14fb4a`，判据 22 613→601，target 589）**：完整记录在设计稿 `docs/mcp-cc19-extra-anomaly-rows.md` §8。新能力 `extraAnomalyRows` 返回 `{ order, rows }` 分组；`damagePoolAnomaly.ts` 在原柏妮思块的位置跨全队收集分组，用导出的纯函数 `flattenAnomalyRowGroups` 稳定排序后 push。`EXTRA_ANOMALY_ROW_ORDER`（types.ts）固定原块序，保证 rowsnap 行序不变。

**rf3 读数（HEAD `b14fb4a`，601 处 / 139 个字段）前列**：remielleSlot 20、triggerPanel 16、aliceSlot 16、remiellePanel 14、remielleAnomalyMultiplier 14、triggerSlot 13、janeSlot 13、janePanel 12。19b 预计能清掉 damagePoolAnomaly 里的 aliceSlot（16）、janeSlot / janePanel 中本文件的那部分，以及 polarAlicePanel 等。

**CC-19b 开工清单**
1. 接口、分组、替换规则、反向验证点已在设计稿 §7.1 定稿（lead 于 `b14fb4a` 实读块 2–5 全文）。
2. 建 worktree：`git worktree add --detach /home/kaua/r69-scratch/cc19b <HEAD>`，软链 node_modules，拷入 `.zc/perf`；`sed -i 's#r69-scratch/cc19a #r69-scratch/cc19b #' /home/kaua/calc-arch/run-wt.sh`。
3. 提示词：复制 `/home/kaua/calc-arch/cc19a.prompt` 为 `cc19b.prompt`，改成「按 §7.1 迁块 2–5 到 alice（1401，模块文件先 `grep -ln "'1401'\|ALICE" src/mechanics/agents/`）与 jane（1261）模块」。棘轮 frozen 当前 **601**、target **589**；单测要求每块一条逐字用例，再加一条「爱丽丝 3 组 order 为 20/40/50」的用例。
4. 零差用 `/home/kaua/calc-arch/v19a.sh`（sed 改成 cc19b / 19b）；反向验证模板 `/home/kaua/calc-arch/r19a.sh`（突变点见 §7.1）。
5. 其余照 19a：cherry-pick -n → verify → 文档 → zc done。
6. 19c（蕾米埃尔，:514 起，字段最多）在 19b 之后单独实读设计。

### 5.13 CC-19b 落地记录 + CC-19c 开工清单（2026-09-26 第 27 轮 lead-arena-0925c）

**CC-19b（`3fbb326`，判据 22 601→545，target 533）**：完整记录在设计稿 `docs/mcp-cc19-extra-anomaly-rows.md` §8。

**rf3 读数（HEAD `3fbb326`，545 处 / 132 个字段）前列**：remielleSlot 20、triggerPanel 16、remiellePanel 14、remielleAnomalyMultiplier 13、triggerSlot 13、banyueSlot 10（convergence.ts）、aliceCoweringConfig 10（roundInputs / anomalyPool / helpers）、remielleCinema1SpecialVoidflareCount 9（跨 7 个文件，含 core/buff、core/panel）、aliceTeamAssaultCount 9、aliceDisorderCount 9。

**CC-19c 开工清单**
1. 定稿见设计稿 §7.2（lead 于 `3fbb326` 实读块 6 与依赖）。**两步两提交**：19c-1 把 `ELEMENT_*_KEYS` 搬到 `src/core/elementKeys.ts`，并把蕾米埃尔 3 个辅助函数搬进 `mechanics/agents/remielle.ts`，原处改为转发导出（零行为）；19c-2 把块 6 迁进 remielle 模块的 `extraAnomalyRows`（order 60），输入面追加 6 个字段。
2. worktree：`git worktree add --detach /home/kaua/r69-scratch/cc19c <HEAD>`，软链 node_modules，拷入 `.zc/perf`；`sed -i 's#r69-scratch/cc19b #r69-scratch/cc19c #' /home/kaua/calc-arch/run-wt.sh`。
3. 提示词：以 `/home/kaua/calc-arch/cc19b.prompt` 为模板。棘轮 frozen 当前 **545**、target **533**。要求两个提交，并在各自提交前各跑一遍 check-guards + vue-tsc。
4. lead 验收：**两个提交分别做零差**（先 checkout 19c-1 跑 v19b.sh 的副本，再验 19c-2）。反向验证点见 §7.2。
5. 19c 做完后的候选（届时实读再定）：
   - `triggerPanel` / `triggerSlot`（damagePool*.ts 与 helpers.ts，疑似触发者 / 扳机角色的通用名误报，要先确认是不是角色前缀；若是扳机 Trigger 这个角色就立卡）；
   - `aliceCoweringConfig` / `aliceTeamAssaultCount` / `aliceDisorderCount`（convergence / panelPhases / roundThreads 的回合线程字段，走 CC-15 那种通用命名的纯改名路线）；
   - `banyueSlot`（convergence.ts）。

### 5.14 CC-19c / CC-20 落地记录 + CC-21 开工清单（2026-09-26 第 28 轮 lead-arena-0925c）

**CC-19c**：完整记录在设计稿 `docs/mcp-cc19-extra-anomaly-rows.md` §8。同一节还记了「`__ms` 漂移不是回退」的 A/B 结论。**以后判断性能要做同条件 A/B，不要拿基线里的 `__ms` 比较。**

**CC-20（`ea61032`，换尺）**：
- 实读 `triggerPanel`（16）/ `triggerSlot`（13）/ `triggerAgentId`（4）/ `triggerCountValues`（3）/ `triggerSources`（1）的全部用处，都是「触发者（覆盖异常的角色）/ 触发源」的通用义（例：`core/anomalyPool/helpers.ts` 里的 `@param triggerPanel 触发者面板`），和扳机（`trigger.ts`）无关，共 37 处误报。
- 按 `triggerCount` 的先例，把这 5 个名字加入 `scripts/lib/core-role-field-ratchet.mjs` 的 `ROLE_FIELD_EXEMPT`。注释锁定：**这 5 个名字专指触发者，扳机角色字段不得复用**。
- `checkGuards.test` 的正控样本由 `triggerSlot` 换成假想扳机字段 `triggerShotCount`，并加一条断言：`triggerSlot` 在豁免表里。
- `/home/kaua/calc-arch/census.mjs` 是出原始普查表的工具，它的数字本来就含误报（当初 `triggerCount` 的 84 处也是事后人工扣除的），**所以不改**。rf3.mjs 直接 import 计数库，自动跟随新口径。

**rf3 读数（HEAD `ea61032`，462 处 / 124 个字段）前列**：remielleAnomalyMultiplier 13、banyueSlot 10（convergence）、aliceCoweringConfig 10（roundInputs / anomalyPool / helpers）、aliceTeamAssaultCount 9、aliceDisorderCount 9（convergence / panelPhases / roundThreads）、velinaCorrosionSource 9（anomalyPool）、remielleRainbowEndCount 9（rowBuild）、liuyinSrc 8、xideIdx 8（crossAgentEnergy）、remielleSpecialVoidflareUseCount 8。

**CC-21 开工清单（全队异常乘区能力化 + 通用改名；lead 实读 HEAD `ea61032`）**
1. 现状：`src/composables/useResourceCalc.ts:159`
   ```
   const remielleAnomalyMultiplier = computed(() => { slot = findSlotByIdentity(…, ['1581']); panel = panelAt(panels.value, slot); 1 + (panel.remielleRefringeCoefficient + panel.remielleRefringeCoefficientBonusPct) / 100 })
   ```
   这是在编排层写死的蕾米埃尔知识（身份 + 角色面板字段）。下游 `roundInputs.ts:126` 传进 anomalyPool 时本来就叫 `globalAnomalyMultiplier`（core/anomalyPool 里已用这个名字）。
   引用分布：useResourceCalc 3、roundInputs 3、damagePool 3、damagePoolAnomaly 3、mechanics/types 1，测试有 nextRoundFeedbackR19 / R20 和 ysgLoopTraceProbe，共 4 处。
2. 决定（规则 17：选长期）：
   - (a) `AgentMechanicModule` 新增可选能力 `globalAnomalyMultiplierFactor?(panel: PanelValues): number`（返回乘法因子，缺省视为 1）。remielle.ts 实现：`1 + (coef + bonus) / 100`，逐字搬现有公式。
   - (b) useResourceCalc 的 computed 改名为 `globalAnomalyMultiplier`，函数体改为遍历 `configStore.team` 各槽：`getAgentMechanic(agentId)?.globalAnomalyMultiplierFactor?.(panelAt(panels.value, slot))`，把有面板的因子连乘，初值 1。原式「无面板时返回 1」等价。
   - (c) 全仓把 `remielleAnomalyMultiplier` 改名为 `globalAnomalyMultiplier`，包括 ctx 字段、roundInputs deps、mechanics/types 的字段、测试。
     ⚠ 改名时先 grep 同文件内已有的 `globalAnomalyMultiplier`：roundInputs.ts:126 已有对象键 `globalAnomalyMultiplier: remielleAnomalyMultiplier.value`，改完变成 `globalAnomalyMultiplier: globalAnomalyMultiplier.value`，这是合法的。core/anomalyPool 里的同名字段本来就是同一个意思。
3. 零差论证：目前只有 remielle 实现这个能力，findSlotByIdentity 与逐槽 agentId 等价（catalog 62 个角色里没有 teammateBuffId 别名，见 CC-19 设计稿 §1），因此乘积恒等于原值。
4. 判据：
   - 判据 22 预计约 −15（13 处 remielleAnomalyMultiplier，加上 useResourceCalc 里的 2 处 remielleRefringe*）；
   - useResourceCalc 删掉了 `['1581']` 身份判定，**角色判定棘轮（判据 6 / agent-identity）可能跟着下降**，按报错同步它的 baseline；
   - 两个都是进步，不是换尺，可以和代码同批提交。
5. 反向：remielle 因子里的 `/ 100` 改成 `/ 1e9`（因子 ≈ 1），rowsnap 应在 6 组含 1581 的预设 × 7 个变体出现 DIFF（异常行受全队乘区影响）。
6. 执行：dsflash 工人 + worktree `r69-scratch/cc21`，提示词以 `/home/kaua/calc-arch/cc19c.prompt` 为模板（单个提交）。零差用 `/home/kaua/calc-arch/v19c.sh <commit> <tag>`（先 sed 把 cc19c 改成 cc21）。
7. CC-21 之后的候选（届时实读再定）：
   - `aliceTeamAssaultCount` / `aliceDisorderCount`（回合线程字段，走 CC-15 那种通用命名的纯改名路线）；
   - `aliceCoweringConfig` / `velinaCorrosionSource` / `velinaCinema2CorrosionRate`（anomalyPool 输入，考虑按模块能力声明）；
   - `banyueSlot`（convergence）；
   - `remielleRainbowEndCount` / `remielleSpecialVoidflareUseCount`（rowBuild / rowAccounting）。

### 5.15 CC-21 落地记录 + CC-22 / CC-23 开工清单（2026-09-26 第 29 轮 lead-arena-0925c）

**CC-21（`3d000d0`，判据 22 462→447，target 435）**：
- `useResourceCalc.ts` 原来按身份 `findSlotByIdentity(['1581'])` 找槽、读 `remielleRefringeCoefficient*` 面板字段，现改为全队各槽 `getAgentMechanic(id)?.globalAnomalyMultiplierFactor(panelAt(panels.value, slot))` 连乘，初值 1，无面板的槽跳过（与原「无面板返回 1」等价）。
- 公式逐字迁入 `remielle.ts` 模块对象（`agentIds` 下一行）。`mechanics/types.ts` 的 `AgentMechanicModule` 新增可选能力 `globalAnomalyMultiplierFactor?(panel)`。
- 改名 16 处：ctx 字段、`roundInputs` deps、damagePool / damagePoolAnomaly，以及 nextRoundFeedbackR19 / R20、ysgLoopTraceProbe 的测试桩。下游 core/anomalyPool 早就叫 `globalAnomalyMultiplier`，现在全链同名。
- **遗留 1 处不改**：`src/specs/agents/1581.json:71` 的说明文字里有 `remielleAnomalyMultiplier` 字样。那是用户确认过的账本校对记录（历史口径描述），不是代码引用。
- 零差：dump 625 / rowsnap 638 个键，只有 `__ms` 不同。反向：因子 `/ 100` → `/ 1e9`，rowsnap DIFF 42 = 6 组 1581 预设 × 7 个变体，没有波及其他角色，cp 还原并 cmp 一致。
- `remielle.test.ts` 新增 1 条公式用例：空面板返回 1；异化度 20 + 提升 5 返回 1.25。
- 角色判定棘轮没有变化：`findSlotByIdentity(['1581'])` 这种数组写法不在 AST 三形态的统计范围内。

**rf3 读数（HEAD `3d000d0`，447 处 / 123 个字段）前列**：banyueSlot 10（convergence）、aliceCoweringConfig 10（roundInputs / anomalyPool / helpers）、aliceTeamAssaultCount 9、aliceDisorderCount 9（convergence / panelPhases / roundThreads）、velinaCorrosionSource 9（anomalyPool）、remielleRainbowEndCount 9（rowBuild）、liuyinSrc 8、xideIdx 8（crossAgentEnergy）、remielleSpecialVoidflareUseCount 8、liuyinIdx 7、liuyinPromoteCount 7、velinaCinema2CorrosionRate 7。

**CC-22 开工清单（纯改名；lead 实读 HEAD `3d000d0`）** ——⚠ **已作废**（前提错误，见 §5.16），保留作为账本
1. 语义（`mechanics/types.ts:291–299` 注释原文）：
   - `aliceTeamAssaultCount` = **全队强击触发次数**（`physical` + `physical_polar_assault` 两键之和，上一轮异常池收敛值）；
   - `aliceDisorderCount` = **全队紊乱次数**。
   两者都是跨轮反馈，build 阶段为 0。**它们是通用事实，只是目前唯一的消费者是爱丽丝**（剑仪 `alice_team_assault_gain` / `alice_disorder_gain`）。
2. 改名：`aliceTeamAssaultCount` → `teamAssaultCount`，`aliceDisorderCount` → `teamDisorderCount`。范围：
   - `mechanics/types.ts:297/299`（`AgentTeamConfigInput` 字段）以及 :310 注释里的引用；
   - `composables/resourceCalc/roundThreads.ts:65/67/103/104`（`CalcRoundThreads`）；
   - `panelPhases.ts:144/146/186/187/245/246`；
   - `convergence.ts:130/131/579/580/1133/1134`（对象键；右侧的 `prevAliceTeamAssaultCount` 等局部量也一并改成 `prevTeamAssaultCount` / `prevTeamDisorderCount`，先 grep 它们的全部出处）；
   - `alice.ts:555/569/570` 里 `applyTeamConfig` 解构的入参名；
   - `alice.test.ts:190/191/196/197` 若是 `applyTeamConfig` 入参就一起改。
3. **不改**：
   - 爱丽丝 cfg 上的同名字段：`alice.ts:210/211/322/323/327/333/559–561/568`（`cc.aliceTeamAssaultCount = …`），以及 `types/resource/config.ts:262/264`（`CharacterConfig` 字段）。它们属于模块自己写的 cfg，不在判据 22 的计数范围内；改了会波及 feedbackCfgKeys / 快照键，没有收益。
   - ⚠ `alice.ts:569` 这一行左边是 cfg 字段（不改），右边是入参（要改）。**必须手工逐行改，禁止全仓 sed**。这和 CC-16 的「cfg 字段与 computed 同名但不同物」是同一类坑。
4. 名字冲突检查（已做）：`teamAssaultCount` 只在 `src/specs/resources.ts:10/197`（spec 上下文字段）出现，与本卡改名的对象不同，语义一致（都是全队强击次数），不冲突。`teamDisorderCount` 全仓未使用。
5. 判据 22 预计约 −18。纯改名，零差应当逐位成立。反向验证用单测：把 `alice.ts` 里 `applyTeamConfig` 写 cfg 那一行的入参改成 0，`alice.test.ts` 190–197 附近的用例应当变红。
6. 执行：改动面约 25 处且有 cfg 同名坑，**建议 lead 自做**（参照 CC-21：python 逐处断言恰好匹配 1 次再替换）；若派 dsflash，提示词必须写明第 3 条。零差命令参照 `/home/kaua/calc-arch/z21.sh`（在主仓库工作区跑 dump + rowsnap + 反向验证）。

**CC-23（待设计，CC-22 之后）**：`convergence.ts:63` 直接 `import { aliceExternalCountsOf, aliceSlotOf, aliceSparkCountOf } from '@/mechanics/agents/alice'`，编排层直连角色模块。它和 CC-16 遗留的 `convergence.ts:54` 直接 import `computeBanyueInteractionTopUp` 是同一类问题。方向：做成模块能力（例如 `nextRoundTeamCounts(ap, rr)`），经 `getAgentMechanic` 派发。`banyueSlot`（convergence，10 处）一起考虑。

### 5.16 CC-22（修订版）落地记录 + CC-23 开工清单（2026-09-27 第 30 轮 lead-arena-0925c）

**§5.15 的 CC-22 为什么作废（决定 + 依据）**：§5.15 的语义依据是 `mechanics/types.ts` 注释写的「全队**强击**触发次数（physical + physical_polar_assault 两键之和）」。但 `alice.ts#aliceExternalCountsOf` 的函数体和注释写明了两点：只取 `physical`（极性强击另有 `alice_polarity_feedback` 规则，计入就会双计）；按 `perSlotTriggerCounts[aliceSlot]` **只取爱丽丝自己触发的**（原文「爱丽丝通过属性异常积蓄触发强击时」，实测会多算 45%）。所以那条注释是**过时的**。改名成 `teamAssaultCount` 会把角色专属的量伪装成通用事实，还会和 `src/specs/resources.ts` 里真正的全队 `teamAssaultCount` 混淆。**教训：开工清单里的语义要以实现为准，不能以注释为准。**

**CC-22 修订版（`05bb382`，判据 22 447→430，target 418）**：
- `alice.ts`：新增 `nextRoundFeedback: ({ slot, anomalyPool }) => aliceExternalCountsOf(anomalyPool, slot) → { aliceTeamAssaultCount, aliceDisorderCount }`（爱丽丝不在队时派发器不调，键缺席）。`applyTeamConfig` 从解构入参改为读 `threads?.aliceTeamAssaultCount ?? 0`。`aliceExternalCountsOf` 的 `perElement` 形参放宽为 `ReadonlyArray`（钩子收到的是 DeepReadonly）。
- `convergence.ts`：import 只剩 `aliceSparkCountOf`。删掉 `threads` 解构里的 `prevAlice*` 两项，删掉 converge 相位 `applyTeamMechanics` 的两个入参，删掉 `aliceExternalCounts` 局部量。threadsNext 改写为 `feedbackNext.aliceTeamAssaultCount ?? 0`。
- `panelPhases.ts`：`applyTeamMechanics` 的 params 删掉 2 个字段、2 个局部量和 2 个透传。`mechanics/types.ts`：`AgentTeamConfigInput` 删掉 2 个字段（含过时注释）。`roundThreads.ts`：注释更正为「爱丽丝自己触发的 physical 强击 / 全队紊乱；产出方为爱丽丝 nextRoundFeedback」。
- **等价论证**：钩子的 `anomalyPool` 就是原来的 `ap1`（convergence 调用 `collectNextRoundFeedback({ anomalyPool: ap1, prevThreads: threads })`）。converge 相位的 `threads` 就是原来 `prevAlice*` 解构的来源。`slot = cfg.slot` 与 `aliceSlotOf(rr)`（`rr.characters[].slot`）同源。
- **验证**：vue-tsc 0；零差（dump 625 / rowsnap 638，只有 `__ms` 不同）；反向（钩子里 `assaultCount + 1000`）rowsnap DIFF 28 = 4 组 1401 预设（`auto-1401-{1361,1511,1261}-1411`、`auto-1401-1411-1031`）× 7 个变体，没有波及其他角色，cp 还原并 cmp 一致；`npm run verify` EXIT=0。脚本：`/home/kaua/calc-arch/cc22.py`（改代码）、`z22.sh`（tsc + 零差 + 反向）。
- **遗留（有意保留）**：cfg 上的同名字段 `aliceTeamAssaultCount` / `aliceDisorderCount`（alice.ts、`types/resource/config.ts`）以及线程字段名都没有改名。它们本来就是爱丽丝专属，名字里的 Team 是历史名，已在注释里标明。`aliceSlotOf` 已无代码调用方（只剩 `roundInputs.ts:96` 注释提到），**暂留导出**，属于可选清理项，删除时要同步那段注释。
- **回退点**：`git revert 05bb382`（单个提交，含棘轮常量 430/418）。

**rf3（HEAD `05bb382`，430 处 / 120 个字段）前列**：banyueSlot 10（convergence）、aliceCoweringConfig 10、velinaCorrosionSource 9、remielleRainbowEndCount 9、liuyinSrc 8、xideIdx 8、remielleSpecialVoidflareUseCount 8、liuyinIdx 7、liuyinPromoteCount 7、velinaCinema2CorrosionRate 7。

**CC-23 开工清单（般岳交互补齐；lead 实读 HEAD `05bb382` 的 convergence.ts）**
1. 现状：
   - `convergence.ts:195` 为 `const banyueSlot = findSlotByIdentity(configStore, catalogStore, ['1471'])`，是身份判定。
   - `:217` autoTopUp 门控为 `… && banyueSlot >= 0 && setting('banyue.autoTopUpInteractions', 1)`；`:221` 为 `decibelParryActive = guaranteeUltimate && banyueSlot < 0`（通用保底 4 喧响与般岳互斥，避免双计）。
   - `:699–721` 在 `if (autoTopUp)` 中用 `banyueSlot` 取 storeChar / axisUltimateNeed / decibelHave / axisActionCountsBySlot / ultimateCost / perParrySeconds，调用直连 import 的 `computeBanyueInteractionTopUp`（`:54`）。
2. 方案（两步，可以合成一个提交）：
   - (a) 找槽改为声明式：`const interactionTopUpSlot = configStore.team.findIndex(c => c?.agentId && getAgentMechanic(c.agentId)?.producesInteractionTopUp)`。这和 `useResourceCalc.ts:437` 同一写法；`banyue.ts:1070` 已声明 `producesInteractionTopUp: true`；`convergenceNightB.test.ts:290` 的注释早就指出这里「本可走声明式」。**先读 `findSlotByIdentity` 的实现**，确认它和 `team.findIndex(agentId)` 在空槽、变体身份上是否等价；不等价就改用同一个 helper，再用模块声明过滤。
   - (b) `AgentMechanicModule` 新增可选能力 `computeInteractionTopUp?(opts)`，签名直接复用 `computeBanyueInteractionTopUp` 的 opts 类型（从 banyue.ts 导出类型，或提到 types.ts）。banyue 模块对象挂 `computeInteractionTopUp: computeBanyueInteractionTopUp`。convergence 改为 `getAgentMechanic(team[slot].agentId)?.computeInteractionTopUp?.({...}) ?? prevInteractionTopUp`，删掉 `:54` 的 import。
   - 局部量 `banyueSlot` 全部改名为 `interactionTopUpSlot`（只在 convergence.ts 内，共 10 处，`grep -n banyueSlot` 逐处核对）。`computeBanyueAxisExFor` 如果只服务这里，改名留到下一张。
   - **不改**：setting 键 `'banyue.autoTopUpInteractions'`（持久化配置键，改了会让用户已有设置失效），以及注释里的「般岳」字样。
3. 预计判据 22 约 −10；角色判定棘轮（`findSlotByIdentity(['1471'])` 是数组写法，不计数）无变化。零差应当逐位成立。反向验证：在 banyue 模块的能力里把返回值的补齐量 +1（或让 `producesInteractionTopUp` 找槽失效），rowsnap 应当只波及含 1471 的预设。
4. 执行：lead 自做（约 15 处，参照 cc22.py 逐处断言），零差模板 `/home/kaua/calc-arch/z22.sh`（把 MUT 那行 sed 换成 banyue）。
5. 之后的候选：aliceCoweringConfig 10（roundInputs / anomalyPool / helpers；core/anomalyPool 里带角色前缀的 cfg，可能适合做成通用的「附加异常 dot 配置」）、velinaCorrosionSource 9（anomalyPool）。两者动手前都要先实读。

### 5.17 CC-23 落地记录 + CC-24 开工清单（2026-09-27 第 31 轮 lead-arena-0925c）

**CC-23（`8ecd5f2`，判据 22 430→420，target 418 不变）**：
- `convergence.ts`：
  - 找槽改为 `const interactionTopUpSlot = configStore.team.findIndex(c => c.agentId && getAgentMechanic(c.agentId)?.producesInteractionTopUp)`，与 `useResourceCalc.ts` 交互栏的 `interactionTopUp` computed **同一写法**，两处判定同源；
  - `banyueSlot` 在本文件内全部 10 处改名为 `interactionTopUpSlot`；
  - `if (autoTopUp)` 里改为 `getAgentMechanic(storeChar.agentId)?.computeInteractionTopUp`，能力缺席时保持上一轮值；
  - 删掉对 `computeBanyueInteractionTopUp` 的 import。
- `mechanics/types.ts`：
  - `AgentMechanicModule` 新增 `computeInteractionTopUp?(opts: InteractionTopUpInput): InteractionTopUp`；
  - 文件末尾新增 `InteractionTopUp` / `InteractionTopUpInput` 两个接口，字段与注释从 banyue.ts 逐字迁入。
- `banyue.ts`：
  - `BanyueInteractionTopUp` 改为 `export type … = InteractionTopUp` 别名，`banyue.test` 等既有引用不用动；
  - `computeBanyueInteractionTopUp(opts: InteractionTopUpInput): InteractionTopUp`；
  - 模块对象挂 `computeInteractionTopUp: computeBanyueInteractionTopUp`。
- `roundThreads.ts` / `roundResult.ts`：类型改从 `@/mechanics/types` import `InteractionTopUp`。这两处也是编排层直连角色模块（类型级），**清单外顺手清掉**。
- `convergenceNightB.test.ts` ② 新增断言：般岳模块必须挂出 `computeInteractionTopUp`。
- **等价口径（拍板）**：`findSlotByIdentity` 按 catalog 条目的 `id` / `teammateBuffId` 匹配，声明式写法按模块声明匹配。两者只在「角色不在 catalog」或「别人的 teammateBuffId 恰好是 '1471'」时可能不同，实际语料中不存在这两种情况（零差已证）。选用与交互栏相同的写法，是为了让「谁是补齐提供者」只有一个判据。
- **验证**：
  - vue-tsc 0；零差（dump 625 / rowsnap 638，只有 `__ms` 不同）。
  - **perf 语料反向为 DIFF 0**：语料没有开轴模式或保底开关的般岳队，autoTopUp 路径不在 dump 覆盖范围内（已知局限，见 Errors 口径「dump 抓不到的改动用单测反向」）。
  - 因此改用**单测反向**：`/home/kaua/calc-arch/r23.sh` 把模块能力改成 `parry + 3`，5 个相关测试文件里 `convergenceNightD.test.ts` 的 2 条真管线端到端用例变红（「保底4喧响 + 般岳队 ⇒ 补齐量精确值」「只开保底4嗔火 ⇒ 喧响侧补齐为 0」），还原后 cmp 一致。
  - `npm run verify` EXIT=0。
  - 脚本：`cc23.py`（改代码）、`z23.sh`（tsc + 零差 + 语料反向）、`r23.sh`（单测反向）。
- **不改**：setting 键 `'banyue.autoTopUpInteractions'`（持久化键）、`computeBanyueAxisExFor`（convergence 局部函数，不在判据计数中）、注释里的「般岳」字样。
- **回退点**：`git revert 8ecd5f2`（单个提交，含棘轮常量 420）。

**rf3（HEAD `8ecd5f2`，420 处 / 119 个字段）前列**：aliceCoweringConfig 10、velinaCorrosionSource 9、remielleRainbowEndCount 9、liuyinSrc 8、xideIdx 8、remielleSpecialVoidflareUseCount 8、liuyinIdx 7、liuyinPromoteCount 7。

**CC-24 开工清单（畏缩配置通用化；lead 实读 HEAD `8ecd5f2`）**
1. 语义：畏缩（Cowering / Flinch）是**物理异常「强击」附带的通用状态**，爱丽丝的核心被动只是强化它（畏缩期间有固定 DOT，紊乱覆盖物理时倍率 +18%/s，上限 180%）。配置本身（`dotRatio / dotInterval / disorderBonusPerSec / disorderBonusMax / assaultBaseMultiplier`）不含角色身份，引擎侧的消费（`helpers.ts:1108` 紊乱倍率加成、`anomalyPool.ts:427` DOT）也只看物理元素，不看是谁。
2. (a) 纯改名（判据 22 预计 −10）：
   - `core/anomalyPool/helpers.ts:306/1043` 字段 `aliceCoweringConfig` → `coweringConfig`，以及 `:1108/1110/1111/1359` 的读点；
   - `:317` `interface AliceCoweringConfig` → `CoweringConfig`，保留 `export type AliceCoweringConfig = CoweringConfig` 别名以防外部引用（先 grep 使用方）；
   - `core/anomalyPool.ts:16`（re-export 同步加 `CoweringConfig`）、`:302`、`:427`；
   - `composables/resourceCalc/roundInputs.ts:127` 的键名；
   - `convergenceNightB.test.ts:232/239` 的注释。
3. **不改**：异常池**输出**字段 `aliceCoweringDot`（`AliceCoweringDotResult`，结果对象键，被快照/展示/行构建消费，改了会影响 rowsnap 键）；函数 `calcAliceCoweringDot`（函数名，不计数，可留到下一张）；cfg 字段 `aliceEnabled` / `aliceCoweringDot*`（爱丽丝模块自己写的 cfg）。
4. (b) 可选第二步（另立 CC-25）：`roundInputs.ts:100–108` 的 `aliceInfo` computed 仍按身份 `findSlotByIdentity(['1401'])` 找槽，并直读 `cfg.aliceEnabled` / `cfg.aliceCowering*`。方向是做成模块能力，例如 `anomalyPoolSetup?(cfg) → { coweringConfig?, giftedTriggerSlot? }`。`giftedTriggerCounts`（`physical_polar_assault` 取 aliceSpark）也在这里，要一并设计。**动手前先读 `convergenceNightB.test.ts` 那组等价性 oracle**（前导空槽实算）。
5. 验证：纯改名，零差应当逐位成立。反向：把 `helpers.ts` 紊乱倍率加成的 `disorderBonusMax` 读点改成 0，rowsnap 应当只波及 1401 预设（语料里 4 组，参见 CC-22 反向 DIFF 28）。模板 `/home/kaua/calc-arch/z22.sh`，把 MUT 那行 sed 换掉。
6. 执行：lead 自做（约 12 处）。

### 5.18 CC-24 落地记录 + CC-25 开工清单（2026-09-27 第 32 轮 lead-arena-0925c）

**CC-24（`1d1d823`，判据 22 420→410，target 398）**：整词改名，共 17 处：
- `core/anomalyPool/helpers.ts` 9 处（`DamageCalcConfig` / `AnomalyPoolInput` 两个字段，第 306、1043 行各含字段名和类型名；接口 `CoweringConfig`；紊乱倍率加成与 `calcAliceCoweringDot` 的读点）；
- `core/anomalyPool.ts` 4 处（re-export、透传、DOT 门控）；
- `roundInputs.ts` 1 处键名；
- `convergenceNightB.test.ts` 2 处注释；
- `ResultPage.vue` 1 处注释。

接口和字段注释改为「畏缩是物理强击附带的通用状态，引擎只按物理元素消费，目前唯一开启方是爱丽丝」。**不留别名**：`AliceCoweringConfig` 除 core 的 re-export 外没有其他使用方（grep 确认）。helpers.ts:317 注释里保留了一次历史名，是有意的。
- **不改**：输出字段 `aliceCoweringDot` / `AliceCoweringDotResult`（结果对象键，被 rowsnap / 展示消费），函数名 `calcAliceCoweringDot`，爱丽丝 cfg 字段 `aliceEnabled` / `aliceCowering*`。
- **验证**：vue-tsc 0；零差（dump 625 / rowsnap 638，只有 `__ms` 不同）；反向（helpers.ts 紊乱倍率加成的 `disorderBonusMax` 读点改为 0）rowsnap DIFF 28 = 4 组 1401 预设 × 7 个变体，与 CC-22 的波及面一致，cp 还原并 cmp 一致；`npm run verify` EXIT=0。脚本：`/home/kaua/calc-arch/cc24.py`、`z24.sh`（tsc + 零差 + 反向 + 读 rf）。
- **回退点**：`git revert 1d1d823`（单个提交，含棘轮常量 410/398）。
- **本轮踩坑（写给后来者）**：
  - ① 改动脚本是「逐文件断言、逐文件写入」，第二个文件断言失败时第一个已经写盘，重跑就不再幂等（预期次数也跟着变了）。**以后的改动脚本要先对全部文件断言完毕，再统一写盘**。
  - ② 预期次数要按「**行内出现次数**」数，不能按 grep 行数数（`key: input.key` 这种行一行算 2 次）。
  - ③ 在断言失败前就启动了后台验证，结果在旧代码上跑。**后台验证必须用 `&&` 接在改动脚本成功之后**。杀掉它时，`setsid` 的 pgid 并不是 bg.sh 打印的那个 pid（打印的是子 bash），要用 `ps -eo pid,pgid,cmd` 查到具体 pid 再逐个 `kill -9`，**禁止使用 wsl --terminate**。

**rf3（HEAD `1d1d823`，410 处）前列**：velinaCorrosionSource 9（anomalyPool）、remielleRainbowEndCount 9（rowBuild）、liuyinSrc 8、xideIdx 8（crossAgentEnergy）、remielleSpecialVoidflareUseCount 8、liuyinIdx 7、liuyinPromoteCount 7、velinaCinema2CorrosionRate 7。（跑 `node /home/kaua/calc-arch/rf3.mjs 10` 核对。）

**CC-25 开工清单（爱丽丝异常池入参能力化；lead 实读 HEAD `1d1d823` 的 roundInputs.ts）**
1. 现状（`composables/resourceCalc/roundInputs.ts:90–130`）：
   - `aliceInfo` computed 用 `findSlotByIdentity(configStore, catalogStore, ['1401'])` 找槽（**身份判定**）；
   - 再用 `resourceConfig.value?.characters.find(c => c.slot === slot)` 取 cfg（按身份取，**禁止** `characters[slot]` 下标，见头注释和判据 17）；
   - `!cfg?.aliceEnabled` 时返回 null；否则拼出 `coweringConfig`（`aliceCoweringDotRatio ?? 2.5` 等 4 个 cfg 字段 + `assaultBaseMultiplier: 853`）；
   - `calcAnomalyPoolInput` 消费 `coweringConfig`、`giftedTriggerCounts`（`alice && aliceSpark > 0 ? { physical_polar_assault: aliceSpark }`）和 `giftedTriggerSlot: alice?.slot`。
2. 方案：
   - `AgentMechanicModule` 新增可选能力 `anomalyPoolSetup?(cfg: CharacterOperationConfig): { coweringConfig?: CoweringConfig } | null`，类型从 `@/core/anomalyPool` 做 type import。**判据 19**：mechanics 禁止按值 import `@/composables`，type import 没问题。
   - alice.ts 实现：`cfg.aliceEnabled` 为假时返回 null，否则返回原样拼出的 `coweringConfig`（默认值逐字搬迁）。
   - roundInputs：把 `aliceInfo` 改名为 `anomalyPoolSetupInfo`，逻辑改为遍历 `configStore.team` 的槽位，找第一个 `getAgentMechanic(agentId)?.anomalyPoolSetup` 存在的槽，按 `characters.find(c => c.slot === slot)` 取 cfg，调用能力；结果为 null 时整体返回 null，否则返回 `{ slot, ...result }`。`giftedTriggerSlot` 用这个 slot。
   - **保留原头注释的循环依赖约束**：这个 computed 只能读 configStore / catalogStore / resourceConfig，不能读 resourceResult。
3. **等价风险**：原来按 catalog 身份找槽，新写法按模块能力找槽，差异面与 CC-23 相同（零差会证）。`giftedTriggerCounts` 的 `alice &&` 门控变成「有 setup 结果」，语义不变（爱丽丝未启用时原来也是 null）。
4. 验证：
   - 零差（rowsnap 应当逐位一致）；
   - 反向用单测：`convergenceNightB.test.ts:241–262` 两条「前导空槽 + 爱丽丝在槽 2」「槽 0 / 槽 2 同一份配置」是现成的端到端判据。变异方式：让能力返回 null，这两条应当变红；
   - 语料反向：能力返回的 `disorderBonusMax` 改为 0，预期 DIFF 28（同 CC-24）。
5. 判据 22 预计小幅下降（主要是删掉 `alice` 前缀局部量）；角色判定棘轮不会变（数组写法 `['1401']` 不计数）。执行：lead 自做。
6. 之后的候选：velinaCorrosionSource（`core/anomalyPool.ts`，9 处）+ velinaCinema2CorrosionRate（7 处），同属维琳娜风蚀，可合成一张，动手前先实读。

### 5.19 CC-25 落地记录 + CC-26 开工清单 + CC-27（维琳娜风蚀）设计要点（2026-09-27 第 33 轮 lead-arena-0925c）

**CC-25（`7cef9c8`，判据 22 410→403，target 398 不变）**：
- `mechanics/types.ts`：`AgentMechanicModule` 新增 `anomalyPoolSetup?(cfg: DeepReadonly<CharacterOperationConfig>): { coweringConfig?: CoweringConfig } | null`，从 `@/core/anomalyPool` 做 type import `CoweringConfig`，符合判据 19。
- `alice.ts` 模块对象：`anomalyPoolSetup: (cfg) => cfg.aliceEnabled ? { coweringConfig: {…} } : null`，4 个 cfg 默认值（2.5 / 0.95 / 18 / 180）和 `assaultBaseMultiplier: 853` 从 roundInputs 逐字搬迁。
- `roundInputs.ts`：
  - `aliceInfo` 改名为 `anomalyPoolSetupInfo`；
  - 找槽改为 `configStore.team.findIndex(c => c.agentId && getAgentMechanic(c.agentId)?.anomalyPoolSetup)`；
  - cfg 仍按 `characters.find(c => c.slot === slot)` 取（判据 17，前导空槽）；
  - 返回 `{ slot, ...setup(cfg) }` 或 null；
  - `calcAnomalyPoolInput` 里的局部量 `alice` 改为 `setup`（`giftedTriggerCounts` / `giftedTriggerSlot` 门控语义不变）。
  - 头注释的「不能读 resourceResult，否则成环」约束保留，并在找槽处注明仍然成立。`findSlotByIdentity` 的 import 保留（`:184` 琉音判定还在用）。
- **验证**：
  - vue-tsc 0；零差（dump 625 / rowsnap 638，只有 `__ms` 不同）。
  - **语料反向**（能力返回的 `disorderBonusMax` 改为 0）：DIFF 28 = 4 组 1401 预设 × 7 个变体。
  - **单测反向**（能力恒返回 null）：`convergenceNightB.test.ts` 组 4 的 2 条「前导空槽 + 爱丽丝在槽 2」「槽 0 / 槽 2 同一份配置」变红（17/19）。
  - 还原后 cmp 一致；convergenceNightB + inStunAttribution + alice.test 共 74/74 通过；`npm run verify` EXIT=0。
  - 脚本：`/home/kaua/calc-arch/cc25.py`（先全部断言再统一写盘，遵守 §5.18 踩坑①）、`z25.sh`。
- **未改**：`calcAnomalyPoolInput` 的形参 `aliceSparkOverride` 和局部量 `aliceSpark`（来自 convergence 的 `aliceSparkCountOf(rr)`，属于 CC-22 之后剩下的「极性强击赠送计数」通道）。如果要做，可以单独一张：让 `anomalyPoolSetup` 也返回赠送计数，但它要读本轮 rr，会撞上成环约束，**不能**直接塞进同一个 computed。
- **回退点**：`git revert 7cef9c8`（单个提交，含棘轮常量 403）。

**CC-26 开工清单（蕾米埃尔「垂虹」必做动作行 → 模块能力；lead 实读 HEAD `7cef9c8`）**
1. 现状（core/resource 里的角色专属逻辑，判据 22 的 rf3 前列 `remielleRainbowEndCount` 9 / `remielleSpecialVoidflareUseCount` 8 都在这里）：
   - `core/resource/rowAccounting.ts:27` `remielleSpecialVoidflareUseCount(cfg)`：按 `panel.remielleCinema1/4/6*` 算特殊虚耀次数；
   - `core/resource/rowBuild.ts:224–242`：`count > 0 && cfg.remielleRainbowEndMoveId` 时 push 一行「普通攻击：垂虹（特殊虚耀载体）」，category basic，timeBucket necessary，actionTime / comboAlignRatio / decibelRecovery 取 `cfg.remielleRainbowEnd*`；
   - `rowBuild.ts:573–600` 是第二处同形逻辑（**开工前先实读**，确认差异）；
   - `core/resource/helpers.ts:410/433`：时间合计里内联了 `remielleSpecialVoidflareUseCount(cfg) * cfg.remielleRainbowEndActionTime`（以及 `* ComboAlignRatio`）；
   - `helpers.ts:57/68/83`：re-export。
2. 先例：同一层的 `rowAccounting.ts#exSpecialNecessaryTime` 已经在 core 里用 `getAgentMechanic(cfg.agentId)?.estimateExSpecialTime` 派发模块能力，所以 core/resource 按 cfg.agentId 派发**不违反** core/** 禁写 agentId 判定（派发器不含 id）。
3. 方案：
   - `AgentMechanicModule` 新增 `extraNecessaryAction?(cfg: CharacterOperationConfig): { moveId: string; moveName: string; category: 'basic'; count: number; actionTime: number; comboAlignRatio: number; decibelRecovery: number } | null`（名字可调，写进设计时定稿）；
   - remielle.ts 实现：搬入 `remielleSpecialVoidflareUseCount` 公式，`count <= 0 || !cfg.remielleRainbowEndMoveId` 时返回 null；
   - rowBuild 两处和 helpers 两处改为调用同一个 helper，例如在 rowAccounting 里放 `extraNecessaryActionOf(cfg)`（内部 `getAgentMechanic(cfg.agentId)?.extraNecessaryAction?.(cfg) ?? null`），再按返回值 push 行或累加时间；
   - `remielleSpecialVoidflareUseCount` 若还有其他调用方（先 grep），保留为 remielle.ts 的导出。
4. **风险**：rowBuild 两处的 moveName / timeBucket 如果不同，要逐字保留（能力只返回数据，文案留在调用点或放进返回值）。helpers 的时间合计必须与行的 totalTime 同源，否则前台时间会漂移。
5. 验证：零差（rowsnap 会直接覆盖这一行）；反向：能力返回的 count +1，预期只波及含 1581 的预设（6 组 × 7 = 42，参见 CC-21）。执行：lead 自做。

**CC-27（维琳娜风蚀，待设计；为什么不能只改名）**：`velinaCorrosionSource`（9 处）和 `velinaCinema2CorrosionRate`（7 处）是 **core 里驻留的角色机制**，不是可以通用化的字段。
- 风蚀状态机 `resolveAnomalyCorrosion` 在 `core/anomalyPool.ts:308–339` 结算，并且只有维琳娜有（CC-D3 测试 `anomalyPool.test.ts:132–182` / `ccD3D1Verdict.test.ts` 写明「无维琳娜时风蚀状态机不得结算」）。
- `velinaCorrosionSource` 是 `AnomalyPoolResult` 的**输出字段**（`types/resource/pools.ts:128`），被 `ResourceResultCard.vue:599`、`velina.ts:491` 和多条测试读取。
- `velinaCinema2CorrosionRate` 从 roundInputs 经 setting 下发（`velina.ts:152` 也从 panel 读）。
- 改名只会给角色专属机制戴上通用名（同 CC-22 教训）。正确方向是：把风蚀结算迁到维琳娜模块已有的 `anomalyCorrosion?` / `transformAnomalyPool?` 能力（types.ts:794/809，**先读它们现在是谁在实现、谁在派发**）；输出字段可以保留原名（结果键），或者放进模块自有的结果槽。**设计稿写好再动手**，改动面涉及 core/anomalyPool 主流程。

### 5.20 CC-26 落地记录 + CC-26b 开工清单（2026-09-27 第 34 轮 lead-arena-0925c）

**实读修正 §5.19 清单（开工前发现）**：
- ① `rowBuild.ts:573` **不是**同形的执行行，而是 `buildAnomalyEventExecutions` 里的「特殊虚耀」**异常事件**。该函数开头已经在派发 `buildAnomalyEvents` 钩子，所以把事件迁进蕾米埃尔的这个钩子即可。
- ② `helpers.ts:410/433` 的时间合计**不检查** `remielleRainbowEndMoveId`，行构建那边检查。所以能力把「次数和时长」与「moveId」分开返回：moveId 为空时只预留时间、不补行，逐位保留迁移前的口径。

**CC-26（`8b7d9db`，判据 22 403→363，target 351）**：
- `mechanics/types.ts`：`AgentMechanicModule` 新增 `extraNecessaryAction?(cfg): ExtraNecessaryAction | null`；文件末尾新增 `interface ExtraNecessaryAction { count; moveId?; moveName; actionTime; comboAlignRatio; decibelRecovery }`。
- `core/resource/rowAccounting.ts`：`remielleSpecialVoidflareUseCount` 删除，换成派发口 `extraNecessaryActionOf(cfg) = getAgentMechanic(cfg.agentId)?.extraNecessaryAction?.(cfg) ?? null`。同文件 `exSpecialNecessaryTime` 派发 `estimateExSpecialTime` 是先例；派发器不含角色 id，符合 core 禁止角色判定的规则。
- `core/resource/helpers.ts`：re-export 改名；循环里先取 `const extraAction = extraNecessaryActionOf(cfg)`，必要时间 `+ (extraAction ? count × actionTime : 0)`，合轴时间再 `× comboAlignRatio`。
- `core/resource/rowBuild.ts`：
  - `buildExecutions` 的垂虹行改为 `extraAction && extraAction.moveId` 时 push，字段顺序经脚本逐字段断言与旧块一致；
  - `buildAnomalyEventExecutions` 删掉局部量 `remielleRainbowEndCount` 和事件块，留一行注释指向模块。
- `mechanics/agents/remielle.ts`：
  - 模块对象新增 `extraNecessaryAction`（count <= 0 返回 null；`moveId: cfg.remielleRainbowEndMoveId || undefined`；moveName 逐字为「普通攻击：垂虹（特殊虚耀载体）」）；
  - 新增 `buildAnomalyEvents`，原事件块逐字搬入；
  - 文件末尾新增导出 `remielleSpecialVoidflareUseCount(cfg)`，公式逐字保留。
- **事件顺序变化（拍板）**：原来特殊虚耀事件排在加农转子事件**之后**，迁进钩子后排到**之前**，因为钩子在函数开头派发。零差证明语料里没有任何影响（事件按 eventId 消费）。若日后发现顺序敏感，回退办法是在 rowBuild 末尾另派一个「后置事件」钩子。
- **验证**：
  - vue-tsc 0；零差（dump 625 / rowsnap 638，只有 `__ms` 不同）。
  - 反向（能力里的 count +1）：rowsnap DIFF 42 = 6 组 1581 预设 × 7 个变体，与 CC-21 波及面一致，还原后 cmp 一致。
  - `remielle.test` + `src/core` 共 251/251 通过；`npm run verify` EXIT=0。
  - 脚本：`/home/kaua/calc-arch/cc26.py`（先全部断言再统一写盘）、`z26.sh`。
- **回退点**：`git revert 8b7d9db`（单个提交，含棘轮常量 363/351）。

**rf3（HEAD `8b7d9db`，363 处 / 110 个字段）前列**：velinaCorrosionSource 9、liuyinSrc 8、xideIdx 8（crossAgentEnergy）、liuyinIdx 7、liuyinPromoteCount 7、velinaCinema2CorrosionRate 7、remielleSpecialVoidflareCount 6（anomalyPanels / helpers / useResourceCalc）、remielleEntryPanels 6、lighterTeamEnergy 5、liuyinMechanicSource 5。

**CC-26b 开工清单（蕾米埃尔「光辉回转」后台行 → 模块能力；lead 实读 HEAD `8b7d9db` 的 rowBuild.ts:405–434）**
1. 现状：`if (cfg.remielleEnabled && cfg.remielleRadiantTurnMoveId)` 用 `frontBlockSeconds(state.frontlineTime, countFrontActions(executions, { fusedMoveIds: [cfg.assistFollowUpMoveId] }), setting 'remielle.frontSwitchRatio', 5)` → `phaseDelayedCooldown` → `floor(effectiveBackstageTime / interval)` 算出次数，push 一行 category special、timeBucket backstage、totalTime 0 的后台行。
2. **关键约束**：次数依赖**构建到这一步为止**的 `executions`（前台动作计数）。所以**不能**挪到末尾的 `patchExecutions`（那时已多出闪避反击等后续行，计数会变），也不能挪到 `buildAnomalyEvents`。
3. 方案：
   - 新增能力 `backstageAutoRows?({ cfg, state, executions }): ResourceExecution[]`（名字可调）；
   - 在 rowBuild **原位置**派发 `getAgentMechanic(cfg.agentId)?.backstageAutoRows?.({ cfg, state, executions })`，结果 push 进 executions；
   - 计算逐字迁入 remielle.ts。remielle.ts 需要 import `@/core/effectiveTime` 的 `frontBlockSeconds / countFrontActions / phaseDelayedCooldown / effectiveBackstageTime / effectiveBattleTime`（mechanics → core 按值 import 是允许的，判据 19 只禁 `@/composables`）。
   - ⚠ 先 grep `backstageAutoFill`：它是已有的声明式字段，**名字相近但语义不同**，不要复用或混淆。
4. 验证：零差；反向为次数 +1，预期 DIFF 42（1581）。判据 22 预计约 −6（`cfg.remielleRadiantTurn*` / `remielleEnabled` 读点）。执行：lead 自做。
5. 之后的候选：remielleSpecialVoidflareCount 6 + remielleEntryPanels 6（composables 侧，先实读）；琉音一族（liuyinSrc / liuyinIdx / liuyinPromoteCount / liuyinMechanicSource，共约 27 处，横跨 damagePool / convergence / liuyinPromote，**需要设计稿**）；CC-27 维琳娜风蚀（§5.19）。

### 5.21 CC-26b 落地记录 + CC-28 开工清单（2026-09-27 第 35 轮 lead-arena-0925c）

**CC-26b（`0d65f59`，判据 22 363→357，target 351 不变）**：
- `mechanics/types.ts`：`AgentMechanicModule` 新增 `backstageAutoRows?(input: AgentResourceInput): SkillExecution[]`，入参复用 `patchExecutions` 的 `AgentResourceInput`。注释写明：`executions` 是「构建到派发点为止」的快照，模块只读；它与 `backstageAutoFill` 名字相近但语义无关。
- `core/resource/rowBuild.ts`：光辉回转整块（原 405–434）换成原位置派发 `getAgentMechanic(cfg.agentId)?.backstageAutoRows?.({ cfg, state, executions, teamFrontlineSeconds })`，返回的行 push 进 executions。effectiveTime 的 import 只剩 `effectiveBattleTime`（加农转子事件在用）。
- `mechanics/agents/remielle.ts`：新增导出 `remielleRadiantTurnRows({ cfg, state, executions })`，原块逐字搬入，只把 `executions.push` 改为 `rows.push`（`countFrontActions(executions, …)` 读的仍是构建器当前的数组）；模块对象挂 `backstageAutoRows: remielleRadiantTurnRows`；import `@/core/effectiveTime` 的 5 个函数（mechanics → core 按值 import 是允许的）。
- **验证**：
  - vue-tsc 0；零差（dump 625 / rowsnap 638，只有 `__ms` 不同）。
  - 反向（模块里 `radiantTurnCount` +1）：rowsnap DIFF 42 = 6 组 1581 预设 × 7 个变体，还原后 cmp 一致。
  - `remielle.test` + `src/core` 共 251/251 通过；`npm run verify` EXIT=0。
  - 脚本：`/home/kaua/calc-arch/cc26b.py`、`z26b.sh`。
- **本轮踩坑**：脚本用 `\bname\b` 在「删掉旧 import 行后的全文」里判断某个名字是否还有使用，结果**我新写的注释里提到了 `countFrontActions`**，被误判为仍在使用，vue-tsc 报 TS6133。修复是手动从 import 删掉。**以后判断 import 是否还在使用时，先剥掉注释再匹配**（例如 `re.sub(r'//.*|/\*[\s\S]*?\*/', '', s)`），或者直接以 vue-tsc 的结果为准。
- **回退点**：`git revert 0d65f59`（单个提交，含棘轮常量 357）。

**CC-28 开工清单（编排层角色分支 `remielleVoidflareEvents` → 模块能力；lead 实读 HEAD `0d65f59`）**
1. 现状：
   - `composables/useResourceCalc.ts:600` 起的 `remielleVoidflareEvents = computed<AnomalyEventRecord[]>` 用 `findSlotByIdentity(configStore, catalogStore, ['1581'])` 找槽；
   - 读 `anomalyPoolResult.value?.perSlotAnomalyTriggers`，把其他槽的异常触发合计为 `voidflareTotal`；
   - 读 `panelAt(panels.value, remielleSlot)` 的 `remielleCinema6LuminizeTriggerMultiplier`，并调用 `remielleSpecialVoidflareCount(remiellePanel)`；
   - 拼出 `id: 'remielle-voidflare-pool'` 等若干条 `AnomalyEventRecord`（含 label / formula / fields / note 文案）。
   - 在 `:765` 导出，唯一消费方是 `views/ResultPage.vue:834/1051`（`...remielleVoidflareEvents.value`）。
   - **这是 AGENTS.md 明令禁止的「在 useResourceCalc 加角色分支」**，优先级高于继续压判据 22。
2. 方案：
   - `AgentMechanicModule` 新增 `anomalyEventRecords?(input: { slot: number; panel: PanelValues; team: readonly (string | undefined)[]; perSlotAnomalyTriggers: readonly number[] }): AnomalyEventRecord[]`（字段按实读定稿，只给它真正要读的东西）。
   - remielle.ts 实现，把整段逐字搬入：先读完 `:600` 到 computed 结束的全部代码，确认它读了哪些量，`configStore.team[slot]?.agentId` 改用入参 `team`。
   - useResourceCalc 改为通用的 `moduleAnomalyEventRecords` computed：遍历 `configStore.team` 的槽位，对挂了能力的模块用 `panelAt(panels.value, slot)` 调用并拼接结果。导出名可以保留 `remielleVoidflareEvents` 作为别名，以免改 ResultPage；更好的做法是 ResultPage 改用新名，并同步它的解构。
   - `useResourceCalc.ts:86` 解构里的 `remielleSpecialVoidflareCount` 如果不再使用，就一并删除（**先剥注释再判断**，见上面的踩坑）。
3. 验证：
   - 这些事件记录**只进展示层，dump / rowsnap 很可能覆盖不到**，参见口径「展示字段的改动 dump 抓不到」。因此零差只能证明没有顺带改坏别的东西。
   - **必须补单测**：固定一个含 1581 的队伍（例如 rowsnap 语料 `auto-1581-1501-1561`），用 harness（参考 `convergenceNightB.test.ts` 的 `setupHarness`）断言新 computed 输出与迁移前**逐字段相等**。做法是迁移前先跑一次，把输出 JSON 固化成 expected 常量。
   - 反向验证：把能力里的 `voidflareTotal` +1，新单测应当变红。
4. 执行：lead 自做。完成后在 AGENTS.md 相关条目下不需要改规则，只在 census 里记录「useResourceCalc 角色分支 −1」。
5. 之后的候选：`remielleEntryPanels`（useResourceCalc:149 `computeRemielleEntryPanel` × 3 槽 → ctx → damagePoolAnomaly:327 的 `entryPanel`，可以做成模块能力 `entryPanel?`，并通用改名为 `entryPanels`）；琉音一族（需要设计稿）；CC-27 维琳娜风蚀（§5.19）。

### 5.22 CC-28 落地记录 + CC-29 开工清单（2026-09-27 第 36 轮 lead-arena-0925c）

**CC-28（`69e85c4`，判据 22 357→340，target 328；useResourceCalc 角色分支 −1）**：
- **先固化再迁移**：迁移前用临时测试在旧代码上采集了 4 种队伍的输出，存为 `/home/kaua/calc-arch/cc28-base.json`：
  - `r0` = [1581, 1501, 1561]，4 条记录；
  - `r2` = [1261, 1331, 1581]，4 条；
  - `lead-empty` = ['', 1501, 1581]，4 条；
  - `none` = [1261, 1331, 1501]，0 条。
  - 「特殊虚耀」那条在这些配置下 count=0，被 filter 掉。
  这份输出原样嵌入新单测 `src/composables/__tests__/moduleAnomalyEventRecords.test.ts` 作为 EXPECTED，逐字段 `toEqual`，另有 1 条负控断言 EXPECTED 不是空壳。临时采集测试已删除。
- `mechanics/types.ts`：`AgentMechanicModule` 新增 `anomalyEventRecords?(input: AgentAnomalyEventRecordsInput): AnomalyEventRecord[]`；文件末尾新增入参接口 `{ slot; panel; teamAgentIds; perSlotAnomalyTriggers }`；`AnomalyEventRecord` 加入 `@/types/resource` 的 type import。
- `mechanics/agents/remielle.ts`：新增导出 `remielleAnomalyEventRecords`，原 computed 的函数体逐字搬入（`remielleSlot` → `ownSlot`，`configStore.team[slot]?.agentId` → `teamAgentIds[slot]`，面板直接用入参）；模块对象挂 `anomalyEventRecords`。
- `composables/useResourceCalc.ts`：
  - 整段替换为 `moduleAnomalyEventRecords` computed：槽位 0→2，对挂了能力的模块用 `panelAt(panels.value, slot)` 派发，无面板就跳过，结果拼接；
  - 导出名改为 `moduleAnomalyEventRecords`；
  - 解构里不再使用的 `remielleSpecialVoidflareCount` 删除（先剥注释再判断）。
- `views/ResultPage.vue`：两处 `remielleVoidflareEvents` 改为 `moduleAnomalyEventRecords`。
- **验证**：
  - vue-tsc 0；新单测 5/5；dump 625 / rowsnap 638 零差（这些记录只进展示层，零差只证明没有顺带改坏别的东西）。
  - **单测反向**（模块里 `voidflareTotal` +1）：r0 / r2 / lead-empty 3 条变红，none 和负控仍然通过；还原后 cmp 一致。
  - `npm run verify` EXIT=0。
  - 脚本：`/home/kaua/calc-arch/cc28.py`、`z28.sh`。
- **回退点**：`git revert 69e85c4`（单个提交，含棘轮常量 340/328 和新单测）。

**CC-29 开工清单（简 6 命事件，同类编排层角色分支；lead 实读 HEAD `69e85c4`）**
1. 现状：`useResourceCalc.ts` 的 `anomalyDamageEvents` computed 末尾（约 `:657`）用 `findSlotByIdentity(configStore, catalogStore, ['1261'])` 找槽，条件是 `configStore.team[janeSlot]?.cinemaLevel >= 6` 且 `panelAt(panels.value, janeSlot)` 存在。它读 `anomalyPoolResult.value?.perElement` 里 physical 的 `triggerCount` 和面板的 `assaultCritRate`，满足 `critCount > 0` 时 push 一条 `id: 'jane-c6-assault-followup-event'`。这是 useResourceCalc 里**最后一处** `findSlotByIdentity` 调用，改完后该 import 可以删除。
2. 方案：复用 `anomalyEventRecords` 能力。入参接口加两个可选字段：`cinemaLevel: number`（派发侧取 `configStore.team[slot]?.cinemaLevel ?? 0`）和 `physicalTriggerCount: number`；或者更通用地传 `perElementTriggerCounts: Record<string, number>`（从 perElement 映射），**二选一，按「只给真正要读的」定**。jane.ts 实现，逻辑逐字搬迁。
3. **展示顺序（需要拍板，已拍）**：ResultPage 大致按「通用池事件 → `moduleAnomalyEventRecords` → `anomalyDamageEvents`」拼接（**开工时先实读 ResultPage 确认实际顺序**）。简的事件迁走后，会从 anomalyDamageEvents 末尾挪到它们**前面**。**决定：接受这个顺序变化**。依据：这是一张异常事件列表，没有依赖顺序的消费方（先 grep `anomalyDamageEvents` / `moduleAnomalyEventRecords` 在 ResultPage 里的用法确认，结果表是否另有排序）。回退方式：给能力返回值加 `placement: 'afterDamage'`，或者另加一个 `moduleAnomalyDamageEventRecords` computed。
4. 验证：同 CC-28，**先采集旧输出**。需要一支含 1261 的 6 命队伍，harness 能否设命座要先看 `src/test/harness.ts` 的 `HarnessTeamSlot`；如果不能，就在 setupHarness 之后改 `config.team[i].cinemaLevel = 6`。采集的是 `anomalyDamageEvents` 里 `id === 'jane-c6-assault-followup-event'` 的那条，以及 `moduleAnomalyEventRecords` 的全量。迁移后断言那条记录出现在 `moduleAnomalyEventRecords`、且逐字段相等，同时 `anomalyDamageEvents` 里不再有它。反向：`critCount` ×2，新单测应当变红。
5. 执行：lead 自做。完成后 useResourceCalc 就不再有 `findSlotByIdentity` 了，在 census 记一笔。
6. 之后的候选：`remielleEntryPanels`（§5.21 第 5 条）、琉音一族（需要设计稿）、CC-27 维琳娜风蚀（§5.19）。

### 5.23 CC-29 落地记录 + CC-30 开工清单（2026-09-27 第 37 轮 lead-arena-0925c）

**CC-29（`69b53f9`，判据 22 340→332，target 328 维持；useResourceCalc 角色分支清零）**：
- **先固化再迁移**：临时测试在旧代码采集 5 队输出 → `/home/kaua/calc-arch/cc29-base.json`：`j0c6`=[1261 c6,1331,1501] count 10、`j2c6`=[1501,1331,1261 c6] 10、`jempty`=['',1331,1261 c6] 13、`j0c5`=[1261 c5,…] 无事件、`jr`=[1261 c6,1331,1581] 11（+蕾米 4 条）。EXPECTED29 由此**机械变换**（事件从 anomalyDamageEvents 挪进 moduleAnomalyEventRecords，按槽位序拼；anomalyDamageEvents 的 id 序列 = 旧序列去掉它），嵌进 `src/composables/__tests__/moduleAnomalyEventRecords.test.ts` 第二个 describe（5 队 + 1 负控）。临时采集测试已删。
- `mechanics/types.ts`：`AgentAnomalyEventRecordsInput` 加 `cinemaLevel: number`、`perElementTriggerCounts: Readonly<Partial<Record<string, number>>>`（派发侧由 `anomalyPoolResult.perElement` 构造，同 element 取首条 = 原 `.find` 语义）。选「逐属性次数表」而非 `physicalTriggerCount` 单字段：通用、仍只给次数不给整池。
- `mechanics/agents/jane.ts`：新增导出 `janeAnomalyEventRecords`（逐字搬迁：`cinemaLevel < 6` → []；`critCount = physical × clamp(assaultCritRate,0,100)/100`；`critCount > 0` 才出），模块挂 `anomalyEventRecords`。
- `composables/useResourceCalc.ts`：派发补两个入参；删简分支；解构删 `findSlotByIdentity`（剥注释后 0 引用）。
- **拍板（已执行）：展示顺序变化**——简事件在 ResultPage（`:1051-1052` 拼 `moduleAnomalyEventRecords` 再 `anomalyDamageEvents`）从通用异常伤害事件之**后**移到之**前**。依据：全 src 无按该 id 或按顺序消费的代码（grep `jane-c6-assault-followup-event` 仅原处 1 处）；纯展示。**回退**：记录加 `placement: 'afterDamage'` 字段，ResultPage 分两段拼；或 revert。
- 语义细差（记账，不影响现有配队）：原实现只取**首个**简槽（findIndex），新实现每个简槽都派发；同队不可能重复同一角色，等价。原身份匹配含 `teammateBuffId === '1261'`，派发按 `getAgentMechanic(agentId)`，简的 agentId 即 1261，等价（单测 3 个槽位形态已证）。
- **验证**：vue-tsc 0；单测 11/11；dump 625 / rowsnap 638 仅 `__ms` 差；**反向**（jane `critCount × 2`）→ j0c6/j2c6/jempty/jr 4 条红、j0c5/CC-28 组/负控仍绿，还原 cmp 一致；`npm run verify` EXIT=0。脚本 `/home/kaua/calc-arch/cc29.py`、`z29.sh`。
- **回退点**：`git revert 69b53f9`（单提交，含棘轮常量 332）。
- **顺带普查**：`findSlotByIdentity` 按身份找槽仍在 `resourceCalc/roundInputs.ts:188`（1481 琉音）、`liuyinPromote.ts:163`（1481）、`convergence.ts:160`（1291 雨果）/`:358`（1481）、`anomalyPanels.ts:62`（1211 丽娜）——都在 composables/resourceCalc（编排辅助层，不是 useResourceCalc 本体，AGENTS 硬规则未直接覆盖），归入琉音一族设计稿 / 后续候选，**不单独开卡**。

**CC-30 开工清单（`remielleEntryPanels` 纯改名；lead 实读 HEAD `69b53f9`）**
1. 事实：`useResourceCalc.ts:149` `remielleEntryPanels` computed 对**全部 3 槽**调 `computeRemielleEntryPanel`（`resourceCalc/panelPhases.ts:702`，只吃自身被动/命座/音擎/驱动盘、不吃队友战内拐力的「进场快照面板」），**无角色判定**——只是名字带角色前缀（判据 22 计 6）。经 `DamagePoolContext.remielleEntryPanels`（`resourceCalc/damagePool.ts:70`）→ `damagePoolAnomaly.ts:77/327` → 模块入参 `entryPanel`（`mechanics/types.ts:1425` 注释）。
2. 做法：**只改字段/变量名** `remielleEntryPanels` → `entrySnapshotPanels`（useResourceCalc 变量 + ctx 字段 + damagePool 接口 + damagePoolAnomaly 解构 + types.ts/core/panel.ts 注释）；`computeRemielleEntryPanel` **本张不改**（它在 helpers 壳导出清单，`anomalyPanelsShell.test.ts`/`skillRowsShell.test.ts` 有名单断言，改名要连测试一起动 ⇒ 另开 CC-30b 或并入，先 rf3 看它是否计入判据 22 再定）。改前 `grep -rn remielleEntryPanels src scripts .zc` 列全引用，按词边界 sed。
3. 验证：tsc 0；dump/rowsnap 零差（纯改名应全等）；rf 读数预计 326（< target 328 ⇒ **必须同时重设 target**，否则 checkGuards.test 2 条红，建议 326−12=314）；verify。
4. 之后候选：琉音一族（xideIdx / liuyinIdx / liuyinSrc / liuyinPromoteCount，需设计稿）、velinaCorrosionSource / velinaCinema2CorrosionRate（CC-27，§5.19）。

### 5.24 CC-30 落地记录 + CC-31 开工清单（2026-09-27 第 38 轮 lead-arena-0925c）

**CC-30（`371a2c1`，判据 22 332→326，target 328→314）**：
- 按词边界 `sed 's/\bremielleEntryPanels\b/entrySnapshotPanels/g'`，改前 21 处 → 改后旧名 0、新名 21；`computeRemielleEntryPanel`（大写 R，词边界不命中）8 处**刻意保留**（helpers 壳名单 `panelPhasesShell.test.ts:38`、`remielle.test.ts` 直接 import；它不计入判据 22 读数，rf3 已核）。
- 改动文件：`src/core/panel.ts`（注释）、`src/mechanics/types.ts`（注释）、`src/composables/useResourceCalc.ts`、`resourceCalc/damagePool.ts`（ctx 字段）、`resourceCalc/damagePoolAnomaly.ts`、两份 `compactedSlotIndex.test.ts`、`scripts/lib/compacted-slot-index.mjs`（**`COMPACTED_ARRAYS` 名单**）、`scripts/check-guards.mjs`（判据 17 名称 + 棘轮常量）、`scripts/lib/core-role-field-ratchet.mjs`、AGENTS.md、docs/ARCHITECTURE.md、docs/ENGINE_PIPELINE_GUIDE.md、docs/MECHANICS_IMPLEMENTATION.md。历史 mcp-*.md 与 `.zc/lead-coordination.md` 保留旧名（历史记录，不改）。
- **已知坑（已处理）**：判据 17 按**数组名**匹配压缩数组下标访问；只改变量不改 `COMPACTED_ARRAYS` ⇒ 新名脱离守卫。已连名单 + fixture（`src/scripts/__tests__/compactedSlotIndex.test.ts` 的 `k` 行与期望）一起改，fixture 测试断言 `entrySnapshotPanels[remielleSlot]` 被拦 ⇒ 守卫有牙。
- **验证**：vue-tsc 0；`compactedSlotIndex` / `remielle.test` / `panelPhasesShell` 36/36；dump 625 / rowsnap 638 仅 `__ms` 差；check-guards 判据 17 ok（违规 0）；`npm run verify` EXIT=0（3570 passed）。脚本 `/home/kaua/calc-arch/z30.sh`。
- **回退点**：`git revert 371a2c1`（单提交）。

**CC-31 开工清单：轮间「模块下一轮反馈」具名字段 → 通用字典（lead 实读 HEAD `371a2c1`）**
1. **事实**：`src/composables/resourceCalc/roundThreads.ts` 的 `CalcRoundThreads` 有 14 个模块反馈具名字段：yixuanFuFaForJufufu、yeshuguangGiftUlt、lucyTeammateEx、lighterTeamEnergy、graceC1Cycles、anbyZeroTeammateWl、vivianTeamEx、vivianAnomalyTriggers、promiaTriggerHits、promiaTeammateReleases、promiaReleaseDecibel、aliceTeamAssaultCount、aliceDisorderCount、ellenFreezeCount（接口 `:27-78`、`initialCalcRoundThreads` 初值 0）。产出：`convergence.ts:927` `feedbackNext = collectNextRoundFeedback(...)`（`resourceCalc/panelPhases.ts:268`，各模块 `nextRoundFeedback` 的**按键名合并记录**），`convergence.ts:1110-1132` 再逐个 `feedbackNext.x ?? 0` 拆回具名字段。消费：各模块 `applyTeamConfig` 读 `threads.<字段>`（grep `threads\.<字段>` 命中 promia/grace/lucy/vivian/yeshuguang/ellen/anbyZero/lighter；**alice / yixuan 未命中该写法，开工先换解构/别名形态再 grep**）；`convergence.ts:128` 解构 `lighterTeamEnergy: prevLighterTeamEnergy`（converge 相位递给莱特模块，`:901` 附近）；`nextRoundFeedback` 的「首轮守卫」读 `prevThreads` 整份快照（`convergence.ts:122-125` 注释）。
2. **判据 22 份量**：rf3 这 14 个字段各计 4–5（convergence.ts + roundThreads.ts），合计约 55–60，是剩余 326 里最大的一簇。
3. **方案（已拍板）**：`CalcRoundThreads` 删 14 个字段，加 `moduleFeedback: Readonly<Record<string, number>>`；初值 `{}`；`threadsNext.moduleFeedback = { ...feedbackNext }`（先核 `collectNextRoundFeedback` 返回类型是否全为 number，否则过滤）；消费侧一律 `threads.moduleFeedback.<键> ?? 0`。**等价性论证**：原字段缺省 = 0，新字典缺键 + `?? 0` = 0；`threadsAfterNullRound` 原把这些重置为 0 → 新 `{}`，等价。**例外保留**：`teamUltimateForJufufu`（全队汇总、无角色判定，原注释论证）继续是具名字段，它从 `feedbackNext.yixuanFuFaForJufufu` 求和的写法不变。**键名类型安全**：各模块把自己的键写成模块内 `const` 并在 producer/consumer 共用（不在 core/resourceCalc 列角色键名），可选在 `mechanics/types.ts` 加 `ModuleFeedbackKey` 字面量联合（mechanics 层允许角色名）。
4. **拆两步提交（可逆）**：31a = 类型 + 产出 + 全部消费者一次改完（字段删掉后 tsc 会把漏改点全部报出来 = 天然清单）；31b = 注释/文档清理。
5. **验证**：这些字段直接影响数值 ⇒ dump 625 / rowsnap 638 **零差是强判据**（覆盖含露西/薇薇安/普罗米娅/爱丽丝/艾莲的预设，开工先用 `grep` 语料确认每个模块都有预设覆盖，缺的用单测补）；**反向**：随便挑一个消费者把 `?? 0` 后的值 +1，dump 必须出差；check-guards；`npm run verify`。预计 rf ≈ 326 − 55 ≈ 270 < target 314 ⇒ **必须同时重设 target**（checkGuards.test 2 条会红）。
6. 风险：`outerFeedbackSignature`（`resourceCalc/outerCycle.ts:10`）只读 `threadsNext.decibelParry` / `backstageAuto` 与 `aliceSwordWillSource.sparkCount`，**不读**这 14 个字段 ⇒ 收敛判据不受影响；测试里若有 `initialCalcRoundThreads()` 快照或手搓 threads 字面量（grep `__tests__` 里的 `lucyTeammateEx:` 等），要同步改。
7. 执行：lead 自做（跨 10+ 文件、需要 tsc 驱动，不适合 dsflash 工人）。之后候选：琉音一族（需设计稿）、CC-27 维琳娜风蚀（§5.19）、crossAgentEnergy.ts 的 `xideIdx` / `xideVanguardEnergy` / 各 `*UltEnergy`（另立普查）。

### 5.25 CC-31 落地记录 + CC-32 开工清单（2026-09-27 第 39 轮 lead-arena-0925c）

**CC-31（`0b8a28a`，判据 22 326→270，target 314→258）**：
- **新类型**：`src/mechanics/types.ts` 新增 `export interface ModuleFeedback`（14 个可选 number 键，逐键中文注释）；`nextRoundFeedback?()` 返回类型 `Partial<CalcRoundThreads> | void` → `ModuleFeedback | void`。键名住 mechanics 层（rf 扫描范围 = `src/core/*.ts`、`src/composables/resourceCalc/*.ts`、`useResourceCalc.ts`，**不含** mechanics/types.ts，见 `scripts/lib/core-role-field-ratchet.mjs:25`）。
- `resourceCalc/roundThreads.ts`：删 14 字段（接口 + 初值），加 `moduleFeedback: Readonly<ModuleFeedback>`（初值 `{}`；`threadsAfterNullRound` 经 `initialCalcRoundThreads()` 重置为 `{}` = 原全 0）。`teamUltimateForJufufu` **保留具名**（全队汇总，无角色判定）。
- `resourceCalc/convergence.ts`：`threadsNext` 删 14 行 `x: feedbackNext.x ?? 0`，改 `moduleFeedback: { ...feedbackNext }`；删解构 `lighterTeamEnergy: prevLighterTeamEnergy`，`:576` 通用输入 `teamEnergyConsumed` 改读 `threads.moduleFeedback.lighterTeamEnergy || 0`（rf 实测未再计数）。`resourceCalc/panelPhases.ts#collectNextRoundFeedback` 返回 `ModuleFeedback`。
- 10 个模块（promia/yixuan/grace/lucy/vivian/yeshuguang/ellen/anbyZero/alice/lighter）：读点 `(prev)threads(?).X(?? 0)` → `((prev)threads(?).moduleFeedback?.X ?? 0)`（正则批改，注释中的同形写法也随之更新）；返回类型改 `ModuleFeedback`，不再用的 `CalcRoundThreads` type import 换成 `ModuleFeedback`。**产出侧返回对象键名不变**。
- **口径（拍板）**：读侧一律 `?? 0`。**必要性**：露西/薇薇安/叶瞬光/零号安比是**裸赋值** `record.x = threads.x`、薇薇安/艾莲/普罗米娅是 `prevThreads.x <= 0` 首轮守卫——缺键不补 0 会写进 `undefined` / 守卫翻转（`undefined <= 0` 为 false）。用 `?.moduleFeedback?.` 而非 `.moduleFeedback.`：测试里有 `as never` / `as any` 手搓 threads，缺 `moduleFeedback` 时读 0 ⇒ 断言红（能暴露漏改），而不是 TypeError。
- 测试同步：`nextRoundFeedback(.R19/.R20).test.ts`、`teamHook.test.ts`、`axisContext.test.ts`——`{ ...initialCalcRoundThreads(), k: v }` → `{ ..., moduleFeedback: { k: v } }`；`x.threadsNext.k` → `(x.threadsNext.moduleFeedback.k ?? 0)`（缺席键原为 0、现为 undefined）；R19 `{ ...initialCalcRoundThreads(), ...next }` → `moduleFeedback: next`（第一次跑时漏了 ⇒ 格莉丝影画1 回能 [6,6] 读成 [0,0]，**正是 `?? 0` 口径让漏改变红**）。alice.test / ellen.test 里的同名字段是 **cfg 字段**，不属本次范围，未动。
- **验证**：vue-tsc 0；`src/mechanics/__tests__` + compactedSlotIndex 1247/1247；dump 625 / rowsnap 638 仅 `__ms` 差（这些字段直接进数值，零差是强判据）；**反向**（convergence `moduleFeedback: { ...feedbackNext }` → `{}`）dump **136 键出差**，还原 cmp 一致；`npm run verify` EXIT=0（3570 passed）。脚本 `/home/kaua/calc-arch/cc31.py`、`z31.sh`。
- **回退点**：`git revert 0b8a28a`（单提交）。
- **新增跨轮反馈的写法（替代 `roundThreads.ts` 头注释里「CalcRoundThreads 加一个字段」的旧说法——该注释未改，下一张顺手改）**：`ModuleFeedback` 加可选键 → 产出模块 `nextRoundFeedback` 返回它 → 消费模块读 `threads.moduleFeedback?.<键> ?? 0`；编排层零改动。
- **踩坑**：`sed 's#…#…#'` 的替换文本含 `#`（如 `types.ts#ModuleFeedback`）⇒ sed 整条报错、**不改任何东西**；改棘轮常量后必须 `grep -c` 核对（本轮就是靠 `grep -c` = 0 发现的），分隔符改用 `|`。

**CC-32 开工清单：`core/resource/crossAgentEnergy.ts` 席德正兵回能 → 模块能力（lead 实读 HEAD `0b8a28a`）**
1. **事实**：`src/core/resource/crossAgentEnergy.ts`（123 行）`calcCrossAgentEnergy(slotIndex, configs, states)`：
   - 丽娜/苍角/露西邻位终结回能**已**走能力 `crossAgentSupply.kind = 'neighbor-ult-energy'`（`./crossAgentSupply#neighborUltEnergyByProvider`，按 `byDisplayKey` 拆）；
   - 莱特影画4：读 `cfg.lighterC4BurstEnergy`（模块预写）→ `lighterC4Energy`；
   - **席德（1461）块 `:74-96`**：按字段 `xideVanguardSlot` 找席德槽（`xideIdx`，计 8），正兵槽 = 该字段；正兵得 `max(0, 席德 frontlineTime − comboAlignTime) × 2`；**算席德自己时副作用写** `xideCfg.xideVanguardEnergySpent = floor(正兵 exSpecialCount) × 正兵 exSpecialEnergyConsume`（core 里改 cfg，且依赖 iterate 的调用顺序）。
   - 返回 `CrossAgentEnergy`（`src/types/resource/energy.ts:18`）含 5 个角色具名展示字段 `rinaUltEnergy / soukakuUltEnergy / lucyEnergy / lighterC4Energy / xideVanguardEnergy`（`ResourceResultCard.vue` 逐条展示）。rf3 该文件合计 29（xideIdx 8、xideVanguardEnergy 5、其余各 4）。
2. **拆两张（先做 a）**：
   - **CC-32a**：席德块 → 模块能力。建议扩现有 `crossAgentSupply` 家族：新 kind（如 `'operator-damage-energy'`）或在席德模块实现 `perTargetAmounts()` 报「正兵槽得 X」，由 `neighborUltEnergyByProvider` 同款派发器按 `byDisplayKey.xideVanguardEnergy` 返回；`xideVanguardEnergySpent` 副作用**必须保持在同一调用时机**（算席德自己那槽时写），先实读 `crossAgentSupply.ts` 的接口与调用顺序再定是否把「写 spent」挪到席德模块的同一钩子里。
   - **CC-32b**：`CrossAgentEnergy` 5 个展示字段 → `byDisplayKey: Record<string, number>` + 显示名表（动 UI `ResourceResultCard.vue` 与类型，需 ui-check），判据 22 −~20；另立卡，先普查全部读点（grep `rinaUltEnergy` 等在 src/components、src/views、测试）。
3. **验证**：零差（含 1461 的预设先 grep 语料确认有覆盖；无则单测固化：席德 + 正兵的 `crossAgent.xideVanguardEnergy` 与席德 cfg 的 `xideVanguardEnergySpent`）；反向（×2 应出差）；check-guards；verify；rf 若低于 target 258 必须同时重设。
4. 其余候选（按判据 22 份量）：琉音一族 liuyinSrc/liuyinIdx/liuyinPromoteCount/liuyinMechanicSource/liuyinGift（≈32，需设计稿）；CC-27 维琳娜风蚀 velinaCorrosionSource/velinaCinema2CorrosionRate（16，§5.19）；`damagePoolDirect.ts` harumasaStunOnlyBonus / xixifuToxinInAxisFraction（各 5）。

### 5.26 CC-32a 落地记录 + CC-32b 开工清单（2026-09-27 第 40 轮 lead-arena-0925c）

**CC-32a（`0671c4c`，判据 22 270→254，target 258→242）**：
- `src/mechanics/types.ts#CrossAgentSupplySpec`：新增可选钩子 `onOwnSlotCrossAgentEnergy?({ ownSlot, cfg, configs, states }): void`——`calcCrossAgentEnergy` 算提供者**自己那槽**时调用，唯一允许的副作用 = 写自己的 cfg；`kind` 注释把 `'vanguard-energy'` 从「后续批次」移入已实现。
- `src/core/resource/crossAgentSupply.ts`：`neighborUltEnergyByProvider` 泛化为 `perTargetEnergyByProvider(configs, states, targetSlot, query, kind)`，原名保留为 `'neighbor-ult-energy'` 包装（调用方与测试不动）；新增 `runOwnSlotCrossAgentEnergyHooks(configs, states, slotIndex, kind)`。
- `src/core/resource/crossAgentEnergy.ts`：删席德内联块（按 `xideVanguardSlot` 字段找槽的 `xideIdx`、正兵回能、回写正兵耗能），改为两行派发；返回 `xideVanguardEnergy: vanguard.byDisplayKey.xideVanguardEnergy ?? 0`，`total` 改加 `vanguard.total`（只有席德提供时二者相等）。
- `src/mechanics/agents/xide.ts`：新增导出 `xideVanguardSupply`（`kind 'vanguard-energy'`、`displayKey 'xideVanguardEnergy'`、`supply: () => 0`、`perTargetAmounts` 与 `onOwnSlotCrossAgentEnergy` 逐字搬迁，`xideNum` = 原 `num`），模块挂 `crossAgentSupply`；description 同步。
- 等价性：原 `xideIdx` = 首个带 `xideVanguardSlot` 字段的 cfg；新 = 模块声明 `vanguard-energy` 的槽，且 `xideVanguardSlot === undefined` 时不供给不回写（= 原找不到分支）。同队不会有两个席德。原实现对 `vanguardSlot` 为 −1 时本来就不会命中落点，新实现显式 `< 0` 返回 `{}`，等价。
- 顺手（CC-31 遗留）：`resourceCalc/roundThreads.ts` 头注释补「模块下一轮反馈例外走 `moduleFeedback`」。
- **验证**：vue-tsc 0；`xide` / `teamHook` / `crossAgent` 单测 40/40（`xide.test.ts:314-330` 直测正兵 40 与回写 240，`teamHook.test.ts:100-113` 走全管线）；dump 625 / rowsnap 638 仅 `__ms` 差（语料含 `auto-1461-1521-1361` 5 变体）；**反向**（回能 ×2 → ×3）单测 1 红、dump **19 键出差**（全为 1461 队），还原 cmp 一致；`npm run verify` EXIT=0（3570 passed）。脚本 `/home/kaua/calc-arch/cc32a.py`、`z32.sh`。
- **回退点**：`git revert 0671c4c`（单提交）。

**CC-32b 开工清单：`CrossAgentEnergy` 角色具名展示字段 → 字典（lead 实读 HEAD `0671c4c`）**
1. **事实**：`src/types/resource/energy.ts:18` `CrossAgentEnergy` 有 5 个角色具名展示字段 `rinaUltEnergy / soukakuUltEnergy / lucyEnergy / lighterC4Energy / xideVanguardEnergy`（+ 通用 `supportUltimateRegen / teamUltimateFlash / total`）。读点（剥注释）：`core/resource/crossAgentEnergy.ts` 15、`components/ResourceResultCard.vue` 8（`:118-133`，**只展示 rina/soukaku/lucy/lighterC4 四行，席德正兵回能没有展示行**——数值已计入 total，但用户看不到明细，是现存 UI 缺口）、`mechanics/__tests__/teamHook.test.ts` 13、`xide.test.ts` 2、`nextRoundFeedback.test.ts` 2、模块 `displayKey` 声明 4（lucy/rina/soukaku/xide 各 1）。rf3：这 5 字段 + `lighterC4Raw` 在 crossAgentEnergy.ts 合计 **22**。
2. **方案（已拍板）**：`CrossAgentEnergy` 删 5 个具名字段，加 `bySource: Record<string, number>`（键 = 模块 `displayKey`；合并 neighbor 与 vanguard 两个派发的 `byDisplayKey`）。莱特影画4 这条目前读 `cfg.lighterC4BurstEnergy`（模块预写的 cfg 字段，计 `lighterC4Raw` 3 + `lighterC4Energy` 4）：**已实读并拍板（第 40 轮）**——莱特**没有**声明 `crossAgentSupply`；它在 `applyTeamConfig` 里给**每个队友**的 cfg 各写一份 `lighterC4BurstEnergy`（`lighter.ts:469/486/492`，「写给全队」模式，量已按落点算好）⇒ **不走** `crossAgentSupply`（套 `perTargetAmounts` 要重算一遍），改为**通用 cfg 字段** `crossAgentFlatEnergy`（任何模块预写「本槽额外获得的队友联动能量」）+ `crossAgentFlatEnergyKey`（展示键，莱特写 `'lighterC4Energy'`），引擎只读通用名、按键并入 `bySource`。回退：恢复 `lighterC4BurstEnergy` 读法（单点）。
3. **UI**：`ResourceResultCard.vue` 四段写死的 `v-if` 行 → `v-for` 遍历 `bySource`（`> 0` 才显示），显示名由表 `CROSS_AGENT_SOURCE_LABELS: Record<string, string>` 给（放 `src/components/` 或 `src/utils/`，**不放 core**）；现有四行的中文标签原样搬进表，并**新增席德一行**（标签按游戏内叫法写「席德·正兵回能」之类，先读模块注释措辞）。表里查不到的键兜底显示键名（防新增提供者漏配时静默消失）。
4. **验证**：dump/rowsnap 若序列化了 `energySource.crossAgent` 则会**因形状变化出差**——先查 `.zc/perf` 的 dump 取了哪些字段（grep `crossAgent`）；若出差只来自形状（值不变），需要在 cmp 前把旧基线做同样的形状映射或换基线（按规则 17② 单独一批，不与代码混提交）。UI 用 `node scripts/ui-check.mjs --step 'tab:资源利用率' --step 'click:计算'` 截图 + `eval` 读回结果卡明细行文本（含 1461 的队伍应多出席德那一行）。测试同步 teamHook/xide/nextRoundFeedback 里的 `crossAgent.<键>` → `crossAgent.bySource.<键> ?? 0`。
5. 预计判据 22 −~20（→ ~234 < target 242 ⇒ **同时重设 target**）。
6. 其余候选不变：琉音一族（≈32，需设计稿）、CC-27 维琳娜风蚀（16，§5.19）、`damagePoolDirect.ts` harumasaStunOnlyBonus / xixifuToxinInAxisFraction（各 5）。

### 5.27 CC-32b done：`CrossAgentEnergy` 角色具名展示字段 → `bySource` 字典（lead-arena-0925c，2026-09-27 第 41 轮）

**提交**：代码 `a276399`（10 文件，含两个棘轮脚本）。判据 22 **254 → 231**（−23 = 5 字段各计 + `lighterC4Raw` 3），`CORE_ROLE_FIELD_BASELINE` / `frozen` 231，**target 重设 219**（231 − 12）。

**改了什么**
- `src/types/resource/energy.ts`：`CrossAgentEnergy` 删 `rinaUltEnergy / soukakuUltEnergy / lucyEnergy / lighterC4Energy / xideVanguardEnergy`，**原位**加 `bySource: Record<string, number>`（字段序 `supportUltimateRegen, teamUltimateFlash, bySource, total`）。只收 > 0 的来源，缺键 = 0。
- `src/core/resource/crossAgentEnergy.ts`：`bySource` = neighbor 派发 `byDisplayKey` + cfg 定额联动能量 + vanguard 派发 `byDisplayKey`（同键累加）；`total` 公式与加法顺序不变（`flatEnergy` 在只有莱特时 ≡ 原 `lighterC4Energy`）。`emptyCrossAgentEnergy` → `bySource: {}`。core 里已无这 5 个名字与 `lighterC4BurstEnergy`（仅注释提及）。
- **莱特（与 §5.26 第 2 条的偏差，已拍板）**：§5.26 原定「`crossAgentFlatEnergy` 数值 + `crossAgentFlatEnergyKey` 键名」两个字段；实做改为**一个**通用字段 `crossAgentFlatEnergyBySource?: Record<string, number>`（`types/resource/config.ts`，替换 `lighterC4BurstEnergy`）。依据：两字段形态一个 cfg 只能容纳一个提供者，第二个提供者会互相覆盖；字典天然支持多提供者，且键就是展示键、引擎直接并入 `bySource`。`lighter.ts` 三处写入改为合并写 `{ ...旧值, lighterC4Energy: x }`（原写 0 处照写 0，保持字段存在与插入序）。
- `src/components/ResourceResultCard.vue`：4 段写死的 `v-if` 行 → `v-for="src in crossAgentSourceRows"`；表 `CROSS_AGENT_SOURCE_LABELS`（放在组件 script 里，UI 层，不进 core）按展示顺序列 5 项，原四行中文标签/说明逐字搬入，**新增「席德正兵回能」**（说明「额外能力：席德操作时间（前台 − 合轴）× 2/秒」，措辞取自 `xide.test.ts:319-325` 与 energy.ts 原注释）。表外键兜底显示键名。
- 测试：`teamHook.test.ts` 17 处、`xide.test.ts` 2 处、`nextRoundFeedback.test.ts` 1 处 `X.<键>` → `(X.bySource.<键> ?? 0)`（`it(` 标题字符串未改）。
- perf 工装（`.zc/` 已 gitignore，不进仓库）：`dump.perf.ts` / `rowsnap.perf.ts` 的 `remap` 加 `CROSS_SRC` 展开——`PERF_KEY_ALIAS=1` 时，带 `teamUltimateFlash` 的对象把 `bySource` 在原位展开为 5 个旧键（缺省 0）；cfg 的 `crossAgentFlatEnergyBySource` 映射回 `lighterC4BurstEnergy`（取 `lighterC4Energy ?? 0`）。**先用改前代码跑过**：dump 625 / rows 638 仅 `__ms` 差 ⇒ 工装改动本身零影响。

**验证**
- vue-tsc 0；`xide` / `teamHook` / `crossAgent` / `nextRoundFeedback` 单测 80/80。
- `PERF_KEY_ALIAS=1` 对 H2a：dump 625 / rowsnap 638 **仅 `__ms` 差**。
- **反向变异**（`addSource` 每项 +1）：单测 3 红，dump **91 键出差**（证明 remap 确实读 `bySource`，零差不是空跑）；还原 cmp 一致。
- UI 实机：`npm run build` 后起 `dist` 静态服务，`node scripts/ui-check.mjs --step 'tab:队伍配置' --step "eval:<经 pinia 调 config.setAgent(0,'1521'); setAgent(1,'1461'); setAgent(2,'1361')>" --step 'tab:资源池' --step 'sleep:8000' --step "eval:<读 .breakdown-row 文本>"` → **PASS**（零 JS 错误、动作全部命中）。读回：正兵（希希芙 1521）卡出现「席德正兵回能 238.01 额外能力：席德操作时间（前台 − 合轴）× 2/秒」这一行（此前 UI 没有这一行）。脚本 `/home/kaua/calc-arch/ui32b.sh`，截图 `/home/kaua/calc-arch/ui32b/ui-check-full.png`。**坑**：「选择预设队伍」下拉只列手工预设，auto-* 预设不在里面，而且 `type:` 过滤后选项为空 ⇒ 要配指定队伍，请用 eval 经 `__vue_app__.config.globalProperties.$pinia._s.get('config').setAgent(slot, id)` 直设。
- `npm run verify` EXIT=0（见 `/home/kaua/calc-arch/verify32b.log`）。脚本 `/home/kaua/calc-arch/cc32b.py`、`perf32b.py`、`z32b.sh`、`z32b0.sh`。
- **回退点**：`git revert a276399`（单提交；perf 工装的展开段在无 `bySource` 时不触发，可留）。

**下一步（可直接开工）**
1. **CC-33 候选（小卡，建议先做）**：`src/core/resource/damagePoolDirect.ts`（或其现址，先 `grep -rn 'harumasaStunOnlyBonus\|xixifuToxinInAxisFraction' src`）的 `harumasaStunOnlyBonus` / `xixifuToxinInAxisFraction` 各 5 计。开工先实读写入点（哪个模块预写、core 怎么读），套用本卡「通用 cfg 字段 + 模块预写」或既有 `directRowBonus` / `extraDirectRows` 能力，择一；零差用同一 `PERF_KEY_ALIAS` 口径，若只改名需在 remap 加映射。
2. 琉音一族（≈32，需先写设计稿）、CC-27 维琳娜风蚀（16，§5.19 先设计）不变。
3. **已知坑**：`bySource` 只含 > 0 项，测试/调用方读它必须 `?? 0`；新增联动回能提供者要同时在 `CROSS_AGENT_SOURCE_LABELS` 补中文标签（漏了会显示英文键名，不会消失）；多个模块写 `crossAgentFlatEnergyBySource` 必须合并写。

### 5.28 CC-33 done：悠真 `harumasaStunOnly` → 通用行级字段；希希芙蚀骨轴内占比 → 模块能力 `directRowAxisSplit`（lead-arena-0925c，2026-09-27 第 42 轮）

**提交**：代码 `e882b9f`（11 文件，含新测试与两个棘轮脚本）。判据 22 **231 → 219**，`CORE_ROLE_FIELD_BASELINE` / `frozen` 219，**target 重设 207**。

**CC-33a 悠真（纯改名 + 补类型）**
- `src/types/resource/execution.ts`：`SkillExecution` 新增显式字段 `stunOnlyDmgBonus?: number`（仅失衡段生效的增伤%，原来是无类型的 `harumasaStunOnly`，靠 `as any` 读写）。
- `harumasa.ts` 写入改为 `exec.stunOnlyDmgBonus = …`；`damagePoolDirect.ts` 读取去掉 `as any`，局部变量 `harumasaStunOnlyBonus` 改为 `stunOnlyDmgBonus`（5 处）；note 文案「失衡增伤+x%（轴内直加）」不变。`harumasa.test.ts` 3 处断言、`specs/agents/1201.json` notes 1 处同步。
- perf 工装 `KEY_ALIAS` 加 `stunOnlyDmgBonus: 'harumasaStunOnly'`（`.zc/` 不进仓库）。
- **覆盖盲区（已查实，这是原本就存在的问题，不是本卡引入的）**：悠真只在**轴模式**写这个字段，而 dump/rowsnap 语料没有走到悠真轴模式路径——反向变异（`stunOverride > 0` 改 `>= 0`）让 rows 出差 **0** 个 1201 键。本卡的等价性依据是：写入方和读取方现在都经同一个类型声明访问，任何一侧拼错 tsc 都会报错；harumasa.test 3 条断言守住写入侧。**读取侧缺单测，已立 W31**（`docs/mcp-worker-task-queue.md` §2）。

**CC-33b 希希芙（新模块能力）**
- `src/mechanics/types.ts`：新增 `DirectRowAxisSplitInput { exec, slot, charResult, axisInUnits(moveId) }`、`DirectRowAxisSplit { inFraction, inNote, outNote }`，以及模块钩子 `directRowAxisSplit?(input)`。
- `damagePoolDirect.ts`：原来的「希希芙蚀骨专属分支」（按 moveId `1521019` / `xixifu_shigu_special` 判断）改为询问行所属模块的 `directRowAxisSplit`，**分支位置不变**（在赠链、CD 自动行之后，伴随事件之前）；占比仍夹到 [0,1]，`Math.round` 取整方式不变。`CharRowsEnv.xixifuToxinInAxisFraction` 删掉。编排层只传 `axisInUnits = moveId => allocMap[`${slot}:${moveId}`]?.inAxisUnits ?? 0`，不再把 allocMap 整体暴露给模块。
- `damagePool.ts`：删掉 `xixifuToxinInAxisFraction` 闭包（26 行），算式**逐字**搬进 `xixifu.ts`（`xixifuToxinInAxisFraction` + `xixifuDirectRowAxisSplit`，`XIXIFU_SHIGU_MOVE_IDS`）。
- 新测试 `src/mechanics/__tests__/xixifuAxisSplit.test.ts`（3 条）：经 `getAgentMechanic('1521')` 取模块（顺带证明注册表 / spec 合并没丢掉这个能力），覆盖非蚀骨行不认领、手算 0.5、无毒素时为 0。

**验证**
- vue-tsc 0；`harumasa` / `xixifu` / `damagePool` 单测 124/124；`get_diagnostics` 0。
- `PERF_KEY_ALIAS=1` 对 H2a：dump 625 / rowsnap 638 **仅 `__ms` 差**。
- 反向变异（希希芙占比 ×0.5 + 悠真 `>= 0`）：新测试 1 红（0.25 ≠ 0.5）；rows 出差 16 键，**全是 1521 队**（4 队 × 4 变体），1201 为 0（即上面说的盲区）。还原后 cmp 一致。
- `npm run verify` EXIT=0（`/home/kaua/calc-arch/verify33.log`）。脚本 `/home/kaua/calc-arch/cc33.py`、`perf33.py`、`z33.sh`。
- **回退点**：`git revert e882b9f`（单提交；perf 工装的别名在代码里没有新名字时不会触发，可以留着）。

**下一步（可直接开工）**
1. **W31**（派低级模型）：给悠真轴模式补一条伤害池消费端测试，卡面在任务队列 §2。
2. **判据 22 剩余 219**：开工前先跑 `node /home/kaua/calc-arch/rf3.mjs`，按字段统计再挑。已知大头：琉音一族约 32（`liuyin*`，**需先写设计稿**，参见 `docs/mcp-liuyin-promote-source.md` 的单源化教训：W21 / W26 都卡在「多读数不同源」上）、CC-27 维琳娜风蚀 16（§5.19，先设计）。建议下一轮先跑 rf3，找还剩哪些 ≤10 计的小块（这种纯改名或「模块预写通用字段」模式一轮就能做完），把琉音留给写好设计稿之后。
3. **已知坑**：`directRowAxisSplit` 只在 `isAxis && axisSlots.has(slot)` 时询问；非轴模式下蚀骨行照旧走通用路径（与原来一致）。新增实现方时注意分支顺序：赠链、CD 自动行优先。
4. **rf3 快照（e882b9f 之后实跑，共 219 计 / 77 个字段）与下一张卡的拍板**：
   - 按簇合计：**remielle\* 63**（`core/buff.ts`、`core/panel.ts`、`resourceCalc/helpers.ts`、`anomalyPanels.ts`、`substatOptimizer.ts`；多为 `remielleCinema*` / `remielleRefringeCoefficient*` / `remielleFlowerFeatherDance*` 这类面板、buff 数值字段，每个 3–5 计）；**liuyin\* 35**（`liuyinSrc` 8、`liuyinIdx` 7、`liuyinPromoteCount` 7、`liuyinMechanicSource` 5、`liuyinGift` 5 …）；velina 19（`velinaCorrosionSource` 9、`velinaCinema2CorrosionRate` 7、`velinaCorrosion` 3）；norma 约 14（`normaHatChain.ts` / helpers）；alice 约 11（convergence / roundInputs / anomalyPool）；hugo 约 7（convergence）；零散：`lighterSource` 5（panelPhases）、`rinaSlot` 4（anomalyPanels）、`janeAssaultCritDmgBonus` 3、`yeshuguangStunCapMult` 2。
   - **拍板：CC-34 = 蕾米埃尔字段普查 + 方案（只读，产出 §5.29，然后按方案拆 CC-34a/b… 实做）**。依据：占剩余的 29%，是最大的一簇；这些字段看上去是「模块往 core 面板 / buff 结构里写的具名数值」，很可能可以套 CC-14a `bonusEntries` / CC-31 `moduleFeedback` 那种「通用字典 + 模块自报键」的先例，但**必须先实读** `core/buff.ts` 与 `core/panel.ts` 里这些字段的定义与读点，再决定是一个字典还是按用途拆几块。琉音（35）继续等设计稿；零散小块可以在两张大卡之间顺手清。
   - 普查命令：`grep -rnoE '\bremielle[A-Z][A-Za-z0-9]*\b' src/core src/composables --include=*.ts | grep -v __tests__ | awk -F: '{print $1" "$3}' | sort | uniq -c`，再按写入方（`src/mechanics/agents/remielle*.ts`）反查。

### 5.29 CC-34 蕾米埃尔普查 + CC-34a done：角色专属面板属性改由数据表驱动（lead-arena-0925c，2026-09-27 第 43 轮）

**提交**：代码 `7de5847`（6 文件，含新文件 `src/data/agentPanelStats.ts` 与两个棘轮脚本）。判据 22 **219 → 171**（−48），`CORE_ROLE_FIELD_BASELINE` / `frozen` 171，**target 重设 159**。

**普查结论（HEAD 840dbf6 实读）**：core + resourceCalc 里 remielle\* 共 63 计，分四簇：
- **A 面板属性（44 计，本卡已清）**：`PanelValues`（`types/catalog.ts`）上 14 个 `remielle*` 字段（折射系数 / 耀变倍率 / 影画 1·4·6 虚耀 / 花羽轮舞 …）。它们同时是 buff 数据（`public/static/catalog.json`、`teammate-buffs.json`）里的 stat 键。core 里只在两处出现：`core/buff.ts#applyStat` 有 14 个 `case 'x': panel.x += value`，`core/panel.ts#emptyPanel` 给 14 个初值（3 个 TriggerMultiplier 为 1，其余为 0）。读取方全在 core 之外（`remielle.ts` 25 处、`StatPanel.vue` 8、`DebugPage.vue` 6、`statMeta.ts` 4、`anomalyPanels.ts` / `helpers.ts` 各 2）。
- **B 字符配置字段（约 20 计）**：`resourceCalc/helpers.ts:497-561` 调 `findRemielleRainbowEnd` / `findRemielleRadiantTurn`，往 cfg 字面量写 7 个字段 `remielleRainbowEnd{MoveId,ActionTime,DecibelRecovery,ComboAlignRatio}`、`remielleRadiantTurn{MoveId,ActionTime,DecibelRecovery}`。
- **C 面板读点（约 5 计）**：`helpers.ts:627` `extraSelfDecibelReward = FlowerFeatherDanceDecibelPerUse × FlowerFeatherDanceCount`；`helpers.ts:822` 读 `remielleRadiantTurnDazeBonusPct`。
- **D re-export 壳（约 6 计）**：`helpers.ts:272/291` 与 `anomalyPanels.ts:384-386` 转导出 `remielleSpecialVoidflareCount` 等（函数本体在 CC-19c-1 已迁到 `remielle.ts`）。

**CC-34a 做了什么（等价性论证）**
- **关键事实**：`applyStat` 的 `default:` 分支本来就是 `if (!(stat in panel)) panel[stat] = 0; panel[stat] += value`。而这 14 个键在 `emptyPanel()` 里都有初值，所以 14 个逐字段 case 与 default **逐字等价** ⇒ 直接删掉，default 分支前补注释。
- `core/panel.ts`：两段初值改为 `...agentPanelStatInitials('stun')`（原叶瞬光 `yeshuguangStunCapMult` / `yeshuguangVeilStunBase` 的位置）和 `...agentPanelStatInitials('anomaly')`（原 remielle 14 项的位置）。对象展开**保持键序**（面板键序进入快照哈希）。
- 新文件 `src/data/agentPanelStats.ts`：表 `AGENT_PANEL_STATS`（16 行，`key` / `group` / `initial`，`as const satisfies`，键被约束为 `keyof PanelValues`），`agentPanelStatInitials(group)` 按表序铺初值。**为什么放数据层、不放 mechanics**：core 禁止值导入 `@/mechanics/agents/*`（判据冻结 0），而 mechanics 各模块又依赖 `core/panel` ⇒ 让 core 去问模块注册表有循环依赖风险。这些键本来就是 StatId（buff JSON 按键引用），与 `utils/statMeta.ts` 同属数据层。
- **面板形状不动**：没有把字段收进字典。依据：`composables/cinemaUplift.ts:247` 用 `Object.keys(panelAfter)` 按数值比较算 `changedFields`（R1 验收口径「changedFields 不要退化」），嵌套字典会让这些字段的变化被静默吞掉；另外 StatPanel / DebugPage / remielle.ts 都按扁平字段读。
- 顺手：`core/substatOptimizer.ts#computeAtkTeamBenefit` 的参数 `remielleATK` 改名为 `sourceATK`（纯局部改名）。
- `PanelValues` 的类型声明仍在 `types/catalog.ts`（不在判据 22 的统计范围内，读取方靠它获得类型）。

**验证**
- vue-tsc 0；`remielle` / `panel` / `buff` / `yeshuguang` / `cinemaUplift` / `substat` 单测全绿（168 + 76）。
- `PERF_KEY_ALIAS=1` 对 H2a：dump 625 / rowsnap 638 **仅 `__ms` 差**，不需要 remap。
- **反向变异**（表内 `remielleCinema6LuminizeTriggerMultiplier` 初值 1 改 2）：remielle 单测 1 红，dump **37 键出差**（`auto-*-1581` 队），证明表确实驱动初值；还原后 cmp 一致。
- `npm run verify` EXIT=0（`/home/kaua/calc-arch/verify34.log`）。脚本 `/home/kaua/calc-arch/cc34.py`、`z34.sh`。
- **回退点**：`git revert 7de5847`（单提交）。
- **踩坑**：泛型返回值 `return out as Record<Extract<…>['key'], number>` 报 TS2719（同名不相关类型），改为 `return out as never`，精确键集仍由函数签名保证。

**下一步（按顺序，可直接开工）**
1. **CC-34b（B 簇，约 20 计）**：把 `helpers.ts:497-561` 的两个 `findRemielle*` 调用和 7 个 cfg 字段整块迁进 `remielle.ts#buildRemielleCharConfig`（该函数已经在写 `remielleEnabled` / `remielleRadiantTurnDazeBonusPct`，先例见 `helpers.ts:471-477` 的注释）。
   - 开工先 `grep -rn 'remielleRainbowEnd\|remielleRadiantTurn' src` 列出全部读点。`rowBuild.ts:225` 注释说补行已经走 `extraNecessaryAction`，要确认 cfg 字段是否仍被读。
   - **风险**：cfg 键会从字面量中间挪到 `buildCharConfig` 写入的位置，键序可能变化。如果 dump 因此出差，并且只是键序差：按规则 17② 在 perf remap 里做键序映射，或者单独一批换基线，**不与代码混提交**。
2. **CC-34c（C 簇，约 5 计）**：`helpers.ts:627` 花羽轮舞喧响 → 先查有没有现成的「自身额外喧响」模块能力（CC-14b `selfBurnDecibel`、`bonusDecibel` 一类），没有再设计；`helpers.ts:822` 失衡加成读点同理。
3. **CC-34d（D 簇，约 6 计）**：re-export 壳。`grep -rn "remielleSpecialVoidflareCount\|getRemielleLevelValue\|calcVoidflareDamage" src` 找出经壳导入的调用方，改为直接从 `@/mechanics/agents/remielle` 导入（注意判据 19：mechanics/specs 不许值导入 composables，反方向没有限制），然后删壳。
4. 其余：简 `janeAssaultCritDmgBonus`（`core/damage.ts`、`anomalyPool/helpers.ts` 读，`panel.ts:68` 初值，该行缩进异常）可以另开一组 `'assault'` 并入 `agentPanelStats` 表，但 core 读点仍在，需要单独设计；琉音（35）等设计稿；维琳娜 19（§5.19）。

### 5.30 CC-34b done：蕾米埃尔 cfg 7 字段与两个招式查找函数迁入 remielle.ts（lead-arena-0925c，2026-09-27 第 44 轮）

**提交**：代码 `db01cb6`（7 文件：5 个 src 加两个棘轮脚本）。判据 22 **171 → 155**（−16），`CORE_ROLE_FIELD_BASELINE` / `frozen` 155，**target 重设 143**。

**做了什么**
- `core/resource/moveLookup.ts`：`findRemielleRainbowEnd` / `findRemielleRadiantTurn` 两个函数**逐字**迁往 `mechanics/agents/remielle.ts`（插在 `buildRemielleCharConfig` 之前）。它们依赖的通用函数 `channelMetricsOf` 改为 `export`。moveLookup 只依赖类型层和数据层，mechanics 值导入它不会形成循环依赖。
- `core/resource.ts`：删除 `findRemielle*` 的转导出。
- `resourceCalc/helpers.ts`：删除两个查找函数的 import 和调用；cfg 字面量里 7 个字段 `remielleRainbowEnd{MoveId,ActionTime,DecibelRecovery,ComboAlignRatio}`、`remielleRadiantTurn{MoveId,ActionTime,DecibelRecovery}` 删除，原位置留 3 行注释指向 remielle.ts。
- `remielle.ts#buildRemielleCharConfig`：从输入里解构 `skills`，调用两个查找函数写入这 7 个字段。`extraNecessaryAction` 的 3 个读点补 `?? 0`（字段在类型上已改为可选）。
- `types/resource/config.ts`：RainbowEnd 的 4 个字段改为可选并加注释（RadiantTurn 原本就是可选）。
- **行为差异（有意为之）**：非蕾米埃尔槽的 cfg 上不再带这 7 个字段（此前是 `undefined` / 0 值占位）。所有读点都在 remielle.ts 里，并且只在蕾米埃尔槽触发。

**验证**
- vue-tsc 0；相关单测 74/74 通过。
- `PERF_KEY_ALIAS=1` 对 H2a：dump / rowsnap **仅 `__ms` 差**。结论：cfg 不进快照哈希，§5.29 担心的键序风险不存在，不需要 remap 或换基线。
- **反向变异**（两个 actionTime ×2）：dump **37 键出差**，证明迁移后的写入点确实驱动结果；已从 `calc-arch/rm34c.bak` 还原，cmp 一致。
- `npm run verify` EXIT=0（3573 passed / 29 skipped，`/home/kaua/calc-arch/verify34c.log`）。脚本：`/home/kaua/calc-arch/cc34b.py`、`z34c.sh`。
- **回退点**：`git revert db01cb6`（单提交）。

**CC-34c / CC-34d 预调研（HEAD db01cb6，只读）**
- **C 簇 ①** `helpers.ts` 约 616 行：`extraSelfDecibelReward` 初值为 `panel.remielleFlowerFeatherDanceDecibelPerUse × panel.remielleFlowerFeatherDanceCount`。catalog 里 `remielle_c1_flower_feather_dance_decibel_per_use` 的 target 是 self（值 200），`teammate-buffs.json` 中没有 ⇒ 只在蕾米埃尔本人面板上非 0。迁移方法：字面量改为 0，在 `buildRemielleCharConfig` 里写 `cfg.extraSelfDecibelReward = Number(cfg.extraSelfDecibelReward ?? 0) + 乘积`（orphie、specPanelBuffs、yixuan 已经用 `+=` 写这个通道，先例成立）。**要先确认** buildCharConfig 里模块钩子在字面量**之后**执行，且之后没有别处覆盖这个字段。
- **C 簇 ②** `helpers.ts` 约 811 行：`foundMove.id === '1581010'` 时读 `panel.remielleRadiantTurnDazeBonusPct`。改法是换成通用的执行级失衡加成字段，由 remielle 的 Radiant Turn 行写入；前提是查清 1581010 这个执行的全部产出方。**暂缓**，单独开卡。
- **D 簇（re-export 壳）**：`helpers.ts` 从 `./anomalyPanels` 导入并导出 `getRemielleLevelValue` / `remielleSpecialVoidflareCount` / `calcVoidflareDamage`；`anomalyPanels.ts` 约 384-386 行从 `@/mechanics/agents/remielle` 导入并转导出。唯一经壳导入的调用方是 `mechanics/__tests__/remielle.test.ts:4`（测试不受判据 19 限制，但直接改为从 remielle 导入更干净）。**`composables/resourceCalc/__tests__/anomalyPanelsShell.test.ts` 的 `D_EXPORTS` 列了这 3 个名字**（刀 C 的壳契约测试，锁定「迁移不改变 API」），删壳时要同步把清单从 11 改为 8，并在注释里写明是 CC-34d 有意收窄。类型 `VoidflareDamageInput` 没有角色前缀，不计入判据 22，保留在壳里。

**下一步（按顺序，可直接开工）**
1. **CC-34c①+34d 合为一卡**（约 6 计，预计 155 → 约 149）：按上面的方法改 `helpers.ts`（extraSelfDecibelReward）、`remielle.ts`、`anomalyPanels.ts`、`remielle.test.ts`、`anomalyPanelsShell.test.ts`。验收：dump / rows 零差；反向变异（把 remielle 里的乘积 ×2）后 dump 应出差。
2. CC-34c②：失衡加成读点，另开卡，先普查 1581010 的产出方。
3. 其余字段簇：简 `janeAssaultCritDmgBonus` 需要单独设计；琉音 35（先写设计稿）、维琳娜 19（§5.19 / CC-27）、诺玛约 14、爱丽丝约 11、雨果约 7，另有零散的 lighterSource 5、rinaSlot 4。

### 5.31 CC-34c①+34d done：花羽轮舞喧响读点迁模块 + 删蕾米埃尔 re-export 壳（lead-arena-0925c，2026-09-27 第 44 轮）

**提交**：代码 `372bbed`（7 文件：5 个 src/测试加两个棘轮脚本）。判据 22 **155 → 149**（−6），`CORE_ROLE_FIELD_BASELINE` / `frozen` 149，**target 仍为 143**（未达成，不重设）。

**做了什么**
- `resourceCalc/helpers.ts`：cfg 字面量 `extraSelfDecibelReward` 由 `DecibelPerUse × Count` 改为 `0`（加注释说明它是跨角色 `+=` 通道）；删除 `getRemielleLevelValue` / `remielleSpecialVoidflareCount` / `calcVoidflareDamage` 在 import 与 export 两处的壳。
- `remielle.ts#buildRemielleCharConfig`：解构出只读 `panel`，写 `cfg.extraSelfDecibelReward = Number(cfg.extraSelfDecibelReward ?? 0) + DecibelPerUse × Count`。已确认 `buildCharConfig` 里模块钩子在字面量**之后**执行，其余写入方（orphie / specPanelBuffs / yixuan / promia）全是 `+=` 累加、没有覆盖写，数值都是整数，先后顺序不影响结果 ⇒ 蕾米埃尔槽 `0 + a×b + …` 与原先的 `a×b + …` 逐位相同。
- `anomalyPanels.ts`：删除 3 个运行时函数的 import+export 壳，头注释 ⑤ 同步；类型 `VoidflareDamageInput` 不带角色前缀，壳保留。
- `mechanics/__tests__/remielle.test.ts`：两个函数改为直接从 `@/mechanics/agents/remielle` 导入；新增 describe「CC-34c」两条用例（直接调钩子：100 + 200×3 = 700；非蕾米埃尔槽不写）。
- `anomalyPanelsShell.test.ts`：`D_EXPORTS` 从 11 个收窄到 8 个（注释写明是 CC-34d 有意为之），新增用例 ①ter 反锁这 3 个名字不得再经 helpers / anomalyPanels 导出。

**验证**
- vue-tsc 0；remielle / anomalyPanelsShell / helpers / orphie / yixuan 单测 95/95 通过。
- `PERF_KEY_ALIAS=1` 对 H2a：dump / rowsnap **仅 `__ms` 差**。
- **反向变异（乘积 ×2）**：dump **零差**，是空验证，原因见下面的未决项；于是补了钩子单测，同一变异下单测红 1 条（expected 1300 to be 700），还原后绿。脚本：`/home/kaua/calc-arch/cc34c.py`、`cc34c2.py`、`z34d.sh`、`z34e.sh`。
- `npm run verify` EXIT=0（`/home/kaua/calc-arch/verify34d.log`）。
- **回退点**：`git revert 372bbed`（单提交）。

**未决（已知坑，可派低级模型调研）**
- **`remielleFlowerFeatherDanceCount` 全仓没有任何写入方**：catalog 只有 `remielle_c1_flower_feather_dance_decibel_per_use`（值 200，target self），没有给次数的 buff，ts 代码里也没人写它 ⇒ 线上乘积恒为 0，一命「花羽轮舞」的额外喧响从未生效。这可能是一命机制漏了实现，也可能是有意留的占位。**本卡不改行为**（纯迁移）。要做的话：先按原文（`docs` 里的蕾米埃尔账本 / catalog 原文描述）确认花羽轮舞的触发条件与次数口径，再在 `remielle.ts#applyRemiellePanel` 或 `buildRemielleCharConfig` 里给出次数，并在 dump 基线上单独说明差异。

**下一步（按顺序，可直接开工）**
1. **CC-34c②**（蕾米埃尔最后一块 core/resourceCalc 读点）：`helpers.ts` 约 811 行 `foundMove.id === '1581010'` 时乘 `panel.remielleRadiantTurnDazeBonusPct`。开工先 `grep -rn "1581010\|remielleRadiantTurnDazeBonusPct\|radiantTurnDazeMult" src` 列出全部产出方与读点，再设计成通用的执行级失衡加成字段，由 `remielleRadiantTurnRows` 写入。验收：dump / rows 零差 + 反向变异 dump 出差（这条有 perf 覆盖的可能性较大，反向变异时再确认）。
2. 花羽轮舞次数（上面的未决项）：调研型，可派 dsflash，结论写回本节。
3. 其余字段簇：简 `janeAssaultCritDmgBonus` 单独设计；琉音 35（先写设计稿）、维琳娜 19（§5.19 / CC-27）、诺玛约 14、爱丽丝约 11、雨果约 7，另有零散的 lighterSource 5、rinaSlot 4。开工前先用 `node /home/kaua/calc-arch/rf3.mjs` 按字段重新计数。

### 5.32 CC-34c② done：Radiant Turn 失衡乘区改由模块能力 `skillDazeMultiplier` 提供（lead-arena-0925c，2026-09-27 第 45 轮）

**提交**：代码 `99b945a`（6 文件：helpers.ts / mechanics/types.ts / remielle.ts / remielle.test.ts 加两个棘轮脚本）。判据 22 **149 → 148**，`CORE_ROLE_FIELD_BASELINE` / `frozen` 148，**target 仍为 143**。

**做了什么**
- 新增模块能力 `skillDazeMultiplier?({ moveId, panel }): number`（`mechanics/types.ts`，紧接 `patchExecutions` 声明）：招式级失衡**独立乘区**，缺省 1。`helpers.ts#extractSkillExecutions` 的非普攻分支用函数开头已有的 `mechanic = getAgentMechanic(agentId)` 派发，`baseDaze = 表值 × dazeCoef × skillDazeMult`。
- 删除 helpers 里 `foundMove.id === '1581010' ? 1 + panel.remielleRadiantTurnDazeBonusPct/100 : 1` 的内联分支；`remielle.ts` 的模块对象逐字实现同一表达式。
- **为什么不用 `patchExecutions` 写行字段（拍板依据）**：① `extractSkillExecutions` 有 panel 为 null 的调用路径（nangongSmoke 等测试），原分支此时为 1，行字段写法拿的是 cfg，结果会变；② rowBuild:539 之后加入的行拿不到 patch。纯函数能力在消费处派发，两条边界都与原分支一致。**为什么不用行字段 `stunBuildUpBonus`**：它和面板失衡值提升是加算，原来是独立乘，不等价。
- 1581010 只存在于蕾米埃尔的技能表里（`foundMove` 在本槽 agent 的 skills 里查找），所以按槽位 agent 派发与原来对任意槽生效逐字等价。

**验证**
- vue-tsc 0；remielle / helpersNightC / skillRowsShell / nangongSmoke / helpers 单测 79/79 通过；新增 describe「CC-34c②」两条用例（1.35 / 1 / null 面板 → 1）。
- `PERF_KEY_ALIAS=1` 对 H2a：dump / rowsnap **仅 `__ms` 差**。
- **反向变异**（remielle 里 `/ 100` 改 `/ 50`）：dump **37 键出差**（`auto-*-1581` 队），remielle 单测红 1 条；已从 `calc-arch/rm34g.bak` 还原。
- `npm run verify` EXIT=0（`/home/kaua/calc-arch/verify34g.log`）。脚本：`/home/kaua/calc-arch/cc34g.py`、`z34g.sh`。
- **回退点**：`git revert 99b945a`（单提交）。

**遗留（记录，本卡不做）**
- `cfg.remielleRadiantTurnDazeBonusPct`（`remielle.ts#buildRemielleCharConfig` 写）在 src 里**没有读取方**，只有 `helpersNightC.test.ts:214` 断言非蕾米埃尔不写。它在 `types/resource/config.ts` 里，不计入判据 22。可以删，但要同步改测试；优先级低。
- 蕾米埃尔在 core + resourceCalc 里只剩 `anomalyPanels.ts:248` 一处：`refringe: panel.remielleRefringeCoefficient + panel.remielleRefringeCoefficientBonusPct`（2 计），与模块 `globalAnomalyMultiplierFactor` 同一算式来源。

**rf3 快照（HEAD 99b945a，148 计 / 53 字段，前若干名）**：velinaCorrosionSource 9、liuyinSrc 8、liuyinIdx 7、liuyinPromoteCount 7、velinaCinema2CorrosionRate 7、liuyinMechanicSource 5、lighterSource 5、liuyinGift 5、rinaSlot 4、normaIdx 4、normaGift 4；另 helpers.ts:575-580 的仪玄 5 字段 + promiaNiyingCount 共 12 计（每个 2 计）。

**下一步（按顺序，可直接开工）**
1. **CC-35a（蕾米埃尔收尾，2 计）**：`anomalyPanels.ts:248` 的 `refringe`。开工先读 248 行上下文，查清 `refringe` 这个字段给谁用；若语义就是「异化度合计」，给模块加一个返回该值的能力，或复用 `globalAnomalyMultiplierFactor` 反推（反推会引入浮点误差，**不要**）。验收：dump / rows 零差 + 反向变异出差。
2. **CC-35b（仪玄 5 + 普罗米娅 1 用户输入字段，约 12 计）**：`helpers.ts:575-580` 把 `char.yixuan*Count` / `char.promiaNiyingCount`（队伍配置里的用户输入）逐字拷进 cfg 字面量。**需要先设计**：`AgentCharConfigInput` 里没有 `char`。候选方案：(a) 给钩子输入加只读的 `char`（通用，最小改动）；(b) 改走模块 `settings`（`setting:<id>`，但这些是按槽的用户输入，UI 的来源要一起改，改动大）。倾向 (a)。注意 `yixuanExtremeAssistCount` 的缺省值是 **-1**（不是 0），迁移时要逐字保留。先 `grep -rn 'yixuanInk2Count' src` 列出全部读写方。
3. 琉音 35（liuyin\* 簇，先写设计稿）、维琳娜 19（§5.19 / CC-27）、诺玛约 14、爱丽丝约 11、雨果约 7，照旧。
4. 调研待派：花羽轮舞次数没有写入方（§5.31 未决）；W31。

### 5.33 CC-35a / CC-35b done：蕾米埃尔收尾 + 仪玄 / 普罗米娅交互栏次数迁模块（lead-arena-0925c，2026-09-27 第 46 轮）

**提交**：CC-35a 代码 `c684126`（6 文件），CC-35b 代码 `084a4e7`（7 文件，含新测试 `src/mechanics/__tests__/charInputFields.test.ts`）。判据 22 **148 → 146 → 134**，`CORE_ROLE_FIELD_BASELINE` / `frozen` 134，**target 已达成（143），重设为 122**。蕾米埃尔在 core + resourceCalc 的 `remielle*` 计数已清零（`anomalyPanels.ts` 仍按值导入 `isRemielleAgent`，见下「未决」）。

**CC-35a：异化度展示列 → 模块能力 `anomalyRefringePct`**
- `anomalyPanels.ts#buildAnomalyVirtualPanel` 每个积蓄贡献行的 `refringe`（结果页异常虚拟面板表的「异化度」列，`ResultPage.vue:476/487`，**只用于展示**，另写回虚拟面板 `panel.refringe`，全仓没有读取方）原来内联读蕾米埃尔两个面板字段。现改为：取**在队**各模块的 `anomalyRefringePct(该行面板)` 求和。
- `remielle.ts` 抽出 `remielleRefringePct(panel)`（异化系数 + 提升），作为 `globalAnomalyMultiplierFactor`（`1 + pct / 100`，运算顺序与原式相同，逐位不变）和新能力的**唯一来源**。
- 等价依据：这两个面板字段只由蕾米埃尔的自身 buff、队友 buff 和 applyPanel 写，她不在队时恒为 0；在队时是 `0 + x = x`。
- 验证：vue-tsc 0；单测 99/99；dump / rows 仅 `__ms` 差。**反向变异（能力返回 ×2）dump 零差**：refringe 不进快照哈希，属于预期。新增的 3 条单测（同源性、在队逐行相等且 > 0、不在队为 0）在该变异下红 2 条（26.8≠13.4、85≠42.5）。verify EXIT=0（3581 passed）。

**CC-35b：交互栏次数 → 模块 `buildCharConfig` 从 `char` 读入**
- `AgentCharConfigInput` 新增可选只读字段 `char?: Readonly<CharacterConfig>`（`mechanics/types.ts` 用 `import type` 引 `@/stores/config`，运行时擦除；之前 mechanics 源码从未引用 stores，这是首次，**拍板理由**：强类型，且只是类型依赖）。**设为可选的原因**：helpersNightC 等测试手工构造这个输入，仪玄还会把输入转交给 specBase，设成必填会一起报错。
- `helpers.ts#buildCharConfig`：删掉 cfg 字面量里的 6 行（`yixuanInk2Count` / `yixuanInk3Count` / `yixuanPerfectBlockCount` / `yixuanExtremeAssistCount`（缺省 **-1**）/ `yixuanBackstageComboCount` / `promiaNiyingCount`），在模块钩子调用处传入 `char`。
- `yixuan.ts#buildYixuanCharConfig`：开头写入 5 项（缺省值逐字保留），**位置在 362 行读 `yixuanPerfectBlockCount`、370 行读 `yixuanExtremeAssistCount` 之前**。`promia.ts#buildPromiaCharConfig` 写 `promiaNiyingCount`。
- 已核实全仓只有 helpers 构造这 6 个字段，读取方全在两个模块内部，并且只读本槽 cfg。`yixuan.ts:370` 把 `yixuanExtremeAssistCount` 拷进 `yixuanExtremeAssistCountInput`，793 行再读它，之后 `buildYixuanExecutions` 会用实际次数覆盖 `yixuanExtremeAssistCount`，名字链条是自洽的，不是 bug。
- 行为差异（有意为之）：非仪玄 / 非普罗米娅槽的 cfg 不再带这些字段。
- 验证：vue-tsc 0；charInputFields / yixuan / promia / helpers / difficulty 单测 128 通过（2 skipped）；dump / rows 仅 `__ms` 差。perf 语料只用缺省输入，读取方兜底值又和缺省值相同，dump 覆盖不到，所以新测试走真实 harness，用非缺省输入锁住接线。反向变异（`yixuanInk2Count` ×2）后新测试红（6≠3）。verify 见 `/home/kaua/calc-arch/verify35b.log`（EXIT=0）。
- 脚本：`/home/kaua/calc-arch/cc35a.py`、`z35a.sh`、`cc35b.py`、`z35b.sh`。**回退点**：分别 `git revert 084a4e7` / `git revert c684126`（单提交，互不依赖；都改了 `mechanics/types.ts` 的不同位置，先撤 35b 再撤 35a 最省事）。

**未决 / 已知坑**
- `anomalyPanels.ts#getWindInfectionTargetSlot` 仍按值导入 `isRemielleAgent`（风属性感染目标挑选里排除蕾米埃尔）。这是**跨槽决策**，文件内注释写明归分诊 §4 批次 3/4、需要新契约。不计入判据 22，本轮不动。
- `cfg.remielleRadiantTurnDazeBonusPct` 没有读取方（§5.32 遗留），照旧。
- 花羽轮舞次数没有写入方（§5.31 未决），照旧待调研。
- 新规律（写给后续卡）：**用户输入类字段**（交互栏次数）的反向变异 dump 基本抓不到，必须补走真实 harness 的单测，并且用非缺省值。

**rf3 快照（HEAD 084a4e7，134 计）前列**：velinaCorrosionSource 9、liuyinSrc 8、liuyinIdx 7、liuyinPromoteCount 7、velinaCinema2CorrosionRate 7、liuyinMechanicSource 5、lighterSource 5（panelPhases）、liuyinGift 5、rinaSlot 4（anomalyPanels）、normaIdx 4、normaGift 4、爱丽丝 aliceSpark\* 约 11、雨果 hugo\* 约 9、janeAssaultCritDmgBonus 3、velinaCinema1ResIgnore 2、luciaC4DecibelPerTrigger 2。

**下一步（按顺序，可直接开工）**
1. **CC-35c（小块，约 11 计）**：`lighterSource`（panelPhases.ts，5）+ `rinaSlot`（anomalyPanels.ts，4）+ `luciaC4DecibelPerTrigger`（assembleSlot.ts / helpers.ts，2）。开工先 `grep -rn 'lighterSource\|rinaSlot\|luciaC4DecibelPerTrigger' src` 列出全部读写方，逐个判断能不能套已有模块能力（`teamPanelEffects`、`crossAgentSupply`、`buildCharConfig` + `char`、`bonusDecibel` 类）。每块单独提交，套不上的就记录下来跳过。
2. **CC-35d（中块）**：诺玛 `normaGift*` / `normaIdx` / `normaSrc`（helpers.ts + normaHatChain.ts，约 14）与琉音 `liuyinGift*`（helpers.ts，约 8）：两者都是「赠送连携」的目标槽与时间，结构很像，**先写一份共用设计稿** `docs/mcp-cc35d-gift-chain.md`（并登记 README §6），再实现。
3. 维琳娜 19（§5.19 / CC-27）、琉音其余（liuyinSrc / Idx / PromoteCount / MechanicSource，需设计稿）、爱丽丝 / 雨果 / 简照旧。
4. 调研待派：花羽轮舞次数；W31。

### 5.34 CC-35c-A / CC-35c-B done：异常持续时间通用规则臂、队友 buff 来源面板修正迁模块（lead-arena-0925c，2026-09-27 第 47 轮）

**提交**：A 代码 `d40a62d`（8 文件，含新测试 `src/mechanics/__tests__/teamAnomalyDuration.test.ts`），B 代码 `b7b0d81`（7 文件，含新测试 `src/mechanics/__tests__/teammateBuffSourceAdjust.test.ts`）。判据 22 **134 → 130 → 125**，`CORE_ROLE_FIELD_BASELINE` / `frozen` 125，target 122（未达成）。agentId 棘轮（规则 6）保持 3/3。

**CC-35c-A：`getTeamAnomalyDurationBonus` → 模块能力 `teamAnomalyDurationBonus`**
- 原来 `anomalyPanels.ts` 里按 id 写死三条分支：柏妮思 1171 火 +3、丽娜 1211 电 +3（额外能力激活，`evalAdditionalAbility`）、简 1261 物理 +5。现在三人的模块各自实现，函数改为遍历在队槽位，对有该能力的模块求值后**取最大值**（现状每种属性至多一个提供者，与原先提前返回等价）。队伍快照只在确有提供者时才构建（每次面板计算要调 4 次）。
- 等价依据：本库 `teammateBuffId` 全部等于自身 id（2026-09-27 用 node 解析 catalog.json 实查：1171 / 1261 / 1411 / 1511 / 1581），所以按 agentId 派发模块与原 `teamHasAgent`（agentId 或 teammateBuffId 命中）等价。丽娜的槽位 / agent 取自 `buildMechanicTeamMembers`，与原 `findSlotByIdentity` + `agentsMap.get('1211')` 相同。
- `anomalyPanels.ts` 不再值导入 `getAgentSpec` / `evalAdditionalAbility`（改由 rina.ts 导入，mechanics 值导入 specs 有 alice / anby / claret / grace 先例）。爱芮以太 +3 仍走 spec buff 通道，类型注释里写明**不要**再实现（会双计）。
- **踩坑（已写进代码注释）**：第一版用 `team.find(m => m.agentId === char.agentId)` 找成员，verify 在 **agentId 棘轮 3→4** 上失败（AST 把 `x.agentId === y.agentId` 计为编排层身份判定）。改成按下标 `team[i]`（`buildMechanicTeamMembers` 就是 `configStore.team.map`）后恢复为 3/3。
- 验证：vue-tsc 0；teamAnomalyDuration / rina / burnice / jane / helpersNightC / cinemaAxisBatchR63 / anomalyPanelsShell 101/101；dump / rows 仅 `__ms` 差；**反向变异（简 5→6）dump 31 键出差**。改下标写法后重跑 verify EXIT=0（3587 passed，`/home/kaua/calc-arch/verify35c2.log`）。下标写法是纯写法调整，语义不变，没有重跑 dump。

**CC-35c-B：`computePanelPhases` 队友 buff 来源面板修正 → 模块能力 `adjustTeammateBuffSource`**
- 原来 `panelPhases.ts` 写死两块：莱特 `sourcePanelsByOwner['1161']` 局内冲击 ×1.2（喷发耗士气）；耀嘉音按 `findSlotByIdentity(['1311'])` 取命座，给来源面板写 3/5 命技能等级加成（取 max）。现在各自在模块里实现，panelPhases 遍历在队槽位，按 **本槽 agentId** 取条目调用。`addSourcePanelAliases` 让别名键（teammateBuffId）指向同一个对象，改动同步可见，逐位等价。panelPhases 不再导入 `findSlotByIdentity`。
- 新类型依赖：`mechanics/types.ts` 用 `import type { SourcePanelsByOwner } from '@/core/buff'`。
- **dump 覆盖不到**：莱特 ×1.2→×1.3 dump 零差。原因：莱特唯一读来源面板冲击力的 buff `lighter.additional_morale_ice_fire_dmg`（`sourceStat: impact`，`inCombat`）挂在额外能力上（可能未激活或已顶上限）；耀嘉音的队友 buff 读的是 `atk`（技能等级加成要经别的公式才起作用）。所以「移除能力 → 队友面板不变」在默认 harness 下也成立，差分测试第一版两条都红，**不可用**。
- 最终测试：模块单测（莱特 ×1.2、耀嘉音 C0/3/5 与 max 语义）+ **包裹能力记录调用**的接线测试（以本角色来源条目调用一次；耀嘉音收到命座 5；都不在队时不调用）。反向验证：把 panelPhases 派发改成恒不调用，接线测试红 2 条；还原后绿。
- 验证：vue-tsc 0；相关单测通过；dump / rows 仅 `__ms` 差；verify 见 `/home/kaua/calc-arch/verify35cb.log`（EXIT=0）。
- **未决**：莱特那条 buff 在默认配置下是否真的生效（额外能力门控 / 上限）没有核实。这是口径问题，不是本次迁移引入的，可派调研。

**脚本**：`/home/kaua/calc-arch/cc35c.py`、`cc35c_fix.py`、`z35c.sh`、`cc35cb.py`、`cc35cb3.py`、`z35cb.sh`。**回退点**：`git revert b7b0d81` / `git revert d40a62d`（单提交；两者都在 `mechanics/types.ts` 同一区域追加声明，先撤 B 再撤 A）。

**下一步（按顺序，可直接开工）**
1. **CC-35c-C（露西亚 C4，2 计，纯改名）**：`core/resource/helpers.ts:314` 与 `core/resource/assembleSlot.ts:116` 读 `cfg.luciaC4DecibelPerTrigger × curtainTriggers`，写入方是 `luciaElowen.ts:530`（=100）、读取方还有 `luciaElowen.ts:281`，注释在 `:515`。把 cfg 字段改名为通用的 `decibelPerCurtainTrigger`（类型在 `types/resource/config.ts:398`），全仓 `grep -rn luciaC4DecibelPerTrigger src` 逐处替换（注意别 sed 全局替换注释里刻意保留的旧名）。先查 `curtainTriggers` 的来源是否本身就是通用的「帷幕」概念（`core/resource/helpers.ts` 的 `curtain.providerSlot`）。验收：dump / rows 零差 + 反向变异（100→200）。
2. **CC-35d**：诺玛 / 琉音赠送连携，先写共用设计稿 `docs/mcp-cc35d-gift-chain.md`（登记 README §6）。
3. 维琳娜 19、琉音其余、爱丽丝、雨果、简照旧（见 §5.33 rf3 快照）。
4. 调研待派：花羽轮舞次数（§5.31）、莱特额外能力 buff 默认是否生效（本节）、W31。

**写给后续卡的规律**
- 编排层 / resourceCalc 里遍历队伍时**不要**写 `a.agentId === b.agentId` 之类的比较，agentId 棘轮会计数；用下标对应或 `getAgentMechanic(char.agentId)` 派发。
- 队友 buff 相关改动的「移除 → 结果不变」差分测试容易是空的，优先用包裹能力记录调用来锁接线。

### 5.35 CC-35c-C / CC-35c-D done：露西亚 C4 cfg 字段改通用名、赠链局部量去角色名（lead-arena-0925c，2026-09-27 第 48 轮）

**提交**：C 代码 `c763f5a`（6 src + GAME_TERM + 2 棘轮），D 代码 `dbc7e92`（helpers.ts + convergence.ts 注释 + 2 棘轮）。判据 22 **125 → 123 → 103**；`CORE_ROLE_FIELD_BASELINE` / `frozen` 103，**target 122 已达成 → 重设 91**（实测 103 − 12，沿用惯例）。agentId 棘轮保持 3/3。

**CC-35c-C：`cfg.luciaC4DecibelPerTrigger` → `cfg.decibelPerCurtainTrigger`**
- 「帷幕」本身已是通用能力（`curtainTriggers` / `curtain-open`），引擎 `core/resource/helpers.ts` 与 `assembleSlot.ts` 只读「每次帷幕触发的喧响」这一个数，名字里的角色是残留。写入方仍是露西亚模块（C4 = 100）。
- `luciaC4CurtainCoverage` 只有露西亚模块自己读，**保留原名**（不计入判据 22 也无需改）。census 历史节保留旧名。
- 验证：vue-tsc 0；luciaElowen / teamHookMigration / yidhari 43/43；dump / rows 仅 `__ms` 差；**反向变异 100→200：dump 零差（语料不含露西亚 C4），单测红 1 条** → 由单测锁住；还原后 rf 123。verify EXIT=0，3592 passed（`/home/kaua/calc-arch/verify35cc.log`）。
- 踩坑：改名脚本若先写入「含旧名的说明注释」再做计数断言，会多计一处。**先全局改名，再插含旧名的说明**。

**CC-35c-D：`core/resource/helpers.ts` 赠链局部量去角色名（计划外，顺手做，20 计）**
- 普查 CC-35d 时发现：`helpers.ts` 里 `normaGift*` / `liuyinGift*` 六个局部变量**取值早已走通用通道**——`crossAgentSupplyAt(… findCrossAgentSupplySlots(configs, 'gift-chain:chain') …)` 与 `ultimateGiftOf`（CC-32 落地）。角色名只剩变量名，改名即可，零行为风险。
- 映射：`normaGift`→`chainGift`、`normaGiftTargetIdx`→`chainGiftTargetIdx`、`normaGiftChainTime`→`chainGiftTime`；`liuyinGift`→`ultGift`、`liuyinGiftTargetIdx`→`ultGiftTargetIdx`、`liuyinGiftTime`→`ultGiftTime`（`\b` 词界替换，逐名断言计数 4/3/3/5/3/2）。`convergence.ts:354` 的过期引用 `core/resource.ts#liuyinGiftTime` 顺手改指向。`crossAgentSupply.ts` 头注释里的历史函数名（`normaGiftChainInfo` 等）是沿革记录，保留。
- 纯改名不做反向变异：vue-tsc 0 保证无残留引用；timeLedgerInvariants / hugoVerdictLanding / norma / liuyin / crossAgentSupply 36/36；dump / rows 仅 `__ms` 差。verify 见 `/home/kaua/calc-arch/verify35cd.log`（EXIT=0）。
- 决定依据：规则 17② 只禁止「换尺」与代码同批；这里尺子没变（rf.mjs 未动），读数下降是代码改动的结果，target 按惯例重设，不属换尺。

**rf3 快照（103 计，36 字段，2026-09-27 D 块后）**：维琳娜 velinaCorrosionSource 9 / velinaCinema2CorrosionRate 7 / velinaCorrosion 3 / velinaC6 2 / velinaBroadFromCorrosionCount 2 / velinaMicroCycloneCount 2 / velinaCinema1ResIgnore 2；琉音 liuyinSrc 8 / liuyinIdx 7 / liuyinPromoteCount 7 / liuyinMechanicSource 5 / liuyinPromoteHug60 2 / liuyinPromote 1；诺玛 normaIdx 4 / normaSrc 3 / normaResult 2 / normaHatChain 1（全在 `normaHatChain.ts`）；爱丽丝 aliceSpark* / aliceCoweringDot 共 14；雨果 hugo* 共 11（convergence / roundInputs）；简 janeAssaultCritDmgBonus 3；莱特 lighterTeamEnergy 1。

**脚本**：`/home/kaua/calc-arch/cc35cc.py`、`z35cc.sh`、`cc35cd.py`、`z35cd.sh`。**回退点**：`git revert dbc7e92` / `git revert c763f5a`（两者都改棘轮同一行，先撤 D 再撤 C）。

**下一步（按顺序，可直接开工）**
1. **CC-35d（诺玛 / 琉音装配后赠送行，约 40 计）**：剩余的是编排层两个装配后补丁——`resourceCalc/normaHatChain.ts#applyNormaHatChain`（`findSlotByIdentity(['1571'])` → `normaMechanicSource.hatToChainCount` → `resolveUltimateTargetSlot` 给上一位队友追加赠连携行）与 `liuyinPromote.ts#applyLiuyinPromote`（同构：赠终结技行），外加 damagePool* 读 `liuyinSrc` / `liuyinPromoteCount`。先写设计稿 `docs/mcp-cc35d-gift-chain.md`（**同提交登记 README §6**）：思路是模块自报「装配后赠送」供给（复用 CC-32 `crossAgentSupply` 的 `gift-chain:chain` / `gift-chain:ultimate` 通道拿次数与目标），编排层只按通道遍历，去掉 `findSlotByIdentity` 身份查找。验收必须含 timeLedgerInvariants（Σ非赠行 + 赠行 ≡ 账本）+ dump / rows 零差 + 反向变异。
2. 维琳娜 27 计（anomalyPool 为主）、爱丽丝 14、雨果 11、简 3 照旧。
3. 调研待派：花羽轮舞次数（§5.31）、莱特额外能力 buff 默认是否生效（§5.34）、W31。

### 5.36 CC-35d-A done：诺姆装配后赠送连携 → 模块能力 `chainGift`（lead-arena-0925c，2026-09-27 第 49 轮）

**提交**：代码 `a1241ba`。判据 22 **103 → 92**（`BASELINE` / `frozen` 92，target 91 未达成，差 1）。agentId 棘轮 3/3。设计稿 **`docs/mcp-cc35d-gift-chain.md`**（新增，已登记 README §6，文档数 48 → 49）。

- `resourceCalc/normaHatChain.ts#applyNormaHatChain` → **`resourceCalc/chainGift.ts#applyChainGift`**：提供者槽位 = 首个实现 `chainGift` 能力的在队模块，去掉 `findSlotByIdentity(['1571'])` 与 `normaIdx/normaResult/normaSrc`；招式名后缀与技能表说明也由能力返回，编排文件不再含诺姆文案。
- 诺姆模块实现 `chainGift`（返回 `hatToChainCount` + 文案）；`Math.floor`/`max(0)` 仍在编排层。
- 验证：vue-tsc 0；dump / rows 仅 `__ms` 差；**反向变异 count+1 → rowsnap 73 键出差、单测红 4**；verify EXIT=0（`/home/kaua/calc-arch/verify35da.log`）。
- 回退点：`git revert a1241ba`（含文件改名，revert 自动恢复 `normaHatChain.ts`）。

**下一步（可直接开工，细节见设计稿 §B）**
1. **CC-35d-B1**（约 11 计，纯改名）：`useResourceCalc` 导出 `liuyinPromoteCount`/`liuyinPromoteHug60` → `ultPromoteCount`/`ultPromoteHug60`（先 grep 全部 vue 消费方），`damagePool.ts` 形参 → `promoteCount`。做完判据 22 应 ≤ 81，**target 91 达成 → 按「实测 − 12」重设**。
2. **CC-35d-B2**：伤害池跳过琉音强特行 → 新能力（设计稿 §B2，注意与专用块门控同源）。
3. **CC-35d-B3**：好评转大去身份查找（设计稿 §B3，风险最高，必须跑 timeLedgerInvariants / hugoVerdictLanding / giftMoveTimeLedger）。
4. 维琳娜 27、爱丽丝 14、雨果 11、简 3 照旧；调研待派同 §5.35。

### 5.37 CC-35d-B1 / B2 / B3 done：琉音装配后赠大与伤害池去角色化（lead-arena-0925c，2026-09-27 第 50 轮）

**提交**：B1 `0aa191e`、B2 `e9e80cd`、B3 `840fa70`（各自单提交、各自 verify EXIT=0）。判据 22 **92 → 83 → 76 → 63**；`BASELINE` / `frozen` 63，**target 51**（两次达成、两次按「实测 − 12」重设：91→71→51）。agentId 棘轮 3/3。细节与验证数字见设计稿 **`docs/mcp-cc35d-gift-chain.md` §D**。

- B1：出口改名 `ultPromoteCount` / `ultPromoteHug60`（含 `views/ResultPage.vue`）。
- B2：新能力 `skipsGenericDirectRow`（琉音强特行跳过通用直伤，与 `extraDirectRows` 重放块同源）。反向变异 dump 107 键。
- B3：新能力 `ultimateGiftSource` + `ultimateGiftProviderSlot` / `ultimateGiftSourceOf`，编排层不再按身份找琉音。反向变异 dump 119 键。
- 决定：B1 ctx 字段名取 `ultPromoteCount`（偏离设计稿 `promoteCount`，理由：上下游同名）；B3 不改文件名（留 B4）。

**rf3 快照（63 计，26 字段，B3 后）**：维琳娜 velinaCorrosionSource 9 / velinaCinema2CorrosionRate 7 / velinaCorrosion 3 / velinaC6 2 / velinaBroadFromCorrosionCount 2 / velinaMicroCycloneCount 2 / velinaCinema1ResIgnore 2 / velinaCinema6 1 / velinaCinema1 1（共 29，`anomalyPool.ts` 为主，另 `roundInputs.ts` / `helpers.ts` / `damagePoolAnomaly.ts`）；爱丽丝 aliceSparkOverride 3 / aliceSparkThisRound 3 / aliceSpark 3 / aliceCoweringDot 3 / aliceSparkCountOf 2 / aliceSwordWillSource 1（共 15，convergence / roundInputs / anomalyPool / outerCycle）；雨果 hugoRefundRatio 3 / hugoMoveActionTime 2 / hugoSlot 2 / hugoHasVerdict 2 / hugoCinema 2（共 11，convergence / roundInputs）；简 janeAssaultCritDmgBonus 3（core helpers / damage / panel）；零散 liuyinPromote 1（import 路径）/ lighterTeamEnergy 1 / yixuanFuFaForJufufu 1 / yeshuguangStunCapMult 1 / yeshuguangVeilStunBase 1。

**下一步（按顺序，可直接开工）**
1. **CC-36 维琳娜（29 计）**：先普查 `anomalyPool.ts` 里 velina* 的语义（侵蚀来源 / 2 命侵蚀率 / 微型气旋 / 6 命），写设计稿 `docs/mcp-cc36-velina-anomaly.md`（同提交登记 README §6，文档数 49 → 50），再分块实现。参照先例：`anomalyPoolSetup` / `extraAnomalyRows` / `anomalyEventRecords` 能力（CC-19 / CC-2x）。
2. 爱丽丝 15（convergence 的 spark 跨轮反馈，参照 `nextRoundFeedback` / `threads`）、雨果 11（convergence 决算，参照 `hugoVerdictLanding` 测试）、简 3（core 层 cfg 字段改通用名，类似 CC-35c-C）。
3. 顺手小卡 CC-35d-B4（`liuyinPromote.ts` → `ultimateGift.ts`，1 计）。
4. 调研待派同 §5.35（莱特额外能力 buff、花羽轮舞次数、W31）。

### 5.38 CC-36a / CC-36b done：维琳娜在判据 22 中清零（lead-arena-0925c，2026-09-27 第 51 轮）

**提交**：36a `8af6ca2`、36b `1ea574e`（各自 verify EXIT=0）。判据 22 **63 → 40 → 34**；`BASELINE` / `frozen` 34，**target 28**（36a 后读数 40 < 51，按「实测 − 12」重设）。agentId 棘轮 3/3。设计稿与实施记录 **`docs/mcp-cc36-velina-anomaly.md`**（新增，已登记 README §6，文档数 49 → 50）。

- 36a：`corrosionSource`（含 `AnomalyPoolResult` 结果字段）、`cinema2CorrosionRate`（异常池输入）、气旋计数局部量、事件 fields 展示串。
- 36b：面板字段 `turbulenceResIgnore`（1 命 20）+ 模块能力 `windAnomalyBonus`（6 命）；补 3 条单测。
- **踩坑**：测试里 `(x as any)?.旧字段名` 的访问 tsc 拦不住，改名后 `toBeUndefined` 会变成空断言。**改结果字段名必须 grep 全仓旧名**（已写进设计稿 §A）。

**rf3 快照（34 计，17 字段，36b 后）**：爱丽丝 aliceSparkOverride 3 / aliceSparkThisRound 3 / aliceSpark 3 / aliceCoweringDot 3 / aliceSparkCountOf 2 / aliceSwordWillSource 1（共 15：convergence / roundInputs / anomalyPool / outerCycle）；雨果 hugoRefundRatio 3 / hugoMoveActionTime 2 / hugoSlot 2 / hugoHasVerdict 2 / hugoCinema 2（共 11：convergence / roundInputs）；简 janeAssaultCritDmgBonus 3（core helpers / damage / panel）；零散 liuyinPromote 1（import 路径）/ lighterTeamEnergy 1 / yixuanFuFaForJufufu 1 / yeshuguangStunCapMult 1 / yeshuguangVeilStunBase 1。

**下一步（按顺序，可直接开工）**
1. **CC-37 简（3 计，最小）**：`janeAssaultCritDmgBonus` 在 `core/**/helpers.ts`、`core/damage.ts`、`core/panel.ts`。先读这个字段的写入方（简模块）与语义（强击暴伤加成），若 core 只是按字段读数，就照 CC-35c-C 改成通用名（如 `assaultCritDmgBonus`），同步 `docs/GAME_TERM_TO_CODE_FIELD.md`；反向变异看 dump 是否覆盖，不覆盖就补单测。
2. **CC-38 爱丽丝（15 计）**：convergence / roundInputs 的 spark 跨轮反馈（`aliceSpark*`）+ anomalyPool 的 `aliceCoweringDot`。先写设计稿 `docs/mcp-cc38-alice.md`（登记 README §6），参照 `nextRoundFeedback` / `AgentTeamConfigInput.threads` 先例。
3. **CC-39 雨果（11 计）**：convergence 决算（`hugoSlot` 仍是 `findSlotByIdentity(['1291'])`），参照 CC-35d-B3 的「按能力找提供者槽位」写法；必须跑 `hugoVerdictLanding`。
4. 零散 5 计：`liuyinPromote.ts` 改名（CC-35d-B4）、叶瞬光 2、仪玄 1、莱特 1。
5. 调研待派同 §5.35。

### 5.39 CC-37 / CC-39a done：简面板字段改通用名、雨果决算返还能力化（lead-arena-0925c，2026-09-27 第 52 轮）

**提交**：CC-37 `f67c0ab`、CC-39a `a87da93`（各自 verify EXIT=0）。判据 22 **34 → 31 → 22**；`BASELINE` / `frozen` 22，**target 10**（39a 后读数 22 < 28，按「实测 − 12」重设）。agentId 棘轮 3/3。

**CC-37：面板字段 `janeAssaultCritDmgBonus` → `selfAssaultCritDmgBonus`**
- 语义：只给**本角色自身触发**的强击吃的暴伤加成（简潜能觉醒·致命舞步；乱流不继承）。写入方仍是 `jane.ts`，读取方 `core/damage.ts`（直伤强击）、`core/anomalyPool/helpers.ts`（异常池强击），声明在 `types/catalog.ts`、默认值在 `core/panel.ts`。
- perl 词界替换 11 文件 15 处，含 `src/specs/agents/1261.json` 与 `public/static/character-mechanics.json` 的说明文本（两者同步改，JSON 校验通过）、`docs/MECHANICS_IMPLEMENTATION.md`。`check-guards.mjs` 里的旧名只在沿革注释，未改。
- 验证：vue-tsc 0；jane / potentialAxisBatchB / specialMechanics / anomalyPool / modelingGaps / damage 177 条；dump / rows 仅 `__ms` 差；**反向变异（damage.ts 读侧置 0）dump 31 键出差**（`auto-1401-1261-1411` 等）。
- 脚本 `/home/kaua/calc-arch/z37.sh`（含改名）。

**CC-39a：雨果决算失衡值返还 → 模块能力 `stunRefundRatio`**
- 原 `convergence.ts` 用 `findSlotByIdentity(['1291'])` 得 `hugoSlot`，再内联 `hugoHasVerdict` / `hugoRefundRatio` 公式。`hugoSlot` 的唯一用途就是这里，所以整段迁入 `hugo.ts` 的 `stunRefundRatio({ getMechanicSetting })`，编排层对在队模块求值取最大值后传 `promoteFixpoint`。
- `convergence.ts` 不再导入 `findSlotByIdentity`（已无调用）。`roundInputs.ts` 局部量 `hugoCinema` → `slotCinema`（纯改名）。
- 等价性：原查找同时认 `teammateBuffId`，本库均等于自身 id（同 CC-35d-A 的论证）。
- 验证：vue-tsc 0；hugo / stunVulnSummary / timeLedgerInvariants / liuyin 60 条；dump / rows 仅 `__ms` 差；**反向变异（返还率恒 0）dump 零差**（perf 语料不含雨果返还路径），**单测红 5 条** → 由单测锁住。
- 脚本 `/home/kaua/calc-arch/cc39a.py`、`z39a.sh`。

**回退点**：`git revert a87da93`，再 `git revert f67c0ab`（两者都改棘轮同一行）。

**rf3 快照（22 计，12 字段，39a 后）**：爱丽丝 aliceSparkOverride 3 / aliceSparkThisRound 3 / aliceSpark 3 / aliceCoweringDot 3 / aliceSparkCountOf 2 / aliceSwordWillSource 1（共 15）；雨果 hugoMoveActionTime 2（convergence 值导入的函数名）；零散 liuyinPromote 1 / lighterTeamEnergy 1 / yixuanFuFaForJufufu 1 / yeshuguangStunCapMult 1 / yeshuguangVeilStunBase 1。

**下一步（按顺序，可直接开工）**
1. **CC-38 爱丽丝（15 计）**：`convergence.ts` / `roundInputs.ts` 的 spark 跨轮反馈（`aliceSpark*`）、`core/anomalyPool.ts` 的 `aliceCoweringDot`、`outerCycle.ts` 的 `aliceSwordWillSource`。先写设计稿 `docs/mcp-cc38-alice.md`（同提交登记 README §6，文档数 50 → 51），参照 `nextRoundFeedback` / `AgentTeamConfigInput.threads` 先例。
2. **CC-39b（2 计 + 结构）**：「终结失衡窗口的招式」统一能力。现状三处写死：`convergence.ts` 决算截断 `act.moveId === '1551016' || isHugoEndsWindowMove(act.moveId, cinema)` + `hugoMoveActionTime(act.moveId, dur)`；`roundInputs.ts` `endsWindow = '1551016' || HUGO_EX_VERDICT_MOVE_ID || (HUGO_ULT_MOVE_ID && slotCinema < 2)` + `HUGO_EX_FINAL_ACTION_TIME` 兜底。方案：新能力 `endsStunWindow?(moveId, cinemaLevel): boolean` + `axisMoveActionTime?(moveId, dur): number`，佩洛伊斯 / 雨果各自实现，编排层按 `configStore.team[act.slot].agentId` 派发。两处门控必须同源；验收含 `hugoVerdictLanding` 与反向变异。
3. 零散 5 计：CC-35d-B4（`liuyinPromote.ts` 改名）、叶瞬光 2、仪玄 1、莱特 1。
4. 判据 22 清零后，考虑把判据 22 的 target 设为 0 并改成「只许降」的硬门（届时再定）。
5. 调研待派同 §5.35。

### 5.40 CC-38 done：爱丽丝清零（lead-arena-0925c，2026-09-27 第 53 轮）

**提交** `7b865bf`（verify EXIT=0）。判据 22 **22 → 7**；`BASELINE` / `frozen` 7，**target 0**（实测 7 − 12 < 0，取 0 作清零目标）。agentId 棘轮 3/3。设计稿与实施记录 `docs/mcp-cc38-alice.md`（README §6 51 份）。

- 38a 改名：`aliceSparkOverride` / `aliceSpark` / `aliceSparkThisRound` → `giftedPolarAssault*`（−9）。
- 38b 新模块能力 `giftedPolarAssaultCount(char)`：convergence 派发求和、outerCycle 逐角色投影；删除 `aliceSparkCountOf`（−3）。
- 38c 异常池输出 `aliceCoweringDot` → `coweringDot`（−3）。**推翻 §5.17/§5.18「不改」口径**：基线 JSON 实测不含此键，零差。
- 验证：tsc 0；dump / rows 零差；反向① dump 25 键、反向② rows 29 键出差，对应单测红 2 / 4。

**回退点**：`git revert 7b865bf`（单提交含棘轮常量）。

**rf3 快照（7 计，6 字段）**：hugoMoveActionTime 2 / liuyinPromote 1 / lighterTeamEnergy 1 / yixuanFuFaForJufufu 1 / yeshuguangStunCapMult 1 / yeshuguangVeilStunBase 1。

**下一步（按顺序，可直接开工）**
1. **CC-39b（2 计 + 结构）**：见 §5.39 下一步 2（「终结失衡窗口招式」统一能力 `endsStunWindow` + `axisMoveActionTime`，佩洛伊斯 `'1551016'` 与雨果常量一起收走）。先写设计稿 `docs/mcp-cc39b-stun-window-end.md`，README §6 → 52。验收必须含 `hugoVerdictLanding` 单测与反向变异（perf 语料不覆盖雨果返还，见 §5.39）。
2. **零散 5 计（CC-40）**：`liuyinPromote`（convergence 里 `./liuyinPromote` import 路径，文件改名如 `ultimatePromote.ts`，同步所有 import）、`lighterTeamEnergy`、`yixuanFuFaForJufufu`、`yeshuguangStunCapMult` / `yeshuguangVeilStunBase`（damagePool.ts）。每个先 grep 读写方再定是改名还是能力化。
3. 判据 22 清零后：把判据 22 改成「只许 0」的硬门（frozen 0 / target 0），并在 ARCHITECTURE 写明新增角色机制一律走模块能力。

### 5.41 CC-39b done：终结失衡窗口招式统一能力（lead-arena-0925c，2026-09-27 第 54 轮）

**提交** `a1eb71e`（verify EXIT=0）。判据 22 **7 → 5**；`BASELINE` / `frozen` 5，target 0 不变。设计稿与实施记录 `docs/mcp-cc39b-stun-window-end.md`（README §6 52 份）。

- 新模块能力 `endsStunWindow(moveId, cinema)` / `axisMoveActionTime(moveId, t)`，由雨果和佩洛伊斯实现；统一派发点 `resourceCalc/helpers.ts#axisMoveEndsStunWindow` / `axisMoveActionTimeOf`。convergence 决算截断与 roundInputs 轴栈 `endsStunWindow` 同源。
- roundInputs 不再值导入 `@/mechanics/agents/hugo`；两处 `'1551016'` 字面量删除。
- 验证：tsc 0；dump / rows 零差；反向①②（两个能力）dump 零差、新单测各红 1；接线探针（调用点恒 false）stunVulnSummary 雨果集成快照红 2。
- **坑**：perf 语料对决算截断零覆盖，改这条路径必须跑 `axisStunWindowEnd` + `stunVulnSummary`。

**回退点**：`git revert a1eb71e`。

**rf3 快照（5 计，5 字段）**：liuyinPromote 1（convergence import 路径）/ lighterTeamEnergy 1（convergence:565 读 moduleFeedback 键）/ yixuanFuFaForJufufu 1（convergence:1102 读 moduleFeedback 键）/ yeshuguangStunCapMult 1 / yeshuguangVeilStunBase 1（damagePool.ts:178–179 读面板字段）。

**下一步：CC-40 清零（可直接开工，按顺序，建议拆 40a/40b/40c 三个提交）**
1. **40a 文件改名**：`git mv src/composables/resourceCalc/liuyinPromote.ts ultimatePromote.ts`（文件里是 `promoteFixpoint` 等通用失衡/终结技提升不动点）。同步所有 import：`grep -rn "liuyinPromote'" src`，已知有 convergence.ts:35、`resourceCalc/__tests__/liuyinPromote.test.ts:12`（测试文件名可保留）。注释里的历史名（findSlotByIdentity.test.ts:8、anomalyPanels.ts:90）改成新路径。先确认 `vitest run liuyin` 的过滤器是否还能匹配到这个测试（按文件名匹配，测试文件不改名就不受影响）。−1。
2. **40b moduleFeedback 键改通用名**：键定义在 `src/mechanics/types.ts` 的 `ModuleFeedback`（CC-31 起）。`lighterTeamEnergy` → `teamEnergyConsumed`（莱特写、convergence:565 读，赋给 cfg `lighterTeamEnergyConsumed`，这个 cfg 名属于模块自有，不在扫描范围）；`yixuanFuFaForJufufu` → `teamUltimateBonusForTigerRoar` 或同义通用名（仪玄写、convergence:1102 读）。整词替换并逐个 `grep -rnw` 旧名：测试 `nextRoundFeedbackR20.test.ts`（199/209/276/288）、`axisContext.test.ts`（707/724/734/747），都是 `as never` 字面量，**tsc 拦不住，漏改会让断言变成空断言**。另外查 `outerCycle` 签名和 `feedbackCfgKeys` 是否按键名枚举。−2。
3. **40c 叶瞬光面板字段改通用名**（照 CC-37）：`yeshuguangStunCapMult` → `veilStunCapMult`，`yeshuguangVeilStunBase` → `veilStunBase`。涉及 `types/catalog.ts:80/89`、`data/agentPanelStats.ts:18–19`、`damagePool.ts:178–179`、叶瞬光模块（写入方）、`damagePoolBatchR18d.test.ts`、`zzz_ysg_probe.test.ts`；再 grep `src/specs/agents/1431.json`、`public/static/character-mechanics.json`、`docs/MECHANICS_IMPLEMENTATION.md`。反向：damagePool 读侧置 0 ⇒ dump 应出差（叶瞬光在语料里；若零差就补单测）。−2。
4. 清零后把判据 22 改成硬门：frozen 0 / target 0，并在 `docs/ARCHITECTURE.md` 写明「core / 编排层不得出现 `<角色前缀>Xxx` 标识符，新机制一律走模块能力」。
5. 小卡 **CC-39c**（可派低级模型）：给佩洛伊斯右分支决算补一条轴集成快照，锁 `verdictSecondsLost > 0`，详见设计稿 §4。

### 5.42 CC-40 done：判据 22 清零 → 硬门（lead-arena-0925c，2026-09-27 第 55 轮）

**提交** `0b6b973`（verify EXIT=0）。判据 22 **5 → 0**；`CORE_ROLE_FIELD_BASELINE` 0、`frozen` 0、`target` 0。**自此判据 22 是硬门**：core / resourceCalc / useResourceCalc 里新增任何 `<角色前缀>Xxx` 标识符（含 import 路径）check-guards 即红。规则同步写进 `docs/ARCHITECTURE.md` §3 决策表。

| 步 | 旧名 | 新名 | 处数 |
|---|---|---|---|
| 40a | 文件 `resourceCalc/liuyinPromote.ts` | `resourceCalc/ultimatePromote.ts`（`git mv`） | 整词 18 处（import 2、@fact 锚 2、注释）+ check-guards @fact 豁免键 2；测试文件名 `liuyinPromote.test.ts` 不改（正则排除 `.test`） |
| 40b | moduleFeedback `lighterTeamEnergy` | `consumedTeamEnergy` | 23（cfg `lighterTeamEnergyConsumed` 属模块自有，不在扫描面，未改） |
| 40b | moduleFeedback `yixuanFuFaForJufufu` | `teamUltimateExtra` | 28 |
| 40c | 面板 `yeshuguangStunCapMult` | `veilStunCapMult` | 19 |
| 40c | 面板 `yeshuguangVeilStunBase` | `veilStunVulnBase`（叶瞬光模块已有同名函数 `veilStunBase`，避开） | 14 |

- 新名先 `grep -rnw` 确认无占用（`teamEnergyConsumed` / `veilStunBase` 已被占，所以没用）。
- 验证：tsc 0；check-guards 22 项通过（判据 22 = 0/0）；相关单测 197 条；dump / rows 零差（基线 JSON 不含这些键）；反向（两处 moduleFeedback 读侧 ×0 + damagePool 帷幕封顶门控 false）dump 6 键出差（`auto-1431-*`），单测红 6。脚本 `/home/kaua/calc-arch/cc40.py`、`z40.sh`。
- **测试同步**：`src/scripts/__tests__/checkGuards.test.ts` 的「基线常量 == RATCHET_BURNDOWN.frozen」原本断言 `target < frozen`，清零后 0 < 0 恒红；改为 frozen > 0 时照旧，frozen = 0 时断言 target = 0（硬门）。首次 verify 因此红 1 条，改后通过。
- 三步合为一个提交：都是纯改名、同一验收，拆开没有回退价值。
- **没有改**：历史 docs（mcp-*.md、AGENT_ID_BURNDOWN_LOG）里的旧文件名和旧字段名保留原样，是沉淀；活文档 `MECHANICS_IMPLEMENTATION.md` / `ENGINE_PIPELINE_GUIDE.md` / `ARCHITECTURE.md` 已同步新文件名。check-guards 注释里的历史旧名保留。

**回退点**：`git revert 0b6b973`（含 git mv 与棘轮常量）。

**判据 22 系列收官。下一步（按顺序）**
1. **CC-39c**（小卡，可派低级模型）：佩洛伊斯右分支决算轴集成快照，见 `docs/mcp-cc39b-stun-window-end.md` §4。
2. **遗留未决项**（见 §5.39 前各节）：莱特额外能力 buff 在默认配置下是否生效（调研）；`cfg.remielleRadiantTurnDazeBonusPct` 没有读取方、`remielleFlowerFeatherDanceCount` 没有写入方（死通道，先 grep 读写方再决定删或补）；`isRemielleAgent` 跨槽决策；W31。
3. 可选观感收尾：类型名 `AliceCoweringDotResult`、函数 `calcAliceCoweringDot`（首字母大写或非前缀，不计入判据 22）改通用名。

### 5.43 CC-39c done + 蕾米埃尔两条「死通道」复核 + CC-41 立卡（lead-arena-0925c，2026-09-27 第 56 轮）

**CC-39c（`0f9f329`，verify EXIT=0，3603 条）**：新增 `src/composables/__tests__/peiluoVerdictTruncation.test.ts`。
- 做法：队伍 1551 / 1011 / 1191，手工单轴 `[{slot:0, moveId, count:1, startTime:0}]`（预设库里没有佩洛伊斯轴），只换招式做对照：右分支决算 `1551016` 对上分支 `1551015`，读 `calc.stunCoverage`（含 `verdictSecondsLost` 的权威口径）。
- 冻结值：窗长 25；上分支 0.2778（= 2 × 25 / 180，不截断）；决算 **0.0834**。断言：决算 < 上分支 × 0.5、> 0，并 `toBeCloseTo(0.0834, 3)`。若数值因无关口径漂移，先确认相对断言仍成立再重冻。
- 反向：佩洛伊斯 `endsStunWindow` 置 false ⇒ 红（0.2778 不小于 0.1389）；convergence 截断调用点置 false ⇒ 红。脚本 `/home/kaua/calc-arch/z39c.sh`。
- 至此决算截断两条路径（雨果 stunVulnSummary、佩洛伊斯本文件）都有集成覆盖。`docs/mcp-cc39b-stun-window-end.md` §4 的待补项关闭。

**遗留项复核（只读 grep，结论如下）**
1. `cfg.remielleRadiantTurnDazeBonusPct`：写入方 `remielle.ts:326`（buildCharConfig）；引擎读的是**同名面板字段** `panel.remielleRadiantTurnDazeBonusPct`（`remielle.ts:390`），cfg 副本只有 `helpersNightC.test.ts:522/531/547` 在读，那组测试把它当成「cfg 与 panel 一致」的契约。**决定：保留，不删**。依据：无害镜像，删掉要改一组契约测试而没有收益。本项关闭。
2. `panel.remielleFlowerFeatherDanceCount`：**确认没有写入方**。`StatPanel.vue:732` 只是展示过滤集合，不是写入；`agentPanelStats.ts:27` 初值 0 ⇒ `remielle.ts:322` 的一命喧响 `DecibelPerUse(200) × Count` 恒 0。**这是建模缺口，不只是死代码**：蕾米埃尔 1 命「发动[支援技：花羽轮舞]时，获得 200 点喧响值，18 秒内最多触发 1 次」（`src/specs/agents/1581.json:47`）目前**完全没生效**。已立卡 CC-41。

**CC-41（todo，中等，需 lead 或能读引擎的模型）：蕾米埃尔 1 命花羽轮舞喧响次数**
- 目标：给 `remielleFlowerFeatherDanceCount` 找到写入方，次数 = min(本角色支援技 `1581015`「花羽轮舞」的施放次数, 冷却上限 ⌊战斗时长 / 18⌋ + 1)。只在影画 ≥ 1 生效。
- 先查：①支援技施放次数在资源结果（`rr.characters[*]` 或 skill executions）里怎么表示，`grep -rn "1581015\|skillDamageTarget.*assist\|counterAssistOf" src`；②现在的写法是面板字段，而次数依赖资源结果，这是循环依赖（面板先于资源）。**建议改走 `moduleFeedback` 跨轮键**（参照 CC-31 / CC-40b 的 `consumedTeamEnergy`：上一轮资源结果算次数 → 下一轮 buildCharConfig 读），不要硬塞面板。
- 验收：影画 1 队伍喧响 / 终结次数上升，影画 0 不变；dump 会出差（这是预期的口径变化，**不是零差重构**），出差键只能是含 1581 的队伍；在 `remielle.test.ts:258` 附近把「目前没有写入方」的注释和断言改成真实写入路径。
- 风险：会改变用户可见的蕾米埃尔 1 命数值。按离线纪律，这是口径修正（原文明确），可以直接做，但要在 census 写明前后数值。

**回退点**：`git revert 0f9f329`（只新增一个测试文件）。

**下一步（按顺序）**
1. **CC-41**（见上）。
2. 调研：莱特额外能力 buff 在默认配置下是否生效；`isRemielleAgent` 跨槽决策；W31。
3. 可选观感收尾：`AliceCoweringDotResult` / `calcAliceCoweringDot` 改通用名。

### 5.44 CC-41 done：蕾米埃尔 1 命花羽轮舞喧响接通（lead-arena-0925c，2026-09-27 第 57 轮）

**提交**：src `8b2a1d2`（remielle.ts / mechanics/types.ts / catalog.ts / agentPanelStats.ts / StatPanel.vue / remielle.test.ts）。回退：`git revert 8b2a1d2`（整提交可逆，恢复为「效果恒 0」的旧行为）。

**原文**（`src/specs/agents/1581.json:47`）：发动[支援技：花羽轮舞]时获得 200 点喧响值，18 秒内最多触发 1 次。catalog 给 `remielleFlowerFeatherDanceDecibelPerUse=200`（buff target=self，仅影画 ≥1）。

**调研结论**
- 改前探针（1581/1261/1331，推荐配装）：C0 decibelSource.total 12545.8、C1 12510.2，unshareableBonus 均 0 ⇒ 一命效果确为 0（差值是收敛噪声），ult 均 4。
- 蕾米 executions 里没有 1581015（花羽轮舞）行；assist 类只有 1581018 招架支援 6 次、1581021 支援突击 6 次。花羽轮舞只以耀变行出现：`remielle-luminize-assist`，countsBySlot = voidflareBySlot（每个虚曜由一次花羽轮舞命中消耗）。
- 次数来自异常池（晚于资源结算）⇒ 不能套 orphie 影画 2 的同轮 patchExecutions 写法，改用 promia 的跨轮模板。

**决定（可逆）**
1. 新 ModuleFeedback 键 `remielleFlowerFeatherDanceCasts`（mechanics/types.ts，前缀写法同 promiaReleaseDecibel；resourceCalc 不引用 ⇒ 判据 22 仍 0）。
2. `remielleNextRoundFeedback`：casts = min(Σ 非本槽 ⌊perSlotAnomalyTriggers[slot]⌋, ⌊T/18⌋)，T = teamResult.totalTime（缺省 180）。**口径修订**：原卡写 ⌊T/18⌋+1，现取与 orphie CD 同款的 ⌊T/18⌋；「一次施放对应一个虚曜」是建模假设（依据 luminize-assist 行 count=voidflareBySlot）。
3. `applyRemielleTeamConfig`：仅 phase==='converge'，`extraSelfDecibelReward += panel.remielleFlowerFeatherDanceDecibelPerUse × casts`。影画门槛由 perUse（C0 为 0）自然实现，无需判命座。
4. 删除 `remielleFlowerFeatherDanceCount`（catalog.ts / agentPanelStats.ts / StatPanel.vue 展示集合 / buildRemielleCharConfig 乘法）。全仓只剩 remielle.ts 一条说明注释。
5. 独立反馈判据：casts 由异常触发数派生，异常触发已在外层收敛签名覆盖范围内，未新增签名项（若日后发现振荡，把 casts 加进 outerCycle 签名）。

**数值（改后探针，1581/1501/1561，slot0 影画）**
| 影画 | unshareableBonus | decibel total | 各槽 ult |
|---|---|---|---|
| C0 | 0 | 11495.0 | 3/4/4 |
| C1 | 2000（10 次 × 200，被 ⌊180/18⌋ 封顶） | 13330.0 | 4/4/4 |
| C6 | 2000 | 12650.0 | 4/3/4 |

**perf 对 H2a**：dump 与 rowsnap 各仅 1 键出差：`auto-1581-1501-1561/c6` 总伤 424117050.01 → 411843207.12（−2.9%）。原因：蕾米多 1 次终结技，固定时长内挤掉爱芮 1 次终结（4→3）。这是模型取舍，不是 bug，记为已知现象。其余 5 支含 1581 的队伍蕾米在第 3 槽，而 `/c6` 档只设 `setCinemaLevel(0,6)` ⇒ 不受影响；所有 default/c0/w/heavy/heavyGate/axis 档零差。**新基线**：`/home/kaua/calc-arch/dump-41.json`、`rows-41.json`（后续零差验收改用这两份）。

**验证**
- 单测（remielle.test.ts CC-41 块 4 条）：次数口径与封顶、converge 累加 100+200×3=700、C0/非 converge/无线程不写、真实管线集成（C0 unshareable=0，C1 >0 且为 200 的倍数、≤2000、ult 不减）。
- 反向变异（applyTeamConfig 恒 return）：dump 回到对 H2a 零差，remielle 单测红 2 条（converge 累加、集成）。
- `vue-tsc -b` 0；check-guards 22 passed；`npm run verify` 通过（298 文件 / 3605 条）。

**遗留**
- 蕾米不在 slot0 的 C1 队伍在语料里不覆盖（`/c6` 只设 slot0），由单测兜底。
- 18s 冷却只做 ⌊T/18⌋ 封顶，未按时间轴逐个判定。若日后需要精细化，改 remielleFlowerFeatherDanceCasts 一处即可。

### 5.45 莱特额外能力 buff 生效性核实 + CC-42 done + CC-35d-B4 状态纠正（lead-arena-0925c，2026-09-27 第 58 轮）

**提交**：测试 `edecb55`（新文件 `src/composables/__tests__/lighterAdditionalGate.test.ts`），CC-42 src `d57c0c3`（mechanics/types.ts、remielle.ts、resourceCalc/anomalyPanels.ts）。回退：各自 `git revert`，两者互不依赖。

**1. 莱特额外能力 buff 是否默认生效（§5.34 未决，本轮关闭）**
- 对象：`lighter.additional_morale_ice_fire_dmg`（teammate-buffs.json，公式 `min(75, 25 + floor(max(0, x−170)/10)×5)`，x = 莱特局内冲击力）。门控：spec 1161 `additionalAbility` = 队中有[强攻] 或同阵营（卡吕冬之子）。
- 探针实测（推荐配装，C0）：
  | 队伍 | 选择表默认 | 莱特冲击 局外/局内 | 关 buff 后 slot0 冰伤/火伤 变化 |
  |---|---|---|---|
  | 1191-1161-1311 | enabled | 185.66 / 278.49 | 170→95、75→0（各 −75） |
  | 1041-1161-1311 | enabled | 185.66 / 278.49 | 75→0、147.5→72.5（各 −75） |
  | 1251-1161-1131（无强攻、无卡吕冬） | **不勾** | 185.66 / 278.49 | 强行勾上后仍不变（面板层 `ADDITIONAL_GATE_BUFFS` 第二道门控） |
- **结论**：门控满足时默认生效；推荐配装下局内冲击 278.49 ≥ 270，公式顶在硬顶 75。所以 CC-35c-B 的 ×1.2→×1.3 dump 零差是**已顶上限**，不是未生效。含 1161 的 perf 语料 5 队（1041/1321/1591×2/1191）都有强攻，门控都开。
- 已知覆盖缺口：来源面板 ×1.2（`adjustTeammateBuffSource`）只在局内冲击 <270 时影响结果（推荐配装到不了），靠模块单测兜底；本轮不补。
- 回归测试 `lighterAdditionalGate.test.ts`（2 条）：①门控满足时默认勾选、莱特冲击 ≥270、关掉后冰伤/火伤各 −75；②门控不满足时默认不勾，强行勾上面板仍不变。反向变异（`panelPhases.ts` 的 `ADDITIONAL_GATE_BUFFS['1161']` 置空）：第 ②条红；还原后绿。
- 注意：用例①断言了「推荐配装冲击 ≥270」。若日后推荐配装数据改动导致它红，那是数据变化信号，不是回归：把该断言改为按实测冲击算期望值即可。

**2. CC-42：`isRemielleAgent` 跨槽判定 → 模块能力 `excludeFromWindInfectionPick`**
- 原状：`anomalyPanels.ts#getWindInfectionTargetSlot` 在风化浸染默认挑槽时，按值导入 `isRemielleAgent` 排除蕾米埃尔（首选轮排除，兜底轮不排除）。以前注释说「跨槽决策无落点，需新契约」。
- 决定：新增**声明式**模块能力 `excludeFromWindInfectionPick?: boolean`（mechanics/types.ts），不需要钩子入参，因此不算新契约。蕾米埃尔模块声明 true；anomalyPanels 按槽位 agentId 调 `getAgentMechanic` 读取，删除对 `@/mechanics/agents/remielle` 的值导入。
- 等价依据：`isRemielleAgent` 的别名臂 `teammateBuffId === 'remielle'` 在数据面恒 false（蕾米 teammateBuffId = '1581'，`helpersNightC.test.ts` 组2-E 第 2 条锁定），所以按 agentId 派发与原判定逐位等价。`isRemielleAgent` 本身保留（remielle.ts 内部 3 处在用）。
- 验证：vue-tsc 0；helpersNightC / lighterAdditionalGate / remielle / anomalyPanels 74 条通过；dump、rowsnap 对 `dump-41`/`rows-41` **零差**。反向变异（改为 false）：helpersNightC 风染挑槽成对用例红 1 条，dump 出差 6 键（语料覆盖到了），还原后绿。`npm run verify` 见 `/home/kaua/calc-arch/verify42.log`。
- 判据 22 / agentId 棘轮不变（`isRemielleAgent` 不以角色前缀开头，本来就不计数）。

**3. CC-35d-B4 状态纠正**：`liuyinPromote.ts` 改名已在 CC-40（`0b6b973`）做成 `ultimatePromote.ts`（census §5.42）。§5.33/§5.35/§5.36 里「CC-35d-B4 待做」是过期状态，**视为 done（并入 CC-40），不要再开工**。

**下一步（按顺序）**
1. W31（派低级模型）：悠真轴模式伤害池消费端测试，卡面在任务队列 §2。
2. 可选观感收尾：`AliceCoweringDotResult` / `calcAliceCoweringDot` 改通用名（不计判据 22，纯可读性）。
3. 候选调研：来源面板 ×1.2 在低冲击配装下的集成覆盖（见上文「已知覆盖缺口」）；多槽同角色时 `giftedPolarAssaultCount` 的求和语义复核。
4. 暂缓不动：CC-11b（理由见 arch 表）。

### 5.46 W31 done（dsh 工人）+ W30 done（lead-arena-0925c，2026-09-27 第 59 轮）

**提交**：W31 测试 `618366b`（新文件 `src/composables/__tests__/harumasaStunOnlyAxis.test.ts`）；W30 `b7f5b77`（`scripts/check-tokens.mjs` 2 处 hint 字符串 `--text-2/--text-3` → `--fg-2/--fg-3`）。回退：各自 `git revert`，互不依赖。

**W31（悠真轴模式 `stunOnlyDmgBonus` 伤害池读取侧）**
- 派发：dsh headless（自检 pong 通过），提示词 `/home/kaua/calc-arch/w31.prompt`，工人报告 `.zc/reports/W31.md`（STATUS: done，闸门通过）。
- 工人找到的关键口径（已写进测试注释）：`harumasa.abnormalCoverage` 默认 1 ⇒ 失衡独有部分 40×(1−1)=0，路径静默为空，所以必须设 0.2（得 32）；额外能力要求队里有击破/异常（放扳机 1361）；`config.stunAxes` 要整体赋值，不能 push，否则 stunAxisResult 为 null。
- lead 复核：①删掉多余的 `await setTimeout(2000)`（计算是同步 computed；删后用例 1.9s）；②删掉未用的类型别名 `Harness`（TS6196，导致 vue-tsc 与 verify 红）。复核后正控 2/2 绿；负控（`damagePoolDirect.ts` 的 `stunOverride > 0 ?` → `>= 0 ?`）红 1 条（断言②），还原后 `git diff src/composables/resourceCalc/` 为空；`vue-tsc -b` 0；`npm run verify` 通过（300 文件 / 3609 条，22 guards）。
- 覆盖意义：census §5.28 记录的「悠真轴模式 perf 语料不覆盖」盲区现在有读取侧单测兜底。
- 流程教训已写进任务队列 §0：工人验收必须跑 `vue-tsc -b`；测试里不要写 setTimeout 等待。

**W30（check-tokens hint 指向不存在的令牌）**
- 决定：不派工人，lead 直接做。依据：只改 2 处字符串，符合「一步能做完的小事不派活」。
- 闸门：`grep -rnE '\-\-text-[23]\b' src/ scripts/ public/`（排除 check-tokens.mjs 自身）为空；`--fg-2`/`--fg-3` 定义在 `src/styles/global.css:201-202`。
- 验收：`npm run check-tokens` 12 项通过，改前改后输出中的数字逐位相同（基线没动）；残留 0 行；diff 1 文件 2 行；check-guards 22 通过。

**队列现状**：任务队列 §1 的 W 卡全部清空。架构线 CC 卡没有 todo（CC-11b 暂缓，理由见 arch 表）。

**下一步（按顺序）**
1. 可选观感收尾（lead 或工人都行）：`AliceCoweringDotResult` / `calcAliceCoweringDot` 改通用名（`grep -rnw` 全仓确认调用点；纯改名，dump/rows 应零差，基线 `/home/kaua/calc-arch/dump-41.json`、`rows-41.json`）。
2. 候选调研：①莱特来源面板 ×1.2 在低冲击配装（局内冲击 <270）下的集成覆盖（census §5.45）；②多槽同角色时 `giftedPolarAssaultCount` 的求和语义复核。
3. 若以上都做完：重新盘点 `docs/mcp-calc-core-architecture.md` §3 目标形态与现状的差距，再立新卡。立卡前先读 CC-11b 的暂缓理由。

### 5.47 CC-43a/b done：判据 22 口径盲区 → 零差改名 + 新判据 23（lead-arena-0925c，2026-09-27 第 60 轮）

**提交**：CC-43a `d573b4a`（24 文件纯改名），CC-43b `6a6c6d7`（守卫：lib / check-guards / d.mts / checkGuards.test）。按规则 17② 换尺与代码改动分两批。回退：`git revert 6a6c6d7`（撤判据 23），`git revert d573b4a`（撤改名）。先撤 B 再撤 A 最安全；只撤 A 会让判据 23 读数升到 13+ 而报红。

**发现**：判据 22 只数 `\b<小写前缀>[A-Z]`，且只扫 `src/core/*.ts` 顶层。盘点脚本 `/home/kaua/calc-arch/inv60.mjs` 扫 core/**、resourceCalc、useResourceCalc 后，找出两类漏网：①标识符中缀带角色名；②core 子目录（anomalyPool/、resource/、stunAxis/）。`types/resource/config.ts` 里大量 `qingyiXxx` 等 cfg 字段属于类型层（由各角色 buildCharConfig 写），不在本卡范围。

**CC-43a 改名映射**（src 与测试整词替换；现行指南 ENGINE_PIPELINE_GUIDE.md、MECHANICS_IMPLEMENTATION.md 同步；历史 mcp-* 文档保留旧名）：
| 旧名 | 新名 | 处数 |
|---|---|---|
| axisLiuyinPromote | axisUltimatePromote | 19 |
| applyLiuyinPromote | applyUltimatePromote | 18 |
| LiuyinPromoteParams | UltimatePromoteParams | 4 |
| VelinaCorrosionSource | CorrosionSource | 14 |
| AliceCoweringDotResult | CoweringDotResult | 6 |
| calcAliceCoweringDot | calcCoweringDot | 4 |
| computeBanyueAxisExFor | computeAxisActionCountsFor（函数体是通用的轴内块次数统计，与般岳无关） | 2 |
验证：残留 0；vue-tsc 0；dump/rows 对 dump-41/rows-41 零差；verify 300 文件 / 3609 条。

**CC-43b 判据 23 口径**（`scripts/lib/core-role-field-ratchet.mjs` 判据 23 段）
- 范围：git ls-files src/core、src/composables/resourceCalc、useResourceCalc.ts 中的 .ts，排除 __tests__。
- 匹配：标识符按驼峰切段（`camelSegments`），任一段小写后等于角色前缀即计 1。只数代码，注释和字符串字面量不计。切段匹配让 `teamBenefit`/`basicBenchmarkMoveId` 不再撞 `ben`，无需撞词表。
- 前缀排除 `trigger`（英文通用词，判据 22 已用豁免表处理）。豁免 `autoYidhariAxis`：configStore 用户持久化配置键，改名需存档迁移，编排层只读。
- 判据 22 不动：它是 0 的硬门，扩口径会破坏硬门语义。所以另立判据 23。
- 基线 13（RATCHET_BURNDOWN「core 角色名中缀/子目录」frozen 13 / target 0 / due 2026-12-31）。检查项数 22→23（checkGuards.test 的 toHaveLength 同步）。
- 验证：check-guards 23 项通过；反向变异（skillRows.ts 追加 `probeLiuyinX`）报 14/13 并点名文件，还原后绿；checkGuards.test 139 条；vue-tsc 0；verify 3613 条。

**还款卡（按建议顺序，每张做完把 CORE_ROLE_INFIX_BASELINE 与 frozen 同步下调，读数必须相等）**
1. **CC-43d（最简单，先做）**：`computeRemielleEntryPanel`（`resourceCalc/panelPhases.ts:680`；helpers.ts 66/78 re-export；useResourceCalc.ts 86/152 对 3 个槽位全调用）。注释写的是「只吃自身被动/命座/音擎/驱动盘、不吃队友战内拐力的进场记录面板」。**先读函数体**：若无蕾米专属逻辑，就零差改名 `computeEntrySnapshotPanel`（−5，dump/rows 应零差）；若有专属分支，把专属部分迁 remielle 模块，再改名。
2. **CC-43e**：`roundInputs.ts:187` `hasLiuyin = findSlotByIdentity(configStore, catalogStore, ['1481']) >= 0`，用于跳过 `act.promoteVariant` 轴块。建议 `AgentMechanicModule` 加声明字段 `ownsPromoteVariantAxisBlocks?: true`（liuyin 模块声明），roundInputs 改为 `team.some(m => getAgentMechanic(m.agentId)?.ownsPromoteVariantAxisBlocks)`（注意 agentId 棘轮：不要写 `x.agentId===y.agentId`）。−2，应零差。代码注释（约 183-186 行）早已写明这个缺口。
3. **CC-43f**：`roundInputs.ts:205-215` 的 `'sigrid-pozhen'` 展开（`SIGRID_LANCE_SEGMENT_IDS` 值导入 + C6 ×0.75）。建议加模块钩子 `expandAxisAction?(act, ctx): AxisAction[] | undefined`，由 sigrid 模块实现，roundInputs 按 act.slot 的 agentId 派发。−2。同段还有 `'norma-hat-chain'` 字面量（字符串不计数），可一并评估。语料是否覆盖希格莉德破阵轴要先做反向变异确认，覆盖不到就补单测。
4. **CC-43c**（最难，放最后；编号沿用架构表，本节按难度排序）：`computeLiuyinHugCounts` 被 convergence.ts（52 import、332 调用）和 ultimatePromote.ts（13 import、294 调用）按值导入。它是琉音「好评→转大」的阈值结转算法。方向：挂到 liuyin 模块能力（如 `promoteHugCounts`），编排层经 getAgentMechanic 取。−4。ultimatePromote.ts 同时导入的 `resolveUltimateTargetSlot` 不计数，但属同类债，可一并处理。

**下一步**：CC-43d（见上 1）。
### 5.48 CC-43d/e done（lead-arena-0925c，2026-09-27 第 61 轮）

**提交**：CC-43d `afc6003`、CC-43e `7ae18b5`。判据 23 读数 13 → 8 → 6（`CORE_ROLE_INFIX_BASELINE` 与 RATCHET_BURNDOWN frozen 同批下调，读数相等）。回退：各自 `git revert`；只撤代码不撤基线会让判据 23 报红，两者在同一提交里，整提交 revert 即可。

**CC-43d**：先读了 `panelPhases.ts` 的函数体。它用本角色的 agent / 音擎 / 驱动盘 / 命座算 `calcPanel(...).inCombat`（队友 buff 传空数组），再补影画 3/5 技能等级。**没有任何蕾米埃尔分支**，所以只做零差改名 `computeEntrySnapshotPanel`（6 文件 10 处，含 MECHANICS_IMPLEMENTATION.md）。`checkGuards.test.ts` 里 `camelSegments('computeRemielleEntryPanel')` 是切段样例字符串，**故意保留**。验证：vue-tsc 0；dump/rows 对 dump-41/rows-41 零差；verify 300 文件 / 3613 条，23 guards。

**CC-43e**：`types.ts` 新增声明字段 `ownsPromoteVariantAxisBlocks?: boolean`（同 `producesInteractionTopUp` 范式），琉音模块声明 true。`roundInputs.ts#buildStackAxes` 改为 `configStore.team.some(c => !!c.agentId && getAgentMechanic(c.agentId)?.ownsPromoteVariantAxisBlocks === true)`，并删掉不再用的 `findSlotByIdentity` 导入。
- 等价依据：`findSlotByIdentity` 同时认 agentId 与 teammateBuffId，而琉音 teammateBuffId = 自身 id。
- 验证：vue-tsc 0；agentId 棘轮不变；dump/rows 零差。反向变异（琉音声明改 false）后 rowsnap 出差 15 键，全是含 1481 的队伍（如 auto-1051-1481-1451/*、auto-1591-1481-1211/*），语料覆盖到了。**但 liuyin / giftAxis / promote 单测 27 条对此变异全绿**：单测层没有锁「无声明者时跳过 promoteVariant 块」，靠 rowsnap 兜底。可选补测见下一步 3。
- verify：见 `/home/kaua/calc-arch/verify43e.log`。

**下一步（按顺序）**
1. **CC-43f**：`roundInputs.ts` 约 205-215 行的 `'sigrid-pozhen'` 展开（`SIGRID_LANCE_SEGMENT_IDS` 值导入 + C6 时长 ×0.75）。建议在 `AgentMechanicModule` 加钩子 `expandAxisAction?(act, ctx): StackActionCost[] | undefined`，ctx 给 `{ skills, cinemaLevel }`（由编排层按 act.slot 取），sigrid 模块实现并返回三段；roundInputs 按 `configStore.team[act.slot]?.agentId` 派发，返回非 undefined 时 push 并 continue。判据 23 −2（6→4）。**先做反向变异**确认语料是否覆盖希格莉德破阵轴（perf 语料里有 auto-1591-* 队伍）；覆盖不到就补单测。同段的 `'norma-hat-chain'` 字面量是字符串、不计数，可顺手评估能否用同一钩子。
2. **CC-43c**：`computeLiuyinHugCounts` 被 convergence.ts 与 ultimatePromote.ts 按值导入（计 4）→ 琉音模块能力。开工前先读 `docs/mcp-liuyin-promote-source.md` 与 ultimatePromote.ts 全文，这是最复杂的一张。
3. 可选补测：单测锁住「队里无 promoteVariant 声明者时，轴里的 promoteVariant 块不产出终结技行」（CC-43e 的反向变异在单测层是绿的）。

### 5.49 CC-43f done：希格莉德破阵展开 → 模块钩子 expandAxisAction（lead-arena-0925c，2026-09-27 第 62 轮）

**提交**：`cf5f270`（mechanics/types.ts、agents/sigrid.ts、resourceCalc/roundInputs.ts、新测试 `src/mechanics/__tests__/sigridExpandAxis.test.ts`、棘轮 lib/check-guards 6→4）。回退：`git revert cf5f270`（代码与基线同提交，整体撤销不会让守卫报红）。

**改法**
- `AgentMechanicModule` 新钩子 `expandAxisAction?(input: { slot, moveId, count, startTime, cinemaLevel, actionTimeOf }): StackActionCost[] | undefined`。返回 undefined 表示「不是我的伪块」，走通用路径。`actionTimeOf` 由编排层提供，因为判据 19 禁止 mechanics 按值导入 composables，模块里不能直接调 `findMoveById`。
- sigrid.ts 新增导出函数 `expandSigridAxisAction`：`SIGRID_POZHEN_MOVE_ID` → `SIGRID_LANCE_SEGMENT_IDS` 三段，C6 时长 ×0.75，免费。逐位照搬原内联实现。
- roundInputs.ts：删掉 `'sigrid-pozhen'` 内联分支与 `SIGRID_LANCE_SEGMENT_IDS` 值导入，改为按 `configStore.team[act.slot].agentId` 派发钩子。
- **语义细微差别（有意接受）**：原实现只看 moveId，破阵伪块放在非希格莉德槽位也会展开（此时查的是那个槽的技能表，时长为 0）；现在只有块所在槽是希格莉德才展开，否则走通用路径。预设和轴编辑器都把破阵块放在希格莉德槽，所以零差（见下）。若日后要恢复旧行为：在 roundInputs 按 moveId 遍历所有模块的钩子即可。

**验证**
- 判据 23 读数 4/4；23 guards；vue-tsc 0；sigrid + sigridExpandAxis 32 条（新增 4 条：C0 三段与时长、C6 ×0.75、非伪块返回 undefined、模块已挂钩子）。
- dump/rows 对 dump-41/rows-41 零差。反向变异结论见下「语料覆盖」。
- `npm run verify` 通过：301 文件 / 3617 条，23 guards（`/home/kaua/calc-arch/verify43f.log`）。

**语料覆盖**：反向变异（钩子恒返回 undefined）后 rowsnap 出差 **8 键**，全是含希格莉德 1591 的队伍（auto-1591-1481-1211/*、auto-1591-1481-1311/* 等），语料覆盖到了这条路径；另有 4 条钩子单测直接锁定展开结果。

**判据 23 剩余 4**：只剩 CC-43c（`computeLiuyinHugCounts` 被 convergence.ts:52/332 与 ultimatePromote.ts:13/294 按值导入）。

**下一步**
1. **CC-43c**（最后一张，最复杂）。开工前先读 `docs/mcp-liuyin-promote-source.md`、`src/composables/resourceCalc/ultimatePromote.ts` 全文、`src/mechanics/agents/liuyin.ts` 的 `computeLiuyinHugCounts`（约 102 行）。方向：琉音模块声明能力（如 `promoteHugCounts(goodReviewTotal, stunCount, hug60Setting, targetChainTotal)`），编排层通过「拥有 promoteVariant 的模块」取（可复用 CC-43e 的 `ownsPromoteVariantAxisBlocks` 找槽）。ultimatePromote.ts 同时导入的 `resolveUltimateTargetSlot` 不计数，但属同类债，建议一并迁。做完判据 23 归 0，然后与判据 22 一样宣布硬门（BASELINE 0 / frozen 0 / target 0，checkGuards.test 同步）。
2. 可选补测：单测锁「队里无 promoteVariant 声明者时，轴里的 promoteVariant 块不产出终结技行」（CC-43e 反向变异在单测层是绿的，靠 rowsnap 兜底）。
### 5.50 CC-43c done：琉音转大次数算法 → 模块能力 promoteHugCounts；判据 23 清零转硬门（lead-arena-0925c，2026-09-27 第 63 轮）

**提交**：`4f3d1ea`（mechanics/types.ts、agents/liuyin.ts、resourceCalc/ultimatePromote.ts、resourceCalc/convergence.ts、新测试 `src/composables/__tests__/promoteHugCapability.test.ts`、棘轮 lib/check-guards 4→0）。回退：`git revert 4f3d1ea`（代码与基线同提交）。

**改法**
- `AgentMechanicModule` 新能力 `promoteHugCounts?(goodReviewTotal, stunCount, hug60Setting, targetChainCountTotal?) => { hug60, hug90, remainingGoodReview }`。琉音模块直接挂 `computeLiuyinHugCounts`（同一函数引用 ⇒ 逐位零差）。
- ultimatePromote.ts 新导出 `promoteHugCountsOf(configStore)`：用 `ultimateGiftProviderSlot`（CC-35 能力 `ultimateGiftSource` 找槽）取提供者模块的 `promoteHugCounts`；无提供者返回 undefined。
- 调用点一 promoteFixpoint（非轴路径）：`promoteHugCountsOf(configStore)?.(...) ?? { hug60: 0, hug90: 0 }`。p 非空意味着一定有提供者，兜底只防提供者没实现该能力。
- 调用点二 convergence 轴模式「剩余好评默认 90」：`hug` 为 undefined 时 h60/h90 保持轴声明值（不覆盖）；有琉音时与原实现一致。
- **找槽口径的选择**：用「赠大提供者」（ultimateGiftSource）而不用 CC-43e 的 `ownsPromoteVariantAxisBlocks`，理由是好评本来就来自提供者，promoteFixpoint 的 p 也由它构建，两者同源。现在两者都只有琉音实现，没有差别。
- **不动的部分**：`resolveUltimateTargetSlot` 仍从 liuyin.ts 按值导入（ultimatePromote、convergence、norma.ts、chainGift.ts）。它不计入判据 23（名字里没有角色段），但属同类债，见「下一步」2。

**验证**
- 判据 23 读数 0/0，23 guards；vue-tsc 0；promoteHugCapability 3 条 + liuyin 等相关 30 条通过。
- dump/rows 对 dump-41/rows-41 零差（DIFF 0）。
- 反向变异（琉音模块 `promoteHugCounts: undefined`）：rowsnap 出差 **118 键**，全是含琉音 1481 的队伍（auto-1371-1481-1451/* 等）；新单测 2/3 失败。恢复后 cmp 一致。
- `npm run verify` 通过：302 文件 / 3620 条，23 guards（`/home/kaua/calc-arch/verify43c.log`）。

**判据 23 状态**：清零，与判据 22 一样是硬门。以后新增任何带角色前缀段的标识符（编排层 / core），check-guards 会直接报红，改用模块能力。

**下一步**（CC-43 系列已全部完成）
1. 可选补测：单测锁「队里无 promoteVariant 声明者时，轴里的 promoteVariant 块不产出终结技行」（CC-43e 遗留）。
2. `resolveUltimateTargetSlot` 从 liuyin.ts 迁到共享位置（如 `src/mechanics/ultimateTarget.ts` 或 core/resource），4 个导入点（ultimatePromote.ts、convergence.ts、norma.ts、chainGift.ts）一起改；纯移动，dump/rows 应零差。
3. 遗留未决：giftedPolarAssaultCount 多槽求和语义、×1.2 系数低冲击配装集成覆盖、CC-11b（暂缓）。
### 5.51 CC-44 done：resolveUltimateTargetSlot 迁 core/resource/targetSlot.ts（lead-arena-0925c，2026-09-27 第 64 轮）

**提交**：`50f09d7`。新文件 `src/core/resource/targetSlot.ts`、测试 `src/core/__tests__/targetSlot.test.ts`（3 条）；改 liuyin.ts（删定义、改为从 core 导入）、norma.ts、resourceCalc/ultimatePromote.ts、convergence.ts、chainGift.ts（导入路径）、core/resource/crossAgentSupply.ts。回退：`git revert 50f09d7`。

**决定与依据**
- 函数名保留 `resolveUltimateTargetSlot`：名字里没有角色段，判据 23 不计数；改名只会扩大改动面，不带来收益。
- 放在 core/resource 而不是 mechanics 共享文件：它是纯槽位算术，core 的 crossAgentSupply 也要用（原来因为「引擎不 import 角色模块」只好内联了一份 `(providerSlot - 1 + teamSize) % teamSize`）。mechanics → core 按值导入是允许的方向（liuyin/norma 本来就导入 `@/core/damage`）。
- crossAgentSupply 的缺省落点改为 `resolveUltimateTargetSlot(providerSlot, teamSize, -1)`：teamSize ≥ 1 时与原内联式逐值相同（单人队两式都得 0）。
- liuyin.ts **不做 re-export**：旧路径全部改完（`grep -rn resolveUltimateTargetSlot src` 只剩 core 路径导入），不保留兼容层。

**验证**
- 23 guards；vue-tsc 0；targetSlot/liuyin/norma/chainGift/crossAgent 相关 40 条通过。
- dump/rows 对 dump-41/rows-41 零差。
- 反向变异（自动落点改为「下一位」）：rowsnap 出差 **189 键**（含诺玛 1571、琉音 1481 队伍），恢复后 cmp 一致。
- `npm run verify` 通过：303 文件 / 3623 条，23 guards（`/home/kaua/calc-arch/verify44.log`）。

**现状**：编排层（src/composables/resourceCalc）已**没有任何**对 `@/mechanics/agents/*` 的按值导入（除测试外）。复核命令：`grep -rn "from '@/mechanics/agents" src/composables src/core | grep -v __tests__`。2026-09-27 读数只有 1 条：`resourceCalc/anomalyPanels.ts:395 export type { VoidflareDamageInput } from '@/mechanics/agents/remielle'`，是纯类型转出，运行时不产生依赖，可以接受。除此之外若再出现新条目，就是新的同类债。

**下一步**
1. 可选补测（CC-43e 遗留）：单测锁「队里无 promoteVariant 声明者时，轴里的 promoteVariant 块不产出终结技行」。入口在 `src/composables/resourceCalc/roundInputs.ts` 的 ownsPromoteVariantAxisBlocks 判定处；目前靠 rowsnap 兜底。
2. 考虑把上面那条 grep 升格为守卫（「编排层禁止按值导入 mechanics/agents/*」）：口径只抓按值 import，排除 `import type` / `export type`，当前读数应为 0；在 scripts/check-guards.mjs 加一条硬门判据 24，同步 checkGuards.test。
3. 遗留未决：giftedPolarAssaultCount 多槽求和语义、×1.2 系数低冲击配装集成覆盖、CC-11b（暂缓）。
### 5.52 CC-45 done：判据 24 — 编排层 + core 禁按值依赖角色模块（硬门）（lead-arena-0925c，2026-09-27 第 65 轮）

**提交**：`bf971b3`（scripts/lib/layer-import-ratchet.mjs 末段新增 `findRoleModuleValueDeps` / `scanRoleModuleValueDeps` / `ROLE_MODULE_DEP_DIRS` / `ROLE_MODULE_DEP_BASELINE=0`；scripts/check-guards.mjs 接线 + 转出；scripts/check-guards.d.mts 声明；src/scripts/__tests__/checkGuards.test.ts 条数 23→24 + 新 describe 3 条）。回退：`git revert bf971b3`（纯守卫，不碰 src 运行时代码）。

**为什么要立（判据 12 不够的两点）**
1. 判据 12 只量 `src/core/**`；编排层 `src/composables/**` 对 `@/mechanics/agents/*` 的值导入以前没人看守。CC-43c/CC-44 清完后实测为 0，趁 0 立硬门，防止回潮。
2. 判据 12 的正则 `CORE_ROLE_IMPORT_RE` 是**单行**的（`import` 与 `from` 必须同行），多行 `import {\n a,\n} from '…'` 看不见。判据 24 按**整条语句**匹配（字符类 `[^;'"]` 可跨行），并计入 `export … from`、裸 `import '…'`、动态 `import('…')`、相对路径 `../mechanics/agents/`。
- 与判据 12 在 core 上重叠：决定**保留判据 12 不动**（改它的正则属于换尺，按规则 17② 要单独成批，而判据 24 已覆盖其盲区，收益为零）。日后若想合并，把判据 12 改为调用 `scanRoleModuleValueDeps` 并限定到 `src/core` 即可。

**口径细节（拍板）**
- 豁免：`import type` / `export type`（整条语句级 type-only）、注释行、测试文件（`__tests__` / `.test.ts`）。
- `import { type X } from '…agents/…'`（内联 type 修饰）**仍计**：保守口径，要豁免就整条写 `import type`。
- `@/mechanics`（注册表）和 `@/mechanics/types` 不计，只有 `mechanics/agents/<角色>` 才计。
- 当前唯一的 type-only 条目：`resourceCalc/anomalyPanels.ts:395 export type { VoidflareDamageInput } from '@/mechanics/agents/remielle'`，豁免。
- 只扫 `.ts`：`src/composables` 下目前没有 `.vue`；展示层（views/components）由判据 7 管。

**验证**
- check-guards：24 guards，`role-module value-dep gate … = 0/0`。
- 反向：往 chainGift.ts 末尾追加一条**多行**值导入 → 判据 24 报红 `1/0` 并定位到 `chainGift.ts:120 [import]`；恢复后 cmp 一致。
- 单测：检测器正控 6 条、负控 6 条（type-only 单行/多行、export type、注释、注册表、types）+ 临时目录扫描器 + 仓库读数 == 0。
- 第一次跑时死通道判据 C 类报 4 条「.d.mts 漂移」，tsc 报 TS2305：**check-guards.mjs 新增转出必须同步 `scripts/check-guards.d.mts`**（已补）。这是已知坑，写在这里备查。
- vue-tsc 0；`npm run verify` 通过：303 文件 / 3626 条，24 guards（`/home/kaua/calc-arch/verify45.log`）。

**下一步**
1. 可选补测（CC-43e 遗留）：单测锁「队里无 promoteVariant 声明者时，轴里的 promoteVariant 块不产出终结技行」。入口在 `src/composables/resourceCalc/roundInputs.ts` 的 `ownsPromoteVariantAxisBlocks` 判定处；目前靠 rowsnap 兜底。做法：用 setupHarness 组一个无琉音、但轴里含 promoteVariant 块的队伍（先 grep 预设 `promoteVariant` 找块形态），断言终结技行里没有转大行；再反向变异（去掉 owns 判定）看它变红。
2. 判据 7（展示层越层 14）是剩下最大的棘轮债，但 plan 里写明全是真引擎调用，需要逐条设计，不适合机械清理。
3. 遗留未决：giftedPolarAssaultCount 多槽求和语义、×1.2 系数低冲击配装集成覆盖、CC-11b（暂缓）。
### 5.53 CC-46 done：补测「无转大块声明者时跳过 promoteVariant 轴块」（lead-arena-0925c，2026-09-27 第 66 轮）

**提交**：`d655e9c`，新测试 `src/composables/__tests__/promoteVariantSkip.test.ts`（2 条），不改源码。回退：`git revert d655e9c`。

**测法**
- 直测 `createConvergenceRoundInputs(...).buildStackAxes(axes)`（构造方式照搬 `src/mechanics/__tests__/nextRoundFeedbackR19.test.ts`）。
- 探针轴：slot0 般岳终结技 `1471021` 两块，一块普通（startTime 0），一块 `promoteVariant: '60'`（startTime 3）。
- 有琉音队 [1471, 1481, 1211]：两块都保留，转大块 decibelCost = 0，普通块 > 0。
- 无琉音队 [1471, 1311, 1211]：只剩普通块（startTime 0）。
- 同 moveId 的普通块是对照组，证明跳过只针对 promoteVariant。

**为什么不走整管线（踩坑，已实测）**：第一版用 `useResourceCalc().stackTraversalResult.executed` 断言。有琉音队里只含转大块的探针轴被求解器判为不可行（solveTeam.ts 的 overBudget / topUpIllegal 分支）⇒ `forceNoAxis` 退回非轴态 ⇒ `calcOutput.resolvedAxes = []` ⇒ `stunAxisResult`、`stackTraversalResult` 都是 null。整管线断言测到的是求解器回退，不是跳过判定。以后给轴相关判定补单测，优先直测 `buildStackAxes` / `resolveAxes`（createConvergenceRoundInputs 已导出）。

**验证**
- 反向变异 1：roundInputs.ts 跳过判定改为 `if (false && …)` ⇒「无琉音」那条红；恢复后 git diff 为空。
- 反向变异 2：liuyin.ts `ownsPromoteVariantAxisBlocks: true → false` ⇒「有琉音」那条红；恢复后 cmp 一致。
- vue-tsc 0；`npm run verify` 通过（`/home/kaua/calc-arch/verify46.log`，读数见 coord 第 66 轮）。

**下一步（按优先级）**
1. 剩下最大的棘轮债：判据 7「展示层越层 import」14 处（`scripts/check-guards.mjs` RATCHET_BURNDOWN 该条的 plan 列了明细：getAgentMechanic×4 / buildTeammateBuffSourceContext×2 / calcPanel / applyTargetedStat / allocateAxisWindows / computeOptimalSubStats+getTemplate / readImpactVar+writeImpactVar / agentSpecs / computeBanyueMingw…）。都是真引擎调用，做法是编排层（composables）包一层只读 API，view 改为调它。建议先挑 `getAgentMechanic×4`：逐个看 view 用它读什么，在 composables 里加一个返回纯数据的 computed，每迁一处就下调 `EXHIBITION_LAYER_IMPORT_BASELINE` 和 frozen（与代码同批提交）。
2. 遗留未决：giftedPolarAssaultCount 多槽求和语义、×1.2 系数低冲击配装集成覆盖、CC-11b（暂缓）。
### 5.54 CC-47 done：判据 7 展示层越层 14→10（getAgentMechanic×4 → 编排层门面）（lead-arena-0925c，2026-09-27 第 67 轮）

**提交**：`79f0f6b`。新文件 `src/composables/agentMechanicView.ts`、测试 `src/composables/__tests__/agentMechanicView.test.ts`（3 条）；改 ResourceUtilizationPage.vue（mechanicSettings）、ImpactChart.vue（settingMap）、StunAxisPage.vue（combos）、ResourceResultCard.vue（specialResourceSections）；`EXHIBITION_LAYER_IMPORT_BASELINE` 与 RATCHET_BURNDOWN「展示层越层 import」.frozen 14→10（同批），plan 里删掉 `getAgentMechanic×4`。回退：`git revert 79f0f6b`。

**做法**：门面只转发模块的**声明式数据**，不计算、不缓存。
- `teamMechanicSettings(team)`：按 setting.id 去重、先出现的槽位优先。原来两处（ResourceUtilizationPage 的 flatMap+seen、ImpactChart 的 `!map.has`）口径相同，合成一份。
- `agentCombos(agentId)`：返回模块 combos 的同一引用。
- `agentResourceSections(agentId, input)`：按方法调用 `mod?.resourceSections?.(input) ?? []`，保留 this 绑定。
- 类型仍可 `import type` 自 '@/mechanics/types'，判据 7 豁免 type-only。

**验证**：判据 7 读数 10/10，24 guards；vue-tsc 0；新单测 3 条（与注册表直读逐位对比）；`npm run verify` 通过：305 文件 / 3631 条，24 guards（`/home/kaua/calc-arch/verify47.log`）。纯转发改写，运行时计算路径不变（这 4 处都只在展示层读声明），所以没跑 dump/rows。

**判据 7 剩余 10 处（2026-09-27 实测，复核脚本 `/home/kaua/calc-arch/ex7.mjs`，调用 layer-import-ratchet 的 detectExhibitionLayerImport 逐行扫）**
- MechanicsTablePage.vue:172 `agentSpecs`（@/specs/registry）
- StunAxisPage.vue:251 `allocateAxisWindows`（@/core/stunAxisStack）；:252 `computeBanyueMingwangBlocks, BANYUE_AXIS_MOVE_META`（@/mechanics/agents/banyue）；:253 `computeYixuanNingshenBlocks`（@/mechanics/agents/yixuan）
- TeamConfigPage.vue:876 `calcPanel`；:877 `applyTargetedStat`；:878 `buildTeammateBuffSourceContext`
- ImpactChart.vue:127 `IMPACT_VARIABLES, readImpactVar, writeImpactVar`；:130 `computeOptimalSubStats, getTemplate`；:131 `buildTeammateBuffSourceContext`

**下一步（按性价比）**
1. **StunAxisPage 的两个角色模块导入**（banyue/yixuan，:252/:253）：页面直接调角色专属函数画轴块，本质是角色分支长在页面里。做法：在 types.ts 加模块能力（例如 `axisOverlayBlocks?(input)`，返回块列表），banyue/yixuan 实现，门面加 `agentAxisOverlayBlocks`，页面按槽位派发。先读 StunAxisPage 里这两个函数的调用点和入参（grep computeBanyueMingwangBlocks / computeYixuanNingshenBlocks），确认入参是否能统一。`BANYUE_AXIS_MOVE_META` 是常量，可经模块声明字段暴露。每清一处，判据 7 基线同批下调。
2. `buildTeammateBuffSourceContext` ×2（TeamConfigPage + ImpactChart）：同一函数，可在编排层包一层后两处一起迁，−2。
3. 其余（calcPanel / applyTargetedStat / substatOptimizer / impactVars / allocateAxisWindows / agentSpecs）逐个评估，大多可以原样经 composables 转出。注意这种「转出」只是挪位置；要写清它是否真正降低了耦合，不要只为降读数而转出。
4. 遗留未决：giftedPolarAssaultCount 多槽求和语义、×1.2 系数低冲击配装集成覆盖、CC-11b（暂缓）。
### 5.55 CC-48 done：判据 7 10→8（StunAxisPage 角色模块值导入 → 模块能力）（lead-arena-0925c，2026-09-27 第 68 轮）

**提交**：`d98cfaf`。改 mechanics/types.ts（新能力 `axisEditorBlockMarks?(input: { axes, slot, cinemaLevel }) => Map<string, AxisEditorBlockMark>`、新声明 `axisMoveMeta?: Record<moveId, { tag, cost }>`、文件末尾新接口 `AxisEditorBlockMark { trigger, active, layers }`）；banyue.ts / yixuan.ts 挂实现（包装原 computeBanyueMingwangBlocks / computeYixuanNingshenBlocks，**原函数不动**）；composables/agentMechanicView.ts 新增 `agentAxisBlockMarks` / `agentAxisMoveMeta`；StunAxisPage.vue 删两行角色模块导入、三处调用改走门面；判据 7 基线与 frozen 10→8（plan 同步删掉这两项）；agentMechanicView.test.ts +2 条。回退：`git revert d98cfaf`。

**决定与依据**
- 统一标注形状 `{ trigger, active, layers }`：般岳映射为 active = layers > 0；仪玄 layers = 0。页面原来读般岳的 `info.layers`、仪玄的 `info.active`/`info.trigger`，字段都还在，页面逻辑一行不改。
- 门面按「该槽的 agentId」派发（`configStore.team[banyueSlot]?.agentId`），不写角色字面量；槽位为 -1 时拿到 undefined，返回空 Map（与原函数在 slot -1 时结果一致）。
- `axisMoveMeta` 的 tag 在通用类型里放宽为 string（原为 '怒' | '普'）。页面只做 `=== '怒'` 比较，不受影响。
- 页面里 `c.agentId === '1471'` 这类**角色字面量**仍大量存在（横幅、泳道、banyueSlot/yixuanSlot 查找）。这不是判据 7 的度量面，本卡不动。页面级角色分支属于 UI 设计问题，要清需要单独立卡（把横幅/泳道也做成模块声明）。

**验证**：判据 7 = 8/8，判据 24 = 0/0，24 guards；vue-tsc 0；新增单测把门面结果与原函数逐块对比（般岳 C0 / C6 满覆盖返回空、仪玄、未声明角色、空 id）；`npm run verify` 通过：305 文件 / 3633 条，24 guards（`/home/kaua/calc-arch/verify48.log`）；dump/rows 对 41 基线结果见 coord 第 68 轮（能力只供展示层用，预期零差）。

**判据 7 剩余 8 处**
- StunAxisPage.vue `allocateAxisWindows`（@/core/stunAxisStack）
- TeamConfigPage.vue `calcPanel` / `applyTargetedStat` / `buildTeammateBuffSourceContext`
- ImpactChart.vue `IMPACT_VARIABLES, readImpactVar, writeImpactVar` / `computeOptimalSubStats, getTemplate` / `buildTeammateBuffSourceContext`
- MechanicsTablePage.vue `agentSpecs`

**下一步**
1. `buildTeammateBuffSourceContext` ×2（TeamConfigPage.vue:~876 与 ImpactChart.vue:~131）：先读两处调用的入参和用途。若两处都是「拿 configStore 构造 → 传给 calcPanel/面板计算」，就在编排层（例如 `src/composables/panelContext.ts`）提供 `teammateBuffSourceContextFor(configStore, slot)` 之类的函数，两处一起改，判据 7 8→6。注意这只是挪位置，要在 census 里写明它是否真正降低了耦合。
2. `allocateAxisWindows`：useResourceCalc 已在用它，看能不能把「轴 → 各轴窗口数」作为 useResourceCalc 的 computed 暴露，页面直接读结果（真正降低耦合，−1）。
3. 遗留未决：giftedPolarAssaultCount 多槽求和语义、×1.2 系数低冲击配装集成覆盖、CC-11b（暂缓）。
### 5.56 CC-49 done：判据 7 8→6（队友 buff 来源上下文的依赖组装收拢到编排层）（lead-arena-0925c，2026-09-27 第 69 轮）

**提交**：`b285a4f`。新文件 `src/composables/teammateBuffContext.ts`（`teammateBuffSourceContextFromStores(configStore, catalogStore)`），测试 `src/composables/__tests__/teammateBuffContext.test.ts`（1 条）；TeamConfigPage.vue `getTeammateBuffSourceContext` 与 ImpactChart.vue `runOptimizerForSlot0` 改为调用它；判据 7 基线与 frozen 8→6（plan 同步删掉该项）。回退：`git revert b285a4f`。

**是否真正降低了耦合（按 §5.54 的要求写明）**：是。两个页面原来各写一份**逐字相同**的 7 项依赖组装（catalog 的 teammateBuffGroups / driveDiscSetsMap / statRules / getAgent / getWEngine + config 的 isTeammateBuffEnabled / enemy.weakness），现在「依赖从哪取」只剩一处；页面不再知道引擎函数的依赖结构。

**有意不动的两处（拍板）**
- `resourceCalc/panelPhases.ts:485`：用 `agentsMap.get` 与**快照过的** `teammateBuffEnabledOf(buffSelections, …)`，和页面口径不同，而且在计算热路径上。统一它需要先证明两种开关判断等价，收益小、风险有，不做。
- `stores/config.ts:832`：store 层不能反向依赖 composables。

**验证**：判据 7 = 6/6，24 guards；vue-tsc 0；新单测把结果与原内联组装逐值比对（[1161, 1311, 1211] 推荐配装，来源面板非空）；反向变异（新函数里 isTeammateBuffEnabled 恒 false）：单测红 1/1，恢复后 cmp 一致；`npm run verify` 通过：306 文件 / 3634 条，24 guards（`/home/kaua/calc-arch/verify49.log`）。只动展示层调用点，计算路径未变，没跑 dump/rows。

**判据 7 剩余 6 处**
- StunAxisPage.vue `allocateAxisWindows`（@/core/stunAxisStack）
- TeamConfigPage.vue `calcPanel`（@/core/panel）/ `applyTargetedStat`（@/core/buff）
- ImpactChart.vue `IMPACT_VARIABLES, readImpactVar, writeImpactVar`（@/core/impactVars）/ `computeOptimalSubStats, getTemplate`（@/core/substatOptimizer）
- MechanicsTablePage.vue `agentSpecs`（@/specs/registry）

**下一步**
1. `allocateAxisWindows`（StunAxisPage.vue:~251，调用点在 `axisTimes(ai)` 附近 `allocateAxisWindows(axes.value, stunCount)[ai]`）：先确认 useResourceCalc / convergence 里是否已按同样入参算过（convergence.ts:156/218 有 `allocateAxisWindows(resolvedAxes, stunCount)`）。注意页面用的是**编辑中的 axes**，不一定等于求解用的 resolvedAxes。若不同，就在 composables 里加纯转发 `axisWindowCounts(axes, stunCount)`，并在 census 写明「只是挪位置」；若相同，就由 useResourceCalc 暴露 computed，页面读结果（真正降低耦合）。
2. TeamConfigPage 的 `calcPanel` + `applyTargetedStat`（:1167 / :1187）：先读这段在做什么（疑似页面自己算「开关某 buff 后的面板」预览）。若 useResourceCalc 已有等价面板，就改读它；否则收拢成编排层函数，同样要写明耦合是否真的降低。
3. 遗留未决：giftedPolarAssaultCount 多槽求和语义、×1.2 系数低冲击配装集成覆盖、CC-11b（暂缓）。
### 5.57 CC-50 done：判据 7 6→5（StunAxisPage allocateAxisWindows → 编排层）（lead-arena-0925c，2026-09-27 第 70 轮）

**提交**：`7cf440d`。新文件 `src/composables/stunAxisView.ts`（`axisWindowCounts`），测试 `src/composables/__tests__/stunAxisView.test.ts`（2 条）；StunAxisPage.vue：导入改为 stunAxisView，`axisTimes(ai)` 改读 computed `axisWindowCountList`；判据 7 基线与 frozen 6→5（plan 删 allocateAxisWindows）。回退：`git revert 7cf440d`。

**是否真正降低了耦合（如实写）**：**没有**，`axisWindowCounts` 是纯转发，只是把依赖挪到编排层。改不成「读 useResourceCalc 现成结果」的原因：页面 `axes` 在手动模式下是**编辑中的** `configStore.stunAxes`（StunAxisPage.vue:~281），而求解侧 `calcOutput.resolvedAxes` 在求解器回退（forceNoAxis）时会被清空，两者不总相等。
**顺带的实际改进**：原 `axisTimes(ai)` 每次调用都重算整组分配，而且在 `allMoves` 的逐动作循环里被调用了 8 处；现在缓存为 computed，每次渲染只算一次，结果逐值相同。

**验证**：判据 7 = 5/5，24 guards；vue-tsc 0；新单测 2 条（口径 + 与 core 逐值一致）；`npm run verify` 通过：307 文件 / 3636 条，24 guards（`/home/kaua/calc-arch/verify50.log`）。只改展示层，计算路径未变，没跑 dump/rows。

**判据 7 剩余 5 处**
- TeamConfigPage.vue:~876 `calcPanel`（@/core/panel）、:~877 `applyTargetedStat`（@/core/buff）
- ImpactChart.vue `IMPACT_VARIABLES, readImpactVar, writeImpactVar`（@/core/impactVars）、`computeOptimalSubStats, getTemplate`（@/core/substatOptimizer）
- MechanicsTablePage.vue `agentSpecs`（@/specs/registry）

**下一步（已读过代码，可以直接开工）**
1. **TeamConfigPage 局外面板 → 编排层（判据 7 −2，真正降低耦合）**。`currentPanel` computed（TeamConfigPage.vue:~1146）分两支：局内已调用编排层 `computePanel(configStore.selectedSlot, configStore, catalogStore)`（`@/composables/resourceCalc/helpers` 转出，定义在 panelPhases.ts:92）；**局外**这支是页面自己算的：`getTeammateBuffSourceContext()` → `calcPanel(agent, wEngine, char.driveDisc, driveDiscSetsMap, enabledTeammateBuffs, statRules, { cinemaLevel, wEngineModLevel, sourcePanelsByOwner, effectCoverageMap: configStore.getWEngineEffectCoverageMap(), enemyWeakness })` → 取 `.outOfCombat` 拷贝 → 对 `configStore.globalBuffs` 中 enabled 的逐条 `applyTargetedStat(panel, stat, value, statSettlementMode(stat), targetSkillType)`。
   做法：在 panelPhases.ts 的 computePanel 旁边新增 `computeOutOfCombatPanel(slot, configStore, catalogStore): PanelValues | null`，把这段逐行搬过去（buff 来源上下文用 CC-49 的 `teammateBuffSourceContextFromStores`；`statSettlementMode` 先查它从哪来，在页面 import 里找），经 helpers.ts 转出；页面局外分支改成一行调用，删掉 calcPanel/applyTargetedStat 两个导入，判据 7 5→3（基线与 frozen 同批）。
   验证：新单测对比「页面原算法」（在测试里照抄一份内联实现）与新函数，至少一队且开启一条 globalBuff；反向变异：跳过 globalBuffs 让测试变红。
2. ImpactChart 的 impactVars / substatOptimizer、MechanicsTablePage 的 agentSpecs：逐个评估是否有编排层等价物。不要做纯转发来凑读数；做不到真正降低耦合的，就在 census 里写明保留理由，并把判据 7 的 target 调成最终值。
3. 遗留未决：giftedPolarAssaultCount 多槽求和语义、×1.2 系数低冲击配装集成覆盖、CC-11b（暂缓）。
### 5.58 CC-51 done：判据 7 5→3（TeamConfigPage 局外面板 → 编排层）（lead-arena-0925c，2026-09-27 第 71 轮）

**提交**：`baceb72`。新文件 `src/composables/outOfCombatPanel.ts`（`computeOutOfCombatPanel(slot, configStore, catalogStore)`），测试 `src/composables/__tests__/outOfCombatPanel.test.ts`（2 条）。TeamConfigPage.vue：局外分支改为一行调用；删掉 calcPanel / applyTargetedStat / teammateBuffSourceContextFromStores 三个导入和已无调用的 `getTeammateBuffSourceContext`；statMeta 导入去掉 `statSettlementMode`（注释同步说明结算口径已搬走）。判据 7 基线与 frozen 5→3（plan 删这两项）。同批改 `src/utils/__tests__/statModeParity.test.ts` ②c：「全局 Buff 结算位必须用 statSettlementMode」这条源码锁的调用点，从 TeamConfigPage.vue 改指 `src/composables/outOfCombatPanel.ts`（正则不变）。⚠ 已知坑：第一次 verify 就是这条红的；以后搬动带源码锁的代码，先 `grep -rn '<文件名>' src/**/__tests__` 找锁。回退：`git revert baceb72`。

**是否真正降低了耦合**：是。页面的两种面板模式现在都只调编排层（局内 `computePanel` / 局外 `computeOutOfCombatPanel`），页面不再知道面板怎么算、全局 Buff 按什么口径结算。算法逐行照搬，未改口径（全局 Buff 仍按结算口径 `statSettlementMode`）。

**验证**：判据 7 = 3/3，24 guards；vue-tsc 0；新单测：三个槽位都与原页面内联算法逐值相等，含一条启用 + 一条禁用的全局 Buff，并断言启用的 Buff 确实改变了面板；空槽返回 null。反向变异（全局 Buff 一律跳过）⇒ 单测红，恢复后 cmp 一致。`npm run verify` 通过：308 文件 / 3638 条，24 guards（`/home/kaua/calc-arch/verify51.log`）。只改展示层取数路径，没跑 dump/rows。

**判据 7 剩余 3 处及评估（拍板）**
| 位置 | 导入 | 评估 | 决定 |
|---|---|---|---|
| ImpactChart.vue:~130 | `computeOptimalSubStats, getTemplate`（@/core/substatOptimizer） | 只在 `runOptimizerForSlot0`（:~365）用：取 agent/wEngine → buff 来源上下文 → getTemplate → computeOptimalSubStats。可整体收拢为编排层函数，和 CC-51 同类，能真正降低耦合 | **下一张 CC-52** |
| ImpactChart.vue:~127 | `IMPACT_VARIABLES, readImpactVar, writeImpactVar`（@/core/impactVars） | 组件自己在做「按变量扫描 → 写 configStore → 重算」（:~190 allVars、:~222 read、:~236 write）。把扫描逻辑抽成编排层扫描函数是真实改进，但牵涉组件的渐进渲染和计时，工作量中等 | CC-53，排在 CC-52 后 |
| MechanicsTablePage.vue:~172 | `agentSpecs`（@/specs/registry） | 只读数据注册表，用来列机制表（:~197 map、:~205 filter）。能做的只有纯转发，耦合不会降低 | **最低优先级**：CC-52/53 做完后再决定是纯转发并如实标注，还是在 RATCHET_BURNDOWN 里把 target 定为 1 并写明永久保留理由 |

**下一步（CC-52，可直接开工）**
1. 读 ImpactChart.vue 的 `runOptimizerForSlot0`（:~365 起，约 40 行）全文，确认 `computeOptimalSubStats` 的入参里哪些来自组件本地状态（进度回调、i18n 文案键 `optimizer.totalSteps*` 等）。
2. 在 `src/composables/` 新建 `substatOptimizer.ts`，导出 `runSubstatOptimizerForSlot(slot, configStore, catalogStore, opts)`：内部完成 agent/wEngine 获取、`teammateBuffSourceContextFromStores`、`getTemplate`、`computeOptimalSubStats`；组件本地的 UI 部分（进度回调、文案）通过 opts 传入，或留在组件里。模板的 stat 数（用于选 `optimizer.totalSteps2/3/4` 文案）可作为返回值的一部分，或另导出 `substatTemplateStatCount(agent)`。
3. ImpactChart 删掉 `@/core/substatOptimizer` 导入；判据 7 基线与 frozen 3→2（同批）。
4. 验证：对照单测（测试里照抄原内联调用，比较结果）；反向变异；vue-tsc；verify。
5. 遗留未决：giftedPolarAssaultCount 多槽求和语义、×1.2 系数低冲击配装集成覆盖、CC-11b（暂缓）。
## 附录：普查脚本 census.sh

```bash
#!/bin/bash
cd /home/kaua/projects/zzz-calculator
P=$(ls src/mechanics/agents/*.ts | xargs -n1 basename | sed 's/\.ts$//' | grep -v -E '^(index|shared|types|utils|registry)' | sed -E 's/^([a-z]+).*/\1/' | sort -u | tr '\n' '|' | sed 's/|$//')
for d in src/core src/composables/resourceCalc src/composables/useResourceCalc.ts; do
  grep -rnoE "\b($P)[A-Z][A-Za-z0-9]*\b" $d --include=*.ts 2>/dev/null | grep -v __tests__
done | awk -F: '{print $1" "$3}' | sort | uniq -c
```

注意：前缀取模块文件名首个小写词，`qingyi`/`lycaon`/`anton` 等若模块文件名不同需手工补进 P；结果需人工剔除误报（如通用词前缀）。

## 附录：隧道断线记录

2026-09-26 起 MCP 端点 `paver-deskbound-angles.ngrok-free.dev` 连续多轮会话返回 ERR_NGROK_3200（隧道离线）。
断线期间无任何仓库改动；本文件恢复后首个动作落盘。

- 后续多轮会话（含 2026-09-26 离线纪律版模板）每轮开局 + 约 5 分钟重试仍为 404；本文件与 `apply.sh` 一直保存在 lead 沙箱 `/home/user/w/pending/`，恢复后首个动作执行 `apply.sh` 落盘。

## 附录 A：2026-09-26 普查失控 → WSL 停摆事故（lead-arena-0925c）

**经过**
- 12:1x 落盘本文档 `7665b74` 后，lead 前台跑普查脚本 `/home/kaua/calc-arch/census.mjs`（node，递归扫 `src/core` + `resourceCalc`）。脚本失控，`timeout 40` 没能杀掉；约 7 分钟后 WSL 服务整体无响应（`Wsl/Service/0x8007274c`）。
- lead 随后用 `run_command` 执行 `wsl --terminate Ubuntu`。这条命令一直没有返回，并使 WSL 整体卡死：文件工具报 `EIO \\wsl.localhost\...`；`run_command` 报「PTY shell did not reach its first prompt」，因为它的终端起点就是 UNC 工作区根；服务重启后 `wsl_exec` 也没有加载。
- 此后约 6 小时共 15 轮会话零改动，直到 18:35 宿主侧重启 WSL 才恢复。

**定为硬规则**（同时写入 AGENTS.md「环境安全」）
1. **禁止执行 `wsl --terminate` / `wsl --shutdown`**。杀进程只按 pid `kill -9 <pid>`；先 `ps -eo pid,etime,cmd | grep <模式>` 确认 pid。`pkill -f` 会匹配到发出命令的 shell 自身。
2. **可能耗时的 node 或 vitest 脚本禁止前台运行**。一律用 `setsid bash -c '<cmd>' > <log> 2>&1 &` 放后台，并加 `timeout -s KILL <秒>`，再轮询 log。
3. 普查类脚本用 `git ls-files` 取文件清单，不要递归 stat，也不要跟随符号链接。
4. `wsl_exec` 缺失时的退路：`run_command` + `wsl -d Ubuntu -e bash -lc "cd <项目> && ..."`（仍在 WSL 内执行）。WSL 本身卡死时这条退路也无效，只能由宿主侧管理员重启 WSL 服务。

**失控根因**：未查明。怀疑是超大文件或符号链接环。重跑普查前先执行 `find src/core src/composables/resourceCalc -name '*.ts' -size +300k` 和 `find ... -type l`。
