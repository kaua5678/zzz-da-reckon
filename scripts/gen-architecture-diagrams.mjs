#!/usr/bin/env node
/**
 * 生成 docs/architecture-layers.svg（分层架构）与 docs/architecture-calc-flow.svg（一次计算的数据流）。
 *
 * 为什么是脚本而不是手画：图里的「文件数 / 行数 / 值边条数」必须是**当前实测**，
 * 手抄会在几轮开发后静默过期（ARCHITECTURE-OVERVIEW.md §1 那张表就从 9 月旧到了 10 月）。
 * 跑一次即重生：node scripts/gen-architecture-diagrams.mjs
 *
 * 口径（与 docs/ARCHITECTURE-OVERVIEW.md §0 同源，刻意保持一致以便对比）：
 *   - 扫描面 = git ls-files 下 src 全部 ts/vue，剔除 __tests__ / *.test.ts / *.d.ts
 *   - 分组 = src/ 下一级目录；core/ composables/ 再拆已知二级子目录（resource/anomalyPool/stunAxis/charts/freeCompare）
 *   - 值边 = import/export from + 动态 import()，@/ 别名归一；import type 单独计数，不计入值边
 *
 * 自检：XML 可解析 + 盒子不重叠 + 文本不溢框，任一不过即 exit 1（图不能悄悄画坏）。
 * 幂等性：同一 HEAD 下重跑产物逐字节一致；HEAD 变了（图题带 commit hash + 日期，实测数字也可能变）
 * 产物会跟着变——这是特性，不是不确定源。
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs');

/* ---------- 测量 ---------- */
const SUBDIRS = new Set(['resource', 'anomalyPool', 'stunAxis', 'charts', 'freeCompare']);
const groupOf = (spec) => {
  const p = spec.replace(/^@\//, 'src/').split('/');
  if (p.length >= 3 && (p[1] === 'core' || p[1] === 'composables') && SUBDIRS.has(p[2])) return `${p[1]}/${p[2]}`;
  return p[1];
};
const files = execSync("git ls-files 'src/**/*.ts' 'src/**/*.vue'", { cwd: ROOT, encoding: 'utf8' })
  .trim().split('\n')
  .filter((f) => !f.includes('__tests__') && !f.endsWith('.d.ts') && !/\.test\.tsx?$/.test(f));
const testFiles = execSync("git ls-files 'src/**/*.test.ts'", { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);

let LIMIT = Infinity;         // 当前画布可用右缘（每个 SVG 入口赋值）
const locByGroup = new Map();  // group -> LOC
const cntByGroup = new Map();  // group -> 文件数
const locMap = new Map();     // file -> LOC
const bump = (g, n) => { locByGroup.set(g, (locByGroup.get(g) || 0) + n); cntByGroup.set(g, (cntByGroup.get(g) || 0) + 1); };
const edges = new Map();      // "a -> b" -> { value, type }
let totalLoc = 0, testLoc = 0;
for (const f of files) {
  const src = execSync(`git show HEAD:"${f}"`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  const n = src.split('\n').length; totalLoc += n; bump(groupOf(f), n); locMap.set(f, n);
  const re = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;]*?)from\s+['"]([^'"]+)['"]/g;
  for (const m of src.matchAll(re)) {
    if (!m[3].startsWith('@/') && !m[3].startsWith('.')) continue;
    const tg = groupOf(m[3]); if (tg === '(ext)') continue;
    const k = `${groupOf(f)} -> ${tg}`;
    const c = edges.get(k) || { value: 0, type: 0 };
    c[m[1] ? 'type' : 'value']++; edges.set(k, c);
  }
  for (const m of src.matchAll(/import\(\s*['"]@\/([^'"]+)['"]\s*\)/g)) {
    const tg = groupOf('@/' + m[1]);
    const k = `${groupOf(f)} -> ${tg}`; const c = edges.get(k) || { value: 0, type: 0 }; c.value++; edges.set(k, c);
  }
}
for (const f of testFiles) {
  testLoc += execSync(`git show HEAD:"${f}"`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n').length;
}
const V = (a, b) => edges.get(`${a} -> ${b}`)?.value ?? 0;
const T = (a, b) => edges.get(`${a} -> ${b}`)?.type ?? 0;
const sumInto = (a, bs) => bs.reduce((s, b) => s + V(a, b), 0);   // 一个起点 → 多个终点组
const sumFrom = (as, b) => as.reduce((s, a) => s + V(a, b), 0);   // 多个起点组 → 一个终点
const n = (x) => x.toLocaleString('en-US');
const LOC = (g) => locByGroup.get(g) || 0;
const CNT = (g) => cntByGroup.get(g) || 0;
const filesIn = (gs) => gs.reduce((s, g) => s + CNT(g), 0);
const HEAD = execSync("git log -1 --format='%h|%ad' --date=short", { cwd: ROOT, encoding: 'utf8' }).trim().split('|');

/* 编排层四桶（E 精确；A/P/G 按文件名关键词粗分，SVG 上标 ≈）——直接复用主循环的文件清单与行数 */
const compFiles = files.filter((f) => f.startsWith('src/composables/'));
const locOf = locMap;
const buckets = { E: [], P: [], G: [], A: [] };
for (const f of compFiles) {
  const b = path.basename(f, '.ts');
  if (f.includes('resourceCalc/') || b === 'useResourceCalc') buckets.E.push(f);
  else if (/(Chart|Geometry|Axis|Hover|Sampling|Pointer|seriesFilter|useStatLabel|liveInteractions|svgHitTest|pointTime|versionChart)/i.test(b)) buckets.P.push(f);
  else if (/(Store|Startup|Import|Deploy|Scenario|batchTask|persistedRef|bossRoom|bossSchedule|teamConfigPresetIO)/i.test(b)) buckets.G.push(f);
  else buckets.A.push(f);
}
const bLoc = (k) => buckets[k].reduce((s, f) => s + locOf.get(f), 0);
const ENGINE_G = ['core', 'core/resource', 'core/anomalyPool', 'core/stunAxis'];
const agentMods = execSync("git ls-files 'src/mechanics/agents/*.ts'", { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').length;
const agentSpecs = execSync("git ls-files 'src/specs/agents/*.json'", { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').length;

/* ---------- SVG 基础件 ---------- */
const C = {
  bg: '#0f172a', band: '#131c31', bandEdge: '#26324a', chip: '#1e293b',
  text: '#e2e8f5', dim: '#94a3b8', mono: '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
  sans: '"Inter", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tw = (s, size) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? size * 1.02 : size * 0.60), 0);
const wrap = (s, size, maxW) => {
  const out = [];
  let line = '';
  for (const word of String(s).split(/(?<=[\s·、，,])/)) {
    if (tw(line + word, size) > maxW && line) { out.push(line.trimEnd()); line = word; }
    else line += word;
  }
  if (line.trim()) out.push(line.trimEnd());
  return out;
};
const rects = [];
function track(x, y, w, h, tag) {
  for (const r of rects) {
    if (x < r.x + r.w && r.x < x + w && y < r.y + r.h && r.y < y + h)
      throw new Error(`盒子重叠: ${tag} vs ${r.tag}`);
  }
  rects.push({ x, y, w, h, tag });
}
function text(x, y, s, size, fill, anchor = 'start', family = C.sans, weight = '400') {
  const end = anchor === 'middle' ? x + tw(String(s), size) / 2 : x + tw(String(s), size);
  if (end > LIMIT) throw new Error('文本越界: ' + String(s).slice(0, 20) + ' 右缘 ' + end.toFixed(0) + ' > ' + LIMIT);
  return `<text x="${x}" y="${y}" font-family="${esc(family)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
}
function arrowV(x, y1, y2, label, color, dashed = false) {
  const ah = 6;
  const d = dashed ? ` stroke-dasharray="4 3"` : '';
  return `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2 - ah}" stroke="${color}" stroke-width="1.6"${d} marker-end="url(#ah)"/>`
    + text(x + 6, (y1 + y2) / 2 + 4, label, 11.5, color, 'start', C.mono);
}
const defs = `<defs>
<marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
<path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker>
<linearGradient id="title" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4493f8"/><stop offset="1" stop-color="#a78bfa"/></linearGradient>
</defs>`;

/* ---------- 图 1：分层架构 ---------- */
function layersSvg() {
  rects.length = 0;
  const W = 1720; LIMIT = W - 12;
  const ML = 20, CHIP = 176, GAP = 14, RIGHT_W = 470;
  const BX = ML + CHIP + 12;                 // 内容区左缘
  const BW = W - ML - RIGHT_W - 24 - BX;      // 内容区宽
  const RX = W - ML - RIGHT_W;               // 右侧面板左缘
  let y = 86;
  const out = [];
  const band = (num, name, sub, color, boxes) => {
    const bx = boxes.map((b) => ({ ...b, lines: wrap(b.detail, 11.5, b.w - 26) }));
    const h = Math.max(74, ...bx.map((b) => 26 + 16 + b.lines.length * 15 + 12)) + 12;
    out.push(`<rect x="${ML}" y="${y}" width="${W - ML * 2}" height="${h}" rx="10" fill="${C.band}" stroke="${C.bandEdge}"/>`);
    out.push(`<rect x="${ML + 10}" y="${y + 10}" width="${CHIP - 20}" height="${h - 20}" rx="7" fill="${C.chip}"/>`);
    out.push(`<rect x="${ML + 10}" y="${y + 10}" width="3.5" height="${h - 20}" rx="1.75" fill="${color}"/>`);
    out.push(text(ML + 26, y + 34, `${num} ${name}`, 15, C.text, 'start', C.sans, '700'));
    out.push(text(ML + 26, y + 52, sub, 10.5, C.dim, 'start', C.mono));
    let used = 0;
    for (const b of bx) {
      if (b.w < 120) throw new Error('band 盒子过窄: ' + b.title + ' w=' + b.w);
      if (tw(b.title, 12.5) > b.w - 26) throw new Error('band 标题溢框: ' + b.title);
      used += b.w;
    }
    if (used + GAP * (bx.length - 1) > BW + 1) throw new Error('band 盒子总宽 ' + used + ' 超出内容区 ' + BW);
    let x = BX;
    for (const b of bx) {
      out.push(`<rect x="${x}" y="${y + 10}" width="${b.w}" height="${h - 20}" rx="7" fill="#0f1a30" stroke="${color}55"/>`);
      out.push(text(x + 13, y + 30, b.title, 12.5, color, 'start', C.mono, '700'));
      b.lines.forEach((ln, i) => out.push(text(x + 13, y + 48 + i * 15, ln, 11.5, C.dim)));
      track(x, y + 10, b.w, h - 20, `band${num}:${b.title}`);
      x += b.w + GAP;
    }
    const bottom = y + h; y = bottom + 10; return bottom;
  };

  const b1 = band('①', '展示层', `views+components · ${filesIn(['views', 'components'])} 文件 · ${n(LOC('views') + LOC('components'))} 行`, '#4493f8', [
    { w: 250, title: 'src/views', detail: `${LOC('views').toLocaleString('en-US')} 行 · 19 个页面：CalculatorView / ResultPage / TeamComparePage / TimeChartsPage / FreeComparePage / ResourceUtilizationPage …` },
    { w: 250, title: 'src/components', detail: `${LOC('components').toLocaleString('en-US')} 行 · AppHeader / CharacterCard / FinalPanel / StatPanel / charts/*（10 个图表组件）` },
    { w: BW - 500 - GAP * 2, title: '不许直连引擎', detail: '值导入 core / mechanics / specs = 0（check-guards 判据 7）——展示层只经 composables 与 stores 进引擎' },
  ]);
  arrowV(BX + 60, b1 + 2, y - 6, `composables ${V('views', 'composables') + V('components', 'composables')}`, '#4493f8');
  arrowV(BX + 330, b1 + 2, y - 6, `components ${V('views', 'components')}`, '#4493f8');

  const b2 = band('②', '编排层', `src/composables · ${buckets.E.length + buckets.A.length + buckets.P.length + buckets.G.length} 文件 · ${n(LOC('composables'))} 行（四块，目录不拆）`, '#22d3ee', [
    { w: 268, title: 'E 伤害管线后半段', detail: `${bLoc('E').toLocaleString('en-US')} 行 · resourceCalc/ + useResourceCalc.ts：solveTeam 外层不动点 → convergence 单轮 → damagePool* 最终伤害 → panelPhases` },
    { w: 268, title: 'A 分析器 / 优化器', detail: `≈${bLoc('A').toLocaleString('en-US')} 行 · teamCompare / teamTimeline / difficultyCurve / pullPlanner / freeCompare / substatOptimizer（多次调用整条管线）` },
    { w: 250, title: 'P 图表几何', detail: `≈${bLoc('P').toLocaleString('en-US')} 行 · charts/ 与 *Chart.ts：坐标 / 命中 / 悬浮卡纯函数` },
    { w: BW - 268 - 268 - 250 - GAP * 3, title: 'G 胶水', detail: `≈${bLoc('G').toLocaleString('en-US')} 行 · store ↔ 页面适配、导入导出、calculatorStartup` },
  ]);
  arrowV(BX + 60, b2 + 2, y - 6, `core 合计 ${sumInto('composables', ENGINE_G)}`, '#22d3ee');
  arrowV(BX + 330, b2 + 2, y - 6, `mechanics ${V('composables', 'mechanics')}（registry 查能力）`, '#f472b6');
  arrowV(BX + 700, b2 + 2, y - 6, `data ${V('composables', 'data')} · utils ${V('composables', 'utils')}`, '#94a3b8');

  const b3 = band('③', '引擎层', `src/core · ${filesIn(ENGINE_G)} 文件 · ${n(ENGINE_G.reduce((s, g) => s + LOC(g), 0))} 行（纯函数，只查询不注册）`, '#a78bfa', [
    { w: 268, title: 'core/resource/', detail: `${LOC('core/resource').toLocaleString('en-US')} 行 · calcTeamResources 阶段表 S0–S5：iterate 内层收敛 / innerLoop / foldLoop / 时间截断 / crossAgentEnergy` },
    { w: 268, title: 'core 顶层', detail: `${(LOC('core') - LOC('core/resource') - LOC('core/anomalyPool') - LOC('core/stunAxis')).toLocaleString('en-US')} 行 · damage 乘区 / buff 局外局内 / panel 面板 / stunPool 失衡池` },
    { w: BW - 268 - 268 - GAP * 2, title: 'anomalyPool / stunAxis', detail: `${(LOC('core/anomalyPool') + LOC('core/stunAxis')).toLocaleString('en-US')} 行 · 异常积蓄池 / 紊乱 / 失衡轴` },
  ]);
  arrowV(BX + 60, b3 + 2, y - 6, `mechanics ${sumFrom(ENGINE_G, "mechanics")}（只经 registry）`, '#f472b6');
  arrowV(BX + 500, b3 + 2, y - 6, 'panel/damage 读 data', '#94a3b8');

  const b4 = band('④', '状态层', `src/stores · ${filesIn(['stores'])} 文件 · ${n(LOC('stores'))} 行`, '#f59e0b', [
    { w: 380, title: 'stores/', detail: 'config（队伍 / 敌人 / 设置 / 滑块）· catalog（只读数据快照，运行时 fetch public/static）· logicEditor · theme / ui · selectionReads（纯函数）' },
    { w: 300, title: '⑤ 逻辑编辑', detail: `logicEditor/ ${LOC('logicEditor')} 行 · 用户自定义规则：类型 / 校验 / 本地存储 / 转 spec；fusion 行融合规则全局快照` },
    { w: BW - 380 - 300 - GAP * 2, title: 'store → 引擎', detail: `config 仍直调 core/substatOptimizer 等 ${V('stores', 'core')} 处（A2 已知欠账）` },
  ]);

  const b5 = band('⑥', '录入层', `specs + mechanics · ${filesIn(['specs', 'mechanics'])} 文件 · ${n(LOC('specs') + LOC('mechanics'))} 行（最大的一层）`, '#f472b6', [
    { w: 250, title: 'src/specs', detail: `${LOC('specs').toLocaleString('en-US')} 行 · agents/*.json ${agentSpecs} 份声明式 spec（数值 / teamBuffs / attributeConversions）` },
    { w: 300, title: 'src/mechanics', detail: `${LOC('mechanics').toLocaleString('en-US')} 行 · registry + ${agentMods} 个角色 TS 模块（applyPanel / applyTeamConfig / crossAgentSupply 钩子）` },
    { w: BW - 250 - 300 - GAP * 2, title: '机制主权的边界', detail: `模块 → spec 解释器 ${V('mechanics', 'specs')} 条；模块 → core ${V('mechanics', 'core') + V('mechanics', 'core/resource')} · → data ${V('mechanics', 'data')} · → utils ${V('mechanics', 'utils')}` },
  ]);
  arrowV(BX + 60, b5 + 2, y - 6, '运行时 fetch（非 import 边）', '#fbbf24');

  const b6 = band('⑦', '数据层', 'public/static + scripts/（唯一事实源）', '#fbbf24', [
    { w: 420, title: 'public/static/*.json', detail: 'catalog.json（倍率 / 属性 / buff / boss / 音擎 / 驱动盘）· boss-presets · teammate-buffs · enginePools——只经 scripts/ 导入，禁手改' },
    { w: BW - 420 - GAP, title: 'scripts/ 导入器', detail: 'import-*.mjs / validate-data / minify:static（紧凑写 + 顶层键白名单，产物不变量由 validate:data 强制）' },
  ]);

  band('⑧', '公共底', `data + types + utils · ${filesIn(['data', 'types', 'utils'])} 文件 · ${n(LOC('data') + LOC('types') + LOC('utils'))} 行`, '#94a3b8', [
    { w: 250, title: 'src/data', detail: `${LOC('data').toLocaleString('en-US')} 行 · 纯函数 + 常量 + 预设（teamPresets / stunAxisPresets / moveFusions / filmEconomy…），各层都可依赖` },
    { w: 250, title: 'src/types', detail: `${LOC('types').toLocaleString('en-US')} 行 · resource/ 按域拆（time / energy / execution / team / config / pools）+ barrel` },
    { w: BW - 250 - 250 - GAP * 2, title: 'src/utils', detail: `${LOC('utils').toLocaleString('en-US')} 行 · statMeta / format 等（进入一切层的叶子）` },
  ]);

  /* 右侧：护栏面板 */
  const guards = [
    ['展示层 → core / mechanics / specs', `值边 0（判据 7 detectExhibitionLayerImport）`],
    ['录入层 → 编排层', `值边 0；${T('mechanics', 'composables')} 条 import type 豁免（判据 19 layer-inversion）`],
    ['core → 角色模块', `只经 mechanics/registry 查询能力，禁 import @/mechanics index（coreMechanicsRegistryOnly.test）`],
    ['specs → core / mechanics / composables', '值边 0（specsRuntimeDeps.test 闭包锁）'],
    ['data → 任何上层', '值边 0（dataRuntimeDeps.test；只白名单 logicEditor/fusion）'],
    ['src/** 的 id 字面量', '四位 agentId / 七位 moveId = 0（判据 26 id-literal-gate，id 的家只在 data/ mechanics/agents/ specs/）'],
  ];
  const gh = 34 + guards.length * 34 + 46;
  out.push(`<rect x="${RX}" y="86" width="${RIGHT_W}" height="${gh}" rx="10" fill="#101a2e" stroke="#26324a"/>`);
  out.push(text(RX + 14, 110, '0 值边 = 机器护栏（新增代码违反时 verify 变红）', 13, C.text, 'start', C.sans, '700'));
  guards.forEach(([k, v], i) => {
    const gy = 134 + i * 34;
    out.push(text(RX + 14, gy, '✓', 12, '#34d399', 'start', C.mono, '700'));
    out.push(text(RX + 32, gy, k, 11.5, C.text, 'start', C.mono));
    wrap(v, 10.5, RIGHT_W - 52).forEach((ln, j) => out.push(text(RX + 32, gy + 13 + j * 13, ln, 10.5, C.dim)));
  });
  const finalNote = ' damages 注：core 只算到执行行；最终伤害在编排层 resourceCalc/damagePool*.ts。'.replace(' damages', '⚠');
  out.push(text(RX + 14, 134 + guards.length * 34 + 6, finalNote, 11, '#fbbf24,', 'start', C.sans));
  const noteY = 134 + guards.length * 34 + 6;
  out.pop();
  wrap('⚠ 最终伤害在编排层算：core 只到执行行为止，damagePool*.ts 在 composables/resourceCalc/。', 11, RIGHT_W - 28)
    .forEach((ln, i) => out.push(text(RX + 14, noteY + i * 14, ln, 11, '#fbbf24')));

  const h = Math.max(y, 86 + gh) + 66;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" font-family="${esc(C.sans)}">
<rect width="${W}" height="${h}" fill="${C.bg}"/>${defs}
${text(ML + 4, 34, 'ZZZ 伤害计算器 · 分层架构', 21, C.text, 'start', C.sans, '700')}
${text(ML + 4, 54, `实测 @${HEAD[0]}（${HEAD[1]}）：${files.length} 个非测试文件 / ${n(totalLoc)} 行；${testFiles.length} 个测试文件 / ${n(testLoc)} 行；${agentMods} 个角色机制模块 / ${agentSpecs} 份 spec。生成器 scripts/gen-architecture-diagrams.mjs，数字随代码重生。`, 11.5, C.dim)}
<line x1="${ML}" y1="66" x2="${W - ML}" y2="66" stroke="url(#title)" stroke-width="2"/>
${out.join('\n')}
</svg>`;
}

/* ---------- 图 2：一次计算的数据流 ---------- */
function flowSvg() {
  rects.length = 0;
  const W = 1500; LIMIT = W - 30;
  let y = 80;
  const out = [];
  const node = (title, detail, color, w = 640, x = 40) => {
    const lines = wrap(detail, 11.5, w - 28);
    const h = 24 + lines.length * 15 + 14;
    out.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#101a2e" stroke="${color}66"/>`);
    out.push(`<rect x="${x}" y="${y}" width="3.5" height="${h}" rx="1.75" fill="${color}"/>`);
    out.push(text(x + 16, y + 22, title, 12.5, color, 'start', C.mono, '700'));
    lines.forEach((ln, i) => out.push(text(x + 16, y + 40 + i * 15, ln, 11.5, C.dim)));
    track(x, y, w, h, 'flow:' + title);
    const b = y + h; y = b + 22; return b;
  };
  const gap = () => { out.push(`<line x1="360" y1="${y - 16}" x2="360" y2="${y + 4}" stroke="#475569" stroke-width="1.6" marker-end="url(#ah)"/>`); };
  const note = (txt, yPos, x = 700) => {
    wrap(txt, 11, W - x - 30).forEach((ln, i) => out.push(text(x, yPos + i * 14, ln, 11, '#94a3b8')));
  };

  node('页面点「计算」 → useResourceCalc()', '编排层入口（composables/useResourceCalc.ts）：把 configStore 的现场装配成 ResourceCalcConfig，下面全部由它串起来', '#4493f8');
  gap();
  node('buildCharConfig ×3 → applyTeamMechanics("build")', '每角色一个 CharacterOperationConfig（面板 + 招式数据 + 机制模块注入）；跨角色 / 队伍级钩子第一阶段（composables/resourceCalc/helpers.ts、panelPhases.ts）', '#22d3ee');
  gap();
  node('computePanelPhases → core/panel.ts calcPanel', '局外面板 → 局内 buff 加权（core/buff.ts）→ 队友 buff（core/inCombatBuffs.ts、teammateBuffSource.ts）→ cfg.panel', '#a78bfa');
  gap();
  node('solveTeam：外层不动点', '失衡次数 ↔ 资源池 ↔ 转大 ↔ 异常喧响奖励 的外层循环；S3 可行化决策 stageResolveFeasibility 在这里，不在 useResourceCalc（resourceCalc/solveTeam.ts）', '#22d3ee');
  gap();
  node('runCalcRound（单轮）+ applyTeamMechanics("converge")', 'convergence.ts#createRunCalcRound：跨轮反馈量集合 CalcRoundThreads（新增反馈 = 加字段 + 初值 + 轮内读写，不动签名）；enemy.stunCountLock ≥ 0 时失衡次数锁定不回填', '#22d3ee');
  gap();
  const coreTop = y;
  node('core/resource.ts calcTeamResources —— 阶段表 S0–S5（唯一事实源在该函数头注释）', 'S0 输入装配 → S1 runInnerLoop（iterate：能量 → 强特 → 喧响 → 终结 → 时间，多轮收敛 + 时间预算外层循环）→ S2 runFoldLoop → S3a 尾段管线 → S4 assembleSlot（buildExecutions + 模块钩子 buildResourceResult）', '#a78bfa');
  note('S5 截断：truncateExecutionsToFrontline 整数装包，超战斗时间的部分折入 necessaryTime 压缩平A池（坑 22）；跨角色回能唯一事实源 calcCrossAgentEnergy', coreTop + 8);
  gap();
  node('enrichExecutionPlan → 提取失衡 / 异常执行', '从倍率表回填 damage/daze/decibel/anomaly（覆盖 name/note，匹配一律用 moveId）；失衡池 core/stunPool ← 异常积蓄池 core/anomalyPool', '#a78bfa');
  gap();
  node('damagePool*.ts buildDamagePoolRows', '编排层算最终伤害：直接伤害 / 异常 / 紊乱 / 失衡 / 赠礼行 + 覆盖率；结果 = useResourceCalc 的 damagePoolRows', '#f472b6');
  gap();
  node('页面渲染', 'ResultPage / StatPanel / FinalPanel / charts/*；「时间分配汇总」composables/teamTimeSummary.ts（纯函数，页面只渲染）', '#4493f8');

  const h = y + 30;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" font-family="${esc(C.sans)}">
<rect width="${W}" height="${h}" fill="${C.bg}"/>${defs}
${text(40, 34, '一次计算的生命周期：点「计算」→ 出图', 21, C.text, 'start', C.sans, '700')}
${text(40, 56, '与 docs/ARCHITECTURE.md §1 同源；阶段顺序不可交换（每阶段语义以 core/resource.ts 阶段表为准）', 11.5, C.dim)}
<line x1="40" y1="66" x2="${W - 40}" y2="66" stroke="url(#title)" stroke-width="2"/>
${out.join('\n')}
</svg>`;
}

writeFileSync(path.join(OUT, 'architecture-layers.svg'), layersSvg());
writeFileSync(path.join(OUT, 'architecture-calc-flow.svg'), flowSvg());
console.log('编排层四桶（E 精确 / A·P·G 关键词粗分）：',
  Object.entries(buckets).map(([k, v]) => `${k} ${v.length}f/${bLoc(k)}L`).join(' · '),
  `= ${compFiles.length}f/${bLoc('E') + bLoc('A') + bLoc('P') + bLoc('G')}L（对账 composables ${compFiles.length}f/${LOC('composables')}L）`);
console.log('已生成 docs/architecture-layers.svg · docs/architecture-calc-flow.svg');
console.log(`规模：${files.length} 非测试文件 / ${totalLoc} 行；测试 ${testFiles.length} 文件 / ${testLoc} 行`);
console.log(`关键值边：展示→编排 ${V('views', 'composables') + V('components', 'composables')} · 编排→引擎 ${sumInto('composables', ENGINE_G)} · 引擎→mechanics ${sumFrom(ENGINE_G, 'mechanics')} · 模块→spec ${V('mechanics', 'specs')}`);
