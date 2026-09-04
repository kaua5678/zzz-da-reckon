<template>
  <div class="team-compare-page">
    <!-- 控制面板 -->
    <n-card size="small" :bordered="true">
      <div class="compare-controls">
        <div class="ctl-field">
          <span class="ctl-label">期数</span>
          <n-select
            v-model:value="selectedPeriodId"
            :options="periodOptions"
            size="small"
            filterable
            style="width: 240px"
            placeholder="先选期数"
          />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">Boss</span>
          <n-select
            v-model:value="selectedBossId"
            :options="bossOptionsForPeriod"
            size="small"
            filterable
            style="width: 260px"
            placeholder="再选该期 Boss"
          />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">预设队伍</span>
          <n-select
            v-model:value="presetGroupSel"
            :options="presetGroupOptionsC"
            size="small"
            style="width: 100px"
            placeholder="职业"
            title="一级分类：先选职业（命破/异常/强攻/击破/支援…），再选属性，最后出队伍"
          />
          <n-select
            v-model:value="presetSubSel"
            :options="presetSubOptions"
            size="small"
            style="width: 100px"
            placeholder="属性"
            title="二级分类：该职业下的属性/体系（如 强攻队·电）"
          />
          <n-select
            v-model:value="selectedPresetIds"
            :options="presetFilteredOptions"
            size="small"
            multiple
            filterable
            style="width: 220px"
            placeholder="选择队伍（可多选）"
          />
          <n-select
            v-model:value="quickPickMainC"
            :options="mainCQuickOptions"
            size="small"
            style="width: 130px"
            placeholder="按主C快选"
            title="选择主C → 勾选替换为仅含该主C的队伍（其他主C的队伍移除）"
            clearable
          />
        </div>
        <div class="ctl-field">
          <span class="ctl-label">限定金</span>
          <n-input-number v-model:value="goldMin" size="small" :min="0" :max="20" style="width: 70px" />
          <span class="ctl-sep">~</span>
          <n-input-number v-model:value="goldMax" size="small" :min="0" :max="20" style="width: 70px" />
        </div>
        <div class="ctl-field" title="≤12金：自动逐金挑选伤害提升最大的加金组合（含专武本体购买，贪婪搜索，每队多算几轮全量伤害，较慢）；12金以上仍按预设 goldSteps 顺序">
          <n-checkbox v-model:checked="optimalGold" size="small">最优加金（≤12金）</n-checkbox>
        </div>
        <div class="ctl-field" title="未穿限定音擎的槽位自动从下方装填池按伤害择优穿戴；选中的限定音擎按本体（精炼1）如实计入总限定金——有金就是金。预设 wEngines 仅限定音擎保留。关闭则回退预设基础音擎">
          <n-checkbox v-model:checked="autoEngine" size="small">自动下位</n-checkbox>
        </div>
        <template v-if="autoEngine">
          <div class="ctl-field" title="自动下位音擎的默认精炼档：A 级 / 常驻 S">
            <span class="ctl-label">下位精炼 A/常驻</span>
            <n-input-number v-model:value="autoModA" size="small" :min="1" :max="5" style="width: 56px" />
            <span class="ctl-sep">/</span>
            <n-input-number v-model:value="autoModStd" size="small" :min="1" :max="5" style="width: 56px" />
          </div>
          <div class="ctl-field" title="自动下位只在池内试算择优（避免全目录遍历过慢）；池内限定音擎按本体精炼1参与，选中即计金。配置持久化在浏览器本地">
            <span class="ctl-label">下位装填池</span>
            <n-select
              v-model:value="autoEnginePool"
              :options="enginePoolOptions"
              size="small"
              multiple
              filterable
              style="width: 260px"
              placeholder="候选音擎"
            />
          </div>
        </template>
        <div class="ctl-field">
          <span class="ctl-label">当期 Buff</span>
          <n-select
            v-model:value="buffChoice"
            :options="buffOptions"
            size="small"
            style="width: 200px"
            placeholder="自动推荐"
          />
        </div>
        <n-button type="primary" size="small" :loading="computing" @click="runCompare">计算</n-button>
      </div>

      <!-- 进度 -->
      <div v-if="computing && progress" class="progress-bar">
        <div class="progress-fill" :style="{ width: progress.pct * 100 + '%' }"></div>
        <span class="progress-text">{{ progress.text }}</span>
      </div>

      <div v-if="!computing && points.length > 0" class="compare-note">
        共 {{ points.length }} 个点 · 纵轴 = 伤害/血量%（100% 击杀线）· 横轴 = 操作难度（交互加权和 + 合轴溢出秒）· 点半径 = 限定金
      </div>

      <div v-if="teamPresets.length === 0" class="empty-hint">
        暂无预设队伍 —— 复制 <code>src/data/teamPresets/_template.json</code> 到同目录改名编辑（删掉
        <code>disabled</code> 字段），刷新后自动加载。加金顺序/交互清单说明见文件头注释。
      </div>
      <div v-else-if="bossPresets.length === 0" class="empty-hint">
        Boss 预设数据未加载（运行 <code>node scripts/import-nanoka-bosses.mjs</code> 生成
        <code>public/static/boss-presets.json</code>）。
      </div>
      <div v-else-if="!computing && points.length === 0" class="empty-hint guide-hint">
        已预选最新期数 / 全部队伍 / 限定金区间 —— 点「计算」生成散点图（默认不带当期 buff，可下拉开启）。
        限定金只统计限定 S 角色/音擎（常驻角色如莱卡恩不计）；选择越界自动钳制到队伍档位范围。
        「最优加金（≤12金）」默认开启：≤12金自动逐金挑选伤害提升最大的加金组合（含专武本体购买，贪婪搜索，较慢），12金以上仍按预设 goldSteps 顺序；
        「自动下位」默认开启：未穿限定音擎的槽位从「下位装填池」（默认常驻 S + 预设常用 A 级，可增删）按伤害择优穿戴，A 级默认精炼 5、常驻默认精炼 3 可调，预设 wEngines 仅限定音擎保留；
        限定专武作为加金步（goldSteps 里带 wEngineId 的步骤），如星徽·比利队基础 3 金（3 角色本体、无专武），4 金起在对比里逐步买专武，改完重跑一次对比即可。
      </div>
    </n-card>

    <!-- 散点图 -->
    <n-card v-if="points.length > 0" size="small" :bordered="true" class="chart-card">
      <div class="chart-area">
        <svg :viewBox="viewBox" class="compare-svg">
          <!-- 网格 + y 刻度（SVG 颜色统一 class + 主题变量，var() 在 presentation attribute 上不可靠） -->
          <line v-for="(y, i) in yTicks" :key="'g' + i" :x1="padL" :y1="y" :x2="padL + plotW" :y2="y" class="chart-grid" />
          <text v-for="(y, i) in yTicks" :key="'yt' + i" :x="padL - 6" :y="y + 4" text-anchor="end" class="chart-tick" font-size="10">{{ fmt(yLabel(i), 0) }}%</text>
          <line v-for="(x, i) in xTickPositions" :key="'xg' + i" :x1="x" :y1="padT" :x2="x" :y2="padT + plotH" class="chart-grid-x" />
          <text v-for="(x, i) in xTickPositions" :key="'xt' + i" :x="x" :y="padT + plotH + 16" text-anchor="middle" class="chart-tick" font-size="10">{{ fmt(xTickLabels[i], 1) }}</text>

          <!-- 击杀线 100% + 200% 参考线 -->
          <line :x1="padL" :y1="yOf(100)" :x2="padL + plotW" :y2="yOf(100)" stroke="#e88080" stroke-dasharray="6,4" opacity="0.8" />
          <text :x="padL + 4" :y="yOf(100) - 4" fill="#e88080" font-size="10">击杀线 100%</text>
          <line v-if="yMax > 200" :x1="padL" :y1="yOf(200)" :x2="padL + plotW" :y2="yOf(200)" class="chart-refline" stroke-dasharray="4,4" />
          <text v-if="yMax > 200" :x="padL + 4" :y="yOf(200) - 4" class="chart-refline-text" font-size="10">200% 两倍血量</text>

          <!-- 坐标轴标签 -->
          <text :x="padL + plotW / 2" :y="padT + plotH + 34" text-anchor="middle" class="chart-axis-label" font-size="11">操作难度（交互+合轴溢出）</text>
          <text :x="14" :y="padT + plotH / 2" text-anchor="middle" class="chart-axis-label" font-size="11" transform="rotate(-90 14 0)">伤害/血量 %</text>

          <!-- 散点 -->
          <g v-for="(pt, i) in chartPts" :key="i">
            <circle
              :cx="pt.cx" :cy="pt.cy" :r="pt.r" :fill="pt.color" opacity="0.75"
              class="scatter-dot" stroke-width="0.5"
              @mouseenter="hoverIdx = i" @mouseleave="hoverIdx = -1"
            />
          </g>

          <!-- hover tooltip -->
          <g v-if="hoverIdx >= 0 && chartPts[hoverIdx]">
            <circle :cx="chartPts[hoverIdx].cx" :cy="chartPts[hoverIdx].cy" r="5" class="chart-hover-dot" />
            <rect :x="ttX - 4" :y="ttY - 4" :width="ttW + 8" :height="ttH + 8" rx="3" class="chart-tooltip-box" />
            <text v-for="(line, li) in hoverTips" :key="'tt' + li" :x="ttX" :y="ttY + li * 13" class="chart-tooltip-text" font-size="10">{{ line }}</text>
          </g>
        </svg>

        <!-- 图例 -->
        <div class="chart-legend">
          <span v-for="p in legendPresets" :key="p.id" class="lchip" :style="{ borderColor: p.color }">
            <span class="ldot" :style="{ background: p.color }"></span>{{ p.name }}（{{ p.minGold }}~{{ p.maxGold }}金）
          </span>
        </div>
      </div>
    </n-card>

    <!-- 明细表 -->
    <n-card v-if="points.length > 0" size="small" :bordered="true" class="detail-card">
      <template #header>明细（{{ points.length }} 点）</template>
      <div class="detail-table-wrap">
        <table class="detail-table">
          <thead>
            <tr>
              <th>队伍</th><th>限定金</th><th>Buff</th><th>伤害</th><th>伤害/血量</th>
              <th>难度</th><th>交互明细</th><th>影画</th><th>精炼</th><th>时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(p, i) in points" :key="i" :class="{ 'time-warn': p.timeExceeded }">
              <td class="td-team" :style="{ color: colorOf(p.presetId) }">{{ p.presetName }}</td>
              <td>
                {{ p.goldLabel }}
                <div v-if="p.standardGoldLabel" class="td-standard">{{ p.standardGoldLabel }}</div>
              </td>
              <td class="td-buff">{{ p.buffTitle || '—' }}</td>
              <td>{{ compact(p.damage) }}</td>
              <td :class="{ kill: p.hpRatio >= 100 }">{{ fmt(p.hpRatio, 1) }}%<template v-if="p.hpRatio > 100"><div class="kill-time">≈{{ killSeconds(p.hpRatio) }}s 击杀</div></template></td>
              <td>{{ fmt(p.difficulty, 1) }}</td>
              <td class="td-detail">{{ p.difficultyDetail }}</td>
              <td>{{ p.cinemas.join('/') }}</td>
              <td>{{ p.wengineMods.join('/') }}</td>
              <td :class="{ 'time-ok': !p.timeExceeded, 'time-exceeded': p.timeExceeded }">{{ p.timeDetail }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NCard, NSelect, NInputNumber, NButton, NCheckbox } from 'naive-ui'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { computeTeamComparePoints, DEFAULT_AUTO_ENGINE_POOL, isLimitedWEngine } from '@/composables/teamCompare'
