/**
 * 挽昼(1601) / 知更鸟(1661) 人工配装的**生效判据**（用户裁决 2026-10-26）。
 *
 * 背景：这两条推荐不是 nanoka 爬取数据，是用户按实战定的（见
 * `scripts/patch-curated-loadout.mjs` 头注释）。数据那条由 `buildRecMainStatRule.test.ts` ④
 * 的登记表锁住，但「登记得对」≠「配装真的生效」——所以这里**走生产通道**（harness 的
 * `recommendedBuild` = 主页「配装推荐 · 一键应用」同一条路），再从引擎读回面板。
 *
 * 用户原话（2026-10-26）：
 *   · 「知更鸟要求转模到位，自己不需要打伤害，做好辅助的拐力就行」
 *   · 「4件套雪兔，2件无所谓」「鸟二件套用生命可以降低词条压力」
 *   · 「挽昼是输出，暴击要贴合200%，防御尽量多……我说防御尽量多意思是你别塞垃圾词条，
 *     但防御本身还是要看你的最优推算」「挽昼五号位火属性伤害应该比防御厉害吧？」
 *   · 「最高词条之前写过不超过20比较合理」「最高的两个加起来最好不超过35」
 *
 * 判据（每条都对应一个真实失败模式）：
 *   ① 一键应用装上了什么（4pc / 2pc / 主词条 / 音擎）—— 失败模式 = 套装按名字解析落兜底 /
 *      专武没配上（1601/1661 在 catalog 里没有 ownerAgentId，只有推荐块里那份 id）。
 *   ② 挽昼暴击贴 200%（190–205 区间）—— 失败模式 = 副词条没按 TOP2 规则收敛，落回 202% 白给。
 *   ③ 挽昼 5 号位火伤 > 5 号位防御（用引擎实测而不是嘴上说）—— 失败模式 = 主词条选反。
 *   ④ 知更鸟转模到顶（离场守护全队 +1000 防御，含 Buff 强化点）+ 自身伤害不参与
 *      —— 失败模式 = 生命堆不够（HP < 26000 就掉档）/ 换错 2 件套。
 *   ⑤ 两条配装的副词条都满足「单项 ≤20、最高两项 ≤35」（用户词条口径）—— 失败模式 =
 *      有人手填 20+19 绕过引擎默认分配。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { computePanelPhases } from '@/composables/resourceCalc/panelPhases'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { robinGuardDefBonus } from '@/mechanics/agents/robin'
import { resolveDiscSetPieces, discFourPieceSetIdOf } from '@/core/buff'
import { topTwoOf, SUBSTAT_TOP2_STEP_CAP } from '@/core/substatOptimizer'

const flush = async () => { await new Promise<void>(r => setTimeout(r, 0)) }

/** 生产队形：挽昼 + 诺姆(击破) + 知更鸟（与 `sunbringer-norma-robin` 预设同一队） */
const TEAM = [{ agentId: '1601' }, { agentId: '1571' }, { agentId: '1661' }] as never

