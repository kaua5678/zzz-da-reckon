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
4. 底部「全部 Boss」折叠：16 个 Boss 按「危局异构（困难）」「危局常规（普通）」两组分组，点 chip 跳转到该 Boss 最新危局期。
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
- 测试：`src/composables/__tests__/phaseBuffParser.test.ts`（7 条，覆盖分档/限定/多招式/测试服）

### 1.5 已知口径

- `attribute_infliction` = 异常条系数万分比（危局 10 → `bossAnomalyCoeff` 1.1）
- 失衡倍率大多 1.5，**名可名/基塔布鲁·滞变畸兽 = 1.25**；失衡时间大多 12s，**复写体·猎血清道夫/滞变畸兽 ≈ 15.02s**
- 怪物本体精确抗性与期数 `element` 粗编码（1/-1/0）同源；`monster_weakness` 是关卡级标签（随期数变）

## 2. 预设队伍（首页下拉 + 队伍对比页共用）

- **数据源唯一**：`src/data/teamPresets/*.json`（`import.meta.glob` 自动加载，`disabled: true` 跳过）。
- **两级下拉**：一级分类（`group` 字段，如「命破队」）→ 二级队伍；分组选项统一由 `teamPresetGroupOptions` 导出，首页/保存弹窗/队伍对比页/击破对比页共用。新预设必须填 `group`（缺省落「未分组」，有测试锁住不出现）；槽位约定 0=主C、1=击破、2=辅助。
- **首页（队伍配置）**：预设队伍是下拉选项（换人 + 自动配装，`applyTeamPreset` 只取 `team` 字段，金数/交互不应用）；队伍多了不拥挤。
  - 下拉旁「预设金数」按钮：弹窗设置当前队伍各槽位影画/精炼（0-6 / 1-5），含加金档位快捷按钮（0命1精 / 212121 / 612121 / 616161 / 656565）与实时「总限定金」显示；应用走 `setCinemaLevel`/`setWEngineModLevel`，只改当前队伍配置，不改预设文件（队伍对比页仍走 `goldSteps`）。总金数口径与对比页一致（`teamCompare.ts` 的 `teamGoldOf`：限定 S 角色/音擎本体各 1 金 + 影画/精炼每级 1 金，常驻不计）。
  - 弹窗内「保存到预设文件」：选择目标预设（默认最近应用的预设）→ 把当前命座/精炼按口径重写为 `goldSteps`（限定角色/音擎步进）+ `standardSteps`（常驻/A 级步进）→ 下载 `<id>.json`（同时复制到剪贴板），手动替换 `src/data/teamPresets/<id>.json` 后刷新生效（浏览器无法直接写项目文件）。阵容与所选预设不一致时有警告；步骤生成逻辑在 `teamCompare.ts` 的 `buildGoldStepsFromConfig`（有单测）。
- **队伍对比页**：同一份数据，多选参与散点对比（金数档位来自 `goldSteps`，横轴难度来自 `interactions`——首页预设这两项为空数组，对比前需补）。
- 新队伍：复制 `_template.json` 改名编辑（删 `disabled`），刷新即加载。

## 3. 预设队伍对比（「队伍对比」Tab）

### 3.1 用户操作

1. 「队伍对比」Tab → **先选期数（全部 Boss 期数并集，新的在前，含老期数）→ 再选该期 Boss**（下拉只列选中期数出现过的 Boss，困难标「（困难）」）→ 预设队伍（多选）+ 限定金区间 + **当期 Buff**（默认「自动推荐（每队取最优）」，可手动指定某张牌）→ 计算。
   - **最优加金（≤12金）**（默认开）：≤12 金不用预设 goldSteps 的排列顺序，逐金贪婪挑伤害提升最大的可用步骤（每金档试算全部「下一个未购级别」）；12 金以上回退预设顺序。勾掉即完全按预设顺序。
   - **金数顺序优先级（用户问答口径）**：「最优加金」开着（默认）= 自动顺序优先，但候选范围仍由预设 `goldSteps` 决定（声明了哪些级别才能买哪些）；超过 12 金或关掉勾选 = 完全按预设手排顺序取前 N 步。goldSteps 编写惯例：细步只到「全21」（每人 2 命 1 精），之后直接 612121 → 616161 → 656565 三大档按序可达，不做更多细分（见 `_template.json`）。对比基线惯例：主C 0命1精（专武本体）、队友 0 命无专武。
   - **自动下位音擎**（默认开）：基础音擎**非限定**的槽位，运行时从「下位装填池」按全队伤害试算择优穿戴。装填池默认 = 用户准信五件（击破：人为刀俎 A/燃狱齿轮 S常驻；辅助：好斗的阿炮 A/逍遥游球 A/啜泣摇篮 S常驻，`DEFAULT_AUTO_ENGINE_POOL`），页面多选框可增删任意音擎并持久化到浏览器本地；A 级默认精炼 5、常驻 S 默认精炼 3（页面可调，与准信 精5/精3 对应），择优只在池内试算（不做全目录遍历）。
   - **有金就是金**：池内限定音擎可选——按本体（精炼1）参与择优，选中几件就在该队点的总限定金里如实加几金（goldLabel 注明「含下位限定 N 金」）；被预算步购买顶替的槽位不双算（其金已含在预算步）。预设 `wEngines` 仅**限定**音擎保留（真实持有物），常驻/A/空槽位一律以择优结果为准——预设不是下位口径的事实源。买上专武的金档该槽换回专武（精炼回 1），其余槽保持下位；击破系等低收益音擎可能落选（按伤害择优的预期行为）。实现 `computeAutoEnginePicks` + `substituteAutoEngines`，两条金档路径同口径。
   - 已知建模缺口：逍遥游球「对应 Boss 弱点才生效」的条件字段引擎未消费，现按无条件常驻暴击 buff 计算（偏乐观）；条件生效建模留待专项。
