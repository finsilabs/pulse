"""Freeform Claude vs PULSE (bench/README.md).

Usage: AWS credentials for Bedrock in the environment, then `python3 bench/run.py 10`.
Existing raw/ files are reused; delete them to re-run.
 on PULSE's synthetic fixtures. Bedrock Converse, default sampling, no tools."""
import json, os, sys, time, boto3, concurrent.futures as cf
FIX = os.path.join(os.path.dirname(__file__), '..', 'fixtures', 'accounts')
OUT = os.path.join(os.path.dirname(__file__), 'raw')
MODEL = 'global.anthropic.claude-sonnet-5-5'
RUNS = int(sys.argv[1]) if len(sys.argv) > 1 else 10
NAMES = ['healthy', 'learning', 'shared-budget', 'cold-start', 'stop-loss']
br = boto3.Session(region_name='us-east-1').client('bedrock-runtime')

def prompt(fx):
    # Everything PULSE's core receives, as an API dump; no PULSE rules.
    data = {k: fx[k] for k in ('account', 'platform', 'currency', 'timezone', 'fetched_at', 'start_date', 'end_date')}
    data['campaigns'] = [{k: c[k] for k in ('id', 'name', 'status', 'start_date', 'currency', 'daily_budget', 'budget_kind', 'learning')} | {'daily_metrics': c['metrics']} for c in fx['campaigns']]
    return ("I'm connected to my Meta ad account through the API. Here is what it returned for the last 30 days (today is 2026-10-02).\n\n"
            + json.dumps(data) +
            "\n\nRecommend today's daily budget for each campaign. Reply with JSON only, no prose outside it: "
            '[{"campaign_id": "...", "current_daily_budget": number, "recommended_daily_budget": number, "reason": "..."}]')

def one(name, i):
    path = os.path.join(OUT, f'{name}-{i:02d}.json')
    if os.path.exists(path): return json.load(open(path))
    fx = json.load(open(os.path.join(FIX, f'{name}.json')))
    t = time.time()
    r = br.converse(modelId=MODEL, messages=[{'role': 'user', 'content': [{'text': prompt(fx)}]}], inferenceConfig={'maxTokens': 2000})
    rec = {'fixture': name, 'run': i, 'model': MODEL, 'seconds': round(time.time() - t, 2),
           'usage': r.get('usage'), 'blocks': [list(b.keys())[0] for b in r['output']['message']['content']], 'text': ''.join(b.get('text', '') for b in r['output']['message']['content'])}
    json.dump(rec, open(path, 'w'))
    return rec

jobs = [(n, i) for n in NAMES for i in range(RUNS)]
with cf.ThreadPoolExecutor(5) as ex:
    done = list(ex.map(lambda a: one(*a), jobs))
tin = sum(d['usage']['inputTokens'] for d in done); tout = sum(d['usage']['outputTokens'] for d in done)
print(f'calls={len(done)} input_tokens={tin} output_tokens={tout}')
