/**
 * 判据 14「死通道扫描」的实现面（check-guards.mjs 判据 14；R46 结构熵切面，纯搬运）。
 *
 * 为什么需要：2026-09-13 连续发现三类「机器不红、人就发现不了」的通道——
 *   ① 导出的可选项零调用（`difficultyCurve.ts` 的 `goldLevel` 死参数）
 *   ② 引擎读的配置字段全库零数据（`invincibleTime`：6 处读、面板可写、数据 0 条）
 *   ③ 手写 `.d.mts` 声明与 `.mjs` 实际导出漂移（`check-guards.d.mts` 漏声明 ⇒ TS2305）
 *
 * ⚠ 本文件是 check-guards.mjs 判据 14 的**实现**；判据名与汇总仍在 check-guards.mjs。
 *   改检测器口径请改本文件，**不要**在 check-guards.mjs 重建同形函数。
 * ⚠ 自指豁免：本文件序言里的 `debt:` 字样会被判据 5 的扫描器扫到 ⇒ 已在
 *   `DEBT_SCAN_SELF_REFERENTIAL` 登记（与 `scripts/zc.mjs` 同款，搬一次登记一次）。
 * ⚠ 纯搬运保真：正文与搬出前逐字节相同（仅整体 `export` 保留 + 新增本序言）。
 */
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

/** 仓库根（从 `scripts/lib/` 上溯三级；与 check-guards.mjs 的 ROOT 同值） */
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

// ---- 判据 14：死通道扫描（防「接口/参数在但实现没接」） ----
//
// 为什么需要：2026-09-13 连续发现三类「机器不红、人就发现不了」的通道：
//   ① **导出的可选项零调用**——`difficultyCurve.ts` 曾有从未接线的 `goldLevel` 死参数
//      （`bac9ce9` 引入 → `82c323a` 移除）。类型上可选、编译通过、测试不红，就是没人传。
//   ② **引擎读的配置字段全库零数据**——`invincibleTime`：引擎 6 处读、面板可写、类型有，
//      但 `boss-presets.json` 23 boss / **159 期相**里只有 12 个 boss 有值、期相 **0** 条 ⇒ 通道空转。
//   ③ **手写 `.d.mts` 声明与 `.mjs` 实际导出漂移**——`check-guards.d.mts` 曾漏声明
//      `CORE_ROLE_IMPORT_BASELINE`，而 `checkGuards.test.ts` 从 `.mjs` 具名 import ⇒ TS2305。
//      `.d.mts` 是**手写的影子 API**，被 `tsconfig.app` 的 `src/**` 消费 ⇒ 漂移只在 `vue-tsc` 暴露。
//
// 三条子判据都是**只报不红 + 白名单豁免（带 since/due）**：首轮必然有存量误报（外部契约字段、
// 预留通道、测试专用），一次性全红会逼人关掉判据。红线只给「**新增未登记**」——
// 与 debt: registry（判据 5）同款：豁免要写进清单（diff 里留痕），清单过期（已不再命中）也红。

