import json, glob, os, re, collections
HERE = os.path.dirname(os.path.abspath(__file__))
PULSE = {}
for n in ['healthy','learning','shared-budget','cold-start','stop-loss']:
    e = json.load(open(os.path.join(HERE, '..', 'examples', f'{n}.json')))
    PULSE[n] = {x['campaign_id']: x['to'] for k in ('scale','shift','hold','watching') for x in e[k]}
res = collections.defaultdict(lambda: collections.defaultdict(list)); bad = collections.Counter()
for f in sorted(glob.glob(os.path.join(HERE, 'raw', '*.json'))):
    d = json.load(open(f)); t = d['text'].strip()
    t = re.sub(r'^```(?:json)?\s*|\s*```$', '', t)
    try: arr = json.loads(t[t.find('['):t.rfind(']')+1])
    except Exception: bad[d['fixture']] += 1; continue
    for x in arr: res[d['fixture']][x['campaign_id']].append(float(x['recommended_daily_budget']))
out = {}
for n in PULSE:
    print(f'== {n}  (PULSE: {PULSE[n]})  unparsed={bad[n]}')
    o = {}
    for cid in sorted(res[n]):
        v = res[n][cid]; ch = [abs(x-100)/100 for x in v]
        o[cid] = dict(runs=len(v), values=sorted(v), min=min(v), max=max(v), distinct=len(set(v)),
                      moved=sum(1 for x in v if x != 100), over20=sum(1 for c in ch if c > 0.2001), pulse=PULSE[n][cid])
        print(f'  {cid}: PULSE {PULSE[n][cid]:g} | Claude {sorted(v)}  distinct={len(set(v))} moved={o[cid]["moved"]}/{len(v)} >20%={o[cid]["over20"]}')
    tot = [sum(res[n][c][i] for c in res[n]) for i in range(min(len(res[n][c]) for c in res[n]))]
    o['_total'] = dict(values=tot, over200=sum(1 for t in tot if t > 200.001))
    print(f'  total budget per run: {tot}  (>200: {o["_total"]["over200"]})')
    out[n] = o
json.dump(out, open(os.path.join(HERE, 'results.json'),'w'), indent=1)
