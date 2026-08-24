<template>
  <div class="page-root">
    <h2 class="page-title">倍率表系数演算记录</h2>

    <!-- ① 口径说明 -->
    <n-card size="small" class="block">
      <template #header>口径说明</template>
      <div class="notes">
        <p>实际录入值(Lv12) = 标准式(const + b×t [+ c×e]) × 等级系数（伤害×2 / 失衡×1.5）× 稀有度系数（限定S ×1.1 / 常驻S ×1.05，只乘伤害与失衡；命破伤害另×0.8）× <b>角色系数</b>。t = 动作时间，e = 强化特殊技耗能。特殊技不回能。</p>
        <p><b>闪能质量 ×1.2</b>：强特消耗闪能（Flash Energy Cost）时，四个耗能利用率系数（5.55835/4.175/1.909/4.86）先 ×1.2 再乘闪能量——相同闪能比相同能量多转化 20% 数值。锚点真斗已数据验证：强特耗 80 闪能代入后五列比值全部 ≈1.000。</p>
        <p>角色纵向系数 = 该角色各「干净类型」招式比值的中位数（排除强化特殊技、轻/重招架与未分类）；<b>版本直伤系数</b>取支援突击伤害列比值（支援突击通常不随角色变化，作锚点）。</p>
        <p>已验证样例：爱丽丝失衡 90%、伊德海莉喧响 ~49%（章鱼）、耀嘉音/琉音回能 50%、叶瞬光失衡 50%+喧响 80%。固化描述见 <code>docs/multiplier-record.md</code>（npm run gen:multiplier-record 再生成）。</p>
      </div>
    </n-card>

    <!-- ② 标准职业稀有度倍率表 -->
    <n-card size="small" class="block" title="标准职业稀有度倍率表（1级 A级基准式；Lv12 = 伤害×2 / 失衡×1.5，限定S伤害失衡再×1.1，常驻S×1.05，命破伤害×0.8）">
      <n-data-table
        size="small"
        :columns="stdColumns"
        :data="stdRows"
        :bordered="true"
        :single-line="false"
        :max-height="420"
      />
    </n-card>

    <!-- ③ 角色纵向系数总表 -->
    <n-card size="small" class="block" title="角色纵向系数总表（点击行查看单角色明细；偏离 100% 即该角色的专属系数）">
      <n-data-table
        size="small"
        :columns="verticalColumns"
        :data="verticalRows"
        :row-key="(r: AgentVerticalRow) => r.agentId"
        :row-props="verticalRowProps"
        :bordered="true"
        :single-line="false"
        :max-height="560"
      />
    </n-card>

    <!-- ④ 单角色招式明细 -->
    <n-card size="small" class="block" title="单角色招式明细">
      <n-select
        v-model:value="selectedAgentId"
        class="agent-select"
        filterable
        placeholder="选择角色"
        :options="agentOptions"
      />
      <n-data-table
        v-if="selectedAgentId"
        size="small"
        class="detail-table"
        :columns="detailColumns"
        :data="detailRows"
        :bordered="true"
        :single-line="false"
        :max-height="520"
      />
    </n-card>

    <!-- ⑤ 招式特定偏差清单 -->
    <n-card size="small" class="block" title="招式特定偏差清单（单招式比值偏离本角色列基准 ±5% 以上——连携增强 / 大招削弱一类设计空间）">
      <n-data-table
        size="small"
        :columns="deviationColumns"
        :data="report.deviations"
        :pagination="{ pageSize: 50 }"
        :bordered="true"
        :single-line="false"
        :max-height="520"
      />
    </n-card>

    <!-- ⑥ 快速支援时间校准 -->
    <n-card size="small" class="block" title="快速支援时间校准清单（actionTime 与喧响基准反推 t = 喧响值 ÷ 27.5 相对偏差 >15%）">
      <n-data-table
        size="small"
        :columns="calibrationColumns"
        :data="report.calibrations"
        :pagination="{ pageSize: 50 }"
        :bordered="true"
        :single-line="false"
        :max-height="420"
      />
    </n-card>

    <!-- ⑦ 待确认口径 -->
    <n-card size="small" class="block" title="待确认口径（按原表保留，不参与纵向聚合强约束）">
      <ul class="notes">
        <li>轻/重招架：标准常数采用数据校准值 95.511+130t / 95.178+130t（斜率固定 130，取主簇 47/53、48/54 条实录的隐含截距中位数；单角色推算的 92.4/89.1 偏低 ~3.4%，经确认改用全体平均）。连续招架 = 130t 不变。</li>
        <li>快速支援两版口径已定案：标准版 = 伤害 200t（原表 100t 系笔误）+ 原表其余列；翻倍版真实语义 = 录制时间只有一半（其秽盾基准 50t），评估时 ×2 还原，伤害 100t、其余列与标准版相同——还原后全列比值 ≈1.00。分版判据 = 喧响速率 ≥40/s；个别减半/离群记录由偏差清单呈现。</li>
        <li>倍率行融合：catalog 把一套招式拆成多行/多段时按配置加总为一个评估单元（前缀项/耗能只计一次）。已配置：星见雅「飞雪 #1+#2=斩击、#3+#4=追击」（融合后 = nanoka 官方倍率，代入公式 ≈1.001）、连携「春临 #1~#3」三段合一（≈1.000，逐段会有 ~0.38 假象）、仪玄「墨痕化形 #1+#2 / #3+#4」。</li>
        <li>仪玄强特：耗能口径与 catalog 一致（凝云术 2s 通道共 40 即 20/s、墨痕化形 #1=40、#4=20 且触发反击回复 10 能量接免费 #2/#3、墨烬影消=20），已恢复展示并按倍率行融合评估；其特调严重（斩击伤害 ~1.15、失衡 ~0.62 等），由偏差清单如实呈现。</li>
        <li>般岳「支援突击：冲霄」：金身格挡后招式，已按闪避反击公式定点改判并做时间修正 −1.5s（有效 t=1.167s；秽盾 150+100t 精确命中，积蓄/喧响 ≈1.000）；伤害/失衡 ~0.94/~0.93 为般岳自身特调。</li>
        <li>真斗「支援突击：孤影·断獠」：机制为弹刀后连续攻击、无支援突击公式，已改判闪避反击（纯 t 列喧响 27.5t / 积蓄 100t 精确命中）；伤害/失衡/秽盾为各段自有数值，真斗直伤系数记「—」。</li>
        <li>支援突击「#N」分段按同套合并（前缀项只计一次；苍角实证三列 ≈1.000）。</li>
        <li>强化特殊技：整体公式成立（伤害中位数 ~101%），但逐角色偏离大，属设计空间；闪能 ×1.2 规则已经真斗（耗 80 闪能）五列 ≈1.000 验证。耗能分摊机制已确认：露西两段各耗 60、各自成式（逐段评估即正确）；妮可 #1 为蓄力段（20 能量/s，倍率行 0.7418s）、#2/#3 为炮击（每次耗 60 并留能量场）、#4 为能量场——妮可逐段无单一标准式，明细仅供参考。</li>
        <li>普攻回能数据缺口：以下招式回能显式录 0，按「0% + 回能录入为0」展示且不参与纵向聚合——柚叶「狸之帐」、席德「霜蕊轮舞 #1/#2」、克拉蕾「血锻四式 ×4 / 锻星 ×3」、洛克茜「旋风锤」，真实值待第二源复核（gachabase 爬取脚本已备好）。爱丽丝「星芒圆舞曲」三段经 gachabase 双源确认为官方 0（非缺口），同样以 0% 展示。</li>
        <li>t=0 / 0.001 / 缺失的分段行视为录入噪声，不参与期望值计算。</li>
      </ul>
    </n-card>
  </div>
