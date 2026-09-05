<template>
  <div class="result-page">
    <!-- 无队伍数据时的占位 -->
    <div v-if="!hasTeam" class="placeholder">
      <n-icon size="64" color="var(--wa-150)">
        <people-outline />
      </n-icon>
      <div class="placeholder-title">请先配置队伍</div>
      <div class="placeholder-desc">在"队伍配置"页选择角色后，资源池分析将自动计算</div>
    </div>

    <template v-else>
      <!-- 全局参数栏（所有 tab 共用） -->
      <n-card size="small" class="global-config-card" :bordered="true">
        <template #header>
          <span>资源池全局参数</span>
        </template>
        <template #header-extra>
          <n-button size="small" secondary @click="handleExportExcel">导出 Excel</n-button>
        </template>
        <n-grid :cols="6" :x-gap="12" responsive="screen">
          <n-gi>
            <div class="param-item">
              <div class="param-label">总时间</div>
              <n-input-number
                :value="configStore.effectiveTime"
                size="small"
                :min="0"
                :max="180"
                @update:value="v => configStore.setEnemy({ invincibleTime: 180 - (v ?? 180) })"
              />
            </div>
          </n-gi>
          <n-gi>
            <div class="param-item">
              <div class="param-label">秽盾数量</div>
              <n-input-number
                :value="configStore.enemy.shieldCount"
                size="small"
                :min="0"
                :max="20"
                @update:value="v => configStore.setEnemy({ shieldCount: v ?? 0 })"
              />
            </div>
          </n-gi>
          <n-gi>
            <div class="param-item">
              <div class="param-label">能量盾数量</div>
              <n-input-number
                :value="configStore.enemy.energyShield"
                size="small"
                :min="0"
                :max="20"
                @update:value="v => configStore.setEnemy({ energyShield: v ?? 0 })"
              />
            </div>
          </n-gi>
          <n-gi>
            <div class="param-item">
              <div class="param-label">Boss失衡值</div>
              <n-input-number
                :value="configStore.enemy.stunValue"
                size="small"
                :min="0"
                @update:value="v => configStore.setEnemy({ stunValue: v ?? 0 })"
              />
            </div>
          </n-gi>
          <n-gi>
            <div class="param-item">
              <div class="param-label">弹刀（全队）</div>
              <n-input-number
                :value="totalParryCount"
                size="small"
                :min="0"
                :max="99"
                disabled
                :placeholder="String(totalParryCount)"
              />
            </div>
          </n-gi>
          <n-gi>
            <div class="param-item">
              <div class="param-label">闪避反击（全队）</div>
              <n-input-number
                :value="totalDodgeCount"
                size="small"
                :min="0"
                :max="99"
                disabled
                :placeholder="String(totalDodgeCount)"
              />
            </div>
          </n-gi>
          <n-gi>
            <div class="param-item">
              <div class="param-label">快速支援（全队）</div>
              <n-input-number
                :value="totalQuickAssistCount"
                size="small"
                :min="0"
                :max="99"
                disabled
                :placeholder="String(totalQuickAssistCount)"
              />
            </div>
          </n-gi>
        </n-grid>
      </n-card>

      <!-- 计算状态（所有 tab 共用）：三层不动点都要可见，别只报内层 -->
      <div v-if="resourceResult" class="result-summary">
        <n-alert :type="convergenceOk ? 'success' : 'warning'" size="small">
          <template #header>
            迭代 {{ resourceResult.iterations }} 次
            {{ resourceResult.converged ? '已收敛' : '未收敛（已达最大迭代次数）' }}
            · 失衡次数: {{ stunPoolResult?.stunCount ?? resourceResult.stunCount }}
          </template>
          <div v-if="!convergenceOk" style="font-size:12px;line-height:1.6">
            <div v-if="!resourceResult.convergence.timeBudgetConverged">
              时间预算外层未收敛（{{ resourceResult.convergence.timeBudgetPasses }} 轮）：仍有
              {{ fmt(resourceResult.convergence.timeBudgetResidualSeconds, 2) }}s 执行行前台时间超出战斗时间
              —— 通常是某模块 buildExecutions 推了占前台的行但没计入 estimateExSpecialTime。
            </div>
            <div v-if="resourceResult.convergence.outerExit === 'maxIter'">
              失衡外层耗尽迭代上限（{{ resourceResult.convergence.outerRounds }} 轮）：失衡次数/异常喧响奖励仍在变，
              结果可能停在非稳定点。
            </div>
            <div v-else-if="resourceResult.convergence.outerExit === 'cycle'">
              失衡外层检测到离散循环（{{ resourceResult.convergence.outerRounds }} 轮）后停止：
              结果取循环中的一支，属离散场景的正常兜底。
            </div>
          </div>
        </n-alert>
        <div class="combo-align-btn-row">
          <n-button size="small" type="primary" secondary @click="showComboAlignModal = true">
            合轴率调节
          </n-button>
          <!-- 原 type="info"：Naive 的 info 亮蓝在 secondary 底上白底只有 2.86:1（audit 抓出），
               换 primary（品牌蓝）与同排「合轴率调节」一致且过 AA -->
          <n-button size="small" type="primary" secondary @click="configStore.triggerRefresh" style="margin-left: 8px">
            刷新计算
          </n-button>
        </div>
      </div>

      <!-- 最终面板与乘区（局外→局内，调命座/装备后用于核对最终属性是否生效） -->
      <FinalPanel v-if="hasTeam" />

      <!-- ====== 子 tabs ====== -->
      <n-tabs v-if="resourceResult" v-model:value="activeResultTab" type="line" size="small" class="result-tabs">
        <!-- Tab 1: 资源/动作池 -->
        <n-tab-pane name="pool" tab="资源/动作池">
          <div class="pool-summary-row">
        <!-- 时间分配汇总：账本（引擎收费口径）与物化（真打出去的动作行）并列，留白可归因 -->
        <n-card size="small" class="pool-summary-card" :bordered="true">
          <template #header>
            <span class="pool-title">时间分配汇总</span>
          </template>
          <div class="pool-summary-body">
            <div class="pool-stat">
              <span class="pool-stat-label">时间预算</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.budget, 1) }}s</span>
              <span class="pool-stat-detail">战斗 {{ fmt(teamTimeSummary.battleTime, 0) }}s − 无敌 {{ fmt(teamTimeSummary.invincibleTime, 0) }}s</span>
            </div>

            <div class="pool-subtitle">账本口径 · 引擎按此分配平A池</div>
            <div class="pool-stat">
              <span class="pool-stat-label">必要前台</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.requiredFrontline, 1) }}s</span>
              <span class="pool-stat-detail">动作前台 {{ fmt(teamTimeSummary.actionFrontline, 1) }}s − 合轴抵扣 {{ fmt(teamTimeSummary.comboAlignDeduction, 1) }}s</span>
            </div>
            <div class="pool-stat">
              <span class="pool-stat-label">平A分配</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.basicTotal, 1) }}s</span>
              <span class="pool-stat-detail">可分配池 {{ fmt(teamTimeSummary.remainingFrontlinePool, 1) }}s · 已分 {{ poolFillText }}</span>
            </div>

            <div class="pool-subtitle">物化口径 · 与角色卡时间条同源</div>
            <div class="pool-stat highlight">
              <span class="pool-stat-label">前台净占用</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.rowsNet, 1) }}s</span>
              <span class="pool-stat-detail">真正打出去的动作（必要行 + 平A行）</span>
            </div>
            <div class="pool-stat" :class="teamTimeSummary.slack > 5 ? 'danger' : 'bonus'">
              <span class="pool-stat-label">时间留白</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.slack, 1) }}s</span>
              <span class="pool-stat-detail">{{ slackHint }}</span>
            </div>
            <div v-if="teamTimeSummary.ledgerInflation > 1" class="pool-stat danger">
              <span class="pool-stat-label">其中账本虚高</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.ledgerInflation, 1) }}s</span>
              <span class="pool-stat-detail">必要时间估高（estimate + 折叠残差），无对应动作行</span>
            </div>
            <div v-if="teamTimeSummary.basicShrink > 1" class="pool-stat">
              <span class="pool-stat-label">其中平A行缩水</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.basicShrink, 1) }}s</span>
              <span class="pool-stat-detail">平A时间被模块改写成专属行/挤给转大赠送行（时间守恒）</span>
            </div>
            <div v-if="teamTimeSummary.overflow > 1" class="pool-stat danger">
              <span class="pool-stat-label">超预算</span>
              <span class="pool-stat-value">{{ fmt(teamTimeSummary.overflow, 1) }}s</span>
              <span class="pool-stat-detail">合轴抵扣后净占用仍超预算（轴/交互太厚）</span>
            </div>
            <div v-if="!teamTimeSummary.timeBudgetConverged" class="pool-stat danger">
              <span class="pool-stat-label">时间预算未收敛</span>
              <span class="pool-stat-value">{{ teamTimeSummary.timeBudgetPasses }} 轮耗尽</span>
              <span class="pool-stat-detail">残差仍在变，结果可能停在错误值</span>
            </div>
            <div class="pool-per-slot">
              <span v-for="item in teamTimeSummary.perSlot" :key="item.slot" class="slot-chip">
                {{ item.name }}: 账本 {{ fmt(item.requiredFrontline, 1) }} / 物化 {{ fmt(item.necRows, 1) }} / 平A {{ fmt(item.basic, 1) }}s
              </span>
            </div>
          </div>
        </n-card>

        <!-- 失衡池汇总 -->
        <n-card v-if="stunPoolResult" size="small" class="pool-summary-card" :bordered="true">
          <template #header>
            <span class="pool-title">失衡池汇总</span>
          </template>
          <div class="pool-summary-body">
            <div class="pool-stat">
              <span class="pool-stat-label">全队失衡值</span>
              <span class="pool-stat-value">{{ fmt(stunPoolResult.totalStunBuildUp, 1) }}</span>
            </div>
            <div class="pool-stat" v-if="stunPoolResult.inAxisStunTotal > 0">
              <span class="pool-stat-label">其中轴内失效</span>
              <span class="pool-stat-value dim">{{ fmt(stunPoolResult.inAxisStunTotal, 1) }}（毛失衡 {{ fmt(stunPoolResult.grossStunBuildUp, 1) }}）</span>
            </div>
            <div class="pool-stat">
              <span class="pool-stat-label">Boss失衡值</span>
              <span class="pool-stat-value">{{ fmt(stunPoolResult.bossStunValue) }}</span>
            </div>
            <div class="pool-stat highlight">
              <span class="pool-stat-label">失衡次数</span>
              <span class="pool-stat-value">{{ stunPoolResult.stunCount }} 次</span>
            </div>
            <div class="pool-stat">
              <span class="pool-stat-label">连携次数</span>
              <span class="pool-stat-value">{{ stunPoolResult.chainCountTotal }} 次</span>
            </div>
            <div class="pool-stat bonus">
              <span class="pool-stat-label">喧响奖励</span>
              <span class="pool-stat-value">+{{ fmt(stunPoolResult.decibelBonus) }}</span>
            </div>
            <div class="pool-per-slot">
              <span v-for="(val, i) in stunPoolResult.perSlotStun" :key="i" class="slot-chip">
                {{ agentNames[configStore.team[i]?.agentId ?? ''] || `槽${i}` }}: {{ fmt(val, 1) }}
              </span>
            </div>
          </div>
        </n-card>

      </div>
      <!-- 三角色资源池卡片 -->
      <div v-if="resourceResult.characters.length > 0" class="card-row">
        <ResourceResultCard
          v-for="charResult in resourceResult.characters"
          :key="charResult.slot"
          :result="charResult"
          :agent-name="agentNames[charResult.agentId] || charResult.agentId"
          :specialty="getSpecialty(charResult.agentId)"
          :stun-pool-result="stunPoolResult"
          :anomaly-pool-result="anomalyPoolResult"
        />
      </div>
      <div v-else class="placeholder">
        <div class="placeholder-title">无法计算</div>
        <div class="placeholder-desc">请确保队伍中至少有1名角色且技能数据完整</div>
      </div>
        </n-tab-pane>

        <!-- Tab 2: 异常池 -->
        <n-tab-pane name="anomaly" tab="异常池">
        <!-- 积蓄池汇总 -->
        <n-card v-if="anomalyPoolResult" size="small" class="pool-summary-card" :bordered="true">
          <template #header>
            <span class="pool-title">积蓄池汇总</span>
          </template>
          <div class="pool-summary-body">
            <div v-for="prog in anomalyPoolResult.perElement" :key="prog.element" class="pool-stat">
              <span class="pool-stat-label">{{ elementLabel(prog.element) }}</span>
              <span class="pool-stat-value">{{ fmt(prog.totalBuildUp, 1) }}</span>
              <span class="pool-stat-detail">{{ prog.triggerCount }} 次</span>
            </div>
            <div class="pool-stat highlight">
              <span class="pool-stat-label">异常触发</span>
              <span class="pool-stat-value">{{ anomalyPoolResult.totalTriggerCount }} 次</span>
            </div>
            <div class="pool-stat">
              <span class="pool-stat-label">紊乱次数</span>
              <span class="pool-stat-value">{{ anomalyPoolResult.disorderCount }} 次</span>
            </div>
            <div class="pool-stat bonus">
              <span class="pool-stat-label">喧响奖励</span>
              <span class="pool-stat-value">+{{ fmt(anomalyPoolResult.decibelBonus) }}</span>
              <span class="pool-stat-detail">按触发角色归属</span>
            </div>
            <div class="pool-per-slot">
              <span v-for="(val, i) in anomalyPoolResult.perSlotBonus" :key="i" class="slot-chip">
                {{ agentNames[configStore.team[i]?.agentId ?? ''] || `槽${i}` }}: +{{ fmt(val) }}
              </span>
            </div>
          </div>

          <!-- 异常覆盖率 -->
          <div v-if="anomalyPoolResult.coverage" class="pool-coverage-section">
            <div class="pool-subtitle">异常覆盖率</div>
            <div class="pool-summary-body">
              <div class="pool-stat highlight">
                <span class="pool-stat-label">综合覆盖率</span>
                <span class="pool-stat-value">{{ (anomalyPoolResult.coverage.coverageRate * 100).toFixed(1) }}%</span>
              </div>
              <div v-if="anomalyPoolResult.coverage.windCoverageRate > 0" class="pool-stat">
                <span class="pool-stat-label">风化/乱流窗口</span>
                <span class="pool-stat-value">{{ (anomalyPoolResult.coverage.windCoverageRate * 100).toFixed(1) }}%</span>
                <span class="pool-stat-detail">非风窗口 {{ ((1 - anomalyPoolResult.coverage.windCoverageRate) * 100).toFixed(1) }}%</span>
              </div>
              <div class="pool-stat">
                <span class="pool-stat-label">总DoT时间</span>
                <span class="pool-stat-value">{{ fmt(anomalyPoolResult.coverage.totalDoTTime) }}s</span>
              </div>
              <div class="pool-stat">
                <span class="pool-stat-label">有效DoT</span>
                <span class="pool-stat-value">{{ fmt(anomalyPoolResult.coverage.effectiveDoTTime) }}s</span>
                <span class="pool-stat-detail">-{{ fmt(anomalyPoolResult.coverage.invincibleTime) }}s 无敌</span>
              </div>
              <div v-if="anomalyPoolResult.coverage.physicalCoverageRate > 0" class="pool-stat">
                <span class="pool-stat-label">畏缩覆盖</span>
                <span class="pool-stat-value">{{ (anomalyPoolResult.coverage.physicalCoverageRate * 100).toFixed(1) }}%</span>
                <span class="pool-stat-detail">+{{ (anomalyPoolResult.coverage.physicalCoverageRate * 7.5).toFixed(2) }}% 失衡</span>
              </div>
              <div v-if="anomalyPoolResult.coverage.frostCoverageRate > 0" class="pool-stat">
                <span class="pool-stat-label">霜寒覆盖</span>
                <span class="pool-stat-value">{{ (anomalyPoolResult.coverage.frostCoverageRate * 100).toFixed(1) }}%</span>
                <span class="pool-stat-detail">+{{ (anomalyPoolResult.coverage.frostCoverageRate * 10).toFixed(2) }}% 暴击伤害</span>
              </div>
            </div>
          </div>

          <!-- 紊乱伤害（无风属性时） -->
          <div v-if="anomalyPoolResult.disorderDamage" class="pool-coverage-section">
            <div class="pool-subtitle">紊乱伤害</div>
            <div class="pool-summary-body">
              <div class="pool-stat highlight">
                <span class="pool-stat-label">总紊乱伤害</span>
                <span class="pool-stat-value">{{ fmt(anomalyPoolResult.disorderDamage.totalDamage) }}</span>
              </div>
              <div class="pool-stat">
                <span class="pool-stat-label">紊乱次数</span>
                <span class="pool-stat-value">{{ anomalyPoolResult.disorderDamage.count }} 次</span>
              </div>
              <div class="pool-stat">
                <span class="pool-stat-label">平均/次</span>
                <span class="pool-stat-value">{{ fmt(anomalyPoolResult.disorderDamage.avgDamage) }}</span>
              </div>
            </div>
          </div>

          <!-- 乱流伤害（有风属性时） -->
          <div v-if="anomalyPoolResult.turbulenceDamage" class="pool-coverage-section">
            <div class="pool-subtitle">乱流伤害（风属性）</div>
            <div class="pool-summary-body">
              <div class="pool-stat highlight">
                <span class="pool-stat-label">总乱流伤害</span>
                <span class="pool-stat-value">{{ fmt(anomalyPoolResult.turbulenceDamage.totalDamage) }}</span>
              </div>
              <div class="pool-stat">
                <span class="pool-stat-label">乱流次数</span>
                <span class="pool-stat-value">{{ anomalyPoolResult.turbulenceDamage.count }} 次</span>
              </div>
              <div class="pool-stat">
                <span class="pool-stat-label">强化乱流</span>
                <span class="pool-stat-value">{{ anomalyPoolResult.turbulenceDamage.boostedCount }} 次</span>
                <span class="pool-stat-detail">风蚀+150%倍率</span>
              </div>
              <div class="pool-stat">
                <span class="pool-stat-label">平均/次</span>
                <span class="pool-stat-value">{{ fmt(anomalyPoolResult.turbulenceDamage.avgDamage) }}</span>
              </div>
            </div>

            <!-- 爱丽丝畏缩 DOT + 专属伤害汇总 -->
            <div v-if="aliceDamageSummary" class="pool-coverage-section">
              <div class="pool-subtitle">爱丽丝伤害汇总</div>
              <div class="pool-summary-body">
                <div class="pool-stat highlight">
                  <span class="pool-stat-label">极性强击</span>
                  <span class="pool-stat-value">{{ fmt(aliceDamageSummary.polarAssaultDamage) }}</span>
                  <span class="pool-stat-detail">{{ aliceDamageSummary.polarAssaultEvents }} 次</span>
                </div>
                <div class="pool-stat">
                  <span class="pool-stat-label">畏缩 DOT</span>
                  <span class="pool-stat-value">{{ fmt(aliceDamageSummary.coweringDotDamage) }}</span>
                  <span class="pool-stat-detail">{{ aliceDamageSummary.dotTicks }} tick · {{ aliceDamageSummary.dotInterval }}s/次</span>
                </div>
                <div class="pool-stat bonus">
                  <span class="pool-stat-label">畏缩紊乱加成</span>
                  <span class="pool-stat-value">+{{ fmt(aliceDamageSummary.coweringDisorderBonus) }}</span>
                  <span class="pool-stat-detail">每剩余1s物理异常 +{{ aliceDamageSummary.disorderBonusPerSec }}%</span>
                </div>
                <div class="pool-stat">
                  <span class="pool-stat-label">六命额外攻击</span>
                  <span class="pool-stat-value">{{ fmt(aliceDamageSummary.cinema6Damage) }}</span>
                  <span class="pool-stat-detail">
                    {{ aliceDamageSummary.cinema6Count }} 次 ·
                    每次状态
                    <n-input-number
                      :value="aliceCinema6PerStateCount"
                      size="tiny"
                      :min="0"
                      :max="6"
                      :step="1"
                      style="width: 56px; display: inline-flex; vertical-align: middle"
                      @update:value="v => configStore.setMechanicSetting('alice.cinema6PerStateCount', v ?? 5)"
                    />
                    次
                  </span>
                </div>
              </div>
            </div>
          </div>
        </n-card>

        <!-- 异常虚拟面板 -->
        <n-card v-if="anomalyVirtualPanels.length > 0" size="small" class="virtual-panel-card" :bordered="true">
          <template #header>
            <span class="pool-title">异常虚拟面板</span>
          </template>
          <div v-for="vp in anomalyVirtualPanels" :key="vp.element" class="virtual-panel-block">
            <div class="virtual-panel-title">{{ elementLabel(vp.element) }}异常 · 总积蓄 {{ fmt(vp.totalBuildUp, 1) }}</div>
            <div class="virtual-panel-table">
              <div class="virtual-panel-row virtual-panel-head">
                <span>角色</span>
                <span>积蓄</span>
                <span>权重</span>
                <span>攻击</span>
                <span>精通</span>
                <span>增伤</span>
                <span>穿透率</span>
                <span>穿透值</span>
                <span>异化度</span>
              </div>
              <div v-for="row in vp.rows" :key="row.slot" class="virtual-panel-row">
                <span>{{ row.name }}<span v-if="row.settlementEligible === false" style="color:#f0a020;font-size:10px;margin-left:4px">（赠）</span></span>
                <span>{{ fmt(row.buildup, 1) }}</span>
                <span>{{ (row.weight * 100).toFixed(1) }}%</span>
                <span>{{ fmt(row.atk, 1) }}</span>
                <span>{{ fmt(row.anomalyProficiency, 1) }}</span>
                <span>{{ fmt(row.dmgBonus, 1) }}%</span>
                <span>{{ fmt(row.penRatio, 1) }}%</span>
                <span>{{ fmt(row.penFlat, 1) }}</span>
                <span>{{ fmt(row.refringe, 1) }}%</span>
              </div>
              <div class="virtual-panel-row virtual-panel-virtual">
                <span>{{ vp.virtual.name }}</span>
                <span>{{ fmt(vp.virtual.buildup, 1) }}</span>
                <span>100%</span>
                <span>{{ fmt(vp.virtual.atk, 1) }}</span>
                <span>{{ fmt(vp.virtual.anomalyProficiency, 1) }}</span>
                <span>{{ fmt(vp.virtual.dmgBonus, 1) }}%</span>
                <span>{{ fmt(vp.virtual.penRatio, 1) }}%</span>
                <span>{{ fmt(vp.virtual.penFlat, 1) }}</span>
                <span>{{ fmt(vp.virtual.refringe, 1) }}%</span>
              </div>
            </div>
          </div>
        </n-card>

        <!-- 异常事件明细 -->
        <n-card v-if="anomalyEventRows.length > 0" size="small" class="pool-summary-card anomaly-event-card" :bordered="true">
          <template #header>
            <span class="pool-title">异常事件明细</span>
          </template>
          <div class="event-table-wrap expanded">
            <table class="event-table">
              <thead>
                <tr>
                  <th>事件</th>
                  <th>来源</th>
                  <th>次数</th>
                  <th>当前公式</th>
                  <th>读取字段</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="event in anomalyEventRows" :key="event.id">
                  <td class="event-name">{{ event.label }}</td>
                  <td>{{ event.source }}</td>
                  <td class="event-count">{{ event.count }}</td>
                  <td class="event-formula">
                    <div>{{ event.formula }}</div>
                    <div v-if="event.note" class="event-note">{{ event.note }}</div>
                  </td>
                  <td class="event-fields">{{ event.fields.join(' · ') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </n-card>

        <!-- 特殊动作汇总 -->
        <n-card v-if="specialActionBonus" size="small" class="pool-summary-card" :bordered="true">
          <template #header>
            <span class="pool-title">特殊动作喧响</span>
          </template>
          <div class="pool-summary-body">
            <div class="pool-stat">
              <span class="pool-stat-label">弹刀 ({{ totalParryCount }}次)</span>
              <span class="pool-stat-value">+{{ fmt(specialActionBonus.parry) }}</span>
              <span class="pool-stat-detail">215/次 · 伴随107.5</span>
            </div>
            <div class="pool-stat">
              <span class="pool-stat-label">连携 ({{ specialActionBonus.perSlotChain.reduce((a, b) => a + b, 0) }}次)</span>
              <span class="pool-stat-value">+{{ fmt(specialActionBonus.chain) }}</span>
              <span class="pool-stat-detail">10/次 · 伴随5</span>
            </div>
            <div class="pool-stat">
              <span class="pool-stat-label">闪避反击 ({{ totalDodgeCount }}次)</span>
              <span class="pool-stat-value">+{{ fmt(specialActionBonus.dodgeCounter) }}</span>
              <span class="pool-stat-detail">10/次 · 伴随5</span>
            </div>
            <div class="pool-stat">
              <span class="pool-stat-label">快速支援 ({{ totalQuickAssistCount }}次)</span>
              <span class="pool-stat-value">+{{ fmt(specialActionBonus.quickAssist) }}</span>
              <span class="pool-stat-detail">20/次 · 伴随10</span>
            </div>
            <div class="pool-stat bonus">
              <span class="pool-stat-label">总计</span>
              <span class="pool-stat-value">+{{ fmt(specialActionBonus.total) }}</span>
            </div>
            <div class="pool-per-slot">
              <span v-for="(val, i) in specialActionBonus.perSlotBonus" :key="i" class="slot-chip">
                {{ agentNames[configStore.team[i]?.agentId ?? ''] || `槽${i}` }}: +{{ fmt(val) }}
              </span>
            </div>
          </div>
        </n-card>
        </n-tab-pane>

        <!-- Tab 3: 伤害池 -->
        <n-tab-pane name="damage" tab="伤害池">
      <n-card v-if="teamOverview.length > 0" size="small" class="team-overview-card" :bordered="true">
        <template #header>
          <span class="pool-title">团队总览</span>
        </template>
        <div class="team-overview-table">
          <div class="team-overview-row team-overview-head">
            <span>角色</span>
            <span>伤害占比</span>
            <span>积蓄占比</span>
            <span>失衡占比</span>
            <span>能量</span>
            <span>喧响</span>
            <span>强特/终结</span>
          </div>
          <div v-for="row in teamOverview" :key="row.slot" class="team-overview-row">
            <span>{{ row.name }}</span>
            <span>{{ fmt(row.damage, 0) }} · {{ row.damagePct.toFixed(1) }}%</span>
            <span>{{ fmt(row.buildup, 1) }} · {{ row.buildupPct.toFixed(1) }}%</span>
            <span>{{ fmt(row.stun, 0) }} · {{ row.stunPct.toFixed(1) }}%</span>
            <span>{{ fmt(row.energy, 1) }}</span>
            <span>{{ fmt(row.decibel, 1) }}</span>
            <span>{{ row.exSpecialCount }} / {{ row.ultimateCount }}</span>
          </div>
        </div>
      </n-card>

      <!-- 伤害占比 -->
      <n-card v-if="damageShareCategories.length > 0" size="small" class="damage-share-card" :bordered="true">
        <template #header>
          <span class="pool-title">伤害占比</span>
        </template>
        <div class="damage-share-summary">
          <span>团队总伤害</span>
          <b>{{ fmt(totalDamageWithDisorder, 0) }}</b>
        </div>
        <div class="share-category-row">
          <div v-for="cat in damageShareCategories" :key="cat.key" class="share-category-chip">
            <span>{{ cat.label }}</span>
            <b>{{ fmt(cat.damage, 0) }}</b>
            <span>{{ cat.pct.toFixed(1) }}%</span>
          </div>
        </div>
        <div v-for="share in characterDamageShares" :key="share.agentId" class="share-character">
          <div class="share-character-head">
            <span>{{ share.name }}</span>
            <b>{{ share.pct.toFixed(1) }}%</b>
          </div>
          <div class="share-character-cats">
            <span v-for="cat in share.categories" :key="cat.key" class="share-character-chip">
              {{ cat.label }} {{ fmt(cat.damage, 0) }} · {{ cat.pct.toFixed(1) }}%
            </span>
          </div>
        </div>
        <div class="share-note">极性紊乱、极性强击等角色专属事件暂未建模；异放事件已按角色/事件在个人伤害占比中显示。</div>
      </n-card>

      <!-- 伤害来源分解（诊断：总伤害异常时定位是倍率错还是属性区错） -->
      <n-card v-if="damageSourceBreakdown.length > 0" size="small" class="damage-source-card" :bordered="true">
        <template #header>
          <div class="damage-pool-header">
            <span>伤害来源分解</span>
            <span class="damage-pool-total">总伤害 {{ fmt(damagePoolTotal, 0) }} ≈ 直伤倍率×属性区 + 异常倍率×属性区</span>
          </div>
        </template>
        <div class="damage-source-table">
          <div class="damage-pool-row damage-pool-head damage-source-row">
            <span>角色</span>
            <span>族</span>
            <span>总伤害</span>
            <span>总倍率(%)</span>
            <span>属性区</span>
            <span>无倍率行伤害</span>
          </div>
          <template v-for="b in damageSourceBreakdown" :key="b.slot">
            <div v-if="b.direct.damage > 0 || b.direct.flatDamage > 0" class="damage-pool-row damage-source-row">
              <span>{{ b.agentName }}</span>
              <span class="damage-type">直伤</span>
              <span class="damage-total">{{ fmt(b.direct.damage, 0) }}</span>
              <span>{{ fmt(b.direct.multiplier, 0) }}</span>
              <span>{{ fmt(b.direct.attrRegion, 0) }}</span>
              <span>{{ fmt(b.direct.flatDamage, 0) }}</span>
            </div>
            <div v-if="b.anomaly.damage > 0 || b.anomaly.flatDamage > 0" class="damage-pool-row damage-source-row">
              <span>{{ b.agentName }}</span>
              <span class="damage-type">异常</span>
              <span class="damage-total">{{ fmt(b.anomaly.damage, 0) }}</span>
              <span>{{ fmt(b.anomaly.multiplier, 0) }}</span>
              <span>{{ fmt(b.anomaly.attrRegion, 0) }}</span>
              <span>{{ fmt(b.anomaly.flatDamage, 0) }}</span>
            </div>
          </template>
        </div>
        <div class="share-note">属性区 = 有倍率行的伤害 ÷ (总倍率/100)，即每 100% 倍率对应的面板×乘区伤害；无倍率行（固定/附伤公式）单列。检查总伤害时：总伤害 ≈ 总倍率/100 × 属性区 + 无倍率伤害。</div>
      </n-card>

      <!-- 伤害池 -->
      <n-card v-if="damagePoolRows.length > 0" size="small" class="damage-pool-card" :bordered="true">
        <template #header>
          <div class="damage-pool-header">
            <span>伤害池</span>
            <span class="damage-pool-total">总伤害 {{ fmt(damagePoolTotal, 0) }}</span>
          </div>
        </template>
        <div class="damage-pool-table">
          <div class="damage-pool-row damage-pool-head">
            <span>角色</span>
            <span>类型</span>
            <span>事件</span>
            <span>属性/来源</span>
            <span>次数</span>
            <span>单次</span>
            <span>总伤</span>
            <span>说明</span>
          </div>
          <div v-for="row in damagePoolRows" :key="row.id" class="damage-pool-row">
            <span>{{ row.agentName }}</span>
            <span class="damage-type">{{ row.type }}</span>
            <span class="damage-name">{{ row.name }}</span>
            <span>{{ elementLabel(row.element) }} · {{ row.source }}</span>
            <span>{{ fmt(row.count, 2) }}</span>
            <span>{{ fmt(row.perDamage, 0) }}</span>
            <span class="damage-total">{{ fmt(row.totalDamage, 0) }}</span>
            <span class="damage-note">{{ row.note || '-' }}</span>
          </div>
        </div>
      </n-card>
        </n-tab-pane>
      </n-tabs>
      <!-- 无计算结果 -->
      <div v-if="!resourceResult" class="placeholder">
        <div class="placeholder-title">无法计算</div>
        <div class="placeholder-desc">请确保队伍中至少有1名角色且技能数据完整</div>
      </div>
    </template>

    <!-- 合轴率调节弹窗 -->
    <n-modal v-model:show="showComboAlignModal" preset="card" title="合轴率调节" style="width: 900px; max-width: 95vw;">
      <div class="combo-align-modal-body">
        <n-text depth="3" style="font-size: 12px; display: block; margin-bottom: 12px">
          合轴率表示该招式动作时间中可与其他操作并行的比例。合轴时间内角色处于"非操作中"状态，触发非操作回能加成；
          合轴段不占三人共享时间轴 → 该部分时间回流平A池（全队必做动作因此可超出战斗总时长）。
          查看各招式的总时间和执行次数后，输入合适的合轴率（0-100%）。
        </n-text>

        <div style="text-align: right; margin-bottom: 8px">
          <n-button size="small" type="info" secondary @click="configStore.triggerRefresh">
            应用并刷新计算
          </n-button>
        </div>

        <n-tabs type="line" animated>
          <n-tab-pane
            v-for="charResult in resourceResult?.characters ?? []"
            :key="charResult.slot"
            :name="String(charResult.slot)"
            :tab="agentNames[charResult.agentId] || `槽${charResult.slot + 1}`"
          >
            <div class="combo-align-exec-list">
              <div
                v-for="exec in charResult.executions.filter(e => e.actionTime > 0)"
                :key="exec.moveId"
                class="combo-align-exec-row"
              >
                <div class="combo-align-exec-info">
                  <span class="combo-align-exec-name">{{ exec.moveName.replace(/（.*）/g, '').trim() }}</span>
                  <n-text depth="3" style="font-size: 11px">
                    {{ exec.count > 0 ? `${exec.count}次` : '平A' }} · 单次{{ exec.actionTime.toFixed(2) }}s · 总{{ exec.totalTime.toFixed(1) }}s
                  </n-text>
                </div>
                <div class="combo-align-exec-control">
                  <n-slider
                    :value="getComboAlignRatio(charResult.slot, exec.moveId) * 100"
                    :min="0"
                    :max="100"
                    :step="5"
                    style="width: 200px"
                    @update:value="v => setComboAlignRatio(charResult.slot, exec.moveId, v / 100)"
                  />
                  <n-input-number
                    :value="Math.round(getComboAlignRatio(charResult.slot, exec.moveId) * 100)"
                    :min="0"
                    :max="100"
                    size="small"
                    style="width: 80px"
                    @update:value="v => setComboAlignRatio(charResult.slot, exec.moveId, (v ?? 0) / 100)"
                  >
                    <template #suffix>%</template>
                  </n-input-number>
                  <span class="combo-align-time-display">
                    合轴{{ (exec.totalTime * getComboAlignRatio(charResult.slot, exec.moveId)).toFixed(1) }}s
                  </span>
                </div>
              </div>
            </div>

            <div class="combo-align-summary">
              <n-text depth="2" style="font-size: 12px">
                总合轴时间: {{ getTotalComboAlignTime(charResult).toFixed(1) }}s
                · 合轴回能加成: {{ (getTotalComboAlignTime(charResult) * 0).toFixed(0) }} 点/秒
              </n-text>
            </div>
          </n-tab-pane>
        </n-tabs>
      </div>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  NCard, NGrid, NGi, NInputNumber, NAlert, NIcon,
  NButton, NModal, NTabs, NTabPane, NSlider, NText,
} from 'naive-ui'
import { PeopleOutline } from '@vicons/ionicons5'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { fmt } from '@/utils/format'
import { exportExcelFile } from '@/utils/exportExcel'
import ResourceResultCard from '@/components/ResourceResultCard.vue'
import FinalPanel from '@/components/FinalPanel.vue'
import { buildTeamTimeSummary, poolFillText as poolFillTextOf, slackHint as slackHintOf } from '@/composables/teamTimeSummary'
import type { CharacterResourceResult, AnomalyEventRecord } from '@/types/resource'

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
const {
  resourceResult,
  stunPoolResult,
  anomalyPoolResult,
  specialActionBonus,
  damagePoolRows,
  damageSourceBreakdown,
  remielleVoidflareEvents,
  anomalyDamageEvents,
  anomalyVirtualPanels,
  agentNames,
} = useResourceCalc()

// 是否有队伍数据
const hasTeam = computed(() => {
  return configStore.team.some(c => c.agentId)
})

/**
 * 三层不动点是否都健康落地（只报内层「已收敛」会掩盖外层耗尽上限的情况）。
 * `cycle` 视为正常兜底（离散场景取循环中一支），只有真·未收敛才转黄。
 */
const convergenceOk = computed(() => {
  const r = resourceResult.value
  if (!r) return true
  const c = r.convergence
  return r.converged
    && c.timeBudgetConverged
    && (c.outerExit === undefined || c.outerExit !== 'maxIter')
})

/** 导出 Excel：操作表（配置快照）/ 资源表 / 伤害行明细 / 异常池；文件名带队伍名 */
async function handleExportExcel() {
  const teamName = configStore.team
    .filter(c => c.agentId)
    .map(c => agentNames.value[c.agentId] ?? c.agentId)
    .join('-')
  await exportExcelFile({
    team: configStore.team,
    enemy: configStore.enemy,
    agentNameOf: (agentId, slot) => agentNames.value[agentId] ?? catalogStore.getAgent(agentId)?.name?.zhCN ?? `槽${slot + 1}`,
    wEngineNameOf: id => (id ? catalogStore.getWEngine(id)?.name?.zhCN ?? id : ''),
    resourceResult: resourceResult.value,
    damagePoolRows: damagePoolRows.value,
    stunPoolResult: stunPoolResult.value,
    anomalyPoolResult: anomalyPoolResult.value,
  }, teamName || 'zzz-calculator')
}

// 全队弹刀/闪避反击总次数（per-character 求和）
const totalParryCount = computed(() =>
  configStore.team.reduce((sum, c) => sum + (c.parryCount ?? 0), 0),
)
const totalDodgeCount = computed(() =>
  configStore.team.reduce((sum, c) => sum + (c.dodgeCounterCount ?? 0), 0),
)
const totalQuickAssistCount = computed(() =>
  configStore.team.reduce((sum, c) => sum + (c.quickAssistCount ?? 0), 0),
)

// 全队时间分配汇总：账本口径（引擎收费）与物化口径（真打出去的动作行）并列 + 留白归因。
// 计算在 composables/teamTimeSummary.ts（纯函数 + 生效测试），本文件只渲染。
const teamTimeSummary = computed(() => buildTeamTimeSummary({
  rr: resourceResult.value,
  battleTime: resourceResult.value?.totalTime ?? configStore.enemy.battleTime ?? 180,
  invincibleTime: configStore.enemy.invincibleTime ?? 0,
  nameOf: (agentId, slot) => agentNames.value[agentId] || `槽${slot}`,
}))

const poolFillText = computed(() => poolFillTextOf(teamTimeSummary.value))
const slackHint = computed(() => slackHintOf(teamTimeSummary.value, fmt))

// 获取角色特性
function getSpecialty(agentId: string): string {
  const agent = catalogStore.getAgent(agentId)
  return agent?.specialty ?? ''
}

// 元素中文标签
const ELEMENT_LABELS: Record<string, string> = {
  physical: '物理',
  fire: '火',
  ice: '冰',
  electric: '电',
  ether: '以太',
  wind: '风',
  lumiflux: '辉光',
  physical_polar_assault: '极性强击',
}

function elementLabel(element: string): string {
  return ELEMENT_LABELS[element] ?? element
}

const damagePoolTotal = computed(() =>
  damagePoolRows.value.reduce((sum, row) => sum + row.totalDamage, 0),
)

// 紊乱伤害已纳入 damagePoolRows，无需额外加算
const totalDamageWithDisorder = computed(() => damagePoolTotal.value)

interface DamageShareCategory {
  key: string
  label: string
  damage: number
  pct: number
}

interface CharacterDamageShare {
  agentId: string
  name: string
  slot: number
  total: number
  pct: number
  categories: DamageShareCategory[]
}

const damageShareCategories = computed<DamageShareCategory[]>(() => {
  const totals = new Map<string, number>()
  for (const row of damagePoolRows.value) {
    totals.set(row.type, (totals.get(row.type) ?? 0) + row.totalDamage)
  }
  // 紊乱伤害已纳入 damagePoolRows（type='紊乱'），无需额外加算
  const total = totalDamageWithDisorder.value
  return [...totals.entries()]
    .map(([label, damage]) => ({
      key: label,
      label,
      damage,
      pct: total > 0 ? (damage / total) * 100 : 0,
    }))
    .sort((a, b) => b.damage - a.damage)
})

const characterDamageShares = computed<CharacterDamageShare[]>(() => {
  const perAgent = new Map<string, Map<string, number>>()
  const addDamage = (agentId: string, label: string, damage: number) => {
    if (!agentId || damage <= 0) return
    let categories = perAgent.get(agentId)
    if (!categories) {
      categories = new Map<string, number>()
      perAgent.set(agentId, categories)
    }
    categories.set(label, (categories.get(label) ?? 0) + damage)
  }

  for (const row of damagePoolRows.value) {
    addDamage(row.agentId, row.type, row.totalDamage)
  }
  // 紊乱伤害已纳入 damagePoolRows（type='紊乱'），无需从 details 额外加算

  const total = totalDamageWithDisorder.value
  return configStore.team
    .map((char, slot) => {
      const categories = perAgent.get(char.agentId) ?? new Map<string, number>()
      const charTotal = [...categories.values()].reduce((a, b) => a + b, 0)
      return {
        agentId: char.agentId,
        name: agentNames.value[char.agentId] || `槽${slot + 1}`,
        slot,
        total: charTotal,
        pct: total > 0 ? (charTotal / total) * 100 : 0,
        categories: [...categories.entries()]
          .map(([label, damage]) => ({
            key: label,
            label,
            damage,
            // 个人伤害构成占比：该伤害类型占该角色个人总伤害的比例
            pct: charTotal > 0 ? (damage / charTotal) * 100 : 0,
          }))
          .sort((a, b) => b.damage - a.damage),
      }
    })
    .filter(share => share.total > 0)
})

const teamOverview = computed(() => {
  const damageTotal = totalDamageWithDisorder.value
  const stunTotal = stunPoolResult.value?.totalStunBuildUp ?? 0
  // 按 slot 汇总积蓄；异属性赠送/赋彩贡献（贡献元素 ≠ 角色伤害元素）记在接收人头上（该元素同属性主贡献者槽），不记赠送者
  const perSlotBuildUp: number[] = [0, 0, 0]
  let totalBuildUp = 0
  for (const prog of anomalyPoolResult.value?.perElement ?? []) {
    // 接收人槽 = 该元素同属性（非赠送）贡献者中积蓄最大的槽
    let receiverSlot = -1
    const receivers = (prog.contributions ?? []).filter(c => {
      const el = catalogStore.getAgent(configStore.team[c.slot]?.agentId ?? '')?.damageElement
      return el === prog.element
    })
    if (receivers.length > 0) {
      receiverSlot = receivers.reduce((max, c) => (c.totalBuildUp > max.totalBuildUp ? c : max)).slot
    }
    for (const contrib of prog.contributions ?? []) {
      const agentEl = catalogStore.getAgent(configStore.team[contrib.slot]?.agentId ?? '')?.damageElement
      const gifted = !!agentEl && contrib.element !== agentEl
      const targetSlot = gifted && receiverSlot >= 0 ? receiverSlot : contrib.slot
      perSlotBuildUp[targetSlot] = (perSlotBuildUp[targetSlot] ?? 0) + contrib.totalBuildUp
      totalBuildUp += contrib.totalBuildUp
    }
  }
  return configStore.team.map((char, slot) => {
    const share = characterDamageShares.value.find(item => item.slot === slot)
    const stun = stunPoolResult.value?.perSlotStun?.[slot] ?? 0
    const resource = resourceResult.value?.characters.find(item => item.slot === slot)
    const buildup = perSlotBuildUp[slot] ?? 0
    return {
      slot,
      name: agentNames.value[char.agentId] || `槽${slot + 1}`,
      damage: share?.total ?? 0,
      damagePct: damageTotal > 0 ? ((share?.total ?? 0) / damageTotal) * 100 : 0,
      stun,
      stunPct: stunTotal > 0 ? (stun / stunTotal) * 100 : 0,
      buildup,
      buildupPct: totalBuildUp > 0 ? (buildup / totalBuildUp) * 100 : 0,
      energy: resource?.energySource.total ?? 0,
      decibel: resource?.decibelSource.total ?? 0,
      exSpecialCount: resource?.exSpecialCount ?? 0,
      ultimateCount: resource?.ultimateCount ?? 0,
    }
  })
})

const anomalyEventRows = computed<AnomalyEventRecord[]>(() => {
  const rows: AnomalyEventRecord[] = [
    ...(anomalyPoolResult.value?.anomalyEvents ?? []),
    ...remielleVoidflareEvents.value,
    ...anomalyDamageEvents.value,
  ]
  for (const char of resourceResult.value?.characters ?? []) {
    for (const event of char.anomalyEventExecutions ?? []) {
      if (event.count <= 0) continue
      rows.push({
        id: `resource-${char.slot}-${event.eventId}`,
        type: event.eventType === 'special_voidflare' ? 'special_voidflare' : 'luminize',
        label: event.eventName,
        source: `${agentNames.value[char.agentId] || char.agentName || `槽${char.slot + 1}`} 的异常事件执行计划`,
        count: event.count,
        formula: event.formula,
        fields: event.fields,
        note: event.note,
      })
    }
  }
  return rows
})

// ============ 爱丽丝伤害汇总 ============

interface AliceDamageSummary {
  polarAssaultDamage: number
  polarAssaultEvents: number
  coweringDotDamage: number
  dotTicks: number
  dotInterval: number
  coweringDisorderBonus: number
  disorderBonusPerSec: number
  cinema6Damage: number
  cinema6Count: number
}

const aliceDamageSummary = computed<AliceDamageSummary | null>(() => {
  const dot = anomalyPoolResult.value?.aliceCoweringDot
  const hasDot = dot && dot.totalDotDamage > 0

  // 从 damagePoolRows 中汇总爱丽丝专属行
  let polarAssaultDamage = 0
  let polarAssaultEvents = 0
  let cinema6Damage = 0
  let cinema6Count = 0
  for (const row of damagePoolRows.value) {
    if (row.type === '极性强击') {
      polarAssaultDamage += row.totalDamage
      polarAssaultEvents += row.count
    }
    if (row.type === '爱丽丝6命附伤') {
      cinema6Damage += row.totalDamage
      cinema6Count += row.count
    }
  }

  if (!hasDot && polarAssaultDamage <= 0 && cinema6Damage <= 0) return null

  // 畏缩紊乱加成 = 每剩余1秒物理异常 +bonusPerSec%，从紊乱公式读取
  const disorderBonusPerSec = 18 // 默认值，来自 AliceCoweringConfig

  return {
    polarAssaultDamage,
    polarAssaultEvents,
    coweringDotDamage: dot?.totalDotDamage ?? 0,
    dotTicks: dot?.totalTicks ?? 0,
    dotInterval: dot?.dotInterval ?? 0.95,
    coweringDisorderBonus: 0, // 紊乱回伤加成在 disorder detail 中已计入，此处仅展示信息
    disorderBonusPerSec,
    cinema6Damage,
    cinema6Count,
  }
})

/** 爱丽丝 6 命每状态额外攻击次数（从 config store 读取，用户可在资源利用率页或此处调节） */
const aliceCinema6PerStateCount = computed(() =>
  configStore.getMechanicSetting('alice.cinema6PerStateCount', 5),
)

// ============ 子 tabs ============

const activeResultTab = ref('pool')

// ============ 合轴率调节弹窗 ============

const showComboAlignModal = ref(false)

/** 获取某角色某招式的合轴率（百分比形式 0-1） */
function getComboAlignRatio(slot: number, moveId: string): number {
  return configStore.getComboAlignOverride(slot, moveId, 0)
}

/** 设置某角色某招式的合轴率 */
function setComboAlignRatio(slot: number, moveId: string, ratio: number) {
  configStore.setComboAlignOverride(slot, moveId, ratio)
}

/** 计算某角色的总合轴时间 */
function getTotalComboAlignTime(charResult: CharacterResourceResult): number {
  return charResult.executions.reduce((sum, exec) => {
    const ratio = getComboAlignRatio(charResult.slot, exec.moveId)
    return sum + exec.totalTime * ratio
  }, 0)
}
</script>

<style scoped>
.result-page {
  width: 100%;
  min-height: 400px;
}

.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 60px 40px;
}

