#!/usr/bin/env python3
"""跨文件同形**代码块**普查（行窗口级，r582 arena-F）。

补 `census-dup-fn-bodies.py` 的盲区：它只比整函数体，嵌在对象字面量 / 回调里的同形片段（如 r581 三处
`perTargetAmounts` 包装）看不到。本脚本把每行归一化（字符串→S、数字→0、非关键字标识符→_、去空白），
取连续 WIN 行的窗口做键，跨 ≥ minFiles 个文件相同的窗口合并成最长连续段后输出。

用法：python3 scripts/census-dup-blocks.py [minFiles=3] [WIN=6] [subdirs...]
环境：EXACT=1 不做任何归一（字符串/数字/标识符原样，只去空白）；INCLUDE_TESTS=1 把 __tests__ 也算进去。
只报结果，不裁决——每组仍要人读源：常数/口径不同的同形块是「有意不同」，不收。
"""
import os, re, sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', 'src'))
MIN_FILES = int(sys.argv[1]) if len(sys.argv) > 1 else 3
WIN = int(sys.argv[2]) if len(sys.argv) > 2 else 6
SUBDIRS = sys.argv[3:]
EXACT = os.environ.get('EXACT') == '1'
INCLUDE_TESTS = os.environ.get('INCLUDE_TESTS') == '1'

KW = set('''abstract any as async await boolean break case catch class const constructor continue debugger declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface is keyof let module namespace never new null number of package private protected public readonly return require set static string super switch symbol this throw true try type typeof undefined unique unknown var void while with yield Record Partial Readonly Math Number String Object Array Map Set Promise JSON console length push map filter reduce some every find indexOf includes slice splice sort join keys values entries max min floor ceil round abs isFinite isNaN'''.split())

def norm(line):
    s = line.strip()
    if not s or s.startswith('//') or s.startswith('*') or s.startswith('/*'):
        return None
    if not EXACT:
        s = re.sub(r"'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"|`(?:\\.|[^`\\])*`", 'S', s)
        s = re.sub(r'\b\d+(?:\.\d+)?\b', '0', s)
        s = re.sub(r'\b[A-Za-z_$][\w$]*\b', lambda m: m.group(0) if m.group(0) in KW else '_', s)
    s = re.sub(r'\s+', '', s)
    # 声明性行不参与：import / declare module / interface / 字段声明 / 常量字面量声明 —— 这些同形是类型系统或 D2 约定使然
    if re.match(r'^(import|export\{|declaremodule|export?interface|interface|exporttype|type_=)', s):
        return None
    if re.match(r'^(readonly)?_\??:[^=()]*,?$', s):
        return None
    if re.match(r'^(export)?(const|let)_(:[^=]*)?=(0|S|_|true|false|\[\]|\{\})[;,]?$', s):
        return None
    if s in ('}', '},', '})', '});', ')', '],', ']', '{', '>', '/>', 'return', 'else{', '}else{', ');', ')),'):
        return None  # 结构行不参与：只靠它们撑出来的窗口没有意义
    return s

def files():
    for d, _, fs in os.walk(ROOT):
        rel = os.path.relpath(d, ROOT)
        if SUBDIRS and not any(rel == sd or rel.startswith(sd + os.sep) for sd in SUBDIRS):
            continue
        if not INCLUDE_TESTS and ('__tests__' in rel.split(os.sep) or rel.startswith('test')):
            continue
        for f in fs:
            if f.endswith('.ts') and not f.endswith('.d.ts') and not f.endswith('.test.ts'):
                yield os.path.join(d, f)

# file -> list of (lineno, normalized)
rows = {}
for p in files():
    try:
        src = open(p, encoding='utf-8').read()
    except Exception:
        continue
    out = []
    for i, line in enumerate(src.split('\n'), 1):
        n = norm(line)
        if n is not None:
            out.append((i, n))
    rows[p] = out

win_hits = defaultdict(list)  # key -> [(file, idx)]
for p, lst in rows.items():
    for k in range(len(lst) - WIN + 1):
        key = '\n'.join(n for _, n in lst[k:k + WIN])
        if len(key) < 12 * WIN:
            continue
        win_hits[key].append((p, k))

cands = {k: v for k, v in win_hits.items() if len({f for f, _ in v}) >= MIN_FILES}

# 合并：以「文件组 + 起始位移差」把相邻窗口串成最长段
# 简化：对每个候选窗口按 (file, idx) 标记，之后从每个文件的最小 idx 起扩展
marked = defaultdict(set)
for k, v in cands.items():
    for f, i in v:
        marked[f].add(i)

groups = defaultdict(set)  # 段键（首窗口 key）-> {(file, start, end)}
seen = set()
for k, v in cands.items():
    for f, i in v:
        if (f, i) in seen:
            continue
        # 向前找段起点
        s = i
        while s - 1 in marked[f]:
            s -= 1
        e = i
        while e + 1 in marked[f]:
            e += 1
        for j in range(s, e + 1):
            seen.add((f, j))
        start_key = '\n'.join(n for _, n in rows[f][s:s + WIN])
        groups[start_key].add((f, rows[f][s][0], rows[f][e + WIN - 1][0]))

res = []
for key, members in groups.items():
    fs = {f for f, _, _ in members}
    if len(fs) < MIN_FILES:
        continue
    span = max(e - s + 1 for _, s, e in members)
    res.append((span, len(fs), sorted(members)))
res.sort(key=lambda t: (-t[0], -t[1]))
mode = 'EXACT' if EXACT else 'SHAPE'
print(f'{mode} scanned {len(rows)} files; WIN={WIN}; groups(>= {MIN_FILES} files): {len(res)}')
for span, nf, members in res:
    print(f'\n== ~{span} 行 × {nf} 文件')
    for f, s, e in members:
        print(f'  {os.path.relpath(f, ROOT)}:{s}-{e}')
