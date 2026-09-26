/**
 * S2 时间预算折叠环 —— 自 `core/resource.ts#calcTeamResources` 外提（CC-4，2026-09-25）。
 *
 * 职责：把每个角色执行行的**前台时间**（`timeBucket ≠ 'backstage'`，见 `isFrontlineExecution`）
 * 对其**自家账本**（`necessaryTime + basicAttackTime`）收敛——超出量折入 `cfg.timeBudgetExcess`
 * → 压缩全队平A池 → 平A回能减少 → 次数重收敛。收敛后 Σ前台执行行 ≡ 账本 ≡ 共享时间轴的占用
 * （构造性恒等式）。
 *
 * 与旧闭包的差别**只有机械替换**：外层变量改读 `ctx.*`、诊断量改读写 `diag.*`、
 * `runInnerLoop(x)` 注入 `ctx.innerCtx`。函数体逐字保留原表达式、顺序与常量；每 pass 的局部量
 * （`teamRefund` / `maxExcess` / `maxIdle` / `inner`）**不进 diag**。
 *
 * 诊断量归属**被接受的那次调用**（口径 `engine:收敛读数归属`，`types/resource/team.ts`）：
 * 重折环换新 `diag` 对象即归零；调用方以一行包装 `runFoldLoopPure(foldCtx, diag, from)`
 * **每次调用时读 `diag`**（禁止 `const d = diag` 之类缓存——重折换对象后会写到旧对象）。
 *
 * 依赖方向：本文件不得 import `core/resource.ts`（防循环依赖）；只依赖类型、`./innerLoop`、
 * `./helpers`、`./crossAgentSupply`、`./phaseExecutions`。
 */
import type {
  ResourceCalcConfig, CharacterOperationConfig, IterationState,
} from '@/types/resource'
import { isFrontlineExecution } from '@/types/resource'
import { runInnerLoop, type InnerLoopContext } from './innerLoop'
import { crossAgentSupplyAt, findCrossAgentSupplySlots, ultimateGiftOf } from './crossAgentSupply'
import { buildExecutionsWithPhase } from './phaseExecutions'
import { TIME_FOLD_CONVERGENCE_SECONDS } from './helpers'
import type { SolveDiagnostics } from './solveDiagnostics'

/** 折叠环的只读上下文：把 `calcTeamResources` 里原先的闭包变量显式化（调用期间不变）。 */
export interface FoldLoopContext {
  configs: CharacterOperationConfig[]
  config: ResourceCalcConfig
  totalTime: number
  maxTimeIter: number
  /** 原 `injectedStates` 的真值判断（显式种子或热启动命中） */
  injected: boolean
  /** 默认零种子快照：种子轨迹未正常收敛时的规范重跑起点 */
  defaultSeedStates: IterationState[]
  /** 内层不动点只读上下文（与欠打回填试探共用同一台机器） */
  innerCtx: InnerLoopContext
}

/**
 * 时间预算折叠循环（内层次数收敛 + 停点规范化 + 折叠 excess/refund 冻结）；写 `diag` 诊断量。
 */
