<template>
  <div v-if="hasTeam" class="impact-chart-card">
    <n-card size="small" :bordered="true">
      <template #header>
        <div class="impact-title-bar">
          <span>伤害影响与响应面分析</span>
          <div class="impact-tab-toggle">
            <n-radio-group v-model:value="dimensionMode" size="small">
              <n-radio-button value="2d">2D 单变量敏感度</n-radio-button>
              <n-radio-button value="3d">3D 双变量响应面</n-radio-button>
            </n-radio-group>
          </div>
        </div>
      </template>

      <!-- 3D 双变量响应面模式 -->
      <ResponseSurface3D
        v-if="dimensionMode === '3d'"
        :all-vars="allVars"
        :read-var="readVar"
        :team-total-damage="teamTotalDamage"
        :has-team="hasTeam"
        :var-options="varOptions"
        :render-var-label="renderVarLabel"
      />

      <!-- 2D 单变量敏感度模式 -->
      <div v-else class="impact-2d-container">
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
          <line v-for="(y,i) in yTicks" :key="'g'+i" :x1="padL" :y1="y" :x2="padL+plotW" :y2="y" class="chart-grid" />
          <text v-for="(y,i) in yTicks" :key="'yt'+i" :x="padL-6" :y="y+4" text-anchor="end" class="chart-tick" font-size="10">{{ fmt(yLabels[i],0) }}</text>
          <text v-for="(x,i) in xTickPositions" :key="'xt'+i" :x="x" :y="padT+plotH+16" text-anchor="middle" class="chart-tick" font-size="10">{{ fmt(xTickLabels[i],1) }}</text>

          <!-- 当前值参考竖线 -->
          <line v-if="refLineX!==undefined" :x1="refLineX" :y1="padT" :x2="refLineX" :y2="padT+plotH" class="chart-refline" stroke-dasharray="4,3" />

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
            <circle :cx="hoverPt.cx" :cy="hoverPt.cy" r="4" class="chart-hover-dot" />
            <rect :x="ttX-4" :y="ttY-4" :width="ttW+8" :height="ttH+8" rx="3" class="chart-tooltip-box" />
            <text v-for="(line,li) in hoverTips" :key="'ttl'+li" :x="ttX" :y="ttY+li*13" class="chart-tooltip-text" font-size="10">{{ line }}</text>
          </g>
        </svg>

        <!-- 图例 -->
        <div class="chart-legend">
          <span v-for="t in activeTypeOrder" :key="t" class="lchip" :style="{borderColor:typeColor(t)}"><span class="ldot" :style="{background:typeColor(t)}"></span>{{ t }}</span>
          <span class="lchip" style="border-color:#63e2b7"><span class="ldot" style="background:#63e2b7"></span>当前</span>
          <span v-for="cv in activeSnapCurves" :key="cv.label" class="lchip" :style="{borderColor:cv.color}"><span class="ldot" :style="{background:cv.color}"></span>{{ cv.label }}</span>
        </div>
      </div>
      </div>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { h, ref, computed, watch } from 'vue'
import { NCard, NSelect, NInputNumber, NButton, NRadioGroup, NRadioButton } from 'naive-ui'
import ResponseSurface3D from '@/components/charts/ResponseSurface3D.vue'
import { withAnalysisScenario } from '@/composables/analysisScenario'
import { useBatchOwner } from '@/composables/batchTask'
import { sampleImpactCurve, type ImpactPoint } from '@/composables/impactSampling'
import { useConfigStore, type CharacterConfig } from '@/stores/config'
import { useCatalogStore } from '@/stores/catalog'
import { fmt } from '@/utils/format'
import { buildImpactVariables, readImpactVariable, type ElementCoverageRate, type TeamImpactVariable } from '@/composables/impactVariables'
import { teamMechanicSettings, teamReleaseShares } from '@/composables/agentMechanicView'
import type { MechanicSetting } from '@/types/resource'

const configStore = useConfigStore()
const catalogStore = useCatalogStore()
/** 当前配置的读数由所在页面传入：页面已持有 calc 实例，组件再建一个会让整条管线每次状态变化多跑一遍（见 useResourceCalc 文档注释） */
const props = defineProps<{ teamTotalDamage: number; coverageRate?: ElementCoverageRate }>()

