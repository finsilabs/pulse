# Self-hosting Streamable HTTP

Build the image locally:

```sh
docker build -t pulse .
```

Run one process, behind a TLS reverse proxy that forwards `/mcp` and OAuth endpoints. Generate a fresh 32-byte key with `openssl rand -hex 32` and store it in your secret manager. Supply environment variables through your deployment's secret injection, not shell history:

```sh
docker run --rm -p 8080:8080 --env-file /private/path/pulse-host.env \
  -v pulse-state:/data pulse
```

Required host settings:

- PULSE_PUBLIC_URL: HTTPS origin, e.g. `https://YOUR-HOST` (no path/query/fragment).
- PULSE_HOST_KEY: 64 hex characters.
- PULSE_STATE_FILE: `/data/pulse.enc`.
- META_APP_ID / META_APP_SECRET and/or GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_ADS_DEVELOPER_TOKEN.
- PORT: optional, defaults to 8080; default HTTP bind is 127.0.0.1 locally; Docker sets HOST=0.0.0.0.

Register the exact remote redirect `https://YOUR-HOST/upstream/callback/meta` or `/google` with the respective provider. Configure Google as a Web OAuth client. Meta users need a role on your app until its permissions are approved for other people.

The host's OAuth consent page connects each user's own upstream account(s). It never asks for raw access tokens. The browser cookie, pending authorization and upstream callback state are bound together. Consent is explicit; pressing approve without connecting at least one provider is refused. Client codes expire in five minutes, PKCE is S256-only, tokens are resource-bound, and refresh tokens rotate. Access tokens expire in one hour.

The MCP SDK supplies discovery, DCR, authorization and token endpoint routing and rate limits. Client metadata documents may be pinned by the operator in PULSE_CIMD_CLIENTS (a JSON array of complete public client metadata with HTTPS client_id URLs and exact redirect_uris). Unknown URL client IDs are refused rather than fetched by the server; this prevents a client-metadata SSRF surface. DCR works without pinning. This is a deliberate constrained CIMD implementation.

No hosted service is deployed by cloning this repo. No URL under a maintainer domain or image under ghcr.io is claimed to exist. The local tests verify real HTTP OAuth and MCP requests; external connector and app-review checks remain separate.