.placeholder-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--wa-500);
}

.placeholder-desc {
  font-size: 14px;
  color: var(--wa-300);
}

.global-config-card {
  margin-bottom: 16px;
  background: var(--wa-20);
}

.param-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.param-label {
  font-size: 12px;
  color: var(--wa-500);
}

.result-summary {
  margin-bottom: 16px;
}

.result-tabs {
  margin-top: 4px;
}

.pool-summary-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}

@media (max-width: 1200px) {
  .pool-summary-row {
    grid-template-columns: 1fr;
  }
}

.pool-summary-card {
  background: var(--wa-20);
}

.pool-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--wa-800);
}

.pool-summary-body {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pool-stat {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 2px 0;
}

.pool-stat-label {
  color: var(--wa-500);
  min-width: 80px;
}

.pool-stat-value {
  color: var(--wa-900);
  font-weight: 600;
}

.pool-stat-value.dim {
  color: var(--wa-450);
  font-weight: 400;
  font-size: 12px;
}

.pool-stat-detail {
  color: var(--wa-300);
  font-size: 11px;
  margin-left: auto;
}

.pool-stat.highlight .pool-stat-value {
  color: var(--c-warning);
  font-size: 14px;
}

.pool-stat.bonus .pool-stat-value {
  color: var(--c-success);
  font-weight: 700;
}

/* 时间留白/账本虚高/超预算/未收敛：留白类告警用 danger（与 .highlight 的 warning 区分
   ——warning = 引擎关键量，danger = 口径异常需要人看） */
.pool-stat.danger .pool-stat-value {
  color: var(--c-danger);
  font-size: 14px;
  font-weight: 700;
}

.pool-coverage-section {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--wa-60);
}