import { teamPresets, presetGroupLabels, presetSubgroupLabelsFor, presetsForFilter, firstNonEmptyFilter } from '@/data/teamPresets'
import { fmt, compact } from '@/utils/format'
import type { BossPreset, BossPresetFile, PhaseView } from '@/types/bossPreset'
import type { TeamComparePoint, TeamPreset } from '@/types/teamPreset'

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
const calc = useResourceCalc()

// ========== Boss 预设 ==========
const bossPresets = ref<BossPreset[]>([])
const phaseViews = ref<PhaseView[]>([])
const selectedPeriodId = ref('')
const selectedBossId = ref('')

onMounted(async () => {
  try {
    const res = await fetch('/static/boss-presets.json')
    if (res.ok) {
      const data = (await res.json()) as BossPresetFile
      bossPresets.value = data.bosses ?? []
      phaseViews.value = data.phaseViews ?? []
      // 默认选最新期数 + 该期第一个 Boss
      const first = allPeriods.value[0]
      if (first) selectedPeriodId.value = first.phaseId
    }
  } catch { /* boss 数据缺失时页面显示引导 */ }
  // 预选全部队伍（不自动计算：计算含 buff 遍历较慢，由用户点「计算」触发）
  selectedPresetIds.value = teamPresets.map(t => t.id)
})