</template>

<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { NCard, NDataTable, NSelect, NTag } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import { useCatalogStore } from '@/stores/catalog'
import {
  MOVE_TYPE_LABELS,
  STANDARD_MULTIPLIER_TABLE,
  STANDARD_ROW_IDS,
  formatStdFormula,
  type MoveType,
  type StandardRowId,
} from '@/data/standardMultiplierTable'
import {
  deriveCoefficientReport,
  type AgentVerticalRow,
  type MoveDeviation,
  type MoveEval,
  type TimeCalibrationItem,
} from '@/composables/multiplierCoefficients'

const catalogStore = useCatalogStore()

const report = computed(() =>
  deriveCoefficientReport(catalogStore.catalog?.agents ?? [], catalogStore.catalog?.agentSkills ?? []),
)

const SPECIALTY_LABELS: Record<string, string> = {
  attack: '强攻',
  stun: '击破',
  anomaly: '异常',
  support: '支援',
  defense: '防护',
  rupture: '命破',
  edgeguard: '戍卫',
  sharpen: '锐化',
}

const ROW_LABELS: Record<StandardRowId, string> = {
  damage: '伤害',
  daze: '失衡',
  energy_recovery: '回能',
  decibel_recovery: '喧响',
  anomaly_buildup: '积蓄',
  ether_purify: '秽盾',
  attack_data_0: '专属资源',
}

