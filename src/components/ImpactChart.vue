<template>
  <div v-if="hasTeam" class="impact-chart-card">
    <n-card size="small" :bordered="true">
      <template #header><span>伤害影响分析</span></template>

      <!-- 控制栏 -->
      <div class="impact-controls">
        <n-select
          v-model:value="selectedVarId"
          :options="varOptions"
          :render-label="renderVarLabel"
          size="small"
          style="width:300px"
          filterable
          placeholder="选择变量"
        />
        <span class="ctl-label">采样</span>
        <n-input-number v-model:value="sampleCount" size="small" :min="10" :max="100" :step="10" style="width:65px" />
        <n-button size="small" type="primary" :loading="computing" @click="run">计算</n-button>
        <n-button size="small" @click="saveSnapshot" :disabled="snapshots.length>=3">保存快照</n-button>
        <n-button size="small" quaternary @click="exportCSV" :disabled="!selectedCurve">导出CSV</n-button>
        <label class="opt-toggle"><input type="checkbox" v-model="optimizePerPoint" />优化词条</label>
        <span v-if="estimateText" class="est-text">{{ estimateText }}</span>
        <span v-if="curVal!==undefined" class="cur-val">当前: {{ fmt(curVal,1) }}{{ selVar?.suffix??'' }}</span>
      </div>

      <!-- 进度 -->
      <div v-if="computing && progress" class="progress-bar">
        <div class="progress-fill" :style="{width: (progress.pct*100)+'%'}"></div>
        <span class="progress-text">{{ progress.text }}</span>
      </div>

      <!-- 快照选择 -->
      <div v-if="snapshots.length>0" class="snapshot-bar">
        <span v-for="(sn, i) in snapshots" :key="i" class="snap-chip" :class="{ active: snapActive[i] }" @click="snapActive[i]=!snapActive[i]">
          {{ sn.label }} <span class="snap-del" @click.stop="snapshots.splice(i,1);snapActive.splice(i,1)">×</span>
        </span>
      </div>

      <div v-if="errorMsg" class="impact-error">{{ errorMsg }}</div>

      <!-- 类型筛选 -->
      <div v-if="allTypeOrder.length > 0" class="type-filter">
        <span v-for="t in allTypeOrder" :key="t" class="tf-chip" :class="{ on: typeFilterSet.has(t) }" @click="toggleTypeFilter(t)">
          <span class="tf-dot" :style="{background:typeColor(t)}"></span>{{ t }}
        </span>
        <span class="tf-chip tf-all" @click="allTypeOrder.forEach(t=>typeFilterSet.add(t))">全选</span>
      </div>

      <!-- 图表 -->
      <div v-if="enrichedCurves.some(c=>c.points.length>0)" class="chart-area">
        <svg :viewBox="viewBox" class="impact-svg">
          <line v-for="(y,i) in yTicks" :key="'g'+i" :x1="padL" :y1="y" :x2="padL+plotW" :y2="y" stroke="rgba(255,255,255,0.06)" />
          <text v-for="(y,i) in yTicks" :key="'yt'+i" :x="padL-6" :y="y+4" text-anchor="end" fill="rgba(255,255,255,0.35)" font-size="10">{{ fmt(yLabels[i],0) }}</text>
          <text v-for="(x,i) in xTickPositions" :key="'xt'+i" :x="x" :y="padT+plotH+16" text-anchor="middle" fill="rgba(255,255,255,0.35)" font-size="10">{{ fmt(xTickLabels[i],1) }}</text>

          <!-- 当前值参考竖线 -->
          <line v-if="refLineX!==undefined" :x1="refLineX" :y1="padT" :x2="refLineX" :y2="padT+plotH" stroke="rgba(255,255,255,0.2)" stroke-dasharray="4,3" />

          <!-- 堆叠面积（仅活动曲线第一条） -->
          <template v-for="stack in activeStackPaths" :key="stack.type">
            <path :d="stack.path" :fill="stack.color" opacity="0.3" />
            <path :d="stack.topLine" fill="none" :stroke="stack.color" stroke-width="0.5" opacity="0.5" />
          </template>

          <!-- 每条曲线 -->
          <template v-for="cv in enrichedCurves" :key="cv.label">
            <polyline :points="cv.pathD" fill="none" :stroke="cv.color" :stroke-width="cv.isMain?1.8:1.2" :opacity="cv.isMain?1:0.7" />
            <circle v-for="(pt,i) in cv.chartPts" :key="'c'+i" :cx="pt.cx" :cy="pt.cy" r="2" :fill="cv.color" opacity="0.8" />
            <circle v-if="cv.maxPt" :cx="cv.maxPt.cx" :cy="cv.maxPt.cy" r="4" fill="none" :stroke="cv.color" stroke-width="1.5" />
            <text v-if="cv.maxPt" :x="cv.maxPt.cx" :y="cv.maxPt.cy-6" text-anchor="middle" :fill="cv.color" font-size="9">max {{ fmt(cv.maxX,1) }}</text>
          </template>

          <!-- hover point + tooltip -->
          <g v-if="hoverIdx>=0 && hoverPt">
            <circle :cx="hoverPt.cx" :cy="hoverPt.cy" r="4" fill="#fff" />
            <rect :x="ttX-4" :y="ttY-4" :width="ttW+8" :height="ttH+8" rx="3" fill="rgba(0,0,0,0.9)" stroke="rgba(255,255,255,0.15)" />
            <text v-for="(line,li) in hoverTips" :key="'ttl'+li" :x="ttX" :y="ttY+li*13" fill="#fff" font-size="10">{{ line }}</text>
          </g>
        </svg>

        <!-- 图例 -->
        <div class="chart-legend">
          <span v-for="t in activeTypeOrder" :key="t" class="lchip" :style="{borderColor:typeColor(t)}"><span class="ldot" :style="{background:typeColor(t)}"></span>{{ t }}</span>
          <span class="lchip" style="border-color:#63e2b7"><span class="ldot" style="background:#63e2b7"></span>当前</span>
          <span v-for="cv in activeSnapCurves" :key="cv.label" class="lchip" :style="{borderColor:cv.color}"><span class="ldot" :style="{background:cv.color}"></span>{{ cv.label }}</span>
        </div>
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { h, ref, computed, watch } from 'vue'
import { NCard, NSelect, NInputNumber, NButton } from 'naive-ui'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { useConfigStore } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { fmt } from '@/utils/format'
import { IMPACT_VARIABLES, readImpactVar, writeImpactVar } from '@/core/impactVars'
import { getAgentMechanic } from '@/mechanics'
import type { MechanicSetting } from '@/types/resource'
import { computeOptimalSubStats, getTemplate } from '@/core/substatOptimizer'
import { buildTeammateBuffSourceContext } from '@/core/teammateBuffSource'
import { calcPanel } from '@/core/panel'

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
const { teamTotalDamage, damagePoolRows, resourceResult, anomalyPoolResult } = useResourceCalc()

