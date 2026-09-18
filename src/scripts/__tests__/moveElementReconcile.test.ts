/**
 * 判据 18 对账器测试（2026-09-18 round 26 R25-J1）。
 *
 * 立项：`auditMoveElementsAgainstRaw` 首版（外部协作者）有三处**已实测**缺陷，
 * 补强逻辑抽到 `scripts/lib/move-element-reconcile.mjs`。本文件按 AGENTS 规则 16③
 * 与 OPEN-ITEMS R25-J1 的**证伪闸门**写：
 *
 *   **前提假设** = 「补上反空洞下限 / 行级 undefined 检出 / orphan 检查三处后，
 *   『catalog 被改回去 / 解析器静默失效 / raw 少角色』三类都能红」。
 *   **假设为假时的可观察失败** = 补完仍有某一类**平凡绿**（下限被设成 0、orphan 用 continue 吞掉）
 *   ⇒ 所以每条判据都配一个**合成注入用例**，先证「注入该退化 ⇒ 判红」再断言仓库现状绿。
 *   单靠「仓库现状 = 0 违规」是**无效断言**（恒绿，判据写错也绿）。
 *
 * ⚠ 接线状态：本模块**尚未**被 `check-guards.mjs` 调用（该文件当时是外部协作者的未提交 WIP，
 * 规则 13 不许替它提交）。故本测试是**目前唯一的判据面**；接线后 `checkGuards.test.ts` 的
 * 条数断言会多一条（17 → 18），届时同步。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// @ts-expect-error -- scripts/lib 纯 JS 工具模块（与 compacted-slot-index / dead-channel-ls 同处理）
import * as recNs from '../../../scripts/lib/move-element-reconcile.mjs'
// @ts-expect-error -- 同上：解析器本体（仅用于 ③-c 的结构性不变式证明）
import { buildMoveTextIndex, resolveMoveElements } from '../../../scripts/lib/move-elements.mjs'

const mod = recNs as {
  reconcileMoveElements: (o: { catalog: unknown; fullDir: string; enforceFloors?: boolean }) => {
    rawFiles: number; catalogAgents: number; reconciledAgents: number; scannedMoves: number
    rawParamMoves: number
    violations: Record<string, unknown>[]
    skippedAgents: Record<string, unknown>[]
    orphans: Record<string, unknown>[]
    belowFloor: boolean; minScannedMoves: number
  }
  moveElementReconcileOk: (r: unknown) => boolean
  formatMoveElementReconcile: (r: unknown, limit?: number) => string[]
  MOVE_ELEMENT_MIN_SCANNED: number
}

let tmpRoots: string[] = []
afterEach(() => {
  for (const r of tmpRoots) rmSync(r, { recursive: true, force: true })
  tmpRoots = []
})

/**
 * 合成 fixture：一个角色 1101，原文说「造成**电属性**伤害」，catalog 里 move 与 row 可注入。
 * raw 结构照 `data/raw/nanoka_missing/full/*.json` 的最小可用子集（skill.<cat>.description[]）。
 */
function fixture(opts: {
  moveElement?: string
  rowElement?: string | undefined
  rowKind?: string
  withRaw?: boolean
  proseElement?: string
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'movereconcile-'))
  tmpRoots.push(root)
  const fullDir = join(root, 'full')
  mkdirSync(fullDir, { recursive: true })

  const prose = opts.proseElement ?? '电属性'
  if (opts.withRaw !== false) {
    writeFileSync(join(fullDir, '1101.json'), JSON.stringify({
      skill: {
        basic: {
          description: [
            { name: '普通攻击：测试斩', desc: `对敌人造成${prose}伤害。` },
            {
              name: '普通攻击：测试斩',
              param: [{ name: '一段伤害倍率', param: { 1101001: 100 } }],
            },
          ],
        },
      },
    }), 'utf8')
  }

  const rowKind = opts.rowKind ?? 'damageMultiplier'
  const catalog = {
    agents: [{ id: 1101, name: { zhCN: '测试角色' } }],
    agentSkills: [{
      agentId: 1101,
      categories: [{
        id: 'basic',
        moves: [{
          id: 1101001,
          name: { zhCN: '普通攻击：测试斩' },
          damageElement: opts.moveElement ?? 'electric',
          rows: [{ kind: rowKind, damageElement: opts.rowElement === undefined ? 'electric' : opts.rowElement }],
        }],
      }],
    }],
  }
  return { root, fullDir, catalog }
}

const run = (f: { fullDir: string; catalog: unknown }, enforceFloors = false) =>
  mod.reconcileMoveElements({ catalog: f.catalog, fullDir: f.fullDir, enforceFloors })

