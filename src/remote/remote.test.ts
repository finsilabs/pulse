import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { EncryptedStore } from "./grants.js";
import { PulseAuth } from "./auth.js";
import { createHttpApp } from "./http.js";
const verifier = "a".repeat(64),
  challenge = createHash("sha256").update(verifier).digest("base64url");
test("encrypted per-subject grants survive reload; wrong key and tampering fail", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pulse-test-")),
    path = join(dir, "state.enc"),
    key = randomBytes(32);
  try {
    const s = new EncryptedStore(path, key);
    await s.set("grant:alice", { meta: { access_token: "synthetic-alice" } });
    await s.set("grant:bob", { google: { access_token: "synthetic-bob" } });
    assert.equal(
      (await readFile(path, "utf8")).includes("synthetic-alice"),
      false,
    );
    assert.deepEqual(await new EncryptedStore(path, key).get("grant:alice"), {
      meta: { access_token: "synthetic-alice" },
    });
    assert.equal(await s.get("grant:carol"), undefined);
    await assert.rejects(() =>
      new EncryptedStore(path, randomBytes(32)).get("grant:alice"),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("PKCE codes single-use, client/resource bound, refresh rotation and subject isolation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pulse-test-"));
  try {
    const store = new EncryptedStore(join(dir, "state.enc"), randomBytes(32)),
      auth = new PulseAuth(new URL("http://127.0.0.1:7890"), store),
      client = await auth.clientsStore.registerClient!({
        redirect_uris: ["http://127.0.0.1/callback"],
        token_endpoint_auth_method: "none",
      });
    const params = {
      codeChallenge: challenge,
      redirectUri: client.redirect_uris[0]!,
      scopes: ["pulse:read"],
      resource: new URL("http://127.0.0.1:7890/mcp"),
    };
    const code = await auth.issueCode(client, params, "alice");
    await assert.rejects(() =>
      auth.exchangeAuthorizationCode(
        client,
        code,
        "wrong",
        params.redirectUri,
        params.resource,
      ),
    );
    const good = await auth.issueCode(client, params, "alice"),
      tokens = await auth.exchangeAuthorizationCode(
        client,
        good,
        verifier,
        params.redirectUri,
        params.resource,
      );
    assert.equal(
      (await auth.verifyAccessToken(tokens.access_token)).extra?.subject,
      "alice",
    );
    await assert.rejects(() =>
      auth.exchangeAuthorizationCode(
        client,
        good,
        verifier,
        params.redirectUri,
        params.resource,
      ),
    );
    const rotated = await auth.exchangeRefreshToken(
      client,
      tokens.refresh_token!,
    );
    assert.notEqual(rotated.refresh_token, tokens.refresh_token);
    await assert.rejects(() =>
      auth.exchangeRefreshToken(client, tokens.refresh_token!),
    );
    await assert.rejects(() =>
      auth.exchangeRefreshToken(
        { ...client, client_id: "other" },
        rotated.refresh_token!,
      ),
    );
    await assert.rejects(() => auth.verifyAccessToken("not-a-token"));
    const c = await auth.issueCode(client, params, "bob");
    await assert.rejects(() =>
      auth.exchangeAuthorizationCode(
        client,
        c,
        verifier,
        params.redirectUri,
        new URL("https://other.invalid/mcp"),
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("HTTP discovery and protected resource challenge; anonymous tools refused", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pulse-test-"));
  let server: any;
  try {
    const app = createHttpApp({
      baseUrl: new URL("http://127.0.0.1:7890"),
      store: new EncryptedStore(join(dir, "s.enc"), randomBytes(32)),
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const origin = "http://127.0.0.1:" + server.address().port;
    const prm = await fetch(
      origin + "/.well-known/oauth-protected-resource/mcp",
    );
    assert.equal(prm.status, 200);
    assert.equal(
      ((await prm.json()) as any).resource,
      "http://127.0.0.1:7890/mcp",
    );
    const denied = await fetch(origin + "/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(denied.status, 401);
    assert.match(
      denied.headers.get("www-authenticate") ?? "",
      /resource_metadata/,
    );
    const reg = await fetch(origin + "/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Synthetic MCP Client",
        redirect_uris: ["http://127.0.0.1/callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(reg.status, 201);
    const metadata = (await (
      await fetch(origin + "/.well-known/oauth-authorization-server")
    ).json()) as any;
    assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
  } finally {
    if (server) await new Promise<void>((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
test("pinned metadata and DCR enforce the same safe redirect policy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pulse-test-"));
  try {
    const store = new EncryptedStore(join(dir, "s.enc"), randomBytes(32));
    assert.throws(
      () =>
        new PulseAuth(new URL("http://127.0.0.1:7890"), store, [
          {
            client_id: "https://client.example/metadata.json",
            redirect_uris: ["javascript:bad"],
            token_endpoint_auth_method: "none",
          },
        ]),
    );
    const auth = new PulseAuth(new URL("http://127.0.0.1:7890"), store);
    await assert.rejects(() =>
      auth.clientsStore.registerClient!({
        redirect_uris: ["https://user:secret@example.invalid/callback"],
        token_endpoint_auth_method: "none",
      }),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
