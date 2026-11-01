/**
 * beta 冻结快照（2026-10-24）：把一个**已录入**的测试服角色整体冻结成旁挂副本（id = `<agentId>v<n>`），
 * 供下一版数据覆盖正主后仍可同屏对比强度。CLI 入口 `scripts/snapshot-agent.mjs`；本文件是纯函数实现，
 * 测试在 `src/scripts/__tests__/betaSnapshot.test.ts`。
 *
 * 冻结面（四件）：
 *  ① catalog 切片：agents 条目 + agentSkills 条目 + 专武（ownerAgentId 命中）；id 改写、名字加 ` v<n>`。
 *  ② 机制模块：`src/mechanics/agents/<file>.ts` → `agents/beta/<betaId>.ts`，逐字面量改写 agentId
 *     **+ 模块自身 `id: 'agent:<name>'` 改写为 `agent:<betaId>`**（mechanics/index.ts 的 import.meta.glob
 *     自动注册）。模块 id 必须与正主区分：两个模块对象同 moduleId 会让判据 4 的 `declared` Map
 *     （键 = moduleId）折叠掉一条、与运行时模块数对不上（2026-11-01 首次真实机制模块冻结实测 57 vs 58）。
 *  ③ spec：`src/specs/agents/<agentId>.json` → `<betaId>.json`，id/agentIds 改写 + `beta: true` + 出处 note
 *     （specs registry 的 glob 自动加载；verify-recording / docs:status 按 beta 标记豁免）。
 *  ④ beta-agents.json：public/static/beta-agents.json 旁挂（紧凑写），catalog store 仅在 beta 开关打开时合并。
 *
 * 改写纪律：
 *  - agentId 字面量替换 = 整串引号匹配（`'1091'` → `'1091v1'`），四位数字 id 不会命中更长数字的
 *    moveId（如 '1091507' 是完整独立字符串）。
 *  - 专武副本**删 legacyIds**：live 与 beta 各带一份旧 slug 会让 wEnginesMap 的 legacy 兜底互相覆盖。
 *  - 滑块/settings id **不改写**：registry 已按模块命名空间容忍同 id（首注册=活体优先，见
 *    src/mechanics/registry.ts）；specAdjustableRate 的全局裸 id 表只收非 beta spec（specs/resources.ts）。
 *  - **生成副本不进「手写门」**：判据 29（类型只声明一次）、debt 标记扫描、死导出扫描都排除
 *    `agents/beta/`（见 scripts/lib/{type-restatement-gate,dead-channel-ls}.mjs 与 scripts/check-guards.mjs
 *    的 `scanDebtMarkers`）——副本与正主逐字相同会假红（2026-11-01 冻结 1601/1661 实测）。
 */
export const BETA_ID_RE = /^(\d{4})(v\d+)$/
export const BETA_TAG_RE = /^v\d+$/

/** 切出角色的 catalog 三块（agents / agentSkills / 专武）。找不到 agent 返回 null。 */
export function sliceCatalogFor(catalog, agentId) {
  const agent = (catalog.agents ?? []).find(a => String(a.id) === agentId)
  if (!agent) return null
  const skills = (catalog.agentSkills ?? []).find(s => String(s.agentId) === agentId) ?? null
  const engines = (catalog.wEngines ?? []).filter(w => String(w.ownerAgentId) === agentId)
  return { agent, skills, engines }
}

function suffixName(name, tag) {
  if (!name || typeof name !== 'object') return name
  const out = { ...name }
  if (typeof out.zhCN === 'string') out.zhCN = `${out.zhCN} ${tag}`
  if (typeof out.en === 'string') out.en = `${out.en} ${tag}`
  return out
}

/** 切片改写成 beta 副本（深拷贝，不动入参）。 */
export function rewriteAgentSlice(slice, agentId, tag, meta) {
  const betaId = `${agentId}${tag}`
  const agent = JSON.parse(JSON.stringify(slice.agent))
  agent.id = betaId
  agent.name = suffixName(agent.name, tag)
  delete agent.hidden
  const skills = slice.skills
    ? (() => {
        const s = JSON.parse(JSON.stringify(slice.skills))
        s.id = betaId
        s.agentId = betaId
        if (s.name) s.name = suffixName(s.name, tag)
        return s
      })()
    : null
  const engines = slice.engines.map(e => {
    const w = JSON.parse(JSON.stringify(e))
    w.id = `${w.id}${tag}`
    w.ownerAgentId = betaId
    w.name = suffixName(w.name, tag)
    delete w.legacyIds
    return w
  })
  return { agent, skills, engines, meta: { ...meta, agentId, betaId, tag } }
}

