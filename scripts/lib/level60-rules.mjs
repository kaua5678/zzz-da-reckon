/**
 * level60 字段映射规则表 —— **单一事实源**（AGENTS 规则 11）。
 *
 * 被两处复用，任一侧都不许另抄公式：
 *   - `scripts/audit-catalog-level60.mjs`（只读审计，抓差异）
 *   - `scripts/patch-level60-ascension.mjs`（按规则订正 catalog）
 * 这样「审计抓到什么」永远等于「修复改什么」，两者不会脱节。
 *
 * 每条规则：
 *   field      catalog level60 字段名
 *   label      中文名（人读输出用）
 *   expected   从 nanoka raw 计算「应当落库的值」；返回 undefined = 该角色无此数据，跳过
 *   tolerance  容差（默认 0）。仅用于历史舍入噪声，别调大到会吞掉真错误的量级
 *   patchable  false = 只审计不修（如对照组）
 *   note       为什么这条规则存在（含事故教训）
 */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
/**
 * nanoka 突破/基础属性的**刻度换算** —— 权威标记是 `extra_level.6.extra[].format`
 * （用户 2026-09-12 确认「+36 是真的，0.36 一看就不可能」，据此反查 format 得下表）：
 *
 * | format        | 含义         | 换算     | 实例                        |
 * |---------------|--------------|----------|-----------------------------|
 * | `{0:0.#}`     | 点数         | 直接加   | 12201 冲击力 18 → +18        |
 * | `{0:0}`       | 点数         | 直接加   | 31201 异常精通 90 → +90      |
 * | `{0:0.#%}`    | 百分点       | `v/100`  | 20101 暴击率 1440 → +14.4    |
 * | `{0:0.#%}`    | 百分比       | `v/100`  | 11102 生命值 1800 → ×1.18    |
 * | `{0:0.##}`    | 百分点       | `v/100`  | 30501 回能 36 → +0.36        |
 *
 * ⚠ **同一个 prop 名可能有不同 format**：生命值就分 `11101`(点数, +420) 与 `11102`(%, +18%)，
 * 1341/1441 用 11102（×1.18，实测 9117.41×1.18 = 10758.55 ≈ catalog 10758.5）、
 * 1371 用 11101（+420）。**按 prop id + format 取，不要按名字取。**
 */
/** 百分点：value/100（如 1440 → 14.4） */
const pct2 = (v) => Math.round(v / 100 * 100) / 100
/** 取某 prop 的突破值；`asRate=true` 时按百分点换算，`false` 时按点数直接加 */
const asc = (raw, prop, asRate) => {
  const e = raw?.extra_level?.['6']?.extra?.[prop]
  if (!e) return 0
  return asRate ? pct2(num(e.value)) : num(e.value)
}

