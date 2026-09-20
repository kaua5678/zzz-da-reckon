/**
 * 「队友 Buff 控件必须带可交互性守卫」扫描器（判据 20 的实现面）。
 *
 * ## 要拦的形态
 * `src/views/AttributeConfigPage.vue` 的队友 Buff 列表 `v-for="buff in group.buffs"` 里，
 * `n-checkbox` / `n-slider` 若**无条件渲染**，用户就会看到「可点但拨了没反应」的控件
 * —— 与「机制没做」同形（R62 第六句）。
 *
 * 实测（R65，行为层真管线三态 `damagePoolRows` 全行 sha256）**7 例**：
 *   · `hidden`（现 `singleSourced`）条 2/2：`1061/corin_c2_enemy_phys_res`、
 *     `1311/yaojiayin.special_aria_buff`；
 *   · `effects: []` 且 `buffModifiers: []` 的声明条 5/5：`jufufu.extra_ability_team_decibel`、
 *     `grace_c1_team_energy`、`anby_zero_potential_followup`、`promethea_core_team_voidflare`、
 *     `promethea_c1_extra_def_ignore`。
 *   后 5 例**根本没有** `hidden` ⇒ 只靠「数值通道过滤」永远治不到它们。
 *
 * ## 为什么必须做成机器判据（而不是只留行为测试）
 * 判据落在 `src/utils/teammateBuffRows.ts`（纯谓词）+ 行为测试上时，
 * **模板面无牙**：把 `v-if="isInteractive(buff)"` 从控件上删掉（= 退回修复前），
 * vitest 全绿（R65 probe A/B 两组实测 `failed=0 passed=5`）—— 因为 .vue 模板不参与单测。
 * 而这条守卫**正是本判据存在的全部理由**（模板是用户唯一看得见的那一面）。
 *
 * ## 判据定义（只报可证明的违规，宁漏不误伤）
 * 扫描面 = 模板里**队友 Buff 列表区域**（`class="buff-item-list"` 起，到其后第一个
 * `</n-collapse>` 止）。该区域内每个 `<n-checkbox>` / `<n-slider>` 控件，
 * **自身或其任一祖先元素**的开标签属性段里必须出现 `isInteractive(`。
 *
 * ⚠ 「或祖先」是必要的：覆盖率滑块被包在 `<div v-if="isInteractive(buff) && …">` 里
 *   （守卫在父元素上）——只判控件自身会把**正确写法**误报成违规。
 *   实现 = 轻量元素栈（逐字符走、跳过引号内文本），控件的守卫状态 = 自身 ∨ 栈上任一祖先。
 *
 * 违规 = 区域内某控件自身与全部祖先都无 `isInteractive(`。
 * 反空洞：① 区域必须能定位到（模板改结构 ⇒ 红，提醒重新标定选择器）；
 *         ② 区域内必须**至少有一个**控件（否则「零违规」= 没扫到，与「修好了」不可区分）。
 *
 * ## 为什么用文本而不是 AST
 * 与判据 16（scoped 样式可达性）同款：Vue SFC 模板的 `v-if` 是**指令属性**，
 * 判据只需证明「守卫字符串在该元素的属性段里」——这是**可证明的最小面**。
 * 不判「守卫是否恒真」那类语义问题（那需要执行模板 ⇒ 归行为测试与 ui-check）。
 *
 * @fact ui:队友Buff/控件守卫 口径: 属性配置页队友 Buff 列表区（class="buff-item-list" 至其后首个 </n-collapse>）内每个 n-checkbox / n-slider 的开标签属性段必须含 isInteractive( 守卫；可交互性单一事实源 = src/utils/teammateBuffRows.ts（进数值通道 ∧ 有可求值载荷），无条件渲染 ⇒ 用户看见拨了没反应的死控件 | 据 实测@2026-09-20·R65（7 例死控件：2 条 hidden + 5 条 effects 空声明条；删守卫 ⇒ vitest 全绿无牙） | 验 src/scripts/__tests__/teammateBuffControls.test.ts | 锚 scripts/lib/teammate-buff-controls.mjs#scanTeammateBuffControls | 信 确认
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 渲染面文件（唯一站点；将来若第二处渲染队友 buff 控件，这里会以「区域定位失败」提醒扩面） */
export const TEAMMATE_BUFF_VIEW = 'src/views/AttributeConfigPage.vue'

/** 扫描区域起点 / 终点标记（模板结构变动 ⇒ 定位失败 ⇒ 判红提醒重新标定） */
export const REGION_START = 'class="buff-item-list"'
export const REGION_END = '</n-collapse>'

/** 受判据约束的控件标签 */
export const GUARDED_CONTROLS = ['<n-checkbox', '<n-slider']

/** 守卫子串：控件渲染必须以可交互性派生结果为条件 */
export const INTERACTIVITY_GUARD = 'isInteractive('

