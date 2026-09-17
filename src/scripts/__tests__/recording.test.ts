/** Recording workbench: test the same seam as the CLI; no store/fetch needed. */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { cleanRecordingText, loadPacket, makePacket, draftRecording, validateRecording, mechanismTemplate, repositoryReader } from '../../../scripts/lib/recording.mjs'

const raw = { id: 9999, skill: { basic: { description: [{ name: '示例', desc: '命中时增伤10%。' }] } }, passive: { level: { '9999507': { level: 7, name: ['核心'], desc: ['最多一层。'] } } }, talent: { '1': { name: '影画', desc: '强特后回能。' } } }
const packet = () => makePacket(raw, {}, [], { raw: 'fixture', nouns: 'fixture' })
function completeFixture() {
  const p = packet()
  const doc = draftRecording(p)
  doc.decisions.forEach(d => { d.status = 'modeled'; d.mechanics = ['buff'] })
  const mechanic = structuredClone(mechanismTemplate)
  Object.assign(mechanic, { id: 'buff', sources: p.units.map(u => u.id), trigger: '命中', target: '自身', gate: '影画 >= 1', formula: '10', field: 'dmgBonus', countSource: '命中次数', duration: '无', cap: '1层' })
  mechanic.implementation = { spec: 'src/specs/agents/9999.json#/notes/0', consumer: 'src/mechanics/agents/fixture.ts#applyBuff' }
  mechanic.cases.forEach(c => { c.input = 'enabled=' + (c.kind === 'negative' ? 'false' : 'true'); c.expected = c.kind === 'negative' ? '0' : '10'; c.test = { file: 'src/scripts/__tests__/fixture.test.ts', title: c.kind } })
  doc.mechanics = [mechanic]
  return { doc, p }
}
const readFixture = (file: string) => file.endsWith('.json') ? '{"notes":["效果"]}' : file.endsWith('.test.ts')
  ? ['positive', 'negative', 'boundary'].map(k => `it('${k}', () => { expect(value).toBe(10) })`).join('\n')
  : 'export function applyBuff() {}'


