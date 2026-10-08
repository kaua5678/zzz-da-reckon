# 平A池 carve 只留一份实现（r742）

> 代码提交 `2a162c29`（纯重构，zd 0/0）+ `78cc9bec`（艾莲池能量双计修正，规则 10）（arena-G r742）；arch CC-524；r6 §8 第 742 行。题目来自 `docs/mcp-frontline-row-seconds.md` §11.7（r741 交接的候选）。r743 做了 §7 的候选（两份派发前行快照改为逐行拷贝），见第 8 节（`46a6353a`，CC-525）。r744 做了 §8.7 的候选（钩子入参按契约收窄），见第 9 节（`421b5b88`，CC-526）。r745 做了 §9.7 的候选（结果钩子的两份快照改必填），见第 10 节（`dc9748c0`，CC-527）。r746 做了 §10.8 的候选（卢西娅追加攻击上限的形参收窄），见第 11 节（`e02a75a9`，CC-528）。

## 1. 问题

有些模块行是从平A池时长解出来的（平A分段、循环行、以太弹、猜拳、地雷撞、转大终结技），占的就是平A那份时间。这时必须从 `basic_attack` 聚合行挤出等量时间，否则同一段时间算两份：折叠环把虚增折进 necessaryTime，平A池被挤，留白虚高。

r742 前有 7 处，各写各的：

| 位置 | 挤出的行 | 钳位写法 | 改行方式 | 池上回能 |
|---|---|---|---|---|
| `anby.ts#buildAnbyExecutions` | 平A分段 | `max(0, T − min(T, x))` | 换新对象（同一个展开里把伤害 / 失衡 / 积蓄归零） | 不动 |
| `sigrid.ts#buildSigridExecutions` | 出枪式分段 | `max(0, T − min(T, x))` | 换新对象 | 不动 |
| `ellen.ts#buildEllenExecutions` | 循环行 | `T − max(0, min(T, x))` | 换新对象 | 只缩喧响 |
| `zhuYuan.ts#buildZhuYuanExecutions` | 压制以太弹 | `T − max(0, min(T, x))` | 换新对象 | 喧响、能量都缩 |
| `liuyin.ts#buildLiuyinExecutions` | 猜拳强化A | `max(0, T − x)` | 原地改 | 不动 |
| `nangong.ts#buildNangongExecutions` | 地雷撞 | `max(0, T − x)` | 原地改 | 不动 |
| `ultimatePromote.ts#applyUltimatePromote`（轴模式） | 转大赠送的终结技 | `max(0, T − max(0, min(T, x)) + 0)` | 换新对象（在 map 里） | 不动 |

T 是聚合行时长，x 是要挤出的秒数。r741 交接时只数到 5 处，读码又找到琉音猜拳和南宫地雷撞。

不算在内的：青衣（`qingyi.ts:277`，把整池清零，回能改由醉花行自带）、伊德海莉（`yidhari.ts:225`，把聚合行改写成「蓄力（烧血）」行）都是改写整个池，不是挤出若干秒；克拉蕾、莱卡恩只改聚合行倍率，不动时间。

## 2. 回能处理是否出自同一原则

原则：挤出去的行**自己带**哪种回能，池上那种回能就按剩余时长比例缩，不缩就双计；挤出行没带的（用 `RECOVERY_OFF` 关掉，或赠行回能为 0），池上就保留——平A回能按整段平A时长记在池上，跟着缩就凭空丢了。

| 挤出的行 | 行上的回能 | 按原则池应 | r742 前 | 判定 |
|---|---|---|---|---|
| 安比平A分段 | `RECOVERY_OFF` | 不缩 | 不缩 | 符合 |
| 希格莉德出枪式段 | `RECOVERY_OFF` | 不缩 | 不缩 | 符合 |
| 琉音猜拳 | `RECOVERY_OFF` | 不缩 | 不缩 | 符合 |
| 南宫地雷撞 | `RECOVERY_OFF` | 不缩 | 不缩 | 符合 |
| 琉音转大赠行 | `buildGiftRow` 两种回能都写 0 | 不缩 | 不缩 | 符合 |
| 朱鸢以太弹 | 按表回填：喧响 7.59 / 14.025 / 37.48，能量 0.991 / 1.835 / 4.906（每次） | 都缩 | 都缩 | 符合 |
| 艾莲循环行 | 按表回填：喧响与能量都有（如 1191006 急冻修剪法#3 为 61.38 / 6.428） | 都缩 | 只缩喧响 | **不符合：能量双计** |

艾莲的来历：

- `07481b8a`（2026-09-09，能量三态回填、删 84 处硬零）把 `pushEllenExecution` 的 `energyRecovery: 0` 判为真债务删掉，从此循环行按表回填能量。倍率表里 1191006 / 1191007 / 1191009 / 1191027 / 1191028 / 1191029 / 1191030 的 energy_recovery 每次为 6.428 / 2.038 / 3.981 / 0.842 / 0.181 / 1.862 / 2.341。
- `f70a4026`（2026-09-19）加 carve 时写的是「能量不动（循环行不带回能——表值 0 落行值 0，同 sigrid 平A分段口径）」。前提不成立：sigrid 的分段行是 `RECOVERY_OFF`，艾莲的不是。
- 探针（改前，auto-1191-1361-1311 默认）：池只剩 1.361s，却记了 59.57 能量（43.8/s，平A每秒回能是 3.334）；循环行 16.508s 自己又带 68.22 能量。双计的量 = 挤出秒数 × 平A每秒回能。

## 3. 改法

