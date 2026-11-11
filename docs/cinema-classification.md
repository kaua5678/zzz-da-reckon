# 命座提升率分类表（384 级 · 引擎三反事实）

> 生成/校验：`src/composables/cinemaClassify.ts` + `__tests__/cinemaClassify.test.ts`（全量护栏）。
> 口径：用户 2026-11-05 裁决「纯属性提升的命座可以直接用面板计算，涉及资源的需要重算新资源的净增益，
> 在此基础上乘面板属性增益」+「很多名座都加速失衡加速积蓄还有新招式。还是不锁吧」。
> 分解算法与三个通道的含义见 `src/composables/cinemaUpliftBreakdown.ts` 头注释。
>
> - **资源 %**：次数 / 能量 / 喧响 / 失衡次数换来的净增益（单次伤害冻结在旧值）
> - **执行 %**：同样招式**单次伤害变了**（技能等级 / 招式倍率 / 附伤 / 新招式行）
> - **面板 %**：在**新资源基线**上乘的面板属性增益
> - 三段连乘 = 总提升（定义式）；`NONE` = 三条通道都没动
>
> 重新生成：`CINEMA_CLASSIFY_UPDATE=1 npx vitest run src/composables/__tests__/cinemaClassify.test.ts`

## 全表

| 级 | 角色 | 状态 | 通道 | 总 % | 资源 % | 执行 % | 面板 % | 面板字段（旧→新） | 资源字段（旧→新） | 执行字段（旧→新） | 新行 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **NONE**（31 级） |||||||||||
| 1011C4 | 安比 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1031C4 | 妮可 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1041C4 | 「11号」 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1081C2 | 比利 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1101C1 | 珂蕾妲 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1101C2 | 珂蕾妲 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1111C1 | 安东 | **partially_implemented** | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1111C2 | 安东 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1111C6 | 安东 | **partially_implemented** | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1121C1 | 本 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1131C1 | 苍角 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1131C2 | 苍角 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1141C2 | 莱卡恩 | implemented | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1141C4 | 莱卡恩 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1151C1 | 露西 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1151C6 | 露西 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1161C4 | 莱特 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1211C1 | 丽娜 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1271C1 | 赛斯 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1271C4 | 赛斯 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1281C6 | 派派 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1311C4 | 耀嘉音 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1351C1 | 波可娜 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1411C4 | 柚叶 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1421C1 | 潘引壶 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1421C4 | 潘引壶 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1421C6 | 潘引壶 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1441C6 | 真斗 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1461C4 | 「席德」 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1551C6 | 佩洛伊斯 | **not_described_not_implemented** | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| 1661C6 | 知更鸟 | impl_approximation | NONE | 0.00 | 0.00 | 0.00 | 0.00 | — | — | — | — |
| **RESOURCE**（11 级） |||||||||||
| 1011C1 | 安比 | impl_approximation | RESOURCE | 9.37 | 9.37 | 0.00 | 0.00 | — | energyGainEfficiency 0.0→12.0 | — | — |
| 1141C1 | 莱卡恩 | impl_approximation | RESOURCE | 1.21 | 1.21 | 0.00 | 0.00 | — | — | — | — |
| 1151C2 | 露西 | impl_approximation | RESOURCE | 1.34 | 1.34 | 0.00 | 0.00 | — | — | — | — |
| 1181C4 | 格莉丝 | impl_approximation | RESOURCE | 0.29 | 0.33 | -0.04 | 0.00 | — | — | — | — |
| 1191C4 | 艾莲 | impl_approximation | RESOURCE | 0.88 | 0.88 | 0.00 | 0.00 | — | — | — | — |
| 1251C4 | 青衣 | impl_approximation | RESOURCE | 0.69 | 0.69 | 0.00 | 0.00 | — | — | — | — |
| 1281C1 | 派派 | impl_approximation | RESOURCE | 5.07 | 5.07 | 0.00 | 0.00 | physicalAnomalyBuildUpEfficiency 80.0→120.0（走资源） | — | piperMomentumStacks 20.0→30.0 | — |
| 1521C6 | 希希芙 | impl_approximation | RESOURCE | 13.62 | 13.62 | 0.00 | 0.00 | — | — | — | — |
| 1551C4 | 佩洛伊斯 | impl_approximation | RESOURCE | 2.28 | 2.28 | 0.00 | 0.00 | — | — | stunBuildUpBonus 0.0→10.0 | — |
| 1561C2 | 维琳娜 | impl_approximation | RESOURCE | 4.06 | 4.06 | 0.00 | 0.00 | — | — | velinaCinema2 0.0→1.0 | — |
| 1611C6 | 克拉蕾 | impl_approximation | RESOURCE | 3.36 | 3.36 | 0.00 | 0.00 | — | — | — | — |
| **EXEC**（112 级） |||||||||||
| 1011C2 | 安比 | impl_approximation | EXEC | 3.45 | 0.00 | 3.45 | 0.00 | — | — | — | — |
| 1011C3 | 安比 | impl_generic_skill_level | EXEC | 7.90 | 0.00 | 7.90 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1011C5 | 安比 | impl_generic_skill_level | EXEC | 7.33 | 0.00 | 7.33 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1011C6 | 安比 | impl_approximation | EXEC | 9.80 | 0.00 | 9.80 | 0.00 | — | — | — | — |
| 1031C3 | 妮可 | impl_generic_skill_level | EXEC | 8.08 | 0.00 | 8.08 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1031C5 | 妮可 | impl_generic_skill_level | EXEC | 7.47 | 0.00 | 7.47 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1041C2 | 「11号」 | impl_approximation | EXEC | 17.08 | 0.00 | 17.08 | 0.00 | — | — | — | — |
| 1041C5 | 「11号」 | impl_generic_skill_level | EXEC | 7.99 | 0.00 | 7.99 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1041C6 | 「11号」 | impl_approximation | EXEC | 10.89 | 0.00 | 10.89 | 0.00 | — | — | — | — |
| 1051C3 | 伊德海莉 | impl_generic_skill_level | EXEC | 8.91 | 0.00 | 8.91 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1051C5 | 伊德海莉 | impl_generic_skill_level | EXEC | 8.18 | 0.00 | 8.18 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1061C6 | 可琳 | impl_approximation | EXEC | 1.17 | 0.00 | 1.17 | 0.00 | — | — | — | 1 |
| 1071C3 | 凯撒 | impl_generic_skill_level | EXEC | 8.45 | 0.00 | 8.45 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1071C4 | 凯撒 | impl_approximation | EXEC | 6.06 | 0.00 | 6.06 | 0.00 | — | — | — | 1 |
| 1071C5 | 凯撒 | impl_generic_skill_level | EXEC | 7.82 | 0.00 | 7.82 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1081C4 | 比利 | impl_approximation | EXEC | 4.43 | 0.00 | 4.43 | 0.00 | — | — | — | — |
| 1091C3 | 雅 | impl_generic_skill_level | EXEC | 9.09 | 0.00 | 9.09 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1091C5 | 雅 | impl_generic_skill_level | EXEC | 8.33 | 0.00 | 8.33 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1101C3 | 珂蕾妲 | impl_generic_skill_level | EXEC | 8.56 | 0.00 | 8.56 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1101C4 | 珂蕾妲 | impl_approximation | EXEC | 4.61 | 0.00 | 4.61 | 0.00 | — | — | — | — |
| 1101C6 | 珂蕾妲 | impl_approximation | EXEC | 8.04 | 0.00 | 8.04 | 0.00 | — | — | — | 1 |
| 1111C3 | 安东 | impl_generic_skill_level | EXEC | 8.72 | 0.00 | 8.72 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1111C5 | 安东 | impl_generic_skill_level | EXEC | 8.03 | 0.00 | 8.03 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1121C2 | 本 | impl_approximation | EXEC | 2.42 | 0.00 | 2.42 | 0.00 | — | — | — | 1 |
| 1121C4 | 本 | impl_approximation | EXEC | 5.58 | 0.00 | 5.58 | 0.00 | — | — | — | — |
| 1121C6 | 本 | impl_approximation | EXEC | 0.00 | 0.00 | 0.00 | 0.00 | — | — | stunBuildUpBonus__basic 0.0→20.0; stunBuildUpBonus__dashAttack 0.0→20.0; stunBuildUpBonus__dodgeCounter 0.0→20.0 | — |
| 1131C3 | 苍角 | impl_generic_skill_level | EXEC | 8.53 | 0.00 | 8.53 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1131C5 | 苍角 | impl_generic_skill_level | EXEC | 7.86 | 0.00 | 7.86 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1131C6 | 苍角 | impl_approximation | EXEC | 6.58 | 0.00 | 6.58 | 0.00 | — | — | — | — |
| 1141C5 | 莱卡恩 | impl_generic_skill_level | EXEC | 8.18 | 0.00 | 8.18 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1151C3 | 露西 | impl_generic_skill_level | EXEC | 8.37 | 0.00 | 8.37 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1151C5 | 露西 | impl_generic_skill_level | EXEC | 7.72 | 0.00 | 7.72 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1161C5 | 莱特 | impl_generic_skill_level | EXEC | 7.86 | 0.00 | 7.86 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1171C3 | 柏妮思 | impl_generic_skill_level | EXEC | 4.38 | 0.00 | 4.38 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1171C4 | 柏妮思 | impl_approximation | EXEC | 5.71 | 0.00 | 5.71 | 0.00 | — | — | — | — |
| 1171C6 | 柏妮思 | impl_approximation | EXEC | 13.06 | 0.00 | 13.06 | 0.00 | — | — | — | 2 |
| 1181C3 | 格莉丝 | impl_generic_skill_level | EXEC | 5.81 | 0.00 | 5.81 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1181C5 | 格莉丝 | impl_generic_skill_level | EXEC | 5.50 | 0.00 | 5.50 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1191C3 | 艾莲 | impl_generic_skill_level | EXEC | 8.77 | 0.00 | 8.77 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1191C5 | 艾莲 | impl_generic_skill_level | EXEC | 8.06 | 0.00 | 8.06 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1201C2 | 悠真 | impl_approximation | EXEC | 4.53 | 0.00 | 4.53 | 0.00 | — | — | — | — |
| 1201C6 | 悠真 | impl_approximation | EXEC | 34.44 | 0.00 | 34.44 | 0.00 | — | — | — | 1 |
| 1211C3 | 丽娜 | impl_generic_skill_level | EXEC | 8.08 | 0.00 | 8.08 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1211C5 | 丽娜 | impl_generic_skill_level | EXEC | 7.48 | 0.00 | 7.48 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1221C3 | 月城柳 | impl_generic_skill_level | EXEC | 5.04 | 0.00 | 5.04 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1221C5 | 月城柳 | impl_generic_skill_level | EXEC | 4.80 | 0.00 | 4.80 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1251C3 | 青衣 | impl_generic_skill_level | EXEC | 8.10 | 0.00 | 8.10 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1251C5 | 青衣 | impl_generic_skill_level | EXEC | 7.50 | 0.00 | 7.50 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1261C5 | 简 | impl_generic_skill_level | EXEC | 5.24 | 0.00 | 5.24 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1271C3 | 赛斯 | impl_generic_skill_level | EXEC | 7.37 | 0.00 | 7.37 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1271C6 | 赛斯 | impl_approximation | EXEC | 8.86 | 0.00 | 8.86 | 0.00 | — | — | — | 1 |
| 1281C2 | 派派 | impl_approximation | EXEC | 6.80 | 0.00 | 6.80 | 0.00 | — | — | — | — |
| 1291C1 | 雨果 | implemented | EXEC | 12.40 | 0.00 | 12.40 | 0.00 | — | — | — | — |
| 1291C2 | 雨果 | impl_approximation | EXEC | 6.50 | 0.00 | 6.50 | 0.00 | — | — | — | — |
| 1291C3 | 雨果 | impl_generic_skill_level | EXEC | 9.09 | 0.00 | 9.09 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1291C4 | 雨果 | impl_approximation | EXEC | 12.00 | 0.00 | 12.00 | 0.00 | — | — | — | — |
| 1291C5 | 雨果 | impl_generic_skill_level | EXEC | 8.33 | 0.00 | 8.33 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1291C6 | 雨果 | impl_approximation | EXEC | 38.90 | 0.00 | 38.90 | 0.00 | — | — | — | — |
| 1301C3 | 奥菲丝&「鬼火」 | impl_generic_skill_level | EXEC | 8.16 | 0.00 | 8.16 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1301C4 | 奥菲丝&「鬼火」 | impl_approximation | EXEC | 0.00 | 0.00 | 0.00 | 0.00 | — | — | skillDmgBonus__ultimate 0.0→40.0 | — |
| 1321C6 | 伊芙琳 | impl_approximation | EXEC | 7.10 | 0.00 | 7.10 | 0.00 | — | — | — | 1 |
| 1331C5 | 薇薇安 | impl_generic_skill_level | EXEC | 5.42 | 0.00 | 5.42 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1341C4 | 照 | impl_approximation | EXEC | 1.70 | 0.00 | 1.70 | 0.00 | — | — | — | — |
| 1351C3 | 波可娜 | impl_generic_skill_level | EXEC | 8.49 | 0.00 | 8.49 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1351C5 | 波可娜 | impl_generic_skill_level | EXEC | 7.85 | 0.00 | 7.85 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1361C4 | 扳机 | impl_approximation | EXEC | 3.60 | 0.00 | 3.60 | 0.00 | — | — | — | 1 |
| 1361C5 | 扳机 | impl_generic_skill_level | EXEC | 8.00 | 0.00 | 8.00 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1361C6 | 扳机 | impl_approximation | EXEC | 15.01 | 0.00 | 15.01 | 0.00 | — | — | — | 1 |
| 1381C6 | 零号·安比 | impl_approximation | EXEC | 9.87 | 0.00 | 9.87 | 0.00 | — | — | — | 1 |
| 1391C6 | 橘福福 | implemented | EXEC | 60.34 | 0.00 | 60.34 | 0.00 | — | — | — | 1 |
| 1401C3 | 爱丽丝 | impl_generic_skill_level | EXEC | 4.47 | 0.00 | 4.47 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1401C5 | 爱丽丝 | impl_generic_skill_level | EXEC | 4.28 | 0.00 | 4.28 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1401C6 | 爱丽丝 | impl_approximation | EXEC | 20.63 | 0.00 | 20.63 | 0.00 | — | — | — | 1 |
| 1411C3 | 柚叶 | impl_generic_skill_level | EXEC | 8.20 | 0.00 | 8.20 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1431C3 | 叶瞬光 | impl_generic_skill_level | EXEC | 9.04 | 0.00 | 9.04 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1431C5 | 叶瞬光 | impl_generic_skill_level | EXEC | 8.29 | 0.00 | 8.29 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1441C3 | 真斗 | impl_generic_skill_level | EXEC | 8.64 | 0.00 | 8.64 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1441C5 | 真斗 | impl_generic_skill_level | EXEC | 7.97 | 0.00 | 7.97 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1451C2 | 卢西娅·艾洛温 | impl_approximation | EXEC | 10.63 | 0.00 | 10.63 | 0.00 | — | — | sheerDmgBonus 0.0→15.0 | — |
| 1451C3 | 卢西娅·艾洛温 | impl_generic_skill_level | EXEC | 8.21 | 0.00 | 8.21 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1451C5 | 卢西娅·艾洛温 | impl_generic_skill_level | EXEC | 7.63 | 0.00 | 7.63 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1461C2 | 「席德」 | impl_approximation | EXEC | 1.80 | 0.00 | 1.80 | 0.00 | — | — | — | — |
| 1471C4 | 般岳 | impl_approximation | EXEC | 5.04 | 0.00 | 5.04 | 0.00 | — | — | — | — |
| 1471C6 | 般岳 | impl_approximation | EXEC | 2.23 | 0.00 | 2.23 | 0.00 | — | — | — | 1 |
| 1481C3 | 留银 | impl_generic_skill_level | EXEC | 5.49 | 0.00 | 5.49 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1481C5 | 留银 | impl_generic_skill_level | EXEC | 5.12 | 0.00 | 5.12 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1481C6 | 留银 | implemented | EXEC | 27.70 | 0.00 | 27.70 | 0.00 | — | — | — | 1 |
| 1491C5 | 千夏 | impl_generic_skill_level | EXEC | 8.10 | 0.00 | 8.10 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1511C2 | 南宫羽 | impl_approximation | EXEC | 1.64 | 0.00 | 1.64 | 0.00 | — | — | — | — |
| 1521C3 | 希希芙 | impl_generic_skill_level | EXEC | 6.04 | 0.00 | 6.04 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1521C4 | 希希芙 | impl_approximation | EXEC | 3.84 | 0.00 | 3.84 | 0.00 | — | — | — | 1 |
| 1521C5 | 希希芙 | impl_generic_skill_level | EXEC | 5.63 | 0.00 | 5.63 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1531C2 | 星徽·比利 | impl_approximation | EXEC | 25.19 | 0.00 | 25.19 | 0.00 | — | — | — | — |
| 1531C3 | 星徽·比利 | impl_approximation | EXEC | 8.93 | 0.00 | 8.93 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1531C5 | 星徽·比利 | impl_approximation | EXEC | 8.20 | 0.00 | 8.20 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1531C6 | 星徽·比利 | impl_approximation | EXEC | 7.62 | 0.00 | 7.62 | 0.00 | — | — | — | 1 |
| 1541C3 | 普罗米娅 | impl_generic_skill_level | EXEC | 6.48 | 0.00 | 6.48 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1551C5 | 佩洛伊斯 | impl_generic_skill_level | EXEC | 7.42 | 0.00 | 7.42 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1561C3 | 维琳娜 | impl_generic_skill_level | EXEC | 6.10 | 0.00 | 6.10 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1561C5 | 维琳娜 | impl_generic_skill_level | EXEC | 5.75 | 0.00 | 5.75 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1571C3 | 诺玛·霍洛韦尔 | impl_generic_skill_level | EXEC | 8.16 | 0.00 | 8.16 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1571C5 | 诺玛·霍洛韦尔 | impl_generic_skill_level | EXEC | 7.58 | 0.00 | 7.58 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1571C6 | 诺玛·霍洛韦尔 | implemented | EXEC | 3.63 | 0.00 | 3.63 | 0.00 | — | — | — | 1 |
| 1581C2 | 蕾米埃尔 | impl_approximation | EXEC | 1.08 | 0.00 | 1.08 | 0.00 | enemyAnomalyDefReduction 0.0→15.0（走资源）; remielleRefringeCoefficientBonusPct 0.0→20.0（走资源） | — | — | — |
| 1601C2 | 挽昼 | impl_approximation | EXEC | 8.00 | 0.00 | 8.00 | 0.00 | — | — | — | — |
| 1611C3 | 克拉蕾 | impl_generic_skill_level | EXEC | 8.89 | 0.00 | 8.89 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1611C4 | 克拉蕾 | impl_approximation | EXEC | 1.06 | 0.00 | 1.06 | 0.00 | — | — | — | — |
| 1611C5 | 克拉蕾 | impl_generic_skill_level | EXEC | 8.17 | 0.00 | 8.17 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1631C5 | 赛维里安 | impl_generic_skill_level | EXEC | 7.75 | 0.00 | 7.75 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1641C4 | 菲欧妮 | impl_approximation | EXEC | 23.23 | 0.00 | 23.23 | 0.00 | — | — | — | 2 |
| 1661C3 | 知更鸟 | impl_generic_skill_level | EXEC | 8.05 | 0.00 | 8.05 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1661C5 | 知更鸟 | impl_generic_skill_level | EXEC | 7.45 | 0.00 | 7.45 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| **ATTR**（62 级） |||||||||||
| 1021C1 | 猫又 | impl_approximation | ATTR | 16.00 | 0.00 | 0.00 | 16.00 | enemyPhysicalResReduction 0.0→16.0 | — | — | — |
| 1021C4 | 猫又 | impl_approximation | ATTR | 12.12 | 0.00 | 0.00 | 12.12 | critRate 19.4→33.4 | — | — | — |
| 1021C6 | 猫又 | impl_approximation | ATTR | 12.70 | 0.00 | 0.00 | 12.70 | critDmg 110.0→164.0 | — | — | — |
| 1031C6 | 妮可 | impl_approximation | ATTR | 6.61 | 0.00 | 0.00 | 6.61 | critRate 5.0→20.0 | — | — | — |
| 1051C4 | 伊德海莉 | impl_approximation | ATTR | 3.39 | 0.00 | 0.00 | 3.39 | hp 11232.0→11766.9 | — | inCombatHpPct 5.0→10.0 | — |
| 1051C6 | 伊德海莉 | impl_approximation | ATTR | 24.58 | 0.00 | 0.00 | 24.58 | — | — | sheerDmgBonus 0.0→25.0 | — |
| 1061C1 | 可琳 | impl_approximation | ATTR | 7.87 | 0.00 | 0.00 | 7.87 | dmgBonus 52.5→64.5 | — | — | — |
| 1061C2 | 可琳 | impl_approximation | ATTR | 10.00 | 0.00 | 0.00 | 10.00 | enemyPhysicalResReduction 0.0→10.0 | — | — | — |
| 1071C1 | 凯撒 | impl_approximation | ATTR | 15.00 | 0.00 | 0.00 | 15.00 | enemyResReduction 0.0→15.0 | — | — | — |
| 1081C6 | 比利 | impl_approximation | ATTR | 18.41 | 0.00 | 0.00 | 18.41 | dmgBonus 15.0→45.0 | — | — | — |
| 1111C4 | 安东 | impl_approximation | ATTR | 4.39 | 0.00 | 0.00 | 4.39 | critRate 19.4→29.4 | — | — | — |
| 1131C4 | 苍角 | impl_approximation | ATTR | 10.00 | 0.00 | 0.00 | 10.00 | enemyIceResReduction 0.0→10.0 | — | — | — |
| 1141C6 | 莱卡恩 | impl_approximation | ATTR | 43.48 | 0.00 | 0.00 | 43.48 | dmgBonus 15.0→65.0 | — | — | — |
| 1151C4 | 露西 | impl_approximation | ATTR | 0.45 | 0.00 | 0.00 | 0.45 | critDmg 50.0→60.0 | — | — | — |
| 1161C2 | 莱特 | impl_approximation | ATTR | 6.72 | 0.00 | 0.00 | 6.72 | stunDmgMultiplierBonus 0.0→25.0 | — | — | — |
| 1171C2 | 柏妮思 | impl_approximation | ATTR | 12.25 | 0.00 | 0.00 | 12.25 | penRatio 0.0→20.0 | — | — | — |
| 1191C6 | 艾莲 | impl_approximation | ATTR | 12.25 | 0.00 | 0.00 | 12.25 | penRatio 0.0→20.0 | — | — | — |
| 1211C2 | 丽娜 | impl_approximation | ATTR | 8.70 | 0.00 | 0.00 | 8.70 | dmgBonus 15.0→25.0 | — | — | — |
| 1211C6 | 丽娜 | impl_approximation | ATTR | 10.82 | 0.00 | 0.00 | 10.82 | electricDmg 0.0→15.0 | — | — | — |
| 1221C1 | 月城柳 | impl_approximation | ATTR | 19.63 | 0.00 | 0.00 | 19.63 | anomalyProficiency 114.0→194.0 | — | — | — |
| 1221C4 | 月城柳 | impl_approximation | ATTR | 9.56 | 0.00 | 0.00 | 9.56 | penRatio 0.0→16.0 | — | — | — |
| 1241C2 | 朱鸢 | impl_approximation | ATTR | 12.71 | 0.00 | 0.00 | 12.71 | etherDmg 0.0→50.0 | — | — | — |
| 1241C4 | 朱鸢 | impl_approximation | ATTR | 6.45 | 0.00 | 0.00 | 6.45 | enemyEtherResIgnoreDirect 0.0→25.0 | — | — | — |
| 1251C2 | 青衣 | impl_approximation | ATTR | 5.54 | 0.00 | 0.00 | 5.54 | stunDmgMultiplierBonus 80.0→108.0 | — | stunBuildUpBonus 0.0→7.5 | — |
| 1261C2 | 简 | impl_approximation | ATTR | 9.01 | 0.00 | 0.00 | 9.01 | — | — | assaultCritDmg 50.0→100.0; enemyAssaultDefReduction 0.0→15.0 | — |
| 1261C4 | 简 | implemented | ATTR | 6.00 | 0.00 | 0.00 | 6.00 | anomalyDmgBonus 0.0→18.0; disorderDamageBonus 0.0→18.0 | — | — | — |
| 1271C2 | 赛斯 | impl_approximation | ATTR | 0.00 | 0.00 | 0.00 | 0.00 | electricAnomalyBuildUpEfficiency 0.0→35.0（走资源） | — | — | — |
| 1301C1 | 奥菲丝&「鬼火」 | impl_approximation | ATTR | 14.43 | 0.00 | 0.00 | 14.43 | dmgBonus 15.0→35.0 | — | — | — |
| 1301C2 | 奥菲丝&「鬼火」 | impl_approximation | ATTR | 14.04 | 0.00 | 0.00 | 14.04 | atk 1775.0→2024.1 | — | inCombatAtkPct 20.0→40.0 | — |
| 1311C1 | 耀嘉音 | impl_approximation | ATTR | 18.00 | 0.00 | 0.00 | 18.00 | enemyResReduction 0.0→18.0 | — | — | — |
| 1321C4 | 伊芙琳 | impl_approximation | ATTR | 13.89 | 0.00 | 0.00 | 13.89 | critDmg 50.0→90.0 | — | — | — |
| 1331C1 | 薇薇安 | impl_approximation | ATTR | 2.85 | 0.00 | 0.00 | 2.85 | anomalyDmgBonus 0.0→16.0; disorderDamageBonus 0.0→16.0 | — | — | — |
| 1341C1 | 照 | impl_approximation | ATTR | 14.15 | 0.00 | 0.00 | 14.15 | enemyResIgnoreDirect 0.0→15.0 | — | — | — |
| 1341C2 | 照 | impl_approximation | ATTR | 9.20 | 0.00 | 0.00 | 9.20 | atk 2298.0→2514.4 | — | zhaoCinema2SelfAtk 0.0→216.3 | — |
| 1351C2 | 波可娜 | impl_approximation | ATTR | 8.33 | 0.00 | 0.00 | 8.33 | atk 1178.2→1276.4 | — | inCombatAtkPct 20.0→30.0 | — |
| 1361C2 | 扳机 | impl_approximation | ATTR | 1.12 | 0.00 | 0.00 | 1.12 | critDmg 50.0→74.0 | — | — | — |
| 1381C4 | 零号·安比 | impl_approximation | ATTR | 12.00 | 0.00 | 0.00 | 12.00 | enemyElectricResReduction 0.0→12.0 | — | — | — |
| 1391C4 | 橘福福 | implemented | ATTR | 7.81 | 0.00 | 0.00 | 7.81 | critDmg 92.0→127.0 | — | — | — |
| 1401C4 | 爱丽丝 | impl_approximation | ATTR | 10.00 | 0.00 | 0.00 | 10.00 | enemyPhysicalResReduction 0.0→10.0 | — | aliceCinema4 0.0→1.0 | — |
| 1411C1 | 柚叶 | impl_approximation | ATTR | 10.00 | 0.00 | 0.00 | 10.00 | enemyResReduction 0.0→10.0 | — | — | — |
| 1411C6 | 柚叶 | impl_approximation | ATTR | 0.00 | 0.00 | 0.00 | 0.00 | disorderBaseMultiplierBonus 0.0→315.0（走资源） | — | — | — |
| 1441C1 | 真斗 | impl_approximation | ATTR | 7.41 | 0.00 | 0.00 | 7.41 | fireDmg 20.0→30.0 | — | — | — |
| 1441C2 | 真斗 | impl_approximation | ATTR | 8.00 | 0.00 | 0.00 | 8.00 | enemyFireResReduction 0.0→8.0 | — | — | — |
| 1441C4 | 真斗 | impl_approximation | ATTR | 5.69 | 0.00 | 0.00 | 5.69 | hp 11315.3→12220.6 | — | zhendouC4HpBonus 0.0→905.2 | — |
| 1451C1 | 卢西娅·艾洛温 | impl_approximation | ATTR | 16.34 | 0.00 | 0.00 | 16.34 | enemyResIgnoreDirect 0.0→18.0 | decibelGainEfficiency 0.0→5.0 | — | — |
| 1481C2 | 留银 | implemented | ATTR | 16.12 | 0.00 | 0.00 | 16.12 | dmgBonus 15.0→30.0; stunDmgMultiplierBonus 30.0→50.0 | — | — | — |
| 1491C1 | 千夏 | impl_approximation | ATTR | 12.94 | 0.00 | 0.00 | 12.94 | enemyDefReduction 0.0→21.0 | — | — | — |
| 1491C2 | 千夏 | impl_approximation | ATTR | 6.46 | 0.00 | 0.00 | 6.46 | atk 1650.2→1756.9 | — | inCombatAtkPct 20.0→30.0 | — |
| 1491C4 | 千夏 | implemented | ATTR | 15.65 | 0.00 | 0.00 | 15.65 | dmgBonus 15.0→33.0 | — | — | — |
| 1491C6 | 千夏 | impl_approximation | ATTR | 87.22 | 0.00 | 0.00 | 87.22 | critDmg 50.0→82.0; critRate 5.0→105.0 | — | — | — |
| 1531C4 | 星徽·比利 | impl_approximation | ATTR | 2.38 | 0.00 | 0.00 | 2.38 | critDmg 140.0→156.0 | — | — | — |
| 1551C1 | 佩洛伊斯 | impl_approximation | ATTR | 5.35 | 0.00 | 0.00 | 5.35 | critRate 19.4→27.4 | — | — | — |
| 1561C1 | 维琳娜 | impl_approximation | ATTR | 5.29 | 0.00 | 0.00 | 5.29 | enemyWindResIgnoreAnomaly 0.0→20.0; turbulenceResIgnore 0.0→20.0 | — | — | — |
| 1561C4 | 维琳娜 | implemented | ATTR | 15.00 | 0.00 | 0.00 | 15.00 | atk 1426.3→1640.3 | — | — | — |
| 1581C6 | 蕾米埃尔 | impl_approximation | ATTR | 12.58 | 0.00 | 0.00 | 12.58 | — | — | remielleCinema6FleetingGraceVoidflareTriggerMultiplier 0.0→1.0; remielleCinema6SpecialVoidflareCount 0.0→3.0; remielleCinema6SpecialVoidflareDamageRatio 0.0→25.0 | — |
| 1591C4 | 希格莉德 | impl_approximation | ATTR | 14.39 | 0.00 | 0.00 | 14.39 | dmgBonus 15.0→33.0 | — | — | — |
| 1621C1 | 洛克茜 | impl_approximation | ATTR | 22.61 | 0.00 | 0.00 | 22.61 | critDmg 57.8→97.8; enemyResReduction 0.0→15.0 | — | — | — |
| 1631C4 | 赛维里安 | impl_approximation | ATTR | 8.33 | 0.00 | 0.00 | 8.33 | atk 1499.4→1624.4 | decibelGainEfficiency 0.0→10.0 | inCombatAtkPct 20.0→30.0 | — |
| 1641C6 | 菲欧妮 | impl_approximation | ATTR | 26.65 | 0.00 | 0.00 | 26.65 | enemyAnomalyReleaseDefReduction 0.0→40.0; enemyResReduction 0.0→15.0 | — | — | — |
| 1661C1 | 知更鸟 | impl_approximation | ATTR | 10.50 | 0.00 | 0.00 | 10.50 | enemyDefIgnoreDirect 0.0→20.0 | — | — | — |
| 1661C2 | 知更鸟 | impl_approximation | ATTR | 13.06 | 0.00 | 0.00 | 13.06 | enemyResIgnoreDirect 0.0→15.0 | — | — | — |
| 1661C4 | 知更鸟 | impl_approximation | ATTR | 7.14 | 0.00 | 0.00 | 7.14 | dmgBonus 40.0→50.0 | — | — | — |
| **RESOURCE+EXEC**（108 级） |||||||||||
| 1021C2 | 猫又 | impl_approximation | RESOURCE+EXEC | 0.92 | 1.42 | -0.50 | 0.00 | — | energyGainEfficiency 0.0→25.0 | — | — |
| 1021C3 | 猫又 | impl_generic_skill_level | RESOURCE+EXEC | 11.31 | 2.45 | 8.65 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1021C5 | 猫又 | impl_generic_skill_level | RESOURCE+EXEC | 9.31 | 1.22 | 8.00 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1031C1 | 妮可 | implemented | RESOURCE+EXEC | 34.87 | 15.97 | 16.31 | 0.00 | — | — | — | — |
| 1031C2 | 妮可 | impl_approximation | RESOURCE+EXEC | 1.76 | 1.95 | -0.19 | 0.00 | — | — | — | — |
| 1041C1 | 「11号」 | impl_approximation | RESOURCE+EXEC | 9.92 | 11.29 | -1.23 | 0.00 | — | — | — | — |
| 1041C3 | 「11号」 | impl_generic_skill_level | RESOURCE+EXEC | 9.61 | 0.85 | 8.69 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1061C3 | 可琳 | impl_generic_skill_level | RESOURCE+EXEC | 10.79 | 3.09 | 7.47 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1061C4 | 可琳 | impl_approximation | RESOURCE+EXEC | 0.53 | 0.77 | -0.24 | 0.00 | — | — | — | — |
| 1061C5 | 可琳 | impl_generic_skill_level | RESOURCE+EXEC | 10.10 | 2.21 | 7.72 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1081C1 | 比利 | impl_approximation | RESOURCE+EXEC | 5.17 | 6.73 | -1.46 | 0.00 | — | — | — | — |
| 1081C3 | 比利 | impl_generic_skill_level | RESOURCE+EXEC | 11.18 | 2.46 | 8.50 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1081C5 | 比利 | impl_generic_skill_level | RESOURCE+EXEC | 9.37 | 1.40 | 7.86 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1091C1 | 雅 | impl_approximation | RESOURCE+EXEC | 10.94 | 2.44 | 8.30 | 0.00 | anomalyBuildUpEfficiency 25.0→45.0（走资源） | — | — | — |
| 1091C4 | 雅 | impl_approximation | RESOURCE+EXEC | 4.58 | 2.34 | 2.19 | 0.00 | — | — | — | — |
| 1091C6 | 雅 | impl_approximation | RESOURCE+EXEC | 35.56 | -9.82 | 50.33 | 0.00 | — | — | skillDmgBonus__basic 30.0→60.0 | 2 |
| 1101C5 | 珂蕾妲 | impl_generic_skill_level | RESOURCE+EXEC | 9.58 | 2.07 | 7.36 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1121C3 | 本 | impl_generic_skill_level | RESOURCE+EXEC | 11.31 | 2.41 | 8.69 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1121C5 | 本 | impl_generic_skill_level | RESOURCE+EXEC | 8.85 | 0.81 | 7.97 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1141C3 | 莱卡恩 | impl_generic_skill_level | RESOURCE+EXEC | 9.52 | 0.56 | 8.91 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1161C3 | 莱特 | impl_generic_skill_level | RESOURCE+EXEC | 11.12 | 2.39 | 8.53 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1161C6 | 莱特 | impl_approximation | RESOURCE+EXEC | 30.28 | 26.60 | 2.91 | 0.00 | — | — | — | 1 |
| 1171C1 | 柏妮思 | impl_approximation | RESOURCE+EXEC | 9.95 | 1.59 | 8.23 | 0.00 | — | — | — | — |
| 1171C5 | 柏妮思 | impl_generic_skill_level | RESOURCE+EXEC | 5.96 | 2.08 | 3.81 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1181C1 | 格莉丝 | impl_approximation | RESOURCE+EXEC | 0.39 | 0.28 | 0.11 | 0.00 | — | — | — | — |
| 1181C6 | 格莉丝 | impl_approximation | RESOURCE+EXEC | 71.02 | 21.84 | 40.36 | 0.00 | — | — | — | — |
| 1191C2 | 艾莲 | impl_approximation | RESOURCE+EXEC | 15.94 | 11.44 | 4.04 | 0.00 | — | — | — | — |
| 1201C1 | 悠真 | impl_approximation | RESOURCE+EXEC | 28.16 | 33.41 | -3.94 | 0.00 | — | — | — | — |
| 1201C3 | 悠真 | impl_generic_skill_level | RESOURCE+EXEC | 15.24 | 5.44 | 9.29 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1201C4 | 悠真 | impl_approximation | RESOURCE+EXEC | 2.62 | 3.55 | -0.89 | 0.00 | — | — | — | — |
| 1201C5 | 悠真 | impl_generic_skill_level | RESOURCE+EXEC | 10.75 | 2.35 | 8.20 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1211C4 | 丽娜 | impl_approximation | RESOURCE+EXEC | 0.76 | 1.10 | -0.34 | 0.00 | — | energyRegenBonusFlat 0.0→0.5 | rinaCinema4EnergyRegen 0.0→0.5 | — |
| 1221C2 | 月城柳 | impl_approximation | RESOURCE+EXEC | 13.62 | 22.46 | -7.22 | 0.00 | electricAnomalyBuildUpEfficiency 0.0→20.0（走资源） | — | — | — |
| 1221C6 | 月城柳 | impl_approximation | RESOURCE+EXEC | 3.43 | 1.02 | 2.38 | 0.00 | — | — | skillDmgBonus__exSpecial 0.0→20.0 | — |
| 1241C1 | 朱鸢 | impl_approximation | RESOURCE+EXEC | 6.07 | 13.14 | -6.25 | 0.00 | — | — | — | — |
| 1241C3 | 朱鸢 | impl_generic_skill_level | RESOURCE+EXEC | 11.11 | 4.80 | 6.02 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1241C5 | 朱鸢 | impl_generic_skill_level | RESOURCE+EXEC | 10.13 | 2.35 | 7.60 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1241C6 | 朱鸢 | impl_approximation | RESOURCE+EXEC | 20.53 | 11.90 | 7.72 | 0.00 | — | — | — | 1 |
| 1261C3 | 简 | impl_generic_skill_level | RESOURCE+EXEC | 8.14 | 2.14 | 5.88 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1271C5 | 赛斯 | impl_generic_skill_level | RESOURCE+EXEC | 7.82 | 1.95 | 5.77 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1281C3 | 派派 | impl_generic_skill_level | RESOURCE+EXEC | 8.45 | 2.22 | 6.10 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1281C4 | 派派 | impl_approximation | RESOURCE+EXEC | 0.76 | 0.98 | -0.22 | 0.00 | — | — | — | — |
| 1281C5 | 派派 | impl_generic_skill_level | RESOURCE+EXEC | 8.59 | 2.24 | 6.21 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1301C5 | 奥菲丝&「鬼火」 | impl_generic_skill_level | RESOURCE+EXEC | 10.20 | 3.09 | 6.90 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1301C6 | 奥菲丝&「鬼火」 | impl_approximation | RESOURCE+EXEC | 200.96 | 8.17 | 178.24 | 0.00 | — | — | — | 1 |
| 1311C6 | 耀嘉音 | impl_approximation | RESOURCE+EXEC | 9.63 | -3.82 | 13.98 | 0.00 | — | — | — | — |
| 1321C3 | 伊芙琳 | impl_generic_skill_level | RESOURCE+EXEC | 14.30 | 5.94 | 7.90 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1321C5 | 伊芙琳 | impl_generic_skill_level | RESOURCE+EXEC | 10.17 | 2.00 | 8.01 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1331C3 | 薇薇安 | impl_generic_skill_level | RESOURCE+EXEC | 5.81 | 0.22 | 5.58 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1341C3 | 照 | impl_generic_skill_level | RESOURCE+EXEC | 11.05 | 2.40 | 8.45 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1341C5 | 照 | impl_generic_skill_level | RESOURCE+EXEC | 8.46 | 0.62 | 7.79 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1351C4 | 波可娜 | impl_approximation | RESOURCE+EXEC | 6.98 | 7.90 | -0.85 | 0.00 | — | — | — | — |
| 1351C6 | 波可娜 | impl_approximation | RESOURCE+EXEC | 9.99 | 7.54 | 2.28 | 0.00 | — | — | — | — |
| 1361C3 | 扳机 | impl_generic_skill_level | RESOURCE+EXEC | 9.86 | 1.09 | 8.68 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1371C2 | 仪玄 | impl_approximation | RESOURCE+EXEC | 5.26 | -12.34 | 20.09 | 0.00 | — | stunDurationBonusSeconds 0.0→3.0 | — | 1 |
| 1371C3 | 仪玄 | impl_generic_skill_level | RESOURCE+EXEC | 14.65 | 6.31 | 7.85 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1371C4 | 仪玄 | impl_approximation | RESOURCE+EXEC | 0.15 | -2.70 | 2.93 | 0.00 | — | — | — | 2 |
| 1371C5 | 仪玄 | impl_generic_skill_level | RESOURCE+EXEC | 10.36 | 2.21 | 7.97 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1371C6 | 仪玄 | impl_approximation | RESOURCE+EXEC | 11.86 | 14.01 | -1.89 | 0.00 | — | — | — | — |
| 1381C1 | 零号·安比 | impl_approximation | RESOURCE+EXEC | 29.00 | 32.35 | -2.53 | 0.00 | — | — | — | — |
| 1381C3 | 零号·安比 | impl_generic_skill_level | RESOURCE+EXEC | 18.38 | 10.90 | 6.75 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1381C5 | 零号·安比 | impl_generic_skill_level | RESOURCE+EXEC | 9.63 | 2.01 | 7.47 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1391C3 | 橘福福 | impl_generic_skill_level | RESOURCE+EXEC | 10.16 | 2.06 | 7.93 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1391C5 | 橘福福 | impl_generic_skill_level | RESOURCE+EXEC | 11.29 | 3.35 | 7.68 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1411C5 | 柚叶 | impl_generic_skill_level | RESOURCE+EXEC | 13.96 | 7.25 | 6.26 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1421C2 | 潘引壶 | impl_approximation | RESOURCE+EXEC | 5.37 | 6.06 | -0.64 | 0.00 | — | — | — | — |
| 1421C3 | 潘引壶 | impl_generic_skill_level | RESOURCE+EXEC | 9.95 | 2.21 | 7.58 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1421C5 | 潘引壶 | impl_generic_skill_level | RESOURCE+EXEC | 10.23 | 2.31 | 7.74 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1431C2 | 叶瞬光 | impl_approximation | RESOURCE+EXEC | 17.41 | 1.52 | 15.65 | 0.00 | — | — | — | — |
| 1431C4 | 叶瞬光 | implemented | RESOURCE+EXEC | -2.07 | -3.89 | 1.89 | 0.00 | — | — | veilStunCapMult 2.1→3.0 | — |
| 1431C6 | 叶瞬光 | implemented | RESOURCE+EXEC | 17.36 | 9.86 | 6.82 | 0.00 | — | — | — | 1 |
| 1451C4 | 卢西娅·艾洛温 | impl_approximation | RESOURCE+EXEC | 5.30 | -4.13 | 9.84 | 0.00 | — | — | — | 1 |
| 1461C1 | 「席德」 | impl_approximation | RESOURCE+EXEC | 3.66 | 6.22 | -2.41 | 0.00 | — | — | — | — |
| 1461C3 | 「席德」 | impl_generic_skill_level | RESOURCE+EXEC | 11.17 | 3.53 | 7.38 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1461C5 | 「席德」 | impl_generic_skill_level | RESOURCE+EXEC | 9.48 | 1.81 | 7.54 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1471C3 | 般岳 | impl_generic_skill_level | RESOURCE+EXEC | 10.41 | 2.37 | 7.86 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1471C5 | 般岳 | impl_generic_skill_level | RESOURCE+EXEC | 10.50 | 2.27 | 8.05 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1491C3 | 千夏 | impl_generic_skill_level | RESOURCE+EXEC | 10.00 | 1.09 | 8.81 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1501C1 | 爱芮 | impl_approximation | RESOURCE+EXEC | 6.22 | 2.51 | 3.62 | 0.00 | enemyEtherAnomalyResReduction 0.0→10.0（走资源） | — | — | — |
| 1501C3 | 爱芮 | impl_generic_skill_level | RESOURCE+EXEC | 9.19 | 5.82 | 3.18 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1501C4 | 爱芮 | impl_approximation | RESOURCE+EXEC | 2.88 | 3.41 | -0.51 | 0.00 | — | — | — | — |
| 1501C5 | 爱芮 | impl_generic_skill_level | RESOURCE+EXEC | 6.59 | 2.94 | 3.55 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1501C6 | 爱芮 | impl_approximation | RESOURCE+EXEC | 32.97 | 18.58 | 12.14 | 0.00 | — | — | — | — |
| 1511C3 | 南宫羽 | impl_generic_skill_level | RESOURCE+EXEC | 6.84 | 1.84 | 4.91 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1511C5 | 南宫羽 | impl_generic_skill_level | RESOURCE+EXEC | 5.88 | 1.61 | 4.20 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1511C6 | 南宫羽 | impl_approximation | RESOURCE+EXEC | 17.75 | 7.11 | 9.94 | 0.00 | — | — | stunBuildUpBonus 20.0→70.0 | 1 |
| 1521C2 | 希希芙 | impl_approximation | RESOURCE+EXEC | 13.32 | 8.58 | 4.37 | 0.00 | — | — | — | — |
| 1541C1 | 普罗米娅 | impl_approximation | RESOURCE+EXEC | 2.00 | 2.27 | -0.26 | 0.00 | — | — | — | — |
| 1541C4 | 普罗米娅 | impl_approximation | RESOURCE+EXEC | 2.39 | 2.63 | -0.24 | 0.00 | — | — | — | — |
| 1541C5 | 普罗米娅 | impl_generic_skill_level | RESOURCE+EXEC | 4.97 | -0.36 | 5.35 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1551C2 | 佩洛伊斯 | impl_approximation | RESOURCE+EXEC | 0.97 | 1.87 | -0.88 | 0.00 | — | — | — | — |
| 1551C3 | 佩洛伊斯 | impl_generic_skill_level | RESOURCE+EXEC | 10.80 | 2.92 | 7.66 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1571C2 | 诺玛·霍洛韦尔 | implemented | RESOURCE+EXEC | 8.18 | 10.08 | -1.73 | 0.00 | — | — | — | — |
| 1571C4 | 诺玛·霍洛韦尔 | implemented | RESOURCE+EXEC | 4.33 | 4.68 | -0.33 | 0.00 | — | — | — | — |
| 1591C2 | 希格莉德 | impl_approximation | RESOURCE+EXEC | 15.52 | 1.98 | 13.28 | 0.00 | — | decibelGainEfficiency 0.0→10.0 | — | — |
| 1591C3 | 希格莉德 | impl_generic_skill_level | RESOURCE+EXEC | 15.54 | 6.08 | 8.91 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1591C5 | 希格莉德 | impl_generic_skill_level | RESOURCE+EXEC | 10.66 | 2.29 | 8.18 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1591C6 | 希格莉德 | impl_approximation | RESOURCE+EXEC | 3.96 | 0.52 | 3.41 | 0.00 | — | — | — | — |
| 1601C3 | 挽昼 | impl_generic_skill_level | RESOURCE+EXEC | 16.70 | 1.17 | 15.35 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1601C5 | 挽昼 | impl_generic_skill_level | RESOURCE+EXEC | 9.15 | 0.96 | 8.12 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1611C1 | 克拉蕾 | impl_approximation | RESOURCE+EXEC | 19.12 | 5.70 | 12.69 | 0.00 | — | — | — | — |
| 1621C3 | 洛克茜 | impl_generic_skill_level | RESOURCE+EXEC | 9.52 | -2.93 | 12.82 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1621C4 | 洛克茜 | impl_approximation | RESOURCE+EXEC | 1.85 | 0.65 | 1.19 | 0.00 | — | — | — | — |
| 1621C5 | 洛克茜 | impl_generic_skill_level | RESOURCE+EXEC | 11.83 | 3.57 | 7.97 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| 1631C3 | 赛维里安 | impl_generic_skill_level | RESOURCE+EXEC | 10.27 | 1.72 | 8.41 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1631C6 | 赛维里安 | impl_approximation | RESOURCE+EXEC | 13.04 | 8.91 | 3.79 | 0.00 | — | — | — | — |
| 1641C3 | 菲欧妮 | impl_generic_skill_level | RESOURCE+EXEC | 11.67 | 5.24 | 6.11 | 0.00 | — | — | skillLevelBonus 0.0→2.0 | — |
| 1641C5 | 菲欧妮 | impl_generic_skill_level | RESOURCE+EXEC | 6.75 | 1.98 | 4.68 | 0.00 | — | — | skillLevelBonus 2.0→4.0 | — |
| **RESOURCE+ATTR**（16 级） |||||||||||
| 1051C1 | 伊德海莉 | impl_approximation | RESOURCE+ATTR | 27.47 | 10.41 | -0.01 | 15.46 | enemyIceResIgnoreDirect__basic 0.0→20.0; enemyIceResIgnoreDirect__exSpecial 0.0→20.0 | — | enemyCritDmgTakenBonus 3.3→3.9 | — |
| 1051C2 | 伊德海莉 | impl_approximation | RESOURCE+ATTR | 9.03 | 2.02 | 0.00 | 6.87 | critDmg 50.0→90.0 | flashEnergyRegenBonusFlat 0.0→0.5 | — | — |
| 1181C2 | 格莉丝 | impl_approximation | RESOURCE+ATTR | 10.88 | 2.19 | 0.00 | 8.50 | enemyElectricAnomalyResReduction 0.0→8.5; enemyElectricResReduction 0.0→8.5 | — | — | — |
| 1251C1 | 青衣 | impl_approximation | RESOURCE+ATTR | 22.20 | 3.31 | 0.00 | 18.28 | critRate 5.0→25.0; enemyDefReduction 0.0→15.0 | — | — | — |
| 1261C1 | 简 | impl_approximation | RESOURCE+ATTR | 17.06 | 7.48 | 0.00 | 8.92 | dmgBonus 15.0→25.3; physicalAnomalyBuildUpEfficiency 22.5→36.0 | — | — | — |
| 1391C1 | 橘福福 | implemented | RESOURCE+ATTR | 16.02 | 0.97 | 0.00 | 14.90 | critRate 19.4→31.4; stunDmgMultiplierBonus 25.0→60.0 | — | — | — |
| 1391C2 | 橘福福 | implemented | RESOURCE+ATTR | 7.53 | 2.30 | 0.00 | 5.11 | critDmg 70.0→92.0 | — | — | — |
| 1401C1 | 爱丽丝 | impl_approximation | RESOURCE+ATTR | 12.97 | 0.65 | 0.00 | 12.25 | enemyDefReduction 0.0→20.0 | — | — | — |
| 1411C2 | 柚叶 | impl_approximation | RESOURCE+ATTR | 26.16 | 13.11 | 0.00 | 11.54 | anomalyBuildUpEfficiency 0.0→15.0; dmgBonus 30.0→45.0 | — | — | — |
| 1471C1 | 般岳 | impl_approximation | RESOURCE+ATTR | 21.18 | 0.53 | 0.00 | 20.53 | enemyFireResReduction 0.0→10.0 | stunDurationBonusSeconds 0.0→2.0 | sheerDmgBonus 0.0→10.0 | — |
| 1511C4 | 南宫羽 | impl_approximation | RESOURCE+ATTR | 11.40 | 2.67 | 0.00 | 8.51 | anomalyProficiency 213.0→253.0 | — | — | — |
| 1561C6 | 维琳娜 | impl_approximation | RESOURCE+ATTR | 12.60 | 3.48 | 0.00 | 8.82 | — | — | velinaCinema6 0.0→1.0 | — |
| 1571C1 | 诺玛·霍洛韦尔 | implemented | RESOURCE+ATTR | 18.66 | 3.18 | 0.00 | 15.00 | enemyResReduction 0.0→15.0 | — | — | — |
| 1591C1 | 希格莉德 | impl_approximation | RESOURCE+ATTR | 28.22 | 6.09 | 0.02 | 20.83 | atk 1505.1→1818.6 | — | inCombatAtkPct 20.0→45.0 | — |
| 1631C1 | 赛维里安 | impl_approximation | RESOURCE+ATTR | 13.97 | 0.24 | 0.00 | 13.69 | enemyWindResIgnoreDirect 0.0→15.0 | — | — | — |
| 1631C2 | 赛维里安 | impl_approximation | RESOURCE+ATTR | 14.40 | 1.92 | 0.00 | 12.25 | penRatio 0.0→20.0 | — | — | — |
| **EXEC+ATTR**（20 级） |||||||||||
| 1071C6 | 凯撒 | impl_approximation | EXEC+ATTR | 54.99 | 0.00 | 11.63 | 38.85 | critDmg 50.0→110.0; critRate 5.0→35.0 | — | — | — |
| 1161C1 | 莱特 | impl_approximation | EXEC+ATTR | 10.84 | 0.00 | 1.97 | 8.70 | enemyFireResReduction 15.0→25.0; enemyIceResReduction 15.0→25.0 | stunDurationBonusSeconds 3.0→5.0 | — | — |
| 1251C6 | 青衣 | impl_approximation | EXEC+ATTR | 32.45 | 0.00 | 10.37 | 20.00 | enemyResReduction 0.0→20.0 | — | — | — |
| 1261C6 | 简 | impl_approximation | EXEC+ATTR | 13.50 | 0.00 | 0.73 | 12.68 | critDmg 50.0→90.0; critRate 5.0→25.0 | — | — | 1 |
| 1311C2 | 耀嘉音 | impl_approximation | EXEC+ATTR | 19.21 | 0.00 | 6.20 | 12.26 | atk 1599.3→1795.3 | — | inCombatAtkFlat 361.1→557.2 | 1 |
| 1311C3 | 耀嘉音 | impl_generic_skill_level | EXEC+ATTR | 9.31 | 0.00 | 7.58 | 1.61 | critDmg 75.0→78.0; dmgBonus 35.0→37.0 | — | skillLevelBonus 0.0→2.0 | — |
| 1311C5 | 耀嘉音 | impl_generic_skill_level | EXEC+ATTR | 8.75 | 0.00 | 7.05 | 1.59 | critDmg 78.0→81.0; dmgBonus 37.0→39.0 | — | skillLevelBonus 2.0→4.0 | — |
| 1331C4 | 薇薇安 | impl_approximation | EXEC+ATTR | 15.09 | 0.00 | 4.63 | 10.00 | atk 1436.0→1579.6 | — | vivianC4AtkBonus 0.0→143.6 | — |
| 1331C6 | 薇薇安 | impl_approximation | EXEC+ATTR | 54.75 | 0.00 | 14.81 | 34.78 | etherDmg 0.0→40.0 | — | — | 1 |
| 1341C6 | 照 | impl_approximation | EXEC+ATTR | 3.14 | 0.00 | 0.76 | 2.36 | critRate 23.1→27.7 | — | zhaoCoreCritRate 18.1→22.7 | — |
| 1451C6 | 卢西娅·艾洛温 | impl_approximation | EXEC+ATTR | 100.45 | 0.00 | 79.84 | 11.46 | atk 1289.0→1502.6 | — | — | — |
| 1461C6 | 「席德」 | impl_approximation | EXEC+ATTR | 13.15 | 0.00 | 10.71 | 2.20 | critDmg 78.8→128.8 | — | — | — |
| 1501C2 | 爱芮 | impl_approximation | EXEC+ATTR | 7.80 | 0.00 | 0.79 | 6.96 | enemyAnomalyReleaseDefReduction 0.0→16.0; enemyDefIgnoreDirect 0.0→16.0 | — | — | — |
| 1541C2 | 普罗米娅 | impl_approximation | EXEC+ATTR | 10.16 | 0.00 | 1.95 | 8.05 | anomalyProficiency 114.0→154.0 | — | — | — |
| 1581C1 | 蕾米埃尔 | impl_approximation | EXEC+ATTR | 5.67 | 0.00 | -0.21 | 5.90 | — | — | remielleCinema1SpecialVoidflareCount 0.0→1.0; remielleFlowerFeatherDanceDecibelPerUse 0.0→200.0 | 1 |
| 1581C3 | 蕾米埃尔 | impl_generic_skill_level | EXEC+ATTR | 11.20 | 0.00 | 8.90 | 2.11 | dmgBonus 33.0→36.0 | — | skillLevelBonus 0.0→2.0 | — |
| 1581C5 | 蕾米埃尔 | impl_generic_skill_level | EXEC+ATTR | 10.09 | 0.00 | 8.01 | 1.92 | dmgBonus 36.0→39.0 | — | skillLevelBonus 2.0→4.0 | — |
| 1601C6 | 挽昼 | impl_approximation | EXEC+ATTR | 19.64 | 0.00 | 5.29 | 13.64 | enemyDefIgnoreDirect 20.0→40.0 | — | — | — |
| 1611C2 | 克拉蕾 | impl_approximation | EXEC+ATTR | 18.72 | 0.00 | 1.00 | 17.54 | enemyElectricResIgnoreDirect 0.0→18.0 | — | — | — |
| 1641C2 | 菲欧妮 | impl_approximation | EXEC+ATTR | 32.83 | 0.00 | 5.35 | 26.09 | dmgBonus 15.0→45.0 | — | fireAnomalyDurationBonusSeconds 0.0→2.0 | — |
| **RESOURCE+EXEC+ATTR**（24 级） |||||||||||
| 1071C2 | 凯撒 | impl_approximation | RESOURCE+EXEC+ATTR | 23.16 | 1.10 | -0.46 | 22.39 | atk 2233.2→2733.2 | energyGainEfficiency 0.0→10.0 | inCombatAtkFlat 1000.0→1500.0 | — |
| 1091C2 | 雅 | impl_approximation | RESOURCE+EXEC+ATTR | 62.38 | 31.74 | 13.36 | 8.74 | anomalyBuildUpEfficiency 45.0→60.0; critRate 5.0→20.0 | — | skillDmgBonus__basic 0.0→30.0; skillDmgBonus__dodgeCounter 0.0→30.0 | — |
| 1191C1 | 艾莲 | impl_approximation | RESOURCE+EXEC+ATTR | 11.28 | -0.75 | 0.74 | 11.31 | critRate 19.4→31.4 | — | — | — |
| 1321C1 | 伊芙琳 | impl_approximation | RESOURCE+EXEC+ATTR | 11.48 | 5.32 | -0.84 | 6.74 | enemyDefIgnoreDirect 0.0→12.0 | — | — | — |
| 1321C2 | 伊芙琳 | impl_approximation | RESOURCE+EXEC+ATTR | 20.22 | 12.74 | -5.22 | 12.50 | atk 1494.9→1681.8 | — | inCombatAtkPct 20.0→35.0 | — |
| 1331C2 | 薇薇安 | impl_approximation | RESOURCE+EXEC+ATTR | 3.71 | 2.52 | 0.70 | 0.45 | enemyAnomalyReleaseResIgnore 0.0→15.0; etherAnomalyBuildUpEfficiency 0.0→25.0 | — | — | — |
| 1361C1 | 扳机 | impl_approximation | RESOURCE+EXEC+ATTR | 23.92 | 9.35 | -0.28 | 13.65 | stunDmgMultiplierBonusAlways 35.0→55.0 | — | — | — |
| 1371C1 | 仪玄 | impl_approximation | RESOURCE+EXEC+ATTR | 17.98 | 15.18 | -0.89 | 3.35 | critDmg 50.0→70.0 | — | — | 1 |
| 1381C2 | 零号·安比 | impl_approximation | RESOURCE+EXEC+ATTR | 12.65 | 7.97 | -0.56 | 4.92 | critRate 19.4→31.4 | — | — | — |
| 1401C2 | 爱丽丝 | impl_approximation | RESOURCE+EXEC+ATTR | 14.10 | 6.90 | -1.47 | 8.34 | anomalyDmgBonus 0.0→15.0; disorderDamageBonus 0.0→15.0 | — | — | — |
| 1431C1 | 叶瞬光 | implemented | RESOURCE+EXEC+ATTR | 10.71 | -8.95 | 1.19 | 20.17 | dmgBonus 40.0→50.0; enemyDefIgnoreDirect 0.0→20.0 | — | — | — |
| 1471C2 | 般岳 | impl_approximation | RESOURCE+EXEC+ATTR | 13.55 | 1.44 | -0.56 | 12.57 | critDmg 86.0→101.0; fireDmg 36.0→51.0 | — | — | — |
| 1481C1 | 留银 | implemented | RESOURCE+EXEC+ATTR | 16.24 | 1.49 | -0.40 | 15.00 | enemyResReduction 0.0→15.0 | — | — | — |
| 1481C4 | 留银 | implemented | RESOURCE+EXEC+ATTR | 40.55 | 1.50 | -0.23 | 38.79 | atk 1289.0→1789.0 | — | liuyinGoodReviewAtkBonus 0.0→500.0 | — |
| 1511C1 | 南宫羽 | impl_approximation | RESOURCE+EXEC+ATTR | 25.77 | 7.78 | -1.11 | 18.00 | enemyResReduction 0.0→18.0 | — | — | — |
| 1521C1 | 希希芙 | impl_approximation | RESOURCE+EXEC+ATTR | 13.13 | 1.63 | 4.90 | 6.12 | enemyElectricResIgnoreDirect 0.0→5.0 | — | enemyElectricDefIgnoreDirect 7.0→9.8 | — |
| 1531C1 | 星徽·比利 | impl_approximation | RESOURCE+EXEC+ATTR | 23.18 | 6.31 | -1.47 | 17.59 | enemyPhysicalResIgnoreDirect 0.0→18.0 | — | — | — |
| 1541C6 | 普罗米娅 | impl_approximation | RESOURCE+EXEC+ATTR | 11.01 | 2.61 | 3.63 | 4.39 | enemyResIgnoreAnomaly 0.0→15.0 | — | — | 1 |
| 1581C4 | 蕾米埃尔 | impl_approximation | RESOURCE+EXEC+ATTR | 7.59 | 0.42 | 0.14 | 7.00 | remielleCinema4LuminizeMultiplierBonus 0.0→12.0 | — | remielleCinema4SpecialVoidflareRefillCount 0.0→3.0 | — |
| 1601C1 | 挽昼 | impl_approximation | RESOURCE+EXEC+ATTR | 15.67 | 4.62 | -3.42 | 14.47 | enemyFireResIgnoreDirect 0.0→15.0 | — | — | — |
| 1601C4 | 挽昼 | impl_approximation | RESOURCE+EXEC+ATTR | 9.15 | 1.73 | -5.09 | 13.04 | dmgBonus 15.0→30.0 | — | — | — |
| 1621C2 | 洛克茜 | impl_approximation | RESOURCE+EXEC+ATTR | 3.60 | 4.72 | -3.54 | 2.55 | stunDmgMultiplierBonus 0.0→30.0 | — | — | — |
| 1621C6 | 洛克茜 | impl_approximation | RESOURCE+EXEC+ATTR | 38.73 | 8.35 | 13.70 | 12.61 | enemyWindResIgnoreDirect 0.0→15.0 | — | — | — |
| 1641C1 | 菲欧妮 | impl_approximation | RESOURCE+EXEC+ATTR | 5.77 | 2.49 | 1.40 | 1.77 | anomalyCritDmg 25.0→50.0 | — | — | — |
## 为什么这张表用单人夹具（口径，**别按格改**）

