/**
 * 倍率融合注册表（单一事实源）。
 *
 * 背景：catalog 的倍率表把「一次玩家动作」拆成多段 move（#1/#2/#3…），
 * 通用引擎 findExSpecial/findChainAttack 只取第一段 → 后续段整段丢失
 * （低估主因之一，2026-09 实战对比·最低金+3 前沿 80% fn 定位到此）。
 *
 * 但「#N 后缀」不可作为融合判据：nanoka 原文里同一招式名下往往有多个 param，
 * 每个 param.desc 用 `{Skill:A} + {Skill:B}*3` 编码「哪些段属于同一次动作」，
 * 例如星见雅强化特殊技·飞雪：
 *   - 「斩击伤害倍率」 = {Skill:1091009} + {Skill:1091010}  → 第一次 E
 *   - 「追击伤害倍率」 = {Skill:1091011} + {Skill:1091012}  → 第二次 E（再耗 40 能量）
 * 两次 E 是**两个独立动作**，不能相加；引擎只选第一段（1091009），所以只该融合斩击。
 *
 * 本表只收「同一次动作的多段求和/加权」组，不替代角色模块已显式建模的段
 * （模块已 emit 兄弟段的 moveId 不入表，避免双计）。来源：data/raw/nanoka_missing/full/<id>.json
 * 的 skill.*.description[].param[].desc，可用 `scripts/extract-move-fusions.mjs` 重抽。
 */

export interface MoveFusionTerm {
  /** 参与融合的 move id */
  moveId: string
  /** 次数权重（如毒牙 #1 ×3） */
  count: number
}

export interface MoveFusionGroup {
  /** 引擎会选中的「主段」moveId（findExSpecial/findChainAttack 取到的那段），也作查表键 */
  moveId: string
  agentId: string
  /** 该组对应的一次动作名（仅文档，不入计算） */
  label: string
  /** 融合项：一次动作 = Σ term.count × term.moveId 的对应 row */
  terms: MoveFusionTerm[]
  /** 依据（param.desc 原文出处） */
  note: string
}

// @fact engine:moveFusion/飞雪斩击 口径: 星见雅强化特殊技「斩击」= 飞雪#1(1091009)+飞雪#2(1091010)=788.3%，追击(1091011+1091012)是第二次E不融 | 据 nanoka full/1091.json param.desc + 用户@2026-09 | 验 src/composables/__tests__/moveFusion.test.ts | 锚 src/data/moveFusions.ts#MIYABI_EX_SLASH | 信 确认
// @fact engine:moveFusion/春临 口径: 星见雅连携技·春临一次 = #1+#2+#3 三段求和（1091015+1091016+1091017）| 据 nanoka full/1091.json param.desc | 验 src/composables/__tests__/moveFusion.test.ts | 锚 src/data/moveFusions.ts#MIYABI_CHAIN | 信 确认

/** 星见雅·强化特殊技·斩击（第一次 E）＝ 飞雪 #1 + #2 */
export const MIYABI_EX_SLASH: MoveFusionGroup = {
  moveId: '1091009',
  agentId: '1091',
  label: '星见雅·强化特殊技·斩击（第一次 E）',
  terms: [
    { moveId: '1091009', count: 1 },
    { moveId: '1091010', count: 1 },
  ],
  note: 'full/1091.json「斩击伤害倍率」={{Skill:1091009}+{Skill:1091010}}；追击(#3+#4)是第二次 E，另行不入。',
}

/** 星见雅·强化特殊技·追击（第二次 E）＝ 飞雪 #3 + #4（通常不打，仅登记口径） */
export const MIYABI_EX_FOLLOWUP: MoveFusionGroup = {
  moveId: '1091011',
  agentId: '1091',
  label: '星见雅·强化特殊技·追击（第二次 E）',
  terms: [
    { moveId: '1091011', count: 1 },
    { moveId: '1091012', count: 1 },
  ],
  note: 'full/1091.json「追击伤害倍率」={{Skill:1091011}+{Skill:1091012}}；通常不打，引擎不会选到该主段，仅登记口径。',
}

/** 星见雅·连携技·春临＝ #1 + #2 + #3（一次连携全打） */
export const MIYABI_CHAIN: MoveFusionGroup = {
  moveId: '1091015',
  agentId: '1091',
  label: '星见雅·连携技·春临',
  terms: [
    { moveId: '1091015', count: 1 },
    { moveId: '1091016', count: 1 },
    { moveId: '1091017', count: 1 },
  ],
  note: 'full/1091.json「伤害倍率」={{Skill:1091015}+{Skill:1091016}+{Skill:1091017}}。',
}