/**
 * 期数优先选择（用户口径）：先选期数，再选该期的 Boss。
 * 期数 = 全部 Boss 期数的并集（新的在前），Boss 下拉只列选中期数里出现过的 Boss。
 */
const allPeriods = computed(() => {
  const map = new Map<string, { phaseId: string; label: string; begin: string; hasCA: boolean }>()
  for (const b of bossPresets.value) {
    for (const ph of b.phases) {
      const cur = map.get(ph.phaseId)
      if (cur) {
        if (ph.modeType === 'critical_assault') cur.hasCA = true
      } else {
        map.set(ph.phaseId, {
          phaseId: ph.phaseId,
          label: ph.label,
          begin: ph.begin,
          hasCA: ph.modeType === 'critical_assault',
        })
      }
    }
  }
  return [...map.values()].sort((a, b) => (b.begin || b.phaseId).localeCompare(a.begin || a.phaseId))
})
const periodOptions = computed(() =>
  allPeriods.value.map(p => ({ value: p.phaseId, label: `${p.label}${p.hasCA ? '（危局）' : ''}` })),
)

/** 选中期数里出现的 Boss（困难优先标注；同 Boss 多关卡去重） */
const bossOptionsForPeriod = computed(() => {
  if (!selectedPeriodId.value) return []
  const out: { value: string; label: string }[] = []
  const seen = new Set<string>()
  for (const b of bossPresets.value) {
    if (seen.has(b.id)) continue
    const phases = b.phases.filter(p => p.phaseId === selectedPeriodId.value)
    if (phases.length === 0) continue
    seen.add(b.id)
    const ph = phases.find(p => p.modeType === 'critical_assault') ?? phases[0]
    out.push({ value: b.id, label: `${b.name}${ph.modeType === 'critical_assault' ? '（困难）' : '（普通）'}` })
  }
  return out
})

