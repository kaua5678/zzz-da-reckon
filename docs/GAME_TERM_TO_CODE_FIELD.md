# 游戏中文术语 → 计算器字段映射表

> 给 AI 快速查询：看到技能文本中的中文效果 → 对应哪个计算器字段。
> 字段定义见 `src/types/catalog.ts` `PanelValues`，乘区公式见 `src/core/damage.ts`。
> 字段元信息（label/zone/mode）见 `src/utils/statMeta.ts` `STAT_META` 数组。

---

## 0. 两个隐藏规则（必读）

### 0.1 百分比 vs 固定值

看数值有没有 `%` 号：
- 有 `%` → 百分比字段，字段名含 `Pct` 后缀
- 无 `%` → 固定值字段，字段名含 `Flat` 后缀
- 例外：暴击率/暴伤/元素伤害加成等天生就是百分比，字段名无 `Pct` 后缀，但 `STAT_META.mode` 标记为 `'pct'`

### 0.2 局外 vs 局内

Buff 引擎默认规则：**来源没有显式写 `scope: 'outOfCombat'` 时，一律视为局内**。

| 来源 | 默认局外/局内 | 判断依据 |
|------|-------------|---------|
| 驱动盘主副词条 | 局外 | 数据中明确 scope |
| 音擎高级词条（白值） | 局外 | 数据中明确 scope |
| 音擎被动效果 | 局内 | 战斗中触发 |
| 驱动盘套装效果 | 局内 | 战斗中触发 |
| 核心被动 | 局外/局内 | 看文本：条件触发/战斗中 → 局内；无条件面板 → 局外 |
| 额外能力 | 局内 | 需要队伍条件触发 |
| 影画/命座 | 局内 | 战斗中触发 |
| 队友 Buff | 局内 | 战斗中触发 |

局外字段前缀 `outOfCombat`，局内字段前缀 `inCombat`。无前缀的兼容字段（`atkPct`、`hpFlat` 等）由来源 scope 决定实际阶段。

---

## 1. 基本属性（攻击/防御/生命）

| 游戏文本 | 字段 | 百分比/固定值 | 局外/局内 |
|---------|------|-------------|---------|
| 攻击力提升 X% | `atkPct` / `outOfCombatAtkPct` / `inCombatAtkPct` | 百分比 | 看来源 |
| 攻击力提升 X 点 | `atkFlat` / `outOfCombatAtkFlat` / `inCombatAtkFlat` | 固定值 | 看来源 |
| 生命值上限提升 X% | `hpPct` / `outOfCombatHpPct` / `inCombatHpPct` | 百分比 | 看来源 |
| 生命值上限提升 X 点 | `hpFlat` / `outOfCombatHpFlat` / `inCombatHpFlat` | 固定值 | 看来源 |
| 防御力提升 X% | `defPct` / `outOfCombatDefPct` / `inCombatDefPct` | 百分比 | 看来源 |
| 防御力提升 X 点 | `defFlat` / `outOfCombatDefFlat` / `inCombatDefFlat` | 固定值 | 看来源 |

**公式**：`最终值 = 基础值 × (1 + Σ百分比) + Σ固定值`（百分比和固定值分批次汇总，同一批次内先加百分比再固定）。

---

## 2. 暴击区

| 游戏文本 | 字段 | 说明 |
|---------|------|------|
| 暴击率提升 X% | `critRate` | 暴击率，伤害计算中封顶 100% |
| 暴击伤害提升 X% | `critDmg` | 暴击伤害 |
| 强特暴击伤害提升 X% | `critDmg__exSpecial` | 技能专属暴伤，仅强化特殊技生效（伤害公式按 `skillDamageTarget` 定向读取） |
| 普攻/终结/连携暴伤提升 X% | `critDmg__{basic\|ultimate\|chain...}` | 技能专属暴伤，按招式类型定向；同 `critRate__{type}` 支持暴击率定向 |
| 锐暴伤害 X% | `sharpCritDmg` | 锋御职业锐化伤害暴击时替代暴击伤害 |
| 强击暴击率 X% | `assaultCritRate` | 仅物理强击使用 |
| 强击暴击伤害 X% | `assaultCritDmg` | 仅物理强击使用 |
| 异常暴击率 X% | `anomalyCritRate` | 异常伤害暴击率 |
| 异常暴击伤害 X% | `anomalyCritDmg` | 异常伤害暴击伤害 |

**注意**：暴击率/暴伤本身就是百分比，字段名无 `Pct` 后缀。

---

## 3. 增伤区