/** 可琳·闪避反击：[舍]＝ #1 + #2 */
export const CORIN_DODGE: MoveFusionGroup = {
  moveId: '1061015',
  agentId: '1061',
  label: '可琳·闪避反击：[舍]',
  terms: [
    { moveId: '1061015', count: 1 },
    { moveId: '1061016', count: 1 },
  ],
  note: 'full/1061.json「伤害倍率」={{Skill:1061015}+{Skill:1061016}}。',
}

/** 可琳·快速支援：应急措施＝ #1 + #2 */
export const CORIN_QUICK_ASSIST: MoveFusionGroup = {
  moveId: '1061019',
  agentId: '1061',
  label: '可琳·快速支援：应急措施',
  terms: [
    { moveId: '1061019', count: 1 },
    { moveId: '1061020', count: 1 },
  ],
  note: 'full/1061.json「伤害倍率」={{Skill:1061019}+{Skill:1061020}}。',
}

/** 希希芙·强化特殊技·毒牙＝ #1 ×3 + #2 */
export const XIXIFU_VENOM_FANG: MoveFusionGroup = {
  moveId: '1521008',
  agentId: '1521',
  label: '希希芙·强化特殊技·毒牙',
  terms: [
    { moveId: '1521008', count: 3 },
    { moveId: '1521009', count: 1 },
  ],
  note: 'full/1521.json「伤害倍率」={{Skill:1521008}*3+{Skill:1521009}}。',
}

/** 珂蕾妲·强化特殊技·沸腾熔炉＝ 打击(#1) + 引爆(#2)（有班协同时引爆换协同引爆 #3，另待模块） */
export const KOLEDA_BOILING_FURNACE: MoveFusionGroup = {
  moveId: '1101104',
  agentId: '1101',
  label: '珂蕾妲·强化特殊技·沸腾熔炉（打击+引爆）',
  terms: [
    { moveId: '1101104', count: 1 },
    { moveId: '1101105', count: 1 },
  ],
  note: 'full/1101.json「打击伤害倍率」={1101104}、「引爆伤害倍率」={1101105}；有班协同时引爆=协同引爆(1101106)，属替换而非叠加。',
}

/** 月城柳·强化特殊技·月华流转＝ 突刺(#1) + 下砸(#2)（C2 长按可追加突刺，另见 yanagi.ts） */
export const YANAGI_MOONLIGHT_FLOW: MoveFusionGroup = {
  moveId: '1221022',
  agentId: '1221',
  label: '月城柳·强化特殊技·月华流转（突刺+下砸）',
  terms: [
    { moveId: '1221022', count: 1 },
    { moveId: '1221023', count: 1 },
  ],
  note: 'full/1221.json「突刺攻击伤害倍率」={1221022}、「下落攻击伤害倍率」={1221023}；C2 长按追加突刺未建模。',
}

/** 简·普通攻击·萨霍夫跳＝ 连续攻击(#1+#2) + 终结一击(#3)（狂热下长按，影画1次数+1） */
export const JANE_SOMERSAULT: MoveFusionGroup = {
  moveId: '1261007',
  agentId: '1261',
  label: '简·普通攻击·萨霍夫跳',
  terms: [
    { moveId: '1261007', count: 1 },
    { moveId: '1261030', count: 1 },
    { moveId: '1261008', count: 1 },
  ],
  note: 'full/1261.json「连续攻击伤害倍率」={1261007}+{1261030}、「终结一击伤害倍率」={1261008}；数值同平A、仅额外回复狂热。',
}

/** 珂蕾妲·强化普攻（消耗熔炉升温）＝ 一段(#5) + 二段(#6)（协同=#7 替二段，另有层数额外火伤 75%/150%） */
export const KOLEDA_ENHANCED_BASIC: MoveFusionGroup = {
  moveId: '1101005',
  agentId: '1101',
  label: '珂蕾妲·强化普攻（熔炉升温）',
  terms: [
    { moveId: '1101005', count: 1 },
    { moveId: '1101006', count: 1 },
  ],
  note: 'full/1101.json「强化普攻一段」={1101005}、「强化普攻二段」={1101006}；协同二段={1101007}替二段（有本）；消耗层数额外火伤 75%/150% 未建模。',
}

