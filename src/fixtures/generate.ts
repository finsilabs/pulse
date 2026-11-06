import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { AccountSnapshot, type Campaign, windowFor } from "../core/snapshot.js";
export const scenarios = [
  "healthy",
  "stop-loss",
  "cold-start",
  "learning",
  "shared-budget",
] as const;
export function syntheticSnapshot(
  scenario: string = "healthy",
  now = new Date(),
): AccountSnapshot {
  if (!scenarios.includes(scenario as any))
    throw Error("Unknown synthetic scenario");
  const window = windowFor(30, now);
  const campaign = (id: string, budget: number, roas: number): Campaign => ({
    id,
    name: "Synthetic " + id,
    status: "active",
    start_date: "2025-01-01",
    currency: "USD",
    daily_budget: budget,
    budget_kind: scenario === "shared-budget" ? "shared" : "daily",
    learning: scenario === "learning" ? "learning" : "stable",
    metrics: Array.from({ length: 30 }, (_, i) => {
      const d = new Date(window.start_date + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      const spend = scenario === "cold-start" ? 1 : 50;
      return {
        date: d.toISOString().slice(0, 10),
        spend,
        conversions: roas === 0 ? 0 : 2,
        revenue: spend * roas,
        impressions: 1000,
        clicks: 25,
      };
    }),
  });
  const s = {
    snapshot_id:
      "synthetic-" +
      createHash("sha256")
        .update(scenario + window.end_date)
        .digest("hex")
        .slice(0, 16),
    account: "meta:synthetic",
    platform: "meta",
    currency: "USD",
    timezone: "UTC",
    fetched_at: now.toISOString(),
    ...window,
    campaigns: [
      campaign("example-a", 100, scenario === "stop-loss" ? 0 : 4),
      campaign("example-b", 100, 1.8),
    ],
  };
  return AccountSnapshot.parse(s);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await mkdir("fixtures/accounts", { recursive: true });
  for (const scenario of scenarios)
    await writeFile(
      "fixtures/accounts/" + scenario + ".json",
      JSON.stringify(
        syntheticSnapshot(scenario, new Date("2026-10-02T12:00:00Z")),
        null,
        2,
      ) + "\n",
    );
}