.pool-subtitle {
  font-size: 12px;
  font-weight: 600;
  color: var(--wa-500);
  margin-bottom: 4px;
}

.pool-per-slot {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--wa-60);
}

.slot-chip {
  font-size: 11px;
  color: var(--wa-400);
  background: var(--wa-40);
  padding: 2px 8px;
  border-radius: 3px;
}

.event-table-wrap {
  overflow-x: auto;
}

.event-table-wrap.expanded {
  max-height: none;
  overflow: visible;
}

.anomaly-event-card {
  grid-column: 1 / -1;
}

.event-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}

.event-table th,
.event-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--wa-60);
  vertical-align: top;
}

.event-table th {
  position: sticky;
  top: 0;
  background: var(--app-tablehead-bg);
  text-align: left;
  color: var(--wa-550);
  font-weight: 600;
}

.event-name,
.event-count {
  color: #f0a020;
  font-weight: 700;
  white-space: nowrap;
}

.event-formula,
.event-fields {
  font-family: Consolas, monospace;
  color: var(--wa-620);
  line-height: 1.55;
}

.event-note {
  margin-top: 3px;
  color: var(--wa-360);
}


.damage-pool-card {
  margin-bottom: 16px;
  background: var(--wa-30);
}

.damage-pool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.damage-pool-total {
  color: #fbbf24;
  font-size: 13px;
  font-weight: 700;
}

