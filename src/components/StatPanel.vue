<template>
  <div class="stat-panel">
    <n-collapse v-model:expanded-names="expandedNames" :default-expanded-names="defaultExpanded">
      <!-- 基础属性乘区 -->
      <n-collapse-item title="基础属性" name="basic">
        <div class="stat-grid">
          <div class="zone-summary">
            <span class="zone-label">基础攻击</span>
            <span class="zone-value">{{ formatNumber(panel.atk, 0) }}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">生命值</span>
            <span class="stat-value">{{ formatNumber(panel.hp, 0) }}</span>
          </div>
          <div class="stat-row highlight-row">
            <span class="stat-label">攻击力</span>
            <span class="stat-value highlight">{{ formatNumber(panel.atk, 0) }}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">防御力</span>
            <span class="stat-value">{{ formatNumber(panel.def, 0) }}</span>
          </div>
        </div>
      </n-collapse-item>

      <!-- 基础10属性 -->
      <n-collapse-item title="基础10属性" name="base-10">
        <div class="stat-grid">
          <div class="stat-row" v-for="row in baseTenStatRows" :key="row.key">
            <span class="stat-label">{{ row.label }}</span>
            <span class="stat-value" :class="{ highlight: row.highlight }">{{ row.value }}</span>
          </div>
          <div class="formula-note">
            此处显示当前面板的 10 项基础属性。切换局外/局内面板时，这里也会同步变化，可用于检查“按自身属性转模”的来源值。
          </div>
        </div>
      </n-collapse-item>

      <!-- 暴击乘区 -->
      <n-collapse-item title="暴击乘区" name="crit">
        <div class="stat-grid">
          <div class="zone-summary">
            <span class="zone-label">期望暴击乘数</span>
            <span class="zone-value">{{ formatNumber(critMultiplier, 3) }}</span>
          </div>
          <div class="formula-box">
            <div class="formula-title">计算公式（期望）</div>
            <div class="formula-text">
              1 + 暴击率 × 暴击伤害
            </div>
            <div class="formula-text">
              = 1 + {{ formatPercent(panel.critRate) }} × {{ formatPercent(panel.critDmg) }}
            </div>
            <div class="formula-text result">
              = {{ formatNumber(critMultiplier, 3) }}
            </div>
          </div>
          <div class="stat-row">
            <span class="stat-label">暴击率</span>
            <span class="stat-value">{{ formatPercent(panel.critRate) }}</span>
          </div>
          <div class="stat-row">
            <span class="stat-label">暴击伤害</span>
            <span class="stat-value">{{ formatPercent(panel.critDmg) }}</span>
          </div>
        </div>
      </n-collapse-item>

      <!-- 增伤乘区 -->
      <n-collapse-item title="增伤乘区" name="dmg">
        <div class="stat-grid">
          <div class="zone-summary">
            <span class="zone-label">增伤乘数</span>
            <span class="zone-value">{{ formatNumber(dmgMultiplier, 3) }}</span>
          </div>
          <div class="formula-box" v-if="totalDmgBonus > 0">
            <div class="formula-title">计算公式</div>
            <div class="formula-text">
              1 + 通用增伤 + 元素增伤 + 对应招式增伤
            </div>
            <div class="formula-text">
              = 1 + {{ formatPercent(panel.dmgBonus) }} + {{ formatPercent(elementDmg) }} + 对应招式增伤
            </div>
            <div class="formula-text result">
              = {{ formatNumber(dmgMultiplier, 3) }}
            </div>
          </div>
          <div class="stat-section-title">通用增伤</div>
          <div class="stat-row" v-if="panel.dmgBonus !== 0">
            <span class="stat-label">通用伤害加成</span>
            <span class="stat-value">+{{ formatPercent(panel.dmgBonus) }}</span>
          </div>
          <div class="stat-section-title" v-if="skillDmgRows.length > 0">招式类型增伤</div>
          <div class="stat-row" v-for="row in skillDmgRows" :key="row.key">
            <span class="stat-label">{{ row.label }}</span>
            <span class="stat-value">+{{ formatPercent(row.value) }}</span>
          </div>
          <div class="stat-section-title" v-if="elementDmgRows.length > 0">元素增伤</div>
          <div class="stat-row" v-for="row in elementDmgRows" :key="row.key">
            <span class="stat-label">{{ row.label }}</span>
            <span class="stat-value">+{{ formatPercent(row.value) }}</span>
          </div>
          <div class="stat-row empty-hint" v-if="totalDmgBonus === 0">
            <span class="stat-label" style="color: var(--wa-300)">暂无增伤属性</span>
            <span class="stat-value"></span>
          </div>
        </div>
      </n-collapse-item>

      <!-- 失衡乘区 -->
      <n-collapse-item title="失衡乘区" name="stun">
        <div class="stat-grid">
          <div class="zone-summary">
            <span class="zone-label">失衡区乘数</span>
            <span class="zone-value">{{ formatNumber(stunBuildUpMultiplier, 3) }}</span>
          </div>
          <div class="formula-box">
            <div class="formula-title">失衡区公式</div>
            <div class="formula-text">
              冲击力/100 × (1 + 失衡值提升/100) × (1 + 受到失衡值提升/100) × 失衡抗性区
            </div>
            <div class="formula-text">
              = {{ formatNumber(panel.impact / 100, 3) }} × (1 + {{ formatPercent(panel.stunBuildUpBonus) }}) × (1 + {{ formatPercent(panel.enemyStunTakenBonus) }}) × 失衡抗性区
            </div>
            <div class="formula-text result">
              = {{ formatNumber(stunBuildUpMultiplier, 3) }}
            </div>
          </div>
          <div class="stat-section-title">失衡区</div>
          <div class="stat-row highlight-row">
            <span class="stat-label">冲击力</span>
            <span class="stat-value highlight">{{ formatNumber(panel.impact, 0) }}</span>
          </div>
          <div class="stat-row" v-if="panel.stunBuildUpBonus !== 0">
            <span class="stat-label">失衡值提升</span>
            <span class="stat-value">+{{ formatPercent(panel.stunBuildUpBonus) }}</span>
          </div>
          <div class="stat-row" v-if="panel.enemyStunTakenBonus !== 0">
            <span class="stat-label">受到失衡值提升</span>
            <span class="stat-value debuff">+{{ formatPercent(panel.enemyStunTakenBonus) }}</span>
          </div>
          <div class="stat-row" v-if="panel.enemyStunResReduction !== 0">
            <span class="stat-label">失衡抗性降低/无视</span>
            <span class="stat-value debuff">{{ formatPercent(panel.enemyStunResReduction) }}</span>
          </div>
          <div class="stat-section-title">失衡易伤（伤害）</div>
          <div class="stat-row" v-if="panel.stunDmgMultiplierBonus !== 0">
            <span class="stat-label">失衡易伤 (失衡时)</span>
            <span class="stat-value">+{{ formatPercent(panel.stunDmgMultiplierBonus) }}</span>
          </div>
          <div class="stat-row" v-if="panel.stunDmgMultiplierBonusAlways !== 0">
            <span class="stat-label">失衡易伤 (常驻)</span>
            <span class="stat-value">+{{ formatPercent(panel.stunDmgMultiplierBonusAlways) }}</span>
          </div>
          <div class="stat-row" v-if="panel.stunDmgMultiplierBonusCapAlways !== 0">
            <span class="stat-label">常驻失衡易伤上限</span>
            <span class="stat-value">{{ formatPercent(panel.stunDmgMultiplierBonusCapAlways) }}</span>
          </div>
        </div>
      </n-collapse-item>

      <!-- 异常积蓄区 -->
      <n-collapse-item title="异常积蓄区" name="anomaly-build-up">
        <div class="stat-grid">
          <div class="zone-summary">
            <span class="zone-label">异常积蓄乘数</span>
            <span class="zone-value">{{ formatNumber(anomalyBuildUpMultiplier, 3) }}</span>
          </div>
          <div class="formula-box">
            <div class="formula-title">异常积蓄公式</div>
            <div class="formula-text">
              基础积蓄 × (异常掌控/100) × (1 + 积蓄效率/100) × 积蓄抗性区
            </div>
            <div class="formula-text">
              本区决定异常条推进速度，不等同于异常伤害倍率。
            </div>
            <div class="formula-text result">
              当前面板积蓄乘数 = {{ formatNumber(anomalyBuildUpMultiplier, 3) }}（未含 Boss 积蓄抗性）
            </div>
          </div>
          <div class="stat-section-title">积蓄速度相关</div>
          <div class="stat-row highlight-row">
            <span class="stat-label">异常掌控</span>
            <span class="stat-value highlight">{{ formatNumber(panel.anomalyMastery, 0) }}</span>
          </div>
          <div class="stat-row" v-if="panel.anomalyBuildUpEfficiency !== 0">
            <span class="stat-label">异常积蓄效率</span>
            <span class="stat-value">+{{ formatPercent(panel.anomalyBuildUpEfficiency) }}</span>
          </div>
          <div class="stat-row" v-if="currentElementAnomalyBuildUpEfficiency !== 0">
            <span class="stat-label">{{ currentElementLabel }}异常积蓄效率</span>
            <span class="stat-value">+{{ formatPercent(currentElementAnomalyBuildUpEfficiency) }}</span>
          </div>
          <div class="stat-row" v-if="panel.enemyAnomalyResReduction !== 0">
            <span class="stat-label">敌方积蓄抗性降低/无视</span>
            <span class="stat-value debuff">{{ formatPercent(panel.enemyAnomalyResReduction) }}</span>
          </div>
          <div class="formula-note">
            异常积蓄只解决“多久触发一次异常”。游戏机制里攻击力、增伤、穿透、异常精通等会按积蓄贡献构建虚拟人；本计算器暂不模拟完整时间轴，覆盖率只折算为静态数值。
          </div>
        </div>
      </n-collapse-item>

      <!-- 异常伤害区 -->
      <n-collapse-item title="异常伤害区" name="anomaly-damage">
        <div class="stat-grid">
          <div class="formula-box">
            <div class="formula-title">异常伤害公式</div>
            <div class="formula-text">
              通用乘区 × 异常精通区 × 等级区 × 异常伤害区 × 异常暴击区
            </div>
            <div class="formula-text">
              通用乘区 = 攻击 × 倍率 × 增伤 × 防御 × 伤害抗性 × 易伤 × 失衡易伤（静态近似）
            </div>
          </div>
          <div class="stat-section-title">伤害质量相关</div>
          <div class="stat-row highlight-row">
            <span class="stat-label">异常精通</span>
            <span class="stat-value highlight">{{ formatNumber(panel.anomalyProficiency, 0) }}</span>
          </div>
          <div class="stat-row" v-if="panel.anomalyDmgBonus !== 0">
            <span class="stat-label">异常伤害提升</span>
            <span class="stat-value">+{{ formatPercent(panel.anomalyDmgBonus) }}</span>
          </div>
          <div class="stat-row" v-if="panel.anomalyReleaseDmgBonus !== 0">
            <span class="stat-label">异放伤害提升</span>
            <span class="stat-value">+{{ formatPercent(panel.anomalyReleaseDmgBonus) }}</span>
          </div>
          <div class="stat-row" v-if="panel.remielleRefringeCoefficient !== 0">
            <span class="stat-label">蕾米异化度</span>
            <span class="stat-value">{{ formatPercent(panel.remielleRefringeCoefficient) }}</span>
          </div>
          <div class="stat-row" v-if="panel.remielleLuminizeMultiplierBonus !== 0">
            <span class="stat-label">蕾米被动耀变倍率提升</span>
            <span class="stat-value">+{{ formatPercent(panel.remielleLuminizeMultiplierBonus) }}</span>
          </div>
          <div class="stat-row" v-if="panel.remielleCinema4LuminizeMultiplierBonus !== 0">
            <span class="stat-label">蕾米4命耀变倍率提升</span>
            <span class="stat-value">+{{ formatPercent(panel.remielleCinema4LuminizeMultiplierBonus) }}</span>
          </div>
          <div class="stat-row" v-if="panel.anomalyCritRate !== 0">
            <span class="stat-label">异常暴击率</span>
            <span class="stat-value">{{ formatPercent(panel.anomalyCritRate) }}</span>
          </div>
          <div class="stat-row" v-if="panel.anomalyCritDmg !== 0">
            <span class="stat-label">异常暴击伤害</span>
            <span class="stat-value">{{ formatPercent(panel.anomalyCritDmg) }}</span>
          </div>
          <div class="stat-row" v-if="isPhysicalElement && panel.assaultCritRate !== 0">
            <span class="stat-label">强击暴击率</span>
            <span class="stat-value">{{ formatPercent(panel.assaultCritRate) }}</span>
          </div>
          <div class="stat-row" v-if="isPhysicalElement && panel.assaultCritDmg !== 0">
            <span class="stat-label">强击暴击伤害</span>
            <span class="stat-value">{{ formatPercent(panel.assaultCritDmg) }}</span>
          </div>
          <div class="stat-section-title">异常伤害类型</div>
          <div class="anomaly-type-grid">
            <div v-for="item in anomalyDamageTypes" :key="item.name" class="anomaly-type-card">
              <div class="anomaly-type-name">{{ item.name }}</div>
              <div class="anomaly-type-desc">{{ item.desc }}</div>
            </div>
          </div>
          <div class="formula-note">
            异常伤害是结算伤害，不是积蓄速度。当前计算器使用最终静态属性表近似结算；DoT、瞬间出伤、紊乱、异放、极性紊乱、极性强击、乱流、耀变等后续应按各自倍率区和继承规则单独处理。
          </div>
        </div>
      </n-collapse-item>

      <!-- 穿透乘区 -->
      <n-collapse-item title="穿透乘区" name="pen">
        <div class="stat-grid">
          <div class="stat-section-title">防御穿透</div>
          <div class="stat-row">
            <span class="stat-label">穿透率</span>
            <span class="stat-value">{{ formatPercent(panel.penRatio) }}</span>
          </div>
          <div class="stat-row" v-if="panel.penFlat !== 0">
            <span class="stat-label">穿透值</span>
            <span class="stat-value">{{ formatNumber(panel.penFlat, 0) }}</span>
          </div>
          <div class="stat-section-title">命破贯穿</div>
          <div class="zone-summary">
            <span class="zone-label">贯穿力</span>
            <span class="zone-value">{{ formatNumber(penetrationPower, 0) }}</span>
          </div>
          <div class="formula-box">
            <div class="formula-title">贯穿力公式</div>
            <div class="formula-text">攻击力 × 0.3 + 生命值 × 0.1 + 贯穿力提升</div>
            <div class="formula-text">= {{ formatNumber(panel.atk, 0) }} × 0.3 + {{ formatNumber(panel.hp, 0) }} × 0.1 + {{ formatNumber(panel.sheerForceFlat ?? 0, 0) }}</div>
            <div class="formula-text result">= {{ formatNumber(penetrationPower, 2) }}</div>
          </div>
          <div class="stat-row" v-if="panel.sheerForceFlat !== 0">
            <span class="stat-label">贯穿力提升</span>
            <span class="stat-value">+{{ formatNumber(panel.sheerForceFlat, 0) }}</span>
          </div>
          <div class="stat-row" v-if="panel.penDmgBonus !== 0">
            <span class="stat-label">贯穿增伤</span>
            <span class="stat-value">+{{ formatPercent(panel.penDmgBonus) }}</span>
          </div>
          <div class="stat-row" v-if="panel.sheerDmgBonus !== 0">
            <span class="stat-label">贯穿伤害提升</span>
            <span class="stat-value">+{{ formatPercent(panel.sheerDmgBonus) }}</span>
          </div>
          <div class="stat-row" v-for="row in elementSheerDmgRows" :key="row.key">
            <span class="stat-label">{{ row.label }}</span>
            <span class="stat-value">+{{ formatPercent(row.value) }}</span>
          </div>
          <div class="formula-note">
