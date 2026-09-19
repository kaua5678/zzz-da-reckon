/**
 * 判据 7「展示层越层 import」+ 判据 12「引擎层角色模块引用」的实现面（R46 结构熵切面，纯搬运）。
 *
 * 规则来源：`ARCHITECTURE` §0「依赖方向：展示 → 编排 → 引擎」——
 *   · 判据 7：views/components 只读编排层产物，不直接 import 引擎（`@/core`）或录入层
 *     （`@/mechanics`、`@/specs`）；存量冻结只减不增。
 *   · 判据 12：`src/core/**` 禁**值**导入具体角色模块（`import type` 豁免）——引擎按能力查询
 *     （`getAgentMechanic(id)?.<能力>`），不 import 具体模块、不写 id 字面量。
 *
 * ⚠ 棘轮基线 `EXHIBITION_LAYER_IMPORT_BASELINE` / `CORE_ROLE_IMPORT_BASELINE` 在本文件；
 *   改基线必须**连 `RATCHET_BURNDOWN` 的 frozen 一起改**。
 * ⚠ 本文件是 check-guards.mjs 判据 7/12 的**实现**；`runAllChecks` 经 re-export 壳消费。
 * ⚠ 纯搬运保真：正文与搬出前逐字节相同（仅整体 `export` 保留 + 新增本序言）。
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** 仓库根（从 `scripts/lib/` 上溯三级；与 check-guards.mjs 的 ROOT 同值） */
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

// ---- 判据 7：展示层越层 import 棘轮 ----
//
// 规则来源：ARCHITECTURE §0「依赖方向：展示 → 编排 → 引擎」——views/components 只读编排层产物，
// 不直接 import 引擎（@/core）或录入层（@/mechanics、@/specs）。
//
// 为什么是棘轮而不是一次清零：2026-09-11 评审实测 24 处（23 运行时 + 1 import type），
// 其中多数是常量/纯函数（sharpCritMultiplier / ULTIMATE_COST_DEFAULT / scoreForDamageRatio /
// SKILL_DMG_TARGET_LABELS…）。正解是下沉 src/data/ 或经编排层透出，但逐条属独立任务；
// 先冻结防恶化（复制 agentId 棘轮的已验范式）。豁免 import type：纯类型不产生运行时依赖。

/** 展示层目录（只扫 .vue；它们的逻辑入口就是 <script setup>） */
export const EXHIBITION_LAYER_DIRS = ['src/views', 'src/components']

