/**
 * 判据 26（影子内核隔离）检测器的行为锁。仓库级「全绿」由 checkGuards.test.ts 的总条数断言覆盖；
 * 这里只用夹具自证判定口径，不断言仓库当前计数（纪律：测试不依赖仓库现状）。
 */
import { describe, expect, it } from 'vitest'
import {
  classifyTimelineEdges,
  extractSpecifiers,
  resolveSpecifier,
  timelineIsolationSelfTest,
} from '../../../scripts/lib/timeline-isolation.mjs'

describe('判据 26 · 影子内核隔离检测器', () => {
  it('自证通过', () => {
    expect(timelineIsolationSelfTest().ok).toBe(true)
  })

  it('说明符提取：多行 import type / export from / 动态 import / 副作用 import 都抓到，注释里的不算', () => {
    const src = [
      "import type {",
      "  A,",
      "} from '@/core/timeline/types'",
      "export { b } from './x'",
      "const m = await import('@/core/timeline/stunTrack')",
      "import '@/core/timeline/side'",
      "// import z from '@/core/timeline/fake'",
      "/* import w from '@/core/timeline/fake2' */",
    ].join('\n')
    expect(extractSpecifiers(src).sort()).toEqual(['./x', '@/core/timeline/side', '@/core/timeline/stunTrack', '@/core/timeline/types'])
  })

  it('路径解析：别名与相对路径都归一到仓库相对路径', () => {
    expect(resolveSpecifier('src/core/a.ts', './timeline/stunTrack')).toBe('src/core/timeline/stunTrack')
    expect(resolveSpecifier('src/core/timeline/a.ts', '../../composables/x')).toBe('src/composables/x')
    expect(resolveSpecifier('src/x.ts', '@/core/timeline')).toBe('src/core/timeline')
    expect(resolveSpecifier('src/x.ts', 'vue')).toBe('vue')
  })

  it('入边：任何非影子文件引用影子内核都算（含类型导入）；影子内部互相引用不算', () => {
    const r = classifyTimelineEdges({
      'src/composables/a.ts': "import type { StunTrackResult } from '@/core/timeline/types'",
      'src/core/timeline/stunTrack.ts': "import type { X } from './types'",
    })
    expect(r.inbound).toEqual([{ file: 'src/composables/a.ts', spec: '@/core/timeline/types' }])
    expect(r.outbound).toEqual([])
  })

  it('出边：影子内核不得依赖编排层、store、录入层、展示层、vue/pinia；@/core、@/types、@/utils 放行', () => {
    const r = classifyTimelineEdges({
      'src/core/timeline/a.ts': [
        "import { ref } from 'vue'",
        "import type { M } from '@/mechanics/types'",
        "import { x } from '../../stores/config'",
        "import { h } from '@/core/resource/helpers'",
        "import type { T } from '@/types/resource'",
        "import { f } from '@/utils/format'",
      ].join('\n'),
    })
    expect(r.outbound.map(e => e.spec)).toEqual(['vue', '@/mechanics/types', '../../stores/config'])
  })
})
