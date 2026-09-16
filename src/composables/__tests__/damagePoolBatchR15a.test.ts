/**
 * R15-a 批次（`damagePool.ts` 两处 agentId 分支迁进模块）的**精确值判据**。
 *
 * 迁移内容（2026-09-16 round 15，编排棘轮 25 → 23）：
 *  · `:408` 柏妮思影画4/6 —— 原为
 *    `const burniceCinema = charResult.agentId === '1171' ? configStore.team[slot]?.cinemaLevel ?? 0 : 0`
 *    后跟「C4 → special/assist 行 +30 暴击率」「C6 → 1171012/1171013 +25 无视火抗」两条。
 *    现迁进 `burnice.ts#patchBurniceExecutions`（读模块自己 cfg 的 `burniceCinemaLevel`），
 *    写通用行级通道 `exec.critRateBonus` / `exec.resIgnore`。
 *  · `:970` 般岳影画6 摧岳附伤 —— 原为 `charResult.agentId === '1471' && cinemaLevel >= 6`
 *    + 自己 `executions.find(e => e.moveId === '1471009')`。现改为读**倾山行上的模块标记**
 *    `banyueC6CrushAttach`（唯一写入方 = `banyue.ts#patchBanyueExecutions`，仅 C6 写自己的倾山行）。
 *
 * 为什么必须单独有这个文件（不是「补测试」的仪式）：
 *  · `damagePool.ts` 这两处在迁走后**没有任何既有测试**能区分「迁移成功」与「静默失效」——
 *    短路后 `timeGolden` 的 `grep -c "dmg:"` 仍可能 == 0（本仓已实测四种假绿形态，见任务卡）。
 *  · 柏妮思 C4 的两臂（special/assist）与 C6 的**两个** moveId 是**四个独立分支**，
 *    `> 0` 型断言会让「只对 1171012 生效、1171013 漏了」这种错**静默通过** ⇒ 一律写精确值。
 *  · 般岳标记是 T6 判据（「字段唯一写入方 = 该角色模块 ⇒ 字段判据覆盖角色判据」）的又一实例，
 *    必须同时锁**正控**（般岳 C6 有标记）与**反锁**（别人 C6 不出现标记），
 *    否则「标记是死的」与「判据没生效」不可区分（round 9 教训①）。
 */
