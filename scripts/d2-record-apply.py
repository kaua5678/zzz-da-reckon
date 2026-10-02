#!/usr/bin/env python3
"""D2 §5 执行卡第 3 步的机械改写（CC-362）：模块内 `const record = cfg as unknown as Record<string, unknown>` → 直接用 `cfg`。
- 删掉该行；`record.<键>` → `cfg.<键>`；内联 `(cfg as unknown as Record<string, unknown>).<键>` → `cfg.<键>`；
- 把 <声明文件> 的内容（已缩进 4 空格的成员声明，可带 doc 注释）并入本模块 `declare module '@/types/resource/config'` 扩充块（没有就新建）；
- 报告剩余要人工处理的点：`record` 仍被引用（动态键 `record[...]`、作参数传出）、`record: Record<string, unknown>` 形参。
只做「同一对象换个名字访问」的改写 ⇒ 运行时语义不变（`Number(x ?? 0)` 等包装原样保留）；之后跑 vue-tsc + zd。
用法: python3 scripts/d2-record-apply.py <repo> <模块名> [<声明文件>]"""
import os, re, sys
repo, mod = sys.argv[1], sys.argv[2]
decl = open(sys.argv[3], encoding='utf-8').read().rstrip('\n') if len(sys.argv) > 3 else ''
p = os.path.join(repo, 'src/mechanics/agents', mod + '.ts')
s = open(p, encoding='utf-8').read()
CAST = 'as unknown as Record<string, unknown>'
n0 = s.count(CAST)
s, nl = re.subn(r'^[ \t]*const record = cfg ' + re.escape(CAST) + r'\n', '', s, flags=re.M)
s, ni = re.subn(r'\(cfg ' + re.escape(CAST) + r'\)\.', 'cfg.', s)
body, sep, aug = s.partition("\ndeclare module '")
body, nr = re.subn(r'\brecord\.', 'cfg.', body)
s = body + sep + aug
if decl:
    head = "declare module '@/types/resource/config' {\n  interface CharacterOperationConfig {\n"
    k = s.find(head)
    if k >= 0:
        k += len(head); s = s[:k] + decl + '\n' + s[k:]
    else:
        s = s.rstrip('\n') + ("\n\n/**\n * D2（CC-359/362）：本模块私有的 cfg 字段——只有本文件读写，声明随模块走，不堆在 `types/resource/config.ts`。\n"
             " * 仍是 `CharacterOperationConfig` 的成员（模块扩充，纯类型、零运行时）；被第二处引用时请迁回公共接口。\n */\n" + head + decl + "\n  }\n}\n")
open(p, 'w', encoding='utf-8', newline='\n').write(s)
print(f'{mod}: 删 const record {nl} 行 / 内联 {ni} / record.→cfg. {nr} 处；强转 {n0} → {s.count(CAST)}')
left = [(i + 1, l.strip()) for i, l in enumerate(s.split('\n')) if re.search(r'\brecord\b', l) and 'declare module' not in l]
for ln, l in left: print(f'  人工: {ln}: {l[:150]}')