生成器（`src/test/cinemaClassify.ts`）对所有 64 角色统一用 `setupHarness([{ agentId }])`：
**一个角色、无队友、交互次数全 0**（`mechanics/interactionBaseline#roleInteractionBaseline` 的
「全职业默认 0 交互」口径，用户 2026-10-21 裁决）。于是三类格子必然测出 0：

- 额外能力靠**队友构成**触发 ⇒ `additionalAbilityActive = 0` ⇒ 挂在额外能力上的命座测出 0；
- 闪反 / 弹刀（招架支援）次数 = 0 ⇒ 依赖这两类**交互行**的命座测出 0；
- 队友强特次数 = 0 ⇒ 「按队友出招计次」的命座测出 0。

### ★ 为什么不按格换队友（2026-11-06 实测被证伪，别再试）

本表要的是「只换命座等级、其他都不变」。换队友会**改写时间预算**，把「命座增益」与「队伍量级变化」混在一起。
决定性证据（同一 C(n-1)→C(n) 对照）：

| 格 | 单人（本表读数） | 换 1 个队友（仍 2 人队） | 加第 3 人 |
|---|---|---|---|
| `1351C4` 波可娜 | **+6.98%** | +0.85% | **0.00%** |
| `1451C4` 卢西娅·艾洛温 | **+5.23%** | +0.69% | **0.00%** |

