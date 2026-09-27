# core/** 角色专属数学盘点（CC-70，2026-09-27 第 91 轮，lead-arena-0925c）

> 目的：「写死角色 id」清完后（census §5.78），盘点 `src/core/**` 里**不靠 agentId 判定、但按某个角色机制写**的逻辑，逐项裁定「留 core（通用引擎能力）」还是「迁 mechanics 模块能力」。
> 口径：core 可以有**机制概念**（帷幕、风蚀、乱流……）作为通用引擎能力，只要**角色归属与角色专属数值/文案**经模块能力注入；core 不应写死某角色的文案、倍率、默认参数。

## 1. 方法（可复现）

```
grep -rnEi 'billy|yidhari|velina|lucia|corrosion|curtain|banyue|yixuan|floria|liuyin|remielle|nome|jane|burnice' src/core --include=*.ts | grep -v __tests__ | grep -vE '^[^:]+:[0-9]+:\s*(//|\*|/\*)'
grep -rhoE '(cfg|config|c)\.[a-z][a-zA-Z0-9]+' src/core --include=*.ts | sort | uniq -c   # 再人工挑带角色名的字段
```
第 91 轮实测：去掉注释后 62 行命中，集中在下表各处；cfg 字段里带角色味的只有 `zhenyuanTriggerCount`、`cannonRotor*`、`cinema2CorrosionRate`、`decibelPerCurtainTrigger`、（注释里的）`aliceEnabled` / `remielleRainbowEndMoveId`。

## 2. 盘点表

| 位置 | 角色 | 逻辑摘要 | 现状 | 裁定 |
|---|---|---|---|---|
| `core/anomalyPool.ts`（原 :365–:386） | 维琳娜 1561 | 两条风蚀气旋异放事件记录（微域 145% / 风蚀替换广域 255%，label/formula/fields/note 全是维琳娜文案） | **CC-71 已迁（`81acc14`）**：模块能力 `anomalyCorrosionEvents`（velina.ts#buildVelinaCorrosionEvents），core 经 `corrosion.ts#resolveAnomalyCorrosionEvents` 追加 | done |
| `core/anomalyPool/corrosion.ts#resolveAnomalyCorrosion` | 维琳娜 | 风蚀状态机求值 | 已经模块能力 `anomalyCorrosion` 派发（CC-6d） | 留 core（派发器） |
| `core/anomalyPool.ts:36` 解构默认 `cinema2CorrosionRate = 2 / 3` | 维琳娜 C2 | 风蚀期望利用率默认值 | core 给了默认 2/3，而 `mechanics/types.ts#anomalyCorrosion` 注释写「引擎**不补默认值**，由模块侧 `resolveVelinaCorrosion` 兜底 2/3」——**两处都是 2/3，数值无差，但注释与代码矛盾** | **CC-72 done（`da6f203`）**：删 core 默认值，`undefined` 透传到模块兜底；`helpers.ts` 的 `cinema2CorrosionRate` 改可选。调用方已 grep：唯一生产入口 `roundInputs.ts:127` 总是显式传值（设置缺省 2/3），测试夹具也显式传 2/3 ⇒ 生产零差 |
| `core/anomalyPool/helpers.ts` 乱流 / `allocateBoostedEvents` / `EMPTY_CORROSION` | 维琳娜 | 乱流强化次数分配，读 `corrosionState.boostedTurbulenceCount` | 数据来自模块能力结果；算法是通用「把 N 次强化分配到乱流事件」 | 留 core |
| `core/anomalyPool/helpers.ts#CORROSION_CYCLONE_RELEASE_ID_PREFIX` | 维琳娜 | 事件 id 前缀单一事实源（CC-69） | 值 `'velina-corrosion'` 进入伤害池行 id，不可改 | 留 core（契约常量） |
| `core/resource/curtain.ts#curtainInfoOf` + `assembleSlot.ts:61–75` + `helpers.ts:296–314` | 卢西娅 1451 | 帷幕触发次数、提供者大招数、队友开幕 | 提供者经模块能力 `curtainTriggers`、开幕者经 `crossAgentSupply 'curtain-open'`，喧响系数经 cfg `decibelPerCurtainTrigger` | 留 core（通用「帷幕」引擎能力，归属已声明式） |
| `core/resource/resourceIncome.ts:90` `zhenyuanEnergyPerTrigger × zhenyuanTriggerCount` | 非角色（「真元奇枢」面板属性，statMeta.ts:136） | 受伤/回血回能 | 面板 stat × cfg 次数，通用 | 留 core |
| `core/resource/rowBuild.ts:548–559` `cannonRotor*` | 非角色（音擎「加农转子」类装备效果） | 按 CD 次数补直伤行 | cfg 字段驱动，通用 | 留 core |
| `core/resource/rowBuild.ts:225` `extraNecessaryAction` | 蕾米埃尔（注释提到 `remielleRainbowEndMoveId`） | 额外必要动作行 | 已是模块能力 | 留 core |
| `core/resource.ts:154`、`core/resource/helpers.ts:162`、`resourceIncome.ts:122` | 伊德海莉 | 注释：原 `agentId === '1051'` 判据已由 cfg 字段蕴含 | 仅注释 | 无动作 |
| `core/anomalyPool/helpers.ts:319` 注释 | 爱丽丝 1401 | 「aliceInfo 按 cfg.aliceEnabled 下发，CC-25 待模块能力化」 | 需核实 CC-25 是否已完成（`grep -rn aliceInfo src` 第 91 轮已无命中 ⇒ **注释过时**） | **CC-72 done**：注释改为「`roundInputs.ts#anomalyPoolSetupInfo` 取第一个声明 `anomalyPoolSetup` 能力的模块下发，CC-25 已完成」（已核实 alice.ts:524 `anomalyPoolSetup`） |

## 3. 结论

- core 里「角色专属文案/倍率」的最后一处（维琳娜气旋事件）已由 CC-71 迁走；其余都是**已声明式派发的通用引擎能力**或**装备/面板属性驱动**的通用逻辑，裁定留 core。
- CC-72（默认值矛盾 + 过时注释）已同轮完成，**core 角色数学这条线收口**。
- 若日后有人主张把「帷幕」「风蚀」整个机制搬出 core：它们目前都是「core 派发器 + 模块求值」结构，与 CC-6d/CC-67 的范式一致，搬家收益低、风险高（乱流/伤害池多处读结果）。回退本裁定的入口在本表对应行。