watch(selectedPeriodId, () => {
  const opts = bossOptionsForPeriod.value
  if (!opts.some(o => o.value === selectedBossId.value)) {
    selectedBossId.value = opts[0]?.value ?? ''
  }
})

const selectedBoss = computed(() => bossPresets.value.find(b => b.id === selectedBossId.value) ?? null)
const selectedPhase = computed(() => {
  const b = selectedBoss.value
  if (!b) return null
  const phases = b.phases.filter(p => p.phaseId === selectedPeriodId.value)
  return phases.find(p => p.modeType === 'critical_assault') ?? phases[0] ?? b.phases[0] ?? null
})

// ========== 当期 Buff ==========
/** 当前期视图（含 buff 牌） */
const currentPhaseView = computed(() => phaseViews.value.find(v => v.phaseId === selectedPeriodId.value) ?? null)
/** buff 选择：'none' = 不使用（默认，不遍历算得快）/ '' = 自动推荐（每队取三张牌伤害最高）/ 牌名 = 手动 */
const buffChoice = ref<string>('none')
const buffOptions = computed(() => [
  { value: 'none', label: '不使用（默认，快）' },
  { value: '', label: '自动推荐（每队取最优，慢 3 倍）' },
  ...(currentPhaseView.value?.buffs ?? []).map(b => ({
    value: b.title,
    label: `${b.title || '(未命名)'}${b.testOnly ? '（测试服）' : ''}`,
    disabled: b.testOnly,
  })),
])
watch([currentPhaseView], () => {
  // 期数切换后若手动选的 buff 不在当期，回到不使用
  const cur = buffChoice.value
  if (cur && cur !== 'none' && !(currentPhaseView.value?.buffs ?? []).some(b => b.title === cur)) buffChoice.value = 'none'
})

