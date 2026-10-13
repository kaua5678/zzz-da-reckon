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
 *   "subgroup": "火",                        // 二级分类 = 输出核心（主C）的属性，缺省归「未分属性」
 *                                            //   ↑ 别偷懒：漏填就掉进兜底桶，选「命破队·火」时
 *                                            //   该队直接消失（般岳队曾因此只剩 1 条可见）。
 *                                            //   口径单源 scripts/lib/presetCategories.mjs，
 *                                            //   回填/校验：node scripts/sync-preset-categories.mjs
 *                                            //   （一级只允许输出定位：强攻/命破/异常/锋御队——
 *                                            //    击破/支援是辅助位，2026-09-08 用户裁决删除该分类）
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
 * 预设来源两种，**成员集合唯一**（同 3 人 = 同一支队，顺序无关；只留一条）。
 *
 * ⚠ **2026-10-12 口径澄清**（用户报障「还有重复的队伍，仪玄卢西娅队」时核对得出）：
 * 上面 2026-09-11 那条裁决的原文是「手动预设的都可以删了……保留 auto- 为唯一来源」，
 * 但**实现与测试后来走的是反方向**——现存手编条目带着 auto 全无的策划字段
 * （`goldSteps` 加金顺序、`interactions`、`stunAxisPresetId`），且多处测试断言它们必须存在。
 * 实测核对（2026-10-12，逐字段查活消费者）后确认**冲突可以消解**：
 *   · `altAxes` —— **零活消费者**（T140c 已整条移出难度曲线，见 difficultyCurve.ts 头注释）；
 *   · `interactions` —— 有消费者（`applyPresetInteractions`），但般岳那条的值与模块
 *     `interactionDefaults` **逐位相同**（dodge10/parry6/block12/dual3）⇒ 冗余；
 *   · `goldSteps` —— 对**难度曲线**无用（`resolveGoldLevel(g, base, base)` 恒 0 步，
 *     即基础档与它无关），但**最优加金**路径会用它定候选顺序；用户 2026-10-12 裁决
 *     「加金顺序也可以丢，从来没写过，这个完全可以用算法自动加最优顺序」
 *     （`teamTimeline.ts#nextGoldCandidates` 已能从 catalog 推出同一套候选）。
 * ⇒ 结论：**按「成员集合唯一」去重，保留哪一条不看来源、只看该条是否已被引用**。
 *   本轮（2026-10-12）删掉的是 4 条 **auto- 孪生**（`auto-1371-1391-1451` / `auto-1471-1481-1451` /
 *   `auto-1611-1101-1211` / `auto-1611-1621-1211`），因为同组的手编条目被多处测试引用、
 *   且 `banyue-liuyin-lucia` 是 `stunAxisPresetId` 的唯一绑定方（该轴也可由队伍自动匹配命中）。
 *   生成器侧已加「跳过已被现有预设覆盖的成员集」（`scripts/gen-auto-presets.mjs`）防复发，
 *   结果面由 `src/data/__tests__/teamPresets.test.ts` 的「成员集合唯一」用例机器守住。
 *
 * 两类来源的差异（选择保留哪条时的判据）：
 *   · `auto-<主C-击破-辅助>.json` = `scripts/gen-auto-presets.mjs` 从**实战顶分归档**生成
 *     （最低金 +2 窗口；`goldSteps: []` 默认 01 基线、`interactions: []` 不预设，走角色职业基准 / 模块专属默认；旧 parry8/dodge4 占位已于 CC-261 删除）——**可重跑再生**；
 *   · 手编 `<主C>-<队友>-lucia.json` = 人工录入（可能带策划字段；**不可再生**，删前先查引用）。
 *   2026-09-11 删掉的 8 条手编重复项：yidhari-lycaon-liuyin / yixuan-qingyi/liuyin/norma /
 *   banyue-norma / billy-liuyin/norma（各自 auto- 孪生仍在；清单同步进 `data/__tests__/teamPresets.test.ts`）。
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
 *
 * 备选轴档 altAxes（2026-09-13 引入「高难一段」表达）：
 * 同一队伍的高难度轴（如 般琉卢 的 10大轴）——**T140c（2026-10-12）起不再进难度曲线**：
 * 曲线改为四个关键旋钮点后容纳不下第 5 个点，且实测该档在新结构下是**空操作**
 * （唯一带 altAxes 的预设，④ 切轴与不切轴逐位相同）⇒ 整条移出，「高难段」由 ④ 的**轴态**承载。
 * 数据字段保留（`validate:data` 契约不变），改 ④ 的构成前先读 `ENGINE_PIPELINE_GUIDE.md` §4 坑 43。
 */
