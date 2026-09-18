/**
 * 设计令牌护栏的护栏（scripts/check-tokens.mjs）。
 *
 * 与 checkGuards.test.ts 同构，补三层价值：
 * ① 解析器的正则/边界（防漏抓误抓——漏抓一条 = 护栏形同虚设，误抓一条 = 基线虚高藏真债）
 * ② 颜色计算（对比度判据全靠它，算错就是假绿灯）
 * ③ 仓库级 runAllChecks 全绿（在 vitest 里给出定位到文件的失败信息，不用等 CI）
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  CONTRAST_EXTRA_PAIRS,
  NAIVE_TOKEN_MAP,
  FONT_SCALE,
  HARDCODED_WHITELIST,
  WA_REF_BASELINE,
  contrastRatio,
  countHardcodedColors,
  extractAppFontFamily,
  extractBlock,
  extractDeclarationRegions,
  extractFlatPairs,
  extractStyleBlocks,
  extractTemplateSource,
  findFontSizes,
  findVarRefs,
  flatten,
  normalizeFontStack,
  parseColor,
  parseGlobalTokens,
  relativeLuminance,
  resolveTokenColor,
  resolveTokenRaw,
  runAllChecks,
  sameValue,
  scanComposableFiles,
  scanVueFiles,
  stripComments,
  stripJsComments,
  TINTED_LITERAL_ALLOW_SET,
  ROOT,
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

/**
 * stripJsComments 是判据 10（scene-ink-closure）的地基：
 * 它要抓 `ctx.fillStyle = 'var(--x)'` 这个「Canvas 静默忽略」的写法，
 * 而两个 3D 组件的**反面教材注释里逐字引用了它** ⇒ 不剥注释 = 把自己的文档判成违规
 * （2026-09-18 round 31 首版实测正是 2 条假红）。
 */
