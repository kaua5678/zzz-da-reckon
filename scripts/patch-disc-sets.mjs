#!/usr/bin/env node
// 驱动盘套装数据补丁（2026-09 审计修复，可重跑/幂等）。
//
// 背景：catalog.driveDiscSets 是初始提交的 wiki 快照，无独立导入管线。本次审计
// （对比官方 wiki 原文 + 引擎消费端）发现一批 4pc 缺失/口径错，逐条修复：
//   31200 震星迪斯科  4pc 缺失 → 普攻/冲刺/闪避反击失衡值+20%（官方 wiki 原文）
//   31300 自由蓝调    4pc 缺失 → 强化特殊技命中使目标对应属性异常积蓄抗性-20%（{attribute} 模板 stat）
//   32500 极地重金属  4pc 缺失 → 普攻/冲刺伤害+20%，冻结/碎冰再+20%（条件段按恒开约定建模+coverage 槽）
//   31000 啄木鸟电音  4pc 只录单层 9% → 3 层×9%（官方：普攻/闪反/强特暴击各 1 层，最多 3 层）
//   31600 摇摆爵士    4pc 只建模了装备者自身 +15% → 补 teamBuff 全队 +15%（官方「全队」口径）
//   32900 如影相随    2pc 缺失 → 追加/冲刺伤害+15%
//   33200 山大王      2pc 缺失 → 失衡值+6%（biligame wiki 原文）；4pc teamBuff 第二段
//                     「暴击率≥50% 额外+15%」从恒开 stacked 拆为 requirement 门槛判据
//   33400 月光骑士颂  4pc teamBuff 补装备者特化门槛（支援）
//   33700 雪兔梦游仙境 4pc teamBuff 补装备者特化门槛（防护）
//   32600 獠牙重金属  4pc 补条件文本（强击限定，恒开约定下仅作文档）
//   32700 折枝剑歌    4pc 暴伤+30 补「异常掌控≥115」门槛（原恒给，对低掌控暴击 C 高估）
//   34000 拂晓行纪    4pc 暴伤+30 补「以太属性」门槛
//   34100 谶羽之誓    4pc 补流明属性 +15% 属性异常伤害（原只录了 AP+50）
// 2026-09-08 追加（用户：「部分靠前的驱动盘的4件套没给属性滑块，是不是属性都没做」）：
//   审计=数值效果都已接线（面板差分实测），但条目缺 condition/coverage → 面板页
//   「条件效果覆盖率」只认 effect.condition/maxStacks，常驻段与触发段整块不出现，
//   看着像没做。逐套装把官方文本的触发条件落到条目上（coverage 一律 default:1，
//   默认数值不变，只把 uptime 折算口子交给用户）。见文件末尾 markConditional 段。
// 消费端：requirement/模板解析在 src/core/buff.ts collectDriveDiscBuffs；teamBuff 门槛在
// src/core/inCombatBuffs.ts discTeamRequirementMet。生效测试：src/core/__tests__/discSetEffects.test.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const path = join(root, 'public', 'static', 'catalog.json')
const catalog = JSON.parse(readFileSync(path, 'utf8'))
const sets = new Map(catalog.driveDiscSets.map(s => [String(s.id), s]))

function set(id) {
  const s = sets.get(String(id))
  if (!s) throw new Error(`套装 ${id} 不存在`)
  return s
}
function skillTargets(...types) {
  return { kind: 'skill', skillTargets: types.map(t => ({ kind: 'skillType', skillType: t })) }
}

// ---- 31000 啄木鸟电音：单层 → 3 层 ----
{
  const s = set(31000)
  const e = s.fourPiece.selfBuff.effects.find(x => x.stat === 'atkPct')
  Object.assign(e, { type: 'stacked', valuePerStack: 9, maxStacks: 3, defaultStacks: 3 })
}

// ---- 31200 震星迪斯科：补 4pc 失衡值 ----
{
  const s = set(31200)
  s.fourPiece.selfBuff = {
    effects: [{
      id: 'effect_shockstar_4pc_buildup',
      type: 'fixed', stat: 'stunBuildUpBonus', mode: 'flat', value: 20,
      target: skillTargets('basic', 'dashAttack', 'dodgeCounter'),
    }],
  }
}

// ---- 31300 自由蓝调：4pc 挂敌人 8s → teamBuff（includeOwner 语义=装备者+队友全吃），
//      {attribute} 模板在 teamBuff 通道按【装备者】属性解析（苍角装备→雅的冰系积蓄也吃到）
{
  const s = set(31300)
  s.fourPiece.selfBuff = null
  s.fourPiece.teamBuff = {
    condition: '强化特殊技命中敌人', durationSeconds: 8,
    effects: [{
      id: 'effect_freedom_blues_4pc_anomaly_res',
      type: 'fixed', stat: 'enemy{attribute}AnomalyResReduction', mode: 'flat', value: 20,
    }],
  }
}

