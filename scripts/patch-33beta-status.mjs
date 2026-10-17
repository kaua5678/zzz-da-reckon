#!/usr/bin/env node
/* 3.3.12+19629936（v12）新角色 1631 赛维里安 / 1641 菲欧妮 状态档案与配装推荐同步：
 * character-mechanics.json（核心被动/额外能力）+ character-constellations.json（影画逐级）
 * + build-recommendations.json（fairy_recommend 真实数据 + 专武）。
 * 只改 characters['1631'|'1641']，不动其他角色（SOP §6.9）。
 *
 * 数据源 = nanoka 3.3.12+19629936（v12，用户说明「已经最后一版 v12」）；原文证据契约
 * data/recordings/1631.json / 1641.json，口径与实现见 src/mechanics/agents/{severian,phoenix}.ts。
 */
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeJsonCompact } from './lib/jsonio.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mechanicsPath = resolve(root, 'public/static/character-mechanics.json')
const constellationsPath = resolve(root, 'public/static/character-constellations.json')
const mechanics = JSON.parse(readFileSync(mechanicsPath, 'utf8'))
const constellations = JSON.parse(readFileSync(constellationsPath, 'utf8'))

const PATCH = {
  1631: {
    name: { zhCN: '赛维里安', en: 'Severian' },
    mechanics: [
      {
        id: 'core_passive_1631',
        name: '核心被动：风回无终',
        implementation: 'implemented_approximation',
        status: 'implemented_approximation',
        implementedParts: [
          '暴击伤害 +60%、造成的伤害 +25%（若队伍中存在其他风属性角色则额外 +30%）——applyPanel panel.critDmg / panel.dmgBonus。',
          '[凭风]：入场技/连携技/终结技最后一击伤害倍率固定 +60%/300%（层数滑块 severian.fengfengStacks，damageMultiplierOverride 同区加算，patchExecutions）；影画1 起本局有苍风影猎则至少 1 层。',
          '[流息]→苍风影猎：次数 = 流息收入/100（疾锋四段×20 + 烈旋×35 + 极限闪避×15 + 连携×35/影画1 50 + 终结×100 + 影画2 入场150；影画6[风起] +25/次定点迭代），buildExecutions 产行 + estimateExSpecialTime 同源计时。',
          '长按风刃段（1631009，818.4%）：随强特产行，倍率/耗能40/时间按满充比例滑块 severian.windBladeChargeRatio 缩放（组合技 1631008 耗能 40 走 exSpecialEnergyConsume）。',
        ],
        pendingParts: [
          '烁影层数状态机与自动闪避触发率；疾锋四段闪避成功强化（1631020）；影画1「登场技替换为连携技」招式替换本体；流息上限 180 截断（总量口径）。',
        ],
        codePaths: ['src/mechanics/agents/severian.ts'],
        pending: ['烁影状态机/闪避判定成功率未建模（操作向量）。'],
      },
      {
        id: 'additional_ability_1631',
        name: '额外能力：最优编配',
        implementation: 'implemented_approximation',
        status: 'implemented_approximation',
        implementedParts: [
          '队伍存在[支援]/[击破]/同阵营（声明式门控）：每拥有 1% 暴击率使自身攻击力提升 8.5 点，最多计入 100% 暴击率（≤ +850），applyPanel 直加 panel.atk。',
        ],
        pendingParts: ['转模读 applyPanel 当下的 panel.critRate，队伍后置暴击加成不回溯（与诺玛 1571 同口径）。'],
        codePaths: ['src/mechanics/agents/severian.ts'],
        pending: [],
      },
    ],
    cinemas: {
      1: { status: 'implemented_approximation', implemented: ['连携技累积流息提升至 50 点（severianChainFlow）；每次苍风影猎 +1 层凭风（resolveSeverianFengfengStacks 下限）；攻击命中无视目标 15% 风属性抗性（panel.enemyWindResReduction）。'], pending: ['登场技替换为连携技的招式替换本体未建模；勘域 180s/60s 触发窗口不建模。'] },
      2: { status: 'implemented_approximation', implemented: ['进入战场回复 150 点流息（并入流息收入）；极限闪避/苍风影猎时穿透率 +20%、25 秒（panel.penRatio × 覆盖率滑块 severian.triggerCoverage）。'], pending: [] },
      4: { status: 'implemented_approximation', implemented: ['进入战斗/换入前场攻击力 +10%（panel.atk）；烈旋/苍风影猎时喧响值获取效率 +10%、15 秒（panel.decibelGainEfficiency × 覆盖率滑块）。'], pending: [] },
      6: { status: 'implemented_approximation', implemented: ['流息上限提升至 180 且入场回复 180（资源卡展示 + 收入计数）；苍风影猎最后一击倍率固定 +350%（行倍率同区加算 + damageMultiplierOverride）；[风起] 每次苍风影猎 +25 流息（定点迭代反馈）。'], pending: ['流息上限 180 的截断未建模（总量口径）。'] },
    },
  },
  1641: {
    name: { zhCN: '菲欧妮', en: 'Phoenix' },
    mechanics: [
      {
        id: 'core_passive_1641',
        name: '核心被动：涅槃',
        implementation: 'implemented_approximation',
        status: 'implemented_approximation',
        implementedParts: [
          '异常精通 +85（applyPanel）。',
          '[灼蚀] 异常伤害暴击：**spec teamBuffs 通用承载**（rate 公式 min(100, 30+max(0,min(初始掌控,255)−155)×0.7) 读**局外**面板；伤 = 25 基础 + 15 额外能力 + 25 影画一）——自体与队友同吃，引擎 EV 乘区 calcAnomalyCritExpect 通用消费。',
          '[灼蚀] 周期火伤：每 8 秒 50% 攻击力火属性伤害（视为强化特殊技伤害），direct_damage 事件，次数 = floor(有效时长×覆盖率/8)。',
          '焚罪/烬火追魂终结一击异放：固定 releaseMultiplier 445%/597%（s=12 满级；影画3/5 技能等级 +2/+4 随动），buildAnomalyEvents。',
          '[燔焰]→焚罪：燃烧攻击行 attack_data 收入×影画1 效率 1.15 + 完美格挡 5/10s，除以 90 = 次数（buildExecutions 产行）。',
          '[枯荣] 稳态强特循环：眩焰（40 能量）→ 坠阳（40 能量，+1[升变]）→ 燎斩（消耗[升变]，0 耗能），三者按 exCount 同源计次。',
          '[生竭]→烬火追魂 1641019（191.2%）：计数 = ultimateCount，收尾追加攻击不占前台时间且免喧响。',
        ],
        pendingParts: [
          '[生竭]/[重明] 状态机本体（回血无乘区）；[枯荣] 逐时序状态机；影画2「[灼烧] 持续 +2 秒」的 DPS 折算。',
        ],
        codePaths: ['src/mechanics/agents/phoenix.ts', 'src/specs/agents/1641.json (teamBuffs)'],
        pending: [],
      },
      {
        id: 'additional_ability_1641',
        name: '额外能力：[灼蚀] 暴伤强化',
        implementation: 'implemented_approximation',
        status: 'implemented_approximation',
        implementedParts: [
          '队伍存在其他[异常]/同阵营（声明式门控）：[灼蚀] 敌人受到属性异常伤害的暴击伤害 +15（v12 固定档）——spec teamBuffs 条 + computePanelPhases buff-id 过滤（SOP §6.2）。',
        ],
        pendingParts: [],
        codePaths: ['src/mechanics/agents/phoenix.ts', 'src/specs/agents/1641.json'],
        pending: [],
      },
    ],
    cinemas: {
      1: { status: 'implemented_approximation', implemented: ['进入战场获得 1 点[升变]（并入燎斩次数口径）；[灼蚀] 暴伤额外 +25%（spec teamBuffs，source「影画一」自动命座门控，全队含自身同吃）；[燃烧攻击] 燔焰获取效率 +15%（燔焰计数 ×1.15）。'], pending: ['勘域 180s 窗口不建模。'] },
      2: { status: 'implemented_approximation', implemented: ['对[灼蚀] 状态下的敌人造成的伤害 +30%（panel.dmgBonus）。'], pending: ['「[灼烧] 持续时间 +2 秒」的 DPS 折算走引擎异常池，不单独建模。'] },
      4: { status: 'implemented_approximation', implemented: ['[烬火追魂] 与 [普通攻击：焚罪] 终结一击命中异常状态敌人时额外触发一次异放，固定 600%（buildAnomalyEvents，两条独立事件）。'], pending: [] },
      6: { status: 'implemented_approximation', implemented: ['无视目标 15% 全属性伤害抗性（panel.enemyResReduction）；眩焰获得 1 点[升变]（并入燎斩次数口径）；异放无视 40% 防御（releaseModifier 异放限定）。'], pending: [] },
    },
  },
}