describe('1601 挽昼 · 人工配装生效（输出 / 贴 200% / 词条合规）', () => {
  it('一键应用：4pc 锋御套 34300v1 + 2pc 防御 + 专武 14160v1 + 主词条 暴击/火伤/防御', async () => {
    const h = await setupHarness(TEAM, { recommendedBuild: true } as never)
    const c = h.config.team[0]
    expect(c.wEngineId, '专武没装上（1601 在 catalog 无 ownerAgentId，全靠推荐块）').toBe('14160v1')
    expect(c.driveDisc.fourPieceSetId).toBe('34300v1')
    expect(c.driveDisc.twoPieceSetId).toBe('34200')
    expect(c.driveDisc.mainStats).toMatchObject({ 4: 'critRate', 5: 'fireDmg', 6: 'defPct' })
  }, 120000)

  it('副词条：单项 ≤20、最高两项 ≤35（用户词条口径），且暴击贴 200% 锐暴封顶', async () => {
    const h = await setupHarness(TEAM, { recommendedBuild: true } as never)
    const alloc = h.config.team[0].driveDisc.subStatAllocation
    for (const [stat, n] of Object.entries(alloc)) expect(n, `${stat} 单项超 20`).toBeLessThanOrEqual(20)
    expect(topTwoOf(alloc), `最高两项合计超 ${SUBSTAT_TOP2_STEP_CAP}：${JSON.stringify(alloc)}`).toBeLessThanOrEqual(SUBSTAT_TOP2_STEP_CAP)
    const panel = computePanelPhases(0, h.config, h.catalog)!
    // 「贴合 200%」：锋御 100% 以上每 1% 是额外锐暴判定、200% 封顶 ⇒ 190–205 视为贴顶。
    // 下界 190 防「没堆够就自称贴顶」，上界 205 防「越过封顶白给」（贪心 20 步实测 202.0%）。
    expect(panel.inCombat.critRate, `局内暴击 ${panel.inCombat.critRate.toFixed(1)}%（期望 190–205 贴 200% 封顶）`)
      .toBeGreaterThanOrEqual(190)
    expect(panel.inCombat.critRate).toBeLessThanOrEqual(205)
  }, 120000)

  it('5 号位火伤确实强于防御力（引擎实测，不是嘴上说）', async () => {
    const read = async (five: string) => {
      const h = await setupHarness(TEAM, { recommendedBuild: true } as never)
      h.config.setMainStat(0, 5, five as never)
      const calc = useResourceCalc()
      await flush()
      return calc.teamTotalDamage.value
    }
    const fire = await read('fireDmg')
    const def = await read('defPct')
    expect(fire, `火伤 ${(fire / 1e6).toFixed(3)}M 应高于防御 ${(def / 1e6).toFixed(3)}M`).toBeGreaterThan(def)
    // 防御主词条不是「垃圾词条」——只是不如火伤：确认两者差距在合理区间（不是数据错位造成的大差）
    expect(fire / def).toBeLessThan(1.15)
  }, 180000)
})

describe('1661 知更鸟 · 人工配装生效（转模到位 / 不打伤害 / 词条合规）', () => {
  it('一键应用：4pc 雪兔 + 2pc 云岿（生命）+ 专武 14166v1，主词条全生命', async () => {
    const h = await setupHarness(TEAM, { recommendedBuild: true } as never)
    const c = h.config.team[2]
    expect(c.wEngineId).toBe('14166v1')
    expect(c.driveDisc.fourPieceSetId).toBe('33700')
    expect(c.driveDisc.twoPieceSetId).toBe('33100')
    expect(c.driveDisc.mainStats).toMatchObject({ 4: 'hpPct', 5: 'hpPct', 6: 'hpPct' })
  }, 120000)

  it('转模到位：局外 HP ≥26000 ⇒ 离场守护全队防御吃满（Lv12 上限 800，Buff 强化点 ×1.25 = 1000）', async () => {
    const h = await setupHarness(TEAM, { recommendedBuild: true } as never)
    const robin = computePanelPhases(2, h.config, h.catalog)!
    const hp = robin.outOfCombat.hp
    expect(hp, `知更鸟局外 HP ${hp.toFixed(0)}（<26000 就掉档，转模没到位）`).toBeGreaterThanOrEqual(26000)
    expect(robinGuardDefBonus({ hp, buffPointActive: true }), '离场守护封顶值').toBe(1000)
    expect(robinGuardDefBonus({ hp, buffPointActive: false })).toBe(800)
    // 反向判据：这 1000 点真的进了**锋御队友**的伤害基底（防御力区），不是只停在知更鸟面板上
    const sunbringer = computePanelPhases(0, h.config, h.catalog)!
    const solo = await setupHarness([{ agentId: '1601' }, { agentId: '1571' }, ''] as never, { recommendedBuild: true } as never)
    const sunbringerSolo = computePanelPhases(0, solo.config, solo.catalog)!
    const defGain = sunbringer.inCombat.def - sunbringerSolo.inCombat.def
    expect(defGain, `知更鸟给挽昼的固定防御应为 1000（实测 ${defGain.toFixed(0)}）`).toBeGreaterThan(900)
  }, 180000)

  it('副词条：单项 ≤20、最高两项 ≤35（用户词条口径）', async () => {
    const h = await setupHarness(TEAM, { recommendedBuild: true } as never)
    const alloc = h.config.team[2].driveDisc.subStatAllocation
    for (const [stat, n] of Object.entries(alloc)) expect(n, `${stat} 单项超 20`).toBeLessThanOrEqual(20)
    expect(topTwoOf(alloc), `最高两项合计超 ${SUBSTAT_TOP2_STEP_CAP}：${JSON.stringify(alloc)}`).toBeLessThanOrEqual(SUBSTAT_TOP2_STEP_CAP)
  }, 120000)

  it('自己不打伤害：主词条与副词条里都不出现攻击力/暴击类（只做拐力）', async () => {
    const h = await setupHarness(TEAM, { recommendedBuild: true } as never)
    const rec = h.catalog.getBuildRecommendation('1661')!
    const dmgStats = ['atkPct', 'critRate', 'critDmg', 'penRatio', 'physicalDmg', 'fireDmg', 'iceDmg', 'electricDmg', 'etherDmg', 'windDmg']
    const mainProps = Object.values(rec.main_stats).map(m => m.prop)
    expect(mainProps.filter(p => dmgStats.includes(p)), '知更鸟主词条混进了输出词条').toEqual([])
    expect((rec.substats ?? []).map(s => s.prop).filter(p => dmgStats.includes(p)), '知更鸟副词条混进了输出词条').toEqual([])
  }, 120000)
})

