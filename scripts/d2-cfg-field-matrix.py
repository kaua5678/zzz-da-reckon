#!/usr/bin/env python3
"""D2 阶段 A：CharacterOperationConfig 字段拓扑矩阵。用法: python3 d2matrix.py <repo> [--md out.md]"""
import os, re, sys, collections
repo = sys.argv[1]
src = os.path.join(repo, 'src')
T = os.path.join(src, 'types/resource/config.ts')
lines = open(T, encoding='utf-8').read().split('\n')
st = next(i for i, l in enumerate(lines) if l.startswith('export interface CharacterOperationConfig'))
en = next(i for i in range(st, len(lines)) if lines[i] == '}')
fields = []
for l in lines[st + 1:en]:
    m = re.match(r'^  (\w+)(\?)?:', l)
    if m: fields.append((m.group(1), bool(m.group(2))))
def nocomment(t):
    """剥注释再找引用（r389：convergence.ts 等处注释里的沿革说明不算引用）"""
    t = re.sub(r'/\*[\s\S]*?\*/', '', t)
    return re.sub(r'(?<![:\'"\w])//[^\n]*', '', t)
files = {}
for root, ds, fs in os.walk(src):
    if '__tests__' in root or '/test' in root.replace(src, ''): continue
    for f in fs:
        if f.endswith(('.ts', '.vue')) and not f.endswith('.d.ts'):
            p = os.path.join(root, f)
            if p == T: continue
            files[os.path.relpath(p, src)] = nocomment(open(p, encoding='utf-8').read())
def kind(rel):
    if rel.startswith('mechanics/agents/'): return 'agent'
    if rel.startswith('mechanics/'): return 'mech'
    if rel.startswith(('core/', 'composables/resourceCalc/')): return 'core'
    return 'other'
rows = []
for name, opt in fields:
    rx = re.compile(r'\b' + name + r'\b(?!\?:)')  # r390：`name?:` 可选声明行（别的接口里的同名字段）不算引用
    hit = collections.defaultdict(list)
    for rel, txt in files.items():
        if rx.search(txt): hit[kind(rel)].append(rel)
    ag = sorted(os.path.basename(x)[:-3] for x in hit['agent'])
    if not hit['core'] and not hit['mech'] and not hit['other']:
        cat = 'dead' if not ag else ('private' if len(ag) == 1 else 'agents-shared')
    else:
        cat = 'engine'
    rows.append((name, opt, cat, ag, sorted(hit['core'] + hit['mech'] + hit['other'])))
cnt = collections.Counter(r[2] for r in rows)
out = [f'# CharacterOperationConfig 字段拓扑（{len(rows)} 字段）', '',
       '分类：private = 只有 1 个角色模块引用（可迁模块私有）；agents-shared = 只在多个角色模块间；engine = 引擎/机制公共层/视图也引用；dead = 声明后无人引用。', '',
       '| 分类 | 字段数 |', '|---|---|'] + [f'| {k} | {v} |' for k, v in cnt.most_common()] + ['']
per = collections.Counter(r[3][0] for r in rows if r[2] == 'private')
out += ['## private 字段按模块', '', '| 模块 | 私有字段数 |', '|---|---|'] + [f'| {k} | {v} |' for k, v in per.most_common()] + ['']
out += ['## 全表', '', '| 字段 | 可选 | 分类 | 角色模块 | 其他引用 |', '|---|---|---|---|---|']
for n, o, c, ag, other in rows:
    out.append(f"| `{n}` | {'?' if o else ''} | {c} | {', '.join(ag)} | {', '.join(other[:4])}{' …+%d' % (len(other)-4) if len(other) > 4 else ''} |")
md = '\n'.join(out) + '\n'
if '--md' in sys.argv: open(sys.argv[sys.argv.index('--md') + 1], 'w', encoding='utf-8', newline='\n').write(md)
print('\n'.join(out[:40]))
