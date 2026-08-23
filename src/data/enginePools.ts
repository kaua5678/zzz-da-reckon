/**
 * 自动下位音擎「命名池」库：跨预设共享的下位候选清单，一处书写、预设内用 poolRef 引用。
 * 数据本体在同目录 enginePools.json（validate-data 会校验 poolRef 引用与音擎 id 存在）。
 *
 * 预设用法（可选字段 autoEngine，声明即覆盖页面装填框）：
 *   "autoEngine": {
 *     "byAgent": { "1481": { "poolRef": "琉音槽下位" } },  // 按角色：琉音站哪个槽都生效
 *     "bySlot":  { "1": { "pool": ["14110", "13005"] } },  // 或按槽位直写
 *     "pool": ["14110", "13005"],                          // 或整队默认池
 *     "mods": { "aRank": 5, "standard": 3 }                // 可选：精炼档覆盖（A 默认 5 不变）
 *   }
 * 每槽取池优先级：bySlot[slot] > byAgent[该槽角色] > 整队 pool/poolRef > 页面装填框 > DEFAULT_AUTO_ENGINE_POOL。
 * 精炼档优先级：preset.mods > 页面输入 > A5/S3。
 */
import pools from './enginePools.json'

export const ENGINE_POOLS = pools as Record<string, string[]>
