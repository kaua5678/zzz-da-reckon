/**
 * 事件道（2026-10-26，用户报「失衡轴的块有时候看不到招式名字了。而且毁伤或者异常事件也夹在块里面，
 * 这些内容该新开一个展示轴啊」）。
 *
 * 判据分三层：
 *  ① **纯派生逐值**：引擎产物（触发/积蓄槽/紊乱/残痕步骤）→ 道上的标记，时刻/元素/文案逐值对齐；
 *  ② **不重推**：层数够不够、有没有满槽一律照抄引擎（喂 fired=false 就是未触发，不看 poolAfter 猜）；
 *  ③ **形状锁**：页面模板里事件类标签**不再出现在 .sap-block 内**，且块内名字有保底宽度
 *     （这两条是「看不到招式名字」的根部——标签回来了、或名字又能被压成 0 宽，都会让用户再报一次）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  axisEventLaneDefs,
  buildAnomalyEventMarkers,
  buildMaimEventMarkers,
  layoutEventMarkers,
} from '@/composables/stunAxisEventLanes'

const labelOf = (el: string) => ({ electric: '电', fire: '火', ether: '以太', ice: '冰' }[el] ?? el)
const moveNameOf = (id: string) => ({ 1511006: '雷影掠击', 1611014: '葬血强袭', 1611012: '斩金断铁' }[id] ?? id)

describe('异常道标记（buildAnomalyEventMarkers）', () => {
  it('入窗注入 / 触发 / 紊乱 / 积蓄槽四类各就其位，时刻与元素照抄引擎', () => {
    const markers = buildAnomalyEventMarkers({
      windowIndex: 0,
      entry: { element: 'fire', pct: 50 },
      triggers: [
        { windowIndex: 0, moveId: '1511006', element: 'electric', offsetSeconds: 3.4, id: '0:electric:1', srcIndex: 1 },
        // 与紊乱点同刻 ⇒ 标记为紊乱
        { windowIndex: 0, moveId: '1511006', element: 'ether', offsetSeconds: 8, id: '0:ether:1', srcIndex: 2 },
        // 别的窗 ⇒ 不进来
        { windowIndex: 1, moveId: '1511006', element: 'ice', offsetSeconds: 1, id: '1:ice:1', srcIndex: 0 },
      ],
      disorders: [{ windowIndex: 0, time: 8, element: 'electric' }],
      gaugeSnapshots: [{ windowIndex: 0, srcIndex: 1, pct: { electric: 33.7, ether: 0 } }],
      labelOf,
      moveNameOf,
      blockAtOf: src => (src === 1 ? 5 : 0),
    })
    expect(markers.map(m => [m.kind, m.at, m.label])).toEqual([
      ['entry', 0, '入窗·火'],
      ['trigger', 3.4, '触电'],
      ['disorder', 8, '触以太·紊'],
      ['gauge', 5, '条电34%'],
    ])
    expect(markers[1].title).toContain('雷影掠击 @3.40s')
    expect(markers[3].title).toContain('100% = 满槽即触发')
  })

  it('无代表窗（windowIndex < 0）⇒ 空；无摘要元素 ⇒ 只出触发', () => {
    expect(buildAnomalyEventMarkers({ windowIndex: -1, labelOf, moveNameOf })).toEqual([])
    const onlyTrigger = buildAnomalyEventMarkers({
      windowIndex: 0,
      triggers: [{ windowIndex: 0, moveId: '1511006', element: 'electric', offsetSeconds: 1, id: 'x' }],
      labelOf, moveNameOf,
    })
    expect(onlyTrigger).toHaveLength(1)
    expect(onlyTrigger[0].kind).toBe('trigger')
  })

  it('抑制的触发：标记为 ✕ 且 dim（保留在道上——用户要看到「这里本该触发」）', () => {
    const markers = buildAnomalyEventMarkers({
      windowIndex: 0,
      triggers: [{ windowIndex: 0, moveId: '1511006', element: 'electric', offsetSeconds: 2, id: '0:electric:1' }],
      suppressed: ['0:electric:1'],
      labelOf, moveNameOf,
    })
    expect(markers[0].label).toBe('✕电')
    expect(markers[0].dim).toBe(true)
    expect(markers[0].title).toContain('已抑制')
  })
})

describe('毁伤道标记（buildMaimEventMarkers）', () => {
  it('只取消耗步骤 + 只取代表窗；触发/未触发都照抄引擎的 fired', () => {
    const markers = buildMaimEventMarkers({
      window: 1,
      perLayer: 600,
      labelOf: mid => `${moveNameOf(mid)}·毁伤`,
      steps: [
        // 积累步骤不进道（不是事件）
        { moveId: '1511001', kind: 'gain', layers: 1.5, fired: true, at: 1, poolAfter: 900, window: 1 },
        { moveId: '1611014', kind: 'consume', layers: 3, fired: true, at: 2.3, poolAfter: 0, window: 1 },
        { moveId: '1611012', kind: 'consume', layers: 1, fired: false, at: 4, poolAfter: 300, window: 1 },
        // 第 2 窗的步骤：代表窗是第 1 窗 ⇒ 不进来
        { moveId: '1611014', kind: 'consume', layers: 3, fired: true, at: 2.3, poolAfter: 0, window: 2 },
      ],
    })
    expect(markers.map(m => [m.kind, m.at, m.label])).toEqual([
      ['maim', 2.3, '毁伤×3'],
      ['maimMiss', 4, '毁伤✕'],
    ])
    expect(markers[0].title).toContain('触发 3 次毁伤')
    expect(markers[1].title).toContain('未触发毁伤')
  })

  it('不重推：fired=false 时即使池里有层也不改判（只信引擎）', () => {
    const [m] = buildMaimEventMarkers({
      window: 1, perLayer: 600, labelOf: id => id,
      steps: [{ moveId: '1611012', kind: 'consume', layers: 1, fired: false, at: 0, poolAfter: 1800, window: 1 }],
    })
    expect(m.kind).toBe('maimMiss')
  })
})

describe('事件道定义（axisEventLaneDefs）', () => {
  it('按引擎是否给摘要 / 是否声明残痕资源决定画几条道', () => {
    expect(axisEventLaneDefs({ hasAnomaly: true, hasMaim: true }).map(d => d.key)).toEqual(['anomaly', 'maim'])
    expect(axisEventLaneDefs({ hasAnomaly: true, hasMaim: false }).map(d => d.key)).toEqual(['anomaly'])
    expect(axisEventLaneDefs({ hasAnomaly: false, hasMaim: true }).map(d => d.key)).toEqual(['maim'])
    expect(axisEventLaneDefs({ hasAnomaly: false, hasMaim: false })).toEqual([])
    expect(axisEventLaneDefs({ hasAnomaly: true, hasMaim: false })[0].name).toBe('异常事件')
  })
})

describe('页面形状锁（看不到招式名字的两个根因）', () => {
  const page = readFileSync(resolve(__dirname, '../../views/StunAxisPage.vue'), 'utf8')

  it('事件类内容不再画在动作块内：块内只剩招式名与招式级徽标', () => {
    const blockStart = page.indexOf('v-for="(act, aii) in axis.actions"')
    expect(blockStart, '反空洞：动作块仍在模板里').toBeGreaterThan(0)
    const blockEnd = page.indexOf('</div>', page.indexOf('moveBadgeFor(act)', blockStart))
    const block = page.slice(blockStart, blockEnd)
    // 旧的块内事件标注（触X / 条XX% / 入窗）三件套一个都不许回来
    expect(block).not.toContain('anomalyTagsFor')
    expect(block).not.toContain('条${')
    // 招式名仍在块内（不是被删掉，而是不再被挤掉）
    expect(block).toContain('sap-block-text')
  })

  /**
   * ⚠ 2026-10-29 口径迁移（本条锁的**意图不变**，判据换了）：
   * 旧判据 = 「名字有 min-width:3.6em 保底宽度 ⇒ 名字永远占着 3.6em，徽标先收缩」。
   * 但 3.6em 保的是**占位**不是**可读**：块只有 2% 宽时，名字照样被 overflow 切成半个字
   * （用户报「动作块也短小，写字也不清不楚」）。现在保证改由**布局**给：
   * 放得下才写块里、放不下排到标签行（stunAxisView#layoutBlockLabels，有单测）；
   * CSS 侧只留「名字不收缩、徽标与时长先收缩」这条优先级。
   */
  it('招式名优先：名字不收缩、徽标/时长先收缩；放不下的名字改走标签行（不再切字）', () => {
    const nameRule = page.match(/\.sap-block-text \{([^}]*)\}/)?.[1] ?? ''
    const badgeRule = page.match(/\.sap-mw \{([^}]*)\}/)?.[1] ?? ''
    const durRule = page.match(/\.sap-block-dur \{([^}]*)\}/)?.[1] ?? ''
    expect(nameRule, '名字不许参与收缩（放不放得下由布局判）').toMatch(/flex:\s*0\s+0/)
    expect(nameRule, '名字不许 flex:1 被压到 0').not.toMatch(/flex:\s*1/)
    expect(badgeRule, '徽标必须可收缩').toMatch(/flex-shrink:\s*1/)
    expect(durRule, '时长是可收缩的尾巴（先挤掉它，不是挤名字）').toMatch(/flex:\s*0\s+1/)
    expect(page, '外置标签行仍在').toContain('class="sap-blab"')
    expect(page, '块内文字必须由布局判定，不许无条件输出').toContain('v-if="blockTextOf(ai, aii)"')
  })

  it('事件道/标签行渲染存在，道高·道位·标记行全部来自派生布局（不写死道高与道距）', () => {
    // 道：一条道一类事件，top/height 由 eventLanes 逐道算，起点由 buildTimelineLayout 逐轴给
    expect(page).toContain('v-for="lane in layoutOf(ai).evLanes"')
    expect(page).toContain(':style="{ top: lane.top, height: lane.height }"')
    // 标记：同刻多颗要分行（mk.row），行高走 TL 常量（写死 16 会在改块高/道高时错位）
    expect(page).toContain('top: (3 + mk.row * TL.evRowH)')
    // 时间轴容器高度也必须随内容走（写死会把新增的事件道/标签行压出容器）
    expect(page).toContain(":style=\"{ height: layoutOf(ai).height + 'px' }\"")
    expect(page).not.toMatch(/\.sap-timeline \{[^}]*height:\s*106px/)
    // 累积式布局：窗口道/事件道的顶坐标必须是**算出来的**（旧实现写死 24 + 序号×20 ⇒ 多一行就互相压住）
    expect(page).toContain('winTop')
    expect(page, '不许回退成固定道距').not.toContain('eventLaneFirst.value * 20')
    expect(page, '像素口径必须走 TL 常量').toContain('const TL = {')
  })
})

