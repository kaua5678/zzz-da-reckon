<!--
  逐窗兑现图（资源池页「逐窗兑现」卡的展示层，2026-10-27）。

  用户口径（逐字）：「资源池页面如果开了轴模式，能显示 **n 次轴的动作块的丢失填充可视化**吗。
  丢失比如某些情况**跳招**了，填充比如我在末尾**自动填了平a或者强特或者诺姆转连携**之类的奖励招式。」

  本组件**只画** `composables/axisWindowView.ts` 已算好的逐窗视图（纯函数 + 单测）：
  不自算任何判定、不读 store、不解码 moveId 语义 —— 名字全部由调用方 `nameOf` 注入。

  坐标口径 = **与轴编辑器共用的原语** `composables/axisTimeline.ts`（2026-10-30 收敛：
  此前本组件自持一套 `pct / blockStyle / fillStyle / closedStyle / inPct`，与编辑器的 `TL` +
  `blockStyle` 是两份实现，越界夹取口径还不同）：
  - 时间条的满宽 = `spanSeconds`（名义窗长 + 决算类按块延长），所有块/填充段按**窗内相对秒**定位；
  - 有效秒数 < span（决算截断 / 时钟截短）时，条尾画一段「关窗」阴影；
  - 跨界块（`inAxisCount < count`）外框画成虚线 + 只有「在窗内」的那一段填实色 ——
    这正是用户 2026-10-18 那条口径的可视化（「小数这块要做完，不要显示一半骗一半」）。
  - ⚠ 与编辑器的**有意差异**（由 `axisBarGeometry` 的参数给，不是第二份实现）：本图的条 = 一窗的
    兑现 ⇒ `clampToTrack`（越界段只画到边界）；编辑器的块拖到窗外要露出真位置 ⇒ 不夹。

  ⚠ 配色只用**语义别名层**（`--line` / `--line-strong` / `--fill-hover` / `--fill-active` /
  `--fg-2` / `--fg-3` / `--app-*` / `--c-*-soft|strong`）：新代码直接写 `--wa-*` 会让
  `check-tokens` 的 alias 棘轮上涨（该棘轮只减不增）。
