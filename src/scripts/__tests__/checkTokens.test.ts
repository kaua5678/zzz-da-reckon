/**
 * 设计令牌护栏的护栏（scripts/check-tokens.mjs）。
 *
 * 与 checkGuards.test.ts 同构，补三层价值：
 * ① 解析器的正则/边界（防漏抓误抓——漏抓一条 = 护栏形同虚设，误抓一条 = 基线虚高藏真债）
 * ② 颜色计算（对比度判据全靠它，算错就是假绿灯）
 * ③ 仓库级 runAllChecks 全绿（在 vitest 里给出定位到文件的失败信息，不用等 CI）
 */
import { describe, expect, it } from 'vitest'
import {
  FONT_SCALE,
  HARDCODED_WHITELIST,
  WA_REF_BASELINE,
  contrastRatio,
  countHardcodedColors,
  extractDeclarationRegions,
  extractTemplateSource,
  findFontSizes,
  findVarRefs,
  flatten,
  parseColor,
  parseGlobalTokens,
  relativeLuminance,
  resolveTokenColor,
  runAllChecks,
  scanVueFiles,
  stripComments,
} from '../../../scripts/check-tokens.mjs'

describe('parseColor（各路色值写法）', () => {
  it('hex 三/四/六/八位', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('#000000')).toEqual({ r: 0, g: 0, b: 0, a: 1 })
    expect(parseColor('#ff000080')).toEqual({ r: 255, g: 0, b: 0, a: 128 / 255 })
    expect(parseColor('#f008')).toEqual({ r: 255, g: 0, b: 0, a: 136 / 255 })
  })

  it('rgb()/rgba() 含斜杠与百分比 alpha', () => {
    expect(parseColor('rgb(255, 0, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColor('rgba(255, 0, 0, 0.5)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 })
    expect(parseColor('rgb(255 0 0 / 50%)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 })
  })

  it('非色值返回 null（不静默吞错）', () => {
    expect(parseColor('red')).toBeNull()
    expect(parseColor('var(--app-bg)')).toBeNull()
    expect(parseColor(undefined)).toBeNull()
  })
})

describe('颜色计算（对比度判据的地基）', () => {
  it('相对亮度：黑白两极', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255, a: 1 })).toBeCloseTo(1, 5)
    expect(relativeLuminance({ r: 0, g: 0, b: 0, a: 1 })).toBeCloseTo(0, 5)
  })

  it('对比度：黑白 = 21:1（WCAG 上限）', () => {
    const white = { r: 255, g: 255, b: 255, a: 1 }
    const black = { r: 0, g: 0, b: 0, a: 1 }
    expect(contrastRatio(white, black)).toBeCloseTo(21, 2)
    expect(contrastRatio(black, white)).toBeCloseTo(21, 2) // 对称
  })

  it('对比度：#767676 vs 白 ≈ 4.54:1（WCAG AA 边界参考值）', () => {
    const grey = parseColor('#767676')!
    const white = parseColor('#ffffff')!
    expect(contrastRatio(grey, white)).toBeGreaterThan(4.5)
    expect(contrastRatio(grey, white)).toBeLessThan(4.6)
  })

  it('flatten：半透明前景压到不透明底', () => {
    const half = { r: 0, g: 0, b: 0, a: 0.5 }
    const white = { r: 255, g: 255, b: 255, a: 1 }
    expect(flatten(half, white)).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 })
  })
})

describe('stripComments（注释里的引用不是活引用）', () => {
  it('块注释与行注释都去掉', () => {
    expect(stripComments('a /* x */ b')).toBe('a  b')
    expect(stripComments('a // x\nb')).toBe('a \nb')
  })

  it('不误伤 URL 里的双斜杠', () => {
    expect(stripComments('url("https://a.b/c")')).toBe('url("https://a.b/c")')
  })
})

describe('extractDeclarationRegions（避开 #id 选择器）', () => {
  it('只取花括号内，id 选择器不计入色值', () => {
    // 注意用 #abc 而非 #app：#app 的 p 不是十六进制字符，HEX_RE 本来就匹配不到，
    // 测不出东西。只有「长得像 hex 的 id」才是真实风险，要用它来验证。
    const css = '#abc { color: #fff; }'
    const decls = extractDeclarationRegions(css).join('')
    expect(decls).toContain('#fff')
    expect(countHardcodedColors(decls)).toBe(1)
    // 整段原文会数成 2（#abc + #fff）——这正是提取声明区要避免的假阳性
    expect(countHardcodedColors(css)).toBe(2)
  })

  it('嵌套 @media 内层声明也能取到', () => {
    const css = '@media (max-width: 900px) { .a { color: #fff; } }'
    const decls = extractDeclarationRegions(css)
    expect(decls.some(d => d.includes('#fff'))).toBe(true)
  })
})

