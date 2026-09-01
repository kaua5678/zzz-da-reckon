<template>
  <n-card size="small" :bordered="true">
    <template #header>
      <n-space align="center" justify="space-between" style="width: 100%">
        <span>Boss 选择</span>
        <n-space size="small">
          <!-- 大版本 + 小版本 + 危局期数三级选择（1.4–3.2 全部 Boss 数据支撑） -->
          <n-select
            v-model:value="selectedMajor"
            :options="majorVersionOptions"
            size="small"
            style="width: 72px"
            placeholder="大版本"
          />
          <n-select
            v-model:value="selectedMinor"
            :options="minorVersionOptions"
            size="small"
            style="width: 62px"
            placeholder="小版本"
          />
          <n-select
            v-model:value="selectedPhaseId"
            :options="periodOptions"
            size="small"
            style="width: 210px"
            placeholder="期数"
          />
          <n-button
            v-if="configStore.appliedBoss"
            size="tiny"
            @click="configStore.clearBossPreset()"
          >
            清除已选
          </n-button>
        </n-space>
      </n-space>
    </template>

    <div v-if="loading" class="boss-loading">Boss 数据加载中...</div>
    <div v-else-if="error" class="boss-error">加载失败：{{ error }}</div>
    <div v-else-if="!view" class="boss-empty">
      当前选中期数无视图数据 —— 请从顶部大版本/小版本/期数下拉选择其他期
    </div>

    <template v-else>
      <!-- 困难：危局强袭战 1 个 Boss（1.4–3.0 无困难模式 → 整块隐藏） -->
      <template v-if="caBoss">
        <div class="mode-title">
          <n-tag type="warning" size="small" :bordered="false">困难</n-tag>
          <span>危局强袭战 · {{ view.label }}</span>
          <n-tag v-if="viewTestOnly" size="tiny" type="default" :bordered="false">测试服数据</n-tag>
        </div>
        <div class="ca-row">
          <BossCard
            :brief="caBoss"
            :preset="caPreset"
            :applied="isApplied(caBoss)"
            @apply="applyBoss(caBoss)"
          />
          <div class="phase-note">一键填充：血量/失衡/防御/等级/危局异常系数/失衡倍率/失衡时间 + 三张抗性表 + 战斗时间/秽盾/能量盾/无敌时间；声明弹刀总数的 Boss 自动勾选「保底4失衡」（击破位弹刀反推、主C 拿剩余）</div>
        </div>
      </template>

      <!-- 普通：同样是危局强袭战，当期 3 个，可应用 -->
      <div class="mode-section">
        <div class="mode-title">
          <n-tag type="info" size="small" :bordered="false">普通</n-tag>
          <span>危局强袭战 · 当期 {{ view.defense.length }} 个</span>
        </div>
        <div class="defense-grid">
          <BossCard
            v-for="d in view.defense"
            :key="d.monsterId"
            :brief="d"
            :preset="presetOf(d)"
            :applied="isApplied(d)"
            compact
            @apply="applyBoss(d)"
          />
        </div>
      </div>

      <!-- 当期 buff（可选牌，推荐/应用在「队伍对比」页） -->
      <div class="mode-section">
        <div class="mode-title">
          <n-tag type="primary" size="small" :bordered="false">当期 Buff</n-tag>
          <span>危局可选牌 × {{ view.buffs.length }}（推荐/应用在「队伍对比」页）</span>
        </div>
        <div class="buff-grid">
          <div v-for="b in view.buffs" :key="b.title" class="buff-card" :class="{ test: b.testOnly }">
            <div class="buff-title">
              {{ b.title || '(未命名)' }}
              <n-tag v-if="b.testOnly" size="tiny" type="default" :bordered="false">测试服</n-tag>
            </div>
            <div class="buff-effects">
              <span v-for="(e, i) in b.effects" :key="i" class="effect-tag">{{ effectLabel(e) }}</span>
              <span v-for="(u, i) in b.unparsed" :key="'u' + i" class="effect-tag unparsed" :title="u">未解析：{{ u.slice(0, 24) }}…</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 全部 Boss（按期分组折叠） -->
      <n-collapse class="all-bosses">
        <n-collapse-item title="全部 Boss（{{ bosses.length }} 个，按模式分组）" name="all">
          <div class="all-boss-groups">
            <div v-for="group in bossGroups" :key="group.label" class="all-group">
              <div class="all-group-label">{{ group.label }}</div>
              <div class="all-boss-grid">
                <div
                  v-for="b in group.list"
                  :key="b.id"
                  class="all-boss-chip"
                  :class="{ 'no-view': !hasViewPhase(b) }"
                  :title="hasViewPhase(b) ? b.name : b.name + '（当期视图无此 Boss 期数）'"
                  @click="jumpToBoss(b)"
                >
                  <span v-if="b.isCriticalAssault" class="chip-dot ca-dot"></span>
                  <span v-else class="chip-dot"></span>
                  {{ b.name }}
                  <span v-if="!hasViewPhase(b)" class="chip-no-view">无当期数据</span>
                </div>
              </div>
            </div>
          </div>
        </n-collapse-item>
      </n-collapse>
    </template>
  </n-card>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NCard, NSpace, NSelect, NButton, NTag, NCollapse, NCollapseItem } from 'naive-ui'
