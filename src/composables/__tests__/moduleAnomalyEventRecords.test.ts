/**
 * CC-28 · 模块异常事件记录（原 useResourceCalc `remielleVoidflareEvents` 编排层角色分支 → 蕾米埃尔模块能力
 * `anomalyEventRecords`）。EXPECTED = **迁移前旧实现**在同一 harness 下的输出（2026-09-27 采集，
 * `/home/kaua/calc-arch/cc28-base.json`），逐字段 toEqual ⇒ 迁移逐位等价；这些记录只进展示层，
 * ⚠ CC-100（R5 D15，2026-09-27）更新 r2 / lead-empty / jr 三组：6 号位异常掌控改按源数据百分比口径后，
 *   1331 / 1501 的掌控升高 ⇒ 同战斗时长内多触发 1 次异常 ⇒ 虚耀池 +1、支援技 +1、普攻 +2（终结技按 3 个一批不变）。
 *   归因经反向验证：把 statModes.impact / anomalyMastery 与 31200 2pc 改回 flat，本文件全绿。
 * ⚠ CC-165（第 193 轮）更新 4 组「普通攻击惊鸿·耀变」：6 命惊鸿翻倍改读 FleetingGrace 加成字段且初值 0
 *   ⇒ 0 命 ×1（原 ×2 = 初值 1 与 `1 + x` 叠加的双计），count 减半、字段名与公式文案同步。
 * ⚠ CC-197（第 220 轮）更新 r0 / lead-empty / j0c6 / j2c6 四组（均含爱芮 1501）：爱芮绝对音准直伤行首次产出
 *   （1501007/1501008 以太积蓄）⇒ 爱芮异常触发 10→15（r0）、13→17（lead-empty）⇒ 虚耀池 / 支援技 / 普攻同增、终结技按
 *   3 个一批；简队的爱芮第三段占前台 ⇒ 简强击次数下降 ⇒ 6 命附伤 10→8。归因：删掉 aire.ts 的
 *   `extraNecessaryAction: aireExtraNecessaryActions` 一行即回到旧值。
 * ⚠ **T141（2026-10-12，合轴吸收改「取满容量」+ 闸门常开）**更新 r2 / lead-empty / j0c6 / j2c6 / jempty / jr 六组：
 *   动态合轴吸收从「溢出消除器」（`take = min(溢出, Σ容量)`、且**必须有溢出**才开闸）改为
 *   **「取满容量」**（`solveComboAlignTakeFullCapacity`，`take = r·T`）且**闸门常开**（缺省
 *   `comboAlignAbsorbRatio = 0.4`）⇒ 队友前台被吸收的量变大、腾出的前台回流平A池 ⇒ 主C 平A 时间增加
 *   ⇒ **异常触发次数同向上升**（每个虚耀 = 一次队友异常触发）。
 *   实测（off 口径 `time.stunPlanProjection = 0`，与用例同路径）：
 *   | 组 | 量 | 旧 | 新 |
 *   |---|---|---|---|
 *   | `r2` | 虚耀池（1261:10/1331:12 → 11/13） | 22 | **24** |
 *   | `r2` | 支援技 / 普攻 | 22 | **24** |
 *   | `r2` | 终结技（按 3 个一批） | 21 | **24** |
 *   | `lead-empty` | 虚耀池（1501:17 → 18） | 17 | **18** |
 *   | `lead-empty` | 终结技 | 15 | **18** |
 *   | `j0c6`/`j2c6` | 简 6 命强击附伤（物理强击次数上升） | 8 | **10** |
 *   | `jempty` | 简 6 命强击附伤 | 13 | **14** |
 *   | `jr` | 简 6 命强击附伤 | 11 | **13** |
 *   | `jr` | 虚耀池（1261:11/1331:12 → 13/14） | 23 | **27** |
 *   方向一致（吸收腾出更多平A ⇒ 次数↑），**不是结构性破坏**：`含蕾米/不含蕾米` 的空队判定（`none` = `[]`）、
 *   简 5 命不出事件（`j0c5` = `[]`）、`dmgIds` 序列与槽序都逐位保持。
 *   `r0` 组（显式钉 `stunPlanProjection=0` + 爱芮在队）实测不变 ⇒ 未列入。
 *   归因经 A/B 反证：把 `helpers.ts` 的吸收闸门改回「必须有溢出」再跑本文件即回到全部旧值（`git stash` 可达）。
 * perf dump/rowsnap 覆盖不到，本测试是唯一判据。覆盖：蕾米在槽 0 / 槽 2 / 前导空槽 / 不在队。
 * ⚠ **2026-10-18（用户口径）重采 r0 / jr 两组的三个耀变载体记录**：耀变改为「**每动作结算已储存的全部虚曜**」
 *   （一轮 = 3 豆 = 入场 / 大招 / 长按A 各结算一次），修前是「每个虚曜打一次 × 三个载体全吃整池」。
 *   本次只改了**公式与字段文案**，count 恰好不变（池 27/30 都能被 3 整除，且每轮结算数与载体数相乘得回池大小）；
 *   真正的数值变化在**伤害行**（`extraAnomalyRows` 按本轮实际动作次数封顶，见 `remielle.test.ts`
 *   「用户 2026-10-18 玩法口径」用例）——事件账本这一层与伤害行同构，不再各写一套口径。
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
      "count": 30,
      "formula": "voidflareTotal = Σ perSlotAnomalyTriggers[非蕾米槽位]",
      "fields": [
        "AnomalyPoolResult.perSlotAnomalyTriggers",
        "蕾米槽位",
        "1501:15 / 1561:15"
      ],
      "note": "每个虚耀记录触发队友的攻击/精通/增伤/穿透/抗性区；异化区统一取蕾米面板。"
    },
    {
      "id": "remielle-luminize-assist",
      "type": "luminize",
      "label": "支援技花羽轮舞·耀变",
      "source": "不消耗虚耀（换入时自动发动）",
      // 池 31 ⇒ 轮数 ⌊31/3⌋=10 × 3 = 30
      "count": 30,
      "formula": "count = 轮数 × 已储存虚曜数（每轮换入结算一次，最多 3 个）",
      "fields": [
        "voidflareTotal",
        "rounds=floor(voidflareTotal/3)",
        "storedTotal",
        "1581015 luminizeMultiplier"
      ]
    },
    {
      "id": "remielle-luminize-ultimate",
      "type": "luminize",
      "label": "终结技缭乱终幕·耀变",
      "source": "不消耗虚耀，每轮一次（有大招才结算）",
      "count": 30,
      "formula": "count = 轮数 × 已储存虚曜数；伤害行再按本轮实际大招次数封顶（来源由用户选择1号队友0-3、2号队友3-0）",
      "fields": [
        "voidflareTotal",
        "storedTotal",
        "remielle.drop:{slot}"
      ]
    },
    {
      "id": "remielle-luminize-basic",
      "type": "luminize",
      "label": "普通攻击惊鸿·耀变",
      "source": "消耗并清空虚耀",
      "count": 30,
      "formula": "count = 轮数 × 已储存虚曜数 × 1",
      "fields": [
        "voidflareTotal",
        "storedTotal",
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
      "count": 25,
      "formula": "voidflareTotal = Σ perSlotAnomalyTriggers[非蕾米槽位]",
      "fields": [
        "AnomalyPoolResult.perSlotAnomalyTriggers",
        "蕾米槽位",
        "1261:13 / 1331:12"
      ],
      "note": "每个虚耀记录触发队友的攻击/精通/增伤/穿透/抗性区；异化区统一取蕾米面板。"
    },
    {
      "id": "remielle-luminize-assist",
      "type": "luminize",
      "label": "支援技花羽轮舞·耀变",
      "source": "不消耗虚耀（换入时自动发动）",
      "count": 24,
      "formula": "count = 轮数 × 已储存虚曜数（每轮换入结算一次，最多 3 个）",
      "fields": [
        "voidflareTotal",
        "rounds=floor(voidflareTotal/3)",
        "storedTotal",
        "1581015 luminizeMultiplier"
      ]
    },
    {
      "id": "remielle-luminize-ultimate",
      "type": "luminize",
      "label": "终结技缭乱终幕·耀变",
      "source": "不消耗虚耀，每轮一次（有大招才结算）",
      "count": 24,
      "formula": "count = 轮数 × 已储存虚曜数；伤害行再按本轮实际大招次数封顶（来源由用户选择1号队友0-3、2号队友3-0）",
      "fields": [
        "voidflareTotal",
        "storedTotal",
        "remielle.drop:{slot}"
      ]
    },
    {
      "id": "remielle-luminize-basic",
      "type": "luminize",
      "label": "普通攻击惊鸿·耀变",
      "source": "消耗并清空虚耀",
      "count": 24,
      "formula": "count = 轮数 × 已储存虚曜数 × 1",
      "fields": [
        "voidflareTotal",
        "storedTotal",
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
      "count": 17,
      "formula": "voidflareTotal = Σ perSlotAnomalyTriggers[非蕾米槽位]",
      "fields": [
        "AnomalyPoolResult.perSlotAnomalyTriggers",
        "蕾米槽位",
        ":0 / 1501:17"
      ],
      "note": "每个虚耀记录触发队友的攻击/精通/增伤/穿透/抗性区；异化区统一取蕾米面板。"
    },
    {
      "id": "remielle-luminize-assist",
      "type": "luminize",
      "label": "支援技花羽轮舞·耀变",
      "source": "不消耗虚耀（换入时自动发动）",
      "count": 15,
      "formula": "count = 轮数 × 已储存虚曜数（每轮换入结算一次，最多 3 个）",
      "fields": [
        "voidflareTotal",
        "rounds=floor(voidflareTotal/3)",
        "storedTotal",
        "1581015 luminizeMultiplier"
      ]
    },
    {
      "id": "remielle-luminize-ultimate",
      "type": "luminize",
      "label": "终结技缭乱终幕·耀变",
      "source": "不消耗虚耀，每轮一次（有大招才结算）",
      "count": 15,
      "formula": "count = 轮数 × 已储存虚曜数；伤害行再按本轮实际大招次数封顶（来源由用户选择1号队友0-3、2号队友3-0）",
      "fields": [
        "voidflareTotal",
        "storedTotal",
        "remielle.drop:{slot}"
      ]
    },
    {
      "id": "remielle-luminize-basic",
      "type": "luminize",
      "label": "普通攻击惊鸿·耀变",
      "source": "消耗并清空虚耀",
      "count": 15,
      "formula": "count = 轮数 × 已储存虚曜数 × 1",
      "fields": [
        "voidflareTotal",
        "storedTotal",
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
        /**
         * 2026-10-20 二次归因（实测，取代原「配装推荐主词条」那条）：**C3「进入失衡 20/人」**。
         *
         * 链条：失衡每次每人 +20 喧响（用户裁决「每人」）⇒ 喧响总量↑ ⇒ 终结技次数↑ ⇒
         * 时间账重排 ⇒ **平A 时间 6.14s → 3.87s** ⇒ 物理积蓄 58512 → 57342 ⇒
         * 物理强击次数 −1 ⇒ 简 6 命附伤 13 → 12。
         *
         * 反证（逐提交对齐，j0c6 的 count）：
         *   `24ca73d2`（C3 之前）= 13，`f6f86264`（C3 落地）= 12（此后所有提交都是 12）。
         * 且 pool / cov / rounds / exit 四项改动前后完全相同（2 / 0.1778 / 20 / cycle）
         * ⇒ 差异只可能来自平A时间这条通道。
         *
         * ⚠ **2026-10-21 round 20 再归因（实测）：12 → 13**。
         * 上一段「反证」里那句 **`exit = cycle`** 正是关键：该夹具在 C3 之后一直是**环态**，
         * 12 是**环里某一轮的读数**（不可信，见 §32「环态读数不可信」）。外层环退出改 kStar 结算后
         * 它**真收敛了**（实测 `stable / pool=2`），读到的 13 才是该配置的真实值
         * （= C3 之前的 13 ⇒ C3 那 −1 本来就是环态假象）。
         * 反证：`92908c27`（本改动前）同一夹具实测 `exit=cycle / count=12`；
         * 本改动后 `exit=stable / count=13`，且 `pool=2` 两边相同。
         */
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
        /**
         * 2026-10-20 二次归因（实测，取代原「配装推荐主词条」那条）：**C3「进入失衡 20/人」**。
         *
         * 链条：失衡每次每人 +20 喧响（用户裁决「每人」）⇒ 喧响总量↑ ⇒ 终结技次数↑ ⇒
         * 时间账重排 ⇒ **平A 时间 6.14s → 3.87s** ⇒ 物理积蓄 58512 → 57342 ⇒
         * 物理强击次数 −1 ⇒ 简 6 命附伤 13 → 12。
         *
         * 反证（逐提交对齐，j0c6 的 count）：
         *   `24ca73d2`（C3 之前）= 13，`f6f86264`（C3 落地）= 12（此后所有提交都是 12）。
         * 且 pool / cov / rounds / exit 四项改动前后完全相同（2 / 0.1778 / 20 / cycle）
         * ⇒ 差异只可能来自平A时间这条通道。
         *
         * ⚠ **2026-10-21 round 20 再归因（实测）：12 → 13**（与 `j0c6` 同一件事）。
         * 上一段「反证」里的 `exit = cycle` 正是关键：该夹具在 C3 之后一直是**环态**，
         * 12 是环里某一轮的读数（§32「环态读数不可信」）。环退出改 kStar 结算后它真收敛
         * （`stable / pool=2`），13 才是真实值（= C3 之前的 13）。
         * 反证：`92908c27`（改动前）实测 `exit=cycle / count=12`；改动后 `exit=stable / count=13`。
         */
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
  "jempty": {
    "mod": [
      {
        "id": "jane-c6-assault-followup-event",
        "type": "anomaly_trigger",
        "label": "简6命强击暴击附伤",
        "source": "强击暴击次数",
        // 2026-10-20：配装推荐主词条订正（同上）⇒ 14 → 19
        "count": 19,
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
        // 2026-10-20：配装推荐主词条订正（简 6 号位掌控、蕾米 6 号位攻击）⇒ 11 → 16
        "count": 16,
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
        // 2026-10-20：配装推荐主词条订正 ⇒ 1261 异常触发 11→16 ⇒ 池 23→29
        "count": 29,
        "formula": "voidflareTotal = Σ perSlotAnomalyTriggers[非蕾米槽位]",
        "fields": [
          "AnomalyPoolResult.perSlotAnomalyTriggers",
          "蕾米槽位",
          "1261:16 / 1331:13"
        ],
        "note": "每个虚耀记录触发队友的攻击/精通/增伤/穿透/抗性区；异化区统一取蕾米面板。"
      },
      {
        "id": "remielle-luminize-assist",
        "type": "luminize",
        "label": "支援技花羽轮舞·耀变",
        "source": "不消耗虚耀（换入时自动发动）",
        // 2026-10-20：每轮换入结算一次「已储存的 3 个」（轮数 ⌊29/3⌋=9 × 3 = 27）
        "count": 27,
        "formula": "count = 轮数 × 已储存虚曜数（每轮换入结算一次，最多 3 个）",
        "fields": [
          "voidflareTotal",
          "rounds=floor(voidflareTotal/3)",
          "storedTotal",
          "1581015 luminizeMultiplier"
        ]
      },
      {
        "id": "remielle-luminize-ultimate",
        "type": "luminize",
        "label": "终结技缭乱终幕·耀变",
        "source": "不消耗虚耀，每轮一次（有大招才结算）",
        "count": 27,
        "formula": "count = 轮数 × 已储存虚曜数；伤害行再按本轮实际大招次数封顶（来源由用户选择1号队友0-3、2号队友3-0）",
        "fields": [
          "voidflareTotal",
          "storedTotal",
          "remielle.drop:{slot}"
        ]
      },
      {
        "id": "remielle-luminize-basic",
        "type": "luminize",
        "label": "普通攻击惊鸿·耀变",
        "source": "消耗并清空虚耀",
        "count": 27,
        "formula": "count = 轮数 × 已储存虚曜数 × 1",
        "fields": [
          "voidflareTotal",
          "storedTotal",
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
