import type { AgentMechanicModule } from './types'
import { getAgentMechanic, registerAgentMechanic } from './registry'
import { registerDamageFormulaFields } from '@/core/damageFormulaFields'
import { velinaMechanic } from './agents/velina'
import { aliceMechanic } from './agents/alice'
import { roxyMechanic } from './agents/roxy'
import { claretMechanic } from './agents/claret'
import { sunbringerMechanic } from './agents/sunbringer'
import { robinMechanic } from './agents/robin'
import { janeMechanic } from './agents/jane'
import { burniceMechanic } from './agents/burnice'
import { yuzuhaMechanic } from './agents/yuzuha'
import { nangongMechanic } from './agents/nangong'
import { remielleMechanic } from './agents/remielle'
import { yidhariMechanic } from './agents/yidhari'
import { graceMechanic } from './agents/grace'
import { nekomataMechanic } from './agents/nekomata'
import { miyabiMechanic } from './agents/miyabi'
import { liuyinMechanic } from './agents/liuyin'
import { normaMechanic } from './agents/norma'
import { piperMechanic } from './agents/piper'
import { hugoMechanic } from './agents/hugo'
import { harumasaMechanic } from './agents/harumasa'
import { ellenMechanic } from './agents/ellen'
import { evelynMechanic } from './agents/evelyn'
import { vivianMechanic } from './agents/vivian'
import { anbyZeroMechanic } from './agents/anbyZero'
import { aireMechanic } from './agents/aire'
import { promiaMechanic } from './agents/promia'
import { koledaMechanic } from './agents/koleda'
import { corinMechanic } from './agents/corin'
import { billyMechanic } from './agents/billy'
import { sethMechanic } from './agents/seth'
import {
  // pulchraHuntStepMechanic/anbyChargeMechanic/zhendouHeartfireMechanic 已由
  // agents/pulchra.ts / agents/anby.ts / agents/zhendou.ts 取代（2026-08-27 补录核心被动/额外能力/命座）
  // benGuardShieldMechanic 已由 agents/ben.ts 替代（全队暴击+防转攻+命座）
  peiluoProminenceMechanic,
  jufufuTigerRoarMechanic,
} from './agents/specPanelBuffs'
import { anbyMechanic } from './agents/anby'
import { pulchraMechanic } from './agents/pulchra'
import { zhendouMechanic } from './agents/zhendou'
import { qingyiMechanic } from './agents/qingyi'
import { luciaElowenMechanic } from './agents/luciaElowen'
import { banyueMechanic } from './agents/banyue'
import { starlightBillyMechanic } from './agents/starlightBilly'
import { yixuanMechanic } from './agents/yixuan'
import { lycaonMechanic } from './agents/lycaon'
import { soldier11Mechanic } from './agents/soldier11'
import { antonMechanic } from './agents/anton'
import { yeshuguangMechanic } from './agents/yeshuguang'
import { lucyMechanic } from './agents/lucy'
import { rinaMechanic } from './agents/rina'
import { lighterMechanic } from './agents/lighter'
import { yaojiayinMechanic } from './agents/yaojiayin'
import { nicoleMechanic } from './agents/nicole'
import { soukakuMechanic } from './agents/soukaku'
import { caesarMechanic } from './agents/caesar'
import { zhaoMechanic } from './agents/zhao'
import { benMechanic } from './agents/ben'
import { sigridMechanic } from './agents/sigrid'
import { severianMechanic } from './agents/severian'
import { phoenixMechanic } from './agents/phoenix'
import { qianxiaMechanic } from './agents/qianxia'
import { panYinhuMechanic } from './agents/panYinhu'
import { triggerMechanic } from './agents/trigger'
import { xixifuMechanic } from './agents/xixifu'
import { yanagiMechanic } from './agents/yanagi'
import { orphieMechanic } from './agents/orphie'
import { zhuYuanMechanic } from './agents/zhuYuan'
import { xideMechanic } from './agents/xide'
import { agentSpecs } from '@/specs/registry'
import { specToMechanicModule } from '@/specs/mechanics'

/**
 * 注册 + 合并同角色 spec 声明的 settings（模块自带优先，按 id 去重，spec 补缺）。
 * CC-247：自 registry.registerAgentMechanic 迁出（语义逐位不变：合并原本就在写 settingDefaults 之前），
 * 使 mechanics/registry.ts 不再值导入 specs。
 */
function registerWithSpecSettings(module: AgentMechanicModule): void {
  const spec = agentSpecs.find(item => item.agentIds.some(id => module.agentIds.includes(id)))
  if (spec) {
    const specSettings = specToMechanicModule(spec).settings ?? []
    const existingIds = new Set((module.settings ?? []).map(setting => setting.id))
    const merged = [
      ...(module.settings ?? []),
      ...specSettings.filter(setting => !existingIds.has(setting.id)),
    ]
    if (merged.length > 0) module.settings = merged
  }
  registerAgentMechanic(module)
  /**
   * 角色专属的**伤害公式字段**并入属性账白名单（2026-10-22）。
   *
   * 判据 22 要求 core 不得出现角色前缀字段名 ⇒ 字段名由角色模块自己声明
   * （`damageFormulaFields` 能力），core 只提供注册表。这里统一注册，模块无需自己调用。
   */
  const fields = module.damageFormulaFields?.()
  if (fields?.length) registerDamageFormulaFields(fields)
}