/**
 * 机制模块源码改写：agentId 字面量整串替换（单/双/反引号三种形态）。
 * 计数为 0 = 该文件根本没引用此 agentId ⇒ 大概率找错了文件，调用方应视为错误。
 */
export function rewriteModuleSource(source, agentId, betaId) {
  const re = new RegExp("(['\"`])" + agentId + '\\1', 'g')
  const replacements = (source.match(re) ?? []).length
  const withAgentId = source.replace(re, '$1' + betaId + '$1')
  // 模块对象自身的 `id: 'agent:<name>'` 也换成 `agent:<betaId>`：否则正主与冻结副本同 moduleId，
  // 判据 4 的 declared Map 折叠、死导出/注册表诊断也会把两份当一份（2026-11-01 实测 57 vs 58）。
  const idRe = /(\bid\s*:\s*)(['"`])agent:[^'"`]*\2/
  const withId = withAgentId.replace(idRe, `$1$2agent:${betaId}$2`)
  return { source: withId, replacements: replacements + (withId === withAgentId ? 0 : 1) }
}

/** spec 改写成 beta 副本：id/agentIds 改写 + beta 标记 + 出处 note（深拷贝）。 */
export function rewriteSpec(spec, agentId, tag, provenanceNote) {
  const betaId = `${agentId}${tag}`
  const out = JSON.parse(JSON.stringify(spec))
  out.id = `agent:${betaId}`
  out.agentIds = [betaId]
  out.beta = true
  out.notes = [...(out.notes ?? []), provenanceNote]
  return out
}

/** 合并进 beta-agents.json（同 betaId 重新快照 = 整组替换，幂等）。 */
export function mergeBetaFile(existing, entries, meta) {
  const file = existing
    ? JSON.parse(JSON.stringify(existing))
    : { schemaVersion: 1, agents: [], agentSkills: [], wEngines: [], snapshots: [] }
  const replaceById = (list, item) => {
    const i = list.findIndex(x => x.id === item.id)
    if (i >= 0) list[i] = item
    else list.push(item)
  }
  replaceById(file.agents, entries.agent)
  if (entries.skills) replaceById(file.agentSkills, entries.skills)
  for (const engine of entries.engines) replaceById(file.wEngines, engine)
  const i = file.snapshots.findIndex(s => s.betaId === meta.betaId)
  if (i >= 0) file.snapshots[i] = meta
  else file.snapshots.push(meta)
  return file
}

/** 生成 beta 模块文件的横幅注释（第一行，标注生成来源与不可手改纪律）。 */
export function moduleBanner({ sourceFile, betaId, sourceVersion, gitSha, createdAt }) {
  return [
    '/**',
    ` * ⚠ beta 冻结副本（生成文件，勿手改——重跑 snapshot-agent.mjs 会整体覆盖）。`,
    ` * 冻结自 ${sourceFile} @ ${gitSha}（nanoka ${sourceVersion}，${createdAt}）；`,
    ` * 角色 id ${betaId}；由 scripts/snapshot-agent.mjs 生成，mechanics/index.ts 的 glob 自动注册。`,
    ` * 引擎共享件（chargeLock / moduleExecRow 等）不冻结——副本只锁角色自身逻辑。`,
    ' */',
    '',
  ].join('\n')
}

/** 在 mechanics/agents/（不含 beta/）里找声明了该 agentId 的模块文件；0 个 = spec-only 角色。 */
export function findModuleFile(agentSources, agentId) {
  const re = new RegExp("(['\"`])" + agentId + '\\1')
  return agentSources.filter(f => re.test(f.content)).map(f => f.path)
}

export function readJsonIfExists(readFile, path) {
  try {
    return JSON.parse(readFile(path, 'utf8'))
  } catch {
    return null
  }
}
