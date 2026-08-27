import { DAMAGE_ELEMENTS, ELEMENT_LABEL, ENEMY_DEBUFF_KIND_CONFIG, LEGACY_ENEMY_DEBUFF_STAT_IDS, enemyDebuffStatId, type EnemyDebuffKind } from '@/utils/enemyDebuffStats'

export type FormulaZone =
  | '基础属性'
  | '暴击区'
  | '增伤区'
  | '防御/穿透区'
  | '贯穿力区'
  | '贯穿增伤区'
  | '锐化增伤区'
  | '抗性/易伤区'
  | '失衡区'
  | '异常积蓄区'
  | '异常伤害区'
  | '能量/喧响区'
  | '其他'

export interface StatMeta {
  value: string
  label: string
  zone: FormulaZone
  mode: 'flat' | 'pct'
  description: string
}

export const STAT_META: StatMeta[] = [
  { value: 'outOfCombatHpFlat', label: '局外生命小词条', zone: '基础属性', mode: 'flat', description: '局外固定生命：加到 基础生命×(1+Σ局外生命%) 之后；驱动盘固定生命等使用' },
  { value: 'outOfCombatHpPct', label: '局外生命大词条', zone: '基础属性', mode: 'pct', description: '局外百分比生命：以基础生命为基数；驱动盘主副词条、无条件2件套等使用' },
  { value: 'outOfCombatAtkFlat', label: '局外攻击小词条', zone: '基础属性', mode: 'flat', description: '局外固定攻击：加到 基础攻击×(1+Σ局外攻击%) 之后；驱动盘固定攻击等使用' },
  { value: 'outOfCombatAtkPct', label: '局外攻击大词条', zone: '基础属性', mode: 'pct', description: '局外百分比攻击：以基础攻击为基数；音擎高级词条、驱动盘主副词条、无条件2件套等使用' },
  { value: 'outOfCombatDefFlat', label: '局外防御小词条', zone: '基础属性', mode: 'flat', description: '局外固定防御：加到 基础防御×(1+Σ局外防御%) 之后；驱动盘固定防御等使用' },
  { value: 'outOfCombatDefPct', label: '局外防御大词条', zone: '基础属性', mode: 'pct', description: '局外百分比防御：以基础防御为基数；驱动盘主副词条、无条件2件套等使用' },
  { value: 'inCombatHpFlat', label: '局内生命小词条', zone: '基础属性', mode: 'flat', description: '局内固定生命：最终局内生命末尾追加，不被局内百分比放大' },
  { value: 'inCombatHpPct', label: '局内生命大词条', zone: '基础属性', mode: 'pct', description: '局内百分比生命：以局外总生命为基数；音擎被动、4件套、队友/角色战斗BUFF等使用' },
  { value: 'inCombatAtkFlat', label: '局内攻击小词条', zone: '基础属性', mode: 'flat', description: '局内固定攻击：最终局内攻击末尾追加，不被局内百分比放大' },
  { value: 'inCombatAtkPct', label: '局内攻击大词条', zone: '基础属性', mode: 'pct', description: '局内百分比攻击：以局外总攻击为基数；音擎被动、全队攻击力提升、4件套、队友/角色战斗BUFF等使用' },
  { value: 'inCombatDefFlat', label: '局内防御小词条', zone: '基础属性', mode: 'flat', description: '局内固定防御：最终局内防御末尾追加，不被局内百分比放大' },
  { value: 'inCombatDefPct', label: '局内防御大词条', zone: '基础属性', mode: 'pct', description: '局内百分比防御：以局外总防御为基数；音擎被动、4件套、队友/角色战斗BUFF等使用' },
  { value: 'outOfCombatImpactFlat', label: '局外冲击力小词条', zone: '失衡区', mode: 'flat', description: '局外固定冲击力：加到 基础冲击力×(1+Σ局外冲击力%) 之后' },
  { value: 'outOfCombatImpactPct', label: '局外冲击力大词条', zone: '失衡区', mode: 'pct', description: '局外百分比冲击力：以基础冲击力为基数；音擎高级词条、驱动盘6号位等使用' },
  { value: 'inCombatImpactFlat', label: '局内冲击力小词条', zone: '失衡区', mode: 'flat', description: '局内固定冲击力：最终局内冲击力末尾追加，不被局内百分比放大' },
  { value: 'inCombatImpactPct', label: '局内冲击力大词条', zone: '失衡区', mode: 'pct', description: '局内百分比冲击力：以局外总冲击力为基数；音擎被动、角色/队友战斗BUFF等使用' },
  { value: 'hpFlat', label: '生命小词条（阶段继承）', zone: '基础属性', mode: 'flat', description: '兼容旧字段：实际局外/局内由来源 scope 决定；显示时会按来源标注阶段' },
  { value: 'hpPct', label: '生命大词条（阶段继承）', zone: '基础属性', mode: 'pct', description: '兼容旧字段：实际局外/局内由来源 scope 决定；显示时会按来源标注阶段' },
  { value: 'atkFlat', label: '攻击小词条（阶段继承）', zone: '基础属性', mode: 'flat', description: '兼容旧字段：实际局外/局内由来源 scope 决定；显示时会按来源标注阶段' },
  { value: 'atkPct', label: '攻击大词条（阶段继承）', zone: '基础属性', mode: 'pct', description: '兼容旧字段：实际局外/局内由来源 scope 决定；显示时会按来源标注阶段' },
  { value: 'defFlat', label: '防御小词条（阶段继承）', zone: '基础属性', mode: 'flat', description: '兼容旧字段：实际局外/局内由来源 scope 决定；显示时会按来源标注阶段' },
  { value: 'defPct', label: '防御大词条（阶段继承）', zone: '基础属性', mode: 'pct', description: '兼容旧字段：实际局外/局内由来源 scope 决定；显示时会按来源标注阶段' },
  { value: 'impactFlat', label: '冲击力小词条（阶段继承）', zone: '失衡区', mode: 'flat', description: '兼容字段：实际局外/局内由来源 scope 决定；按冲击力的局外/局内公式结算' },
  { value: 'impactPct', label: '冲击力大词条（阶段继承）', zone: '失衡区', mode: 'pct', description: '兼容字段：实际局外/局内由来源 scope 决定；按冲击力的局外/局内公式结算' },
  { value: 'shieldAppliedBonus', label: '施加护盾值提升（暂不实现）', zone: '其他', mode: 'pct', description: '奔袭獠牙等护盾量字段占位：当前计算器不计算护盾量，字段仅用于显式留档，后续实现护盾公式时需要接入' },
  { value: 'critRate', label: '暴击率', zone: '暴击区', mode: 'pct', description: '期望暴击区使用，暴击率在伤害计算中封顶 100%' },
  { value: 'critDmg', label: '暴击伤害', zone: '暴击区', mode: 'pct', description: '期望暴击区使用：1 + 暴击率 × 暴击伤害' },
  { value: 'sharpCritDmg', label: '锐暴伤害', zone: '暴击区', mode: 'pct', description: '锐化伤害暴击时替代暴击伤害；暴击率超过100%的部分额外进行一次锐爆期望判定' },
  { value: 'dmgBonus', label: '通用伤害加成', zone: '增伤区', mode: 'pct', description: '与对应元素伤害加成、对应招式增伤加算后进入普通增伤区' },
  { value: 'skillDmgBonus', label: '招式类型伤害加成', zone: '增伤区', mode: 'pct', description: '可指定全部/普攻/特殊技/强化特殊技/终结技/连携技/支援技/闪避反击，按当前招式类型进入增伤区' },
  { value: 'physicalDmg', label: '物理伤害加成', zone: '增伤区', mode: 'pct', description: '物理技能对应元素增伤' },
  { value: 'fireDmg', label: '火属性伤害加成', zone: '增伤区', mode: 'pct', description: '火属性技能对应元素增伤' },
  { value: 'iceDmg', label: '冰属性伤害加成', zone: '增伤区', mode: 'pct', description: '冰属性技能对应元素增伤' },
  { value: 'electricDmg', label: '电属性伤害加成', zone: '增伤区', mode: 'pct', description: '电属性技能对应元素增伤' },
  { value: 'etherDmg', label: '以太伤害加成', zone: '增伤区', mode: 'pct', description: '以太属性技能对应元素增伤' },
  { value: 'windDmg', label: '风属性伤害加成', zone: '增伤区', mode: 'pct', description: '风属性技能对应元素增伤' },
  { value: 'lumifluxDmg', label: '辉光伤害加成', zone: '增伤区', mode: 'pct', description: '辉光属性技能对应元素增伤' },
  { value: 'penDmgBonus', label: '贯穿增伤', zone: '贯穿增伤区', mode: 'pct', description: '命破角色额外独立乘区：1 + 贯穿增伤' },
  { value: 'sheerForceFlat', label: '贯穿力提升', zone: '贯穿力区', mode: 'flat', description: '直接加到命破贯穿力：局内攻击力×0.3 + 局内生命值×0.1 + 固定贯穿力提升' },
  { value: 'sheerDmgBonus', label: '贯穿伤害提升', zone: '贯穿增伤区', mode: 'pct', description: '命破角色贯穿伤害提升，与贯穿增伤加算进入独立乘区' },
  { value: 'sharpDmgBonus', label: '锐化增伤', zone: '锐化增伤区', mode: 'pct', description: '锋御角色额外独立乘区：1 + 锐化增伤' },
  { value: 'physicalSheerDmg', label: '物理贯穿增伤', zone: '贯穿增伤区', mode: 'pct', description: '只在物理属性命破/贯穿伤害结算时，与通用贯穿增伤加算进入独立乘区' },
  { value: 'fireSheerDmg', label: '火属性贯穿增伤', zone: '贯穿增伤区', mode: 'pct', description: '只在火属性命破/贯穿伤害结算时，与通用贯穿增伤加算进入独立乘区' },
  { value: 'iceSheerDmg', label: '冰属性贯穿增伤', zone: '贯穿增伤区', mode: 'pct', description: '只在冰属性命破/贯穿伤害结算时，与通用贯穿增伤加算进入独立乘区' },
  { value: 'electricSheerDmg', label: '电属性贯穿增伤', zone: '贯穿增伤区', mode: 'pct', description: '只在电属性命破/贯穿伤害结算时，与通用贯穿增伤加算进入独立乘区' },
  { value: 'etherSheerDmg', label: '以太贯穿增伤', zone: '贯穿增伤区', mode: 'pct', description: '只在以太属性命破/贯穿伤害结算时，与通用贯穿增伤加算进入独立乘区' },
  { value: 'windSheerDmg', label: '风属性贯穿增伤', zone: '贯穿增伤区', mode: 'pct', description: '只在风属性命破/贯穿伤害结算时，与通用贯穿增伤加算进入独立乘区' },
  { value: 'lumifluxSheerDmg', label: '辉光贯穿增伤', zone: '贯穿增伤区', mode: 'pct', description: '只在辉光属性命破/贯穿伤害结算时，与通用贯穿增伤加算进入独立乘区' },
  { value: 'physicalSharpDmg', label: '物理锐化增伤', zone: '锐化增伤区', mode: 'pct', description: '只在物理属性锋御/锐化伤害结算时，与通用锐化增伤加算进入独立乘区' },
  { value: 'fireSharpDmg', label: '火属性锐化增伤', zone: '锐化增伤区', mode: 'pct', description: '只在火属性锋御/锐化伤害结算时，与通用锐化增伤加算进入独立乘区' },
  { value: 'iceSharpDmg', label: '冰属性锐化增伤', zone: '锐化增伤区', mode: 'pct', description: '只在冰属性锋御/锐化伤害结算时，与通用锐化增伤加算进入独立乘区' },
  { value: 'electricSharpDmg', label: '电属性锐化增伤', zone: '锐化增伤区', mode: 'pct', description: '只在电属性锋御/锐化伤害结算时，与通用锐化增伤加算进入独立乘区' },
  { value: 'etherSharpDmg', label: '以太锐化增伤', zone: '锐化增伤区', mode: 'pct', description: '只在以太属性锋御/锐化伤害结算时，与通用锐化增伤加算进入独立乘区' },
  { value: 'windSharpDmg', label: '风属性锐化增伤', zone: '锐化增伤区', mode: 'pct', description: '只在风属性锋御/锐化伤害结算时，与通用锐化增伤加算进入独立乘区' },
  { value: 'lumifluxSharpDmg', label: '辉光锐化增伤', zone: '锐化增伤区', mode: 'pct', description: '只在辉光属性锋御/锐化伤害结算时，与通用锐化增伤加算进入独立乘区' },
  { value: 'penRatio', label: '穿透率', zone: '防御/穿透区', mode: 'pct', description: '防御区：怪物防御 × (1 - 穿透率)' },
  { value: 'penFlat', label: '穿透值', zone: '防御/穿透区', mode: 'flat', description: '防御区：有效防御中固定扣除' },
  { value: 'enemyDefReduction', label: '敌方防御降低/无视防御（非元素限定）', zone: '防御/穿透区', mode: 'pct', description: '非元素限定的减防/无视防御，只按当前角色自己的面板进入该角色公式；不会自动变成全队共享减防' },
  { value: 'enemyDefFlatReduction', label: '敌方固定防御降低', zone: '防御/穿透区', mode: 'flat', description: '当前与穿透值加算，作为固定防御扣除' },
  { value: 'enemyAnomalyDefReduction', label: '异常伤害防御降低/无视防御', zone: '防御/穿透区', mode: 'pct', description: '只在异常伤害、紊乱、乱流、异放等异常结算中进入防御区' },
  { value: 'enemyResReduction', label: '敌方抗性降低/无视抗性（全元素）', zone: '抗性/易伤区', mode: 'pct', description: '旧兼容字段：作为6个常规元素的全元素减抗使用' },
  { value: 'disorderDamageBonus', label: '紊乱增伤', zone: '异常伤害区', mode: 'pct', description: '只作用于紊乱，不作用于普通异常伤害；与 anomalyDmgBonus 分区' },
  { value: 'disorderBaseMultiplierBonus', label: '紊乱基础倍率提升', zone: '异常伤害区', mode: 'pct', description: '加到紊乱基础倍率区，例如把基础倍率450提高到700' },
  { value: 'anomalyDurationBonusSeconds', label: '异常持续时间增加', zone: '异常伤害区', mode: 'flat', description: '只影响DoT覆盖时间和紊乱/乱流剩余时间，不影响异常积蓄' },
  { value: 'enemyDamageTakenBonus', label: '敌方受到伤害提升', zone: '抗性/易伤区', mode: 'pct', description: '易伤区：1 + 敌方受到伤害提升' },
  { value: 'impact', label: '冲击力', zone: '失衡区', mode: 'flat', description: '失衡区：基础失衡 × (冲击力/100)，字段本身按数值显示' },
  { value: 'stunBuildUpBonus', label: '造成失衡值提升', zone: '失衡区', mode: 'pct', description: '失衡区：与冲击力区相乘' },
  { value: 'enemyStunTakenBonus', label: '敌方受到失衡值提升', zone: '失衡区', mode: 'pct', description: '失衡区：敌方受到失衡提升区' },
  { value: 'enemyStunResReduction', label: '敌方失衡抗性降低/无视', zone: '失衡区', mode: 'pct', description: '失衡抗性区：1 - (基础失衡抗性 - 无视/降低抗性) / 100，不设上限' },
  { value: 'stunDmgMultiplierBonus', label: '失衡易伤加成', zone: '失衡区', mode: 'pct', description: '伤害公式失衡乘区；当前由静态是否失衡/后续失衡轴预设决定覆盖，不模拟实时窗口' },
  { value: 'stunDmgMultiplierBonusAlways', label: '常驻失衡易伤加成', zone: '失衡区', mode: 'pct', description: '按静态面板进入失衡易伤相关乘区；不模拟实时持续时间' },
  { value: 'stunDmgMultiplierBonusCapAlways', label: '常驻失衡易伤上限', zone: '失衡区', mode: 'pct', description: '用于限制常驻失衡易伤加成' },
  { value: 'anomalyProficiency', label: '异常精通', zone: '异常伤害区', mode: 'flat', description: '异常伤害：异常精通区 = 异常精通/100；当前计算器用静态面板近似，不做完整虚拟人时间轴加权' },
  { value: 'anomalyMastery', label: '异常掌控', zone: '异常积蓄区', mode: 'flat', description: '按阶段公式结算：局内掌控 = (基础掌控 × (1 + Σ局外掌控%) + Σ局外固定掌控) × (1 + Σ局内掌控%) + Σ局内固定掌控；积蓄公式使用 floor(异常掌控)/100' },
  { value: 'anomalyBuildUpEfficiency', label: '异常积蓄效率', zone: '异常积蓄区', mode: 'pct', description: '通用异常积蓄效率区，与异常掌控区相乘' },
  { value: 'electricAnomalyBuildUpEfficiency', label: '电属性异常积蓄效率', zone: '异常积蓄区', mode: 'pct', description: '只在电属性异常积蓄结算时进入积蓄效率区，与通用异常积蓄效率加算' },
  { value: 'physicalAnomalyBuildUpEfficiency', label: '物理属性异常积蓄效率', zone: '异常积蓄区', mode: 'pct', description: '只在物理属性异常积蓄结算时进入积蓄效率区，与通用异常积蓄效率加算' },
  { value: 'enemyAnomalyResReduction', label: '敌方积蓄抗性降低/无视', zone: '异常积蓄区', mode: 'pct', description: '积蓄抗性区：1 - (基础积蓄抗性 - 无视/降低抗性) / 100，不设上限' },
  { value: 'anomalyDmgBonus', label: '异常伤害提升', zone: '异常伤害区', mode: 'pct', description: '异常伤害公式的通用异常增伤区；当前按静态属性表结算' },
  { value: 'windAnomalyDmgBonus', label: '风化/风属性异常伤害提升', zone: '异常伤害区', mode: 'pct', description: '只作用于风属性异常/风化相关异常伤害，与通用异常增伤加算' },
  { value: 'turbulenceDamageBonus', label: '乱流伤害提升', zone: '异常伤害区', mode: 'pct', description: '只作用于乱流结算区，与通用异常增伤加算后进入乱流伤害' },
  { value: 'anomalyReleaseDmgBonus', label: '异放伤害提升', zone: '异常伤害区', mode: 'pct', description: '异放专用独立增伤区，只在 settlementType=release 时进入公式' },
  { value: 'remielleRefringeCoefficient', label: '蕾米异化度', zone: '异常伤害区', mode: 'pct', description: '蕾米埃尔异化区：1 + 异化度/100；满级核心为异常精通×0.02%，二命额外+20%异化度' },
  { value: 'remielleRefringeCoefficientBonusPct', label: '蕾米异化度提升', zone: '异常伤害区', mode: 'pct', description: '蕾米埃尔异化/折射系数的百分比提升；核心被动3异常+10%与二命+20%会写入该字段' },
  { value: 'remielleLuminizeMultiplierBonus', label: '蕾米被动耀变倍率提升', zone: '异常伤害区', mode: 'pct', description: '蕾米埃尔被动耀变倍率提升：满级核心为异常精通×0.2%，作为独立倍率乘区' },
  { value: 'remielleCinema4LuminizeMultiplierBonus', label: '蕾米4命耀变倍率提升', zone: '异常伤害区', mode: 'pct', description: '蕾米埃尔4命耀变倍率+12%，与被动耀变倍率提升独立相乘' },
  { value: 'anomalyCritRate', label: '异常暴击率', zone: '异常伤害区', mode: 'pct', description: '通用异常伤害暴击区，影响所有可暴击异常' },
  { value: 'anomalyCritDmg', label: '异常暴击伤害', zone: '异常伤害区', mode: 'pct', description: '通用异常伤害暴击区，影响所有可暴击异常' },
  { value: 'assaultCritRate', label: '强击暴击率', zone: '异常伤害区', mode: 'pct', description: '只影响物理强击，以及由强击造成并继承其性质的乱流' },
  { value: 'assaultCritDmg', label: '强击暴击伤害', zone: '异常伤害区', mode: 'pct', description: '只影响物理强击，以及由强击造成并继承其性质的乱流' },
  { value: 'enemyAssaultDefReduction', label: '强击无视/降低防御', zone: '防御/穿透区', mode: 'pct', description: '只影响强击异常伤害的防御区，例如简2命15%无视防御' },
  { value: 'energyRegen', label: '基础能量自动回复', zone: '能量/喧响区', mode: 'flat', description: '点/秒；最终回能公式中的基础项' },
  { value: 'energyRegenBonusPct', label: '能量回复百分比加成', zone: '能量/喧响区', mode: 'pct', description: '最终回能 = (基础 × (1 + 百分比) + 固定) × 获得效率' },
  { value: 'energyRegenBonusFlat', label: '能量回复固定加成', zone: '能量/喧响区', mode: 'flat', description: '点/秒，直接加到基础回能后再乘获得效率' },
  { value: 'energyGainEfficiency', label: '能量获得效率', zone: '能量/喧响区', mode: 'pct', description: '最终回能公式的最后乘区' },
  { value: 'flashEnergyRegen', label: '基础闪能自动回复', zone: '能量/喧响区', mode: 'flat', description: '命破角色使用，逻辑同能量' },
  { value: 'flashEnergyRegenBonusPct', label: '闪能回复百分比加成', zone: '能量/喧响区', mode: 'pct', description: '闪能最终回能公式中的百分比加成' },
  { value: 'flashEnergyRegenBonusFlat', label: '闪能回复固定加成', zone: '能量/喧响区', mode: 'flat', description: '闪能点/秒固定加成' },
  { value: 'flashEnergyGainEfficiency', label: '闪能获得效率', zone: '能量/喧响区', mode: 'pct', description: '闪能最终回能公式的最后乘区' },
  { value: 'decibelGainEfficiency', label: '喧响获得效率', zone: '能量/喧响区', mode: 'pct', description: '作用于开局、招式、奖励与队友伴随等所有喧响获得来源' },
  { value: 'timeSliceDodgeCounterDecibel', label: '时光切片闪反喧响', zone: '能量/喧响区', mode: 'flat', description: '时光切片：闪避反击触发的固定喧响，资源池按闪避反击次数结算' },
  { value: 'timeSliceExSpecialDecibel', label: '时光切片强特喧响', zone: '能量/喧响区', mode: 'flat', description: '时光切片：强化特殊技触发的固定喧响，资源池按强特次数结算' },
  { value: 'timeSliceAssistDecibel', label: '时光切片支援喧响', zone: '能量/喧响区', mode: 'flat', description: '时光切片：支援攻击触发的固定喧响，资源池按快速支援+弹刀次数近似结算' },
  { value: 'timeSliceChainDecibel', label: '时光切片连携喧响', zone: '能量/喧响区', mode: 'flat', description: '时光切片：连携技触发的固定喧响，资源池按连携次数结算' },
  { value: 'timeSliceEnergyPerTrigger', label: '时光切片触发回能', zone: '能量/喧响区', mode: 'flat', description: '时光切片：上述触发为装备者回复的固定能量；资源池汇总会单独展示额外能量和喧响' },
  { value: 'backstageEnergyRegenFlat', label: '后台固定回能', zone: '能量/喧响区', mode: 'flat', description: '点/秒，位于后台/后场/不战场时生效；资源池按后台时间结算，属于固定加成' },
  { value: 'nonOperatingEnergyRegenFlat', label: '非操作固定回能', zone: '能量/喧响区', mode: 'flat', description: '点/秒，装备者为非操作中角色时生效；资源池按非操作/合轴时间结算，属于固定加成' },
  { value: 'demaraEnergyGainEfficiency', label: '德玛拉能量获得效率', zone: '能量/喧响区', mode: 'pct', description: '德玛拉电池II型：闪避反击或支援攻击命中后提升能量获得效率，资源池按(闪反+快支+弹刀)×8秒自动折算覆盖率，最大100%' },
  { value: 'zhenyuanEnergyPerTrigger', label: '真元奇枢受伤/回血回能', zone: '能量/喧响区', mode: 'flat', description: '队伍中任意角色受到伤害或回复生命时，为装备者回复的固定能量；触发次数待资源轴配置' },
  { value: 'healingAmount', label: '回血量', zone: '能量/喧响区', mode: 'flat', description: '招式倍率表中的生命回复量，用于血量作为资源或受伤/回血触发类效果的资源轴统计' },
  { value: 'roaringRideBackstageEnergyRegen', label: '旧字段：灼心摇壶后台回能', zone: '能量/喧响区', mode: 'flat', description: '兼容旧数据；新数据请使用 backstageEnergyRegenFlat' },
]



