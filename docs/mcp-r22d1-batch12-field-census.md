# R22-D1 批 1-2 裁决 + core 角色专属字段普查（交接文档）

> lane `lead-arena-0925c`，2026-09-26。本文件的结论在 MCP 隧道断线期间（ERR_NGROK_3200，跨多轮会话）推出，
> 恢复后原样落盘。**下一个会话只读本文件 + `docs/mcp-calc-core-architecture.md` 即可接着干。**

## 1. 做到哪一步

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