非命破角色使用防御区；命破角色无视防御，防御区固定为 1。贯穿增伤是命破独立额外乘区，不计入普通增伤区。
          </div>
        </div>
      </n-collapse-item>

      <!-- 能量系统 -->
      <n-collapse-item title="能量系统" name="energy">
        <div class="stat-grid">
          <div class="zone-summary">
            <span class="zone-label">自动回能</span>
            <span class="zone-value">{{ formatNumber(energyRegenPerSec, 2) }}/秒</span>
          </div>
          <div class="formula-box" v-if="hasEnergyBonus">
            <div class="formula-title">自动回能公式</div>
            <div class="formula-text">
              (基础 × (1 + 百分比加成) + 固定加成) × (1 + 获得效率)
            </div>
            <div class="formula-text">
              = ({{ formatNumber(panel.energyRegen, 2) }} × {{ formatNumber(1 + panel.energyRegenBonusPct/100, 2) }} + {{ formatNumber(panel.energyRegenBonusFlat, 2) }}) × {{ formatNumber(1 + panel.energyGainEfficiency/100, 2) }}
            </div>
            <div class="formula-text result">
              = {{ formatNumber(energyRegenPerSec, 3) }} /秒
            </div>
          </div>
          <div class="stat-section-title">能量</div>
          <div class="stat-row">
            <span class="stat-label">能量上限</span>
            <span class="stat-value">{{ formatNumber(panel.energyMax, 0) }} 点</span>
          </div>
          <div class="stat-row highlight-row">
            <span class="stat-label">基础自动回复</span>
            <span class="stat-value highlight">{{ formatNumber(panel.energyRegen, 2) }}/秒</span>
          </div>
          <div class="stat-row" v-if="panel.energyRegenBonusPct !== 0">
            <span class="stat-label">回复百分比加成</span>
            <span class="stat-value">+{{ formatPercent(panel.energyRegenBonusPct) }}</span>
          </div>
          <div class="stat-row" v-if="panel.energyRegenBonusFlat !== 0">
            <span class="stat-label">回复固定加成</span>
            <span class="stat-value">+{{ formatNumber(panel.energyRegenBonusFlat, 2) }}/秒</span>
          </div>
          <div class="stat-row" v-if="panel.energyGainEfficiency !== 0">
            <span class="stat-label">能量获得效率（全局）</span>
            <span class="stat-value">+{{ formatPercent(panel.energyGainEfficiency) }}</span>
          </div>
          <div class="stat-section-title" v-if="panel.flashEnergyMax > 0">闪能（命破）</div>
          <div class="stat-row" v-if="panel.flashEnergyMax > 0">
            <span class="stat-label">闪能上限</span>
            <span class="stat-value">{{ formatNumber(panel.flashEnergyMax, 0) }} 点</span>
          </div>
          <div class="stat-row" v-if="panel.flashEnergyRegen > 0">
            <span class="stat-label">基础自动回复</span>
            <span class="stat-value">{{ formatNumber(panel.flashEnergyRegen, 2) }}/秒</span>
          </div>
          <div class="stat-row" v-if="panel.flashEnergyRegenBonusPct !== 0">
            <span class="stat-label">回复百分比加成</span>
            <span class="stat-value">+{{ formatPercent(panel.flashEnergyRegenBonusPct) }}</span>
          </div>
          <div class="stat-row" v-if="panel.flashEnergyRegenBonusFlat !== 0">
            <span class="stat-label">回复固定加成</span>
            <span class="stat-value">+{{ formatNumber(panel.flashEnergyRegenBonusFlat, 2) }}/秒</span>
          </div>
          <div class="stat-row" v-if="panel.flashEnergyGainEfficiency !== 0">
            <span class="stat-label">闪能获得效率（全局）</span>
            <span class="stat-value">+{{ formatPercent(panel.flashEnergyGainEfficiency) }}</span>
          </div>
          <div class="stat-section-title">喧响值</div>
          <div class="stat-row">
            <span class="stat-label">喧响值上限</span>
            <span class="stat-value">3000</span>
          </div>
          <div class="stat-row" v-if="panel.decibelGainEfficiency !== 0">
            <span class="stat-label">喧响获得效率</span>
            <span class="stat-value">+{{ formatPercent(panel.decibelGainEfficiency) }}</span>
          </div>
          <div class="formula-note">
            能量获得效率为全局乘区，作用于所有能量获取方式（自动回能、攻击回能、能量球等）。
          </div>
        </div>
      </n-collapse-item>

      <!-- 敌方减益 -->
      <n-collapse-item title="敌方减益" name="enemy">
        <div class="stat-grid">
          <div class="stat-section-title">防御相关</div>
          <div class="stat-row" v-if="panel.enemyDefReduction !== 0">
            <span class="stat-label">敌方防御降低（通用）</span>
            <span class="stat-value debuff">{{ formatPercent(panel.enemyDefReduction) }}</span>
          </div>
          <div class="stat-row" v-if="hasElementDefReduction">
            <span class="stat-label">元素专属减防</span>
            <span class="stat-value debuff">{{ elementDefReductionSummary }}</span>
          </div>
          <div class="stat-row" v-if="panel.enemyDefFlatReduction !== 0">
            <span class="stat-label">敌方防御固定降低</span>
            <span class="stat-value debuff">{{ formatNumber(panel.enemyDefFlatReduction, 0) }}</span>
          </div>
          <div class="stat-section-title">抗性相关</div>
          <div class="stat-row" v-if="panel.enemyResReduction !== 0">
            <span class="stat-label">敌方伤害抗性降低/无视（全元素）</span>
            <span class="stat-value debuff">{{ formatPercent(panel.enemyResReduction) }}</span>
          </div>
          <div class="stat-row" v-if="panel.enemyLumifluxResReduction !== 0 && (!compactPreview || damageElement === 'lumiflux')">
            <span class="stat-label">辉光/耀变抗性降低/无视</span>
            <span class="stat-value debuff">{{ formatPercent(panel.enemyLumifluxResReduction) }}</span>
          </div>
          <div class="stat-row" v-if="hasElementResReduction">
            <span class="stat-label">元素专属减抗</span>
            <span class="stat-value debuff">{{ elementResReductionSummary }}</span>
          </div>
          <div class="stat-section-title">失衡相关</div>
          <div class="stat-row" v-if="panel.enemyStunResReduction !== 0">
            <span class="stat-label">敌方失衡抗性降低/无视</span>
            <span class="stat-value debuff">{{ formatPercent(panel.enemyStunResReduction) }}</span>
          </div>
          <div class="stat-row" v-if="panel.enemyStunTakenBonus !== 0">
            <span class="stat-label">敌方受到失衡值提升</span>
            <span class="stat-value debuff">+{{ formatPercent(panel.enemyStunTakenBonus) }}</span>
          </div>
          <div class="stat-section-title">异常相关</div>
          <div class="stat-row" v-if="panel.enemyAnomalyResReduction !== 0">
            <span class="stat-label">敌方积蓄抗性降低/无视</span>
            <span class="stat-value debuff">{{ formatPercent(panel.enemyAnomalyResReduction) }}</span>
          </div>
          <div class="stat-section-title">伤害相关</div>
          <div class="stat-row" v-if="panel.enemyDamageTakenBonus !== 0">
            <span class="stat-label">敌方受到伤害提升（易伤）</span>
            <span class="stat-value debuff">+{{ formatPercent(panel.enemyDamageTakenBonus) }}</span>
          </div>
          <div class="stat-row empty-hint" v-if="!hasAnyEnemyDebuff">
            <span class="stat-label" style="color: var(--wa-300)">暂无敌方减益</span>
            <span class="stat-value"></span>
          </div>
        </div>
      </n-collapse-item>

      <!-- 全部属性字段 -->
      <n-collapse-item v-if="!compactPreview" title="全部属性字段" name="all-fields">
        <div class="stat-grid all-fields-grid">
          <div class="stat-row" v-for="row in allPanelRows" :key="row.key">
            <span class="stat-label">{{ row.label }}</span>
            <span class="stat-value">{{ row.value }}</span>
          </div>
        </div>
      </n-collapse-item>

      <!-- 伤害公式总览 -->
      <n-collapse-item title="伤害公式总览" name="formula">
        <div class="stat-grid">
          <div class="formula-overview">
            <div class="formula-section">
              <div class="formula-section-title">直伤公式</div>
              <div class="formula-line">伤害 = 攻击力/贯穿力区 × 技能倍率区 × 增伤区</div>
              <div class="formula-line">　 × 防御区 × 抗性区 × 易伤区 × 失衡易伤 × 暴击区</div>
              <div class="formula-sub">普通：攻击力区 = 攻击力；命破：贯穿力 = 攻击力×0.3 + 生命值×0.1</div>
              <div class="formula-sub">锋御：防御力区 = 防御力；锋御伤害使用锐暴伤害替代暴击伤害</div>
              <div class="formula-sub">增伤区 = 1 + (通用增伤 + 对应元素增伤 + 对应招式增伤) / 100</div>
              <div class="formula-sub">命破防御区 = 1；贯穿增伤为独立额外乘区</div>
              <div class="formula-sub">暴击区 = 1 + 暴击率 × 暴击伤害 / 10000（期望）；锐暴区 = 1 + 暴击率 × 锐暴伤害 / 10000 + 溢出暴击率 × 锐暴伤害 / 10000</div>
            </div>
            <div class="formula-section">
              <div class="formula-section-title">失衡区公式</div>
              <div class="formula-line">失衡区 = 基础失衡 × 冲击力 × 失衡值提升</div>
              <div class="formula-line">　 × 受到失衡提升 × 失衡抗性</div>
            </div>
            <div class="formula-section">
              <div class="formula-section-title">异常积蓄公式</div>
              <div class="formula-line">积蓄 = 基础积蓄 × (异常掌控/100)</div>
              <div class="formula-line">　 × (1 + 积蓄效率/100) × (1 - 积蓄抗性)</div>
            </div>
            <div class="formula-section">
              <div class="formula-section-title">异常伤害公式</div>
              <div class="formula-line">异常伤害 = 通用乘区 × 异常精通区 × 等级区</div>
              <div class="formula-line">　 × 异常增伤区 × 异常暴击区</div>
              <div class="formula-sub">通用乘区 = 攻击 × 倍率 × 增伤 × 防御 × 抗性 × 易伤 × 失衡易伤（当前用静态属性表近似）</div>
              <div class="formula-sub">异常精通区 = 异常精通 / 100（无上限）；虚拟人加权暂不做逐时间轴模拟</div>
              <div class="formula-sub">等级区 = 1 + 1/59 × (等级 - 1)，60级为2.0</div>
            </div>
          </div>
          <div class="formula-source">
            公式来源：波波獭「绝区零底层机制」系列 + NGA 绝区零板块
          </div>
        </div>
      </n-collapse-item>
    </n-collapse>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { NCollapse, NCollapseItem } from 'naive-ui'
