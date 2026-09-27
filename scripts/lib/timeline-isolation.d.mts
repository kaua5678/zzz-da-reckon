/** scripts/lib/timeline-isolation.mjs 的类型声明（供 vitest/TS 消费，先例：record-key-dead-reads.d.mts） */

export declare const TIMELINE_DIR: string
export declare const TIMELINE_MIN_FILES: number
export declare const TIMELINE_FORBIDDEN_OUT: string[]

export interface TimelineEdge {
  file: string
  spec: string
}

export interface TimelineIsolationReport {
  ok: boolean
  timelineFiles: number
  scanned: number
  inbound: TimelineEdge[]
  outbound: TimelineEdge[]
  hollow: boolean
  selfTest: { ok: boolean; detail: { inbound: TimelineEdge[]; outbound: TimelineEdge[] } }
}

export declare function extractSpecifiers(content: string): string[]
export declare function resolveSpecifier(fromFile: string, spec: string): string
export declare function classifyTimelineEdges(sources: Record<string, string>): { inbound: TimelineEdge[]; outbound: TimelineEdge[] }
export declare function timelineIsolationSelfTest(): { ok: boolean; detail: { inbound: TimelineEdge[]; outbound: TimelineEdge[] } }
export declare function scanTimelineIsolation(root: string): TimelineIsolationReport
export declare function formatTimelineIsolation(report: TimelineIsolationReport): string[]