for (const [id, patch] of Object.entries(PATCH)) {
  const mChar = mechanics.characters[id]
  if (!mChar) { console.error('mechanics 缺', id); process.exit(1) }
  mChar.name = patch.name
  for (const entry of mChar.mechanics ?? []) {
    const p = patch.mechanics.find(x => x.id === entry.id)
    if (!p) continue
    Object.assign(entry, p)
  }
  const cChar = constellations.characters[id]
  if (!cChar) { console.error('constellations 缺', id); process.exit(1) }
  cChar.name = patch.name
  for (const cinema of cChar.cinemas ?? []) {
    const p = patch.cinemas[String(cinema.cinema)]
    if (!p) continue
    cinema.status = p.status
    cinema.implemented = p.implemented
    cinema.pending = p.pending
  }
  console.log('patched', id, patch.name.zhCN)
}

writeJsonCompact(mechanicsPath, mechanics)
writeJsonCompact(constellationsPath, constellations)
console.log('已写入 character-mechanics.json + character-constellations.json（紧凑）')

// ===== build-recommendations：v12 fairy_recommend（两角色现在都有真实推荐）=====
const recsPath = resolve(root, 'public/static/build-recommendations.json')
const recs = JSON.parse(readFileSync(recsPath, 'utf8'))
const catalog = JSON.parse(readFileSync(resolve(root, 'public/static/catalog.json'), 'utf8'))
const VERSION = '3.3.12+19629936'

