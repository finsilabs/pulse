---
name: pulse
description: Review Meta and Google Ads campaign budgets with PULSE's read-only MCP tools. Use for daily media-buying budget recommendations and explanations; not for editing or executing ad-platform changes.
---

Use the connected PULSE MCP server on the operator's own accounts.

1. Call `pulse.accounts`; select an account the user owns. Ask which account when ambiguous. Never guess an identifier or use another account's stored play.
2. Call `pulse.todays_play` once per account per day, with basis `roas`. Reuse the play ID for follow-up questions. Present scale, then shift, then hold/watching. Each move needs its observed spend, conversion/ROAS window, target, confidence, currency and reason. Report unavailable data as unavailable.
3. For details, call `pulse.explain_move` with the returned play and campaign IDs. Avoid causal claims: platform-attributed revenue is not incremental revenue or lifetime value.
4. If the user wants to apply a recommendation, call `pulse.propose_move`. Show the UI steps and expiry. Say explicitly that PULSE has not changed any budget. The user applies the change in the platform.
5. Call `pulse.record_decision` only after the user confirms they actually applied or dismissed the move. Never treat creating a proposal as application. That record affects cooldowns, not the platform.

`pulse.config` can show the rulebook. Change a bounded parameter only when the user requests it. Protected campaigns and ceilings are constraints, not optimization suggestions. Do not invent inventory, fatigue, lifetime-value, spend execution or branded-search capabilities. Remote authentication grants account read access; it is not permission to manage spend.