/** 死通道豁免清单：key = `A|<file>:<line> <name>` 形式，value = { since, due, why } */
export const DEAD_CHANNEL_ALLOWLIST = {
  // 段 A：导出可选项零读零写（goldLevel 模式）
  // ⚠ 2026-09-15 销号 3 条（**假阳性**，非真债）：coverageMap / moduleInputRows ×2 全部是
  // **完全接通的活通道**，因读判定漏了「裸标识符 + 位置实参」形态而被误记成死通道
  // （详见 scanDeadOptionalProps 头注的取证）。修检测器后这 3 条自然不再命中 ⇒ 从清单删除
  // （棘轮只减不增：留着即 stale 红）。
  'A|src/composables/runArchiveImport.ts weaknesses': {
    since: '2026-09-13',
    action: '归档导入的弱点字段未消费——归档只做单条部署对照（用户裁决 2026-09），确认无用途后删',
    // 到期日与 RATCHET_BURNDOWN「死通道豁免清单」的 due 同源（2026-09-14 补：原先 due 是散文、
    // 全仓零日期解析 ⇒ 15 条冻结豁免零到期压力，正是「冻结 = 永久豁免」要防的形态，T15 审计 #6）
    due: '2026-12-31',
    why: '归档导入 DTO 的展示字段；按用户裁决归档不作误差判据，可能永远不需要',
  },
  'A|src/composables/runArchiveImport.ts hpTotal': {
    since: '2026-09-13',
    action: '同 weaknesses，随归档导入 DTO 一并处置',
    // 到期日与 RATCHET_BURNDOWN「死通道豁免清单」的 due 同源（2026-09-14 补：原先 due 是散文、
    // 全仓零日期解析 ⇒ 15 条冻结豁免零到期压力，正是「冻结 = 永久豁免」要防的形态，T15 审计 #6）
    due: '2026-12-31',
    why: '归档导入 DTO 字段，无消费点',
  },
  // 段 B：可选项只读不写（invincibleTime 模式；`?? 默认值` 兜底 ⇒ 静默走默认）
  'B|src/composables/difficultyLadder.ts minGain': {
    since: '2026-09-13',
    action: 'LadderOpts.minGain 无人传（minGainRatio 才是活通道）——确认为无用则删，或接上调用点后销号',
    // 到期日与 RATCHET_BURNDOWN「死通道豁免清单」的 due 同源（2026-09-14 补：原先 due 是散文、
    // 全仓零日期解析 ⇒ 15 条冻结豁免零到期压力，正是「冻结 = 永久豁免」要防的形态，T15 审计 #6）
    due: '2026-12-31',
    why: '只读不写：实现读 `opts.minGain ?? 0`，全仓零写入点（同族的 minGainRatio 有调用点）',
  },
  // 2026-09-20 销号：`B|src/composables/difficultyLadder.ts maxSteps` —— 棘轮报告「已不再命中」。
  // 复核：`opts.maxSteps` 仍在 `climbDifficultyLadder` 里被读（`:293` 走 `?? 24`），但扫描器不再把它
  // 判为「可选项只读不写」（R46 结构熵切面 refactor 后判据形态变化）⇒ 该豁免已失效。
  // 按「棘轮只减不增」删除条目（**不是**因为字段被删；字段仍在，只是不再命中该判据）。
  // ⚠ 2026-09-15 销号 2 条（**假阳性**）：`minGain`（difficultyLadder）与 `zeroEnergyRow`
  // （multiplierCoefficients）被判「只读不写」，但实测都有写入点，只是形态是**对象字面量简写**
  // （`{ …, zeroEnergyRow }` / 调用点的 `minGain,`）——而原写判定 `reWrite` 要求冒号。
  // 修 scanReadOnlyOptionalProps（补 reShorthand，逐行排除 const/let/var 绑定）后自然不再命中。
  // `zeroEnergyRow` 证据链：`:146` 计算 → `:149` 用它打标 → `:164` 简写写入 → `:299` 消费。
  'B|src/composables/pullPlannerEngine.ts freePoolPerSpecialty': {
    since: '2026-09-13',
    action: '抽卡规划器的 freePoolPerSpecialty 无人传——接上 UI 或删除',
    // 到期日与 RATCHET_BURNDOWN「死通道豁免清单」的 due 同源（2026-09-14 补：原先 due 是散文、
    // 全仓零日期解析 ⇒ 15 条冻结豁免零到期压力，正是「冻结 = 永久豁免」要防的形态，T15 审计 #6）
    due: '2026-12-31',
    why: '只读不写（走 `?? 默认`）；抽卡价值只用期望值口径（用户裁决 2026-09-01），该字段疑似旧模拟残留',
  },
  'B|src/composables/timeWeightBalancer.ts minWeight': {
    since: '2026-09-13',
    action: 'minWeight 只读不写——确认默认值即唯一口径则删字段',
    // 到期日与 RATCHET_BURNDOWN「死通道豁免清单」的 due 同源（2026-09-14 补：原先 due 是散文、
    // 全仓零日期解析 ⇒ 15 条冻结豁免零到期压力，正是「冻结 = 永久豁免」要防的形态，T15 审计 #6）
    due: '2026-12-31',
    why: '只读不写（走 `?? 默认`）',
  },
  // ⚠ 本条是**扫描器已知盲区的产物**，登记理由与上面几条（真死通道）不同：见 why + kind。
  // kind: 'namesake' ⇒ 它是「名字撞车」的记录，不是「待处置的死通道」——
  // 故**不进 burn-down 计数**（见 countDeadChannelWorkload）：它的 reads 恒 > 0，候选永远不会消失，
  // 拿它当待办会让棘轮永远还不完（T15 审计 #13）。真正的处置对象是上面那些 kind 缺省的条目。
  'B|src/composables/runArchiveImport.ts resistances': {
    kind: 'namesake',
    since: '2026-09-13',
    action: '归档 DTO 的 resistances 字段——与 weaknesses/hpTotal 同族（活动/归档 JSON 契约面），随归档 DTO 一并确认删留',
    // 到期日与 RATCHET_BURNDOWN「死通道豁免清单」的 due 同源（2026-09-14 补：原先 due 是散文、
    // 全仓零日期解析 ⇒ 15 条冻结豁免零到期压力，正是「冻结 = 永久豁免」要防的形态，T15 审计 #6）
    due: '2026-12-31',
    why: '**名字撞车导致的误报**（实测核实）：本扫描器按字段名全仓计数，reads=21 全部来自 src/stores/config.ts 的**同名但无关**字段 `EnemyConfig.resistances`（旧版单表抗性，:1068/:1285 有兼容读取）；归档的 `ArchiveRoom.resistances` 自身零消费者（run-archive.json 实测 0 处出现该键）。这是 T10 报告的盲区②「跨类型同名结构写入」的样本——判据 14 是字段名级启发式，不是符号级引用分析。**留着这条登记而非删掉判据**：它如实记录了「此处有一个名字撞车的字段」，且 T10 用 TypeScript LanguageService 复核过同族字段（weaknesses/hpTotal 真为零读零写）。',
  },
  'B|src/core/damage.ts isRupture': {
    since: '2026-09-13',
    action: 'DirectDamageInput.isRupture 零写入——函数体内已用 profile 判贯穿，确认冗余后删',
    // 到期日与 RATCHET_BURNDOWN「死通道豁免清单」的 due 同源（2026-09-14 补：原先 due 是散文、
    // 全仓零日期解析 ⇒ 15 条冻结豁免零到期压力，正是「冻结 = 永久豁免」要防的形态，T15 审计 #6）
    due: '2026-12-31',
    why: '只读不写：`input.isRupture ? RUPTURE_DAMAGE_PROFILE : …` 的兼容入参，全仓调用点都改传 specialDamageProfile（resolveSpecialDamageProfile），该入参已成死通道',
  },
  'B|src/core/effectiveTime.ts blockSeconds': {
    since: '2026-09-13',
    action: 'phaseDelayedCooldown 的 blockSeconds 形参无人传（走 `?? c` 旧口径）——接上 frontBlockSeconds 或删形参',
    // 到期日与 RATCHET_BURNDOWN「死通道豁免清单」的 due 同源（2026-09-14 补：原先 due 是散文、
    // 全仓零日期解析 ⇒ 15 条冻结豁免零到期压力，正是「冻结 = 永久豁免」要防的形态，T15 审计 #6）
    due: '2026-12-31',
    why: '只读不写；注意 frontBlockSeconds 是被测试与调用方用的活通道，死的是 phaseDelayedCooldown 的这个形参',
  },
  // ⚠ 2026-09-15 销号 2 条（**假阳性**）：`stunAxisPresets` 的 chapter / guarantee 被判「只读不写、
  // 预设数据里没人填」，但实测**数据就在 JSON 里**：`src/data/stunAxisPresets/{0章-琉,0章其他,
  // 1章-琉,1章其他}.json` 各有 `"chapter": 0/1`（`stunAxisPresets.test.ts:153-156` 逐条断言），
  // `5火10大.json` 有 `guarantee`。原判据只在 `.ts/.vue` 语料里找写入 ⇒ 数据驱动的字段一律误判。
  // 修 scanReadOnlyOptionalProps（写判定语料扩到 JSON）后自然不再命中，故从清单删除。
  // 原 why「chapter 疑似未填」是**错的**（规则 16：文档/注释也会骗 agent，故此处留痕纠正）。
  // 段 C（手写 .d.mts 漂移）**首轮即清零**：本判据上线时把 check-guards.d.mts 的漏声明一次补齐
  // （16 个：判据 12 的 CORE_LAYER_DIR/scanCoreRoleImports + 判据 13/14/15 的全部新导出），
  // 故无 C 段豁免条目——这正是判据该有的用法：发现漂移 → 补齐声明 → 清单为空。
  // ⚠ 以后 C 段真出现漂移，正解同样是补声明而不是登记豁免。
}

