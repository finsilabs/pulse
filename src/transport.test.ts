import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpApp } from "./remote/http.js";
import { EncryptedStore, SubjectStore } from "./remote/grants.js";
import { PulseService } from "./server.js";
import { syntheticSnapshot } from "./fixtures/generate.js";
test("real stdio process lists tools and returns a synthetic play with proposal-only contract", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pulse-stdio-")),
    client = new Client({ name: "test-client", version: "1" }),
    transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/index.ts", "--demo"],
      env: { PATH: process.env.PATH ?? "", PULSE_HOME: dir },
      stderr: "pipe",
    });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 7);
    const result: any = await client.callTool({
      name: "pulse.todays_play",
      arguments: { account: "meta:synthetic" },
    });
    assert.ok(!result.isError, JSON.stringify(result));
    const play = JSON.parse(result.content[0].text);
    assert.equal(play.synthetic, true);
    assert.ok(play.shift.length);
    const proposal: any = await client.callTool({
      name: "pulse.propose_move",
      arguments: {
        play_id: play.play_id,
        campaign_id: play.shift[0].campaign_id,
      },
    });
    assert.equal(JSON.parse(proposal.content[0].text).applied, false);
  } finally {
    await client.close();
    await transport.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("HTTP authorization/consent/code exchange and SDK transport isolate subjects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pulse-http-")),
    store = new EncryptedStore(join(dir, "state.enc"), randomBytes(32));
  let listener: any;
  const clients: Client[] = [];
  try {
    const app = createHttpApp({
      baseUrl: new URL("http://127.0.0.1:7890"),
      store,
    });
    listener = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => listener.once("listening", r));
    const origin = "http://127.0.0.1:" + listener.address().port,
      verifier = "b".repeat(64),
      challenge = createHash("sha256").update(verifier).digest("base64url");
    const reg = await fetch(origin + "/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Synthetic transport check",
        redirect_uris: ["http://127.0.0.1/callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    assert.equal(reg.status, 201);
    const registration: any = await reg.json();
    const authz = new URL(origin + "/authorize");
    authz.search = new URLSearchParams({
      client_id: registration.client_id,
      redirect_uri: "http://127.0.0.1/callback",
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: "http://127.0.0.1:7890/mcp",
      scope: "pulse:read",
      state: "client-csrf",
    }).toString();
    const consent = await fetch(authz, { redirect: "manual" });
    assert.equal(consent.status, 302);
    const cookie = consent.headers.get("set-cookie")!.split(";")[0]!,
      location = consent.headers.get("location")!,
      ticket = new URL(location, origin).searchParams.get("ticket")!,
      pendingKey =
        "pending:" + createHash("sha256").update(ticket).digest("hex"),
      pending: any = await store.get(pendingKey);
    assert.ok(pending);
    const subject = new SubjectStore(store, pending.subject);
    await subject.write("credentials", {
      meta: { access_token: "synthetic-only-not-used" },
    });
    const page = await fetch(origin + location, { headers: { cookie } });
    assert.equal(page.status, 200);
    const fake = await fetch(origin + "/consent", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ticket, decision: "approve" }),
      redirect: "manual",
    });
    assert.equal(fake.status, 400);
    const approved = await fetch(origin + "/consent", {
      method: "POST",
      headers: { cookie, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ticket, decision: "approve" }),
      redirect: "manual",
    });
    assert.equal(approved.status, 302);
    const callback = new URL(approved.headers.get("location")!);
    assert.equal(callback.searchParams.get("state"), "client-csrf");
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: registration.client_id,
      redirect_uri: "http://127.0.0.1/callback",
      code: callback.searchParams.get("code")!,
      code_verifier: verifier,
      resource: "http://127.0.0.1:7890/mcp",
    });
    const exchange = await fetch(origin + "/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });
    assert.equal(exchange.status, 200);
    const tokens: any = await exchange.json();
    const replay = await fetch(origin + "/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });
    assert.equal(replay.status, 400);
    const seedService = new PulseService(subject, {
        demo: syntheticSnapshot("stop-loss"),
      }),
      play = await seedService.todaysPlay({ account: "meta:synthetic" });
    const connect = async (token: string) => {
      const c = new Client({ name: "http-test", version: "1" });
      clients.push(c);
      await c.connect(
        new StreamableHTTPClientTransport(new URL(origin + "/mcp"), {
          requestInit: { headers: { Authorization: "Bearer " + token } },
        }),
      );
      return c;
    };
    const alice = await connect(tokens.access_token);
    assert.equal((await alice.listTools()).tools.length, 7);
    const evidence: any = await alice.callTool({
      name: "pulse.explain_move",
      arguments: {
        play_id: play.play_id,
        campaign_id: play.shift[0]!.campaign_id,
      },
    });
    assert.ok(!evidence.isError);
    const auth = app.locals.auth,
      code = await auth.issueCode(
        registration,
        {
          codeChallenge: challenge,
          redirectUri: "http://127.0.0.1/callback",
          scopes: ["pulse:read"],
        },
        "other-subject",
      ),
      other = await auth.exchangeAuthorizationCode(
        registration,
        code,
        verifier,
        "http://127.0.0.1/callback",
      );
    const bob = await connect(other.access_token);
    const denied: any = await bob.callTool({
      name: "pulse.explain_move",
      arguments: {
        play_id: play.play_id,
        campaign_id: play.shift[0]!.campaign_id,
      },
    });
    assert.equal(denied.isError, true);
  } finally {
    for (const c of clients) await c.close();
    if (listener) await new Promise<void>((r) => listener.close(r));
    await rm(dir, { recursive: true, force: true });
  }
});
