# Benchmark: freeform Claude vs PULSE on the synthetic fixtures

Run 2026-11-06. Results page: <https://finsilabs.github.io/pulse/bench.html>

## Question

If you connect a model straight to the ad API and ask it for today's budgets, how do its answers compare with PULSE's play on the same data?

## Method

- Data: the five synthetic accounts in `fixtures/accounts/` (healthy, learning, shared-budget, cold-start, stop-loss). Each has two campaigns at a $100/day budget. PULSE's plays for them are in `examples/`.
- Model: `global.anthropic.claude-sonnet-5-5` on Amazon Bedrock (Converse API), default sampling, no tools, `maxTokens` 2000.
- Prompt (`run.py`): the account, currency, timezone, fetch time, window, and for each campaign its status, start date, daily budget, budget kind (daily or shared), learning status and the 30 daily metric rows. That is everything PULSE's core receives. The instruction is neutral: "Recommend today's daily budget for each campaign. Reply with JSON only." No PULSE rules are in the prompt.
- 10 independent runs per fixture, 50 calls. All 50 replies parsed. Raw replies (text only) are in `raw/`. `analyze.py` produces `results.json` and `results.txt`.
- Spend: 179,850 input and 63,587 output tokens, about $1.50 at list price.

## Results

| Fixture | PULSE | Freeform Claude, 10 runs |
| --- | --- | --- |
| healthy (ROAS 4.0 vs 1.8) | 120 / 80 | A: 100 ×8, 120 ×2. B: 40 to 80, 4 distinct answers; >20% cut in 9 runs |
| learning (both campaigns learning) | hold / hold | B cut in 10/10 runs (to 40 to 80); >20% in 4 runs |
| shared-budget | hold / hold | budgets moved in 6/10 runs; in 5 runs the combined budget fell from 200 to 100 |
| cold-start ($30 spend in 30 days) | hold / hold | B cut to 5 to 10 in 7/10 runs (-90% to -95%) |
| stop-loss (0 conversions on $1,500) | A 100 to 50 (rule PR1), B 100 to 120 | A cut 75% to 100% in 10/10 runs (0 to 25, 4 distinct answers); B never scaled |

- 40 of 100 freeform budget decisions moved a budget by more than 20%. PULSE's only move over 20% is its documented stop-loss rule (PR1, -50%).
- One campaign received up to 4 different budgets across 10 identical runs. PULSE's core has no model calls, an explicit seed and an explicit clock, so its play does not vary.

## What this does not show

- Freeform Claude never exceeded the total budget, and it leaned toward cutting.
- On the healthy fixture Claude often noted that each campaign spends $50/day against a $100 budget, so raising the budget may add nothing. PULSE still proposes +20%. That point is fair against PULSE.
- The fixtures contain no missing values, so "missing numbers never become zeros" was not tested here.
- Synthetic data, one model, one neutral prompt. This is a consistency and guardrail comparison, not a revenue-lift claim, and not a live-account result.