// ========== 预设队伍 ==========
const selectedPresetIds = ref<string[]>([])
/** 两级下拉：一级分类（如 命破队）→ 二级队伍 */
// 三级筛选（2026-09-03 用户：一级下拉装 99+ 条太多——先选职业、再选属性、后出队伍）
// 默认选中第一个职业+属性（用户 2026-09-03：打开即有队伍可选——此前全空像「没下拉框」）
const firstFilter = firstNonEmptyFilter()
const presetGroupSel = ref<string | null>(firstFilter.group)
const presetSubSel = ref<string | null>(firstFilter.subgroup)
const presetGroupOptionsC = presetGroupLabels.map(l => ({ label: l, value: l }))
const presetSubOptions = computed(() =>
  (presetGroupSel.value ? presetSubgroupLabelsFor(presetGroupSel.value) : []).map(l => ({ label: l, value: l })),
)
const presetFilteredOptions = computed(() =>
  presetGroupSel.value && presetSubSel.value
    ? presetsForFilter(presetGroupSel.value, presetSubSel.value).map(t => ({ value: t.id, label: t.name }))
    : [],
)
watch([presetGroupSel, presetSubSel], () => {
  // 换筛选即清空已选（避免选中的队伍不在当前筛选内）
  if (presetGroupSel.value && presetSubSel.value) selectedPresetIds.value = []
})
const selectedPresets = computed<TeamPreset[]>(() =>
  teamPresets.filter(t => selectedPresetIds.value.includes(t.id)),
)
/** 按主C快选：选一个主C → 勾选替换为「仅含该主C的队伍」（其他主C的队伍移除）；清空不影响已选 */
const quickPickMainC = ref<string | null>(null)
const mainCQuickOptions = computed(() => {
  const seen = new Map<string, string>()
  for (const t of teamPresets) {
    const main = t.team[0]
    if (!seen.has(main)) seen.set(main, catalogStore.getAgent(main)?.name.zhCN ?? main)
  }
  return [...seen.entries()].map(([value, label]) => ({ value, label }))
})
watch(quickPickMainC, main => {
  if (!main) return
  selectedPresetIds.value = teamPresets.filter(t => t.team[0] === main).map(t => t.id)
})

// ========== 金数 ==========
const goldMin = ref(0)
const goldMax = ref(6)
/** 最优加金（≤12金）：不用预设排列顺序，逐金挑提升最大的组合；12金以上回退预设顺序 */
const optimalGold = ref(true)
/** 自动下位音擎（缺省开）：非限定槽位从装填池按伤害择优穿戴；选中限定音擎按本体如实计金 */
const autoEngine = ref(true)
/** 自动下位默认精炼档：A 级 / 常驻 S */
const autoModA = ref(5)
const autoModStd = ref(3)
// 装填池：玩家可增删，localStorage 持久化；种子 = 用户准信五件（击破：人为刀俎/燃狱齿轮，辅助：阿炮/逍遥游球/啜泣摇篮）
const AUTO_ENGINE_POOL_KEY = 'zzz-compare-auto-engine-pool'
function loadAutoEnginePool(): string[] {
  try {
    const raw = localStorage.getItem(AUTO_ENGINE_POOL_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        const valid = [...new Set(arr.filter((id: unknown) => typeof id === 'string' && catalogStore.getWEngine(id as string)))] as string[]
        if (valid.length > 0) return valid
      }
    }
  } catch { /* 损坏回落默认 */ }
  return [...DEFAULT_AUTO_ENGINE_POOL]
}
const autoEnginePool = ref<string[]>(loadAutoEnginePool())
watch(autoEnginePool, v => {
  try { localStorage.setItem(AUTO_ENGINE_POOL_KEY, JSON.stringify(v)) } catch { /* 忽略 */ }
}, { deep: true })
const enginePoolOptions = computed(() =>
  (catalogStore.displayWEngines ?? [])
    .map(w => ({
      value: w.id,
      label: `${w.name.zhCN ?? w.name.en ?? w.id}（${w.rarity}${isLimitedWEngine(w.id) ? '·限定' : ''}）`,
    })),
)

// ========== 计算 ==========
const computing = ref(false)
const progress = ref<{ pct: number; text: string } | null>(null)
const points = ref<TeamComparePoint[]>([])

function goldLevels(): number[] {
  const levels: number[] = []
  const min = Math.max(0, Math.min(goldMin.value, goldMax.value))
  const max = Math.max(0, Math.max(goldMin.value, goldMax.value))
  for (let g = min; g <= max; g++) levels.push(g)
  return levels
}

