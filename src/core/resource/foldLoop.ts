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
import { stunCountForCountChannel } from '@/core/stunPlanProjection'
import { probePush } from '@/core/probeTrace'
import type {
  ResourceCalcConfig, CharacterOperationConfig, IterationState,
} from '@/types/resource'
import { isFrontlineExecution } from '@/types/resource'
import { runInnerLoop, type InnerLoopContext } from './innerLoop'
import { crossAgentSupplyAt, findCrossAgentSupplySlots, ultimateGiftOf } from './crossAgentSupply'
import { buildExecutionsWithPhase } from './phaseExecutions'
import { TIME_FOLD_CONVERGENCE_SECONDS } from './helpers'
import type { SolveDiagnostics } from './solveDiagnostics'

/**
 * CC-158：负溢出退回本槽折叠残差的最小量（秒）。值同 `core/resource.ts#TIME_BUDGET_TOLERANCE_SECONDS`
 * （1s 量化地板）；本文件不得 import core/resource.ts（循环依赖），故本地声明。
 */
const UNFOLD_MIN_SECONDS = 1

/**
 * 累加器出口（2026-10-04）：判定「rowTime 不再随 `acc` 下降」的容差（秒）与连续轮数。
 * 与停滞判据同源（`1e-2` = 10 毫秒，量化噪声量级，见下方停滞判据注释）。
 * 语义：某槽连续 `ROW_TIME_STAGNATION_PASSES` 轮 `rowTime` 无改善（且平A池已空）
 * ⇒ 折叠残差对该槽已失去杠杆（挤不动行），继续累加只是记账噪声。
 */
const ROW_TIME_STAGNATION_SECONDS = 1e-2
const ROW_TIME_STAGNATION_PASSES = 2

