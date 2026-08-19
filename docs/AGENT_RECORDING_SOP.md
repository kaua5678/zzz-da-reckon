# 角色录入 SOP（AI 快速上手）

> 流程与口径见 `README.md` §3 与 `src/specs/template.json` `_comment`；管线数据流见 `docs/ENGINE_PIPELINE_GUIDE.md`；
> 中文术语→字段见 `docs/GAME_TERM_TO_CODE_FIELD.md`。本文只回答一个问题：
> **录的字段到底有没有被计算消费？**（教训：战栗减抗录了 spec 却从未进计算，靠用户肉眼发现。）

## 0. 铁律

1. **每个录入的机制 = spec 字段 + 生效测试**。没有测试的录入不算完成。
2. **spec 不是数据源，代码消费端才是**。录入后先回答：哪个函数读它？
3. **不要依赖 `enrichExecutionPlan` 之后的 name/note 匹配**（会被倍率表回填覆盖），测试/逻辑按 `moveId` 匹配。
4. **自定义 TS 模块角色**（`src/mechanics/agents/*.ts` 注册过的）**绕过 spec 解释器**：spec 里的 adjustable 滑块、attributeConversions 是死数据，机制必须在模块里实现。

## 1. spec 字段 → 消费者 → 生效测试 清单

| spec 字段 | 消费端 | 生效测试模式 | 备注 |
|---|---|---|---|
| `attributeConversions` | spec 解释器 `specs/mechanics.ts`（仅无自定义模块的角色） | 面板字段断言 | 自定义模块角色 → 在模块 `applyPanel` 实现，spec 留空 |
| `resources`（含 adjustable） | spec 解释器 `specs/resources.ts`（仅 spec 模块角色） | 资源结果断言 | 自定义模块 → 模块读 `setting:<id>`，spec 无消费者 → 别录 |
| `events` / `rowFusions` / `stateMachines` | spec 解释器 | 执行行/事件断言 | 同上 |
| `teamBuffs` | **`stores/catalog.ts` `mergeSpecTeamBuffs`（加载时合并，按 id 去重，spec 优先）** | 面板 `enemyXxx`/全队字段断言 | 与 `teammate-buffs.json` 同 id 不重复 |
| `verifications` | `scripts/validate-specs.mjs` → vitest 自动跑 | panel → expected | 用户确认的数值都放这 |
| `notes` | 人读（spec 页面/排查） | 无 | `[已确认]` / `[猜测·X]` 标注 |
| `status` | `docs/implementation-status.md` 矩阵 | 无 | 不被 import 降级 |

## 2. 自定义模块钩子（`AgentMechanicModule`，JSDoc 在 `src/mechanics/types.ts`）

| 钩子 | 阶段 | 典型用途 | 生效测试 |
|---|---|---|---|
| `applyPanel` | computePanelPhases（面板层） | 转模、面板 buff、额外能力门控（`panel.additionalAbilityActive`） | `computePanelPhases` 面板字段断言 |
| `buildCharConfig` | 配置层 | 预存倍率/时间表到 cfg（`record.<key>`）、跳过通用强特 | cfg 字段断言 |
| `estimateExSpecialTime` | iterate 每轮 | 强特链必做前台时间（资源收敛用） | 收敛次数断言 |
| `buildExecutions` | 执行计划 | 专属动作行（连段/循环/附伤载体） | damagePoolRows 断言 |
| `patchExecutions` | 执行计划修正 | moveId 级增伤/暴伤、行替换 | 行字段断言 |
| `buildResourceResult` | 资源结果 | 专属 cycle/资源卡数据 | resourceResult 断言 |

**iterate 与 buildExecutions 分离**：次数先收敛（多轮），执行计划从收敛态生成一次。模块在 buildExecutions 里算出的值只能经 **cfg 字段**留给下一轮 estimate 使用（般岳嗔火固定点、比利星光同款模式）。

## 3. 常见坑（按踩坑频率）

1. **`import-specs.mjs` 整文件覆盖人工字段**（已修复：默认合并保留 notes/teamBuffs/verifications/status，`--force` 跳过）。
   跑完任何 import/生成脚本后，**跑一次 vitest** 确认人工字段（尤其 teamBuffs）还在。
2. **双轨数据源**：`teammate-buffs.json`（采集）与 spec `teamBuffs`（人工）。消费端已合并（spec 优先按 id 去重）。
   新角色队友增益 → 录 spec `teamBuffs`（source 写「影画X」自动按命座门控），不要手改 teammate-buffs.json。
