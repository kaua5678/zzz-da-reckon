# R22-D1 批 1-2 裁决 + core 角色专属字段普查（交接文档）

> lane `lead-arena-0925c`，2026-09-26。本文件的结论在 MCP 隧道断线期间（ERR_NGROK_3200，跨多轮会话）推出，
> 恢复后原样落盘。**下一个会话只读本文件 + `docs/mcp-calc-core-architecture.md` 即可接着干。**

## 1. 做到哪一步

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
| resourceIncome 伊德海莉残余 | `yidhariBurnDecibel`、`yidhariDecibelPerHpPct`、`yidhariExHealMissingHpPct`、`yidhariExternalHealPct`、`yidhariChargeSlam`、`yidhariBasicFollow` | A（待逐字段核实） | 与 CC-13 同一角色、同一类「模块写数值、core 求和」的形状 | CC-14b（待立卡） |
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