-->
<template>
  <div class="awc">
    <!-- 图例（形状 = 语义；颜色沿用主题令牌，双主题可读） -->
    <div class="awc-legend">
      <span class="awc-lg"><i class="awc-sw sw-done" />执行（实心段吃失衡易伤）</span>
      <span class="awc-lg"><i class="awc-sw sw-part" />跨界（虚线段不吃易伤）</span>
      <span class="awc-lg"><i class="awc-sw sw-fill" />窗尾填充</span>
      <span class="awc-lg"><i class="awc-sw sw-skip" />被跳过</span>
      <span class="awc-lg"><i class="awc-sw sw-idle" />关窗 / 无人打</span>
    </div>

    <div v-for="w in windows" :key="w.index" class="awc-win">
      <div class="awc-win-head">
        <span class="awc-win-no">{{ w.label }}</span>
        <span v-if="w.axisName" class="awc-axis" :title="`该窗来自「${w.axisName}」这条轴`">{{ w.axisName }}</span>
        <span class="awc-metric" :title="headTitle(w)">窗 {{ fmt(w.effectiveSeconds, 1) }}s</span>
        <span class="awc-metric" title="窗内动作占用（只算落在失衡内的那一段：普通招式按吃易伤比例折算，伤害前置招式按伤害段；越窗段归失衡外）">动作 {{ fmt(w.actionSeconds, 1) }}s</span>
        <span v-if="w.overlapSeconds > 0.05" class="awc-metric" title="跨角色块并行只计一次前台（合轴节省）">
          合轴省 {{ fmt(w.overlapSeconds, 1) }}s
        </span>
        <span v-if="w.fillSeconds > 0.05" class="awc-metric fill" title="轴块都打完之后，窗尾剩余时间由兜底平A/模块兜底池填上">
          填充 {{ fmt(w.fillSeconds, 1) }}s
        </span>
        <span
          v-if="w.idleSeconds !== null && w.idleSeconds > 0.05"
          class="awc-metric idle"
          title="窗口开着、轴块打完了、三个槽的平A预算也都见底 ⇒ 这段秒数没人打（不是打满）"
        >发呆 {{ fmt(w.idleSeconds, 1) }}s</span>
        <span v-if="w.idleSeconds === null" class="awc-metric" title="没有时间轴快照 ⇒ 发呆不可推演（不写 0，0 会被读成「打满」）">发呆 —</span>
        <span v-if="w.truncated" class="awc-tag" title="决算类块（佩洛伊斯·永陷幽囚 / 雨果终结）做完即清空窗口剩余失衡时间">决算截断</span>
        <span v-if="w.clippedByClock" class="awc-tag" title="窗口放不进剩余战斗时间 ⇒ 末窗被时钟截短（如实上报，不用吸收补齐抹平）">时钟截短</span>
        <span
          v-if="w.zeroedSeconds > 0.05"
          class="awc-tag"
          title="战斗结束 ⇒ 这一窗最后那段直接归零（与决算同机制：之后无事发生，不算发呆），条按归零后的长度画"
        >末窗归零 {{ fmt(w.zeroedSeconds, 1) }}s</span>
      </div>

      <div v-if="lanesOf(w).length === 0" class="awc-empty">这一窗一个动作都没执行（资源门控全跳过 / 空窗）</div>

      <div v-for="lane in lanesOf(w)" :key="lane.slot" class="awc-lane">
        <span class="awc-slot" :title="lane.name">{{ lane.name }}</span>
        <div class="awc-lane-body">
          <div class="awc-strip" :style="{ height: AXIS_TIME_PX.chartStripH + 'px' }">
            <span
              v-if="w.effectiveSeconds < w.spanSeconds - 0.05"
              class="awc-closed"
              :style="closedStyle(w)"
              :title="`窗口在 ${fmt(w.effectiveSeconds, 1)}s 处结束（满宽 ${fmt(w.spanSeconds, 1)}s），之后的时间不在失衡内`"
            />
            <span
              v-for="(b, bi) in lane.blocks"
              :key="'b' + bi"
              class="awc-block"
              :class="{ 'is-partial': b.partial }"
              :style="blockStyle(b, w)"
              :title="blockTitle(b)"
            >
              <i class="awc-block-in" :style="{ width: inBlockPct(b) }" />
              <em class="awc-block-text">{{ b.name }}<template v-if="b.count > 1">×{{ b.count }}</template></em>
            </span>
            <span
              v-for="(f, fi) in lane.fills"
              :key="'f' + fi"
              class="awc-fill"
              :style="fillStyle(f, w)"
              :title="fillTitle(f)"
            >填 {{ fmt(f.seconds, 1) }}s</span>
          </div>
          <div v-if="lane.skips.length > 0" class="awc-skips">
            <span
              v-for="(s, si) in lane.skips"
              :key="'s' + si"
              class="awc-skip"
              :title="skipTitle(s)"
            >✕ {{ s.name }} · {{ s.reasonText }}<template v-if="s.times > 1"> ×{{ s.times }}</template></span>
          </div>
        </div>
      </div>

      <div class="awc-ticks"><span>0s</span><span>{{ fmt(w.spanSeconds, 0) }}s</span></div>
    </div>

    <!-- 填充展开：同一秒数在伤害侧被兜底池展开成哪些真实招式（平A / 强特…）。
         ⚠ 数据由页面用**引擎同一个函数**（`expandExecutedToCounts`）算出，本组件不重算。 -->
    <div v-if="fillMoves.length > 0" class="awc-fill-moves">
      <div class="awc-subtitle">窗尾填充展开（与伤害侧同一个兜底池函数）</div>
      <div v-for="g in fillMoves" :key="g.slot" class="awc-fm-row">
        <span class="awc-slot">{{ g.name }}</span>
        <span class="awc-fm-sec">{{ fmt(g.seconds, 1) }}s →</span>
        <span v-for="(m, mi) in g.moves" :key="mi" class="awc-fm-move">
          {{ m.name }}{{ m.unit === 'seconds' ? ' ' + fmt(m.count, 2) + 's' : ' ×' + fmt(m.count, 2) }}
        </span>
        <span v-if="g.moves.length === 0" class="awc-fm-move awc-fm-none">（未声明兜底池 ⇒ 一律按平A秒数计）</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { fmt } from '@/utils/format'
