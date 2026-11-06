import type { AccountSnapshot, Campaign } from "./snapshot.js";
import type { Config } from "./config.js";
export function signals(c: Campaign, s: AccountSnapshot, cfg: Config) {
  const end = Date.parse(s.end_date + "T00:00:00Z"),
    start = end - 6 * 86400000,
    seven = c.metrics.filter((d) => Date.parse(d.date + "T00:00:00Z") >= start);
  const sum = (
    rows: typeof c.metrics,
    key: "spend" | "revenue" | "conversions",
  ) => rows.reduce((n, r) => n + r[key], 0);
  const spend = sum(c.metrics, "spend"),
    revenue = sum(c.metrics, "revenue"),
    conversions = sum(c.metrics, "conversions"),
    spend7 = sum(seven, "spend"),
    revenue7 = sum(seven, "revenue");
  return {
    spend,
    revenue,
    conversions,
    spend7,
    revenue7,
    cpa: conversions > 0 ? spend / conversions : null,
    roas: spend > 0 ? revenue / spend : null,
    days_active: Math.max(
      0,
      Math.floor((end - Date.parse(c.start_date + "T00:00:00Z")) / 86400000) +
        1,
    ),
    confidence: Math.min(1, spend7 / cfg.confidence_spend_anchor) * 0.7,
    cold_start: spend7 < 350,
  };
}
export function targets(c: Campaign, s: AccountSnapshot, cfg: Config) {
  return (
    cfg.targets[c.id] ??
    cfg.targets[s.platform] ?? {
      target_cpa: cfg.target_cpa,
      target_roas: cfg.target_roas,
    }
  );
}
export function rng(seed: number) {
  let n = seed >>> 0;
  return () => {
    n = (1664525 * n + 1013904223) >>> 0;
    return n / 4294967296;
  };
}