import { describe, expect, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { burniceMechanic } from '@/mechanics/agents/burnice'
import { banyueMechanic } from '@/mechanics/agents/banyue'

/** 关掉全部全局 buff（含额外能力），让命座差异成为唯一变量 */
function isolate(config: Awaited<ReturnType<typeof setupHarness>>['config']) {
  for (const b of config.globalBuffs) b.enabled = false
}

async function calcOf(team: Parameters<typeof setupHarness>[0]) {
  const { config, catalog } = await setupHarness(team)
  isolate(config)
  const calc = useResourceCalc()
  await new Promise(r => setTimeout(r, 60))
  return { calc, config, catalog }
}

/** 取某槽角色的执行行（按 agentId 找，不按下标） */
function execsOf(calc: ReturnType<typeof useResourceCalc>, agentId: string) {
  return calc.resourceResult.value!.characters.find(c => c.agentId === agentId)!.executions
}

// ── 跳③：模块钩子（纯函数级，绕开整条管线） ─────────────────────────────────────
describe('R15-a 跳③：burnice.patchExecutions 的四条行级分支（精确值）', () => {
  const mkExec = (moveId: string, category: string) => ({ moveId, category, moveName: moveId, count: 1 } as any)

  const run = (cinemaLevel: number, execs: any[]) => {
    burniceMechanic.patchExecutions!({
      cfg: { burniceCinemaLevel: cinemaLevel } as any,
      state: {} as any,
      executions: execs,
    } as any)
    return execs
  }

  it('C0：一行都不改（critRateBonus / resIgnore 全为 undefined = 不伪造 0）', () => {
    const execs = [mkExec('1171012', 'special'), mkExec('1171019', 'assist'), mkExec('1171017', 'chain')]
    run(0, execs)
    expect(execs.map(e => e.critRateBonus)).toEqual([undefined, undefined, undefined])
    expect(execs.map(e => e.resIgnore)).toEqual([undefined, undefined, undefined])
  })

  it('C4：special +30 / assist +30 / chain 不动（三态逐位精确）', () => {
    const execs = [mkExec('1171010', 'special'), mkExec('1171019', 'assist'), mkExec('1171017', 'chain'), mkExec('basic_attack', 'basic')]
    run(4, execs)
    expect(execs.map(e => e.critRateBonus)).toEqual([30, 30, undefined, undefined])
    expect(execs.map(e => e.resIgnore)).toEqual([undefined, undefined, undefined, undefined])
  })

  it('C6：1171012 与 1171013 **各自** +25 无视火抗（另两行不加 = 精确到 moveId）', () => {
    const execs = [mkExec('1171012', 'special'), mkExec('1171013', 'special'), mkExec('1171010', 'special'), mkExec('1171011', 'special')]
    run(6, execs)
    expect(execs.map(e => e.resIgnore)).toEqual([25, 25, undefined, undefined])
    // C6 蕴含 C4：四行 special 全部 +30
    expect(execs.map(e => e.critRateBonus)).toEqual([30, 30, 30, 30])
  })

  it('累加而非覆盖：行上已有 critRateBonus/resIgnore 时按 += 叠加（逐位保留原语义）', () => {
    const execs = [Object.assign(mkExec('1171012', 'special'), { critRateBonus: 7, resIgnore: 3 })]
    run(6, execs)
    expect(execs[0].critRateBonus).toBe(37)
    expect(execs[0].resIgnore).toBe(28)
  })
})

describe('R15-a 跳③：banyue.patchExecutions 的影画6 标记（精确值）', () => {
  const mkExec = (moveId: string) => ({ moveId, category: 'basic', moveName: moveId, count: 3 } as any)

  const run = (cinemaLevel: number, execs: any[]) => {
    banyueMechanic.patchExecutions!({
      cfg: { banyueCinemaLevel: cinemaLevel } as any,
      state: {} as any,
      executions: execs,
    } as any)
    return execs
  }

  it('C5：倾山行**没有**标记（影画6 才写；缺字段 = 不伪造）', () => {
    const execs = [mkExec('1471009'), mkExec('1471010')]
    run(5, execs)
    expect((execs[0] as any).banyueC6CrushAttach).toBeUndefined()
  })

  it('C6：只有倾山(1471009) 行有标记，值为附伤倍率 600（摧岳 1471010 不写）', () => {
    const execs = [mkExec('1471009'), mkExec('1471010')]
    run(6, execs)
    expect((execs[0] as any).banyueC6CrushAttach).toBe(600)
    expect((execs[1] as any).banyueC6CrushAttach).toBeUndefined()
  })
})

// ── 跳①/②：真管线（真 store + 真派发器），断言消费端真的读到了 ─────────────────────
describe('R15-a 真管线：柏妮思 C4/C6 落到执行行（真 store，非合成）', () => {
  it('C6 队：双喷两行 resIgnore=25、special/assist 行 critRateBonus=30、chain/dodge 不带', async () => {
    const { calc } = await calcOf([{ agentId: '1171', cinemaLevel: 6 }, { agentId: '1181' }])
    const execs = execsOf(calc, '1171')
    const byId = new Map(execs.map(e => [e.moveId, e]))
    // 精确到 moveId：双喷持续/爆炸各 +25
    expect(byId.get('1171012')!.resIgnore).toBe(25)
    expect(byId.get('1171013')!.resIgnore).toBe(25)
    // 单喷两行**不**吃 C6（那是「双份」限定）
    expect(byId.get('1171010')!.resIgnore).toBeUndefined()
    expect(byId.get('1171011')!.resIgnore).toBeUndefined()
    // C4 臂：special 行全部 +30
    expect(byId.get('1171010')!.critRateBonus).toBe(30)
    expect(byId.get('1171012')!.critRateBonus).toBe(30)
    // chain（终结技/连携）不吃 C4
    expect(byId.get('1171017')!.critRateBonus).toBeUndefined()
  })

  it('C0 队：同队同槽，两行 resIgnore/critRateBonus 全为 undefined（命座是唯一变量）', async () => {
    const { calc } = await calcOf([{ agentId: '1171', cinemaLevel: 0 }, { agentId: '1181' }])
    const execs = execsOf(calc, '1171')
    expect(execs.filter(e => (e.resIgnore ?? 0) > 0)).toEqual([])
    expect(execs.filter(e => (e.critRateBonus ?? 0) > 0)).toEqual([])
  })

  it('C4 队（非 6）：critRateBonus=30 但 resIgnore 全空（两臂独立，不会一起亮）', async () => {
    const { calc } = await calcOf([{ agentId: '1171', cinemaLevel: 4 }, { agentId: '1181' }])
    const execs = execsOf(calc, '1171')
    expect(execs.filter(e => e.critRateBonus === 30).length).toBeGreaterThan(0)
    expect(execs.filter(e => (e.resIgnore ?? 0) > 0)).toEqual([])
  })
})

describe('R15-a 真管线：般岳影画6 摧岳附伤行', () => {
  it('C6 队：附伤行次数 == 倾山行次数（精确相等，不是 >0），倍率 600', async () => {
    const { calc } = await calcOf([{ agentId: '1471', cinemaLevel: 6 }, { agentId: '1181' }])
    const qingShan = execsOf(calc, '1471').find(e => e.moveId === '1471009')!
    const attach = calc.damagePoolRows.value.find(r => r.id === 'banyue-c6-crush-attach')!
    expect(qingShan.count).toBeGreaterThan(0)
    expect(attach.count).toBe(qingShan.count)
    expect(attach.multiplier).toBe(600)
    expect(attach.agentId).toBe('1471')
    expect(attach.moveId).toBe('banyue_c6_crush_attach')
  })

  it('C5 队：同一队形不出附伤行（影画6 是唯一门槛）', async () => {
    const { calc } = await calcOf([{ agentId: '1471', cinemaLevel: 5 }, { agentId: '1181' }])
    expect(calc.damagePoolRows.value.find(r => r.id === 'banyue-c6-crush-attach')).toBeUndefined()
  })
})

// ── 反锁：T6 判据的「字段即身份」必须两侧都锁（正控 + 反锁成对） ──────────────────────
describe('R15-a 反锁：标记不会泄漏给别的角色（否则 = 把专属机制发给全游戏）', () => {
  it('不含 1171/1471 的队：任何执行行都不带这两个模块标记', async () => {
    const { calc } = await calcOf([{ agentId: '1431', cinemaLevel: 6 }, { agentId: '1481', cinemaLevel: 6 }, { agentId: '1311', cinemaLevel: 6 }])
    const all = calc.resourceResult.value!.characters.flatMap(c => c.executions)
    expect(all.length).toBeGreaterThan(0)
    const leaked = all.filter(e => (e as any).banyueC6CrushAttach !== undefined)
    expect(leaked.map(e => e.moveId)).toEqual([])
    expect(calc.damagePoolRows.value.find(r => r.id === 'banyue-c6-crush-attach')).toBeUndefined()
  })

  it('正控：般岳 C6 队里标记**确实**可被检出（证明上面那条反锁不是空转）', async () => {
    const { calc } = await calcOf([{ agentId: '1471', cinemaLevel: 6 }, { agentId: '1181' }])
    const marked = execsOf(calc, '1471').filter(e => (e as any).banyueC6CrushAttach !== undefined)
    expect(marked.map(e => e.moveId)).toEqual(['1471009'])
  })
})
