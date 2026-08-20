# ZZZ 伤害计算器

绝区零（ZZZ）伤害计算器：**60 名角色**的资源回复/消耗、属性 buff、招式调用、命座、额外能力的完备计算。
技术栈：Vue 3 + TypeScript + Vite + Naive UI + Pinia + Vitest。
核心口径：**整局总量**（不算逐帧时间轴，算"整局回复量 vs 整局消耗量"），用户可调覆盖率/占比参数。

---

## 1. 快速开始

```bash
npm install
npm run dev        # 开发服务器
npm run build      # 类型检查 + 产物构建
npm run preview    # 预览产物
```

## 2. 检查与验收命令

```bash
npm run verify          # 一条链验收：validate:data + validate:specs + vitest + typecheck + build
npm run check           # validate:data + validate:specs + vitest（快速环，改完必跑）
npm run typecheck       # vue-tsc --noEmit
npm run build
npm run validate:specs # spec 结构/状态/倍率行引用校验（60 个角色 spec，含自定义模块死数据强制检查）
npm run specs:coverage # 60 角色覆盖矩阵（转模/资源/融合/事件/验证数）
npm run docs:status    # 重新生成 docs/implementation-status.md（CI 会检查漂移，漏跑即红）
```

数据/爬取类命令见 `package.json` 的 scripts（specs:new / specs:import / specs:bootstrap 等）。

> 测试约定：新测试一律用 `src/test/harness.ts`（`setupHarness` / `mockStaticFetch` / `setTeam`）装配
> pinia + 三文件 fetch stub + 队伍，禁止复制样板；全局回归网 = `src/composables/__tests__/allAgentsSweep.test.ts`
> （60 角色 × 命座 0/6 不变量）。

## 3. 角色录入（唯一高频工作流）

新增角色或补机制：

1. 生成骨架：`npm run specs:new -- <agentId> --write`（或复制 `src/specs/template.json`，其 `_comment` 字段带字段说明）。
2. **先看完整角色模板**：`src/specs/agents/1451.json`（卢西娅·艾洛温）——梦境值计划/追加攻击/[合唱]行修正/4命帷幕喧响/6命转模/回血接入伊德海莉的全口径示例。
3. 填写 `attributeConversions` / `resources` / `events` / `verifications` / `notes`。**标注约定**（`[猜测·高/中/低]` / `[已确认]`）见 `src/specs/template.json` 的 `_comment` 与 `scripts/validate-specs.mjs` 头注释。
4. 用户确认的数值 → 写入 `verifications`（panel → expected），vitest 自动执行，成为回归测试。
5. 需要 TS 机制模块的角色：新建 `src/mechanics/agents/<id>.ts`（钩子清单与职责见 `src/mechanics/types.ts` 的 `AgentMechanicModule` JSDoc），并在 `src/mechanics/index.ts` 注册；模块头注释按 JSDoc 要求写完整口径。
6. **每个录入的机制必须补一条生效测试**（防死数据铁律）——防死数据清单、字段→消费者映射、常见坑见 `docs/AGENT_RECORDING_SOP.md`（AI 录入必读）。
7. 同步 `public/static/character-mechanics.json` / `character-constellations.json` 的实现状态与 codePaths。
8. 跑验收：`npm run validate:specs && npm run check && npm run typecheck && npm run build && npm run docs:status`。

**进度数字一律看 `docs/implementation-status.md`（自动生成），不要手写"已实现 N 个角色"。**

## 4. 目录结构

```
src/
  core/            计算引擎（resource 资源池 / stunPool 失衡 / anomalyPool 异常 / damage 伤害 / buff / panel / stunAxis*）
  composables/     useResourceCalc.ts 总管线（双层不动点、伤害池、失衡轴、章鱼自动轴）+ resourceCalc/helpers.ts（computePanel* 等）
  mechanics/       agents/*.ts 每角色机制模块（钩子注入）；types.ts 钩子接口；registry.ts 注册表
  specs/           声明式 spec（agents/*.json + 解释器 mechanics.ts / resources.ts / runtime.ts / verify.ts）
  stores/          config.ts（队伍/敌人/失衡轴/设置，含 autoYidhariAxis）+ catalog.ts（只读数据）
  views/           页面（队伍/属性/倍率表/资源池/资源利用率/失衡轴 + 开发：公式字段/音擎字段/逻辑编辑/机制表）
  components/      FinalPanel.vue（最终面板与乘区，局外→局内同源）、StatPanel.vue 等
  data/            stunAxisPresets/（失衡轴预设 JSON，含 chapter 字段）+ 预设匹配逻辑
public/static/     catalog.json（编译期数据快照，倍率表唯一事实来源）、teammate-buffs.json（全队拐力）、character-*.json（状态表）
scripts/           validate / specs / docs:status / 数据导入等
data/raw/          nanoka 原始数据（含 nanoka_missing/）
```

