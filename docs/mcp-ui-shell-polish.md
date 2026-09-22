# UI 外壳美术打磨（顶栏 + 全局质感）

> 2026-09-21。范围 = **应用外壳**（顶栏 / 品牌区 / 分段导航 / 全局交互反馈），
> 不含任何业务页面。主题切换机制**未改动**（`stores/theme.ts` + `html.light` 维持原样）。
> 配套入口：`src/styles/global.css`（令牌）+ `src/components/AppHeader.vue`（消费）。

## 1. 立项口径：为什么不是"再做一个主题切换"

接到的需求含"可以弄个主题切换功能"。**实测该功能已存在**，故未重复建设：

| 能力 | 现状位置 |
| --- | --- |
| `dark` / `light` 双模式 + localStorage `zzz-theme` | `src/stores/theme.ts` |
| 首帧防闪烁（挂载前预置 `html.light`） | `index.html` 内联脚本 |
| 顶栏日/月切换按钮 | `AppHeader.vue` `.theme-toggle` |
| Naive UI 明暗桥接（两套 `themeOverrides`） | `src/App.vue` |
| 令牌双主题对称的机器校验 | `check-tokens` 判据 2 `theme-parity` |

⇒ 增量落在**外壳视觉语言**上，且全部以"新令牌 + var() 消费"的形式沉淀，
自动继承既有双主题能力（新增 10 个令牌 × 2 档，见 §3）。

## 2. 改了什么（视觉）

### 2.1 顶栏 `.app-header`

- **斜向扫描纹理**（`::before`）：45° 细线、7px 循环，`mask-image` 向右淡出
  —— 左侧品牌区最实、右侧工具区最净，形成视觉重心。
  ⚠ 独立伪元素层而非 `background-image` 叠在自身：后者与 `backdrop-filter`
  毛玻璃的层叠顺序打架（实测纹理会被模糊糊掉）。
- **底部霓虹导轨**（`::after`）：电蓝 → S级金 → 电蓝，两端透明淡出，
  替代原本单调的 1px `border-bottom`。全局唯一一条"品牌色横贯屏宽"的元素。
- `.header-left/center/right` 统一 `position: relative; z-index: 1`
  —— 两个 absolute 装饰层必须压在内容之下。

### 2.2 品牌徽章 `.brand-badge`

- 金属高光扫过：`::after` 一道 20° 斜白条，`.brand:hover` 时从左掠到右
  （`brand-sheen-sweep`，`--dur-slow`）。静止时停在框外 `left:-60%`，零视觉噪声。
- 三处字面色值收进令牌：`#241a03` → `--brand-ink`、
  `rgba(255,181,0,.35)` → `--brand-glow`、高光白 → `--brand-sheen`。

### 2.3 分段导航

- `.tab-section-label`（配置/分析/对比/规划/开发）**从裸文字升级为胶囊贴片**：
  原本 12px 灰字与 tab 文字混在一起，扫视时分不清"分组名"还是"可点 tab"。
  现为 `--shell-chip-bg` 底 + `--shell-chip-line` 描边 + 11px 字距 1px。
- 激活 tab 的下划线加辉光：`filter: drop-shadow(var(--shell-tab-glow))`。
  ⚠ 用 `filter` 而非 `box-shadow`：bar 是伪元素，`box-shadow` 会被裁掉。
- 开发区紫色 bar `#a855f7` → `--dev-accent`（亮色档压深到 `#7c3aed`，
  原值在白底上只有 3.1:1）。

### 2.4 主题按钮 `.theme-toggle`

hover 时 `color: --app-accent-gold` + `rotate(-18deg)` —— 日/月图标切换的
"天体运行"暗示。原本只有 naive 默认底色变化，反馈太弱。

### 2.5 全局质感（`global.css`）

- **键盘焦点环全局兜底**：`:where(a, button, [tabindex]):focus-visible`。
  此前只有主题按钮单独处理过，其余控件 Tab 过去要么无反馈、要么是浏览器
  默认黑虚线（深底上几乎不可见）。`:focus-visible` 不打扰指针用户。
- 卡片 hover 描边提亮（`--wa-200`）+ 亮色档阴影加深到 `--shadow-3`。
  ⚠ **不用 transform 位移**：本仓库大量卡片内嵌 sticky 表头与 SVG 图表，
  位移会让 sticky 计算基准漂移、SVG 出现亚像素模糊。只动光影。
- 滚动条 thumb 加 `--dur-base` 过渡；`::selection` 去 `text-shadow`。

## 3. 新增令牌（`--shell-*` / `--brand-*` / `--dev-*`）

为什么与 `--app-*` 分开命名：`--app-*` 是"页面通用表面"语义（bg/panel/border/text），
本层描述的是**应用外壳自身的视觉语言**。页面组件不该引用 `--shell-*`，
外壳也不该被页面配色牵着走。

