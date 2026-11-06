# PULSE

**Daily ad-budget recommendations for the accounts you own, inside the AI client you already use.**

PULSE reads Meta and Google Ads, compares campaigns, and proposes where to scale or reduce daily budgets. Each move carries the observed window, conversions, CPA, ROAS, confidence and reason. Your host model can explain the numbers; PULSE itself makes no model calls.

**PULSE never changes spend.** There is no pause, mutate or apply tool. A proposal is a set of instructions for you to use in Ads Manager or Google Ads. Recording “applied” records your report; it does not perform the action.

## Quick start

Node 22 or later:

```sh
git clone https://github.com/finsilabs/pulse.git
cd pulse
npm ci
npm run build
node dist/index.js --demo
```

The last command starts a stdio MCP server using explicitly synthetic data. It waits for a client; it is not an interactive chat shell. For a printable example:

```sh
node dist/index.js smoke --demo
```

To use your own accounts, [create your platform app and log in](docs/platform-auth.md):

```sh
node dist/index.js login meta
node dist/index.js login google
node dist/index.js doctor
```

Connect one or both platforms. Credentials live under `~/.config/pulse` with owner-only permissions, not in your project. Meta uses `ads_read`. Google exposes only the broad `adwords` scope; PULSE restricts its client to tested read endpoints and fixed GAQL queries. Prefer a Google Ads user with read-only account access.

No Finsi account, database, warehouse or model-provider key is needed. This repository is MIT licensed.

## Install in your client

- [Claude Code / Desktop and Grok Build (local stdio)](docs/clients/local.md)
- [Claude connectors, ChatGPT and Grok (remote Streamable HTTP)](docs/clients/remote.md)
- [Self-host the remote server](docs/remote.md)
- [Verification status](docs/clients/VERIFICATION.md)

Remote use needs an HTTPS host and its own OAuth app setup. This project does not claim a hosted service, published npm package or registry image. Build from the source above. See [skills/pulse/SKILL.md](skills/pulse/SKILL.md) for Claude instructions.

## Tools

| Tool | What it returns |
| --- | --- |
| `pulse.accounts` | Accounts accessible to your grant, with currency/timezone |
| `pulse.snapshot` | Validated campaign daily metrics and observed budgets; cached up to an hour, optional refresh |
| `pulse.todays_play` | Scale, shift, hold, watching and warnings; seeded, ROAS-basis recommendations |
| `pulse.explain_move` | Evidence, window, target, cooldown and clamps for one campaign |
| `pulse.propose_move` | An expiring UI action plan with `applied: false` |
| `pulse.config` | Get or change bounded targets, caps, protected campaigns and ceilings |
| `pulse.record_decision` | Record your reported applied/dismissed decision for cooldowns |

Resources: `pulse://rulebook`, `pulse://play/latest`.

Ask your agent: “Show today's play. Explain the evidence for each move. Do not change anything.” Read a play before requesting a proposal; refresh its snapshot before proposing if the current budget evidence is older than five minutes.

## What it does

A diminishing-return curve reallocates a fixed daily pool, damped by confidence and bounded by guardrails. Rules cover stop-loss, sunsetting, learning protection, account-relative underperformance and restoration after a reported cut. Defaults: 20% maximum curve move, target CPA 50 account-currency units, target ROAS 2.0, 14-day cut cooldown, 48-hour proposal expiry. Targets are configurable; defaults are not a claim about what is profitable for your business.

Metrics exclude the newest complete day to reduce attribution lag. Decisions use calendar-day windows, never a sum of overlapping rolling totals. Every monetary output carries its currency and whether it is observed or estimated. A platform-reported attribution value is not proof of causality.

## Honest limits

- ROAS only. No first-party lifetime value, inventory, MMM fitting, branded-search cannibalisation, conversion uploads, creative fatigue actions or budget execution.
- No currency conversion. The account currency applies to targets, minimums and budgets.
- Meta ad-set-budget campaigns are held: an aggregate is not an actionable campaign budget. Shared/lifetime/unknown Google budgets are also held. Learning signals are explicit; Google learning state is unknown unless the API provides it.
- Account history is local to this install/remote subject. A manually changed budget is not known until you refresh. Cooldowns begin only when you report an applied change.
- Google discovery reads accessible customers and their non-manager children. Manager IDs are preserved as login-customer-id for child reads. API access levels and account-role permissions still apply.
- Remote hosting requires trusting that operator with your encrypted account grants and metrics. Each subject is isolated, but this is not a managed hosting or compliance service.
- Fixtures and examples are synthetic. No live-account or native-app verification is claimed without a receipt in the verification record.

## Local checks

```sh
npm run check
```

This runs TypeScript, offline tests and a secondary read-only surface guard. Adapter tests assert the actual requests; the text guard alone is not evidence. Tests do not need cloud credentials and do not call Meta or Google. No hosted CI is required.

For an explicitly authorized own-account smoke:

```sh
node dist/index.js smoke --account meta:act_YOUR_ACCOUNT
```

Treat its output as private account data. Do not commit it without reviewing/redacting it.

## Architecture and measurement

See [DESIGN.md](DESIGN.md) for rules, invariants and sources; [docs/next-agent.md](docs/next-agent.md) for the next-agent layout matching [ecom-context](https://github.com/finsilabs/ecom-context).

The measurements here are deterministic test results, not a revenue-lift claim. A stronger ROAS recommendation can still be wrong because attribution, stock, customer quality or context is missing. Validate recommendations against your business before applying them.

The core is also importable without starting MCP:

```ts
import { AccountSnapshot, defaultConfig, buildPlay } from '@finsilabs/pulse';
const snapshot = AccountSnapshot.parse(yourOwnSnapshot);
const play = buildPlay(snapshot, defaultConfig(), {}, new Date());
```

Build from source before importing. The library uses the same validation, clock, seed and proposal invariants as the MCP server.
