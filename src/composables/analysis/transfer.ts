/**
 * 跨页分析传递：专业页（队伍对比/时间图表/血量膨胀）跑完后，把结果摊成长表放进这里；
 * 分析工作台只读导入，不重新求值。模块级 shallowRef 而非 Pinia：
 * 数据集可能上千行，深层 reactive 没有收益；页面/组件都从同一模块实例读。
 */
import { readonly, shallowRef } from 'vue'
import type { AnalysisDataset } from './dataset'

export interface TransferredAnalysis {
  /** 稳定 id：同一来源/指标重跑会覆盖旧项，不无限堆积 */
  id: string
  /** 来源页（展示用，如「队伍对比」） */
  source: string
  label: string
  dataset: AnalysisDataset
  createdAt: number
}

const MAX_ITEMS = 6
const items = shallowRef<TransferredAnalysis[]>([])

/** 发布一次结果（同 id 覆盖并移到最前；最多保留 6 项） */
export function publishAnalysis(input: Omit<TransferredAnalysis, 'createdAt'>): void {
  const next = [{ ...input, createdAt: Date.now() }, ...items.value.filter(x => x.id !== input.id)]
  items.value = next.slice(0, MAX_ITEMS)
}

/** 只读清单（工作台导入下拉用） */
export const transferredAnalyses = readonly(items)
