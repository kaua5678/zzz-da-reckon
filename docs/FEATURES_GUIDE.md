# 功能手册：Boss 选择 + 预设队伍对比

> 本手册记录两个"决策层"功能的**操作方式**与**修改入口**，防止遗忘。
> 代码口径以脚本/模块头注释为唯一事实来源，本手册是索引与步骤说明。

## 1. Boss 选择界面（属性配置页顶部）

### 1.1 用户操作

1. 打开「属性配置」页 → 顶部「Boss 选择」卡片。**版本 + 危局期数两级下拉**（一期 = 1 困难 + 3 普通，**都是危局强袭战**；防卫战期默认不收，例外见下）。
2. 每期分三区：
   - **困难 · 危局强袭战**：1 个 Boss，可应用
   - **普通 · 危局强袭战**：当期 3 个 Boss，**同样可应用**（预设覆盖全部危局 Boss 共 15 个 + 老防卫战 Boss 彷徨猎手 1 个 = 16 个，用户确认收录）
   - **当期 Buff**：3 张可选牌 + 各 Boss 卡上的**关卡固有 buff**（layer_buff 解析）
3. 应用 Boss 时除填充敌人配置外，**自动把该 Boss 当期关卡固有 buff（layer_buff 数值效果）写入全局 Buff 表**（id 前缀 `layer-buff:`，切 Boss 时先清旧）
3. 一键填充字段：血量 / 失衡值 / 防御 / 等级 / 危局异常系数（`bossAnomalyCoeff`）/ 失衡易伤（`stunVuln`）/ 失衡时间（`stunTime`）/ 三张抗性表 / 战斗时间 180s / 秽盾触发次数 / 能量盾次数。
   **不动的字段**：无敌时间（招式机制只能手填）、快支次数（角色侧）。
4. 底部「全部 Boss」折叠：9 个预设按危局异构/危局阵容分组，点 chip 跳转到该 Boss 最新危局期。
5. 已应用 Boss 卡片高亮；「清除已选」撤销高亮（不影响已填数值）。
6. 期数标注：`(测试服)` 期的 buff 是 (Test1)TBD 占位，等正式服重跑 import 自动更新。

### 1.2 数据管道（加新期数/Boss 时）

```bash
node scripts/fetch-nanoka-bosses.mjs [版本号]   # 幂等；缺省读 manifest 最新版
node scripts/import-nanoka-bosses.mjs           # 生成 public/static/boss-presets.json
```

- 原始数据 → `data/raw/bosses/{summary.json, version.json, zh|en/<期数id>.json, monster/<怪物id>.json}`
- 端点与结构见 `scripts/fetch-nanoka-bosses.mjs` 头注释（boss.json / zh|en/boss/<id>.json / zh/monster/<id>.json）
- **期视图**（`phaseViews`，Boss 选择 UI 的数据源）：每期含 困难 Boss（`criticalAssault`，可应用）/ 普通 3 Boss（`defense`，只读）/ 当期 buff（`buffs`）

### 1.3 修改入口（都在 `scripts/import-nanoka-bosses.mjs`）

| 要改什么 | 改哪里 |
| --- | --- |
| 预设收录哪些 Boss | `CATALOG_MONSTER_MAP`（**危局 Boss**：困难异构 + 普通常规，共 15 个 + 用户确认收录的老防卫战 Boss 彷徨猎手 `30041`；`null` = 无 catalog 条目） |
| 秽盾/能量盾/战斗时间默认值 | `BOSS_DEFAULTS`（**秽盾是触发次数不是血量**：破盾奖励 60 能量 × 次数，名可名 = 1；不要填 3000 那种血量值） |
| 失衡倍率/失衡时间公式 | `loadMonster()`：`(100+stun_damage_taken_ratio/100)/100`、`10000/destroy_recover_rate` |
| 抗性映射 | `toCalcRes()`：怪物 `*_res` 万分比直接 /100（**游戏绝对值**：弱点 **-20** / 中性 0 / 抗性 +20~+40；引擎公式 `1 - res/100`） |
| 关卡弱点并集/交集 | 危局期数取**跨期交集**（`caWeaknessIntersection`，测试服期数会带错弱点，如 690471 异构·焚昼余火多贴了"风"）；防卫战期数用当期标签 |
| 新增期数版本标签兜底 | `VERSION_FALLBACK`（version.json 未收录的 3.2 期数前缀） |