describe('stripJsComments（JS 注释不是活代码）', () => {
  it('块注释与行注释都去掉（JS 口径，与 CSS 版分开）', () => {
    // ⚠ 不断言逐字空白：本函数先把字符串字面量换成占位符再剥注释，
    // 占位符回填后块注释位置会多出空格（`a   b` 而非 CSS 版的 `a  b`）。
    // 判据只关心「注释内容不再出现在结果里」，钉空白 = 钉实现细节（会让无害重构假红）。
    expect(stripJsComments('a /* x */ b').replace(/\s+/g, ' ')).toBe('a b')
    expect(stripJsComments('a // x\nb')).toBe('a \nb')
  })

  it('★ 剥掉注释里引用的错误写法（否则判据 10 假红）', () => {
    // 这正是两个 3D 组件注释里的形态——注释里的 `ctx.fillStyle = 'var(...)'` 不是活代码
    const src = "// ⚠ 不要写 ctx.fillStyle = 'var(--wa-450)'：Canvas 静默忽略\nctx.fillStyle = sceneInk()"
    const code = stripJsComments(src)
    expect(code).not.toContain("'var(--wa-450)'")
    expect(code).toContain('sceneInk()')
  })

  it('★ 保留字符串字面量里的 // 与 /*（不误伤 URL / 正则相邻文本）', () => {
    expect(stripJsComments('const u = "https://a.b/c"')).toBe('const u = "https://a.b/c"')
    expect(stripJsComments("const t = 'a // b'")).toBe("const t = 'a // b'")
    expect(stripJsComments('const s = `x /* y */ z`')).toBe('const s = `x /* y */ z`')
  })

  it('★ 行注释里带引号也不会吃掉后面的活代码', () => {
    const src = "// 它写着 'var(--x)' 这个坑\nconst a = 1"
    const code = stripJsComments(src)
    expect(code).toContain('const a = 1')
    expect(code).not.toContain('var(--x)')
  })

  it('未闭合的模板串不抛、不吞（防御性）', () => {
    expect(() => stripJsComments('const a = `unterminated')).not.toThrow()
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

  it('theme-parity 的判定口径：值含色值字面量的才算主题相关', () => {
    // 与 check-tokens.mjs 内 isThemeDependent 同口径。这条测试的意义是防止有人
    // 把判定改成「键集完全相等」，那样会把几十个尺度令牌逼着在 html.light 抄一遍。
    const isThemeDependent = (v: string) => /#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i.test(v)
    expect(isThemeDependent('--space-4: 8px'.split(': ')[1])).toBe(false)
    expect(isThemeDependent('--text-md: 12px'.split(': ')[1])).toBe(false)
    expect(isThemeDependent('--dur-base: 200ms'.split(': ')[1])).toBe(false)
    expect(isThemeDependent('--fg-2: var(--wa-750)'.split(': ')[1])).toBe(false)
    expect(isThemeDependent('--app-font-sans: system-ui, sans-serif'.split(': ')[1])).toBe(false)
    // 含色值 → 必须双主题各一份
    expect(isThemeDependent('0 1px 2px rgba(2, 6, 23, 0.4)')).toBe(true)
    expect(isThemeDependent('#0f172a')).toBe(true)
    expect(isThemeDependent('rgba(255, 255, 255, 0.02)')).toBe(true)
  })
})

describe('字体栈一致性（规则 11：global.css ↔ App.vue 单一事实源）', () => {
  it('normalizeFontStack 抹平引号/折行/大小写，只比字体序列', () => {
    const a = 'system-ui, -apple-system,\n  "Segoe UI", Roboto,\n  "PingFang SC", sans-serif'
    const b = `system-ui, -apple-system, 'Segoe UI', Roboto, "PingFang SC", sans-serif`
    expect(normalizeFontStack(a)).toBe(normalizeFontStack(b))
    expect(normalizeFontStack(a)).toBe('system-ui, -apple-system, segoe ui, roboto, pingfang sc, sans-serif')
  })

  it('字体序列不同则判为分叉（不是只比长度）', () => {
    expect(normalizeFontStack('Inter, sans-serif')).not.toBe(normalizeFontStack('system-ui, sans-serif'))
  })

  it('extractAppFontFamily 抽单引号/双引号两种写法', () => {
    expect(extractAppFontFamily(`fontFamily:\n    'Inter, sans-serif',`)).toBe('Inter, sans-serif')
    expect(extractAppFontFamily(`fontFamily: "Inter, sans-serif",`)).toBe('Inter, sans-serif')
    expect(extractAppFontFamily('const a = 1')).toBeNull()
  })
})

describe('scanVueFiles 的扫描面含 src/styles/*.css（2026-09-14 补的第二个搬家盲区）', () => {
  // 为什么要有这组：与 extractStyleBlocks 的 `<style src>` 盲区**同型**——把 CSS 从 .vue 搬进
  // `src/styles/` 会让四条棘轮一起失明（实测：6 个跨页图表类收进 styles/charts.css 后，
  // 若不扩面，两页计数会「凭空下降」，判据只报「是进步，把基线下调」）。
  it('★ src/styles/*.css 在扫描面内（搬进 styles 目录不再失明）', () => {
    const files = scanVueFiles(process.cwd(), FONT_SCALE)
    const paths = files.map(f => f.path)
    expect(paths).toContain('src/styles/charts.css')
  })

  it('★ global.css 除外（它是令牌定义源，字面色值就是定义本体）', () => {
    const files = scanVueFiles(process.cwd(), FONT_SCALE)
    expect(files.map(f => f.path)).not.toContain('src/styles/global.css')
  })

  it('★ charts.css 的规则被真实计量（不是当成 0 混过去）', () => {
    const f = scanVueFiles(process.cwd(), FONT_SCALE).find(x => x.path === 'src/styles/charts.css')!
    expect(f).toBeDefined()
    // 6 个共享基元里的 var() 引用必须被数出来（否则「搬进 .css 就失明」的缺陷会复发）
    expect(f.varRefs).toContain('--wa-80')
    expect(f.varRefs).toContain('--app-primary')
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

describe('extractStyleBlocks 的 <style src> 支持（2026-09-14 实测补的静默逃生通道）', () => {
  // 为什么要有这组：把 627 行 CSS 从 .vue 搬到独立 .css（`<style scoped src="…">`）后，
  // 首版 extractStyleBlocks 只读 .vue 内联正文 ⇒ 硬编码色值 33→3、离群字号 8→0、var() 76→21
  // **三份计数一起消失**，而判据只会报「是进步，把基线下调」——「把 CSS 挪出 .vue」于是成了
  // 三条棘轮的静默逃生通道（实测于 TimeChartsPage.vue 样式外置）。
  const room = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'tokens-src-'))
    for (const [rel, text] of Object.entries(files)) {
      const p = join(dir, rel)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, text)
    }
    return dir
  }

  it('src 指向的 .css 内容计入硬编码色值/离群字号/var()', () => {
    const root = room({
      'src/views/A.vue': '<template><div class="a" /></template>\n<style scoped src="./a.css"></style>\n',
      'src/views/a.css': '.a { color: #ff0000; font-size: 11.5px; background: var(--wa-60); }',
    })
    const f = scanVueFiles(root, FONT_SCALE).find(x => x.path === 'src/views/A.vue')!
    expect(f.hardcoded).toBe(1) // #ff0000 来自外置 css（模板无内联样式）
    expect(f.fontOutliers).toEqual(['11.5px'])
    expect(f.varRefs).toContain('--wa-60')
  })

  it('内联 <style> 与外置 .css 并存时 var() 不双计（各算一次）', () => {
    const root = room({
      'src/views/B.vue': '<template><div /></template>\n<style scoped>.b { color: var(--c-info); }</style>\n<style scoped src="./b.css"></style>\n',
      'src/views/b.css': '.b2 { color: var(--c-danger); }',
    })
    const f = scanVueFiles(root, FONT_SCALE).find(x => x.path === 'src/views/B.vue')!
    expect(f.varRefs.filter(v => v === '--c-info')).toHaveLength(1)
    expect(f.varRefs.filter(v => v === '--c-danger')).toHaveLength(1)
  })

  it('src 指到仓外/不存在的文件不静默（计入一行可归因的 ✗ 标记，计数不虚高）', () => {
    const root = room({ 'src/views/C.vue': '<template><div /></template>\n<style scoped src="./missing.css"></style>\n' })
    const blocks = extractStyleBlocks(readFileSync(join(root, 'src/views/C.vue'), 'utf8'), { root, filePath: 'src/views/C.vue' })
    expect(blocks).toHaveLength(1)
    expect(blocks[0].content).toContain('无法解析')
    const f = scanVueFiles(root, FONT_SCALE).find(x => x.path === 'src/views/C.vue')!
    expect(f.hardcoded).toBe(0)
    expect(f.varRefs).toEqual([])
  })

  it('不传 root/filePath 时退回旧行为（纯字符串提取，不读文件系统）', () => {
    const blocks = extractStyleBlocks('<style scoped src="./whatever.css">.x{}</style>')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].content.trim()).toBe('.x{}')
    expect(blocks[0].external).toBe('')
  })
})