第 3 个角色一进队，平A 预算被三人分走、时间账重排 ⇒ 原本非零的格子直接塌成 0。
⇒ 条件型命座一律用「**换 1 个队友**（同为 2 人队、每槽 `basicAttackTimeWeight = 1`）」的读数取归因，
**不写回本表**。判据：`__tests__/cinemaNone28.test.ts`「★ 夹具不可换」。

## 28 格「声明已实现却零收益」的归因（2026-11-06 实测）

> 上一轮遗留的待查项：状态表声明 `implemented*`、而本表 `NONE`（三通道全零）的 28 级。
> 本节是**逐格实测归因**，不是推断。
> **结论：28 格里没有一格是死数据** —— 8 格夹具缺席、8 格原文声明不建模、
> 12 格待查全部落进「夹具缺交互行 / 资源通道不传导伤害 / 需队友 / 如实无增量」四类。
> ⚠ 状态表口径上其实还有一格同类：`1141C2` 莱卡恩（`implemented`，表里 `NONE`，能量 +15 不传导伤害），
> 交接文档漏列 ⇒ 本节覆盖 **29 格**。

### A 类 · 夹具缺席（换 1 个条件队友即可测出，不是缺陷）

交接文档原列 8 格；实测多出 2 格（`1151C6` / `1351C1`，原被归在 C 类）⇒ **共 10 格**。
队友按该格 `spec.additionalAbility.teamConditions` 的声明式条件解析选取
（`sameAttributeAsSelf` / `sameFactionAsSelf` / `specialty`，id 升序第一个命中者 = 确定性）：

