#!/usr/bin/env node
/* 【一次性】3.3 测试服新角色 1631 赛维里安 / 1641 菲欧妮 录入后同步状态档案：
 * character-mechanics.json（核心被动/额外能力）+ character-constellations.json（影画逐级）。
 * 只改 characters['1631'|'1641']，不动其他角色（SOP §6.9）。审计痕迹保留。
 *
 * ⚠️ 数据源为 nanoka 3.3.2+18895034 测试服快照，正式服改版后需重核状态描述。
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
          '暴击伤害 +60%（applyPanel panel.critDmg）。',
          '[凭风]：入场技/连携技/终结技最后一击伤害倍率固定 +60%/300%（层数滑块 severian.fengfengStacks，damageMultiplierOverride 同区加算，patchExecutions）。',
          '[流息]→苍风影猎：次数 = 流息收入/100（疾锋四段×20+烈旋×35+极限闪避×15+连携×50+终结×100，buildExecutions 产行 + estimateExSpecialTime 同源计时）。',
          '长按风刃段（1631009，818.4%）：随强特产行，倍率/耗能40/时间按满充比例滑块 severian.windBladeChargeRatio 缩放（2026-09-12 用户纠错补录；强特组合技耗能 80 为真实值）。',
        ],
        pendingParts: [
          '烁影层数状态机与自动闪避触发率；疾锋四段闪避成功强化（1631020 无计数来源）；流息上限 150/180 截断（总量口径）。',
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
          '队伍存在[支援]/[击破]/同阵营（声明式门控）：攻击力 +700（Lv60，局内小攻击，applyPanel）；影画2 触发时额外 +15% 攻击力。',
        ],
        pendingParts: ['30 秒持续/重复刷新按整局常驻近似。'],
        codePaths: ['src/mechanics/agents/severian.ts'],
        pending: [],
      },
    ],
    cinemas: {
      1: { status: 'implemented_approximation', implemented: ['进入战场 +100 流息（整局一次近似，并入流息收入计数）；普通攻击暴击伤害 +60%（basic 组 moveId 限定，patchExecutions critDmgBonus）。'], pending: ['勘域 180s 一次的触发窗口不建模。'] },
      2: { status: 'implemented_approximation', implemented: ['触发最优编配时额外 +15% 攻击力（applyPanel）；每次苍风影猎获得 2 层凭风（并入凭风层数滑块口径，需手动调 2 层）。'], pending: ['「登场技替换为连携技」的招式替换未建模；凭风获得后需手动调滑块（未自动按苍风影猎次数补层）。'] },
      4: { status: 'implemented_approximation', implemented: ['极限闪避/苍风影猎触发时无视 16% 防御 × 覆盖率滑块 severian.c4Coverage（panel.enemyDefReduction）。'], pending: [] },
      6: { status: 'implemented_approximation', implemented: ['苍风影猎最后一击伤害倍率固定 +900%（行倍率同区加算 + damageMultiplierOverride）；[风起] 每次苍风影猎 +30 流息（countFromFlow 定点迭代反馈）。'], pending: ['流息上限 180 的截断未建模（总量口径）。'] },
    },
  },
  1641: {
    name: { zhCN: '菲欧妮', en: 'Phoenix' },
    mechanics: [
      {
        id: 'core_passive_1641',
        name: '核心被动：脆弱',
        implementation: 'implemented_approximation',
        status: 'implemented_approximation',
        implementedParts: [
          '异常精通 +40（applyPanel）。',
          '[脆弱] 异常伤害暴击：**spec teamBuffs 通用承载**（rate 公式 30+max(0,掌控-145)×0.7 读源面板；伤 基础15 + 额外能力档位 tier2 +10（buff-id 过滤门控）+ 影画一 +20（中文数字 source 命座门控））——自体与队友同吃，引擎 EV 乘区 calcAnomalyCritExpect 通用消费。',
          '长按普攻/终结技终结一击异放：固定 releaseMultiplier 445%/597%（s=12 满级；影画3/5 技能等级 +2/+4 随动），buildAnomalyEvents（普罗米娅绝裁同款通道）。',
          '[余火]→长按普攻：燃烧攻击行 attack_data 收入×影画1 效率 1.15/90 = 次数（buildExecutions 产行）。',
          '终结技：入场 1641019（1545.8%）：每次终结后点按一次，计数=ultimateCount（产行+计时，2026-09-12 用户纠错）。',
          '[消亡]消费：终结进入（次数=终结次数）→下一次连携退出并+30%积蓄，加成次数=min(终结,连携)按占比乘连携行 anomalyBuildUp（行级乘法）。',
        ],
        pendingParts: [
          '[重生]（无乘区）；[消亡]逐时序状态机本体（次数驱动乘区已建模）；脆弱暴伤 3 档（3异常→40，+15）编成自动推导未承载（teamBuff 覆盖率被 store 兜底 100 抹平，需正式版做覆盖率兜底/编成推导）。',
        ],
        codePaths: ['src/mechanics/agents/phoenix.ts', 'src/specs/agents/1641.json (teamBuffs)', 'src/composables/resourceCalc/helpers.ts (AA buff-id 过滤)'],
        pending: ['余火获取速率按 attack_data /10000 口径解读 [猜测·低]，待正式服复核。'],
      },
      {
        id: 'additional_ability_1641',
        name: '额外能力：脆弱暴伤档位',
        implementation: 'implemented_approximation',
        status: 'implemented_approximation',
        implementedParts: [
          '队伍存在其他[异常]/同阵营（声明式门控）：脆弱暴伤 +10（15→25，2 档）——spec teamBuffs tier2 条 + computePanelPhases buff-id 过滤（SOP §6.2）。',
        ],
        pendingParts: ['3 档（3异常→40）编成自动推导未承载；影画6 需求-1 的档位+1 随之未承载。'],
        codePaths: ['src/mechanics/agents/phoenix.ts', 'src/composables/resourceCalc/helpers.ts'],
        pending: [],
      },
    ],
    cinemas: {
      1: { status: 'implemented_approximation', implemented: ['脆弱目标异常伤害触发暴击时暴伤 +20（spec teamBuffs，source「影画一」自动命座门控，全队含自身同吃）；燃烧攻击余火获取效率 +15%（余火计数 ×1.15）。'], pending: ['入场 +1 点蓄能勘域窗口不建模。'] },
      2: { status: 'implemented_approximation', implemented: ['[焚化] 异常积蓄效率 +15% × 覆盖率滑块 phoenix.c2IncinerationCoverage（panel.anomalyBuildUpEfficiency）；强化特殊技第二段回 8 能量（行级 energyRecovery）。'], pending: ['「保留当前强化特殊技段数」状态机未建模。'] },
      4: { status: 'implemented_approximation', implemented: ['长按普攻 +200 喧响/次（initialDecibelGift；次数=滑块覆盖，自动=战斗时长/15s 估算）。'], pending: [] },
      6: { status: 'implemented_approximation', implemented: ['强化特殊技终结一击异放 200%（buildAnomalyEvents）；异放无视 15% 防御（releaseModifier 异放限定）；额外能力所需异常角色数 -1（档位推导未承载，随 3 档留正式版）。'], pending: [] },
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

// ===== build-recommendations：beta 角色不在 nanoka 正式服索引（sync-build-recommendations 会崩），
// 用 1611 的 fallback 占位条目（荆棘玫瑰/啄木鸟 + 通用主词条），正式服上线后重跑 sync 覆盖。
const recsPath = resolve(root, 'public/static/build-recommendations.json')
const recs = JSON.parse(readFileSync(recsPath, 'utf8'))
const fallbackSource = recs.characters['1611']
if (!fallbackSource) { console.error('缺 fallback 源 1611'); process.exit(1) }
for (const [id, patch] of Object.entries(PATCH)) {
  if (recs.characters[id]) { console.log('recs 已存在', id); continue }
  recs.characters[id] = {
    ...JSON.parse(JSON.stringify(fallbackSource)),
    name: patch.name,
    nanoka_id: id,
    source_url: `https://zzz.nanoka.cc/character/${id}`,
  }
  console.log('recs fallback 补齐', id)
}
writeJsonCompact(recsPath, recs)
console.log('已写入 build-recommendations.json（紧凑）')