async function runCompare() {
  const presets = selectedPresets.value
  const boss = selectedBoss.value
  const phase = selectedPhase.value
  if (presets.length === 0 || !boss || !phase) return
  computing.value = true
  progress.value = { pct: 0, text: '' }
  const all: TeamComparePoint[] = []
  const levels = goldLevels()
  const buffs = currentPhaseView.value?.buffs ?? []
  // 按队伍分批，让出主线程更新进度
  for (let i = 0; i < presets.length; i++) {
    const p = presets[i]
    progress.value = { pct: i / presets.length, text: `计算 ${p.name}（${i + 1}/${presets.length}）...` }
    await new Promise(r => setTimeout(r, 0))
    all.push(...computeTeamComparePoints(calc, {
      presets: [p],
      goldLevels: levels,
      boss,
      optimalGold: optimalGold.value,      phase,
      autoEngine: autoEngine.value,
      autoEngineMods: { aRank: autoModA.value, standard: autoModStd.value },
      autoEnginePool: autoEnginePool.value,
      buffs: buffChoice.value === 'none' ? [] : buffs,
      manualBuffTitle: buffChoice.value === '' || buffChoice.value === 'none' ? undefined : buffChoice.value,
    }))
  }
  points.value = all
  progress.value = { pct: 1, text: `完成：${all.length} 个点` }
  computing.value = false
}

// ========== 图表 ==========
const svgW = computed(() => Math.max(420, Math.min(1100, typeof window !== 'undefined' ? window.innerWidth - 120 : 960)))
const padL = 46, padR = 16, padT = 24, padB = 44
const plotW = computed(() => svgW.value - padL - padR)
const plotH = 340
const viewBox = computed(() => `0 0 ${svgW.value} ${padT + plotH + padB}`)

const yMax = computed(() => {
  const maxRatio = Math.max(...points.value.map(p => p.hpRatio), 0)
  return Math.max(100, Math.ceil(Math.max(maxRatio, 150) / 50) * 50)
})
const xMax = computed(() => {
  const maxD = Math.max(...points.value.map(p => p.difficulty), 1)
  return Math.max(10, Math.ceil(maxD / 5) * 5)
})
function yOf(v: number): number {
  return padT + plotH - (v / yMax.value) * plotH
}
function xOf(v: number): number {
  return padL + (v / xMax.value) * plotW.value
}

const yTicks = computed(() => {
  const ticks: number[] = []
  const step = yMax.value <= 100 ? 20 : yMax.value <= 200 ? 50 : 100
  for (let v = 0; v <= yMax.value; v += step) ticks.push(yOf(v))
  return ticks
})
function yLabel(i: number): number {
  const step = yMax.value <= 100 ? 20 : yMax.value <= 200 ? 50 : 100
  return i * step
}

const xTicks = 5
const xTickPositions = computed(() => {
  const out: number[] = []
  for (let i = 0; i <= xTicks; i++) out.push(xOf((xMax.value / xTicks) * i))
  return out
})
const xTickLabels = computed(() => {
  const out: number[] = []
  for (let i = 0; i <= xTicks; i++) out.push((xMax.value / xTicks) * i)
  return out
})

const PALETTE = ['#63e2b7', '#63b3ed', '#f6ad55', '#f687b3', '#b794f4', '#f6e05e', '#4fd1c5', '#fc8181']
const presetColors = computed<Record<string, string>>(() => {
  const map: Record<string, string> = {}
  teamPresets.forEach((t, i) => { map[t.id] = PALETTE[i % PALETTE.length] })
  return map
})
function colorOf(presetId: string): string {
  return presetColors.value[presetId] ?? '#888'
}

const chartPts = computed(() =>
  points.value.map(p => ({
    ...p,
    cx: xOf(p.difficulty),
    cy: yOf(Math.min(p.hpRatio, yMax.value)),
    r: 3 + Math.min(p.goldCount, 36) * 0.5,
    color: colorOf(p.presetId),
  })),
)

const legendPresets = computed(() => {
  const ids = [...new Set(points.value.map(p => p.presetId))]
  return ids.map(id => {
    const ps = points.value.filter(p => p.presetId === id)
    const t = teamPresets.find(x => x.id === id)
    return {
      id,
      name: t?.name ?? id,
      color: colorOf(id),
      minGold: Math.min(...ps.map(p => p.goldCount)),
      maxGold: Math.max(...ps.map(p => p.goldCount)),
    }
  })
})

