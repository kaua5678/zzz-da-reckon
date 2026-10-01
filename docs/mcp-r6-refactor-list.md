# R6 第 2 步：重构机会清单（做 / 不做）

> lead-arena-0925c · 2026-09-27 第 139 轮。输入：`docs/ARCHITECTURE-OVERVIEW.md`（全貌，§3 A1–A5、§5 C1–C7、§6 实测）。
> 判据（REQUIREMENTS R6）：**按架构收益做，不按计数做**；只降计数、不带来架构收益的改动一律「不做」；禁止用「更接近投稿」当理由。
> 每条：类别 · 为什么（出处）· 收益 · 影响面 · 风险 · **结论**。「做」的条目写到可以直接开工。

## 0. 结论总表

| # | 条目 | 类别 | 结论 | 状态 |
|---|---|---|---|---|
| C1 | core ↔ mechanics 模块环 | 可结构化 | **做** | ✅ 第 139 轮完成（R6 验收项，见 §1） |
| C7 | spec 与模块「一处执行、一处描述」 | 可归一 | **做**（分刀） | 1481 ✅ 第 140 轮；1511 ✅ + alice 死写入删除 第 142 轮；runtime sources + 1541 ✅ 第 143 轮；runtime 封顶先于覆盖率 + 1261 ✅ 第 144 轮；1571 等不做（§2.2、§2.4）；attributeConversions 归一到此收尾（§2.7） |
| C5 | 伤害基底两套口径 + 死参数 | 冗余可简化 | **做**（只删死参数与误导字段读法，低优先） | ✅ 第 141 轮（§3） |
| C3 | catalog `appliesToOutOfCombatPanel` 冗余 | 冗余可简化 | **做成校验**，不删字段 | ✅ 第 141 轮（§4） |
| C6 | 编排层实际是四层 | 可结构化 | **只改规划文档**，不挪目录 | ✅ 第 140 轮（ARCHITECTURE.md §0） |
| C2 | `stores/config.ts` 调引擎 | 可归一 | **不做**（改写规划承认它） | ✅ 规划已改（第 140 轮） |
| C4 | 局外判定读 `outOfCombatEffectFilter` | 可结构化 | **不做** | — |
| N1 | `resourceCalc/helpers.ts` 的 re-export 壳 | 冗余可简化 | **不做** | — |
| N2 | `data/moveTableQueries` 读全局 fusion 状态（A3） | 可结构化 | **不做** | — |

「影响面最大」的判断：C1 改变的是整个引擎层（`src/core/**`）对录入层的依赖方向，涉及 12 个 core 文件、全部 core 单测的加载方式与应用入口的注册时机；其余条目最多涉及一个机制族（C7）或只涉及文档（C6）。所以 R6 验收项选 C1。

## 1. C1 core ↔ mechanics 模块环 —— 可结构化 · **做（已完成）**

