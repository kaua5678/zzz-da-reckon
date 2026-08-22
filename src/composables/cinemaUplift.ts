/**
 * 命座提升率分析（逐级影画的伤害增量 + 死数据自检）
 *
 * 从 `views/ResourceUtilizationPage.vue` 抽出来的原因：这段逻辑是本项目**最高频事故类型**
 * （「机制录了但没接进计算」）的唯一检测器，AGENTS 规则 5 却只能靠人去页面上肉眼找橙色
 * 「⚠无变化」角标。埋在 .vue 里意味着测试用不了它。抽到这里后：
 * - 页面照旧调用（展示逐级提升率 + 自检角标）；
 * - 测试可以直接调用，把「命座必须有效果」变成红灯（见 `__tests__/cinemaUplift.test.ts`；
 *   另有零成本的全角色版不变量在 `allAgentsSweep.test.ts`）。
 *
 * 口径（沿用页面原实现，未改数值语义）：
 * - **固定失衡次数**：命座提升率 = 只变命座的同场景对比。3/5 命的技能等级会抬失衡值 →
 *   失衡次数联动放大成 20%+ 的假提升（失衡次数↑ → 连携/喧响↑ → 失衡总量自激，阈值无稳定点），
 *   因此用 `enemy.stunCountLock` 把失衡次数锁在当前收敛值上再逐级对比。
 * - **自检三态**：`ok` = 局内面板有字段变化；`execLevel` = 面板无变化但伤害有移动（含负号——
 *   资源侧联动可能被时间预算抵消，如卢西娅C4帷幕喧响，命座定案 2026-08）
 *   （执行级效果：moveId 增伤/暴伤/附伤，正常）；`unimplemented` = 面板无变化且伤害无提升
 *   （效果可能完全没接进计算 —— 需要人看的信号）。
 *
 * 注意：本函数会**临时改写 configStore**（命座等级 / stunCountLock）并在 finally 恢复现场。
 * 这是当前引擎只能「改全局 store → 读 computed」驱动的后果，不是本模块的设计选择。
 */
import { nextTick } from 'vue'
import type { useConfigStore } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
import { computePanelPhases } from '@/composables/resourceCalc/helpers'

export interface CinemaUpliftEntry {
  /** 目标命座等级（本条 = 从 to-1 升到 to） */
  to: number
  /** 伤害提升百分比 */
  gainPct: number
  /** 本级命座切换前后的全队终结技总次数（检测加喧响/加能量类命座是否推动大招 +1） */
  ultBefore: number
  ultAfter: number
  /** 本级命座切换前后该角色局内面板有变化的字段（无字段变化 = 效果可能未接进计算） */
  changedFields: string[]
  /** 自检结论：ok 有字段变化 / execLevel 无面板变化但伤害有移动（含负号）/ unimplemented 疑似未实现 */
  warn: 'ok' | 'execLevel' | 'unimplemented'
}

export interface CinemaUpliftRow {
  slot: number
  agentId: string
  name: string
  entries: CinemaUpliftEntry[]
}

/** 判定 execLevel 与 unimplemented 的伤害变化阈值（百分比，取绝对值）。零移动才是「未接入」。 */
export const UPLIFT_EPSILON_PCT = 0.05

export interface AnalyzeCinemaUpliftParams {
  configStore: ReturnType<typeof useConfigStore>
  catalogStore: ReturnType<typeof useCatalogStore>
  /** 读当前配置下的全队总伤害（页面传 teamTotalDamage 的 getter） */
  readDamage: () => number
  /** 读当前配置下的全队终结技总次数 */
  readUltimateTotal: () => number
  /** 锁定的失衡次数（页面传当前收敛的 stunPoolResult.stunCount；<=0 表示不锁） */
  targetStunCount: number
  /** 要分析的槽位，默认 0/1/2 */
  slots?: number[]
  /** 最高命座等级，默认 6 */
  maxLevel?: number
  /** 角色名解析（页面传 agentNames 映射；缺省回落 catalog 名） */
  resolveName?: (agentId: string, slot: number) => string
}