// hover tooltip
const hoverIdx = ref(-1)
const hoverPt = computed(() => (hoverIdx.value >= 0 ? chartPts.value[hoverIdx.value] : null))
const ttX = computed(() => hoverPt.value ? Math.min(hoverPt.value.cx + 10, svgW.value - ttW - 20) : 0)
const ttY = computed(() => hoverPt.value ? Math.max(0, Math.min(hoverPt.value.cy - 20, padT + plotH - ttH - 10)) : 0)
const ttW = 200
const ttH = 110
const hoverTips = computed(() => {
  const p = hoverPt.value
  if (!p) return []
  return [
    `${p.presetName} · ${p.goldLabel}${p.standardGoldLabel ? ' · ' + p.standardGoldLabel : ''}`,
    `伤害 ${compact(p.damage)}（${fmt(p.hpRatio, 1)}%）${p.buffTitle ? ' · ' + p.buffTitle : ''}${p.hpRatio > 100 ? ` · ≈${killSeconds(p.hpRatio)}s 击杀` : ''}`,
    `难度 ${fmt(p.difficulty, 1)} · ${p.difficultyDetail}`,
    `影画 ${p.cinemas.join('/')} · 精炼 ${p.wengineMods.join('/')}`,
    p.timeExceeded ? `⚠ ${p.timeDetail}` : `✓ ${p.timeDetail}`,
  ]
})

/** 击杀时间（秒）：伤害/血量 > 100% 时 = 战斗时长 × 100/hpRatio（2 倍伤害 → 90s，按 180s 基准） */
function killSeconds(hpRatio: number): number {
  if (hpRatio <= 100) return 0
  const battle = configStore.enemy.battleTime ?? 180
  return Math.round(battle * 100 / hpRatio)
}

</script>

<style scoped>
.team-compare-page {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.compare-controls {
  display: flex;
  gap: 14px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.ctl-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ctl-label {
  font-size: 11px;
  color: var(--wa-550);
}

.ctl-sep {
  margin: 0 4px;
  color: var(--wa-400);
}

.progress-bar {
  margin-top: 10px;
  height: 4px;
  background: var(--wa-80);
  border-radius: 2px;
  position: relative;
}

.progress-fill {
  height: 100%;
  background: #63e2b7;
  border-radius: 2px;
  transition: width 0.15s;
}

.progress-text {
  position: absolute;
  top: 8px;
  right: 0;
  font-size: 11px;
  color: var(--wa-500);
}

.compare-note {
  margin-top: 10px;
  font-size: 12px;
  color: var(--wa-500);
}

.buff-note {
  color: rgba(230, 180, 100, 0.8);
}

.empty-hint {
  margin-top: 10px;
  font-size: 12px;
  color: var(--wa-600);
  line-height: 1.7;
}

.empty-hint code {
  background: var(--wa-80);
  padding: 1px 5px;
  border-radius: 3px;
}

.chart-card,
.detail-card {
  margin-top: 0;
}

.compare-svg {
  width: 100%;
  height: auto;
  background: var(--wa-15);
  border-radius: 4px;
}

/* SVG 网格/刻度/提示框颜色走主题变量 */
.chart-grid { stroke: var(--wa-60); }
.chart-grid-x { stroke: var(--wa-50); }
.chart-tick { fill: var(--wa-350); }
.chart-refline { stroke: var(--wa-250); }
.chart-refline-text { fill: var(--wa-450); }
.chart-axis-label { fill: var(--wa-500); }
.scatter-dot { stroke: var(--wa-350); }
.chart-hover-dot { fill: var(--app-text-solid); }
.chart-tooltip-box { fill: var(--app-tooltip-bg); stroke: var(--wa-150); }
.chart-tooltip-text { fill: var(--app-tooltip-text); }

.chart-legend {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.lchip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--wa-750);
  border: 1px solid;
  border-radius: 10px;
  padding: 1px 8px;
}

.ldot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.detail-table-wrap {
  overflow-x: auto;
}

.detail-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.detail-table th,
.detail-table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--wa-60);
  text-align: right;
  white-space: nowrap;
}

.detail-table th {
  color: var(--wa-500);
  font-weight: 600;
}

.detail-table td:first-child,
.detail-table th:first-child {
  text-align: left;
}

.td-team {
  font-weight: 600;
}

.td-detail {
  color: var(--wa-550);
  font-size: 11px;
}

.td-standard {
  color: rgba(230, 180, 100, 0.85);
  font-size: 11px;
}

.kill {
  color: #63e2b7;
  font-weight: 700;
}
.kill-time {
  color: inherit;
  font-weight: 400;
  font-size: 11px;
  opacity: 0.85;
  line-height: 1.3;
}

.time-ok {
  color: var(--wa-400);
  font-size: 11px;
}

.time-exceeded {
  color: #e88080;
  font-weight: 600;
  font-size: 11px;
}

.time-warn {
  background: rgba(255, 80, 80, 0.06);
}
</style>
