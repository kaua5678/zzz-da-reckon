#!/usr/bin/env node
/** Deterministic, offline recording workbench. Help is the command interface. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPacket, draftRecording, validateRecording, repositoryReader, mechanismTemplate } from './lib/recording.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [command, arg, stage, ...extra] = process.argv.slice(2)
try {
  if (!command || command === '--help') {
    console.log(`录入工作台（离线，不调用模型，不改计算代码）
  node scripts/record-agent.mjs packet <agentId>       # 稳定 JSON，含原文上下文/JSON pointer/hash
  node scripts/record-agent.mjs init <agentId>         # 创建 data/recordings/<id>.json，拒绝覆盖
  node scripts/record-agent.mjs template               # 一条机制契约模板
  node scripts/record-agent.mjs check <agentId> plan    # 原文覆盖/结构/未决项/预期值闸门
  node scripts/record-agent.mjs check <agentId> complete # 再查 spec/消费者/测试引用
原文更新后先重新 packet，对比旧契约逐条复核，再替换 packet；不自动清空已有分析。
complete 只证明静态追踪，不证明理解正确/测试通过，仍须执行 Vitest + SOP §6.10。`)
  } else if (command === 'template' && !arg) {
    console.log(JSON.stringify(mechanismTemplate, null, 2))
  } else {
    if (extra.length || (command !== 'check' && stage)) throw new Error('多余参数，见 --help')
    const packet = loadPacket(root, arg)
    const file = resolve(root, 'data/recordings', `${arg}.json`)
    if (command === 'packet') console.log(JSON.stringify(packet, null, 2))
    else if (command === 'init') {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(draftRecording(packet), null, 2) + '\n', { flag: 'wx' })
      console.log(`created data/recordings/${arg}.json；每段 pending，下一步填 decisions/mechanics，见 template 与 SOP §0.5`)
    } else if (command === 'check') {
      if (!['plan', 'complete'].includes(stage)) throw new Error('check 需要 plan 或 complete')
      const doc = JSON.parse(readFileSync(file, 'utf8'))
      const errors = validateRecording(doc, packet, { stage, readText: repositoryReader(root) })
      if (errors.length) throw new Error(errors.join('\n'))
      console.log(`${arg}: ${stage} PASS · ${packet.units.length} 原文条目 · ${doc.mechanics.length} 机制（静态追踪，非语义验收）`)
    } else throw new Error('未知命令，见 --help')
  }
} catch (e) { console.error(e.message); process.exitCode = 1 }
