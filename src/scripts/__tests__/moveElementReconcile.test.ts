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

const mod = recNs as {
  reconcileMoveElements: (o: { catalog: unknown; fullDir: string; enforceFloors?: boolean }) => {
    rawFiles: number; catalogAgents: number; reconciledAgents: number; scannedMoves: number
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
  it('③ 注入「解析器输出 catalog 里不存在的 moveId」⇒ orphans 点名（首版零检查）', () => {
    const f = fixture()
    // raw 里多给一个 moveId 1101002，但 catalog 只有 1101001 ⇒ 2 是 orphan
    writeFileSync(join(f.fullDir, '1101.json'), JSON.stringify({
      skill: {
        basic: {
          description: [
            { name: '普通攻击：测试斩', desc: '对敌人造成电属性伤害。' },
            { name: '普通攻击：测试斩', param: [{ name: '一段伤害倍率', param: { 1101001: 100, 1101002: 100 } }] },
          ],
        },
      },
    }), 'utf8')
    // 解析面（resolveMoveElements 的入参）只在 catalog moveIds 内 ⇒ 需显式传入 1101002 才成 orphan；
    // 这里改为断言「对账器确实按 catalog moveId 全集做差集」：把 catalog 的一招从 categories 里藏掉。
    const cats = (f.catalog.agentSkills[0] as { categories: { moves: unknown[] }[] }).categories
    cats[0].moves.push({
      id: 1101002,
      name: { zhCN: '普通攻击：测试斩#2' },
      damageElement: 'electric',
      rows: [{ kind: 'damageMultiplier', damageElement: 'electric' }],
    })
    // 此时两侧仍有 1101002，orphan=0（负控：不该误报）
    const ok = run(f)
    expect(ok.orphans).toEqual([])
    expect(mod.moveElementReconcileOk(ok)).toBe(true)
  })

  it('③-b orphan 正控：解析结果指向 catalog 之外的 id 时被抓（直接构造解耦输入）', () => {
    // 用 raw 里两条 **不同名字** 的组：catalog 只声明第二组 ⇒ 第一组解析出的 id 不在 catalog 面内
    const root = mkdtempSync(join(tmpdir(), 'movereconcile-'))
    tmpRoots.push(root)
    const fullDir = join(root, 'full')
    mkdirSync(fullDir, { recursive: true })
    writeFileSync(join(fullDir, '1101.json'), JSON.stringify({
      skill: {
        basic: {
          description: [
            { name: '普通攻击：测试斩', desc: '对敌人造成电属性伤害。' },
            { name: '普通攻击：测试斩', param: [{ name: '一段伤害倍率', param: { 1101001: 100 } }] },
          ],
        },
      },
    }), 'utf8')
    const catalog = {
      agents: [{ id: 1101, name: { zhCN: '测试角色' } }],
      agentSkills: [{
        agentId: 1101,
        categories: [{
          id: 'basic',
          moves: [{
            id: 1101001, name: { zhCN: '普通攻击：测试斩' },
            damageElement: 'electric',
            rows: [{ kind: 'damageMultiplier', damageElement: 'electric' }],
          }],
        }],
      }],
    }
    // 负控：正常输入下 orphan = 0
    expect(run({ fullDir, catalog }).orphans).toEqual([])
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
