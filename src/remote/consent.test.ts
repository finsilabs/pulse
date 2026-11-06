import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { EncryptedStore } from "./grants.js";
import { createHttpApp } from "./http.js";

for (const pinned of [false, true]) {
  test(`consent identifies ${pinned ? "operator-pinned" : "unverified dynamic"} client and exact requested destination`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "pulse-consent-"));
    const redirect = "https://attacker.example/cb?x=1&y=%3Cscript%3E";
    const metadata = {
      client_id: "https://client.example/metadata.json",
      client_name: 'Claude <img src=x onerror="bad">',
      redirect_uris: ["https://other.example/cb", redirect],
      token_endpoint_auth_method: "none" as const,
    };
    const app = createHttpApp({
      baseUrl: new URL("http://127.0.0.1:7890"),
      store: new EncryptedStore(join(dir, "s.enc"), randomBytes(32)),
      pinnedClients: pinned ? [metadata] : [],
    });
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((r) => server.once("listening", r));
      const origin =
        "http://127.0.0.1:" + (server.address() as { port: number }).port;
      let id = metadata.client_id;
      if (!pinned) {
        const registration = await fetch(origin + "/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(metadata),
        });
        assert.equal(registration.status, 201);
        id = (await registration.json()).client_id;
      }
      const params = new URLSearchParams({
        client_id: id,
        redirect_uri: redirect,
        response_type: "code",
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update("a".repeat(64))
          .digest("base64url"),
        scope: "pulse:read",
        resource: "http://127.0.0.1:7890/mcp",
      });
      const auth = await fetch(origin + "/authorize?" + params, {
        redirect: "manual",
      });
      assert.equal(auth.status, 302);
      const cookie = auth.headers.get("set-cookie")!.split(";")[0]!;
      const consent = await fetch(origin + auth.headers.get("location"), {
        headers: { Cookie: cookie },
      });
      assert.equal(consent.status, 200);
      const html = await consent.text();
      assert.match(html, /<strong>attacker\.example<\/strong>/);
      assert.ok(
        html.includes("https://attacker.example/cb?x=1&amp;y=%3Cscript%3E"),
      );
      assert.ok(!html.includes("<img"));
      assert.ok(html.includes("Claude &lt;img"));
      if (pinned) {
        assert.match(html, /Operator-pinned client/);
        assert.ok(html.includes(metadata.client_id));
        assert.doesNotMatch(html, /Unverified client/);
      } else {
        assert.match(html, /Unverified client/);
        assert.doesNotMatch(html, /Operator-pinned client/);
      }
      const noCookie = await fetch(origin + auth.headers.get("location"));
      assert.equal(noCookie.status, 400);
    } finally {
      await new Promise<void>((r, reject) =>
        server.close((e) => (e ? reject(e) : r())),
      );
      await rm(dir, { recursive: true, force: true });
    }
  });
}