const hasTeam = computed(() => configStore.team.some(c => !!c.agentId))
const optimizePerPoint = ref(false)

// 进度
interface Progress { current: number; total: number; pct: number; text: string; startTime: number }
const progress = ref<Progress | null>(null)

// 时间估算文本（计算前）
const estimateText = computed(() => {
  if (!selVar.value || sampleCount.value <= 0) return ''
  const pts = sampleCount.value
  const base = pts * 0.005 // ~5ms per point for basic sampling
  const opt = optimizePerPoint.value ? pts * 0.03 : 0 // ~30ms per point for optimize
  const total = base + opt
  if (total < 1) return `≈ ${pts}点 <1秒`
  return `≈ ${pts}点 ${total.toFixed(1)}秒`
})
const settingMap = computed<Map<string, MechanicSetting>>(() => {
  const map = new Map<string, MechanicSetting>()
  for (const char of configStore.team) {
    if (!char?.agentId) continue
    for (const setting of getAgentMechanic(char.agentId)?.settings ?? []) {
      if (!map.has(setting.id)) map.set(setting.id, setting)
    }
  }
  return map
})

const dynamicVars = computed(() => {
  const vars: typeof IMPACT_VARIABLES = []
  for (const [id, setting] of settingMap.value) {
    const range = setting.suffix === '%'
      ? [(setting.min ?? 0) * 100, (setting.max ?? 100) * 100]
      : [setting.min ?? 0, setting.max ?? 100]
    vars.push({ id: `setting.${id}`, label: setting.label, defaultRange: range as [number, number], suffix: setting.suffix })
  }
  const burniceSlot = configStore.team.findIndex(char => {
    const agent = char.agentId ? catalogStore.getAgent(char.agentId) : null
    return agent?.id === '1171' || agent?.teammateBuffId === '1171'
  })
  if (burniceSlot >= 0) {
    const elementLabels: Record<string, string> = { physical: '物理', fire: '火', ice: '冰', electric: '电', ether: '以太', wind: '风', lumiflux: '辉光' }
    const coverage = anomalyPoolResult.value?.coverage?.perElementCoverageRate ?? {}
    for (const [element, rate] of Object.entries(coverage)) {
      if (rate <= 0) continue
      vars.push({
        id: `setting.burnice.releaseShare:${element}`,
        label: `柏妮思异放·${elementLabels[element] ?? element}占比`,
        defaultRange: [0, 100],
        suffix: '%',
      })
    }
  }
  return vars
})

