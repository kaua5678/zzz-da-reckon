# 交接提示词 ②：平A 填充 / 留白专项

> 用途：直接粘给新对话作为任务 brief。
> 背景：2026-10-21 把交互默认全 0 之后，`auto-1091-1031-1311` 的留白从 21.1s 涨到 **33.6s**，
> 破了 `timeFillRatchet` 的「留白 ≤ 30s」**绝对不变量**。用户口径：
> 「**留白正常情况是 0**，你这个平a怎么没有自动填充呢。不止这个队，其他所有空白队都应该自动填充。」

---

## 任务

让「平A 池自动填满剩余时间」真正生效 —— 目标是把全库留白压到 0（或解释清为什么某些留白是物理必然）。

## 一、已知事实（都已实测，不用重查）

### 1. 现状读数（`auto-1091-1031-1311`）

| 状态 | slack（留白） | pool | 伤害 |
|---|---|---|---|
| 交互 6/10（改动前默认） | 21.1s | 2 | 48.8M |
| 交互 0（改动后） | **33.6s** | 1 | 46.2M |

### 2. 该队的分配细节（交互 0 时）

```
weights = 1/0/0
s0[1091] nec=87.6  basic=92.4  front=176.6  back=3.4
s1[1031] nec=16.9  basic=0.0   front=16.9
s2[1311] nec=2.2   basic=0.0   front=2.2
Σnec=106.7  Σbasic=92.4  Σ=199.1 / 180
```

- `s0` 的 `front = 176.6`，**距 180 差 3.4s** —— 平A 本可以再给 3.4s 却没给。
- `s1`/`s2` 的 `weight = 0`（不接平A）。
- `Σ所有物化行 = 195.7s`（超预算 15.7s），但 `netFrontlineOccupation = 149.1`
  （扣掉轴内合轴分摊 46.6s）⇒ `slack = 180 − 149.1 = 30.9s`。

### 3. 已试过并**回退**的修法（别再走）

改 `src/core/resource/helpers.ts:828`：

```ts
// 原（正确）
const headroom = Math.max(0, totalTime - totalNecessary[i]) - basicAlloc[i]
// 试过（错）
const headroom = Math.max(0, totalTime - cappedNecessary[i]) - basicAlloc[i]
```

**假设**：「写进 state 的是 capped，headroom 却用 total ⇒ 分不出去 ⇒ 留白」。
**实测证伪**：`totalNecessary` 含 `cfg.timeBudgetExcess`（折叠残差，见 `helpers.ts:562`），
它**比 capped 大** ⇒ 改 capped 让 headroom 变大、平A 分得更多 ⇒ 更差。
实测留白 30.9s → **33.6s**。已在注释里留痕（`helpers.ts:817` 附近）。

## 二、要查的方向（按可能性排序）

### 方向 A：`netFrontlineOccupation` 的合轴分摊是否扣多了

`net = Σ前台行 − min(Σ前台行, 该槽轴内合轴分摊)`。
若某槽的 `slotOverlap` 被高估，`net` 就偏小 ⇒ 误报留白。
- 检查 `frontlineOccupationBreakdown`（`src/core/resource/timeOccupation.ts:97`）
- 对 1091 打印逐槽 `rowNet` / `slotOverlap` / `net`

### 方向 B：`weight = 0` 的槽为什么不接平A

`s1`/`s2` 的 `weight = 0`，而 `s0` 贴顶后池还有剩 ⇒ 留白。
- 检查 `effectiveWeights` 的兜底（`helpers.ts:795` 附近）：
  只有「**全队权重皆 0**」时才让 slot0 独享，**部分为 0 时不兜底**。
- 问题：`s0` 贴顶后，`s1`/`s2` 明明有余量（`back = 163.1 / 177.8`）却不接。
- **这可能就是「平A没自动填充」的真因**：水填法只在 `effectiveWeights[i] > 0` 的槽之间分配。

### 方向 C：交互归零后 pool 掉到 1，失衡时间少 ⇒ nec 变小 ⇒ 平A池变大但没人接

- 交互 0 → `pool = 1`；交互 6/10 → `pool = 2`。
- `nec` 变小 ⇒ `availableBasicTime` 变大 ⇒ 但 `s0` 已贴顶、`s1`/`s2` 不接 ⇒ 留白。
- 这是**交互归零的连带效应**，不是平A机制的 bug。

### 方向 D：其他留白队是否同一根因

`grep` 全库 `slack > 1` 的队，看是否都是「只有 slot0 有权重」的形态。

## 三、执行步骤

```bash
# 1. 先复现
npx vitest run src/composables/__tests__/timeFillRatchet.test.ts 2>&1 | grep -A5 '绝对不变量被破'

# 2. 打印该队的逐槽明细（探针模板见下）
# 3. 按方向 A→B→C 逐个验证
# 4. 找到根因后，A/B 量化「修前 vs 修后」的全库留白
```

探针模板（可直接复制到 `src/zzprobeXXX.probe.test.ts`）：

```ts
import { describe, it } from 'vitest'
import { setupHarness } from '@/test/harness'
import { useResourceCalc } from '@/composables/useResourceCalc'
import { buildTeamTimeSummary } from '@/composables/teamTimeSummary'
import { useConfigStore } from '@/stores/config'
import { teamPresets } from '@/data/teamPresets'

describe('p', () => {
  it('probe', async () => {
    const preset = teamPresets.find(p => p.id === 'auto-1091-1031-1311')!
    const { catalog, config } = await setupHarness(['', '', ''])
    await catalog.loadBuildRecommendations()
    for (let i = 0; i < 3; i++) config.setAgent(i, preset.team[i])
    config.applyTeamPreset(preset.team as [string, string, string])
    const calc = useResourceCalc()
    const rr: any = calc.resourceResult.value!
    const t = buildTeamTimeSummary({ rr, battleTime: rr.totalTime, invincibleTime: config.enemy.invincibleTime ?? 0, nameOf: (_a: string, s: number) => 's' + s })
    console.log('slack=' + t.slack.toFixed(1) + ' rowsNet=' + t.rowsNet.toFixed(1) + ' budget=' + t.budget)
    for (const c of rr.characters) {
      console.log('  s' + c.slot + ' nec=' + c.timeAllocation.necessaryTime.toFixed(1)
        + ' basic=' + c.timeAllocation.basicAttackTime.toFixed(1)
        + ' front=' + c.timeAllocation.frontlineTime.toFixed(1)
        + ' weight=' + (config.team[c.slot] as any)?.basicAttackTimeWeight)
    }
  }, 900_000)
})
```

## 四、验收

- [ ] 找到留白的**确切根因**（不是「大概因为交互少了」，要指到具体那行代码）
- [ ] 给出修法 + A/B 数据（全库 `slack > 1` 的队数：修前 / 修后）
- [ ] `timeFillRatchet` 的「绝对不变量」转绿（**不允许**靠调地板值绕过 —— 那是绝对不变量）
- [ ] 若某些留白是物理必然（如该槽确实没东西可打），在测试里逐队标注理由

## 五、注意事项

1. **不要为了转绿去调 `ABS_FLOOR`（30s）** —— 注释明写「绝对不变量……不能靠重生成基线绕过」。
2. **改 `helpers.ts` 的分配逻辑前，先跑 `timeGolden`** 看全库影响面。
3. **交互全 0 是用户新裁决（`13b9f584`）**，不要回退它来让留白变小。
4. 相关文档：`docs/STUN_CONTINUOUS_LASTWINDOW.md` §45（本轮排查记录）。

