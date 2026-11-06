import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { MetaAdapter } from "./meta.js";
import { GoogleAdapter } from "./google.js";
import { mkdtemp, stat, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStore } from "./credentials.js";
const now = new Date("2026-10-02T12:00:00Z");
const metaFixture = JSON.parse(
  readFileSync(
    new URL("../../fixtures/api/meta.json", import.meta.url),
    "utf8",
  ),
);
const metaResponse = (url: string) =>
  structuredClone(metaFixture[new URL(url).pathname.split("/").at(-1)!] ?? {});
test("Meta mapping uses GET only, no double-counting purchase aliases, correct currency minor units", async () => {
  const calls: { url: string; method: string }[] = [];
  const a = new MetaAdapter(
    { access_token: "synthetic-not-a-token" },
    async (u, i) => {
      calls.push({ url: String(u), method: i?.method ?? "GET" });
      assert.equal(new URL(String(u)).hostname, "graph.facebook.com");
      return Response.json(metaResponse(String(u)));
    },
    now,
  );
  const ac = await a.accounts();
  const s = await a.snapshot(ac[0]!, 30);
  assert.equal(s.campaigns[0]?.daily_budget, 1000);
  assert.equal(s.campaigns[0]?.metrics[0]?.conversions, 2);
  assert.equal(s.campaigns[0]?.metrics[0]?.revenue, 600);
  assert.ok(calls.every((c) => c.method === "GET"));
  assert.deepEqual(
    calls.map((c) => new URL(c.url).pathname.split("/").at(-1)),
    ["adaccounts", "campaigns", "adsets", "insights"],
  );
});
test("Meta pagination refuses arbitrary hosts without sending credentials", async () => {
  let calls = 0;
  const a = new MetaAdapter(
    { access_token: "synthetic-not-a-token" },
    async () => {
      calls++;
      return Response.json({
        data: [],
        paging: { next: "https://attacker.invalid/?page=2" },
      });
    },
    now,
  );
  await assert.rejects(() => a.accounts());
  assert.equal(calls, 1);
});
test("Meta ad-set budgets aggregate and unknown learning stays unknown", async () => {
  const a = new MetaAdapter(
    { access_token: "synthetic-not-a-token" },
    async (u) => {
      const x = metaResponse(String(u));
      if (String(u).includes("/campaigns"))
        delete (x as any).data[0].daily_budget;
      if (String(u).includes("/adsets"))
        (x as any).data = [
          {
            campaign_id: "c1",
            daily_budget: "100",
            effective_status: "ACTIVE",
          },
          {
            campaign_id: "c1",
            daily_budget: "200",
            effective_status: "ACTIVE",
          },
        ];
      return Response.json(x);
    },
    now,
  );
  const s = await a.snapshot((await a.accounts())[0]!, 30);
  assert.equal(s.campaigns[0]?.daily_budget, 300);
  assert.equal(s.campaigns[0]?.learning, "unknown");
});
test("Google only lists customers and searchStreams fixed campaign GAQL; micros converted, shared budget marked", async () => {
  const calls: { url: string; body: any }[] = [];
  const a = new GoogleAdapter(
    { access_token: "synthetic-not-a-token", developer_token: "synthetic-dev" },
    async (u, i) => {
      calls.push({
        url: String(u),
        body: i?.body ? JSON.parse(String(i.body)) : null,
      });
      if (String(u).endsWith("customers:listAccessibleCustomers"))
        return Response.json({ resourceNames: ["customers/1234567890"] });
      const q = JSON.parse(String(i?.body)).query;
      if (q.includes("FROM customer"))
        return Response.json([
          {
            results: [
              {
                customer: {
                  id: "1234567890",
                  descriptiveName: "Synthetic Google",
                  currencyCode: "USD",
                  timeZone: "UTC",
                  manager: false,
                },
              },
            ],
          },
        ]);
      return Response.json([
        {
          results: [
            {
              campaign: {
                id: "1",
                name: "Synthetic search",
                status: "ENABLED",
                startDate: "2026-01-01",
              },
              campaignBudget: {
                amountMicros: "50000000",
                explicitlyShared: true,
                type: "STANDARD",
                period: "DAILY",
              },
              segments: { date: "2026-09-30" },
              metrics: {
                costMicros: "10000000",
                conversions: 2,
                conversionsValue: 40,
                impressions: "100",
                clicks: "5",
              },
            },
          ],
        },
      ]);
    },
    now,
  );
  const accounts = await a.accounts(),
    s = await a.snapshot(accounts[0]!, 30);
  assert.equal(s.campaigns[0]?.metrics[0]?.spend, 10);
  assert.equal(s.campaigns[0]?.budget_kind, "shared");
  assert.equal(s.campaigns[0]?.daily_budget, 50);
  const queries = JSON.parse(
    readFileSync(
      new URL("../../fixtures/api/google-queries.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(
    calls.filter((c) => c.body).map((c) => c.body.query),
    [queries.customer, queries.campaign],
  );
  assert.ok(
    calls.every(
      (c) =>
        c.url.endsWith(":searchStream") ||
        c.url.endsWith(":listAccessibleCustomers"),
    ),
  );
  assert.ok(
    calls
      .filter((c) => c.body)
      .every((c) => c.body.query.startsWith("SELECT ")),
  );
});
test("invalid upstream numbers fail rather than fabricate zero", async () => {
  const a = new MetaAdapter(
    { access_token: "synthetic-not-a-token" },
    async (u) => {
      const x = metaResponse(String(u));
      if (String(u).includes("/insights")) (x as any).data[0].spend = "NaN";
      return Response.json(x);
    },
    now,
  );
  await assert.rejects(() =>
    a.snapshot(
      {
        account: "meta:act_123",
        platform: "meta",
        name: "Synthetic",
        currency: "JPY",
        timezone: "UTC",
        last_successful_read: null,
      },
      30,
    ),
  );
});
test("local state permissions, credential isolation and malformed-file failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pulse-test-"));
  try {
    const s = new LocalStore(dir);
    await s.write("credentials", { meta: { access_token: "synthetic" } });
    assert.equal(
      (await stat(join(dir, "credentials.json"))).mode & 0o777,
      0o600,
    );
    assert.equal((await stat(dir)).mode & 0o777, 0o700);
    assert.deepEqual(await s.read("credentials", {}), {
      meta: { access_token: "synthetic" },
    });
    await writeFile(join(dir, "credentials.json"), "bad json");
    await assert.rejects(() => s.read("credentials", {}));
    await assert.rejects(() => s.read("../escape", {}));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("whitespace is not a fabricated numerical zero", async () => {
  const a = new MetaAdapter(
    { access_token: "synthetic" },
    async (u) => {
      const x = metaResponse(String(u));
      if (String(u).includes("/insights")) x.data[0].spend = " ";
      return Response.json(x);
    },
    now,
  );
  await assert.rejects(() =>
    a.snapshot(
      {
        account: "meta:act_123",
        platform: "meta",
        name: "Synthetic",
        currency: "JPY",
        timezone: "UTC",
        last_successful_read: null,
      },
      30,
    ),
  );
});
