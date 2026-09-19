/**
 * 判据 4「滑块生效测试」的实现面（R46 结构熵切面，纯搬运）。
 *
 * 为什么需要：每个录入的机制 = spec 字段 + 生效测试（规则 5）。「加了滑块但没有测试引用」
 * = 死数据风险；曾实测般岳 `rageGainCoverage` 滑块静默失效。
 * 棘轮：新增滑块必须带「改滑块→结果确实变」的测试；存量补了测试就从
 * `UNTESTED_SETTINGS_ALLOWLIST` 删一行（漏删不红，只打 warn 提醒回收）。
 *
 * ⚠ 本文件是 check-guards.mjs 判据 4 的**实现**；`runAllChecks` 经 re-export 壳消费。
 * ⚠ 纯搬运保真：正文与搬出前逐字节相同（仅整体 `export` 保留 + 新增本序言）。
 *
 * ## R47：反空洞下限（`SETTINGS_COVERAGE_MIN_MODULES`）
 * 原判据 `ok = newGaps.length === 0` 在**抽取器整体失效**时仍绿（打印 `已测 0/0`，EXIT=0）
 * —— `0/0` 与 `84/84` 在退出码上不可区分。R47 闸门判「前提成立」（`MIN=0` 平凡绿、
 * `MIN≥1` 在恒空注入下红）⇒ 加一条**扫到的模块数 ≥ 冻结实测值**的下限。
 * ⚠ **口径纪律**（与 `NOUN_SOURCE_MIN_KEYS` / `LAYER_INVERSION_MIN_TOTAL_SITES` 同）：
 * 常量**只减不增地**冻结；确需下调先改常量并在提交说明写明理由，**不许**顺手删判据。
 * ⚠ **已知局限（未修，见 `.claude/OPEN-ITEMS.md` R47-J2）**：块起始正则只认 `settings: [`
 * 对象属性形态，17 个用 `const settings: MechanicSetting[] = [` 独立声明的模块**结构性漏扫**
 * （实测 `extractSettingIds(banyue.ts)` = `[]`）。放宽后 35→51 模块 / 84→137 id / 21 个零引用
 * ⇒ 那是「扫描面缩水」另一个缺口，修它要么补 21 条测试要么加豁免（后者 = 放宽判据，禁）。
 *
 * ## R49：扫描面接运行时注册表（正则在 R47/R48 判死后的正解）
 *
 * R48 分诊（`/home/kaua/r48-scratch/evidence/R48-TRIAGE-settings-scan.md`）实测漏扫 **96 id / 5 形态**：
 *   A `settings: [ … ]` 内联（正则唯一认得，84 id）· B `const settings: T[] = [` + 简写 ·
 *   C `settings: <identifier>,` 引用外部变量 · D `<mod>.settings = [ … ]` 注册后挂载 ·
 *   E `specs/agents/*.json` 的 `adjustable`（经 `registry.ts:27-34` 合并注入，**id 不在 .ts 里**）。
 * C 要跨变量解析、D 要跨语句追踪、E 根本不在 TS 里 ⇒ **放宽正则方向不完备**（最多收 B = 57/96）。
 *
 * ⇒ 「有哪些滑块」这一问的真值**只有一个**：`getRegisteredMechanicSettings()`（`registry.ts:41`），
 * 它同时喂 `resolveMechanicSettings()` → `AgentPanelInput.settings` 与资源利用率页的 `v-for` 渲染面。
 * 故扫描面改接**运行时 dump**（`scripts/dump-mechanic-registry.mjs` 子进程 → 单行 JSON）；
 * 父进程用 `execFileSync` 保持 `runAllChecks()` 同步（6 个调用点零改动）。
 *
 * ⚠ **刻意不做缓存**：现跑实测 1.4s，而缓存引入「dump 过期」这一整类静默失效（R45 踩过
 * 「改了代码却测到旧 dist」的假绿）。现跑 = 构造性新鲜。
 * ⚠ `extractSettingIds` **保留**：它不再定「有哪些滑块」，而是**零假阳性的交叉校验面**
 * （正则面必须是注册表面的子集；实测 84/84 全在注册表里）。
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 仓库根（从 `scripts/lib/` 上溯三级；与 check-guards.mjs 的 ROOT 同值） */
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))