/**
 * 去掉**注释**与**字符串字面量**，供判据 14 的字段名计数使用。
 *
 * 为什么需要（2026-09-14 实测缺陷，两段各自独立咬过一次）：
 * 本判据按**字段名文本**计数，于是任何「不是代码」的地方出现 `name:` / `.name` 都算活引用。
 * ① **字符串字面量**：并行车道新增的 `deadChannelLs.test.ts` 里一行 `{ resistances: {} }`
 *    夹具构造串，让判据 14-B 当场 10→9——真实死通道 `B|…runArchiveImport.ts resistances`
 *    被抹掉，判据反而报「豁免过期」而红。
 * ② **注释**（同日 T15 对抗审计发现、实测复核）：`// TODO: resistances: 待接` 或
 *    `/* blockSeconds: 旧口径 *​/` 同样算写入点 ⇒ 一条 TODO 注释就能把真死通道洗白。
 *    这是**唯一会因日常写 TODO 而静默失效**的形态。
 * 顺序要紧：**先剥注释再去串**。反过来的话，`// '` 这种注释里的引号会先把「串」开在错误位置，
 * 把后半段真代码整段吞掉（实测：反过来做会把 `const a = 1` 之后的行吃光）。
 * 去两侧（reads/writes）口径一致，B 段实测恢复为冻结基线 10 条。
 *
 * ③ **复合赋值**（2026-09-15 实测缺陷，false-red 面）：写入检测原式 `\.name\s*=(?!=)`
 *    只认简单赋值，不认 `??=` / `||=` / `&&=`。自由对比工作台的 `FreeCompareSeries.downgrades?`
 *    在 `engine.ts` 用 `(out[si].downgrades ??= [])` 写入，却被判 `writes=0` 打成死通道——
 *    **把已接上的通道报成死的**，会逼人去登记假豁免（比漏报更危险）。
 *    修复 = 正则加 `(?:\?\?|\|\||&&)?` 前缀（A/B 两段同改）；实测只清掉这 1 条误报，
 *    其余冻结条目零变化。判据 `checkGuards.test.ts`「复合赋值也算写入」钉住。
 */