/** 折叠环的只读上下文：把 `calcTeamResources` 里原先的闭包变量显式化（调用期间不变）。 */
export interface FoldLoopContext {
  configs: CharacterOperationConfig[]
  config: ResourceCalcConfig
  totalTime: number
  maxTimeIter: number
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
  /**
   * 累加器出口（2026-10-04）的逐槽停滞跟踪：**本函数局部**，不跨运行——重折环是新调用，重新观察。
   * `prevRowTime` = 该槽历史最小物化行时间（只降不升，与停滞判据的 `bestExcess` 同手法）；
   * `stagnantRowPasses` = 连续无改善轮数。判据见 `ROW_TIME_STAGNATION_SECONDS` 常量处。
   */
  const prevRowTime: number[] = ctx.configs.map(() => Infinity)
  const stagnantRowPasses: number[] = ctx.configs.map(() => 0)
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
    // ① 逐轮记录全状态签名，签名精确重复 = 进入极限环 → 取环停点（`innerLoop.ts#integerCycleStop`：不透支成员中
    //    次数最多者、平局取 JSON 字典序最小；CC-326 前 = JSON 字典序最小成员）。相位无关：冷/热从不同瞬态段进入同一个环，
    //    成员集合与后继关系相同，选择必然相同；
    // ② （CC-147 删）注入种子通道（显式 initialStates / 热启动缓存）已不存在：起点 = 调用方给的 st
    //    （主路径 = 默认零种子；截断重折 = 默认零种子快照；终局重折 = 终局态）。
    // ③ 正常收敛（次数严格相等判稳）的轨迹直接接受——不动点唯一性由既有连续松弛教义保证
    //    （2026-09-04），冷/热正常收敛落点逐位一致是 determinism.test 的既有约定。
    // 下游（折叠残差累计/欠打回填/终局整数重推/装配）全部是停点的确定性函数；pass>0 的起点
    // 冷热已同，其上限停点亦同，冷热逐位一致由归纳保持。
    // ②′ CC-146 曾令 pass0 弃用注入种子（反例：注入种子 clean 收敛到冷种子到不了的共存不动点）；
    // CC-147（2026-09-28）把注入通道整体删掉，此分支随之消失。回退点：git revert CC-147 提交。
    let inner = runInnerLoop(st, ctx.innerCtx)
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
    /**
     * 停滞判据用：历史最小残差 + 连续无改善轮数（阶段2，见下方收敛判据注释）。
     * **只在 undefined 时初始化 = 跨运行不归零，这是承重行为**（第 348 轮实测）：同一个 `diag` 上的第二次运行
     * （CC-160 终局重折，`resource.ts#runPreTailFinalize`）接着主折叠的最优残差与计数判停；截断重折环每次换新 `diag`，不受影响。
     * 改成每次运行归零时，缺省配置 414 例终局不变，但 auto-1431-1481-1341 在 `comboAlignAbsorbRatio=1` 下留白 1.01→1.88s
     * （dynamicComboAlign ② 的 1.5s 门红）、`=0` 下截断 82.7→63.9s。要改先定重折语义（续跑还是重新迭代），见 docs/mcp-fold-loop-stop.md。
     */
    if (typeof diag.bestExcess === 'undefined') diag.bestExcess = Infinity
    if (typeof diag.stagnantPasses === 'undefined') diag.stagnantPasses = 0
    // 诺姆膛温换连携赠链行在装配后被 applyChainGift 追加、不在 buildExecutions 产物里——
    // 行测量必须计入其时间（iterate 必要时间已按同一口径预留），否则折叠环会把预留读成
    // idle → pass0 refund 双击（与最高马力星光行同病）。
    // 供给量与落点由模块声明（`crossAgentSupply`），引擎按类别查询——本文件不再含角色 id。
    const chainGiftInfo = crossAgentSupplyAt(ctx.configs, st, findCrossAgentSupplySlots(ctx.configs, 'gift-chain:chain')[0] ?? -1, {
      totalTime: ctx.totalTime, stunCount: stunCountForCountChannel(ctx.config),
    })
    // 琉音好评转大赠链行同理：装配后 applyUltimatePromote 追加，行测量计入其时间。
    // **轴模式必须用轴计数**（`ultimateGiftOf` = 该量的单一事实源）：模块供给带 `axisSuppressed`
    // ⇒ 漏掉轴分支就看不见赠行 ⇒ 它占的前台被读成 idle，`timeBudgetRefund` 把它 refund 掉
    // ⇒ iterate 侧刚补的预留又被打回（2026-09-20 R67 实测：只补 iterate 不补本处，账本净额仍 0）。
    const ultimateGift = ultimateGiftOf(ctx.configs, st, {
      totalTime: ctx.totalTime, stunCount: stunCountForCountChannel(ctx.config),
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
      let excess = rowTime - (state.necessaryTime + state.basicAttackTime)
      // （CC-191 删：原此处按「战斗窗口 − 队友账本净占用」算 availableFrontline 写 cfg.timeAvailableFrontlineSeconds，字段注释自承无消费者）
      const battleWindow = ctx.totalTime - (ctx.config.invincibleTime ?? 0)
      // 真实时间压力（模块退化判据的权威信号，见 CharacterOperationConfig.timePressureSeconds）：
      // **本槽物化行 − 战斗窗口**（不减队友占用）——用户裁决 2026-09-25：退化（短轴/砍交互）只在
      // 「自己绝对打不完」时触发。旧口径减了队友账本净占用 ⇒ 队友吃掉前台就把「其实装得下」的队
      // 顶过阈值误退化（叶瞬光满命队 auto 退短轴、白丢灭极段伤害 −11% 即此因）。用**当轮实测行**
      // 而不是累加的折叠残差，否则 pass0 的虚高会把「其实装得下」的队误判成超支（叶瞬光自动轴退化曾被此关掉过）。
      cfg.timePressureSeconds = rowTime - battleWindow
      /**
       * ★ 累加器出口（2026-10-04）：判定该槽「rowTime 是否还随 acc 下降」。
       *
       * 折叠残差 `acc` 的唯一杠杆 = 压缩平A池 → 模块少产行 → `rowTime` 下降。判据取**合取**：
       *   ① `state.basicAttackTime <= 0`：该槽平A池已空（无处可压）；
       *   ② `rowTime` 连续 `ROW_TIME_STAGNATION_PASSES` 轮无改善（≤ `ROW_TIME_STAGNATION_SECONDS`）。
       * 两者同时成立 ⇒ 继续累加挤不动任何行，是纯记账噪声 ⇒ 该槽停止累加。
       *
       * **为什么必须带 ②（v1 的教训）**：只判 ①（团队 Σbasic==0）会在「池被挤空但行仍在缩」的
       * 过渡轮就冻结，把本该由残差继续挤掉的秒数留在账本外 ⇒ 实测全库 **−32.5M / 失衡 −3 /
       * `timeFillRatchet` 6 红**（`over 0→1.1`、`stun 2→1`、`stable→cycle`）。带 ② 后冻结只发生在
       * 真正到不动点的槽上。
       *
       * **机制（修正 v1 的错误归因）**：封顶激活时 `pool = budget − scale·Σnet − Σcredits + relief + refund`
       * 且 `scale·Σnet ≡ budget` ⇒ **平A池恒 0，与 acc 无关**（`take` 项在 `Σcapped` 与
       * `reliefWithDynamic` 里精确抵消，实测两态均 +0.000）。acc 的真正作用面是**份额**：
       * `capped_i = net_i × budget/Σnet`，只由比值决定 ⇒ 冻结 acc 会改份额（实测主C +3.10s）。
       * ⇒ 本出口**不是中性记账**，它改落点；故判据要窄，且必须逐队归因。
       */
      const rowImproved = rowTime < prevRowTime[i] - ROW_TIME_STAGNATION_SECONDS
      if (rowImproved) {
        prevRowTime[i] = rowTime
        stagnantRowPasses[i] = 0
      } else {
        stagnantRowPasses[i] = (stagnantRowPasses[i] ?? 0) + 1
      }
      // ★ 累加器出口（2026-10-04）的判据 = 目标口径的**三段合取**：
      //   ① `basicAttackTime <= 0` —— 该槽平A池已空（无处可压）；
      //   ② `excess >= 0`（即 `idle == 0`）—— 该槽**不是欠打**（账本 ≤ 物化行）。
      //      漏掉本条会误伤「账本高估」的槽：实测 `auto-1431-1491-1341` 在无出口时
      //      `resid=0.000 / idle=0.54`（完美收敛），带（缺②的）出口后 `resid=1.538 / idle=2.74`
      //      ⇒ **把已收敛的队弄坏**（−0.60M）。idle>0 说明该槽的账本仍高于物化行，
      //      此时残差不该被冻——它还得靠 refund 通道继续参与收敛。
      //   ③ `rowTime` 连续 `ROW_TIME_STAGNATION_PASSES` 轮无改善 —— 杠杆确实已失效。
      const accLeverLost = state.basicAttackTime <= 1e-9
        && excess >= 0
        && (stagnantRowPasses[i] ?? 0) >= ROW_TIME_STAGNATION_PASSES
      if (excess > 1e-6) {
        // 量化（floor 次数）导致残差 ~1s 属合轴可覆盖，不追求精确 0。
        // `+=` 累加（2026-09-03 实测三语义对比）：`=` 对正反馈队（猫又/伊德海莉——模块行随
        // 平A池增长）欠补偿 → 溢出 186s；峰值 `max()` 同样溢出；累加虽使单调队（希格莉德
        // 敛枪式/凛冽枪尖）必要时间带历史残差，但这是全队模块行（雅/叶瞬光/柏妮思）的既有
        // 口径（必要 = 估计 + 折叠残差），且收敛健康（timeBudgetConverged、无溢出）。
        // ★ 例外（2026-10-04）：该槽平A池已空且 rowTime 已停滞 ⇒ 杠杆失效，累加是纯记账噪声
        // （判据与机制见上方 `accLeverLost`）。回退点：删掉三元、恢复无条件 `+=`。
        // ⚠ 诊断量只在**真的抑制了累加**时置位（`accLeverLost` 为真但 `excess ≤ 0` 时无事发生），
        // 否则它会在「条件成立但没压住任何东西」时也报 true —— 行为锁就锁不住实现（反证实测踩到）。
        if (accLeverLost) diag.timeBudgetAccumulatorFrozen = true
        cfg.timeBudgetExcess = accLeverLost
          ? (cfg.timeBudgetExcess ?? 0)
          : (cfg.timeBudgetExcess ?? 0) + excess
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
        // CC-158（第 180 轮）：**先退回本槽自己折进去的残差**（夹在 ≥ 0，necessary 不会变负），退回量计入 maxExcess
        // 让环继续迭代——折叠残差由「只增不减」变成不动点迭代 acc' = max(0, acc + excess)。
        // 病例（auto-1431-1341-1311，叶瞬光剑势来自平A = 正反馈）：acc=0 时平A池 45s ⇒ 行超账本 +17.8 折入；
        // 下一轮平A被挤到 0 ⇒ 行缩回、负溢出 −21.6，旧逻辑只进团队 refund（已冻结）且不计入收敛判据 ⇒
        // 停在账本虚高 18.9s / 留白 9.4s。收敛条件：模块行对平A时间的斜率 < 1（叶瞬光 ≈ 0.32）。
        // 门槛 UNFOLD_MIN_SECONDS（= 1s 量化地板）：负溢出 ≤ 1s 不退回——整数行阶跃会让 excess 在 ±0.8s 间 2-循环
        // （实测南宫羽+格莉丝手写轴：acc 6.6↔7.4，被停滞判据截停在中途、留下 2.08s 截断），与上方「量化残差 ~1s
        // 属合轴可覆盖，不追求精确 0」同一口径。
        // 退回之后仍剩的负溢出照旧走下方分支（贴顶折回 / 团队 refund）。docs/mcp-stun-dual-source.md §22。
        // 回退点：删除本块（到 `if (atSingleCap)` 之前）。
        const ownFolded = cfg.timeBudgetExcess ?? 0
        if (ownFolded > 1e-9 && -excess > UNFOLD_MIN_SECONDS) {
          const back = Math.min(ownFolded, -excess)
          cfg.timeBudgetExcess = ownFolded - back
          if (back > maxExcess) maxExcess = back
          excess += back
          // 退回的秒数回到团队平A池；refund 已冻结时先从 refund 里扣（夹 ≥ 0），否则同一份空闲被补偿两次：
          // pass0 该槽的估算高估量已进 refund 冻结，之后同一槽先折入、再退回 ⇒ 平A池 = 预算 + refund + 合轴，
          // 净占用 ≈ 预算 + refund（实测南宫羽+格莉丝手写轴 184.75 = 180 + ~5.1 ⇒ 被误判轴太厚而退化）。
          // refund 是 pass0 的粗修正、退回是逐槽的精修正，二者不叠加；只减不增 ⇒ 不引入冻结语义要防的抖动。
          if (diag.refundFrozen && (ctx.config.timeBudgetRefund ?? 0) > 0) {
            ctx.config.timeBudgetRefund = Math.max(0, (ctx.config.timeBudgetRefund ?? 0) - back)
            diag.timeBudgetRefundedSeconds = ctx.config.timeBudgetRefund // 诊断量跟随实际生效值
          }
        }
        if (-excess <= 1e-6) {
          // 负溢出已被本槽残差完全吸收
        } else if (atSingleCap) {
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
    probePush('PROBE_TRACE_FOLD', '__foldPasses', () => ({
      call: (globalThis as unknown as { __foldTrace?: unknown[] }).__foldTrace?.length ?? 0,
      pass: timePass, maxExcess, best: diag.bestExcess, stagnant: diag.stagnantPasses,
      idle: maxIdle, refund: ctx.config.timeBudgetRefund ?? 0, conv: diag.timeBudgetConverged,
      innerClean: inner.clean, innerIters: inner.iterations,
    }))
  }
  // 累加器出口（2026-10-04）：如实上报留在账本里的折叠残差量级（逐槽取最大）。
  // 这是「账本自洽性」的直接读数，也是本出口**唯一可被行为锁区分**的观测量——
  // 实测 `auto-1431-1481-1491` 有/无出口的**落点与伤害逐位相同**（`ledger=[135.01…]`、
  // `dmg=104.68M`），差别只在本字段（有出口 `62.2` vs 无出口 `163.0`）。
  diag.timeBudgetAccumulatedSeconds = ctx.configs.reduce(
    (m, c) => Math.max(m, c.timeBudgetExcess ?? 0), 0)
  return st
}