| 格 | 角色 | 条件队友 | 条件 | 实测总 % | 通道 |
|---|---|---|---|---|---|
| `1661C6` | 知更鸟 | `1011` 安比 | 锋御/击破 | **+7.71** | EXEC |
| `1151C6` | 露西 | `1021` 格莉丝 | 需队友强特（无 `additionalAbility` 声明） | **+5.35** | RESOURCE+EXEC |
| `1421C1` | 潘引壶 | `1051` 伊德海莉 | 命破/同阵营 | **+4.53** | ATTR（dmgBonus 35→45） |
| `1421C6` | 潘引壶 | `1051` | 同上 | **+2.91** | ATTR |
| `1311C4` | 耀嘉音 | `1021` | 强攻/异常/命破 | **+2.88** | EXEC（+1 新行） |
| `1011C4` | 安比 | `1041`+`1211` | 属性/阵营 | **+1.49** | RESOURCE+EXEC（后场电回能） |
| `1211C1` | 丽娜 | `1011` | 属性/阵营 | **+1.16** | ATTR |
| `1461C4` | 「席德」 | `1021` | 强攻 | **+1.07** | EXEC（`skillDmgBonus__ultimate` 0→20） |
| `1161C4` | 莱特 | `1021` | 强攻/同阵营 | **+0.92** | RESOURCE+EXEC |
| `1351C1` | 波可娜 | `1021` | 强攻/命破/同阵营 | **+0.77** | ATTR（critRate 5→15） |