const hasTeam = computed(() => configStore.team.some(c => !!c.agentId))
const optimizePerPoint = ref(false)
const dimensionMode = ref<'2d' | '3d'>('2d')

// 进度
interface Progress { current: number; total: number; pct: number; text: string; startTime: number }
const progress = ref<Progress | null>(null)

// 时间估算文本（计算前）
const estimateText = computed(() => {
  if (!selVar.value || sampleCount.value <= 0) return ''
  const pts = sampleCount.value
  const base = pts * 0.005 // ~5ms per point for basic sampling
  const opt = optimizePerPoint.value ? pts * 0.3 : 0 // CC-183：含真实伤害精修，单人队 ~0.26s/点
  const total = base + opt
  if (total < 1) return `≈ ${pts}点 <1秒`
  return `≈ ${pts}点 ${total.toFixed(1)}秒`
})
const settingMap = computed<Map<string, MechanicSetting>>(() => {
  // CC-47：经编排层门面（判据 7）；teamMechanicSettings 已按 id 去重、先出现者优先 ⇒ 与原 `!map.has` 口径一致
  const map = new Map<string, MechanicSetting>()
  for (const setting of teamMechanicSettings(configStore.team)) map.set(setting.id, setting)
  return map
})

// CC-53：变量表（静态 + 机制设置 + 柏妮思占比）与读写口径收拢到编排层（判据 7）；组件只留 settingMap / 采样 / 渲染
const coverageRate = computed(() => props.coverageRate)
const releaseShares = computed(() => teamReleaseShares(configStore.team, id => catalogStore.getAgent(id)))  // CC-55：模块声明（原写死 1171）
const allVars = computed(() => buildImpactVariables(settingMap.value, releaseShares.value, coverageRate.value))
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

function readVar(v: TeamImpactVariable): number {
  return readImpactVariable(v, configStore, coverageRate.value)
}


// ========== 快照 ==========
interface Snapshot { label: string; team: CharacterConfig[] }
const snapshots = ref<Snapshot[]>([])
const snapActive = ref<boolean[]>([])

function saveSnapshot() {
  const label = `快照${['A','B','C'][snapshots.value.length]} ${configStore.team.map(c => c.agentId||'?').join('+')}`
  const teamClone = JSON.parse(JSON.stringify(configStore.team))
  snapshots.value.push({ label, team: teamClone })
  snapActive.value.push(true)
}

// ========== 数据点 ==========
type DataPoint = ImpactPoint
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

// ========== 采样（CC-345：在独立场景上跑，见 composables/impactSampling.ts） ==========

/** 批任务归属（同 CC-343 S4）：重算吊销上一次，离开页面也吊销 */
const owner = useBatchOwner()

