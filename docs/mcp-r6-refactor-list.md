# R6 第 2 步：重构机会清单（做 / 不做）

> lead-arena-0925c · 2026-09-27 第 139 轮。输入：`docs/ARCHITECTURE-OVERVIEW.md`（全貌，§3 A1–A5、§5 C1–C7、§6 实测）。
> 判据（REQUIREMENTS R6）：**按架构收益做，不按计数做**；只降计数、不带来架构收益的改动一律「不做」；禁止用「更接近投稿」当理由。
> 每条：类别 · 为什么（出处）· 收益 · 影响面 · 风险 · **结论**。「做」的条目写到可以直接开工。

## 0. 结论总表

| # | 条目 | 类别 | 结论 | 状态 |
|---|---|---|---|---|
| C1 | core ↔ mechanics 模块环 | 可结构化 | **做** | ✅ 第 139 轮完成（R6 验收项，见 §1） |
| C7 | spec 与模块「一处执行、一处描述」 | 可归一 | **做**（分刀） | 下一刀：1481 / 1571 attributeConversions |
| C5 | 伤害基底两套口径 + 死参数 | 冗余可简化 | **做**（只删死参数与误导字段读法，低优先） | 待做 |
| C3 | catalog `appliesToOutOfCombatPanel` 冗余 | 冗余可简化 | **做成校验**，不删字段 | 待做 |
| C6 | 编排层实际是四层 | 可结构化 | **只改规划文档**，不挪目录 | 待做 |
| C2 | `stores/config.ts` 调引擎 | 可归一 | **不做**（改写规划承认它） | 规划待改 |
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

## 3. C5 伤害基底两套口径 —— 冗余可简化 · **做（低优先）**

- **为什么**：R5 D6 / Z1：`src/core/damage.ts:265` `DirectDamageInput.damageBasis` 是死参数（引擎按 specialty 经 `resolveSpecialDamageProfile` 决定），catalog 行上的 `damageBasis`（`src/types/catalog.ts:381`，导入脚本合成）与实际计算不符（命破 5 人写 atk，实际贯穿力）。
- **做什么**：删掉死参数及其调用点的传参（零差）；catalog 字段先不删（要改导入脚本），在 `types/catalog.ts` 注释写明「展示用合成字段，引擎不读」。
- **不做什么**：不让引擎改读字段（字段本身是合成的，不是规格）。
- **风险**：低，零差可验。

## 4. C3 `appliesToOutOfCombatPanel` 冗余 —— 冗余可简化 · **做成校验，不删字段**

- **为什么**：R5 Z2：与 `scope` 100% 同义，引擎不读；来源是导入脚本 `scripts/import-nanoka-wengine.mjs`。
- **做什么**：加一条数据前提测试（与 `r5DataInvariants.test.ts` 同处）：凡出现该字段，必须等于 `scope === 'outOfCombat'`。
- **为什么不删**：删字段要改导入脚本并重导数据，收益只是少一个同义字段；校验已足以防止两者分叉。

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

1. C7 第一刀（1481 → 1571）。
2. C6 规划文档 + C2 规划条款（一次改 `docs/ARCHITECTURE.md` §0）。
3. C5 删死参数；C3 加校验。