| 令牌 | 夜间 | 明亮 |
| --- | --- | --- |
| `--shell-grid-line` | `rgba(148,163,184,.07)` | `rgba(51,65,85,.05)` |
| `--shell-rail` | 电蓝→金渐变（.55/.75） | 压深版（.5/.7，`#d97706` 金） |
| `--shell-tab-glow` | `0 0 10px` 蓝光晕 | `0 1px 3px` 实投影 |
| `--shell-chip-bg` / `-line` | `rgba(148,163,184,.10/.18)` | `rgba(51,65,85,.06/.12)` |
| `--brand-ink` | `#241a03` | 同值（金底黑白通吃） |
| `--brand-glow` | `0 2px 12px` 金光晕 .38 | `0 2px 8px` .45 |
| `--brand-sheen` | 白 .55 | 白 .70 |
| `--dev-accent` (+`-glow`) | `#a855f7` | `#7c3aed`（白底 3.1:1 不够 ⇒ 压深） |

**亮色档通则：整体收敛。** 白底上的 blur 辉光会糊成脏雾、纹理会变噪点
⇒ glow 一律换成"实体投影 + 更低透明度"，纹理浓度下调一档。

### ⚠ 必须定义在**已有**的 `:root` / `html.light` 块内

`check-tokens` 的 `parseGlobalTokens` 用 `match(/^\s*:root\s*\{/m)` 只取**第一个**块。
另起一个 `:root { }` 块 = 令牌对判据**完全不可见** ⇒ 组件里 `var(--shell-*)`
会被 `tokens-defined` 判为未定义而红。本轮初版正是这么写的，实测触发后改为并入原块。

## 4. 护栏结果（`npm run check-tokens`）

12 judgments 全绿。三条基线按棘轮纪律更新（**全部是进步方向**）：

| 基线键 | 改前 | 改后 | 归因 |
| --- | --- | --- | --- |
| `HARDCODED_BASELINE['AppHeader.vue']` | 3 | **2** | 3 处字面色值收进令牌；剩余 2 处是 `mask-image`/关键帧里的 `rgba(0,0,0,α)` —— **遮罩通道**不是颜色（alpha 才有意义，RGB 恒被忽略），换令牌无意义 |
| `WA_REF_BASELINE` | 448 | **447** | `.tab-section-label` 的 `--wa-420` → `--app-text` |
| `VAR_TOTAL_BASELINE` | 778 | **800** | 外壳质感层全部走 var() 消费 |

令牌总数 148 → **158**，需双主题对称的 100 → **110**，硬编码色值合计 108 → **107**。

### 被判据拦下的一处真问题（记录以免重犯）

`.tab-section-label` 初版用 `--app-text-dim` 做墨色 —— 它作为**页面底上的次要文字**
完全合规，但该元素升级为贴片后**自带底色**，`tinted-contrast` 实测
**dark 4.42 / light 3.27，双双低于 4.5** 而报红。

修法 = 上抬到 `--app-text`（dark 15.2 / light 13.9）。
**视觉层级改由字号(11px) + 字距 + 胶囊底承担，不靠压低墨色** —— 压墨换来的
"次要感"代价是可读性，11px 尺寸上尤其不划算。这正是判据 11 存在的理由：
判据 5 的背景固定取 `--app-panel`，对"贴片上的墨"结构不可见。

## 5. 验证

| 项 | 结果 |
| --- | --- |
| `npm run check-tokens` | 12/12 passed |
| `npm run check-guards` | 20/20 passed |
| `vitest run src/scripts/__tests__/checkTokens.test.ts` | 58/58 passed |
| `npm run build` | ✓ built in 9.27s |
| 双主题实机截图（1600×900 @2x，Playwright） | 明暗两档均无塌陷、零 pageerror |

实机复核确认：夜间档金徽章/斜纹/胶囊/蓝辉光/霓虹导轨均正常；
亮色档纹理压淡、胶囊浅灰底、导轨压深不发灰。

## 6. 无障碍

- 两处动效（品牌高光扫过、主题按钮旋转）均包在 `@media (prefers-reduced-motion: reduce)`
  里置为 `none`。
- 焦点环从"仅主题按钮"扩展到全部可聚焦元素。
- 所有新增前景/背景对均过 WCAG AA 4.5（由 `tinted-contrast` 机器校验）。

## 7. 未做（留给后续）

- 业务页面（team/attribute/resource/result/compare/charts）的视觉统一 —— 本轮范围
  明确限定在外壳，页面级改动面大、风险高，应单独立项并逐页取证。
- 顶栏在 `max-width: 900px` 下隐藏了品牌标题与分段标签；胶囊化后小屏是否需要
  保留分段标签（改为纯图标？）未做移动端实测。