describe('extractTemplateSource（排除 <script> 的数据色）', () => {
  it('只留 template，脚本里的属性色板不计入', () => {
    const src = [
      '<template><div style="color: #f00">x</div></template>',
      '<script setup lang="ts">',
      "const MAP = { attack: { color: '#c0392b', textColor: '#fff' } }",
      '</script>',
      '<style>.a { color: #0f0 }</style>',
    ].join('\n')
    const tpl = extractTemplateSource(src)
    expect(tpl).toContain('#f00')
    expect(tpl).not.toContain('#c0392b')
    expect(tpl).not.toContain('#0f0')
  })

  it('无 template 块返回空串（不抛错）', () => {
    expect(extractTemplateSource('<script>const a=1</script>')).toBe('')
  })
})

describe('findVarRefs / findFontSizes', () => {
  it('var() 兼容 fallback 语法，只取主名', () => {
    expect(findVarRefs('color: var(--a)')).toEqual(['--a'])
    expect(findVarRefs('color: var(--a, #fff)')).toEqual(['--a'])
    expect(findVarRefs('color: var( --a , var(--b))')).toEqual(['--a', '--b'])
  })

  it('字号：识别 px/rem/em 并按数值判定档位', () => {
    const sizes = findFontSizes('.a{font-size:12px}.b{font-size:11.5px}.c{font-size:1rem}')
    expect(sizes.map(s => s.value)).toEqual(['12px', '11.5px', '1rem'])
    expect(sizes.filter(s => FONT_SCALE.includes(s.num)).map(s => s.value)).toEqual(['12px'])
  })

  it('尺度档位不含半档值（11.5/10.5/9.5/8.5 与 7/15/17/22 都算离群）', () => {
    for (const v of [7, 8.5, 9.5, 10.5, 11.5, 15, 17, 22]) expect(FONT_SCALE).not.toContain(v)
    for (const v of [10, 11, 12, 13, 14, 16]) expect(FONT_SCALE).toContain(v)
  })
})

describe('parseGlobalTokens / resolveTokenColor', () => {
  const css = `
:root {
  --app-bg: #0f172a;
  --app-panel: rgba(255, 255, 255, 0.035);
  --line: var(--wa-120);
  --wa-120: rgba(255, 255, 255, 0.12);
}
html.light {
  --app-bg: #edf1f7;
  --app-panel: #ffffff;
  --line: var(--wa-120);
  --wa-120: rgba(23, 26, 31, 0.12);
}
`
  it('分别解析 :root 与 html.light 两个块', () => {
    const { root, light } = parseGlobalTokens(css)
    expect(root.get('--app-bg')).toBe('#0f172a')
    expect(light.get('--app-bg')).toBe('#edf1f7')
    expect(root.size).toBe(4)
    expect(light.size).toBe(4)
  })

  it('跟随 var() 引用求值（最多 8 层，防环）', () => {
    const { root } = parseGlobalTokens(css)
    const bg = resolveTokenColor(root, '--app-bg', null)!
    // --line → --wa-120 → rgba(255,255,255,.12)，压到 #0f172a 上
    const line = resolveTokenColor(root, '--line', bg)!
    expect(line.a).toBe(1)
    expect(line.r).toBeGreaterThan(bg.r) // 白色半透明压深底 → 比底色亮
  })

  it('缺令牌返回 null（由调用方决定跳过还是报错）', () => {
    const { root } = parseGlobalTokens(css)
    expect(resolveTokenColor(root, '--nope', null)).toBeNull()
  })
})

describe('scanVueFiles（口径：样式声明区 + 模板，排除脚本）', () => {
  it('脚本里的属性色板不计入硬编码', () => {
    const files = scanVueFiles(process.cwd(), FONT_SCALE)
    const card = files.find(f => f.path === 'src/components/CharacterCard.vue')
    expect(card).toBeDefined()
    // CharacterCard 的脚本里有 8 职业 × 2 + 9 属性 × 2 = 34 个 hex，若口径错误会是 40+
    expect(card!.hardcoded).toBeLessThan(10)
  })

  it('白名单文件仍会被扫描（只是不参与比较）', () => {
    const files = scanVueFiles(process.cwd(), FONT_SCALE)
    expect(HARDCODED_WHITELIST.length).toBeGreaterThan(0)
    expect(files.some(f => f.path === 'src/App.vue')).toBe(true)
  })
})

describe('仓库级自洽（真实扫描）', () => {
  it('六条判据全绿（tokens-defined / theme-parity / 硬编码棘轮 / 字号棘轮 / 对比度 / 别名棘轮）', () => {
    const { results, ok } = runAllChecks()
    if (!ok) console.log(results.flatMap(r => r.detail).join('\n'))
    expect(ok).toBe(true)
    expect(results).toHaveLength(6)
  })

  it('--wa-* 引用数不超过冻结基线（别名层推进方向）', () => {
    const { stats } = runAllChecks()
    expect(stats.waRefs).toBeLessThanOrEqual(WA_REF_BASELINE)
  })
})