// ---- 判据 4：滑块生效测试（「加了滑块但没有测试引用」= 死数据风险） ----

/**
 * 反空洞下限：扫到的**声明了 settings 的模块数**（运行时注册表口径）低于此值 ⇒ 判扫描器失效。
 *
 * 为什么要有（R47 闸门判「前提成立」，见 `.claude/OPEN-ITEMS.md` R46-J2）：
 * 把抽取器注入成恒空 ⇒ 判据 4 打印 **`已测 0/0` 并 `19 guard checks passed`（EXIT=0）**
 * —— 抽取器整体失效与「真的全测」在**退出码上不可区分**。
 * 同族先例：判据 13 `NOUN_SOURCE_MIN_KEYS = 68`、判据 19 `LAYER_INVERSION_MIN_TOTAL_SITES = 8`。
 *
 * ⚠ **口径为什么是「模块数」而不是「滑块数」**：滑块数随录入进展自然增减，拿它当下限 =
 * 把判据强度绑在业务量上（且「今天恰好有 N 个」一改就假红）。模块数 = 「扫描器有没有找到它的输入」
 * 的直接读数。闸门实测判别力：`MIN=0` ⇒ 恒空注入下**平凡绿**（这是立项的收口条件）；
 * `MIN≥1` ⇒ 恒空注入下**红**。故下限**不得**写成 0 / 恒真。
 *
 * ## 2026-09-20 round 49：**35 → 55**（口径纠正，不是退步）
 *
 * 扫描面从「块起始正则」换成「运行时注册表」后按新尺实测：**55 模块 / 180 id**（旧尺 35 / 84）。
 * 这是规则 17② 的「度量口径纠正」——棘轮防的是代码变差，不是防尺子变准（先例：2026-09-12
 * `frozen 8 → 78`，注释原文「78 才是编排层真实的 agentId 特判存量」）。
 * ⚠ 下调到旧值 35 会**失去判别力**：新尺下 35 远低于实测 ⇒ 注册表大面积失效（如 spec glob 断）
 * 仍可能绿。实测判别力：`import.meta.glob` 失效时模块数 55 → **52**（3 个 spec-only 模块消失）
 * ⇒ 下限 55 能抓住它。
 * ⚠ 模块数**自然减少**（模块合并/改名/搬目录）时会红——那是提醒「下限要重新标定」：
 * 按实测值下调并写进提交说明，**不要顺手删判据**（同 `LAYER_INVERSION_MIN_TOTAL_SITES` 纪律）。
 */
export const SETTINGS_COVERAGE_MIN_MODULES = 55

/**
 * 存量缺口冻结清单：**2026-09-20 round 49 换尺时实测的 60 条**「注册了但无任何测试引用」。
 *
 * ⚠ **这不是 `UNTESTED_SETTINGS_ALLOWLIST`（那一个是豁免面，本仓禁止新增）**，是**待办 burn-down 队列**：
 * 每条 = 「该补一条『改滑块→面板/结果确实变』的生效测试」，补一条删一行，删漏只 warn 提醒回收。
 *
 * ## 为什么 60 条是「口径纠正后的存量」而不是「放宽判据」
 *
 * 换尺前这 60 条**零可问责性**（旧扫描面看不见它们，既不红也不点名）；换尺后每一条**具名在册** +
 * 在 `RATCHET_BURNDOWN` 有 due ⇒ 可问责性**上升**。且 `newGaps` 判红逻辑**未动** ⇒ 新滑块仍然红。
 * 规则 17② 明令：「不许为保住好看的数字而维持错误的度量」。
 *
 * ## 批次切法（规则 17②「换尺与改代码不得混批」，本仓硬约束）
 *
 * 本清单 = **换尺批**的产物（零 `src/**` 改动）；补测试 = **后续批次**（可分批，每批删对应行）。
 * ⚠ 补测试必须**走真管线**（`setMechanicSetting` → `resourceResult`/`computePanelPhases`），
 * **不许**直调钩子 + 手写 cfg —— R48 实测：手写 cfg 会把「生产代码写不写这个字段」这个自由度
 * 整个抹掉，让断链「通过」（`anbyC2StunCoverage` 曾因此掩盖恒等 0.5 的真缺陷）。
 *
 * ## 分型（R48 五形态，补测试时按型取法）
 *
 * · **E（38 条，`<四位数>.<resource>.<rule>.rate`）**＝ spec `adjustable`，值经
 *   `specs/resources.ts:150` 的 `setting:${adjustable.id}` **按构造消费** ⇒ 正解是**一条通用
 *   registry 驱动测试**（遍历注册表，min/max 各跑一次真管线比 delta），本任实测 **27/39 有 delta**；
 *   余 12 条需更贴的 fixture（countSource 为 `perfectBlockCount`/`parryCount` 等未被默认队伍触发的量）。
 * · **B/C/D（22 条）**＝ 模块自己 `setting()` 读的覆盖率/次数滑块 ⇒ 逐条写角色级真管线断言。
 */