### 1.4 当期 Buff 解析器（`scripts/phase-buff-parser.mjs`，类型声明 `phase-buff-parser.d.mts`）

- 输入 `selectable_buff` 描述文本 → `{ title, testOnly, effects[], unparsed[] }`
- **口径（用户拍板）**：
  - 失衡易伤 → `stunDmgMultiplierBonus`（与击破角色 buff 同字段，直接加不折算）
  - **锐化伤害 → `sharpDmgBonus`（锋御独立乘区）；贯穿伤害 → `sheerDmgBonus`（命破贯穿增伤区）；锐暴 → `sharpCritDmg`**——三者别混
  - 异常特性 2/3 名 → `cond.anomalyCount: [2名档, 3名档]`，应用时按队伍异常人数选档
  - 强攻/异常等特性限定 → `cond.specialty`，队伍无该特性角色则该条不生效
  - 其余条件效果（施放后持续 X 秒）→ 默认满覆盖，原文保留在 `note`
  - `(Test1)TBD` → `testOnly: true` 不参与推荐；`unparsed` = 未命中规则表的段落（UI 展示原文）
- 规则表在 `RULES`（正则数组，先命中先得；段落内循环删匹配继续解析；按 `。\n;` 分句）
- **两个数据源都走同一解析器**：`selectable_buff`（当期可选牌 3 张）与 `layer_buff`（当期关卡固有 buff，随 Boss 卡展示/应用）
- 新 buff 文案类型解析不了时：加规则到 `RULES`，或把属性名加进 `RANKED_STAT_MAP`（分档）、`STAT_LABELS`（显示名）
- 测试：`src/composables/__tests__/phaseBuffParser.test.ts`（6 条，覆盖分档/限定/多招式/测试服）

### 1.5 已知口径

- `attribute_infliction` = 异常条系数万分比（危局 10 → `bossAnomalyCoeff` 1.1）
- 失衡倍率大多 1.5，**名可名/基塔布鲁·滞变畸兽 = 1.25**；失衡时间大多 12s，**复写体·猎血清道夫/滞变畸兽 ≈ 15.02s**
- 怪物本体精确抗性与期数 `element` 粗编码（1/-1/0）同源；`monster_weakness` 是关卡级标签（随期数变）

## 2. 预设队伍（首页下拉 + 队伍对比页共用）

- **数据源唯一**：`src/data/teamPresets/*.json`（`import.meta.glob` 自动加载，`disabled: true` 跳过）。
- **首页（队伍配置）**：预设队伍是下拉选项（换人 + 自动配装，`applyTeamPreset` 只取 `team` 字段，金数/交互不应用）；队伍多了不拥挤。
  - 下拉旁「预设金数」按钮：弹窗设置当前队伍各槽位影画/精炼（0-6 / 1-5），含加金档位快捷按钮（0命1精 / 212121 / 612121 / 616161 / 656565）与实时「总限定金」显示；应用走 `setCinemaLevel`/`setWEngineModLevel`，只改当前队伍配置，不改预设文件（队伍对比页仍走 `goldSteps`）。总金数口径与对比页一致（`teamCompare.ts` 的 `teamGoldOf`：限定 S 角色/音擎本体各 1 金 + 影画/精炼每级 1 金，常驻不计）。
  - 弹窗内「保存到预设文件」：选择目标预设（默认最近应用的预设）→ 把当前命座/精炼按口径重写为 `goldSteps`（限定角色/音擎步进）+ `standardSteps`（常驻/A 级步进）→ 下载 `<id>.json`（同时复制到剪贴板），手动替换 `src/data/teamPresets/<id>.json` 后刷新生效（浏览器无法直接写项目文件）。阵容与所选预设不一致时有警告；步骤生成逻辑在 `teamCompare.ts` 的 `buildGoldStepsFromConfig`（有单测）。
- **队伍对比页**：同一份数据，多选参与散点对比（金数档位来自 `goldSteps`，横轴难度来自 `interactions`——首页预设这两项为空数组，对比前需补）。
- 新队伍：复制 `_template.json` 改名编辑（删 `disabled`），刷新即加载。

