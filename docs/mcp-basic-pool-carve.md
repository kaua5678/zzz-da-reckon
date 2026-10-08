# 平A池 carve 只留一份实现（r742）

> 代码提交 `2a162c29`（纯重构，zd 0/0）+ `78cc9bec`（艾莲池能量双计修正，规则 10）（arena-G r742）；arch CC-524；r6 §8 第 742 行。题目来自 `docs/mcp-frontline-row-seconds.md` §11.7（r741 交接的候选）。r743 做了 §7 的候选（两份派发前行快照改为逐行拷贝），见第 8 节（`46a6353a`，CC-525）。r744 做了 §8.7 的候选（钩子入参按契约收窄），见第 9 节（`421b5b88`，CC-526）。r745 做了 §9.7 的候选（结果钩子的两份快照改必填），见第 10 节（`dc9748c0`，CC-527）。r746 做了 §10.8 的候选（卢西娅追加攻击上限的形参收窄），见第 11 节（`e02a75a9`，CC-528）。r747 做了 §11.8 的候选（effectiveTime 时间 helper 的形参收窄），见第 12 节（`56465f75`，CC-529）。r748 做了 §12.8 的两个候选（countFrontActions 与 computeJufufuCycle 的入参收窄），见第 13 节（`983c4b10` / `f50f0924`，CC-530 / CC-531）。r749 做了 §13.8 的候选（设置项缺省值只留在声明，删 cfgMechanicSettingRaw），见第 14 节（`1c8b10d3` / `0532dc80`，CC-532）。r750 做了 §14.8 的第 1 条候选（删机制设置的 cfg 镜像字段），见第 15 节（`0487d921`，CC-533）。r751 做了 §15.8 的第 1 条候选（并入钩子读取器通道），见第 16 节（`5d737c73`，CC-534）。r752 做了 §16.8 的第 1 条候选（普查后模块外只剩一处，挪进模块钩子；未采用按注册表回落），见第 17 节（`d9c98594`，CC-535）。r753 做了 §17.9 的第 1 条候选（扩到洛克茜两处，并去掉 reader 的 fallback 形参），见第 18 节（`1fff4c95`，CC-536）。r754 做了 §18.8 的第 1 条候选（读写口径随变量对象携带，`meta?.default ?? 1` 随之删除），见第 19 节（`c32e9c09`，CC-537）。r755 做了 §19.8 的第 1 条候选（影响变量表项自带读写，core 两张平行 switch、抗性 `?? 20` 与 2 号位 `?? 1` 随之删除），见第 20 节（`6bcd6cc3`，CC-538）。

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

### 11.8 下一轮候选（r747 已做，见 §12）

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

## 12. r747：effectiveTime 时间 helper 的形参收窄

> 代码提交 `56465f75`（数值逐位不变，zd 0/0）（arena-G r747）；arch CC-529；r6 §8 第 747 行。题目是 §11.8 的候选。

### 12.1 问题

`core/effectiveTime.ts` 里六个时间 helper 的形参允许 undefined，函数体各自兜底：

| helper | 原形参 | 函数体兜底 |
|---|---|---|
| `minusInvincibleTime(seconds, cfg)` | `seconds: number \| undefined` | `?? 0` |
| `effectiveBackstageTime(backstageTime, cfg)` | `number \| undefined` | 转给 minusInvincibleTime |
| `effectiveCombatTime(state, cfg)` | `{ frontlineTime?: number; backstageTime?: number }` | 两处 `?? 0` |
| `phaseDelayedCooldown(cd, frontlineTime, effectiveTotalTime, blockSeconds?)` | 两个时间参数 `number \| undefined`，blockSeconds 可省 | `?? 0` ×2、`blockSeconds ?? c` |
| `frontBlockSeconds(frontlineTime, frontActionCount, frontSwitchRatio, fallback)` | 前三个 `number \| undefined` | `?? 0` ×2、`?? 1` |
| `stunWindowDuration(stunTime, teamStunDurationBonus = 0)` | `number \| undefined` | `?? 12` |

- 形参写宽了，判据 28 就查不到这些 `??`。
- 缺省值多写了一份：失衡时间 12 已经写在 store 的 defaultEnemy；块长 = CD 的回退已经由 frontBlockSeconds 的 fallback 参数承担。

### 12.2 谁在传 undefined

**静态。** 把六个形参改成 number 后跑 vue-tsc，报 15 处：

- 生产代码只有 2 处，都在 `specPanelBuffs.ts` 的 `computeJufufuCycle`：它把 `JufufuCycleInput` 的可选字段转给 frontBlockSeconds / phaseDelayedCooldown。
- 其余 13 处在测试：effectiveTime.test 12 处、stunPool.test 1 处。
- 另外 24 处生产调用（还有 effectiveTime.ts 内部 2 处）本来就传 number / IterationState。

**运行时。** vue-tsc 看不穿 `as any` 夹具，所以在 HEAD 版六个 helper 的入口临时打桩：实参不是 number 就记一行调用栈（已还原）。

| 跑了什么 | 命中 |
|---|---|
| 全量 vitest（520 文件 / 4503 例） | 50 次，全部来自测试 |
| zd：全部预设 × 5 变体（dump + rowsnap） | 0 |

50 次按来源分：

| 来源 | 命中 | 收窄后会怎样 | 处理 |
|---|---|---|---|
| effectiveTime.test / stunPool.test 直调：传 undefined，或省略 blockSeconds | 14 | vue-tsc 报错 | 删只验缺省的断言，块长 = c 的补第 4 参（§12.3） |
| jufufu.test 直调 computeJufufuCycle，没传时间字段 | 6 | 字段改必填后 vue-tsc 报错 | 补字段 |
| jufufu.test 两个钩子用例：state 缺 frontlineTime，经 jufufuCycleOf 传进来 | 3 | buildExecutions 用例的虎威次数变成 NaN，断言失败。buildResourceResult 用例的 cfg 本来就缺 battleTime / invincibleTime，后台时间在 HEAD 上就是 NaN，其中两条断言是 NaN 比 NaN（Object.is 判相等），永远通过 | 前者补 frontlineTime 0；后者补 battleTime 180、invincibleTime 0、frontlineTime 0，让这两条断言真正比较数值 |
| orphieSelf 的 `build()` 夹具：state 缺 frontlineTime | 6 | 次数变成 NaN，2 例失败（§12.4 实测） | 夹具补 frontlineTime 0 |
| orphieSelf 滑块用例：state 只有 basicAttackTime，cfg 没有 invincibleTime | 12 | 后台次数在 HEAD 上已经是 NaN；用例只断言火刀衔接行 | 不动 |
| orphieSelf 的 patchExecutions 用例：传 `state: {}` | 3 | 影画2 的喧响写进 cfg.extraSelfDecibelReward，夹具 cfg 没这个字段，HEAD 上就是 NaN；用例不断言它 | 不动 |
| vivian.test 的 buildAnomalyEvents：cfg 没有 battleTime | 6 | battleTime 只在 vivianAdditionalActive 为真时给源2 封顶，这些用例都没开 | 不动 |

### 12.3 改法（6 个文件 +59 / −69）

- `effectiveTime.ts`
  - minusInvincibleTime / effectiveBackstageTime / stunWindowDuration：形参改 `number`，删 `?? 0` / `?? 12`。stunWindowDuration 的 `teamStunDurationBonus = 0` 默认参数也去掉：2 个生产调用方（useResourceCalc、ultimatePromote）都传，只有 stunPool.test 一处直调省略。
  - effectiveCombatTime：state 改为 `Pick<IterationState, 'frontlineTime' | 'backstageTime'>`，删两处 `?? 0`。
  - phaseDelayedCooldown：两个时间参数改 `number`，blockSeconds 改必填（4 个调用方都传 frontBlockSeconds 的结果），删 `?? 0` / `?? c`。
  - frontBlockSeconds：三个参数改 `number`，删 `?? 0` / `?? 0` / `?? 1`。返回值里的 `Math.max(0, f)` 是重复钳制（f 已经钳过），改成 `f / switches`。
- `specPanelBuffs.ts`
  - `JufufuCycleInput` 的 frontlineTime / effectiveTotalTime / frontActionCount / frontSwitchRatio 改必填。
  - computeJufufuCycle 删 `Number(input.frontlineTime) || 0`，也删 effectiveTotalTime 的「前台 + 后台」回退：唯一的生产装配 jufufuCycleOf 一直传 `effectiveBattleTime(cfg)`。
  - frontSwitchRatio 的注释原来写「clamp 0.2~1，默认 1」，实际下限是 0（`FRONT_SWITCH_MIN_RATIO`），设置项默认 0.7，已改正。
- 测试
  - effectiveTime.test：删 5 条只验 undefined 缺省的断言（原 :21、:27、:32、:62、:65）和 1 条块长缺省断言（原 :51）；块长 = c 的 6 条补第 4 参，期望值不变。
  - stunPool.test：删 `stunWindowDuration(undefined)`，另一条补第 2 参 0。
  - jufufu.test：账本 describe 里加 `noFront`（四个时间字段，前台时间 0）给只验账本的直调用；「没有前台动作行 → 块长回退 ≈ CD」那条补 frontActionCount 0 / frontSwitchRatio 1，期望仍是 21；两个钩子用例按 §12.2 补字段。
  - orphieSelf：`build()` 夹具补 frontlineTime 0。

### 12.4 反证

- 收窄后 vue-tsc 报 15 处（测试 13 处传 undefined 或少第 4 参，生产 2 处传可选字段）：新形参确实不收 undefined。
- 临时写回 `seconds ?? 0`：判据 28 报 `effectiveTime.ts:70  ?? [(局部).seconds: number]`。helper 的函数体重新受判据 28 约束。
- 临时去掉 orphie `build()` 的 frontlineTime 0：2 例失败（expected NaN to be 2 / 30）。补这个字段是必需的。

以上都已还原。

### 12.5 零差

zd（对 `9f4f07d6`，不丢键）DUMP 0 / ROWS 0。生产实参都是有限的 number，删掉的 `??` 和 `Number(x) || 0` 在生产里一次都不会触发；本轮没有改文案。

### 12.6 验证

| 项 | `9f4f07d6` | `56465f75` |
|---|---|---|
| vue-tsc | 0 | 0 |
| guards | 29 | 29 |
| zc.test + checkGuards.test | 207 | 207 |
| tokens / data / specs / recording | 12 / 161 / 462 / 189 | 12 / 161 / 462 / 189 |
| vitest | 258/2155 + 262/2348 = 520/4503 | 258/2155 + 262/2348 = 520/4503 |
| zd | — | 0 / 0 |
| build | 1598.48 kB | 1598.38 kB |
| zc drift | 154 / 0 / 0 | 154 / 0 / 0 |

用例数不变：删的是断言，不是用例。

### 12.7 不做与回退

- vivian.test 6 处、orphieSelf 滑块用例和 patchExecutions 用例的夹具不补字段：它们落到的通道这些用例不断言，在 HEAD 上本来就是 NaN 或 0（§12.2）。补了只是噪音。
- stunWindowFraction 的 `lostSeconds = 0` 保留：5 个生产调用里 difficultyRatio、solveTeam 不传，ultimatePromote ×2、useResourceCalc 传（只有易伤覆盖率要扣），这个默认参数服务生产代码。
- countFrontActions 不在本轮做，见 §12.8。
- 回退：`git revert 56465f75`（6 个文件）。文档另有提交。

