/**
 * CC-359 / CC-360（D2 类型层）：公共接口只收**被两处以上引用**的成员。
 * 只有一个角色模块（`mechanics/agents/<x>.ts`）读写的成员，声明放在该模块末尾的
 * `declare module '<spec>'` 扩充块里（纯类型、零运行时，产物 JS 逐字节不变）。
 * 判据与 `scripts/d2-migrate-private-cfg.py` 同口径：剥注释；`name?:` 可选声明行（别的接口里的同名字段）不算引用；
 * 声明文件里接口体之外的引用算。
 * 红了 ⇒ 把报出的成员连同 doc 注释挪进对应模块的扩充块（或跑 `python3 scripts/d2-migrate-private-cfg.py . --target <cfg|feedback|result> <模块名>`）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const SRC = resolve(__dirname, '../..')
const TARGETS = [
  { file: 'types/resource/config.ts', iface: 'CharacterOperationConfig', min: 50 },
  { file: 'mechanics/types.ts', iface: 'ModuleFeedback', min: 1 },
  { file: 'types/resource/agentResources.ts', iface: 'CharacterResourceResult', min: 10 },
] as const

/** 注释里提到成员名不算引用（r389：convergence.ts 的迁移沿革注释曾让 36 个私有字段被误判为公共） */
function stripComments(t: string): string {
  return t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<![:'"\w])\/\/[^\n]*/g, '')
}

function walk(d: string, out: string[] = []): string[] {
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) { if (n !== '__tests__' && n !== 'test') walk(p, out) }
    else if (/\.(ts|vue)$/.test(n) && !n.endsWith('.d.ts')) out.push(p)
  }
  return out
}

const ALL = walk(SRC).map(p => ({ rel: relative(SRC, p).replace(/\\/g, '/'), raw: readFileSync(p, 'utf-8') }))

describe('CC-359/360：单模块私有成员不进公共接口', () => {
  for (const { file, iface, min } of TARGETS) {
    it(`${iface}（${file}）里没有「只被一个角色模块引用」的成员`, () => {
      const lines = readFileSync(join(SRC, file), 'utf-8').split('\n')
      const st = lines.findIndex(l => l.startsWith(`export interface ${iface}`))
      const en = lines.findIndex((l, i) => i > st && l === '}')
      const members = lines.slice(st + 1, en).map(l => /^ {2}(\w+)\??:/.exec(l)?.[1]).filter((x): x is string => !!x)
      expect(members.length).toBeGreaterThanOrEqual(min) // 解析器自检
      const files = ALL.map(x => ({
        rel: x.rel,
        txt: stripComments(x.rel === file ? [...lines.slice(0, st), ...lines.slice(en + 1)].join('\n') : x.raw),
      }))
      const offenders = members.filter(m => {
        const rx = new RegExp(`\\b${m}\\b(?!\\?:)`)
        const hits = files.filter(x => rx.test(x.txt))
        return hits.length === 1 && hits[0]!.rel.startsWith('mechanics/agents/')
      })
      expect(offenders).toEqual([])
    })
  }
})

describe('CC-360：角色专属结果类型随模块走', () => {
  it('types/resource/agentResources.ts 里没有「只被一个角色模块引用」的整份 interface', () => {
    const file = 'types/resource/agentResources.ts'
    const self = stripComments(readFileSync(join(SRC, file), 'utf-8'))
    const names = [...self.matchAll(/^export interface (\w+)/gm)].map(m => m[1]!)
    expect(names.length).toBeGreaterThanOrEqual(3)
    const others = ALL.filter(x => x.rel !== file && x.rel !== 'types/resource/index.ts')
      .map(x => ({ rel: x.rel, txt: stripComments(x.raw) }))
    const offenders = names.filter(n => {
      const rx = new RegExp(`\\b${n}\\b`)
      const selfRefs = (self.match(new RegExp(`\\b${n}\\b`, 'g')) ?? []).length // 1 = 只有声明本身
      const hits = others.filter(x => rx.test(x.txt))
      return selfRefs === 1 && hits.length === 1 && hits[0]!.rel.startsWith('mechanics/agents/')
    })
    expect(offenders).toEqual([]) // 红了 ⇒ python3 scripts/d2-migrate-agent-types.py .
  })
})

