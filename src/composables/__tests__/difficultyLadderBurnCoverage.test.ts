/**
 * 「② 烧吸收」分片判据的**覆盖完全性**（T182，2026-10-18）。
 *
 * 分片把一条 592s 的全库用例拆成 4 个文件（判据本体见 `src/test/ladderBurnShard.ts`），
 * 于是出现一个只有分片才有的失效模式：**某支队谁都不跑**（分片数改了但文件没加、取模写错、
 * 预设被过滤掉）。本条用纯静态断言把那个洞堵上：
 *
 * ① **并集 == 全库**（3 槽预设逐队都被某一片认领）；
 * ② **两两互斥**（没有队被跑两遍 ⇒ 否则分片不省时间，且违例会重复报）；
 * ③ **每片非空**（分片数 > 队数时会有空片 ⇒ 空 `it` 是假绿）；
 * ④ **见证队**（分片前那条用例的 `burning > 0` 非平凡性断言搬到这里，全局验一次）：
 *    全库确实有队「② 落在 r>0」，否则「吸收确实必要」整条判据退化成空转。
 *
 * 本文件**不跑引擎**（纯数组运算），耗时 ~0s；引擎面由 4 个分片文件各自承担。
 */
import { describe, expect, it } from 'vitest'
import { teamPresets } from '@/data/teamPresets'
import { LADDER_BURN_SHARD_COUNT, burnCheckPresets, burnCheckShard } from '@/test/ladderBurnShard'

describe('② 的落点分片：覆盖完全性', () => {
  it('① 并集 == 全库（3 槽预设逐队都被某一片认领）', () => {
    const all = burnCheckPresets().map(p => p.id).sort()
    const claimed = Array.from({ length: LADDER_BURN_SHARD_COUNT }, (_, k) => burnCheckShard(k))
      .flat().map(p => p.id).sort()
    expect(claimed, '分片并集必须逐队等于全库（否则有队谁都没跑）').toEqual(all)
  })

  it('② 两两互斥（没有队被跑两遍）', () => {
    const seen = new Map<string, number>()
    for (let k = 0; k < LADDER_BURN_SHARD_COUNT; k++) {
      for (const p of burnCheckShard(k)) {
        const prev = seen.get(p.id)
        expect(prev, `${p.id} 同时落在分片 ${prev} 与 ${k}`).toBeUndefined()
        seen.set(p.id, k)
      }
    }
    expect(seen.size).toBe(burnCheckPresets().length)
  })

  it('③ 每片非空（空片 = 假绿）', () => {
    for (let k = 0; k < LADDER_BURN_SHARD_COUNT; k++) {
      expect(burnCheckShard(k).length, `分片 ${k} 为空（分片数 > 队数 ⇒ 该片 it 空跑）`).toBeGreaterThan(0)
    }
  })

  it('④ 分片号越界即抛（防「分片号写错 ⇒ 静默跑全库两遍」）', () => {
    expect(() => burnCheckShard(LADDER_BURN_SHARD_COUNT)).toThrow()
    expect(() => burnCheckShard(-1)).toThrow()
    expect(() => burnCheckShard(0.5)).toThrow()
  })

  it('⑤ 分片数 ≤ 全库队数（否则必然有空片）', () => {
    expect(LADDER_BURN_SHARD_COUNT, '分片数不得超过 3 槽预设总数').toBeLessThanOrEqual(teamPresets.length)
  })
})