### 12.8 下一轮候选（r748 已做，见 §13）

1. **`countFrontActions` 的形参收窄**（effectiveTime.ts 里最后一个形参比调用方宽的 helper）。
   - 现状：`executions: readonly { category?: string; count?: number; timeBucket?; moveId?: string }[]`，`opts: { fusedMoveIds?: Array<string | undefined | null> } = {}`。函数体有 `e.count ?? 0`、`e.moveId ?? ''`、`opts.fusedMoveIds?.filter(…) ?? []`。
   - `SkillExecution` 的 category / count / moveId 都是必填（types/resource/execution.ts），`assistFollowUpMoveId` 也是必填 string（types/resource/config.ts:176）。
   - 5 个生产调用方（luciaElowen ×2、orphie、remielle、specPanelBuffs）全部写 `countFrontActions(executions, { fusedMoveIds: [cfg.assistFollowUpMoveId] })`；测试没有直调。
   - 下一步：先在入口打运行时探针，看有没有测试夹具的行缺 count / moveId；再决定改成 `(executions: readonly SkillExecution[], fusedMoveId: string)` 还是保留数组；filter(Boolean) 要不要保留，取决于 assistFollowUpMoveId 会不会是空串。
2. **computeJufufuCycle 剩下的数值防御。** specPanelBuffs.ts:495–502 有 7 处 `Number(x) || 0`（字段都是 number）；:510–511 的 assistRate / teamUltRate 是可选字段，用 `Number.isFinite(Number(x)) ? … : 1` 兜底，而 jufufuCycleOf（:630–631）两个都传。jufufu.test 的直调靠「缺省 1」。teamUltimateCount 的 `?? ult` 要先核实 cfg 字段是否可选，再决定去留。

另记（小，未立题）：
- 橘福福 patchExecutions 的 `e.dmgBonus = (e.dmgBonus ?? 0)`（specPanelBuffs.ts:781，同 §10.8；:790 另有一处 `(e.dmgBonus ?? 0) + …`）。
- 设置项缺省值写了两处：声明里的 default 和读取处的 `cfgMechanicSettingRaw(cfg, id) ?? D`（例：jufufu.frontSwitchRatio 两处都是 0.7）。全仓这种读法 23 处、11 个文件，还没核实是否都与声明一致。

## 13. r748：countFrontActions 与 computeJufufuCycle 的入参收窄

> 代码提交 `983c4b10`（countFrontActions）+ `f50f0924`（computeJufufuCycle），两次 zd 都是 0/0（arena-G r748）；arch CC-530、CC-531；r6 §8 第 748 行。题目是 §12.8 的两个候选。

### 13.1 问题

**countFrontActions**（`core/effectiveTime.ts`）

- 行的形参是结构类型 `{ category?: string; count?: number; timeBucket?; moveId?: string }`，4 个字段都可选，函数体为此写了 `e.count ?? 0`、`e.moveId ?? ''`。而 `SkillExecution` 里 category / count / moveId 都是必填。
- 第 2 参是 `opts: { fusedMoveIds?: Array<string | undefined | null> } = {}`：可以省略，元素可以是空值，函数体为此写了 `new Set(opts.fusedMoveIds?.filter(Boolean) ?? [])`。
- 5 个生产调用方（luciaElowen ×2、orphie、remielle、specPanelBuffs）全部写 `{ fusedMoveIds: [cfg.assistFollowUpMoveId] }`，数组里从来只有一个元素。克拉蕾反制支援的融合走 `data/moveFusions` 的融合行，不经过这里。

**computeJufufuCycle**（`mechanics/agents/specPanelBuffs.ts`）

- 7 个数值字段逐个包了 `Number(x) || 0`，而这些字段的类型都是 number。对 number 来说，这层兜底只会把 NaN 变成 0（-0 经后面的 `Math.max(0, …)` 本来就是 0）。坏输入不会因此变对，只是被藏起来。
  - r747 修之前的 jufufu buildResourceResult 用例就是例子：cfg 缺 invincibleTime，`effectiveBackstageTime` 返回 NaN，被这层兜底静默改成了 0。虎威次数最后还是 NaN，是因为有效战斗时间（battleTime 也缺）同样是 NaN，经等效 CD 传了进来（`9f4f07d6` 的 phaseDelayedCooldown 对 NaN 不早返回）。§12.2 只写了「后台时间是 NaN」，这里补上完整链路。
- 两个 adjustable 比例 assistRate / teamUltRate 是可选字段，函数里写 `Number.isFinite(Number(x)) ? Math.max(0, Number(x)) : 1`。唯一的生产装配 jufufuCycleOf 两个都传 `jufufuAdjustableRate(cfg, id)`，即 `Math.max(0, cfgMechanicSetting(cfg, id, 1))`：默认值 1 和下限 0 已经在那里写过一次。

### 13.2 运行时探针（先核对再删）

两处都在 HEAD 版入口临时打桩（按「标签 + 调用栈」去重写文件，用完已还原），跑全量 vitest（520 文件 / 4503 例）和 zd（全部预设 × 5 变体）。

| 探针 | 全量 vitest | zd |
|---|---|---|
| countFrontActions：行缺 count / moveId / category，moveId 为空串，不传 opts，fusedMoveIds 含空串 | 0 | 0 |
| countFrontActions：fusedMoveIds 含非 string（夹具的 cfg 没给 assistFollowUpMoveId，传进来是 undefined） | 13 条：jufufu.test 3、orphieSelf 9、luciaElowen.test 1 | 0 |
| computeJufufuCycle：11 个数值字段收到非有限值 | 0 | 0 |
| computeJufufuCycle：assistRate / teamUltRate 缺省 | 各 8 条，全是 jufufu.test 的直调 | 0 |
| computeJufufuCycle：比例是非有限值或负数 | 0 | 0 |
| computeJufufuCycle：teamUltimateCount 缺省 | 61 条 | 4 条 |

结论：

- countFrontActions 收到的行字段都齐。空值只来自测试夹具，传进来的是 undefined。新写法 `e.moveId !== assistFollowUpMoveId` 对 undefined 恒为真，不排除任何行；旧写法经 filter(Boolean) 后同样不排除任何行。所以夹具不用补。
- computeJufufuCycle 的 `Number(x) || 0` 一次都没改过值。两个比例的缺省只服务 8 处测试直调。teamUltimateCount 在 zd 里也会缺省（编排层没注入时），`?? ult` 服务生产代码，保留。

### 13.3 改法

**`983c4b10`（6 个文件 +16 / −18）**

- `effectiveTime.ts`
  - 签名改为 `countFrontActions(executions: readonly Pick<SkillExecution, 'category' | 'count' | 'timeBucket' | 'moveId'>[], assistFollowUpMoveId: string)`，与 `types/resource/execution.ts` 里 FrontlineRow 的写法相同。
  - 函数体只剩一个 filter（`isFrontlineExecution(e) && e.category !== 'basic' && e.moveId !== assistFollowUpMoveId`）和一个 reduce（`Math.max(0, Math.floor(e.count))`），删掉 Set、filter(Boolean) 和三处 `??`。
  - JSDoc 写明：调用方传 cfg.assistFollowUpMoveId；没有支援突击的角色这里是空串，而行的 moveId 不为空，所以不会误排除。
- 5 个调用方改成 `countFrontActions(rows, cfg.assistFollowUpMoveId)`。
- `ENGINE_PIPELINE_GUIDE.md` 三处用法同步（:50、:61、:292）。它随代码一起提交，revert 时一起回退。

**`f50f0924`（2 个文件 +19 / −17）**

- `specPanelBuffs.ts`
  - 删 7 处 `Number(x) || 0`，`Math.max(0, …)` / `Math.floor` 保留。
  - JufufuCycleInput 的 assistRate / teamUltRate 改必填，函数里直接乘。字段注释改为「jufufuCycleOf 经 jufufuAdjustableRate 读入，未注入时为 1」。
  - teamUltimateCount 保持可选。
- `jufufu.test`：8 处直调补 `assistRate: 1, teamUltRate: 1`（两个用例的字面量，加上两个 describe 的 base），期望值不变。

### 13.4 反证

- countFrontActions：在临时文件里传缺 count 的行、第 2 参传 undefined，vue-tsc 各报 1 处（TS2741 / TS2345）。临时写回 `e.count ?? 0`，判据 28 报 `effectiveTime.ts:154`。
- computeJufufuCycle：在临时文件里直调不传两个比例、比例传 undefined，vue-tsc 各报 1 处（TS2345 / TS2322）。

以上都已还原。

### 13.5 零差

zd（不丢键）两次都是 DUMP 0 / ROWS 0：`983c4b10` 对 `3166475a`，`f50f0924` 对 `983c4b10`。生产实参都是有限 number，行字段都齐（§13.2），删掉的兜底在生产里一次都不会触发。本轮没有改文案。

### 13.6 验证

| 项 | `3166475a` | `983c4b10` | `f50f0924` |
|---|---|---|---|
| vue-tsc | 0 | 0 | 0 |
| guards | 29 | 29 | 29 |
| zc.test + checkGuards.test | 207 | 207 | 207 |
| tokens / data / specs / recording | 12 / 161 / 462 / 189 | 12 / 161 / 462 / 189 | 12 / 161 / 462 / 189 |
| vitest | 258/2155 + 262/2348 = 520/4503 | 258/2155 + 262/2348 = 520/4503 | 258/2155 + 262/2348 = 520/4503 |
| zd | — | 0 / 0 | 0 / 0 |
| build | 1598.38 kB | 1598.22 kB | 1598.02 kB |
| zc drift | 154 / 0 / 0 | 154 / 0 / 0 | 154 / 0 / 0 |

用例数不变：两次都没有增删用例。

### 13.7 不做与回退

- countFrontActions 不保留空串特判：行的 moveId 不为空，`e.moveId !== ''` 恒为真，删掉 filter(Boolean) 行为不变；探针也没见过空串 moveId。
- 不保留数组参数：融合排除只有支援突击这一种用法（克拉蕾反制走 data/moveFusions，奥菲丝的前台块走 timeBucket）。
- `Math.max(0, Math.floor(e.count))`，以及 computeJufufuCycle 里的 `Math.max(0, …)` / `Math.floor`，都保留：它们管的是负数和小数，与 undefined 无关，删了会改变行为。要删，得先逐个证明上游非负、已取整。
- 缺 assistFollowUpMoveId 的测试夹具不补：传 undefined 时不排除任何行，与旧写法相同。
- teamUltimateCount 不改必填：编排层没注入时用自身的终结次数，zd 里就有这种情况。
- §12.8 另记的 `e.dmgBonus ?? 0`（现在在 specPanelBuffs.ts:779、:788）核实过了：`SkillExecution.dmgBonus` 是可选字段（execution.ts:96），这个 `??` 不是死防御，保留，不再列为候选。
- 顺带修正 r746 / r747 写坏的表格行：r6 §8 第 746、747 行和 CC-529 的正文里有未转义的 `|`（如 `Pick<…, 'frontlineTime' | 'backstageTime'>`），GFM 会把一行拆成多余的列并丢掉超出的部分。只把正文里的 `|` 改成 `\|`，文字不变。r705 / r723 / r726 / r731 也有同样的问题，一并改了。别的 lane 的行不动。
- 回退：`git revert f50f0924`、`git revert 983c4b10`。两个提交改的是不同的代码块，可以各自单独回退。文档另有提交。

