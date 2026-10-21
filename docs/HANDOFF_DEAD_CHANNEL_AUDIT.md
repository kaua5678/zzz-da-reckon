# 交接提示词 ①：死口径专项排查

> 用途：直接粘给新对话作为任务 brief。
> 背景：2026-10-21 排查比利「格挡 +5 决意」时发现**注释声明了收益通道、代码从未实现**，
> 且这条死口径藏了很久没人发现。本仓已知至少还有同类，需要系统排查。

---

## 任务

找出仓库里所有「**注释/文档/@fact 声明了某收益通道，但代码没有实现**」的死口径，逐条列出并处置。

## 一、判据（怎么机械识别）

一条口径算「死口径」需同时满足：

1. **声明存在**：在下列任一位置出现「X 会给 Y」「X 计入 Y」「X 回复 Y」这类断言：
   - 模块头注释（`src/mechanics/agents/*.ts` 顶部战斗逻辑说明）
   - `@fact` 行
   - `interactionInputs` / `resourceSections` 等展示层声明的 label
2. **实现缺失**：`grep` 该通道对应的字段名，**在计算路径上找不到消费点**。
   注意区分：
   - ✅ 真实现：字段出现在某个 `compute*` 函数的**入参或读取处**
   - ❌ 假实现：字段只出现在
     * 类型定义
     * 默认值赋值（如 `if (!cfg.blockCount) cfg.blockCount = X`）
     * 展示层 label / 注释本身
3. **A/B 可证**：把该字段从 0 调到某个大值，**伤害读数逐位不变**。

## 二、本次已确认的案例（作为模板）

**比利「格挡 +5 决意」**：

| 项 | 内容 |
|---|---|
| 声明位置 | `src/mechanics/agents/starlightBilly.ts:33` 注释「额外回复：……格挡 +5（主页交互 blockCount）」 |
| 展示声明 | `interactionInputs: { block: { label: '格挡（动力压制）' } }` |
| 实现检查 | `computeAttackDataDetermination`（:497）入参只有 `chainCountTotal` / `ultimateCount` / `dodgeCounterCount` / `basicAttackTime` + `parryCount` / `quickAssistCount`，**没有 `blockCount`** |
| A/B 实测 | 格挡 0 / 5 / 10 / 15 四档：星光次数 9/9/9/9、伤害 59.6/60.7/64.4 **逐位相同** |
| 处置 | 已把 `BILLY_INTERACTION_DEFAULTS.block` 改 0，并在注释里标注该通道未实现（提交 `13b9f584`） |
| ⚠ 未做 | **「格挡 +5」这个机制本身要不要补实现**没定 —— 那是玩法口径问题，需问用户 |

## 三、检查范围（按优先级）

1. **所有 `src/mechanics/agents/*.ts` 的模块头「战斗逻辑」段**
   —— 那里通常列了一串「XX 回复 YY」，最密集。
2. **所有 `@fact` 行**（`grep -rn '@fact' src/`）
   —— 每条都声称「口径确认」，但可能只有声明没有实现。
3. **`interactionInputs` / `resourceSections` 的 label**
   —— 标签写着「格挡（动力压制）」暗示有关联，需验证。
4. **`src/data/*.ts` 里带注释的常量**
   —— 如「摇曳链占付费单位比例」这类。

## 四、执行步骤

```bash
# 1. 列出所有候选声明
grep -rn '回复\|计入\|回复量\|gain\|recover' src/mechanics/agents/*.ts | grep -v '^\s*//' | head -50

# 2. 对每条，grep 对应字段在计算路径的出现
grep -rn '<字段名>' src/ --include=*.ts | grep -v '__tests__' | grep -v 'label\|type\|interface'

# 3. 对疑似死口径，写 A/B 探针
#    模板见 src/mechanics/__tests__/billySmoke.test.ts
#    关键：只改该字段 0 → 大值，看 teamTotalDamage 是否变化

# 4. 记录结果
```

## 五、验收

- [ ] 每条候选都标记为「有实现」/「死口径」/「部分实现」，附 `grep` 证据
- [ ] 每条死口径附 A/B 实测数字（改前/改后的伤害）
- [ ] 死口径二选一：**补实现**（需先问用户机制口径）或 **删注释 + 标注未建模**
- [ ] 结果写成表格进 `docs/`，并给后续 agent 留检索入口

## 六、注意事项

1. **不要只看类型定义**：`blockCount?: number` 出现在类型里 ≠ 有实现。
2. **不要只看默认值赋值**：`if (!cfg.blockCount) cfg.blockCount = 5` 只是预填，不是消费。
3. **A/B 探针必须只改一个变量**，否则无法归因。
4. **发现死口径别急着补实现**：那通常是玩法口径问题（如「格挡到底该不该给决意」），
   先问用户，别自己拍。

