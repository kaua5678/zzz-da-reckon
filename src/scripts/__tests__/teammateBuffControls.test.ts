/**
 * 判据 20「队友 Buff 控件守卫」双层测试（2026-09-20 R65-J1）。
 *
 * ① detector 单测（构造源码，**可红性自证**）：
 *    「无 `v-if="isInteractive(…)` 门控的 checkbox/slider」必须报；
 *    控件自身或**祖先**带门控必须不报 —— 这一对是判据的核心 discriminating pair
 *    （少一半就是误报/漏报）。
 * ② 仓库级判据：真实仓库当前违规数 = 0（本轮修复后）。
 *    基线取 **0** 而不是「冻结存量」：非零存量全是**面向用户的缺陷**，没有可豁免的形态。
 *
 * ## 立项依据（R62 第七句的又一次实证：探针的绿可能是没跑起来）
 *
 * 本判据是**被反向验证逼出来的**：R65 的反向验证探针 `probe-r65.py` A/B 两组
 * （把 `v-if="isInteractive(buff)"` 删掉 / 只删一半 = 退回修复前）实测
 * **`failed=0 passed=5` 全绿** —— 因为 .vue 模板不参与单测，
 * 「谓词 + 行为测试」这条判据链**在模板面上没有牙**。
 * 而模板恰恰是**用户唯一看得见的那一面**。⇒ 补本判据后 A/B 精确红。
 *
 * ## 为什么 detector 必须用 `v-if` 而不是「属性段里出现 isInteractive(」
 *
 * 首版就是那么写的，结果 A 组仍判绿：`class="buff-item"` 的
 * `:class="{ enabled: isInteractive(buff) && … }"` 里也有这个标识符，
 * 但它是**样式绑定**，把控件删掉之后它照样在 ⇒ 判据恒真。
 * 本文件第 3 个 detector 用例专门锁这条边界（**防橡皮图章**）。
 */
import { describe, it, expect } from 'vitest'
import {
  scanTeammateBuffControls,
  extractTeammateBuffRegion,
  REGION_START,
  REGION_END,
  TEAMMATE_BUFF_VIEW,
} from '../../../scripts/lib/teammate-buff-controls.mjs'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

/** 造一个最小仓库：只含渲染面文件 */
function makeRepo(viewSource: string): string {
  const root = mkdtempSync(join(tmpdir(), 'r65-buffctrl-'))
  const p = join(root, TEAMMATE_BUFF_VIEW)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, viewSource, 'utf8')
  return root
}

/** 模板外壳：列表区域（区域起止标记）+ 由参数决定门控形态的控件 */
function viewWith({ checkboxGuard, sliderGuard, sliderOnAncestor }: {
  checkboxGuard: string
  sliderGuard: string
  sliderOnAncestor: boolean
}) {
  const slider = `<n-slider ${sliderGuard}:value="c" style="flex: 1" />`
  return `<template>
  <div class="teammate-buff-list">
    <n-collapse>
      <n-collapse-item>
        <div class="buff-item-list">
          <div v-for="buff in group.buffs" :key="buff.id" class="buff-item"
               :class="{ enabled: isInteractive(buff) && cfg(buff.id) }">
            <n-checkbox ${checkboxGuard}:checked="cfg(buff.id)" />
            ${sliderOnAncestor
              ? `<div v-if="isInteractive(buff) && cfg(buff.id)" class="buff-item-coverage">${slider}</div>`
              : slider}
          </div>
        </div>
      </n-collapse-item>
    </n-collapse>
  </div>
</template>
`
}

