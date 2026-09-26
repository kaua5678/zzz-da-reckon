# R22-D1 批 1-2 裁决 + core 角色专属字段普查（交接文档）

> lane `lead-arena-0925c`，2026-09-26。本文件的结论在 MCP 隧道断线期间（ERR_NGROK_3200，跨多轮会话）推出，
> 恢复后原样落盘。**下一个会话只读本文件 + `docs/mcp-calc-core-architecture.md` 即可接着干。**

## 1. 做到哪一步

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

## 5. 普查结果

（待步骤 1 填写）

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