const allVars = computed(() => [...IMPACT_VARIABLES, ...dynamicVars.value])
const varOptions = computed(() => allVars.value.map(v => ({ label: v.label, value: v.id })))
function renderVarLabel(option: { label: string; value: string }) {
  return h('span', { title: option.label, style: 'display:inline-block;white-space:nowrap;vertical-align:middle' }, option.label)
}

const selectedVarId = ref<string | null>(null)
const sampleCount = ref(30)
const computing = ref(false)
const errorMsg = ref('')
const curVal = ref<number | undefined>(undefined)
const selVar = computed(() => allVars.value.find(v => v.id === selectedVarId.value))

function parseDynamicVar(id: string): { kind: 'rate' | 'cap' | 'anomaly' | 'setting'; slot?: number; actionId?: string; settingId?: string } | null {
  let m = id.match(/^setting\.(.+)$/)
  if (m) return { kind: 'setting', settingId: m[1] }
  return null
}

function readVar(id: string): number {
  const dyn = parseDynamicVar(id)
  if (dyn?.kind === 'setting' && dyn.settingId) {
    if (dyn.settingId.startsWith('burnice.releaseShare:')) {
      const element = dyn.settingId.slice('burnice.releaseShare:'.length)
      const stored = configStore.mechanicSettings[dyn.settingId]
      const auto = (anomalyPoolResult.value?.coverage?.perElementCoverageRate[element] ?? 0) * 100
      return stored !== undefined ? stored * 100 : auto
    }
    const meta = settingMap.value.get(dyn.settingId)
    const raw = configStore.getMechanicSetting(dyn.settingId, meta?.default ?? 1)
    return meta?.suffix === '%' ? raw * 100 : raw
  }
  return readImpactVar(configStore, id)
}

function writeVar(id: string, value: number): void {
  const dyn = parseDynamicVar(id)
  if (dyn?.kind === 'setting' && dyn.settingId) {
    if (dyn.settingId.startsWith('burnice.releaseShare:')) {
      configStore.setMechanicSetting(dyn.settingId, value / 100)
      return
    }
    const meta = settingMap.value.get(dyn.settingId)
    configStore.setMechanicSetting(dyn.settingId, meta?.suffix === '%' ? value / 100 : value)
    return
  }
  writeImpactVar(configStore, id, value)
}

// ========== 快照 ==========
interface Snapshot { label: string; team: any }
const snapshots = ref<Snapshot[]>([])
const snapActive = ref<boolean[]>([])

function saveSnapshot() {
  const label = `快照${['A','B','C'][snapshots.value.length]} ${configStore.team.map(c => c.agentId||'?').join('+')}`
  const teamClone = JSON.parse(JSON.stringify(configStore.team))
  snapshots.value.push({ label, team: teamClone })
  snapActive.value.push(true)
}

// ========== 数据点 ==========
interface DataPoint { x: number; y: number; byType: Record<string, number> }
interface CurveData { label: string; points: DataPoint[]; color: string; isMain: boolean }
const curves = ref<CurveData[]>([])
const selectedCurve = computed(() => curves.value.find(c => c.isMain))
const hoverIdx = ref(-1)

