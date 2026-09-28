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
