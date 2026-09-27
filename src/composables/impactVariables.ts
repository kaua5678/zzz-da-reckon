/**
 * 伤害影响分析的变量表与读写（CC-53，2026-09-27）：静态变量（core/impactVars）+ 动态变量（队伍机制设置、柏妮思异放占比）。
 *
 * 为什么放编排层：原先 ImpactChart.vue 直接 import 引擎的 `IMPACT_VARIABLES / readImpactVar / writeImpactVar`（判据 7），
 * 并在组件里自己决定「机制设置 `%` 变量按 ×100 展示」「柏妮思占比变量的自动值取异常覆盖率」这些口径。
 * 收拢后组件只保留 settingMap（经 agentMechanicView 门面）、采样循环、渐进渲染与计时。
 *
 * 口径：逐行照搬原组件（789a27e 版 :161–236），不改行为：
 * - 变量顺序 = 静态表 → 机制设置（settingMap 的插入顺序）→ 柏妮思各元素占比（覆盖率 >0 的元素，按 coverageRate 的键序）；
 * - `setting.<id>`：读 = getMechanicSetting(id, meta.default ?? 1)，`%` 后缀 ×100；写 = `%` 后缀 ÷100；
 * - `setting.burnice.releaseShare:<元素>`：读 = 已存值 ×100，未存则取覆盖率 ×100；写 = ÷100；
 * - 其余 id 交给 core 的 readImpactVar / writeImpactVar。
 *
 * ⚠ 写死角色 ID：`BURNICE_ID = '1171'`（原组件 :171 同款）。本文件不在 agentId 棘轮度量面
 *   （度量面 = useResourceCalc.ts + resourceCalc/*.ts，见 scripts/lib/agent-branch-ratchet.mjs#listAgentBranchFiles），
 *   搬过来是为了让组件不再含引擎口径；声明化（改成柏妮思模块声明「异放占比变量」能力）登记在遗留项
 *   「展示层/编排层写死角色 ID 需单独立卡」，同款还有 ResourceUtilizationPage.vue:~420、FreeComparePage.vue:~261。
 */
import { IMPACT_VARIABLES, readImpactVar, writeImpactVar, type ImpactVariable } from '@/core/impactVars'
import type { MechanicSetting } from '@/types/resource'
import type { Agent } from '@/types/catalog'
import type { useConfigStore } from '@/stores/config'

export type { ImpactVariable }

type ConfigStore = ReturnType<typeof useConfigStore>
/** 每元素异常覆盖率（0~1）；来自 useResourceCalc().anomalyPoolResult.coverage.perElementCoverageRate，可缺省 */
export type ElementCoverageRate = Readonly<Record<string, number>> | undefined

const BURNICE_ID = '1171'
const BURNICE_SHARE_PREFIX = 'burnice.releaseShare:'
const ELEMENT_LABELS: Record<string, string> = { physical: '物理', fire: '火', ice: '冰', electric: '电', ether: '以太', wind: '风', lumiflux: '辉光' }

function settingIdOf(id: string): string | null {
  const m = id.match(/^setting\.(.+)$/)
  return m ? m[1]! : null
}

/** 下拉可选的全部影响变量（静态 + 动态），顺序与原组件 `allVars` 一致 */
export function buildImpactVariables(
  team: ReadonlyArray<{ agentId?: string | null }>,
  settingMap: ReadonlyMap<string, MechanicSetting>,
  getAgent: (id: string) => Pick<Agent, 'id' | 'teammateBuffId'> | null | undefined,
  coverageRate: ElementCoverageRate,
): ImpactVariable[] {
  const vars: ImpactVariable[] = []
  for (const [id, setting] of settingMap) {
    const range = setting.suffix === '%'
      ? [(setting.min ?? 0) * 100, (setting.max ?? 100) * 100]
      : [setting.min ?? 0, setting.max ?? 100]
    vars.push({ id: `setting.${id}`, label: setting.label, defaultRange: range as [number, number], suffix: setting.suffix })
  }
  const burniceSlot = team.findIndex(char => {
    const agent = char.agentId ? getAgent(char.agentId) : null
    return agent?.id === BURNICE_ID || agent?.teammateBuffId === BURNICE_ID
  })
  if (burniceSlot >= 0) {
    for (const [element, rate] of Object.entries(coverageRate ?? {})) {
      if (rate <= 0) continue
      vars.push({
        id: `setting.${BURNICE_SHARE_PREFIX}${element}`,
        label: `柏妮思异放·${ELEMENT_LABELS[element] ?? element}占比`,
        defaultRange: [0, 100],
        suffix: '%',
      })
    }
  }
  return [...IMPACT_VARIABLES, ...vars]
}

/** 读变量当前值（展示单位：`%` 变量为 0~100） */
export function readImpactVariable(
  id: string,
  configStore: ConfigStore,
  settingMap: ReadonlyMap<string, MechanicSetting>,
  coverageRate: ElementCoverageRate,
): number {
  const settingId = settingIdOf(id)
  if (settingId) {
    if (settingId.startsWith(BURNICE_SHARE_PREFIX)) {
      const element = settingId.slice(BURNICE_SHARE_PREFIX.length)
      const stored = configStore.mechanicSettings[settingId]
      const auto = (coverageRate?.[element] ?? 0) * 100
      return stored !== undefined ? stored * 100 : auto
    }
    const meta = settingMap.get(settingId)
    const raw = configStore.getMechanicSetting(settingId, meta?.default ?? 1)
    return meta?.suffix === '%' ? raw * 100 : raw
  }
  return readImpactVar(configStore, id)
}

/** 写变量（入参为展示单位；写入 store 触发响应式重算） */
export function writeImpactVariable(
  id: string,
  value: number,
  configStore: ConfigStore,
  settingMap: ReadonlyMap<string, MechanicSetting>,
): void {
  const settingId = settingIdOf(id)
  if (settingId) {
    if (settingId.startsWith(BURNICE_SHARE_PREFIX)) {
      configStore.setMechanicSetting(settingId, value / 100)
      return
    }
    const meta = settingMap.get(settingId)
    configStore.setMechanicSetting(settingId, meta?.suffix === '%' ? value / 100 : value)
    return
  }
  writeImpactVar(configStore, id, value)
}
