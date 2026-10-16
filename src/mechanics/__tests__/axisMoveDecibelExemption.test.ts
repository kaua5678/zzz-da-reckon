/**
 * **「非喧响大」豁免声明的护栏**（T171，用户口径 2026-10-15）。
 *
 * ## 为什么需要它（这条护栏防的是一类**静默且有害**的错误）
 *
 * 引擎判「轴里这个块是不是大招」只看**英文名是否以 `Ultimate:` 开头**
 * （`data/chainMoveKind#chainMoveKind`）⇒ 按 `ultimateCost`（默认 3000）收喧响。
 * 但**名字带 `Ultimate:` ≠ 由喧响购买**：
 *  - 仪玄 `1371020` 符法千重 = **术法值**购买（该免）；
 *  - 伊德海莉 `1051016` 终幕·惘事渡却 = **喧响**购买（那 3000 买的是**开帷幕**，
 *    终结技是它的附属，原文「每次消耗喧响值开启[以太帷幕·涌泉]，最多发动1次」）⇒ **不该免**。
 *
 * ⚠ **误免的代价是「白送」**：豁免后该块不扣喧响却照样执行 ⇒ 凭空多打（违反
 * 「不许凭空创造资源」）。而误免**不会让任何现有测试变红**（它只是数字变大），
 * 所以必须有本条正面判据。
 *
 * ## 本文件锁什么
 *
 * ① 每个声明 `axisMoveFreeOfDecibel` 的模块，其豁免判据**不得**把该角色的
 *    **真·喧响大**（引擎会收费的那个 ultimate）也判成 true；
 * ② 豁免必须**逐 moveId 精确**，不得写成 `() => true`（那会把该角色所有大招都免掉）；
 * ③ 反空洞：必须有模块声明该能力（否则本条零覆盖，形同虚设）。
 *
 * ## 负控（删掉被锁行为后本测试确实变红）
 *
 * 把仪玄的声明改成 `() => true` ⇒ ② 红；
 * 把伊德海莉（或其他真喧响大角色）加成豁免 ⇒ ① 红（若该角色有 ultimate 行）。
 */
import { describe, expect, it } from 'vitest'
import { getRegisteredAgentMechanics } from '@/mechanics'
import '@/mechanics'
import { findUltimateMove } from '@/data/chainMoveKind'
import { useCatalogStore } from '@/stores/catalog'
import { beforeEach } from 'vitest'
import { mockStaticFetch, newPinia } from '@/test/harness'

/**
 * **不许误免**的黑名单：各角色的**真·喧响大**。
 *
 * ## ⚠ 为什么不能写死（这是本条护栏能否自动覆盖新声明者的关键）
 *
 * 写死一张表 ⇒ **T133 那类工人给新角色加豁免时，该角色不在表里 ⇒ 漏检**。
 * 故改为**从引擎派生**：真·喧响大 = 该角色倍率表里**第一个**英文名以 `Ultimate:` 开头的招式
 * （`data/chainMoveKind#findUltimateMove`，引擎自己就是用这个算 `ultimateCount` 的
 * ⇒ 与收费侧同源，规则 11）。
 *
 * 例外表只用于「引擎派生结果**不是**真喧响大」的反常角色（须逐个写明理由），当前为空。
 */
const REAL_DECIBEL_ULT_OVERRIDES: Record<string, string | null> = {}

/** 从倍率表派生某角色的真·喧响大 moveId（引擎同源：`findUltimateMove`） */
function realDecibelUltOf(agentId: string): string | null {
  if (agentId in REAL_DECIBEL_ULT_OVERRIDES) return REAL_DECIBEL_ULT_OVERRIDES[agentId]!
  const skills = useCatalogStore().agentSkillsByAgentMap.get(agentId)
  if (!skills) return null
  return findUltimateMove(skills)?.id ?? null
}

describe('轴块喧响豁免（axisMoveFreeOfDecibel）护栏', () => {
  beforeEach(async () => {
    newPinia()
    mockStaticFetch()
    await useCatalogStore().load()
  })

  it('① 豁免不得波及本角色的真·喧响大（误免 = 白送一次大招）', () => {
    const violations: string[] = []
    for (const mod of getRegisteredAgentMechanics()) {
      const free = mod.axisMoveFreeOfDecibel
      if (!free) continue
      for (const id of mod.agentIds ?? []) {
        const realUlt = realDecibelUltOf(id)
        if (!realUlt) continue
        // 若该角色「唯一的真喧响大」被豁免 ⇒ 这个角色在轴里将一次喧响都不花 ⇒ 白送
        if (free(realUlt)) violations.push(`${id}: 真喧响大 ${realUlt} 被误判为「不扣喧响」`)
      }
    }
    expect(violations, `误免真喧响大（会凭空多打）：\n${violations.join('\n')}`).toEqual([])
  })

  it('② 豁免必须逐 moveId 精确——不得写成「该角色全部大招都免」', () => {
    const violations: string[] = []
    for (const mod of getRegisteredAgentMechanics()) {
      const free = mod.axisMoveFreeOfDecibel
      if (!free) continue
      /**
       * 判据：拿一个**显然不是本角色招式**的 moveId 去问，若也返回 true
       * ⇒ 该判据不是「按 moveId 白名单」而是「恒真」⇒ 会把所有大招都免掉。
       */
      if (free('__not_a_real_move__')) violations.push(`${mod.agentIds?.join(',')}: 豁免判据恒真（未按 moveId 收窄）`)
    }
    expect(violations, `豁免判据必须按 moveId 精确（恒真 = 免掉全部大招）：\n${violations.join('\n')}`).toEqual([])
  })

  it('③ 反空洞：必须有模块声明该能力（否则本护栏零覆盖）', () => {
    const declarers = getRegisteredAgentMechanics().filter(m => !!m.axisMoveFreeOfDecibel)
    expect(declarers.length, '必须至少有一个模块声明 axisMoveFreeOfDecibel（本护栏才有意义）').toBeGreaterThan(0)
    // 声明者必须有 agentIds（否则 ①② 的黑名单匹配不到它）
    for (const m of declarers) {
      expect((m.agentIds ?? []).length, `${m.name ?? '?'} 声明了豁免但没有 agentIds`).toBeGreaterThan(0)
    }
  })
})
