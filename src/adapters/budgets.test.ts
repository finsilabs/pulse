import test from "node:test";
import assert from "node:assert/strict";
import { GoogleAdapter } from "./google.js";
import { MetaAdapter } from "./meta.js";
const account = {
  account: "google:123",
  platform: "google" as const,
  name: "Synthetic",
  currency: "USD",
  timezone: "UTC",
  last_successful_read: null,
};
test("Google custom-period budget is lifetime and unknown period never becomes daily", async () => {
  for (const period of ["CUSTOM_PERIOD", undefined]) {
    const a = new GoogleAdapter(
      { access_token: "synthetic", developer_token: "synthetic" },
      async () =>
        Response.json([
          {
            results: [
              {
                campaign: {
                  id: "x",
                  name: "Synthetic",
                  status: "ENABLED",
                  startDate: "2026-01-01",
                },
                campaignBudget: { amountMicros: "5000000", period },
                segments: { date: "2026-09-30" },
                metrics: { costMicros: "1000000" },
              },
            ],
          },
        ]),
      new Date("2026-10-02T12:00:00Z"),
    );
    const s = await a.snapshot(account, 30);
    assert.equal(s.campaigns[0]?.budget_kind, period ? "lifetime" : "unknown");
  }
});
test("Meta explicit zero campaign budget does not hide active ad-set budgets or become actionable", async () => {
  const a = new MetaAdapter(
    { access_token: "synthetic" },
    async (u) =>
      Response.json(
        String(u).includes("/campaigns")
          ? {
              data: [
                {
                  id: "x",
                  name: "Synthetic",
                  status: "ACTIVE",
                  start_time: "2026-01-01T00:00:00Z",
                  daily_budget: "0",
                },
              ],
            }
          : String(u).includes("/adsets")
            ? {
                data: [
                  {
                    campaign_id: "x",
                    effective_status: "ACTIVE",
                    daily_budget: "5000",
                    learning_stage_info: { status: "LEARNING" },
                  },
                ],
              }
            : { data: [] },
      ),
    new Date("2026-10-02T12:00:00Z"),
  );
  const s = await a.snapshot(
    { ...account, account: "meta:act_123", platform: "meta" },
    30,
  );
  assert.equal(s.campaigns[0]?.daily_budget, 50);
  assert.equal(s.campaigns[0]?.budget_kind, "unknown");
  assert.equal(s.campaigns[0]?.learning, "learning");
});
test("Google manager discovery reads children and uses their manager for later metrics", async () => {
  const seen: string[] = [];
  const a = new GoogleAdapter(
    { access_token: "synthetic", developer_token: "synthetic" },
    async (u, i) => {
      if (String(u).endsWith(":listAccessibleCustomers"))
        return Response.json({ resourceNames: ["customers/111"] });
      const query = JSON.parse(String(i?.body)).query,
        login = (i?.headers as Record<string, string>)["login-customer-id"];
      if (query.includes("FROM customer_client")) {
        assert.equal(login, "111");
        return Response.json([
          {
            results: [
              {
                customerClient: {
                  id: "222",
                  descriptiveName: "Synthetic child",
                  currencyCode: "USD",
                  timeZone: "UTC",
                  manager: false,
                },
              },
            ],
          },
        ]);
      }
      if (query.includes("FROM customer"))
        return Response.json([
          { results: [{ customer: { id: "111", manager: true } }] },
        ]);
      seen.push(login!);
      return Response.json([{ results: [] }]);
    },
    new Date("2026-10-02T12:00:00Z"),
  );
  const accounts = await a.accounts();
  assert.equal(accounts[0]?.account, "google:222");
  await a.snapshot(accounts[0]!, 30);
  assert.deepEqual(seen, ["111"]);
});
test("missing Google campaign status is unknown rather than fabricated archived", async () => {
  const a = new GoogleAdapter(
    { access_token: "synthetic", developer_token: "synthetic" },
    async () =>
      Response.json([
        {
          results: [
            {
              campaign: { id: "x", name: "Synthetic", startDate: "2026-01-01" },
              campaignBudget: { amountMicros: "5000000", period: "DAILY" },
              segments: { date: "2026-09-30" },
              metrics: { costMicros: "1000000" },
            },
          ],
        },
      ]),
    new Date("2026-10-02T12:00:00Z"),
  );
  assert.equal((await a.snapshot(account, 30)).campaigns[0]?.status, "unknown");
});
test("missing Meta campaign status is unknown rather than fabricated archived", async () => {
  const a = new MetaAdapter(
    { access_token: "synthetic" },
    async (u) =>
      Response.json(
        String(u).includes("/campaigns")
          ? {
              data: [
                {
                  id: "x",
                  name: "Synthetic",
                  start_time: "2026-01-01T00:00:00Z",
                  daily_budget: "5000",
                },
              ],
            }
          : { data: [] },
      ),
    new Date("2026-10-02T12:00:00Z"),
  );
  assert.equal(
    (
      await a.snapshot(
        { ...account, account: "meta:act_123", platform: "meta" },
        30,
      )
    ).campaigns[0]?.status,
    "unknown",
  );
});

// Literal expectations from Meta's published Marketing API currency offsets.
for (const [currency, raw, expected] of [
  ["TWD", "30000", 30000],
  ["CRC", "30000", 30000],
  ["BHD", "5000", 50],
  ["JOD", "5000", 50],
  ["PKR", "500000", 5000],
  ["USD", "5000", 50],
  ["JPY", "5000", 5000],
] as const) {
  for (const source of ["campaign", "adsets"] as const) {
    test(`Meta ${currency} ${source} budget uses provider offset`, async () => {
      const adapter = new MetaAdapter(
        { access_token: "synthetic" },
        async (u) =>
          Response.json({
            data: String(u).includes("/campaigns")
              ? [
                  {
                    id: "x",
                    status: "ACTIVE",
                    start_time: "2026-01-01",
                    ...(source === "campaign" ? { daily_budget: raw } : {}),
                  },
                ]
              : String(u).includes("/adsets") && source === "adsets"
                ? [
                    {
                      campaign_id: "x",
                      effective_status: "ACTIVE",
                      daily_budget: raw,
                    },
                    {
                      campaign_id: "x",
                      effective_status: "ACTIVE",
                      daily_budget: raw,
                    },
                    {
                      campaign_id: "x",
                      effective_status: "PAUSED",
                      daily_budget: raw,
                    },
                  ]
                : [],
          }),
        new Date("2026-10-02T12:00:00Z"),
      );
      const snapshot = await adapter.snapshot(
        { ...account, platform: "meta", account: "meta:act_123", currency },
        30,
      );
      assert.equal(
        snapshot.campaigns[0]?.daily_budget,
        expected * (source === "adsets" ? 2 : 1),
      );
    });
  }
}
test("Meta refuses unsupported currency even with no campaigns", async () => {
  let requests = 0;
  const adapter = new MetaAdapter({ access_token: "synthetic" }, async () => {
    requests++;
    return Response.json({ data: [] });
  });
  await assert.rejects(
    () =>
      adapter.snapshot(
        {
          ...account,
          platform: "meta",
          account: "meta:act_123",
          currency: "ZZZ",
        },
        30,
      ),
    /Unsupported Meta currency/,
  );
  assert.equal(requests, 0);
});