3. **enrichExecutionPlan 回填覆盖**：moveName/note 会被倍率表 zhCN/回填文案替换；行匹配一律用 `moveId`。
4. **自定义模块角色 spec 字段无消费者**：adjustable 滑块/attributeConversions 是死数据（般岳战栗是反例：应录 teamBuffs，它有消费者）。
5. **命座提升率联动放大**：技能等级 → daze → 失衡次数变化 → 伤害暴涨假象（3 命技能+2 曾被放大成 +20%）。`computeCinemaGains` 固定失衡次数场景：**阈值调节会被失衡自激破坏**（阈值变小 → 失衡次数变多 → 连携/喧响变多 → 失衡总量暴涨，无稳定点），已改为 `enemy.stunCountLock` 直接锁定次数（`calcOutput` 按固定次数算一轮，不收敛）；手工对比命座时同样锁定。
6. **失衡窗口时长**：引擎 `computeWindowDuration` = stunTime + 4 + 全队 `stunDurationBonusSeconds`（角色级延长），轴编辑器 `maxDur` 用导出的 `windowDuration`，不要硬编码。
7. **测试环境**：fetch 需 stub 三个静态文件（catalog/teammate-buffs/build-recommendations），见 `src/mechanics/__tests__/banyue.test.ts` 顶部模板。

## 3.5 命座提升率丢失 / buff 丢失 · 根因与自查（星徽·比利 1531 录入实证）

命座提升率显示 0% / 偏低 / 偏高，几乎都是**效果没被计算消费**或**消费在错误的层/乘区**。按根因分类自查：

| 根因 | 症状 | 实测案例 | 自查 |
|---|---|---|---|
| 面板 buff 施加点错误 | 覆盖率滑块不生效，提升率恒定不变 | 般岳 `rageGainCoverage`：applyPanel 读 `panel.banyueRageCoverage`（从未被写入的对象）→ 滑块失效 | `applyPanel` 早于 `buildCharConfig`、拿不到 configStore/settings。覆盖率滑块只有两条合法路径：① `computePanelPhases` 硬编码块（jane/liuyin/1531 模式，能读 configStore）；② buildCharConfig 写 panel 字段、后续 transform/patch 钩子读取（miyabi 模式） |
| 作用域错误 | 提升率偏高（buff 作用到不该作用的招式/角色） | 旧 `billyStarGlowMechanic` 把星辉挂**全局 dmgBonus**（文本只作用 6 个目标招式） | 每录一个 buff 问三问：谁受益（自身/全队/敌人）？哪些招式（moveId 集合）？哪个乘区？ |
| 乘区位置错误 | 提升率数值不对（非零但错） | C6"贯穿伤害+18%"最初挂通用增伤区，应为**贯穿增伤乘区**（`sheerDmgBonus`，引擎后补执行级通道） | 乘区查表：通用 `dmgBonus` / 元素 / `skillDmgBonus*` / 贯穿 `sheerDmgBonus` / 暴伤 `critDmgBonus` / 抗性 `enemyXxxResReduction` / 基础区 `flatDamageBonus` |
| 计数源错误 | 次数类 buff 量不对 | 孤轮+8 决意只按付费强特计（**免费衔接的孤轮漏算**，后改按孤轮总次数）；格挡按招架近似（应为 `blockCount` 交互次数） | buff 次数由什么驱动：闪能 / HP / 交互次数 / 命中次数？按真实来源计数，**不要拿邻近计数近似** |
| 条件门控缺失 | 不满足条件也生效 | 星辉未挂 `panel.additionalAbilityActive` 时无条件增伤 | 文本"队伍存在X时" → 声明式 `teamConditions` + 门控；"自身攻击" → 面板/执行级而非全队 |
| 无回归断言 | 改引擎后悄悄丢 | — | 每个命座效果补**命座差分测试**（见 §5），而非只断言"开着时字段=某值" |
| 命座切换不刷新资源配置 | 执行级命座效果（buildExecutions/patchExecutions 读 `record.<agent>CinemaLevel`）全部 +0%，面板级效果（applyPanel）却正常 | 仪玄 2/4/6 命 +0%：`setCinemaLevel` 不触发 `refreshTrigger` → `resourceConfig`（buildCharConfig 产物）缓存不失效 → 模块命座字段永远是旧值 | 模块级命座效果必须验证「setCinemaLevel 切换后生效」；`setCinemaLevel` 需 `refreshTrigger++`（该 setter 已修复，新角色照此） |
| 命座门槛缺失 | 低命座也有高命座专属执行 | 仪玄 0/1 命也生成聚墨·符法千重-破（影画2 专属，缺 `cinemaLevel >= 2` 判断） | 命座专属执行 push 前必须带 `cinemaLevel >= N` 门槛，并用差分测试断言 0 命不生成 |