### 13.8 下一轮候选（r749 已做，见 §14）

1. **设置项的缺省值写了两处，读法也有两种。**
   - 声明里有 default，读取处又写一遍 `Number(cfgMechanicSettingRaw(cfg, id) ?? D)`。例：jufufu.frontSwitchRatio 两处都是 0.7。全仓这种读法 23 处、11 个文件（`f50f0924` 复数过）。
   - 另一种读法是 `cfgMechanicSetting(cfg, id, D)`（例：jufufuAdjustableRate）。
   - 下一步：
     - 先普查每处读取的 D 是否等于声明的 default。-1、'auto' 这类哨兵值单独看。
     - 再查注入层在用户没设置时会不会把声明的 default 写进 cfg。
     - 有不一致，先记差异、逐条归因（规则 10）；全部一致，再考虑让读取方只认声明里的那一份默认值。

另记（小，未立题）：

- computeJufufuCycle 剩下的 `Math.max(0, …)`：backstageTime 来自 effectiveBackstageTime，已经钳到 ≥ 0；aweInitial / c2WeishiPerUlt 来自 cfg 的 `?? 0`。要删，得先证明每个来源都非负（§13.7）。

## 14. r749：设置项缺省值只留在声明（删 cfgMechanicSettingRaw）

> 代码提交 `1c8b10d3` + `0532dc80`（trigger），两次 zd 都是 0/0（arena-G r749）；arch CC-532；r6 §8 第 749 行。题目是 §13.8 的候选。

### 14.1 问题

- CC-508 / CC-510 已把「settings 声明 default，读取处再手抄一遍」收进模块 reader（`mechanicSettingReader` / `mechanicSettingPanelReader`），并加了源码锁。锁只认两种写法：`reader(x, 'a.b', 数字)` 和 `settings['a.b'] ?? 数字或常量`。
- CC-363（r393）为收口 `'setting:…'` 字面量，把 24 处读法改成 `Number(cfgMechanicSettingRaw(cfg, id) ?? D)`（当时为零差，外层原样保留）。这种写法不在锁里，默认值仍写两处。按 cfgMechanicSettingRaw 的调用点数，实为 24 处、12 个模块（§13.8 记的「23 处、11 个文件」少了一处）。
- 普查（`look-a.py`，0e07fc8d）：20 处 D 与声明相同；另有 4 处不同——

| 设置项 | 读取处的 D | 声明 | 说明 |
|---|---|---|---|
| caesar.c4SubstitutionCount | 0 | 5 | 99e666b0（08-28「凯撒C4默认5次」）只改了声明和描述，读取处和「默认 0」的注释没跟着改 |
| yidhari.exPerStun | 影画 ≥ 1 取 3，否则 2 | 2 | 描述写「1命可连续释放默认3次」，实际一直按 2 算 |
| yeshuguang.formAxis | 缺键当 'auto'，另兼容 'full' 等字符串 | 0（打满） | R2C 裁决（09-25）：默认打满，只有用户显式设 -1 才自动退化 |
| remielle.frontSwitchRatio | 1 | 无声明 | 用户没有滑块可调，生产里恒为 1 |

- 为什么生产结果不受影响：引擎 `buildCharConfig`（`resourceCalc/helpers.ts:488–492`）对 `getAgentMechanic(agent.id).settings` 逐项调用 `writeMechanicSettingCfg(cfg, id, configStore.getMechanicSetting(id, default))`，先于模块的 buildCharConfig。store 的 `mechanicSettingOf` 只放行有限数字，否则给声明的 default。所以读取处的 D 只对手搭 cfg 的单测生效，叶瞬光的字符串分支在生产里走不到。

### 14.2 运行时探针（打在 HEAD 版 cfgMechanicSettingRaw 上，已还原）

记录读到「不是有限数字」的值：设置项 id、读到的值、前两帧调用栈，按进程去重。跑全量 vitest 两片和 zd。

- zd：只有 `remielle.frontSwitchRatio = undefined`（没有声明，生产里恒为 1，改成常量后等价）。
- vitest（去重后 65 条）：
  - 缺键的站点：remielle 24 条，soukaku.chopSlam 8 条，vivian 两项各 5 条，soukaku.exPressCount 3 条，qianxia / nekomata / jufufu / anton / orphie.frontSwitchRatio 各 2 条，orphie 另两项各 1 条。这些站点的 D 都等于声明值，改走 reader 后结果不变。
  - 那 4 个不一致的 id 里：caesar 只有 `caesar.test:61` 缺键（断言「默认滑杆 0 → 不生成」，靠的就是读取处那个过时的 0）；yeshuguang 只有 `yeshuguang.test:331` 传了字符串 'full' / 'short_mie'（「手动指定轴时自动退化不介入」那个循环）；yidhari 一条都没有（单测里读到的都是已预填的数字）。
  - 另 3 条来自锁测试自己的 Raw 语义用例。

### 14.3 改法（`1c8b10d3` 18 个文件 +78 / −89；`0532dc80` 1 个文件 +2 / −5）

- 11 个模块改用模块 reader（vivian、yeshuguang 复用已有的；新建的统一叫 `setting`；specPanelBuffs 同一文件里有两个模块，叫 `jufufuSetting`）。随之删掉 reader 已经保证过的东西：`Number()` 包裹、qianxia 的 `|| 0`、anton 的 typeof 分支、nekomata 和 miyabi 的 `Number.isFinite` 兜底（miyabi 那处兜底又写了一遍默认值 1）。
- remielle：直接传 1，注释改成「蕾米没有切上频率滑块，频率固定 1」。将来要做成可调，就在 settings 里声明再改用 reader——那是新功能，本轮不做。
- yeshuguang：两处各自解析滑块值（cfgAxis 和 estimateExSpecialTime 的 isAuto），合成一个 `axisSettingOf`：0 / 1 / 2 分别是打满 / 灭极短轴 / 仅灭短轴，其余（-1）是自动。删掉字符串兼容。
- yidhari：exPerStun 的描述改成「默认 2 次；1命可连续释放，请按实际调到 3 次」，与实际计算一致。
- caesar：「默认 0（凯撒为支援，默认不假定能量饥饿）」的注释改为「次数默认值见 settings 声明」。
- piper：applyPanel 里 `Number(settings['piper.momentumCoverage']` 换行 `?? PIPER_BUILDUP_COVERAGE_DEFAULT)` 是 CC-510 的裸索引写法，只因折成两行，逐行匹配的锁没扫到（`look-b.py` 普查全 agents，只有这一处）。改走 panel reader。
- utils：删 `cfgMechanicSettingRaw`。`mechanics/types.ts` 里 `AgentPanelInput.settings` 的注释示例原来教的正是被锁的 `settings['banyue.rageGainCoverage'] ?? 1`，改成 reader 写法。
- 锁（CC-508/510 那条）：
  - 改为整文件匹配：注释先换成等长空白，行号不变，`\s` 可以跨行；
  - fallback 写常量也算（原来调用形只认数字）；
  - reader 名带前缀也算（`\w*[sS]etting(?:Of)?`，覆盖 jufufuSetting / peiluoSettingOf）。
- 单测：
  - caesar.test「滑杆 0 → 不生成」改为显式设 0；用例名去掉「默认 0」。
  - yeshuguang.test 的手动轴循环删掉两个字符串值。
  - 锁测试删掉 cfgMechanicSettingRaw 的语义用例（−1 例）。
- trigger（`0532dc80`）：本地 `cfgSetting(cfg, id)` 包装对所有 id 统一 fallback 0，换成模块 reader。CC-508 当时把它当「动态 id 读口」保留，其实三个调用点（:223–225）都是字面 id，声明的 default 也都是 0，行为不变。
- 两条 @fact（agent:1131/强特、agent:1431/自动选轴）的锚函数这次动过，drift 报「待复核 2」。逐条核对：击数滑块默认 2、默认打满且只有显式设 -1 才退化，都仍成立；「据」追加 复核@2026-10-08，drift 回到 154/0/0。

### 14.4 反证

在改后的代码上临时写回三种写法，跑锁测试，三处全报：

- piper 的两行裸索引形 → `piper.ts:118`；
- `jufufuSetting(cfg, 'jufufu.frontSwitchRatio', 0.7)` → `specPanelBuffs.ts:621`；
- `setting(cfg, 'soukaku.exPressCount', SOUKAKU_SWINGS_DEFAULT)` → `soukaku.ts:81`。

已还原并逐字节比对。旧锁在 HEAD 上是绿的，而 HEAD 里就有 piper 那处两行写法，说明逐行匹配确实漏了它。

### 14.5 零差

zd 两套快照都是 0/0。yidhari 描述文案不在 zd 输出里，不加 ZD_DROP 也是 0/0。生产里每个设置都由引擎预填成数字，读取处的 D 从来用不上（§14.2）。

### 14.6 验证

| 项 | 结果 |
|---|---|
| vue-tsc | 0 |
| guards | 29 条全过，扫 298 个文件 |
| zc.test + checkGuards.test | 207 |
| tokens / data / specs / recording | 12 / 161 / 462 / 189 |
| zd | 两次都是 0/0（第二次以 `1c8b10d3` 为基准） |
| vitest | 258 / 2155 + 262 / 2347 = 520 文件 / 4502 例（比基线少 1 例，就是删掉的 Raw 语义用例；跳过 13 / 26 不变） |
| build | 1598.02 → 1597.70 → 1597.69 kB（index-CQTHSbb6.js，gzip 464.59） |
| drift | 154 / 0 / 0；触发器逾期 0、未到期 10 |

### 14.7 不做、口径待定与回退

- 不给蕾米加切上频率滑块：属于新功能，没人提过。
- yidhari「1 命默认 3 次」只记为口径待定，本轮不实现。要实现，协议得支持随影画变化的默认值，或者给「用户没设」留一个哨兵值；severian.ts:139 也写过协议分不出「用户设了」和「默认值」。本轮只把描述改成和实际计算一致。触发条件：用户提出 1 命应默认 3 次。
- specs/resources.ts:136 保留显式 fallback：id 来自遍历 spec 的 adjustable，fallback 就是 `adjustable.default`，没有重复。
- jufufuAdjustableRate 的 `cfgMechanicSetting(cfg, id, 1)` 保留：这两条比例在 spec 的 adjustable 里声明，只有经过 `mechanics/index.ts` 的 registerWithSpecSettings 注册后才会并进 `jufufuTigerRoarMechanic.settings`。直接 import 模块的单测没有注册，换成 reader 会抛「未声明」。
- 回退：`git revert 0532dc80`、`git revert 1c8b10d3` 可以各自单独回退，生产结果不变。

### 14.8 下一轮候选（r750 做了第 1 条，见 §15）

1. **设置的镜像字段把默认值又写了第三份。**
   - 有些模块在 buildCharConfig 里把设置值写进 cfg 字段，别的钩子再用 `cfg.字段 ?? D` 读。例：
     - yidhari 写 `cfg.yidhariExPerStun`，`yidhari.ts:161` 和 `:379` 两处读 `cfg.yidhariExPerStun ?? 2`；
     - piper 写 `cfg.piperMomentumCoverage`，`piper.ts:105` 读 `?? PIPER_BUILDUP_COVERAGE_DEFAULT`。
   - 生产里 buildCharConfig 总是先跑，这个 D 和 §14.1 的情况一样，只对手搭 cfg 的单测生效。
   - 下一步：
     - 普查 agents 里「由设置值写入、别处带 `?? D` 读取」的字段，以及 D 是否等于声明；
     - 在 HEAD 版打探针，确认生产里读取时字段总是已写入；
     - 再决定是改成必填字段，还是读取处直接用 reader。
