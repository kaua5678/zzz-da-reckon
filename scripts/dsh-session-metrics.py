#!/usr/bin/env python3
"""dsh（DeepSeek Harness）会话度量适配器：把 ~/.dsh/sessions 的多帧 zstd JSONL
解析成与 scripts/session-metrics.mjs（ZCode db.sqlite）同口径的指标。

为什么单独一个适配器：用户在 dsh 和 ZCode 两个 CLI 里都积累了大量本项目对话
（dsh 127 个会话 / 08-15 起，ZCode 46 个 / 08-16 起）。before 基线必须合并两源
才完整——只在 ZCode 里测「提升」会漏掉一半的工作流历史。

格式要点（逆向自 session-*.zstd）：
  - 每行一个 JSON 事件，整个文件是 zstd 多帧流（必须用 stream_reader，不能用
    decompress() —— 它只解第一帧，会得到「只有 1 行」的假象）
  - tool/call:  data.callId / data.name / data.arguments（JSON 字符串）
  - tool/result: data.message.content[].isError（edit/bash 失败判定）
  - request/header: data.header.config.model（模型分层）
  - bash 的 exit code 不在 result 里（只能按 isError 计，口径见下）

口径对齐说明（与 ZCode 侧差异，对比时要记住）：
  - Edit 失败：两侧同义（old_string 不匹配 / 文件没读 / 文件已变），ZCode 按
    status!='completed'，dsh 按 isError —— 都数「agent 的文件心智模型错」
  - Bash 失败：ZCode 有 exit_code!=0；dsh 只有 isError 布尔（粗一档），绝对值
    不可跨源比，趋势同源比
  - 动词扫描：两侧一致（Bash 命令文本 substring 匹配）

用法：
  python3 scripts/dsh-session-metrics.py                # 全量（zzz-calculator 项目）
  python3 scripts/dsh-session-metrics.py --since 2026-08-30
  python3 scripts/dsh-session-metrics.py --model deepseek-v4-flash
"""
import argparse
import glob
import json
import os
import sys
from datetime import datetime, timezone

try:
    import zstandard
except ImportError:
    print("⚠ 缺 python3-zstandard（pip install zstandard），无法读 dsh 会话", file=sys.stderr)
    sys.exit(0)

DSH_SESSIONS = os.path.expanduser('~/.dsh/sessions')
PROJECT_DIR_NAME = '--home-kaua-projects-zzz-calculator--'
VERBS = ['resolve.mjs', 'probe:panel', 'npm run verify', 'npm run check', 'docs:status', 'grep']

ap = argparse.ArgumentParser()
ap.add_argument('--since', default=None)
ap.add_argument('--model', default=None)
args = ap.parse_args()

files = sorted(glob.glob(os.path.join(DSH_SESSIONS, PROJECT_DIR_NAME, '*', 'session.jsonl.zstd')), key=os.path.getmtime)
if not files:
    print(f"⚠ 无 dsh 会话（{DSH_SESSIONS}/{PROJECT_DIR_NAME}）")
    sys.exit(0)

dctx = zstandard.ZstdDecompressor()
day = {}          # date -> {s, e, ef, b, bf}
verb_day = {}     # verb -> date -> count
verb_sess = {}    # verb -> set(session)
edit_sess = set()
verify_sess = set()
check_sess = set()
model_by_sess = {}
err_kinds = {}    # edit 失败分类