const CURVE_COLORS = ['#63e2b7', '#f0a020', '#38bdf8', '#f472b6']
const activeCurves = computed(() => curves.value.filter((_, i) => i === 0 || snapActive.value[i - 1]))
const activeSnapCurves = computed(() => activeCurves.value.filter(c => !c.isMain))
const activeStackPaths = computed(() => {
  const main = curves.value[0]
  if (!main?.points.length) return []
  // 复用现有堆叠逻辑
  return buildStackPaths(main.points, activeTypeOrder.value)
})
const allTypeOrder = computed(() => {
  const main = curves.value[0]; if (!main?.points.length) return []
  return getTypeOrder(main.points)
})
const typeFilterSet = ref(new Set<string>([]))
// 初始化全选
watch(allTypeOrder, (types) => { for (const t of types) typeFilterSet.value.add(t) }, { immediate: true })
function toggleTypeFilter(t: string) { if (typeFilterSet.value.has(t)) typeFilterSet.value.delete(t); else typeFilterSet.value.add(t) }

const activeTypeOrder = computed(() => allTypeOrder.value.filter(t => typeFilterSet.value.has(t)))

// ========== 颜色 ==========
const TYPE_COLORS: Record<string,string> = { '直伤':'#93c5fd','灼烧':'#ef4444','感电':'#facc15','侵蚀':'#a78bfa','强击':'#9ca3af','碎冰':'#38bdf8','紊乱':'#f0a020','乱流':'#10b981','耀变':'#ec4899','特殊虚耀':'#f472b6','极性强击':'#9ca3af','爱丽丝6命附伤':'#fb923c','简6命附伤':'#fbbf24' }
function typeColor(t:string){return TYPE_COLORS[t]??'#888'}
function getTypeOrder(pts: DataPoint[]) {
  const all=new Set<string>()
  for(const p of pts) for(const t of Object.keys(p.byType)) all.add(t)
  const totals=new Map<string,number>()
  for(const p of pts) for(const [t,d] of Object.entries(p.byType)) totals.set(t,(totals.get(t)??0)+d)
  return [...all].sort((a,b)=>(totals.get(b)??0)-(totals.get(a)??0))
}
function buildStackPaths(pts: DataPoint[], filterTypes?: string[]) {
  const allTypes=getTypeOrder(pts)
  const types = filterTypes ? allTypes.filter(t => filterTypes.includes(t)) : allTypes
  if(!types.length||!pts.length) return[]
  const sX=(x:number)=>padL+((x-rng.value.xMin)/(rng.value.xMax-rng.value.xMin||1))*plotW.value
  const sY=(y:number)=>padT+plotH.value-((y-rng.value.yMin)/(rng.value.yMax-rng.value.yMin||1))*plotH.value
  return types.map(type=>{
    const tops:number[]=[],bots:number[]=[]
    for(const pt of pts){let cb=0,ct=0;for(const t of types){const d=pt.byType[t]??0;if(t===type){cb=ct;ct+=d;break}ct+=d};bots.push(sY(cb));tops.push(sY(ct))}
    const N=pts.length
    const tl=tops.map((cy,i)=>`${i===0?'M':'L'}${sX(pts[i].x)},${cy}`).join(' ')
    const ap=tl+` L${sX(pts[N-1].x)},${bots[N-1]}`+bots.slice().reverse().map((cy,i)=>`L${sX(pts[N-1-i].x)},${cy}`).join(' ')+' Z'
    return{type,path:ap,topLine:tl,color:typeColor(type)}
  })
}

// ========== SVG ==========
const padL=55,padR=12,padT=8,padB=28
const svgW=computed(()=>Math.max(320,Math.min(800,typeof window!=='undefined'?window.innerWidth-80:720)))
const svgH=220,plotW=computed(()=>svgW.value-padL-padR),plotH=computed(()=>svgH-padT-padB)
const viewBox=computed(()=>`0 0 ${svgW.value} ${svgH}`)

const rng=computed(()=>{
  let xMin=0,xMax=1,yMin=0,yMax=1
  for(const cv of activeCurves.value) for(const p of cv.points){if(p.x<xMin)xMin=p.x;if(p.x>xMax)xMax=p.x;if(p.y>yMax)yMax=p.y}
  yMax*=1.08;return{xMin,xMax,yMin,yMax}
})
const sX=(x:number)=>padL+((x-rng.value.xMin)/(rng.value.xMax-rng.value.xMin||1))*plotW.value
const sY=(y:number)=>padT+plotH.value-((y-rng.value.yMin)/(rng.value.yMax-rng.value.yMin||1))*plotH.value