2. （小）jufufuAdjustableRate 的 1 与 spec adjustable 的 `"default": 1` 重复（§14.7）。要去掉，得先有一个不依赖注册顺序、也能拿到 spec 声明的读法。只有一处，单独不立题，可以并进第 1 条一起看。

## 15. r750：删机制设置的 cfg 镜像字段

> 代码提交 `0487d921`，zd 0/0（arena-G r750）；arch CC-533；r6 §8 第 750 行。题目是 §14.8 的第 1 条候选。

### 15.1 问题

- 有些角色模块在 buildCharConfig 里把设置值换算后写进 cfg 私有字段，别的钩子再读这个字段。例：evelyn 写 `cfg.evelynGarroteCount = whole(setting(cfg, 'evelyn.garroteCount'))`，`cycleFromInput` 读 `Number(cfg.evelynGarroteCount ?? 4)`。
- 这类字段在 CharacterOperationConfig 上只能声明成可选（别的角色的 cfg 上没有它），所以读取处必须写 `?? D`。于是默认值写了三份：settings 声明一份，reader 回落（同一份），读取处的 D 又一份。
- 这层镜像出过事。2026-09-20 round 48 分诊发现：安比 `c2StunCoverage`、塞维林 `fengfengStacks` / `c4Coverage` 的读取处读的是没人写的镜像字段，滑块能拖，结果恒等于 D。当时的修法是补写镜像字段（anby.ts / severian.ts 原注释）。
- 普查（`look-c.py`，75e8bfaf）：agents 里由 reader 结果（直接或经局部变量）写入的 cfg 字段共 66 个。其中 56 个是纯镜像，分布在 21 个模块：写入是无条件的「换算(设置)」，没有第二个写入方，只在本模块读。另外 10 个不是镜像，见 §15.3 末尾。
- 读取处的 D 换算后和声明对比：只有克拉蕾 `claretCleaveCount` / `claretBloodBurialCount` 两个读 `?? 0`，声明是 1；其余都相同（雨果影画4 覆盖率读 `?? 0`，与命座门对 4 命以下给 0 一致）。增广声明的注释里也抄着默认值，如「默认 0.5」「默认0.75」，伊德海莉 exPerStun 的注释还写着「0命2 / 1命3」，和 CC-532 改过的描述不一致（实际一律默认 2）。

### 15.2 运行时探针（打在 HEAD 版 21 个模块上，已还原）

- 每处 `cfg.字段` 读取（按源码匹配共 70 处，含注释里的写法）外面包一层记录：字段名；cfg 上有没有引擎预填的 `setting:<id>` 键（有 = 引擎建的 cfg）；字段是否已写；前三帧调用栈。按进程去重。跑 vitest 两片和 zd。
- 结果：
  - 56 个字段在带键的 cfg 上读到的都是已写的值；
  - 「带键、未写」只有 3 条，都来自 harumasa.test.ts:132 / 142 / 154 手搭的 cfg（写了 `'setting:harumasa.a5Count': 2`，没写镜像字段），不是生产路径；
  - 不带键（手搭）又未写的读取涉及 9 个字段，它们的 D 都等于声明换算值，改后结果不变。
- zd 两套快照 0/0（探针只记录，不改值）。vitest 第 2 片有 2 例失败，都和探针有关：一例是 `src/__p750.ts` 里的 `'setting:' + id` 触发 CC-235 字面量锁；另一例是 zc 工作区测试，推测是探针新增的未跟踪文件所致。还原后的全量里这两例都通过。

### 15.3 改法（`0487d921` 41 个文件 +133 / −353）

- 读取处直接写「换算(reader(cfg, id))」，换算就是原来写入时那一段；删写入行，删 CharacterOperationConfig 增广里的声明（连同注释里抄的默认值）。
- 37 个字段只有一处读、换算只用模块级常量，原样搬过去（脚本处理）。另 19 个逐个处理：
  - 柏妮思：单 / 双喷秒数在 buildCharConfig（算耗能）和资源结果两处用，双喷上限随影画4 变，收成 `singleSpraySecondsOf` / `doubleSpraySecondsOf`；
  - 伊德海莉：`exPerStunOf`（生命值账本、收敛期返还上限两处用）和 `exHealMissingHpPctOf`（资源结果、自身烧血喧响两处用）；触手间隔、烧血速率各只有一处读，直接写；
  - 克拉蕾：两个次数在资源账本和 spec 事件 counts 两处读，读侧 `?? 0` 与声明 1 不一致的问题随之消失（spec 的 countField 查的是 counts 记录，不是 cfg）；
  - 雨果：回响覆盖率（6 命固定 1）和影画4 覆盖率（4 命以下 0）的命座门搬到读取处；
  - 塞维林：执行行原来是「字段有值用字段，没有就读设置」的三元，收成直接读设置；`cycleFromCfg` 的 Pick 去掉这个字段；
  - 安比：删「滑块 → cfg 的唯一通道」注释，头注释的历史缺陷改写成现状（原第一句说 cfgNum 是 cfgMechanicSetting 的别名，现在它已是模块 reader）；
  - 莱卡恩的 C1 覆盖率改在读取处读（同模块的 exHoldRatio 本来就这样读）；千夏的注释随读取点搬走；洛希在 buildCharConfig 内改用局部常量；艾莲 c4CdRate 两处读各写一次夹取。
- 协议单一来源 `utils/mechanicSettingCfg.ts` 的头注释加一段：模块在用到设置的地方直接调 reader，不要换算后写进 cfg 私有字段给别的钩子读。
- 不动的 10 个（值来自设置，但不是镜像）：
  - 引擎基础字段：`exSpecialEnergyConsume` / `exSpecialActionTime`（莱卡恩长按比例）、`initialEnergyGift`（派派、苍角）；
  - 派生量：`billyChainHp`、`healPctPerCurtainProviderUlt`、`liuyinPreviousTeammateSlot`；
  - `hugoRemainingStunSeconds`：轴内反推（hugo.ts:396）是第二个写入方；
  - `yuzuhaChainEntryCount`：影画2 在设置底数上 `+=`；
  - `luciaC4CurtainCoverage`：applyTeamConfig 写给全队的通道。
- 单测（19 个文件）：手搭 cfg 里的镜像字段，等于声明换算值的删掉（70 处），否则改写成真实输入 `'setting:<id>'`（33 处）。其中 ellen.test 的 `patchCfg` 底座把几项设成 0，有两个用例靠 extra 把它们覆盖回默认值；这两处删掉后就变成 0，所以又改写成设置键（净删 68、改写 35）。另外：
  - burnice / roxy 删掉断言镜像字段的行，耗能断言还在，仍覆盖默认秒数；
  - decibelRowParity 改读引擎 cfg 上的 `setting:roxy.spinSeconds`；
  - ellen 一个用例名里的字段名改成设置 id。

### 15.4 反证

在改后的代码上临时改两处，已还原并逐字节比对：

- evelyn 循环改回读 `Number(cfg.evelynGarroteCount ?? 4)` → vue-tsc 报 TS2339。增广声明已删，「读了没人写的字段」在类型检查这一步就过不去，2026-09-20 那类缺陷不会再出现。
- ellen 循环把 c6FeastCoverage 写死成 1 → ellen.test「ellen.c6FeastCoverage → 蓄力剪击行增伤差分」报错。改前这类滑块差分用例直接填镜像字段，测不到「设置 → 字段」这一段；现在填设置键，测的是整条链。

### 15.5 零差

zd 两套快照都是 0/0。理由：写入是无条件的「换算(设置)」，没有第二写入方；生产里读取都发生在写入之后（§15.2）。所以读取处现算的值和原来字段里的值相同。

### 15.6 验证

| 项 | 结果 |
|---|---|
| vue-tsc | 0 |
| guards | 29 条全过，扫 298 个文件 |
| zc.test + checkGuards.test | 207 |
| tokens / data / specs / recording | 12 / 161 / 462 / 189 |
| zd | 0/0 |
| vitest | 258 / 2155 + 262 / 2347 = 520 文件 / 4502 例（与基线相同；跳过 13 / 26 不变） |
| build | 1597.69 → 1594.31 kB（index-BIEAqNe9.js，gzip 463.92） |
| drift | 154 / 0 / 0；触发器逾期 0、未到期 10 |

### 15.7 不做与回退

- 不加新锁。删掉的字段已不在类型里，读回去 vue-tsc 就报（§15.4）。剩下 10 个从设置写 cfg 的字段都是正当通道，要写精确的源码锁就得带白名单，维护成本高于收益。规则写进了协议单一来源的头注释。
- 回退：`git revert 0487d921`。单提交，无数据迁移，生产结果不变。

### 15.8 下一轮候选（r751 做了第 1 条，见 §16）

1. 两个带第二写入方的设置字段，读取处还各有一份默认值：
   - 雨果 `hugoRemainingStunSeconds`：buildCharConfig 从设置写（hugo.ts:171），轴内反推再覆盖（:396），读取处 `?? 5`（:187）。可以照 `hugoAxisExVerdictCount` 的做法，让轴路径写自己的覆盖字段，读取处写「覆盖值 ?? 设置换算」。
   - 柚叶 `yuzuhaChainEntryCount`：设置作底数（yuzuha.ts:115），影画2 再 `+=`（:133），读取处 `?? 0`（:167）。可以改成读取处「设置 + 影画2 增量」。
   - 两处都小，可以并成一轮；先确认 convergence.ts:524 注释里提到的轴内反推读法。
2. （沿用 §14.8 第 2 条）jufufuAdjustableRate 的 1 与 spec adjustable 的 `"default": 1` 重复，难点仍是注册顺序。

## 16. r751：设置默认值只留在声明（收尾：两个带第二写入方的字段与钩子读取器）

> 代码提交 `5d737c73`，zd 0/0（arena-G r751）；arch CC-534；r6 §8 第 751 行。题目是 §15.8 的第 1 条候选，查的时候并入同类的钩子读取器通道。

### 16.1 问题

- r750 删镜像字段时留下两个不是纯镜像的设置字段，读取处各有一份默认值：
  - 雨果 `hugoRemainingStunSeconds`：buildCharConfig 写夹取后的设置值（hugo.ts:171），轴模式下 applyHugoTeamConfig 改写成轴内反推的剩余秒数（:396），cycleFromInput 读 `Number(cfg.hugoRemainingStunSeconds ?? 5)`（:187）。一个字段两种含义。同模块另外两个轴内量 `hugoAxisExVerdictCount` / `hugoAxisUltVerdictCount` 早就是「只在轴模式写、读取处看写没写选通路」。
  - 柚叶 `yuzuhaChainEntryCount`：buildCharConfig 以设置为底数（yuzuha.ts:115），影画2 再 `+= floor(有效战斗时间 / 20)`（:133），yuzuhaSourceFromCfg 读 `?? 0`（:167）。同一个影画2 公式在 applyTeamConfig 里又写了一遍（全队 `chainCountTotalExtra`），注释说两者「同源近似」，实际是两份代码。