/**
 * 逐槽位、逐级计算命座提升率与自检结论。
 * 全程只读结果、临时写 store，返回前恢复命座与失衡锁。
 */
export async function analyzeCinemaUplift(params: AnalyzeCinemaUpliftParams): Promise<CinemaUpliftRow[]> {
  const {
    configStore, catalogStore, readDamage, readUltimateTotal,
    targetStunCount, slots = [0, 1, 2], maxLevel = 6, resolveName,
  } = params

  const originalCinemas = configStore.team.map(c => c?.cinemaLevel ?? 0)
  const originalStunLock = configStore.enemy.stunCountLock
  const rows: CinemaUpliftRow[] = []

  /**
   * 锁定失衡次数后读伤害：3/5 命抬技能等级 → 失衡值↑ → 失衡次数联动放大成假提升，
   * 故按「操作够就能打 N 次失衡」的用户口径把次数钉死再比。
   */
  async function fixedStunDamage(): Promise<number> {
    if (targetStunCount > 0) {
      configStore.enemy.stunCountLock = targetStunCount
      await nextTick()
      const dmg = readDamage()
      configStore.enemy.stunCountLock = -1
      await nextTick()
      return dmg
    }
    return readDamage()
  }

  try {
    for (const slot of slots) {
      const char = configStore.team[slot]
      if (!char?.agentId) continue
      const name = resolveName?.(char.agentId, slot)
        || catalogStore.getAgent(char.agentId)?.name?.zhCN
        || `槽${slot + 1}`
      const entries: CinemaUpliftEntry[] = []

      for (let to = 1; to <= maxLevel; to++) {
        configStore.setCinemaLevel(slot, to - 1)
        configStore.syncTeammateBuffsFromTeam()
        const base = await fixedStunDamage()
        const ultBefore = readUltimateTotal()
        const panelBefore = computePanelPhases(slot, configStore, catalogStore)?.inCombat ?? null

        configStore.setCinemaLevel(slot, to)
        configStore.syncTeammateBuffsFromTeam()
        const next = await fixedStunDamage()
        const ultAfter = readUltimateTotal()
        const panelAfter = computePanelPhases(slot, configStore, catalogStore)?.inCombat ?? null

        const changedFields = panelBefore && panelAfter
          ? Object.keys(panelAfter).filter(k => Math.abs((panelAfter[k] ?? 0) - (panelBefore[k] ?? 0)) > 1e-9)
          : []
        const gainPct = base > 0 ? ((next - base) / base) * 100 : 0
        // 三态判定：面板字段变化 → ok；无面板变化但伤害移动（|gain| ≥ ε，含负号）→ execLevel
        // ——伤害发生符号变化本身就是执行/资源级生效的证据（如卢西娅C4帷幕喧响挤占时间预算，
        // 命座定案 2026-08：预算极紧时可为轻微负增益），不是死数据；零移动才是未接入。
        const warn: CinemaUpliftEntry['warn'] = changedFields.length > 0
          ? 'ok'
          : Math.abs(gainPct) >= UPLIFT_EPSILON_PCT
            ? 'execLevel' // 面板无变化但伤害有移动：执行级效果（moveId 增伤/暴伤/附伤/资源侧联动等）
            : 'unimplemented' // 无字段无伤害：效果可能未接进计算
        entries.push({ to, gainPct, ultBefore, ultAfter, changedFields, warn })
      }
      rows.push({ slot, agentId: char.agentId, name, entries })
    }
  } finally {
    for (let i = 0; i < configStore.team.length; i++) {
      configStore.setCinemaLevel(i, originalCinemas[i] ?? 0)
    }
    configStore.enemy.stunCountLock = originalStunLock
    configStore.syncTeammateBuffsFromTeam()
    await nextTick()
  }

  return rows
}
