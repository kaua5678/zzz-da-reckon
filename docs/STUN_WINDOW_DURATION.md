# 失衡窗口时长（stunDurationBonusSeconds）口径与缺口

> 立档 2026-10-20（用户点出「洛克茜有延长失衡 2s 的被动」，顺查发现是**系统性缺口**）。
> 本文件是**知识沉淀**，不是工作状态；工作项在 `.claude/OPEN-ITEMS.md`。

## 1. 这个量是什么

`PanelValues.stunDurationBonusSeconds` —— **全队加总**后进窗口时长：

```
W（单次失衡窗口秒数） = enemy.stunTime + 4（连携窗口） + Σ 各角色 stunDurationBonusSeconds
```

单一实现：`src/core/effectiveTime.ts#stunWindowDuration`（CC-217/CC-218 唯一入口）。
消费点两处（同源）：`useResourceCalc#computeWindowDuration`、`ultimatePromote` 的攒条折算。

**为什么它重要**：W 直接决定
- 失衡窗口占总时间比例 → `stunWindowFraction` → 窗口内动作**不攒下一次失衡条**（负反馈）
- 窗口内能塞多少爆发（`stunAxisStack` 的时间门）
- `solveTeam` 的「非失衡时间 ≥ 必要时间」判据

⇒ W 差 2s，池次数、外层收敛落点、伤害都会动（实测洛克茜 16→18s 让
`banyue-roxy-lucia` 从 `cycle/20` 变 `stable`）。

## 2. 缺口（2026-10-20 普查）

判据：`data/raw/nanoka_missing/full/<id>.json` 含「失衡(时长|时间|持续时间)」+
该模块是否有 `panel.stunDurationBonusSeconds +=` 写入。

| id | 角色 | 模块 | 原文 | 实现 |
|---|---|---|---|---|
| 1161 | 莱特 | lighter.ts | 溃败：失衡持续 +3s / +5s（C1） | ✅ |
| 1291 | 雨果 | hugo.ts | **决算**按剩余失衡时间算倍率/攒条（非「提升时长」） | — 语义不同，见 §3 |
| 1371 | 仪玄 | yixuan.ts | 终结技：失衡持续 +3s | ✅ |
| 1471 | 般岳 | banyue.ts | 摧岳命中失衡敌人：+2s（C1） | ✅ |
| 1481 | 琉音 | liuyin.ts | 恶意投诉：+2s | ✅ |
| 1511 | 南宫羽 | nangong.ts | 踉跄：+3s | ✅ 走**采集侧 buff**（`teammate-buffs.json` 的 `enemyStunDurationBonusSeconds`） |
| 1551 | 佩洛伊斯 | specPanelBuffs.ts | 决算：+3s（且终结一击结束失衡） | ✅ **2026-10-20 改为按块延长**（见 §7） |
| 1571 | 诺姆 | norma.ts | 技术鸿沟：+2s | ✅（`additionalAbilityActiveOf` 门控；单人夹具为 0 是正确行为） |
| 1581 | 蕾米埃尔 | remielle.ts | 惊鸿命中失衡敌人：+3s | ✅ **2026-10-20 补**（采集 buff 里没有，需模块自己加） |
| 1621 | 洛克茜 | roxy.ts | 额外能力·辉金心脏：+2s | ✅ **2026-10-20 补**（此前只在注释里） |

**结论（2026-10-20 修正后的真实状态）**：10 个提到该词的角色里，**实际只有 2 个真缺**——
洛克茜 1621（只在注释里）与蕾米埃尔 1581（采集 buff 也没有），两者本次均已补。
1511 走采集侧 buff、1551 走 spec teamBuffs（本次改成按块延长）、1571 有额外能力门控，三者**本来就生效**。

⚠ **第一版普查的判据是错的**（教训，别再踩）：只扫了 `src/mechanics/agents/*.ts` 的
`panel.stunDurationBonusSeconds +=`，漏掉了三条同样生效的通道：
1. **采集侧 buff**：`public/static/teammate-buffs.json` 的 `stat: "enemyStunDurationBonusSeconds"`
   （`core/buff.ts:749` 映射到同一面板字段）——1511 就在这里；
2. **spec teamBuffs**：`src/specs/agents/<id>.json` 的 `teamBuffs[].effects[].stat`——1551 原来在这里；
3. **额外能力门控**：`if (additionalAbilityActiveOf(panel))` 包着的模块加成——1571 是这种，
   单人夹具读 0 是**正确**的（条件不满足），不是缺陷。
⇒ **正确判据 = 跑 `computePanelPhases` 读真实面板值**（`.zc/perf/stunAudit3.perf.ts` 的做法），
不是 grep 源码。

## 3. 为什么「文字→乘区」这条链会漏

不是模板不成熟，而是**这个量有三个特殊性质**，使它逃过了常规检查：

1. **它不在角色自己的面板上生效**，而是「全队加总」后才影响一个**队伍级**参数（W）。
   ⇒ 单角色面板测试（`panel.stunDmgMultiplierBonus` 那类）**看不见它**。
2. **没有专属的显示位**。伤害/暴击/贯穿都有卡片，失衡时长只在「失衡池」卡片的窗口时长里
   间接体现 ⇒ 漏了不会有人发现。
3. **原文句式分散**：「进入失衡状态后的失衡持续时间提升 N 秒」出现在
   核心被动 / 额外能力 / 影画 / 终结技描述里，措辞有 5 种变体
   （失衡持续时间 / 失衡时间 / 失衡时长 / 失衡状态后…），**没有统一的字段名可 grep**。