**铁律补充**：命座效果录完后，必须跑一次**该命座开/关的差分断言**（`computePanelPhases` / `damagePoolRows` / `resourceResult` 的字段差异）。只断言"开着时字段=某值"发现不了"效果从未接进计算"——字段恒为默认值的断言照样通过（般岳战栗减抗就是靠用户肉眼发现的）。

**系统级兜底（资源利用率页「命座提升率」自检）**：逐命座对比 局内面板字段 diff + 伤害增量，自动打标——`ok`（有字段变化）/ `执行级`（无面板变化但伤害提升，moveId 级效果属正常）/ `⚠无变化`（无字段无伤害，效果可能未接进计算）。录入时不必手工做整套差分，但**至少跑一次命座提升率计算确认无橙色警示**。

## 4. 验收命令（录入完成后）

```bash
npm run verify      # validate:data + validate:specs + vitest + typecheck + build（一条链）
npm run docs:status # 重新生成 implementation-status.md（CI 检查漂移）
```

## 5. 生效测试模板（机制录入必备）

```ts
// 面板级机制：applyPanel / teamBuff
expect(computePanelPhases(0, config, catalog)!.inCombat.<field>).toBe(<value>)
// 执行行机制：buildExecutions / patchExecutions
const rows = calc.damagePoolRows.value
expect(rows.find(r => r.moveId === '<moveId>')!.count).toBe(<n>) // 按 moveId，不按 name/note
// 资源循环：buildResourceResult
expect(calc.resourceResult.value!.characters[0].banyueRageCycle.rageCount).toBe(<n>)
```

**命座差分模板（防"效果没接进计算"）**：断言 0 命 vs N 命的字段差异，而不是只断言开着时的值：

```ts
const p0 = computePanelPhases(0, config, catalog)!.inCombat
config.team[0].cinemaLevel = N
const pN = computePanelPhases(0, config, catalog)!.inCombat
expect(pN.critDmg - p0.critDmg).toBe(90)        // 例：星徽·比利核心被动暴伤（0→1命应看到 enemyPhysicalResReduction +18 等）
expect(pN.enemyPhysicalResReduction - p0.enemyPhysicalResReduction).toBe(18)
```

## 6. 拐力 / 快录清单（莱特·妮可·苍角·凯撒实证）

> 目标：已有 `teammate-buffs` 草稿的支援/防护，1～2 小时内可验证交付。

### 6.1 拐力双轨：何时改哪边

| 情况 | 做法 |
|---|---|
| `teammate-buffs.json` 已有该角色完整 buff 组 | **优先修/用现成 buff**（改 description、formula、cap、defaultStacks）；再补门控与薄模块 |
| 草稿没有 / 错 id / 要新命座拐 | 录 **spec `teamBuffs`**（`source.zhCN` 写「影画X」自动命座门控），由 `mergeSpecTeamBuffs` 合并 |
| 同一效果两边都有 | **不要双写**；保留一侧，另一侧 `hidden` 或删除 |

`source` 写「影画一」…「影画六」→ `syncTeammateBuffsFromTeam` 按影画等级启停。核心/额外能力不写影画字样。

### 6.2 额外能力标准接线（漏了就永远开着）

1. spec `additionalAbility.teamConditions`（`sameAttributeAsSelf` / `sameFactionAsSelf` / `specialty`…）
2. `computePanelPhases` 里 `evalAdditionalAbility(...)`
3. **按 buff id 过滤**启用的 teammate buff，例如：
   - `nicole.additional_ether_damage`
   - `soukaku.additional_ice_damage`
   - `lighter.additional_morale_ice_fire_dmg`
   - `caesar.additional_battle_spirit_dmg`（凯撒另：有队友即近似「可招架支援」）
4. 模块侧可读 `panel.additionalAbilityActive`

只写第 1 步不做第 3 步 = 条件文本存在但计算不关门。

### 6.3 `buffModifiers`（×1.2 / ×1.5）

- 挂在**命座 buff**上，`operation: multiplyResolvedValue`，`targetBuffIds` / `targetEffectIds` 指向核心条。
- 收集端扫**全部**已启用 buff 的 modifiers（不要写死某个 id）。
- 测 C2：断言 `c2.field - c0.field` 等于放大后的差分（例：凯撒 1000→1500 差分 +500，不是绝对值 1500）。

