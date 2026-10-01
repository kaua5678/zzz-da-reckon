#!/usr/bin/env python3
"""D2（CC-360）：`types/resource/agentResources.ts` 里「只被 1 个角色模块引用」的整份 interface 迁到该模块末尾（export 保留，供测试 import）。
用法: python3 scripts/d2-migrate-agent-types.py <repo>"""
import os, re, sys
repo = sys.argv[1]; src = os.path.join(repo, 'src')
T = os.path.join(src, 'types/resource/agentResources.ts')
lines = open(T, encoding='utf-8').read().split('\n')
blocks = {}
for i, l in enumerate(lines):
    m = re.match(r'^export interface (\w+)', l)
    if not m: continue
    en = next(j for j in range(i, len(lines)) if lines[j] == '}')
    s = i
    if lines[s - 1].strip().endswith('*/'):
        k = s - 1
        while not lines[k].strip().startswith('/**'): k -= 1
        s = k
    blocks[m.group(1)] = (s, en)
files = {}
for root, ds, fs in os.walk(src):
    if '__tests__' in root: continue
    for f in fs:
        if f.endswith(('.ts', '.vue')):
            p = os.path.join(root, f)
            if p != T and not p.endswith('types/resource/index.ts'): files[p] = open(p, encoding='utf-8').read()
drop = set(); moved = {}
for name, (s, e) in blocks.items():
    rx = re.compile(r'\b' + name + r'\b')
    hits = [p for p, t in files.items() if rx.search(t)]
    rest = '\n'.join(l for k, l in enumerate(lines) if not (s <= k <= e))
    if len(hits) == 1 and '/mechanics/agents/' in hits[0] and not rx.search(rest):
        moved.setdefault(hits[0], []).append(name); drop.update(range(s, e + 1))
for p, names in moved.items():
    t = files[p]
    for n in names:
        # 从 import { ... } from '@/types/resource...' 里删掉这个名字
        def strip(m):
            body = m.group(2)
            parts = [x for x in re.split(r',', body)]
            kept = [x for x in parts if x.strip() not in (n, 'type ' + n)]
            new = ','.join(kept)
            return m.group(1) + new + m.group(3)
        t2 = re.sub(r"(import type \{|import \{)([^}]*)(\}\s*from\s*'@/types/resource[^']*')", strip, t)
        t = t2
    t = re.sub(r"import type \{\s*,?\s*\}\s*from\s*'@/types/resource[^']*'\n", '', t)
    names.sort(key=lambda n: blocks[n][0])
    body = []
    for n in names:
        s, e = blocks[n]; body += lines[s:e + 1] + ['']
    t = t.rstrip('\n') + ("\n\n// ===== 本模块私有的结果类型（D2 / CC-360：原在 types/resource/agentResources.ts，只有本文件引用）=====\n\n"
                         + '\n'.join(body).rstrip('\n') + '\n')
    open(p, 'w', encoding='utf-8', newline='\n').write(t)
    print(os.path.relpath(p, src), names)
out = '\n'.join(l for k, l in enumerate(lines) if k not in drop)
out = re.sub(r'\n{3,}', '\n\n', out)
open(T, 'w', encoding='utf-8', newline='\n').write(out)
print('moved', sum(len(v) for v in moved.values()), 'interfaces /', len(drop), 'lines')