### 3.1 `2a162c29`：收成一处（纯重构，8 个文件 +53 / −68）

`src/mechanics/moduleExecRow.ts` 加：

```ts
export type BasicPoolRecoveryKey = 'totalDecibelRecovery' | 'totalEnergyRecovery'

export function carveBasicPool(executions: SkillExecution[], seconds: number, scale: readonly BasicPoolRecoveryKey[] = []): void {
  const i = executions.findIndex(e => e.moveId === 'basic_attack')
  if (i < 0) return
  const row = executions[i]
  const kept = row.totalTime - Math.min(row.totalTime, seconds)
  const ratio = row.totalTime > 0 ? kept / row.totalTime : 0
  const next = { ...row, totalTime: kept }
  for (const k of scale) next[k] = (row[k] ?? 0) * ratio
  executions[i] = next
}
```

- 聚合行取第一条 `basic_attack`。它是 rowBuild 最先建的前台平A行，只在 basicAttackTime > 0 时存在。
- 回能缩不缩由调用方显式传：朱鸢传两种；艾莲在本提交里照旧只传喧响；其余 5 处不传。
- 一律换新行对象。rowBuild 给 `preModuleExecutions` 的是浅拷贝（`moduleInputRows.push(...executions)`），原地改会改到「钩子派发前」的快照。琉音、南宫原来是原地改，它们的 `preModuleExecutions` 没有读方，换成新对象观察不到差别。（r743 起快照逐行拷贝，这条理由不再成立，见 §8。）
- 调用处：安比先调 helper，再在一个展开里把伤害 / 失衡 / 积蓄归零，备注里的余量改读挤出后的行时长；艾莲、朱鸢、希格莉德的 `x > 0` 守卫和整块 findIndex 删掉；琉音、南宫各一行。
- `ultimatePromote`：原来 `basicIdx` / `carve` / `refund` 三个三元式揉在一起，拆成两支——无预留（轴模式）调 `carveBasicPool(patched, promoteTime)`；有预留时只把多留的秒数退回目标平A行（CC-145）。退还不折进 helper：用负秒数表示「退还」会让参数有两种意思。
- 锚函数动过的 4 条 @fact（engine:实战档位喧响计数、agent:1191/循环行时间占用、agent:1591/影画1溢出、agent:1241/压制以太弹时间）复核后口径不变，据 追加 `复核@2026-10-08`。

逐位理由：

- 三种钳位在 T ≥ 0、x ≥ 0 时逐位相同：x ≥ T 时都得 +0；否则都是 T − x。7 处的 x 都是非负次数乘非负时长，T 是 core 建的正时长或前面 carve 剩下的非负数。
- 缩回能的比例式与原来运算顺序相同：原式 `(d ?? 0) * (T > 0 ? (T − carve) / T : 0)`，`T − carve` 与 `kept` 逐位相同。
- 删掉 `x > 0` 守卫后 x = 0 时：kept = T，ratio = T / T = 1，d × 1 = d，值不变，只多换一个键序相同的新对象。
- ultimatePromote 挤出一支：原式末尾 `+ 0`（refund 为 0）不改变非负数；退还一支：`max(0, T − 0 + r)` = T + r。

zd DUMP 0 / ROWS 0（对 `63947eeb`）。

### 3.2 `78cc9bec`：艾莲池能量按比例缩（规则 10，6 个文件 +38 / −35）

艾莲调 helper 时多传 `'totalEnergyRecovery'`，和朱鸢以太弹同一口径。同步改：注释；`@fact agent:1191/循环行时间占用` 的口径改成「喧响与能量都按比例缩」，据 里注明 r742 订正；⟳复核 加上能量；`ellen.test` 的守恒用例改为断言能量按比例缩（原来断言 `toBe(30)`，把旧行为锁死了）；`rowAccounting.ts` 的注释补上艾莲。

差异（zd 对 `2a162c29`：DUMP 12 / ROWS 12，全在 3 支含 1191 的预设里，其余 101 支 × 5 场景逐位相同）：

| 场景 | 艾莲能量 | 艾莲强特 | 队伍总伤 |
|---|---|---|---|
| 1191-1361-1311 默认 / c0 | 478.46 → 427.00 | 11 → 10 | −1.318% |
| 1191-1361-1311 c6 | 518.75 → 487.35 | 不变 | +0.111% |
| 1191-1361-1311 w | 493.45 → 440.24 | 12 → 11 | +0.073% |
| 1191-1161-1311 默认 / c0 | 518.19 → 451.87 | 12 → 11 | −1.755% |
| 1191-1161-1311 c6 | 585.45 → 501.59 | 14 → 12 | −3.042% |
| 1191-1161-1311 w | 548.32 → 474.75 | 13 → 11 | −1.812% |
| 1191-1481-1311 默认 / c0 | 不变 | 不变 | 不变（资源结果有变） |
| 1191-1481-1311 w | 412.18 → 397.33 | 10 → 9 | +0.981% |
| 1191-1481-1311 heavy | 不变 | 不变 | −0.141% |

归因：

1. 直接原因是艾莲池能量不再双计：能量减少 15～84，强特最多少 2 次。
2. 连带：艾莲的必要时间变少，全队平A时间变多（golden：1361 队每槽 +0.330s，1161 队每槽 +1.434s），队友能量大多增加（+0.4～+11.4，只有 1161 队 c6 槽 1 −3.8），1361 强特 6 → 7。
3. 队伍总伤反升的 3 处：艾莲强特没少或少得不多，队友多出的平A时间补回来还有余。
4. 1481 队默认 / c0：最终结果里艾莲没有平A聚合行，只在中间迭代里有，所以只动了必要时间（槽 0 −0.081s），总伤不变。