## 3. 预设队伍对比（「队伍对比」Tab）

### 3.1 用户操作

1. 「队伍对比」Tab → **先选期数（全部 Boss 期数并集，新的在前，含老期数）→ 再选该期 Boss**（下拉只列选中期数出现过的 Boss，困难标「（困难）」）→ 预设队伍（多选）+ 限定金区间 + **当期 Buff**（默认「自动推荐（每队取最优）」，可手动指定某张牌）→ 计算。
   - **最优加金（≤12金）**（默认开）：≤12 金不用预设 goldSteps 的排列顺序，逐金贪婪挑伤害提升最大的可用步骤（每金档试算全部「下一个未购级别」）；12 金以上回退预设顺序。勾掉即完全按预设顺序。
2. **最优加金口径**（用户拍板）：候选只来自该预设 `goldSteps` 里写过的级别（尊重作者设定的命座/精炼范围，如只写到 2 命就只在这范围内挑）；`standardSteps` 全量应用（不占金）；每步同场景对比（boss/buff 已应用，只变这一级）；金数预算精确（总金 = 基础金 + 已选步数）。计算量：每金档 × 候选数（≤6）次全量伤害，封顶 12 金内最多 ~48 次/队，比预设顺序慢。
2. 散点图：横轴 = 操作难度（交互加权和），纵轴 = 伤害/血量%（100% = 击杀线，200% = 两倍血量）。
   点颜色 = 队伍、半径 = 金数；hover 显示明细（含 buff 名）；底部明细表（含 Buff 列）+ CSV 导出。
3. **buff 推荐**：自动模式对每个队伍三张可用牌各算一次伤害（用第一个金数档），取最高者作为该队所有点的 buff；手动模式全队用指定牌。测试服牌不参与。

### 3.2 添加预设队伍（高频操作）

1. 复制 `src/data/teamPresets/_template.json` → 同目录改名（如 `miyabi-team.json`）。
2. 删掉 `"disabled": true` 字段，填：

```json
{
  "id": "my-team", "name": "队名",
  "team": ["1561", "1261", "1411"],
  "wEngines": ["", "", ""],                    // 缺省 '' = 自动推荐
  "driveDiscs": [ { "fourPieceSetId": "", "twoPieceSetId": "" } ],
  "goldSteps": [
    { "label": "主C 1命", "slot": 0, "kind": "cinema", "value": 1 },
    { "label": "专武精炼1", "slot": 0, "kind": "wengine", "value": 2 }
  ],
  "interactions": [
    { "type": "parry", "count": 8 },
    { "type": "banyueGoldenParry", "count": 5, "weight": 1.5, "label": "般岳金身弹刀" },
    { "type": "tauntCancel", "count": 2, "slot": 2 }   // 般岳：每次嘲讽取消一次失衡外连段末尾后摇（weight 0，不计难度）
  ],
  "chainCountPerStun": [1, 1, 1]
}
```

3. 刷新页面自动加载（`import.meta.glob`，照 `stunAxisPresets` 模式）。