/** 禁止的越层目标：引擎/录入层（@/core、@/mechanics、@/specs） */
export const EXHIBITION_LAYER_FORBIDDEN = /@\/(?:core|mechanics|specs)(?:\/|['"])/

/**
 * 2026-09-11 冻结基线（评审时实测 23 处运行时越层 import；另有 1 处 `import type` 按豁免不计）
 * → **15**（2026-09-13 T7 首次真清偿 −8）。只减不增：迁走一处 → 把基线下调到新值；上调没有合法路径。
 *
 * 23 → 15 沿革（纯常量/纯函数下沉 `src/data/`，原位置改 re-export ⇒ 引擎侧调用点、测试、
 * `@fact` 锚零改动，规则 11 单一事实源不破；实测 vue-tsc 0 错、@fact 锚 93/93 不变）：
 *  · `SKILL_DMG_TARGETS`/`SKILL_DMG_TARGET_LABELS`/`normalizeSkillDamageTarget`
 *    `core/buff.ts` → `data/skillDamageTargets.ts`（buff.ts re-export）
 *    ⇒ 属性配置页 + 调试页 2 处
 *  · `scoreForDamageRatio`（含 SCORE_CURVES/cap/逆函数，整模块纯）
 *    `core/deadlyAssaultScore.ts` → `data/deadlyAssaultScore.ts`（core 留 re-export 壳）⇒ 实战对比页 1 处
 *  · `ANOMALY/DISORDER/TURBULENCE_DECIBEL_BONUS`
 *    `core/anomalyPool/helpers.ts` → `data/anomalyDecibelBonuses.ts`（helpers import+re-export）
 *    ⇒ 结果卡 1 处
 *  · `ULTIMATE_COST_DEFAULT` `core/resource.ts` → `data/resourceDefaults.ts`（resource.ts re-export）⇒ 队伍配置页 1 处
 *  · `BOSS_ENTRY_ANOMALY_OPTIONS` `core/stunAxis/inStunAnomaly.ts` → `data/bossEntryAnomalyOptions.ts` ⇒ 失衡轴页 1 处
 *  · `sharpCritMultiplier` `core/damage.ts` → `data/sharpCritMultiplier.ts`（damage.ts re-export）
 *    ⇒ 面板卡 + 属性面板 2 处。⚠ 偏离 T7 简报的「本批不要碰」清单：简报把它列为「真引擎调用，
 *    需经编排层透出或改架构」，但**实测它是纯函数**（2 个标量入参 → 1 个数，无 import/无状态），
 *    且本文件 :489 的设计注释早已把它列进「常量/纯函数，正解是下沉 src/data/」名单
 *    （原出处 = 2026-09-11 架构评审快照，快照已删、未落地项迁 .claude 账本）——无需架构改动。如需回退，把该函数搬回 damage.ts +
 *    两个组件 import 改回 `@/core/damage` 即可（棘轮基线同步回调 15→17）。
 *
 * **剩 14 处不能再按本法下沉**（逐处核过，全是真引擎调用或注册表读取，无纯常量）：
 * getAgentMechanic×4 / buildTeammateBuffSourceContext×2 / calcPanel / applyTargetedStat /
 * allocateAxisWindows / computeOptimalSubStats+getTemplate /
 * readImpactVar+writeImpactVar（收 configStore，非纯）/ agentSpecs / computeBanyueMingwangBlocks+
 * BANYUE_AXIS_MOVE_META / computeYixuanNingshenBlocks。它们要经编排层透出，属架构改动。
 *
 * ★ 2026-09-20 round 44：**15 → 14**（`calcStunMultiplier`，进步登记不是放松）。
 * 结果页「失衡易伤可见化」整族纯展示映射搬进 `composables/stunVulnDisplay.ts`（结构熵切面，
 * 逐字节保真）⇒ 该越层 import 随实现一起离开展示层。**这是搬运的副产品，不是为降数字而改**：
 * 判据语义（展示层禁直连引擎）一字未动，只把已经上移的实现从计数里去掉。
 * ⚠ 与 :763 的 `sharpCritMultiplier` 先例同型——**纯函数搬走后 import 自然消失**，
 * 无需注册表/编排层透出。下面这 14 处仍是真引擎调用，别照此法硬搬。
 */
export const EXHIBITION_LAYER_IMPORT_BASELINE = 14

// ---- 判据 12：引擎层「静态依赖具体角色模块」棘轮 ----
//
// 为什么需要（2026-09-13 架构诊断）：agentId 棘轮是**词法**判据（`/agentId\s*(===|!==)/`），
// 双向失真——既漏掉等价写法（`c.liuyinCinemaLevel !== undefined` 不被计数），
// 又**完全看不见**强得多的耦合形态：`core/` 直接 `import ... from '@/mechanics/agents/<角色>'`。
// 实测病灶：`core/resource.ts` 曾住着 135 行「诺姆怎么赠链、琉音怎么转大」的角色数学
// （`normaGiftChainInfo` / `liuyinGiftChainInfo` / `liuyinGiftTime`），它们不写 id 字面量
// ⇒ 棘轮零意见，但**新角色接赠链必须改引擎**——正是规则 6 要消灭的形状。
//
// 度量面 = `src/core/**` 对 `@/mechanics/agents/*` 的**值**导入（`import type` 豁免：纯类型不产生
// 运行时依赖，与判据 7 同款豁免）。正解 = 模块经 `AgentMechanicModule` 钩子/声明式字段暴露能力
// （`crossAgentSupply` / `axisWindowOverlays` / `backstageAutoFill` …），引擎按能力查询、不按角色查询。

/** 引擎层目录（依赖方向最内层，应当角色无关） */
export const CORE_LAYER_DIR = 'src/core'

/** 角色模块路径（值导入 = 硬耦合；type-only 豁免） */
const CORE_ROLE_IMPORT_RE = /^\s*import\s+(?!type\s)[^'"]*from\s+['"]@\/mechanics\/agents\/[^'"]+['"]/

/**
 * 2026-09-13 冻结基线：诊断时实测 **7 处**（不含测试）——
 * `core/resource.ts` 1（luciaElowen）+ `core/resource/helpers.ts` 4（luciaElowen / banyue / norma / liuyin）
 * + `core/anomalyPool.ts` 1 + `core/anomalyPool/helpers.ts` 1（均 velina）。
 * 同批 `crossAgentSupply` 契约落地后**赠链族数学**（135 行）已迁进 norma/liuyin 模块，
 * 但引擎侧仍有 4 处对本批未迁移能力的直接引用（见下），故冻结 7。
 * 只减不增：迁一处 → 把基线下调到新值；上调没有合法路径。
 *
 * 剩余 5 处的迁移前提**已被实测证伪（2026-09-13 T8，勿照原计划重走）**：
 * 原本预期「赠链族迁走后会剩零调用死引用可删」——**实测 0 个死引用**，5 处 import 的每个符号都有活调用：
 *  · `velina#simulateVelinaCorrosionState` ×2（anomalyPool.ts:328 / anomalyPool/helpers.ts:1195）——
 *    **不能只删**：模块的 `transformAnomalyPool` 钩子已算过一次，但用的是**预算值** `preTurbulenceCount`，
 *    而 core 这两处是**最终值**二次结算（注释原文「风蚀状态机按最终乱流次数重新结算」）⇒ **有意双轨**，
 *    删任一处都改数值；且两处 core 的 `cinema2CorrosionRate` 兜底来源还不一样，连合并都不能证逐位等价。
 *  · `banyue#computeBanyueCycleFromCfg`/`readAxisExCounts` ×1——函数本身纯（只吃 cfg），但它读的
 *    `banyueAxisEx` **由编排层逐轮注入**（convergence.ts:980），模块 `buildCharConfig` 跑在 cfg 合并**之前**
 *    ⇒ 预先算会读到过期值。改「converge 相位算好写 cfg」则**测试直调 `calcTeamResources` 的路径不经过钩子**
 *    ⇒ 静默回落通用「闪能/20」公式（正是该分支存在的原因）⇒ 必须设计成缺失时**大声失败**，属引擎改动。
 *  · `luciaElowen#computeLuciaCurtainTriggers` ×2——入参全是**引擎收敛态**，且两个相位各调一次
 *    （iterate 内用 prevStates / 收敛后用最终 states），脱钩同样需「core 经注册表向模块要值」+ 穿参数。
 *
 * ⇒ **三处都是引擎契约改动**（给 `AgentMechanicModule` 加「引擎期求值」能力 + 把注册表穿进
 * `calcTurbulenceDamage` 等签名），不是机械迁移。原计划里「norma/liuyin/velina 可直接删」**已证伪**
 * （norma/liuyin 那两条随赠链族一起迁走了；velina 那条不成立）。
 */
export const CORE_ROLE_IMPORT_BASELINE = 5

/** 扫 `src/core/**` 里对具体角色模块的值导入 → [{ file, line, text }]（**不含测试**：测试自由引用模块） */
export function scanCoreRoleImports(root = ROOT) {
  const sites = []
  const rec = (dir) => {
    if (!existsSync(dir)) return
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) { rec(p); continue }
      if (!n.endsWith('.ts') || n.endsWith('.d.ts')) continue
      const rel = relative(root, p).split(sep).join('/')
      if (rel.includes('__tests__') || rel.endsWith('.test.ts')) continue
      readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
        if (CORE_ROLE_IMPORT_RE.test(l)) sites.push({ file: rel, line: i + 1, text: l.trim().slice(0, 110) })
      })
    }
  }
  rec(join(root, CORE_LAYER_DIR))
  return { count: sites.length, sites }
}