import type { DamageElement, PanelValues } from '@/types/catalog'
import { getStatMeta, isPctStat } from '@/utils/statMeta'

const props = defineProps<{
  panel: PanelValues
  /** 当前角色属性，用于只展示对应元素的专属字段 */
  damageElement?: DamageElement
  /** 默认展开的分组 */
  defaultExpanded?: string[]
  /** 队伍配置页使用的紧凑预览：隐藏排查字段，只显示当前角色相关项 */
  compactPreview?: boolean
}>()

const expandedNames = ref<string[]>(props.defaultExpanded ?? ['basic', 'crit'])
const compactPreview = computed(() => props.compactPreview ?? false)
const isPhysicalElement = computed(() => props.damageElement === 'physical')

const baseTenStatRows = computed(() => {
  const p = props.panel
  return [
    { key: 'hp', label: '生命值', value: formatNumber(p.hp, 0) },
    { key: 'atk', label: '攻击力', value: formatNumber(p.atk, 0), highlight: true },
    { key: 'def', label: '防御力', value: formatNumber(p.def, 0) },
    { key: 'impact', label: '冲击力', value: formatNumber(p.impact, 0) },
    { key: 'critRate', label: '暴击率', value: formatPercent(p.critRate) },
    { key: 'critDmg', label: '暴击伤害', value: formatPercent(p.critDmg) },
    { key: 'anomalyProficiency', label: '异常精通', value: formatNumber(p.anomalyProficiency, 0) },
    { key: 'anomalyMastery', label: '异常掌控', value: formatNumber(p.anomalyMastery, 0) },
    { key: 'penRatio', label: '穿透率', value: formatPercent(p.penRatio) },
    { key: 'energyRegen', label: '自动回能', value: `${formatNumber(energyRegenPerSec.value, 2)}/秒` },
  ]
})