import type { AxisWindowBlockView, AxisWindowFillView, AxisWindowLine, AxisWindowSkipView } from '@/composables/axisWindowView'
// 时间轴共享原语（与失衡轴编辑器同一份几何/换算；见 axisTimeline.ts 头注释）
import { AXIS_TIME_PX, axisBarGeometry, axisInnerPct } from '@/composables/axisTimeline'

/** 窗尾填充展开（按槽位分组；`moves` 为空 = 该角色没声明兜底池，秒数一律计平A） */
export interface AxisFillMoveGroup {
  slot: number
  name: string
  /** 该槽填充总秒数（跨全部窗口；与窗口条上的填充段同源，只是汇总） */
  seconds: number
  /**
   * 展开后的招式：`unit` 区分两种量纲——`basic` 的 count 是**秒数**（平A填充按秒计），
   * 兜底池其它招式（强特等）的 count 是**次数**。页面据此写「3.4s」或「×2」，不混量纲。
   */
  moves: { moveId: string; name: string; count: number; unit: 'seconds' | 'times' }[]
}

const props = defineProps<{
  /** 逐窗视图（`axisWindowView(...).windows`） */
  windows: AxisWindowLine[]
  /** 填充展开（可选；空数组 ⇒ 不显示这一段） */
  fillMoves?: AxisFillMoveGroup[]
}>()

const fillMoves = computed(() => props.fillMoves ?? [])

/** 一条道（= 一个槽位在本窗里的动作 / 填充 / 跳过） */
interface Lane { slot: number; name: string; blocks: AxisWindowBlockView[]; fills: AxisWindowFillView[]; skips: AxisWindowSkipView[] }

/**
 * 本窗要画的道：**只画有内容的槽**（动作 / 填充 / 跳过任一非空）。
 *
 * 为什么不全画 3 道：轴是每窗重放的模板，n 窗 × 3 道会把真正的差异（第 5 窗开始丢招）
 * 稀释在大量空道里；空槽由窗口标题行的「动作 0.0s」如实表达。
 */
function lanesOf(w: AxisWindowLine): Lane[] {
  const map = new Map<number, Lane>()
  const laneOf = (slot: number, name: string): Lane => {
    const hit = map.get(slot)
    if (hit) return hit
    const lane: Lane = { slot, name, blocks: [], fills: [], skips: [] }
    map.set(slot, lane)
    return lane
  }
  for (const b of w.actions) laneOf(b.slot, b.slotName).blocks.push(b)
  for (const f of w.fills) laneOf(f.slot, f.name).fills.push(f)
  for (const s of w.skipped) laneOf(s.slot, s.slotName).skips.push(s)
  return [...map.values()].sort((a, b) => a.slot - b.slot)
}

/** 0 时长的标记块（诺姆转连携等）的最小可见宽度（%）——条内块专属下限，不进共享表 */
const MIN_BLOCK_PCT = 1.2

/**
 * 条内几何走**共享原语** `axisBarGeometry`（与失衡轴编辑器同一份「起点 + 时长 → left/width」）。
 *
 * ⚠ 这里必须 `clampToTrack`：本图的条 = **一窗的兑现**，条宽就是窗长；越界段捅出轨道会让读者
 *   以为那一窗更长。编辑器相反（不夹，块拖到窗外要露出真位置）——差异由参数给，不是两份实现。
 */