def dayof(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime('%Y-%m-%d')

for f in files:
    sid = os.path.basename(os.path.dirname(f))
    try:
        raw = dctx.stream_reader(open(f, 'rb')).read().decode('utf-8')
    except Exception as e:
        print(f"⚠ 跳过 {sid}: {e}", file=sys.stderr)
        continue
    calls = {}       # callId -> (name, args_dict)
    results = {}     # callId -> result data
    created_ms = None
    model = None
    for ln in raw.splitlines():
        try:
            d = json.loads(ln)
        except Exception:
            continue
        t = d.get('type')
        if t == 'session':
            created_ms = d.get('createdAt')
        elif t == 'request/header':
            model = d.get('data', {}).get('header', {}).get('config', {}).get('model')
        elif t == 'tool/call':
            dd = d['data']
            try:
                a = json.loads(dd.get('arguments') or '{}')
            except Exception:
                a = {}
            calls[dd.get('callId')] = (dd.get('name'), a)
        elif t == 'tool/result':
            dd = d['data']
            cid = dd.get('message', {}).get('source', {}).get('callId')
            if cid:
                results[cid] = dd
    if created_ms is None:
        created_ms = int(os.path.getmtime(f) * 1000)
    if model:
        model_by_sess[sid] = model
    d = dayof(created_ms)
    if args.since and d < args.since:
        continue
    if args.model and model != args.model:
        continue
    v = day.setdefault(d, {'s': 0, 'e': 0, 'ef': 0, 'b': 0, 'bf': 0})
    v['s'] += 1
    for cid, (name, a) in calls.items():
        r = results.get(cid)
        is_err = False
        err_code = None
        if r:
            for c in r.get('message', {}).get('content', []):
                if isinstance(c, dict) and c.get('isError'):
                    is_err = True
            err_code = r.get('error', {}).get('code')
        if name == 'edit':
            v['e'] += 1
            edit_sess.add(sid)
            if is_err:
                v['ef'] += 1
                # code 语义（dsh 源码 FsError）：NOT_FOUND=old_string 不在文件里（agent 心智模型错）；
                # STALE_VERSION=编辑时文件与上次读不一致（常为并行会话/外部改动）；
                # NOT_OBSERVED=没读过就想写；AMBIGUOUS_EDIT=多处匹配。
                k = {
                    'FS_EDIT_NOT_FOUND': 'old_string 不匹配（心智模型错）',
                    'FS_STALE_VERSION': '读后文件已变（并发/外部改动）',
                    'FS_NOT_OBSERVED': '没先 Read（流程错）',
                    'FS_AMBIGUOUS_EDIT': '多处匹配需更精确',
                }.get(err_code, f'其他({err_code})')
                err_kinds[k] = err_kinds.get(k, 0) + 1
        elif name == 'bash':
            v['b'] += 1
            if is_err:
                v['bf'] += 1
            cmd = a.get('command', '')
            if isinstance(cmd, str) and cmd:
                dd_ = dayof(created_ms)
                for verb in VERBS:
                    needle = 'grep' if verb == 'grep' else verb
                    if needle in cmd:
                        verb_day.setdefault(verb, {}).setdefault(dd_, 0)
                        verb_day[verb][dd_] += 1
                        verb_sess.setdefault(verb, set()).add(sid)
                        if verb == 'npm run verify':
                            verify_sess.add(sid)
                        elif verb == 'npm run check':
                            check_sess.add(sid)

tot = {'s': 0, 'e': 0, 'ef': 0, 'b': 0, 'bf': 0}
print("date        sess  Edit(ok/fail)  Bash(ok/fail)")
for d in sorted(day):
    v = day[d]
    print(f"{d}  {v['s']:>4}  {v['e']-v['ef']}/{v['ef']}        {v['b']-v['bf']}/{v['bf']}")
    for k in tot:
        tot[k] += v[k]
print(f"TOTAL      {tot['s']:>4}  {tot['e']-tot['ef']}/{tot['ef']}        {tot['b']-tot['bf']}/{tot['bf']}")
if tot['e']:
    line = f"Edit 失败率 {100*tot['ef']/tot['e']:.1f}%"
    if tot['b']:
        line += f" | Bash 失败率 {100*tot['bf']/tot['b']:.1f}%"
    print(line)
if err_kinds:
    print("Edit 失败分类:", dict(sorted(err_kinds.items(), key=lambda x: -x[1])))

print("\n动词采用（按天）：")
for verb in VERBS:
    if verb in verb_day:
        days = ' '.join(f"{d}={c}" for d, c in sorted(verb_day[verb].items()))
        print(f"  {verb}（{len(verb_sess[verb])} 会话）: {days}")

if edit_sess:
    covered = len(edit_sess & (verify_sess | check_sess))
    print(f"\nverify 执行率：有 Edit 的 {len(edit_sess)} 会话中 {covered} 跑过 verify/check = {100*covered/len(edit_sess):.0f}%")

models = {}
for sid, m in model_by_sess.items():
    models[m] = models.get(m, 0) + 1
if models:
    print("\n模型分布:", dict(sorted(models.items(), key=lambda x: -x[1])))
