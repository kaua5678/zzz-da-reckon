/**
 * 装配后「赠送连携」编排簇（CC-35d-A 2026-09-27 由 `normaHatChain.ts#applyNormaHatChain` 通用化）。
 *
 * 提供者 = 首个实现模块能力 `chainGift` 的在队槽位（现唯一实现：诺姆「膛温换连携」——帽子把戏触发
 * 上一位角色的快速支援→替换为该队友本人的连携技）。本文件不认角色：次数 / 招式名后缀 / 说明文案都由能力返回。
 * 引擎侧时间预留走 crossAgentSupply 的 `gift-chain:chain` 通道（core/resource/helpers.ts 的 chainGift*），两者须同源。
 */
import { findChainAttack } from '@/core/resource'
import { resolveUltimateTargetSlot } from '@/mechanics/agents/liuyin'
import type { TeamResourceResult } from '@/types/resource'
import type { useConfigStore } from '@/stores/config'
import type { useCatalogStore } from '@/stores/catalog'
import { getAgentMechanic } from '@/mechanics'
// 招式行取值簇（C 簇）已迁 `./skillRows`（R22 熵批 2 / R22-S2 刀 B）——同目录兄弟模块
// 直接指真实现，不走 `./helpers` 的 re-export 壳（壳只服务目录外的既有消费者面）。
import { findMoveById, fusedRowValue } from './skillRows'
import { buildGiftRow } from '@/core/resource/giftRows'

/**
 * 赠送连携：提供者给「上一位队友」（`resolveUltimateTargetSlot`）赠送 N 次其本人连携技，连携归属该队友。
 * 诺姆 C4 的 +200 不可分享喧响不在这里（资源池 calcDecibelSource 已计入）。
 */
export function applyChainGift(
  base: TeamResourceResult | null,
  configStore: ReturnType<typeof useConfigStore>,
  catalogStore: ReturnType<typeof useCatalogStore>,
): TeamResourceResult | null {
  if (!base) return null
  // 提供者槽位 = 首个实现 `chainGift` 的在队模块（CC-35d-A；原按身份 findSlotByIdentity(['1571'])，
  // 本库 teammateBuffId 均等于自身 id，按 agentId 派发与之等价）
  const providerSlot = configStore.team.findIndex(m => !!m.agentId && !!getAgentMechanic(m.agentId)?.chainGift)
  if (providerSlot < 0) return base
  const providerResult = base.characters.find(c => c.slot === providerSlot)
  const gift = providerResult ? getAgentMechanic(configStore.team[providerSlot].agentId)?.chainGift?.(providerResult) ?? null : null
  if (!gift) return base
  const hatCount = Math.max(0, Math.floor(gift.count))
  // 引擎占位行（阶段1 ②）以**池口径**为准：hatCount = 0 时撤掉占位行（同 applyUltimatePromote）
  if (hatCount <= 0) {
    if (!base.characters.some(c => (c.executions ?? []).some(e => e.chainGift))) return base
    return {
      ...base,
      characters: base.characters.map(c => ({
        ...c,
        executions: (c.executions ?? []).filter(e => !e.chainGift),
      })),
    }
  }

  // 上一位队友（环绕，排除自己）
  const targetSetting = configStore.getMechanicSetting('liuyin.ultimateTargetSlot', -1)
  const targetSlot = resolveUltimateTargetSlot(providerSlot, configStore.team.length, targetSetting)
  // 帽子把戏替换的是「上一位队友的快速支援→该队友本人的连携技」（用户口径：赠送连携给上一位队友打，
  // 不是诺姆替打自己的 1571018）——连携招式 id/倍率/时长全部取目标队友技能表。
  // C4 喧响（诺姆+队友各 200×次数）已由资源池 calcDecibelSource 计入（buildResourceResult 回写
  // cfg.normaHatToChainCount → 下一轮迭代注入 extraUnshareableDecibel，真实影响终结技次数），
  // applyChainGift 只做连携赠送，不再重复注入喧响。
  // 赠送连携行需自带倍率表值（applyChainGift 在 enrich 之后执行，不走 enrich 回填；
  // 缺倍率则伤害池按 damageMultiplier≤0 跳过、失衡池无 baseDaze——带上后伤害/失衡才进池）
  const targetAgentId = configStore.team[targetSlot]?.agentId ?? ''
  const targetSkills = catalogStore.agentSkillsByAgentMap.get(targetAgentId)
  const chainInfo = targetSkills ? findChainAttack(targetSkills) : null
  if (!chainInfo) return base
  const giftedMove = findMoveById(targetSkills, chainInfo.moveId)
  // 赠送的是「一次完整连携」：多段招式（登记融合组，如雅 春临 #1~#3）必须取整段倍率，
  // 否则赠送行只算了第一段（377.6% vs 1258.3%）——与倍率侧同一口径（用户 2026-09-11）。
  const fusedOf = (rowId: string) =>
    fusedRowValue(targetSkills, chainInfo.moveId, rowId)
    ?? giftedMove?.rows?.find(r => r.id === rowId)?.values?.[0] ?? 0
  const giftedDamage = fusedOf('damage')
  const giftedDaze = fusedOf('daze')
  const giftedAnomaly = fusedOf('anomaly_buildup')

  return {
    ...base,
    characters: base.characters.map(char => {
      if (char.slot !== targetSlot) return char
      // 上一位队友：连携次数 +hatCount、执行计划补其本人连携技执行（C4 喧响在资源池）
      //
      // 阶段1 ②（2026-09-10）：**行由引擎物化**（存在/行序），本函数补倍率 + 连携计数，并把
      // 计数/时长**以池为准**写回；找不到行时兜底追加。
      const giftIdx = (char.executions ?? []).findIndex(e => e.chainGift || e.source === 'gift')
      const giftPatch = {
        count: hatCount,
        actionTime: chainInfo.actionTime,
        totalTime: hatCount * chainInfo.actionTime,
        totalComboAlignTime: hatCount * chainInfo.actionTime * chainInfo.comboAlignRatio,
        moveName: `${giftedMove?.name?.zhCN || '连携技'}（${gift.label}）`,
        decibelRecovery: chainInfo.decibelRecovery,
        totalDecibelRecovery: chainInfo.decibelRecovery * hatCount,
        damageMultiplier: giftedDamage,
        damageMultiplierOverride: giftedDamage > 0,
        dazeMultiplier: giftedDaze,
        dazeMultiplierOverride: giftedDaze > 0,
        anomalyBuildUp: giftedAnomaly,
        totalAnomalyBuildUp: giftedAnomaly * hatCount,
      }
      const executions = giftIdx >= 0
        ? (char.executions ?? []).map((e, i) => (i === giftIdx ? { ...e, ...giftPatch } : e))
        : [...(char.executions ?? []), buildGiftRow({
          moveId: chainInfo.moveId,
          moveName: giftPatch.moveName,
          count: hatCount,
          actionTime: chainInfo.actionTime,
          comboAlignRatio: chainInfo.comboAlignRatio,
          decibelRecovery: chainInfo.decibelRecovery,
          damageMultiplier: giftedDamage,
          dazeMultiplier: giftedDaze,
          anomalyBuildUp: giftedAnomaly,
          skillTableNote: gift.note,
          chainGift: true,
        })]
      return {
        ...char,
        chainCountTotal: (char.chainCountTotal ?? 0) + hatCount,
        executions,
      }
    }),
  }
}
