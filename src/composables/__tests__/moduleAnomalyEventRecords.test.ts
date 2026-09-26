/**
 * CC-28 · 模块异常事件记录（原 useResourceCalc `remielleVoidflareEvents` 编排层角色分支 → 蕾米埃尔模块能力
 * `anomalyEventRecords`）。EXPECTED = **迁移前旧实现**在同一 harness 下的输出（2026-09-27 采集，
 * `/home/kaua/calc-arch/cc28-base.json`），逐字段 toEqual ⇒ 迁移逐位等价；这些记录只进展示层，
 * perf dump/rowsnap 覆盖不到，本测试是唯一判据。覆盖：蕾米在槽 0 / 槽 2 / 前导空槽 / 不在队。
 */
import { describe, it, expect } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'

const TEAMS: Record<string, unknown[]> = {
  'r0': [{ agentId: '1581' }, { agentId: '1501' }, { agentId: '1561' }],
  'r2': [{ agentId: '1261' }, { agentId: '1331' }, { agentId: '1581' }],
  'lead-empty': ['', { agentId: '1501' }, { agentId: '1581' }],
  'none': [{ agentId: '1261' }, { agentId: '1331' }, { agentId: '1501' }],
}

const EXPECTED: Record<string, unknown[]> = {
  "r0": [
    {
      "id": "remielle-voidflare-pool",
      "type": "luminize",
      "label": "蕾米虚耀池",
      "source": "其他队友异常触发",
      "count": 24,
      "formula": "voidflareTotal = Σ perSlotAnomalyTriggers[非蕾米槽位]",
      "fields": [
        "AnomalyPoolResult.perSlotAnomalyTriggers",
        "蕾米槽位",
        "1501:10 / 1561:14"
      ],
      "note": "每个虚耀记录触发队友的攻击/精通/增伤/穿透/抗性区；异化区统一取蕾米面板。"
    },
    {
      "id": "remielle-luminize-assist",
      "type": "luminize",
      "label": "支援技花羽轮舞·耀变",
      "source": "不消耗虚耀",
      "count": 24,
      "formula": "count = 虚耀池总数；每个虚耀打一次",
      "fields": [
        "voidflareTotal",
        "1581015 luminizeMultiplier"
      ]
    },
    {
      "id": "remielle-luminize-ultimate",
      "type": "luminize",
      "label": "终结技缭乱终幕·耀变",
      "source": "不消耗虚耀，按3个一批",
      "count": 24,
      "formula": "count = floor(voidflareTotal / 3) × 3；来源由用户选择1号队友0-3、2号队友3-0",
      "fields": [
        "voidflareTotal",
        "qBatches",
        "remielle.q:{slot}"
      ]
    },
    {
      "id": "remielle-luminize-basic",
      "type": "luminize",
      "label": "普通攻击惊鸿·耀变",
      "source": "消耗并清空虚耀",
      "count": 48,
      "formula": "count = voidflareTotal × 2（6命翻倍）",
      "fields": [
        "voidflareTotal",
        "remielleCinema6LuminizeTriggerMultiplier",
        "1581008 luminizeMultiplier"
      ]
    }
  ],
  "r2": [
    {
      "id": "remielle-voidflare-pool",
      "type": "luminize",
      "label": "蕾米虚耀池",
      "source": "其他队友异常触发",
      "count": 21,
      "formula": "voidflareTotal = Σ perSlotAnomalyTriggers[非蕾米槽位]",
      "fields": [
        "AnomalyPoolResult.perSlotAnomalyTriggers",
        "蕾米槽位",
        "1261:10 / 1331:11"
      ],
      "note": "每个虚耀记录触发队友的攻击/精通/增伤/穿透/抗性区；异化区统一取蕾米面板。"
    },
    {
      "id": "remielle-luminize-assist",
      "type": "luminize",
      "label": "支援技花羽轮舞·耀变",
      "source": "不消耗虚耀",
      "count": 21,
      "formula": "count = 虚耀池总数；每个虚耀打一次",
      "fields": [
        "voidflareTotal",
        "1581015 luminizeMultiplier"
      ]
    },
    {
      "id": "remielle-luminize-ultimate",
      "type": "luminize",
      "label": "终结技缭乱终幕·耀变",
      "source": "不消耗虚耀，按3个一批",
      "count": 21,
      "formula": "count = floor(voidflareTotal / 3) × 3；来源由用户选择1号队友0-3、2号队友3-0",
      "fields": [
        "voidflareTotal",
        "qBatches",
        "remielle.q:{slot}"
      ]
    },
    {
      "id": "remielle-luminize-basic",
      "type": "luminize",
      "label": "普通攻击惊鸿·耀变",
      "source": "消耗并清空虚耀",
      "count": 42,
      "formula": "count = voidflareTotal × 2（6命翻倍）",
      "fields": [
        "voidflareTotal",
        "remielleCinema6LuminizeTriggerMultiplier",
        "1581008 luminizeMultiplier"
      ]
    }
  ],
  "lead-empty": [
    {
      "id": "remielle-voidflare-pool",
      "type": "luminize",
      "label": "蕾米虚耀池",
      "source": "其他队友异常触发",
      "count": 12,
      "formula": "voidflareTotal = Σ perSlotAnomalyTriggers[非蕾米槽位]",
      "fields": [
        "AnomalyPoolResult.perSlotAnomalyTriggers",
        "蕾米槽位",
        ":0 / 1501:12"
      ],
      "note": "每个虚耀记录触发队友的攻击/精通/增伤/穿透/抗性区；异化区统一取蕾米面板。"
    },
    {
      "id": "remielle-luminize-assist",
      "type": "luminize",
      "label": "支援技花羽轮舞·耀变",
      "source": "不消耗虚耀",
      "count": 12,
      "formula": "count = 虚耀池总数；每个虚耀打一次",
      "fields": [
        "voidflareTotal",
        "1581015 luminizeMultiplier"
      ]
    },
    {
      "id": "remielle-luminize-ultimate",
      "type": "luminize",
      "label": "终结技缭乱终幕·耀变",
      "source": "不消耗虚耀，按3个一批",
      "count": 12,
      "formula": "count = floor(voidflareTotal / 3) × 3；来源由用户选择1号队友0-3、2号队友3-0",
      "fields": [
        "voidflareTotal",
        "qBatches",
        "remielle.q:{slot}"
      ]
    },
    {
      "id": "remielle-luminize-basic",
      "type": "luminize",
      "label": "普通攻击惊鸿·耀变",
      "source": "消耗并清空虚耀",
      "count": 24,
      "formula": "count = voidflareTotal × 2（6命翻倍）",
      "fields": [
        "voidflareTotal",
        "remielleCinema6LuminizeTriggerMultiplier",
        "1581008 luminizeMultiplier"
      ]
    }
  ],
  "none": []
}

describe('CC-28 moduleAnomalyEventRecords（迁移前后逐字段等价）', () => {
  for (const [key, team] of Object.entries(TEAMS)) {
    it(key, async () => {
      await setupHarness(team as never, { recommendedBuild: true })
      const calc = useResourceCalc()
      expect(calc.moduleAnomalyEventRecords.value).toEqual(EXPECTED[key])
    }, 60000)
  }
  it('负控：含蕾米的队伍确实产出非空记录（EXPECTED 不是空壳）', () => {
    expect((EXPECTED['r0'] as unknown[]).length).toBeGreaterThan(0)
    expect((EXPECTED['lead-empty'] as unknown[]).length).toBeGreaterThan(0)
  })
})