所有增伤区字段加算，进入 `1 + Σ增伤 / 100`。

| 游戏文本 | 字段 | 说明 |
|---------|------|------|
| 造成的伤害提升 X% | `dmgBonus` | 通用增伤，对所有伤害生效 |
| 物理伤害提升 X% | `physicalDmg` | 元素增伤 |
| 火属性伤害提升 X% | `fireDmg` | 元素增伤 |
| 冰属性伤害提升 X% | `iceDmg` | 元素增伤 |
| 电属性伤害提升 X% | `electricDmg` | 元素增伤 |
| 以太伤害提升 X% | `etherDmg` | 元素增伤 |
| 风属性伤害提升 X% | `windDmg` | 元素增伤 |
| 辉光伤害提升 X% | `lumifluxDmg` | 辉光元素增伤 |
| 普攻伤害提升 X% | `skillDmgBonus__basic` | 招式限定增伤，只对普攻生效 |
| 强特伤害提升 X% | `skillDmgBonus__special` | 招式限定增伤，只对特殊技生效 |
| 终结技伤害提升 X% | `skillDmgBonus__ultimate` | 招式限定增伤，只对终结技生效 |
| 连携技伤害提升 X% | `skillDmgBonus__chain` | 招式限定增伤，只对连携技生效 |
| 闪避反击伤害提升 X% | `skillDmgBonus__dodgeCounter` | 招式限定增伤 |
| 追加攻击伤害提升 X% | `追加攻击伤害` | 走 `skillDmgBonus` 配合 `targetSkillType` |
| X 招式造成的伤害提升 X% | `skillDmgBonus` + `targetSkillType` | 通用招式限定，指定生效的招式类型 |

**注意**：`skillDmgBonus` 字段支持 `targetSkillType` 指定招式类型（basic/special/exSpecial/ultimate/chain/assist/dodgeCounter/dashAttack）。带 `targetSkillType` 的 buff 会解析到 `skillDmgBonus__{type}` 字段。

---

## 4. 防御/穿透区

**有效防御公式**：`有效防御 = max(0, 怪物防御 × (1 - 穿透率/100) × (1 - 减防/100 - 无视防御/100) - 穿透值)`

| 游戏文本 | 字段 | 说明 |
|---------|------|------|
| 穿透率 X% | `penRatio` | 百分比降低防御，与减防**乘算** |
| 穿透值 X 点 | `penFlat` | 固定值降低防御，最后减 |
| 防御力降低 X% | `enemyDefReduction` | 减防，与减防/无视防御**加算** |
| 无视目标 X% 防御力 | `enemyDefReduction` | **与减防同字段**，加算 |
| 防御力降低 X 点 | `enemyDefFlatReduction` | 固定值减防 |
| X 属性防御降低 X% | `enemy{Element}DefReduction` | 元素专属减防，仅影响该元素伤害 |

**示例**："无视防御"和"减防"都走 `enemyDefReduction`，两者加算后与 `penRatio` 乘算。

---

## 5. 抗性/易伤区

**有效抗性公式**：`有效抗性 = max(0, 怪物抗性 - 抗性降低/100)`，抗性区 = `1 - 有效抗性/100`

| 游戏文本 | 字段 | 说明 |
|---------|------|------|
| 全属性抗性降低 X% | `enemyResReduction` | 全局减抗 |
| 物理伤害抗性降低 X% | `enemyPhysicalResReduction` | 元素专属减抗 |
| 火属性伤害抗性降低 X% | `enemyFireResReduction` | 元素专属减抗 |
| 冰属性伤害抗性降低 X% | `enemyIceResReduction` | 元素专属减抗 |
| 电属性伤害抗性降低 X% | `enemyElectricResReduction` | 元素专属减抗 |
| 以太伤害抗性降低 X% | `enemyEtherResReduction` | 元素专属减抗 |
| 风属性伤害抗性降低 X% | `enemyWindResReduction` | 元素专属减抗 |
| 辉光伤害抗性降低 X% | `enemyLumifluxResReduction` | 辉光专属减抗 |
| 受到伤害提升 X% | `enemyDamageTakenBonus` | 易伤，独立乘区 |

**注意**："无视抗性"和"抗性降低"都走 `enemy{Element}ResReduction`，加算。

---

## 6. 失衡区

