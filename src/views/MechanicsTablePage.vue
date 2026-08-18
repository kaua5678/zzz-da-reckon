<template>
  <div class="mechanics-page">
    <div class="page-head">
      <div class="page-title">角色机制表</div>
      <div class="page-subtitle">数据源：src/specs/agents/*.json，展示属性 Buff / 特殊资源 / 招式释放（详细备注可展开）</div>
    </div>

    <n-space :size="12" class="agent-bar">
      <n-select
        v-model:value="selectedAgentId"
        :options="agentOptions"
        filterable
        clearable
        placeholder="筛选角色"
        style="width: 220px"
      />
      <n-input v-model:value="keyword" clearable placeholder="搜索机制文本" style="width: 260px" />
      <n-switch v-model:value="showNotes" size="small">
        <template #checked>显示详细备注</template>
        <template #unchecked>显示详细备注</template>
      </n-switch>
    </n-space>

    <div v-if="visibleSpecs.length === 0" class="empty-box">暂无匹配的机制数据</div>

    <div v-for="spec in visibleSpecs" :key="spec.id" class="mech-card">
      <div class="mech-head">
        <span class="mech-name">{{ spec.name }}</span>
        <span class="mech-id">{{ spec.agentIds.join(' / ') }}</span>
        <n-tag size="small" :bordered="false" :type="statusType(spec.status)">
          {{ statusLabel(spec.status) }}
        </n-tag>
      </div>

      <div class="mech-body">
        <div v-if="teamBuffRows(spec).length > 0" class="mech-section">
          <div class="section-title">局内拐力（Buff / 减益，覆盖率默认满覆盖）</div>
          <table class="mech-table">
            <thead>
              <tr>
                <th>来源</th>
                <th>名称</th>
                <th>对象</th>
                <th>效果</th>
                <th>覆盖率</th>
                <th>文本</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="buff in teamBuffRows(spec)" :key="buff.id">
                <td>{{ buff.source }}</td>
                <td>{{ buff.name }}</td>
                <td>{{ buff.targetLabel }}</td>
                <td>{{ buff.effectsText || '-' }}</td>
                <td>{{ buff.coverageLabel }}</td>
                <td>{{ buff.description }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="spec.attributeConversions.length > 0" class="mech-section">
          <div class="section-title">属性 Buff（转模）</div>
          <table class="mech-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>来源</th>
                <th>阈值</th>
                <th>步长</th>
                <th>目标</th>
                <th>每步值</th>
                <th>上限</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="conv in spec.attributeConversions" :key="conv.id">
                <td>{{ conv.name }}</td>
                <td>{{ conv.sourceStat }}</td>
                <td>{{ conv.threshold }}</td>
                <td>{{ conv.stepSize }}</td>
                <td>{{ conv.targetStat }}</td>
                <td>{{ conv.valuePerStep }}</td>
                <td>{{ conv.cap ?? '-' }}</td>
                <td>{{ conv.note }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="spec.resources.length > 0" class="mech-section">
          <div class="section-title">特殊资源（回复 / 消耗 / 收益）</div>
          <table class="mech-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>性质</th>
                <th>初始</th>
                <th>获取</th>
                <th>消耗</th>
                <th>属性</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="res in spec.resources" :key="res.id">
                <td>{{ res.name }}</td>
                <td>{{ res.nature }}</td>
                <td>{{ res.initialValue ?? 0 }}</td>
                <td>
                  <div v-for="(rule, i) in res.gainRules" :key="i" class="rule-line">
                    {{ rule.trigger }}<span v-if="rule.amount != null">：{{ rule.amount }}</span>
                  </div>
                </td>
                <td>
                  <div v-for="(rule, i) in res.spendRules" :key="i" class="rule-line">
                    {{ rule.trigger }}<span v-if="rule.cost != null">：{{ rule.cost }}</span>
                  </div>
                </td>
                <td>
                  <span v-for="(value, key, i) in res.properties" :key="key" class="prop-line">
                    {{ key }}={{ value }}<span v-if="i < Object.keys(res.properties).length - 1">，</span>
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="spec.events.length > 0" class="mech-section">
          <div class="section-title">招式释放（特殊资源触发）</div>
          <table class="mech-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>触发</th>
                <th>类型</th>
                <th>载体招式</th>
                <th>倍率行 / 系数</th>
                <th>次数来源</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="event in spec.events" :key="event.id">
                <td>{{ event.name }}</td>
                <td>{{ event.trigger }}</td>
                <td>{{ event.executionKind ?? 'anomaly' }}</td>
                <td>{{ event.carrierMoveId || event.carrierField || '-' }}</td>
                <td>{{ event.multiplierRowId ?? 'damage' }}<span v-if="event.multiplierRatio != null"> × {{ event.multiplierRatio }}</span></td>
                <td>{{ event.countField || event.countSource || 'fixed' }}</td>
                <td>{{ event.note }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="showNotes && spec.notes.length > 0" class="mech-section">
          <div class="section-title">逻辑说明（防止文本遗漏）</div>
          <ul class="note-list">
            <li v-for="(note, i) in spec.notes" :key="i">{{ note }}</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NInput, NSelect, NSpace, NSwitch, NTag } from 'naive-ui'
import { agentSpecs } from '@/specs/registry'
import type { AgentMechanicSpec } from '@/specs/types'
import { useCatalogStore } from '@/stores/catalog'

const catalogStore = useCatalogStore()
const selectedAgentId = ref<string | null>(null)
const keyword = ref('')
const showNotes = ref(false)

interface DisplayTeamBuff {
  id: string
  name: string
  source: string
  description: string
  targetLabel: string
  coverageLabel: string
  effectsText: string
}

onMounted(() => {
  void catalogStore.loadTeammateBuffs()
})

const agentOptions = computed(() =>
  agentSpecs.map(spec => ({
    label: `${spec.name}（${spec.agentIds.join('/')}）`,
    value: spec.id,
  })),
)

const visibleSpecs = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return agentSpecs.filter(spec => {
    if (selectedAgentId.value && spec.id !== selectedAgentId.value) return false
    if (!kw) return true
    const text = [
      spec.name,
      ...spec.agentIds,
      ...spec.notes,
      ...spec.resources.map(r => `${r.name} ${JSON.stringify(r)}`),
      ...spec.events.map(e => `${e.name} ${e.trigger} ${e.note ?? ''}`),
      ...spec.attributeConversions.map(c => `${c.name} ${c.note}`),
      ...teamBuffRows(spec).map(b => `${b.name} ${b.source} ${b.description} ${b.effectsText}`),
    ].join(' ').toLowerCase()
    return text.includes(kw)
  })
})

function catalogGroupForSpec(spec: AgentMechanicSpec) {
  for (const agentId of spec.agentIds) {
    const agent = catalogStore.getAgent(agentId)
    const key = agent?.teammateBuffId ?? agentId
    const group = catalogStore.teammateBuffGroups.find(item => item.id === key)
    if (group) return group
  }
  return null
}

function formatEffect(effect: { stat: string; value?: number; mode?: string; sourceStat?: string; targetSkillType?: string; formula?: { expression?: string } }): string {
  const target = effect.targetSkillType ? `[${effect.targetSkillType}]` : ''
  if (effect.formula?.expression) {
    return `${effect.stat}${target} = ${effect.formula.expression}`
  }
  if (effect.value != null) {
    return `${effect.stat}${target} +${effect.value}${effect.mode === 'pct' ? '%' : ''}`
  }
  if (effect.sourceStat) {
    return `${effect.stat}${target}（来源 ${effect.sourceStat}）`
  }
  return `${effect.stat}${target}`
}

function teamBuffRows(spec: AgentMechanicSpec): DisplayTeamBuff[] {
  const rows: DisplayTeamBuff[] = []
  for (const buff of spec.teamBuffs ?? []) {
    const coverage = buff.coverage ?? 1
    rows.push({
      id: buff.id,
      name: buff.name,
      source: buff.source,
      description: buff.description,
      targetLabel: buff.target === 'enemy' ? '敌人减益' : buff.target === 'both' ? '全队+敌人' : '全队/队友',
      coverageLabel: `${Math.round(coverage * 100)}%`,
      effectsText: buff.effects.map(formatEffect).join('；'),
    })
  }

  const group = catalogGroupForSpec(spec)
  for (const buff of group?.buffs ?? []) {
    const effectsText = (buff.effects ?? []).map(formatEffect).join('；')
    const coverageValues = (buff.effects ?? []).map(effect => effect.coverage?.default ?? 1)
    const coverage = coverageValues.length > 0 ? Math.min(...coverageValues) : 1
    rows.push({
      id: buff.id,
      name: buff.name?.zhCN ?? buff.name?.en ?? buff.id,
      source: buff.source?.zhCN ?? buff.source?.en ?? buff.sourceLabel?.zhCN ?? '',
      description: buff.description?.zhCN ?? buff.description?.en ?? buff.conditionLabel?.zhCN ?? '',
      targetLabel: '全队/队友',
      coverageLabel: `${Math.round(coverage * 100)}%`,
      effectsText,
    })
  }
  return rows
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    implemented: '已实现',
    implemented_approximation: '已实现（近似）',
    partially_implemented: '部分实现',
    not_described_not_implemented: '未实现',
  }
  return map[status] ?? status
}

function statusType(status: string): 'success' | 'warning' | 'info' | 'default' {
  if (status === 'implemented' || status === 'implemented_approximation') return 'success'
  if (status === 'partially_implemented') return 'warning'
  return 'default'
}
</script>

<style scoped>
.mechanics-page {
  padding: 16px 24px;
}

.page-head {
  margin-bottom: 12px;
}

.page-title {
  font-size: 18px;
  font-weight: 700;
  color: #fff;
}

.page-subtitle {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.45);
  margin-top: 2px;
}

.agent-bar {
  margin-bottom: 16px;
}

.mech-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  margin-bottom: 16px;
  overflow: hidden;
}

.mech-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.mech-name {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
}

.mech-id {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

.mech-body {
  padding: 12px 14px;
}

.mech-section {
  margin-bottom: 14px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: #a78bfa;
  margin-bottom: 8px;
}

.mech-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.mech-table th,
.mech-table td {
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 6px 8px;
  color: rgba(255, 255, 255, 0.75);
  vertical-align: top;
  text-align: left;
}

.mech-table th {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.55);
  font-weight: 600;
}

.rule-line,
.prop-line {
  display: block;
}

.note-list {
  margin: 0;
  padding-left: 18px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  line-height: 1.7;
}

.note-list li {
  margin-bottom: 4px;
}

.empty-box {
  padding: 40px;
  text-align: center;
  color: rgba(255, 255, 255, 0.4);
}
</style>
