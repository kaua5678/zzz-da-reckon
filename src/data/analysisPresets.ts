/**
 * 分析工作台 · 内置分析模板（问题模板）
 *
 * 用户口径（2026-10-17）：「我的不同对比只是预设了不同参数」。
 * 每个模板只回答一个社区常见问题，应用后用户仍可改任何参数——模板是**起点**，不是锁定场景。
 * 用户原话里的三个实体（规则 15：已 resolve 查证）来自 `viewAgentDefaults`，这里不另写 id。
 */
import { FREE_COMPARE_AGENTS } from './viewAgentDefaults'
import type { WorkbenchPreset } from '@/composables/freeCompare/presets'

const BURNICE = FREE_COMPARE_AGENTS.burnice
const PHOENIX = FREE_COMPARE_AGENTS.phoenix
const VELINA = FREE_COMPARE_AGENTS.velina

const base = {
  cinemaMax: 6,
  setupCodesText: '01,11,21,20',
  bossId: '',
  buffChoice: 'none',
  mateB: '',
  autoBuild: false,
} satisfies Partial<WorkbenchPreset>

export const BUILTIN_ANALYSIS_PRESETS: WorkbenchPreset[] = [
  {
    ...base,
    id: 'builtin:character',
    name: '角色配置对比',
    note: '柏妮思 vs 菲欧妮 × 配置码 01/11/21/20，看队伍总伤曲线',
    series: [{ agentId: BURNICE, code: '21' }, { agentId: PHOENIX, code: '21' }],
    axisId: 'setupCode',
    sliceKey: '',
    metricId: 'teamTotalDamage',
    mateA: VELINA,
    conditions: [],
    view: 'line',
  },
  {
    ...base,
    id: 'builtin:cinema',
    name: '命座曲线',
    note: '同一系列沿 0→6 命看提升；精炼固定在系列配置码',
    series: [{ agentId: BURNICE, code: '21' }, { agentId: PHOENIX, code: '21' }],
    axisId: 'cinema',
    sliceKey: '',
    metricId: 'teamTotalDamage',
    mateA: VELINA,
    conditions: [],
    view: 'line',
  },
  {
    ...base,
    id: 'builtin:wengine',
    name: '专武精炼',
    note: '0=无专武（按伤害择优下位）→ 精1..5；看抽专武/精炼的边际',
    series: [{ agentId: BURNICE, code: '21' }, { agentId: PHOENIX, code: '21' }],
    axisId: 'wengine',
    sliceKey: '',
    metricId: 'teamTotalDamage',
    mateA: VELINA,
    conditions: [],
    view: 'line',
  },
  {
    ...base,
    id: 'builtin:period',
    name: 'Boss 期数',
    note: '同一系列打所选 Boss 的各期（血量/抗性/弱点都变）；先在场景里选 Boss',
    series: [{ agentId: BURNICE, code: '21' }, { agentId: PHOENIX, code: '21' }],
    axisId: 'period',
    sliceKey: '',
    metricId: 'teamTotalDamage',
    mateA: VELINA,
    conditions: [],
    view: 'line',
  },
  {
    ...base,
    id: 'builtin:config-cinema-slice',
    name: '配置 × 命座切片',
    note: 'x = 专武精炼，切片 = 影画 0..6；一次出 7 张 2D 图或 3D',
    series: [{ agentId: BURNICE, code: '21' }, { agentId: PHOENIX, code: '21' }],
    axisId: 'wengine',
    sliceKey: 'axis:cinema',
    metricId: 'teamTotalDamage',
    mateA: VELINA,
    conditions: [],
    view: 'grid',
  },
  {
    ...base,
    id: 'builtin:velina-slice',
    name: '维琳娜命座切片',
    note: '用户原话场景：维琳娜 0/1/2.. 命是条件，柏妮思 vs 菲欧妮才是系列',
    series: [{ agentId: BURNICE, code: '21' }, { agentId: PHOENIX, code: '21' }],
    axisId: 'setupCode',
    sliceKey: 'condition:' + VELINA,
    metricId: 'teamTotalDamage',
    mateA: VELINA,
    conditions: [{ agentId: VELINA, cinema: 0 }],
    view: 'grid',
  },
]
