#!/usr/bin/env python3
"""D2 类型层迁移（CC-359 / CC-360）：把公共接口里「只有 1 个角色模块引用」的成员声明（连同紧贴的 doc 注释）
迁到该模块文件末尾的 `declare module '<spec>' { interface <I> { ... } }` 扩充块。只动类型 ⇒ 产物 JS 逐字节不变。
引用口径：剥注释；`name?:` 形式的可选声明行（别的接口里的同名字段）不算引用；声明文件里接口体之外的引用算。
用法: python3 scripts/d2-migrate-private-cfg.py <repo> [--target cfg|feedback|result|all] [模块名 ...]"""
import os, re, sys, collections
TARGETS = {
    'cfg': ('types/resource/config.ts', 'CharacterOperationConfig', '@/types/resource/config',
            '本模块私有的 cfg 字段——只有本文件读写'),
    'feedback': ('mechanics/types.ts', 'ModuleFeedback', '@/mechanics/types',
                 '本模块自产自读的跨轮反馈键（nextRoundFeedback 产出、下一轮本模块读回）'),
    'result': ('types/resource/agentResources.ts', 'CharacterResourceResult', '@/types/resource/agentResources',
               '本模块私有的结果字段——只有本文件读写'),
}
args = sys.argv[1:]; repo = args.pop(0)
which = 'all'
if args[:1] == ['--target']: which = args[1]; args = args[2:]
only = set(args)
src = os.path.join(repo, 'src')

def nocomment(t):
    """剥注释再找引用（r389：convergence.ts 等处注释里的沿革说明不算引用）"""
    t = re.sub(r'/\*[\s\S]*?\*/', '', t)
    return re.sub(r'(?<![:\'"\w])//[^\n]*', '', t)

def interface_span(lines, iface):
    st = next(i for i, l in enumerate(lines) if l.startswith('export interface ' + iface))
    en = next(i for i in range(st, len(lines)) if lines[i] == '}')
    return st, en

def run(key):
    rel, iface, spec, blurb = TARGETS[key]
    T = os.path.join(src, rel)
    lines = open(T, encoding='utf-8').read().split('\n')
    st, en = interface_span(lines, iface)
    decl = {}; i = st + 1
    while i < en:
        m = re.match(r'^  (\w+)\??:', lines[i])
        if m:
            j = i; depth = 0
            while True:
                depth += sum(lines[j].count(c) for c in '{([') - sum(lines[j].count(c) for c in '})]')
                if depth <= 0: break
                j += 1
            s = i
            if lines[s - 1].strip().endswith('*/'):
                k = s - 1
                while not lines[k].strip().startswith('/**'): k -= 1
                s = k
            decl[m.group(1)] = (s, j); i = j + 1
        else: i += 1
    files = {}
    for root, ds, fs in os.walk(src):
        if '__tests__' in root or '/test' in root.replace(src, ''): continue
        for f in fs:
            if f.endswith(('.ts', '.vue')) and not f.endswith('.d.ts'):
                p = os.path.join(root, f)
                t = '\n'.join(lines[:st] + lines[en + 1:]) if p == T else open(p, encoding='utf-8').read()
                files[os.path.relpath(p, src)] = nocomment(t)
    plan = collections.defaultdict(list)
    for name in decl:
        rx = re.compile(r'\b' + name + r'\b(?!\?:)')
        hits = [r for r, t in files.items() if rx.search(t)]
        if len(hits) == 1 and hits[0].startswith('mechanics/agents/'):
            if not only or os.path.basename(hits[0])[:-3] in only: plan[hits[0]].append(name)
    drop = set()
    head = f"declare module '{spec}' {{\n  interface {iface} {{\n"
    for mod, names in sorted(plan.items()):
        names.sort(key=lambda n: decl[n][0])
        body = []
        for n in names:
            s, e = decl[n]; body += lines[s:e + 1]; drop.update(range(s, e + 1))
        ind = '\n'.join('  ' + l if l else l for l in body)
        p = os.path.join(src, mod); t = open(p, encoding='utf-8').read().rstrip('\n')
        k = t.find(head)
        if k >= 0:  # 已有同一接口的扩充块 ⇒ 并入，不另起第二块
            close = t.find('\n  }\n}', k)
            t = t[:close] + '\n' + ind + t[close:] + '\n'
            tag = ' (merged)'
        else:
            t += (f"\n\n/**\n * D2（CC-359/360）：{blurb}，声明随模块走，不堆在 `{rel}`。\n"
                  f" * 仍是 `{iface}` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。\n */\n"
                  + head + ind + "\n  }\n}\n")
            tag = ''
        open(p, 'w', encoding='utf-8', newline='\n').write(t)
        print(f'[{key}] {mod}: {len(names)}{tag}')
    open(T, 'w', encoding='utf-8', newline='\n').write('\n'.join(l for k, l in enumerate(lines) if k not in drop))
    print(f'[{key}] moved', sum(len(v) for v in plan.values()), 'members /', len(drop), 'lines')

for key in (TARGETS if which == 'all' else [which]):
    run(key)
