import test from "node:test";
import assert from "node:assert/strict";
import { createGrantRequest, exchangeGrant, refreshGoogle } from "./oauth.js";
test("upstream grants use exact provider URLs, Meta ads_read and Google offline PKCE", () => {
  const meta = createGrantRequest(
    "meta",
    "https://pulse.example/upstream/callback/meta",
    { meta_id: "example-id", meta_secret: "synthetic-secret" },
  );
  const u = new URL(meta.url);
  assert.equal(u.hostname, "www.facebook.com");
  assert.equal(u.searchParams.get("scope"), "ads_read");
  assert.ok(meta.state.length >= 32);
  const g = createGrantRequest("google", "http://127.0.0.1:8765/callback", {
    google_id: "example-id",
  });
  const v = new URL(g.url);
  assert.equal(v.hostname, "accounts.google.com");
  assert.equal(v.searchParams.get("code_challenge_method"), "S256");
  assert.equal(v.searchParams.get("access_type"), "offline");
  assert.ok(g.verifier);
});
test("token exchange is upstream-only and never leaks provider errors", async () => {
  const p = createGrantRequest("google", "http://127.0.0.1:8765/callback", {
    google_id: "example-id",
  });
  const requests: any[] = [];
  const g = await exchangeGrant(
    p,
    "synthetic-code",
    { google_id: "example-id" },
    async (u, i) => {
      requests.push({ url: String(u), body: String(i?.body) });
      return Response.json({
        access_token: "synthetic-token",
        refresh_token: "synthetic-refresh",
        expires_in: 3600,
      });
    },
  );
  assert.equal(g.access_token, "synthetic-token");
  assert.equal(requests[0].url, "https://oauth2.googleapis.com/token");
  assert.match(requests[0].body, /code_verifier/);
  await assert.rejects(
    () =>
      exchangeGrant(
        p,
        "synthetic-code",
        { google_id: "example-id" },
        async () =>
          Response.json({ error: "synthetic-secret" }, { status: 400 }),
      ),
    (e) => !(e as Error).message.includes("synthetic-secret"),
  );
  const r = await refreshGoogle(
    { access_token: "old", refresh_token: "synthetic-refresh" },
    { google_id: "example-id" },
    async () => Response.json({ access_token: "new", expires_in: 3600 }),
  );
  assert.equal(r.refresh_token, "synthetic-refresh");
});
