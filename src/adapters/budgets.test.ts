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