/**
 * 从开标签属性段里抽 `v-if` 的值（**只认渲染门控**）。
 *
 * ⚠★ 为什么必须限定 `v-if` 而**不是**「属性段里出现 `isInteractive(` 就算数」：
 * `class="buff-item"` 上的 `:class="{ enabled: isInteractive(buff) && … }"` 里也有这个标识符，
 * 但它只是**样式绑定**，把控件删掉之后它照样在 ⇒ 用它当守卫会让本判据**恒真**。
 * R65 实测踩过：首版用「属性段包含」判，A 组（删掉 checkbox 的 v-if = 退回修复前）
 * 仍判 `ok=true` —— 正是 R62 第七句「探针的绿可能是没跑起来」的形态。
 */
function renderGuardValue(opening) {
  // v-if="…" / v-if='…'；允许 = 两侧空格
  const m = opening.match(/\bv-if\s*=\s*(["'])([\s\S]*?)\1/)
  return m ? m[2] : null
}

/** 该开标签是否**以可交互性为渲染门控** */
function isRenderGuarded(opening) {
  const vIf = renderGuardValue(opening)
  return vIf !== null && vIf.includes(INTERACTIVITY_GUARD)
}

/**
 * 从模板里切出队友 Buff 列表区域。定位失败返回 null（调用方判红）。
 */
export function extractTeammateBuffRegion(source) {
  const start = source.indexOf(REGION_START)
  if (start < 0) return null
  const end = source.indexOf(REGION_END, start)
  if (end < 0) return null
  return source.slice(start, end)
}

/**
 * 取一个控件的**开标签属性段**（`<n-checkbox` 到其闭合 `>` 或 `/>`）。
 * 找不到闭合返回 null（畸形模板 ⇒ 调用方判红）。
 */
function openingTagOf(source, tagStart) {
  // 允许属性值里出现 `>`（如 `v-if="a > b"`）：逐字符走，遇引号内跳过
  let quote = null
  for (let i = tagStart; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (ch === '>') return source.slice(tagStart, i + 1)
  }
  return null
}

/** 自闭合标签（`<br />`、`<img … />`）：不入栈 */
function isSelfClosing(opening) {
  return /\/\s*>$/.test(opening)
}

/** 从开标签里抽标签名（`<n-checkbox` ⇒ `n-checkbox`） */
function tagNameOf(opening) {
  const m = opening.match(/^<\s*([A-Za-z][\w.-]*)/)
  return m ? m[1].toLowerCase() : ''
}

/** 模板里的「非元素」标签名（不参与元素栈配对，避免把 Vue 内置块算成祖先） */
const NON_ELEMENT_TAGS = new Set(['template', 'slot'])

/**
 * 扫描队友 Buff 控件守卫。
 *
 * 实现 = 单遍线性扫：维护一个**祖先守卫栈**，逐个遇到元素开/闭标签时更新。
 * 控件（`<n-checkbox` / `<n-slider>`）的守卫状态 = 自身 ∨ 栈上任一祖先含 `isInteractive(`。
 *
 * 返回 { regionFound, controls, violations, malformed, ok }。
 */
export function scanTeammateBuffControls(root) {
  const path = join(root, TEAMMATE_BUFF_VIEW)
  if (!existsSync(path)) {
    return { regionFound: false, controls: [], violations: [], malformed: [], ok: false, missing: true }
  }
  const source = readFileSync(path, 'utf8')
  const region = extractTeammateBuffRegion(source)
  if (region === null) {
    return { regionFound: false, controls: [], violations: [], malformed: [], ok: false, missing: false }
  }

  const controls = []
  const violations = []
  const malformed = []
  // 祖先栈：每项 = { name, guarded }
  const stack = []

  let i = 0
  while (i < region.length) {
    const lt = region.indexOf('<', i)
    if (lt < 0) break

    // 闭标签
    if (region.startsWith('</', lt)) {
      const gt = region.indexOf('>', lt)
      if (gt < 0) break
      const name = region.slice(lt + 2, gt).trim().toLowerCase()
      // 弹到匹配的祖先（容忍未闭合的中间元素，按名字就近匹配）
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name === name) { stack.length = k; break }
      }
      i = gt + 1
      continue
    }

    // 注释 / doctype：跳过
    if (region.startsWith('<!--', lt)) {
      const end = region.indexOf('-->', lt)
      i = end < 0 ? region.length : end + 3
      continue
    }

    const opening = openingTagOf(region, lt)
    if (opening === null) break
    const name = tagNameOf(opening)
    const selfClosing = isSelfClosing(opening)

    if (GUARDED_CONTROLS.includes(`<${name}`)) {
      controls.push(`<${name}`)
      const guarded = isRenderGuarded(opening) || stack.some(f => f.guarded)
      if (!guarded) {
        violations.push({
          tag: `<${name}`,
          opening: opening.replace(/\s+/g, ' ').slice(0, 120),
        })
      }
    }

    if (!selfClosing && name && !NON_ELEMENT_TAGS.has(name)) {
      stack.push({ name, guarded: isRenderGuarded(opening) })
    }
    i = lt + opening.length
  }

  // 反空洞：没扫到任何控件 ⇒ 「零违规」不可采信（与 dead-channel-ls 空基线配下限同款纪律）
  const ok = violations.length === 0 && malformed.length === 0 && controls.length > 0
  return { regionFound: true, controls, violations, malformed, ok, missing: false }
}