export const FIELD_RULES = [
  {
    field: 'critRate',
    label: '暴击率',
    /**
     * 口径：level60 是「满级满突破面板」→ 突破暴击率加成(20101)**必须**计入。
     * 事故（2026-09-12）：导入脚本只写裸 `stats.crit`，漏掉 20101 → 有突破加成的角色
     * 全被落成了裸基值 5。因「大家都一样」肉眼完全看不出来，直到克拉蕾(1611)被单独订正才暴露。
     * 修前自证：catalog 里 1481/1571 = 19.4（含加成，来自另一条已废弃 scraper 路径），
     * 与 19 个裸值角色并存 → 证明是漏写而非逐角色口径差异。
     */
    expected: (raw) => pct2(num(raw?.stats?.crit) + num(raw?.extra_level?.['6']?.extra?.['20101']?.value)),
    note: '20101=暴击率突破；漏加会让所有角色退化成裸基值 5 且看不出来',
  },
  {
    field: 'critDmg',
    label: '暴击伤害',
    expected: (raw) => pct2(num(raw?.stats?.crit_damage) + num(raw?.extra_level?.['6']?.extra?.['21101']?.value)),
    note: '21101=暴击伤害突破，同 critRate',
  },
  {
    field: 'anomalyProficiency',
    label: '异常精通',
    /**
     * ⚠ **反直觉映射**：精通取 `element_mystery`，掌控取 `element_abnormal_power`（与字段名相反）。
     * 三条独立锚点（任一存疑就重查）：① 异常主C 的精通显著更高（1091 星见雅 148 /
     * 1331 薇薇安 118 / 1501 爱芮 116，都来自 mystery）；② extra_level 里 `31201` 的 name
     * 就是「异常精通」；③ 47 个角色按此方向 42 个匹配。
     * 事故：我曾照字面联想把 1621 落成了 精通110/掌控63（反的），1631/1641 同样中招。
     */
    expected: (raw) => num(raw?.stats?.element_mystery) + asc(raw, '31201', false),
    note: '精通←element_mystery + 31201（点数）；字段名反直觉，别照字面联想',
  },
  {
    field: 'anomalyMastery',
    label: '异常掌控',
    expected: (raw) => num(raw?.stats?.element_abnormal_power) + asc(raw, '31401', false),
    note: '掌控←element_abnormal_power + 31401（点数，实测 36 即 +36）',
  },
  {
    field: 'impact',
    label: '冲击力',
    /** 12201 突破（点数 +18）。实测 1141 莱卡恩 catalog 137 = 119+18、1361「扳机」131 = 113+18 已含，
     *  而 1011 安比/1101 珂蕾妲/1351 波可娜 是裸基值 ⇒ 同 crit 的漏加，口径取「含突破」。 */
    expected: (raw) => num(raw?.stats?.break_stun) + asc(raw, '12201', false),
    note: 'break_stun + 12201（点数）；击破角色 130+ 才合理，裸值 11x 多半是漏了',
  },
  {
    field: 'hpBase',
    label: '基础生命值',
    /**
     * ⚠ 生命值突破**有两个 prop**，刻度不同（别按名字取）：
     *   `11101` format `{0:0}`   = 点数直接加（1371 仪玄 +420）
     *   `11102` format `{0:0.#%}` = 百分比，value/100（1341 照 1800 → ×1.18，
     *                                实测 9117.41×1.18 = 10758.55 ≈ catalog 10758.5）
     */
    expected: (raw) => {
      const base = num(raw?.stats?.hp_max) + num(raw?.stats?.hp_growth) / 10000 * 59 + num(raw?.level?.['6']?.hp_max)
      const flat = asc(raw, '11101', false)          // 点数
      const rate = asc(raw, '11102', true) / 100     // 百分点 → 倍率
      return Math.round((base + flat) * (1 + rate) * 10000) / 10000
    },
    /**
     * 容差 0.5：catalog 现存 hpBase 多为**旧爬虫的 1 位小数**（如 8145.8），
     * 与 raw 重算值（8145.8433）天然差 <0.5（实测 14 例）。真漏加（1371 +420 / 1441 +1390）
     * 远超此阈值，仍会被抓出。⚠ 别把容差调到 ≥1，那会吞掉真实漏算。
     */
    tolerance: 0.5,
    note: 'hp 公式 + 11101(点数) 后 ×(1+11102%)；两 prop 刻度不同，按 prop id 取；容差 0.5 吸收旧 1 位小数',
  },
  {
    field: 'energyRegen',
    label: '基础能量自动回复',
    /** 30501 是百分点（36 → +0.36）。实测 8 个角色 catalog 全为 1.56 = 1.2+0.36 ⇒ 已含突破。 */
    /**
     * `sp_recover` 是**直接可用的基值**（120 → 1.2），`30501` 突破是百分点（36 → +0.36）。
     * ⚠ 历史坑：`sp_recover = 0`（无回能，如锋御角色克拉蕾用锐能、命破角色用闪能）时
     * catalog 曾被写成 **1.2**（把"运行时兜底值" `helpers.ts` 的 `?? 1.2` 当成了存储值），
     * 与同类的 1051/1371/1441/1471/1531（都是 0）不一致 ⇒ 2026-09-12 订正为 0。
     * 1491 千夏 `sp_recover=100` 却存 1.2（应为 1.0），同批订正（同类 1551 佩洛伊斯 = 1 是对的）。
     * **不要再对 sr=0/100 做特殊豁免**——它们就该按公式走，豁免只会掩盖错误。
     */
    expected: (raw) => Math.round((num(raw?.stats?.sp_recover) / 100 + asc(raw, '30501', true)) * 100) / 100,
    note: 'sp_recover/100 + 30501(百分点)；0 就是 0（锋御/命破不用能量），别存运行时兜底值 1.2',
  },
  {
    field: 'atkBase',
    label: '基础攻击力',
    /** 对照组：导入脚本这条一直是**正确**的（含 growth + lv6 + 12101）。 */
    expected: (raw) => {
      const st = raw?.stats ?? {}
      const lv6 = raw?.level?.['6'] ?? {}
      const ex6 = raw?.extra_level?.['6']?.extra ?? {}
      const v = num(st.attack) + num(st.attack_growth) / 10000 * 59 + num(lv6.attack) + num(ex6['12101']?.value)
      return Math.round(v * 10000) / 10000
    },
    /**
     * 容差 0.1：catalog 现存 atkBase 是多代脚本沉淀值，与 raw 重算值普遍差 <0.05
     * （实测 1031/1141/1171/1221/1241…）。真错误（1621 洛克茜 +5.5）远超此阈值，仍会被抓出。
     * ⚠ 别调大到 ≥1，那会吞掉真实漏算。
     */
    tolerance: 0.1,
    patchable: false, // 只审计不修：atkBase 差属历史噪声或需人工确认，别脚本批量改
    note: '对照组——大面积小差属历史舍入噪声（容差 0.1）；大的差是真漏算，需人工确认',
  },
]
