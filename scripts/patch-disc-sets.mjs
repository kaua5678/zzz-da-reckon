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
// 消费端：requirement/模板解析在 src/core/buff.ts collectDriveDiscBuffs；teamBuff 门槛在
// src/core/inCombatBuffs.ts discTeamRequirementMet。生效测试：src/core/__tests__/discSetEffects.test.ts
import { readFileSync, writeFileSync } from 'node:fs'
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

writeFileSync(path, JSON.stringify(catalog))
console.log(`patched ${catalog.driveDiscSets.length} sets → ${path}`)
