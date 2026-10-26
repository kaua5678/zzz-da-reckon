/**
 * 队伍对比 ·「逐槽锁定」（用户 2026-10-25）。
 *
 * 用户原话：「这里我感觉确实修改栏太少了……自动加金的计算成本高吗？这里格里斯这种常驻角色
 * 还不能设置其金数，我想修改自由度大一点」+「C，默认肯定要快速，你有精确需求可以自己打开开关呀」。
 *
 * 为什么需要它：队伍对比页此前**只有**「总共花多少金」一个旋钮（`goldMin~goldMax`）+ 一个
 * 「最优加金」勾选框，**没有任何逐槽位控件**（`grep cinemaLevel|setCinemaLevel|setWEngine
 * src/views/TeamComparePage.vue` 零命中）。于是用户改不了「这笔金投给谁」，而 96 个预设里
 * 73 个 `goldSteps` 为空（`resolveGoldLevel` 钳到 `[基础金, 基础金+0]`）⇒ 金数滑块对
 * 四分之三的预设是空转，0-6 实际只有 1 个点。
 *
 * ## 口径（三条）
 *
 * 1. **配置码 = 该槽的最终配装**，走 `utils/setupCode` 的同一套解析（两位数字：左影画 / 右精炼，
 *    右位 0 读作「无专武」）。与自由对比页的配置码**逐字同源**，不另造一套。
 * 2. **锁定 = 该槽不再参与加金**：把该槽的 `goldSteps` / `standardSteps` 全部剔除，
 *    点循环里在 `applyGoldSteps` 之后**强制覆盖**该槽的影画/精炼。因此锁定槽的金数是"预支"的，
 *    不再是预算里可分配的那份——这正是「我就要这个配置」的语义。
 * 3. **不填 = 完全走原有路径**（逐位不变）。这条是硬约束：空 overrides 必须返回同一个 preset
 *    对象引用，让「没填锁 = 零改动」可以被 `toBe` 判据钉住。
 *
 * ## 常驻角色（用户点名的格莉丝一类）
 *
 * 引擎侧**早就支持**：`isLimitedSAgentId` 为假的角色，影画步进 `standardSteps`（不占金、默认全量应用），
 * 实测格莉丝(1181) C0→C6 队伍总伤 82.67M→99.39M 而金数恒为 2。缺的只是 UI 入口——
 * 96 个预设里 `standardSteps` 使用数为 **0**。本模块对常驻/限定一视同仁（金数按
 * `teamGoldOf` 如实算，常驻天然不占金），所以配置码对它们同样直接可用。
 */
import type { GoldStep, SlotCodeSpec, TeamPreset } from '@/types/teamPreset'
import type { useCatalogStore } from '@/stores/catalog'
import { signatureWEngineOf } from '@/composables/signatureWEngine'
import { presetBaseEngines } from '@/composables/goldStepsFromCatalog'
import { defaultDowngradeFor } from '@/data/downgradeWEngines'

type Catalog = ReturnType<typeof useCatalogStore>

/** 一个锁定槽的最终配装（配置码解析后） */
export interface SlotLockState {
  /** 影画 0-6 */
  cinema: number
  /** 精炼 1-5（配置码右位 0「无专武」已规整成 1 = 基础音擎本体） */
  wengine: number
}

/**
 * 三个槽位的锁定（`null` = 该槽不锁，走预设/加金）。
 *
 * 2026-10-26 起支持**第三位**：`{ cinema, wengine, downgradeWEngineId? }` ——
 * 右位 0（无专武）时必须能指定「穿哪件下位」，否则用户填了 00 就只能猜引擎挑了什么
 * （用户原话：「填00或者其他不带专武的配置时，我在哪里勾选下位武器呢？」）。
 */
export type SlotOverrides = readonly [SlotLockSpec | null, SlotLockSpec | null, SlotLockSpec | null]

/** 一个槽的锁定：配置码 + （右位 0 时）指定的下位音擎 id。形状与 `TeamPreset.slotCodes` 同一份声明。 */
export type SlotLockSpec = SlotCodeSpec

/** 无锁定（页面缺省；同一份常量给测试与页面共用，避免各写一份 [null,null,null]） */
export const NO_SLOT_OVERRIDES: SlotOverrides = [null, null, null]

/**
 * 把逐槽锁定应用到预设：剔除锁定槽的加金/常驻步，并给出该槽的最终配装。
 *
 * **无锁定 ⇒ 原样返回同一个 preset 引用**（不是浅拷贝）：调用方与测试都能用 `toBe` 证明
 * 「没填锁 = 零改动」，而不是靠数值比对猜。
 *
 * 锁定槽的「无专武」（配置码右位 0）规整成精炼 1：游戏里没有精炼 0，且该槽的**基础音擎**
 * （`preset.wEngines[slot]`）本来就该原样穿着——见 `freeCompare/engine.ts#applyCodeToSlot` 的
 * 同款说明（空音擎实测比专武本体低 34~41%，那是「没带武器」不是「没抽专武」）。
 */