describe('reconcileMoveElements（判据 18 对账器：三处补强的可红性自证）', () => {
  it('基线：两侧一致 ⇒ 零违规', () => {
    const r = run(fixture())
    expect(r.violations).toEqual([])
    expect(r.skippedAgents).toEqual([])
    expect(r.orphans).toEqual([])
    expect(mod.moveElementReconcileOk(r)).toBe(true)
    expect(r.scannedMoves).toBe(1)
    expect(r.reconciledAgents).toBe(1)
  })

  // ---- 缺陷 ② 行级：值不对 + undefined 漏检 ----
  it('②-a 注入「row 属性被改错」⇒ 判红，且 got 取**行自己的值**（不是 move 面）', () => {
    const r = run(fixture({ moveElement: 'electric', rowElement: 'physical' }))
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].want).toBe('electric')
    expect(r.violations[0].got).toBe('physical')   // ← 首版会打印 move 面的 'electric'，自相矛盾
    expect(r.violations[0].rowChanged).toBe(true)
    expect(r.violations[0].moveChanged).toBe(false)
    expect(mod.moveElementReconcileOk(r)).toBe(false)
  })

  it('②-b 注入「row 属性字段被删成 undefined」⇒ **必须判红**（首版被 filter(Boolean) 吃掉）', () => {
    const f = fixture({ moveElement: 'electric' })
    // 删掉 row 上的 damageElement（= 字段被删/导入器退化）
    const rows = (f.catalog.agentSkills[0].categories[0].moves[0] as { rows: Record<string, unknown>[] }).rows
    delete rows[0].damageElement
    const r = run(f)
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].rowUndefined).toBe(1)
    expect(r.violations[0].got).toBeUndefined()
    expect(mod.moveElementReconcileOk(r)).toBe(false)
    const text = mod.formatMoveElementReconcile(r).join('\n')
    expect(text).toContain('属性字段缺失')
  })

  it('②-c move.damageElement 本身被翻回旧值 ⇒ 判红', () => {
    const r = run(fixture({ moveElement: 'physical', rowElement: 'electric' }))
    expect(r.violations).toHaveLength(1)
    expect(r.violations[0].moveChanged).toBe(true)
    expect(mod.moveElementReconcileOk(r)).toBe(false)
  })

  // ---- 缺陷 ① 反空洞 ----
  it('①-a 注入「解析器静默失效 / raw 散文不可解析」⇒ skippedAgents 点名（首版静默 continue、0 条不红）', () => {
    const r = run(fixture({ proseElement: '无属性词的一句话' }))
    expect(r.scannedMoves).toBe(0)
    expect(r.skippedAgents).toHaveLength(1)
    expect(String(r.skippedAgents[0].agentId)).toBe('1101')
    expect(String(r.skippedAgents[0].reason)).toContain('一条都没解析出来')
    expect(mod.moveElementReconcileOk(r)).toBe(false)
  })

  it('①-b 注入「raw 整目录消失」⇒ 全局下限判红（belowFloor）', () => {
    const f = fixture({ withRaw: false })
    const r = mod.reconcileMoveElements({ catalog: f.catalog, fullDir: f.fullDir, enforceFloors: true })
    expect(r.rawFiles).toBe(0)
    expect(r.belowFloor).toBe(true)
    expect(mod.moveElementReconcileOk(r)).toBe(false)
    expect(mod.formatMoveElementReconcile(r).join('\n')).toContain('反空洞下限')
  })

  it('①-c 下限在 enforceFloors=false 时不生效（合成小样本不被地板干扰）', () => {
    const f = fixture({ withRaw: false })
    expect(run(f, false).belowFloor).toBe(false)
  })

  // ---- 缺陷 ③ orphan ----
  //
  // ★★ round 29 实测改正：**旧的两个 orphan 用例都是负控，从未构造过 orphan**。
  // 实测证据：把 `reconcileMoveElements` 里**整段 orphan 收集删掉** ⇒ 本文件 **10/10 仍全绿**
  // ⇒ 那两条用例对「orphan 检查存在与否」**完全不可见**（写了但恒不触发 = 与没有等价）。
  // 根因：旧式 orphan 比较的是 `resolved.keys()` ↔ `catalogMoveIds`，而两者
  // **是同一个集合**（`resolveMoveElements` 只在入参 moveIds 内 out.set）⇒ 恒空。
  // 处置：改为检查真实漂移方向（raw param 键 ∉ catalog），并在此补**正控**。
  it('③ 负控：raw 与 catalog 两侧一致 ⇒ orphan 不误报', () => {
    const f = fixture()
    const ok = run(f)
    expect(ok.orphans).toEqual([])
    expect(mod.moveElementReconcileOk(ok)).toBe(true)
  })

  it('③-b ★ 正控：raw 的 param 表里有 catalog 未声明的 moveId ⇒ orphans 点名且判红', () => {
    // 真实漂移场景：nanoka raw 换版本后多出一招（或导入器漏招），catalog 还没录。
    // ⚠ 这条注入必须**真的能红**：把 lib 里 orphan 收集整段删掉 ⇒ 本用例必须失败。
    const f = fixture()
    writeFileSync(join(f.fullDir, '1101.json'), JSON.stringify({
      skill: {
        basic: {
          description: [
            { name: '普通攻击：测试斩', desc: '对敌人造成电属性伤害。' },
            // raw 的 param 表里有 1101002，但 catalog 只声明了 1101001
            { name: '普通攻击：测试斩', param: [{ name: '一段伤害倍率', param: { 1101001: 100, 1101002: 100 } }] },
          ],
        },
      },
    }), 'utf8')
    const r = run(f)
    expect(r.orphans, 'raw 多出的 moveId 必须被点名').toEqual([{ agentId: '1101', moveId: '1101002' }])
    expect(mod.moveElementReconcileOk(r)).toBe(false)
    expect(mod.formatMoveElementReconcile(r).join('\n')).toContain('orphan')
  })

  it('③-c 结构性证明：`resolved.keys() ⊆ 入参 moveIds`（旧 orphan 判据因此恒空）', () => {
    // 这条把「旧检查为什么是死代码」钉成机器判据——防后人把 orphan 改回旧式比较。
    const f = fixture()
    const full = JSON.parse(readFileSync(join(f.fullDir, '1101.json'), 'utf8'))
    // raw 里故意多给 1101002，但**入参**（= catalog 声明面）只有 1101001
    full.skill.basic.description[1].param[0].param['1101002'] = 100
    const moveIds = ['1101001']
    const resolvedKeys = [...buildMoveTextIndex(full).keys()]
    // raw 面确实看到了 1101002（证明这不是「raw 里没有」造成的平凡绿）
    expect(resolvedKeys).toContain('1101002')
    // 但解析器**只会**输出入参内的 moveId ⇒ 旧式比较 resolved.keys()↔moveIds 恒等
    const out = [...resolveMoveElements(full, moveIds).keys()].map(String)
    expect(out, '解析器只会输出入参内的 moveId').toEqual(['1101001'])
    expect(out.some(k => !moveIds.includes(k))).toBe(false)
  })

  it('③-d 真实仓库双向漂移现状：raw∉catalog 与 catalog∉raw 都必须是 0（否则点名）', () => {
    const ROOT = join(__dirname, '..', '..', '..')
    const catalog = JSON.parse(readFileSync(join(ROOT, 'public/static/catalog.json'), 'utf8'))
    const r = mod.reconcileMoveElements({ catalog, fullDir: join(ROOT, 'data/raw/nanoka_missing/full'), enforceFloors: true })
    // 活性断言：raw 键面必须非空（防 buildMoveTextIndex 静默返回空 ⇒ orphan 恒 0 的平凡绿）
    expect(r.rawParamMoves, 'raw param 表键数必须 > 0，否则 orphan 检查是平凡绿').toBeGreaterThan(0)
    expect(r.orphans).toEqual([])
  })
})

describe('reconcileMoveElements（真实仓库现状）', () => {
  const ROOT = join(__dirname, '..', '..', '..')

  it('仓库现状：零违规 / 零空洞 / 零 orphan，且覆盖不低于冻结下限', () => {
    const catalog = JSON.parse(readFileSync(join(ROOT, 'public/static/catalog.json'), 'utf8'))
    const r = mod.reconcileMoveElements({
      catalog,
      fullDir: join(ROOT, 'data/raw/nanoka_missing/full'),
      enforceFloors: true,
    })
    if (!mod.moveElementReconcileOk(r)) console.log(mod.formatMoveElementReconcile(r).join('\n'))
    expect(r.violations).toEqual([])
    expect(r.skippedAgents).toEqual([])
    expect(r.orphans).toEqual([])
    expect(r.belowFloor).toBe(false)
    // 活性断言：下限必须真的被"够得着"（防 MOVE_ELEMENT_MIN_SCANNED 被写成 0 的平凡绿）
    expect(mod.MOVE_ELEMENT_MIN_SCANNED).toBeGreaterThan(0)
    expect(r.scannedMoves).toBeGreaterThanOrEqual(mod.MOVE_ELEMENT_MIN_SCANNED)
  })
})
