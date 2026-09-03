/**
 * 预设队伍库（队伍对比页）
 *
 * 录入方式：把 `<id>.json` 丢进 `src/data/teamPresets/` 文件夹（构建/刷新后自动加载），
 * 或复制 `_template.json` 改字段。`disabled: true` 的条目会被跳过（模板自带）。
 *
 * 数据形态：
 * {
 *   "id": "miyabi-yanagi-soukaku",
 *   "name": "雅柳苍（示例）",
 *   "group": "命破队",                       // 一级分类（下拉两级：分类 → 队伍），缺省归「未分组」
 *   "note": "加金顺序：雅 1 命 → 专武精炼 1 → 柳 2 命 …",
 *   "team": ["1081", "1071", "1041"],       // 槽位约定：0=主C、1=击破、2=辅助
 *   "wEngines": ["14121", "", ""],          // 缺省 '' = 自动推荐
 *   "driveDiscs": [{ "fourPieceSetId": "31500", "twoPieceSetId": "" }],
 *   "goldSteps": [
 *     { "label": "主C 1命", "slot": 0, "kind": "cinema", "value": 1 },
 *     { "label": "专武精炼1", "slot": 0, "kind": "wengine", "value": 2 }
 *   ],
 *   "standardSteps": [                       // 常驻角色配置（可选）：不占限定金，默认全量应用
 *     { "label": "莱卡恩 1命", "slot": 1, "kind": "cinema", "value": 1 }
 *   ],
 *   "interactions": [
 *     { "type": "parry", "count": 8 },
 *     { "type": "dodge", "count": 4 },
 *     { "type": "banyueGoldenParry", "count": 5, "weight": 1.5 }
 *   ]
 * }
 *
 * 金数口径：**总限定金** = 限定 S 角色本体1 + 限定音擎本体1 + 影画/精炼每级1；
 * 常驻 S 角色（莱卡恩/丽娜/猫又/11号/珂蕾妲/格莉丝）与 A 级角色、常驻音擎不计限定金。
 * 选择的目标限定金越界自动钳制到队伍 [基础金, 基础金+goldSteps 数]（见 teamCompare.ts）。
 * 常驻配置走 standardSteps（不占限定金，改文件后重跑对比）。
 * 难度口径：横轴难度 = Σ(count × weight)，权重查 INTERACTION_WEIGHTS，条目可覆盖；
 * 角色专属交互（如般岳金身弹刀）用自定义 type 加进清单即可。
 *
 * 难度变体（队伍分类）：同一队伍的不同操作难度档（如 般琉卢 的「5嗔火10大」vs「普通轴」）：
 *   "variants": [
 *     { "id": "normal", "name": "普通轴", "stunAxisPresetId": "preset-1471-1481-1451" },
 *     { "id": "wrath5-ult10", "name": "5嗔火10大",
 *       "note": "要求 5 次嗔火 + 琉音回能高（好评≥390）支撑 10 次终结技",
 *       "interactions": [ ... ],          // 缺省沿用本体 interactions
 *       "stunAxisPresetId": "…",          // 绑定失衡轴预设 id（10大轴捏好后填）
 *       "minGold": 8 }                    // 配置门槛：低于此总限定金不生成点
 *   ]
 * 加载时展开成独立条目：id = `${id}__${变体id}`、名 = `${name}·${变体名}`，
 * team/wEngines/goldSteps 共用本体；带 variants 的队伍本体条目不再单独出现。
 */
import type { SelectGroupOption, SelectOption } from 'naive-ui'
import type { TeamPreset } from '@/types/teamPreset'

export interface TeamPresetFile extends TeamPreset {
  disabled?: boolean
}

function isValidPreset(p: unknown): p is TeamPreset {
  if (!p || typeof p !== 'object') return false
  const o = p as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    Array.isArray(o.team) &&
    o.team.length === 3 &&
    o.team.every(t => typeof t === 'string') &&
    Array.isArray(o.goldSteps) &&
    (o.standardSteps === undefined || Array.isArray(o.standardSteps)) &&
    Array.isArray(o.interactions)
  )
}

/** 难度变体展开：带 variants 的预设 → 每变体一个独立条目（id/name 加后缀，变体字段覆盖本体） */
function expandVariants(preset: TeamPreset): TeamPreset[] {
  if (!preset.variants || preset.variants.length === 0) return [preset]
  return preset.variants.map(v => ({
    ...preset,
    id: `${preset.id}__${v.id}`,
    name: `${preset.name}·${v.name}`,
    note: v.note ? [preset.note, `【${v.name}】${v.note}`].filter(Boolean).join('\n') : preset.note,
    interactions: v.interactions ?? preset.interactions,
    stunAxisPresetId: v.stunAxisPresetId ?? preset.stunAxisPresetId,
    minGold: v.minGold ?? preset.minGold,
    variants: undefined,
    variantOf: preset.id,
  }))
}

const jsonModules = import.meta.glob('./teamPresets/*.json', { eager: true })

