# 合轴率账本归属普查（T19 阶段 0，纯读）

> 立卡：`docs/mcp-worker-task-queue.md` §3 T19（arena-F r533，起因 = CC-454 `f329335c`）。
> 仪器：`.zc/perf/t19census.perf.ts`（一次性探针，已 gitignore；166 队 = 104 预设 + 62 角色单飞）。
> 本文件**只报告事实，不改代码**；阶段 1 的设计选型见 §4。

## 1. 问题（一句话）

模块在**执行行**上写 `comboAlignRatio` 声明「这段时间可与其他操作并行」，但**引擎不读行上的比例**
抵扣团队预算——`comboAlignCredit` 只由两个账本入口产出：
`extraNecessaryAction`（雅 CC-202 模式）或 `estimateExSpecialTime`（苍角模式）。
两者不相交时，该声明是**死数据**：账本按全额 `count × actionTime` 计必要时间，前台被白占。

**实证**（CC-454）：爱丽丝（1401）的星芒圆舞曲 #3 声明 ratio = 0.749，死数据 ⇒
每队多占 18~21s 前台、伤害低估 10~20%。已修（照抄雅的模式）。

## 2. ★ 普查结果（推翻立卡时的 53/19 估算）

立卡时按**源码文本**数出「53 个模块写 `comboAlignRatio`，仅 19 个有 credit 产出口」。
**实测（真实配置 + 只看 `ratio > 0` 的前台行）：只有 5 个模块、8 个 (角色, 招式) 组合。**

| 角色 | 模块名 | credit 产出口 | 死数据行 | Σ声明秒 | 改引擎会双计 |
|---|---|---|---|---|---|
| 1451 | 卢西娅·艾洛温 | `estimateExSpecialTime` | 1 | **1121.5** | ⚠ 是 |
| 1401 | 爱丽丝 | `extraNecessaryAction`（CC-454 新加） | 1 | 134.2 | ⚠ 是 |
| 1091 | 雅 | `extraNecessaryAction` | 1 | 92.5 | ⚠ 是 |
| 1131 | 苍角·刃旗助威 | `estimateExSpecialTime` | 1 | 29.0 | ⚠ 是 |
| 1371 | 仪玄 | `estimateExSpecialTime` | 4 | 0.0 | ⚠ 是 |

**汇总：5 个模块，Σ声明 1377.2s，全部会在「引擎改读行上比例」时双计。**

### 2.1 为什么 53 → 5（口径差异，不是估算错误）

| 口径 | 计数 | 说明 |
|---|---|---|
| 源码文本 `comboAlignRatio:` 出现处 | 122 处 / 53 文件 | **含大量 `comboAlignRatio: 0`**（显式声明「不合轴」）与从 cfg 透传的赋值 |
| 实测 `ratio > 0` 的 (角色,招式) | **8 个 / 5 角色** | 只数「真的声明了并行」的 |
| 其中 `source === 'setting'` | 0 个 | 7 个 cfg 招式走 `setting`（引擎经 cfg 读比例），**不在本卡范围**（与立卡边界一致） |

**⇒ 53/19 是「写字段的模块数」，不是「死数据的模块数」**——绝大多数模块写的是 `0`（无并行）。
**本卡的实际改动面比立卡预估小一个数量级。**

### 2.2 ★ 五个模块**全部**有 credit 产出口 ⇒ 它们**不是**「漏了产出口」，而是「两套通道并存」

这是普查最重要的发现，**与立卡的假设不同**：

| 模块 | 行上声明 | 账本通道 | 两者关系 |
|---|---|---|---|
| 1091 雅 | 霜月 #3 `(actionTime−1)/actionTime` | `extraNecessaryAction` 同一比例 | **同源**（模块自己保证一致） |
| 1131 苍角 | 打年糕 #3 = 1.0 | `estimateExSpecialTime` 返回同一 `basic3At × 1.0` | **同源** |
| 1401 爱丽丝 | 星芒 #3 = 0.749 | CC-454 补的 `extraNecessaryAction`，读同一 cfg 字段 | **同源**（本次修复保证） |
| 1371 仪玄 | 4 行 = 1.0（`totalTime: 0`） | `estimateExSpecialTime` | 行 `totalTime = 0` ⇒ **声明秒 = 0，无实际影响** |
| 1451 卢西娅 | 计划外强特 = 1.0 | `estimateExSpecialTime` + `comboAlignIncludedInNecessary: false`（**NET 约定**） | **有意分离**：合轴段已从 `necessaryTime` 剔除 ⇒ credit 故意为 0 |