/**
 * 1571 诺姆 / 1621 洛克茜（两人都是[击破]）的**推荐配装**与「常规 / 锋御」两套出装（用户 2026-10-28/29）。
 *
 * 用户口径（逐字，两次）：
 *  · 「洛克茜带 3 个 2 件套都是回能的，你改一下，现在的 4 件套摇摆是错的。诺姆带山大王没问题。
 *    新的驱动盘四件套给击破带，可以加锐化伤害。诺姆和洛克茜和锋御角色组队时就带这个 4 件套。」
 *  · 「当然，2+2+2 是给常规队用的，代替的是非常弱的四摇摆。锋御队该用新套装加锐化拐。」
 *  ⇒ **常规队默认**：诺姆 = 4pc 山大王（站点原样）、洛克茜 = **2+2+2**（摇摆2+月光2+34400×2，回能 +60%）；
 *    **锋御队（队里有挽昼/克拉蕾）**：击破位换 4pc 34400v1（全队锐化伤害 +8%）——推荐配装按角色只存单份，
 *    所以这份默认给常规盘，锋御那侧由用户手选（推荐条目 strategy 里写明了实测与做法）。
 *
 * 判据四条（各拦一种真实失败模式）：
 *   ① 一键应用装上的默认盘正是上面那两套（失败模式 = 推荐 JSON 被 sync 脚本按站点 raw 重建、静默回退；
 *      或 2pc/专武/第三套被顺手改掉）。
 *   ② 洛克茜的 2+2+2 形态真的成立：三套各 2 件、回能 +60%、**4 件段不发放**。
 *   ③ 锋御队那条路可走：手动把诺姆的 4pc 换成 34400v1 ⇒ 锋御队友（1601）面板锐化 +8。
 *   ④ 锋御队里换新盘队伤更高（实测 1601+1571+1661 72.163M → 76.512M；1601+1621+1661 88.90M → 95.10M）
 *      —— 失败模式 = 口径写反（把「换盘是亏的」当默认）。
 */
const SHARP_TEAM = (stunId: string) => [{ agentId: '1601' }, { agentId: stunId }, { agentId: '1661' }] as never

