# 平A池 carve 只留一份实现（r742）

> 代码提交 `2a162c29`（纯重构，zd 0/0）+ `78cc9bec`（艾莲池能量双计修正，规则 10）（arena-G r742）；arch CC-524；r6 §8 第 742 行。题目来自 `docs/mcp-frontline-row-seconds.md` §11.7（r741 交接的候选）。

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
- 一律换新行对象。rowBuild 给 `preModuleExecutions` 的是浅拷贝（`moduleInputRows.push(...executions)`），原地改会改到「钩子派发前」的快照。琉音、南宫原来是原地改，它们的 `preModuleExecutions` 没有读方，换成新对象观察不到差别。
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
- `preModuleExecutions` 是浅拷贝快照，别的钩子原地改 core 行也会漏进去（见 §7）。本轮只保证 helper 自己不原地改。
- ultimatePromote 轴模式下，目标没有前台平A行时，first-match 可能找到莱卡恩的后台 `basic_attack` 行。保持原语义，不改。
- 不为 `carveBasicPool` 单独写测试：5 个角色各自的测试和 zd 已覆盖；行为改动由 `ellen.test` 守恒用例的能量断言守住。

## 6. 回退

- 只撤艾莲能量修正：`git revert 78cc9bec`（两份基线和佩洛伊斯快照一起回去）。
- 连重构一起撤：先撤 `78cc9bec`，再 `git revert 2a162c29`。
- 文档另有提交。

## 7. 下一轮候选（未做）

**`preModuleExecutions` 不是真的「钩子派发前」快照。** `rowBuild.ts` 在调 `buildExecutions` 前 `moduleInputRows.push(...executions)`，存的是同一批行对象。钩子原地改 core 行，快照就跟着变。grep 到的原地改（`src/mechanics/agents/*.ts`，`行.字段 = …`）：青衣 :277–279、伊德海莉 :225–233、克拉蕾 :715–717、莱卡恩 :256–258、雅 :326 / :329、希格莉德 :540–544，以及 evelyn、grace、lighter、nangong :298、nicole、phoenix、roxy、seth、severian、specPanelBuffs、starlightBilly、yixuan、yuzuha 的若干处——其中一部分改的是模块自己建的行，不在快照里，要逐个分。

快照的读方现在只有 luciaElowen、青衣（排除 basic_attack）、specPanelBuffs 橘福福、qianxia，都没读到被改的字段，所以眼下没有错数。

下一步：

1. 把快照改成逐行浅拷贝（`moduleInputRows.push(...executions.map(e => ({ ...e })))`），跑 zd。0 差就说明没有读方依赖被改过的值，契约从源头成立，`carveBasicPool` 注释里「换新对象」那条可以删掉。
2. zd 不为 0，就是有读方在读钩子改过的值，逐条归因：是 bug 就按规则 10 修，是有意的就把快照语义写清楚。