## 4. 护栏（本次补的）

- `src/mechanics/__tests__/roxy.test.ts` 新增「额外能力·失衡时长 +2s 进面板」用例（含负控：
  删掉实现即红）。
- `timeGolden` 快照新增 **`windowDur` 字段**：此前 `slots` 的 7 个字段没有一个记录窗口时长，
  于是「窗口时长变了」在时间账上**完全不可见**，会被 R23-N2 误判成「纯伤害回归」。
  补字段后该类改动可被正确归类为时间账变化。

## 5. 待办（未做）

- ~~1511 / 1551 / 1581 三个角色的 +N 秒尚未实现~~ → **2026-10-20 已全部落地**（同一批提交 `2c30edc4`）：
  1511 走采集侧 buff（`teammate-buffs.json` 的 `enemyStunDurationBonusSeconds`，`core/buff.ts:749` 映射）、
  1551 改为按块延长 `stunWindowExtendOnEnd`（见 §7）、1581 补进 `applyRemiellePanel`（带负控用例）。
  ⚠ 原文**早于本条写下的「未实现」是错的**：第一版普查判据只 grep 了模块源码，漏了采集 buff / spec teamBuffs /
  额外能力门控三条同样生效的通道（教训见 §2 末）。
- 1291 雨果的「决算按剩余失衡时间」是**另一种机制**（读剩余时间、不改窗口长度）——**已实现**
  （`hugo.ts`，走 `endsStunWindow` 同族的剩余时间读取，不进 `stunDurationBonusSeconds`）；
  本档只记录它不是同一类，不是缺口。

⇒ **本节当前无活待办**。本文件 §2 表是逐角色实现的唯一事实源。

## 6. 口径裁决（用户 2026-10-20）

> 「捏轴不隐含合轴……此处直接用全局合轴率计算多余时间就行，差值被合轴吸收那就吸收呗，合轴应得的。」
> 「失衡是需要计入 180s 的，通常 4 失衡中，27 秒用来打失衡和积累资源，18s 用来失衡爆发。4 次就是 180s。」
> 「捏轴就是规定了失衡期内的动作计数，这并不代表什么时间重叠和什么合轴之类。」
> 「最后一窗口要么失衡不够导致时间慢了，最后失衡窗口时间残疾，要么资源回复来不及，导致动作次数残疾。」

⇒ **失衡窗口时间计入 180s**；窗口内动作占窗口时间；**合轴吸收是合法的**（全局合轴率算），
不需要为「捏轴看起来 0 重合」做特殊处理。

## 7. 佩洛伊斯决算：**按块的窗口延长**（不是常驻面板加成）

原文：「右分支·[终结技：永陷幽囚]：重击命中失衡敌人触发决算效果……**招式发动时**，使所有处于
失衡状态的敌人**失衡持续时间提升3秒**，终结一击命中时敌人失衡结束。」

### 为什么不能像其它角色那样加 `stunDurationBonusSeconds`
其它角色的 +N 秒是**窗口开始时就已生效**的常驻延长（进入失衡那一刻窗口就更长）。
佩洛伊斯不同：
- 它由**决算招式自己**在施放瞬间触发，**同一窗口只发生一次**；
- 作用是「**让你在窗口最后 0.1s 放大招也能打完**」（用户口径 2026-10-20 逐字：
  「就算你大招放在失衡的最后0.1s，他也能触发延时让你打完大招然后触发决算」）。

⇒ 按常驻面板加，会让**每一次**失衡窗口都多 3s，而决算只发生在有决算的窗口 ⇒ 系统性高估。

### 实现（2026-10-20）
模块能力 `stunWindowExtendOnEnd(moveId, cinemaLevel): number`（`src/mechanics/types.ts`），
佩洛伊斯声明 `1551016 → 3`（`specPanelBuffs.ts#PEILUO_VERDICT_WINDOW_EXTEND`）。
派发器 `resourceCalc/helpers.ts#axisMoveExtendOnEndOf` → 传入 `core/stunAxisStack.ts` 的
`StackTraversalInput.extendOnEndOf`，轴栈据此把**该窗口的有效时长**放宽 N 秒；
`convergence.ts` 的决算截断秒数同步按延长后的窗长算。

**两条同批简化**（用户口径 2026-10-20）：
1. 「大招在最后不会出窗口，不计算跨窗易伤」⇒ 该块 `fits` 恒 1（本来就由 `endsStunWindow` 保证）；
2. 「大招后立即决算不用算窗口时间」⇒ 该块结束即窗口结束，不再向后延。

### 现状（如实登记）
机制已接通（`axisMoveExtendOnEndOf('1551','1551016',0) === 3`），但**当前引擎语义下无可观测差异**：
`endsStunWindow` 块已把 `fits` 强制为 1、且截断后不填平A ⇒ 延长 3s 不改变任何读数
（实测 `.zc/perf/peiluoTrunc.perf.ts`：noExt 与 withExt 的 `basicFill`/`timeUsed` 完全相同）。
它的价值在于**口径正确性**：① 不再给非决算窗口白送 3s（本次已从 spec teamBuffs 移除该常驻条目）；
② 为将来「决算块的跨界易伤/窗口时间精细化」留好单一落点。

⚠ spec `1551.json` 的 `teamBuffs[].effects` 现已留空并附 `note` —— 这是有意的：
该条目只承载文档与门控语义，数值走模块能力（防两套账）。