// ========== 暴击乘区 ==========
const critMultiplier = computed(() => {
  const p = props.panel
  const rate = Math.min(100, Math.max(0, p.critRate)) / 100
  const dmg = p.critDmg / 100
  return 1 + rate * dmg
})

// ========== 增伤乘区 ==========
const SKILL_DMG_LABELS: Record<string, string> = {
  skillDmgBonus: '全部招式伤害加成',
  skillDmgBonus__basic: '普通攻击伤害加成',
  skillDmgBonus__special: '特殊技伤害加成',
  skillDmgBonus__exSpecial: '强化特殊技伤害加成',
  skillDmgBonus__ultimate: '终结技伤害加成',
  skillDmgBonus__chain: '连携技伤害加成',
  skillDmgBonus__assist: '支援技伤害加成',
  skillDmgBonus__dodgeCounter: '闪避反击伤害加成',
}

const skillDmgRows = computed(() => {
  return Object.entries(SKILL_DMG_LABELS)
    .map(([key, label]) => ({ key, label, value: props.panel[key] ?? 0 }))
    .filter(row => row.value !== 0)
})

const totalSkillDmgBonusForPanel = computed(() => skillDmgRows.value.reduce((sum, row) => sum + row.value, 0))

const totalDmgBonus = computed(() => {
  const p = props.panel
  return p.dmgBonus + elementDmg.value + totalSkillDmgBonusForPanel.value
})