/**
 * 单行判定：是否构成越层依赖。
 * 计入 `import ... from '@/core/...'`、`export ... from ...`、动态 `import('@/core/...')`；
 * 豁免：注释行、`import type`（类型面不产生运行时边）。
 */
export function detectExhibitionLayerImport(line) {
  const t = line.trim()
  if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return false
  if (/^import\s+type\b/.test(t)) return false
  const hasImportSyntax = /\bfrom\s+['"]/.test(t) || /\bimport\s*\(\s*['"]/.test(t)
  return hasImportSyntax && EXHIBITION_LAYER_FORBIDDEN.test(t)
}

/** 扫一个 .vue 源码的越层 import 行数 */
export function countExhibitionLayerImports(content) {
  return content.split('\n').filter(detectExhibitionLayerImport).length
}

/** 扫展示层全部 .vue，返回 { count, sites: [{ file, line, text }] }（sites 供归因输出） */
export function scanExhibitionLayerImports(root = ROOT) {
  const sites = []
  const rec = (dir) => {
    if (!existsSync(dir)) return
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) rec(p)
      else if (n.endsWith('.vue')) {
        const rel = relative(root, p).split(sep).join('/')
        readFileSync(p, 'utf8').split('\n').forEach((l, i) => {
          if (detectExhibitionLayerImport(l)) sites.push({ file: rel, line: i + 1, text: l.trim().slice(0, 100) })
        })
      }
    }
  }
  for (const d of EXHIBITION_LAYER_DIRS) rec(join(root, d))
  return { count: sites.length, sites }
}