import { useConfigStore } from '@/stores/config'
import { applyBossLayerBuffs } from '@/composables/runArchiveDeploy'
import BossCard from './BossCard.vue'
import type { BossPreset, BossPresetFile, BossPresetPhase, PhaseBossBrief, PhaseBuffEffect, PhaseView } from '@/types/bossPreset'

const configStore = useConfigStore()

const loading = ref(true)
const error = ref('')
const presets = ref<BossPreset[]>([])
const phaseViews = ref<PhaseView[]>([])
const selectedMajor = ref('')
const selectedMinor = ref('')
const selectedPhaseId = ref('')

onMounted(async () => {
  try {
    const res = await fetch('/static/boss-presets.json')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as BossPresetFile
    presets.value = data.bosses ?? []
    phaseViews.value = data.phaseViews ?? []
    // 默认选最新期（从所有 Boss phases 数据中取最新；覆盖 1.4–3.2）
    const sorted = allPhases.value
    if (sorted.length > 0) {
      const latest = sorted[0]
      const parts = latest.version.split('.')
      selectedMajor.value = parts[0]
      selectedMinor.value = parts[1]
      selectedPhaseId.value = latest.phaseId
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})

// ========== 大版本 + 小版本 + 期数三级选择（从全部 Boss phases 数据构建） ==========
/** 从所有 Boss 的 phases 收集唯一期数，覆盖 1.4–3.2 */
const allPhases = computed(() => {
  const seen = new Set<string>()
  const phases: BossPresetPhase[] = []
  for (const b of presets.value) {
    for (const p of b.phases) {
      if (!seen.has(p.phaseId)) {
        seen.add(p.phaseId)
        phases.push(p)
      }
    }
  }
  return phases.sort((a, b) => b.begin.localeCompare(a.begin))
})

const majorVersionOptions = computed(() => {
  const majors = [...new Set(allPhases.value.map(p => p.version.split('.')[0]))]
  return majors.sort((a, b) => parseInt(b) - parseInt(a)).map(v => ({ value: v, label: `v${v}` }))
})

const minorVersionOptions = computed(() => {
  if (!selectedMajor.value) return []
  const minors = [...new Set(
    allPhases.value
      .filter(p => p.version.startsWith(selectedMajor.value + '.'))
      .map(p => p.version.split('.')[1])
  )]
  return minors.sort((a, b) => parseInt(b) - parseInt(a)).map(v => ({ value: v, label: `.${v}` }))
})

const fullVersion = computed(() => {
  if (!selectedMajor.value || !selectedMinor.value) return ''
  return `${selectedMajor.value}.${selectedMinor.value}`
})

const periodOptions = computed(() => {
  if (!fullVersion.value) return []
  return allPhases.value
    .filter(p => p.version === fullVersion.value)
    .map(p => {
      const periodNum = p.phaseId.slice(3, 5) // 从 phaseId 提取危局期数（如 690451 → 45）
      const date = (p.begin || '').slice(0, 10) // YYYY-MM-DD
      return {
        value: p.phaseId,
        label: `${periodNum}期 ${date}`,
        // 按 begin 降序（最新在前）
      }
    })
    .sort((a, b) => b.value.localeCompare(a.value))
})

watch(selectedMajor, (major) => {
  if (!major) { selectedMinor.value = ''; selectedPhaseId.value = ''; return }
  // 大版本切换 → 重置小版本和期数，自动选该大版本下最新小版本
  selectedMinor.value = ''
  selectedPhaseId.value = ''
  const versions = [...new Set(
    allPhases.value.filter(p => p.version.startsWith(major + '.')).map(p => p.version)
  )].sort().reverse()
  if (versions.length > 0) {
    const parts = versions[0].split('.')
    selectedMinor.value = parts[1]
  }
})

watch(selectedMinor, (minor) => {
  if (!minor || !selectedMajor.value) { selectedPhaseId.value = ''; return }
  // 小版本切换 → 重置期数，自动选该版本下最新期
  selectedPhaseId.value = ''
  const ver = `${selectedMajor.value}.${minor}`
  const phases = allPhases.value.filter(p => p.version === ver).sort((a, b) => b.begin.localeCompare(a.begin))
  if (phases.length > 0) {
    selectedPhaseId.value = phases[0].phaseId
  }
})

const view = computed(() => phaseViews.value.find(v => v.phaseId === selectedPhaseId.value) ?? null)
const viewTestOnly = computed(() => view.value?.buffs.some(b => b.testOnly) ?? false)

const caBoss = computed(() => view.value?.criticalAssault ?? null)
const caPreset = computed(() => {
  const id = caBoss.value?.presetId
  return id ? presets.value.find(p => p.id === id) ?? null : null
})

function presetOf(brief: PhaseBossBrief): BossPreset | null {
  return brief.presetId ? presets.value.find(p => p.id === brief.presetId) ?? null : null
}

function isApplied(brief: PhaseBossBrief): boolean {
  const a = configStore.appliedBoss
  return a !== null && a.presetId === brief.presetId
}

/** 应用 Boss：填敌人配置 + 把该 Boss 当期关卡固有 buff（layer_buff 数值效果）写入全局 Buff 表 */
function applyBoss(brief: PhaseBossBrief) {
  const preset = presetOf(brief)
  const v = view.value
  if (!preset || !v) return
  const phase = preset.phases.find(p => p.phaseId === v.phaseId && p.zoneKey === brief.zoneKey)
  if (!phase) return
  configStore.applyBossPreset({ id: preset.id }, phase, preset.monster, preset.defaults)
  applyBossLayerBuffs(configStore, brief)
}

// ========== 全部 Boss 分组（折叠区） ==========
const bossGroups = computed(() => {
  const ca = presets.value.filter(p => p.isCriticalAssault)
  const rest = presets.value.filter(p => !p.isCriticalAssault)
  return [
    { label: '危局异构（困难）', list: ca },
    { label: '危局常规（普通）', list: rest },
  ].filter(g => g.list.length > 0)
})

function jumpToBoss(boss: BossPreset) {
  // 优先跳转到有 phaseView 的期数，否则跳转到该 Boss 的最新期
  const viewIds = new Set(phaseViews.value.map(v => v.phaseId))
  const target = boss.phases.find(p => p.modeType === 'critical_assault' && viewIds.has(p.phaseId))
    ?? boss.phases.find(p => viewIds.has(p.phaseId))
    ?? boss.phases.sort((a, b) => b.begin.localeCompare(a.begin))[0]
  if (target) {
    const parts = target.version.split('.')
    selectedMajor.value = parts[0]
    selectedMinor.value = parts[1]
    selectedPhaseId.value = target.phaseId
  }
}

/** 该 Boss 是否在期视图里有可显示期数（chip 标注用） */
function hasViewPhase(boss: BossPreset): boolean {
  const viewIds = new Set(phaseViews.value.map(v => v.phaseId))
  return boss.phases.some(p => viewIds.has(p.phaseId))
}

function effectLabel(e: PhaseBuffEffect): string {
  const cond: string[] = []
  if (e.cond?.anomalyCount) cond.push('异常2/3名')
  if (e.cond?.specialty) cond.push(`${e.cond.specialty}限定`)
  const unit = e.stat === 'anomalyProficiency' ? '点' : '%'
  const parts = [statLabelOf(e.stat), `+${e.value}${unit}`]
  if (e.targetSkillType) parts.push(`→${e.targetSkillType}`)
  if (cond.length) parts.push(`[${cond.join('，')}]`)
  return parts.join(' ')
}

const STAT_LABELS: Record<string, string> = {
  critDmg: '暴伤', atkPct: '攻击%', anomalyProficiency: '精通',
  anomalyDmgBonus: '异常伤', anomalyBuildUpEfficiency: '积蓄效率',
  enemyResReduction: '全减抗', enemyDefReduction: '减防',
  stunDmgMultiplierBonus: '失衡易伤', enemyDamageTakenBonus: '易伤',
  sheerDmgBonus: '贯穿伤', sharpDmgBonus: '锐化伤', sharpCritDmg: '锐暴', penRatio: '穿透率',
  defPct: '防御%', hpPct: '生命%', stunBuildUpBonus: '失衡值', skillDmgBonus: '招式伤',
}
const EL_ZH: Record<string, string> = { physical: '物理', fire: '火', ice: '冰', electric: '电', ether: '以太', wind: '风' }
function statLabelOf(stat: string): string {
  if (STAT_LABELS[stat]) return STAT_LABELS[stat]
  const el = stat.match(/^(physical|fire|ice|electric|ether|wind)Dmg$/)
  if (el) return `${EL_ZH[el[1]]}伤`
  const res = stat.match(/^enemy(Physical|Fire|Ice|Electric|Ether|Wind)ResReduction$/)
  if (res) return `${EL_ZH[res[1].toLowerCase()]}减抗`
  return stat
}
</script>

<style scoped>
.boss-loading,
.boss-error,
.boss-empty {
  padding: 12px;
  font-size: 12px;
  color: var(--wa-600);
}

.boss-error {
  color: #e88080;
}

.mode-section {
  margin-bottom: 14px;
}

.mode-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--wa-750);
  margin-bottom: 8px;
}