const penetrationPower = computed(() => props.panel.atk * 0.3 + props.panel.hp * 0.1 + (props.panel.sheerForceFlat ?? 0))

const ELEMENT_FIELD_PREFIX_BY_ELEMENT: Record<string, string> = {
  physical: 'Physical',
  fire: 'Fire',
  ice: 'Ice',
  electric: 'Electric',
  ether: 'Ether',
  wind: 'Wind',
  lumiflux: 'Lumiflux',
}

const ELEMENT_DMG_KEY_BY_ELEMENT: Record<string, string> = {
  physical: 'physicalDmg',
  fire: 'fireDmg',
  ice: 'iceDmg',
  electric: 'electricDmg',
  ether: 'etherDmg',
  wind: 'windDmg',
  lumiflux: 'lumifluxDmg',
}

const ELEMENT_NAME_BY_ELEMENT: Record<string, string> = {
  physical: '物理',
  fire: '火属性',
  ice: '冰属性',
  electric: '电属性',
  ether: '以太',
  wind: '风属性',
  lumiflux: '辉光',
}

const ELEMENT_DMG_LABELS: Record<string, string> = {
  physicalDmg: '物理伤害加成',
  fireDmg: '火属性伤害加成',
  iceDmg: '冰属性伤害加成',
  electricDmg: '电属性伤害加成',
  etherDmg: '以太属性伤害加成',
  windDmg: '风属性伤害加成',
  lumifluxDmg: '辉光属性伤害加成',
}