// 为每条曲线预计算 chartPts + pathD + maxPt
const enrichedCurves = computed(() => activeCurves.value.map(cv => {
  const chartPts = cv.points.map(p => ({ cx: sX(p.x), cy: sY(p.y), ...p }))
  const pathD = chartPts.map((p,i) => `${i===0?'M':'L'}${p.cx},${p.cy}`).join(' ')
  let maxIdx = -1, maxY = -Infinity
  cv.points.forEach((p,i) => { if(p.y>maxY){maxY=p.y;maxIdx=i} })
  return { ...cv, chartPts, pathD, maxPt: maxIdx>=0?chartPts[maxIdx]:null, maxX: maxIdx>=0?cv.points[maxIdx].x:0 }
}))

// 参考竖线
const refLineX = computed(() => {
  if (!selVar.value || curVal.value===undefined) return undefined
  return sX(curVal.value)
})

const yTicks=computed(()=>{const n=5;return Array.from({length:n},(_,i)=>padT+(plotH.value/(n-1))*i)})
const yLabels=computed(()=>{const n=5;return Array.from({length:n},(_,i)=>rng.value.yMin+((rng.value.yMax-rng.value.yMin)/(n-1))*i)})
const xTickPositions=computed(()=>{
  const pts=activeCurves.value[0]?.points;if(!pts?.length)return[]
  const n=Math.min(5,pts.length);if(n<=1)return[];const step=(pts.length-1)/(n-1)
  return Array.from({length:n},(_,i)=>sX(pts[Math.round(i*step)].x))
})
const xTickLabels=computed(()=>{
  const pts=activeCurves.value[0]?.points;if(!pts?.length)return[]
  const n=Math.min(5,pts.length);if(n<=1)return[];const step=(pts.length-1)/(n-1)
  return Array.from({length:n},(_,i)=>pts[Math.round(i*step)].x)
})

// ========== Hover ==========
const hoverPt = computed(() => {
  const cv = enrichedCurves.value[0]; if (!cv || hoverIdx.value<0 || !cv.chartPts[hoverIdx.value]) return null
  return cv.chartPts[hoverIdx.value]
})
const hoverTips = computed(() => {
  if (!hoverPt.value) return []
  const pt = hoverPt.value; const lines = [`x=${fmt(pt.x,1)}  总=${fmt(pt.y,0)}`]
  for (const t of activeTypeOrder.value) { const d = pt.byType[t]; if (d && d > 0) lines.push(`  ${t}: ${fmt(d,0)}`) }
  return lines
})
const ttX = computed(() => hoverPt.value ? Math.min(hoverPt.value.cx + 8, svgW.value - 180) : 0)
const ttY = computed(() => hoverPt.value ? Math.max(padT + 4, hoverPt.value.cy - (hoverTips.value.length) * 13) : 0)
const ttW = 170
const ttH = computed(() => (hoverTips.value.length) * 13)

// ========== 采样核心 ==========

/** 对当前配置跑一轮优化（仅槽0），应用到 store 副分配 */
function runOptimizerForSlot0() {
  const slot = 0
  const char = configStore.team[slot]
  if (!char?.agentId) return
  const agent = catalogStore.getAgent(char.agentId)
  if (!agent) return
  const wEngine = char.wEngineId ? catalogStore.getWEngine(char.wEngineId) : undefined
  const setInfo = buildTeammateBuffSourceContext(configStore.team, {
    teammateBuffGroups: catalogStore.teammateBuffGroups,
    driveDiscSetsMap: catalogStore.driveDiscSetsMap,
    statRules: catalogStore.statRules,
    getAgent: (id: string) => catalogStore.getAgent(id),
    getWEngine: (id: string) => catalogStore.getWEngine(id),
    isTeammateBuffEnabled: (id: string) => configStore.isTeammateBuffEnabled(id),
  })
  const tmpl = getTemplate(agent)
  const sc = tmpl.stats.length
  const tsk = sc <= 2 ? 'optimizer.totalSteps2' : sc === 3 ? 'optimizer.totalSteps3' : 'optimizer.totalSteps4'
  try {
    const result = computeOptimalSubStats({
      agent, wEngine,
      driveDiscConfig: char.driveDisc,
      setsMap: catalogStore.driveDiscSetsMap,
      teammateBuffs: setInfo.enabledTeammateBuffs,
      statRules: catalogStore.statRules,
      statCap: configStore.getMechanicSetting('optimizer.substatCap', 20),
      totalSteps: configStore.getMechanicSetting(tsk, 0),
      config: { cinemaLevel: char.cinemaLevel ?? 0, wEngineModLevel: char.wEngineModLevel ?? 1, sourcePanelsByOwner: setInfo.sourcePanelsByOwner },
    })
    char.driveDisc.subStatAllocation = {}
    for (const [s, n] of Object.entries(result.subStatAllocation)) {
      if (n > 0) char.driveDisc.subStatAllocation[s] = Math.max(0, Math.min(54, n))
    }
  } catch { /* skip */ }
}

