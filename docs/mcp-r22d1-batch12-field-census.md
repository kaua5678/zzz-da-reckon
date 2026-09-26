# R22-D1 批 1-2 裁决 + core 角色专属字段普查（交接文档）

> lane `lead-arena-0925c`，2026-09-26。本文件的结论在 MCP 隧道断线期间（ERR_NGROK_3200，跨多轮会话）推出，
> 恢复后原样落盘。**下一个会话只读本文件 + `docs/mcp-calc-core-architecture.md` 即可接着干。**

## 1. 做到哪一步

- **最新交接（2026-09-27 第 37 轮，lead-arena-0925c）**：**CC-29 已落地 `69b53f9`**。useResourceCalc `anomalyDamageEvents` 末尾按身份 `findSlotByIdentity(['1261'])` 的简 6 命事件分支 → jane 模块 `anomalyEventRecords`（入参扩 `cinemaLevel` / `perElementTriggerCounts`）；**useResourceCalc 已无 `findSlotByIdentity`**。判据 22 从 340 降到 **332**（target 328 未达成，维持）。verify EXIT=0。详见 §5.23。
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