const ELEMENT_SHEER_DMG_KEY_BY_ELEMENT: Record<string, string> = {
  physical: 'physicalSheerDmg',
  fire: 'fireSheerDmg',
  ice: 'iceSheerDmg',
  electric: 'electricSheerDmg',
  ether: 'etherSheerDmg',
  wind: 'windSheerDmg',
  lumiflux: 'lumifluxSheerDmg',
}

const ELEMENT_SHEER_DMG_LABELS: Record<string, string> = {
  physicalSheerDmg: '物理贯穿增伤',
  fireSheerDmg: '火属性贯穿增伤',
  iceSheerDmg: '冰属性贯穿增伤',
  electricSheerDmg: '电属性贯穿增伤',
  etherSheerDmg: '以太贯穿增伤',
  windSheerDmg: '风属性贯穿增伤',
  lumifluxSheerDmg: '辉光贯穿增伤',
}

const elementDmg = computed(() => {
  const key = props.damageElement ? ELEMENT_DMG_KEY_BY_ELEMENT[props.damageElement] : undefined
  if (key) return props.panel[key] ?? 0
  const p = props.panel
  return Math.max(p.physicalDmg, p.fireDmg, p.iceDmg,
    p.electricDmg, p.etherDmg, p.windDmg, p.lumifluxDmg)
})

const elementDmgRows = computed(() => {
  const p = props.panel
  const currentKey = props.damageElement ? ELEMENT_DMG_KEY_BY_ELEMENT[props.damageElement] : undefined
  return Object.entries(ELEMENT_DMG_LABELS)
    .filter(([key]) => !compactPreview.value || !currentKey || key === currentKey)
    .map(([key, label]) => ({ key, label, value: p[key] ?? 0 }))
    .filter(row => row.value !== 0)
})

const dmgMultiplier = computed(() => {
  return 1 + totalDmgBonus.value / 100
})

const elementSheerDmgRows = computed(() => {
  const p = props.panel
  const currentKey = props.damageElement ? ELEMENT_SHEER_DMG_KEY_BY_ELEMENT[props.damageElement] : undefined
  return Object.entries(ELEMENT_SHEER_DMG_LABELS)
    .filter(([key]) => !currentKey || key === currentKey)
    .map(([key, label]) => ({ key, label, value: p[key] ?? 0 }))
    .filter(row => row.value !== 0)
})