// ---- 31600 摇摆爵士：4pc 官方口径=全队+15%（含装备者）→ 只录 teamBuff（includeOwner 语义
//      装备者同样吃到）；不得同时录 selfBuff+teamBuff，否则装备者双计 30%
{
  const s = set(31600)
  s.fourPiece.selfBuff = null
  s.fourPiece.teamBuff = {
    condition: '发动连携技或终结技', durationSeconds: 12,
    effects: [{
      id: 'effect_swing_jazz_4pc_team_dmg',
      type: 'fixed', stat: 'dmgBonus', mode: 'flat', value: 15,
    }],
  }
}

// ---- 32500 极地重金属：补 4pc 普攻/冲刺伤害 ----
{
  const s = set(32500)
  s.fourPiece.selfBuff = {
    effects: [
      {
        id: 'effect_polar_metal_4pc_basic_dash',
        type: 'fixed', stat: 'dmgBonus', mode: 'flat', value: 20,
        target: skillTargets('basic', 'dashAttack'),
      },
      {
        id: 'effect_polar_metal_4pc_frozen',
        type: 'fixed', stat: 'dmgBonus', mode: 'flat', value: 20,
        target: skillTargets('basic', 'dashAttack'),
        condition: '队伍中任意角色对敌人施加冻结或触发碎冰', durationSeconds: 12,
        coverage: { default: 1, min: 0, max: 1, step: 0.1 },
      },
    ],
  }
}

// ---- 32900 如影相随：补 2pc 追加/冲刺伤害+15% ----
{
  const s = set(32900)
  s.twoPiece = {
    effects: [{
      id: 'effect_shadow_harmony_2pc',
      type: 'fixed', stat: 'dmgBonus', mode: 'flat', value: 15,
      target: skillTargets('dashAttack', 'additionalAttack'),
    }],
  }
}

// ---- 33200 山大王：补 2pc 失衡值+6%；4pc teamBuff 拆门槛段 ----
{
  const s = set(33200)
  s.twoPiece = {
    effects: [{
      id: 'effect_king_2pc_buildup',
      type: 'fixed', stat: 'stunBuildUpBonus', mode: 'flat', value: 6,
    }],
  }
  const tb = s.fourPiece.teamBuff
  tb.requirement = { specialty: 'stun' }
  tb.effects = [
    {
      id: 'effect_e044f6f6b8',
      type: 'fixed', stat: 'critDmg', mode: 'flat', value: 15,
    },
    {
      id: 'effect_king_4pc_crit_gate',
      type: 'fixed', stat: 'critDmg', mode: 'flat', value: 15,
      requirement: { outOfCombatStat: { stat: 'critRate', min: 50 } },
    },
  ]
}

// ---- 33400 月光骑士颂：teamBuff 补支援特化门槛 ----
{
  const s = set(33400)
  s.fourPiece.teamBuff.requirement = { specialty: 'support' }
}

// ---- 33700 雪兔梦游仙境：teamBuff 补防护特化门槛 ----
{
  const s = set(33700)
  s.fourPiece.teamBuff.requirement = { specialty: 'defense' }
}

// ---- 32600 獠牙重金属：补条件文本（强击限定，恒开约定下作文档） ----
{
  const s = set(32600)
  for (const e of s.fourPiece.selfBuff.effects) {
    if (e.stat === 'dmgBonus') e.condition = '队伍中任意角色对敌人施加强击'
  }
}

// ---- 32700 折枝剑歌：暴伤+30 补异常掌控≥115 门槛 ----
{
  const s = set(32700)
  const e = s.fourPiece.selfBuff.effects.find(x => x.stat === 'critDmg' && x.value === 30)
  e.requirement = { outOfCombatStat: { stat: 'anomalyMastery', min: 115 } }
}

// ---- 34000 拂晓行纪：暴伤+30 补以太属性门槛 ----
{
  const s = set(34000)
  const e = s.fourPiece.selfBuff.effects.find(x => x.stat === 'critDmg')
  e.requirement = { attribute: 'ether' }
}

// ---- 34100 谶羽之誓：补流明属性 +15% 属性异常伤害 ----
{
  const s = set(34100)
  const effects = s.fourPiece.selfBuff.effects.filter(e => e.id !== 'effect_chant_vow_4pc_lumiflux')
  effects.push({
    id: 'effect_chant_vow_4pc_lumiflux',
    type: 'fixed', stat: 'anomalyDmgBonus', mode: 'flat', value: 15,
    requirement: { attribute: 'lumiflux' },
    condition: '装备者为流明属性', durationSeconds: 15,
  })
  s.fourPiece.selfBuff.effects = effects
}