.ca-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.phase-note {
  font-size: 11px;
  color: var(--wa-400);
}

.defense-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 8px;
}

.buff-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 8px;
}

.buff-card {
  border: 1px solid var(--wa-80);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.buff-card.test {
  opacity: 0.55;
}

.buff-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
}

.buff-effects {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.effect-tag {
  font-size: 11px;
  background: rgba(99, 226, 183, 0.12);
  color: #63e2b7;
  border-radius: 3px;
  padding: 1px 5px;
}

.effect-tag.unparsed {
  background: rgba(230, 180, 100, 0.1);
  color: #e6b464;
}

.all-bosses {
  margin-top: 4px;
}

.all-boss-groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.all-group-label {
  font-size: 11px;
  color: var(--wa-500);
  margin-bottom: 4px;
}

.all-boss-grid {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.all-boss-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  border: 1px solid var(--wa-100);
  border-radius: 10px;
  padding: 2px 8px;
  cursor: pointer;
  color: var(--wa-750);
}

.all-boss-chip:hover {
  border-color: #63e2b7;
}

.all-boss-chip.no-view {
  opacity: 0.45;
}

.chip-no-view {
  font-size: 10px;
  color: var(--wa-500);
}

.chip-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #63b3ed;
}

.chip-dot.ca-dot {
  background: #f6ad55;
}
</style>
