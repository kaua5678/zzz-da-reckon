#!/usr/bin/env node
/**
 * 生成 docs/architecture-runtime.svg —— 「运行时拓扑」图（回答：为什么不是线性并列）。
 * 与 gen-architecture-diagrams.mjs 的分工：那张是**静态分层**（谁在哪层、值边几条）；
 * 这张是**动态结构**：嵌套收敛环（谁在谁里面）+ 多对多钩子派发 + 分析器扇出。
 * 数字现场实测（git HEAD 对时），结构来自代码（file:line 标注）。
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEAD = execSync("git log -1 --format='%h|%ad' --date=short", { cwd: ROOT, encoding: 'utf8' }).trim().split('|');
const sh = (c) => execSync(c, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }).trim();

/* ---- 实测：钩子面 ---- */
const mods = sh("git ls-files 'src/mechanics/agents/*.ts'").split('\n');
const typesSrc = sh('git show HEAD:src/mechanics/types.ts');
const methods = [...new Set([...typesSrc.matchAll(/^\s{2}([a-zA-Z][A-Za-z0-9]*)\??\s*\(/gm)].map((m) => m[1]))];
const implCount = new Map();
for (const f of mods) {
  const src = sh(`git show HEAD:"${f}"`);
  for (const m of methods) if (new RegExp(`(^|[\\s,{])${m}\\s*[(:,]`, 'm').test(src)) implCount.set(m, (implCount.get(m) || 0) + 1);
}
const implTotal = [...implCount.values()].reduce((a, b) => a + b, 0);
const universal = [...implCount.entries()].filter(([, n]) => n >= 50).sort((a, b) => b[1] - a[1]);
const solo = [...implCount.entries()].filter(([, n]) => n === 1).map(([c]) => c);
/* 派发点口径：排除测试、注释行与 types.ts 的文档提及（shell 里转义正则易错 ⇒ 取回原始行在 JS 里过滤） */
const dispatchLines = sh("grep -rn 'getAgentMechanic(' src --include=*.ts --include=*.vue")
  .split('\n')
  .filter((l) => l && !l.includes('__tests__') && !/:\s*(\/\/|\*)/.test(l) && !l.includes('mechanics/types.ts'));
const dispatch = dispatchLines.length;
const caps = [...new Set(dispatchLines
  .map((l) => l.match(/getAgentMechanic\([^)]*\)\??\.([a-zA-Z0-9]+)/)?.[1])
  .filter(Boolean))];
const moduleObjects = sh("grep -rhE '^export const [A-Za-z0-9_]+: AgentMechanicModule = \\{' src/mechanics/agents/*.ts").trim().split('\n').length;
/* ---- 实测：分析器 ---- */
const scenarioUsers = sh("grep -rln 'AnalysisContext' src/composables/*.ts").split('\n').length;
const viewsUsingScenario = sh("grep -rln 'withAnalysisScenario' src/views/*.vue").split('\n').length;
/* ---- 实测：测试网 ---- */
const testFiles = sh("git ls-files 'src/**/*.test.ts'").split('\n').length;
const testLoc = sh("git ls-files 'src/**/*.test.ts' | xargs cat | wc -l");