**⇒ 结论：当前没有「声明了却没进账本」的活跃缺陷**（爱丽丝是最后一个，已修）。
立卡担心的「53 个模块各自为政」在**实际数据面上不成立**。

## 3. 唯一仍需注意的两个边界

### 3.1 卢西娅（1451）的 Σ声明 1121.5s —— **不是缺陷，是 NET 约定的展示量**

`luciaElowen.ts:236` 的「计划外强特」行 `comboAlignRatio: 1, totalTime: count × exTime`，
`totalComboAlignTime = 同值`。同时 `:560` 声明 `comboAlignIncludedInNecessary: false`
（合轴动作已从 `necessaryTime` 剔除）⇒ 引擎**故意**不给 credit（防同一重叠双重抵扣）。

**但 1121.5s 这个 Σ 是跨 166 队累加的口径**，单队实际值 = `count × 1.167s`。
它是**展示量**（`ResourceResultCard` 的「动作/合轴」列），**不进任何预算**——设计如此。

⚠ **若要动它**，必须同时处理 `comboAlignIncludedInNecessary` 语义，否则双计（坑 21 铁律①）。

### 3.2 仪玄（1371）的 4 行 `totalTime = 0`

`yixuan.ts:745` 附近 4 个「合轴·玄墨值替换」行：`actionTime: 0, comboAlignRatio: 1, totalTime: 0`。
**声明秒 = 0 × 1 = 0** ⇒ 无害（它们是纯计数/倍率载体，不占前台）。
**别把它们当死数据去"修"**——给 0 时长的行补 credit 会凭空放宽预算。

## 4. 阶段 1 设计选型（需 lead 拍板；本阶段不改代码）

立卡给了两个候选。**基于本普查，两个候选的收益都远小于立卡预估**（活跃缺陷 = 0）：

| 候选 | 内容 | 本普查后的评估 |
|---|---|---|
| **A** | `helpers.ts` 账本直接用 `exec.comboAlignRatio` 折算，删三家模块的预留口 | **收益 ≈ 0**（三家已同源且正确）；**代价 = 必须同步删 3 个模块的预留，否则双计**（普查已点名 5/5 会双计）+ zd 全量重排 |
| **B** | 保留 `extraNecessaryAction`，由 `buildExecutions` 出口为 `fixed && ratio>0` 的行自动合成预留 | 同理收益 ≈ 0；但**多一层隐式机制**（模块写行 ⇒ 引擎悄悄改账本），与「显式声明」的现有设计相悖 |

**⇒ 建议：T19 阶段 1 不立项（前提已证伪）**，理由同 `AGENTS.md` 规则 12 阶梯①「这功能真要建吗」：

1. **活跃缺陷 = 0**（爱丽丝已修，其余 4 家同源或有意分离）；
2. **候选 A/B 都要动 5 个已正确的模块**，风险 > 收益；
3. 立卡的「53 模块」是**源码文本计数**，不是缺陷面。

**替代建议（若仍要防未来）**：把本普查的判据做成**机器护栏**——
「模块写了 `ratio > 0` 的行 ⇒ 必须有 credit 产出口（或显式声明 NET 约定）」，
在 `check-guards` 加一条判据。这样新增模块漏接线时**当场红**，而不必重构现有 5 家。

## 5. 复现

```bash
npx vitest run --config .zc/perf/vitest.perf.config.ts t19census
```

输出 = §2 的表格 + 汇总行。探针已 gitignore（`.zc/`），不随仓库分发。

## 6. 交叉复核（arena-F r534，独立探针，22:20–22:40）

> 与 §2 同题、不同仪器、同时段撞车（arena-F 22:20 在 `LANE-CLAIMS.md` 认领 T19 阶段 0，他 lane 22:25 提交 `87ce4428`）。
> 本节只补 §2 没有的事实，不改 §1–§5 的结论。探针：临时 vitest 文件 `src/core/__tests__/zzT19{census,solo}.probe.test.ts`
> （`setupHarness` + `useResourceCalc().resourceResult` 真实次数，104 预设 + 62 角色 c0/c6，各 ~9s，跑完即删；源码与数据在
> `/home/kaua/calc-arch/arenaF/r534/`：`zzT19census.probe.test.ts`、`t19-census.json`、`t19-solo.json`）。

### 6.1 数值交叉：credit 与行上声明**精确相等**（不只是「同源」）