2. **最优加金口径**（用户拍板）：候选只来自该预设 `goldSteps` 里写过的级别（尊重作者设定的命座/精炼范围，如只写到 2 命就只在这范围内挑）；`standardSteps` 全量应用（不占金）；每步同场景对比（boss/buff 已应用，只变这一级）；金数预算精确（总金 = 基础金 + 已选步数）。计算量：每金档 × 候选数（≤6）次全量伤害 + 下位装填池 × 有角色槽位数（每队一次），比预设顺序慢。
2. 散点图：横轴 = 操作难度（交互加权和），纵轴 = 伤害/血量%（100% = 击杀线，200% = 两倍血量）。
   点颜色 = 队伍、半径 = 金数；hover 显示明细（含 buff 名）；底部明细表（含 Buff 列）+ CSV 导出。
3. **buff 推荐**：自动模式对每个队伍三张可用牌各算一次伤害（用第一个金数档，在所选 Boss 期数应用后评估），取最高者作为该队所有点的 buff；手动模式全队用指定牌。测试服牌不参与。

### 3.2 添加预设队伍（高频操作）

**预设级自动下位声明（可选字段 `autoEngine`，声明即覆盖页面装填框/精炼输入）：**
```jsonc
"autoEngine": {
  "byAgent": { "1481": { "poolRef": "琉音槽下位" } },  // 按角色：琉音站哪个槽都生效，写一次处处复用
  "bySlot":  { "1": { "pool": ["14110", "13005"] } },  // 或按槽位直写
  "pool": ["14110", "13005"],                          // 或整队默认池
  "mods": { "aRank": 5, "standard": 3 }                // 可选：精炼档覆盖（A 默认 5 不变）
}
```
每槽取池优先级：`bySlot[slot] > byAgent[该槽角色] > 整队 pool/poolRef > 页面装填框 > 准信五件`；精炼档：`preset.mods > 页面输入 > A5/S3`。命名池在 `src/data/enginePools.json` 一处书写（validate-data 校验 poolRef 与音擎 id 存在）。

1. 复制 `src/data/teamPresets/_template.json` → 同目录改名（如 `miyabi-team.json`）。
2. 删掉 `"disabled": true` 字段，填：