基线（比对确认后重生成）：

- `timeGolden.baseline.json`（16 条，`TIME_GOLDEN_UPDATE=1`）：三支预设如上；艾莲单人 c0 / c3 / c4～c6 强特 21 → 17 / 22 → 17 / 23 → 18，平A +11.468 / +14.487 / +29.770s，留白 c3 1.317 → 0、c4～c6 0.032 → 0.171（强特取整后的余数），总伤 −2.7% / −4.6% / −2.0%。
- `timeFillRatchet.baseline.json`（`TIME_RATCHET_UPDATE=1`）：auto-1191-1481-1311 留白 0.5 → 0，外环出口 cycle → stable。
- `peiluoVerdictTruncation.test.ts`（1551 / 1011 / 1191）重冻 0.1999 → 0.1894：槽 2 艾莲能量 456.1 → 419.0、强特 11 → 10；失衡次数 3、上分支 0.4167 不变，相对断言仍成立（0.1894 < 0.2083）。

⟳复核 要求的「1191 系默认口径留白 ≤ 2s」仍成立。量化探针 `calc-arch/g742/ellen742q.perf.ts`、`peiluo742.perf.ts`（不入库），输出在同目录 `q-*.tsv`、`p-*.tsv`。

## 4. 验证

| 项 | `2a162c29` | `78cc9bec` |
|---|---|---|
| vue-tsc | 0 | 0 |
| guards / zc.test + checkGuards.test | 29 / 207 | 29 / 207 |
| tokens / data / specs / recording | 12 / 161 / 462 / 189 | 未动数据，未重跑 |
| vitest | 258/2155 + 262/2348 = 520/4503 | 同左（重生成基线后） |
| zd | 0 / 0 | 12 / 12（见 3.2） |
| build | 1599.12 → 1598.57 kB | 1598.59 kB |
| zc drift | 154 / 0 / 0 | 154 / 0 / 0 |

## 5. 不做

- 青衣、伊德海莉的整池改写不进 helper：它们不是挤出若干秒，而是整行换掉。
- `preModuleExecutions` 是浅拷贝快照，别的钩子原地改 core 行也会漏进去（见 §7）。本轮只保证 helper 自己不原地改。（r743 已改，见 §8。）
- ultimatePromote 轴模式下，目标没有前台平A行时，first-match 可能找到莱卡恩的后台 `basic_attack` 行。保持原语义，不改。
- 不为 `carveBasicPool` 单独写测试：5 个角色各自的测试和 zd 已覆盖；行为改动由 `ellen.test` 守恒用例的能量断言守住。

## 6. 回退

- 只撤艾莲能量修正：`git revert 78cc9bec`（两份基线和佩洛伊斯快照一起回去）。
- 连重构一起撤：先撤 `78cc9bec`，再 `git revert 2a162c29`。
- 文档另有提交。

## 7. 下一轮候选（r743 已做，见 §8）

**`preModuleExecutions` 不是真的「钩子派发前」快照。** `rowBuild.ts` 在调 `buildExecutions` 前 `moduleInputRows.push(...executions)`，存的是同一批行对象。钩子原地改 core 行，快照就跟着变。grep 到的原地改（`src/mechanics/agents/*.ts`，`行.字段 = …`）：青衣 :277–279、伊德海莉 :225–233、克拉蕾 :715–717、莱卡恩 :256–258、雅 :326 / :329、希格莉德 :540–544，以及 evelyn、grace、lighter、nangong :298、nicole、phoenix、roxy、seth、severian、specPanelBuffs、starlightBilly、yixuan、yuzuha 的若干处——其中一部分改的是模块自己建的行，不在快照里，要逐个分。

快照的读方现在只有 luciaElowen、青衣（排除 basic_attack）、specPanelBuffs 橘福福、qianxia，都没读到被改的字段，所以眼下没有错数。

下一步：

1. 把快照改成逐行浅拷贝（`moduleInputRows.push(...executions.map(e => ({ ...e })))`），跑 zd。0 差就说明没有读方依赖被改过的值，契约从源头成立，`carveBasicPool` 注释里「换新对象」那条可以删掉。
2. zd 不为 0，就是有读方在读钩子改过的值，逐条归因：是 bug 就按规则 10 修，是有意的就把快照语义写清楚。

## 8. r743：两份「派发前」行快照改为逐行拷贝

> 代码提交 `46a6353a`（zd 0/0）（arena-G r743）；arch CC-525；r6 §8 第 743 行。题目是 §7 的候选。

### 8.1 问题

- `rowBuild#buildExecutions` 有两个出参，各存一份行快照：
  - `moduleInputRows`：派发模块 `buildExecutions` 钩子之前；
  - `patchInputRows`：派发 `patchExecutions` 钩子之前。
- 装配层（`assembleSlot`）把它们当作 `preModuleExecutions` / `prePatchExecutions` 传给本槽模块的 `buildResourceResult`，让它复现钩子当时看到的行。
- 原实现是 `push(...executions)`：数组新建，行对象和后续行共享。钩子之后原地改行，快照跟着变：
  - 青衣 `buildExecutions` 把平A聚合行的 totalTime、喧响、能量清零；
  - 佩洛伊斯 `patchExecutions` 改写通用大招行的 count、totalTime、喧响（两份快照里都有这一行）；
  - 卢西娅、橘福福 `patchExecutions` 往行上加 flatDamageBonus、dmgBonus、暴击、skillDamageTarget。