describe('scanComposableFiles（口径：把 composables 的 .ts 纳入 var() 统计）', () => {
  // 为什么要有这条口径：评审 #14 把图表取色抽进 composables/*.ts 后，.vue-only 的统计面
  // 连续四次把"搬家"误报为"改回字面量"；反向更糟——在 .ts 里把 var() 换成字面量完全看不见。
  it('扫到 composables 下的 .ts，且**排除** __tests__ 与 *.test.ts', () => {
    const files = scanComposableFiles(process.cwd())
    expect(files.length).toBeGreaterThan(10)
    for (const f of files) {
      expect(f.path.startsWith('src/composables/')).toBe(true)
      expect(f.path).not.toContain('__tests__')
      expect(f.path.endsWith('.test.ts')).toBe(false)
    }
  })

  it('抽出的图表模块里的 var() 确实被计入（以 pullValueChart 为例）', () => {
    const files = scanComposableFiles(process.cwd())
    const pv = files.find(f => f.path === 'src/composables/pullValueChart.ts')
    expect(pv).toBeDefined()
    expect(pv!.varRefs).toContain('--wa-150')
    expect(pv!.varRefs).toContain('--fg-3')
  })

  it('目录不存在时返回空数组（不抛错）', () => {
    expect(scanComposableFiles('/nonexistent-root')).toEqual([])
  })
})