export const teamPresets: TeamPreset[] = Object.values(jsonModules)
  .map(m => (m as { default?: unknown }).default ?? m)
  .filter((p): p is TeamPresetFile => isValidPreset(p))
  .filter(p => !p.disabled)
  .map(({ disabled: _disabled, ...preset }) => preset)
  .flatMap(expandVariants)
  .sort((a, b) => a.name.localeCompare(b.name))

/** 未填 group 的预设归入的兜底分类（测试锁「不出现」——新预设必须归类） */
export const UNGROUPED_LABEL = '未分组'

/** n-select 单条选项 */
export interface TeamPresetOption {
  value: string
  label: string
}

/** n-select 一级分组选项（Naive UI group options：type='group' + children） */
export interface TeamPresetOptionGroup {
  type: 'group'
  label: string
  key: string
  children: TeamPresetOption[]
}

/**
 * 分组下拉选项（两级：分类 → 队伍；分类名 = 一级分类 + 二级分类合成
 * 「一级 · 二级」——2026-09-03 用户「太多了需要二级分类」）。
 * 三个消费点（首页预设下拉/保存弹窗、队伍对比页、击破对比页）共用。组名按
 * localeCompare 排序、「未分组」恒排最后，组内沿用 teamPresets 的名称序。
 */
export const teamPresetGroupOptions: Array<SelectOption | SelectGroupOption> = (() => {
  const groups = new Map<string, TeamPresetOption[]>()
  for (const p of teamPresets) {
    const label = [p.group?.trim() || UNGROUPED_LABEL, p.subgroup?.trim()].filter(Boolean).join(' · ')
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push({ value: p.id, label: p.name })
  }
  return [...groups.entries()]
    .sort(([a], [b]) =>
      a === UNGROUPED_LABEL ? 1 : b === UNGROUPED_LABEL ? -1 : a.localeCompare(b),
    )
    .map(([label, children]) => ({ type: 'group' as const, label, key: label, children }))
})()


// ========== 三级筛选（2026-09-03 用户：一级下拉装 99+ 条太多——先选职业、再选属性、后出队伍） ==========

/** 一级：职业（group；「未分组」恒最后） */
export const presetGroupLabels: string[] = [...new Set(teamPresets.map(p => p.group?.trim() || UNGROUPED_LABEL))]
  .sort((a, b) => a === UNGROUPED_LABEL ? 1 : b === UNGROUPED_LABEL ? -1 : a.localeCompare(b))

/** 二级：该职业下的属性（subgroup；缺省归「未分属性」） */
export const PRESET_UNGROUPED_SUB = '未分属性'
export function presetSubgroupLabelsFor(group: string): string[] {
  const subs = [...new Set(
    teamPresets
      .filter(p => (p.group?.trim() || UNGROUPED_LABEL) === group)
      .map(p => p.subgroup?.trim() || PRESET_UNGROUPED_SUB),
  )]
  return subs.sort((a, b) => a === PRESET_UNGROUPED_SUB ? 1 : b === PRESET_UNGROUPED_SUB ? -1 : a.localeCompare(b))
}

/** 三级：该（职业, 属性）下的预设队伍 */
export function presetsForFilter(group: string, subgroup: string): TeamPreset[] {
  return teamPresets.filter(p =>
    (p.group?.trim() || UNGROUPED_LABEL) === group
    && (p.subgroup?.trim() || PRESET_UNGROUPED_SUB) === subgroup,
  )
}

/** n-cascader 树（职业 → 属性 → 队伍；无二级时降为两级），供触发式选择（TeamConfigPage） */
export interface PresetCascadeNode {
  label: string
  value: string
  children?: PresetCascadeNode[]
}
export const teamPresetCascadeOptions: PresetCascadeNode[] = presetGroupLabels.map(group => ({
  label: group,
  value: group,
  children: presetSubgroupLabelsFor(group).map(sub => ({
    label: sub,
    value: `${group}::${sub}`,
    children: presetsForFilter(group, sub).map(p => ({ label: p.name, value: p.id })),
  })),
}))

/** 默认筛选：第一个「真的有队伍」的（职业, 属性）——避免初始落到空组显示异常（2026-09-03） */
export function firstNonEmptyFilter(): { group: string; subgroup: string } {
  // 优先含手编预设（非 auto）的组合——初始默认别落在全是 auto 队伍的组（用户 2026-09-03）
  for (const g of presetGroupLabels) {
    for (const sub of presetSubgroupLabelsFor(g)) {
      if (presetsForFilter(g, sub).some(p => !p.id.startsWith('auto-'))) return { group: g, subgroup: sub }
    }
  }
  for (const g of presetGroupLabels) {
    for (const sub of presetSubgroupLabelsFor(g)) {
      if (presetsForFilter(g, sub).length > 0) return { group: g, subgroup: sub }
    }
  }
  return { group: presetGroupLabels[0] ?? '未分组', subgroup: PRESET_UNGROUPED_SUB }
}
