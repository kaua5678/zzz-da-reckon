#!/usr/bin/env python3
"""D2 §5 助手：列出某角色模块里经 `X as unknown as Record<string, unknown>` 读写的键，并标出哪些在 CharacterOperationConfig 上**未声明**
（声明 = 公共接口 types/resource/config.ts 或任一模块的 `declare module '@/types/resource/config'` 扩充块；扩充是全局的）。
用法: python3 scripts/d2-record-keys.py <repo> <模块名>   例: python3 scripts/d2-record-keys.py . banyue"""
import os, re, sys, collections
repo, mod = sys.argv[1], sys.argv[2]
src = os.path.join(repo, 'src')
declared = set()
pub = open(os.path.join(src, 'types/resource/config.ts'), encoding='utf-8').read().split('\n')
st = next(i for i, l in enumerate(pub) if l.startswith('export interface CharacterOperationConfig'))
en = next(i for i in range(st, len(pub)) if pub[i] == '}')
declared |= {m.group(1) for l in pub[st+1:en] for m in [re.match(r'^  (\w+)\??:', l)] if m}
AUG = re.compile(r"declare module '@/types/resource/config' \{\n  interface CharacterOperationConfig \{\n(.*?)\n  \}\n\}", re.S)
for root, ds, fs in os.walk(os.path.join(src, 'mechanics')):
    for f in fs:
        if f.endswith('.ts'):
            for b in AUG.findall(open(os.path.join(root, f), encoding='utf-8').read()):
                declared |= {m.group(1) for m in re.finditer(r'^    (\w+)\??:', b, re.M)}
p = os.path.join(src, 'mechanics/agents', mod + '.ts')
t = open(p, encoding='utf-8').read()
CAST = 'as unknown as Record<string, unknown>'
vars_ = collections.OrderedDict()
for m in re.finditer(r'const (\w+)\s*=\s*([\w.?\[\]]+)\s+' + re.escape(CAST), t):
    vars_.setdefault(m.group(1), set()).add(m.group(2))
inline = re.findall(r'\(([\w.?\[\]]+)\s+' + re.escape(CAST) + r'\)\.(\w+)', t)
print(f'== {mod}.ts：{t.count(CAST)} 处强转')
for v, srcs in vars_.items():
    keys = collections.Counter(re.findall(r'\b' + v + r'\.(\w+)', t))
    dyn = len(re.findall(r'\b' + v + r'\[', t))
    print(f'-- 变量 `{v}` ← {", ".join(sorted(srcs))}' + (f'（另有 {dyn} 处动态键 {v}[...]：通用逻辑，保留/记理由）' if dyn else ''))
    looks_cfg = any(re.search(r'(^|\.)cfg$|Cfg$|config$', s) for s in srcs)
    for k, n in sorted(keys.items()):
        tag = ('已声明' if k in declared else '**未声明**') if looks_cfg else '（非 cfg 来源，查对应接口）'
        print(f'   {k} ×{n}  {tag}')
for s, k in inline:
    cfgish = re.search(r'(^|\.)cfg$|Cfg$|config$', s)
    print(f'-- 内联 ({s} as …).{k}  ' + (('已声明' if k in declared else '**未声明**') if cfgish else '（非 cfg 来源，查对应接口）'))