describe('判据 20 · 队友 Buff 控件守卫扫描器', () => {
  it('★核心判别对：无门控 ⇒ 报违规；带门控 ⇒ 不报', () => {
    const bad = makeRepo(viewWith({ checkboxGuard: '', sliderGuard: '', sliderOnAncestor: false }))
    const badReport = scanTeammateBuffControls(bad)
    expect(badReport.ok, '无门控的 checkbox/slider 必须判红').toBe(false)
    expect(badReport.violations.map(v => v.tag).sort()).toEqual(['<n-checkbox', '<n-slider'])

    const good = makeRepo(viewWith({
      checkboxGuard: 'v-if="isInteractive(buff)" ',
      sliderGuard: '',
      sliderOnAncestor: true, // 滑块门控在父 div 上（= 本仓真实写法）
    }))
    const goodReport = scanTeammateBuffControls(good)
    expect(goodReport.ok, '自身或祖先带门控必须判绿').toBe(true)
    expect(goodReport.violations).toEqual([])
    expect(goodReport.controls.length, '反空洞：必须真扫到控件').toBe(2)
  })

  it('祖先门控与自身门控**各自独立**生效（半修必须红）', () => {
    // 只修 checkbox、滑块（含祖先）都没修 ⇒ 精确 1 条违规，且是 slider
    const half = makeRepo(viewWith({
      checkboxGuard: 'v-if="isInteractive(buff)" ',
      sliderGuard: '',
      sliderOnAncestor: false,
    }))
    const r = scanTeammateBuffControls(half)
    expect(r.ok).toBe(false)
    expect(r.violations.map(v => v.tag)).toEqual(['<n-slider'])
  })

  it('★防橡皮图章：`:class` 里的 isInteractive **不算**渲染门控', () => {
    // 这正是首版的假阴性形态 —— 模板里 isInteractive( 出现两次（都在 :class），
    // 但控件自身与祖先都**没有** v-if ⇒ 必须红。
    const sneaky = makeRepo(viewWith({ checkboxGuard: '', sliderGuard: '', sliderOnAncestor: false }))
    const src = readFileSync(join(sneaky, TEAMMATE_BUFF_VIEW), 'utf8')
    expect(src.includes('isInteractive('), '前提：模板里确实出现了该标识符').toBe(true)
    expect(scanTeammateBuffControls(sneaky).ok,
      '标识符出现在 :class 里不构成渲染门控 ⇒ 必须仍判红').toBe(false)
  })

  it('反空洞①：区域定位失败 ⇒ 判红（不是「零违规」）', () => {
    const noRegion = makeRepo('<template><div>没有队友 buff 列表</div></template>\n')
    const r = scanTeammateBuffControls(noRegion)
    expect(r.regionFound).toBe(false)
    expect(r.ok).toBe(false)
  })

  it('反空洞②：区域内零控件 ⇒ 判红（扫不到与修好了不可区分）', () => {
    const noControls = makeRepo(`<template>
  <div class="teammate-buff-list">
    <n-collapse><n-collapse-item><div class="buff-item-list">没有控件</div></n-collapse-item></n-collapse>
  </div>
</template>
`)
    const r = scanTeammateBuffControls(noControls)
    expect(r.regionFound).toBe(true)
    expect(r.controls).toEqual([])
    expect(r.ok, '零控件时「零违规」不可采信').toBe(false)
  })

  it('渲染面文件缺失 ⇒ 判红（扫描面失效可见）', () => {
    const empty = mkdtempSync(join(tmpdir(), 'r65-buffctrl-empty-'))
    const r = scanTeammateBuffControls(empty)
    expect(r.missing).toBe(true)
    expect(r.ok).toBe(false)
  })

  it('区域切片在起止标记之间（结构契约）', () => {
    const src = `<div>前缀 ${REGION_START} 区域内容 ${REGION_END} 后缀</div>`
    const region = extractTeammateBuffRegion(src)
    expect(region).toContain('区域内容')
    expect(region?.startsWith(REGION_START)).toBe(true)
    expect(region).not.toContain('后缀')
  })

  it('② 仓库级：当前真实仓库违规数 = 0（本轮修复后）', async () => {
    const { fileURLToPath } = await import('node:url')
    const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
    const r = scanTeammateBuffControls(repoRoot)
    expect(r.regionFound, `仓库渲染面应能定位到队友 Buff 列表区域（${TEAMMATE_BUFF_VIEW}）`).toBe(true)
    expect(r.controls.length, '反空洞：真实仓库必须扫到控件').toBeGreaterThan(0)
    expect(r.violations.map(v => v.tag), '真实仓库不得有未加门控的控件').toEqual([])
    expect(r.ok).toBe(true)
  })
})