- 「派发前」只靠两条约定撑着：
  - types.ts 要求 prePatch 的读方「只读 moveId / count / 时长，不要读 patch 会改写的字段」。这条本身不准：佩洛伊斯改的就是 count 和时长。
  - r742 在 `carveBasicPool` 注释里要求换新行对象（§3.1）。
- 快照从拍下到被读，中间只有本槽自己的钩子会改行：
  - `materializePhaseState`（格莉丝、叶瞬光）只写 cfg；
  - `applyExecutionUtilization` 只在次数变了时返回新对象，否则原样返回；
  - 截断（`truncateMoveRows`）返回原行或新行，不改原行；
  - `buildResourceResult` 之后快照数组不再被引用，编排层（`ultimatePromote` 等）后来改行与它无关。

### 8.2 改法（3 个文件 +6 / −6）

- rowBuild 两处改成 `push(...executions.map(e => ({ ...e })))`。`SkillExecution` 的字段全是标量（string、number、boolean、字面量联合），一层拷贝就是完整拷贝。
- types.ts：契约写一次，放在 `AgentResourceResultInput.preModuleExecutions` 的文档末尾——两份快照都是逐行拷贝的，钩子之后原地改行改不到，读哪个字段都行。删掉 `prePatchExecutions` 上那条读方限制。
- moduleExecRow.ts：删掉 `carveBasicPool` 注释里「换新行对象……浅拷贝」那条理由，实现不动。
- `@fact engine:time/回避支援` 的锚函数是 `buildExecutions`，本提交动过它。回避支援行不受影响（zd 0、`evadeAssist.test` 通过），复核仍成立，「据」末尾加 `复核@2026-10-08`。

### 8.3 为什么 0 差

快照有 4 个读方，各自只读本槽钩子不改的字段：

| 读方 | 快照 | 读的字段 | 本槽钩子在快照之后改什么 |
|---|---|---|---|
| 卢西娅 1451 | preModule | `countFrontActions`：category、count、timeBucket、moveId | patch：合唱行加 flatDamageBonus、dmgBonus、critRateBonus、critDmgBonus |
| 青衣 1251 | preModule | 非 `basic_attack` 行的 totalTime | buildExecutions：平A行清零（读方排除了平A行） |
| 橘福福 1391 | preModule | `countFrontActions` | patch（影画6）：连携行 dmgBonus、skillDamageTarget |
| 千夏 1491 | prePatch | 标记招式行的 count，平A汇总秒 | patch 只追加行 |

- 钩子只派发给本槽的角色模块，别的角色改不到本槽的行。
- zd DUMP 0 / ROWS 0（对 `06eed50f`）。zd 里卢西娅 40 条、青衣 10 条、千夏 30 条；橘福福不在 zd 预设里，由全量 vitest 覆盖。

### 8.4 验证

| 项 | `06eed50f` | `46a6353a` |
|---|---|---|
| vue-tsc | 0 | 0 |
| guards | 29 | 29 |
| zc.test + checkGuards.test | 207 | 207 |
| tokens / data / specs / recording | 12 / 161 / 462 / 189 | 12 / 161 / 462 / 189 |
| vitest | 258/2155 + 262/2348 = 520/4503 | 258/2155 + 262/2348 = 520/4503 |
| zd | — | DUMP 0 / ROWS 0 |
| build | 1598.59 kB | 1598.63 kB |
| zc drift | 154 / 0 / 0 | 154 / 0 / 0（复核 1 条后） |

### 8.5 不做

- 不立「钩子不许原地改行」的规则。快照拷贝之后，原地改只影响最终行，这本来就是钩子的职责：`patchExecutions` 的文档写的就是「对最终执行列表补专属字段」。
- 不改 `carveBasicPool` 的实现。换新对象和原地改现在等价，没有理由动。
- 不为快照拷贝单独写测试。读方的数值由 zd 和各角色测试守着；拷贝是两行代码，契约写在类型文档里。

### 8.6 回退

- `git revert 46a6353a`（3 个文件）。文档另有提交。

### 8.7 下一轮候选（r744 已做，见 §9）

**`backstageAutoRows` 的「不要改它」只写在注释里。** rowBuild 在闪避反击行之前派发这个钩子，传的是正在构建的 `executions` 本体。types.ts 的 `AgentMechanicModule.backstageAutoRows` 注释写着 `input.executions` 是只读快照语义，模块用它数前台动作，**不要**改它，但入参类型是共用的 `AgentResourceInput`，`executions: SkillExecution[]` 可写。

下一步：

1. 把这个钩子的入参改成只读：`executions` 声明为 `readonly Readonly<SkillExecution>[]`，用类型检查守约束，注释里的「不要改它」随之删掉。
2. 先看实现方（蕾米埃尔「光辉回转」）和 `countFrontActions` 的形参能不能直接接只读数组。
3. 只读入参的声明方式要省，类型只声明一次，例如在 `AgentResourceInput` 上加泛型或用 `Omit` 派生。

## 9. r744：钩子入参按契约收窄

> 代码提交 `421b5b88`（zd 0/0）（arena-G r744）；arch CC-526；r6 §8 第 744 行。题目是 §8.7 的候选，范围扩到共用同一个入参类型的另一个钩子。

### 9.1 问题

`AgentResourceInput`（cfg / state / executions / teamFrontlineSeconds）是 4 个物化钩子共用的入参，但各钩子的契约不同：