const ENEMY_DEBUFF_ZONE_BY_KIND: Record<EnemyDebuffKind, FormulaZone> = {
  def: '防御/穿透区',
  res: '抗性/易伤区',
  stunRes: '失衡区',
  anomalyRes: '异常积蓄区',
}

const GENERATED_ENEMY_DEBUFF_META: StatMeta[] = DAMAGE_ELEMENTS.flatMap(element =>
  (Object.keys(ENEMY_DEBUFF_KIND_CONFIG) as EnemyDebuffKind[]).map(kind => {
    const config = ENEMY_DEBUFF_KIND_CONFIG[kind]
    return {
      value: enemyDebuffStatId(kind, element),
      label: `${ELEMENT_LABEL[element]}${config.label}`,
      zone: ENEMY_DEBUFF_ZONE_BY_KIND[kind],
      mode: 'pct' as const,
      description: `只在${ELEMENT_LABEL[element]}结算时生效；${config.description}`,
    }
  }),
)

STAT_META.push(...GENERATED_ENEMY_DEBUFF_META)

const STAT_META_MAP = new Map(STAT_META.map(item => [item.value, item]))

const TARGET_LABEL_MAP: Record<string, string> = {
  basic: '普通攻击',
  special: '特殊技',
  exSpecial: '强化特殊技',
  ultimate: '终结技',
  chain: '连携技',
  assist: '支援技',
  dodgeCounter: '闪避反击',
  dashAttack: '冲刺攻击',
}