function barBox(start: number, duration: number, span: number, minPct = 0) {
  const g = axisBarGeometry({ start, duration, span, minPct, clampToTrack: true })
  return {
    left: g.leftPct + '%',
    width: g.widthPct + '%',
    top: AXIS_TIME_PX.chartBarTop + 'px',
    height: AXIS_TIME_PX.chartBarH + 'px',
  }
}

function blockStyle(b: AxisWindowBlockView, w: AxisWindowLine) {
  return barBox(b.startTime, b.actionTime, w.spanSeconds, MIN_BLOCK_PCT)
}

function fillStyle(f: AxisWindowFillView, w: AxisWindowLine) {
  return barBox(f.startSeconds, f.seconds, w.spanSeconds)
}

/** 关窗阴影：满高（top/bottom 由 CSS 给），只给横向几何 */
function closedStyle(w: AxisWindowLine) {
  const g = axisBarGeometry({ start: w.effectiveSeconds, duration: Math.max(0, w.spanSeconds - w.effectiveSeconds), span: w.spanSeconds, clampToTrack: true })
  return { left: g.leftPct + '%', width: g.widthPct + '%' }
}

/** 在窗内部分占该块宽度的百分比（跨界时 < 100） */
function inBlockPct(b: AxisWindowBlockView): string {
  return axisInnerPct(b.inAxisCount, b.count) + '%'
}

function blockTitle(b: AxisWindowBlockView): string {
  const base = `${b.name}${b.count > 1 ? ' ×' + b.count : ''} · 单次 ${fmt(b.actionTime, 2)}s · 窗内起手 ${fmt(b.startTime, 2)}s`
  return b.partial
    ? `${base}｜窗内只占 ${fmt(b.inAxisCount, 2)}/${b.count}（${Math.round(axisInnerPct(b.inAxisCount, b.count))}%）：实心那段吃失衡易伤，虚线那段不吃`
    : base
}

function fillTitle(f: AxisWindowFillView): string {
  return `${f.name} 窗尾填充 ${fmt(f.seconds, 2)}s（从窗内 ${fmt(f.startSeconds, 2)}s 起）`
    + (f.defaulted ? '｜轴没声明兜底槽 ⇒ 引擎按轴内主C补位（产出端，不吃窗外平A池上限）' : '｜轴声明的兜底槽（受窗外平A池上限）')
}

function skipTitle(s: AxisWindowSkipView): string {
  return `本窗被跳过 ${s.times} 次 · 原因：${s.reasonText}`
}

function headTitle(w: AxisWindowLine): string {
  const occupied = w.actionSeconds - w.overlapSeconds + w.fillSeconds
  return `本窗有效 ${fmt(w.effectiveSeconds, 1)}s = 动作 ${fmt(w.actionSeconds, 1)}s − 合轴省 ${fmt(w.overlapSeconds, 1)}s + 填充 ${fmt(w.fillSeconds, 1)}s = ${fmt(occupied, 1)}s`
    + `, 其余 ${w.idleSeconds === null ? '不可推演' : fmt(w.idleSeconds, 1) + 's 无人打'}`
}
</script>

<style scoped>
.awc {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.awc-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 11px;
  color: var(--fg-3);
}

.awc-lg {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.awc-sw {
  display: inline-block;
  width: 18px;
  height: 9px;
  border-radius: 2px;
}

.awc-sw.sw-done {
  background: var(--c-info-soft);
  border: 1px solid var(--c-info);
}

.awc-sw.sw-part {
  background: repeating-linear-gradient(45deg, var(--c-warning-soft) 0 3px, transparent 3px 6px);
  border: 1px dashed var(--c-warning);
}

.awc-sw.sw-fill {
  background: repeating-linear-gradient(45deg, var(--c-success-soft) 0 3px, transparent 3px 6px);
  border: 1px dashed var(--c-success);
}

.awc-sw.sw-skip {
  background: var(--c-danger-soft);
  border: 1px solid var(--c-danger);
}

.awc-sw.sw-idle {
  background: var(--fill-hover);
  border: 1px dashed var(--line-strong);
}

.awc-win {
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 6px 8px 2px;
  background: var(--fill-hover);
}

.awc-win-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 4px;
}