`1011C4` 是全表唯一需要**两个**条件队友的格子：C4 回能写的是
`applyTeamConfig postRound → initialEnergyGift`，**只回给后场电属性队友**；单人或只有一个队友时
后场没有电角色 ⇒ 回能无处可去 ⇒ 0。交接文档记的「两种配法符号相反（+0.71% vs −1.72%）」
来源就是**后场有没有电角色**，不是同一夹具的矛盾。

`1151C6` 的触发量 = **队友强特合计**（`lucy.ts#computeLucyCheer` 的 `mateEx`），单人恒 0。
队友 1 人 +5.35%、队友 2 人 +10.91%（露西 spec **无 `additionalAbility`**，门控恒 0 也不影响 ⇒ 不挑职业）。

⚠ 交接文档给的 A 类数字（如 `1311C4` +6.94%、`1211C1` +1.92%）**无法逐位复现** —— 它没记配队。
本表数字是「按 spec 条件解析出的第一个队友」的确定性读数，可复现；两套数字**结论一致**（>0 ⇒ 夹具缺席）。

### B 类 8 格 · 原文逐字写「不建模」：0 是预期，**别去"修"**

| 格 | 状态表自述 |
|---|---|
| `1031C4` 妮可 | 范围扩大无乘区，明确跳过 |
| `1041C4` 「11号」 | 抗打断 + 受到伤害 −18% + 无敌（防御向，不建模，用户确认 2026-08-31） |
| `1101C2` 珂蕾妲 | 强特回 60 能量：无干净回能通道，明确不建模 |
| `1111C2` 安东 | 7.5% 生命值护盾（生存向，不建模，用户确认 2026-08-31） |
| `1121C1` 本 | 格挡降攻击者伤害 30%（防御向，不建模） |
| `1141C4` 莱卡恩 | 7.5% 生命值护盾（防御向，不建模，用户确认） |
| `1271C1` 赛斯 | 护盾/防御向不建模；精通失效 +10s 无独立时长维度 |
| `1421C4` 潘引壶 | 终结技治疗 +25%（生存向，不建模，用户确认 2026-08-31） |

