# Claude connectors, ChatGPT and Grok remote MCP

Self-hosting is the default. This repository does not promise a hosted URL, npm package, container registry image, OAuth app review or listing in any app directory.

Set up a public HTTPS endpoint using [remote hosting](../remote.md). Its `/mcp` endpoint uses Streamable HTTP and OAuth. Your ad-platform grants stay on that host, encrypted per connector authorization. Each authorization receives its own subject and isolated grants. Never configure “No auth” on a server holding ad tokens.

## Claude

In Settings → Connectors, add a custom connector using your host's `https://YOUR-HOST/mcp` URL. Complete consent and connect your own Meta and/or Google account. Availability and labels depend on your plan and client version. Claude Code remote setup:

```sh
claude mcp add --transport http pulse https://YOUR-HOST/mcp
```

Use `/mcp` in Claude Code to complete OAuth. Discovery and dynamic client registration are provided by the server.

## ChatGPT

Enable developer mode in the settings area for apps/connectors, then create a custom app/connector using the `/mcp` URL and OAuth. Current UI labels and workspace policies vary. The server publishes protected-resource and authorization-server metadata, supports registered redirects, S256 PKCE and DCR. It binds tokens to the MCP resource. No “No auth” configuration or public app-directory submission is included.

Official references: [connect a custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server), [build an MCP server](https://developers.openai.com/apps-sdk/build/mcp-server), [authentication](https://developers.openai.com/apps-sdk/build/auth). These describe protocol requirements; native UI installation must still be checked in the user's own account.

## Grok

On grok.com/connectors, choose New Connector → Custom, enter the public HTTPS `/mcp` endpoint and finish OAuth. This server implements Streamable HTTP (including streamed SSE responses), not the older standalone SSE transport. Check your client's transport support before connecting.

For xAI Responses API, use a PULSE access token belonging to the relevant subject:

```json
{"type":"mcp","server_url":"https://YOUR-HOST/mcp","server_label":"pulse","headers":{"Authorization":"Bearer YOUR_PULSE_TOKEN"},"allowed_tools":["pulse.accounts","pulse.snapshot","pulse.todays_play","pulse.explain_move","pulse.propose_move"]}
```

Check the current [xAI remote MCP docs](https://docs.x.ai/developers/tools/remote-mcp) for API-specific authorization syntax. This example uses its documented explicit headers field. Never include an upstream Meta/Google token here.

## Verify in each client

List tools, read accounts, request a play, explain a move and request a proposal. Confirm that changes are proposals only, and that reconnecting as a separate subject cannot fetch the first subject's play ID. Screenshot both tool listing and play output only with synthetic data. See [verification status](VERIFICATION.md).

Official setup references (checked 2026-11-06): [Claude remote connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp), [Grok web connectors](https://docs.x.ai/grok/connectors), [Grok Build MCP](https://docs.x.ai/build/features/mcp-servers).