**口径**：金数 = **总限定金**（用户定义）= 限定 S 角色本体 1 + 限定音擎本体 1 + 影画/精炼每级 1。**常驻 S 角色（莱卡恩/丽娜/猫又/11号/珂蕾妲/格莉丝）与 A 级角色、常驻音擎不计限定金**；例：伊德海莉+莱卡恩+卢西娅全带专武 = 4 金（莱卡恩与拘缚者不计）。选择的目标限定金**越界自动钳制**到队伍档位范围 [基础金, 基础金+goldSteps 数]（大于最高取最高=全步数，小于最低取最低=0 步）；全队 0命1精带专武 = 6 金，212121 = 12 金；应用前 N 步取最大值；
**常驻配置**：预设里 `standardSteps` 数组（与 goldSteps 同构）给常驻角色/非限定音擎设命座与精炼，**不占限定金、默认全量应用**；改该数组后重跑一次对比即可，不在页面里逐档选择。
**加金档位（用户口径，见 `_template.json` note）**：两位 = 一个角色的「影画+精炼」（21 = 2命1精）；下限 4~5 金 → 12 金（212121 = 全队 2命1精）→ 612121（主C 6命1精）→ 616161（全队 6命1精）→ 656565（全队 6命5精，最高档）；
难度 = Σ(count × weight)，权重查 `INTERACTION_WEIGHTS`（`src/types/teamPreset.ts`），条目可覆盖；
内置交互类型 parry/dodge/quickAssist 会映射到对应角色的 `parryCount/dodgeCounterCount/quickAssistCount`（槽位 = `it.slot`，缺省 0），角色专属类型只进难度轴。
**配置类交互 `tauntCancel`（weight 0，不计难度）**：般岳专属——映射到 `tauntCancelCount`（每次嘲讽取消一次失衡外连段末尾后摇）；其余交互照常按难度计入。
**般岳轴模式自动补齐（保底语义，仅轴模式 + 设置 `banyue.autoTopUpInteractions` 开时）**：轴内怒相/终结技对嗔火/喧响有硬性需求，不足时自动抬**双反**（补嗔火 +10/次）与**弹刀**（普通弹刀补喧响 +215/次）；有效次数 = 交互栏输入 + 补齐量（**不覆盖输入**，交互栏显示「弹刀 +N（轴自动）」、资源卡片显示补齐行）。

### 3.3 修改入口

| 要改什么 | 改哪里 |
| --- | --- |
| 交互类型难度权重/中文名 | `src/types/teamPreset.ts` 的 `INTERACTION_WEIGHTS` / `src/composables/teamCompare.ts` 的 `INTERACTION_LABELS` |
| 金数应用 / 难度公式 | `src/composables/teamCompare.ts`：`applyGoldSteps`（目标限定金钳制 + standardSteps 常驻配置）/ `computeDifficulty` / `baseGoldOf`（只算限定 S 角色/音擎，常驻清单 `STANDARD_S_AGENT_IDS`/`STANDARD_S_WENGINE_IDS`） |
| buff 应用/推荐 | 同上 `applyBuffToStore`（写全局 Buff 表）/ `pickBestBuff`（每队三张牌取伤害最高）/ `resolveBuffEffect`（特性限定/异常人数分档，导出供测试） |
| 批量计算管线（含现场快照/恢复） | 同上 `computeTeamComparePoints`（改 configStore → 读 `calc.teamTotalDamage` computed → 收集 → 恢复；快照含 team/enemy/globalBuffs/stunAxes） |
| 最优加金（≤12金贪婪） | 同上 `computeOptimalGoldAllocations`（候选只来自 goldSteps、standardSteps 全量应用、封顶 `GOLD_OPTIMIZE_CAP`=12、同场景对比）；页面对勾 `TeamComparePage.vue` 的 `optimalGold` |
| 交互 → 角色配置映射（含 tauntCancel） | `src/composables/teamCompare.ts` `applyTeamToStore`（parry/dodge/quickAssist/block/tauntCancel → `set*Count`） |
| 般岳轴模式自动补齐交互次数 | `src/mechanics/agents/banyue.ts` `computeBanyueInteractionTopUp`（纯函数：嗔火缺口→双反、喧响缺口→弹刀）+ `src/composables/useResourceCalc.ts`（外不动点 `prevBanyueTopUp` 线程、弹刀计入 `calcSpecialActionBonus`、暴露 `banyueInteractionTopUp`）；交互栏显示在 `TeamConfigPage.vue` |
| 散点图/控制面板/明细表 | `src/views/TeamComparePage.vue`（自绘 SVG，无图表库；buff 选择器 = 自动推荐/手动指定） |
| 页面注册 | `src/views/CalculatorView.vue` pageMap + `src/components/AppHeader.vue`（`teamCompare` tab） |
| 测试 | `src/composables/__tests__/teamCompare.test.ts`（金数/难度/批量/现场恢复/buff 推荐/buff 条件） |

## 3. 验证命令

```bash
npm run typecheck      # 类型
npm run check          # validate:data + validate:specs + vitest（153+ 测试）
npm run build          # 产物（public/ 自动拷入 dist/）
```

改动数据后重跑 `scripts/import-nanoka-bosses.mjs` 并 `npm run build`（preview 服务读 dist/）。
