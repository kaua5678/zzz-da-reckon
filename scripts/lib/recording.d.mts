export declare const RECORDING_VERSION: number
export declare function fingerprint(value: unknown): string
export declare function cleanRecordingText(text: unknown, nouns: Record<string, { name?: string }>): string
export declare interface Unit { id: string; pointer: string; title: string; category: string; quote: string; context: string }
export declare interface Packet { version: number; agentId: string; source: unknown; passiveLevel: number; hashes: Record<string, string>; moves: unknown[]; units: Unit[] }
export declare interface Mechanism {
  id: string; sources: string[]; dimension: string; certainty: string;
  trigger: string; target: string; gate: string; formula: string; field: string; countSource: string; duration: string; cap: string;
  assumptions: { premise: string; falsifier: string }[]; decisionEvidence: string;
  implementation: { spec: string; consumer: string };
  cases: { kind: string; input: string; expected: string; test: { file: string; title: string } }[];
}
export declare interface Recording { version: number; packet: Packet; decisions: { sourceId: string; status: string; reason: string; mechanics: string[] }[]; mechanics: Mechanism[] }
export declare function makePacket(raw: unknown, nouns: unknown, moves: unknown[], source: unknown, level?: number): Packet
export declare function loadPacket(root: string, agentId: string, level?: number): Packet
export declare function draftRecording(packet: Packet): Recording
export declare const mechanismTemplate: Mechanism
export declare function validateRecording(doc: unknown, packet: Packet, options?: { stage?: string; readText?: (file: string) => string }): string[]
export declare function repositoryReader(root: string): (file: string) => string