/* ---- SVG 基础件 ---- */
const C = { bg: '#0f172a', panel: '#131c31', edge: '#26324a', text: '#e2e8f5', dim: '#94a3b8',
  mono: '"JetBrains Mono", Consolas, monospace', sans: '"Inter", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tw = (s, size) => [...String(s)].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? size * 1.02 : size * 0.60), 0);
const wrap = (s, size, maxW) => { const out = []; let line = '';
  for (const w of String(s).split(/(?<=[\s·、，,])/)) { if (tw(line + w, size) > maxW && line) { out.push(line.trimEnd()); line = w; } else line += w; }
  if (line.trim()) out.push(line.trimEnd()); return out; };
const rects = [];
const track = (x, y, w, h, tag) => { for (const r of rects) if (x < r.x + r.w && r.x < x + w && y < r.y + r.h && r.y < y + h) throw new Error(`重叠: ${tag}(${x},${y},${w},${h}) vs ${r.tag}(${r.x},${r.y},${r.w},${r.h})`); rects.push({ x, y, w, h, tag }); };
let LIMIT = Infinity;
const text = (x, y, s, size, fill, anchor = 'start', family = C.sans, weight = '400') => {
  const end = anchor === 'middle' ? x + tw(s, size) / 2 : x + tw(s, size);
  if (end > LIMIT) throw new Error(`文本越界: ${String(s).slice(0, 20)} ${end.toFixed(0)}>${LIMIT}`);
  return `<text x="${x}" y="${y}" font-family="${esc(family)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;
};
const defs = `<defs>
<marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker>
<marker id="ahB" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker>
<linearGradient id="title" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4493f8"/><stop offset="1" stop-color="#a78bfa"/></linearGradient>
</defs>`;

const W = 1760;
const out = [];
let y = 0;
const panel = (x, yy, w, h, title, color) => {
  out.push(`<rect x="${x}" y="${yy}" width="${w}" height="${h}" rx="10" fill="${C.panel}" stroke="${C.edge}"/>`);
  out.push(`<rect x="${x}" y="${yy}" width="3.5" height="${h}" rx="1.75" fill="${color}"/>`);
  out.push(text(x + 16, yy + 24, title, 14, color, 'start', C.sans, '700'));
};

const NEST_PRE = [
  ['S3 可行化搜索', 'solveTeam.ts:429', '枚举 DOWNSCALE_SCALES 8 档 × 每档重跑整环（最多 5 个 runOuterLoop 调用点）', '#f472b6', '环外重跑整环'],
  ['L1 外层失衡不动点', 'solveTeam.ts:200  k < MAX_OUTER_ITER(20)', '变量 = 失衡次数 · 容差 OUTER_STUN_TOLERANCE=0.05 · 退出 stable / cycle / maxIter（实测 3~4 轮）', '#a78bfa', ''],
  ['L2 内层资源不动点', 'innerLoop.ts:108  k < maxIter(100)', '变量 = 强特/终结次数 + 平A时间 · 判稳 = 严格相等 · 环停点 integerCycleStop（浮点噪声环视为收敛）', '#a78bfa', ''],
  ['L3 时间预算折叠环', 'foldLoop.ts:74  timePass < TIME_FOLD_MAX_PASSES(32)', '变量 = cfg.timeBudgetExcess / timeBudgetRefund · 判据 maxExcess ≤ 1e-3（实测 2~12 轮）', '#a78bfa', ''],
  ['L4 终局重折', 'finalizePasses.ts:78  pass < 12', '仅声明 finalizePass 的模块（伊德海莉 tail）· 判稳 allBitEqual', '#60a5fa', '按模块声明'],
  ['L5 截断重折', 'truncationRefold.ts:73  refoldPass < 3', '变量 = cfg.rowTimeLimit · 不动点 = 本轮 kept 与上轮逐槽一致', '#60a5fa', ''],
  ['S1/S4 单趟', 'iterate → assembleSlot', 'S1 资源账本预解 → S4 装配（截断）——环的叶子里才发生真正的「算一次」', '#94a3b8', ''],
];
/* ============ 左栏：嵌套收敛环（同心盒子 = 真嵌套） ============ */
const LX = 24, LW = 760;
/* 先量高度：同心框每层 inset 9，行数按描述 wrap 算 */
let _h = 0;
NEST_PRE.forEach(([, , desc], i) => { _h += 34 + wrap(desc, 10.5, LW - 32 - i * 18 - 30).length * 14 + 7; });
const NEST_H = _h + 60;
panel(LX, 78, LW, NEST_H, '① 一次计算的运行时：七层嵌套环（谁在谁里面）', '#22d3ee');
out.push(text(LX + 16, 100, '同心框 = 真嵌套调用；虚线回边 = 反馈量写回下一轮（不是顺序流水线）', 11, C.dim));
let ny = 118;
const NW = LW - 32;
NEST_PRE.forEach(([name, loc, desc, color, tag], i) => {
  const inset = i * 9;
  const lines = wrap(desc, 10.5, NW - inset * 2 - 30);
  const h = 34 + lines.length * 14;
  const x = LX + 16 + inset, w = NW - inset * 2;
  out.push(`<rect x="${x}" y="${ny}" width="${w}" height="${h}" rx="7" fill="#0f1a30" stroke="${color}66"/>`);
  out.push(text(x + 12, ny + 18, name, 12, color, 'start', C.mono, '700'));
  out.push(text(x + 12 + tw(name, 12) + 10, ny + 18, loc, 10, C.dim, 'start', C.mono));
  if (tag) out.push(text(x + w - 12, ny + 18, tag, 10, '#fbbf24', 'end', C.mono));
  lines.forEach((ln, j) => out.push(text(x + 12, ny + 33 + j * 14, ln, 10.5, C.dim)));
  track(x, ny, w, h, 'nest:' + name);
  ny += h + 7;
});
/* 回边箭头：从最内层绕回 L1 右侧 */
const backX = LX + LW - 26;
out.push(`<path d="M ${backX} ${ny - 12} C ${backX + 22} ${ny - 12}, ${backX + 22} 140, ${backX} 132" fill="none" stroke="#f472b6" stroke-width="1.6" stroke-dasharray="5 4" marker-end="url(#ah)"/>`);
out.push(text(backX - 8, ny - 40, '17 条跨轮回边', 10.5, '#f472b6', 'end', C.mono));
out.push(text(backX - 8, ny - 26, 'CalcRoundThreads', 10, C.dim, 'end', C.mono));

/* ============ 右栏：多对多派发 + 扇出 ============ */
const RX = LX + LW + 20, RW = W - RX - 24;
const P2H = 330;
panel(RX, 78, RW, P2H, '② 引擎 ↔ 角色模块：多对多（不是调用一个函数）', '#f472b6');
out.push(text(RX + 16, 102, `${moduleObjects} 个模块对象（${mods.length} 个文件，specPanelBuffs 一个文件导出 2 个）· ${methods.length} 个方法钩子 · ${implTotal} 处实现 · ${dispatch} 个按能力查询的派发点 · ${caps.length} 个被查能力`, 11.5, C.text, 'start', C.mono));
out.push(text(RX + 16, 122, '引擎不认 id：getAgentMechanic(id)?.<能力> —— 模块声明能力，引擎按能力查（判据 24 硬门：值依赖 0）', 10.5, C.dim));
let gy = 142;
out.push(text(RX + 16, gy, '通用钩子（几乎所有模块都实现）', 11.5, '#34d399', 'start', C.sans, '700'));
gy += 16;
universal.forEach(([c, n], ci) => {
  const bw = 150;
  const bx = RX + 16 + (ci % 3) * (bw + 8);
  out.push(`<rect x="${bx}" y="${gy - 12}" width="${bw}" height="19" rx="4" fill="#0f1a30" stroke="#34d39955"/>`);
  out.push(text(bx + 8, gy + 2, `${c}  ×${n}`, 10.5, '#34d399', 'start', C.mono));
  track(bx, gy - 12, bw, 19, 'cap:' + c);
  if (ci % 3 === 2) gy += 24;
});
gy += 30;
out.push(text(RX + 16, gy, `单模块专属钩子（= 该角色私有机制的出口，共 ${solo.length} 个）`, 11.5, '#fbbf24', 'start', C.sans, '700'));
gy += 16;
const soloLines = wrap(solo.join(' · '), 10.5, RW - 32);
soloLines.forEach((ln, i) => out.push(text(RX + 16, gy + i * 14, ln, 10.5, C.dim)));

/* ③ 分析器扇出 */
const P3Y = 78 + P2H + 16;
const P3H = 360;
panel(RX, P3Y, RW, P3H, '③ 上层分析器：扇出后扇入（一次出结果 = 跑 N 次整条管线）', '#60a5fa');
const FAN = [
  ['组队对比 teamCompare', '金币/命座/合轴率多维枚举', '贪心 + 缓存', '#'],
  ['时间图表 teamTimeline', '精确增量搜索 + 逐金贪婪', 'SWAP_UPGRADE_UPLIFT_PCT=10', '#'],
  ['难度爬梯 difficultyLadder', 'G1–G5 五目标逐目标贪心爬梯', '纯策略，可换 costOf', '#'],
  ['自由对比 freeCompare/', '四层：指标/轴/约束/求值器', '加指标 = METRICS 加一行', '#'],
  ['抽卡规划 pullPlannerEngine', '期/房间/队友组合枚举', 'oracle 注入，纯逻辑', '#'],
  ['命座提升 cinemaUplift', 'C0→C6 逐级对比', '页面与测试同源', '#'],
];
let fy = P3Y + 24;
out.push(text(RX + 16, fy, `全部经 AnalysisContext（config + calc）拿管线：${scenarioUsers} 个分析器 · ${viewsUsingScenario} 个页面用 withAnalysisScenario 隔离`, 10.5, C.dim));
fy += 20;
FAN.forEach(([name, how, note]) => {
  out.push(`<rect x="${RX + 16}" y="${fy - 13}" width="${RW - 32}" height="30" rx="5" fill="#0f1a30" stroke="#60a5fa44"/>`);
  out.push(text(RX + 26, fy + 2, name, 11, '#60a5fa', 'start', C.mono, '700'));
  out.push(text(RX + 26 + tw(name, 11) + 12, fy + 2, how, 10.5, C.dim));
  out.push(text(RX + RW - 26, fy + 2, note, 10, '#fbbf24', 'end', C.mono));
  track(RX + 16, fy - 13, RW - 32, 30, 'fan:' + name);
  fy += 34;
});
out.push(text(RX + 16, fy + 6, '扇入：结果汇到 6 个页面（TeamComparePage / TimeChartsPage / FreeComparePage / ResourceUtilizationPage / PositionComparePage / RunArchivePage）', 10.5, C.dim));
out.push(text(RX + 16, fy + 24, `为什么不能直接用 active store：分析器要反复改写配置再求值 ⇒ createAnalysisScenario 出生态（effectScope 隔离，判据 analysisScenario.test）`, 10.5, C.dim));

/* ④ 验证网 */
const VY = 78 + NEST_H + 16;
const VH = 200;
panel(LX, VY, LW, VH, '④ 验证网：每层都被机器钉住（这才是「敢重构」的原因）', '#34d399');
const VER = [
  ['分层锁 7 条', 'coreMechanicsRegistryOnly / coreRuntimeDeps / resourceCalcStoreDeps / specsRuntimeDeps / dataRuntimeDeps / 展示层不值导入 / layer-inversion', '#34d399'],
  ['棘轮与硬门', '判据 7 · 19 · 22 · 23 · 24 · 25 · 26（id 字面量 0、值依赖 0、死读 0）', '#34d399'],
  ['全局回归网', `allAgentsSweep（全角色 × 命座 0/6 不变量）· timeGolden（105 预设时间账）· timeFillRatchet（留白棘轮）`, '#34d399'],
  ['证据链', `recordings 原文契约 · validate:specs 逐条认定消费 · verify:recording 交付闸门 · ${testFiles} 测试文件 / ${Number(testLoc).toLocaleString('en-US')} 行`, '#34d399'],
];
let vy = VY + 28;
VER.forEach(([k, v]) => {
  out.push(text(LX + 20, vy, k, 11.5, '#34d399', 'start', C.mono, '700'));
  const lines = wrap(v, 10.5, LW - 190);
  lines.forEach((ln, i) => out.push(text(LX + 150, vy + i * 13, ln, 10.5, C.dim)));
  vy += Math.max(20, lines.length * 13 + 8);
});

const H = Math.max(VY + VH, P3Y + P3H) + 40;
LIMIT = W - 12;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(C.sans)}">
<rect width="${W}" height="${H}" fill="${C.bg}"/>${defs}
${text(24, 34, 'ZZZ 伤害计算器 · 运行时拓扑（为什么不是线性并列）', 21, C.text, 'start', C.sans, '700')}
${text(24, 56, `实测 @${HEAD[0]}（${HEAD[1]}）：静态分层见 docs/architecture-layers.svg；本图回答「结构上非线性在哪」——嵌套环 / 多对多派发 / 分析器扇出 / 验证网。生成器 scripts/gen-architecture-runtime.mjs`, 11.5, C.dim)}
<line x1="24" y1="66" x2="${W - 24}" y2="66" stroke="url(#title)" stroke-width="2"/>
${out.join('\n')}
</svg>`;
writeFileSync(path.join(ROOT, 'docs/architecture-runtime.svg'), svg);
console.log(`钩子：${moduleObjects} 模块对象 / ${mods.length} 文件 / ${methods.length} 钩子 / ${implTotal} 实现 / ${dispatch} 派发点 / ${caps.length} 能力；通用 ${universal.length} 个，专属 ${solo.length} 个`);
console.log('已生成 docs/architecture-runtime.svg');
