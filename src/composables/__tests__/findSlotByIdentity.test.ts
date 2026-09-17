/**
 * `findSlotByIdentity`（按角色身份找槽位，单一事实源）的判据。
 *
 * ## 为什么需要这个 helper（2026-09-17 round 20 侦察）
 *
 * `configStore.team.findIndex(char => { const a = …; return a?.id === 'X' || a?.teammateBuffId === 'Y' })`
 * 这一形状在编排层**重复 18 次**（`damagePool` 5 / `helpers` 5 / `useResourceCalc` 3 /
 * `convergence` 3 / `normaHatChain` 1 / `liuyinPromote` 1），每处都是角色判定棘轮的计数站点。
 * 收敛成一个 helper 后：调用点不再出现身份字面量（棘轮 −5），判定只在一处、不可能再漂移。
 *
 * ## 判据要点（这些正是「照抄旧表达式」时最容易写错的）
 *
 * 1. **两个字段都要查**：`agent.id` 与 `agent.teammateBuffId`。
 *    蕾米埃尔是典型：`id === '1581'`，`teammateBuffId === 'remielle'` 是**别名**。
 *    旧正则口径只认 `agentId ===`，这两种形态都漏 —— 换尺的理由（见 check-guards 沿革）。
 * 2. **找不到返回 -1**（不是 undefined）：调用方按 `< 0` 判空。
 * 3. **空槽 / 未知 agent 安全**：`char.agentId` 为空或 catalog 查不到 ⇒ 跳过，不抛。
 * 4. **槽位号 ≠ 下标**：返回的是 `configStore.team` 的**下标**（该数组本身就是按槽位排列的
 *    队伍配置，索引即槽位号；压缩的是 `characters`/`panels`，不是 `team`）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { findSlotByIdentity } from '@/composables/resourceCalc/helpers'

async function ctx(team: Array<{ agentId: string; cinemaLevel?: number }>) {
  const { catalog, config } = await setupHarness(team as never, { recommendedBuild: true })
  return { catalog, config }
}

describe('findSlotByIdentity（按身份找槽位）', () => {
  it('★ 按 agent.id 命中', async () => {
    const { catalog, config } = await ctx([{ agentId: '1181' }, { agentId: '1581' }, { agentId: '1011' }])
    expect(findSlotByIdentity(config, catalog, ['1581'])).toBe(1)
  })

  it('★ 按 teammateBuffId 命中（契约面必须留：数据面可能变）', async () => {
    // ⚠ **实测数据面现状（2026-09-17，本批勘查发现，已记入报告）**：
    // catalog 里 `teammateBuffId` 只有 5 个取值（1171/1261/1411/1511/1581），
    // **全部等于该角色自己的 id** ⇒ 对现有数据，「查 teammateBuffId」与「查 id」等价。
    // 而到处写的别名 `'remielle'` **不是任何角色的 teammateBuffId**（它只是 catalog 里
    // `remielleRefringeCoefficient` 之类 **stat/effect 名前缀**）⇒ 那些
    // `agent.teammateBuffId === 'remielle'` 右臂在当前数据面恒 false。
    // ⇒ 本 helper **仍必须保留第二字段查询**：它是契约面（数据面将来可能给出真别名），
    //    删掉会让「按别名引用」静默失效，而那正是旧正则口径漏计 27 行的同族错误。
    // 故此处不钉 `'remielle'`（那会钉住一个死值），而用**数据面真值**验两字段都生效：
    const { catalog, config } = await ctx([{ agentId: '1181' }, { agentId: '1581' }, { agentId: '1011' }])
    expect(findSlotByIdentity(config, catalog, ['1581'])).toBe(1)   // id 命中
    const remielleAgent = catalog.getAgent('1581')!
    expect(remielleAgent.teammateBuffId, '数据面：1581 的 buffId').toBe('1581')
    // 用「数据面给什么就认什么」的方式验：把该角色真实 teammateBuffId 传进去必须命中
    expect(findSlotByIdentity(config, catalog, [remielleAgent.teammateBuffId!])).toBe(1)
  })

  it('★ 死别名 `remielle` 当前数据面查不到（诚实记录，不钉成契约）', async () => {
    const { catalog, config } = await ctx([{ agentId: '1181' }, { agentId: '1581' }, { agentId: '1011' }])
    // 这不是 helper 的缺陷、也不是要修的行为——是**数据面事实**：`remielle` 不是任何角色的
    // teammateBuffId。本断言把该事实钉住，使「某天它真的成为别名」时这里立刻变红、提醒复核。
    const allBuffIds = new Set<string>()
    for (const a of (catalog as any).agents ?? []) if (a?.teammateBuffId) allBuffIds.add(String(a.teammateBuffId))
    expect(allBuffIds.has('remielle'), 'remielle 若成为真 teammateBuffId ⇒ 本行红，应复核 18 处旧右臂').toBe(false)
    expect(findSlotByIdentity(config, catalog, ['remielle'])).toBe(-1)
  })

  it('未命中 ⇒ 返回 -1（不是 undefined/0）', async () => {
    const { catalog, config } = await ctx([{ agentId: '1181' }, { agentId: '1011' }, { agentId: '1031' }])
    expect(findSlotByIdentity(config, catalog, ['1581'])).toBe(-1)
    expect(findSlotByIdentity(config, catalog, ['remielle'])).toBe(-1)
  })

  it('★ 前导空槽：槽位号仍正确（不许返回压缩后的下标）', async () => {
    // team = ['', 1581, 1011] ⇒ 蕾米在槽位 1；若实现误用压缩数组语义会返回 0
    const { catalog, config } = await ctx([{ agentId: '' }, { agentId: '1581' }, { agentId: '1011' }])
    expect(findSlotByIdentity(config, catalog, ['1581'])).toBe(1)
    expect(findSlotByIdentity(config, catalog, ['1011'])).toBe(2)
  })

  it('多 id 任一命中即算（顺序无关）', async () => {
    const { catalog, config } = await ctx([{ agentId: '1401' }, { agentId: '1011' }, { agentId: '1031' }])
    expect(findSlotByIdentity(config, catalog, ['9999', '1401'])).toBe(0)
    expect(findSlotByIdentity(config, catalog, ['1401', '9999'])).toBe(0)
  })

  it('★ 等价性：helper 结果 === 旧内联 findIndex 表达式（逐槽位对照）', async () => {
    // 旧表达式（本批消除的形状）——用它做 oracle，证明收敛没改语义
    const legacy = (config: any, catalog: any, idA: string, idB: string) =>
      config.team.findIndex((char: any) => {
        const a = char.agentId ? catalog.getAgent(char.agentId) : null
        return a?.id === idA || a?.teammateBuffId === idB
      })
    for (const team of [
      [{ agentId: '1011' }, { agentId: '1581' }, { agentId: '1031' }],
      [{ agentId: '1581' }, { agentId: '1011' }, { agentId: '1031' }],
      [{ agentId: '' }, { agentId: '1011' }, { agentId: '1581' }],
      [{ agentId: '1011' }, { agentId: '1031' }, { agentId: '1041' }],
      [{ agentId: '1401' }, { agentId: '1011' }, { agentId: '1581' }],
    ] as const) {
      const { catalog, config } = await ctx(team as never)
      // 单 id 形态（id === buffId，如 '1581'）与 双 id 形态（'1581' + 'remielle'）都要一致
      expect(findSlotByIdentity(config, catalog, ['1581']), JSON.stringify(team))
        .toBe(legacy(config, catalog, '1581', '1581'))
      expect(findSlotByIdentity(config, catalog, ['1581', 'remielle']), JSON.stringify(team))
        .toBe(legacy(config, catalog, '1581', 'remielle'))
      expect(findSlotByIdentity(config, catalog, ['1401']), JSON.stringify(team))
        .toBe(legacy(config, catalog, '1401', '1401'))
    }
  })
})
