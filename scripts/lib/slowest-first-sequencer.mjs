import { BaseSequencer } from 'vitest/node'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * **按实测耗时降序排文件**（LPT，Longest Processing Time first）。
 *
 * ## 为什么（2026-11-04 实测，本轮唯一「纯调度」浪费）
 *
 * vitest 只做**文件级**并行：worker 领活的顺序 = sequencer 给的顺序。
 * `BaseSequencer` 的默认序来自文件发现顺序（≈ 目录遍历），与耗时无关
 * ⇒ 长文件被排到后面，最后只剩少数 worker 在跑长尾，其余空转。
 *
 * 实测（core 环，619 文件 / CPU 773s / 8 workers）：
 * - 默认序：墙钟 **164.4s**
 * - CPU / workers = **97s**（理论下界）
 * - 按耗时降序（LPT）：模拟 **97s** ⇒ 白扔了 **68s（41%）**
 *
 * ## 为什么不引入新事实源
 *
 * 排序键 = `scripts/lib/test-durations.json`（与三环清单同一份数据）。没测过的文件按 0 排最后
 * ——**排序不影响跑什么**，只影响先跑谁，所以未测到的排后面是安全的。
 *
 * ⚠ **不改断言、不改选择面、不改并发度**：只改「同样的文件按什么顺序交给 worker」。
 * 判据：`src/scripts/__tests__/testSequencer.test.ts`（降序 / 未知排后 / 一个不丢 / 稳定）。
 */
// 本文件在 scripts/lib/ ⇒ 仓库根要上溯三级（scripts/lib → scripts → 根）
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

function loadDurations() {
  try {
    const doc = JSON.parse(readFileSync(join(ROOT, 'scripts', 'lib', 'test-durations.json'), 'utf8'))
    return doc.entries ?? {}
  } catch {
    return {}
  }
}

export default class SlowestFirstSequencer extends BaseSequencer {
  async sort(files) {
    // 逃生口：VITEST_SEQUENCER=off 时退回文件发现顺序（A/B 对照与「怀疑排序造成长尾」时用）
    if (process.env.VITEST_SEQUENCER === 'off') return files
    const durations = loadDurations()
    const secondsOf = (spec) => {
      const name = String(spec.moduleId ?? spec.taskId ?? '').split('/').pop()
      return durations[name] ?? 0
    }
    // 稳定排序：耗时降序，同耗时按原来的相对顺序（否则同一套测试每次跑出不同的长尾）
    return files
      .map((spec, i) => ({ spec, i, seconds: secondsOf(spec) }))
      .sort((a, b) => b.seconds - a.seconds || a.i - b.i)
      .map(x => x.spec)
  }
}