/**
 * D2 §5（r391 起逐模块补声明，r405 全部完成）：角色模块里经 `Record<string, unknown>` / `as any` 读写 cfg，
 * 键就没有类型，拼错键名 = 静默读到 undefined。
 * r405 起由逐模块名单（TYPED_CFG_MODULES，35 个）升级为**全目录不变式**：`src/mechanics/agents/*.ts` 全部文件都不许这样写，
 * 新模块写了就红（名单只能防回退，挡不住新模块重犯，见长期规则 r395 CC-369）。
 * 覆盖这个病的三种写法：`as unknown as Record<string, unknown>`（任何对象）、`<…cfg/Cfg> as any`、`<…cfg/Cfg> as Record<string, unknown>`
 * （最后一种是 r405 补的：soukaku 曾用它绕过旧正则）。
 * 公开签名要收「任意字面量」时（测试传带 `setting:` 动态键的对象），用 `cfg as Partial<CharacterOperationConfig>` 这类**带类型**的断言读静态键（soukaku 先例）。
 */
const AGENT_DIR = join(SRC, 'mechanics/agents')
const UNTYPED_CFG_ACCESS = [
  /as unknown as Record<string,\s*unknown>/,
  /\b\w*[cC]fg\)?\s+as\s+any\b/,
  /\b\w*[cC]fg\)?\s+as\s+Record<string,\s*unknown>/,
]
/**
 * r406（CC-380）：agents 目录**零 `any` 类型**。D2 §5 的锁只认 cfg 强转，但同一个病还有别的入口：
 * `(result|state|exec|row) as any` 读未声明的结果/执行行字段（26 处）、钩子参数标 `({ cfg, … }: any)`
 * 让 cfg 整体失去类型（佩洛 7 个钩子，掩盖 3 个未声明 cfg 键）、`cfgIn as typeof cfgIn & Record<string, unknown>`。
 * 清理中顺带抓出 1 个真 bug（orphie 影画2 读不存在的 `state.combatTime` ⇒ CD 上限恒按 180s）和 1 处死读
 * （remielle `row.luminizeLevelValues`，该键只在 move 层）。模块私有字段一律用 `declare module` 扩充
 * （`CharacterResourceResult` / `CharacterOperationConfig` / `SkillExecution`），不要回退到 any。
 */
const AGENT_ANY_TYPE = [
  /\bas\s+any\b/,
  /:\s*any\b/,
  /<any\b/,
  /\bany\[\]/,
  /&\s*Record<string,\s*unknown>/,
  /,\s*any\s*[>,\]]/,
  /\|\s*any\b/,
]

describe('D2 §5 + r406：角色模块不经 Record 强转读写 cfg、全目录零 any 类型（全目录不变式）', () => {
  const files = readdirSync(AGENT_DIR).filter(f => f.endsWith('.ts'))
  it('扫描面非空（防目录改名后全绿）', () => {
    expect(files.length).toBeGreaterThanOrEqual(50)
  })
  for (const f of files) {
    it(`mechanics/agents/${f}`, () => {
      const src = stripComments(readFileSync(join(AGENT_DIR, f), 'utf-8'))
      for (const rx of [...UNTYPED_CFG_ACCESS, ...AGENT_ANY_TYPE]) expect(src).not.toMatch(rx)
    })
  }
})

