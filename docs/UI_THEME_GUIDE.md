# UI 主题系统指南（明暗双主题 · AI 接手 UI 改动的入口文档）

> 本文是 UI 改动的**唯一导航**：改颜色/加主题/调样式前先读完本文，不要从零翻目录。
> 配套代码入口：`src/styles/global.css`（变量定义）+ `src/stores/theme.ts`（切换逻辑）+ `src/App.vue`（Naive UI 桥接）。

## 1. 心智模型：三层颜色体系

```
┌─ 语义层 --app-* ──────────────────────────────┐
│ 用途命名（bg/panel/border/text/primary...）      │
│ 页面组件只允许引用这一层，禁止写死色值            │
├─ 色阶层 --wa-<α×1000> ────────────────────────┤
│ 单色透明色阶：夜间=白、明亮=深墨(23,26,31)同α    │
│ 从历史 rgba(255,255,255,α) 机械迁移而来，        │
│ 47 档(15..900)，用于次要文字/描边/悬浮底         │
├─ 字面色值（仅 3 处合法）────────────────────────┤
│ ① global.css 的变量定义本体                     │
│ ② App.vue 的 Naive UI overrides（需具体色值）   │
│ ③ 强调色（ZZZ 属性色/S级金/危险红等品牌色）      │
└───────────────────────────────────────────────┘
```

**判断该用哪层**：日常改样式 → `--app-*` 或 `--wa-*`；只有定义变量本身和品牌强调色才允许 hex。

## 2. 双主题变量表（真源在 global.css，本表是导读）

| 变量 | 夜间（:root 默认） | 明亮（html.light） | 用途 |
| --- | --- | --- | --- |
| `--app-bg` | `#0f172a`（slate-900 海军蓝） | `#edf1f7`（冷灰蓝画布） | 页面底 |
| `--app-panel` | `rgba(255,255,255,0.035)` | `#ffffff` | 内嵌面板底 |
| `--app-border` | `rgba(148,163,184,0.16)` | `rgba(51,65,85,0.14)` | 通用描边（slate 带蓝） |
| `--app-text` / `--app-text-dim` | 白 0.9 / 0.48 | 墨 0.9 / 0.5 | 正文/次要字 |
| `--app-text-solid` | `#ffffff` | `#1f2329` | 标题/强调字（"纯白"的替身） |
| `--app-primary` | `#4493f8`（电蓝，ZZZ 电 #2EB6FF 提饱和版） | `#2f6ee0`（压深保 4.5:1 白字） | 主色/链接/tab bar |
| `--app-accent-gold` | `#FFB500` | 同值 | **ZZZ S级金**：品牌徽章/高亮点缀 |
| `--app-header-bg` | `rgba(15,23,42,0.85)` | `rgba(255,255,255,0.85)` | 顶栏毛玻璃底 |
| `--app-inset` | `rgba(2,6,23,0.5)` | `rgba(15,23,42,0.06)` | 内嵌暗坑（表头旁/输入底） |
| `--app-tablehead-bg` | `#1e293b`（slate-800） | `#e3e8f0` | sticky 表头底 |
| `--app-tooltip-bg/text` | `rgba(30,41,59,0.96)`/白 | `rgba(255,255,255,0.97)`/墨 | SVG 图表 tooltip |
| `--scrollbar-thumb(-hover)` | 蓝灰 0.28/0.42 | 蓝灰 0.22/0.34 | 滚动条 |
| `--link-color` | `#6cb2ff` | `#2f6ee0` | 链接 |
| `--wa-15..900`（47 档） | `rgba(255,255,255,α)` | `rgba(23,26,31,α)` | 次要字/描边/浅底（α=档位/1000） |

> 色温锚点：暗色 = Tailwind slate-900 `#0f172a`（蓝调肉眼可辨，不是黑）；明亮 = slate-100/200 之间的 `#edf1f7`（冷灰蓝，不是白）。surface 各提一层：暗色提 slate-800、明亮压 slate-200 系。

**明亮模式卡片**：`html.light .n-card { box-shadow: 0 1px 2px + 0 2px 6px rgba(16,24,40,...) }`（纸面层次），夜间保持扁平描边。

## 3. 主题切换机制（改流程先读这段）

1. **持久化**：`src/stores/theme.ts` — `mode: 'dark' | 'light'`，localStorage key `zzz-theme`（缺省 dark）。切换 = toggle `<html>` 的 `light` class + `color-scheme` + PWA `theme-color`。
2. **防首帧闪烁**：`index.html` `<head>` 里有一段内联脚本，挂载前按 localStorage 预置 `html.light`。**key 改名必须两处同步**（store + index.html）。
3. **Naive UI 桥接**：`src/App.vue` — `naiveTheme = mode==='dark' ? darkTheme : null`（null = naive 内置亮色）；`themeOverrides` 按模式二选一（darkOverrides/lightOverrides）。品牌色梯子按模式分开定义（亮色主色必须压深，保证按钮白字对比）。
4. **改动流程**：改色值 → 只动 global.css + App.vue 两处；加新变量 → global.css 双主题各加一份（缺一侧 = 明亮模式漏色）→ 本表登记。

