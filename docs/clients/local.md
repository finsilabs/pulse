# Claude Code, Claude Desktop and Grok Build

Build from source; no npm publication is assumed:

```sh
git clone https://github.com/finsilabs/pulse.git
cd pulse
npm ci
npm run build
node dist/index.js login meta
node dist/index.js login google
node dist/index.js doctor
```

You need only the platform you use. See [platform auth](../platform-auth.md) for your own app credentials and redirect URIs. Tokens are saved to `~/.config/pulse/credentials.json` with 0600 permissions. Do not paste them into chat or commit them.

Claude Code (use an absolute path):

```sh
claude mcp add --transport stdio --scope user pulse -- node /absolute/path/to/pulse/dist/index.js
```

Claude Desktop: edit `claude_desktop_config.json` and restart the app:

```json
{"mcpServers":{"pulse":{"command":"node","args":["/absolute/path/to/pulse/dist/index.js"]}}}
```

Grok Build:

```sh
grok mcp add pulse -- node /absolute/path/to/pulse/dist/index.js
```

The exact Grok CLI syntax varies by release; inspect `grok mcp --help` for your installed version. To try synthetic data without credentials, append `--demo` to the server arguments. The output explicitly labels the data synthetic.

For Claude, copy `skills/pulse` into your project's `.claude/skills/pulse`, or load its SKILL.md as instructions. Ask: “Show today's play for my account. Explain each proposed move; do not execute anything.”

Check that the client lists seven `pulse.*` tools, call `pulse.accounts` and `pulse.todays_play`, then ask for a proposal. The proposal must contain `applied: false`. Capture your client screenshot for your own verification; do not include account names, tokens or real spend in a public screenshot.

`docs/clients/VERIFICATION.md` distinguishes protocol verification from native-app verification. Do not infer that an install was tested in the native application from a generated example.

Official setup references (checked 2026-11-06): [Claude Code MCP](https://code.claude.com/docs/en/mcp), [MCP local-server developer configuration](https://modelcontextprotocol.io/docs/develop/connect-local-servers), [Claude Desktop extensions](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop), [Grok Build MCP](https://docs.x.ai/build/features/mcp-servers). The JSON example above is manual developer configuration, not a packaged desktop extension.
