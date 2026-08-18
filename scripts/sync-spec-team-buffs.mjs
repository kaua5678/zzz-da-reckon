#!/usr/bin/env node
/* 把角色文本里的局内拐力（全队/队友/敌人减益）同步到 spec.teamBuffs。
 * 规则：覆盖率默认 100%；已经由 public/static/teammate-buffs.json 承载的角色不再重复录入。
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const specDir = resolve(root, 'src/specs/agents')
const catalog = JSON.parse(readFileSync(resolve(root, 'public/static/catalog.json'), 'utf8'))
const teammateGroups = JSON.parse(readFileSync(resolve(root, 'public/static/teammate-buffs.json'), 'utf8'))
const groupIds = new Set(teammateGroups.map(group => group.id))

function plain(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const manualTeamBuffs = {
  '1561': [
    {
      id: 'velina_infection_zone',
      name: '维琳娜｜风化侵染',
      source: '风化/浸染机制',
      description: '风化状态下，风属性与被染队友属性的直伤进入独立乘区：风化系数 10%。默认按满覆盖处理，用户可在资源利用率页调整侵染覆盖率。',
      target: 'team',
      coverage: 1,
      effects: [{ stat: 'infectionZoneBonus', value: 10, mode: 'pct' }],
      status: 'implemented_approximation',
      note: '侵染独立乘区只对风属性与被染队友属性直伤生效。',
    },
  ],
  '1401': [
    {
      id: 'alice_c1_enemy_def_reduction',
      name: '爱丽丝｜影画一',
      source: '影画一',
      description: '爱丽丝触发[强击]时，目标防御力降低 20%。该减防不限定强击，视为全队可用的敌人减益，默认满覆盖。',
      target: 'enemy',
      coverage: 1,
      effects: [{ stat: 'enemyDefReduction', value: 20, mode: 'flat' }],
      status: 'implemented',
      note: '全减防，不只作用于强击。',
    },
    {
      id: 'alice_c2_team_assault_damage',
      name: '爱丽丝｜影画二',
      source: '影画二',
      description: '全队强击伤害提升 15%，畏缩紊乱伤害提升 15%。',
      target: 'team',
      coverage: 1,
      effects: [
        { stat: 'anomalyDamageBonus', value: 15, mode: 'flat' },
        { stat: 'disorderDamageBonus', value: 15, mode: 'flat' },
      ],
      status: 'implemented',
      note: '强击与畏缩紊乱分别吃异常增伤区和紊乱增伤区。',
    },
  ],
  '1061': [
    {
      id: 'corin_c2_enemy_phys_res',
      name: '可琳｜影画二',
      source: '影画二',
      description: '目标物理伤害抗性下降 0.5%/层，最多 20 层，即满层下降 10%。',
      target: 'enemy',
      coverage: 1,
      effects: [{ stat: 'enemyPhysicalResReduction', value: 10, mode: 'flat' }],
      status: 'implemented_approximation',
    },
  ],
  '1091': [
    {
      id: 'miyabi_c1_team_buildup',
      name: '星见雅｜影画一',
      source: '影画一',
      description: '斩击命中[霜灼]敌人并消除[霜灼]时，全队角色属性异常积蓄效率提升 20%，持续 10 秒。',
      target: 'team',
      coverage: 1,
      effects: [{ stat: 'anomalyBuildUpEfficiency', value: 20, mode: 'flat' }],
      status: 'implemented_approximation',
    },
  ],
  '1111': [
    {
      id: 'anton_c4_team_crit_rate',
      name: '安东｜影画四',
      source: '影画四',
      description: '发动[连携技]或[终结技]时，全队角色暴击率提升 10%，持续 12 秒。',
      target: 'team',
      coverage: 1,
      effects: [{ stat: 'critRate', value: 10, mode: 'flat' }],
      status: 'implemented_approximation',
    },
  ],
  '1121': [
    {
      id: 'ben_core_team_shield',
      name: '本｜核心被动',
      source: '核心被动',
      description: '强化特殊技追加强力打击时，为全队角色提供等同于自身 30% 防御力 + 550 点的护盾，持续 30 秒。',
      target: 'team',
      coverage: 1,
      effects: [],
      status: 'partially_implemented',
      note: '护盾量暂未接成面板字段。',
    },
    {
      id: 'ben_extra_shield_crit_rate',
      name: '本｜额外能力',
      source: '额外能力',
      description: '拥有[核心被动：守卫]施加的护盾时，角色暴击率提升 16%。',
      target: 'team',
      coverage: 1,
      effects: [{ stat: 'critRate', value: 16, mode: 'flat' }],
      status: 'implemented_approximation',
    },
  ],
  '1181': [
    {
      id: 'grace_extra_shock_damage',
      name: '格莉丝｜额外能力',
      source: '额外能力',
      description: '强化特殊技命中敌人时，目标下次被施加[感电]受到的伤害提升 18%，最多叠加 2 层。',
      target: 'enemy',
      coverage: 1,
      effects: [{ stat: 'electricAnomalyDmgBonus', value: 18, mode: 'flat' }],
      status: 'implemented_approximation',
    },
    {
      id: 'grace_c1_team_energy',
      name: '格莉丝｜影画一',
      source: '影画一',
      description: '普通攻击第四段命中敌人时，全队角色回复 0.25 点能量；同一招式最多回复 2 点。',
      target: 'team',
      coverage: 1,
      effects: [],
      status: 'partially_implemented',
      note: '全队回能暂未接成面板字段。',
    },
    {
      id: 'grace_c2_enemy_electric_debuff',
      name: '格莉丝｜影画二',
      source: '影画二',
      description: '投掷手雷命中敌人时，目标电属性伤害抗性与电属性异常积蓄抗性降低 8.5%，持续 8 秒。',
      target: 'enemy',
      coverage: 1,
      effects: [
        { stat: 'enemyElectricResReduction', value: 8.5, mode: 'flat' },
        { stat: 'enemyElectricAnomalyResReduction', value: 8.5, mode: 'flat' },
      ],
      status: 'implemented_approximation',
    },
  ],
  '1201': [
    {
      id: 'harumasa_c4_electric_prison',
      name: '悠真｜影画四',
      source: '影画四',
      description: '发动[终结技]时，为场上所有敌人施加满层[电囚]效果；[电囚]持续时间提升至 20 秒。',
      target: 'enemy',
      coverage: 1,
      effects: [],
      status: 'partially_implemented',
      note: '[电囚]作为敌人减益记录，暂未接成面板字段。',
    },
  ],
  '1271': [
    {
      id: 'seth_core_teammate_shield',
      name: '赛斯｜核心被动',
      source: '核心被动',
      description: '队友通过指定快速支援/连携技入场时获得匪石之盾，持有者异常精通提升 100 点。',
      target: 'team',
      coverage: 1,
      effects: [{ stat: 'anomalyProficiency', value: 100, mode: 'flat' }],
      status: 'implemented_approximation',
    },
    {
      id: 'seth_extra_enemy_anomaly_res',
      name: '赛斯｜额外能力',
      source: '额外能力',
      description: '连携技或感电终结一击命中敌人时，目标全属性异常积蓄抗性降低 20%，持续 20 秒。',
      target: 'enemy',
      coverage: 1,
      effects: [{ stat: 'enemyAnomalyResReduction', value: 20, mode: 'flat' }],
      status: 'implemented_approximation',
    },
  ],
  '1281': [
    {
      id: 'piper_extra_team_damage',
      name: '派派｜额外能力',
      source: '额外能力',
      description: '派派拥有 20 层或以上[动力]时，全队角色造成的伤害提升 18%。',
      target: 'team',
      coverage: 1,
      effects: [{ stat: 'dmgBonus', value: 18, mode: 'flat' }],
      status: 'implemented',
    },
  ],
  '1331': [
    {
      id: 'vivian_extra_team_erosion',
      name: '薇薇安｜额外能力',
      source: '额外能力',
      description: '全队角色造成的[侵蚀]伤害和[侵蚀]状态结算的[紊乱]伤害提升 12%。',
      target: 'team',
      coverage: 1,
      effects: [],
      status: 'partially_implemented',
      note: '侵蚀/紊乱限定增伤暂未接成面板字段。',
    },
    {
      id: 'vivian_c1_enemy_anomaly_damage',
      name: '薇薇安｜影画一',
      source: '影画一',
      description: '处于[薇薇安的预言]下的目标受到的所有属性异常伤害和[紊乱]伤害提升 16%。',
      target: 'enemy',
      coverage: 1,
      effects: [
        { stat: 'anomalyDamageBonus', value: 16, mode: 'flat' },
        { stat: 'disorderDamageBonus', value: 16, mode: 'flat' },
      ],
      status: 'implemented_approximation',
    },
  ],
  '1351': [
    {
      id: 'pulchra_extra_trap_followup',
      name: '波可娜｜额外能力',
      source: '额外能力',
      description: '敌人被施加[困迹]后，所有单位发动[追加攻击]对目标造成的伤害提升 30%。',
      target: 'enemy',
      coverage: 1,
      effects: [],
      status: 'partially_implemented',
      note: '追加攻击限定增伤暂未接成面板字段。',
    },
  ],
  '1371': [],
  '1381': [
    {
      id: 'anby_zero_core_silverstar_crit',
      name: '零号·安比｜核心被动',
      source: '核心被动',
      description: '敌方单位被施加[银星]后，受到的[追加攻击]暴击伤害额外提升，数值等同于零号·安比暴击伤害的 30%。',
      target: 'enemy',
      coverage: 1,
      effects: [],
      status: 'partially_implemented',
      note: '按来源暴击伤害折算的追加攻击暴伤暂未接成面板字段。',
    },
    {
      id: 'anby_zero_extra_team_followup',
      name: '零号·安比｜额外能力',
      source: '额外能力',
      description: '当前操作为零号·安比时，全队角色[追加攻击]对拥有[银星]标记的敌人造成的伤害提升 25%。',
      target: 'team',
      coverage: 1,
      effects: [],
      status: 'partially_implemented',
      note: '追加攻击限定增伤暂未接成面板字段。',
    },
    {
      id: 'anby_zero_potential_followup',
      name: '零号·安比｜潜能觉醒',
      source: '潜能觉醒',
      description: '潜能满级时，[额外能力：电极化]的全队[追加攻击]伤害提升效果提升至 50%。',
      target: 'team',
      coverage: 1,
      effects: [],
      status: 'partially_implemented',
    },
  ],
  '1391': [
    {
      id: 'jufufu_core_tiger_roar',
      name: '橘福福｜核心被动',
      source: '核心被动',
      description: '发动[连携技：虎釜震煞]时，全队获得[虎啸]：暴击伤害提升 20%，初始攻击力 2800 以上每 100 点再提升 5%，最多额外 30%；[虎啸]下连携技/终结技伤害提升 20%/40%。',
      target: 'team',
      coverage: 1,
      effects: [{ stat: 'critDmg', value: 20, mode: 'flat' }],
      status: 'implemented_approximation',
      note: '攻击力阈值追加与连携/终结限定增伤暂未接成面板字段。',
    },
    {
      id: 'jufufu_extra_team_decibel',
      name: '橘福福｜额外能力',
      source: '额外能力',
      description: '队伍中所有角色喧响值上限提升 1000 点；[强攻]或[命破]角色发动[终结技]时获得 300 点喧响值。',
      target: 'team',
      coverage: 1,
      effects: [],
      status: 'partially_implemented',
      note: '喧响上限与终结额外回复暂未接成面板字段。',
    },
    {
      id: 'jufufu_c1_stun_dmg',
      name: '橘福福｜影画一',
      source: '影画一',
      description: '连携技命中失衡敌人时，目标失衡易伤倍率提升 35%，持续 30 秒。',
      target: 'enemy',
      coverage: 1,
      effects: [{ stat: 'stunDmgMultiplierBonus', value: 35, mode: 'flat' }],
      status: 'implemented_approximation',
    },
  ],
  '1471': [
    {
      id: 'banyue_c1_enemy_fire_debuff',
      name: '般岳｜影画一',
      source: '影画一',
      description: '强化特殊技使敌人陷入[战栗]：火属性伤害抗性降低 10%，持续 30 秒；[普通攻击：摧岳]命中失衡敌人时失衡持续时间提升 2 秒。',
      target: 'enemy',
      coverage: 1,
      effects: [{ stat: 'enemyFireResReduction', value: 10, mode: 'flat' }],
      status: 'implemented_approximation',
    },
  ],
  '1501': [
    {
      id: 'aire_extra_erosion_duration',
      name: '爱芮｜额外能力',
      source: '额外能力',
      description: '队伍中任意角色对敌人施加[侵蚀]效果时，该效果持续时间提升 3 秒。',
      target: 'team',
      coverage: 1,
      effects: [{ stat: 'etherAnomalyDurationBonusSeconds', value: 3, mode: 'flat' }],
      status: 'implemented_approximation',
    },
    {
      id: 'aire_ultimate_team_atk',
      name: '爱芮｜终结技',
      source: '终结技',
      description: '[以太帷幕·妄想重奏]生效期间，全队角色攻击力额外提升 50 点，持续 30 秒。',
      target: 'team',
      coverage: 1,
      effects: [{ stat: 'atkFlat', value: 50, mode: 'flat' }],
      status: 'implemented_approximation',
    },
  ],
  '1541': [
    {
      id: 'promethea_core_team_voidflare',
      name: '普罗米娅｜核心被动',
      source: '核心被动',
      description: '初始异常掌控超过 150 后，每超过 1 点提升 0.35% 全队造成的[异放]伤害。',
      target: 'team',
      coverage: 1,
      effects: [],
      status: 'partially_implemented',
      note: '全队异放伤害公式暂未接成面板字段。',
    },
    {
      id: 'promethea_extra_guilty_presumption',
      name: '普罗米娅｜额外能力',
      source: '额外能力',
      description: '全队角色对[有罪推定]状态敌人造成[异放]时无视 40% 防御力；队伍中任意角色施加[霜寒]时持续时间提升 3 秒。',
      target: 'team',
      coverage: 1,
      effects: [
        { stat: 'enemyDefReduction', value: 40, mode: 'flat' },
        { stat: 'frostDurationBonusSeconds', value: 3, mode: 'flat' },
      ],
      status: 'implemented_approximation',
      note: '异放限定无视防御与霜寒时长按文本录入。',
    },
    {
      id: 'promethea_c1_extra_def_ignore',
      name: '普罗米娅｜影画一',
      source: '影画一',
      description: '全队角色对[有罪推定]状态的敌人造成[异放]效果时额外无视 20% 防御力。',
      target: 'team',
      coverage: 1,
      effects: [{ stat: 'enemyDefReduction', value: 20, mode: 'flat' }],
      status: 'implemented_approximation',
    },
  ],
  '1551': [
    {
      id: 'peiluo_core_stun_duration',
      name: '佩洛伊斯｜核心被动',
      source: '核心被动',
      description: '下分支[终结技：永陷幽囚]发动时，所有处于失衡状态的敌人失衡持续时间提升 3 秒。',
      target: 'enemy',
      coverage: 1,
      effects: [{ stat: 'stunDurationBonusSeconds', value: 3, mode: 'flat' }],
      status: 'implemented_approximation',
    },
  ],
}

const files = readdirSync(specDir).filter(file => file.endsWith('.json'))
let updated = 0
let emptyCount = 0

for (const file of files) {
  const specPath = resolve(specDir, file)
  const spec = JSON.parse(readFileSync(specPath, 'utf8'))
  const agentId = spec.agentIds[0]
  const agent = catalog.agents.find(item => item.id === agentId || item.teammateBuffId === agentId)
  const groupKey = agent?.teammateBuffId ?? agentId
  if (groupIds.has(groupKey)) {
    spec.teamBuffs = []
    writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8')
    emptyCount++
    continue
  }

  const manual = manualTeamBuffs[agentId]
  if (!manual) {
    spec.teamBuffs = spec.teamBuffs ?? []
    writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8')
    emptyCount++
    continue
  }

  spec.teamBuffs = manual.map(buff => ({
    ...buff,
    description: plain(buff.description),
    name: plain(buff.name),
    source: plain(buff.source),
  }))
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8')
  updated++
}

console.log(`teamBuffs synced: ${updated} specs updated with manual entries, ${emptyCount} specs ensured array`)