function readDamageSnapshot(): DataPoint {
  const byType: Record<string, number> = {}
  for (const row of damagePoolRows.value) {
    if (row.totalDamage > 0) byType[row.type] = (byType[row.type] ?? 0) + row.totalDamage
  }
  return { x: 0, y: teamTotalDamage.value, byType } as DataPoint
}

async function sampleCurve(totalPts: number, updateProgress: (i: number) => void): Promise<DataPoint[]> {
  const v = selVar.value; if (!v) return []
  const pts: DataPoint[] = []
  const [xMin, xMax] = v.defaultRange
  const BATCH = 5 // 每 5 点让出主线程一次

  for (let batch = 0; batch * BATCH < totalPts; batch++) {
    const start = batch * BATCH
    const end = Math.min(start + BATCH, totalPts)

    // 批量设置变量（每点不同值）
    for (let i = start; i < end; i++) {
      const x = xMin + ((xMax - xMin) / (totalPts - 1)) * i
      writeVar(selectedVarId.value!, x)
      // 不开 setTimeout——最后一次性等待
    }
    // 等待响应式链结算
    await new Promise(r => setTimeout(r, 0))

    // 批量读取（每点需恢复自己的 x 值 + 重算）
    // 实际上需要逐点：每次设 x → 等待 → 读 → 设下一个 x
    // 简化：回退到逐点（但在同一 tick 批量 updateProgress）
    for (let i = start; i < end; i++) {
      const x = xMin + ((xMax - xMin) / (totalPts - 1)) * i
      writeVar(selectedVarId.value!, x)
      await new Promise(r => setTimeout(r, 0))
      if (optimizePerPoint.value) runOptimizerForSlot0()
      await new Promise(r => setTimeout(r, 0))
      const dp = readDamageSnapshot(); dp.x = x
      pts.push(dp)
      updateProgress(i + 1)
    }
  }
  return pts
}

async function run() {
  if (!selectedVarId.value) return
  computing.value = true; errorMsg.value = ''; hoverIdx.value = -1
  const origVal = readVar(selectedVarId.value)
  curVal.value = origVal
  const N = sampleCount.value

  // 保存原始词条分配（用于优化模式恢复）
  const origAllocs = configStore.team.map(c => c?.driveDisc?.subStatAllocation ? { ...c.driveDisc.subStatAllocation } : {})

  progress.value = { current: 0, total: N, pct: 0, text: '采样中 0/' + N, startTime: Date.now() }
  const updProgress = (i: number) => {
    const elapsed = (Date.now() - progress.value!.startTime) / 1000
    const eta = i > 0 ? (elapsed / i) * (N - i) : 0
    progress.value = { current: i, total: N, pct: i / N, text: `采样中 ${i}/${N} · 预计剩余 ${eta.toFixed(0)}s`, startTime: progress.value!.startTime }
  }

  try {
    // 主线
    const mainPts = await sampleCurve(N, updProgress)
    // 快照
    const snapPts: DataPoint[][] = []
    const origTeam = JSON.parse(JSON.stringify(configStore.team))
    for (let i = 0; i < snapshots.value.length; i++) {
      if (!snapActive.value[i]) { snapPts.push([]); continue }
      configStore.$patch({ team: JSON.parse(JSON.stringify(snapshots.value[i].team)) })
      await new Promise(r => setTimeout(r, 0))
      progress.value = { current: 0, total: N, pct: 0, text: '采样 ' + snapshots.value[i].label + ' 0/' + N, startTime: Date.now() }
      snapPts.push(await sampleCurve(N, updProgress))
    }
    configStore.$patch({ team: JSON.parse(JSON.stringify(origTeam)) })
    await new Promise(r => setTimeout(r, 0))
    writeVar(selectedVarId.value!, origVal)

    // 恢复原始词条
    for (let s = 0; s < 3; s++) {
      if (origAllocs[s]) configStore.team[s].driveDisc.subStatAllocation = { ...origAllocs[s] }
    }
    await new Promise(r => setTimeout(r, 0))

    const all: CurveData[] = [{ label: '当前', points: mainPts, color: CURVE_COLORS[0], isMain: true }]
    for (let i = 0; i < snapPts.length; i++) {
      all.push({ label: snapshots.value[i].label, points: snapPts[i], color: CURVE_COLORS[1 + (i % 3)], isMain: false })
    }
    curves.value = all
  } catch (e: any) {
    errorMsg.value = `计算失败：${e?.message ?? e}`
  } finally {
    writeVar(selectedVarId.value!, origVal)
    progress.value = null
    computing.value = false
  }
}

