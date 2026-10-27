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

  it('招式名有保底宽度；徽标先收缩（顺序错了名字又会被压成 0 宽）', () => {
    const nameRule = page.match(/\.sap-block-text \{([^}]*)\}/)?.[1] ?? ''
    const badgeRule = page.match(/\.sap-mw \{([^}]*)\}/)?.[1] ?? ''
    expect(nameRule, '.sap-block-text 必须有 min-width').toMatch(/min-width:\s*[\d.]+em/)
    expect(nameRule, '名字不许 flex:1 被压到 0').not.toMatch(/flex:\s*1/)
    expect(badgeRule, '徽标必须可收缩').toMatch(/flex-shrink:\s*1/)
  })

  it('事件道渲染存在，道高/道位/标记行全部来自派生函数（不写死道高）', () => {
    // 道：一条道一类事件，top/height 由 eventLanes 逐道算（行数不同 ⇒ 不能用固定 20px 递增）
    expect(page).toContain('v-for="lane in eventLanes(ai)"')
    expect(page).toContain(':style="{ top: lane.top, height: lane.height }"')
    // 标记：同刻多颗要分行（mk.row），否则「触发」与「块末积蓄槽」会叠成一颗
    expect(page).toContain('top: (2 + mk.row * 16) + \'px\'')
    // 时间轴容器高度也必须随内容走（写死会把新增的事件道压出容器）
    expect(page).toContain(':style="{ height: timelineHeight(ai) }"')
    expect(page).not.toMatch(/\.sap-timeline \{[^}]*height:\s*106px/)
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
