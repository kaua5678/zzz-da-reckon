/**
 * 伤害影响分析的变量表与读写（CC-53，2026-09-27）：静态变量（core/impactVars）+ 动态变量（队伍机制设置、柏妮思异放占比）。
 *
 * 为什么放编排层：原先 ImpactChart.vue 直接 import 引擎的 `IMPACT_VARIABLES / readImpactVar / writeImpactVar`（判据 7），
 * 并在组件里自己决定「机制设置 `%` 变量按 ×100 展示」「柏妮思占比变量的自动值取异常覆盖率」这些口径。
 * 收拢后组件只保留 settingMap（经 agentMechanicView 门面）、采样循环、渐进渲染与计时。
 *
 * 口径：逐行照搬原组件（789a27e 版 :161–236），不改行为：
 * - 变量顺序 = 静态表 → 机制设置（settingMap 的插入顺序）→ 各异放占比声明 × 覆盖率 >0 的元素（按 coverageRate 的键序）；
 * - 机制设置变量 `setting.<id>`：读 = getMechanicSetting(id, 声明 default)，`%` 后缀 ×100；写 = `%` 后缀 ÷100；
 * - 异放占比变量 `setting.<ns>.releaseShare:<元素>`：读 = 已存值 ×100，未存则取覆盖率 ×100；写 = ÷100；
 * - 静态变量交给 core 的 readImpactVar / writeImpactVar。
 *
 * CC-55（2026-09-27）：异放占比变量改为**模块声明**——`AgentMechanicModule.releaseShare = { namespace, label }`
 *   （现唯一声明：burnice.ts ⇒ `{ namespace: 'burnice', label: '柏妮思异放' }`），调用方经
 *   `composables/agentMechanicView.ts#teamReleaseShares` 取队伍声明后传进来；本文件不再含角色 ID、也不查 catalog。
 *   变量 id 形如 `setting.<namespace>.releaseShare:<元素>`，与引擎 damagePoolRelease.ts 读取的键一致。
 * CC-537（2026-10-08 arena-G r754）：读写口径随变量对象携带。buildImpactVariables 给机制设置变量挂上声明 `setting`、
 *   给异放占比变量挂上 `releaseShare: { key, element }`；readImpactVariable / writeImpactVariable 收变量对象，按这两个字段分派。
 *   原先读写收 id 字符串，自己解析 `setting.` 前缀和 releaseShare 形状，再回 settingMap 查声明；查不到时（换队后界面还留着
 *   旧队伍的选择）读取回落 `?? 1`、写入按非 `%` 处理。现在只有当前变量表里的变量对象才能读写，失效的选择由界面按
 *   「不在当前变量表」处理（ImpactChart / ResponseSurface3D 不显示当前值）；读写里不再有缺声明分支，也不再需要 settingMap。
 */
import { IMPACT_VARIABLES, readImpactVar, writeImpactVar, type ImpactVariable } from '@/core/impactVars'
import type { MechanicSetting } from '@/types/resource'
import { damageElementLabel } from '@/utils/agentLabelMaps'
import type { ReleaseShareDecl } from '@/composables/agentMechanicView'
import type { ConfigModel } from '@/stores/config'

type ConfigStore = ConfigModel
/** 每元素异常覆盖率（0~1）；来自 useResourceCalc().anomalyPoolResult.coverage.perElementCoverageRate，可缺省 */
export type ElementCoverageRate = Readonly<Record<string, number>> | undefined

/** 队伍的影响变量（CC-537）：静态变量两个字段都没有，交给 core；动态变量自带读写口径，读写不解析 id、也不回查 settingMap */
export interface TeamImpactVariable extends ImpactVariable {
  /** 机制设置变量（id = `setting.<setting.id>`）的声明：未存值时读它的 default，`%` 后缀按 ×100 展示 */
  setting?: MechanicSetting
  /** 异放占比变量（id = `setting.<key>`）：key = `<namespace>.releaseShare:<元素>`，与引擎 damagePoolRelease.ts 读取的设置键一致 */
  releaseShare?: { key: string; element: string }
}

/** 下拉可选的全部影响变量（静态 + 动态），顺序与原组件 `allVars` 一致 */
export function buildImpactVariables(
  settingMap: ReadonlyMap<string, MechanicSetting>,
  releaseShares: ReadonlyArray<ReleaseShareDecl>,
  coverageRate: ElementCoverageRate,
): TeamImpactVariable[] {
  const vars: TeamImpactVariable[] = []
  for (const [id, setting] of settingMap) {
    const range = setting.suffix === '%'
      ? [(setting.min ?? 0) * 100, (setting.max ?? 100) * 100]
      : [setting.min ?? 0, setting.max ?? 100]
    vars.push({ id: `setting.${id}`, label: setting.label, defaultRange: range as [number, number], suffix: setting.suffix, setting })
  }
  for (const decl of releaseShares) {
    for (const [element, rate] of Object.entries(coverageRate ?? {})) {
      if (rate <= 0) continue
      const key = `${decl.namespace}.releaseShare:${element}`
      vars.push({
        id: `setting.${key}`,
        label: `${decl.label}·${damageElementLabel(element)}占比`,
        defaultRange: [0, 100],
        suffix: '%',
        releaseShare: { key, element },
      })
    }
  }
  return [...IMPACT_VARIABLES, ...vars]
}

/** 读变量当前值（展示单位：`%` 变量为 0~100） */
export function readImpactVariable(v: TeamImpactVariable, configStore: ConfigStore, coverageRate: ElementCoverageRate): number {
  if (v.setting) {
    const raw = configStore.getMechanicSetting(v.setting.id, v.setting.default)
    return v.setting.suffix === '%' ? raw * 100 : raw
  }
  if (v.releaseShare) {
    const stored = configStore.mechanicSettings[v.releaseShare.key]
    return stored !== undefined ? stored * 100 : (coverageRate?.[v.releaseShare.element] ?? 0) * 100
  }
  return readImpactVar(configStore, v.id)
}

/** 写变量（入参为展示单位；写入 store 触发响应式重算） */
export function writeImpactVariable(v: TeamImpactVariable, value: number, configStore: ConfigStore): void {
  if (v.setting) configStore.setMechanicSetting(v.setting.id, v.setting.suffix === '%' ? value / 100 : value)
  else if (v.releaseShare) configStore.setMechanicSetting(v.releaseShare.key, value / 100)
  else writeImpactVar(configStore, v.id, value)
}
