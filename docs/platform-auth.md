# Your own platform credentials

PULSE has no shared ad account or third-party data dependency. Create your own platform app and grant it access only to accounts you own or operate. Do not send credentials to the MCP host model.

## Meta

Create a Meta developer app with Marketing API access, and register the callback printed by `pulse login meta`. For local login it is `http://127.0.0.1:8765/callback` (set PULSE_LOGIN_PORT to change it). The Meta app must allow that exact redirect and your account must be an app administrator/developer/tester in development mode. Provider restrictions on HTTP loopback vary by app configuration; if yours requires HTTPS, use a self-hosted HTTPS remote endpoint instead.

Set `META_APP_ID` and `META_APP_SECRET` in the environment of the login command, then run:

```sh
node dist/index.js login meta
```

PULSE requests `ads_read`, never `ads_management`. For a previously issued owner-account `ads_read` token, you can create the local credential file manually (0600) with `{"meta":{"access_token":"YOUR_TOKEN"}}`. Do not put a real token in a project file. Expired Meta grants require login again; PULSE does not silently fall back to another identity.

Remote apps serving people without an app role require the relevant Meta app review/access level. This repository does not supply that approval.

## Google Ads

Create an OAuth client (Desktop for loopback, Web for remote). Enable the Google Ads API. You may need a Google Ads developer token and the appropriate API access level. Configure:

- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET, if your client requires it
- GOOGLE_ADS_DEVELOPER_TOKEN
- GOOGLE_ADS_LOGIN_CUSTOMER_ID, only when using a manager account (digits, no hyphens)

Then run `node dist/index.js login google`. Google requests the `https://www.googleapis.com/auth/adwords` scope. **There is no read-only Google Ads scope**. PULSE enforces read-only by exposing only accessible-customer listing and fixed `searchStream` queries, with contract tests. It never calls mutate services. For defense in depth, use a Google Ads user with read-only account access.

Refresh tokens are stored locally or in the encrypted remote grant store. A refresh token is not a sandbox guarantee: choose test/own accounts deliberately. Google OAuth consent/test-user and API-access restrictions still apply.

## Storage

Local default: `~/.config/pulse`, overridable by PULSE_HOME. Parent directory must be owned by the process user; credential/state files are owner-only, atomically replaced, and symlinks are refused. Do not share this directory between unrelated OS users.

Remote: the operator supplies PULSE_HOST_KEY (64 hex characters, generated locally) and a private persistent PULSE_STATE_FILE. Never reuse this file across multiple running processes. Back up the encrypted file together with the key using your normal secret-management controls. Changing or losing the key without migration makes grants unreadable.

PULSE output contains account metrics. Treat the MCP client's conversation and the remote host as data recipients when deciding where to connect.