import type { TeamPreset } from '@/types/teamPreset'

/** 文件形态 = JSON 契约登记的类型：validate:data 按它逐字段校验 `teamPresets/*.json`（scripts/lib/json-contract.mjs），加载时直接转型 */
export interface TeamPresetFile extends TeamPreset {
  disabled?: boolean
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

const presetFiles = Object.values(import.meta.glob('./teamPresets/*.json', { eager: true, import: 'default' })) as TeamPresetFile[]

export const teamPresets: TeamPreset[] = presetFiles
  .filter(p => !p.disabled)
  .map(({ disabled: _disabled, ...preset }) => preset)
  .flatMap(expandVariants)
  .sort((a, b) => a.name.localeCompare(b.name))

/** 未填 group 的预设归入的兜底分类（测试锁「不出现」——新预设必须归类） */
export const UNGROUPED_LABEL = '未分组'

// ========== 三级筛选（2026-09-03 用户：一级下拉装 99+ 条太多——先选职业、再选属性、后出队伍） ==========

// @fact preset:队伍分类口径 口径: 一级分类=队伍「输出核心」职业队名（强攻/命破/异常/锋御队），二级=该核心属性中文名；输出核心=槽位0（0=主C），槽位0 是击破/支援/防护等辅助位时退到队内第一个输出位；整队无输出位不收录。击破队/支援队/防护队不作为一级分类 | 据 用户 2026-09-08「击破队和支援队没必要分…他们是辅助，怎么能作为一个命名呢」+「自动按主C属性分」+ 复核「南宫羽队暂归异常队没啥问题」·复核@2026-09-09（删 edgeguard 别名键后 锋御队=sharpen 映射未变） | 验 src/data/__tests__/teamPresets.test.ts | 锚 scripts/lib/presetCategories.mjs#classifyPreset | 信 确认
/** 一级：职业（group；「未分组」恒最后） */
export const presetGroupLabels: string[] = [...new Set(teamPresets.map(p => p.group?.trim() || UNGROUPED_LABEL))]
  .sort((a, b) => a === UNGROUPED_LABEL ? 1 : b === UNGROUPED_LABEL ? -1 : a.localeCompare(b))

/**
 * 二级：该职业下的属性（subgroup；缺省归「未分属性」）。
 *
 * `group = null` = **不限职业** ⇒ 返回全部属性的并集（用户 2026-10-11：「点了职业和属性后就不能
 * 加其他队伍了…这不够自由」）。用 `null` 而不是「全部」哨兵字符串：哨兵会与真实分类名撞车
 * （预设分类名由 `scripts/lib/presetCategories.mjs` 生成，不在本文件的控制内）。
 */
export const PRESET_UNGROUPED_SUB = '未分属性'
export function presetSubgroupLabelsFor(group: string | null): string[] {
  const subs = [...new Set(
    teamPresets
      .filter(p => group === null || (p.group?.trim() || UNGROUPED_LABEL) === group)
      .map(p => p.subgroup?.trim() || PRESET_UNGROUPED_SUB),
  )]
  return subs.sort((a, b) => a === PRESET_UNGROUPED_SUB ? 1 : b === PRESET_UNGROUPED_SUB ? -1 : a.localeCompare(b))
}

/** 三级：该（职业, 属性）下的预设队伍。两级各自 `null` = 该级不筛（跨分类自由勾选，2026-10-11） */
export function presetsForFilter(group: string | null, subgroup: string | null): TeamPreset[] {
  return teamPresets.filter(p =>
    (group === null || (p.group?.trim() || UNGROUPED_LABEL) === group)
    && (subgroup === null || (p.subgroup?.trim() || PRESET_UNGROUPED_SUB) === subgroup),
  )
}

/** n-cascader 树（职业 → 属性 → 队伍；无二级时降为两级），供触发式选择（TeamConfigPage） */
export interface PresetCascadeNode {
  label: string
  value: string
  children?: PresetCascadeNode[]
}

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