| 钩子 | 对 executions 的契约 | 实现方 |
|---|---|---|
| `buildExecutions` | 追加行，也改 core 行（青衣清零平A行、`carveBasicPool` 换平A行） | 多数角色 |
| `patchExecutions` | 改行、增删行（佩洛伊斯 splice） | 多数角色 |
| `backstageAutoRows` | 只数行（`countFrontActions`），新行经返回值交给构建器 | 蕾米埃尔 |
| `materializePhaseState` | 不用行：记的是本次物化用的 state | 格莉丝、叶瞬光（都只解构 cfg / state） |

- 后两个钩子的入参比契约宽：
  - `backstageAutoRows` 拿到可写数组，「不要改它」只写在注释里；
  - `materializePhaseState` 的两处调用点（phaseExecutions、underfillProbe）传了 executions / teamFrontlineSeconds，没有实现方读。
- `countFrontActions` 只读，形参却是可写的 `Array<…>`。橘福福 `jufufuCycleOf` 手里是只读数组，只好写 `executions as SkillExecution[]` 断言迁就，这是全仓唯一一处 `as SkillExecution[]`。

### 9.2 改法（9 个文件 +27 / −22）

- types.ts 加 `AgentBackstageRowsInput`：字段同 `AgentResourceInput`，executions 为 `readonly Readonly<SkillExecution>[]`，不能增删行，也不能改行字段。`backstageAutoRows` 改用它，注释里的「不要改它」删掉。
- 蕾米埃尔 `remielleRadiantTurnRows` 的形参改成 `AgentBackstageRowsInput`。顺手把行字面量里缩进错位的 4 行和收尾括号对齐（纯空白）。
- `countFrontActions` 形参改成只读数组，删掉橘福福的断言。
- `materializePhaseState` 入参改为 `Pick<AgentResourceInput, 'cfg' | 'state'>`，文档补一句：入参只有 cfg / state，写入记的是本次物化用的 state，与行无关。两处调用点只传 `{ cfg, state }`。
- 格莉丝的两个测试（mechanicRowValuesT9、idempotentCfgWrite，共 4 处调用）删掉 `executions: []` 和 `as any`。cfg / state 在测试里本来就声明成 any。
- `@fact engine:欠打回填` 的锚函数 `runUnderfillProbe` 动过（只改了上面那处入参）。复核仍成立，「据」末尾加 `复核@2026-10-08`。

### 9.3 反证

临时文件 `src/zz-r744-probe.ts`（已删）里写三种违约写法，vue-tsc 都报错：

| 写法 | vue-tsc |
|---|---|
| `AgentBackstageRowsInput` 的 `executions.push(…)` | TS2339：push 不存在 |
| `executions[0].count = 1` | TS2540：只读属性 |
| 在 `materializePhaseState` 的入参上读 executions | TS2339：属性不存在 |

### 9.4 验证

| 项 | `bae8b416` | `421b5b88` |
|---|---|---|
| vue-tsc | 0 | 0 |
| guards | 29 | 29 |
| zc.test + checkGuards.test | 207 | 207 |
| tokens / data / specs / recording | 12 / 161 / 462 / 189 | 12 / 161 / 462 / 189 |
| vitest | 258/2155 + 262/2348 = 520/4503 | 258/2155 + 262/2348 = 520/4503 |
| zd | — | DUMP 0 / ROWS 0 |
| build | 1598.63 kB | 1598.55 kB |
| zc drift | 154 / 0 / 0 | 154 / 0 / 0（复核 1 条后） |

### 9.5 不做

- **不把 `backstageAutoRows` 改成属性签名。** 钩子是方法签名（`backstageAutoRows?(input): …`），TS 对方法参数双变，单独声明成 `(input: AgentResourceInput)` 的函数仍能挂上去；改成属性签名（`backstageAutoRows?: (input) => …`）才严格。但 `AgentMechanicModule` 的钩子全是方法签名，只改这一个就不一致；实现方只有一个，内联实现和按声明类型写的实现都已受约束。
- **`AgentResourceInput.teamFrontlineSeconds` 不改必填。** 模块里只有 zhao 读它（`?? 0`）。测试里直接调 buildExecutions / patchExecutions / backstageAutoRows 的有 163 处，同一行里传了 teamFrontlineSeconds 的只有 9 处。改必填要动约 150 处测试，只换掉一个 `?? 0`，量过不做。
- buildExecutions / patchExecutions 的入参不拆，它们本来就要改行。

### 9.6 回退

- `git revert 421b5b88`（9 个文件）。文档另有提交。

### 9.7 下一轮候选（r745 已做，见 §10）

**`AgentResourceResultInput` 的两份快照是可选字段，读方各写一份缺省分支。** 唯一的生产调用方 `assembleSlot` 总是传 `preModuleExecutions` / `prePatchExecutions`（r743 起是逐行拷贝）。4 个读方各自兜底：

- 卢西娅 `buildLuciaResourceResult`：缺快照时「退化为无前台动作计数口径」，传 undefined 给 `additionalAttackCapOf`；
- 青衣：`preModuleExecutions ?? []`；
- 橘福福：`jufufuCycleOf` 的 `executions ? … : undefined`，形参是 `readonly SkillExecution[] | undefined`；
- 千夏：`prePatchExecutions ?? []`。

这些分支只为测试直调而存在：`jufufu.test.ts:200` 传 `{ cfg, state } as any`，`luciaElowen.test.ts:123` 只传 cfg / state（`as never`），都走缺省分支。青衣、千夏没有直调的测试。

下一步：