### C 类 · 逐格归因（**无一格是死数据**）

| 格 | 归因 | 实测证据 |
|---|---|---|
| `1081C2` 比利 | 夹具缺交互行 | 闪反行 `1081017` 在夹具里 0 次（交互默认全 0）⇒ `dodgeCounterCount=10` 后 **+0.96% EXEC** |
| `1411C4` 柚叶 | 夹具缺交互行 | 涌入的支援突击行要接在弹刀后 ⇒ `parryCount=6` 后 **+0.29% EXEC**（异常积蓄 +447） |
| `1441C6` 真斗 | 夹具缺交互行 | 同上 ⇒ `parryCount=6` 后 **+1.40% EXEC**（资源 −0.55：蓄力占前台） |
| `1271C4` 赛斯 | 夹具缺交互行 + 门槛未跨 | 招架支援行 `1271019` 要弹刀；补 `parryCount=6` 后失衡值 **+323.62**，失衡窗数仍 2→2 ⇒ 伤害 0 |
| `1101C1` 珂蕾妲 | 资源动了，没传导到伤害 | 失衡值 **+1433.71**（单人）/ +985.61（配队友），失衡次数 3→3 ⇒ 单次伤害未变 |
| `1141C1` 莱卡恩 | ~~资源动了，没传导到伤害~~ → **2026-11-08 起已传导** | 失衡值 **+1660.18**；入口门默认开启后窗数 3→**4** ⇒ 跨过阈值，主表读数 `ATTR 1.21%`（`PROBE_STUN_STABLE_BAND=off` 仍读 0） |
| `1131C2` 苍角 | 资源动了，没传导到伤害 | 能量 **+6.00**（`soukaku.c2RefundCount`×1.2 已注入），未换来额外招 |
| `1151C1` 露西 | 资源动了，没传导到伤害 | 能量 **+16.16**，未换来额外招 |
| `1141C2` 莱卡恩 | 资源动了，没传导到伤害 | 能量 **+15.00**（(失衡次数+队友连携)×5），未换来额外招 |
| `1281C6` 派派 | 如实无增量（原文已声明） | 自述「动力恒满口径下无伤害增量」「持续时间上限 +2s 仅记录，不伪造额外命中」 |
| `1151C6` 露西 | 需队友（**已改归 A 类**） | +5.35% / +10.91% |
| `1351C1` 波可娜 | 需队友（**已改归 A 类**） | 困迹要额外能力门控 ⇒ +0.77% ATTR |
| `1131C1` 苍角 | 如实无增量（**用户 2026-11-06 裁决：按满覆盖口径**） | 展旗增益默认全程覆盖 ⇒ 时长 +8s 不产生伤害增量；全模块无 `cinemaLevel >= 1` 分支，0 是预期值 |