async function run() {
  const varId = selectedVarId.value
  if (!varId) return
  const task = owner.start()
  const control = { signal: task.signal }
  computing.value = true; errorMsg.value = ''; hoverIdx.value = -1
  // 换队后下拉里可能还留着旧队伍的变量：不在当前变量表 ⇒ 没有当前值（快照曲线照常按 varId 采样，CC-537）
  curVal.value = selVar.value ? readVar(selVar.value) : undefined
  const N = sampleCount.value
  const optimize = optimizePerPoint.value
  /** 每条曲线一个进度条：label 0/N → label i/N · 预计剩余 */
  const progressFor = (label: string) => {
    const startTime = Date.now()
    task.commit(() => { progress.value = { current: 0, total: N, pct: 0, text: `${label} 0/${N}`, startTime } })
    return (i: number) => {
      const elapsed = (Date.now() - startTime) / 1000
      const eta = i > 0 ? (elapsed / i) * (N - i) : 0
      task.commit(() => { progress.value = { current: i, total: N, pct: i / N, text: `${label} ${i}/${N} · 预计剩余 ${eta.toFixed(0)}s`, startTime } })
    }
  }
  // 发车时定格快照列表与勾选（运行中增删快照不影响本次）
  const snaps = snapshots.value.map((sn, i) => ({ label: sn.label, team: sn.team, active: !!snapActive.value[i] }))
  try {
    const mainPts = await withAnalysisScenario(s => sampleImpactCurve(s, { varId, points: N, optimizePerPoint: optimize, onProgress: progressFor('采样中'), control }))
    const all: CurveData[] = [{ label: '当前', points: mainPts, color: CURVE_COLORS[0], isMain: true }]
    for (let i = 0; i < snaps.length; i++) {
      const sn = snaps[i]
      const pts = sn.active
        ? await withAnalysisScenario(s => sampleImpactCurve(s, { varId, points: N, optimizePerPoint: optimize, team: sn.team, onProgress: progressFor('采样 ' + sn.label), control }))
        : []
      all.push({ label: sn.label, points: pts, color: CURVE_COLORS[1 + (i % 3)], isMain: false })
    }
    task.commit(() => { curves.value = all })
  } catch (e) {
    task.commit(() => { errorMsg.value = `计算失败：${e instanceof Error ? e.message : String(e)}` })
  } finally {
    task.commit(() => { progress.value = null; computing.value = false })
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
.impact-title-bar { display: flex; align-items: center; justify-content: space-between; width: 100%; flex-wrap: wrap; gap: 8px; }
.impact-tab-toggle { display: flex; align-items: center; }
.impact-2d-container { display: flex; flex-direction: column; width: 100%; }
.impact-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
/* D4 用户裁决 2026-09-25（授权自定基准）：`.ctl-label` 统一全局口径 11px/--wa-550，
   与 src/styles/charts.css 全局表一致；原 scoped 异类 12px/--wa-500 删除（跨页观感统一）。 */
.ctl-label { font-size: 11px; color: var(--wa-550); }
.cur-val { font-size: 12px; color: var(--wa-450); margin-left: auto; }
.opt-toggle { font-size: 11px; color: var(--wa-550); display: flex; align-items: center; gap: 3px; cursor: pointer; }
.opt-toggle input { cursor: pointer; }
.est-text { font-size: 11px; color: var(--wa-300); }
.progress-bar { position: relative; height: 18px; background: var(--wa-40); border-radius: 3px; margin-bottom: 8px; overflow: hidden; }
.progress-fill { position: absolute; left: 0; top: 0; height: 100%; background: rgba(99,226,183,0.3); transition: width .2s; }
.progress-text { position: relative; display: flex; align-items: center; justify-content: center; height: 100%; font-size: 10px; color: var(--wa-500); }
.snapshot-bar { display: flex; gap: 6px; margin-bottom: 10px; }
.snap-chip { font-size: 11px; padding: 2px 8px; border-radius: 3px; background: var(--wa-40); color: var(--fg-2); cursor: pointer; user-select: none; }
.snap-chip.active { background: rgba(99,226,183,0.15); color: var(--c-success); }
.snap-del { color: var(--wa-300); margin-left: 4px; }
.impact-error { font-size: 12px; color: #ef4444; margin-bottom: 8px; }
.chart-area { width: 100%; overflow-x: auto; }
.impact-svg { width: 100%; height: auto; background: var(--wa-15); border-radius: 4px; }
/* SVG 网格/刻度/提示框颜色走主题变量（var() 在 presentation attribute 上不可靠，统一 class + CSS） */
.chart-grid { stroke: var(--wa-60); }
.chart-tick { fill: var(--wa-350); }
.chart-refline { stroke: var(--wa-200); }
.chart-hover-dot { fill: var(--app-text-solid); }
.chart-tooltip-box { fill: var(--app-tooltip-bg); stroke: var(--wa-150); }
.chart-tooltip-text { fill: var(--app-tooltip-text); }
.chart-legend { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.type-filter { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.tf-chip { font-size: 10px; padding: 1px 6px; border-radius: 3px; background: var(--wa-40); color: var(--fg-2); cursor: pointer; user-select: none; display: inline-flex; align-items: center; gap: 3px; }
.tf-chip.on { background: rgba(99,226,183,0.1); color: var(--wa-700); }
.tf-dot { width: 5px; height: 5px; border-radius: 50%; display: inline-block; }
.tf-all { color: var(--wa-250); font-style: italic; }
.lchip { font-size: 10px; color: var(--wa-550); border: 1px solid var(--wa-100); border-radius: 3px; padding: 1px 6px; display: inline-flex; align-items: center; gap: 4px; }
.ldot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
</style>