// ========== 失衡乘区 ==========
const stunBuildUpMultiplier = computed(() => {
  const p = props.panel
  const impactMult = p.impact / 100
  const bonusMult = 1 + p.stunBuildUpBonus / 100
  return impactMult * bonusMult
})

// ========== 异常乘区 ==========
const currentElementAnomalyBuildUpEfficiency = computed(() => props.damageElement === 'electric' ? props.panel.electricAnomalyBuildUpEfficiency ?? 0 : 0)
const currentElementLabel = computed(() => props.damageElement ? ELEMENT_NAME_BY_ELEMENT[props.damageElement] ?? '' : '')

const anomalyBuildUpMultiplier = computed(() => {
  const p = props.panel
  const mastery = Math.floor(p.anomalyMastery) / 100
  const efficiency = 1 + ((p.anomalyBuildUpEfficiency ?? 0) + currentElementAnomalyBuildUpEfficiency.value) / 100
  return mastery * efficiency
})

const anomalyDamageTypes = [
  { name: '瞬间出伤', desc: '强击、碎冰等一次性异常伤害，触发时立即结算。' },
  { name: 'DoT', desc: '灼烧、感电、侵蚀等持续或被攻击触发的异常伤害。' },
  { name: '紊乱', desc: '不同属性异常覆盖时触发，倍率区不同，结算区继承原异常状态。' },
  { name: '异放', desc: '异常状态相关的额外爆发伤害，需按具体角色机制独立建模。' },
  { name: '极性紊乱', desc: '月城柳机制，替换/复制基础伤害区，其他乘区继承原异常。' },
  { name: '极性强击', desc: '物理强击的特殊派生，需独立确认倍率和继承规则。' },
  { name: '乱流', desc: '风属性相关派生结算，当前代码已有初步模型但需继续校准。' },
  { name: '耀变', desc: '辉光/流明相关派生异常伤害，需按角色机制补充。' },
]

// ========== 能量系统 ==========
const hasEnergyBonus = computed(() => {
  const p = props.panel
  return p.energyRegenBonusPct !== 0 || p.energyRegenBonusFlat !== 0 || p.energyGainEfficiency !== 0
})

const energyRegenPerSec = computed(() => {
  const p = props.panel
  const base = p.energyRegen
  const pctBonus = 1 + (p.energyRegenBonusPct ?? 0) / 100
  const flatBonus = p.energyRegenBonusFlat ?? 0
  const efficiency = 1 + (p.energyGainEfficiency ?? 0) / 100
  return (base * pctBonus + flatBonus) * efficiency
})

const energyFullTime = computed(() => {
  const p = props.panel
  if (energyRegenPerSec.value <= 0) return Infinity
  return p.energyMax / energyRegenPerSec.value
})

const flashEnergyRegenPerSec = computed(() => {
  const p = props.panel
  if (!p.flashEnergyRegen) return 0
  const base = p.flashEnergyRegen
  const pctBonus = 1 + (p.flashEnergyRegenBonusPct ?? 0) / 100
  const flatBonus = p.flashEnergyRegenBonusFlat ?? 0
  const efficiency = 1 + (p.flashEnergyGainEfficiency ?? 0) / 100
  return (base * pctBonus + flatBonus) * efficiency
})

function isOtherElementSpecificField(key: string): boolean {
  const sheerMatch = key.match(/^(physical|fire|ice|electric|ether|wind|lumiflux)SheerDmg(?:__\w+)?$/)
  if (sheerMatch) return !props.damageElement || sheerMatch[1] !== props.damageElement

  const match = key.match(/^enemy(Physical|Fire|Ice|Electric|Ether|Wind|Lumiflux)(DefReduction|ResReduction|StunResReduction|AnomalyResReduction)(?:__\w+)?$/)
  if (!match) {
    if ((key === 'assaultCritRate' || key === 'assaultCritDmg') && !isPhysicalElement.value) return true
    if (key.endsWith('AnomalyBuildUpEfficiency') && key !== `${props.damageElement}AnomalyBuildUpEfficiency`) return true
    return RESOURCE_EVENT_PANEL_FIELDS.has(key)
  }
  const currentPrefix = currentElementPrefix.value
  return !currentPrefix || match[1] !== currentPrefix
}

const RESOURCE_EVENT_PANEL_FIELDS = new Set([
  'timeSliceDodgeCounterDecibel',
  'timeSliceExSpecialDecibel',
  'timeSliceAssistDecibel',
  'timeSliceChainDecibel',
  'timeSliceEnergyPerTrigger',
  'zhenyuanEnergyPerTrigger',
  'remielleFlowerFeatherDanceDecibelPerUse',
  'remielleFlowerFeatherDanceCount',
])

const allPanelRows = computed(() => {
  return Object.entries(props.panel)
    .filter(([key, value]) => !key.startsWith('__') && !isOtherElementSpecificField(key) && typeof value === 'number' && Number.isFinite(value))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({
      key,
      label: getStatMeta(key).label === key ? key : `${getStatMeta(key).label} (${key})`,
      value: isPctStat(key) ? formatPercent(value) : formatNumber(value, Number.isInteger(value) ? 0 : 2),
    }))
})

// ========== 敌方减益 ==========
const ELEMENT_DEBUFF_LABELS = [
  ['Physical', '物理'],
  ['Fire', '火'],
  ['Ice', '冰'],
  ['Electric', '电'],
  ['Ether', '以太'],
  ['Wind', '风'],
  ['Lumiflux', '辉光'],
] as const