```json
{
  "id": "my-team", "name": "队名",
  "team": ["1561", "1261", "1411"],
  "wEngines": ["", "", ""],                    // '' = 对比页由「自动下位」择优；填限定音擎 = 真实持有（计入基础金）
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
**常驻配置**：预设里 `standardSteps` 数组（与 goldSteps 同构）给常驻角色/非限定音擎设命座与精炼，**不占限定金、默认全量应用**；改该数组后重跑一次对比即可，不在页面里逐档选择。常驻精炼不残留到被「专武本体」获取步换装的槽位（换上限定专武即回精炼1，最优加金同口径）。注意：`standardSteps` 写入的**非限定音擎**会被自动下位择优覆盖（命座步不受影响）。
**明细表「时间」列口径**（2026-08）：动作总时间只累计**前台**执行行（`timeBucket='backstage'` 的后台行不计——如莱卡恩围猎蓄力属后台活动，不占三人共享时间轴）；引擎折叠循环已把前台行对账本收敛（Σ前台行 ≡ 必要+平A 账本 ≤ 战斗−无敌），仍超出才是真超时。
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
| 自动下位音擎（装填池择优） | 同上 `computeAutoEnginePicks`（池解析/过滤/逐槽试算）+ `substituteAutoEngines`（非限定槽位覆盖）；默认池 `DEFAULT_AUTO_ENGINE_POOL`；页面开关/精炼档/装填框 = `TeamComparePage.vue` 的 `autoEngine`/`autoEngineMods`/`autoEnginePool` |
| 交互 → 角色配置映射（含 tauntCancel） | `src/composables/teamCompare.ts` `applyTeamToStore`（parry/dodge/quickAssist/block/tauntCancel → `set*Count`） |
| 般岳轴模式自动补齐交互次数 | `src/mechanics/agents/banyue.ts` `computeBanyueInteractionTopUp`（纯函数：嗔火缺口→双反、喧响缺口→弹刀）+ `src/composables/useResourceCalc.ts`（外不动点 `prevBanyueTopUp` 线程、弹刀计入 `calcSpecialActionBonus`、暴露 `banyueInteractionTopUp`）；交互栏显示在 `TeamConfigPage.vue` |
| 散点图/控制面板/明细表 | `src/views/TeamComparePage.vue`（自绘 SVG，无图表库；buff 选择器 = 自动推荐/手动指定） |
| 页面注册 | `src/views/CalculatorView.vue` pageMap + `src/components/AppHeader.vue`（`teamCompare` tab） |
| 测试 | `src/composables/__tests__/teamCompare.test.ts`（金数/难度/批量/现场恢复/buff 推荐/buff 条件/自动下位择优） |

## 4. 时间图表（「时间图表」Tab）

### 4.1 用户操作

1. 「时间图表」Tab → 选主C（只列 S 级，默认仪玄）→ 选 Boss（**必选直选**，按最近出场倒序，默认最新危局 Boss；数值取该 Boss 最新一期，优先危局）→ 编辑**候选队友策展池**（多选，localStorage 持久化；默认种子 = 青衣/潘引壶/橘福福/卢西娅/琉音，至少 2 名）→ 限定金预算 → 计算。
   - **横轴 = 所选 Boss 登场的危局期数**（一版上下两个卡池但约 3 期危局、每期 ~14 天）：只看**危局·普通**，困难（critical_assault）不参与演变；角色期数中途实装也算该期可用。测试服占位期默认剔除。选中 Boss 后横轴只保留其登场期数（从首次登场起），体现对抗单 Boss 的队伍成长；刻度用期号 seq（剔除测试服后按时间序 1 起编，「45」代表 69045）。
   - **轻量速算（默认）**：只枚举池内 C(n,2) 组合、每队只算一次（同队跨期面对同一 Boss 数值不变，伤害直接复用；当期 Buff 不参与），配装用 setAgent 兜底（专属音擎/兜底套装/5号位主词条）、加金用主C优先确定性分配——5 人池 ≈ 10 次求值 / 亚秒级。
   - **全量档勾选框**（默认关）：「自动配装」= 推荐驱动盘 + 词条优化器；「最优加金分配」= 逐金贪婪（每步多次求值）。
   - **多队并存强度卡**（队伍×期数矩阵，参照用户 演示.xlsx）：池内每个收敛组合一条横带（纵轴=伤害/血量%），覆盖其存活的期数格；每期包容前 K 名（K 可调，默认 3），跌出即永久淘汰（可达集合只增 ⇒ 排名单调不升）并标 ✕。悬停看伤害与存活区间。
     ⚠ 实现坑：逐期排名循环里「可达集合为空」不能 break——首期可能没有任何可达组合（新队友未实装/全被收敛排除），提前退出会让后续所有期的裁剪失效（曾致弱队全部存活到最后）。
2. 输出：
   - **队伍强度折线**：横轴 = 版本节点（上半/下半卡池期，从主C实装那期到最新），纵轴 = 伤害/Boss血量%（100 = 击杀线）。
   - **队伍构成泳道**：主C/队友1/队友2 三轨，换人节点可视化；换人垂直参考线 + 事件 chips。
   - **明细表**：每节点队伍、伤害、血量%、金数明细、换人事件（含**上位/平替**徽标与提升%）；新角色实装当期未进最优队时标注「实装未进队 · 平替（可不抽）/ 未上位」。
   - **当期 Boss 排期车道**：泳道区第 4 轨按节点显示该期危局 Boss（仅试炼时标注「（试炼）」）；选中某 Boss（如秽息司祭）即高亮其历次出场节点，hover 卡片与明细表同步显示，图表下方给出场节点摘要——这些节点上的换人/入队判定即「当期新队友入队比较」。
   - **限定S首次UP × 版本直伤系数散点**（页面底部静态卡片，无需点计算）：每位限定 S 在首次 UP 节点的支援突击伤害比值（中心系数，`buildDirectDamageTimeline` 推导）；灰 ≈100%、蓝 >105%、橙 <95%，3.2 测试服节点阴影标注——直读历代直伤膨胀档位（1.18/1.27 等，口径见 §5）。
3. **每期新角色 · 强队强度卡**（页面底部，横轴 = **版本卡池期**，与上面的危局期数轴不同）：每个点 = 当期新 S 角色的**强队**（**纯用户手填展示**——已删引擎建议；预填 `src/data/strongTeamPresets.ts` 用户口述预设（2026-08-23，18 队），仓库 preset 补剩余；**同一角色可添加多支队伍 = 同一时间点多点对比**，点色按队伍构成映射）。行清单**排除 1.0 常驻 S**（猫又/11号/珂蕾妲/莱卡恩/格莉丝/丽娜 不是当期新角色；潘引壶 A 级特例保留）。强度按**当前全部已实装**（队伍可含晚于主C实装的队友，如 诺姆 队里的 佩洛伊斯 是 3.2 测试服角色）+ 所选金数配装（默认轻量档主C优先确定性分配；勾选最优加金则逐金贪婪）。未配置强队的角色不出点；3.2 测试服行带标注。
4. **菲林经济模拟卡**（页面底部，横轴 = 所选 Boss 登场的危局期数 + 日期）：**主C 固定（顶部选择）+ 队友 = 顶部候选池按当前总限定金自动换最优双人组**（如 金数够时 琉音换青衣、卢西娅换潘引壶；**选的是主C不是队伍**）→ 逐期发菲林（默认 ≈1金/版本 = 15000，可编辑）→ 按**消耗占比**花/存（如给 1 金用半金 = 0.5）→ 抽卡资金按当前最优队的**主C优先**步买金（命座金 = 93.75 抽 = 15000 菲林；音擎金 = 62.5 抽 = 10000 菲林——依据游戏内调频详情：角色池综率 1.6% × 50/50 保底、音擎池综率 2% × 75/25 保底）→ **每期只用「当前期数」的 Boss 血量 + 关卡固有 buff（layer_buff，期视图有数据才应用）+ 队伍**算伤害/血量%。**起点 = 主C 首次 UP 之后的 Boss 初登场**（主C 实装前的期不计）。可选**目标卡池**（把银行菲林一期清空投入抽卡）、**每版本充值预算（元）按性价比固定分配**：月卡（30元→3300菲林）→ 大月卡（68元→≈2600菲林）→ 直充（10菲林/元），**汇率固定不可改**（`data/filmEconomy.ts` `allocateTopUpFilm`）。初始金数/占比/预算均可设定；纵轴 = 血量%（主线）+ 金数（右轴虚线副线），悬停看详情。
5. **抽卡价值 · 危局兑现卡**（页面底部，点「计算」懒加载实战归档）：回答「这张卡抽了以来在危局**实际兑现了多少分**、哪些卡价值高/低」。横轴 = 归档覆盖的危局房间（期 × 关卡，含普通与困难），每行一张卡、气泡 = 当期**边际兑现**（同房间同一玩家「带该卡最佳分 − 不带最佳分」跨玩家取中位数），行末柱 = **累计兑现总和**（实装以来 Σ 边际）；点击行展开逐期明细。分级 T0~T3 = 限定池累计四分位。详见 §4.4。
6. 可选「包含测试服角色（3.2 未实装）」（缺省关，防测试服数值污染曲线；开时 3.2 节点标注「测试服数据」）。

### 4.2 口径（用户拍板 + 实现细节）

- **版本节点** = 卡池期（上半/下半），数据在 `src/data/versionTimeline.ts`（来源：zzz.163.moe/banners + B 站卡池记录；只收 **S 级**，唯一特例 = 潘引壶（1421，A 级贯穿拐，随仪玄 2.0 上实装、0 限定金））。
- **队伤与节点无关**（同队伍 × 同 Boss × 同金数）→ 全组合 C(n,2) 各算一次，每节点最强 = 可达前缀最大值（**精确增量，非贪心/波束**）。
- **搜索排名用「预算感知确定性分配」**（主C优先加金，`budgetAwareStateFor`）：排名贴近所选金数，换人时机正确；**最终加金 = 逐金贪婪最优**（`computeOptimalTeamAllocation`：影画/音擎本体/精炼，每金档试算全部候选取最大提升；非限定槽位也可花 1 金佩戴限定音擎）。
- **收敛过滤**：失衡外层未收敛（`convergence.outerExit === 'maxIter'`）的队伍伤害虚高（实测青衣系阵容 407%+ vs 收敛 meta 队 105-127%），排除出排名（统计在页头显示）。
- **计算性能口径（实测）**：`applyTeamPreset` 仅 ~0.6ms/队（推荐多为查表、优化器极少触发），真正成本是每次伤害求值 ~30ms——全候选 ~900 对 ≈ 27s，**因此默认走策展池轻量档（见 4.1）**；全候选遍历仅测试/显式场景使用。防卡死靠阶段边界 yield（阶段1每2队、阶段3每2队，单帧 ~60ms + 进度条）；**贪婪试算区不做 yield**——临时改动未还原时让出会触发 store 的 team watch（syncTeammateBuffsFromTeam）重入、扭曲后续试算（曾致潘引壶测试回归）。配装不按 agentId 缓存：队友可用 buff 组随组合变化，缓存会使同角色副词条跨队漂移（实测末节点伤害 -13%）。根治需 Worker 化（引擎与 Pinia store 解耦后）。
- **Boss 排期匹配规则**：`phase.begin` 落入 `[node.date, 下一 node.date)` 窗口归该节点（早于首节点丢弃、晚于末节点归末节点），不依赖 version 字符串；同 (节点, Boss, 模式) 去重。数据源 `composables/bossSchedule.ts`，危局期数随导入管道增长后标记自动变全。计算口径不变：整条曲线仍用所选 Boss 一套数值，排期标记只负责定位比较窗口。
- **已知偏差（模型 vs 真实 meta）**：真实演变路径依赖的青衣系队伍目前全部 `maxIter` 未收敛被排除（外层不动点 6 轮内不落稳、伤害漂移虚高，如 仪玄+青衣+橘福福 实测 363% 血量），且收敛队中 仪玄+贯穿拐/击破位 组合排名低于模型偏好组合——时间线排序与真实 meta 尚有差距，待收敛处理与机制精度专项。
- **换人判定（上位/平替）**：换人节点的最优队伤害对比上一节点旧队伤害（同预算下各自最优加金），提升 ≥ `SWAP_UPGRADE_UPLIFT_PCT`（默认 10%，`teamTimeline.ts` 导出常量）→ **上位**，否则 **平替**；单一事实源 `classifySwapUplift`，节点与换人事件 chips/hover 同步显示。
- **实装未进队判定**：当期新实装角色全部不在最优队时，用阶段①参考伤害比较「含新角色最强组合 vs 不含的最强组合」——差距 < 阈值 → 平替·可不抽，≥ 阈值 → 未上位（零额外求值；参考最强含新角色但最优加金后被反超的排名分歧场景不标注）。
- **队伍结构约束**：至多 1 名击破（stun）——真实 meta 无双击破；引擎失衡循环对双击破高估。
- 交互基准：全槽位 弹刀6/闪反10/快支3/连携1（般岳/星徽·比利按角色默认）；配装 = 邦布精灵推荐（含词条优化器）；当期可选 Buff 不参与（沿用当前全局 Buff 表）。

### 4.4 抽卡价值 · 危局兑现口径（Chart 5，学术框架映射）

数据源 = `public/static/run-archive.json`（实战归档，5700+ 条投稿；房间 = 期数 × 关卡，含普通/困难）。点「计算」懒加载 + 会话内缓存，纯函数零引擎求值（`composables/pullValue.ts` `computePullValue`）。

| 学术概念 | 本实现 |
| --- | --- |
| 生产函数边际产量 MP | 同房间「带卡 c 最佳分 − 不带卡 c 最佳分」的**作者内差分**（同一玩家自己跟自己比） |
| 双向固定效应 AKM（作者 × 房间） | 作者固定效应（玩家技术）与房间固定效应（Boss/buff/期数难度）被差分结构吸收，无需显式估计 |
| 稳健统计（robust） | 跨作者取**中位数**（抗整队替换的异常放大；均值会被明星玩家单期拉爆） |
| Tobit 删失 | 单房间上限 65000；带/不带都打满 → 边际如实计 0（顶部饱和 = 边际报酬趋零，本身即结论） |
| 资本积累 | 卡在实装日被抽取 = 投资；**累计兑现 = Σ 逐期边际**（无折现，「总和」字面口径）；衰减由「近 3 期场均」呈现 |
| ROI | 每万菲林兑现 = 累计 / (CINEMA_GOLD_FILM/10000)；赠送 S（佩洛伊斯）= null |
| 非参数分级 | 限定池（含赠送）累计**四分位** → T0~T3；配对数 < `MIN_PAIRS_FOR_GRADE`(10) = 样本不足不分级 |
| treatment-on-the-treated | 估计 = 玩家**选它上场**时的效果（正向选择偏：玩家倾向在卡适合的房间用它——对「抽了能兑现多少」的决策口径恰好合适） |

关键口径与已知边界：
- **期中实装**：卡可用 ⇔ 实装日 ≤ 该期结束日（赛季窗口后半段实装算该期可用，对齐 teamTimeline 惯例；实测希格莉德 08-19 实装在 08-13 开赛的 69043 期已有 92 次出场）。
- **观测窗口左截断**：归档只覆盖 2026-04 之后的赛季；更早实装的卡只累计窗口内兑现（累计不可跨卡直接比时看「场均」）。
- **分层不混排**：限定 S（分级主体）/ 赠送 S / 常驻 S / A 级基线（潘引壶按 A 级特例归此层）。A 级负边际 = 「没卡时的占位选择」与更好卡的机会差，不是抽卡投资标的，不参与分级。
- **未出场计 0**：「兑现」= 实际上场产生的边际；从未出场的限定 S 累计 0、不分级（如纯辅助拐在顶分环境缺位本身就是信号）。
- **匿名投稿无配对可能**（无名 = 各自成组）；房间轴只含有投稿的房间。

### 4.3 修改入口

| 要改什么 | 改哪里 |
| --- | --- |
| 版本节点 / S 级实装版本 | `src/data/versionTimeline.ts`（新增版本/角色时更新；3.2 测试服 note 标注） |
| 搜索 / 加金 / 收敛过滤算法 | `src/composables/teamTimeline.ts`（`computeTeamTimeline` / `computeOptimalTeamAllocation` / `budgetAwareStateFor`） |
| 每期新角色·强队强度（Chart 3） | `teamTimeline.ts`：`buildNewCharacterRows`（版本×新角色行，**排除 1.0 常驻 S**）/ `computeNewCharacterPoints`（**同角色多队**逐队配装+收敛过滤）/ `prefillStrongTeamsFromPresets`（口述预设优先 + 仓库 preset 补剩余）；**口述强队单一事实源 = `data/strongTeamPresets.ts`** |
| 菲林经济模拟（Chart 4） | `teamTimeline.ts`：`computeFilmSimulation`（经济累积 + 主C优先买金 + 逐期 Boss/buff 求值）；**抽卡期望/汇率常量 = `data/filmEconomy.ts`**（角色金 93.75 抽 / 音擎金 62.5 抽 / 直充 10 菲林/元，萌百·游戏内调频详情） |
| 抽卡价值 · 危局兑现（Chart 5） | `composables/pullValue.ts`：`computePullValue`（配对差分/累计/ROI/四分位分级，纯函数）+ `pvTierOf`（分层单一事实源）；口径见 §4.4 |
| 图表 / 控制面板 / 明细表 | `src/views/TimeChartsPage.vue`（自绘 SVG，无图表库） |
| 直伤系数散点数据 | `composables/multiplierCoefficients.ts` 的 `buildDirectDamageTimeline`（限定S × 首次UP节点 × 支援突击锚点比值；口径见 §5） |
| 页面注册 | `CalculatorView.vue` pageMap + `AppHeader.vue`（`timeline` tab） |
| 测试 | `src/composables/__tests__/teamTimeline.test.ts`（数据不变量/基础金/贪婪金/演变冒烟）；Chart 5 = `pullValue.test.ts`（fixture 不变量 + 真实归档冒烟）+ `pvRenderCheck.test.ts`（渲染层集成） |

## 5. 倍率表系数演算记录（「倍率系数记录」Tab，开发组）

### 5.1 用户操作

1. 「倍率系数记录」Tab（开发组）自动对全角色跑一遍演算，无需点按钮：
   - **标准职业稀有度倍率表**：14 类招式 × 六列（伤害/失衡/回能/喧响/积蓄/秽盾）的 1 级 A 级基准式；
   - **角色纵向系数总表**：每角色五列资源系数 + 直伤系数，偏离 100% 即该角色专属系数（点击行跳转明细）;
   - **单角色招式明细**：逐招式逐列「实际/期望」比值与标记；
   - **招式特定偏差清单**：单招式比值偏离本角色列基准 ±5% 以上（连携增强/大招削弱一类设计空间）。

### 5.2 口径

- **模型**：实际录入值(Lv12) = 标准式(const + b×t [+ c×e]) × 等级系数（伤害×2 / 失衡×1.5，引用 `core/skillLevel.ts` 同源常量 `LEVEL1_TO_LEVEL12`）× 稀有度系数（限定S ×1.1 / 常驻S ×1.05，只乘伤害失衡；命破伤害另×0.8）× 角色系数。t = actionTime，e = energyCost 首个非持续项。**特殊技不回能**（原表 3.6t 系笔误，已从标准表删除）。
- **闪能质量 ×1.2**：命破角色的「能」均指闪能。强特消耗闪能（Flash Energy Cost）时，四个耗能利用率系数（伤害 5.55835 / 失衡 4.175 / 喧响 1.909 / 积蓄 4.86）先 ×1.2 再乘闪能量——相同闪能比相同能量多转化 20%。**锚点真斗**：强特「归烬·天坠」耗 80 点闪能（nanoka param 确认，`scripts/patch-move-energy-cost.mjs` 录入），代入后五列比值全部 ≈1.000（测试钉住）；仪玄/般岳在规则之上仍有各自机制偏移，由偏差清单呈现。
- **纵向系数聚合口径**：只取干净类型（排除强化特殊技、轻/重招架、未分类），列内取中位数抗脏行；**支援突击为锚点**（通常不随角色变化），其伤害列比值即「版本直伤系数」。支援突击的「#N」分段按同套合并（前缀项只计一次，苍角实证三列 ≈1.000）；般岳「冲霄」经 `MOVE_TYPE_OVERRIDES` 定点改判为闪避反击公式（金身格挡后招式，锚点由「昂霄」承担，比值 ≈1.000）。
- **已验证钉子（测试钉住）**：爱丽丝失衡 90%、伊德海莉（章鱼）喧响 ~49%、耀嘉音/琉音回能 50%、叶瞬光失衡 50%+喧响 80%、蕾米埃尔喧响 50%、悠真积蓄 70%、薇薇安积蓄 80%、南宫羽喧响 90%、凯撒/月城柳失衡 ~91%；可琳 A 级基线五列 ≈100%；秽盾列全角色无偏差；般岳「山摇」闪能 ×1.2 手算比值；般岳/苍角直伤锚点 ≈1。
- **固化产物 `docs/multiplier-record.md`**：「描述倍率表的句子」与倍率表一样静止——老角色倍率不变则描述不变。由演算结果确定性渲染（总表 / 性质描述 / 招式特定偏差），数据或口径变了漂移测试变红，跑 `npm run gen:multiplier-record` 再生成并随数据改动一起提交；手改无效。
- **待确认口径（页面底部有同款清单）**：个别减半/离群的快速支援记录（安东、卢西娅等，按标准版评估由偏差清单呈现）；普攻回能显式录 0 的 13 条以「0% + 打标」展示、不参与聚合（爱丽丝「星芒圆舞曲」三段经 **gachabase 双源确认官方即 0**，柚叶/克拉蕾/洛克茜的待第二源复核，爬取脚本 `scripts/fetch-gachabase-agent.mjs <agentId> <slug>` 已备好，输出 `data/raw/gachabase/`）。已修复：**席德(1461)错位攻击数据**（用户 2026-08 观察，`scripts/patch-misplaced-attack-data.mjs`）——其 attack_data 实为 [钢能, 回能, 喧响] 三通道，数值策划把回能/喧响填进了 1/2 位、正列反为 0（磁陨轮舞 [3.2084, 0.73, 8.03]：8.03/0.292s=27.5/s 命中喧响基准、0.73/0.292=2.5/s 与正列同速率），7 招已回填 energy_recovery/decibel_recovery（纵向回能 69.5%、喧响 100%），attack_data_1/2 错位行移除、attack_data_0（钢能）保留，席德随之脱离回能缺口清单。已定案：**快速支援两版口径**——标准版 = 伤害 200t（原表 100t 系笔误）+ 原表其余列；翻倍版 = 录制时间只有一半（秽盾基准 50t），评估按 `MOVE_TYPE_TIME_SCALE` ×2 还原、伤害 100t、其余列同标准版；分版判据 = 喧响速率 ≥40/s。**倍率行融合 `MOVE_FUSION_GROUPS`**：星见雅「飞雪 #1+#2=斩击 / #3+#4=追击」（融合后=nanoka 官方倍率，代入公式 ≈1.001）、连携「春临 #1~#3」三段合一（≈1.000）——前缀项/耗能只计一次。**仪玄强特 = 定点整链记录 `FIXED_RECORD_UNITS`**（用户口径）：墨痕化形按交互变体记录 6 招 = 单E/2连/3连 × 弹刀与否——#1=1371009（40 闪能）、#2=1371024（弹刀赠送免费）、#3=1371023（跟随#1 免费）、#4=1371025（20 闪能）；单E/2连 = 40 闪能、3连 = 60 闪能，每招 = 完整一次链（t 与各列数值求和、耗能整链一次计）；原「#1+#2 / #3+#4」融合评估得 ~0.46~2.56 假象已弃用。凝云术（2s 通道共 40）/墨烬影消（20）保持逐行评估；特调由各变体比值如实呈现（单E 伤害 ~0.82、3连·弹刀 喧响/积蓄 ≈0.99、全变体秽盾 ≈1.000）。**普罗米娅强特 = 定点整链记录**（用户口径）：处刑式·坠霜/重霜实为消耗 40 能量（封喉霜径 1541009 / 匿影）后接的免费招——记录为强特公式 + 40 能量奖励（重霜 伤害 ≈1.023、坠霜 ≈0.922、秽盾 ≈1.000；否则按特殊技公式 e=0 得 2.2~3.1 倍虚高比值，纵向积蓄系数由污染值 125.1% 回落至干净样本 85.0%）；重霜 #1+#2 合一（#2 子段 24.2%），封喉霜径保留原行。另有定案：轻/重招架标准常数 = 数据校准值 **95.511+130t / 95.178+130t**；般岳「冲霄」= 闪避反击公式 + 时间 −1.5s；真斗「孤影·断獠」= 改判闪避反击，直伤记「—」；露西两段强特各耗 60 各自成式；妮可 #1 蓄力 20 能量/s、#2/#3 炮击每次耗 60 并留能量场、#4 能量场——明细仅供参考。
- 标准表常数单一来源 `src/data/standardMultiplierTable.ts`（常驻 S 名单也移到此为单一来源，`teamCompare.ts` 转出保持原 API）。

### 5.3 修改入口

| 要改什么 | 改哪里 |
| --- | --- |
| 标准表常数 / 稀有度系数 / 新增招式类型 | `src/data/standardMultiplierTable.ts` |
| 分类规则 / 聚合口径 / 偏差阈值 | `src/composables/multiplierCoefficients.ts`（`classifyMove` / `isCleanVerticalType` / 阈值常量） |
| 页面展示 | `src/views/MultiplierCoeffPage.vue` |
| 页面注册 | `CalculatorView.vue` pageMap + `AppHeader.vue`（`multiplierCoeff` tab） |
| 测试（口径钉子） | `src/composables/__tests__/multiplierCoefficients.test.ts` |
| 固化产物再生成 | `npm run gen:multiplier-record`（生成器 + 漂移检查在 `src/composables/__tests__/multiplierRecord.test.ts`，产物 `docs/multiplier-record.md`） |

## 6. 击破手对比（「击破手对比」Tab）

回答「击破手这个位置选谁」：同一支队伍只换击破手（如诺姆 ↔ 琉音），总伤拆成 自身直伤 / 送连携 / 拐力差分 / 其他 四块。

- **同款限定金数**：所有参比队伍先按同一金档应用各自预设 `goldSteps`（控件「限定金」，缺省 6）再比较——公平看换击破手的边际收益。
- **失衡值 / 失衡占比**：来自失衡池逐槽统计（`perSlotStun`）。**后台自动招式（莱卡恩围猎闪反/蓄力平A、橘福福虎威、露西、丽娜邦布、仪玄合轴等）的失衡贡献已计入**——这些行 daze 经倍率表回填进失衡池，分子分母都含。
- 各队自动匹配各自预设轴；拐力 = 关掉该击破手 teammate-buffs 重算的总伤差值。实现 `composables/breakerCompare.ts` + `views/StunBreakerComparePage.vue`。

## 7. 实战对比（「实战对比」Tab）

目标：把 zzz-run-archive 的玩家实战投稿一键部署进计算器，对比「计算器理论理想 vs 实战分数/击杀/用时」，定位建模精度缺口。

### 7.1 数据管道

```bash
node scripts/fetch-zzz-run-archive.mjs      # 爬全量 → data/raw/zzz-run-archive/{bootstrap,runs,manifest}.json
node scripts/import-zzz-run-archive.mjs     # 精炼 → public/static/run-archive.json（只收危局 + rooms/seasons 索引）
```

- 前端 `RunArchivePage.vue` 懒加载 fetch `/static/run-archive.json`（不进首屏 bundle）。
- 归档新 Boss / 期数 → 补 `scripts/import-nanoka-bosses.mjs` 的 `CATALOG_MONSTER_MAP` 后重跑（见 §1.2），再重跑 import-zzz-run-archive。

### 7.2 用户操作

1. 「实战对比」Tab → 期数 / Boss / 仅击杀筛选 → 列表点「部署」。
2. 右侧：玩家实战（分数/用时/击杀/队伍/视频链）vs 计算器（总伤害 / 当期 Boss 血量 / 伤害血量% / 击杀判定）。
3. 判定不一致给方向提示：预测击杀但实战未击杀 = 理想配装被高估（配装差 + 建模误差）；实战击杀但未达线 = 口径偏保守（漏拐/漏机制）。

### 7.3 修改入口

| 要改什么 | 改哪里 |
| --- | --- |
| 归档 → DeployConfig（命座/音擎/精炼/Boss 期相位） | `src/composables/runArchiveImport.ts`（`submissionToDeploy`/`matchBossPreset`/`matchBossPhase`） |
| DeployConfig → store（队伍/交互基准/Boss/layer_buff） | `src/composables/runArchiveDeploy.ts`（`applyDeployConfig`/`resolveBossApply`/`applyBossLayerBuffs`） |
| 页面 / 注册 | `src/views/RunArchivePage.vue` + `CalculatorView.vue` pageMap + `AppHeader.vue`（runArchive） |
| 测试 | `src/composables/__tests__/runArchiveImport.test.ts` / `runArchiveDeploy.test.ts` |

### 7.4 口径

- 配装 = 计算器默认理想（推荐驱动盘 + 最优副词条 + 技能全满，作为理论**上界**）；不从视频提取真实配装。
- 交互基准 = 角色专属默认（般岳/星徽·比利）> 通用基准（弹刀 6 / 闪反 10 / 快支 3 / 连携 1），与 teamTimeline 同源。
- Boss = 期相位（分期数决定血量膨胀）+ 关卡固有 layer_buff 自动应用；当期可选牌（3 选 1）**不自动应用**（归档未记录玩家选择）。
- 仅危局强袭（Deadly Assault*，含 Adversity），防卫战/歼灭排除。
- 比对口径：伤害/血量%（击杀线 100%）vs 实战 score/bossKilled/time，**不做 score 精确映射**；差异 = 配装差 + 建模误差，靠理想配装上界夹逼隔离。

## 8. 验证命令

```bash
npm run typecheck      # 类型
npm run check          # validate:data + validate:specs + vitest（数量见 vitest 输出，勿在文档写死）
npm run build          # 产物（public/ 自动拷入 dist/）
```

改动数据后重跑 `scripts/import-nanoka-bosses.mjs` 并 `npm run build`（preview 服务读 dist/）。