1. 两个字段改必填，删掉 4 个缺省分支。判据 28（dead-nullish）会把漏删的 `??` 报出来。
2. 先核对传 `[]` 和传 undefined 是否等价：`countFrontActions([])` = 0，`frontBlockSeconds` 对 0 和 undefined 都取回退值；但 `additionalAttackCapOf`、`computeJufufuCycle` 里 frontActionCount 还有没有别的用法，要读代码确认。不等价就让测试传真实行，不留退化口径。
3. 测试直调处补 `preModuleExecutions: []`（或真实行）。生产路径不变，zd 应为 0/0。

## 10. r745：结果钩子的两份快照改必填

> 代码提交 `dc9748c0`（zd 0/0）（arena-G r745）；arch CC-527；r6 §8 第 745 行。题目是 §9.7 的候选。

### 10.1 问题

`AgentResourceResultInput` 的 `preModuleExecutions` / `prePatchExecutions` 原是可选字段。唯一的生产调用方 `assembleSlot`（`src/core/resource/assembleSlot.ts:180–181`）每次都传（r743 起是逐行拷贝），可选只服务测试直调。4 个读方为此各写了一份缺省分支：

| 读方 | 缺省分支 | 缺快照时 |
|---|---|---|
| 卢西娅 `buildLuciaResourceResult` | `preModuleExecutions ? countFrontActions(…) : undefined`，另有一行「外部直调时退化」的注释 | frontActionCount 为 undefined |
| 橘福福 `jufufuCycleOf` | `executions ? countFrontActions(…) : undefined`，形参允许 undefined，文档里一句「缺行基准（外部直调）时…」 | 同上 |
| 青衣 `buildQingyiResourceResult` | `preModuleExecutions ?? []` | 按空行算 |
| 千夏 `buildQianxiaResourceResult` | `prePatchExecutions ?? []` | 按空行算 |

判据 28（dead-nullish）查不出这几处：字段声明成可选，`??` 在类型上就不算死兜底。

### 10.2 等价性（先核对再删）

- 卢西娅、橘福福的 frontActionCount 各只有一处用法，都是传给 `frontBlockSeconds`（卢西娅经 `additionalAttackCapOf`，橘福福经 `computeJufufuCycle`）。`frontBlockSeconds` 对 0 和 undefined 都取回退值（块长 ≈ CD），而 `countFrontActions([])` = 0。测试直调改传 `[]`，走的是同一个回退。
- 青衣、千夏的 `x ?? []` 在 x 恒为数组时与 x 同义。
- 生产路径本来就传真实行，不受影响。

### 10.3 改法（8 个文件 +13 / −17）

- types.ts：两份快照去掉 `?`。文档加一句：两份都必填，唯一调用方 assembleSlot 每次都传，测试直调没有引擎行就传 `[]`。
- 卢西娅、橘福福：三元改为直接调 `countFrontActions`，删掉两段「外部直调退化」的说明。`jufufuCycleOf` 的形参去掉 `| undefined`，顺手把 `exSpecialCount` 一行的缩进对齐（纯空白）。
- 青衣、千夏：删掉 `?? []`。
- 测试 3 处：
  - `luciaElowen.test.ts:121` 与 `jufufu.test.ts:200` 的直调补 `preModuleExecutions: []`。jufufu 那个用例先调 buildExecutions，往 `executions` 里 push 了模块行；派发前没有引擎行，所以传 `[]`，不传 `executions`。
  - `nangongSmoke.test.ts:303` 的 `as any` 从 state 挪到整个入参。南宫不读快照，不补字段。

### 10.4 反证

| 临时改动（均已还原） | 结果 |
|---|---|
| 青衣那处加回 `?? []` | check-guards 判据 28 报 1 处：`qingyi.ts:342  ?? [(局部).preModuleExecutions: SkillExecution[]]` |
| `nangongSmoke.test.ts` 恢复旧写法 `{ cfg, state: {…} as any }` | vue-tsc 报 TS2345：`{ cfg: any; state: any; }` 不能赋给 `AgentResourceResultInput` |

以后再有人给这两个字段写缺省分支，判据 28 会拦下；漏传快照的直调，vue-tsc 会拦下。

### 10.5 验证

| 项 | `a68edc45` | `dc9748c0` |
|---|---|---|
| vue-tsc | 0 | 0 |
| guards | 29 | 29 |
| zc.test + checkGuards.test | 207 | 207 |
| tokens / data / specs / recording | 12 / 161 / 462 / 189 | 12 / 161 / 462 / 189 |
| vitest | 258/2155 + 262/2348 = 520/4503 | 258/2155 + 262/2348 = 520/4503 |
| zd | — | DUMP 0 / ROWS 0 |
| build | 1598.55 kB | 1598.53 kB |
| zc drift | 154 / 0 / 0 | 154 / 0 / 0 |

### 10.6 不做

- **`AgentResourceResultInput.teamFrontlineSeconds` 保持可选。** 唯一读方是 zhao 的 `teamFrontlineSeconds ?? 0`（zhao.ts:148）。那个 helper 的形参是 `Pick<AgentResourceInput, …>`，`AgentResourceInput` 这边已定不改必填（§9.5），只改结果入参这一边，删不掉这个 `?? 0`。
- **卢西娅 `additionalAttackCapOf` 本轮不动。** TS 不允许必填参数排在可选参数后面，frontActionCount 改必填就得连 state 一起改，而 state 那条路径被一个测试的期望值占着。单独立题，见 §10.8。
- **`computeQingyiSource(cfg, state, genericRowsTime = 0)` 的默认参数不删。** 纯函数的默认参数，只有测试在用，不涉及钩子契约。

### 10.7 回退

- `git revert dc9748c0`（8 个文件）。文档另有提交。