| 游戏文本 | 字段 | 说明 |
|---------|------|------|
| 冲击力提升 X% | `impactPct` / `outOfCombatImpactPct` / `inCombatImpactPct` | 百分比，看局外/局内 |
| 冲击力提升 X 点 | `impactFlat` / `outOfCombatImpactFlat` / `inCombatImpactFlat` | 固定值，看局外/局内 |
| 造成的失衡值提升 X% | `stunBuildUpBonus` | 失衡值提升，可指定招式类型 |
| 受到的失衡值提升 X% | `enemyStunTakenBonus` | 敌人受到失衡值提升（物理畏缩） |
| 失衡抗性降低 X% | `enemyStunResReduction` | 敌人失衡抗性降低 |
| X 属性失衡抗性降低 X% | `enemy{Element}StunResReduction` | 元素专属失衡抗性降低 |
| 失衡易伤提升 X% | `stunDmgMultiplierBonus` | 失衡时额外易伤 |

---

## 7. 异常积蓄区

| 游戏文本 | 字段 | 说明 |
|---------|------|------|
| 异常精通提升 X 点 | `anomalyProficiency` | 异常精通，无上限 |
| 异常掌控提升 X 点 | `anomalyMastery` | 异常掌控，无上限 |
| 异常积蓄效率提升 X% | `anomalyBuildUpEfficiency` | 全元素积蓄效率 |
| X 属性异常积蓄效率提升 X% | `{element}AnomalyBuildUpEfficiency` | 元素专属，如 `physicalAnomalyBuildUpEfficiency` |
| 异常积蓄抗性降低 X% | `enemyAnomalyResReduction` | 敌人积蓄抗性降低 |
| X 属性异常积蓄抗性降低 X% | `enemy{Element}AnomalyResReduction` | 元素专属积蓄抗性降低 |

**公式**：`单次积蓄 = 基础积蓄 × (异常掌控/100) × (1 + 积蓄效率/100) × (1 - 有效抗性/100)`

---

## 8. 异常伤害区

| 游戏文本 | 字段 | 说明 |
|---------|------|------|
| 异常伤害提升 X% | `anomalyDmgBonus` | 异常伤害增伤，影响 DOT/初始化伤害 |
| 紊乱伤害提升 X% | `disorderDamageBonus` | 紊乱增伤，替代 `anomalyDmgBonus`，不影响 DOT |
| 异放伤害提升 X% | `releaseDamageBonus` | 异放增伤，子类加算 |
| 灼烧/感电/侵蚀 DOT | `calcStandardDotDamage()` | 引擎自动算，`STANDARD_DOT_CONFIG` 注册参数 |
| 风化/畏缩/霜寒 | 无 DOT | 只有持续状态（buff），没有 DOT 伤害；风化有浸染(infection)直伤+10%独立乘区 |
| X 属性异常伤害提升 X% | `windAnomalyDmgBonus` 等 | 元素专属异常增伤 |
| 紊乱基础倍率提升 X 点 | `disorderBaseMultiplierBonus` | 加到紊乱基础倍率（如 450→700） |
| 异常持续时间延长 X 秒 | `{element}AnomalyDurationBonusSeconds` | 元素专属，如 `physicalAnomalyDurationBonusSeconds` |

---

## 9. 能量/喧响区

| 游戏文本 | 字段 | 说明 |
|---------|------|------|
| 能量自动回复提升 X% | `energyRegenBonusPct` | 百分比，作用于基础回能（**只作用于能量，不作用于闪能**） |
| 能量自动回复提升 X 点/秒 | `energyRegenBonusFlat` | 固定值，直接加（**只作用于能量，不作用于闪能**） |
| 能量获得效率提升 X% | `energyGainEfficiency` | 独立乘区，最后乘 |
| 闪能自动回复提升 X% | `flashEnergyRegenBonusPct` | 命破角色，作用闪能基础回能（与能量 pct 互斥，能量 buff 不加闪能） |
| 闪能获得效率提升 X% | `flashEnergyGainEfficiency` | 命破角色，作用闪能，同能量 |
| 闪能自动回复基础值 | `flashEnergyRegen` | 命破角色，点/秒（如伊德海莉 2/s），不受能量回复加成影响 |
| 喧响值获取效率提升 X% | `decibelGainEfficiency` | 喧响获得效率 |
| 能量上限提升 X 点 | `energyMax` | 默认 120 |

**最终回能公式**：`(基础回能 × (1 + 百分比加成/100) + 固定加成) × (1 + 获得效率/100)`

---

## 10. 贯穿区（命破角色专用）

