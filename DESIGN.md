# PULSE design

PULSE proposes daily campaign budgets from the operator's own Meta and Google Ads accounts. It is deterministic software, not an LLM runtime. The MCP host explains the output. No account on another service is needed.

## Core and ownership

`src/core` owns validated snapshots, signals, response curves, allocation, rule selection and proposals. It has no network or filesystem dependencies. Inputs are one account, one currency, a bounded rulebook and the operator's reported decision history. The seed and analysis clock are explicit.

A snapshot covers 30 calendar days, ending **two days before today's date**. This excludes the most recent day to allow reporting maturation. All dates are date strings; timestamps represent collection and decision times. Seven-day signals are selected from this window. Sparse API rows represent no activity; null or invalid numerical fields do not become fabricated zeros. Unknown budgets and learning status are explicit. A snapshot older than 24 hours is not actionable.

The ROAS response is `value = k * spend^beta`, with beta .6 by default (.01–.99 allowed). Allocation takes 200 greedy steps on marginal return. Noise decreases with confidence and uses a seeded generator. Confidence is `min(1, spend7d / 700) * .7`; campaigns below .2 confidence hold. A ROAS campaign below 350 spend over seven days uses the channel prior (Meta 1.0, Google 1.1). Configuration money thresholds are **in the account's currency**, not converted USD.

Curve moves are damped by confidence and capped at 20%; guardrails cap daily increases and campaign ceilings. Protected, paused, unknown/shared/lifetime budget campaigns hold. Final increases are trimmed so proposals never exceed the total budget, or return an explicit infeasibility warning when fixed holds already exceed it. Money respects ISO currency minor units; rounding never increases the pool.

## Rules

| Rule | Trigger | Result |
| --- | --- | --- |
| Sufficiency | spend < 2×target CPA and <50 | Veto PR1, PR2, PR5 |
| PR1 | ≥5 days active, ≥2×target CPA spend, zero conversions | 50% cut, floor 5/day |
| PR2 | ≥14 days active, CPA >1.5×target and ROAS <.5×target | 50% cut |
| PR4 | Learning and proposed curve move >20% | Hold |
| PR5 | ≥3 mature campaigns, CPA ≥1.5×account CPA and spend ≥2×account CPA | 30% cut |
| PR6 | Reported applied cut in 14-day cooldown, post-cut ROAS >1 | Restore pre-cut budget, subject to increase/total caps |

First-fire wins for PR1/2/5. PR4 hold overrides every rule; PR6 considers only a user-reported applied cut, never a suggested one. Cooldowns are 14 days (learning guard: 3). Cuts win only below the curve recommendation; restores win only above it. A curve move must reach 1%; proposal creation additionally requires at least 1 currency unit. No campaign is resurfaced within 72 hours; after three unanswered surfacings the row moves to watching for seven days. A decision reported today prevents a new move today. None of these records change an ad account.

PR3 branded-search cannibalisation is not implemented. Neither first-party lifetime value, inventory, MMM fitting, fatigue actions, conversion uploads nor budget execution is included.

## MCP contract

`pulse.accounts`, `pulse.snapshot`, `pulse.todays_play`, `pulse.explain_move`, `pulse.propose_move`, `pulse.config`, `pulse.record_decision`. Resources: `pulse://rulebook` and `pulse://play/latest`. IDs scope evidence to a cached snapshot/play. Every money object includes currency and observed/estimated basis. Proposals expire after 48 hours and always carry `applied: false`. There is no execute tool.

The SDK owns stdio and Streamable HTTP framing and OAuth endpoint validation. The application owns authentication, account ownership, scopes, credential storage and recommendation invariants. Remote requests create isolated MCP servers scoped to the validated subject; no MCP state is shared between users. SSE responses within Streamable HTTP are supported; the legacy SSE transport is not exposed.

## Platform adapters

Meta budget fields use its published [Marketing API currency offsets](https://developers.facebook.com/docs/marketing-api/currencies/) (1 or 100), independently of ISO monetary rounding. The adapter refuses currencies outside that table. PKR monetary rounding explicitly preserves its two ISO 4217 minor digits, including on ICU versions that default to zero.

Only adapters contact ad-platform endpoints. Meta uses GET with `ads_read`; Google uses fixed GAQL reads and customer listing. Google has **no read-only scope**, so writes are absent from the client and request contracts are tested. No arbitrary URL, query or account identifier is accepted from MCP callers. Account selection must match accounts discovered from the current subject's grants.

Local credentials are owner-only files (directory 0700, files 0600). Loopback OAuth uses a random state and Google PKCE, verifies the actual loopback callback and times out. Remote grants are encrypted with AES-256-GCM, separated by subject, with a host-supplied key. OAuth client tokens are distinct from upstream platform tokens. Authorization requires explicit consent, S256 PKCE, registered redirect URIs and resource binding. The consent screen marks dynamically registered client names as unverified and shows the requested redirect host and full URI before approval. Operator-pinned clients are labeled separately with their HTTPS metadata client ID; no trust is inferred from a self-reported name. Refresh tokens rotate. Cookies protect the browser grant/consent session; upstream OAuth state is single-use. No secrets are logged or returned through MCP.

## Tests and distribution

Offline tests exercise pure rules, account/currency boundaries, recorded-shaped **synthetic** API responses, credential permissions, every tool, real stdio/HTTP MCP framing, OAuth discovery, PKCE and subject isolation. `scripts/check.sh` runs the local gate without hosted CI. Live sandbox and native-client checks are a separate manual verification, never inferred from passing fixtures.

The top-level layout follows [ecom-context](https://github.com/finsilabs/ecom-context). New agents use [docs/next-agent.md](docs/next-agent.md); remote/auth remains in this repository until a second implementation justifies a shared package.

## Protocol sources

- [MCP authorization](https://modelcontextprotocol.io/specification/latest/basic/authorization)
- [MCP transports](https://modelcontextprotocol.io/specification/latest/basic/transports)
- [ChatGPT MCP server requirements](https://developers.openai.com/apps-sdk/build/mcp-server)
- [ChatGPT authentication](https://developers.openai.com/apps-sdk/build/auth)
- [Meta Insights](https://developers.facebook.com/docs/marketing-api/insights/)
- [Google Ads REST search](https://developers.google.com/google-ads/api/rest/common/search)

This implementation was written from an approved behavioral design, not copied from a private application. All checked-in account data and API responses are generated examples.