describe('同刻标记分行（layoutEventMarkers）', () => {
  const mk = (at: number, key: string) => ({ key, at, label: key, title: '', kind: 'gauge' as const })

  it('间距够 = 同一排；同刻/太近 = 下一排（不重叠）', () => {
    const { rows, placed } = layoutEventMarkers([mk(0, 'a'), mk(0, 'b'), mk(10, 'c')], 20)
    expect(placed.map(p => [p.key, p.row])).toEqual([['a', 0], ['b', 1], ['c', 0]])
    expect(rows).toBe(2)
  })

  it('只影响排号，不改时刻/顺序/其它字段', () => {
    const input = [mk(3, 'x'), mk(3.1, 'y'), mk(9, 'z')]
    const { placed } = layoutEventMarkers(input, 20)
    expect(placed.map(p => p.at)).toEqual([3, 3.1, 9])
    expect(placed.map(p => p.key)).toEqual(['x', 'y', 'z'])
    expect(placed.map(p => p.kind)).toEqual(input.map(p => p.kind))
  })

  it('空输入 ⇒ 仍占 1 行（道要画出来，让用户看到「这条道是空的」），单颗 ⇒ 1 行', () => {
    expect(layoutEventMarkers([], 20).rows).toBe(1)
    expect(layoutEventMarkers([], 20).placed).toEqual([])
    expect(layoutEventMarkers([mk(1, 'a')], 20).rows).toBe(1)
  })
})
