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
import {
  piperMomentumMechanic,
  hugoAbyssEchoMechanic,
  pulchraHuntStepMechanic,
  billyHitStacksMechanic,
  // benGuardShieldMechanic 已由 agents/ben.ts 替代（全队暴击+防转攻+命座）
  ellenFrostChargeMechanic,
  harumasaEdgeMechanic,
  sigridLanceMechanic,
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
import { benMechanic } from './agents/ben'
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
registerAgentMechanic(piperMomentumMechanic)
registerAgentMechanic(hugoAbyssEchoMechanic)
registerAgentMechanic(pulchraHuntStepMechanic)
registerAgentMechanic(billyHitStacksMechanic)
// registerAgentMechanic(benGuardShieldMechanic) — replaced by benMechanic
registerAgentMechanic(ellenFrostChargeMechanic)
registerAgentMechanic(harumasaEdgeMechanic)
registerAgentMechanic(sigridLanceMechanic)
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