function pct(v: number | null | undefined, digits = 1): string {
  return v == null ? '—' : `${(v * 100).toFixed(digits)}%`
}

/** 比值着色：±2% 内正常，±5% 内浅色，超出深色；>1 蓝（高于标准）、<1 橙（低于标准） */
function ratioStyle(ratio: number | null | undefined): Record<string, string> {
  if (ratio == null) return {}
  const d = Math.abs(ratio - 1)
  if (d <= 0.02) return {}
  const color = ratio > 1 ? '#7dd3fc' : '#fdba74'
  const bg = d <= 0.05 ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.12)'
  return { color, background: bg, borderRadius: '4px', padding: '0 4px', fontWeight: d > 0.05 ? '700' : '400' }
}

// ============ ② 标准表展示 ============

interface StdRow {
  moveType: MoveType
  label: string
  cells: Record<StandardRowId, string>
}

const stdRows: StdRow[] = (Object.keys(MOVE_TYPE_LABELS) as MoveType[]).map((moveType) => ({
  moveType,
  label: MOVE_TYPE_LABELS[moveType],
  cells: Object.fromEntries(
    STANDARD_ROW_IDS.map((rowId) => [rowId, formatStdFormula(STANDARD_MULTIPLIER_TABLE[moveType][rowId] ?? {})]),
  ),
})) as StdRow[]

const stdColumns: DataTableColumns<StdRow> = [
  { title: '招式类型', key: 'label', width: 190, render: (r) => r.label },
  ...STANDARD_ROW_IDS.map((rowId) => ({
    title: ROW_LABELS[rowId],
    key: rowId,
    render: (r: StdRow) => r.cells[rowId],
  })),
]

// ============ ③ 角色纵向系数总表 ============

const verticalRows = computed(() => report.value.vertical)

function verticalCell(rowId: StandardRowId) {
  return (row: AgentVerticalRow) => {
    const coef = row.coefficients[rowId]
    if (!coef) return '—'
    return h('span', { style: ratioStyle(coef.value) }, pct(coef.value))
  }
}

const verticalColumns: DataTableColumns<AgentVerticalRow> = [
  { title: '角色', key: 'name', width: 150, render: (r) => `${r.agentName} (${r.agentId})` },
  { title: '稀有度', key: 'rarity', width: 70 },
  { title: '职业', key: 'specialty', width: 80, render: (r) => SPECIALTY_LABELS[r.specialty] ?? r.specialty },
  { title: '失衡', key: 'daze', width: 90, render: verticalCell('daze') },
  { title: '喧响', key: 'decibel', width: 90, render: verticalCell('decibel_recovery') },
  { title: '积蓄', key: 'anomaly', width: 90, render: verticalCell('anomaly_buildup') },
  { title: '回能', key: 'energy', width: 90, render: verticalCell('energy_recovery') },
  { title: '秽盾', key: 'purify', width: 90, render: verticalCell('ether_purify') },
  {
    title: '直伤系数(支援突击)',
    key: 'directDamage',
    width: 130,
    render: (r) =>
      r.directDamage ? h('span', { style: ratioStyle(r.directDamage.value) }, pct(r.directDamage.value)) : '—',
  },
]

const selectedAgentId = ref<string>('1401')

function verticalRowProps(row: AgentVerticalRow) {
  return {
    style: 'cursor: pointer',
    onClick: () => {
      selectedAgentId.value = row.agentId
    },
  }
}

// ============ ④ 单角色招式明细 ============

const agentOptions = computed(() =>
  report.value.vertical.map((v) => ({ label: `${v.agentName} (${v.agentId})`, value: v.agentId })),
)

const detailRows = computed(() => report.value.moves.filter((m) => m.agentId === selectedAgentId.value))