describe('recording evidence packet', () => {
  it('fixed raw yields identical packets with traceable basic and assist origins', () => {
    const first = loadPacket(process.cwd(), '1031')
    expect(JSON.stringify(loadPacket(process.cwd(), '1031'))).toBe(JSON.stringify(first))
    for (const category of ['basic', 'assist']) {
      const unit = first.units.find(u => u.category === category)!
      expect(unit.pointer).toMatch(new RegExp(`^/skill/${category}/description/\\d+/desc$`))
      expect(unit.context).toContain(unit.quote)
      expect(unit.id).toMatch(/:\d+$/)
    }
    expect(first.hashes.raw).toMatch(/^[a-f0-9]{64}$/)
  })
  it('restores terms and preserves both Skill/Prop coordinates; unknown terms fail closed', () => {
    expect(cleanRecordingText('<Term:1></Term><color=#fff>+10%</color>{Skill:4, Prop:5}', { '1': { name: '攻击' } })).toBe('攻击+10%{Skill:4, Prop:5}')
    expect(() => cleanRecordingText('<Term:2></Term>', {})).toThrow('术语 2')
    expect(() => cleanRecordingText('<Unknown>x</Unknown>', {})).toThrow('未知原文标签')
  })
  it('selects highest passive numerically, preserves context, inventories potentials', () => {
    const r = structuredClone(raw)
    Object.assign(r.passive.level, { '9999506': { level: 6, desc: ['低级。'], name: ['低级'] } })
    const p = makePacket({ ...r, potential_detail: { a: { desc: '潜能效果。' } } }, {}, [], {})
    expect(p.passiveLevel).toBe(7)
    expect(p.units.some(u => u.category === 'potential')).toBe(true)
    expect(makePacket(r, {}, [], {}, 6).passiveLevel).toBe(6)
    expect(() => makePacket(r, {}, [], {}, 99)).toThrow('等级')
  })
  it('draft and deleted decisions cannot pass; complete positive fixture can', () => {
    const { doc, p } = completeFixture()
    expect(validateRecording(draftRecording(p), p).length).toBeGreaterThan(0)
    expect(validateRecording(doc, p, { stage: 'complete', readText: readFixture })).toEqual([])
    doc.decisions.pop()
    expect(validateRecording(doc, p).join('\n')).toContain('原文漏项')
  })
  it.each(['raw', 'nouns', 'moves'])('detects %s source drift', key => {
    const { doc, p } = completeFixture()
    const changed = structuredClone(p)
    changed.hashes[key] = 'changed'
    expect(validateRecording(doc, changed).join('\n')).toContain('证据包漂移')
  })
  it('rejects invented/duplicate ids, missing reverse links and blocked questions', () => {
    const { doc, p } = completeFixture()
    doc.decisions[0]!.sourceId = 'invented'
    doc.decisions[1]!.status = 'blocked'
    doc.decisions.push(doc.decisions[1]!)
    const errors = validateRecording(doc, p).join('\n')
    expect(errors).toContain('未知/重复')
    expect(errors).toContain('未决口径')
    expect(errors).toContain('双向映射断裂')
  })
  it('requires scope reasons, modeling dimensions, assumptions and all three predictions', () => {
    const { doc, p } = completeFixture()
    doc.decisions[0]!.status = 'out_of_scope'
    doc.mechanics[0]!.dimension = 'random'
    doc.mechanics[0]!.certainty = 'L2'
    doc.mechanics[0]!.cases.pop()
    const errors = validateRecording(doc, p).join('\n')
    expect(errors).toContain('排除必须')
    expect(errors).toContain('维度需')
    expect(errors).toContain('缺假设')
    expect(errors).toContain('缺 boundary')
  })
  it('plan accepts future anchors; complete rejects comments posing as consumers/tests', () => {
    const { doc, p } = completeFixture()
    expect(validateRecording(doc, p)).toEqual([])
    const errors = validateRecording(doc, p, { stage: 'complete', readText: () => '// applyBuff positive negative boundary expect(' }).join('\n')
    expect(errors).toContain('实现引用无效')
    expect(errors).toContain('测试引用无效')
  })
  it.each(['it.skip', 'it.todo', 'it.only'])('rejects %s rather than accepting a title substring', callee => {
    const { doc, p } = completeFixture()
    const readText = (file: string) => file.endsWith('.test.ts') ? readFixture(file).replaceAll('it(', callee + '(') : readFixture(file)
    expect(validateRecording(doc, p, { stage: 'complete', readText }).join('\n')).toContain('测试引用无效')
  })
  it('rejects skipped parent suites and missing assertions in the named test', () => {
    const { doc, p } = completeFixture()
    for (const body of ["describe.skip('suite', () => {" + readFixture('x.test.ts') + '})', "it('positive', () => {})\nit('other',()=>{expect(1).toBe(1)})"]) {
      const readText = (file: string) => file.endsWith('.test.ts') ? body : readFixture(file)
      expect(validateRecording(doc, p, { stage: 'complete', readText }).join('\n')).toContain('测试引用无效')
    }
  })
  it('repository references cannot leave the workspace', () => {
    const read = repositoryReader(process.cwd())
    expect(() => read('../outside')).toThrow('相对路径')
    expect(() => read('/etc/passwd')).toThrow('相对路径')
  })
  it('CLI packet replay is byte identical and invalid arguments fail', () => {
    const run = () => execFileSync(process.execPath, ['scripts/record-agent.mjs', 'packet', '1031'], { encoding: 'utf8' })
    expect(run()).toBe(run())
    expect(JSON.parse(run()).units.length).toBeGreaterThan(0)
    expect(spawnSync(process.execPath, ['scripts/record-agent.mjs', 'check', '1031', 'typo']).status).toBe(1)
  })
  it('real corpus either yields all standard categories or an explicit missing-term diagnostic', () => {
    const files = readdirSync('data/raw/nanoka_missing/full').filter(f => /^\d{4}\.json$/.test(f))
    let packets = 0
    for (const f of files) {
      try {
        const p = loadPacket(process.cwd(), f.slice(0, 4))
        expect(p.units.every(u => u.context.includes(u.quote))).toBe(true)
        expect(p.units.some(u => u.category === 'passive')).toBe(true)
        expect(p.units.some(u => u.category === 'talent')).toBe(true)
        packets++
      } catch (e) {
        if (!(e instanceof Error) || !/^术语 \d+ 未命中 noun 表$/.test(e.message)) throw e
      }
    }
    expect(packets).toBeGreaterThan(0)
  })
  it('actual verifier exits 1 for unknown terms, drafts and missing new-agent contracts', () => {
    const root = mkdtempSync(join(tmpdir(), 'recording-verifier-'))
    try {
      for (const dir of ['scripts/lib', 'src/specs/agents', 'docs', 'data/recordings', 'data/raw/nanoka_missing/full', 'public/static']) mkdirSync(join(root, dir), { recursive: true })
      for (const file of ['scripts/verify-recording.mjs', 'scripts/record-agent.mjs', 'scripts/lib/recording.mjs']) copyFileSync(file, join(root, file))
      symlinkSync(join(process.cwd(), 'node_modules'), join(root, 'node_modules'), 'dir')
      const put = (file: string, value: unknown) => writeFileSync(join(root, file), JSON.stringify(value))
      writeFileSync(join(root, 'docs/MECHANICS_IMPLEMENTATION.md'), 'fixture')
      put('data/recordings/legacy.json', { agentIds: [] })
      put('data/recordings/9999.json', {})
      put('data/raw/nanoka_missing/noun_1.0.json', {})
      put('public/static/catalog.json', { agents: [{ id: '9999' }], agentSkills: [{ agentId: '9999', categories: [] }] })
      const r = structuredClone(raw)
      r.skill.basic.description[0]!.desc = '<Term:99999999></Term>'
      put('data/raw/nanoka_missing/full/9999.json', r)
      const run = () => spawnSync(process.execPath, [join(root, 'scripts/verify-recording.mjs')], { encoding: 'utf8' })
      const unknown = run()
      expect(unknown.status).toBe(1)
      expect(unknown.stdout).toContain('术语 99999999 未命中 noun 表')
      put('data/raw/nanoka_missing/full/9999.json', raw)
      put('data/recordings/9999.json', draftRecording(loadPacket(root, '9999')))
      expect(run().stdout).toContain('尚未处置')
      expect(run().status).toBe(1)
      const original = readFileSync(join(root, 'data/recordings/9999.json'), 'utf8')
      expect(spawnSync(process.execPath, [join(root, 'scripts/record-agent.mjs'), 'init', '9999']).status).toBe(1)
      expect(readFileSync(join(root, 'data/recordings/9999.json'), 'utf8')).toBe(original)
      rmSync(join(root, 'data/recordings/9999.json'))
      put('src/specs/agents/9999.json', { agentIds: ['9999'], name: 'fixture', status: 'implemented' })
      expect(run().stdout).toContain('新录入缺 data/recordings/9999.json')
      expect(run().status).toBe(1)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('legacy migration exemptions cannot expand to new characters', () => {
    const legacy = JSON.parse(readFileSync('data/recordings/legacy.json', 'utf8')).agentIds as string[]
    const original = '1011 1021 1031 1041 1051 1061 1071 1081 1091 1101 1111 1121 1131 1141 1151 1161 1171 1181 1191 1201 1211 1221 1241 1251 1261 1271 1281 1291 1301 1311 1321 1331 1341 1351 1361 1371 1381 1391 1401 1411 1421 1431 1441 1451 1461 1471 1481 1491 1501 1511 1521 1531 1541 1551 1561 1571 1581 1591 1611 1621 1631 1641'.split(' ')
    expect(legacy.every(id => original.includes(id))).toBe(true)
    expect(new Set(legacy).size).toBe(legacy.length)
  })
})