export function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')      // 块注释（含 JSDoc）
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')   // 行注释（避开 `https://` 的假注释）
}

export function stripCommentsAndStrings(text) {
  return stripStringLiterals(stripComments(text))
}

/**
 * 按 `root` 键控的记忆化（判据 14 两个扫描器的性能修复，2026-09-16）。
 *
 * ## 为什么要（实测）
 * `scanDeadOptionalProps` / `scanReadOnlyOptionalProps` 是**纯函数**：同一 root 在同一次
 * 运行内结果恒定。但它们的实现是「对**每条候选声明**都遍历全部源文件」——
 * 实测 A 段：309 条声明 × 4 条正则 × 457 个文件 ≈ **565 万次正则匹配**，
 * 且每条声明都把 1.2MB 语料**重新 `stripCommentsAndStrings` 一遍**（实测该步单独 ≈ 20s）。
 * 而 `checkGuards.test.ts` 里三条用例会**重复调用**同一扫描器 ⇒ 重复序列实测 **37.1s**。
 *
 * ## ⚠ 为什么缓存键**必须含 root**（这是本修复唯一的风险点）
 * 测试用 `mkdtempSync` 造**各自的 fixture root** 调同一函数（`checkGuards.test.ts` 的
 * 「零读零写 = 死」等一组用例）。实测：fixture root 返回 `[]`、真实 root 返回 2 条 ——
 * 若只按函数名缓存，第二次调用就会**拿到另一个 root 的结果**，把死通道判据变成
 * 「第一个 root 说了算」的假绿。故键 = `函数名 + root`。
 * （fixture 用 `mkdtempSync` 保证路径唯一 ⇒ 不会两个不同内容共用同一键。）
 *
 * ⚠ 仅在同一次进程内有效；测试若改动 fixture 后**重新扫描同一 root**，须自行失效
 * （当前无此用法：每个 fixture 都是新 root）。
 */
const scanCache = new Map()
function memoScan(key, root, compute) {
  const k = key + '\u0000' + root
  if (scanCache.has(k)) return scanCache.get(k)
  const v = compute()
  scanCache.set(k, v)
  return v
}

/**
 * 去掉**字符串字面量**（模板串 / 单引号串 / 双引号串）。
 * 见 `stripCommentsAndStrings` 的说明——判据 14 用前者，本函数保留为可单测的最小单元。
 */
export function stripStringLiterals(text) {
  return text
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
}

/**
 * 段 A：导出可选项**零读零写**（`goldLevel` 模式）。
 * 范围 = `src/{core,composables,data}/**` 非测试文件里缩进 2–4 空格的 `name?: T` 声明。
 * 判定 = 全仓（含测试）既无读取形态也无写入形态（写入 = `name:` / `.name =`）。
 * 排除声明行自身（否则每个声明都自计一次写入）。计数前先去注释与字符串（见 stripCommentsAndStrings）。
 *
 * ⚠ **读判定必须含「裸标识符」形态**（2026-09-15 修，本判据上线以来最贵的一次假阳性）：
 * 原先 `reRead` 只认 `.name` / `??` / 解构 / `,name] =` 四种，于是**形参位置传参**与
 * **裸标识符真值判断**全都不算读。实测后果：3 条**完全接通**的通道被判「零读零写」进豁免清单——
 *   · `coverageMap` —— `buff.ts:777` 读 `coverageMap?.get(e.id)`（可选链）+
 *     `panel.ts:280/285` 以**位置实参**传入（`applyBuffs(a, b, config.effectCoverageMap)`）
 *   · `moduleInputRows` —— `helpers.ts:958-960` 真值判断 + `.length=0` + `.push()`（全裸标识符）+
 *     `resource.ts:77` 位置实参；`resource.ts:846-847` 传 `preModuleExecutions`，:898 被
 *     `buildResourceResult` 消费（**活通道，端到端可用**）
 * 这类假阳性的方向最坏：它把「已接好的通道」记成债，逼后来人去「接」一个本来就通的线
 * （或按清单「删死字段」把功能删掉）——与判据 14 立项目的（找真断线）恰好相反。
 * 修法 = 增一条 `reBare`：标识符**不以 `.` 开头**（排除 `x.name` 成员名与声明本身）、
 * 且右侧**不是单冒号**（排除 `name:` 对象字面量写入 = 写、以及 `name?:` 声明）。
 */
export function scanDeadOptionalProps(root = ROOT) {
  return memoScan('A', root, () => scanDeadOptionalPropsUncached(root))
}