### 6.4 `hidden` buff

- `hidden: true` 的条**不得**再进 `collectInCombatTeamBuffs`（已过滤）。
- 若改由 `helpers` 手写数值（耀嘉音咏叹随技能等级）：notes 写清「本条 hidden，数值在 helpers」；**禁止** hidden 仍带 effects 又 helpers 再加一遍。

### 6.5 公式读技能等级 `s` / 源面板

- formula 里 `s` = `dynamicSkillLevel` = `12 + source.skillLevelBonus`。
- 3/5 命要涨数值时：在 `buildTeammateBuffSourceContext` 之后给 `sourcePanelsByOwner[agentId].outOfCombat/inCombat.skillLevelBonus` 写入 2/4。
- 冲击力等「先自身加成再给队友公式」：先改 source 面板再 `calcPanel`（莱特喷发 impact×1.2）。

### 6.6 邻位回能模板（终结 +10 / 下一位再 +20）

1. 纯函数 `assignXxxUltNeighborEnergy(slots, selfSlot)` → 三人 30/10，两人 30  
2. `applyXxxTeamEnergyFlags(characters)` 写 `cfg.xxxEnergyPerXxxUlt`  
3. `useResourceCalc` 组队后调用 apply  
4. `calcXxxUltEnergy` 在 iterate 能量总和里 `+ per × ultimateCount`  
（丽娜 / 露西 / 苍角同款）

### 6.7 能量口径

| 点 | 规则 |
|---|---|
| 普通能量 vs 闪能 | `cfg.isFlashUser === true` 的消耗**不要**计入「全队能量消耗」类机制（莱特士气） |
| `exSpecialEnergyConsume = 0` | `resolveExSpecialCount` **恒返回 0**；和弦/士气等自管耗能时必须关掉通用强特 |
| CD 回能整局近似 | `floor(battleTime / cd) × amount` 并入 `initialEnergyGift`（妮可 C2、莱特 C4 喷发定额等） |

### 6.8 「简单角色」快录路径

1. 读 nanoka 原文满级被动 + 影画；对照 `teammate-buffs` 组是否已有  
2. 修 buff 文案/公式；补 `additionalAbility` + helpers 过滤  
3. 薄 `src/mechanics/agents/<id>.ts`：只做草稿没有的（执行级增伤、邻位回能、转模、C6）  
4. `mechanics/index.ts` 注册  
5. 测试：纯函数 + 面板差分 +（如有）执行行 `moveId`  
6. `character-constellations.json` 更新该 id 状态；`MECHANICS_IMPLEMENTATION.md` 加一小节  
7. `npm test -- <file>` + `npm run typecheck` → commit/push  

范围扩大/无敌/护盾吸收量等**无乘区**效果：constellations 标 skip/pending，不要假装进伤害。

### 6.9 改静态 JSON 纪律

- **禁止**对 `teammate-buffs.json` / `catalog.json` / `character-constellations.json` 整文件重 dump 改缩进。  
- 只改目标 `group id` / `buff id` / `characters[id]`。  
- 改完用脚本确认：`changed groups/chars` 只有预期 id。

## 7. 测试卫生（面板断言）

1. **用公共 harness，不要复制 stub**：`src/test/harness.ts` 提供 `mockStaticFetch()`（stub catalog/teammate-buffs/build-recommendations 三静态文件）、`setupHarness(team)`（pinia + 加载 + 队伍装配 + syncTeammateBuffsFromTeam）、`setTeam(config, team)` 自由组合；模板见 `src/mechanics/__tests__/billySmoke.test.ts`（已迁移）
2. **关掉默认全局危局** `globalBuffs`（默认常带 `dmgBonus +15`，会污染绝对值）
3. 优先 **差分**：`inCombat - outOfCombat`、`cinema N - cinema 0`
4. 队友自带 buff 时不要 `expect(etherDmg).toBe(0)` 这类绝对值；用「相对局外增量」
5. 额外能力负例：选**不同属性且不同阵营**的队友
6. 执行级：只 assert `moveId`，不 assert 回填后的 name/note
7. 全量回归网：`src/composables/__tests__/allAgentsSweep.test.ts` 自动跑 60 角色 × 命座 0/6 的
   数字 moveId 有效性 / 次数非负 / 时间字段非负 / 伤害有限断言——改引擎后跑一遍可提前发现跨角色回归
   （刻意不做 frontlineTime ≤ 战斗时间 全局断言，口径见该文件头注释）
