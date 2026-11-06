# Verification record

This file records what was actually checked. Synthetic data is not a real ad account or a sandbox API recording.

| Check | Status |
| --- | --- |
| Core rules and invariants | Passed local gate (63/63 tests, TypeScript build) |
| Synthetic Meta/Google response replay | Passed local gate (63/63 tests, TypeScript build) |
| Seven MCP tools, in-memory SDK client | Passed local gate (63/63 tests, TypeScript build) |
| Real stdio and Streamable HTTP transport | Passed local gate (63/63 tests, TypeScript build) |
| OAuth discovery, PKCE, refresh and subject isolation | Passed local gate (63/63 tests, TypeScript build) |
| Claude Desktop / Code native UI screenshots | Follow-up: founder-run with a real ad account; needs authenticated client session |
| ChatGPT native connector screenshot | Follow-up: founder-run with a real ad account; needs authenticated client session and public HTTPS host |
| Grok native connector screenshot | Follow-up: founder-run with a real ad account; needs authenticated client session and public HTTPS host |
| Maintainer-owned ad sandbox live smoke | Follow-up: founder-run with a real ad account; no maintainer sandbox credentials exist |

No installed client config is modified by `npm test`. No ad-platform credentials are required by the offline gate. The live command is documented separately; never substitute a merchant's connected token for a maintainer's sandbox grant.

Release scope (2026-11-06): the live sandbox run and native-client screenshots are follow-up work, not a blocker for the synthetic-fixture + real-transport release.

## Founder-run with a real ad account

- [ ] Run the live smoke against an explicitly owned Meta and Google Ads account.
- [ ] Capture tool listing and a play in Claude Desktop/Code.
- [ ] Capture tool listing and a play in ChatGPT's authenticated custom connector.
- [ ] Capture tool listing and a play in Grok's authenticated custom connector.
- [ ] Confirm proposals remain unapplied; redact sensitive account details before publishing screenshots.

Local release gate: `npm run check` passed on Node 22.23.4 (63 tests, zero failures). Real SDK clients exercised stdio and Streamable HTTP, OAuth code exchange/consent/PKCE/replay protection and subject isolation. Runtime `npm audit --omit=dev` reported zero vulnerabilities. Five synthetic fixture/play pairs are checked in under fixtures/accounts and examples.

Updated 2026-11-06 after the review fixes (Meta budget offsets, consent redirect matching): the offline gate passes 63/63 tests at main.
