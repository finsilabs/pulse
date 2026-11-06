import { z } from "zod";
export const Platform = z.enum(["meta", "google"]);
export const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    "Invalid calendar date",
  );
const Nonnegative = z.number().finite().nonnegative();
export const Campaign = z.object({
  id: z.string().min(1),
  name: z.string(),
  status: z.enum(["active", "paused", "archived", "unknown"]),
  start_date: Day,
  currency: z.string().regex(/^[A-Z]{3}$/),
  daily_budget: Nonnegative.nullable(),
  budget_kind: z.enum(["daily", "lifetime", "shared", "unknown"]),
  budget_id: z.string().optional(),
  learning: z.enum(["learning", "stable", "unknown"]),
  metrics: z.array(
    z.object({
      date: Day,
      spend: Nonnegative,
      conversions: Nonnegative,
      revenue: Nonnegative,
      impressions: Nonnegative,
      clicks: Nonnegative,
    }),
  ),
});
export const AccountSnapshot = z
  .object({
    snapshot_id: z.string().min(1),
    account: z.string().min(1),
    platform: Platform,
    currency: z.string().regex(/^[A-Z]{3}$/),
    timezone: z.string().min(1),
    fetched_at: z.string().datetime(),
    start_date: Day,
    end_date: Day,
    campaigns: z.array(Campaign),
  })
  .superRefine((s, ctx) => {
    if (s.start_date > s.end_date)
      ctx.addIssue({ code: "custom", message: "Invalid window" });
    const ids = new Set();
    for (const c of s.campaigns) {
      if (ids.has(c.id))
        ctx.addIssue({ code: "custom", message: "Duplicate campaign" });
      ids.add(c.id);
      if (c.currency !== s.currency)
        ctx.addIssue({ code: "custom", message: "Mixed currencies" });
      const dates = new Set();
      for (const d of c.metrics) {
        if (d.date < s.start_date || d.date > s.end_date || dates.has(d.date))
          ctx.addIssue({
            code: "custom",
            message: "Duplicate or out-of-window daily row",
          });
        dates.add(d.date);
      }
    }
  });
export type Campaign = z.infer<typeof Campaign>;
export type AccountSnapshot = z.infer<typeof AccountSnapshot>;
export interface Account {
  login_customer_id?: string;
  account: string;
  platform: z.infer<typeof Platform>;
  name: string;
  currency: string;
  timezone: string;
  last_successful_read: string | null;
}
export interface Cooldown {
  applied_at: string;
  before: number;
  after: number;
  rule: string | null;
}
export interface Decision {
  play_id: string;
  campaign_id: string;
  decision: "applied" | "dismissed";
  at: string;
  note?: string;
}
export interface CampaignHistory {
  learning_hold_until?: string;
  cooldown?: Cooldown;
  decisions: Decision[];
  surfacings: string[];
}
export type History = Record<string, CampaignHistory>;
export function minorUnits(currency: string): number {
  return (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}
export function money(n: number, currency: string): number {
  const p = 10 ** minorUnits(currency);
  return Math.round((n + Number.EPSILON) * p) / p;
}
export function calendarDate(date: Date, timezone = "UTC") {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function windowFor(days: number, now = new Date(), timezone = "UTC") {
  const end = new Date(calendarDate(now, timezone) + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return {
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
  };
}