- 查这两处时发现第三个读口：派发器递给钩子的 store 读取器 `getMechanicSetting(id, D)`（= `configStore.getMechanicSetting`）。agents 里手抄了 6 处 D：雨果 `stunRefundRatio` 的 5 / 1 / 1，爱丽丝 `alice.cinema6PerStateCount` 的 5（两处），琉音 `liuyin.c6EchoMax` 的 `CINEMA6_ECHO_MAX`。
  - store 里没有用户值时，这个读取器直接返回 D。所以这份 D 是**生产默认值**，不像 cfg / 面板两个读口的 fallback 只对手搭输入生效。改声明的默认值时，这 6 处会静默不跟。
  - 目前 6 个 D 都等于声明。
  - CC-508/510 源码锁只认带 cfg 首参的调用形和裸索引形，这一形漏网。

### 16.2 运行时探针（打在 HEAD 版两个读取点上，已还原）

- 做法：两个读取点在旧读法之外同时算新读法，逐位比较（Object.is）。记「cfg 上有没有引擎预填的 setting 键 × 相同 / 不同」，不同的另记新旧值和调用栈。跑 vitest 两片和 zd。
  - 雨果的新读法：轴路径写过的值 ?? 夹取(设置)。轴路径的值由探针在 applyHugoTeamConfig 写入处另存一份。
  - 柚叶的新读法：floor(设置) + 读取时现算的影画2 增量。
- 结果：
  - 引擎 cfg 上没有一次不同。按进程去重的首见行：雨果 22 个进程、柚叶 39 个进程；落盘的退出计数共 1276 / 6666 次读取。
  - 补跑雨果相关测试（15 个文件），把「轴路径写过」单独记：读到轴内值的有 7 个进程，全部相同。
  - 唯一不同的是 yuzuha.test.ts:140 手搭的影画6 cfg：它写了 `yuzuhaChainEntryCount: 0`，旧 0、新 2。生产里影画6 必带强制连携，到不了这个状态。
- 道理上也成立：
  - cfg.battleTime / invincibleTime 只在 helpers.ts 建 cfg 时写一次，所以读取时现算的有效战斗时间与 buildCharConfig 时相同。
  - convergence 每轮从 base cfg 克隆，再对克隆派发 applyTeamConfig，轴内值写在克隆上。新旧字段的生命周期一样。
- zd 0/0（探针只记录）。第 1 片 4 例失败都来自探针写法：`(cfg as any)` 触发零 any 锁和 guards。第 2 片全过。

### 16.3 改法（`5d737c73` 11 个文件 +88 / −70）

- 雨果：
  - 删 buildCharConfig 写设置的那行；applyHugoTeamConfig 改写 `hugoAxisRemainingStunSeconds`。
  - 读取处写 `cfg.hugoAxisRemainingStunSeconds ?? setting(cfg, 'hugo.remainingStunSeconds')`，不再夹取。0–15 的夹取由 computeHugoCycle 负责：剩余秒展示、决算倍率、失衡返还三个用途对夹取都不变。返还是 min(25%, max(0, 秒) × 5%)，15 秒以上同为 25%。
  - 增广声明换成新字段，和两个决算次数排在一起。
- 柚叶：
  - `forcedChainCount(命座, 有效秒)` 只写一处，applyTeamConfig 与 computeYuzuhaMechanic 共用。
  - computeYuzuhaMechanic 的 `chainEntryCount` 只表示设置值，在函数内 floor（与 parryCount 同样处理）；影画2 的入场由函数自己加。影画2 的 CD 缩短本来就在这个函数里。
  - yuzuhaSourceFromCfg 直接传设置。删 cfg 字段、buildCharConfig 里的两段写入和增广声明。
- 钩子读取器：
  - `utils/mechanicSettingCfg.ts` 加 `mechanicSettingGetterReader(declared)`，返回 `(get, id, fallback?) => get(id, 声明默认)`，与 cfg 读口、面板读口共用 `declaredDefault`。头注释写明：三个读口各用一个「声明即默认值」的 reader。
  - 雨果 / 爱丽丝 / 琉音共 6 处改用它。
  - 琉音的 `CINEMA6_ECHO_MAX` 随之无人用，删除（声明里本来就写着 12）。
  - 爱丽丝注释里抄的「默认5次」改成设置 id。
- convergence.ts:524 的迁移注释改用新字段名。
- 源码锁 mechanicSettingCfgSource.test.ts：CC-508/510 那条的正则加上 `getMechanicSetting('a.b', D)` 一形；补一条 getter reader 的语义用例（声明默认、显式覆盖、未声明抛错）。
- 单测：
  - convergenceNightD 6 处断言改读 `hugoAxisRemainingStunSeconds`（「非轴不写」的 toBeUndefined 语义不变）；convergenceNightB 用例名同步。
  - hugo.test 删 3 处等于默认值的 `hugoRemainingStunSeconds: 5`。
  - yuzuha.test 删「滑块经 buildCharConfig 落 cfg」用例：底部的完整计算链用例已经覆盖「滑块 → sweetnessFromChain」。
  - yuzuha.test 影画2 用例改为断言资源结果的 sweetnessFromChain（设置 4 + 强制连携 9）。
  - yuzuha.test 纯函数的影画2 / 影画6 用例，以及手搭影画6 的 buildExecutions 用例，按「影画≥2 必带强制连携」更新期望：硬糖 5→8、6→9、6→8，·极 9→11，预算 6→9。旧期望对应的状态生产里到不了。
- hugo.ts 的 `@fact engine:轴内块数落地` 锚在 applyHugoTeamConfig。函数动过，块数逻辑没动，追加 `·复核@2026-10-08`。

### 16.4 反证

在改后的代码上临时改以下几处，已还原并逐字节比对：

- 雨果读回 `cfg.hugoRemainingStunSeconds`、柚叶读回 `cfg.yuzuhaChainEntryCount` → vue-tsc 分别报 TS2551 / TS2339。
- 雨果 stunRefundRatio 第一项改回 `getMechanicSetting('hugo.remainingStunSeconds', 5)` → 源码锁报。
- computeYuzuhaMechanic 去掉强制连携 → yuzuha.test 3 例报（影画2 用例、硬糖用例、buildExecutions 用例）。
- cycleFromInput 忽略轴内覆盖、只读设置 → hugo.test「轴模式：决算倍率由轴内块位置反推」报。

### 16.5 零差

zd 两套快照都是 0/0，理由：

- 雨果：轴模式读到的是同一个轴内值，非轴读到的是同一个设置值（夹取不变的理由见 §16.3）。
- 柚叶：设置、命座、有效战斗时间三项输入，在 buildCharConfig 和读取时相同（§16.2）。
- 钩子读取器：6 个 D 都等于声明。

### 16.6 验证

| 项 | 结果 |
|---|---|
| vue-tsc | 0 |
| guards | 29 条全过，扫 298 个文件 |
| zc.test + checkGuards.test | 207 |
| tokens / data / specs / recording | 12 / 161 / 462 / 189 |
| zd | 0/0 |
| vitest | 258 / 2155 + 262 / 2347 = 520 文件 / 4502 例（删 1 例、加 1 例，与基线相同；跳过 13 / 26 不变） |
| build | 1594.31 → 1594.29 kB（index-Z5vJPp2t.js，gzip 463.95） |
| drift | 154 / 0 / 0；触发器逾期 0、未到期 10 |

### 16.7 不做与回退

- 引擎侧按 id 读模块设置、自带默认值的，本轮不动。例：`ultimatePromote.ts:205` 读 `liuyin.hug60Count` 给 -1，等于声明。
  - 这是编排层读角色设置。要去掉这份默认值，得让 store 的 `getMechanicSetting` 按注册表回落声明，store 就要依赖 mechanics 注册表，超出本轮，记为候选（§16.8）。
  - `guarantee.*` 刻意不注册；`boss.*` / `optimizer.*` / `time.*` 等不是模块设置，不在此列。
- 柚叶不单独保留「设置 → cfg」的用例：完整计算链用例覆盖滑块，影画2 用例覆盖「设置 + 强制连携」。
- 回退：`git revert 5d737c73`。单提交，无数据迁移，生产结果不变。

### 16.8 下一轮候选（r752 做了第 1 条，见 §17）

1. 编排层 / 视图层按 id 读模块设置时自带的默认值（`ultimatePromote.ts:205` 的 `liuyin.hug60Count` -1 等）。
   - 做法候选：store 的 `getMechanicSetting(id)` 省略 fallback 时，按注册表回落声明。
   - 先普查 composables / views / stores 里读**模块注册设置**的调用点，以及默认值是否等于声明。
   - 再看 store → mechanics 注册表的依赖方向能不能接受。现在 helpers.ts / ResourceUtilizationPage 的做法是遍历声明后传 `setting.default`。
2. （沿用 §14.8 第 2 条）jufufuAdjustableRate 的 1 与 spec adjustable 的 `"default": 1` 重复，难点仍是注册顺序。

## 17. 编排层不再按 id 读模块设置（r752，CC-535）

> 代码提交 `d9c98594`（纯重构，zd 0/0）+ `c8fa1610`（zcWorkspace 偶发失败，只改测试）（arena-G r752）；arch CC-535；r6 §8 第 752 行。题目来自 §16.8 第 1 条。

### 17.1 普查

§16.8 原先的设想是：store 的 `getMechanicSetting(id)` 省略 fallback 时按注册表回落到声明值。动手前先普查谁在模块外按 id 读模块设置。

- 取 `src/mechanics` 里声明的 141 个设置 id（`id: '<ns>.<name>'`），在 `src/mechanics` 以外的非测试 `.ts` / `.vue` 里找它们的字符串字面量。
- 不在注释里的命中只有一处：`composables/resourceCalc/ultimatePromote.ts#buildPromoteParams` 的 `configStore.getMechanicSetting('liuyin.hug60Count', -1)`。
  - 其余命中都在注释里：crossAgentSupply、ResourceUtilizationPage、panelPhases、wEngineStackCoverage、types/resource/config、mechanics/types。
- 编排层 / 视图里其他带字面默认值的 `getMechanicSetting`，读的都不是模块设置：
  - `guarantee.*`：刻意不注册；
  - `boss.*`、`optimizer.*`、`time.stunPlanProjection`；
  - `wind.*`：只在页面和 anomalyPanels 出现，没有模块声明；
  - `<ns>.releaseShare:<元素>`：动态 id，默认值是自动占比；
  - 合轴吸收比：具名常量。
- 以下几处本来就以声明为准：`helpers.ts#buildCharConfig` 和 `ResourceUtilizationPage#settingDisplayValue` 遍历声明传 `setting.default`；`impactVariables.ts` 用 settingMap 的 `meta.default`。

结论：按注册表回落只服务一个调用点。把这一处挪进模块后，它就没有消费者了，还会让 store 依赖 mechanics 注册表。所以不做。

### 17.2 这一处的问题

- 赠大编排簇已在 CC-35d-B3 / CC-43c 改成按能力找提供者（`ultimateGiftSource` / `promoteHugCounts`），却仍写死琉音的设置 id 和默认值 -1，这是声明之外的第二份默认值。
- 读到的值存进 `UltimatePromoteParams.hug60Setting`，再作为 `promoteHugCounts` 的第三个位置参数传回琉音。
  - convergence 轴模式在同一个位置传「轴声明的 60 次数 floor(h60)」。
  - 同一个参数平时是设置值、轴模式是轴声明值，和 r751 雨果 hugoRemainingStunSeconds 是同一类问题。
