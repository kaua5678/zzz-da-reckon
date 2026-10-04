#!/usr/bin/env python3
"""只读普查（r573 立、r580 修）：src/**/*.ts|*.vue 中「签名+函数体」完全相同（剥注释、规范化空白、忽略函数名）的函数，按出现文件数分组。
用法: python3 scripts/census-dup-fn-bodies.py [最少文件数=3] [子目录逗号表，如 mechanics,core,composables]
产出: 组列表（文件:行 函数名）。命中 ⇒ 候选「≥N 模块手写同一 helper → 共享 util」（先例 CC-280 finiteClamp、CC-461 finiteOr0）。
已知盲区：只认精确重复；近似重复（改了变量名/多一个分支）不报，需另用 jscpd。r573 版箭头函数会被误解析成下一个函数体，r580 已修。"""
import os, re, sys, hashlib, collections
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src'))
MINF = int(sys.argv[1]) if len(sys.argv) > 1 else 3
SUB = sys.argv[2].split(',') if len(sys.argv) > 2 else None
pat_fn = re.compile(r'(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(<[^>]*>)?\s*\(')
pat_arrow = re.compile(r'(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]{0,80})?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]{0,80})?=>\s*\{')

def strip_comments_keep_lines(src):
    # r580：先把注释替换成等长空白（换行保留），避免注释内的花括号/引号干扰体解析
    out = []; i = 0; n = len(src)
    while i < n:
        c = src[i]
        if c in '\'"`':
            q = c; j = i + 1
            while j < n and src[j] != q:
                if src[j] == '\\': j += 1
                j += 1
            out.append(src[i:j+1]); i = j + 1; continue
        if src.startswith('//', i):
            j = src.find('\n', i); j = n if j < 0 else j
            out.append(' ' * (j - i)); i = j; continue
        if src.startswith('/*', i):
            j = src.find('*/', i); j = n if j < 0 else j + 2
            seg = src[i:j]; out.append(''.join('\n' if ch == '\n' else ' ' for ch in seg)); i = j; continue
        out.append(c); i += 1
    return ''.join(out)

def body_from(src, open_idx):
    depth = 0
    i = open_idx
    n = len(src)
    while i < n:
        c = src[i]
        if c == '{': depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0: return src[open_idx:i+1]
        elif c in '\'"`':
            q = c; i += 1
            while i < n and src[i] != q:
                if src[i] == '\\': i += 1
                i += 1
        elif src.startswith('//', i):
            j = src.find('\n', i); i = n if j < 0 else j
        elif src.startswith('/*', i):
            j = src.find('*/', i); i = n if j < 0 else j + 1
        i += 1
    return None

groups = collections.defaultdict(list)
files = 0
for dp, dn, fn in os.walk(ROOT):
    if '__tests__' in dp or 'node_modules' in dp: continue
    if SUB and not any(os.path.relpath(dp, ROOT).startswith(x) for x in SUB): continue
    for f in fn:
        if not (f.endswith('.ts') or f.endswith('.vue')) or f.endswith('.d.ts') or f.endswith('.test.ts'): continue
        p = os.path.join(dp, f)
        try: src = open(p, encoding='utf-8').read()
        except Exception: continue
        src = strip_comments_keep_lines(src)
        files += 1
        for kind, m in [('fn', x) for x in pat_fn.finditer(src)] + [('arrow', x) for x in pat_arrow.finditer(src)]:
            name = m.group(1)
            # find signature start '(' then the '{' opening the body
            if kind == 'fn':
                k = src.find('(', m.end() - 1)
            else:
                # r580：箭头函数——参数表在 match 内部；`x => {` 无括号单参跳过（r573 版从 m.end() 起找 '(' 会吃到下一个函数）
                k = src.find('(', m.start(), m.end())
                if k < 0: continue
            if k < 0: continue
            # skip params to matching ')'
            d = 0; j = k
            while j < len(src):
                if src[j] == '(': d += 1
                elif src[j] == ')':
                    d -= 1
                    if d == 0: break
                j += 1
            ob = src.find('{', j)
            body = None
            while ob >= 0:
                cand = body_from(src, ob)
                if cand is None: break
                after = src[ob + len(cand):ob + len(cand) + 8].lstrip()
                if after[:1] in ('{', '|', '&') or after.startswith('=>') or after[:1] == '>' :
                    ob = src.find('{', ob + len(cand)); continue
                body = cand; break
            if body is None: continue
            sig = src[k:j+1]
            raw = re.sub(r'/\*.*?\*/', '', sig + body, flags=re.S)
            raw = re.sub(r'//[^\n]*', '', raw)
            norm = re.sub(r'\s+', ' ', raw).strip()
            if len(norm) < 60: continue  # 太短的一行体不算
            h = hashlib.md5(norm.encode()).hexdigest()[:10]
            rel = os.path.relpath(p, ROOT)
            line = src.count('\n', 0, m.start()) + 1
            groups[h].append((rel, line, name, len(norm)))

print('files scanned', files)
out = []
for h, lst in groups.items():
    fset = sorted(set(x[0] for x in lst))
    if len(fset) >= MINF:
        out.append((len(fset), len(lst), lst[0][3], h, lst))
out.sort(key=lambda x: (-x[0], -x[2]))
print('dup groups (>=%d files):' % MINF, len(out))
for nf, nocc, ln, h, lst in out[:40]:
    print(f'\n## {h} files={nf} occ={nocc} len={ln}')
    for rel, line, name, _ in sorted(lst):
        print(f'  {rel}:{line} {name}')
