# Adding the next agent

Use the same top level: README, DESIGN, MIT LICENSE, package.json (ESM, bin), tsconfig, src, skills/<agent>, fixtures, examples, docs/clients, scripts/check.sh. Keep unit tests beside the module. Provide a synthetic demo without credentials.

Keep deterministic decisions in src/core. Give every external service a bounded adapter and a recorded-response contract test. Use src/server.ts for transport-independent MCP tools. Keep identity/grants in src/remote, with no domain logic. Reuse the MCP SDK rather than writing framing or OAuth handlers.

Do not share authentication by copying a private application's internals. At the second agent, extract the tested remote layer into a separately versioned package only after its actual differences are understood. Record native-client verification separately from protocol tests.