- 引擎侧 `liuyin.crossAgentSupply.supply` 早就用模块 reader 从自己的 cfg 读这个设置。

### 17.3 改法

- 钩子入参：新增 `PromoteHugInput { goodReviewTotal; stunCount; targetChainCountTotal?; hug60Cap? }`。
  - 类型放在 `mechanics/typesHooks.ts`，由 `types.ts` 转出，和 r732 挪过去的钩子入参放在一起。types.ts 行数 1336 → 1335。
  - `promoteHugCounts(input: PromoteHugInput & { getMechanicSetting })`。
- `liuyin.ts`：钩子 = `computeLiuyinHugCounts(G, n, hug60Cap ?? settingVia(getMechanicSetting, 'liuyin.hug60Count'), targetChainCountTotal)`。
  - 这就是「覆盖 ?? 设置」，默认值只剩声明里的 -1。
  - `computeLiuyinHugCounts` 本体不动。
- `ultimatePromote.ts`：
  - `promoteHugCountsOf` 绑定 store 读取器 `(id, fallback) => configStore.getMechanicSetting(id, fallback)`，返回只收 `PromoteHugInput` 的函数；
  - `promoteFixpoint` 不传覆盖；
  - `UltimatePromoteParams` 删 `hug60Setting`，`buildPromoteParams` 删那次读取；
  - 错位的 `ultimateGiftSourceOf` 注释挪回原处。
- `convergence.ts`：轴模式传 `hug60Cap: Math.floor(h60)`。
- 源码锁：在 `mechanicSettingCfgSource.test.ts` 新增一条。
  - 用 `getRegisteredMechanicSettings()` 取全部模块设置 id（含 spec adjustable）。
  - `mechanics/agents/` 以外的非测试源码去掉注释后，不得出现这些 id 的字符串字面量。
  - 编排层 / 视图要用模块设置，就遍历声明取 default，或者把读取器递给模块钩子、由模块自己读。
  - `utils/mechanicSettingCfg.ts` 头注释同步写明这条边界。

### 17.4 运行时探针

在 HEAD 版 `promoteFixpoint` 调钩子的地方打桩，只记录，已还原。比较两个值：

- 旧值 `p.hug60Setting`：在 buildPromoteParams 时读；
- 新读法 `configStore.getMechanicSetting('liuyin.hug60Count', -1)`：在钩子调用时读，也就是 settingVia 用声明的 -1。

结果：

- vitest 两片（2155 + 2347 全过）加 zd：58 个进程、至少 77450 次读取，DIFF 0。
- 见过的值有 -1 / 0 / 2 / 4，后三个来自 mechanicSettingsEffect 的三个探测点。
- 轴模式只是参数换了形式（floor(h60) 原样传进去），值的来源不变，不需要探针。

### 17.5 单测与反证

单测改动：

- promoteHugCapability：
  - 删「钩子就是 computeLiuyinHugCounts 本体」用例，它已不成立；
  - 能力用例改为断言：不传覆盖 = 读设置（未设时为 -1），传 `hug60Cap: 2` = 覆盖优先；两者都与直接调用逐位相同；
  - 用例取 390 好评、6 次失衡，两种情况分别得 {6, 0} 和 {2, 3}，能区分优先级。
- mechanicSettingsEffect：一处注释更新读取位置。它的 `liuyin.hug60Count` 用例走 `ultPromoteHug60`，正好覆盖钩子读设置这条路。

反证（都已还原）：

| 临时改动 | 结果 |
|---|---|
| convergence 改回位置参数 | vue-tsc TS2554 |
| 读回 `p.hug60Setting` | vue-tsc TS2339 |
| promoteFixpoint 用新 API 重新手抄：`hug60Cap: configStore.getMechanicSetting('liuyin.hug60Count', -1)`（行为零差） | 只有新源码锁报：`composables/resourceCalc/ultimatePromote.ts:337: liuyin.hug60Count` |
| 琉音钩子把优先级写反（设置 ?? 覆盖） | promoteHugCapability 报；liuyinAxisGiftSameSource / promoteVariantSkip / giftAxisProbe / stunPlanGiftChannel 都不报，所以这条覆盖断言要留 |
| 钩子不读设置（覆盖 ?? -1） | mechanicSettingsEffect 的 `liuyin.hug60Count` 用例报（v=0 时实到 3） |

### 17.6 验证

| 项 | 结果 |
|---|---|
| vue-tsc | 0 |
| guards | 29 条全过，扫 298 个文件 |
| zc.test + checkGuards.test | 207 |
| tokens / data / specs / recording | 12 / 161 / 462 / 189 |
| zd | DUMP 0 / ROWS 0 |
| vitest | 258 / 2155 + 262 / 2347 = 520 文件 / 4502 例（删 1 例、加 1 例，与基线相同；跳过 13 / 26 不变） |
| build | 1594.29 → 1594.50 kB（index-BTCUI7Dw.js，gzip 464.00） |
| drift | 154 / 0 / 0；触发器逾期 0、未到期 10 |

- drift：@fact `engine:失衡次数不动点` 的锚函数动过，口径未变，已加「复核@2026-10-08」。
- 第 2 片第一次跑时有 1 例失败，见 §17.7。
- `PromoteHugInput` 挪到 typesHooks.ts 发生在全量验证之后。这一步只动类型（编译后 JS 不变），补跑了 vue-tsc 0、guards 29、zc+guards 207、定向 14 个测试文件 170 例。

### 17.7 顺手修：zcWorkspace 偶发失败（`c8fa1610`）

- 失败的用例是「真 CLI 收工/释放后，仅自己活跃租约覆盖的变化属于自己」。
- 原因：
  - 用例给 `expired.ts` 的租约是 `at = time - 2000, ttlMs = 1000`，只比过期线多 1 秒墙钟。
  - CLI 在子进程里重新取 `Date.now()`，判过期用 `now - at > ttlMs`。
  - 只有墙钟回拨超过 1 秒，这条租约才会被当成活跃，`expired.ts` 才会被算进 ownedPaths。WSL 高负载下的时间同步会这样回拨。
- 以前两次记作「偶发、单跑通过」（`docs/mcp-stun-dual-source.md` :899 / :1187），都没查原因。本轮单跑 3 次都通过。
- 改为 `at = time - 3_600_000`（过期一小时），语义不变。改后第 2 片重跑，2347 例全过。

### 17.8 不做与回退

- store 的 `getMechanicSetting` 不按注册表回落到声明值。理由见 §17.1：唯一的调用点已挪走，没有消费者，还会让 store 依赖 mechanics。
- 模块之间互读设置不另加锁：
  - 普查 `mechanics/agents` 里读别的模块设置 id 的地方：0 处。
  - 现有机制已经挡住了这条路：
    - 模块 reader 绑定本模块的声明，读未声明的 id 又不给 fallback 会抛错；
    - 给字面 fallback 会被 CC-508/510 锁抓；
    - 钩子形会被 CC-534 锁抓；
    - `'setting:'` 字面量会被 CC-235 锁抓。
- `computeLiuyinHugCounts` 的形参名 `hug60Setting` 不改。它收的就是「已决定的 60 档上限（-1 = 自动）」，改名会动 @fact 锚函数，没有收益。
- `impactVariables.ts` 的 `meta?.default ?? 1` 本轮不动。meta 来自声明，`?? 1` 只在变量 id 不在当前 settingMap 时生效，见 §17.9。
- 回退：`git revert c8fa1610 d9c98594`。两个提交互不依赖，可以单独回退。无数据迁移，生产结果不变。

### 17.9 下一轮候选（r753 做了第 1 条，见 §18）

1. 沿用 §14.8 / §16.8 第 2 条：jufufuAdjustableRate 的 1 与 spec adjustable 的 `"default": 1` 重复，难点仍是注册顺序。
2. `impactVariables.ts#readImpactVariable` 的 `meta?.default ?? 1`：
   - 先查伤害影响页换队后，已选的 `setting.<id>` 变量会不会残留（这时 meta 才会缺）；
   - 不会残留，就删 `?? 1`，让 meta 必有；
   - 会残留，就保留，并在注释里写明这个场景。

## 18. spec adjustable 比例统一按声明读，模块 reader 去掉 fallback 形参（r753，CC-536）

> 代码提交 `1fff4c95`（纯重构，zd 0/0）（arena-G r753）；arch CC-536；r6 §8 第 753 行。题目来自 §17.9 第 1 条；普查后把同类的洛克茜两处一起做了，并收掉 reader 的 fallback 形参。

### 18.1 普查

- 起点：§17.9 第 1 条，橘福福 `jufufuAdjustableRate` 的 1 与 spec 1391 两条 adjustable 的 `"default": 1` 重复。当时记的难点是注册顺序。
- 注册顺序现在不是障碍：`vite.config.ts` 的 `setupFiles: ['./src/mechanics/index.ts']`（`6db533b9`，09-27）让每个测试文件先跑注册。不过本轮的改法不依赖注册（见 18.3）。
- spec JSON 共声明 37 条 adjustable，分布在 13 个角色。
  - 模块源码里按 id 读的只有 4 条：橘福福 2 条（1391）、洛克茜 2 条（1621）。
  - 其余 33 条只出现在 spec JSON 里，由 spec 解释器 `applyAdjustable` 按规则自带的声明读。
- 模块 reader（`mechanicSetting*Reader` 造出的函数）在 src 里共 236 次调用。
  - 生产代码带显式 fallback 的只有洛克茜 `roxyWindEnergySourceOf` 的两次 `cfgSetting(cfg, ROXY_*_RATE_ID, 1)`。
  - id 是常量，CC-508/510 的正则只认字面量 id，所以没拦住。
  - 其余带 fallback 的调用都在 mechanicSettingCfgSource.test 里，测的就是这个形参。
- 橘福福没走 reader：`jufufuAdjustableRate` 是 `Math.max(0, cfgMechanicSetting(cfg, id, 1))`。mechanics/ 下直接用裸读口 `cfgMechanicSetting` / `mechanicSettingOf` 的只有这一处。

### 18.2 问题

同一种声明（spec adjustable：default 1、min 0、max 2）有三种读法：

- 解释器 `specs/resources.ts#applyAdjustable`：取声明 default，再钳到声明区间（CC-511）。
- 洛克茜：reader 手抄 fallback 1，再用私有 `clampRate` 手抄 [0, 2]，非有限值取 1。注释写着「与 spec 声明的 min/max 同源」，实际上是抄的。
- 橘福福：裸读口手抄 1，只钳下界 0。

另外，reader 的 fallback 形参只剩这两处在用，它是「默认值只来自声明」（CC-508）仅剩的例外通道。

### 18.3 改法

- `specs/resources.ts`：
  - 抽出 `adjustableRate(cfg, adjustable)`，作为 spec adjustable 比例的唯一读法，`applyAdjustable` 改为调用它；
  - 新增 `specAdjustables(spec)`，枚举增益 / 消耗 / 反馈三类规则上的 adjustable。`specToMechanicModule` 改用它，删掉原来的 flatMap + filter 和 `ResourceRuleSpec` 导入；
  - 新增 `specAdjustableRate(cfg, id)`，按 id 从 `agentSpecs` 惰性建表，id 未声明就抛错。它只读 spec 注册表，与模块注册顺序、`registerWithSpecSettings` 的合并都无关。