### 10.8 下一轮候选（r746 已做，见 §11）

**卢西娅 `additionalAttackCapOf` 的形参比两个调用方宽，早返回分支在生产上走不到。**

- 形参是 `state?: { backstageTime?: number; frontlineTime?: number }` 和 `frontActionCount?: number`。两个调用方（`buildLuciaExecutions` :184、`buildLuciaResourceResult` :304）传的都是 `Readonly<IterationState>`（frontlineTime / backstageTime 都是必填 number）和 `countFrontActions(…)` 的结果。
- 所以 `if (!state || typeof state.backstageTime !== 'number')` 的早返回（旧口径 min(滑块, floor(有效战斗时间 / 8))）和 `state.frontlineTime ?? 0` 只服务测试直调。形参把字段声明成了可选，判据 28 看不出来。文档注释（:365）说「state 缺失（estimate/无收敛信息）时回退」，但 estimate 钩子并不调它。
- 走这条路的是 `luciaElowen.test.ts:121`「追加攻击口径：CD 8s 全球性」：state 只给 exSpecialCount / ultimateCount（`as never`），期望 20 = min(20, floor(180 / 8) = 22)。换成真实 state 后，cap 按「有效后台时间 / 相位延后等效 CD」算，后台时间不够长就会小于 20。
- 展示文案也还是旧口径：`note`（:298）写「按有效战斗时间/8 封顶」，`skillTableNote`（:247）写「次数按有效战斗时间/8 封顶」。设置项 `lucia.additionalAttackCount` 的 description（:393）写的才是相位延后口径。

下一步：

1. 形参收成 `Pick<IterationState, 'frontlineTime' | 'backstageTime'>` 和 `number`，删早返回和 `?? 0`。`Math.max(0, …)` 要不要留，看 frontlineTime 会不会为负。
2. 那个用例补真实 state（backstageTime / frontlineTime），按相位延后口径重算期望。用例要测的是「axisInSeconds 不再折算」，这个意图保留。
3. 两段文案改成生产口径。这是展示层改动，zd 看不到，要单独核对面板。
4. 生产路径不变，zd 应为 0/0。

另记（小，未立题）：橘福福 `patchExecutions`（specPanelBuffs.ts:791）对 tigerChain / tigerChainManual / popcorn 三种行都写 `e.dmgBonus = (e.dmgBonus ?? 0)`，注释说「生成行已设」，实际只给下一行 tigerChainManual 的加法兜底。可以并进 tigerChainManual 分支，但要先看 rowsnap 会不会把 undefined → 0 算成差异。

## 11. r746：卢西娅追加攻击上限的形参收窄

> 代码提交 `e02a75a9`（数值逐位不变，文案差异已归因）（arena-G r746）；arch CC-528；r6 §8 第 746 行。题目是 §10.8 的候选。

### 11.1 问题

- `additionalAttackCapOf` 的形参是 `state?: { backstageTime?: number; frontlineTime?: number }` 和 `frontActionCount?: number`。两个调用方（`buildLuciaExecutions`、`buildLuciaResourceResult`）传的都是 `Readonly<IterationState>`（frontlineTime / backstageTime 都是必填 number）和 `countFrontActions(…)` 的结果。
- 形参比调用方宽出来的部分只服务测试直调：
  - 早返回 `if (!state || typeof state.backstageTime !== 'number')`，走旧口径 min(滑块, floor(有效战斗时间 / 8))；
  - `Math.max(0, state.frontlineTime ?? 0)`。字段声明成可选，判据 28 看不出这个 `?? 0`。
- 文档注释说「state 缺失（estimate/无收敛信息）时回退」，但 `estimateExSpecialTime` 不调它：估时直接拿滑块值当 cap，而 cap 只影响追加攻击次数，不影响估时要用的强特 / A5 次数。
- 展示文案还是旧口径：文件头、追加攻击行的 `skillTableNote`、`luciaMechanicSource.note` 三处都写「按有效战斗时间/8 封顶」。生产口径是 2026-08-30 起的相位延后 floor(有效后台时间 / 等效CD)，设置项 `lucia.additionalAttackCount` 的 description 写的才是这个口径。

### 11.2 先确认早返回只服务测试（运行时探针）

在早返回分支里临时加一行，把调用栈里的测试 / perf 帧写进文件（已还原），然后跑：

| 跑了什么 | 命中次数 |
|---|---|
| 全量 vitest（520 文件 / 4503 例） | 1，来自 `luciaElowen.test.ts:123` |
| zd：全部预设 × 5 变体（dump + rowsnap） | 0 |

zd 覆盖不到决策层、展示层等路径，这部分由全量 vitest 补上。

### 11.3 改法（2 个文件 +10 / −13）

- `additionalAttackCapOf`：state 改为 `AgentResourceInput['state']`，frontActionCount 改为 `number`；删掉早返回和那句文档。
- `Math.max(0, state.frontlineTime ?? 0)` 改为 `state.frontlineTime`：f 只传给 `frontBlockSeconds` 和 `phaseDelayedCooldown`，两者入口都先做 `Math.max(0, …)`。
- 文案：三处「按有效战斗时间/8 封顶」改成「受相位延后 CD 封顶 = 有效后台时间/等效CD」，与设置项 description 同一说法。追加攻击行上方的注释「默认 20 次（180s / 9s）」改成「≈500 梦境值 ÷ 25/次」，与常量注释一致。
- `luciaElowen.test.ts` 的「CD 8s 全球性…axisInSeconds 不再折算」用例：state 补 `frontlineTime: 0, backstageTime: 180`。全程后台 ⇒ 没有相位延后，CD 封顶 floor(180/8) = 22，期望仍是 20（梦境值 500 ÷ 25）。用例要测的「72s 轴窗口不折算」不变。