export const SETTINGS_UNTESTED_BACKLOG = [
  '1021.nekomata_purr.nekomata_chain_gain.rate', // nekomata
  '1021.nekomata_purr.nekomata_ex_gain.rate', // nekomata
  '1021.nekomata_purr.nekomata_ultimate_gain.rate', // nekomata
  '1041.soldier11_charge.soldier11_chain_charge_gain.rate', // soldier11
  '1091.miyabi_frost_fall.miyabi_c2_flower_basic_frost_fall_gain.rate', // miyabi
  '1091.miyabi_frost_fall.miyabi_disorder_frost_fall_gain.rate', // miyabi
  '1091.miyabi_frost_fall.miyabi_frostburn_break_frost_fall_gain.rate', // miyabi
  '1301.orphie_xuyan.xuyan_ex_special_gain.rate', // orphie_magusa
  '1301.orphie_xuyan.xuyan_shiguang_gain.rate', // orphie_magusa
  '1391.jufufu_weishi.jufufu_team_ult_weishi_gain.rate', // jufufu_tiger_roar
  '1391.jufufu_weishi.jufufu_weishi_assist.rate', // jufufu_tiger_roar
  '1441.zhendou_heartfire.zhendou_special_heartfire_gain.rate', // 1441
  '1521.xixifu_toxin.toxin_duya_hold.rate', // xixifu
  '1521.xixifu_toxin.toxin_tuxin_stunned_bonus.rate', // xixifu
  '1531.billy_radiant_star.billy_radiant_chain_gain.rate', // starlight_billy
  '1531.billy_star_glow.billy_star_chain_gain.rate', // starlight_billy
  '1551.peiluo_prominence.peiluo_perfect_block_gain.rate', // peiluo_prominence
  '1561.velina_corrosion.2 命风化获得.rate', // velina
  '1591.sigrid_lance_opportunity.sigrid_hit_opportunity_gain.rate', // sigrid
  '1611.claret_gash.gash_gain_from_sharp_dmg.rate', // claret
  '1621.roxy_wind_energy.wind_energy_per_30_energy.rate', // roxy
  '1621.roxy_wind_eye.wind_eye_from_cannon.rate', // roxy
  'banyue.diDongComboCount', // banyue
  'burnice.flowCountUtilization', // burnice
  'burnice.singleSpraySeconds', // burnice
  'burnice.stirringCount', // burnice
  'claret.bloodBurialCount', // claret
  'claret.chainInWindowCoverage', // claret
  'claret.cleaveSpecialCount', // claret
  'claret.gashCoverage', // claret
  'jane.frenzyActive', // jane
  'liuyin.c6EchoMax', // liuyin
  'liuyin.hug60Count', // liuyin
  'liuyin.previousTeammateSlot', // liuyin
  'lucia.additionalAttackCount', // lucia_elowen
  'lucia.frontSwitchRatio', // lucia_elowen
  'nangong.releaseCoverage', // nangong
  'nangong.vibratoStacksPerRelease', // nangong
  'norma.holdSeconds', // norma
  'roxy.spinSeconds', // roxy
  'sigrid.cinema4Coverage', // sigrid
  'yeshuguang.zhaoyingCount', // yeshuguang
  'yixuan.c6GiftUltCount', // yixuan
  'yixuan.stunExCoverage', // yixuan
]