function detailCell(rowId: StandardRowId) {
  return (row: MoveEval) => {
    const cell = row.cells.find((c) => c.rowId === rowId)
    if (!cell) return '—'
    return h('span', { style: ratioStyle(cell.ratio) }, pct(cell.ratio))
  }
}

const detailColumns: DataTableColumns<MoveEval> = [
  { title: '招式', key: 'moveName', minWidth: 220, render: (r) => `${r.moveName} (${r.moveId})` },
  { title: '类型', key: 'type', width: 150, render: (r) => r.moveTypeLabel },
  { title: 't(s)', key: 't', width: 70, render: (r) => (r.t == null ? '—' : String(Number(r.t.toFixed(3)))) },
  { title: '耗能', key: 'e', width: 76, render: (r) => (r.energy == null ? '—' : `${r.energy.value}${r.energy.kind === 'flashEnergy' ? '(闪)' : ''}`) },
  { title: '伤害', key: 'damage', width: 90, render: detailCell('damage') },
  { title: '失衡', key: 'daze', width: 90, render: detailCell('daze') },
  { title: '回能', key: 'energy', width: 90, render: detailCell('energy_recovery') },
  { title: '喧响', key: 'decibel', width: 90, render: detailCell('decibel_recovery') },
  { title: '积蓄', key: 'anomaly', width: 90, render: detailCell('anomaly_buildup') },
  { title: '秽盾', key: 'purify', width: 90, render: detailCell('ether_purify') },
  {
    // attack_data_0 专属资源（青衣闪络电压/星徽·比利决意等）：无标准式，只展示实际值
    title: '专属资源',
    key: 'attackData',
    width: 90,
    render: (r) => {
      const cell = r.cells.find((c) => c.rowId === 'attack_data_0')
      return cell ? String(Number(cell.actual.toFixed(1))) : '—'
    },
  },
  {
    title: '标记',
    key: 'flags',
    width: 160,
    render: (r) =>
      r.flags.length ? h(NTag, { size: 'tiny', type: 'warning', bordered: false }, { default: () => r.flags.join('；') }) : '',
  },
]

// ============ ⑤ 招式特定偏差清单 ============

const deviationColumns: DataTableColumns<MoveDeviation> = [
  { title: '角色', key: 'agentName', width: 140, render: (r) => `${r.agentName} (${r.agentId})` },
  { title: '招式', key: 'moveName', minWidth: 200, render: (r) => r.moveName },
  { title: '类型', key: 'type', width: 130, render: (r) => r.moveTypeLabel },
  { title: '列', key: 'rowId', width: 70, render: (r) => ROW_LABELS[r.rowId] },
  {
    title: '本招式比值',
    key: 'ratio',
    width: 100,
    render: (r) => h('span', { style: ratioStyle(r.ratio) }, pct(r.ratio)),
  },
  { title: '角色基准', key: 'baseline', width: 90, render: (r) => pct(r.baseline) },
  {
    title: '偏差',
    key: 'deviation',
    width: 110,
    render: (r) =>
      h('span', { style: ratioStyle(r.deviation) }, `${r.deviation > 1 ? '↑' : '↓'}${pct(Math.abs(r.deviation - 1))}`),
  },
]

// ============ ⑥ 时间校准清单 ============

const calibrationColumns: DataTableColumns<TimeCalibrationItem> = [
  { title: '角色', key: 'agentName', width: 140, render: (r) => `${r.agentName} (${r.agentId})` },
  { title: '招式', key: 'moveName', minWidth: 200, render: (r) => `${r.moveName} (${r.moveId})` },
  { title: 'actionTime', key: 'tAction', width: 100, render: (r) => r.tAction.toFixed(3) },
  { title: '喧响反推 t', key: 'tDecibel', width: 100, render: (r) => r.tDecibel.toFixed(3) },
    {
      title: '相对偏差',
      key: 'delta',
      width: 100,
      render: (r) => pct(Math.abs(r.tDecibel - r.tAction) / r.tAction, 0),
    },
  ]
</script>

<style scoped>
.page-root {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.page-title {
  margin: 0;
  font-size: 20px;
  color: #fff;
}

.block {
  background: rgba(255, 255, 255, 0.03);
}

.notes {
  margin: 0;
  padding-left: 18px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 13px;
  line-height: 1.9;
}

.agent-select {
  max-width: 280px;
  margin-bottom: 10px;
}

.detail-table {
  margin-top: 4px;
}
</style>