- 洛克茜：
  - 删 `clampRate`，两处改为 `specAdjustableRate`；
  - `computeRoxyWindEnergy` 的 `energyRate` / `eyeRate` 未传时取 1（不缩放），钳制只在读取侧做一次；
  - `@fact agent:1621/风眼时序` 和 `余响时序` 锚在这个函数上。两条口径都未变（eyeRate 的滑块上限仍是 2），各追加复核@2026-10-08。
- 橘福福：删 `jufufuAdjustableRate` 及其注释，两处改为 `specAdjustableRate`；更新 `JufufuCycleInput`、`computeJufufuCycle` 里提到它的两条注释；不再 import `cfgMechanicSetting`。
- `utils/mechanicSettingCfg.ts`：
  - 三个 reader 和 `declaredDefault` 去掉 fallback 形参，删掉「显式 fallback 仍可覆盖」的说明；
  - 头注释写明：spec adjustable 走 `specAdjustableRate`，模块不直接调裸读口。
- 源码锁 CC-536（mechanicSettingCfgSource.test）：mechanics/ 下的非测试代码去掉注释后，不得出现 `cfgMechanicSetting` / `mechanicSettingOf`。三个 reader 用例删掉显式 fallback 的断言。
- resources.test 新增 `specAdjustableRate` 用例：
  - 未注入时取声明 default；
  - 钳到声明区间（5 → 2、-1 → 0）；
  - id 未声明就抛错。

### 18.4 运行时探针

在 HEAD 上打只记录的探针（已还原），比较旧值与新读法（声明 default + 区间）：

- 橘福福两个比例：`jufufuAdjustableRate` 的返回值；
- 洛克茜读取侧两个比例：`clampRate(cfgSetting(cfg, ID, 1))`；
- `computeRoxyWindEnergy` 去掉内部钳制后的值：`input.xRate ?? 1` 对比 `clampRate(input.xRate)`；
- 另在 `declaredDefault` 记录显式 fallback 的实际使用。

结果：

- vitest 两片（2155 + 2347 全过）加 zd，共记录 347 行（按进程去重）：DIFF 0，未声明 0。
- 四个站点都出现了 0 / 1 / 2 三个取值。
- 运行时用到显式 fallback 的只有洛克茜两条 id，另有锁测试自造的 x.y / x.z。

行为差异只有一处：橘福福的比例新增上界 2（spec 声明的 max）。存储值超过 2 才会不同，界面滑块最大就是 2，实际到不了。

### 18.5 反证（均已还原，cmp 核对）

| 临时改动 | 结果 |
|---|---|
| 洛克茜改回 `cfgSetting(cfg, ROXY_WIND_ENERGY_RATE_ID, 1)` | vue-tsc 报 TS2554；锁测试 8 例全过，两道源码锁都不报。这种写法只有类型能拦 |
| 橘福福 `assistRate` 改回 `Math.max(0, cfgMechanicSetting(cfg, ID, 1))`（行为零差） | vue-tsc 0，jufufu / adminRulingEffect 全过；只有 CC-536 锁报（import 和调用共 2 处） |
| `adjustableRate` 去掉上界钳制 | 只有 resources.test 的新用例报（expected 5 to be 2）；adjustableEffect 的 0 / 1 / 2 三点用例不报 |

### 18.6 验证

| 项 | 结果 |
|---|---|
| vue-tsc | 0 |
| guards | 29 条，扫 298 个文件 |
| tokens / data / specs / recording | 12 / 161 / 462 / 189 |
| zc.test + checkGuards.test | 207 |
| vitest | 258/2156 + 262/2348 = 520 文件 / 4504 例（+2：CC-536 锁、specAdjustableRate 用例）；跳过 13 / 26 |
| zd | DUMP 0 / ROWS 0 |
| build | index 1594.50 → 1594.54 kB（gzip 464.02） |
| zc drift | 154 / 0 / 0；触发器逾期 0、未到期 10 |

### 18.7 不做与回退

- 不改成「模块 reader 读注册后合并过的 `<module>.settings`」：这样也能删掉 fallback，但默认值仍依赖 `registerWithSpecSettings` 在注册期的改写，钳制也还得各模块自己抄。
- `computeRoxyWindEnergy` 的 `?? 1` 保留：它是纯函数「未传 = 不缩放」的默认值。测试直接调用时不传比例，生产侧总是传读取侧钳过的值。
- 不把 `cfgMechanicSetting` 改成模块私有：`specs/resources.ts` 还要用它；`mechanicSettingOf` 还被 `panelPhases.ts` 用来按声明预填记录。所以改用源码锁，只限定 mechanics/。
- 两个模块里的 adjustable id 常量保留：id 拼错或 spec 改名时，`specAdjustableRate` 第一次调用就会抛错，洛克茜和橘福福的单测都会走到这里。
- 回退：`git revert 1fff4c95`（单提交，无数据迁移）。

### 18.8 下一轮候选（r754 做了第 1 条，见 §19）

1. 沿用 §17.9 第 2 条：`impactVariables.ts#readImpactVariable` 的 `meta?.default ?? 1` 是否可达，即换队后已选的 `setting.<id>` 变量会不会残留。
2. `registerWithSpecSettings`（mechanics/index.ts）在注册时改写 `module.settings`。spec adjustable 的读取已经不经过这条路。
   - 先普查还有谁依赖改写后的列表：UI 列设置、settingDefaults、读 `<module>.settings` 的 reader；
   - 再决定能不能让注册表自己保存合并结果，不改模块对象。

## 19. 影响变量自带读写口径（r754，CC-537）

> 代码提交 `c32e9c09`（重构，zd 0/0；唯一行为差异在界面：失效的选择不显示当前值）（arena-G r754）；arch CC-537；r6 §8 第 754 行。题目来自 §18.8 第 1 条。

### 19.1 普查

- 起点：§18.8 第 1 条，`composables/impactVariables.ts#readImpactVariable` 的 `meta?.default ?? 1` 能不能走到。
- 读写入口只有两个函数：`readImpactVariable(id, store, settingMap, coverage)` 和 `writeImpactVariable(id, value, store, settingMap)`。
  - 它们先解析 id 字符串：`setting.` 前缀，以及 `<ns>.releaseShare:<元素>` 形状；
  - 机制设置变量再回 settingMap 查声明：读取缺省用 `meta?.default ?? 1`，`%` 判断用 `meta?.suffix`。
- 调用方（全量 grep）：
  - 读：`ImpactChart.vue#readVar`，`run()` 发车时读当前值；它还作为 prop 传给 `ResponseSurface3D.vue`，后者的 `curValX` / `curValY` 是 computed。另有两个测试文件。
  - 写：`impactSampling.ts` 三处（曲线一处、响应面两处），都在场景变量表里 find 到变量之后才写。另有两个测试文件。
- 查不到声明只有一种情况：传进来的 id 不在当前队伍的变量表里。两个组件的下拉选择换队后都不清空：
  - `ResponseSurface3D` 的 computed 换队后立刻用旧 id 读，徽标显示存储值或 1；
  - `ImpactChart.run()` 发车时也读一次；主曲线为空（采样函数 find 不到就返回空），快照曲线照常。
- 运行时探针（HEAD，只记录，已还原）：
  - 读写六个分支各记去重行。影响变量相关的 6 个测试文件（32 例全过）共记录 44 行，机制设置分支 meta 缺失 0 次。
  - 测试里唯一的旧 id 读取是 impactVariables.test 第二例的异放占比，走覆盖率分支，不经 meta。

### 19.2 问题

- 变量表是 `buildImpactVariables` 用 settingMap 和异放声明建出来的。读写要的口径（声明、存储键、元素）建表时都在手上，却没随变量对象带出去。
- 读写只好拿 id 反解字符串，再查一次 settingMap，于是要处理「查不到」。`?? 1` 就是这条分支手抄的默认值，跟声明无关。
- 调用方得把 settingMap 一路传下去：`impactVariableView` 专门回传 settingMap，给采样写入用。
- `ResponseSurface3D.vue` 自己声明了一个与 core `ImpactVariable` 逐字段相同的 `ImpactVar`，属于判据 29 说的重述（.vue 不在 guard 的扫描范围）。
- 两个组件本来就给「没有当前值」留了处理：
  - 模板里的 `v-if="curValX !== undefined"`；
  - 绘制时的 `curValX ?? minX`；
  - ImpactChart 的 `curVal` 也声明为 `number | undefined`。

  但读函数总是返回数字，这些分支从来不生效。

### 19.3 改法

- `impactVariables.ts`：
  - 新增 `TeamImpactVariable`（继承 core `ImpactVariable`）：机制设置变量带声明 `setting`，异放占比变量带 `releaseShare: { key, element }`，静态变量两者都没有；
  - `buildImpactVariables` 建表时挂上这两个字段；
  - `readImpactVariable(v, store, coverage)` 和 `writeImpactVariable(v, value, store)` 按这两个字段分派，静态变量照旧交给 core；
  - 删 `settingIdOf`、`RELEASE_SHARE_RE`、两处 settingMap 查找和 `meta?.default ?? 1`。
- `impactSampling.ts`：
  - `impactVariableView` 只返回变量表；
  - 三处写入改传变量对象；
  - 不再 import core 的 `ImpactVariable`。
- `ImpactChart.vue`：
  - `readVar` 改收变量对象；
  - `run()` 只在选择属于当前变量表时读当前值，否则为 `undefined`；
  - 快照曲线仍按 varId 采样：旧队伍的变量只要快照队伍里有，照样出曲线。
- `ResponseSurface3D.vue`：
  - 删本地 `ImpactVar`，props 改用 `TeamImpactVariable`；
  - `curValX` / `curValY` 只对当前变量表里的选择读值。
- 测试：
  - 两个测试文件改按变量对象调用；
  - 变量表与原组件的对照改用 `toMatchObject`：变量对象多了口径字段，对照的仍是展示字段；
  - 读写的逐值对照不变；
  - 删掉 impactVariables.test 第二例里「读取不属于当前队伍的变量」那一行（这种调用已经写不出来），例名去掉「覆盖率缺省也不崩」。

净变化：6 个文件，+70 / −91。

### 19.4 行为

- 变量表、读写、采样结果逐位不变：
  - 读写逐值对照（与原组件的内联写法比）全过；
  - zd DUMP 0 / ROWS 0。
- 唯一的差异在界面，只出现在选择失效（换队后不在当前变量表）时：
  - 2D 不显示「当前」徽标；
  - 3D 不显示徽标，当前点标记落在区间起点。

  原先显示的是存储值或 1，对当前队伍没有意义。

### 19.5 反证（均已还原，cmp 核对）

| 临时改动 | 结果 |
|---|---|
| `impactSampling` 写入、`ImpactChart` 读取改回传 id 字符串 | vue-tsc 各报一条 TS2345 |
| 建表时不挂 `releaseShare` | vue-tsc 不报（字段可选）；impactVariables 对照（fire 读到 0，应为 60）、impactSampling ① 曲线（各点总伤相同）和 ① 反例，共 3 例报 |
| 建表时不挂 `setting` | impactVariables 逐值对照报（singleSpraySeconds 读到 0，应为 1.89） |

### 19.6 验证