.damage-pool-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.damage-pool-row {
  display: grid;
  grid-template-columns: 88px 58px minmax(140px, 1fr) minmax(180px, 1.2fr) 64px 92px 104px minmax(180px, 1.2fr);
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--wa-35);
  color: var(--wa-760);
  font-size: 12px;
}

.damage-pool-head {
  background: var(--wa-70);
  color: var(--wa-520);
  font-weight: 600;
}

/* 伤害来源分解行：复用 damage-pool-row 视觉，仅覆盖 6 列布局 */
.damage-source-row {
  grid-template-columns: 88px 58px 110px 120px 110px 130px;
}

.damage-source-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.damage-type {
  color: #93c5fd;
  font-weight: 600;
}

.damage-name {
  color: var(--wa-900);
}

.damage-total {
  color: #fbbf24;
  font-weight: 700;
}

.damage-note {
  color: var(--wa-520);
  line-height: 1.45;
}

.card-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

@media (max-width: 1200px) {
  
.damage-pool-card {
  margin-bottom: 16px;
  background: var(--wa-30);
}

.damage-pool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.damage-pool-total {
  color: #fbbf24;
  font-size: 13px;
  font-weight: 700;
}

.damage-pool-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.damage-pool-row {
  display: grid;
  grid-template-columns: 88px 58px minmax(140px, 1fr) minmax(180px, 1.2fr) 64px 92px 104px minmax(180px, 1.2fr);
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--wa-35);
  color: var(--wa-760);
  font-size: 12px;
}

