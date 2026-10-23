# MCP 交付备忘：3D 双变量联合响应面与伤害构成立体交互演进 (3D Visualization & Interaction Upgrade)

> 交付日期: 2026-09-18
> 责任主体: ShunCode Agent & Arena Agent 联合工作组
> 归档范围: 可视化组件 `src/components/charts/ResponseSurface3D.vue`、`src/components/charts/TeamDamage3DChart.vue`、集成点 `src/components/ImpactChart.vue` 与 `src/views/ResultPage.vue`

---

## 1. 业务背景与用户诉求

在 ZZZ 计算器（`zzz-calculator`）中，配装调优与伤害分析高度依赖多维变量的非线性耦合：
- **双变量乘区耦合**：如暴击率与暴击伤害、攻击力加成与穿透率、异常掌控与异常精通、总时间与秽盾等变量，在 2D 单变量敏感度曲线中无法观察联合交互与最优配比路径；
- **伤害结构立体认知**：在计算结果分析页中，团队总伤害构成仅有离散表格与扁平标签，缺乏直观、可交互的 3D 视觉深度表达。

针对用户提出的「优化可视化、交互等，比如三维图表」诉求，工作组落地了双核 3D 可视化交互升级方案。

---

## 2. 核心架构与 3D 交互实现

### 2.1 3D 双变量联合响应面组件 (`ResponseSurface3D.vue`)
- **交互式 3D 投影相机**：基于 Canvas 实现球面坐标系渲染（Yaw 方位角 0°~360°、Pitch 俯仰角 5°~88°、Zoom 缩放 0.4x~2.8x、Shift 平移），支持触控/鼠标拖动与平滑阻尼。
- **动态光照曲面与拓扑表现**：
  - 光照曲面模式（Shaded Surface）：计算每个四边形面元的真实 3D 法向量，结合方向光源模型实现 Lambertian 漫反射深度明暗；
  - 霓虹网格模式（Neon Wireframe）：高科技赛博网格线框渲染；
  - 等高线（Iso-Contours）与底面投影：在曲面元内利用线性插值切割出多档位等高线，并在 $Z=0$ 投影面投射同心热力线。
- **高阶特征点标定**：
  - 📍 **当前实战落点**：绿色光球标定实战配置坐标 $(X_{\text{cur}}, Y_{\text{cur}}, Z_{\text{cur}})$，并向下引出虚线投影；
  - 👑 **全域最高峰值**：金色皇冠标定全局最大收益落点与收益上限；
  - 🔍 **实时射线探针 HUD**：鼠标悬停吸附最近网格顶点，实时浮层显示 X/Y 采样值、总伤害及相对当前落点的收益增幅百分比。
- **多档网格与预设对**：
  - 9×9（快速）、13×13（标准）、17×17（精细）多档采样；
  - 内置「双暴配比」、「环境压迫」、「易伤异常」、「双抗压制」等快捷对，亦支持任意全量变量自选。

### 2.2 3D 团队伤害构成立体环组件 (`TeamDamage3DChart.vue`)
- **3D 挤出圆柱立体环（3D Extruded Donut）**：
  - 具备真实俯仰倾角、外侧圆柱侧壁明暗渲染与底面投影光晕；
  - 交互式 360° 旋转与自转动力学；
  - 鼠标悬停切片即时在 3D 空间中平滑上升并向外突显（3D Lift Effect），伴随高亮外边框与浮动 HUD 数据卡；
  - 支持「按伤害类型」（直伤/灼烧/感电/侵蚀/强击/碎冰/紊乱/乱流/耀变/异放）与「按出战角色」双维度自由切换；
  - 支持 3D 环体、3D 柱阵（3D Isometric Bars）与 2D 平面展开等三种渲染形态。

### 2.3 规范与护栏合规保障
- **展示层架构隔离（判据 7）**：新组件严格遵从 ARCHITECTURE §0，仅依赖 `@/utils/format` 及 naive-ui/vue，**零导入** `@/core`、`@/mechanics` 或 `@/specs`，使展出层越层统计严格维持在 15/15 基线。
- **样式隔离（判据 16）**：所有新类名均完备定义在各自组件的 `<style scoped>` 中，scoped 样式失配判定为 0 处违规。
- **零外部运行时依赖**：基于原生 HTML5 Canvas 高性能实时运算，不引入大型外部 WebGL 库，保障构建与包体积精简。

---

## 3. 验收与构建矩阵

| 验证项 | 执行命令 | 结果 | 状态 |
| :--- | :--- | :--- | :--- |
| **护栏判据总检** | `node scripts/check-guards.mjs` | 18/18 全绿（展示层越层 15/15，scoped 样式 0 失配） | **PASS** |
| **护栏单元测试** | `npx vitest run src/scripts/__tests__/checkGuards.test.ts` | 114/114 测例通过 | **PASS** |
| **TypeScript 静态检查** | `npm run typecheck` | 0 errors（vue-tsc 严格类型校验通过） | **PASS** |
| **生产打包构建** | `npm run build` | built in 7.74s，无编译阻断 | **PASS** |
