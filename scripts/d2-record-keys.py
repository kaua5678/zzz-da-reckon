#!/usr/bin/env python3
"""D2 §5 助手：列出某角色模块里经 `X as unknown as Record<string, unknown>` 读写的键，并标出哪些在 CharacterOperationConfig 上**未声明**
（声明 = 公共接口 types/resource/config.ts 或任一模块的 `declare module '@/types/resource/config'` 扩充块；扩充是全局的）。
用法: python3 scripts/d2-record-keys.py <repo> <模块名> [<声明骨架输出文件>]   例: python3 scripts/d2-record-keys.py . banyue /tmp/decl.txt
（r394 起也统计 `as Record<string, unknown>` 与 `as any`，并输出未声明键的声明骨架）"""
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
# r394 CC-366：三种绕类型写法同病，一并统计：as unknown as Record<string, unknown> / as Record<string, unknown> / as any
CAST = r'as (?:unknown as )?(?:Record<string,\s*unknown>|any\b)'
SRC = r'([\w.?\[\]]+)'
CFGISH = re.compile(r'(^|\.)cfg$|Cfg$|config$')
vars_ = collections.OrderedDict()
for m in re.finditer(r'const (\w+)\s*=\s*' + SRC + r'\s+' + CAST, t):
    vars_.setdefault(m.group(1), set()).add(m.group(2))
inline = re.findall(r'\(' + SRC + r'\s+' + CAST + r'\)\.(\w+)', t)
print(f'== {mod}.ts：{len(re.findall(CAST, t))} 处强转（含非 cfg 对象）')
undeclared = collections.OrderedDict()
def guess(k):
    """按用法猜类型（只是骨架，tsc 会纠正）：Number(…k …) / k ?? 数字 ⇒ number；=== true/false ⇒ boolean；?? {} ⇒ Record<string, number>"""
    if re.search(r'\.' + k + r'\s*\?\?\s*\{\}', t): return 'Record<string, number>'
    if re.search(r'\.' + k + r'\s*===?\s*(true|false)', t): return 'boolean'
    return 'number'
for v, srcs in vars_.items():
    keys = collections.Counter(re.findall(r'\b' + v + r'\.(\w+)', t))
    dyn = len(re.findall(r'\b' + v + r'\[', t))
    print(f'-- 变量 `{v}` ← {", ".join(sorted(srcs))}' + (f'（另有 {dyn} 处动态键 {v}[...]：通用逻辑，保留/记理由）' if dyn else ''))
    looks_cfg = any(CFGISH.search(s) for s in srcs)
    for k, n in sorted(keys.items()):
        tag = ('已声明' if k in declared else '**未声明**') if looks_cfg else '（非 cfg 来源，查对应接口）'
        if looks_cfg and k not in declared: undeclared[k] = 1
        print(f'   {k} ×{n}  {tag}')
for s, k in inline:
    cfgish = CFGISH.search(s)
    if cfgish and k not in declared: undeclared[k] = 1
    print(f'-- 内联 ({s} as …).{k}  ' + (('已声明' if k in declared else '**未声明**') if cfgish else '（非 cfg 来源，查对应接口）'))
if undeclared:
    sk = ''.join(f'    /** TODO 写清含义与写入方 */\n    {k}?: {guess(k)}\n' for k in undeclared)
    print('-- 声明骨架（可直接作 d2-record-apply.py 的 <声明文件>；类型是按用法猜的，跑 tsc 纠正、补注释）：\n' + sk, end='')
    if len(sys.argv) > 3:
        open(sys.argv[3], 'w', encoding='utf-8', newline='\n').write(sk.rstrip('\n') + '\n')
        print(f'-- 已写入 {sys.argv[3]}')
