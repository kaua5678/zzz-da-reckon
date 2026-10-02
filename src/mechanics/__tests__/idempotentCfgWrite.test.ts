/**
 * CC-291：同一轮内会被重复调用的模块钩子，对 cfg 的累加写入必须幂等。
 *
 * 背景：`buildCharConfig`（建 base 一次）与 `applyTeamConfig`（每轮每相位对新克隆调一次，convergence.ts:424）
 * 之外的钩子——patchExecutions / materializePhaseState / buildExecutions / buildAnomalyEvents …——
 * 会在**同一份 cfg** 上被内层迭代、试探测量（underfillProbe）重复调用。在这里写
 * `cfg.k = (cfg.k ?? 0) + x` 会随调用次数累加：
 * - 格莉丝 C4 回能（materializePhaseState）：能量账读到的 initialEnergyGift 从 124 涨到 853.9，本应只加约 70；
 * - 奥菲丝 C2 喧响（patchExecutions）：extraSelfDecibelReward 读到 5850，本应 2925。
 * 正确写法：先扣本模块上次写入量再加新值（`prev` 记在本模块专属键上，见 ellen / panYinhu / corin）。
 *
 * ① 源码锁（TypeScript AST）：上述钩子（含其调用的同文件 helper，深 3 层）里出现「自引用累加」且右侧没有 prev 扣减 ⇒ 红。
 * ② 行为锁：两处修复点重复调用后结果不变。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { graceMechanic } from '../agents/grace'
import { orphieMechanic } from '../agents/orphie'

const AGENTS_DIR = fileURLToPath(new URL('../agents/', import.meta.url))
/** 只调用一次的钩子 / 非函数字段 */
const ONCE = new Set(['buildCharConfig', 'applyTeamConfig', 'id', 'name', 'description', 'agentIds', 'settings'])
/**
 * 允许名单（写明为什么不累积）：
 * - yidhari.ts onFinalAssemble：每次装配只调一次，且 core/resource.ts:274 的第二遍装配在全新 cfg 上跑（不叠加）。
 */
const ALLOW = new Set(['yidhari.ts:onFinalAssemble:yidhariExternalHealPct'])

function scan(): string[] {
  const hits: string[] = []
  for (const f of readdirSync(AGENTS_DIR).filter(x => x.endsWith('.ts'))) {
    const sf = ts.createSourceFile(f, readFileSync(AGENTS_DIR + f, 'utf8'), ts.ScriptTarget.Latest, true)
    const fns = new Map<string, ts.FunctionLikeDeclaration>()
    const hookFns: Array<[string, ts.Node]> = []
    const visit = (n: ts.Node) => {
      if (ts.isFunctionDeclaration(n) && n.name) fns.set(n.name.text, n)
      if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name)
        && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) fns.set(n.name.text, n.initializer)
      if (ts.isPropertyAssignment(n) && !ONCE.has(n.name.getText(sf))) hookFns.push([n.name.getText(sf), n.initializer])
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isPropertyAccessExpression(n.left) && /Mechanic$/.test(n.left.expression.getText(sf))
        && !ONCE.has(n.left.name.text)) hookFns.push([n.left.name.text, n.right])
      ts.forEachChild(n, visit)
    }
    visit(sf)
    for (const [hook, init] of hookFns) {
      const seen = new Set<ts.Node>()
      const scanFn = (fn: ts.Node | undefined, depth: number) => {
        const body = fn && (fn as ts.FunctionLikeDeclaration).body
        if (!body || seen.has(fn!) || depth > 3) return
        seen.add(fn!)
        const walk = (n: ts.Node) => {
          if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && fns.has(n.expression.text)) scanFn(fns.get(n.expression.text), depth + 1)
          if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.EqualsToken || n.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken)
            && (ts.isPropertyAccessExpression(n.left) || ts.isElementAccessExpression(n.left))) {
            const obj = n.left.expression.getText(sf).replace(/[()\s]|as any|as unknown as Record<string, unknown>/g, '')
            const key = ts.isPropertyAccessExpression(n.left) ? n.left.name.text : n.left.argumentExpression.getText(sf).replace(/['"]/g, '')
            const rhs = n.right.getText(sf)
            const selfRef = n.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken || new RegExp(`\\b${key}\\b`).test(rhs)
            if (/^(cfg|record|rec|c|mateCfg|mateRecord)$/.test(obj) && selfRef && !/prev/i.test(rhs)) {
              const id = `${f}:${hook}:${key}`
              if (!ALLOW.has(id)) hits.push(`${id} @${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`)
            }
          }
          ts.forEachChild(n, walk)
        }
        walk(body)
      }
      scanFn(ts.isIdentifier(init) ? fns.get(init.text) : init, 0)
    }
  }
  return hits
}

describe('CC-291 重复调用钩子的 cfg 累加写入幂等', () => {
  it('① 源码锁：无「自引用累加且不扣 prev」的写入', () => {
    expect(scan(), '重复调用的钩子里累加 cfg 必须先扣本模块上次写入量（见本文件头注释）').toEqual([])
  })

  it('② 格莉丝 materializePhaseState 重复调用不累加 initialEnergyGift', () => {
    const cfg: any = { graceCinemaLevel: 6, initialEnergyGift: 40 }
    const state: any = { exSpecialCount: 30, basicAttackTime: 120, totalEnergy: 1000, combatTime: 180 }
    graceMechanic.materializePhaseState!({ cfg, state, executions: [] } as any)
    const once = cfg.initialEnergyGift
    for (let i = 0; i < 5; i++) graceMechanic.materializePhaseState!({ cfg, state, executions: [] } as any)
    expect(cfg.initialEnergyGift).toBe(once)
  })

  it('② 奥菲丝 patchExecutions 重复调用不累加 extraSelfDecibelReward', () => {
    const cfg: any = { orphieCinemaLevel: 6, extraSelfDecibelReward: 100 }
    const mk = () => [{ moveId: 'x', skillDamageTarget: 'additionalAttack', count: 10, totalTime: 1 }] as any[]
    // r406：战斗时长走 IterationState 真实字段（orphie 现读 effectiveCombatTime；旧夹具的 `combatTime` 不存在于 state）
    orphieMechanic.patchExecutions!({ cfg, state: { frontlineTime: 180, backstageTime: 0 }, executions: mk() } as any)
    const once = cfg.extraSelfDecibelReward
    expect(once).toBeGreaterThan(100)
    for (let i = 0; i < 5; i++) orphieMechanic.patchExecutions!({ cfg, state: { frontlineTime: 180, backstageTime: 0 }, executions: mk() } as any)
    expect(cfg.extraSelfDecibelReward).toBe(once)
  })
})