function baseStatId(stat: string): string {
  return stat.split('__')[0]
}

function targetSuffixLabel(stat: string): string {
  const target = stat.split('__')[1]
  return target ? `（${TARGET_LABEL_MAP[target] ?? target}限定）` : ''
}

export function isPctStat(stat: string): boolean {
  const base = baseStatId(stat)
  return base.endsWith('Pct') ||
    base.endsWith('Rate') ||
    base.endsWith('Dmg') ||
    base.endsWith('Ratio') ||
    base.endsWith('Efficiency') ||
    base.endsWith('Bonus') ||
    base.endsWith('Reduction') ||
    base.endsWith('Ignore')
}

export function getStatMeta(stat: string): StatMeta {
  const direct = STAT_META_MAP.get(stat)
  if (direct) return direct
  const base = STAT_META_MAP.get(baseStatId(stat))
  if (base) {
    return {
      ...base,
      value: stat,
      label: `${base.label}${targetSuffixLabel(stat)}`,
      description: `${base.description}；该字段仅在指定招式类型下生效。`,
    }
  }
  return {
    value: stat,
    label: stat,
    zone: '其他',
    mode: isPctStat(stat) ? 'pct' : 'flat',
    description: '未在调试元数据中登记的字段',
  }
}


const CORE_STAGE_META: Record<string, { base: '攻击' | '生命' | '防御' | '冲击力'; size: '大词条' | '小词条' }> = {
  atkPct: { base: '攻击', size: '大词条' },
  atkFlat: { base: '攻击', size: '小词条' },
  hpPct: { base: '生命', size: '大词条' },
  hpFlat: { base: '生命', size: '小词条' },
  defPct: { base: '防御', size: '大词条' },
  defFlat: { base: '防御', size: '小词条' },
  impactPct: { base: '冲击力', size: '大词条' },
  impactFlat: { base: '冲击力', size: '小词条' },
}