## 5. 数据源与关键口径

- **nanoka.cc 爬虫** → `public/static/catalog.json`：60 角色基础属性 + 完整倍率表（编译期快照，改数据要同步快照与导入脚本）；音擎补录走 `scripts/import-nanoka-wengine.mjs`（无参自动补 nanoka 有而 catalog 缺的武器，`data/raw/nanoka_wengine_*.json` 为原始数据，60 级面板按 base/rand 推导、被动 buff 在脚本 MANUAL_EFFECTS 人工建模）。
- **Boss 预设**：`scripts/fetch-nanoka-bosses.mjs` + `scripts/import-nanoka-bosses.mjs` → `public/static/boss-presets.json`（危局强袭战 15 个 Boss × 各期血量/失衡/防御/异常系数/三张抗性表 + 怪物本体失衡倍率/失衡时间 + 用户确认收录的老防卫战 Boss 彷徨猎手），属性配置页 `BossSelectCard.vue` 一键填充。
- **预设队伍对比**：`src/data/teamPresets/`（JSON，含加金顺序/交互清单/常驻配置）→ 队伍对比页散点图（x=操作难度=交互加权和，y=伤害/血量%，点=队伍×限定金）。批量计算管线在 `src/composables/teamCompare.ts`，金数口径：总限定金 = 限定 S 角色本体/音擎本体 + 影画/精炼步，常驻 S 角色（莱卡恩等）与常驻音擎不计；选择越界自动钳制到队伍档位范围；常驻角色命座/精炼走 `standardSteps`（不占限定金，改文件后重跑）。
- **teammate-buffs.json**：全队拐力（核心被动/额外能力/命座拐），按 `source.zhCN` 里的"影画X"自动按命座门控。
- **动作时间公式**（基于倍率表 `ether_purify` 行）：一般招式 `秽盾/100`、闪避反击 `-1.5`、轻重弹刀 `-2.5`、终结技 `-5`。
- **合轴率** `comboAlignRatio`：动作时间内可与其他操作并行的比例，硬编码进 catalog 静态数据。
- **失衡轴**：`src/data/stunAxisPresets/` 下的预设 JSON（`team` 按槽位匹配、`*` 通配、`chapter` 字段用于章鱼自动轴按伊德海莉命座选轴）。

## 6. 文档（共 9 份，其余知识在代码注释 / spec / 测试里）

| 文档 | 定位 |
| --- | --- |
| `docs/ARCHITECTURE.md` | **代码架构地图（AI 导航）**：五层心智模型、一次计算生命周期、核心类型地图、任务→文件决策树、数据流速查（动手前必读） |
| `docs/ENGINE_PIPELINE_GUIDE.md` | **引擎管线导读**：一轮计算的数据流、模块钩子调用顺序、常见坑（AI 录入排查用） |
| `docs/AGENT_RECORDING_SOP.md` | **角色录入 SOP（AI 快速上手）**：spec 字段→消费者→生效测试清单、防死数据铁律、踩坑清单 |
| `docs/MECHANIC_PATTERNS.md` | **机制模式目录**：游戏文本 → 计算逻辑的翻译词典——九个计算维度、确定性四级（L0 直读/L1 直译/L2 近似/L3 凹分拍板）、凹分思想提炼路径（录新角色先做模式匹配） |
| `docs/GAME_TERM_TO_CODE_FIELD.md` | 中文游戏术语 → 计算器字段映射（AI 录入时查字段用） |
| `docs/MECHANICS_IMPLEMENTATION.md` | 角色特殊机制档案：已实现机制角色口径（洛克茜/克拉蕾/柏妮思/雅/琉音/诺姆/青衣/般岳/卢西娅/星徽·比利等）与通用自动失衡轴 |
| `docs/FEATURES_GUIDE.md` | **Boss 选择 + 队伍对比功能手册**：操作方式、数据管道命令、修改入口表、口径与验证命令（新功能必更新） |
| `docs/implementation-status.md` | **自动生成**，60 角色覆盖矩阵（唯一权威进度，勿手改） |
| `docs/mechanism-reference.md` | 游戏底层机制理论（啵啵獭 10 期：能量/喧响/击破/异常/紊乱/防御/秽盾/风），纯参考，不随代码维护 |

> 项目知识以代码为唯一事实来源：角色口径在 spec `notes` + 模块头注释，用户确认数值在 `verifications`（测试固化），引擎规则在 core/ 注释与测试。删掉的文档不再重建。
> 文档数量以本表为准（9 份），新增文档需同步本表。