export function applySlotOverrides(
  preset: TeamPreset,
  pageOverrides: SlotOverrides = NO_SLOT_OVERRIDES,
  catalog?: Catalog,
): {
  preset: TeamPreset
  locked: readonly [SlotLockState | null, SlotLockState | null, SlotLockState | null]
  /** 哪几个槽是**页面**覆盖的（预设自带的 slotCodes 不算——它的金已经进 baseGoldOf） */
  pageLocked: readonly boolean[]
} {
  // 来源两层：**页面三格 > 预设自带的 slotCodes**（页面是"这次想看什么"，预设是"这支队是什么"）。
  // 两层都空 ⇒ 原对象引用返回（零改动，见上面第 3 条口径）。
  const overrides: SlotOverrides = [
    pageOverrides[0] ?? preset.slotCodes?.[0] ?? null,
    pageOverrides[1] ?? preset.slotCodes?.[1] ?? null,
    pageOverrides[2] ?? preset.slotCodes?.[2] ?? null,
  ]
  if (overrides.every(o => o === null)) {
    return { preset, locked: [null, null, null], pageLocked: [false, false, false] }
  }
  const pageLocked = ([0, 1, 2] as const).map(s => pageOverrides[s] !== null)
  const lockedSlot = (slot: number): boolean => overrides[slot] !== null
  const drop = (s: GoldStep): boolean => !lockedSlot(s.slot)
  /**
   * 保留 `wengine: 0`（无专武）——下游 `lockSlots` 用它把精炼设为 1（游戏里没有精炼 0），
   * 音擎则由上面的 `wEngines` 决定（指定下位 / 留空给自动下位）。
   * ⚠ 旧实现把它规整成 1 并丢掉「无专武」这条信息 ⇒ 用户填 00 也照样穿专武（2026-10-26 修）。
   */
  const locked = overrides.map(o => (o ? { cinema: o.cinema, wengine: o.wengine } : null)) as
    unknown as readonly [SlotLockState | null, SlotLockState | null, SlotLockState | null]
  /**
   * 锁定槽的音擎也要跟着码落定 —— 否则金数算不到它：
   * `teamGoldOf` 只认 `wEngines` 里的 id，而「精炼 2」这种码只写在 `slotCodes` 里、
   * 基础音擎还是空的（预设 wEngines 留空 = 自动推荐）⇒ 实测 `baseGoldOf` 少算 3 金
   * （2026-10-25：诺姆30+丽娜65+克拉蕾61 应 20 金，实测 11 金）。
   * 码右位 ≥1 ⇒ 戴该角色专武（照 `freeCompare/engine.ts#applyCodeToSlot` 同口径）；
   * 右位 0（无专武）⇒ 清空，交给加金/下位择优。
   */
  const wEngines: [string, string, string] = [...(catalog ? presetBaseEngines(preset, catalog) : [
    preset.wEngines?.[0] ?? '', preset.wEngines?.[1] ?? '', preset.wEngines?.[2] ?? '',
  ])] as [string, string, string]
  if (catalog) {
    for (const s of [0, 1, 2] as const) {
      const lock = locked[s]
      const agentId = preset.team[s]
      if (!lock || !agentId) continue
      /**
       * 右位 ≥1 ⇒ 戴该角色专武（精炼 = 右位）。
       * 右位 **0（无专武）** ⇒ 必须穿**某件下位**，**绝不留空**：
       *  · 用户点名了 `downgradeWEngineId` ⇒ 用他选的那件；
       *  · 没点名 ⇒ 走 `data/downgradeWEngines` 的角色表 → 职业表第一件
       *    （用户 2026-10-26：「想找下位也有默认下位表，找不到再启动更重的算法」）。
       * ⚠ 空音擎实测比下位低 34~41%（那是「没带武器」而不是「没抽专武」）⇒ 留空是错数，不是"更保守"。
       */
      if (lock.wengine >= 1) {
        wEngines[s] = signatureWEngineOf(catalog, agentId)?.id ?? ''
      } else {
        const picked = overrides[s]?.downgradeWEngineId
        wEngines[s] = picked
          || defaultDowngradeFor(agentId, catalog.getAgent(agentId)?.specialty)
          || ''
      }
    }
  }
  return {
    preset: {
      ...preset,
      wEngines,
      goldSteps: preset.goldSteps.filter(drop),
      ...(preset.standardSteps ? { standardSteps: preset.standardSteps.filter(drop) } : {}),
    },
    locked,
    pageLocked,
  }
}

/** 该槽是否被锁定（页面展示用：锁了就不显示「这金投给谁」的悬念） */
export function isSlotLocked(overrides: SlotOverrides, slot: number): boolean {
  return overrides[slot] !== null
}