### `1131C1` 苍角：**已裁决（2026-11-06，按满覆盖口径）**

用户逐字：「苍角算满覆盖就好，其他的太麻烦了。」

口径 = 展旗增益**默认全程覆盖** ⇒ 影画1 的「增益时长 +8s」不产生伤害增量，**0 是预期值**，
与 `1281C6`（动力时长恒满）同族。`soukaku.ts` 因此**有意不写** `cinemaLevel >= 1` 分支，
状态表照旧 `implemented_approximation`（原文已写「默认满覆盖无额外面板数值」，本次把裁决补进去）。
判据：`cinemaNone28.test.ts`「1131C1 苍角：实测 0（满覆盖口径，用户 2026-11-06 裁决）」。

### 顺带量到：总 % ≈ 0 但非伤害通道动了（标签本就落在 RESOURCE/ATTR，不是缺陷）

同一套探针扫了全部「声明 implemented 且总 % ≈ 0」的格子，除上表外还有 5 格是
「非伤害通道动了、伤害没动」：

| 格 | 动了哪条非伤害通道 | 伤害 |
|---|---|---|
| `1011C1` 安比 | 能量 +25.92 | 0 |
| `1121C6` 本 | 失衡值 +2764.54 | 0 |
| `1271C2` 赛斯 | 异常积蓄 +2358.6 | 0 |
| `1181C2` 格莉丝 | 电抗/电积蓄抗（spec teamBuffs） | 0 |
| `1151C4` 露西 | 加油暴伤 +10%（spec teamBuffs） | 0 |

### 复现

`npx vitest run src/composables/__tests__/cinemaNone28.test.ts`（30 判据，~5s）
—— A 类每格一个 `it`、B 类零值、C 类三组、以及「★ 夹具不可换」都在里面，夹具按该格原文手写。
