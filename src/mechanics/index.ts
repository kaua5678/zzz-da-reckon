import { getAgentMechanic, registerAgentMechanic } from './registry'
import { velinaMechanic } from './agents/velina'
import { aliceMechanic } from './agents/alice'
import { roxyMechanic } from './agents/roxy'
import { claretMechanic } from './agents/claret'
import { janeMechanic } from './agents/jane'
import { burniceMechanic } from './agents/burnice'
import { yuzuhaMechanic } from './agents/yuzuha'
import { nangongMechanic } from './agents/nangong'
import { remielleMechanic } from './agents/remielle'
import { yidhariMechanic } from './agents/yidhari'
import { nekomataMechanic } from './agents/nekomata'
import { miyabiMechanic } from './agents/miyabi'
import { liuyinMechanic } from './agents/liuyin'
import { normaMechanic } from './agents/norma'
import { piperMechanic } from './agents/piper'
import { hugoMechanic } from './agents/hugo'
import {
  pulchraHuntStepMechanic,
  billyHitStacksMechanic,
  // benGuardShieldMechanic 已由 agents/ben.ts 替代（全队暴击+防转攻+命座）
  ellenFrostChargeMechanic,
  harumasaEdgeMechanic,
  koledaFurnaceMechanic,
  anbyChargeMechanic,
  corinChargeMechanic,
  graceChargeMechanic,
	  prometheusGuiltyMechanic,
  zhendouHeartfireMechanic,
  aireProficiencyMechanic,
  peiluoProminenceMechanic,
  sethShieldMechanic,
  anbyZeroVortexMechanic,
  jufufuTigerRoarMechanic,
} from './agents/specPanelBuffs'
import { qingyiMechanic } from './agents/qingyi'
import { luciaElowenMechanic } from './agents/luciaElowen'
import { banyueMechanic } from './agents/banyue'
import { starlightBillyMechanic } from './agents/starlightBilly'
import { yixuanMechanic } from './agents/yixuan'
import { lycaonMechanic } from './agents/lycaon'
import { soldier11Mechanic } from './agents/soldier11'
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
import { qianxiaMechanic } from './agents/qianxia'
import { triggerMechanic } from './agents/trigger'
import { xixifuMechanic } from './agents/xixifu'
import { yanagiMechanic } from './agents/yanagi'
import { orphieMechanic } from './agents/orphie'
import { zhuYuanMechanic } from './agents/zhuYuan'
import { xideMechanic } from './agents/xide'
import { agentSpecs } from '@/specs/registry'
import { specToMechanicModule } from '@/specs/mechanics'

registerAgentMechanic(velinaMechanic)
registerAgentMechanic(aliceMechanic)
registerAgentMechanic(roxyMechanic)
registerAgentMechanic(claretMechanic)
registerAgentMechanic(janeMechanic)
registerAgentMechanic(burniceMechanic)
registerAgentMechanic(yuzuhaMechanic)
registerAgentMechanic(nangongMechanic)
registerAgentMechanic(remielleMechanic)
registerAgentMechanic(yidhariMechanic)
registerAgentMechanic(nekomataMechanic)
registerAgentMechanic(piperMechanic)
registerAgentMechanic(hugoMechanic)
registerAgentMechanic(pulchraHuntStepMechanic)
registerAgentMechanic(billyHitStacksMechanic)
// registerAgentMechanic(benGuardShieldMechanic) — replaced by benMechanic
registerAgentMechanic(ellenFrostChargeMechanic)
registerAgentMechanic(harumasaEdgeMechanic)
// sigridLanceMechanic 已由 agents/sigrid.ts 替代（出枪式/巡空枪势/影画，面板块在 computePanelPhases）
registerAgentMechanic(sigridMechanic)
registerAgentMechanic(qianxiaMechanic)
registerAgentMechanic(triggerMechanic)
registerAgentMechanic(xixifuMechanic)
registerAgentMechanic(yanagiMechanic)
registerAgentMechanic(orphieMechanic)
registerAgentMechanic(zhuYuanMechanic)
registerAgentMechanic(xideMechanic)
registerAgentMechanic(koledaFurnaceMechanic)
registerAgentMechanic(anbyChargeMechanic)
registerAgentMechanic(corinChargeMechanic)
registerAgentMechanic(graceChargeMechanic)
registerAgentMechanic(miyabiMechanic)
registerAgentMechanic(liuyinMechanic)
registerAgentMechanic(normaMechanic)
registerAgentMechanic(prometheusGuiltyMechanic)
registerAgentMechanic(zhendouHeartfireMechanic)
registerAgentMechanic(yeshuguangMechanic)
registerAgentMechanic(lucyMechanic)
registerAgentMechanic(rinaMechanic)
registerAgentMechanic(lighterMechanic)
registerAgentMechanic(yaojiayinMechanic)
registerAgentMechanic(nicoleMechanic)
registerAgentMechanic(soukakuMechanic)
registerAgentMechanic(caesarMechanic)
registerAgentMechanic(zhaoMechanic)
registerAgentMechanic(benMechanic)
registerAgentMechanic(aireProficiencyMechanic)
registerAgentMechanic(peiluoProminenceMechanic)
registerAgentMechanic(sethShieldMechanic)
registerAgentMechanic(anbyZeroVortexMechanic)
registerAgentMechanic(jufufuTigerRoarMechanic)
registerAgentMechanic(qingyiMechanic)
registerAgentMechanic(luciaElowenMechanic)
registerAgentMechanic(banyueMechanic)
registerAgentMechanic(starlightBillyMechanic)
registerAgentMechanic(yixuanMechanic)
registerAgentMechanic(lycaonMechanic)
registerAgentMechanic(soldier11Mechanic)

for (const spec of agentSpecs) {
  if (spec.agentIds.every(id => !getAgentMechanic(id))) {
    registerAgentMechanic(specToMechanicModule(spec))
  }
}

export * from './registry'
export * from './types'