### 11.4 反证

- 临时写回 `state.frontlineTime ?? 0`：判据 28 报 1 处（`luciaElowen.ts:373  ?? [IterationState.frontlineTime: number]`），已还原。形参收窄后，这个函数重新受判据 28 约束。

### 11.5 零差与归因

文案变了，zd 一定有差异。按 AGENTS.md 规则 10 的口径先量差异，再归因：

| zd 比对（对 `2af5245d`） | DUMP | ROWS |
|---|---|---|
| `ZD_DROP=note,skillTableNote`（两边都丢掉这两个键） | 0 | 0 |
| 不丢键 | 125 | 125 |

- 125 = 含卢西娅的 25 个预设 × 5 变体。全部 520 条里名字含 lucia / 1451 的正好 125 条，与差异条目一一对应。
- 丢掉两个文案键后为 0：差异只来自这两段文案，数值逐位不变。
- 仓库里的金样基线不含这两段文案：全仓 grep「有效战斗时间/8」只命中 luciaElowen.ts 三处，所以不用重生成任何基线。

### 11.6 验证

| 项 | `2af5245d` | `e02a75a9` |
|---|---|---|
| vue-tsc | 0 | 0 |
| guards | 29 | 29 |
| zc.test + checkGuards.test | 207 | 207 |
| tokens / data / specs / recording | 12 / 161 / 462 / 189 | 12 / 161 / 462 / 189 |
| vitest | 258/2155 + 262/2348 = 520/4503 | 258/2155 + 262/2348 = 520/4503 |
| zd | — | 见 §11.5 |
| build | 1598.53 kB | 1598.48 kB |
| zc drift | 154 / 0 / 0 | 154 / 0 / 0 |

### 11.7 不做与回退

- 不给这个用例加相位延后的断言：`phaseDelayedCooldown`（11 处）和 `frontBlockSeconds`（7 处）在 `core/__tests__/effectiveTime.test.ts` 里已经锁住，这里不重复。
- 回退：`git revert e02a75a9`（2 个文件）。文档另有提交。

### 11.8 下一轮候选（未做）

**`core/effectiveTime.ts` 的共享时间 helper，形参也比调用方宽，`?? 0` 落在核心里。** 本轮的卢西娅是调用方一侧的例子，helper 自己也是同一个模式：

| helper | 宽在哪 | 生产调用方 |
|---|---|---|
| `effectiveCombatTime(state: { frontlineTime?: number; backstageTime?: number }, cfg)` | state 字段可选，内部 `(state.frontlineTime ?? 0) + (state.backstageTime ?? 0)` | 8 处（burnice、lighter ×3、orphie、rina、yaojiayin ×2），都传钩子的 `state` |
| `frontBlockSeconds(frontlineTime, frontActionCount, frontSwitchRatio, fallback)` | 前三个参数是 `number \| undefined`，内部各自 `??` | 4 处：luciaElowen、orphie、remielle 传的都是 number；橘福福 `computeJufufuCycle` 传 `JufufuCycleInput` 的可选字段 |
| `phaseDelayedCooldown(cd, frontlineTime, effectiveTotalTime, blockSeconds?)` | 两个时间参数可 undefined；blockSeconds 缺省 = cd | 同上 4 处，都传了 block |
| `effectiveBackstageTime` / `minusInvincibleTime(x: number \| undefined, cfg)` | 内部 `?? 0` | effectiveBackstageTime 4 处都传 `state.backstageTime`；minusInvincibleTime 另有 trigger、vivian ×2、yuzuha 共 4 处 |

- 橘福福 `computeJufufuCycle` 是 frontBlockSeconds / phaseDelayedCooldown 收到 undefined 的唯一来源：`JufufuCycleInput` 的 frontlineTime / effectiveTotalTime / frontActionCount / frontSwitchRatio（以及 teamUltimateCount / assistRate）是可选字段。唯一的生产调用方 `jufufuCycleOf` 每个都传，`jufufu.test.ts` 有 8 处直调只传部分字段。函数体里还有一串对 number 字段的 `Number(x) || 0`。
- `core/__tests__/effectiveTime.test.ts` 直调这些 helper 24 处（minusInvincibleTime 3、effectiveBackstageTime 3、frontBlockSeconds 7、phaseDelayedCooldown 11），其中 5 处传 undefined 验缺省（:21、:27、:32、:62、:65）。

下一步：

1. 逐个 helper 核实调用方实参的静态类型：minusInvincibleTime 的 `cfg.battleTime` / `totalTime` / `combatTime`，effectiveCombatTime 8 处的 state 是否都是 `IterationState`。全是 number 才收窄，否则只收能收的。
2. `JufufuCycleInput` 的 4 个时间字段改必填，删函数体里对 number 字段的 `Number(x) || 0`；jufufu.test 的直调补字段。
3. helper 形参改为 `number`，删内部 `??`；`blockSeconds` 4 处都传，可改必填。判据 28 会把调用方漏删的 `??` 报出来。
4. 删 effectiveTime.test 里那 5 处只验 undefined 缺省的断言（缺省分支没了，删掉不会漏真实回归）。生产路径不变，zd 应为 0/0。

另记（小，未立题，同 §10.8）：橘福福 `patchExecutions` 的 `e.dmgBonus = (e.dmgBonus ?? 0)`（specPanelBuffs.ts:791）。