| 游戏文本 | 字段 | 说明 |
|---------|------|------|
| 贯穿力提升 X 点 | `sheerForceFlat` | 固定贯穿力，加到 `atk×0.3 + hp×0.1 + sheerForceFlat` |
| 贯穿伤害提升 X% | `penDmgBonus` | 贯穿增伤独立乘区 |
| 贯穿伤害提升 X%（另一来源） | `sheerDmgBonus` | 与 `penDmgBonus` 加算 |

**公式**：`贯穿力 = 局内攻击力 × 0.3 + 局内生命值 × 0.1 + sheerForceFlat`

---

## 11. 其他

| 游戏文本 | 字段 | 说明 |
|---------|------|------|
| 技能等级+2 | `skillLevelBonus` | 3命/5命通用，引擎自动算伤害/失衡系数 |
| 能量上限提升 X 点 | `energyMax` | 默认 120 |
| 喧响值上限提升 X 点 | 走 `decibelOverflow` 配置 | 在 EnemyConfig 中配置 |
| 物理异常[畏缩] | 覆盖率折入 `enemyStunTakenBonus` | 畏缩使敌人受到失衡值+7.5%，按覆盖率折算 |

---

## 12. 卢西娅·艾洛温（1451）专用词表

| 游戏文本 | 计算器字段/实现 | 说明 |
|---------|------|------|
| [随想]（A5/闪反/快支/特殊技） | `1451005` 等随想行 | 招式升级为[合唱]的伤害不拆分，A5 统一按随想 `1451005`（用户口径） |
| [合唱]（强特/追加攻击/连携/终结技/支援突击） | `patchExecutions` 按 moveId 集合修正 | 追加攻击 `1451007` + `cfg.{exSpecial,ultimate,chain,assistFollowUp}MoveId` |
| [合唱]最后一段按最大生命值 X% 附加伤害 | `SkillExecution.flatDamageBonus` | 乘区前固定伤害 = `局内生命 × (34% + 3%×终结技等级)/100`（爬取公式 `0.34+AvatarSkillLevel(1)*0.03`，12级=70%），全部[合唱]行整行近似 |
| [梦境值] | spec `lucia_dream_value` + `computeLuciaDreamPlan` | 目标 500：初始60 + A5×3(40) + E×2(60) + Q×2(100)；消耗 25/次 → 追加攻击 |
| [追加攻击]（合唱） | event `lucia_additional_attack` + `1451007` | 默认20次（180s/9s），1100%倍率/200%异常积蓄/0失衡，不占前台时间 |
| [以太帷幕·涌泉]（开启/延长） | `computeLuciaCurtainTriggers` + `luciaC4DecibelPerTrigger` | 4命：开启/延长事件 → 全队每人+100喧响；15s CD 封顶 × `lucia.c4CurtainCoverage` 滑块；含伊德海莉大招开帷幕 |
| [巡梦童谣]（全队伤+20%） | teammate-buffs `lucia_elowen.core_dream_song` | F级 20%，coverage 可调 |
| [巡梦童谣]抗性无视/喧响获取 | teammate-buffs `lucia_elowen.cinema_1_dream_song_res_ignore` | 一命：18%全抗无视（`enemyResReduction`）+ 5%喧响获取（`decibelGainEfficiency`，全队3人） |
| [破暗]（贯穿力） | teammate-buffs `lucia_elowen.ex_special_darkbreaker_sheer_force` | 公式 `clamp(12 + floor(hp/200)×(5+s×0.2), 12, 612+s×24)`，s=12+skillLevelBonus，局外生命 |
| [破暗]暴伤+30%（额外能力） | teammate-buffs `lucia_elowen.additional_long_night_crit_dmg` | 队伍有命破/击破时 |
| 影画2 全队贯穿伤害+15% | teammate-buffs `lucia_elowen.cinema_2_darkbreaker_sheer_dmg` | 破暗全覆盖近似全队 |
| 影画2 自身[合唱]伤害+15% | `SkillExecution.dmgBonus`（patchExecutions） | 全部[合唱]行增伤区 +15% |
| 影画6 初始生命 2% → 攻击 | spec `lucia_c6_hp_to_atk`（`attributeConversions`） | 局内小攻击，按局内面板近似 |
| 影画6 [合唱]必暴/暴伤+30% | `SkillExecution.critRateBonus/critDmgBonus`（patchExecutions） | 全部[合唱]行必暴 + 暴伤+30% |
| [星光汇聚之地]回血 | `computeLuciaHealPctPerUlt` → `yidhariExternalHealPerUltPct` | 每大 = 8s × (1%+0.05%×终结技等级)/s（12级 12.8%）；换算成伊德海莉生命%接入烧血→喧响（伊德海莉在队时） |