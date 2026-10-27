/**
 * CC-61：agentAxisExtraBlocks 与原 StunAxisPage 写死的诺姆 1571 / 希格莉德 1591 专属块逐字段一致。
 *
 * ## ⚠ T176（2026-10-16）：伊德海莉「寒冰触手」已从本清单**移除**（有意变更，非漂移）
 *
 * 用户口径逐字：
 * > 「我说的自动是橘福福后台连携，**扳机后台攻击**，**章鱼触手cd**，卢西娅后台追击」
 * > 「**这个是通用逻辑，我认为自动攻击无需手捏计数，直接全局均匀计数，哪些吃易伤哪些打失衡就有了**」
 *
 * 触手次数是**纯自动**的（`floor(有效战斗时间 / yidhari.tentacleInterval)`，玩家调**间隔**而非次数），
 * 原 `axisExtraBlocks` 手捏块**不改变次数**、**只改变易伤归属**（实测捏×1 让总伤掉 5%）。
 * 现改走通用机制 `autoSplitByStun`（与猫又/扳机/蕾米埃尔同款）⇒ 候选池里再列出它只会误导。
 * ⇒ 本测试的 `legacy()` 对照表同步删掉 1051 那一行，`hits` 由 21 降为 **14**（2 角色 × 影画 0..6）。
 *
 * ## ⚠ R68（2026-10-27）：诺姆「转连携」块也从候选池**撤出**（有意变更，非漂移）
 *
 * 用户口径逐字：「诺姆转连携其本体是主c的连携块，**不应该和普通连携有差别**」。
 * 它曾是 0 时长标记块（只标易伤、不占窗口时间），现编辑器改放**受赠队友本人的连携块**；
 * 旧轴残留的 `norma-hat-chain` 仍被引擎认，并按主C 连携的真实时长收时间
 * （判据 `src/composables/__tests__/hatChainAsNormalChain.test.ts`）⇒ `hits` 由 14 降为 **7**。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { findMoveById } from '@/data/moveTableQueries'
import { agentAxisExtraBlocks } from '@/composables/agentMechanicView'
import type { AgentSkills } from '@/types/catalog'

// 对照基准：照抄原页面两段 if 块（remaining 的 9 = quota）
function legacy(agentId: string, cinemaLevel: number, skills: AgentSkills | undefined) {
  // R68（2026-10-27）：诺姆「转连携」块已**撤出候选池** —— 用户口径「其本体是主c的连携块，
  // 不应该和普通连携有差别」；编辑器改放受赠队友本人的连携块（候选池里带「·赠」那条）。
  // 旧轴里残留的 norma-hat-chain 仍由 roundInputs 按主C 连携的真实时长建块（判据 `hatChainAsNormalChain.test.ts`）。
  // T176：原 CC-433 的伊德海莉寒冰触手分支已移除（改走 autoSplitByStun，不再手捏；理由见文件头）
  if (agentId === '1591') {
    const pzSum = ['1591007', '1591008', '1591022'].reduce((sum, mid) => sum + (findMoveById(skills, mid)?.actionTime ?? 0), 0)
    const pzScale = cinemaLevel >= 6 ? 0.75 : 1
    return [{ moveId: 'sigrid-pozhen', label: '破阵连段', actionTime: pzSum * pzScale, quota: 9 }]
  }
  return []
}

describe('CC-61 专属轴块 → 模块声明 axisExtraBlocks', () => {
  it('全 catalog 角色 × 影画 0..6：候选块与原写死逐字段相等', async () => {
    const { catalog } = await setupHarness([{ agentId: '1591' }, { agentId: '1571' }, ''])
    const ids = [...catalog.agentsMap.keys()]
    expect(ids.length).toBeGreaterThan(30)
    let hits = 0
    for (const id of ['', ...ids]) {
      const skills = catalog.getAgentSkills(id)
      for (let cinemaLevel = 0; cinemaLevel <= 6; cinemaLevel++) {
        const got = agentAxisExtraBlocks(id, { cinemaLevel, actionTimeOf: mid => findMoveById(skills, mid)?.actionTime ?? 0 })
        expect([...got], `${id}/c${cinemaLevel}`).toEqual(legacy(id, cinemaLevel, skills))
        hits += got.length
      }
    }
    expect(hits).toBe(7)  // R68：只剩希格莉德 × 影画 0..6（诺姆转连携块已撤、伊德海莉触手 2026-10-16 已撤）
    // 破阵块行动时间非零（技能表三段都查得到），C6 恰为 0.75 倍
    const sk = catalog.getAgentSkills('1591')
    const at = (c: number) => agentAxisExtraBlocks('1591', { cinemaLevel: c, actionTimeOf: mid => findMoveById(sk, mid)?.actionTime ?? 0 })[0]?.actionTime ?? 0
    expect(at(0)).toBeGreaterThan(0)
    expect(at(6)).toBeCloseTo(at(0) * 0.75, 10)
    expect(agentAxisExtraBlocks(null, { cinemaLevel: 0, actionTimeOf: () => 1 })).toEqual([])
  }, 60000)

  it('StunAxisPage 不再按 agentId 写死诺姆 / 希格莉德专属块', () => {
    const src = readFileSync(resolve(__dirname, '../../views/StunAxisPage.vue'), 'utf8')
    expect(src.includes("=== '1571'")).toBe(false)
    expect(src.includes("=== '1591'")).toBe(false)
    expect(src.includes("'1051024'"), 'CC-433：触手块不再写死在页面').toBe(false)
  })
})