.awc-win-no {
  font-size: 12px;
  font-weight: 700;
  color: var(--app-text);
}

.awc-axis {
  font-size: 11px;
  color: var(--fg-2);
  background: var(--fill-active);
  border-radius: 3px;
  padding: 1px 6px;
}

.awc-metric {
  font-size: 11px;
  color: var(--fg-3);
}

.awc-metric.fill {
  color: var(--c-success-strong);
}

.awc-metric.idle {
  color: var(--c-warning);
}

.awc-tag {
  font-size: 10px;
  color: var(--c-warning-strong);
  background: var(--c-warning-soft);
  border-radius: 3px;
  padding: 1px 5px;
}

.awc-empty {
  font-size: 11px;
  color: var(--fg-3);
  padding: 2px 0 4px;
}

.awc-lane {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 2px 0;
}

.awc-slot {
  flex: 0 0 62px;
  font-size: 11px;
  color: var(--fg-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-top: 1px;
}

.awc-lane-body {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

/* 条高由 AXIS_TIME_PX.chartStripH 内联给出（共享几何常量，见 axisTimeline.ts） */
.awc-strip {
  position: relative;
  background: var(--app-inset);
  border-radius: 3px;
  overflow: hidden;
}

.awc-closed {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--fill-hover);
  border-left: 1px dashed var(--line-strong);
}

.awc-block {
  position: absolute;
  border-radius: 3px;
  overflow: hidden;
  background: var(--c-info-soft);
  border: 1px solid var(--c-info);
  box-sizing: border-box;
}

.awc-block.is-partial {
  background: repeating-linear-gradient(45deg, var(--c-warning-soft) 0 3px, transparent 3px 6px);
  border: 1px dashed var(--c-warning);
}

.awc-block-in {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  background: var(--c-info-soft);
}

.awc-block.is-partial .awc-block-in {
  border-right: 1px solid var(--c-warning);
}

.awc-block-text {
  position: absolute;
  left: 3px;
  top: 0;
  line-height: 14px;
  font-size: 10px;
  font-style: normal;
  color: var(--app-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: clip;
  max-width: calc(100% - 4px);
}

.awc-fill {
  position: absolute;
  box-sizing: border-box;
  font-size: 10px;
  line-height: 14px;
  padding: 0 3px;
  color: var(--c-success-strong);
  background: repeating-linear-gradient(45deg, var(--c-success-soft) 0 3px, transparent 3px 6px);
  border: 1px dashed var(--c-success);
  border-radius: 3px;
  white-space: nowrap;
  overflow: hidden;
}

.awc-skips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.awc-skip {
  font-size: 10px;
  color: var(--c-danger-strong);
  background: var(--c-danger-soft);
  border: 1px solid var(--c-danger);
  border-radius: 3px;
  padding: 0 5px;
  line-height: 15px;
}

.awc-ticks {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--fg-3);
  padding: 2px 0 4px 70px;
}

.awc-fill-moves {
  border-top: 1px dashed var(--line);
  padding-top: 6px;
}

.awc-subtitle {
  font-size: 11px;
  font-weight: 600;
  color: var(--fg-2);
  margin-bottom: 4px;
}

.awc-fm-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 1px 0;
}

.awc-fm-sec {
  color: var(--c-success-strong);
}

.awc-fm-move {
  color: var(--fg-2);
  background: var(--fill-hover);
  border-radius: 3px;
  padding: 0 5px;
}

.awc-fm-move.awc-fm-none {
  color: var(--fg-3);
  background: transparent;
}
</style>