export function runFoldLoop(
  ctx: FoldLoopContext,
  diag: SolveDiagnostics,
  from: IterationState[],
): IterationState[] {
  let st = from
  // 每次折叠管线运行（含规范重放）独立冻结 refund
  diag.refundFrozen = false
  for (let timePass = 0; timePass < ctx.maxTimeIter; timePass++) {
    diag.timeBudgetPasses = timePass + 1
    // 口径 `engine:收敛环停点规范化` 的 `@fact` 声明按既有惯例留在 re-export 壳处
    // （`src/core/resource.ts`，锚已随实现改指 `src/core/resource/foldLoop.ts#runFoldLoop`）。
    // 否决记录（环停点侧，都有实测数字）：环均值阻尼（对环成员取均值）实测被吸回同一环、
    // 桥接不了「冷种子收敛不动点 vs 热种子入环」的共存吸引子 → 否决；0.5 阻尼单独用也吸收不了
    // 整数阶梯跳变（丽娜 ex 行随能量阈值 6↔7 跳变，账本阶跃 ~180 喧响经队伍分享闭环）→ 否决。
    // 精确周期环检测 + 规范重跑（2026-09-08）：内层判稳只看强特/终结次数严格相等，但喧响
    // 账本行级化后「喧响→能量→次数→必要时间→平A池→阶梯行数→喧响」反馈环带整数阶梯项
    // （实测振荡器：丽娜 ex 行+子行随能量阈值 6↔7 整数量子跳变，账本阶跃 ~180 喧响经队伍
    // 分享闭环），0.5 阻尼吸收不了 → 全状态精确 2-循环、甚至「冷种子收敛到不动点、热种子入环」
    // 的多吸引子共存（yidhariInteractionGrid parry=4/dodge=2 格实测；环均值阻尼亦实测被吸回
    // 同一环——均值桥接不了共存吸引子，否决）。停点必须与种子无关，规则三层：
    // ① 逐轮记录全状态签名，签名精确重复 = 进入极限环 → 取环内 JSON 字典序最小成员为规范停点
    //    （相位无关：冷/热从不同瞬态段进入同一个环，成员集合相同，规范选择必然相同）；
    // ② 注入种子（显式 initialStates / 热启动缓存）的轨迹若非正常收敛（跑满上限或入环）= 停点
    //    含瞬态相位成分 → 弃用并**规范重跑**：从默认零种子重启，逐位复刻冷启动轨迹；重跑仍入环
    //    则按①取字典序规范——重跑结果是（默认种子, 迭代映射）的纯函数，与注入种子彻底解耦；
    // ③ 正常收敛（次数严格相等判稳）的轨迹直接接受——不动点唯一性由既有连续松弛教义保证
    //    （2026-09-04），冷/热正常收敛落点逐位一致是 determinism.test 的既有约定。
    // 下游（折叠残差累计/欠打回填/终局整数重推/装配）全部是停点的确定性函数；pass>0 的起点
    // 冷热已同，其上限停点亦同，冷热逐位一致由归纳保持。
    let inner = runInnerLoop(st, ctx.innerCtx)
    if (!inner.clean && timePass === 0 && ctx.injected) {
      // ② 规范重跑：种子轨迹的停点含瞬态相位，弃用，从默认零种子复刻冷启动
      inner = runInnerLoop(ctx.defaultSeedStates.map(s => ({ ...s })), ctx.innerCtx)
    }
    st = inner.end
    diag.iterations = inner.iterations // 诊断量 `iterations` 只记折叠环的内层轮数（欠打回填试探复用 runInnerLoop 但不覆盖它）
    if (inner.clean) diag.converged = true

    // 测量每个角色执行计划的**前台**时间（后台行不占共享轴），对自家账本收敛：
    // 超出账本 = 该角色有未付费的前台行 → 折入必要时间压缩平A池（团队级，非单人预算）。
    // 只折正超出（真溢出）：负值 = estimate 高估必要时间 / 有空闲前台，不折回单角色
    // （否则 necessary 变负），改为团队 refund 回填平A池（见下）。
    let maxExcess = 0
    let maxIdle = 0
    let teamRefund = 0
    /** 停滞判据用：历史最小残差 + 连续无改善轮数（阶段2，见下方收敛判据注释） */
    if (typeof diag.bestExcess === 'undefined') diag.bestExcess = Infinity
    if (typeof diag.stagnantPasses === 'undefined') diag.stagnantPasses = 0
    // 诺姆膛温换连携赠链行在装配后被 applyChainGift 追加、不在 buildExecutions 产物里——
    // 行测量必须计入其时间（iterate 必要时间已按同一口径预留），否则折叠环会把预留读成
    // idle → pass0 refund 双击（与最高马力星光行同病）。
    // 供给量与落点由模块声明（`crossAgentSupply`），引擎按类别查询——本文件不再含角色 id。
    const chainGiftInfo = crossAgentSupplyAt(ctx.configs, st, findCrossAgentSupplySlots(ctx.configs, 'gift-chain:chain')[0] ?? -1, {
      totalTime: ctx.totalTime, stunCount: ctx.config.stunCount ?? 0, teamSize: ctx.config.teamSize,
    })
    // 琉音好评转大赠链行同理：装配后 applyUltimatePromote 追加，行测量计入其时间。
    // **轴模式必须用轴计数**（`ultimateGiftOf` = 该量的单一事实源）：模块供给带 `axisSuppressed`
    // ⇒ 漏掉轴分支就看不见赠行 ⇒ 它占的前台被读成 idle，`timeBudgetRefund` 把它 refund 掉
    // ⇒ iterate 侧刚补的预留又被打回（2026-09-20 R67 实测：只补 iterate 不补本处，账本净额仍 0）。
    const ultimateGift = ultimateGiftOf(ctx.configs, st, {
      totalTime: ctx.totalTime, stunCount: ctx.config.stunCount ?? 0, teamSize: ctx.config.teamSize,
      axisMode: ctx.config.axisMode, axisPromote: ctx.config.axisUltimatePromote,
    })
    for (let i = 0; i < ctx.configs.length; i++) {
      const cfg = ctx.configs[i]
      const state = st[i]
      const teammateFrontlineSeconds = ctx.configs.reduce(
        (sum, _, j) => (j === i ? sum : sum + st[j].frontlineTime),
        0,
      )
      const executions = buildExecutionsWithPhase(cfg, state, state.chainCountTotal, teammateFrontlineSeconds)
      // 净占用口径：物化行全额 − 轴内合轴分摊（跨角色并行块只计一次前台；iterate 平A池吃进同一值）。
      // 分摊按 `${slot}:${moveId}`（栈引擎比例分摊），行 count = 块次数、totalTime 全额。
      const overlapByAction = ctx.config.axisOverlapByAction
      const rowTime = executions.reduce(
        (sum, e) => sum + Math.max(0, (e.totalTime ?? 0) - (overlapByAction?.[`${cfg.slot}:${e.moveId}`] ?? 0))
          * (isFrontlineExecution(e) ? 1 : 0),
        0,
      ) + (i === chainGiftInfo.targetIdx ? chainGiftInfo.time : 0)
        + (i === ultimateGift.targetIdx ? ultimateGift.time : 0)
      // 账本份额 = 必要时间 + 分到的平A池（iterate 保证 Σ账本 ≤ budget + refund）
      const excess = rowTime - (state.necessaryTime + state.basicAttackTime)
      const teammatesLedgerNet = ctx.configs.reduce(
        (sum, _, j) => (j === i ? sum
          : sum + Math.max(0, st[j].necessaryTime - (st[j].comboAlignCredit ?? 0) + st[j].basicAttackTime)),
        0)
      const battleWindow = ctx.totalTime - (ctx.config.invincibleTime ?? 0)
      const availableFrontline = Math.max(0, battleWindow - teammatesLedgerNet)
      cfg.timeAvailableFrontlineSeconds = availableFrontline
      // 真实时间压力（模块退化判据的权威信号，见 CharacterOperationConfig.timePressureSeconds）：
      // **本槽物化行 − 战斗窗口**（不减队友占用）——用户裁决 2026-09-25：退化（短轴/砍交互）只在
      // 「自己绝对打不完」时触发。旧口径减了队友账本净占用 ⇒ 队友吃掉前台就把「其实装得下」的队
      // 顶过阈值误退化（叶瞬光满命队 auto 退短轴、白丢灭极段伤害 −11% 即此因）。用**当轮实测行**
      // 而不是累加的折叠残差，否则 pass0 的虚高会把「其实装得下」的队误判成超支（叶瞬光自动轴退化曾被此关掉过）。
      cfg.timePressureSeconds = rowTime - battleWindow
      if (excess > 1e-6) {
        // 量化（floor 次数）导致残差 ~1s 属合轴可覆盖，不追求精确 0。
        // `+=` 累加（2026-09-03 实测三语义对比）：`=` 对正反馈队（猫又/伊德海莉——模块行随
        // 平A池增长）欠补偿 → 溢出 186s；峰值 `max()` 同样溢出；累加虽使单调队（希格莉德
        // 敛枪式/凛冽枪尖）必要时间带历史残差，但这是全队模块行（雅/叶瞬光/柏妮思）的既有
        // 口径（必要 = 估计 + 折叠残差），且收敛健康（timeBudgetConverged、无溢出）。
        cfg.timeBudgetExcess = (cfg.timeBudgetExcess ?? 0) + excess
        if (excess > maxExcess) maxExcess = excess
      } else if (-excess > 1e-6) {
        // 负溢出（该角色账本 > 物化行，idle_i = estimate 高估量，与 basicAttackTime 无关）：
        // 单角色不折回（necessaryTime 变负、平A池膨胀），团队层面累计成 refund 回填平A池
        // ——回填后 Σ前台行 = Σ物化必要行 + 平A池 ≈ 预算，时间打满。
        // ⚠ 例外（R37-J5 动态合轴配套，2026-09-19）：该槽已贴满**单角色上限**（必要+平A ≥ 战斗时间）时，团队级 refund
        //   到不了它——cap 让它一秒平A都拿不到，refund 只能流向队友并把次数收敛搅乱（实测 auto-1431-1491-1341：操作角色账本
        //   180 / 物化行 167.2，欠打回填 4 次试探全部 stable=false 被拒，留白 12.8s）。此时按物化行把**本槽**账本折回
        //   （累加负 excess，与正向折叠同一口径），省下的时间下一轮由它自己的平A池吸收；仍记入 maxExcess 视为未自洽、继续折叠。
        //   用户口径：最后一点时间给平A；留白太多 = 引擎没把资源回复消耗算完备，不是可容忍残差。
        const atSingleCap = state.necessaryTime + state.basicAttackTime >= (ctx.totalTime - (ctx.config.invincibleTime ?? 0)) - 1e-6
        if (atSingleCap) {
          cfg.timeBudgetExcess = (cfg.timeBudgetExcess ?? 0) + excess
          if (-excess > maxExcess) maxExcess = -excess
        } else {
          teamRefund += -excess
          if (-excess > maxIdle) maxIdle = -excess
        }
      }
    }
    diag.timeBudgetResidualSeconds = maxExcess
    diag.timeBudgetIdleSeconds = maxIdle
    // refund = Σ(该角色正 idle)：idle_i = 账本_i − 物化必要行_i。
    // **冻结语义**：首轮测得的 idle 总和写入 timeBudgetRefund（第 2 轮起 iterate 吃进、次数重收敛），
    // 之后**不再改写**——refund 与次数收敛存在耦合（平A回能→次数→必要时间→idle），逐轮跟随会
    // 抖动到 8 轮耗尽（伊德海莉烧血/艾莲等强依赖角色的 idle 随次数跳变）；一次性修正 + 收敛判据
    // 保持 excess-only（与旧行为同构），换 canceling 掉的精度是 ±1s 量化残差量级。
    // 天然上限：idle_i ≤ E_i → refund ≤ ΣE → availableBasicTime ≤ 预算，不会填超战斗时间。
    if (!diag.refundFrozen) {
      ctx.config.timeBudgetRefund = Math.max(0, teamRefund)
      diag.timeBudgetRefundedSeconds = ctx.config.timeBudgetRefund
      diag.refundFrozen = true
      continue // 注入轮不判收敛：下一轮 iterate 吃进 refund 后再按 excess 判据停（否则 states 没吃到回填）
    }
    // 收敛判据：excess 是**秒**——精确估时（琉音/sigrid 钩子）把残差压到 ~5e-4s 浮点噪声量级，
    // 1e-6 判据 8 轮耗尽 → timeBudgetConverged=false 而 allAgentsSweep 硬断言恒 true（2026-09-06
    // 实测否决）。1e-3（1 毫秒）容差远小于任何量化残差（坑12 口径 ±1~2s），不改变折叠动力学，
    // 只让「已收敛到浮点噪声」的队如实报收敛。
    // 常量与 S4 截断入口容差同源（TIME_FOLD_CONVERGENCE_SECONDS）：这里放行的残差，截断处不得再当溢出。
    if (maxExcess <= TIME_FOLD_CONVERGENCE_SECONDS) {
      diag.timeBudgetConverged = true
      break
    }
    // 停滞判据（阶段2，用户 2026-09-10 口径「平A→资源→次数 的正反馈是模型本身，不能去掉」）：
    // 折叠环在**量化地板**处会停在恒定残差上——实测叶瞬光队 pass7 起 maxExcess 恒 0.092~0.093s
    // 持续 20+ 轮（累加器仍在增长，残差不动）。这不是「没收敛」，而是已到不动点（残差 = 量化粒度）。
    // 判据：连续 3 轮无改善（改善 ≤ 1e-2 = 10 毫秒，量化噪声量级）即判收敛；
    // 取代「残差 ≤ 1e-3」这个对离散系统过严的门槛。阈值取 1e-2 的依据：比利系每轮只改善
    // ~0.002s（比利终局整数重推的量化残差），1e-3 会让停滞计数不断重置、差一两轮跑满上限。
    if (maxExcess < (diag.bestExcess as number) - 1e-2) {
      diag.bestExcess = maxExcess
      diag.stagnantPasses = 0
    } else {
      diag.stagnantPasses = (diag.stagnantPasses as number) + 1
      if ((diag.stagnantPasses as number) >= 3) {
        diag.timeBudgetConverged = true
        break
      }
    }
    // 逐轮残差轨迹（同一调用的折叠环内部序列；与上面的调用级记录同属收敛读数归属设施）
    // 注意：`maxExcess ≤ 1e-3` 那条 break 在本记录之前 → **收敛即停的轮次不留记录**，
    // 故「记录条数 = passes − 1 − 早停轮数」，别把记录条数当轮数读。
    if (typeof process !== 'undefined' && process.env?.PROBE_TRACE_FOLD === '1') {
      const g = globalThis as unknown as { __foldPasses?: unknown[] }
      ;(g.__foldPasses ??= []).push({
        call: (globalThis as unknown as { __foldTrace?: unknown[] }).__foldTrace?.length ?? 0,
        pass: timePass, maxExcess, best: diag.bestExcess, stagnant: diag.stagnantPasses,
        idle: maxIdle, refund: ctx.config.timeBudgetRefund ?? 0, conv: diag.timeBudgetConverged,
        innerClean: inner.clean, innerIters: inner.iterations,
      })
    }
  }
  return st
}