.damage-pool-head {
  background: var(--wa-70);
  color: var(--wa-520);
  font-weight: 600;
}

.damage-type {
  color: #93c5fd;
  font-weight: 600;
}

.damage-name {
  color: var(--wa-900);
}

.damage-total {
  color: #fbbf24;
  font-weight: 700;
}

.damage-note {
  color: var(--wa-520);
  line-height: 1.45;
}

.card-row {
    grid-template-columns: 1fr;
  }
}

/* 合轴率调节 */
.combo-align-btn-row {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}

.combo-align-modal-body {
  max-height: 60vh;
  overflow-y: auto;
}

.combo-align-exec-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.combo-align-exec-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  background: var(--wa-30);
  border-radius: 6px;
}

.combo-align-exec-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 180px;
}

.combo-align-exec-name {
  font-size: 13px;
  color: var(--wa-900);
  font-weight: 500;
}

.combo-align-exec-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.combo-align-time-display {
  font-size: 11px;
  color: rgba(82, 196, 26, 0.8);
  min-width: 80px;
  text-align: right;
}

.combo-align-summary {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--wa-60);
}

.damage-share-card {
  background: var(--wa-30);
}

.damage-share-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  margin-bottom: 10px;
  border-radius: 6px;
  background: var(--wa-40);
  color: var(--wa-620);
}

