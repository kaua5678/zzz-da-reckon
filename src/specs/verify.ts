import { emptyPanel } from '@/core/panel'
import { applySpecAttributeConversions } from './runtime'
import type { AgentMechanicSpec, VerificationSpec } from './types'

export interface SpecVerificationResult {
  specId: string
  verificationId: string
  name: string
  pass: boolean
  actual: Record<string, number>
  expected: Record<string, number>
  tolerance: number
}

/** 可执行校验：带 panel+expected 的 verified 记录；纯文档型确认（仅 claim/verified）跳过 */
export type ExecutableVerification = VerificationSpec & {
  panel: Record<string, number>
  expected: Record<string, number>
}

export function isExecutableVerification(verification: VerificationSpec): verification is ExecutableVerification {
  return !!verification.panel && !!verification.expected
}

export function runSpecVerification(
  spec: AgentMechanicSpec,
  verification: ExecutableVerification,
): SpecVerificationResult {
  const panel = emptyPanel()
  for (const [stat, value] of Object.entries(verification.panel)) {
    panel[stat] = value
  }

  applySpecAttributeConversions(panel, spec.attributeConversions)

  const tolerance = verification.tolerance ?? 1e-6
  const actual: Record<string, number> = {}
  let pass = true

  for (const [stat, expected] of Object.entries(verification.expected)) {
    const value = panel[stat] ?? 0
    actual[stat] = value
    if (Math.abs(value - expected) > tolerance) {
      pass = false
    }
  }

  return {
    specId: spec.id,
    verificationId: verification.id,
    name: verification.name,
    pass,
    actual,
    expected: verification.expected,
    tolerance,
  }
}

export function runSpecVerifications(spec: AgentMechanicSpec): SpecVerificationResult[] {
  return spec.verifications
    .filter(isExecutableVerification)
    .map(verification => runSpecVerification(spec, verification))
}

export function verifyAllSpecs(specs: AgentMechanicSpec[]): SpecVerificationResult[] {
  return specs.flatMap(runSpecVerifications)
}