describe('1571 诺姆 / 1621 洛克茜 · 击破位换 3.4 新盘 34400v1', () => {
  it('① 一键应用 = 常规默认：诺姆 4pc 山大王（备选 = 锋御替换项 34400v1）；洛克茜走 2+2+2（见下条）', async () => {
    const norma = await setupHarness(SHARP_TEAM('1571'), { recommendedBuild: true } as never)
    const n = norma.config.team[1]
    expect(n.driveDisc.fourPieceSetId, '诺姆常规默认 = 山大王（被改回 34400v1 了？锋御队那条是手选路径）').toBe('33200')
    expect(n.driveDisc.twoPieceSetId).toBe('31000') // 啄木鸟电音（站点原样）
    expect(n.driveDisc.thirdTwoPieceSetId ?? undefined, '诺姆不是 2+2+2').toBeUndefined()
    expect(n.wEngineId).toBe('14157')
    expect(norma.catalog.getBuildRecommendation('1571')!.drive_disc_sets.alt_two_piece?.id, '备选行要给锋御队的替换项 34400v1').toBe('34400v1')

    const roxy = await setupHarness(SHARP_TEAM('1621'), { recommendedBuild: true } as never)
    const r = roxy.config.team[1]
    expect(r.wEngineId).toBe('14162')
    expect(roxy.catalog.getBuildRecommendation('1621')!.drive_disc_sets.alt_two_piece?.id).toBe('31000')
  }, 180000)

  it('★ 洛克茜 = 2+2+2（摇摆2+月光2+34400×2，用户 2026-10-29）：三套各 2 件、回能 +60%、4 件段不生效', async () => {
    const h = await setupHarness(SHARP_TEAM('1621'), { recommendedBuild: true } as never)
    const d = h.config.team[1].driveDisc
    expect(d.fourPieceSetId).toBe('31600')          // 摇摆爵士 ×2（2+2+2 的第一套）
    expect(d.twoPieceSetId).toBe('33400')           // 月光骑士颂 ×2
    expect(d.thirdTwoPieceSetId, '第三套没装上 ⇒ 形态退回 4+2，回能只剩 20%').toBe('34400v1')
    expect(h.catalog.getBuildRecommendation('1621')!.drive_disc_sets.alt_two_piece?.id).toBe('31000')
    // 形态判定（引擎同源）：三套各 2 件、没有 4 件套
    expect([...resolveDiscSetPieces(d)]).toEqual([['31600', 2], ['33400', 2], ['34400v1', 2]])
    expect(discFourPieceSetIdOf(d)).toBeUndefined()
    // 引擎读数：三个二件套的回能都进面板（+60%），且 34400 的 4pc「全队锐化 +8」不生效
    const roxy = computePanelPhases(1, h.config, h.catalog)!
    expect(roxy.outOfCombat.energyRegenBonusPct).toBeGreaterThanOrEqual(60)
    const sunbringer = computePanelPhases(0, h.config, h.catalog)!.inCombat.sharpDmgBonus ?? 0
    h.config.setThirdTwoPieceSet(1, '')   // 退回 4+2（此时第一套 = 4 件套）
    const sunbringerAfter = computePanelPhases(0, h.config, h.catalog)!.inCombat.sharpDmgBonus ?? 0
    expect(sunbringerAfter - sunbringer, '2+2+2 下 34400 只有 2 件 ⇒ 全队锐化不发放').toBeCloseTo(0, 6)
  }, 180000)

  it('③ 锋御队那条路可走：诺姆手选 4pc 34400v1 ⇒ 锋御队友（1601）面板锐化 +8', async () => {
    const h = await setupHarness(SHARP_TEAM('1571'), { recommendedBuild: true } as never)
    const mountain = computePanelPhases(0, h.config, h.catalog)!.inCombat.sharpDmgBonus ?? 0   // 默认：山大王
    h.config.setFourPieceSet(1, '34400v1')                                                     // 锋御队：手选新盘
    const sharp = computePanelPhases(0, h.config, h.catalog)!.inCombat.sharpDmgBonus ?? 0
    expect(sharp - mountain, '34400v1 的「装备者为[击破] ⇒ 全队锐化 +8」必须进锋御队友面板').toBeCloseTo(8, 6)
  }, 180000)

  it('④ 锋御队里换新盘队伤更高（引擎实测：诺姆 +6.0% / 洛克茜 +7.0%）', async () => {
    const read = async (stun: string, fourPiece: string) => {
      const h = await setupHarness(SHARP_TEAM(stun), { recommendedBuild: true } as never)
      h.config.setFourPieceSet(1, fourPiece)
      const calc = useResourceCalc()
      await flush()
      return calc.teamTotalDamage.value
    }
    const normaNew = await read('1571', '34400v1')
    const normaOld = await read('1571', '33200')
    expect(normaNew, `诺姆换 34400v1 后队伤 ${(normaNew / 1e6).toFixed(3)}M 应高于山大王 ${(normaOld / 1e6).toFixed(3)}M`)
      .toBeGreaterThan(normaOld)

    const roxyNew = await read('1621', '34400v1')
    const roxyOld = await read('1621', '31600') // 31600 = 2+2+2 的第一套（形态不变，即常规盘）
    expect(roxyNew, `洛克茜换 4pc 34400v1 后队伤 ${(roxyNew / 1e6).toFixed(3)}M 应高于常规 2+2+2 的 ${(roxyOld / 1e6).toFixed(3)}M`)
      .toBeGreaterThan(roxyOld)
  }, 300000)
})