| 项 | 结果 |
|---|---|
| vue-tsc | 0 |
| guards | 29 条，扫 298 个文件 |
| tokens / data / specs / recording | 12 / 161 / 462 / 189 |
| zc.test + checkGuards.test | 207 |
| vitest | 258/2156 + 262/2348 = 520 文件 / 4504 例（与基线相同）；跳过 13 / 26 |
| zd | DUMP 0 / ROWS 0 |
| build | index 1594.54 kB（不变，gzip 464.02） |
| zc drift | 154 / 0 / 0；触发器逾期 0、未到期 10 |

### 19.7 不做与回退

- 换队时不清空下拉选择：
  - 快照曲线要用旧队伍的变量（快照队伍里有它就能出曲线）；
  - 清不清空是交互上的取舍，与本题无关。
- 不改 core 的 `ImpactVariable`：口径字段只属于编排层的队伍变量，静态表用不到。
- 不加源码锁：
  - 读写签名收变量对象，传 id 字符串就是 TS2345；
  - 漏挂口径字段由逐值对照测试拦（见 19.5）。
- 回退：`git revert c32e9c09`（单提交，无数据迁移）。

### 19.8 下一轮候选（r755 做了第 1 条，见 §20）

1. `core/impactVars.ts` 的静态变量。现状：
   - `IMPACT_VARIABLES` 表之外，`readImpactVar` / `writeImpactVar` 是两张按同一组 id 写的平行 switch；未知 id 读取走 `default: return 0`，写入什么都不做；
   - 抗性读取有 `?? 20`，而 store 的默认抗性表是 `defaultResistanceTable(0)`；cc337SingleSource.test 第 205 行锁的正是 20。

   做法：
   - 先查 `?? 20` 和 `slot1TimeWeight` 的 `?? 1` 在生产里能不能走到（存档或预设里的抗性表会不会缺键）；
   - 再看表项自带读写（与本轮同一方向）能不能消掉两张 switch 和未知 id 分支。
2. 沿用 §18.8 第 2 条：`registerWithSpecSettings` 在注册时改写 `module.settings`。本轮粗查到的依赖方：
   - `mechanics/registry.ts:28`：注册时写 settingDefaults；
   - `composables/agentMechanicView.ts:24`：teamMechanicSettings；
   - `composables/resourceCalc/helpers.ts:490`：buildCharConfig 遍历模块 settings；
   - 模块里读 `<module>.settings` 的 reader。

## 20. 影响变量表项自带读写（r755，CC-538）

> 代码提交 `6bcd6cc3`（纯重构，zd 0/0，生产读写逐值不变）（arena-G r755）；arch CC-538；r6 §8 第 755 行。题目来自 §19.8 第 1 条。

### 20.1 普查

- 起点：§19.8 第 1 条，`core/impactVars.ts` 的静态变量。
- 每个静态变量的 id 要在四处手工对齐：
  - `IMPACT_VARIABLES`（展示字段：标签、区间、后缀）；
  - `readImpactVar` 的 switch 和 `writeImpactVar` 的 switch；
  - 抗性另有 `RESISTANCE_VAR_ELEMENTS`（id → 元素）。
  - 拼错不报：读取落到 `default: return 0`，写入什么都不做（switch 没有 default）。
- 抗性读取的 `?? 20` 能不能走到。`enemy.damageResistances` 只有四个来源（全量 grep `damageResistances`）：
  - store 初值 `defaultResistanceTable(0)`，六键；
  - `applyBossPreset` 整表复制预设阶段：`public/static/boss-presets.json` 的 159 个阶段全部六键齐全；
  - `setResistance` 改单键；影响变量写入是展开旧表再改一键；
  - store 不持久化 enemy，生产代码没有 `$patch`。⇒ 生产里缺不了键。
  - 真缺键时三处口径不一：引擎 `anomalyPool/helpers.ts:786` / `:822` 按 0，属性页 `AttributeConfigPage.vue:371` 按 0，只有影响图按 20。
- `slot1TimeWeight` 的 `?? 1`：store 队伍初值 3 格（`defaultCharacter`），config.ts 里没有整队替换或删格；唯一的整队赋值是采样场景 `config.team = cloneConfigState(opts.team)`，同样 3 格；`CharacterConfig.basicAttackTimeWeight` 必填。
- 调用方（全量 grep）：
  - core 的 `readImpactVar` / `writeImpactVar` 只被 `composables/impactVariables.ts` 和两个 core 测试调用；
  - 编排层的 `readImpactVariable` 被 `ImpactChart.vue#readVar` 调用（readVar 同时作为 prop 传给 `ResponseSurface3D.vue`），`writeImpactVariable` 被 `impactSampling.ts` 三处调用；另有两个测试文件。
- 运行时探针（HEAD，只记录，已还原）：
  - core 读写入口、抗性读取、2 号位读取、未知 id 各记去重行。影响变量相关的 8 个测试文件（41 例全过）共 45 行。
  - 缺省只被两个测试桩走到：cc337SingleSource.test 的半张抗性表（wind → 20），impactVars.test 用 `undefined as any` 造的空 2 号位（→ 1）。
  - 未知 id 0 次；走真实 store 的 impactVariables / impactSampling 测试一次都没走到缺省。

### 20.2 问题

- 「变量是什么」和「怎么读写」分在四处，靠 id 字符串对齐，漏一处不报错。
- 两层分派：编排层 `readImpactVariable` / `writeImpactVariable` 先看 CC-537 的 `setting` / `releaseShare` 字段，都没有再交给 core 按 id switch。两层的根源相同：变量对象不带读写。
- 两个走不到的默认值，其中 `?? 20` 还和引擎口径（0）矛盾；它们被两个测试锁着（cc337 锁 20，impactVars.test 锁 1）。

### 20.3 改法

- `core/impactVars.ts`：
  - `ImpactVariable<C = ImpactVarConfig>` 加 `read(config)` / `write(config, value)`，都用展示单位；
  - 五个 enemy 标量和 `slot1TimeWeight` 逐项写读写；六种抗性由 `resistanceVar(element, name)` 生成，id、标签、区间、读写只写一处；
  - 删 `readImpactVar`、`writeImpactVar`、`RESISTANCE_VAR_ELEMENTS`、`?? 20`、`?? 1`；
  - `ImpactVarConfig.team` 改必填、每格权重必填。与 r724 处理 enemy 字段同一原则：默认值只在 store，桩要给全。
- `composables/impactVariables.ts`：
  - `TeamImpactVariable = ImpactVariable<ConfigModel>`；
  - 机制设置变量的闭包捕获声明：读 `getMechanicSetting(id, default)`，`%` ×100；写 `%` ÷100；
  - 异放占比变量的闭包捕获设置键和建表时的覆盖率：有存值读存值 ×100，未存读覆盖率 ×100；写 ÷100；
  - 删 `readImpactVariable` / `writeImpactVariable`、CC-537 的 `setting` / `releaseShare` 字段和 `ConfigStore` 别名。
- 调用方：`impactSampling.ts` 三处改 `v.write(config, x)`；`ImpactChart.vue#readVar` 改 `v.read(configStore)`；`ResponseSurface3D` 的 `readVar` prop 不变。
- 闭包捕获覆盖率为什么等价：ImpactChart 的 `allVars` 是 `computed(() => buildImpactVariables(…, coverageRate.value))`，覆盖率一变变量表就重建，原先读取时传的也是同一个 `coverageRate.value`；采样侧 `impactVariableView` 每个场景现建。
- 类型：`C` 只出现在参数位置。静态表项（收 `ImpactVarConfig`）可以放进 `ImpactVariable<ConfigModel>[]`：能收更宽配置面的函数，拿更窄的来调也成立。
- 测试：
  - cc337：抗性桩给全六键（store 不会缺键），删「wind 读 20」，改为写入后整表断言（只动 wind）；
  - impactVars.test：删「槽位为空时回退默认 1」（`undefined as any` 造的不可能输入），其余改 `slot1.read / write`；
  - impactVariables.test：改调方法；对照基准的静态分支照原组件交给 core，现在就是表项自身（r754 起本来就是同一函数自比）；`inlineAllVars` 的变量类型改 `Omit<ImpactVariable, 'read' | 'write'>`；
  - impactSampling.test：改调方法，① 删掉用不到的 coverage。

### 20.4 行为

- 生产读写逐值不变：
  - 一次性新旧对照（HEAD 的 core 存成临时模块，临时测试已删）：12 个静态变量展示字段相同；读值和 6 个写入值后的 enemy / team 快照（JSON 含键序）共 156 次比较全等；
  - 动态变量：impactVariables.test 的逐值对照（原组件内联写法）全过；
  - zd DUMP 0 / ROWS 0。
- 删掉的只有两个测试桩才走得到的默认值，以及锁它们的断言（impactVars.test 少 1 例）。

### 20.5 反证（均已还原，cmp 核对）

- 段 type：core 表项 `anomalyCoeff` 删 `write` → vue-tsc TS2741；异放占比变量删 `write` → TS2345。原先对应的错误（表里有 id、switch 漏 case）静默写不进去。
- 段 unit：`resistanceVar` 读错键 → cc337 报（undefined ≠ 10）；`slot1` 读 1 号位 → impactVars.test 两例报。
- 段 pct：机制设置写入不按 `%` 换算 → 逐值对照报（`burnice.flowCountUtilization`）。
- 段 share：异放占比读取忽略已存值 → 逐值对照报（electric 40 ≠ 30）。
- 不拦的：静态标量的映射整体写错（读写都指向同一个错字段）没有单测拦，与原 switch 相同；本轮这次改写由新旧对照兜住。

### 20.6 验证

- vue-tsc -b --force 0；check-guards 29（扫 298 个文件）；zc+checkGuards 207；tokens / data / specs / recording 12 / 161 / 462 / 189。
- vitest 258/2155 + 262/2348 = 520 文件 / 4503 例（基线 4504，删 1 例不可能输入；跳过 13 / 26 不变）。
- zd DUMP 0 / ROWS 0；build index 1594.54 kB（gzip 464.01）；drift 154 / 0 / 0，触发器逾期 0、未到期 10。

### 20.7 不做与回退

- 不把 `ResponseSurface3D` 的 `readVar` prop 换成组件自己读 store：保持该组件不碰 store。
- 不给静态标量映射补单测：原先也没有；映射在表里一行一项，改写这一次由新旧对照兜。
- 机制设置变量的读写键仍用 `setting.id`（与 CC-537 相同），变量 id 用 settingMap 的键。
- 回退：`git revert 6bcd6cc3`（单提交，无数据迁移）。

### 20.8 下一轮候选（未做）

1. 沿用 §19.8 第 2 条：`registerWithSpecSettings` 在注册时改写 `module.settings`（依赖方见 §19.8）。
2. 抗性表的键集合只靠约定。`AttributeConfigPage.vue#getResistance` 三类抗性读取都写 `?? 0`，但页面只遍历 `STANDARD_ENEMY_DEBUFF_ELEMENTS`（六元素），三张表在 `defaultEnemy` 和 159 个 Boss 预设阶段里都六键齐全，三处 `?? 0` 走不到。
   - 可评估：`defaultResistanceTable` 由 `STANDARD_ENEMY_DEBUFF_ELEMENTS` 生成，表类型收窄为按六元素索引，缺键变成类型错误；
   - 先查引擎按 `getBaseElement(element)` 取抗性时，元素会不会超出六元素（`helpers.ts:786` 的 `?? 0` 可能是真兜底）。