function wengineBlock(id) {
  const w = catalog.wEngines.find(x => x.id === id)
  if (!w) { console.error(`catalog 缺音擎 ${id}`); process.exit(1) }
  return {
    nanoka_wengine_id: id,
    rank: w.rarity,
    name_en: w.name.en,
    name_zh: w.name.zhCN,
    icon: (w.images?.icon ?? '').split('/').pop()?.replace('.png', '') || `Weapon_S_${w.ownerAgentId ?? ''}`,
    atk: w.level60?.atkBase ?? 713,
    sub_stat: w.level60?.advancedStat?.stat ?? '',
    desc: w.effect?.description?.zhCN ?? '',
    catalog_wengine_id: id,
  }
}
function discSetBlock(id) {
  const s = catalog.driveDiscSets.find(x => x.id === id)
  if (!s) { console.error(`catalog 缺盘组 ${id}`); process.exit(1) }
  return {
    id,
    name_en: s.name.en ?? '',
    name_zh: s.name.zhCN,
    desc2_zh: s.twoPiece?.effects?.map(e => `${e.stat} ${e.value}${e.mode === 'pct' ? '%' : ''}`).join('，') ?? '',
    desc4_zh: s.fourPiece?.effectText?.zhCN ?? '',
  }
}
function statBlock(prop, name, format, icon) {
  return { prop, name, format, icon }
}

// 1631 赛维里安：fairy_recommend 4pc 拂晓生花 + 2pc 河豚电音；主词条 暴击率/暴伤/穿透率
recs.characters['1631'] = {
  name: { zhCN: '赛维里安', en: 'Severian' },
  nanoka_id: '1631',
  source_url: 'https://zzz.nanoka.cc/character/1631',
  strategy: [
    `来源：nanoka fairy_recommend（${VERSION}）——4pc 拂晓生花 + 2pc 河豚电音（备选 啄木鸟电音+河豚电音 / 纯攻击力）。主词条 4 暴击率 / 5 暴击伤害 / 6 穿透率，副词条优先攻击力%。`,
  ],
  drive_disc_sets: { four_piece: discSetBlock('33300'), two_piece: discSetBlock('31100') },
  main_stats: {
    '4': statBlock('20103', '暴击率', '{0:0.#%}', 'UI/Sprite/A1DynamicLoad/IconAttribute/UnPacker/Role/IconCrit.png'),
    '5': statBlock('21103', '暴击伤害', '{0:0.#%}', 'UI/Sprite/A1DynamicLoad/IconAttribute/UnPacker/Role/IconCritDam.png'),
    '6': statBlock('23103', '穿透率', '{0:0.#%}', 'UI/Sprite/A1DynamicLoad/IconAttribute/UnPacker/Role/IconPenRatio.png'),
  },
  substats: [
    statBlock('12102', '攻击力', '{0:0.#%}', 'UI/Sprite/A1DynamicLoad/IconAttribute/UnPacker/Role/IconAttack.png'),
  ],
  wengine: wengineBlock('14163'),
}
// 1641 菲欧妮：fairy_recommend 4pc 自由蓝调 + 2pc 法厄同之歌
recs.characters['1641'] = {
  name: { zhCN: '菲欧妮', en: 'Phoenix' },
  nanoka_id: '1641',
  source_url: 'https://zzz.nanoka.cc/character/1641',
  strategy: [
    `来源：nanoka fairy_recommend（${VERSION}）——4pc 自由蓝调 + 2pc 法厄同之歌；备选 2pc 混沌爵士 + 2pc 法厄同之歌。主词条 4 异常掌控 / 5 异常精通 / 6 火伤，副词条优先攻击力%。`,
  ],
  drive_disc_sets: { four_piece: discSetBlock('31300'), two_piece: discSetBlock('33000') },
  main_stats: {
    '4': statBlock('31402', '异常掌控', '{0:0.#%}', 'UI/Sprite/A1DynamicLoad/IconAttribute/UnPacker/Role/IconElementAbnormalPower.png'),
    '5': statBlock('31203', '异常精通', '{0:0}', 'UI/Sprite/A1DynamicLoad/IconAttribute/UnPacker/Role/IconElementMystery.png'),
    '6': statBlock('31603', '火属性伤害加成', '{0:0.#%}', 'UI/Sprite/A1DynamicLoad/IconGeneralBuff/Packer/IconFire.png'),
  },
  substats: [
    statBlock('31203', '异常精通', '{0:0}', 'UI/Sprite/A1DynamicLoad/IconAttribute/UnPacker/Role/IconElementMystery.png'),
    statBlock('12102', '攻击力', '{0:0.#%}', 'UI/Sprite/A1DynamicLoad/IconAttribute/UnPacker/Role/IconAttack.png'),
  ],
  wengine: wengineBlock('14164'),
}
console.log('recs v12 真实推荐写入 1631 / 1641')
writeJsonCompact(recsPath, recs)
console.log('已写入 build-recommendations.json（紧凑）')
