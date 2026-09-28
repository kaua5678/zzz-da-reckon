/**
 * CC-28 · 模块异常事件记录（原 useResourceCalc `remielleVoidflareEvents` 编排层角色分支 → 蕾米埃尔模块能力
 * `anomalyEventRecords`）。EXPECTED = **迁移前旧实现**在同一 harness 下的输出（2026-09-27 采集，
 * `/home/kaua/calc-arch/cc28-base.json`），逐字段 toEqual ⇒ 迁移逐位等价；这些记录只进展示层，
 * ⚠ CC-100（R5 D15，2026-09-27）更新 r2 / lead-empty / jr 三组：6 号位异常掌控改按源数据百分比口径后，
 *   1331 / 1501 的掌控升高 ⇒ 同战斗时长内多触发 1 次异常 ⇒ 虚耀池 +1、支援技 +1、普攻 +2（终结技按 3 个一批不变）。
 *   归因经反向验证：把 statModes.impact / anomalyMastery 与 31200 2pc 改回 flat，本文件全绿。
 * ⚠ CC-165（第 193 轮）更新 4 组「普通攻击惊鸿·耀变」：6 命惊鸿翻倍改读 FleetingGrace 加成字段且初值 0
 *   ⇒ 0 命 ×1（原 ×2 = 初值 1 与 `1 + x` 叠加的双计），count 减半、字段名与公式文案同步。
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
      "count": 24,
      "formula": "count = voidflareTotal × 1",
      "fields": [
        "voidflareTotal",
        "remielleCinema6FleetingGraceVoidflareTriggerMultiplier",
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
      "count": 22,
      "formula": "voidflareTotal = Σ perSlotAnomalyTriggers[非蕾米槽位]",
      "fields": [
        "AnomalyPoolResult.perSlotAnomalyTriggers",
        "蕾米槽位",
        "1261:10 / 1331:12"
      ],
      "note": "每个虚耀记录触发队友的攻击/精通/增伤/穿透/抗性区；异化区统一取蕾米面板。"
    },
    {
      "id": "remielle-luminize-assist",
      "type": "luminize",
      "label": "支援技花羽轮舞·耀变",
      "source": "不消耗虚耀",
      "count": 22,
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
      "count": 22,
      "formula": "count = voidflareTotal × 1",
      "fields": [
        "voidflareTotal",
        "remielleCinema6FleetingGraceVoidflareTriggerMultiplier",
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
      "count": 13,
      "formula": "voidflareTotal = Σ perSlotAnomalyTriggers[非蕾米槽位]",
      "fields": [
        "AnomalyPoolResult.perSlotAnomalyTriggers",
        "蕾米槽位",
        ":0 / 1501:13"
      ],
      "note": "每个虚耀记录触发队友的攻击/精通/增伤/穿透/抗性区；异化区统一取蕾米面板。"
    },
    {
      "id": "remielle-luminize-assist",
      "type": "luminize",
      "label": "支援技花羽轮舞·耀变",
      "source": "不消耗虚耀",
      "count": 13,
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
      "count": 13,
      "formula": "count = voidflareTotal × 1",
      "fields": [
        "voidflareTotal",
        "remielleCinema6FleetingGraceVoidflareTriggerMultiplier",
        "1581008 luminizeMultiplier"
      ]
    }
  ],
  "none": []
}

describe('CC-28 moduleAnomalyEventRecords（迁移前后逐字段等价）', () => {
  for (const [key, team] of Object.entries(TEAMS)) {
    it(key, async () => {
      const { config } = await setupHarness(team as never, { recommendedBuild: true })
      // CC-152 逐用例钉：EXPECTED.r0 为 off 快照
      if (key === 'r0') config.setMechanicSetting('time.stunPlanProjection', 0)
      const calc = useResourceCalc()
      expect(calc.moduleAnomalyEventRecords.value).toEqual(EXPECTED[key])
    }, 60000)
  }
  it('负控：含蕾米的队伍确实产出非空记录（EXPECTED 不是空壳）', () => {
    expect((EXPECTED['r0'] as unknown[]).length).toBeGreaterThan(0)
    expect((EXPECTED['lead-empty'] as unknown[]).length).toBeGreaterThan(0)
  })
})

/**
 * CC-29 · 简 6 命强击暴击附伤事件（原 `anomalyDamageEvents` 末尾按身份 `['1261']` 的分支 → jane 模块
 * `anomalyEventRecords`）。EXPECTED29 由**迁移前旧实现**输出（2026-09-27 采集，`/home/kaua/calc-arch/cc29-base.json`）
 * 机械变换而来：jane 事件从 `anomalyDamageEvents` 末尾挪进 `moduleAnomalyEventRecords`（按槽位序拼接），
 * 其余字段逐位不变；`anomalyDamageEvents` 的 id 序列 = 旧序列去掉该事件。覆盖：简 6 命槽 0 / 槽 2 / 前导空槽、
 * 5 命（不出）、简+蕾米同队（拼接顺序）。
 */