function scanDeadOptionalPropsUncached(root) {
  const files = walkSrcFiles(root)
  const texts = files.map(f => [relPosix(root, f), readFileSync(f, 'utf8')])
  // strip 一次、全声明复用（见 memoScan 头注释：原先每条声明都重 strip 全语料，实测 ≈20s）
  const stripped = texts.map(([rel, text]) => [rel, stripCommentsAndStrings(text)])
  const decls = []
  for (const [rel, text] of texts) {
    if (rel.includes('__tests__')) continue
    if (!/^src\/(core|composables|data)\//.test(rel)) continue
    text.split('\n').forEach((ln, i) => {
      const m = ln.match(/^\s{2,4}(\w+)\?\s*:\s*\S/)
      if (m) decls.push({ file: rel, line: i + 1, name: m[1] })
    })
  }
  const count = (name, excludeFile, excludeLine) => {
    const reRead = new RegExp('[.\\?]\\.?' + name + '\\b|\\b' + name + '\\s*\\?\\?|\\{\\s*' + name + '\\s*[,}]|\\b' + name + '\\s*[,}]\\s*=', 'g')
    // 裸标识符读（2026-09-15 补）：非成员访问、非对象字面量键、非可选声明。
    // `(?!\s*:\s*[^:=])` 放行 `name: value`（写）与 `name?: T`（声明），但 `name ? a : b` 里
    // 的 `name` 后跟空格+`?`+空格，不匹配 `:` ⇒ 仍算读（三元真值判断是真读）。
    const reBare = new RegExp('(?<![.\\w$])' + name + '\\b(?!\\s*:)(?!\\s*\\?\\s*:)', 'g')
    const reWrite = new RegExp('(^|[\\s{,(])' + name + '\\s*:(?!:)', 'g')
    const reAssign = new RegExp('\\.' + name + '\\s*(?:\\?\\?|\\|\\||&&)?=(?!=)', 'g')
    let reads = 0, writes = 0
    // 复用预先 strip 好的语料（原先在此对每条声明重 strip 全部文件）
    for (const [rel, strippedText] of stripped) {
      let t = strippedText
      if (rel === excludeFile) {
        const lines = t.split('\n')
        lines.splice(excludeLine - 1, 1)
        t = lines.join('\n')
      }
      reads += (t.match(reRead) ?? []).length + (t.match(reBare) ?? []).length
      writes += (t.match(reWrite) ?? []).length + (t.match(reAssign) ?? []).length
    }
    return { reads, writes }
  }
  const dead = []
  for (const d of decls) {
    const { reads, writes } = count(d.name, d.file, d.line)
    if (reads === 0 && writes === 0) dead.push({ ...d, reads, writes, key: `A|${d.file} ${d.name}` })
  }
  return dead
}

/**
 * 段 B：可选项**只读不写**（`invincibleTime` 模式的字段级同款：引擎读、面板可写、数据不给）。
 * 实现里有 `?? 默认值` 兜底 ⇒ 缺数据时静默走默认，不报错——正是"通道空转"的形态。
 *
 * ⚠ **数据文件里的键必须算「写」**（2026-09-15 修第二个假阳性）：原先写判定只在 `.ts/.vue`
 * 语料里找 `name:`，于是**由 JSON 供给的字段**一律被判「只读不写」。实测后果：
 * `stunAxisPresets` 的 `chapter` / `guarantee` 被判死通道，而它们**有数据**：
 *   · `chapter` —— `src/data/stunAxisPresets/{0章-琉,0章其他,1章-琉,1章其他}.json` 各有
 *     `"chapter": 0/1`，且 `stunAxisPresets.ts:234` 真按它过滤
 *   · `guarantee` —— `5火10大.json` 有值，`TeamConfigPage.vue:1140` 读它
 * 与判据 10（catalog/raw 对账）同族：**数值的唯一事实源常在 JSON 而非 TS**，
 * 只看 TS 会把「数据驱动」误判成「通道空转」。
 */
export function scanReadOnlyOptionalProps(root = ROOT) {
  return memoScan('B', root, () => scanReadOnlyOptionalPropsUncached(root))
}

function scanReadOnlyOptionalPropsUncached(root) {
  const files = walkSrcFiles(root)
  const texts = files.map(f => [relPosix(root, f), readFileSync(f, 'utf8')])
  // strip 一次、全声明复用（同 A 段；原先每条声明重 strip 全语料）
  const stripped = texts.map(([rel, text]) => [rel, stripCommentsAndStrings(text)])
  // 数据语料（2026-09-15 补）：JSON 里的 `"name":` 即「有人供给这个字段」。
  const jsonTexts = []
  for (const dir of ['src', 'public/static']) {
    const rec = (d) => {
      if (!existsSync(d)) return
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) { if (!['node_modules', 'dist', '.git'].includes(n)) rec(p) }
        else if (n.endsWith('.json')) jsonTexts.push([relPosix(root, p), readFileSync(p, 'utf8')])
      }
    }
    rec(join(root, dir))
  }
  const decls = []
  for (const [rel, text] of texts) {
    if (rel.includes('__tests__')) continue
    if (!/^src\/(core|composables|data)\//.test(rel)) continue
    text.split('\n').forEach((ln, i) => {
      const m = ln.match(/^\s{2,4}(\w+)\?\s*:\s*\S/)
      if (m) decls.push({ file: rel, line: i + 1, name: m[1] })
    })
  }
  const count = (name, excludeFile, excludeLine) => {
    const reRead = new RegExp('[.\\?]\\.?' + name + '\\b|\\b' + name + '\\s*\\?\\?|\\{\\s*' + name + '\\s*[,}]|\\b' + name + '\\s*[,}]\\s*=', 'g')
    const reWrite = new RegExp('(^|[\\s{,(])' + name + '\\s*:(?!:)', 'g')
    const reAssign = new RegExp('\\.' + name + '\\s*(?:\\?\\?|\\|\\||&&)?=(?!=)', 'g')
    // 简写属性写（2026-09-15 修第三个假阳性）：`{ …, zeroEnergyRow }` 与 `zeroEnergyRow: v` 等价，
    // 但 reWrite 要求冒号 ⇒ 简写形态被判「零写入」。实测事故：`multiplierCoefficients.ts:164`
    // 的 `zeroEnergyRow,` 是**真写**（:146 计算、:149 用它打标、:299 消费），却被记成只读不写。
    //
    // ⚠ 必须限定「该标识符处在对象/数组**字面量**里」——否则 `Math.max(minGain, base * …)`
    // 这类**函数实参**会被误判成对象简写（那不是写、是读），把**真死通道洗白**
    // （本判据最坏的失效方向；第一版用「前面有 `{` 或有 `,`」就踩了：`minGain` 只有读却因
    //  该行被判「有写入」而退出死通道集合——靠「真死通道仍报」的反向用例抓到）。
    // 判据 = 逐字符扫该标识符**之前**的前缀，跟踪小括号深度；深度为 0 时最后出现的
    // 开符是 `{` 或 `[` ⇒ 在字面量里 = 简写写；是 `(`（函数实参）⇒ 不算写。
    // 同时排除 `const/let/var/function` 绑定声明行。
    // 注意匹配起点：`name` 可能在行首（仅缩进）⇒ 不能用 `[\s{,(]` 作前置捕获，
    // 否则 match.index 落在前一个空白上、前缀切错（第一版即此 bug，`zeroEnergyRow,` 未被识别）。
    const reShorthand = new RegExp('(?<![.\\w$])' + name + '\\s*(?=[,}])', 'g')
    let reads = 0, writes = 0
    // 复用预先 strip 好的语料（原先对每条声明重 strip 全部文件）
    // 同段 A：夹具串/注释里的 `resistances:` 曾把本条真实的死通道抹掉（见 stripCommentsAndStrings）
    for (const [rel, strippedText] of stripped) {
      let t = strippedText
      if (rel === excludeFile) {
        const lines = t.split('\n')
        lines.splice(excludeLine - 1, 1)
        t = lines.join('\n')
      }
      // 简写写判定：必须扫**整份文本**并维护**定界符栈**。
      // 两个反例逼出了正确形态（都实测过）：
      //   ① 按行扫 ⇒ 对象字面量跨行（`units.push({` 在前、`zeroEnergyRow,` 在 20 行后）看不到 `{`；
      //   ② 只认「小括号深度 0 时的 `{`」⇒ 上例的 `{` 在 `push(` 里面（深度 1）照样漏。
      // 正确判据 = 该标识符处**栈顶**是 `{` 或 `[`（= 处在对象/数组字面量里 = 简写写）；
      // 栈顶是 `(`（函数实参，如 `Math.max(minGain, …)`）= 读，不算写。
      let shorthandWrites = 0
      {
        const stack = []
        const bindRe = new RegExp('\\b(?:const|let|var|function)\\s+' + name + '\\b')
        const lineOf = (idx) => { const i = t.lastIndexOf('\n', idx - 1); return t.slice(i + 1, t.indexOf('\n', idx) === -1 ? t.length : t.indexOf('\n', idx)) }
        reShorthand.lastIndex = 0
        let m
        let cursor = 0
        while ((m = reShorthand.exec(t))) {
          for (; cursor < m.index; cursor++) {
            const ch = t[cursor]
            if (ch === '(' || ch === '{' || ch === '[') stack.push(ch)
            else if (ch === ')' || ch === '}' || ch === ']') stack.pop()
          }
          const top = stack[stack.length - 1]
          if (!bindRe.test(lineOf(m.index)) && (top === '{' || top === '[')) shorthandWrites++
        }
      }
      reads += (t.match(reRead) ?? []).length
      writes += (t.match(reWrite) ?? []).length + (t.match(reAssign) ?? []).length + shorthandWrites
    }
    // JSON 供给（与 reWrite 同形态：`"name": value`）
    const reJsonWrite = new RegExp('"' + name + '"\\s*:', 'g')
    for (const [, t] of jsonTexts) writes += (t.match(reJsonWrite) ?? []).length
    return { reads, writes }
  }
  const out = []
  for (const d of decls) {
    const { reads, writes } = count(d.name, d.file, d.line)
    if (reads > 0 && writes === 0) out.push({ ...d, reads, writes, key: `B|${d.file} ${d.name}` })
  }
  return out
}