.damage-share-summary b {
  color: #fbbf24;
  font-size: 18px;
}

.share-category-row,
.share-character-cats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.share-category-chip,
.share-character-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  background: var(--wa-40);
  color: var(--wa-700);
  font-size: 12px;
}

.share-category-chip b {
  color: var(--app-text-solid);
}

.share-character {
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--wa-25);
}

.share-character-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  color: var(--wa-900);
  font-weight: 600;
}

.share-character-head b {
  color: #fbbf24;
}

.share-note {
  margin-top: 10px;
  color: var(--wa-450);
  font-size: 12px;
}

.team-overview-card {
  background: var(--wa-30);
}

.team-overview-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.team-overview-row {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr 1fr 0.8fr 0.8fr 0.8fr;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--wa-30);
  color: var(--wa-820);
  font-size: 12px;
}

.team-overview-head {
  background: var(--wa-70);
  color: var(--wa-500);
  font-weight: 600;
}

.virtual-panel-card {
  background: var(--wa-30);
}

.virtual-panel-block {
  margin-bottom: 12px;
}

.virtual-panel-title {
  margin-bottom: 8px;
  color: var(--wa-850);
  font-weight: 600;
}

.virtual-panel-table {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.virtual-panel-row {
  display: grid;
  grid-template-columns: 1.2fr 0.9fr 0.7fr 0.9fr 0.8fr 0.8fr 0.9fr 0.8fr 0.8fr;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 5px;
  background: var(--wa-30);
  color: var(--wa-780);
  font-size: 12px;
}

.virtual-panel-head {
  background: var(--wa-70);
  color: var(--wa-500);
  font-weight: 600;
}

.virtual-panel-virtual {
  background: rgba(251, 191, 36, 0.08);
  color: #fbbf24;
  font-weight: 700;
}
</style>