// ========== 导出 CSV ==========
function exportCSV() {
  const cv = curves.value[0]; if (!cv?.points.length) return
  const types = getTypeOrder(cv.points)
  let csv = 'x,总伤害,' + types.join(',') + '\n'
  for (const p of cv.points) {
    const row = [fmt(p.x,2), fmt(p.y,0), ...types.map(t => fmt(p.byType[t]??0,0))]
    csv += row.join(',') + '\n'
  }
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `impact_${selVar.value?.id??'data'}.csv`
  a.click(); URL.revokeObjectURL(url)
}
</script>

<style scoped>
.impact-chart-card { margin-top: 16px; }
.impact-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.ctl-label { font-size: 12px; color: rgba(255,255,255,0.5); }
.cur-val { font-size: 12px; color: rgba(255,255,255,0.45); margin-left: auto; }
.opt-toggle { font-size: 11px; color: rgba(255,255,255,0.55); display: flex; align-items: center; gap: 3px; cursor: pointer; }
.opt-toggle input { cursor: pointer; }
.est-text { font-size: 11px; color: rgba(255,255,255,0.3); }
.progress-bar { position: relative; height: 18px; background: rgba(255,255,255,0.04); border-radius: 3px; margin-bottom: 8px; overflow: hidden; }
.progress-fill { position: absolute; left: 0; top: 0; height: 100%; background: rgba(99,226,183,0.3); transition: width .2s; }
.progress-text { position: relative; display: flex; align-items: center; justify-content: center; height: 100%; font-size: 10px; color: rgba(255,255,255,0.5); }
.snapshot-bar { display: flex; gap: 6px; margin-bottom: 10px; }
.snap-chip { font-size: 11px; padding: 2px 8px; border-radius: 3px; background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.5); cursor: pointer; user-select: none; }
.snap-chip.active { background: rgba(99,226,183,0.15); color: #63e2b7; }
.snap-del { color: rgba(255,255,255,0.3); margin-left: 4px; }
.impact-error { font-size: 12px; color: #ef4444; margin-bottom: 8px; }
.chart-area { width: 100%; overflow-x: auto; }
.impact-svg { width: 100%; height: auto; background: rgba(255,255,255,0.015); border-radius: 4px; }
.chart-legend { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.type-filter { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.tf-chip { font-size: 10px; padding: 1px 6px; border-radius: 3px; background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.35); cursor: pointer; user-select: none; display: inline-flex; align-items: center; gap: 3px; }
.tf-chip.on { background: rgba(99,226,183,0.1); color: rgba(255,255,255,0.7); }
.tf-dot { width: 5px; height: 5px; border-radius: 50%; display: inline-block; }
.tf-all { color: rgba(255,255,255,0.25); font-style: italic; }
.lchip { font-size: 10px; color: rgba(255,255,255,0.55); border: 1px solid rgba(255,255,255,0.1); border-radius: 3px; padding: 1px 6px; display: inline-flex; align-items: center; gap: 4px; }
.ldot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
</style>