/**
 * 段 C：手写 `.d.mts` 与实际 `.mjs` **运行时导出**的一致性（TS2305 模式）。
 * 只看「值声明」（`export declare const/function/class/enum`），`interface`/`type` 是纯类型、
 * 不进运行时导出表，误报为漂移。
 *
 * 两个方向都报：
 * - `declared-not-exported`：`.d.mts` 声明了 `.mjs` 没有的值 ⇒ 具名 import 即 **TS2305**
 *   （实测事故：`CORE_ROLE_IMPORT_BASELINE`）。
 * - `exported-not-declared`：`.mjs` 导出了但影子 API 没写 ⇒ TS 侧看不见（本轮实测 2 处）。
 *
 * 实现用**静态抽取**而非 `import()`：本文件自己就是被对账对象之一，动态 import 会成环
 * （实测 `unsettled top-level await`），且执行 `.mjs` 顶层副作用对「导出表」这件事是多余的。
 */
export function scanDtsDrift(root = ROOT) {
  const dir = join(root, 'scripts')
  if (!existsSync(dir)) return { pairs: [], declaredNotExported: [], exportedNotDeclared: [] }
  const dts = []
  const rec = (d) => {
    if (!existsSync(d)) return
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) { if (!['node_modules', 'dist'].includes(n)) rec(p); continue }
      if (n.endsWith('.d.mts')) dts.push(p)
    }
  }
  rec(dir)
  const pairs = []
  const declaredNotExported = []
  const exportedNotDeclared = []
  for (const dtsPath of dts.sort()) {
    const mjsPath = dtsPath.replace(/\.d\.mts$/, '.mjs')
    if (!existsSync(mjsPath)) continue
    const dtsText = readFileSync(dtsPath, 'utf8')
    const mjsText = readFileSync(mjsPath, 'utf8')
    const typeOnly = new Set([...dtsText.matchAll(/export declare (?:interface|type)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]))
    const declared = [...new Set([...dtsText.matchAll(/export declare (?:const|function|class|enum|let|var)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]))]
    // `export * from '<spec>'` 递归解析（T15 审计 #11）：从 .mjs 所在目录解析相对路径，
    // 越出 root 或文件不存在时返回 null（→ 标记名进 runtime，判据变红而非静默）
    const rtSeen = new Set()
    const rtResolve = (spec) => {
      const dir = dirname(mjsPath)
      const abs = spec.startsWith('.') ? join(dir, spec) : null
      if (!abs || !existsSync(abs) || relPosix(root, abs).startsWith('..')) return null
      if (rtSeen.has(abs)) return { source: '', resolve: null }   // 防环
      rtSeen.add(abs)
      return { source: readFileSync(abs, 'utf8'), resolve: rtResolve }
    }
    const runtime = extractRuntimeExports(mjsText, rtResolve)
    const relDts = relPosix(root, dtsPath)
    const relMjs = relPosix(root, mjsPath)
    const dOnly = declared.filter(d => !runtime.includes(d))
    const eOnly = runtime.filter(e => !declared.includes(e) && !typeOnly.has(e))
    pairs.push({ dts: relDts, mjs: relMjs, declared: declared.length, runtime: runtime.length })
    // key 逐符号展开（不是整组一个 key）：豁免/销号要能精到单个符号，
    // 否则「补了一个声明」就得把整组 key 重写一遍（清单会变成一次性消耗品）
    for (const n of dOnly) declaredNotExported.push({ dts: relDts, mjs: relMjs, names: [n], key: `C|${relDts}#${n}` })
    for (const n of eOnly) exportedNotDeclared.push({ dts: relDts, mjs: relMjs, names: [n], key: `C|${relDts}#${n}` })
  }
  return { pairs, declaredNotExported, exportedNotDeclared }
}