对照字段 `characters[i].timeAllocation.comboAlignCredit`（= `helpers.ts:612` `effectiveCredits[i]`）：

| 角色 | 场景 | Σ count × actionTime × ratio | `comboAlignCredit` | 差 |
|---|---|---|---|---|
| 1401 爱丽丝 | 单人 c0 / c6 / 预设最大 | 32.813 / 44.745 / 41.762 | 32.813 / 44.745 / 41.762 | **0** |
| 1131 苍角 | 单人 c0 = c6（不在任何预设） | 34.216 | 34.216 | **0** |
| 1091 雅 | 单人 c6 / 预设最大 | 31.642 / 17.038 | 31.642 / 17.038 | **0**（c0 36.51 vs 34.076 的 +2.43 来自其他通用项） |
| 1451 卢西娅 | 单人 c0 / c6 | 2.334 / 3.501 | 0 / 0 | NET 设计（§3.1） |

⇒ 三家「同源」在数值上成立，且 credit = 1× 声明秒（不是 2×），**无双计**。

### 6.2 §2 漏掉的第 6 个命中：蕾米埃尔 1581 Radiant Turn（后台行）

`remielle.ts:680–692` `backstageAutoRows` 推的 `1581010 Special Attack: Ode to Dawn - Radiant Turn（后台）`：`comboAlignRatio: 1, totalTime: 0`，
只在**队伍**里出现（单人无后台时间 ⇒ §2 的 62 角色单飞口径看不到；104 预设里 potential 最大 31.675s/队）。
**不是缺陷**：后台行不进必要时间，不需要 credit；蕾米实测 credit 9.97 来自垂虹 `extraNecessaryAction`（CC-26），与本行无关。
但它和仪玄 4 行（§3.2）一起说明 **`comboAlignRatio` 在前台行与后台 / 0 时长行上是两种语义**（「可折扣比例」vs 展示「不占前台」）——
任何自动化护栏（§4 替代建议 / §6.4）**必须以 `totalTime > 0` 过滤**，否则蕾米会被误判为 31.7s 死数据。仅 2 角色 3 处，不值得开新字段（zd 行哈希 §8.0 #18）。

### 6.3 其他核对

- **莱卡恩 1141 pushEx 跟随行**（CC-453 边界，立卡要求单列）：104 预设 + 单人均无 `fixed && ratio>0` 行 ⇒ 不构成死数据，无需单列。
- 其余 56 角色无命中（预设 41 + 单人补齐）。
- 坑：`comboAlignCredit` 挂在 `timeAllocation` 上，探针第一版读角色结果顶层得 0，差点把爱丽丝再判成死数据——写普查前先 grep 字段挂载点。

### 6.4 对 §4 替代建议的具体化（arena-F 建议，lead 可改）

§4 建议把判据做成护栏，有两种形态：
- **静态（check-guards 判据）**：模块源码里出现非零 `comboAlignRatio` ⇒ 模块必须注册 `extraNecessaryAction` / `estimateExSpecialTime`。便宜，但**蕾米埃尔会因垂虹的产出口而碰巧通过**、从 cfg 透传的赋值要特判，且查不出「有口但数不对」。
- **动态（vitest 不变量锁，arena-F 推荐）**：`src/core/__tests__/comboAlignLedgerInvariant.test.ts`，遍历 catalog 全角色单人 c0/c6（~9s），断言
  `Σ_{fixed, ratio>0, totalTime>0} count × actionTime × ratio ≤ timeAllocation.comboAlignCredit + ε`，
  **唯一豁免 = 模块自己声明** `estimateExSpecialTime(...).comboAlignIncludedInNecessary === false`（NET，现仅卢西娅 / 照），不写 id 名单（§8.0 #16）。
  test-only、不改行形状 ⇒ 无 zd / golden / ratchet 影响；回滚 = 删文件。CC-454 那类缺陷从「靠人读数发现」变成「新模块一写就红」，是 CC-453「出口统一打标」的下一步「标了就要兑现」。
- 待 lead 拍板的只有「NET 声明 = 唯一豁免口」这个契约；按队列规则未认领 1 轮则 arena-F 下一轮按 CC-455 做动态锁。
- **已落地（r535）**：CC-455 `accc23ae` = 动态锁 `src/core/__tests__/comboAlignLedgerInvariant.test.ts`；反证（删 `alice.ts:503` 注册）红并点名 1401；T19 关闭，A / B 不做。lead 要改形态时回滚 = 删锁文件。