## 4. SVG 图表的坑（重要）

SVG presentation attribute（`fill="var(...)"` / `stroke="var(...)"`）**不可靠**（多数浏览器仅识别具体色值，var() 会被忽略导致黑色）。三种正确写法：
- **静态色**：class + CSS（如 ImpactChart/TeamCompare 的 `.chart-grid/.chart-tick/.chart-tooltip-box`）
- **动态三目**：`:style` 绑定（如 TimeCharts 的 `:style="{stroke: hover ? 'var(--app-text-solid)' : 'var(--wa-250)'}"`）
- **强品牌色**：直接 hex（如击杀线 `#e88080`，两主题通用）

例外：泳道块上的深色描边光晕（`rgba(0,0,0,·)` paint-order stroke）是画在**彩色块**上的，两主题都成立，保留 hex。

## 5. ZZZ 品牌色板（强调色从这里取）

来源：萌娘百科 [ZZZcolor 模板](https://zh.moegirl.org.cn/Template:ZZZcolor)（提取自游戏内代表色）。

| 用途 | 色值 |
| --- | --- |
| **S级金（品牌锚点，徽章已用）** | `#FFB500` |
| 电 / 冰 / 火 / 物理 / 以太 | `#2EB6FF` `#3FE0E3` `#FF5522` `#F0D12A` `#FE427E` |
| 玄墨 / 凛刃 / 风 / 流明 | `#BB7D33` `#889EFF` `#A4C0F4` `#FFA7DB` |
| 增益文本 / 减益文本 | `#33A20F` `#BD232B` |

角色/属性专属色已在用：ResourcePage 的 specialty/attribute map、TeamCompare 的阵容色。这些是**数据色**不是主题色，明暗通吃，不进变量表。

## 6. 设计口径（审美决策与依据）

- **夜间蓝黑而非纯灰黑**：shadcn/Radix 流派（zinc/slate 底带蓝调）比中性黑更"被设计过"；同时呼应 ZZZ 电属性蓝。[shadcn Color Library](https://v3.shadcn.com/colors)
- **明亮冷白纸面 + 白卡柔和阴影**：Tailwind/shadcn 亮色惯例，数据密集页可读性最好。
- **主色夜间亮、明亮深**：`#4493f8` vs `#2f6ee0`——亮色下白字按钮对比度要 ≥4.5:1（WCAG AA）。
- **S级金做品牌锚点**：ZZZ 最有辨识度的颜色（抽卡金），只用在徽章级别的小面积，大面积会腻。
- **dev tabs 紫色 `#a855f7`**：与主 tab 蓝区分"开发/计算器"两个区域，两主题通吃。

## 7. 常见 UI 任务速查

| 任务 | 入口 |
| --- | --- |
| 调某页某元素颜色 | 找到该 .vue，用 `--app-*`/`--wa-*`；发现写死色值→顺手迁变量 |
| 全局换主色/底色 | `global.css` 两套变量 + `App.vue` overrides（品牌色梯子 4 个值都要换） |
| 加第三个主题（如跟随系统） | `stores/theme.ts` 加 mode + `global.css` 加 `html.<name>` 块 + App.vue 加 overrides 分支 + index.html 脚本 |
| 改亮暗切换动画 | `global.css` body 的 transition + `.n-card` 过渡 |
| 新 SVG 图表颜色 | §4 三种写法，禁止 presentation attribute 写 var() |
| 检查明亮模式漏色 | grep 新改动文件里的 `rgba(255` / `#fff` / `#0f0f` 等字面值 |

## 8. 历史决策记录（Changelog）

- **2026-08 v1 主题基建**：418 处硬编码 `rgba(255,255,255,α)` codemod 迁移到 `--wa-*` 色阶；暗底/纯白 10 处迁语义变量；SVG 属性位 var() 改 class/:style。主题基建（store/双套变量/NaiveUI 桥/防闪烁）落地。
- **2026-08 v2 审美化**：夜间底 `#0f0f12`→`#0b0e15`（蓝黑）；明亮 `#f4f5f7`→`#f5f6f8`+白卡阴影；主色 `#4c8bf5`→夜间 `#4493f8`/明亮 `#2f6ee0` 分梯；品牌徽章蓝紫渐变→**S级金渐变**（ZZZ 抽卡金 `#FFB500`）；tab bar 接 `--app-primary`；趋势线接主色变量；补 body 主题切换过渡。
- **2026-08 v3 色温加码**：v2 蓝调太弱（`#0b0e15`/`#f5f6f8` 肉眼读成黑白），整体切 slate 锚点——夜间底 `#0f172a`(slate-900)、surface 提 slate-800、描边换蓝灰 `rgba(148,163,184,·)`；明亮底 `#edf1f7`(slate-100/200 间冷灰蓝)、描边 `rgba(51,65,85,·)`；滚动条/inset/表头/tooltip 全同步蓝灰；Naive modal/popover 换 slate-800；明亮卡阴影加重一档。经验：**色温要"过"一点才读得出**，差 3~10 个通道值等于没改。