/**
 * r407（CC-381）：**计算层非测试源码零 `any` 类型**（core / types / specs / utils / data / mechanics，全目录不变式）。
 * 清理时的发现（详见架构卡 CC-381）：catalog 漏声明 5 个数据真实字段（音擎精修值 / 排除目标 / derived 来源 / 修饰器 / 锐暴基值）；
 * `specResources` 被 18 个模块当私有结果的夹带通道（`Record<string, any>`），现收紧为 `Record<string, SpecResourceResult>`，
 * 私有对象改为各模块 `declare module` 的具名结果键。core 需要 store 的地方用**结构类型**（`ImpactVarConfig`），不要回退到 any；
 * 外部不可信输入用 `unknown` + 收窄（`getGlobalBuffStatOptions`）。
 *
 * r408（CC-382）：扩到编排层 `composables/resourceCalc/`。发现：`damagePool.ts` 的 pushDirect/pushRelease 内联行类型与
 * `damagePoolDirect.ts` 导出接口逐位重复（已删，单一来源）；行接口 `skillDamageTarget?: any` 掩盖了上游 `SkillExecution`
 * 声明 `string`、下游 `core/damage` 要求 `SkillDamageTarget` 的断层（已收窄执行记录字段）；`backstageAutoFill.cfgField/manualField`
 * 改为 `NumericCfgField`（cfg 上数字键），编排层按声明字段读写 cfg 不再需要 `as any`。
 * 其余 UI 层（composables 其余 / components / stores / views）不在此锁内。
 */
const CALC_DIRS = ['core/', 'types/', 'specs/', 'utils/', 'data/', 'mechanics/', 'composables/resourceCalc/']
describe('r407 CC-381：计算层非测试源码零 any 类型（全目录不变式）', () => {
  const files = ALL.filter(x => CALC_DIRS.some(d => x.rel.startsWith(d)) && !/\.test\.ts$/.test(x.rel))
  it('扫描面非空（防目录改名后全绿）', () => {
    expect(files.length).toBeGreaterThanOrEqual(180)
  })
  it('零命中（违规列出 文件 + 命中的正则）', () => {
    const hits = files.flatMap(x => {
      const t = stripComments(x.raw)
      return AGENT_ANY_TYPE.filter(rx => rx.test(t)).map(rx => `${x.rel} ${rx}`)
    })
    expect(hits).toEqual([])
  })
})

/**
 * CC-369（r395）：全仓不变式——非测试源码不得用 `(cfg as any).<键>` 静态访问 cfg。
 * 这是 D2 §5 的「病」本身（键无类型、拼错静默），对所有文件成立，不再逐模块列名单：新模块写了就红。
 * 只锁**静态键**；按声明字段名的动态访问（convergence.ts 的 backstageAutoFill）自 r408 起由 `NumericCfgField` 约束键类型，已无 `as any`。
 */
describe('D2 §5：全仓不得 (cfg as any).键', () => {
  it('src 非测试源码零命中', () => {
    const hits: string[] = []
    for (const p of walk(SRC)) {
      const t = stripComments(readFileSync(p, 'utf-8'))
      t.split('\n').forEach((l, i) => { if (/\((?:input\.)?cfg as any\)\.\w/.test(l)) hits.push(`${relative(SRC, p)}:${i + 1}`) })
    }
    expect(hits).toEqual([])
  })
})

/**
 * CC-376（r402）：全仓不变式——非测试源码不得用 `as any` / `as unknown as Record` 绕过 `PanelValues` 类型。
 * r402 起索引签名只剩模板签名 `${string}__${string}`，未声明键编译失败；`(panel as any).xxx` 是剩下唯一的夹带后门
 * （r402 收口时实测还有 ben / lighter / yeshuguang 4 处，盘点脚本看不见：它靠编译报错，而 `as any` 让编译器闭嘴）。
 * 私有字段在本模块 `declare module '@/types/catalog'` 声明；键名来自数据走 `utils/panelStat.ts`（那里是唯一允许的断言）。
 */
describe('PanelValues：全仓不得 (xxxPanel as any) / as unknown as Record 绕过面板类型', () => {
  it('src 非测试源码零命中（utils/panelStat.ts 除外）', () => {
    const hits: string[] = []
    for (const p of walk(SRC)) {
      const rel = relative(SRC, p)
      if (rel.replace(/\\/g, '/') === 'utils/panelStat.ts') continue
      const t = stripComments(readFileSync(p, 'utf-8'))
      t.split('\n').forEach((l, i) => {
        if (/\b\w*[pP]anel\w*\)?\s+as\s+(?:any\b|unknown\s+as\s+Record\b)/.test(l)) hits.push(`${rel}:${i + 1}`)
      })
    }
    expect(hits).toEqual([])
  })
})