export function phaseStatLabel(stat: string, scope?: 'outOfCombat' | 'inCombat'): string {
  const explicit = stat.match(/^(outOfCombat|inCombat)(Hp|Atk|Def|Impact)(Pct|Flat)$/)
  if (explicit) {
    const phase = explicit[1] === 'outOfCombat' ? '局外' : '局内'
    const base = ({ Hp: '生命', Atk: '攻击', Def: '防御', Impact: '冲击力' } as Record<string, string>)[explicit[2]]
    const size = explicit[3] === 'Pct' ? '大词条' : '小词条'
    return `${phase}${base}${size}`
  }
  const core = CORE_STAGE_META[stat]
  if (core && scope) return `${scope === 'outOfCombat' ? '局外' : '局内'}${core.base}${core.size}`
  return getStatMeta(stat).label
}

export function getGlobalBuffStatOptions(display?: Record<string, any>) {
  const grouped = new Map<FormulaZone, StatMeta[]>()
  for (const item of STAT_META) {
    if (LEGACY_ENEMY_DEBUFF_STAT_IDS.includes(item.value)) continue
    if (!grouped.has(item.zone)) grouped.set(item.zone, [])
    grouped.get(item.zone)!.push(item)
  }

  return Array.from(grouped.entries()).map(([zone, items]) => ({
    type: 'group' as const,
    label: zone,
    key: zone,
    children: items.map(item => {
      const entry = display?.[item.value]
      const lbl = entry?.label
      let label = item.label
      if (typeof lbl === 'string') label = lbl
      else if (lbl && typeof lbl === 'object') label = lbl.zhCN ?? lbl.en ?? item.label
      return {
        label: `${label} (${item.value})`,
        value: item.value,
      }
    }),
  }))
}