// ---- 2026-09-08（用户：「部分靠前的驱动盘的4件套没给属性滑块，我认为可能是属性都没做」）----
// 审计结论：这些套装的数值效果**都已接线**（逐套装跑面板差分实测，见
// src/utils/__tests__/discEffectRows.test.ts），看不到是因为面板页的覆盖率行只认
// effect.condition / effect.maxStacks（src/views/TeamConfigPage.vue 旧 discCoverageEffects），
// 于是常驻段/门槛段整块不出现。这里把官方文本里的触发条件如实落到条目上：
// coverage 一律 default:1 → **默认数值一分不变**，只是把 uptime 折算的口子交给用户。
const COV1 = { default: 1, min: 0, max: 1, step: 0.1 }
/** 给指定套装匹配到的效果补 condition + coverage（幂等：同值跳过）。 */
function markConditional(id, matcher, condition) {
  const s = set(id)
  const effs = [s.fourPiece?.selfBuff?.effects, s.fourPiece?.teamBuff?.effects]
    .filter(Boolean).flat()
  for (const e of effs) {
    if (!matcher(e)) continue
    if (e.condition === condition && e.coverage) continue
    e.condition = condition
    e.coverage = e.coverage ?? { ...COV1 }
  }
}
// 33800 囚徒手记：异放段（异常精通+48）/ 冻结段（异常伤+紊乱各+16），都是触发限时 30s
markConditional(33800, e => e.stat === 'anomalyProficiency', '装备者触发异放（持续30秒）')
markConditional(33800, e => e.stat === 'anomalyDmgBonus' || e.stat === 'disorderDamageBonus', '装备者触发冻结（持续30秒）')
// 33500 沧浪行歌：两段都挂在以太帷幕上（组级条件此前只在文本里，没落到效果上）
markConditional(33500, () => true, '处于/刚离开以太帷幕（第一段15秒；第二段另需强攻角色开/延帷幕30秒）')
// 33100 云岿如我：叠满 3 层才有的贯穿增伤段
markConditional(33100, e => e.stat === 'sheerDmgBonus', '叠满3层后（持续15秒）')
// 33200 山大王：击破位发动强特/连携后全队暴伤，15s 窗口（第二段另带暴击率≥50 门槛）
markConditional(33200, () => true, '击破位装备者发动强化特殊技/连携技后（持续15秒）')
// 33400 月光骑士颂：支援位发动强特/终结后全队增伤，25s 窗口
markConditional(33400, () => true, '支援位装备者发动强化特殊技/终结技后（持续25秒）')
// 31300 自由蓝调：强特命中挂敌 8s 的属性异常积蓄减抗
markConditional(31300, () => true, '强化特殊技命中敌人（持续8秒）')
// 33900 呼啸沙龙：风化后的增伤段（有 coverage 缺条件文本）
markConditional(33900, e => e.stat === 'dmgBonus', '触发风化效果后（持续40秒）')
// 34000 拂晓行纪：强特/终结后的攻击段（组级条件落到条目）
markConditional(34000, e => e.stat === 'atkPct', '发动强化特殊技/终结技后（持续30秒）')
// 34100 谶羽之誓：进场/切人后 15s（后台恒持）
markConditional(34100, e => e.stat === 'anomalyProficiency', '进入战场或切换为场上角色后（持续15秒；后台恒持）')

// ---- 2pc 效果 id 去重（覆盖率按效果 id 存：config.discEffectCoverages /
// mergeDiscEffectCoverages，10 个套装的 2pc 共用 wiki 快照带来的通用 id「effect-1」，
// 一旦给 2pc 挂覆盖率滑块就会互相串改；先改成每套唯一再谈可见性）----
for (const s of catalog.driveDiscSets) {
  for (const e of s.twoPiece?.effects ?? []) {
    if (!e.id || e.id === 'effect-1') e.id = `effect_${s.id}_2pc`
  }
}

// ---- 套装名对齐 nanoka 正式服 equipment.json（2026-09-09 录入 1611/1621 时发现）----
// 34200 catalog 写作「棘刺玫瑰」，正式服原文是「荆棘玫瑰」（错字）；33700 原文名带尾空格。
// 数据源 data/raw/nanoka_equipment.json 由 scripts/sync-build-recommendations.mjs 抓取；缺则跳过。
const eqPath = join(root, 'data', 'raw', 'nanoka_equipment.json')
if (existsSync(eqPath)) {
  const eq = JSON.parse(readFileSync(eqPath, 'utf8'))
  let renamed = 0
  for (const s of catalog.driveDiscSets) {
    const zh = eq[String(s.id)]?.zh?.name?.trim()
    if (zh && s.name?.zhCN !== zh) {
      console.log(`  套装名对齐 ${s.id}: ${s.name?.zhCN} → ${zh}`)
      s.name.zhCN = zh
      renamed++
    }
  }
  console.log(`套装名对齐 nanoka：${renamed} 条`)
} else {
  console.log('跳过套装名对齐：缺 data/raw/nanoka_equipment.json（跑 scripts/sync-build-recommendations.mjs 生成）')
}

writeFileSync(path, JSON.stringify(catalog))
console.log(`patched ${catalog.driveDiscSets.length} sets → ${path}`)