/** 从 mechanics 模块源码抽 settings 块里的 id（字符串字面量 + 常量引用两种形态） */
export function extractSettingIds(moduleSource) {
  const lines = moduleSource.split('\n')
  let inBlock = false, depth = 0, buf = []
  for (const ln of lines) {
    if (!inBlock && /\bsettings\s*:\s*\[/.test(ln)) {
      inBlock = true
      depth = (ln.match(/\[/g) ?? []).length - (ln.match(/\]/g) ?? []).length
      buf = [ln]
      if (depth <= 0) inBlock = false
      continue
    }
    if (inBlock) {
      buf.push(ln)
      depth += (ln.match(/\[/g) ?? []).length - (ln.match(/\]/g) ?? []).length
      if (depth <= 0) inBlock = false
    }
  }
  if (!buf.length) return []
  const block = buf.join('\n')
  const literal = [...block.matchAll(/\bid\s*:\s*['"]([\w.\-]+)['"]/g)].map(m => m[1])
  const consts = [...block.matchAll(/\bid\s*:\s*([A-Z_][A-Z0-9_]*)\b/g)].map(m => {
    const def = moduleSource.match(new RegExp(`(?:const|let)\\s+${m[1]}\\s*=\\s*['"]([\\w.\\-]+)['"]`))
    return def ? def[1] : `UNRESOLVED:${m[1]}`
  })
  return [...literal, ...consts]
}

/**
 * 运行时注册表快照（判据 4 扫描面的**真值**）。
 *
 * 子进程 + stdout JSON：`scripts/dump-mechanic-registry.mjs` 内部起 vite `ssrLoadModule`
 * （TS + `@/` 别名 + `import.meta.glob` 全原生），dump 完即退。
 * ⚠ **必须子进程**：父进程 `runAllChecks()` 是同步函数（6 个调用点），in-process `import('vite')`
 * 会把整条链传染成 async。⚠ **不缓存**（见文件头：缓存 = 「dump 过期」一整类静默失效）。
 */
export function loadRegistrySnapshot(root = ROOT) {
  const out = execFileSync(
    process.execPath,
    [join(root, 'scripts/dump-mechanic-registry.mjs'), root],
    { cwd: root, encoding: 'utf8', timeout: 180000, maxBuffer: 32 * 1024 * 1024 },
  )
  return JSON.parse(out)
}

/**
 * 扫**运行时注册表**的 settings 声明 + `agents/*.ts` 正则面（零假阳性交叉校验）
 * + 全部 *.test.ts 的引用。
 *
 * 返回：
 * - `declared`：Map(模块 → [ids])，**运行时真值**（键 = `moduleId`，如 `agent:1011`）
 * - `untested`：`模块::id`（无任何测试文本引用）
 * - `stale`：冻结清单里**已有测试**的行（提醒回收）
 * - `regexOnly`：正则面认得但注册表没有的 id（**假阳性**，实测应为 0）
 */
export function scanSettingsCoverage(root = ROOT) {
  const snapshot = loadRegistrySnapshot(root)
  const declared = new Map()
  for (const m of snapshot.byModule) declared.set(m.moduleId, m.ids)

  // 正则面：不再定「有哪些滑块」，只做零假阳性交叉校验（R48 实测 84/84 全在注册表里）
  const agentsDir = join(root, 'src/mechanics/agents')
  const regexIds = new Set()
  if (existsSync(agentsDir)) {
    for (const f of readdirSync(agentsDir).filter(f => f.endsWith('.ts'))) {
      for (const id of extractSettingIds(readFileSync(join(agentsDir, f), 'utf8'))) regexIds.add(id)
    }
  }
  const runtimeIds = new Set()
  for (const ids of declared.values()) for (const id of ids) runtimeIds.add(id)
  const regexOnly = [...regexIds].filter(id => !runtimeIds.has(id)).sort()

  // 全部测试文本（src 下递归）
  const testTexts = []
  const rec = (d) => {
    if (!existsSync(d)) return
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) rec(p)
      else if (n.endsWith('.test.ts')) testTexts.push(readFileSync(p, 'utf8'))
    }
  }
  rec(join(root, 'src'))
  const allTests = testTexts.join('\n')
  const untested = []
  for (const [mod, ids] of declared) for (const id of ids) if (!allTests.includes(id)) untested.push(`${mod}::${id}`)
  // ⚠ 冻结清单按 **id 本体**匹配（不带 `模块::` 前缀）：`registry.ts` 对重复 setting id 直接抛错
  // ⇒ id 在本仓**全局唯一**，而模块 id（`agent:1011` / `agent:nekomata`）会随模块改名/合并漂移。
  // 用 id 当键 ⇒ 模块改名不会让整份清单假 stale（那是「清单腐烂」的经典成因）。
  const stale = SETTINGS_UNTESTED_BACKLOG.filter(e => !untested.some(u => u.endsWith(`::${e}`)))
  return { declared, untested, stale, regexOnly }
}

/**
 * 判据 4 的合取：无新缺口 ∧ 扫描面非空洞（反空洞下限）∧ 正则交叉面零假阳性。
 *
 * ⚠ `minModules` 缺省 = 冻结常量；显式传参只给测试夹具用（同 `layerInversionOk(report, minTotal)` 先例）。
 * ⚠ **第三个合取项是 R49 新增的**：`regexOnly` 非空 ⇒ 正则面认得一个**运行时并不存在**的滑块 id
 * （假阳性）⇒ 说明两个面已经错位（要么正则抓到了非 settings 的 `id:` 字面量，要么注册表漏注册）。
 * 它是**零假阳性**这一 R48 结论的常驻守卫，也是「接运行时面」相对「放宽正则」的判别力证据：
 * 放宽正则会让这个集合立刻非空，而接真值面天然恒空。
 */
export function settingsCoverageOk(report, newGaps, minModules = SETTINGS_COVERAGE_MIN_MODULES) {
  return newGaps.length === 0
    && report.declared.size >= minModules
    && (report.regexOnly ?? []).length === 0
}

/** 归因输出（绿也打印 warn 类回收提醒；红时给逐条归因） */
export function formatSettingsCoverage(report, newGaps, minModules = SETTINGS_COVERAGE_MIN_MODULES) {
  const out = [
    ...newGaps.map(e => `  ✗ 新滑块无测试引用：${e} → 补「改滑块→面板/结果确实变」的生效测试（ARCHITECTURE.md §3 滑块行，般岳 rageGainCoverage 曾静默失效）`),
    ...report.stale.map(e => `  ⚠ 清单可回收：${e} 已有测试，从 SETTINGS_UNTESTED_BACKLOG 删掉该行`),
    ...(report.regexOnly ?? []).map(e => `  ✗ 正则面假阳性：\`${e}\` 被 \`agents/*.ts\` 的 \`settings: [\` 正则扫到，但**不在运行时注册表里** ⇒ 两个面已错位（放宽正则会让这里非空；接真值面应恒空）`),
  ]
  if (report.declared.size < minModules) {
    out.push(`  ✗ 反空洞下限：扫到 ${report.declared.size} 个有 settings 的模块 < ${minModules} —— 运行时注册表疑似失效（如 spec 的 import.meta.glob 断掉 ⇒ 3 个 spec-only 模块消失，实测 55→52）`)
    out.push('    → 先核 node scripts/dump-mechanic-registry.mjs 能否拿到完整快照、src/mechanics/index.ts 是否仍注册全部模块；')
    out.push('      确系模块自然减少再按实测下调 SETTINGS_COVERAGE_MIN_MODULES 并写明理由')
  }
  return out
}