- **为什么**：12 个 core 文件（`src/core/resource/{assembleSlot,crossAgentSupply,curtain,finalizePasses,helpers,phaseExecutions,resourceIncome,rowAccounting,rowBuild,underfillProbe,warmStart}.ts`、`src/core/substatOptimizer.ts`）写 `import { getAgentMechanic } from '@/mechanics'`。`src/mechanics/index.ts` 一次性 import 全部角色模块并注册，角色模块又按值 import core ⇒ **core → mechanics/index → agents/* → core** 的 ESM 环。规划（`docs/ARCHITECTURE.md` §0）写的是「引擎经 registry 消费录入层」，代码实际经的是 index。
- **做法**：
  - 12 处改为 `from '@/mechanics/registry'`。registry 只依赖 `@/specs/registry` 与 `@/specs/mechanics`，二者不 import core ⇒ 环消失（已逐文件核对 import）。
  - 注册副作用由应用入口负责：`src/main.ts` 本来就 `import '@/mechanics'`；测试进程加 `vite.config.ts` `test.setupFiles: ['./src/mechanics/index.ts']`，与浏览器入口看到同一张注册表。
  - 新测试 `src/core/__tests__/coreMechanicsRegistryOnly.test.ts` 钉住：core 不按值 import `@/mechanics` 或角色模块；registry 不 import 角色模块；两个注册入口仍在。反向验证：把 `substatOptimizer.ts` 改回 `@/mechanics`，第一例失败，恢复后一致。
- **收益**：依赖方向与规划一致（core 只认查询接口）；去掉初始化顺序敏感的环；以后要让 core 单测不加载 62 个模块，只需把 setupFiles 换成按需注册，不用再动 core。
- **影响面**：12 个 core 文件各一行 import；`vite.config.ts` 一行；组件 / composables 仍 import `@/mechanics`（编排层 import 注册入口是合理的，不在环上：角色模块不 import composables，判据 19 保证）。
- **风险与验证**：注册不再由「第一次 import core」隐式触发。所有运行入口已核：浏览器只有 `main.ts`（无 Web Worker，`git grep 'new Worker'` 为 0）；node 侧没有直接跑 src 的脚本（tsx / vite-node 为 0），zd 与测试都走 vitest ⇒ 都有 setupFiles。zd `r6c1` DUMP / ROWS DIFF 0；verify EXIT=0（含 `vite build`）；vue-tsc 0。
- **回退点**：12 处 import 改回 `@/mechanics`，删 setupFiles 一行和新测试。

## 2. C7 spec 与模块归一 —— 可归一 · **做（分刀）**

- **为什么**：全景 §6.4 实测 26 个模块不调用 spec 解释器，其 spec 里的 resources / events / attributeConversions 只供展示；1481、1571 的属性转化常数在 spec 与模块各写一份（spec note 自称「非 spec runtime 执行」）。`alice.ts:115`、`luciaElowen.ts:135` 已示范归一写法 `applySpecAttributeConversions(panel, getAgentSpec(id)?.attributeConversions ?? [])`。
- **收益**：常数单一来源；spec 从「说明书」变成「真执行」，改 spec 即改行为（CC-109 就是说明书与实现分叉的事故）。
- **第一刀（可直接开工）**：
  1. 读 `src/mechanics/agents/liuyin.ts` 的 applyPanel 里暴击率 → 冲击力那段（threshold 50 / step 1 / 2 点每步 / cap 100），对照 `src/specs/agents/1481.json` 的 `liuyin_crit_to_impact` 与 `src/specs/runtime.ts#applySpecAttributeConversions` 的语义（sourcePanelPhase、取整、cap 的含义）。**语义完全一致才替换**；不一致就把差异写进本节，不替换。
  2. 替换后跑 zd（要求 DIFF 0），并把 spec note 的「非 spec runtime 执行」改为实际执行位置。
  3. 同法处理 1571 诺姆的 3 条（`norma_crit_to_critdmg` / `norma_crit_to_stun` / `norma_pen_to_atk`）（note 里写了 valuePerStep 随核心技能等级变化，runtime 若不支持等级变化，就只做能表达的条目，其余留在模块并在 spec note 写明）。
- **暂不做**：10 个模块的 resources 重复（spec resources 驱动 `resourceSections` 展示）。这些要逐个判断 spec 解释器能否表达模块的资源账本；先做 attributeConversions 这种语义简单的，再评估。
- **风险**：低；zd 可验。**回退点**：模块恢复手写那段。

### 2.1 第 140 轮结果：1481 琉音 ✅（不是直接替换，而是先把口径差异写成数据）

- **发现的语义差异**：`src/specs/runtime.ts` 的 `applySpecAttributeConversions` 按 `steps = ⌊(超出量+1e-9)/stepSize⌋` **整步取整**；琉音模块原写 `min(100, max(0, crit−50) × 2)`，**连续不取整**（暴击率 73.6% 时模块 47.2、runtime 46）。spec 的两条 verifications 只测整数点（80 → 60、100 → 100），所以两边分叉一直没被发现。诺姆模块（`norma.ts:204–210`）同样是连续口径。
- **决定**：给 `AttributeConversionSpec` 加可选字段 `stepRounding?: 'floor' | 'none'`（`src/specs/types.ts`；缺省 floor，alice / luciaElowen / 1561 / spec 生成模块全部不变）。1481 spec 声明 `"stepRounding": "none"`，`liuyin.ts` 删掉三个常数，改调 `applySpecAttributeConversions(panel, getAgentSpec(LIUYIN_AGENT_ID)?.attributeConversions ?? [])`（放在原位置，执行顺序不变）。spec 新增 verification `liuyin_crit73_6_to_impact_continuous`（73.6 → 47.2），钉住非整数点。`src/specs/template.json` 字段说明补 stepRounding。
- **依据**：R5 / R6 硬约束「不顺手改数值」。取整与否是**数据口径**，不是重构能决定的；先让口径成为 spec 里一个看得见、可测的字段，常数只剩一处。
- **验证**：zd `c7a` DUMP / ROWS DIFF 0（dump 含 `auto-1371-1481-1451/*` 等琉音预设，哈希前后一致）；`validate:specs` 1102 条通过；`src/specs` + `src/mechanics/__tests__` 116 files / 1318 tests 通过；反向验证：删掉 `stepRounding` 后新 verification 失败（46 ≠ 47.2），恢复后 `cmp` 一致。
- **回退点**：删 1481 的 `stepRounding` 字段与新 verification，`liuyin.ts` 恢复三个常数与四行手算；runtime 的 `none` 分支可保留（缺省不生效）。
- **未决（数据口径，不在重构里改）**：技能原文「初始暴击率超过 50% 时，每超过 1%……」是否意味着按整 1% 取整。若日后确认取整：把 1481 的 `stepRounding` 删掉（回到缺省 floor），73.6 那条 verification 改为 46，并对诺姆模块做同样的改动——这会改数值，必须另开 CC 卡、逐条解释 golden 差异。禁止用「更接近投稿」当理由。

### 2.2 1571 诺姆：**不做**（本条即结论）

> **第 235 轮更新（CC-212，`7b2af5ce`）**：下面「spec runtime 表达不了」的判断仍然成立，但当时漏了第三条路：模块负责来源和落点，常数与步数口径从 spec 读（`specs/runtime.ts#specConversionAmount`）。现已按这条路归一：常数只在 spec 一处，模块只负责取来源和写落点。下面保留原记录。

- `norma_crit_to_stun`：模块把失衡加成分别写到 `stunBuildUpBonus__exSpecial / __special / __ultimate` 三个定向字段，runtime 只有单个 `targetStat`，表达不了。
- `norma_pen_to_atk`：来源是 `calcPenetrationPower(panel)`（`src/core/damage.ts`），不是面板上的某个字段。要表达只能给 runtime 加 `sourceValue: 'penetrationPower'` 并让 `specs/runtime.ts` import core——这会重建 C1 刚拆掉的环（core → mechanics/registry → specs → core），不可接受。
- `norma_crit_to_critdmg` 单独可以迁（加 `stepRounding: 'none'` 即零差），但会把诺姆的三条转化拆到两处（一条在 spec 执行、两条在模块），可读性比现在差；而且 note 写明 valuePerStep 随核心技能等级变化（Lv1 0.86 → Lv7 1.7），模块固定按 Lv7。
- 所以三条都留在模块，spec 条目保持「实现位置：……勿经 spec runtime 应用」的纯记录状态（`validate-specs.mjs` 的死数据检查按 note 放行）。**回退 / 重开条件**：runtime 支持多目标 `targetStats[]` 且有不依赖 core 的贯穿力来源时再议。

### 2.3 C7 其余候选（下一刀按此开工，逐个判断，**不适用就写不做**）

粗筛（`git grep -nE 'Math\.max\(0, *\(?(panel\.|[a-zA-Z]+ *-)' -- src/mechanics/agents`）得到的、模块里手写「超出阈值 × 系数」并**写回面板**的候选：

| 模块 | 位置 | 形态 | 初判 |
|---|---|---|---|
| nangong（1511 南宫羽） | `nangong.ts:117` | `panel.impact += max(0, 异常掌控 − CONTROL_THRESHOLD)` | 最像 1481：单来源、单目标、连续。spec 目前 attributeConversions 为空 ⇒ 迁移意味着在 spec 里新增条目（`stepRounding: 'none'`），收益是常数单一来源 + 机制表页自动展示 |
| promia（1541 普罗米娅） | `promia.ts:75`、`:114` | 异常精通超 PROMIA_MASTERY_THRESHOLD 的部分 | spec notes 自称「模块复现原 attributeConversions」，先读清为什么当初从 spec 挪到模块（可能与面板阶段有关） |
| burnice（1171 柏妮思） | `burnice.ts:283` | 能量回复超阈值 | 先确认写回面板还是写资源结果；runtime 有 `sourceValue: 'energyRegenTotal'` |
| phoenix | `phoenix.ts:132` | 精通超阈值 × 比例 | 先确认目标是不是面板字段 |
| jane（1261 简） | `jane.ts:68` | `atkFromMastery`，有 cap | 写进结果对象而非面板，大概率不适用 |
| alice | `alice.ts:117` | `aliceMasteryToProficiencyBonus` | 写的是自定义键；alice 已调 runtime 处理其余转化，这一条是否能并入要看目标键是否被 runtime 以外的代码读 |
| lighter（1161 莱特） | `lighter.ts:116` | 冲击力超软上限每 10 点 | 是软上限折算，不是加成，大概率不适用 |

每迁一个：spec 加条目（note 写「实现位置：<模块> 调 applySpecAttributeConversions」）+ 至少一条非整数点 verification + zd DIFF 0。**判断标准不是「降低模块行数」**，而是「这个常数改动时，是否只需要改一个地方」。

### 2.4 第 142 轮：§2.3 七个候选的结论

| 模块 | 结论 | 依据（已读代码） |
|---|---|---|
| nangong 1511 | ✅ **已迁** | spec 新增 `nangong_mastery_to_impact`（阈值 110、每点 +1、`stepRounding: none`、无 cap、`sourcePanelPhase: inCombat`）+ 2 条 verification（150.5 → 40.5；100 → 0）。`nangong.ts` 删 `CONTROL_THRESHOLD`；**面板**（applyNangongPanel）与**展示值**（computeNangongMechanic 的 `impactFromMastery`，经 `emptyPanel()` 探针）都调 `applySpecAttributeConversions`，两处永远同口径。zd `c7b` DIFF 0（含 `auto-1511-1561-1411/*`）；反向验证：删 stepRounding → 150.5 那条得 40 ≠ 40.5 |
| alice 1401 `:117` | ✅ **删死写入**（不是迁移） | spec `alice_mastery_to_proficiency` 早已由 runtime 执行（缺省 floor）；`alice.ts:117` 又按**连续**公式写 `panel.aliceMasteryToProficiencyBonus`，`alice.ts:217` 写 `cfg.aliceMasteryToProficiencyRate`——`git grep` 全仓**零读取**（只有 `types/resource/config.ts` 的类型声明）。第二份常数且口径与执行不同 ⇒ 删除两处写入、常数 `MASTERY_TO_PROFICIENCY_RATE` 与类型字段。zd `c7c` DIFF 0 |
| promia 1541 | ✅ **第 143 轮已迁**（见 §2.6）；原判：待 §2.5-① 后零差迁 | `applyPromiaPanel` 读的是 `outOfCombatPanel.anomalyMastery`（阈值 150），runtime 只能读传入的当前面板 ⇒ 现在表达不了。`PROMIA_MASTERY_THRESHOLD` 还被 `computePromiaCycle` 的展示值与导出使用，迁时一并走探针（同 nangong） |
| jane 1261 | ✅ **第 144 轮已迁**（见 §2.7）；原判：待 §2.5-② 后零差迁 | `jane.ts:132–134`：`min(600, (精通−120)×2) × frenzyFactor`——**先封顶再乘覆盖率**；runtime 是 `min(cap, steps×vps×coverage)`——**先乘覆盖率再封顶**，frenzyFactor < 1 且超 cap 时不同。另有展示值 `jane.ts:68` 用同组常数 |
| burnice 1171 | **不做** | `burnice.ts:283–289`：一次超阈值同时写两个目标（anomalyMastery、dmgBonus），每步数值按潜能等级查表（`BURNICE_POTENTIAL_*_PER_0_1[potLv]`）；runtime 的 valuePerStep 是常数。取整口径（floor 0.1）倒是与 runtime 一致 |
| phoenix | **不做** | `computePhoenixWeaknessCrit` 返回派生的「弱点暴击率」= 基础值 + 超阈值部分 × 比例，不写面板；runtime 只写面板字段且没有基础项 |
| lighter 1161 | **不做** | `computeLighterMoraleDmgBonus` 是队友 buff 的软上限折算（每超 10 点冲击力加层数，再封顶、C2 ×1.2），不是属性转化 |

**新发现 1（规格与实现不一致；卢西娅部分 ✅ 第 145 轮 CC-118 已修，见 §2.8）**：`AttributeConversionSpec.sourcePanelPhase` 在 runtime **从不读取**（`resolveAttributeSource` 只读传入面板）。全量 10 条转化里：
- `1451 lucia_c6_hp_to_atk` 声明 `outOfCombat`，实际按局内面板执行（`luciaElowen.ts:131` 注释自称「局外/局内差异约 5%，近似接受」）。**这是数值差异**，修正会改卢西娅 6 命的伤害 ⇒ 必须另开 CC 卡、逐条解释 golden 差异，不在重构里改。
- `1561 velina_regen_to_dmg / velina_regen_to_mastery` 声明 `outOfCombat`，经 `sourceValue` 读回能（需确认用的是 `energyRegenOutOfCombat` 还是 `energyRegenTotal`，与声明是否一致）。
- 其余 7 条声明 `inCombat`，与执行一致。

**新发现 2（口径不统一，数据问题）**：同类原文「超过 X 时每超过 1 点/1%」，alice（floor 整步）与 liuyin / nangong / norma（连续）口径不同。哪个对是数据口径问题，不在重构里统一；统一即改数值，须另开 CC 卡。

### 2.5 下一刀：runtime 两处可选扩展（都是 opt-in，缺省行为不变 ⇒ 零差）

1. **按 `sourcePanelPhase` 取源面板（opt-in）**：`applySpecAttributeConversions(panel, conversions, coverage = 1, sources?: { outOfCombat?: PanelValues })`。仅当调用方传了 `sources.outOfCombat` 且条目声明 `sourcePanelPhase: 'outOfCombat'` 时，从局外面板读 `sourceStat`；否则保持现状。然后迁 promia（它本来就读 `outOfCombatPanel`，零差）：spec 1541 加条目 + 非整数点 verification（注意 `specs/verify.ts` 的 verification 只有一张面板，要么给 verification 增加可选 `outOfCombatPanel`，要么 verification 面板同时当两张用——先读 `verify.ts` 再定）+ zd DIFF 0。**不要**顺手给卢西娅传 sources（那会改数值，见新发现 1）。
   - **✅ 第 143 轮完成**，见 §2.6。
2. **封顶先于覆盖率**（**✅ 第 144 轮完成**，见 §2.7）：先 `timeout 40 git grep -n 'applySpecAttributeConversions(' -- src` 确认没有调用方传第 3 个参数（第 142 轮核对：alice、liuyin、luciaElowen、nangong×2、velina、specs/mechanics.ts、specs/verify.ts 都没传），且 spec 里唯一带 `coverage` 字段的是 `1451 lucia_c6_hp_to_atk: 1`（第 142 轮核对）。满足则把 runtime 改成 `min(cap, steps×vps) × coverage × (conversion.coverage ?? 1)`——覆盖率是时间占比，先封顶再按时间加权才是正确语义；在上述前提下零差。然后迁 jane（传 `frenzyFactor` 作 coverage；`if (精通 > 120)` 与 `max(0, …)` 等价）。

## 3. C5 伤害基底两套口径 —— 冗余可简化 · **做（低优先）**

- **为什么**：R5 D6 / Z1：`src/core/damage.ts:265` `DirectDamageInput.damageBasis` 是死参数（引擎按 specialty 经 `resolveSpecialDamageProfile` 决定），catalog 行上的 `damageBasis`（`src/types/catalog.ts:381`，导入脚本合成）与实际计算不符（命破 5 人写 atk，实际贯穿力）。
- **做什么**：删掉死参数及其调用点的传参（零差）；catalog 字段先不删（要改导入脚本），在 `types/catalog.ts` 注释写明「展示用合成字段，引擎不读」。
- **不做什么**：不让引擎改读字段（字段本身是合成的，不是规格）。
- **风险**：低，零差可验。
- **第 141 轮结果 ✅**：`src/core/damage.ts` `DirectDamageInput` 删去 `damageBasis`（原处留两行注释说明基底由 profile 决定）；删除传参 3 处（`resourceCalc/damagePool.ts`、`mechanics/agents/alice.ts`、`jane.ts`）与测试里 8 处（`damage.test.ts` 6、`discSetEffects.test.ts` 2，这些测试的基底本来就由传入的 `SpecialDamageProfile` 决定）。`src/types/catalog.ts` 的 `SkillRow.damageBasis` 保留并加注释「导入合成的展示字段，引擎不读」；`scripts/import-nanoka-v12.mjs` 头注释原写「SHARPEN_DAMAGE_PROFILE 消费」，是误导（profile 按 specialty 选，不读行字段），已更正。验证：删前 `git grep damageBasis -- src` 全仓只有声明、零读取；zd `c5` DIFF 0；vue-tsc 0；verify 0。回退点：`git revert` 该提交（纯删除，无数值影响）。

## 4. C3 `appliesToOutOfCombatPanel` 冗余 —— 冗余可简化 · **做成校验，不删字段**

- **为什么**：R5 Z2：与 `scope` 100% 同义，引擎不读；来源是导入脚本 `scripts/import-nanoka-wengine.mjs`。
- **做什么**：加一条数据前提测试（与 `r5DataInvariants.test.ts` 同处）：凡出现该字段，必须等于 `scope === 'outOfCombat'`。
- **为什么不删**：删字段要改导入脚本并重导数据，收益只是少一个同义字段；校验已足以防止两者分叉。
- **第 141 轮结果 ✅**：实测 catalog 里该字段 95 处，全部是 `false` 且同对象 `scope: 'inCombat'`（都在 `wEngines[*].effect.selfBuff / teamBuff`，来自 `scripts/import-nanoka-wengine.mjs:272/275`）。`src/core/__tests__/r5DataInvariants.test.ts` 新增 2 例：检测器夹具自证（同义 0 条、分叉 2 条），以及 catalog 全量同义 + 非空前提。`src/types/catalog.ts:276` 字段加注释。回退点：删这 2 例。

## 5. C6 编排层四层 —— 可结构化 · **只改规划文档**

- **为什么**：全景 §6.2：composables 20 871 行 = 伤害管线后半段 7 217 + 上层分析器 9 418 + 展示几何 2 275 + 胶水 1 961。规划只写了「胶水」。
- **做什么**：在 `docs/ARCHITECTURE.md` §0 的层次图里把编排层拆成「管线后半段（resourceCalc/ + useResourceCalc）」「应用层（分析器 / 优化器）」「展示几何」「胶水」，并写明「最终伤害在 `resourceCalc/damagePool*.ts` 算」。
- **为什么不挪目录**：挪约 60 个文件的 import 路径，行为零变化；在「管线后半段是否并入 core」决定之前挪目录只会挪两次。那个决定的前提是先让 `resourceCalc/` 不再直接读 store（`helpers.ts`、`panelPhases.ts` 仍 import stores），这是更大的工程，**不在 R6 内开**。

## 6. 不做的条目

- **C2 `stores/config.ts` 调引擎（A2）**：它调的是 `calcPanel`、`computeOptimalSubStats`、`buildTeammateBuffSourceContext`，都是只读 catalog 的纯函数，用于默认副词条优化与面板预览。把调用上移到编排层只是多一层转发，不会让架构更通用。**改为改规划**：状态层允许调用 `core/` 的纯函数，禁止调用编排层（composables）与写入引擎状态。
- **C4 局外判定读 `outOfCombatEffectFilter`**：规则只有一条、数据里「局外 + 带条件」为 0；`r5DataInvariants.test.ts`（CC-111）已把「数据出现新情况」变成红灯。把一条假设性规则数据化，没有当前收益，属于为通用而通用。
- **N1 `resourceCalc/helpers.ts` 的 re-export 壳**（`helpers.ts:75`、`:237`、`:277` 三块，给 51 个 `computePanelPhases` 消费者与目录外消费者保留旧路径）：改掉只会统一 import 路径、降低文件计数，没有行为或结构收益，正是 R6 禁止的「为降计数」。
- **N2 `data/moveTableQueries.ts` 读 `logicEditor/fusion.ts` 的全局 shallowRef（A3）**：唯一写入方是 `stores/logicEditor.ts`，读取方在计算入口 `useResourceCalc.ts:222` 已取快照参与缓存键。改成参数要穿过全部招式查询函数，收益仅是「不用全局」，风险与改动面都不成比例。

## 7. 后续顺序（写进队列 §2）

1. ~~C7 第一刀（1481 → 1571）~~ 第 140 轮：1481 ✅、1571 不做（§2.1、§2.2）。
2. ~~C6 规划文档 + C2 规划条款~~ ✅ 第 140 轮。
3. ~~C5 删死参数；C3 加校验~~ ✅ 第 141 轮。
4. ~~C7 §2.3 候选逐个判断~~ ✅ 第 142 轮（§2.4）。
5. C7 §2.5：runtime opt-in 扩展 ① → 迁 promia；② → 迁 jane。
6. 登记的数值差异（§2.4 新发现 1：卢西娅 6 命局外生命）走 CC 卡，排在 §2.5 之后。

### 2.6 第 143 轮结果：runtime `sources.outOfCombat` + 1541 普罗米娅 ✅

- **runtime**（`src/specs/runtime.ts`）：`applySpecAttributeConversions(panel, conversions, coverage = 1, sources?: SpecConversionSources)`，`SpecConversionSources = { outOfCombat?: Readonly<PanelValues> }`。仅当调用方传了 `sources.outOfCombat` **且**条目声明 `sourcePanelPhase: 'outOfCombat'` 时从局外面板读 `sourceStat`（只读不写）；`sourceValue` 回能类来源不受影响；不传 sources ⇒ 与迁移前逐位一致。新单测 `src/specs/__tests__/runtimeSourcePhase.test.ts` 4 例（不传 / 传且 outOfCombat / 传但 inCombat / sourceValue 不受影响）。**现有调用点一个都没补传 sources**（alice、liuyin、luciaElowen、nangong、velina、specs/mechanics.ts、specs/verify.ts），所以 `sourcePanelPhase` 对它们仍只是文档。
- **1541**：spec 新增 `promia_mastery_to_proficiency`（`sourcePanelPhase: outOfCombat`、阈值 150、每点 1.5、`stepRounding: none`、无 cap）+ 2 条 verification（200.5 → 75.75；140 → 0）。`promia.ts`：`applyPromiaPanel` 改为 `applySpecAttributeConversions(panel, promiaConversions(), 1, { outOfCombat: outOfCombatPanel })`（迁移前就读 `outOfCombatPanel.anomalyMastery`，所以零差，且现在 spec 的声明与执行一致）；`computePromiaCycle` 的 `proficiencyFromMastery` 经 `emptyPanel()` 探针走同一执行器；导出常量 `PROMIA_MASTERY_THRESHOLD` / `PROMIA_PROF_PER_MASTERY` 改为从 spec 条目读取（缺条目时模块加载即抛错），`promia.test.ts` 与展示行无需改动。
- **验证**：zd `c7d` DUMP / ROWS DIFF 0（含 `auto-1541-1511-1411/*`）；validate:specs 1114；`src/specs` + `src/mechanics/__tests__` 117 files / 1322 tests；反向验证两项：删 1541 的 stepRounding → verification 得 75 ≠ 75.75；把 runtime 取源改回 `panel` → 「传 sources 读局外面板」单测失败；恢复后 `cmp` 一致。
- **回退点**：1541 spec 删条目与 verifications，`promia.ts` 恢复两个字面常量与手算；runtime 的 `sources` 参数可保留（opt-in，无调用方传时不生效）。
- **登记的缺口 ——【第 146 轮更正：误登记，早已生效，见 §2.9】**（不在重构里补，数值变化须走 CC 卡）：同段原文「每超过 1 点初始异常掌控……提升 0.35% 全队造成的[异放]伤害」**未接入计算**——`computePromiaCycle` 只算 `teamReleaseDmg` 供机制卡展示（行 detail 写「全队向，未接面板（仅展示）」），常数 `PROMIA_TEAM_RELEASE_PER_MASTERY = 0.35` 仍在模块。接入会提高含普罗米娅队伍的异放伤害，需先确认全队异放增伤在引擎中的承载字段（异放走 `releaseModifier`），另开 CC 卡。

### 2.7 第 144 轮结果：runtime 先封顶再乘覆盖率 + 1261 简 ✅；attributeConversions 归一收尾

- **runtime**（`src/specs/runtime.ts`）：`value = min(cap, steps × valuePerStep) × coverage × (conversion.coverage ?? 1)`（原为先乘覆盖率再封顶）。零差前提已复核：调用方只有 promia 显式传 `1`，其余都不传；spec 中带 `coverage` 字段的只有 `1451 lucia_c6_hp_to_atk: 1`。覆盖率为 1 时两种顺序逐位相等，无 cap 时乘法结合顺序不变。新增单测 3 例（`src/specs/__tests__/runtimeSourcePhase.test.ts` 的「先封顶、再乘覆盖率」段）。
- **1261**：spec 新增 `jane_proficiency_to_atk`（`sourceStat: anomalyProficiency`、`inCombat`、阈值 120、每点 +2、`stepRounding: none`、cap 600）+ 2 条 verification（180.5 → 121；500 → 600）。`jane.ts`：面板块改为 `applySpecAttributeConversions(panel, janeConversions(), frenzyFactor)`（frenzyFactor = 狂热开关 × `jane.passionCoverage`，原公式 `min(600, (精通−120)×2) × frenzyFactor` 与新 runtime 语义逐位一致；原 `if (精通 > 120)` 守卫等价于 `max(0, …)`）；`computeJaneMechanic` 的 `atkFromMastery` 经 `emptyPanel()` 探针；机制卡 detail 文案「精通>120每点+2，上限600」改为由 spec 条目拼出。三个常数 `MASTERY_ATK_THRESHOLD / ATK_PER_MASTERY_OVER / ATK_FROM_MASTERY_CAP` 删除。
- **验证**：zd `c7e` DUMP / ROWS DIFF 0（含 `auto-1261-1561-1411/*`，默认 passionCoverage 0.9 ⇒ 覆盖率 < 1 路径被执行）；validate:specs 1120；`src/specs` + `src/mechanics/__tests__` 117 files / 1325 tests；反向验证：删 1261 stepRounding → verification 得 120 ≠ 121；runtime 改回旧顺序 → 新单测 2 例失败；恢复后 `cmp` 一致。
- **回退点**：runtime 恢复 `steps × vps × coverage × convCoverage` 后封顶（当前数据下零差）；1261 spec 删条目与 verifications，`jane.ts` 恢复三常数与手算。
- **attributeConversions 归一到此收尾**：§2.3 的七个候选全部有结论（迁 4：1481、1511、1541、1261；删死写入 1：alice；不做 3：burnice、phoenix、lighter），外加 1571 不做（§2.2）。手写模块里不再有「spec 与模块各写一份」的属性转化常数（1571 的 spec 条目是标注「勿经 runtime」的纯记录）。C7 剩下的是「10 个模块 spec resources 与模块账本重复」，另行评估（全景 §6.4）。

### 2.8 第 145 轮结果：CC-118 卢西娅 6 命改读局外生命 ✅（改数值）

- **改动**：`luciaElowen.ts` `applyLuciaPanel` 传 `{ outOfCombat: outOfCombatPanel }`；`1451.json` 的 `lucia_c6_hp_to_atk` status 改为 implemented。依据：spec `sourcePanelPhase: outOfCombat`，原文「初始最大生命值」（R5：数据可信）。
- **数值**：自写探针（HEAD worktree 与工作区对比，所有含 1451 的预设分别在其槽位设 0 命、6 命）：50 个键里 25 个变化，全部是 6 命，全队总伤害 -0.042% ~ -0.262%（如 yixuan-trigger-lucia 80766976 → 80601508，-0.205%；banyue-trigger -0.262%；auto-1371-1571-1451 -0.042%）；0 命零变化。timeGolden 仅 `agent:1451:c6.dmg` 1175132 → 1169281（-0.498%，单人场景攻击占比更高，所以跌幅更大）。
- **zd 盲区**：`zd cc118` DIFF 0，因为 `/c6` 变体只设 0 号位 6 命，而卢西娅在所有预设里都在 2 号位。
- **验证**：新单测（局内 12000 / 局外 10000 → +200）；反向验证（去 sources 得 240）；vue-tsc 0；CG 25/25；verify（仅上述 golden 1 条）。
- **回退点**：去掉调用的第 3、4 参数，spec status 改回 implemented_approximation，恢复 golden 该值。

### 2.9 第 146 轮结果：CC-119 普罗米娅全队异放增伤——误登记，早已生效（零差修正）

- **实测**：`.zc/perf/cc119probe.perf.ts`（不进 git）遍历含 1541 的预设（auto-1541-1511-1411、auto-1541-1561-1411、auto-1541-1331-1581），用 `panelAt(calc.panels.value, slot)` 读局内面板：两名队友 `anomalyReleaseDmgBonus` 都是 34.524 = (248.64 − 150) × 0.35；普罗米娅自身 69.524，多出的 35 来自专武「朔月裁霜」自身效果（catalog wEngines[79]）。
- **承载者**：spec 1541 teamBuff `promia_ice_team_release_dmg`（formula 型，`sourceStat: anomalyMastery`，`sourcePanelPhase: outOfCombat`，`clamp((x − 150) × 0.35, 0, 999)`），经 `stores/catalog.ts#mergeSpecTeamBuffs` → `core/buff.ts#collectTeammateBuffs` 进入每个队员面板。§2.6 末把它登记为缺口，原因是模块文案写着「未接面板（仅展示）」，而 spec teamBuffs 通道与模块无关、始终生效。
- **改动**（零差）：删除 `PROMIA_TEAM_RELEASE_PER_MASTERY`；`computePromiaCycle` 的 `teamReleaseDmg` 改为在探针面板上用 `applyEffect` 执行同一条 effect（与 `max(0, x − 150) × 0.35` 的 IEEE 运算顺序相同）；4 处文案更正；单测 +1。
- **验证**：zd `cc119` 伤害逐位相同，仅 resourceResult 哈希 18 条差异；临时改回 note 后 zd `cc119b` DIFF 0，证明差异来自文案。反向验证：spec 0.35 → 0.36 时单测红。
- **回退点**：恢复常数与乘法、恢复文案即可；数值不受影响。
- **教训**：登记「数值缺口」之前，先用面板探针实测字段；不要只凭模块注释判断。

### 2.10 第 147 轮结果：全景 §6.4「spec resources 与模块账本重复」评估完成（CC-120）

- **结论：不迁移**。10 份 resources 与 3 份 events 经变异法证明不参与计算（zd DIFF 0，另有阳性对照；预设外的 4 个角色用定向探针补测），只供机制表和逻辑编辑器展示。
- **逐条对照**：81 条一致；4 条不一致（1 条真错已修：1581 `luminizeMasteryRatio` 0.1 → 0.2；2 条语义不同；1 条未决：1471 格挡 4 vs 6）；34 条在模块里没有对应（模块按覆盖率或恒满建模）。
- **不迁移的理由**：结构不同（状态机描述 vs 覆盖率模型），强行对接要么改数值、要么造只为对接的字段；而且真错只有 1 条，收益低；R6 禁止只为降计数的改动。
- 细节、复跑方法和原始表见 `docs/mcp-spec-resources-audit.md`。**C7 至此全部收尾。**

### 2.11 第 150 轮结果：CC-123 南宫羽 / 琉音「初始」转化改读局外 ✅（改数值，预设内零差）

- **结论**：本清单与队列里的未决项「南宫羽 / 琉音『初始』是否读局外」**已结**。原文（`data/raw/nanoka_missing/full/1511.json`、`1481.json`）都写「初始」，两份 spec 却声明 `sourcePanelPhase: "inCombat"`；按 R5「数据可信（原文）」订正为 outOfCombat，模块传 `sources.outOfCombat`（写法同 §2.8 CC-118）。
- **顺带统一展示口径**：`AgentCharConfigInput.outOfCombatPanel`（可选，`src/mechanics/types.ts`）由 `helpers.ts buildCharConfig` 从同一次 `computePanelPhases` 传入；南宫羽资源卡、普罗米娅 `promiaAnomalyMastery` 都改读局外，面板计算与展示不再分叉。
- **为什么零差**：harness / 预设不开局内 buff，局内 = 局外。差异只在用户开启局内暴击 / 掌控 buff 时出现，由新单测覆盖。
- **仍未决**：「每超过 1 点 / 1%」是否取整（§2.1），未动。

### 2.12 第 151 轮：模块里「初始 X」的全量核对（CC-123 的推广）

方法：`git grep -n '初始' -- src/mechanics/agents`，去掉「初始化 / 初始值 / 初始层 / 初始能量 / 初始资源」等资源类用法，逐条对原文（`data/raw/nanoka_missing/full/<id>.json`）看读的是哪个面板。

| 角色 | 原文 | 实现读取 | 结论 |
|---|---|---|---|
| 1511 南宫羽 / 1481 琉音 | 初始掌控 / 初始暴击率 | 局外（CC-123） | ✅ |
| 1541 普罗米娅 | 初始掌控 | 局外（CC-116；展示 CC-123） | ✅ |
| 1451 卢西娅 C6 | 初始最大生命 | 局外（CC-118） | ✅ |
| 1611 克拉蕾 | 初始暴伤 → 初始暴击 | 局外 | ✅ |
| 1121 本 | 初始防御 → 攻击 | 局外 | ✅ |
| 1341 照 | 初始最大生命 → 暴击 | `outOfCombatPanel.hp` | ✅（zhao.ts:142/182 的 `cfg.panel.hp` 用于生命附伤，原文非「初始」） |
| 1131 苍角 / 1311 耀嘉音 / 1411 柚叶 全队攻击 | 初始攻击 × 比例 | formula teammate buff（CC-96 outOfCombatAtk） | ✅ 计算正确 |
| 1411 柚叶 资源卡展示 | 40% 初始攻击 | 原 `cfg.panel.atk`（局内） | ✅ **CC-126 已修（941f597）** |
| 1491 千夏 C6 暴伤 | 初始攻击 × 0.03% | 原局内 | ❌ → **CC-124 已修（862fc15）** |
| 1501 爱芮 异放比例 + 影画1 异放暴击 | 每10点初始掌控 / 初始掌控>100 | 原 damagePool 读局内 | ✅ **CC-125 已修（bf6d184）** |
| 1331 薇薇安 异放比例 | 每10点异常精通（无「初始」） | 局内 | ✅ |

**CC-125 开工方案（下一轮直接做）**：
1. 读 `src/composables/resourceCalc/damagePool.ts` 第 290-310 行附近 `releaseRatio` 分支和 `triggerPanel` 的来源；读 `src/types/resource/execution.ts` 第 180-190 行 `releaseRatio` 类型。
2. 给 `releaseRatio` 加可选字段 `basisPhase?: 'outOfCombat'`（缺省局内 ⇒ 薇薇安零差）；爱芮 `aire.ts` 第 196 行声明 `basisPhase: 'outOfCombat'`。
3. damagePool 取触发者局外面板：先查同文件是否已能拿到 `computePanelPhases(...).outOfCombat` 或 panels 的局外版本；拿不到就在构造 triggerPanel 的地方并排传一份局外面板。**不得**在编排层写 agentId 分支（守卫）。
4. 同时查爱芮 C1 `masteryThreshold`（异放暴击按掌控阈值）原文是否也写「初始」，是则同一字段处理。
5. 验证：爱芮在预设中的位置决定 zd 能否看到；timeGolden `agent:1501:*` 预计变化，逐条解释（局内 / 局外掌控比值）后重生成；加单测（局内 ≠ 局外 → 只随局外变）。

### 2.13 第 152 轮结果：CC-125 / CC-126 ✅；「初始」模块侧核对收口

- CC-125 没有改 damagePool 的取源（编排层拿不到局外面板），而是让事件携带**预算值**：`releaseRatio.basisValue`、`releaseCrit.masteryValue`（可选，缺省局内）。以后其他角色的异放若原文写「初始」，照爱芮写法在 buildCharConfig 记局外值、事件里填字段即可，不必改编排层。
- §2.12 表里的 ❌ 已全部修完。
- **下一步：从原文侧反查**（§2.12 只查了「模块注释里写了初始」的地方，可能漏掉原文写「初始」但注释没写的实现）：
  1. 脚本抽取 `data/raw/nanoka_missing/full/*.json` 与 `public/static/catalog.json`（agents 技能、wEngines、driveDiscSets 描述）里匹配 `初始(攻击力|生命值|最大生命值|防御力|暴击率|暴击伤害|异常掌控|异常精通|冲击力|能量自动回复|穿透率)` 的句子，按（id，属性）去重。
  2. 每条对实现：spec attributeConversions 的 `sourcePanelPhase`、catalog 效果的 formula basis（CC-96 outOfCombatAtk 口径）、模块 applyPanel / buildCharConfig 读的面板。
  3. 结果表写进本清单 §2.14；读局内的开 CC 卡（CC-127 起），走 CC-123 ~ CC-125 的模式（原文为准、阳性对照单测、zd + timeGolden 逐条解释）。
  4. 规模预估：句子上百条，可派 dsh，但**要按角色分批**（每批 ≤ 10 个角色）并要求边做边追加结果文件，避免 1500s 超时丢结果（第 151 轮教训）。

### 2.14 第 153 轮：「初始」原文侧反查结果

抽句脚本（输出不进仓库）：对 `data/raw/nanoka_missing/full/*.json`、catalog `wEngines` / `driveDiscSets`、`teammate-buffs.json` 去标签后匹配 `初始(攻击力|最大生命值|生命值|防御力|暴击率|暴击伤害|异常掌控|异常精通|冲击力|能量自动回复|穿透率|贯穿力)`，按（来源 id，属性）去重，得 38 条。

| 来源 | 属性 | 实现 | 结论 |
|---|---|---|---|
| 1121 / 1341 / 1451 / 1481 / 1491 / 1501 / 1511 / 1541 / 1611 | 各类 | 局外（CC-116/118/123/124/125 等） | ✅ |
| 1131 / 1311 / 1411 / 1421 / 1581 全队 buff（teammate-buffs） | 攻击力 | derived/formula `sourcePanelPhase: outOfCombat` | ✅ |
| 1391 橘福福虎啸 | 攻击力 ≥2800 | teammate formula，outOfCombat | ✅ |
| 1301 奥菲丝 / 1521 希希芙 | 能量自动回复 | teammate formula，`sourceStat: energyRegenTotal` + outOfCombat | ✅ |
| 1561 维琳娜 | 能量自动回复 | spec `sourceValue: energyRegenOutOfCombat` | ✅ |
| 1171 柏妮思 | 能量自动回复 | `panel.energyRegenOutOfCombat` | ✅ |
| 1151 露西 | 攻击力 | 直接取封顶 600（fixed） | ✅ 有意近似 |
| D34200 荆棘玫瑰 4 件 | 防御力 ≥1000/1800 | `requirement.outOfCombatStat` | ✅ |
| 1071 凯撒 / 1271 赛斯 | 冲击力 / 攻击力 → 护盾 | 护盾不影响伤害 | 不适用 |
| **1621 洛克茜** | 能量自动回复 | 原读基础回能 `energyRegen` | ❌ → **CC-127 已修**（真 bug） |
| **1571 诺姆** | 暴击率 | 原读局内 | ❌ → **CC-128 已修** |
| **1461 席德** | 攻击力（选正兵） | ~~`level60.atkBase`~~ → `cfg.outOfCombatPanel.atk` | ✅ CC-129 `850246fc` |

**结论**：「初始」这一类在模块侧（§2.12）和原文侧（本节）都已查完。除 CC-129 外，全部口径正确或有意近似。

**CC-129 开工方案**（✅ 第 154 轮已按第 2 步「能拿到」分支完成，`850246fc`；以下保留为记录）：
1. 读 `src/mechanics/agents/xide.ts` 的 `applyXideTeamConfig`（build 阶段）与 `AgentTeamConfigInput`（`src/mechanics/types.ts`），确认 build 阶段能否拿到各队友的局外面板（team 成员上可能有 panel / outOfCombat 字段；没有就看 `sourcePanelsByOwner` 之类的现成结构）。
2. 能拿到：改为按队友局外 `atk` 选；拿不到：改为 `level60.atkBase + 音擎 level60.atkBase`（仍是近似，但更接近「初始攻击力」），并在注释写明。
3. 验证：zd（席德预设里若只有 1 名强攻队友则零差）+ 探针（两名强攻队友、装备差异使选人翻转）。

**方法沉淀（字段语义）**：`PanelValues.energyRegen` 是**基础**回能，局外总回能在 `energyRegenOutOfCombat`，teammate formula 用 `sourceStat: energyRegenTotal`。以后写「按回能」的机制一律读后两者。

### 2.15 字段语义误读扫描（第 154 轮，洛克茜 CC-127 的同类排查）

**范围**：`PanelValues` 中注释标「基础」语义的字段（`src/types/catalog.ts` 第 42-60 行：`energyRegen`、`flashEnergyRegen`），两组加成字段（`energyRegenBonusPct/Flat`、`flashEnergyRegenBonusPct/Flat`），以及机制 / spec / core / 编排层对 `agent.level60.*` 的直接读取。方法：`timeout 40 git grep -n <字段> -- src | grep -v __tests__`，逐处判断「想要基础值还是总值」。

| 字段 | 读取点 | 判断 |
|---|---|---|
| `energyRegen` | 第 153 轮已查：resourceIncome 基础×加成、StatPanel「基础自动回复」、buff.ts / runtime.ts 的 `energyRegenTotal` 合成、1561 spec 走 `energyRegenOutOfCombat` | ✅（洛克茜 CC-127 是唯一误读，已修） |
| `flashEnergyRegen` | `core/resource/resourceIncome.ts:44` 基础×加成；`core/buff.ts:479` `flashEnergyRegenTotal` 合成；StatPanel / FinalPanel / DebugPage 展示（标「基础」或旁边有加成行） | ✅ 全部有意取基础 |
| `energyRegenBonusPct/Flat` | `panelPhases.ts:563` 合成局外总回能；buff.ts / runtime.ts 合成；burnice.ts:293 优先读 `energyRegenOutOfCombat`、回退自算；rina.ts:374 写入 | ✅ |
| `energyRegenTotal`（teammate formula） | 1301 奥菲丝、1521 希希芙，原文「初始能量自动回复」，source 面板为局外（§2.14 已判） | ✅ |
| `level60.*` | `core/panel.ts` 面板构建本身；`helpers.ts:475` 命破判定；claret.ts 锐能基础累积 `sharpnessRegen`（无加成来源）；xide.ts 选正兵 | ✅；xide 已由 CC-129 修正 |

**结论**：除 CC-129（已修）外没有新的误读。顺手修正零差注释 `src/mechanics/agents/velina.ts` 回能转模一处：原注释写「加成只体现在 energyRegenTotal」，与实际 spec `sourceValue: energyRegenOutOfCombat` 不符，已改为说明读局外总回能。

**方法沉淀**：build 阶段（`applyTeamConfig`）需要队友「初始属性」时，读 `characters.find(c => c.slot === s)?.outOfCombatPanel`（CC-129 起编排层通用挂载），不要读 `agent.level60.*`。

### 2.16 队友 buff 作用对象核对（第 155 轮，CC-130）

**问题类别**：teammate-buffs.json 的效果没有「接收者」字段（`target.kind` 只管技能范围：default / skill / teammate / self），编排层对每个接收槽下发**同一份** `enabledTeammateBuffs`，**来源本人也会吃到自己那组**。原文只给特定队友的拐，静态数据只能按全队近似。

**通道（CC-130 起）**：模块能力 `teammateBuffRecipientFilter`（契约见 `src/mechanics/types.ts`）。按接收槽返回要剔除的本人 inCombat 效果 id；需要比较队友「初始属性」时用入参 `getOutOfCombatPanel(slot)`。首个消费者是席德 1461。

**全库扫描**（conditionLabel / description 匹配「全队生效近似 / 多吃 / 按全队 / 全队近似 / 指定队友 / 一名队友 / 当前操作角色 / 前台角色」）：

| buff | 标注 | 判断 |
|---|---|---|
| 1461 `seed.core_vanguard_bright_attack` / `seed.cinema_2_encirclement_def_ignore` | 按全队近似，第三人多吃 | ❌ → ✅ CC-130 已修 |
| 1451 `lucia_elowen.cinema_2_darkbreaker_sheer_dmg` | 「破暗随每次合唱重挂且持续 20 秒，按全队近似」 | ✅ 第 156 轮核：原文「卢西娅发动[合唱]时，为全队角色施加[破暗]状态」，全队本来就对 |
| 1341 `zhao.cinema_1.off_field_res_ignore` | 原文「使全队角色」 | ✅ 全队本来就对 |

**局限**：这次扫描只抓到**标注了近似**的条目。原文是单体、但录入时没标注的 buff 扫不出来，要从原文侧反查（raw 文本里「[某状态]的代理人 / 当前操作角色 / 指定」这类单体措辞，对照 teammate-buffs 效果）。

**第 156 轮补充：来源本人实测 + 说明文字单体措辞扫描**

- **实测**（临时探针，已删）：对 29 个 buff 组，每组队伍 = [来源角色, 1081, 1031]（来源是其中之一时换 1191），6 命、推荐配装，开关整组 buff，逐槽比较局内面板全部数值字段。结论：**除已声明 `excludeTargetAgentIds` 的 4 处（1341 影画2 治疗攻击、1581 影画1 / 影画2 系数、1211 核心穿透率）和 CC-130 过滤的席德外，来源本人都吃自己那组。** 原文写「全队」的拐这样是对的；原文写「队友 / 其他角色」的必须声明 `excludeTargetAgentIds: [本人 id, teammateBuffId 别名]`（`src/core/buff.ts:505` 消费）。
- **说明文字扫描**（description 匹配「该角色 / 该队友 / 入场 / 切换 / 下一 / 被支援 / 接替 / 当前操作 / 视为 / 指定 / 一名 / 其他队友 / 处于或拥有[x]状态的」）命中 12 条，判断：

| buff | 原文要点 | 判断 |
|---|---|---|
| 1611 `claret.gleaming_edge_teammate` | 「复制给击破 / 锋御队友」 | ❌ → **CC-131 删除**：v12 原文没有此效果（测试服残留） |
| 1421 `pan_yinhu.core_open_meridians_sheer_force` | 「入场的下一位代理人获得[通窍]」 | ✅ CC-133 已排除本人（零差）。原判断：本人不该吃（他是触发支援的一方）。潘引壶是防护、伤害不走贯穿力，预计零差；低优先，做法 = 该 buff 加 `excludeTargetAgentIds: ["1421", <teammateBuffId>]`，zd 确认零差 |
| 1131 `soukaku.core_fly_the_flag_atk` | 本人攻击提升，并传递给经展旗入场的队友 | ✅ 一轮里两名队友都可能接到，全队近似合理 |
| 1581 影画1、1341 影画1、1071、1251、1311、1391、1481、1451 | 全队 / 敌人减益 / 已排除本人 / 非面板效果 | ✅ |

- **新教训**：初始提交（2026-08-18）就存在、后来角色又「重录」过的 buff，可能是测试服残留。**下一步的系统做法**：对 teammate-buffs 每个效果，检查它的数值（如 `20` + `%`、`1000` + `点`）是否出现在该角色原文里，出现不了的列为嫌疑逐条核。

### 2.17 队友 buff 数值 ↔ 原文对账（第 157 轮）

**方法**（脚本已固化为常驻测试 `src/mechanics/__tests__/teammateBuffRawNumbers.test.ts`）：对 `public/static/teammate-buffs.json` 每个效果的 `value / ratio / cap / valuePerStack`，在 `data/raw/nanoka_missing/full/<组id>.json`（去标签）里找「紧跟 % / 点 / 秒 的数字」或 `{CAL:...}` 模板在技能等级 1–16 下的求值（含 ×100 形式）。

**结果**：29 组、106 个数值字段（另 15 个效果只有 formula）。宽松判据（任意数字）与严格判据（带单位）结果相同：只有 1 条对不上。

| 条目 | 数据 | 原文 | 结论 |
|---|---|---|---|
| 1411 柚叶「狸之愿」增伤 `effect_68de5894c8` | 15.04 | 「伤害提升15%」 | ❌ → **CC-132 订正为 15** |

**formula 常数核对**（不进常驻测试，因常含推导值）：15 个 formula 中 5 个常数在原文里没有字面出现，逐条核过都是推导值：
- 耀嘉音 `special_aria` 的 `x + 8`、`x * 1.5 + 7`：按技能等级 x 的线性拟合（端点 9/24、8.5/31 在原文里）。
- 耀嘉音影画2 `0.54`、`1600`：= 核心 0.35 + 影画2「额外提升19%」，1200 + 「上限额外提升400点」。
- 希希芙 `0.12`：原文「超过部分每超过0.12」（不带单位，严格判据漏配，宽松判据命中）。
- 卢西娅 `612 + s * 24`：就是原文 `{CAL:612+AvatarSkillLevel(1)*24}` 模板。

**局限**：数字巧合匹配时抓不到（如 CC-131 克拉蕾的 20%、10% 在原文别处出现过，本测试抓不到那条，是靠单体措辞扫描 + 查原文发现的）。所以本测试只拦「数字对不上」的笔误 / 残留，不能证明效果本身存在。

### 2.18 「每超过 / 每拥有 N」取整口径（第 158 轮，CC-134）

**结论（已拍板）**：原文写「每超过 N 点 / 每拥有 N 点 …… 提升 M」的属性转化，**一律 floor 整步**：steps = ⌊(源值 − 阈值) / N + 1e-9⌋。

**依据**：
1. 原文字面：「每……会使……提升」描述的是离散的步，不是连续比例。
2. 仓库现状：步长不为 1 的实现（安比 12%、莱特 10 点、柏妮思 0.1 回能与 10 精通、奥菲 0.1、照 400、橘福福 100、卢西娅 200、希希芙 0.12、维琳娜 0.01）**全部**已是 floor；步长为 1 的也有 floor（爱丽丝、诺姆、伊德海莉、卢西娅 C6）。用连续算法的都是步长为 1、写成 `over × k` 的早期实现，注释自己标着「取整与否未决」。
3. 游戏把属性存成整数的基本单位（原文 `stats.crit_damage=5000` 即 50.00%），分步效果不可能在单位以下连续。
4. 没有可用的公开资料能区分两种口径（查过：社区只有「220 冲击力吃满」这类端点说法，两种口径在端点上结果相同）；按约束不引入实测。

**影响量级**：每条最多少一步（如琉音少 ≤2 冲击力、普罗米娅少 ≤1.5 精通），多数预设 |Δ| < 0.1%。
**回退**：逐条可逆——spec 恢复 `stepRounding: "none"`；模块或公式改回连续写法。`stepRounding` 字段保留，就是为了这个。

**全量清单**（原文扫描：`data/raw/nanoka_missing/full/*.json` 中「每超过 / 每高于 / 每拥有」，排除「每拥有一层」这类天然整数；扫描脚本 `/home/kaua/calc-arch/step158.py`）：

| 角色 | 原文要点 | 实现位置 | CC-134 前 | 现状 |
|---|---|---|---|---|
| 1011 安比 影画4 | 每拥有 12% 能量获得效率，回能 +2 | `anby.ts` 约 98 行 | floor | ✅ floor |
| 1051 伊德海莉 | 生命值 → 贯穿力（步长 1） | spec | floor | ✅ floor |
| 1161 莱特 额外能力 | 冲击力 >170 每超过 10 点，每层昂扬 +0.25% | teammate-buffs 公式 `floor(max(0, x - 170) / 10)` | floor | ✅ floor |
| 1161 莱特 | 冲击力 >170 每超过 1 点，[火焰冲击]倍率 +5% | `lighter.ts` 157 行 `floor(impact) - 170` | floor | ✅ floor（第 159 轮核实：阈值是整数，对冲击力取整后减阈值，等价于整步） |
| 1171 柏妮思 潜能 | 回能 ≥1.8 超过部分每 0.1 | `burnice.ts` 166 / 285 行 | floor（+1e-9） | ✅ floor |
| 1171 柏妮思 | 每拥有 10 点精通，余烬伤害 +1% | `burnice.ts` 175 行 | floor | ✅ floor |
| 1251 青衣 额外能力 | 冲击力 >120 每超过 1 点，攻击 +6 | `qingyi.ts` 127 行 `over * 6` | 连续 | ✅ **CC-135 → floor**（零差：预设冲击 233.7，攻击加成已封顶 600） |
| 1261 简 | 精通 >120 每超过 1 点，攻击 +2 | spec | none | ✅ **CC-134 → floor** |
| 1301 奥菲 | 回能 ≥1.6 超过部分每 0.1，攻击 +20 | teammate-buffs 公式 floor | floor | ✅ floor |
| 1341 照 | 生命 >15000 每超过 400，增伤 +1% | teammate-buffs 公式 floor | floor | ✅ floor |
| 1361 扳机 | 暴击 >40% 每超过 1%，追加攻击失衡 +1.5% | `trigger.ts` 212 行 `overCrit * 1.5` | 连续 | ✅ **CC-135 → floor** |
| 1391 橘福福 | 攻击 ≥2800 每超过 100，暴伤 +5% | teammate-buffs 公式 floor | floor | ✅ floor |
| 1401 爱丽丝 | 掌控 >140 每超过 1 点，精通 +1.6 | spec | floor | ✅ floor |
| 1411 柚叶 | 掌控 >100 每超过 1 点，积蓄效率 +0.2% 等 | teammate-buffs 公式 `clamp((x - 100) * 0.2, 0, 20)` | 连续 | ✅ **CC-135 → floor**（公式改为 `clamp(floor(max(0, x - 100) + 1e-9) * 0.2, 0, 20)`） |
| 1451 卢西娅 破暗 | 每拥有 200 点初始生命，贯穿力额外提升 | teammate-buffs 公式 `floor(x / 200)` | floor | ✅ floor |
| 1451 卢西娅 C6 | 生命 → 攻击（步长 1） | spec | floor | ✅ floor |
| 1481 琉音 | 暴击 >50% 每超过 1%，冲击力 +2 | spec | none | ✅ **CC-134 → floor** |
| 1501 爱芮 影画1 | 掌控 >100 每超过 1 点，异放暴击率 +0.5% | `damagePool.ts` 约 260 行（连续减阈值） | 连续 | ✅ **CC-135 → floor** |
| 1501 爱芮 核心 | 每 10 点初始掌控 → 异放比例 | `damagePool.ts` 约 311 行 `basisValue / 10` | 连续 | ✅ **保持连续，不属本规则**（第 159 轮判定，见下） |
| 1511 南宫羽 | 掌控 >110 每超过 1 点，冲击力 +1 | spec | none | ✅ **CC-134 → floor** |
| 1521 希希芙 | 回能 >1.4 超过部分每超过 0.12 | teammate-buffs 公式 floor | floor | ✅ floor |
| 1541 普罗米娅 | 掌控 >150 每超过 1 点，精通 +1.5 | spec | none | ✅ **CC-134 → floor** |
| 1561 维琳娜 | 回能 >1.2 超过部分每超过 0.01 | spec | floor | ✅ floor |
| 1571 诺姆 | 暴击 >50% 每超过 1% | ~~spec~~ 实为 `norma.ts` 连续计算（spec 条目不执行，本行原记录有误） | 连续 | ✅ **CC-212 → floor**（`7b2af5ce`，第 235 轮：模块改为经 `specConversionAmount` 读 spec，口径才真正生效；`auto-1371-1571-1451` −3.94% 属悬崖效应，见 stun-dual-source §24.59） |
| 1611 克拉蕾 核心 | 每拥有 1% 初始暴伤，初始暴击率 +0.35% | `claret.ts` 195 行 `initialCritDmg * 0.35` | 连续 | ✅ **CC-135 → floor**（零差：预设局外暴伤 = 50） |
| 1621 洛克茜 | 回能 >1.2 超过部分每超过 0.01，攻击 +5、冲击 +0.4 | `roxy.ts` 305–306 行（攻击为连续值再 `Math.round`，冲击连续） | 连续 | ✅ **CC-135 → floor**（`0028eb01`；零差：攻击和冲击都已封顶） |

**已知坑：外层不动点对微小输入敏感（不是本卡引入的）**。`auto-1201-1481-1211/c6`：琉音局内冲击力 208.8 → 208（−0.8），失衡累积只降 0.7%，但规划失衡次数 `plannedStunCount` 从 0.70 跳到 1.12、外层轮数 3 → 4，总伤 +5.34%。timeGolden `auto-1021-1481-1341` 同类：规划失衡 1.24 → 1.13，两个槽各多 1 次强化特殊技，+1.0%。和 `docs/mcp-outer-feedback-regression.md` 记录的「计划失衡输入 2.59 → 1.54」是同一类路径依赖。探针模板：本地 `/home/user/w/up/zzProbe158.test.ts`（放到 `src/composables/__tests__/` 跑，用完删）。**处理**：这里只记录不修；以后改数值遇到「输入变小、伤害反而大涨」，先查 `plannedStunCount` 与外层轮数，不要当成改动本身的效果。是否值得做「不动点连续性」专项，排进交接候选。

**顺带发现：`seedInvariance` 的活性自检早已空转（同提交已改写）**。`src/composables/__tests__/seedInvariance.test.ts`「全库预设 × 冷/高/低/校准」一档要求 `ledgerExercised > 0`，意思是至少一个槽在不同种子下出现时间账的守恒式再分配，借此证明「种子通道没断」。实测（临时打印触发槽，改前和改后的 spec 各跑一次）：
- CC-134 前全库唯一触发的是 `auto-1051-1481-1451` 高种子的两个槽，差值 1.4e-14 / 2.8e-14，是浮点末位噪声。注释声称校准种子能让 `auto-1591-1571-1211` 移动落点，这一说法已失效。
- CC-134 让琉音冲击力变成整数，噪声消失，自检变红（verify181 EXIT=1 的唯一失败）。但种子通道没有坏，是自检度量的东西不对。
- **决定**：改为直接度量「种子被引擎用上」，即种子运行的 `iterations`（内层迭代轮数）与冷启动不同的 (预设, 种子) 对数 > 0。反向验证：让 `run(seed)` 丢弃 `initialStates` 时，新自检精确变红。断言②（守恒式再分配）保留为守卫，触发数写进失败信息。**不采纳**的做法：为了让旧自检变绿去造一个会移动落点的种子。那是为了判据而造样本，违反 R6 / R8「判据是工具不是目标」。
- 回退点：从 `git show <CC-134>~1:src/composables/__tests__/seedInvariance.test.ts` 取回旧文件；但旧自检在 CC-134 之后必红，要回退就得连 spec 一起回退。

**第 159 轮补充（CC-135）**：
- 表中「CC-135 待改」6 行已全部改为 floor（`0028eb01`），逐条归因见卡表 CC-135。至此 §2.18 表内没有待改项。
- **爱芮 / 薇薇安「每 10 点 → 异放比例」判定为不属本规则，保持连续**。原文是「相对于原属性异常伤害的比例为**每10点**初始异常掌控 13.8%/…」（1501）和「……比例为每10点异常精通 3.59%/…」（1331）。这是在定义比率单位（相当于每点 1.38%），没有「超过 / 拥有 …… 提升」这种分步动词，也没有阈值。对比柏妮思「每拥有10点异常精通，[余烬]造成的伤害提升1%」是分步句式，所以取 floor。回退：若日后认定也要 floor，改 `damagePool.ts` `releaseMultiplierFor` 里的 `basisValue / 10` 为 `Math.floor(basisValue / 10 + 1e-9)`，会同时影响爱芮和薇薇安。
- **外层不动点敏感，第二例**：`auto-1201-1361-1211/c0`，扳机失衡增幅至多少 1.5%，失衡累积实测 +0.02%（几乎没变），但 `plannedStunCount` 2.98 → 2.34、内层迭代 4 → 2、外层轮数 7 → 5，总伤 −1.74%。连同第 158 轮的琉音例（+5.34%），两轮连续两次碰上，已升为下一步第一优先（见队列第 159 轮交接）。
- **旁支（第 194 轮已关闭：局外回能 160% 全是局外加成，3.12 正确；局外面板的 1.2 是未盖章残留，已同时盖章。见 stun-dual-source §24.16）**：探针读到洛克茜的**局外**面板 `energyRegenOutOfCombat = 1.2`，而**局内**面板同字段为 3.12（`roxy.ts` 读的是局内面板上的这个字段）。要查的是：3.12 是否只含局外加成（`panelPhases.ts` 写入 `energyRegenOutOfCombat` 的位置），以及局外面板上的 1.2 是缺省值残留还是读法差异。3.12 = 1.2 × 2.6，偏高，要排除混进了局内回能加成。

## 8. 自选候选扫描记录（第 237 轮起；无排定项时先读这里，别重复扫）

§0 总表全部结项（C1–C7、N1、N2 都已 ✅ 或写了「不做」）。之后没有排定项的轮次，按「让架构更通用 / 更简单」自选，已查过的范围记在下表。**重开条件**写在每行，条件不满足就不要再扫同一处。

| 轮次 | 查了什么 | 结论 | 重开条件 |
|---|---|---|---|
| 236 | spec 里 21 条「实现位置：」纯记录条目与模块代码是否一致 | 除 1571（CC-212 已修）外无分叉；validate-specs 改为逐条认定消费（CC-213） | 新增带「实现位置：」的条目 |
| 237 | 外层不动点「物理失衡次数整数台阶」 | 第 161 轮已裁决：不是缺陷，不修（`mcp-outer-fixedpoint-continuity.md` §5） | 出现「物理次数不变、伤害却跳」的反例 |
| 237 | 规划失衡 / 物理次数双源（坑 25 残差） | 由 `mcp-stun-dual-source.md` 整线处理（§1–24.x），ENGINE_PIPELINE_GUIDE 已无「仍双源」表述 | 连携按实际失衡次数改造开工前（坑 25 ⟳，到期 2026-10-31） |
| 237 | 坑 37「部署态失衡易伤只兑现两成」 | 产品级口径，没有外部真值锚点就无法裁决；方向 B（受控实测）暂缓，R5 又禁止引入实测 ⇒ **不做** | 用户宣布进入数值校准阶段（REQUIREMENTS 出现相应条目） |
| 237 | LONG-TERM-DIRECTIONS 的 A–E | A 已否决；B 暂缓；C 第 2 刀 = CC-99 不做；D 只适合设计（依赖 B）；E 依赖 B 的原子 | 同上 |
| 237 | 机制账本 pending（40 项）是否过时、导致缺口清单出现假缺口 | 抽读全部条目：都是如实记录的近似说明（非轴按覆盖率、未逐时序等），不是过时条目 | 实现提交改了某角色机制却没回写 pending（队列 §1 CC-89 规则） |
| 237 | 模块里「轴按捏轴 / 非轴按覆盖率」的重复 | isAxis 分支集中在 9 个模块；覆盖率 helper 各有各的物理量，没有两处算同一个量；`axisStunFor` / `ultimateInAxisFraction` 已由 `damagePool.ts:138/349` 统一提供 | 出现第二处自算轴内占比 |
| 237 | ⟳ 复核触发器是否有已到期项 | 只有测试夹具里的日期；真实最早到期 2026-10-31（坑 25） | 2026-10-31 |

**第 237 轮决定**：以上都不满足判据，本轮不改代码。依据：用户明确不要「只为有事做 / 降计数」的改动。影响：无。回退点：无（纯文档）。
| 238 | 展示层「code → 中文名」映射副本 | 元素 / 属性名 12 处副本已收（CC-214，`361abc6f`）；**职业名 `SPECIALTY_LABEL` 还有 6 份**（agentLabelMaps、ResourcePage、WEngineFieldPage、MultiplierCoeffPage、teamCompareSweep、CharacterCard），见队列 §2 下一步 1 | 职业名收完后，再有新副本由源码锁拦下 |
| 239 | 职业名 `SPECIALTY_LABEL` 副本 | 7 处已收（CC-215，`7eb7c11a`），修了两处可见缺项；展示层 code→中文名这一类到此收完 | 源码锁拦截新副本；其他「code→中文」类映射（稀有度颜色、职业颜色等）未查，见队列 §2 |
| 240 | `stores/config.ts` 的 computed / getter 与引擎是否在算同一个量 | `effectiveTime` 写死 180（CC-216，`95901f50`，已收）；`counterAssistSlot`、`selectedChar/Agent/WEngine`、`usedAgentIds` 是纯选择读取，不重复；CC-206/207 已收 buff 门控。**stores/catalog.ts（14 个 computed）与 logicEditor.ts 没查** | 查 catalog / logicEditor 的 computed |
| 241 | `stores/catalog.ts`（14 个 computed）、`stores/logicEditor.ts`（6 个） | 无重复（§24.65）。顺带收了失衡窗口占比 4 份副本（CC-217，`3ba7af41`）。stores 这条线查完 | — |
| 242 | `core/effectiveTime.ts` 其余口径的手写副本；core @fact 算式；暴击期望 | 窗口时长、扣无敌秒各 1 份已收（CC-218，`90f51ade`），effectiveTime 收口；暴击期望只有 1 处；@fact 多为行为口径，没有可 grep 的算式 | 新增时间类公式时锁测试会拦 |
| 243 | 伤害公式防御 / 抗性乘区副本 | 3 份收进 `core/damageMultipliers.ts`（CC-219，`257e042c`）；积蓄 / 失衡抗性区同形但口径独立，不归一 | 锁测试拦新增内联 |
| 244 | 增伤区 / 精通区 / 失衡易伤区副本 | 增伤、精通只是 `1+x/100` 通用写法且组成各异，不做；耀变手写失衡易伤区收进 `calcStunMultiplier`（CC-220，`dc096e98`，修覆盖率当布尔，蕾米队 −11～16%）；伤害乘区线收尾 | 锁测试拦新增内联失衡区 |
| 245 | 角色模块自带伤害公式；`stunned` 真假判断残留 | mechanics 与 resourceCalc 没有另一份手写伤害公式；core/damage.ts 两处展示按乘数判定（CC-221，`253257e4`，零数值差）；伤害公式线收尾 | — |
| 246 | 暴击期望 / 暴击率钳制副本 | 8 处收进 `src/data/critMultiplier.ts`（CC-222，`f4e45890`）；伤害公式线至此无尾巴 | 锁测试拦新增内联 |
| 247 | 展示层（FinalPanel / StatPanel）乘区与引擎对账 | 2 处口径不同已修（CC-223，`7eb4eace`）；失衡 cap 字段无写入方，不修；展示层对账线收尾 | 结构锁 anomalyElement.test |
| 248 | 元素 → 面板字段名映射表 | 10 份收进 `src/utils/elementStatKeys.ts`（CC-224，`f1db965e`），`core/elementKeys.ts` 删除 | 源码锁 elementStatKeys.test |
| 249 | 元素字段名手拼 / StatPanel 前缀表副本 | 并入 utils/elementStatKeys（CC-225，`f361972f`），元素线结项 | 源码锁 elementStatKeys.test 第 4 例 |
| 250 | 失衡易伤展示反推（stunVulnSummary / stunVulnDisplay 各一份，且基数假设错） | 行携带引擎实值，反推收成单一回落（CC-226，`f9be411d`） | stunVulnSummary.test CC-226 三例 |
| 251 | 特殊动作喧响每槽次数两处组装（引擎 convergence / 展示 useResourceCalc） | 展示直读引擎结果（CC-227，`661133cd`） | specialActionBonusSingleSource.test |
| 252 | 贯穿力公式 4 份（core 1 + 展示 3） | 下沉 data/penetrationPower（CC-228，`2ba355d0`） | penetrationPower.test 源码锁 |
| 253 | 保底4喧响提示在展示层重算缺口（口径与引擎不同） | 引擎结果带出 decibelGuarantee，展示直读（CC-229，`4e03fc6f`） | decibelGuarantee.test 源码锁 + 真队断言 |
| 254 | 展示层 `* 0.x` 全量与 resourceResult 读者；喧响队友伴随规则 3 份 | `* 0.x` 除卡片外都是绘图 / 估时；resourceResult 读者都是直读。伴随规则收进 data/decibelCompanion（CC-230，`f49a183f`）；**「展示层手写引擎公式」线结项** | 新增展示代码出现与 core 同形算式 |
| 255 | 喧响单价的全部读者 | 失衡池 decibelBonus 是无引擎消费者的展示字段，删（CC-231，`6b99e293`）；单价 215/10/10/20 下沉 data，结果页说明文字改为生成（CC-232，`70cddc3c`）；**喧响线结项** | 新增喧响来源 |
| 256 | 结果接口 570 个字段的读者分类（fieldscan.mjs） | 模块诊断字段、测试可观测量不做；死字段 specialResources 删；卡片明细漏列两项已补（CC-233，`2e7e2c4c`），并加「明细之和 = 总数」锁 | 引擎新增 total 组成项（锁会红） |
| 257 | 各页「明细 vs 总数」；视图重算 useResourceCalc 导出聚合量 | 明细只有结果卡（CC-233 已锁）；ResultPage 另算队伍总伤害，改为直读（CC-234，`09575566`）；stunCoverage 无近似副本；**视图重算线结项** | useResourceCalc 新增导出聚合量 |
| 258 | 换层：resourceCalc 内部与 mechanics/agents 之间的重复 helper（跨文件同形扫描，29 组） | resourceCalc 没有真实重复（结项）；agents 的 `setting:${id}` 读取协议 37 份、4 种变体，收拢到 utils/mechanicSettingCfg（CC-235，`960c00d3`）；findMoveById / rowValue 待核；clamp / whole 倾向不做 | agents 新增私有 cfg 读取器（锁会拦） |
| 259 | agents 重复 helper 第 2 族：findMoveById / findMove | 25 个模块 + StunAxisPage 的副本收拢到 data（CC-236，`51f52f7e`）；抄写理由「避免依赖 composables」已失效；rowValue 族有 3 种语义（含融合 / 不融合 / 取 12 级），不能直接合并，下一轮先查不融合调用点有没有碰到融合登记的招式 | agents 新增私有招式查找（锁会拦） |
| 260 | agents 重复 helper 第 3 族：rowValue 族 | 行乘数来自逻辑编辑器，不是 moveFusions；私有副本漏乘，与 R37-J1 同型 ⇒ 收拢到 data getRowValue（CC-237，`a6471949`）；新发现引擎（core moveLookup、resourceCalc 多处、specs）也有约 30 处内联原始读取，下一轮裁决行规则作用面 | 新增私有取行值函数（锁会拦） |
| 261 | 行规则作用面裁决；复核 CC-237 | 发现 spec 默认启用规则在生产生效、测试态为空；CC-237 误并焰烈 rawRowValue 造成生产回归，由 CC-238（`c512f97c`）修复；作用面 = 该招式该行的一切倍率表取值；core 保持纯函数，不直接依赖 fusion | 新增默认启用规则（绊线会拦） |
| 262 | 行规则作用面候选 1：resourceCalc 内联原始读取 | 赠送 / 手放行（CC-239，`01889e4d`）、治疗 / 专属回复（CC-240，`97404d67`）改吃规则；panelPhases 积蓄属性判定不做；登记表锁防止新增内联读取 | resourceCalc 新增 `.values[0]`（登记表锁会拦） |
| 263 | 行规则作用面候选 1：specs/mechanics 事件载体原始读取 | CC-241（`652c7c18`）改走 data 单一来源；生产零差（仅 usesOverride 时 base 生效，现存 spec 无 ratio）；源码锁拦截 specs 新增 `.values[0]` | 将来声明非 damage 的 multiplierRowId 会撞上 buildExecutions 的 damage 闸 |
| 264 | 行规则作用面候选 2：角色模块内联原始读取 | CC-242（`79951791`）5 个模块改走 getRowValue，登记表锁；multiplierCoefficients 不做（系数分析需要原表）；moveLookup 已给出设计，待量 | 喧响通道（channelMetricsOf）仍读原值，见 §24.88 ⑥ |
| 265 | 行规则作用面候选 3：core/moveLookup；未决项 ultimatePromote:218 | CC-243（`a5df49c4`）注入式吃规则；CC-244（`275ec8b4`）赠送终结技失衡取融合组。全仓扫描后**行规则作用面结项**（§24.89 ④） | 新增绕开 getRowValue / fusedRowReader 的取值（各层锁会拦） |
| 266 | 融合组「一次完整动作」口径：19 个组头的全仓引用 + resourceCalc 直取 getRowValue | 无剩余真实偏差（千夏 extraExPlans 数据等价；手放表直伤潜在但触发不到；yanagi 追加突刺故意取头段）（§24.90 ①） | 融合组后段出现喧响 / 时长，或手放融合组头段成为常见用法 |
| 266 | C6 前提：resourceCalc 读 store | 从不调用 useXStore；唯一值导入 helpers:17-18 改 type-only（CC-245，`99e1be54`），闭包锁；并入 core 裁决**不做**：剩余依赖 mechanics / fusion / agentMechanicView，并入会重建 C1 已拆的 core→mechanics 环（§24.90 ③） | 需要在无 Vue / pinia 环境跑管线（worker、CLI 批量） |
| 267 | 管线层 → 展示门面反向依赖；core 运行时传递闭包 | CC-246（`d9d5e4ed`）AUTO_AXIS_PRESET_HINTS 迁入 registry；CC-247（`1f2ee896`）registry 成纯叶子，core 闭包去掉 specs / fusion；两层都有闭包锁（§24.91） | 新增分层违规会被 importClosure 锁拦截；其他层（specs → core 禁止、展示层禁止值导入 core / mechanics / specs）还没有闭包锁，见交接下一步 |
| 268 | specs → core 越界（verify.ts）；specs / data 分层无锁 | CC-248（`7c8567c9`）verify.ts 迁至 src/test/specVerify.ts；specs / data 闭包锁；ARCHITECTURE 分层规则表（§24.92） | 口头分层规则已全部落成锁（7 条对应 7 个锁）；展示层规则确认已有判据 7 覆盖 |
| 269 | mechanics 闭包（测量）；测试态 / 生产态行规则盲区 | mechanics 无越界、不加锁；CC-249（`9c037acf`）一致性锁（§24.93） | 「涉及 getRowValue 须在默认规则下补验」由人工纪律转为 verify 自动检查 |
| 270 | spec 声明式字段 multiplierRowId 只对 damage 生效（4 份重复闸 + enrich 回填 damage 行） | CC-250（`60d35e7f`）缺省读取器归一，非 damage 行强制覆盖（§24.94） | §24.87 ④ 未决项结项 |
| 271 | 重跑跨文件同形扫描（dupfn.mjs，15 组） | 快照 / 恢复协议 3 份归一并修复 buff 开关泄漏（CC-251，`7ed14dfc`）；clamp / whole / settingOf / 防御包装 / 签名截断不做；combatTimeOf 3 份、findMoveByEnglishName 2 份留作下一步（§24.95） | 新增 agents 私有 helper 时重跑 dupfn.mjs |
| 272 | combatTimeOf / findMoveByEnglishName（§24.95 留项）；跨分析器协议（applyTeamToStore、交互基准） | CC-252（`ca29c623`）、CC-253（`045c587b`）、CC-254（`979b673c`）；交互基准 4 份漂移副本 → CC-255 待做（§24.96） | dupfn 扫描线结项；跨分析器协议线见 CC-255 与轻量装配归一 |
| 273 | 交互基准副本（CC-255）；轻量装配副本 | CC-255（`e9a57ec6`，修复 1051 偏差）、CC-256（`41971d2a`，零差）（§24.97） | 跨分析器协议线结项；下一步测量魔数装配（快支 3 / 连携 1） |
| 274 | 魔数装配（快支 3 / 连携 1）；预设交互映射副本 | 魔数装配「不做」（2 处，口径各自独立）；CC-257（`5268b414`，零差）；发现般岳难度双计 → CC-258（§24.98） | 下一步 CC-258 |
| 275 | 般岳难度双计（CC-258）；难度轴引擎字段读取副本 | CC-258（`0cd375a8`，涉及难度数值；difficultyDescent 副本归一；CC-68 声明并入）（§24.99） | 交互线结项；下一步测量散点 vs 曲线的 x 轴输入口径 |
| 276 | 散点 vs 曲线 x 轴输入口径 | CC-259（`58e4eb7b`，涉及散点难度数值，伤害零差；liveInteractions 独立模块；CC-257 专属类型泛化为模块反查）（§24.100） | 难度 x 轴输入线结项 |
| 277 | 预设占位交互；逐预设循环状态泄漏 | CC-260（`a1b2e755`，零差）；占位交互 → CC-261 待做（§24.101） | 下一步 CC-261（数值卡） |
| 278 | 预设占位交互 | CC-261（`bdc3d312`，数值卡，依据用户 09-04 / 09-11 口径）；暴露 G5 吸收不单调 → CC-262 | 下一步 CC-262 或快支口径测量 |
| 279 | 难度 x 与引擎降配口径 | CC-262 定性不修；CC-263（`47c051c8`，降配字段表 / 取整单一来源） | 下一步快支口径测量或 R6 复盘 |
| 280 | 快支 / 连携口径多入口 | CC-264（`5a357bf6`，基准单一来源 + 删死兜底）；Boss 侧快支死字段 → CC-265 | 下一步 R6 清单复盘或 CC-265 |
| 281 | 动作次数写入入口 | CC-266（`b0ec91a3`，基准唯一写入者 = setAgent）；CC-265（`626e2e63`，死字段） | 下一步 R6 清单复盘 |
| 282 | R6 清单复盘；换人时专属动作次数残留 | 清单为空（§0 / §7 全部结项）；CC-267（`dfbe5db1`，换人重置全部动作次数，删 restoreActionCounts） | 装配口径线结项；新方向见队列 §2 |
| 283 | setAgent「随角色」字段逐个判定 | CC-268（`0577858e`，潜能）；命座 / 精炼不改；驱动盘在无推荐角色上残留，待量 | 下一步量缺推荐角色 |
| 284 | 驱动盘残留测量 | 无残留（62/62 有推荐、主词条全可映射）；测量中发现推荐套装按名匹配失败 ⇒ CC-269（`81068b3c`） | 下一步：展示层映射副本 |
| 285 | 推荐配装名字通道 / 展示层颜色映射 / 限定判定 | 前两项不收；「限定 S 角色」两套定义分叉 ⇒ CC-270（`fb9786fb`） | 音擎侧两套限定判定（前缀 vs catalog 稀有度，legacyIds 差异）待查 |
| 286 | 音擎侧限定判定两套 | CC-271（`48f30a1b`）：委托 limitedGold 单一定义并先解析别名；修常驻别名误判 | 抽卡分层特例集合（pullPlannerEngine FREE_SPECIAL vs pullValue FREE_GIFT + A 级特例）待查 |
| 287 | 旧 id 通道 / 抽卡分层特例集合 | 旧 id 通道都经登记了别名的 Map，不改；特例集合单一来源 CC-272（`6047d435`） | composables / views 里其他硬编码 agentId 集合（同一事实 ≥ 2 份才收） |
| 288 | 硬编码 agentId 集合 / 按名字认招式 | 前者无重复；后者 CC-273（`4b01b307`）：维琳娜改按 moveId，删 findMoveByEnglishName | 其他「查不到就静默回落」的查找（按名字 / 按 id）待扫 |
| 289 | 源码 id 字面量悬空 | 0 悬空；加全量锁 CC-274（`89c988a2`） | 「静默回落」扫描到此收尾；下一轮换题（见队列 §2） |
| 290 | 静态数据交叉引用 | 发现拥有者 slug 让来源面板失联，CC-275（`ae4e2af5`）在加载处归一 | 静态数据交叉引用已查完；下一轮回 R6 清单（见队列 §2） |
| 291 | 身份双字段（id / teammateBuffId） | 可归一：别名字段退役，CC-276（`ccfd9dfe`） | 遗留：teamHasAgent / findSlotByIdentity 无生产调用，下一轮删 |
| 292 | 死身份 helper | 冗余可删：CC-277（`fcecd8eb`） | 身份线（CC-275→277）收尾；下一轮换题 |
| 293 | jscpd 跨文件克隆 | 可归一：快照 / 恢复副本并回 configSnapshot，CC-278（`d02c098a`） | 剩 3 处同文件克隆待看（norma / burnice / damagePoolRelease） |
| 294 | jscpd 同文件克隆 3 处 | 可归一：CC-279（`fc72df87`） | ts 克隆清零；下一轮扫 .vue + min-lines 8 |
| 295 | 角色模块私有钳位 helper ×20 | 可归一：utils/finiteClamp，CC-280（`0b4664f3`） | 异义 clamp01 组待核实 NaN 可能性；CharacterCard↔ResourcePage 与 6 处同文件克隆待看 |
| 296 | 展示层标签颜色表 ×2 / CharacterCard 选项 ×2 | 可归一：agentLabelMaps，CC-281（`20ebfa5b`）；推翻 285 行「颜色映射不收」（当时漏看职业 / 属性表） | lumiflux 无颜色（审美未决）；jscpd 剩 5 处同文件克隆待看 |
| 297 | AttributeConfigPage 敌人数值框 ×11 | 可结构化：描述表 + v-for，CC-282（`54baeebe`） | jscpd 剩 specPanelBuffs / lucy / freeCompare metrics / versionChartGeometry 同文件克隆 |
| 298 | 橘福福 cfg 缓存 + 回退分叉 / 露西装配 ×2 / 指标聚合循环 ×7 / 版本图摊点 ×2 | 可归一：CC-283（`d3fbccc2`）、CC-284（`94817ea8`）；AttributeConfigPage 两段 v-for「不做」 | jscpd 清零；其余模块的 cfg 写回缓存待普查（见交接） |
| 299 | 角色模块 cfg 死写 ×37 | 冗余可删：CC-285（`7a783dd5`），加锁 | 12 个真「写了读回」的缓存待逐个改成纯函数重算（§24.123 清单） |
| 300 | 仪玄 cfg 缓存 ×2 / 其余「写了读回」候选 | 可简化：CC-286（`8920ccc6`）；phoenix / nekomata / promia 属轮间通道「不做」；xide 有测试接口「暂不做」 | qingyi 同调用传参、nangong / billy 未查 |
| 301 | 青衣 cfg 回写传参 / nangong / billy | 可简化：CC-287（`f45d69f7`）；nangong、billy 属轮间通道「不做」；普查结项 | nangong C6 疑似陈旧值（pairs→0 时不清零）待量 |
| 302 | nangong C6 残留套数 | 真缺陷，CC-288（`de751282`）修复，锁 2 例 | 同型「提前 return 早于 cfg 写入」普查（候选约 20 个模块）待做 |
| 303 | 「提前 return 早于 cfg 写入」普查；buildResourceResult 晚写 | AST 扫描只剩 nangong（已修）和 zhuYuan；zhuYuan C6 余温回能是死写入 → CC-289（`1f8ed509`，数值卡）；晚写探针只剩 orphieBladeHits（展示，不改）；两类普查结项 | 新模块把影响引擎的量写在 buildResourceResult 里（真队锁只覆盖 1241） |
| 304 | 晚写常驻化；anby 能量写入 | CC-290（`0e40804e`）锁；anby 两处有效（golden 场景不触发） | 其他「礼物型」cfg 字段（initialDecibelGift / extraSelfDecibelReward）的死写入普查 |
| 305 | 喧响礼物字段死写入；重复调用钩子的非幂等累加 | 死写入按钩子时机推理结项；非幂等累加 2 处真缺陷 → CC-291（`ecc5a838`，数值卡）；源码锁 idempotentCfgWrite | 源码锁只认 cfg/record 等变量名和同文件 helper；跨文件 helper 或别名变量不在覆盖面 |
| 306 | 重复调用钩子的非累加型不一致 / 陈旧值（行为探针） | 0 处；固化为 hookReplay 锁 CC-292（`5801e112`）；cfg 写入纪律线（CC-285～292）结项 | 结构性问题：模块私有通道借道共享 cfg（见交接下一步） |
| 307 | 模块私有通道借道共享 cfg（AST 测量 `scripts/cfg-key-census.cjs`） | agents 写入键 476：a 仅本模块读 387（60 模块；once 307 / round 51 / repeat 29）、b 仅外部读 33、c 两者 55、无读者 1。风险层 a/repeat 29 键已被 hookReplay / idempotentCfgWrite / lateCfgWrite 覆盖 | **不做**：私有状态袋只是把钩子层级规则搬家，还要改 materializeRows 快照 / outerFeedbackSignature / cfgField 路径；类型搬家属整洁性改动。详见 `docs/mcp-module-state.md`（含重开条件） |
| 308 | 模块接口成员普查（`AgentMechanicModule` 92 个成员；单实现者 42 个） | 同一模块的成对成员里只有「布尔旗标 + 同事实能力函数」一处真冗余：banyue `producesInteractionTopUp` + `computeInteractionTopUp` ⇒ CC-293（`12393c82`，零差）。其余成对成员语义不同（见 §24.132），单实现者钩子本身是「core 不写 agentId」的正确代价，**不做**合并 | 新增函数型能力时不要再配布尔旗标（能力存在即声明） |
| 309 | 编排层 / 展示层读取带角色名的机制设置键（8 个键） | 赠送落点 `liuyin.ultimateTargetSlot` 被编排层 3 处重解，与引擎用的模块 targetSlot 不同源 ⇒ 真缺陷，CC-294（`a712129c`）。其余见 §24.133：`banyue.autoTopUpInteractions` 门控在 convergence 与 banyue.ts 各写一份（**下一步**）；velina / alice / yeshuguang / liuyin.hug60Count 属展示或难度驱动，读的是该角色自己的设置，**不做** | 编排层需要「模块决定的量」时调模块能力，不要自己读设置重算 |
| 310 | 般岳 autoTopUp 门控两份副本（convergence / banyue.ts） | 可归一：CC-295（`39ecce25`，零差）；编排层带角色名的设置键只剩展示 / 难度驱动类（309 行判「不做」） | 交互栏「弹刀 +N」显示门控是第三种写法（只认轴模式），待量（见交接） |
| 311 | 交互栏补齐显示门控第三种写法 + 读下一轮量 | 可归一：CC-296（`fa64324e`，零差）。「补齐线程单调夹住」治 2-环：**不做**（1471 结构溢出队 12→20 弹刀，215/次低估实际 ~290/次 ⇒ 首轮估计系统性超补；现有 ⑥″ + 环成员可行性闸门的落点更合理） | — |
| 312 | 展示层读「下一轮」反馈线程量的同型扫描（CalcRoundResult 各字段） | 可归一：CC-297（`e54413f2`，零差）。只有 parrySplit 同型；inStunAnomalyState / bossAnomalyState 是「本轮结果摘要」（由本轮池算出、供下一轮用），描述的就是本计划，**不改** | — |
| 313 | 轴栈三份实例（引擎执行集合 / 转大轴内占比 / 伤害侧 stackTraversalResult）入参对账 | 真缺陷：引擎执行集合按计划实数分窗 ⇒ CC-298（`fee62755`）；修后 golden 22 个轴场景引擎集合 == 伤害侧集合 | 伤害侧 `stackTraversalResult` 重算一份栈（资源入参与引擎不同）⇒ 候选 CC-299 改读引擎集合（见交接） |
| 314 | CC-299 伤害侧改读引擎执行集合（试做，已撤回） | **阻塞**：锁定失衡（`enemy.stunCountLock`）下引擎集合按锁定值分窗（CC-151：锁定 ⇒ countStun ≡ 锁定值），雨果轴决算行按池物理次数（坑36，`hugo.ts` 读 `threads.prevPoolStunCount`），伤害侧旧重算按池 ⇒ 改读引擎集合后 `hugo.test.ts:289` 3≠4 红。两条用户口径在锁定模式下冲突，先裁口径再做（§24.138） | 裁定锁定模式下「池次数 vs 锁定值」谁是计数权威 |
| 315 | 锁定模式池 ≠ 锁定值（§24.138 待查项） | 真缺陷（锁定 = 「恰 N 次」，池没钳）⇒ CC-300（`fdf54712`）。CC-299 再试：physical / 锁定已无分叉，但 **off 投影**（难度阶梯 G4 + 钉 off 的旧测试）下引擎集合按计划实数、雨果行按池 ⇒ hugoVerdictLanding / stunVulnSummary 3 红，再次撤回 | off 模式下雨果（坑36）与计数通道的分叉 |
| 316 | off 投影下引擎执行集合（计划实数）与雨果 / 伤害侧（池整数）分叉 | 执行集合窗口数统一读池整数 ⇒ CC-301；CC-299 第三次落地（`9629f619`），全量 verify 4032 绿、golden 零差 | 已结项；遗留：axisChainTotal / windows / ultNeed 在 off 下仍读计划实数（见 §24.140，默认不做） |
| 317 | 伤害池 / overlay 用展示计算 `stunAxisResult` 的真假值判轴模式 | 改读引擎 `axisActive`（CC-302，`c45a500a`）；`stunAxisResult` 退为纯展示（仅 StunAxisPage 与测试读） | 已结项 |
| 318 | useResourceCalc 普查余项 | computeStunCoverage（注入引擎的依赖，非重复）/ interactionTopUp（已读 threadsApplied）/ axisOverlays（伤害侧独有，引擎不算）：不做；parrySplitResult 复制了引擎门控与击破位规则 ⇒ CC-303（`c7aa0ad6`） | 已结项 |
| 319 | 展示层 .vue 派生规则副本普查 | ResourceUtilizationPage 风化浸染挑槽复制了引擎规则且身份口径不同 ⇒ CC-304（`07a91a16`）；其余命中（optimizer.* / releaseShare / alice / guarantee.* / counterAssist / 连段吸收比例）都是设置控件的读写或纯展示，不做 | 已结项 |
| 320 | 展示层 findIndex / damageElement 普查；锁定未下沉进 promoteFixpoint（§24.139 未钳项） | 页面命中 5 处全为纯展示（条件列表 / 饼图 / 排序 / 抗性行 / 物理判断），不做；锁定下沉 ⇒ CC-305（`c46321bb`），实测零数值差 | 已结项 |
| 321 | 角色模块之间的队伍级规则副本（specialty / damageElement 判定） | 额外能力条件在 4 个模块手写、与 spec 声明两套来源 ⇒ CC-306（`25041ef0`）；维琳娜 / 爱丽丝无 spec 声明（仍手写），其余命中是各角色技能自身条件（非额外能力），见 §24.145 | 下一步：维琳娜 / 爱丽丝补 spec 声明（先量 additionalGate 连带门控） |
| 322 | 额外能力条件仍手写的最后两处（维琳娜 / 爱丽丝） | CC-307（`60b9fff4`）补 spec 声明后，mechanics/agents 内额外能力条件已无手写副本（仅剩 1511 南宫羽按 AA_OWNER_EXEMPT 豁免）；见 §24.146 | 结项 |
| 323 | 源码锁按行号登记（改无关代码也要同步） | 2 处真实源码锁去行号 ⇒ CC-308（`bdba9007`）；其余 `.ts:N` 字面量都是扫描器自测夹具（recordKeyDeadReads / layerInversion / record-key-dead-reads.mjs 断言扫描器报出的行号本身），不做 | 结项 |
| 324 | 「额外能力」来源判定在门控表与测试各写一份全等比较 | CC-309（`cf097628`）收成一个谓词并接受「额外能力：<名>」；顺带纠正 1541 一条标错来源的 teamBuff | 下一步：spec teamBuffs 来源标签对原文普查 |
| 325 | 来源标签格式多样（`额外能力` / `额外能力：名` / `额外能力（名）`），门控谓词只认前两种 | CC-310（`b3da0d0f`）谓词补括号形 + 护栏测试「凡以额外能力开头都须被识别」；spec teamBuffs 来源对原文普查 0 处影响门控的错标 | 结项 |
| 326 | 影画要求靠标签字符串解析，写法不合即静默当 C0 | CC-311（`f37af4de`）数据锁兜底；另记录「影画 / 在队」只有 store 软门控、引擎不拦（§24.150，裁决不改） | 结项 |
| 327 | 角色模块按身份认别的角色（规则拥有者与消费者倒置） | ① singleSourced / 空 effects 队友 buff 普查：7 条全有模块通道，0 零读取；② 仪玄→橘福福倒置 ⇒ CC-312（`b7c6d567`）；③ 全量扫描后只剩 luciaElowen.ts→1051 伊德海莉一处（下一步） | 结项（CC-312 + CC-313，§24.151–152） |
| 328 | 最后一处跨角色身份字面量（luciaElowen `YIDHARI_AGENT_ID`） | 提供者报「每次提供者终结技给本槽回血 %本槽生命」写全队，消费者自决 ⇒ CC-313（`9262395f`）；mechanics/agents 内非本模块 agentId 字面量清零；跨模块私有前缀写入普查 0 处（仅 starlightBilly 的 `billy*` 为同名前缀误报） | 做 |
| 329 | 共享喧响通道 `extraSelfDecibelReward` 写入方（orphie / promia / remielle / 佩洛伊斯）；外层反馈签名是否覆盖 `moduleFeedback` | 写入方：都只写自己 cfg、用自己常量，无身份 / 抄常量 ⇒ **不做**（佩洛伊斯「每次连携 +300」可仿 `extraSelfDecibelPerUltimate` 做 per-chain 字段，但唯一使用者，只是换名字）；陈旧注释已修（`03591521`）。签名：看不到模块反馈字典 ⇒ CC-314（`acf5e8d4`，零差） | 新增「下一轮反馈」通道但不走 `moduleFeedback` 字典时，须在 `outerFeedbackSignature` 手动补项 |
| 330 | `CalcRoundThreads` 各字段是否在外层签名里（§24.153 交接第 1 条） | 插桩 479 停点：105 个仍有字段在变 ⇒ CC-315（`a6ab4558`，golden 零差、轮数 +5.6%）；`postRoundInput.stunCount` 入签名会破坏长环检测 ⇒ 根因（滞后一拍）转 CC-316 | 新增 CalcRoundThreads 字段时：入签名或在 `outerCycle.ts` 头注释的从属清单写明理由 |
| 331 | CC-316：postRound 失衡次数滞后一拍 | 改读本轮 countStun，零差（`d357f784`）；签名例外清零 | — |
| 332 | 喧响预算棘轮 `max(上一轮, 本轮)` 是否仍必要 | 不影响任何覆盖用例的结果 ⇒ 删（CC-317，`0ebcfcae`） | 出现「某队喧响 / 终结次数逐轮塌缩」的反例时回退 CC-317 |
| 333 | 第 333 轮复核：无满足项（坑 25 到期日 2026-10-31，还没到；264 行 channelMetricsOf 已由 CC-243 覆盖）。自选：编排层的角色专属线程 `auricInkFlash` 该不该留 | 该移：它由仪玄产生、只给仪玄读，应走 moduleFeedback 通道 ⇒ CC-318（`2c88fd30`）；`teamUltimateForJufufu` 维持原裁决，留在编排层（全队汇总），不改名 | 出现「玄墨触发必须在无 1371 的队里可见」的需求时回退 CC-318 |
| 334 | 第 334 轮复核：无满足项。① `CalcRoundThreads` 里是否还有「单模块产出、单模块消费」的字段（CC-318 同型）；② 「按英文名判终结技 / 连携技」的规则副本 | ① 没有：`inStunWindowTriggers` 虽然只有南宫羽读，但它由通用的失衡内异常系统 v2 算出（全部异常角色通用），不是角色专属提取；`teamVeilCountTotal` 有 3 个消费者；`backstageAuto` 走声明式 `cfgField`；`interactionTopUp` 走通用能力；`prevPoolStunCount` 编排层自己用 ⇒ 不做，这一类已清完。② 5 份副本、3 份不看分类，青衣 Penultimate 触发 ⇒ CC-319（`54fb397f`）；`core/damage.ts:53` 和 `ResourceResultCard.vue:405` 都有分类判断、另外匹配中文名，是伤害分类和展示用途 ⇒ 不做 | 出现名字不含 Ultimate 的终结技，或 chain 分类外的终结技时，改 `chainMoveKind` 一处 |
| 335 | 第 335 轮复核：无满足项。按英文名子串判招式类型的其余写法（ex special / dodge counter / dash / assist follow-up / defensive assist / quick assist / flash …） | catalog 扫描：除 `ultimate`（CC-319）外，只有 `flash` 跨分类出现，但它判的是能量键名（`moveLookup.ts:74`），不是招式名 ⇒ 这些写法都不做。顺带发现「普通 #N 普攻段」判定有 4 份副本，而且 #N 启发式对 1631/1641 失效，导致秒均回复为 0 ⇒ CC-320（`71bf1a04`，数值卡） | 出现新的无 #N 段角色时，basicSegment.test 的名单断言会红：先确认该角色的基准段（catalog `basicBenchmarkMoveId`），再更新名单 |
| 336 | 第 336 轮复核：无满足项。① 其余依赖 `#N` 命名的规则（§2 交接第 2 条）；② 基准段的两个来源 | ① 不做：`basicComboCycleSeconds` 只有千夏 1491004 / 爱芮 1501004 / 佩洛伊斯 1551003 三个固定段，catalog 上整套时长依次是 4.767 / 3.183 / 2.284s，都不为 0；`averageBasicRows` 走基准段；`multiplierCoefficients.ts` 是展示用的系数分析，按中文名 `#N` 分组，不进引擎。#N 这条线收口。② `BASIC_BENCHMARK_OVERRIDE` 恒空，是死的平行来源 ⇒ CC-321（`b91008c4`，零差）；同类「恒空导出常量」扫描后没有第二处 | 如果将来需要在代码里裁决基准段（数据不能表达的动态条件），走模块能力，不要恢复硬编码表 |
| 337 | 第 337 轮复核：无满足项。「伤害 > 200% = 强化平A」启发式（§2 交接第 2 条）：它排除了哪些段，对秒均回复影响多大 | catalog 60 个带 #N 段的角色里 59 人有段被排除；过滤后的秒均能量普遍回到约 3.6/s，不过滤反而被强化段拉偏（如 1431 只有 1.31/s）⇒ 启发式有效，保留。唯一的真缺陷是 1511 被整组排除 ⇒ CC-322（`2f745db0`，数值卡）。`alice#calcSwordWillPerSec` 有同一过滤，爱丽丝有存活的普通段 ⇒ 不做 | 新角色的 #N 段全被排除时，basicSegment.test 的名单断言会红：先确认基准段，再更新名单 |
| 338 | 第 338 轮复核：无满足项。反向体检：对 catalog 全部 62 个角色单人跑 `buildCharConfig`，找「多数角色非 0、个别为 0 或缺失」的通用字段（§24.162） | 10 个字段离群，全部可归类，**无新缺陷**：数据本来就没有（没有招架支援 1081/1181/1211/1241/1311/1351；1311 没有强特，闪反时长为 null；1611 强特走替代资源；1551 强特无耗能数据（第 339 轮订正，见 §24.163）；1611 普攻段不回能）；模块有意为之（1451 `timeWeight=0`；1531 闪反由银河横行口径禁用；1541 强特由 promia 模块单建）；已登记的数据缺口（1441 招架支援 #1 时长为 0，见 moveLookup:269 与 rowBuild:469）。存疑一项：1451 终结技 #1 时长为 null，#2 段未计入。nanoka 原文两段是独立 param，没有 `{A}+{B}` 融合编码，按 moveFusions 规则「#N 不作融合判据」加 R5「不顺手改数值」⇒ 不做 | 1451 重开条件：出现把终结技两段编码为同一次动作的数据源（param.desc 求和），或用户给出口径 ⇒ 登记融合组（数值卡）。新角色进 catalog 时可重跑体检：`/home/user/mcp-tools/zzProbe338.test.ts` + `an338.py` |
| 339 | 第 339 轮复核：无满足项。行级体检：62 个角色各配 [id, 1211, 1311]（撞车时换 1131/1041），chainCountPerStun=1，跑完整 `useResourceCalc`，看 cfg 选中的强特/终结/连携在伤害行里是否 count>0（§24.163） | 终结技全员 >0。强特离群 6 人：1121/1481/1611/1311 由模块或数据承接（本的招架版 #3/#4、琉音的石头剪刀布、克拉蕾锐能、耀嘉音无强特改和弦）。**1551 佩洛伊斯强特恒 0**：日华原文「能量足够时发动」，但三个数据源都没有耗能数值，`costType=free` ⇒ 0 次，能量效率 +15% 等能量收益全部落空 ⇒ 数据缺口，不编数，加名单锁 CC-323（`56e29d1d`）。第 338 行说 1551「走替代资源」是误判，已订正。招架/闪反/支援突击默认 0 次，全员一致，不算离群 | 1551 重开条件：catalog 给 1551009 补 energyCost（零代码自动生效），或用户给出耗能口径（写进模块，参照 xide:121）⇒ 数值卡，更新名单锁并解释 golden |
| 340 | 第 340 轮复核：无满足项（1551 耗能仍无数据；坑 25 未到期）。自选：强特次数来源测量（第 339 轮交接第 2 条） | 12 个 `skipGenericExSpecial` 模块的理由**不同类**（轮换 / 石头剪刀布 / 锐能 / 持续喷射 / 怒相循环……），收成单一「来源声明」**不做**：它们本来就各自经 exSpecialCount 能力、costType、exContinuous 分流，再加一层声明只是换壳。但测出 skip 标志兼管「次数取整」，是隐式耦合且已咬人（1181/1621）⇒ CC-324（`5621d802`）拆开：取整成为缺省，期望值模型显式 opt-in | 新增持续型强特（按住秒数可变耗能）时须设 `exSpecialCountFractional=true`，否则次数被取整；若出现「真实次数却需小数」的新需求，先回头看本行 |
| 341 | 第 341 轮复核：无满足项。① 自选：CharacterOperationConfig 24 个布尔字段普查「一词两义」（CC-324 同型）；② 附带：golden 单人用例影画单调性体检 | ① **无第二例**：exContinuous/exFinalize 单写入方同一语义；billyFinalizeChain / yeshuguangFinalizeForms / exFinalize 三旗标已由 finalizePasses 执行器统一，复位不对称有意保留 ⇒ 不做；isFlashUser 单一语义（闪能 vs 能量）；velinaAdditionalAbilityActive 经 spec enabledField 读，非死写。§5 前提「resourceCalc 直接读 store」实测已满足（8 个文件全为 import type，store 参数注入；selectionReads 为纯函数），再收窄参数类型只是类型搬家 ⇒ 不做。② 62 人中 3 处下降：1581 c3→c4 / c5→c6 为真缺陷 ⇒ CC-325（`6c7cb19e`）；1091 c3→c4 为资源重新分配（终结技 +2 / 强特 −1），登记白名单 | cinemaMonotone.test 变红 = 新的影画掉伤：先归因（缺陷修 / 重分配登记 ALLOW 并写原因） |
| 342 | 第 342 轮：带日期的条件（坑 25，2026-10-31）未到期；按第 341 轮交接第 2、3 条自选。① `extraNecessaryAction` 钩子普查（计时条件 vs 出伤条件）；② 执行行「占时但零伤」全量探针；③ 组队影画单调性 + 收敛普查 | ① 全仓 3 处：remielle（CC-325 已修）；aire 带 moveId，由 rowBuild 直接产执行行，计时与出伤同源；miyabi 只预留时间，与 buildMiyabiExecutions 同读 `frostMoonCount>0`（CC-202 有锁）⇒ **无新缺陷，收口**。② 248 次运行中，占时间但无伤害的只有 3 类，全部合理 ⇒ 收口。③ 组队场景 434 次中 3 处下降，归因后都不是缺陷；**非收敛 19/434（4.4%）**，属已登记的「真整数环」，DEBT「全局实数化收敛重构」范畴 ⇒ 本轮不做 | 若要做组队单调性守护，前提是先解决非收敛（否则参照值不可信）；整数台阶维持否决 |
| 343 | 第 343 轮复核：无满足项（坑 25 到期日 2026-10-31，未到）。自选：按第 342 轮交接第 2 条，给组队非收敛 19 例分型，并试验「整数环停点改成语义化选取」 | 分型：19 例全部是第 2–3 轮就检出的**真整数环**（环长 2 或 3，没有一例跑满预算；时间预算外层全部收敛），机制都是「整数次数 ±1 ↔ 平 A 时间 ±0.5–7s ↔ 能量/喧响」反馈。停点规则「环成员 JSON 字典序最小」按字符串比较（`"10"<"9"`、先比到哪个字段取决于序列化顺序）⇒ 与语义无关。试验「取 Σ次数最小、平局取平 A 最多」：golden 64 条（伤害至少 17 例，全部 −0.1% 到 −5.7%，**含大量 converged=true 的单人用例**）、棘轮 9 队 ⇒ **不采纳**（§24.167） | 「全局实数化收敛重构」立项时，以 §24.167 的分型表和「converged=true 也受环成员选取影响」作为范围依据；停点规则单独改：维持否决 |
| 344 | 第 344 轮（lane arena-C）复核：无满足项（坑 25 到期日 2026-10-31，未到）。自选：① §24.167 的延续——整数环停点换判据重试（按可行性判，不按保守判）；② 第 343 轮交接第 2 条 moveId；③ 孤儿 `docs/devlog/` | ① **CC-326（`76261a80`，数值卡）**：真整数环停点改为「不透支成员中次数最多者」。终局非收敛 18 例的旧停点 18/18 透支，改后为 0；golden 64 条 / 38 例，棘轮 6 队（4 好 2 差），cinemaMonotone 唯一例外随之消失（§24.168，`docs/mcp-integer-cycle-stop.md`）。② moveId **不做**：`DamagePoolRow.moveId` 生产代码没有读者，缺 moveId 的只有 liuyin/banyue/burnice 三个 `extraDirectRows` 模块行，补上只会改 zd 哈希。③ `docs/devlog/`（2026-09-19 WSL 工具链笔记，未跟踪 10 天、无 lane 认领，内容已在 AGENTS.md L206–256）已删，备份 `calc-arch/orphans/docs-devlog-2026-09-19.md` | 第 20 轮后回落（`oscillatorStopStates`）改用 `integerCycleStop` 需单独实测，1431 c6 留白 0 是硬约束；出现按 moveId 关联模块行的消费方时重开 ② |
| 345 | 第 345 轮（lane arena-C）复核：第 344 行的条件「第 20 轮后回落需单独实测」由本轮完成；其余无满足项（坑 25 到期日 2026-10-31，未到；cinemaMonotone 仍绿；非收敛 18 例单人仍在，第 342 行前提不成立）。自选：第 20 轮后回落是否并入 `integerCycleStop` | **CC-327（`1f03164f`，简化卡，终局零差）**：删「第 20 轮后回落到第 20 轮瞬态」兼容层，即 `INNER_LOOP_OSCILLATOR_STOP`、ctx 的 `oscillatorStop`、第 20 轮快照和 1051 特例。现在任何轮次检出的真整数环都取 `integerCycleStop`，预算耗尽返回末轮状态。414 例：这条路径 74 次停点，第 20 轮瞬态全部是环成员，其中 70 次正好是规则选中的成员；终局逐字段零差，预算耗尽 0 次，1431 c6 留白仍为 0（§24.169，`docs/mcp-integer-cycle-stop.md` §7） | 非收敛 18 例单人的根治仍是 DEBT「全局实数化收敛重构」；第 343 行「停点规则单独改：维持否决」只针对 Σ最小，不涉及可行性停点 |
| 346 | 第 346 轮（lane arena-C）复核：无满足项（坑 25 到期日 2026-10-31，未到；第 345 行转交的「converged=true 路径依赖」本轮未做，仍在交接）。自选：① 浮点噪声环停点能否并入 `integerCycleStop`；② 外层环内选点逐级消融 | **CC-328（`7ad71a8e`，简化卡，终局逐位零差）**：环分支合一，停点一律 `integerCycleStop`，`isFloatNoiseCycle` 只决定收敛标志；414 例噪声环 60 次停点两条规则同一成员，终局全字段 0 差（§24.170，`docs/mcp-integer-cycle-stop.md` §8）。外层消融（physical 与 off 各 414 例，只测不改）：⓪ 零窗 / ⓪′ 截断 / ② 时间三级 0 次改变选点；③「取最后一轮」只在 auto-1371-1571-1451（physical，可行成员 K=4/3/3）实质相位相关（`docs/mcp-outer-fixedpoint-continuity.md` §6） | 重开：① 噪声判据（相对 1e-9）与 `CYCLE_STOP_EPS`（绝对 1e-9）的差异若在实测中改变终局 ⇒ 统一容差；② 外层三级静默只是面上结论，删除需要「被别级蕴含」的语义论证；③ 外层相位相关点先定 K 取大 / 取小的原则再开卡 |
| 347 | 第 347 轮（lane arena-C）复核：无满足项（坑 25 到期日 2026-10-31，未到）；第 346 行重开条件 ③「外层相位相关点先定 K 取大 / 取小的原则再开卡」由本轮完成。自选：外层 physical 同级成员按读入 K 的取向 | **CC-329（`216c5bde`，数值卡，1 个预设）**：`pickOuterCycleMember` 在 ③′ 之后新增 ③″「physical 同级取读入 K 大者」。依据是 CC-150 / CC-153 的「最大自洽可行整数」，与内层 CC-326 同一原则：整数次数取可行最大，连续规划量（③′）取小。③″ 只接管原先由「取最后一轮」决定、K 不同的情形。414 例 × physical / off 只有 auto-1371-1571-1451 变：失衡 3→4、伤害 +4.049%，留白 / 超预算仍为 0（§24.171，`docs/mcp-outer-fixedpoint-continuity.md` §7） | 外层 ③「取最后一轮」剩下的只有同一成员的重复（lag=4）和容差内成员。若出现 K 相同、内容不同、结果差超出取整的相位相关点，再考虑内容键兜底（例如外层签名字典序）；③″ 若被证明推翻了本该由时间可行性决定的选点，回退本卡 |
| 348 | 第 348 轮（lane arena-C）复核：无满足项（坑 25 到期日 2026-10-31，未到）。自选：S2 折叠环出口普查（交接可选项「停滞判据触发面」）与控制状态能否按运行隔离 | 普查：2968 次运行，残差达标 1771、停滞 1197、跑满 0。停滞计数（`diag.bestExcess` / `stagnantPasses`）跨运行不归零，CC-160 终局重折接着主折叠的计数判停（404 次运行、12 个 1431 用例）。归零试验：缺省 414 例终局不变，但 dynamicComboAlign ②（合轴吸收率 1）auto-1431-1481-1341 留白 1.01 → 1.88 红，吸收率 0 时截断 82.7 → 63.9 秒 ⇒ **承重，不改**，只加注释（`5363d20a`）（§24.172，`docs/mcp-fold-loop-stop.md`） | ~~先定 CC-160 重折是「续跑」还是「重新迭代」再动；候选 F2 先量实际差~~ → 第 349 轮已全部实测结项（见第 349 行） |
| 349 | 第 349 轮（lane arena-A）复核：第 348 行两项重开条件与第 346 行转交的「`converged=true` 路径依赖」由本轮完成；其余无满足项（坑 25 到期日 2026-10-31，未到）。自选：① 折叠环 CC-160 重折语义四变体与候选 F2 实测；② 内层整数环 `converged=true` 路径依赖归因；③ `resolveExSpecialCount` 正交归一 + 伊德海莉轴内成本档槽位错位修复 | ① **折叠环两候选结项（不做）**：`cont / cont_reset_stag`（保持 `refundFrozen=true`）动 14 例并恶化时间账（`!diag.refundFrozen` 兼任整数态重测 `teamRefund` 与 CC-158 展开后必跑 Pass 1 门控，职责与停滞计数正交）；F2（还原最小残差轮）动 13 例，因 `cfg.timeBudgetExcess` 是累加器，回退第 1 轮丢弃后续已折叠的 `7.84s` 时间债，把 `yidhari-qingyi-lucia` 从 `cut=0` 打成 `cut=0.95s`（`docs/mcp-fold-loop-stop.md` §2、§4）。② **`converged=true` 路径依赖结项**：18/18 例均在前序/终局 `runInnerLoop` 命中真整数 2-循环（`over: 1..5 → 0`），经折叠累加器（9 例）、外层跨轮反馈（6 例）、`diag.converged` 粘性 OR（4 例）传递（`docs/mcp-integer-cycle-stop.md` §9）。③ **CC-330（`0237d0d2`）**：`resolveExSpecialCount` 正交化 `fractional` 与 `exReservedCount` 拆分（删重复块）；`applyYidhariTeamConfig` 改读本槽 `cinemaLevel`（补 `slot=1` 正反单测）；删 `028b47c9` 误提交的空壳 `data/recordings/1581.json`（§24.173） | 折叠环停点线与内层整数环停点线全部收口；后续除非连同 DEBT 1a（全局实数化收敛重构）一起动，不再单改折叠环出口或停滞计数 |
| 350 | 第 350 轮（lane arena-A）复核：无满足项（坑 25 到期日 2026-10-31，未到）。自选：R26 遗留分诊表终检 + 菲欧妮（1641）槽位/异常队友计数单源化 | ① 确认 `docs/mcp-pending-triage-2026-09-30.md` 中 B 类 10 条与 C 类 6 条全部收口。② **CC-331（`cb5fc209`，终局零差）**：修正 `phoenix.ts` 中 `adjustAdditionalAbilityGates` 的 `team[slot]` 压缩数组越界（改 `team.find(m => m.slot === slot)`）与 `tier2` 门控漏锁，并将 `buildPhoenixCharConfig` / `buildPhoenixResourceResult` 的队内异常人数统一到 `phoenixTeamAnomalyCount`；同步校准 `character-constellations.json` 中 1181 C4 回能描述（§24.174） | 若后续新增使用 `adjustAdditionalAbilityGates` 的角色，按 `team.find(m => m.slot === slot)` 查本槽 |
| 351 | 第 351 轮（lane arena-A）复核：无满足项（坑 25 到期日 2026-10-31，未到）。自选：蕾米埃尔（1581）特殊虚耀载体垂虹动作次数与耀变次数对账 + 额外能力推导归一 | **CC-332（`84016cd3`，单人 1581 c3–c6 4 例更新，105 预设零差）**：分离 `remielleSpecialVoidflareRainbowCount`（垂虹载体招式次数 `1/2/2`）与 `remielleSpecialVoidflareCount`（耀变事件次数 `3/6/12`），修正 C1/C4/C6 把垂虹必做动作多扣为 3/6/12 次的单位混用 bug；抽 `computeRemielleAdditionalState` 归一两份额外能力三档推导；删 `catalog.json` 孤儿项 `remielleCinema6SpecialVoidflareTriggerMultiplier`（§24.175） | 若官方调整 1581 影画 1/4/6 的特殊虚耀给予次数或垂虹清空规则，重算 `remielleSpecialVoidflareRainbowCount` |
| 352 | 第 352 轮（lane arena-A）复核：无满足项（坑 25 到期日 2026-10-31，未到）。自选：普罗米娅（1541）C1 `[有罪推定]` 异放无视防御门控对账 + 7 个角色模块内部派生单源化 | **CC-333（`2feb0083`，单人 1541 c3–c6 4 例更新，105 预设零差）**：① `promia.ts`：原文 `[有罪推定]` 仅由额外能力施加、C1「对[有罪推定]状态的敌人造成[异放]时额外无视 20% 防御」，修正 `promiaReleaseModifier` 在额外能力未激活时越门控给 C1 20% 减防、以及 `computePromiaCycle.guiltyDefIgnore` 漏计 C1 20% 的双向分叉，两处统一读 `computePromiaCycle.guiltyDefIgnore`；② `aire.ts`（`applyAirePanel` 复用 `computeAireCycle`）、`nangong.ts`（重拍回复/颤音层数/C2 每层 `+35%`/地雷撞套数单源化）、`luciaElowen.ts`（`computeLuciaCurtainBreakdown` 三处合一）、`norma.ts` & `liuyin.ts`（`computeNormaHatToChainCount` 复用 `computeNormaSource`、`specAdditionalAbilityActive` 优先取入参 `agent`）、`severian.ts`（`severianFlowState` 含 C6 `[风起]` 定点流息与 `computeSeverianCycle` 共用）、`sigrid.ts`（`countBasicFinisherHits` 委托 `countBasicSegments`）单源化（§24.176） | 若官方调整 1541 `[有罪推定]` 施加来源（不再绑额外能力），同步放开 `computePromiaCycle.guiltyDefIgnore` 的 `additionalActive` 门控 |
| 353 | 第 353 轮（lane arena-A）复核：无满足项（坑 25 到期日 2026-10-31，未到）。自选：简（1261）`jane.frenzyActive` 账本与面板同源化、洛克茜（1621）单轮耗能与自旋秒缺省值对齐、以及 10 个自定义角色模块内部循环/资源装配单源化 | **CC-334（`6d885b6c`，全量 414 条 golden 零差）**：① `jane.ts`：补齐 R51 漏接的第二处调用点 `buildJaneResourceResult`（改读 `cfgMechanicSetting(cfg, 'jane.frenzyActive', 1)` 而非硬编码 `true`），并在 `computeJaneMechanic` 内按 `input.frenzyActive` 门控 `frenzyBuildUpBonus` 与 `atkFromMastery`，消除狂热总闸关闭时「面板归零而资源卡仍显生效/+25%/+600攻」的账本分裂；② `roxy.ts`：`computeRoxyWindEnergy` 接入入参 `exSpecialEnergyConsume`（未传时回退 `10 + spinSeconds * 30`），`buildRoxyCharConfig` 自旋秒缺省回退由 `2` 对齐为 `2.5`（与 `settings` 及 `computeRoxyWindEnergy` 一致），抽出 `roxyWindEnergySourceOf` 合一 `buildRoxyResourceResult` 与 `buildRoxyExecutions`；③ `velina.ts`：`resolveVelinaExecutionDamage` 优先按 `VELINA_SWEEPING_CYCLONE_2_MOVE_ID`（`1561020`）认招（补完 CC-273），`velinaBroadCycloneCountFromFloria` 直接委托 `buildVelinaFloriaSource`；④ `banyue.ts`（`buildBanyueExecutions` 复用 `computeBanyueCycleFromCfg`、`patchBanyueExecutions` 用 `MOVE.buDongRuShan / MOVE.chongXiao`）、`zhao.ts`（`buildResourceResult` 复用 `cycleFromInput`）、`yaojiayin.ts`（`yaojiayinTremolosOf`）、`rina.ts`（`rinaBangbooOf`）、`lighter.ts`（`lighterMoraleOf`）、`yixuan.ts`（`resolveYixuanPerfectBlocks / resolveYixuanExtremeAssists`）、`yidhari.ts`（复用 `chargeCycleTime / EX_HEAL_RATIO_PCT / BASIC_FOLLOW_HEAL_PCT` 并删死变量）单源化（§24.177） | 若新增角色模块同时实现 `buildExecutions` 与 `buildResourceResult`，优先抽共享 `*Of(cfg, state)` 装配函数，禁止两处手抄同一入参对象 |
| 354 | 第 354 轮（lane arena-A）复核：无满足项（坑 25 到期日 2026-10-31，未到）。自选：扫完剩余 `src/mechanics/agents/`（含 `specPanelBuffs.ts`），修复星见雅跨槽风队门控、佩洛伊斯额外能力连携喧响门控、奥菲丝融合行 C1 火抗无视时序、雨果决算失衡返还门控、席德钢能 `total` 字段，并单源化 12 个模块的资源/面板派生 | **CC-335（`67b371c2`，全量 414 条 golden 零差）**：① `miyabi.ts`（1091）：`teamPanelEffects` 的入参 `panel` 是 `targetSlot` 面板，而 `applyMiyabiPanel` 仅在雅自身面板写 `miyabiHasWindTeammate`，导致有风队时队友槽 `panel.miyabiHasWindTeammate === undefined` 误吃核心被动 `+20%` 积蓄效率；改为直接调 `hasWindTeammate(team, slot)`，并抽 `hasMiyabiCinema6` 统一 C6 判定；② `specPanelBuffs.ts`：佩洛伊斯（1551）额外能力「辉煌军势」的 `chainTotal * 300` 喧响在 `applyTeamConfig` 中补齐 `(cfgIn.panel?.additionalAbilityActive ?? 1) > 0` 门控（与 `applyPanel` 暴伤 +40% 同门控），`resourceSections` 直接读 `prom.total / prom.remaining`；橘福福（1391）在 `computeJufufuCycle` 内单源产出 `aweGains / weishiGains` 供 `buildResourceResult` 直接消费（根除 R51 双写隐患），`patchExecutions` 统一用 `jufufuCinemaOf(cfg)`；③ `orphie.ts`（1301）：`patchOrphieExecutions` 先入列倍率融合行（`1301011 → 1301022`）再挂 C1 `ORPHIE_C1_RES_IGNORE_MOVE_IDS`，使融合出的燥焰迸射（`1301022`）同吃 C1 无视 15% 火抗；④ `hugo.ts`（1291）：抽出 `computeHugoStunRefundRatio` 合一 `computeHugoCycle` 与 `hugoMechanic.stunRefundRatio` 的决算存在性门控；⑤ `xide.ts`（1461）：抽出 `resolveXideSteelResources` 合一 `buildXideExecutions` 与 `buildXideResourceResult`，并补齐 `steel.total = totalSteel`；⑥ `starlightBilly.ts`（1531 `billyFullThrottleFromDetermination`）、`alice.ts`（1401 消除双调 `computeSpecResources`）、`xixifu.ts`（1521 `resolveXixifuResources`）、`zhuYuan.ts`（1241 `resolveZhuYuanResources`）、`ellen.ts` / `anbyZero.ts` / `evelyn.ts`（`apply*Panel` 直接委托 `compute*Cycle`）单源化（§24.178） | `src/mechanics/agents/` 全量 47 个模块已全部完成对账与单源化扫描；后续仅在新增角色或修改角色机制时复核 |
| 355 | 第 355 轮（lane arena-A）复核：无满足项（坑 25 到期日 2026-10-31，未到）。自选：审计 `src/specs/` 与 `src/composables/resourceCalc/`，修复诺姆赠链与琉音赠大同槽共存覆写 bug，并单源化 `buildGiftRow` 赠行构造、Spec 运行时事件/资源求值与 `helpers.ts` 倍率查表 | **CC-336（`f4c32bef`，全量 414 条 golden 零差）**：① `chainGift.ts` & `ultimatePromote.ts`：修正 `applyChainGift` 用 `findIndex(e => e.chainGift || e.source === 'gift')` 匹配占位行导致同槽同时存在琉音赠大（`assembleSlot.ts` 先 push，`source === 'gift'`）与诺姆赠链（后 push，`chainGift: true`）时误把琉音赠大行覆写为诺姆连携倍率、而诺姆真赠行留 0 倍率的共存 bug；两侧统一按 `Boolean(e.chainGift)` 与 `e.source === 'gift' && !e.chainGift` 精确定位，并统一经 `buildGiftRow` 单源构造（消除两处 13 字段手写 `giftPatch` 副本）；② `convergence.ts`：消除 `rrShown` 对 `applyUltimatePromote + applyChainGift` 的重复调用（直接复用同入参链 `adj2 ?? adj1 ?? rr`）；③ `specs/mechanics.ts` & `specs/resources.ts`：抽出 `isSpecEventEnabled`、`specToMechanicModule.buildCharConfig` 复用 `resolveCarrierMoveId`、`resolveEventCount` 统一支持 `counts[event.countField ?? event.id]`，`computeOneResource.feedbackGainRules` 委托 `resolveGain(..., countOverride)`；④ `helpers.ts`：`extractSkillExecutions` 改调 `findMoveById`（删 11 行手写双层循环），两处抽取统一经局部 `fusedOf` 读取 `fusedRowValue ?? getRowValue`（§24.179） | 新增赠送机制若共用 `source: 'gift'`，占位行匹配必须按各自的判别标志（如 `chainGift`）互斥过滤 |
| 356 | 第 356 轮（lane arena-A）复核：无满足项（坑 25 到期日 2026-10-31，未到）。自选：`calcPanel` 局外总回能出口盖章、驱动盘门槛单源化、轴块招式能量成本类型化与跨模块重复管道归一 | **CC-337（`f0c5b4b8`，全量 414 条 golden 零差）**：① `data/agentPanelStats.ts` 定义 `calcEnergyRegenTotal / calcFlashEnergyRegenTotal`，`calcPanel` 的 `outOfCombatOf` 出口统一盖章 `energyRegenOutOfCombat`，`panelPhases.ts` 抽 `applyDefaultCinemaSkillLevelBonus`；② `buff.ts` 导出 `discRequirementMet / resolveDiscStatTemplate` 供 `inCombatBuffs.ts` 复用；③ `moveLookup.ts` 导出 `parseMoveEnergyCost` 供 `findExSpecial` 与 `buildStackAxes` 共用；④ `useResourceCalc` / `ResultPage` / `positionCompare` / `difficultyDescent` / `teamCompare` / `impactVars` 重复管道归一（§24.180） | 新增 `calcPanel` 调用点无需手动补算 `energyRegenOutOfCombat` |
| 357 | 第 357 轮（lane arena-A）复核：无满足项（坑 25 到期日 2026-10-31，未到）。自选：审计 `src/core/` 结算子模块与外围分析 composables，修复 `cinemaUplift` 多槽 C6 残留与 `freeCompare` 空槽残留，并单源化元素面板字段与异常暴击统计 | **CC-338（`58c6c473`，全量 414 条 golden 零差）**：① `cinemaUplift.ts`：每槽跑完恢复 `originalCinemas[slot]`（防前序槽留在 C6 污染后续槽）并复用上一档 `(after, panelAfter)`（单槽求值 `12→7` 次）；② `freeCompare/engine.ts`：`!team[slot]` 时显式清空槽位（防 `autoBuild=false` 下残留第 3 人）；③ `elementStatKeys.ts` 补齐 `enemyAnomalyRes | enemyStunRes`、`buff.ts` 导出 `getTargetedElementStat`，清除 `damage.ts` / `stunPool.ts` / `anomalyPool/helpers.ts` 的元素字段手写包装并加源码锁；④ `anomalyPool/helpers.ts` 导出 `getAnomalyCritStats` 合一 `calcAnomalyCritExpect` 与 `damage.ts`（§24.181） | 新增元素定向面板字段一律先入 `ElementStatKind`，禁外部直调 `enemyDebuffElementStatId` |
| 358 | 第 358 轮（lane arena-A）复核：无满足项（坑 25 到期日 2026-10-31，未到）。自选：审计批处理分析 composables（`positionCompare` / `teamCompare` / `difficultyLadder` / `difficultyCurve` / `pullValue` / `pullPlannerEngine` / `charIncrement`），修复跨预设状态残留、buff 门控恢复错误与重复求值 | **CC-339（`efd63a1f`）**：① `positionCompare.ts` 首轮求值同源读取 `stunPoolResult / anomalyPoolResult`，拐力差分后用 `syncTeammateBuffsFromTeam()` 恢复（消除未解锁命座/额外能力 buff 污染，单队求值 `3→2` 次）；② `teamCompare.ts` `applyTeamToStore` 换人前复位 `0命1精`，`computeTeamComparePoints` 在 `pickBestBuff / computeAutoEnginePicks` 前无条件置基础金分配，`computeOptimalGoldAllocations` 与 `applyGoldToStore` 统一复用 `applyGoldSteps`（删漏传 `preset.wEngines` 的重复调用）；③ `difficultyLadder.ts#resetDifficultyGoals` 补齐 `0命1精` 复位并删 `applyTeamPreset` 前冗余 `setAgent`（§24.182） | 批处理预设切换必须在 `setAgent / applyTeamPreset` 前复位 `0命1精`，恢复队友 buff 一律走 `syncTeammateBuffsFromTeam()` |