registerWithSpecSettings(velinaMechanic)
registerWithSpecSettings(aliceMechanic)
registerWithSpecSettings(roxyMechanic)
registerWithSpecSettings(claretMechanic)
registerWithSpecSettings(sunbringerMechanic)
registerWithSpecSettings(robinMechanic)
registerWithSpecSettings(janeMechanic)
registerWithSpecSettings(burniceMechanic)
registerWithSpecSettings(yuzuhaMechanic)
registerWithSpecSettings(nangongMechanic)
registerWithSpecSettings(remielleMechanic)
registerWithSpecSettings(yidhariMechanic)
registerWithSpecSettings(graceMechanic)
registerWithSpecSettings(nekomataMechanic)
registerWithSpecSettings(piperMechanic)
registerWithSpecSettings(hugoMechanic)
registerWithSpecSettings(pulchraMechanic)
registerWithSpecSettings(billyMechanic)
// registerAgentMechanic(benGuardShieldMechanic) — replaced by benMechanic
registerWithSpecSettings(ellenMechanic)
registerWithSpecSettings(evelynMechanic)
registerWithSpecSettings(vivianMechanic)
registerWithSpecSettings(harumasaMechanic)
// sigridLanceMechanic 已由 agents/sigrid.ts 替代（出枪式/巡空枪势/影画，面板块在 computePanelPhases）
registerWithSpecSettings(sigridMechanic)
registerWithSpecSettings(qianxiaMechanic)
registerWithSpecSettings(panYinhuMechanic)
registerWithSpecSettings(triggerMechanic)
registerWithSpecSettings(xixifuMechanic)
registerWithSpecSettings(yanagiMechanic)
registerWithSpecSettings(orphieMechanic)
registerWithSpecSettings(zhuYuanMechanic)
registerWithSpecSettings(xideMechanic)
registerWithSpecSettings(koledaMechanic)
registerWithSpecSettings(anbyMechanic)
registerWithSpecSettings(corinMechanic)
registerWithSpecSettings(miyabiMechanic)
registerWithSpecSettings(liuyinMechanic)
registerWithSpecSettings(normaMechanic)
registerWithSpecSettings(zhendouMechanic)
registerWithSpecSettings(antonMechanic)
registerWithSpecSettings(yeshuguangMechanic)
registerWithSpecSettings(lucyMechanic)
registerWithSpecSettings(rinaMechanic)
registerWithSpecSettings(lighterMechanic)
registerWithSpecSettings(yaojiayinMechanic)
registerWithSpecSettings(nicoleMechanic)
registerWithSpecSettings(soukakuMechanic)
registerWithSpecSettings(caesarMechanic)
registerWithSpecSettings(zhaoMechanic)
registerWithSpecSettings(benMechanic)
registerWithSpecSettings(aireMechanic)
registerWithSpecSettings(promiaMechanic)
// nanoka 3.3.12+19629936（v12 正式数值，2026-10-17 重录；原文证据契约 data/recordings/1631.json / 1641.json）
registerWithSpecSettings(severianMechanic)
registerWithSpecSettings(phoenixMechanic)
registerWithSpecSettings(peiluoProminenceMechanic)
registerWithSpecSettings(sethMechanic)
registerWithSpecSettings(anbyZeroMechanic)
registerWithSpecSettings(jufufuTigerRoarMechanic)
registerWithSpecSettings(qingyiMechanic)
registerWithSpecSettings(luciaElowenMechanic)
registerWithSpecSettings(banyueMechanic)
registerWithSpecSettings(starlightBillyMechanic)
registerWithSpecSettings(yixuanMechanic)
registerWithSpecSettings(lycaonMechanic)
registerWithSpecSettings(soldier11Mechanic)

/**
 * beta 冻结副本（`scripts/snapshot-agent.mjs` 生成到 `./agents/beta/<id>v<n>.ts`，角色 id 形如
 * `1091v1`）：测试服旧版整体冻结，与正主并存以便同屏对比强度。目录里有什么注册什么——
 * 找不到模块导出的文件视为坏快照，启动即抛。
 * ⚠ 必须在下方 spec 兜底循环**之前**执行：beta spec（`specs/agents/<id>v<n>.json`）先被
 * 兜底注册成模块的话，这里再注册同一 agentId 就撞车。滑块 id 与正主重复由 registry 的
 * 跨模块命名空间容忍（见 registry.ts#registerAgentMechanic 注释）。
 */
const betaModules = import.meta.glob('./agents/beta/*.ts', { eager: true }) as Record<
  string,
  Record<string, unknown>
>
for (const [path, mod] of Object.entries(betaModules)) {
  const candidate = Object.values(mod).find(
    v => !!v && typeof v === 'object' && Array.isArray((v as AgentMechanicModule).agentIds) && typeof (v as AgentMechanicModule).id === 'string',
  ) as AgentMechanicModule | undefined
  if (!candidate) throw new Error(`[mechanics] beta snapshot ${path} exports no AgentMechanicModule`)
  registerWithSpecSettings(candidate)
}

for (const spec of agentSpecs) {
  if (spec.agentIds.every(id => !getAgentMechanic(id))) {
    registerWithSpecSettings(specToMechanicModule(spec))
  }
}

export * from './registry'
export * from './interactionBaseline'
export * from './types'