const TEAMS29: Record<string, unknown[]> = {
  'j0c6': [{ agentId: '1261', cinemaLevel: 6 }, { agentId: '1331' }, { agentId: '1501' }],
  'j2c6': [{ agentId: '1501' }, { agentId: '1331' }, { agentId: '1261', cinemaLevel: 6 }],
  'jempty': ['', { agentId: '1331' }, { agentId: '1261', cinemaLevel: 6 }],
  'j0c5': [{ agentId: '1261', cinemaLevel: 5 }, { agentId: '1331' }, { agentId: '1501' }],
  'jr': [{ agentId: '1261', cinemaLevel: 6 }, { agentId: '1331' }, { agentId: '1581' }]
}

const EXPECTED29: Record<string, { mod: unknown[]; dmgIds: string[] }> = {
  "j0c6": {
    "mod": [
      {
        "id": "jane-c6-assault-followup-event",
        "type": "anomaly_trigger",
        "label": "简6命强击暴击附伤",
        "source": "强击暴击次数",
        "count": 10,
        "formula": "count = 物理强击次数 × 强击暴击率；伤害 = 简异常精通 × 1600%",
        "fields": [
          "强击次数",
          "assaultCritRate",
          "anomalyProficiency"
        ]
      }
    ],
    "dmgIds": [
      "anomaly-damage-event-physical",
      "anomaly-damage-event-ether"
    ]
  },
  "j2c6": {
    "mod": [
      {
        "id": "jane-c6-assault-followup-event",
        "type": "anomaly_trigger",
        "label": "简6命强击暴击附伤",
        "source": "强击暴击次数",
        "count": 10,
        "formula": "count = 物理强击次数 × 强击暴击率；伤害 = 简异常精通 × 1600%",
        "fields": [
          "强击次数",
          "assaultCritRate",
          "anomalyProficiency"
        ]
      }
    ],
    "dmgIds": [
      "anomaly-damage-event-ether",
      "anomaly-damage-event-physical"
    ]
  },
  "jempty": {
    "mod": [
      {
        "id": "jane-c6-assault-followup-event",
        "type": "anomaly_trigger",
        "label": "简6命强击暴击附伤",
        "source": "强击暴击次数",
        "count": 13,
        "formula": "count = 物理强击次数 × 强击暴击率；伤害 = 简异常精通 × 1600%",
        "fields": [
          "强击次数",
          "assaultCritRate",
          "anomalyProficiency"
        ]
      }
    ],
    "dmgIds": [
      "anomaly-damage-event-ether",
      "anomaly-damage-event-physical"
    ]
  },
  "j0c5": {
    "mod": [],
    "dmgIds": [
      "anomaly-damage-event-physical",
      "anomaly-damage-event-ether"
    ]
  },
  "jr": {
    "mod": [
      {
        "id": "jane-c6-assault-followup-event",
        "type": "anomaly_trigger",
        "label": "简6命强击暴击附伤",
        "source": "强击暴击次数",
        "count": 11,
        "formula": "count = 物理强击次数 × 强击暴击率；伤害 = 简异常精通 × 1600%",
        "fields": [
          "强击次数",
          "assaultCritRate",
          "anomalyProficiency"
        ]
      },
      {
        "id": "remielle-voidflare-pool",
        "type": "luminize",
        "label": "蕾米虚耀池",
        "source": "其他队友异常触发",
        "count": 23,
        "formula": "voidflareTotal = Σ perSlotAnomalyTriggers[非蕾米槽位]",
        "fields": [
          "AnomalyPoolResult.perSlotAnomalyTriggers",
          "蕾米槽位",
          "1261:11 / 1331:12"
        ],
        "note": "每个虚耀记录触发队友的攻击/精通/增伤/穿透/抗性区；异化区统一取蕾米面板。"
      },
      {
        "id": "remielle-luminize-assist",
        "type": "luminize",
        "label": "支援技花羽轮舞·耀变",
        "source": "不消耗虚耀",
        "count": 23,
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
        "count": 23,
        "formula": "count = voidflareTotal × 1",
        "fields": [
          "voidflareTotal",
          "remielleCinema6FleetingGraceVoidflareTriggerMultiplier",
          "1581008 luminizeMultiplier"
        ]
      }
    ],
    "dmgIds": [
      "anomaly-damage-event-physical",
      "anomaly-damage-event-ether"
    ]
  }
}

describe('CC-29 简 6 命事件迁 anomalyEventRecords（迁移前后逐字段等价）', () => {
  for (const [key, team] of Object.entries(TEAMS29)) {
    it(key, async () => {
      await setupHarness(team as never, { recommendedBuild: true })
      const calc = useResourceCalc()
      expect(calc.moduleAnomalyEventRecords.value).toEqual(EXPECTED29[key].mod)
      expect(calc.anomalyDamageEvents.value.map(e => e.id)).toEqual(EXPECTED29[key].dmgIds)
    }, 60000)
  }
  it('负控：6 命队确实出简事件、5 命不出', () => {
    expect(EXPECTED29['j0c6'].mod.length).toBe(1)
    expect(EXPECTED29['j0c5'].mod.length).toBe(0)
  })
})
