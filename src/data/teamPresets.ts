/**
 * 预设队伍库（队伍对比页）
 *
 * ## 文件只带 `team`（用户 2026-10-26 裁决）
 *
 * > 「预设队伍只需带 3 个人的信息就行，其他配置交给预设金数或者其他模块就行」
 * > 「买金是队伍对比中的内容吗，那个和这个没关系，他也是只需要 team，金数需要自己设置，
 * >   配置也要自己设置。你不设置我怎么知道你想对比什么？顶多支持你一个默认配置，然后你在这基础上改。」
 *
 * 所以 `teamPresets/*.json` 的**唯一必填字段是 `team`**（外加 `id`）。其余一律**派生**：
 *
 * | 字段 | 来源 | 为什么不能进文件 |
 * |---|---|---|
 * | `name` | 三个角色名用 `+` 连接 | 跟着 catalog 走，角色改名不用回填 |
 * | `group`/`subgroup` | `scripts/lib/presetCategories.mjs#classifyPreset` | 分类是**规则**（输出核心职业 + 属性），不是数据 |
 * | `wEngines`（基础档） | `goldStepsFromCatalog#presetBaseEngines` | = 主页「配装推荐·一键应用」同一口径（限定角色带专武，其余带不占金的音擎） |
 * | `goldSteps`（加金阶梯） | `goldStepsFromCatalog#catalogGoldSteps` | 用户裁决 2026-10-12「加金顺序可以丢，完全可以用算法自动加最优顺序」 |
 * | `interactions` | 角色模块 `interactionDefaults` / 职业基准（全 0） | 用户 2026-09-11「完全不需要以前这个死数值」 |
 * | `note` | —— | 零消费者（34 KB 散文）；出处已在 git 历史与 `run-archive.json` |
 *
 * **仍然留在文件里的可选字段**（= 用户的**显式**配置，缺省即不写）：
 *   · `stunAxisPresetId` —— 绑定失衡轴（当前唯一一条：`banyue-liuyin-lucia`）；
 *   · `interactions` —— 只手填过的队写（当前两条般岳队 = 用户 2026-09-08 确认的 10/6/12/3）；
 *   · `goldSteps` / `standardSteps` —— 只有「预设金数 → 保存到预设文件」写回的**用户配置**会落这两个键；
 *   · `disabled` —— 停用；`variants` / `altAxes` / `minGold` / `slotCodes` / `autoEngine` 等契约字段保留（当前无数据用）。
 *
 * **`name` / `group` / `subgroup` 仍在文件里**：它们是「这支队叫什么、归哪一类」的**策划标签**
 * （分类口径单源 `scripts/lib/presetCategories.mjs`，`validate:data` 逐条重算比对），不是配装。
 *
 * ## 队伍身份 = 成员集合（顺序无关）
 *
 * 同 3 人换槽位仍是同一支队，只留一条（判据 `data/__tests__/teamPresets.test.ts`「成员集合唯一」）。
 * 生成器 `scripts/gen-auto-presets.mjs` 从实战顶分归档产出 `auto-*`，并跳过已被现有预设覆盖的成员集。
 *
 * ## 金数口径（队伍对比页的事，不是预设文件的事）
 *
 * **总限定金** = 限定 S 角色本体 1 + 限定音擎本体 1 + 影画/精炼每级 1；常驻 S / A 级角色与常驻音擎不计。
 * 基础档 = 0 命 1 精（01）；加金从基础档往上按 `goldSteps` 逐步应用，越界钳制到
 * `[基础金, 基础金 + 步数]`（见 `teamCompare#resolveGoldLevel`）。
 *
 * ## 下位替代（不花金的那件）不是基础档
 *
 * 基础档永远是「干净的 01」；想比「没专武」时穿什么，查 `src/data/downgradeWEngines.ts` 的下位表
 * （角色专属表 → 职业默认表 → 找不到才启动按伤害择优）。
 */
import type { GoldStep, InteractionItem, TeamPreset } from '@/types/teamPreset'

/**
 * 文件形态 = JSON 契约登记的类型：validate:data 按它逐字段校验 `teamPresets/*.json`
 * （scripts/lib/json-contract.mjs），加载时直接转型。
 *
 * 与 `TeamPreset` 的差别只有两处，都是「文件里可以不写、加载时补缺省」：
 *  · `goldSteps` / `interactions` **可选**（缺省 = 加金阶梯由 catalog 派生、交互走角色职业基准）；
 *  · `disabled` = 停用开关（模板自带）。
 */
export interface TeamPresetFile extends Omit<TeamPreset, 'goldSteps' | 'interactions'> {
  goldSteps?: GoldStep[]
  interactions?: InteractionItem[]
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

/**
 * 文件 → 完整预设：**只补两个必填数组的缺省**，其余原样。
 *
 * 为什么不是「全字段派生」：`name` / `group` / `subgroup` 是策划标签（分类口径单源在
 * `scripts/lib/presetCategories.mjs`，`validate:data` 逐条重算比对），仍是数据不是规则；
 * 而**配装类字段（wEngines / goldSteps / interactions）不再允许写进文件**——
 * 它们分别由 `goldStepsFromCatalog#presetBaseEngines`（基础档 = 主页一键搭配同口径）、
 * `goldStepsForPreset`（加金阶梯）、角色模块 `interactionDefaults` 派生。
 * 这里补空数组只是让类型成立：空 = 「没声明」，消费方按缺省语义处理（01 基线 / 角色职业基准）。
 */
function derivePreset(file: TeamPresetFile): TeamPreset {
  return {
    ...file,
    goldSteps: file.goldSteps ?? [],
    interactions: file.interactions ?? [],
  }
}

export const teamPresets: TeamPreset[] = presetFiles
  .filter(p => !p.disabled)
  .map(({ disabled: _disabled, ...preset }) => derivePreset(preset as TeamPresetFile))
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