const currentElementPrefix = computed(() => props.damageElement ? ELEMENT_FIELD_PREFIX_BY_ELEMENT[props.damageElement] : undefined)

const elementDefReductionSummary = computed(() => ELEMENT_DEBUFF_LABELS
  .filter(([key]) => key === currentElementPrefix.value)
  .map(([key, label]) => ({ label, value: props.panel[`enemy${key}DefReduction`] ?? 0 }))
  .filter(item => item.value !== 0)
  .map(item => `${item.label}${formatPercent(item.value)}`)
  .join(' / '))

const elementResReductionSummary = computed(() => ELEMENT_DEBUFF_LABELS
  .filter(([key]) => key === currentElementPrefix.value)
  .map(([key, label]) => ({ label, value: props.panel[`enemy${key}ResReduction`] ?? 0 }))
  .filter(item => item.value !== 0)
  .map(item => `${item.label}${formatPercent(item.value)}`)
  .join(' / '))

const hasElementDefReduction = computed(() => elementDefReductionSummary.value.length > 0)
const hasElementResReduction = computed(() => elementResReductionSummary.value.length > 0)

const hasAnyEnemyDebuff = computed(() => {
  const p = props.panel
  return p.enemyDefReduction !== 0 || p.enemyDefFlatReduction !== 0 || p.enemyAnomalyDefReduction !== 0 || p.enemyResReduction !== 0
    || hasElementDefReduction.value || hasElementResReduction.value
    || p.enemyStunResReduction !== 0 || p.enemyAnomalyResReduction !== 0
    || p.enemyDamageTakenBonus !== 0 || p.enemyStunTakenBonus !== 0
})

// ========== 格式化 ==========
function formatNumber(value: number, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return '-'
  if (decimals === 0) return Math.round(value).toLocaleString()
  return Number(value.toFixed(decimals)).toLocaleString()
}

function formatPercent(value: number, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${Number(value.toFixed(decimals))}%`
}
</script>

<style scoped>
.stat-panel {
  width: 100%;
}

.stat-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 13px;
}

.stat-row:hover {
  background: var(--wa-30);
}

.stat-row.highlight-row {
  background: rgba(250, 204, 21, 0.04);
}

.stat-row.formula-row {
  background: rgba(250, 204, 21, 0.06);
  border: 1px solid rgba(250, 204, 21, 0.15);
}

.stat-label {
  color: var(--wa-650);
  font-size: 12px;
}

.stat-value {
  color: var(--wa-900);
  font-weight: 500;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.stat-value.highlight {
  color: #facc15;
}

.stat-value.debuff {
  color: #f87171;
}

.stat-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--wa-550);
  padding: 8px 8px 4px;
  margin-top: 2px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* 乘区汇总行 */
.zone-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  background: linear-gradient(90deg, rgba(250, 204, 21, 0.1), rgba(250, 204, 21, 0.02));
  border-radius: 6px;
  margin-bottom: 6px;
  border: 1px solid rgba(250, 204, 21, 0.2);
}

.zone-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--wa-850);
}

.zone-value {
  font-size: 14px;
  font-weight: 700;
  color: #facc15;
  font-variant-numeric: tabular-nums;
}

/* 公式框 */
.formula-box {
  margin: 6px 4px 10px;
  padding: 8px 10px;
  background: var(--app-inset);
  border: 1px solid var(--wa-80);
  border-radius: 6px;
}

.formula-title {
  font-size: 10px;
  color: var(--wa-450);
  margin-bottom: 6px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.formula-text {
  font-size: 11px;
  color: var(--wa-650);
  line-height: 1.7;
  font-family: 'JetBrains Mono', Consolas, monospace;
  word-break: break-all;
}

.formula-text.result {
  color: #facc15;
  font-weight: 600;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px dashed var(--wa-100);
}

.anomaly-type-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.anomaly-type-card {
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--wa-30);
  border: 1px solid var(--wa-60);
}

.anomaly-type-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--wa-860);
  margin-bottom: 3px;
}

.anomaly-type-desc {
  font-size: 11px;
  line-height: 1.45;
  color: var(--wa-480);
}

.formula-note {
  font-size: 11px;
  color: var(--wa-400);
  padding: 8px;
  font-style: italic;
  line-height: 1.5;
}

/* 伤害公式总览 */
.formula-overview {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 4px;
}

.formula-section {
  padding: 10px 12px;
  background: var(--app-inset);
  border-radius: 6px;
  border: 1px solid var(--wa-60);
}

.formula-section-title {
  font-size: 12px;
  font-weight: 700;
  color: #facc15;
  margin-bottom: 8px;
}

.formula-line {
  font-size: 11px;
  color: var(--wa-700);
  line-height: 1.7;
  font-family: 'JetBrains Mono', Consolas, monospace;
}

.formula-sub {
  font-size: 10px;
  color: var(--wa-450);
  line-height: 1.6;
  padding-left: 12px;
  margin-top: 2px;
}

.formula-source {
  font-size: 10px;
  color: var(--wa-350);
  text-align: right;
  padding: 4px 8px;
  font-style: italic;
}

.empty-hint {
  opacity: 0.5;
}

/* 覆盖 Naive UI collapse 样式 */
:deep(.n-collapse) {
  --n-item-text-color: var(--wa-850);
  --n-item-divider-color: var(--wa-60);
  background: transparent;
  border: none;
}

:deep(.n-collapse-item) {
  background: var(--wa-20);
  border-radius: 6px;
  margin-bottom: 4px;
  border: 1px solid var(--wa-40);
}

:deep(.n-collapse-item__header) {
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
}

:deep(.n-collapse-item__content) {
  padding: 0 12px 8px;
}
</style>
