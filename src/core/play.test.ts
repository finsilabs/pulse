import test from "node:test";
import assert from "node:assert/strict";
import { buildPlay, evaluateRule, proposeMove } from "./play.js";
import { defaultConfig, setConfig } from "./config.js";
import { AccountSnapshot, type Campaign, windowFor } from "./snapshot.js";
const campaign = (x: Partial<Campaign> = {}): Campaign => ({
  id: "campaign-a",
  name: "Example campaign",
  status: "active",
  start_date: "2026-01-01",
  currency: "USD",
  daily_budget: 100,
  budget_kind: "daily",
  learning: "stable",
  metrics: Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 8, i + 1)).toISOString().slice(0, 10),
    spend: 20,
    conversions: 1,
    revenue: 50,
    impressions: 100,
    clicks: 5,
  })),
  ...x,
});
const snap = (campaigns = [campaign()]): AccountSnapshot => ({
  snapshot_id: "synthetic",
  account: "meta:example",
  platform: "meta",
  currency: "USD",
  timezone: "UTC",
  fetched_at: "2026-10-02T12:00:00Z",
  start_date: "2026-09-01",
  end_date: "2026-09-30",
  campaigns,
});
const config = defaultConfig(),
  now = new Date("2026-10-02T12:00:00Z");
test("PR1 stop loss fires at 2x target CPA with zero conversions and age >=5 days; mature healthy campaign does not", () => {
  const c = campaign({
    metrics: [
      {
        date: "2026-09-30",
        spend: 100,
        conversions: 0,
        revenue: 0,
        impressions: 100,
        clicks: 5,
      },
    ],
  });
  assert.equal(evaluateRule(c, snap([c]), config, undefined, now)?.id, "PR1");
  assert.equal(evaluateRule(c, snap([c]), config, undefined, now)?.budget, 50);
  assert.equal(evaluateRule(campaign(), snap(), config, undefined, now), null);
});
test("sufficiency and young campaigns veto stop loss", () => {
  for (const c of [
    campaign({
      metrics: [
        {
          date: "2026-09-30",
          spend: 20,
          conversions: 0,
          revenue: 0,
          impressions: 1,
          clicks: 1,
        },
      ],
    }),
    campaign({
      start_date: "2026-09-29",
      metrics: [
        {
          date: "2026-09-30",
          spend: 100,
          conversions: 0,
          revenue: 0,
          impressions: 1,
          clicks: 1,
        },
      ],
    }),
  ])
    assert.equal(evaluateRule(c, snap([c]), config, undefined, now), null);
});
test("PR2 sunsetting needs old campaign and both CPA and ROAS failures", () => {
  const c = campaign({
    metrics: [
      {
        date: "2026-09-30",
        spend: 200,
        conversions: 1,
        revenue: 50,
        impressions: 1,
        clicks: 1,
      },
    ],
  });
  assert.equal(evaluateRule(c, snap([c]), config, undefined, now)?.id, "PR2");
  assert.equal(evaluateRule(c, snap([c]), config, undefined, now)?.budget, 50);
  assert.equal(
    evaluateRule(
      { ...c, metrics: c.metrics.map((m) => ({ ...m, revenue: 500 })) },
      snap([c]),
      config,
      undefined,
      now,
    ),
    null,
  );
});
test("PR5 account-relative needs three mature campaigns and sufficiency", () => {
  const c = campaign({
      id: "bad",
      metrics: [
        {
          date: "2026-09-30",
          spend: 200,
          conversions: 2,
          revenue: 500,
          impressions: 1,
          clicks: 1,
        },
      ],
    }),
    good = campaign({ id: "good" }),
    other = campaign({ id: "other" });
  assert.equal(
    evaluateRule(c, snap([c, good, other]), config, undefined, now)?.id,
    "PR5",
  );
  assert.equal(
    evaluateRule(c, snap([c, good, other]), config, undefined, now)?.budget,
    70,
  );
  assert.equal(evaluateRule(c, snap([c, good]), config, undefined, now), null);
});
test("PR6 restores only a reported applied cut within cooldown and post-cut ROAS >1", () => {
  const c = campaign({ daily_budget: 50 });
  const h = {
    decisions: [],
    surfacings: [],
    cooldown: {
      applied_at: "2026-09-28T00:00:00Z",
      before: 100,
      after: 50,
      rule: "PR1",
    },
  };
  assert.equal(evaluateRule(c, snap([c]), config, h, now)?.id, "PR6");
  assert.equal(evaluateRule(c, snap([c]), config, h, now)?.budget, 100);
  assert.equal(
    evaluateRule(
      { ...c, metrics: c.metrics.map((m) => ({ ...m, revenue: 0 })) },
      snap([c]),
      config,
      h,
      now,
    ),
    null,
  );
});
test("deterministic play holds protected, low confidence, paused and shared budgets, respects total", () => {
  const s = snap([
      campaign(),
      campaign({ id: "shared", budget_kind: "shared" }),
      campaign({ id: "paused", status: "paused" }),
      campaign({ id: "protected" }),
      campaign({ id: "low", metrics: [] }),
    ]),
    cfg = { ...config, protected_campaigns: ["protected"] };
  const a = buildPlay(s, cfg, {}, now, 500);
  assert.deepEqual(a, buildPlay(s, cfg, {}, now, 500));
  for (const id of ["shared", "paused", "protected", "low"])
    assert.ok(a.hold.some((row) => row.campaign_id === id));
  assert.ok(
    [...a.scale, ...a.shift, ...a.hold, ...a.watching].reduce(
      (n, r) => n + (r.to ?? 0),
      0,
    ) <= 500,
  );
  assert.equal(a.basis, "roas");
});
test("a cut proposal never claims application; refuses expired, small and shared moves", () => {
  const c = campaign({
      metrics: [
        {
          date: "2026-09-30",
          spend: 100,
          conversions: 0,
          revenue: 0,
          impressions: 1,
          clicks: 1,
        },
      ],
    }),
    p = buildPlay(snap([c]), config, {}, now);
  assert.equal(proposeMove(p, c.id, now).applied, false);
  assert.throws(() => proposeMove(p, c.id, new Date("2026-10-05T00:00:00Z")));
  assert.throws(() =>
    proposeMove(
      buildPlay(snap([campaign({ budget_kind: "shared" })]), config, {}, now),
      "campaign-a",
      now,
    ),
  );
});
test("boundary rejects NaN, duplicate dates, mixed currencies and malformed config", () => {
  assert.throws(() =>
    AccountSnapshot.parse(snap([campaign({ daily_budget: NaN })])),
  );
  assert.throws(() =>
    AccountSnapshot.parse(snap([campaign({ currency: "EUR" })])),
  );
  assert.throws(() =>
    AccountSnapshot.parse(
      snap([
        campaign({ metrics: [campaign().metrics[0]!, campaign().metrics[0]!] }),
      ]),
    ),
  );
  assert.throws(() => setConfig(config, "max_move_pct", 0.9));
  assert.throws(() => setConfig(config, "__proto__", {}));
});
test("window excludes latest complete day and preserves calendar dates", () =>
  assert.deepEqual(windowFor(30, new Date("2026-10-02T00:01:00Z")), {
    start_date: "2026-09-01",
    end_date: "2026-09-30",
  }));