/**
 * 从 `.mjs` 源码静态抽取**运行时导出名**。
 * 覆盖四种合法写法：`export function/const/class/let/var <名>`、`export { a, b as c }`、
 * `export { x } from './y.mjs'`（re-export 也是运行时导出）、**`export * from './y.mjs'`**
 * （barrel 写法，2026-09-14 补，T15 审计 #11）。`export type`/`export default` 不计
 * ——前者不进运行时表，后者无具名绑定（本仓 scripts/ 实测零 default export，判据会锁死这条假设）。
 *
 * `export * from './y.mjs'` 必须**递归解析目标文件**（它把目标的所有具名导出原样re-export）：
 * 不解析就会把整组符号误判成 `declared-not-exported` 假红。递归带 visited 集合防环，
 * 目标文件缺失或越出 root 时**不静默**——记一条 `✗` 标记名，让判据变红而不是假装通过。
 *
 * @param source `.mjs` 源码
 * @param resolve 可选：把 `from '<spec>'` 解析成绝对路径（缺省 = 不递归，只当无导出）
 */
export function extractRuntimeExports(source, resolve = null) {
  const names = new Set()
  for (const m of source.matchAll(/^export\s+(?:async\s+)?(?:function|const|class|let|var)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1])
  for (const m of source.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const seg = part.trim()
      if (!seg) continue
      const as = seg.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/)
      names.add(as ? as[2] : seg)
    }
  }
  for (const m of source.matchAll(/^export\s+\*\s+from\s*['"]([^'"]+)['"]/gm)) {
    if (!resolve) continue
    const target = resolve(m[1])
    if (!target) { names.add(`✗ unresolved export * from '${m[1]}'`); continue }
    for (const n of extractRuntimeExports(target.source, target.resolve)) names.add(n)
  }
  return [...names].sort()
}

