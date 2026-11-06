import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, PulseService } from "./server.js";
import { LocalStore } from "./adapters/credentials.js";
import { syntheticSnapshot } from "./fixtures/generate.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("all seven tools execute via MCP; resources and invalid inputs; proposals never apply", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pulse-test-")),
    store = new LocalStore(dir),
    snapshot = syntheticSnapshot("stop-loss"),
    service = new PulseService(store, { demo: snapshot }),
    server = createServer(service),
    client = new Client({ name: "synthetic-test", version: "1" }),
    [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);
    await client.connect(ct);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((t) => t.name).sort(), [
      "pulse.accounts",
      "pulse.config",
      "pulse.explain_move",
      "pulse.propose_move",
      "pulse.record_decision",
      "pulse.snapshot",
      "pulse.todays_play",
    ]);
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result: any = await client.callTool({ name, arguments: args });
      assert.ok(!result.isError, JSON.stringify(result));
      return JSON.parse(result.content[0].text);
    };
    const accounts = await call("pulse.accounts");
    assert.equal(accounts.accounts[0].account, snapshot.account);
    await call("pulse.snapshot", { account: snapshot.account });
    const play = await call("pulse.todays_play", {
      account: snapshot.account,
      basis: "roas",
    });
    assert.ok(play.shift.length);
    const row = play.shift[0],
      exp = await call("pulse.explain_move", {
        play_id: play.play_id,
        campaign_id: row.campaign_id,
      });
    assert.equal(exp.campaign_id, row.campaign_id);
    const proposal = await call("pulse.propose_move", {
      play_id: play.play_id,
      campaign_id: row.campaign_id,
    });
    assert.equal(proposal.applied, false);
    assert.equal(proposal.current_daily_budget.currency, "USD");
    await call("pulse.config", { action: "get" });
    await call("pulse.config", {
      action: "set",
      param: "target_cpa",
      value: 40,
    });
    assert.equal(
      (await call("pulse.config", { action: "get" })).target_cpa,
      40,
    );
    await call("pulse.record_decision", {
      play_id: play.play_id,
      campaign_id: row.campaign_id,
      decision: "dismissed",
    });
    const resources = await client.listResources();
    assert.equal(resources.resources.length, 2);
    await client.readResource({ uri: "pulse://play/latest" });
    await client.readResource({ uri: "pulse://rulebook" });
    const invalid: any = await client.callTool({
      name: "pulse.snapshot",
      arguments: { account: "meta:other" },
    });
    assert.equal(invalid.isError, true);
    const malformed: any = await client.callTool({
      name: "pulse.snapshot",
      arguments: { account: snapshot.account, days: NaN },
    });
    assert.equal(malformed.isError, true);
    assert.equal(JSON.stringify(invalid).includes("synthetic-token"), false);
  } finally {
    await client.close();
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("two users cannot read each other plays or accounts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pulse-test-"));
  try {
    const a = new PulseService(new LocalStore(join(dir, "a")), {
        demo: syntheticSnapshot("stop-loss"),
      }),
      b = new PulseService(new LocalStore(join(dir, "b")), {
        demo: syntheticSnapshot("healthy"),
      });
    const p = await a.todaysPlay({ account: (await a.accounts())[0]!.account });
    await assert.rejects(() => b.explain(p.play_id, p.shift[0]!.campaign_id));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("a changed rulebook invalidates an old proposal; an identical explicit budget reuses the play", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pulse-test-"));
  try {
    const store = new LocalStore(dir),
      service = new PulseService(store, {
        demo: syntheticSnapshot("stop-loss"),
      }),
      account = (await service.accounts())[0]!.account;
    const p = await service.todaysPlay({ account, total_budget: 200 }),
      again = await service.todaysPlay({ account, total_budget: 200 });
    assert.equal(again.play_id, p.play_id);
    await service.propose(p.play_id, p.shift[0]!.campaign_id);
    await service.configuration("set", "protected_campaigns", [
      p.shift[0]!.campaign_id,
    ]);
    await assert.rejects(() =>
      service.propose(p.play_id, p.shift[0]!.campaign_id),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