test("PR4 learning guard only fires for a learning campaign with >20% raw curve move", () => {
  const c = campaign({ learning: "learning" });
  assert.equal(
    evaluateRule(c, snap([c]), config, undefined, now, 0.21)?.id,
    "PR4",
  );
  assert.equal(evaluateRule(c, snap([c]), config, undefined, now, 0.2), null);
  assert.equal(
    evaluateRule(
      { ...c, learning: "stable" },
      snap([c]),
      config,
      undefined,
      now,
      0.5,
    ),
    null,
  );
});
test("budgets never increase beyond 20%, stale snapshots are refused, low confidence holds", () => {
  const p = buildPlay(
    snap([
      campaign({
        id: "strong",
        daily_budget: 100,
        metrics: campaign().metrics.map((m) => ({
          ...m,
          spend: 100,
          revenue: 400,
          conversions: 5,
        })),
      }),
      campaign({
        id: "weaker",
        daily_budget: 100,
        metrics: campaign().metrics.map((m) => ({
          ...m,
          spend: 100,
          revenue: 125,
          conversions: 3,
        })),
      }),
    ]),
    config,
    {},
    now,
  );
  assert.equal(p.scale.length, 1);
  assert.equal(p.scale[0]?.campaign_id, "strong");
  assert.equal(p.scale[0]?.to, 120);
  assert.equal(p.shift.find((r) => r.campaign_id === "weaker")?.to, 80);
  for (const r of p.scale) assert.ok(r.to! <= r.from! * 1.2);
  assert.throws(() =>
    buildPlay(snap(), config, {}, new Date("2026-11-01T12:00:00Z")),
  );
  const low = buildPlay(snap([campaign({ metrics: [] })]), config, {}, now);
  assert.equal(low.hold.length, 1);
  assert.equal(low.hold[0]?.from, low.hold[0]?.to);
});
test("account-local date window avoids crossing midnight in another time zone", () => {
  assert.deepEqual(
    windowFor(7, new Date("2026-10-02T00:30:00Z"), "America/Los_Angeles"),
    { start_date: "2026-09-23", end_date: "2026-09-29" },
  );
});
test("cooldown post-cut ROAS excludes the partially observed cut day", () => {
  const c = campaign({
    daily_budget: 50,
    metrics: [
      {
        date: "2026-09-28",
        spend: 1,
        conversions: 1,
        revenue: 100,
        impressions: 1,
        clicks: 1,
      },
      {
        date: "2026-09-29",
        spend: 50,
        conversions: 0,
        revenue: 0,
        impressions: 1,
        clicks: 1,
      },
    ],
  });
  assert.equal(
    evaluateRule(
      c,
      snap([c]),
      config,
      {
        decisions: [],
        surfacings: [],
        cooldown: {
          applied_at: "2026-09-28T22:00:00Z",
          before: 100,
          after: 50,
          rule: "PR1",
        },
      },
      now,
    ),
    null,
  );
});
test("recorded learning hold persists for three days but not forever", () => {
  const h = {
    decisions: [],
    surfacings: [],
    learning_hold_until: "2026-10-04T00:00:00Z",
  };
  assert.equal(evaluateRule(campaign(), snap(), config, h, now, 0)?.id, "PR4");
  assert.equal(
    evaluateRule(
      campaign(),
      snap(),
      config,
      h,
      new Date("2026-10-05T00:00:00Z"),
      0,
    ),
    null,
  );
});
test("shared daily pool is counted once rather than once per campaign", () => {
  const shared1 = campaign({
      id: "shared-1",
      budget_kind: "shared",
      budget_id: "shared-budget",
    }),
    shared2 = campaign({
      id: "shared-2",
      budget_kind: "shared",
      budget_id: "shared-budget",
    });
  const p = buildPlay(snap([shared1, shared2, campaign()]), config, {}, now);
  assert.equal(p.total_budget.value, 200);
  assert.equal(p.hold.filter((r) => r.budget_kind === "shared").length, 2);
});
test("stop-loss floor never increases a budget already below the floor", () => {
  const c = campaign({
    daily_budget: 2,
    metrics: campaign().metrics.map((m) => ({
      ...m,
      spend: 100,
      revenue: 0,
      conversions: 0,
    })),
  });
  assert.equal(evaluateRule(c, snap([c]), config, undefined, now)?.budget, 2);
  const p = buildPlay(
    snap([c, campaign({ id: "other", metrics: c.metrics })]),
    config,
    {},
    now,
  );
  assert.ok(!p.scale.some((r) => r.campaign_id === c.id));
});
test("all mature zero-value curves hold rather than allocating all money to the first campaign", () => {
  const a = campaign({
      id: "young-a",
      start_date: "2026-09-29",
      daily_budget: 10,
      metrics: [
        {
          date: "2026-09-30",
          spend: 700,
          conversions: 0,
          revenue: 0,
          clicks: 10,
          impressions: 100,
        },
      ],
    }),
    b = { ...a, id: "young-b", daily_budget: 100 };
  const p = buildPlay(snap([a, b]), config, {}, now);
  assert.equal(p.scale.length, 0);
  assert.equal(p.shift.length, 0);
  assert.equal(p.hold.length, 2);
});
test("post-cut evidence excludes the cut calendar day in the account timezone", () => {
  const c = campaign({
      daily_budget: 50,
      metrics: [
        {
          date: "2026-09-29",
          spend: 1,
          conversions: 1,
          revenue: 100,
          impressions: 1,
          clicks: 1,
        },
        {
          date: "2026-09-30",
          spend: 50,
          conversions: 0,
          revenue: 0,
          impressions: 1,
          clicks: 1,
        },
      ],
    }),
    s = { ...snap([c]), timezone: "Pacific/Auckland" };
  assert.equal(
    evaluateRule(
      c,
      s,
      config,
      {
        decisions: [],
        surfacings: [],
        cooldown: {
          applied_at: "2026-09-28T20:00:00Z",
          before: 100,
          after: 50,
          rule: "PR1",
        },
      },
      now,
    ),
    null,
  );
});