/** `src/**` 下所有 .ts/.vue 文件（跳过 node_modules/dist/.git） */
function walkSrcFiles(root) {
  const out = []
  const rec = (dir) => {
    if (!existsSync(dir)) return
    for (const n of readdirSync(dir)) {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) { if (!['node_modules', 'dist', '.git'].includes(n)) rec(p) }
      else if (/\.(ts|vue)$/.test(n)) out.push(p)
    }
  }
  rec(join(root, 'src'))
  return out.sort()
}

function relPosix(root, p) {
  return relative(root, p).split(sep).join('/')
}

/**
 * 死通道 burn-down 的**真实剩余工作量** = 豁免清单里 `kind !== 'namesake'` 的条数。
 *
 * 为什么单列这个函数（2026-09-14，T15 审计 #13）：namesake 条目（如 `resistances`）是
 * 「扫描器名字撞车」的**记录**，不是待处置的死通道——它的候选永远存在（reads 恒 > 0），
 * 永远不会 stale，把它算进 burn-down 会让棘轮**永远还不完**（假「有存量」）。
 * 反之若把它从清单删掉，判据又会对它误报 fresh。故：留在清单、但不计工作量。
 * `why` 里必须写明是 namesake（本函数只看 kind，不猜）。
 */
export function countDeadChannelWorkload(allowlist = DEAD_CHANNEL_ALLOWLIST) {
  return Object.values(allowlist).filter(v => v.kind !== 'namesake').length
}

/**
 * 按白名单豁免死通道候选；返回 { fresh, allowlisted, stale }。
 *
 * `stale`（清单里已不再命中的行）**只在同一段内计算**（key 前缀 `A|`/`B|`/`C|`）——
 * 三段各查各的：若拿 global key 列表去比单个段的命中集，A 段的条目会被 B 段调用误报成 stale。
 *
 * ⚠ **必须显式传 `segment`**（2026-09-14 修，T15 审计 #5 发现）：
 * 首版 `segments` 从 candidates 推断，于是「某段被清干净 ⇒ 该段候选集为空 ⇒ 该段永不查 stale」
 * ——实测 A 段清空后清单里 5 条 `A|` 记录永久留存，且棘轮读数照常下降（度量 = allowlisted.length，
 * 候选没了自然 0）。**「修好了但忘了销号」恰好是这个判据要抓的形态，却因为修好了而看不见**。
 * 现改为由**调用方声明本次扫的是哪一段**：候选为空也照常查该段 stale（空 = 全 stale = 红）。
 *
 * 不传 `segment` 时退回「从候选推断段」（`fresh`/`allowlisted` 仍然正确，`stale` 在空候选时为
 * 空数组）——**只给不理解 scope 的旧调用方兜底**，生产接线一律显式传。
 */
export function applyDeadChannelAllowlist(candidates, segment = null) {
  const keys = Object.keys(DEAD_CHANNEL_ALLOWLIST)
  const fresh = candidates.filter(c => !keys.includes(c.key))
  const allowlisted = candidates.filter(c => keys.includes(c.key))
  const hit = new Set(candidates.map(c => c.key))
  const segOf = (k) => k.slice(0, k.indexOf('|') + 1)
  // 显式 scope 优先（空候选也查）；否则从候选推断（旧行为，空候选 = 不查）
  const segments = segment
    ? new Set([segment.endsWith('|') ? segment : segment + '|'])
    : new Set(candidates.map(c => segOf(c.key)))
  const stale = segments.size === 0 ? [] : keys.filter(k => segments.has(segOf(k)) && !hit.has(k))
  return { fresh, allowlisted, stale }
}
