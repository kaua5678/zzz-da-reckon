#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fetch missing nanoka characters (skills + stats) into data/raw/nanoka_missing/."""
import json
import os
import sys

sys.path.insert(0, r'F:\trae_output\nanoka_scraper')
from nanoka_scraper import scrape_character
from nanoka_stats_scraper import get_character_data, extract_base_stats

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, 'public', 'static', 'catalog.json')
OUT = os.path.join(ROOT, 'data', 'raw', 'nanoka_missing')

with open(CATALOG, encoding='utf-8') as f:
    catalog = json.load(f)
existing = {a['id'] for a in catalog['agents']}

CHAR_LIST_URL = 'https://static.nanoka.cc/zzz/3.2.1+17934514/character.json'
import urllib.request
req = urllib.request.Request(CHAR_LIST_URL, headers={'User-Agent': 'Mozilla/5.0'})
chars = json.loads(urllib.request.urlopen(req, timeout=30).read().decode('utf-8'))

missing = [cid for cid in sorted(chars) if cid not in existing]
print('missing', len(missing), missing)

os.makedirs(OUT, exist_ok=True)
ok, fail = [], []
for cid in missing:
    try:
        skills = scrape_character(cid, 12)
        stats = extract_base_stats(get_character_data(cid))
        with open(os.path.join(OUT, f'{cid}_skills.json'), 'w', encoding='utf-8') as f:
            json.dump(skills, f, ensure_ascii=False, indent=2)
        with open(os.path.join(OUT, f'{cid}_stats.json'), 'w', encoding='utf-8') as f:
            json.dump(stats, f, ensure_ascii=False, indent=2)
        with open(os.path.join(OUT, 'list.json'), 'w', encoding='utf-8') as f:
            json.dump({cid: chars[cid] for cid in missing}, f, ensure_ascii=False, indent=2)
        ok.append(cid)
        print('OK', cid, skills['name_en'])
    except Exception as e:
        fail.append((cid, f'{type(e).__name__}: {e}'))
        print('FAIL', cid, e)

print('done ok', len(ok), 'fail', len(fail))
for cid, err in fail:
    print('  ', cid, err)