describe('仓库级自洽（真实扫描）', () => {
  it('十二条判据全绿（tokens-defined / theme-parity / 硬编码棘轮 / 字号棘轮 / 对比度 / 别名棘轮 / 字体栈一致 / naive-token-reuse / scene-contrast / scene-ink-closure / tinted-contrast / tinted-ink-closure）', () => {
    const { results, ok } = runAllChecks()
    if (!ok) console.log(results.flatMap(r => r.detail).join('\n'))
    expect(ok).toBe(true)
    // ⚠ 这条计数是**有意**钉死的：加判据必须同步改这里，逼一次「新判据是否真有断言」的复核
    // （只看 ok 的话，一个恒真的空判据也能混进来）。历史：8 → 10（round 31 加两条 3D 场景判据）
    // → 12（round 31-a2 加两条贴片墨判据）。
    expect(results).toHaveLength(12)
  })

  it('★ 场景判据成对存在（行为面 scene-contrast + 形状面 scene-ink-closure）', () => {
    // 为什么单列一条：R30 §2.3 的教训是「单写任一面都有盲区」——
    // 只有行为面 ⇒ 把场景文字改回 --wa-450 看不出来（该令牌自己没变）；
    // 只有形状面 ⇒ 场景底改回固定深色看不出来（引用名没变）。两者必须同时在册。
    const names = runAllChecks().results.map(r => r.name).join('\n')
    expect(names).toContain('scene-contrast')
    expect(names).toContain('scene-ink-closure')
  })

  it('★ 贴片墨判据成对存在（行为面 tinted-contrast + 形状面 tinted-ink-closure）', () => {
    // 与上面那条同构（round 31-a2）。实测三条注入把「两面都必要」钉实：
    //   注入 A/C：行为面红、形状面绿（改了值、引用名没变）⇒ 行为面必要
    //   注入 D：行为面**绿**（自洽字面量对，双主题都 5.31:1）、形状面红 ⇒ 形状面必要
    const names = runAllChecks().results.map(r => r.name).join('\n')
    expect(names).toContain('tinted-contrast')
    expect(names).toContain('tinted-ink-closure')
  })

  it('--wa-* 引用数不超过冻结基线（别名层推进方向）', () => {
    const { stats } = runAllChecks()
    expect(stats.waRefs).toBeLessThanOrEqual(WA_REF_BASELINE)
  })

  it('★ 形状面豁免仍然有效（防「豁免腐烂」：被豁免的选择器一旦消失/改名就必须删条目）', () => {
    // 为什么单列：豁免表是判据唯一的逃生口，条目腐烂后**静默失效**——
    // 选择器改名后豁免指向空气，判据看起来还在保护，实际已经放行。
    // 判据 10（scene-ink-closure）的教训同源：白名单条目必须可证明仍被消费。
    const { results } = runAllChecks()
    const closure = results.find(r => r.name.includes('tinted-ink-closure'))
    expect(closure).toBeDefined()
    for (const [key, reason] of TINTED_LITERAL_ALLOW_SET) {
      const [file, selector] = key.split('::')
      // ① 该文件里这个选择器必须真实存在（否则豁免已腐烂）
      const src = readFileSync(join(ROOT, file), 'utf8')
      const blocks = extractStyleBlocks(src, { root: ROOT, filePath: file })
      const cssText = blocks.map(b => b.content).join('\n')
      expect(cssText, `豁免条目已腐烂：${key} 的选择器在文件中不存在`).toContain(selector)
      // ② 该选择器必须**仍然**是字面量（否则豁免已无用，应当删除）
      // ⚠ `.pop()` 返回 `string | undefined`（规则可能是多行选择器）⇒ 必须兜住，
      //   否则 `vue-tsc -b` 报 TS2532 —— vitest **不做类型检查**，这个坑只有 build 看得见。
      const lastLine = (s: string) => s.trim().split('\n').pop() ?? ''
      const rule = [...cssText.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .find(m => lastLine(m[1]) === selector)
      expect(rule, `豁免条目已无用：${key} 找不到规则体，应删除该豁免`).toBeDefined()
      expect(/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(rule?.[2] ?? ''), `豁免已无用：${key} 已不含字面量，删除豁免`).toBe(true)
      expect(reason.length).toBeGreaterThan(0)
    }
  })
})

describe('extractBlock / stripNestedBraces / extractFlatPairs（App.vue 块解析）', () => {
  const src = `const darkCommon = {
  bodyColor: '#0f172a',
  nested: { inner: 'x', deep: { y: 1 } },
  tagColor: 'rgba(255, 255, 255, 0.06)',
}
const darkOverrides = {
  Tooltip: {
    color: 'rgba(30, 41, 59, 0.96)',
    textColor: '#fff',
  },
}`

  it('extractBlock 按名字取花括号内容（支持嵌套与 const/段内两种写法）', () => {
    const block = extractBlock(src, 'darkCommon')
    expect(block).toContain("bodyColor: '#0f172a'")
    expect(block).toContain('nested: { inner')
    const tooltip = extractBlock(src, 'Tooltip')
    expect(tooltip).toContain("color: 'rgba(30, 41, 59, 0.96)'")
  })

  it('extractFlatPairs 只取顶层单引号键值对，嵌套段不干扰', () => {
    const pairs = extractFlatPairs(extractBlock(src, 'darkCommon'))
    expect(pairs.get('bodyColor')).toBe('#0f172a')
    expect(pairs.get('tagColor')).toBe('rgba(255, 255, 255, 0.06)')
    expect(pairs.has('nested')).toBe(false)
    expect(pairs.has('inner')).toBe(false)
  })

  it('组件段内的键经 extractBlock+extractFlatPairs 两跳取出', () => {
    const section = extractBlock(src, 'darkOverrides')!
    const pairs = extractFlatPairs(extractBlock(section, 'Tooltip'))
    expect(pairs.get('textColor')).toBe('#fff')
  })

  it('找不到块返回 null（不抛错）', () => {
    expect(extractBlock(src, 'noSuchBlock')).toBeNull()
  })
})

describe('resolveTokenRaw（跨层取最终原始值）', () => {
  const tokens = new Map([
    ['--fill-hover', 'var(--wa-60)'],
    ['--wa-60', 'rgba(255, 255, 255, 0.06)'],
  ])

  it('跟别名链到原始色值（≤8 层）', () => {
    expect(resolveTokenRaw(tokens, '--fill-hover')).toBe('rgba(255, 255, 255, 0.06)')
  })

  it('主表缺键时用 fallback 合并表继续跟（链中间仍优先主表值）', () => {
    const fallback = new Map([['--wa-60', 'rgba(23, 26, 31, 0.06)']])
    const lightish = new Map([['--fill-hover', 'var(--wa-60)']])
    expect(resolveTokenRaw(lightish, '--fill-hover', fallback)).toBe('rgba(23, 26, 31, 0.06)')
  })

  it('链断裂或成环返回 null（不静默给错值）', () => {
    expect(resolveTokenRaw(new Map([['--a', 'var(--missing)']]), '--a')).toBeNull()
    const ring = new Map([['--a', 'var(--b)'], ['--b', 'var(--a)']])
    expect(resolveTokenRaw(ring, '--a')).toBeNull()
  })
})

describe('sameValue（容忍写法差异的同值判定）', () => {
  it('rgba 写法差异（空格/小数 alpha）视为同值', () => {
    expect(sameValue('rgba(1,2,3,.5)', 'rgba(1, 2, 3, 0.5)')).toBe(true)
  })

  it('非色值按归一化字符串比较', () => {
    expect(sameValue('12px', '12px')).toBe(true)
    expect(sameValue('12px', '13px')).toBe(false)
  })

  it('色值不同就不同（防假绿）', () => {
    expect(sameValue('#ffffff', '#000000')).toBe(false)
    expect(sameValue(null, '#fff')).toBe(false)
  })
})

describe('naive-token-reuse 判据（App.vue ↔ global.css 表面色对齐）', () => {
  it('映射表非空且每个条目三元组完整（主题块/键/令牌）', () => {
    expect(NAIVE_TOKEN_MAP.length).toBeGreaterThanOrEqual(36)
    for (const [block, key, token] of NAIVE_TOKEN_MAP) {
      expect(['darkCommon', 'lightCommon', 'darkOverrides', 'lightOverrides']).toContain(block)
      expect(key).toMatch(/^(\w+|\w+\.\w+)$/)
      expect(token).toMatch(/^--/)
    }
  })

  it('映射表引用的令牌全部真实存在于 global.css（否则判据自身就是死的）', () => {
    const css = readFileSync(new URL('../../../src/styles/global.css', import.meta.url), 'utf8')
    const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]))
    for (const [, , token] of NAIVE_TOKEN_MAP) {
      expect(defined.has(token), `${token} 未在 global.css 定义`).toBe(true)
    }
  })

  it('额外对比度对的令牌也真实存在', () => {
    const css = readFileSync(new URL('../../../src/styles/global.css', import.meta.url), 'utf8')
    const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]))
    for (const p of CONTRAST_EXTRA_PAIRS) {
      expect(defined.has(p.fg), `${p.fg} 未定义`).toBe(true)
      expect(defined.has(p.bg), `${p.bg} 未定义`).toBe(true)
    }
  })
})
