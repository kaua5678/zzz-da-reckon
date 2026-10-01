#!/usr/bin/env python3
"""D2 阶段 B（类型层）：把 CharacterOperationConfig 里「只有 1 个角色模块引用」的字段声明（连同紧贴的 doc 注释）
迁到该模块文件末尾的 `declare module '@/types/resource/config'` 扩充块。只动类型 ⇒ 产物 JS 逐字节不变。
用法: python3 d2migrate.py <repo> [模块名 ...]   （不给模块名 = 全部 private 字段）"""
import os, re, sys, collections
repo = sys.argv[1]; only = set(sys.argv[2:])
src = os.path.join(repo, 'src'); T = os.path.join(src, 'types/resource/config.ts')
text = open(T, encoding='utf-8').read(); lines = text.split('\n')
st = next(i for i, l in enumerate(lines) if l.startswith('export interface CharacterOperationConfig'))
en = next(i for i in range(st, len(lines)) if lines[i] == '}')
# 字段 → (起行, 止行)，含紧贴的 /** */ 注释；多行类型按括号配平
decl = {}
i = st + 1
while i < en:
    m = re.match(r'^  (\w+)\??:', lines[i])
    if m:
        j = i; depth = 0
        while True:
            depth += lines[j].count('{') + lines[j].count('(') + lines[j].count('[') - lines[j].count('}') - lines[j].count(')') - lines[j].count(']')
            if depth <= 0: break
            j += 1
        s = i
        if lines[s - 1].strip().endswith('*/'):
            k = s - 1
            while not lines[k].strip().startswith('/**'): k -= 1
            s = k
        decl[m.group(1)] = (s, j); i = j + 1
    else: i += 1
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
            if p != T: files[os.path.relpath(p, src)] = nocomment(open(p, encoding='utf-8').read())
plan = collections.defaultdict(list)
for name in decl:
    rx = re.compile(r'\b' + name + r'\b')
    hits = [r for r, t in files.items() if rx.search(t)]
    if len(hits) == 1 and hits[0].startswith('mechanics/agents/'):
        mod = hits[0]
        if not only or os.path.basename(mod)[:-3] in only: plan[mod].append(name)
drop = set()
MARK = "declare module '@/types/resource/config' {"
for mod, names in sorted(plan.items()):
    names.sort(key=lambda n: decl[n][0])
    body = []
    for n in names:
        s, e = decl[n]; body += lines[s:e + 1]; drop.update(range(s, e + 1))
    p = os.path.join(src, mod)
    t = open(p, encoding='utf-8').read().rstrip('\n')
    END = "\n  }\n}"
    if MARK in t and t.endswith(END):  # 已有本模块扩充块（在文件末尾）⇒ 并入，不另起第二块
        t = t[:-len(END)] + '\n' + '\n'.join('  ' + l if l else l for l in body) + END + '\n'
        open(p, 'w', encoding='utf-8', newline='\n').write(t)
        print(f'{mod}: {len(names)} (merged)')
        continue
    t += ("\n\n/**\n * D2（CC-359）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不再堆在 `types/resource/config.ts`。\n"
          " * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。\n */\n"
          "declare module '@/types/resource/config' {\n  interface CharacterOperationConfig {\n"
          + '\n'.join('  ' + l if l else l for l in body) + "\n  }\n}\n")
    open(p, 'w', encoding='utf-8', newline='\n').write(t)
    print(f'{mod}: {len(names)}')
open(T, 'w', encoding='utf-8', newline='\n').write('\n'.join(l for k, l in enumerate(lines) if k not in drop))
print('moved', sum(len(v) for v in plan.values()), 'fields /', len(drop), 'lines')