// @fact engine:moveFusion/兔兔连斩 口径: 照终结技·兔兔连斩一次 = #1+#2 两段求和（1341014+1341023，引擎只取 #1 主段） | 据 nanoka full/1341.json param.desc + 用户@2026-09 | 验 src/composables/__tests__/moveFusion.test.ts | 锚 src/data/moveFusions.ts#ZHAO_ULT_BUNNY_BARRAGE | 信 确认
// @fact engine:moveFusion/孤影断獠 口径: 真斗支援突击·孤影·断獠「连打最大」= #1+#2（1441024+1441025）；单打档=仅 #1，总量口径取连打满 | 据 nanoka full/1441.json param.desc | 验 src/composables/__tests__/moveFusion.test.ts | 锚 src/data/moveFusions.ts#ZHENDOU_ASSIST_BREAKING_FANG | 信 确认
// @fact engine:moveFusion/泡泡糖轰炸 口径: 千夏强特·泡泡糖轰炸一次 = #1+#2（1491007+1491018）；「快速衔接特别拍照技巧时」仅 #1 的变体只适用接拍照的轴 | 据 nanoka full/1491.json param.desc | 验 src/composables/__tests__/moveFusion.test.ts | 锚 src/data/moveFusions.ts#QIANXIA_EX_BUBBLEGUM_BARRAGE | 信 确认
/** 照·终结技·兔兔连斩＝ #1 + #2（引擎取 #1 作主段，尾段整段丢失） */
export const ZHAO_ULT_BUNNY_BARRAGE: MoveFusionGroup = {
  moveId: '1341014',
  agentId: '1341',
  label: '照·终结技·兔兔连斩',
  terms: [
    { moveId: '1341014', count: 1 },
    { moveId: '1341023', count: 1 },
  ],
  note: 'full/1341.json「终结技：兔兔连斩伤害倍率」={{Skill:1341014}+{Skill:1341023}}；引擎找 Ultimate 只取 #1。',
}

/** 真斗·支援突击·孤影·断獠＝ #1 + #2（连打最大档；单打档=仅 #1，总量口径取连打满） */
export const ZHENDOU_ASSIST_BREAKING_FANG: MoveFusionGroup = {
  moveId: '1441024',
  agentId: '1441',
  label: '真斗·支援突击·孤影·断獠（连打最大）',
  terms: [
    { moveId: '1441024', count: 1 },
    { moveId: '1441025', count: 1 },
  ],
  note: 'full/1441.json「连打最大伤害倍率」={{Skill:1441024}+{Skill:1441025}}；「伤害倍率」=仅 #1（未连打档）。',
}

/** 千夏·强化特殊技·泡泡糖轰炸＝ #1 + #2（完整强特；「快速衔接特别拍照技巧时」仅 #1 的变体另计） */
export const QIANXIA_EX_BUBBLEGUM_BARRAGE: MoveFusionGroup = {
  moveId: '1491007',
  agentId: '1491',
  label: '千夏·强化特殊技·泡泡糖轰炸',
  terms: [
    { moveId: '1491007', count: 1 },
    { moveId: '1491018', count: 1 },
  ],
  note: 'full/1491.json「泡泡糖轰炸伤害倍率」={{Skill:1491007}+{Skill:1491018}}；引擎只取第一个带能耗的强特(1491007)。',
}

/** 千夏·强化特殊技·特别拍照技巧（协同）＝ #1 + #2——引擎不选该行（无能耗），仅登记口径；
 *  该动作需模块接入（每 [天使协律] 40s 窗口一次、0 耗能，见 qianxia.ts 未建模项）。 */
export const QIANXIA_EX_PHOTOGRAPHY: MoveFusionGroup = {
  moveId: '1491008',
  agentId: '1491',
  label: '千夏·强化特殊技·特别拍照技巧（协同）',
  terms: [
    { moveId: '1491008', count: 1 },
    { moveId: '1491019', count: 1 },
  ],
  note: 'full/1491.json「伤害倍率（协同）」={{Skill:1491008}+{Skill:1491019}}；未接线的协同段登记，待模块发射行后自动生效。',
}

export const MOVE_FUSION_GROUPS: MoveFusionGroup[] = [
  MIYABI_EX_SLASH,
  MIYABI_EX_FOLLOWUP,
  MIYABI_CHAIN,
  CORIN_DODGE,
  CORIN_QUICK_ASSIST,
  XIXIFU_VENOM_FANG,
  KOLEDA_BOILING_FURNACE,
  KOLEDA_ENHANCED_BASIC,
  YANAGI_MOONLIGHT_FLOW,
  JANE_SOMERSAULT,
  ZHAO_ULT_BUNNY_BARRAGE,
  ZHENDOU_ASSIST_BREAKING_FANG,
  QIANXIA_EX_BUBBLEGUM_BARRAGE,
  QIANXIA_EX_PHOTOGRAPHY,
]

/** 主段 moveId → 融合组（查表键） */
export const moveFusionByMoveId: ReadonlyMap<string, MoveFusionGroup> = new Map(
  MOVE_FUSION_GROUPS.map((g) => [g.moveId, g]),
)
