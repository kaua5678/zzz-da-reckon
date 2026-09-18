# ZZZ 伤害计算器

绝区零（ZZZ）伤害计算器：**全部已收录角色**（数量以 `docs/implementation-status.md` 为准）的资源回复/消耗、属性 buff、招式调用、命座、额外能力的完备计算。
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
npm run verify          # 一条链验收：check-guards + check-tokens + validate:data + validate:specs + verify:recording + vitest + build（build 内含 vue-tsc 类型检查）
npm run check           # check-guards + check-tokens + validate:data + validate:specs + vitest（快速环，改完必跑）
npm run typecheck       # vue-tsc -p tsconfig.app.json --noEmit（单独跑更快；verify 链内已由 build 覆盖）
npm run build
npm run validate:specs # spec 结构/状态/倍率行引用校验（全角色 spec，含自定义模块死数据强制检查）
npm run specs:coverage # 全角色覆盖矩阵（转模/资源/融合/事件/验证数）
npm run docs:status    # 重新生成 docs/implementation-status.md（CI 会检查漂移，漏跑即红）
```

数据/爬取类命令见 `package.json` 的 scripts（specs:new / specs:import / specs:bootstrap 等）。

> 测试约定：新测试一律用 `src/test/harness.ts`（`setupHarness` / `mockStaticFetch` / `setTeam`）装配
> pinia + 三文件 fetch stub + 队伍，禁止复制样板；全局回归网 = `src/composables/__tests__/allAgentsSweep.test.ts`
> （全角色 × 命座 0/6 不变量）。

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

## 5. 数据源与关键口径（细节在各自主档，本节只做索引——同一事实不在这里重写一遍）

| 主题 | 唯一事实源 | 细节在哪 |
|---|---|---|
| 角色/音擎基础属性 + 完整倍率表 | `public/static/catalog.json`（编译期快照；**改数值 = 改 `scripts/` 导入/爬取脚本重跑，勿手改 JSON**） | `docs/DATA_FETCHING.md`（抓取/导入约定、版本 hash 坑） |
| Boss 预设（各期血量/失衡/防御/抗性/默认交互） | `public/static/boss-presets.json` ← `scripts/{fetch,import}-nanoka-bosses.mjs` 的 `BOSS_DEFAULTS` | `docs/FEATURES_GUIDE.md` §1 |
| 预设队伍 + 限定金口径 | `src/data/teamPresets/*.json`（`auto-` 为唯一来源，同名/同成员集合只留一条） | `docs/FEATURES_GUIDE.md` §2–3 |
| 全队拐力 | `public/static/teammate-buffs.json`（采集）+ spec `teamBuffs`（人工）→ `stores/catalog.ts` 合并 | `docs/AGENT_RECORDING_SOP.md` §6.1 |
| 实战归档（**只作单条部署对照，不作误差判据**，用户裁决 2026-09） | `public/static/run-archive.json` ← `scripts/{fetch,import}-zzz-run-archive.mjs` | `docs/FEATURES_GUIDE.md` §7 |
| 动作时间公式 / 合轴率 / 失衡轴 | 招式时间口径在 `scripts/import-nanoka-missing.mjs`（真源，勿在文档抄公式）· `comboAlignRatio` 进 catalog · `src/data/stunAxisPresets/` | `docs/ENGINE_PIPELINE_GUIDE.md` §1 与 §4 坑 21 |

## 6. 文档（14 份，其余知识在代码注释 / spec / 测试里）

| 文档 | 定位 |
| --- | --- |
| `docs/ARCHITECTURE.md` | **代码架构地图（AI 导航）**：五层心智模型、一次计算生命周期、核心类型地图、任务→文件决策树、数据流速查（动手前必读） |
| `docs/ENTITY_CARDS.md` | **实体卡（AI 陈述性知识层）**：音擎/角色/驱动盘等实体的完整结构与权威指针表 + 事故登记；配套查证工具 `node scripts/resolve.mjs` 与引擎探针 `npm run probe:panel`（跨实体断言/派生数值必用） |
| `docs/ENGINE_PIPELINE_GUIDE.md` | **引擎管线导读**：一轮计算的数据流、模块钩子调用顺序、常见坑（AI 录入排查用） |
| `docs/AGENT_RECORDING_SOP.md` | **角色录入 SOP（AI 快速上手）**：spec 字段→消费者→生效测试清单、防死数据铁律、踩坑清单 |
| `docs/MECHANIC_PATTERNS.md` | **机制模式目录**：游戏文本 → 计算逻辑的翻译词典——九个计算维度、确定性四级（L0 直读/L1 直译/L2 近似/L3 凹分拍板）、凹分思想提炼路径（录新角色先做模式匹配） |
| `docs/GAME_TERM_TO_CODE_FIELD.md` | 中文游戏术语 → 计算器字段映射（AI 录入时查字段用） |
| `docs/MECHANICS_IMPLEMENTATION.md` | **逐角色机制档案**（录角色前先 grep 该角色段）：当前实现状态行 + 只有档案知道的用户裁决与未建模项 + 实现指针；§0 特化中英映射表、§3.05 名词缺口挂账。机制细节以 `src/specs/agents/<id>.json` notes 与模块头注释为唯一事实源，档案不复述它们 |
| `docs/FEATURES_GUIDE.md` | **Boss 选择 + 队伍对比功能手册**：操作方式、数据管道命令、修改入口表、口径与验证命令（新功能必更新） |
| `docs/UI_THEME_GUIDE.md` | **UI 主题系统指南**：明暗双主题三层颜色体系（--app-*/--wa-* 色阶）、切换机制、SVG 填坑、ZZZ 品牌色板、改 UI 前必读 |
| `docs/implementation-status.md` | **自动生成**，全角色覆盖矩阵（唯一权威进度，勿手改） |
| `docs/mechanism-reference.md` | 游戏底层机制理论（啵啵獭 10 期）：**只留尚未建模的理论存量**（秽盾/接战状态/精英怪档/待实测系数）；已进引擎的公式与倍率表以 `src/core/**` 为唯一事实源，本文只给指针 |
| `docs/DATA_FETCHING.md` | 数据抓取/导入约定（nanoka 等数据源的管道与字段口径） |
| `docs/multiplier-record.md` | **自动生成**倍率表系数演算记录（`npm run gen:multiplier-record`），供倍率系数页核对 |
| `docs/AGENT_ID_BURNDOWN_LOG.md` | **agentId 清偿编年史**（从 `scripts/check-guards.mjs` 搬出的 `AGENT_BRANCH_BASELINE` 沿革：逐轮对账/逐队归因/实验过程）；当前读数与判据仍以该脚本为唯一事实源 |

> 项目知识以代码为唯一事实来源：角色口径在 spec `notes` + 模块头注释，用户确认数值在 `verifications`（测试固化），引擎规则在 core/ 注释与测试。删掉的文档不再重建（2026-09-14 删 `architecture-review-2026-09-11.md` 点时间快照：已落地结论长在代码与护栏里，未落地 4 条曾迁账本 Open 段，现随账本瘦身统一收在 `.claude/OPEN-ITEMS.md`）。
> 文档数量以本表为准（14 份），新增文档需同步本表。
