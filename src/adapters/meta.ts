import { randomUUID } from "node:crypto";
import { AccountSnapshot, type Account, windowFor } from "../core/snapshot.js";
import type { Grant } from "./credentials.js";
import { jsonRequest, number, type Fetch } from "./http.js";
// Marketing API budget units, not ISO currency precision. Source (2026-11-06):
// https://developers.facebook.com/docs/marketing-api/currencies/
const budgetOffsets = new Map<string, number>([
  ..."CLP COP CRC HUF ISK IDR JPY KRW PYG TWD VND"
    .split(" ")
    .map((c): [string, number] => [c, 1]),
  ..."DZD ARS AUD BHD BDT BOB BGN BRL GBP CAD CNY HRK CZK DKK EGP EUR GTQ HNL HKD INR ILS JOD KES LVL LTL MOP MYR MXN NZD NIO NGN NOK PKR PEN PHP PLN QAR RON RUB SAR RSD SGD SKK ZAR SEK CHF THB TRY AED UAH USD UYU VEF FBZ VES"
    .split(" ")
    .map((c): [string, number] => [c, 100]),
]);
export class MetaAdapter {
  constructor(
    private grant: Grant,
    private fetcher: Fetch = fetch,
    private now = new Date(),
  ) {}
  private async list(path: string, params: Record<string, string> = {}) {
    let url = new URL("https://graph.facebook.com/v23.0/" + path);
    for (const [k, v] of Object.entries({ ...params, limit: "200" }))
      url.searchParams.set(k, v);
    const expectedPath = url.pathname;
    const rows: any[] = [];
    const visited = new Set();
    while (url) {
      if (visited.has(url.href) || visited.size >= 500)
        throw Error("Meta pagination limit");
      visited.add(url.href);
      const page = await jsonRequest(
        this.fetcher,
        url,
        {
          method: "GET",
          headers: { Authorization: "Bearer " + this.grant.access_token },
        },
        "graph.facebook.com",
      );
      if (!Array.isArray(page.data)) throw Error("Invalid Meta response");
      rows.push(...page.data);
      if (!page.paging?.next) break;
      url = new URL(page.paging.next);
      // Meta may return paging.next on a newer API version than the one we pinned.
      const unversioned = (path: string) => path.replace(/^\/v\d+\.\d+\//, "/");
      if (
        url.hostname !== "graph.facebook.com" ||
        unversioned(url.pathname) !== unversioned(expectedPath) ||
        url.searchParams.has("method")
      )
        throw Error("Meta pagination URL refused");
      url.pathname = expectedPath;
    }
    return rows;
  }
  async accounts(): Promise<Account[]> {
    return (
      await this.list("me/adaccounts", {
        fields: "id,name,currency,timezone_name",
      })
    ).map((a) => ({
      account: "meta:" + a.id,
      platform: "meta",
      name: a.name ?? a.id,
      currency: a.currency,
      timezone: a.timezone_name,
      last_successful_read: this.now.toISOString(),
    }));
  }
  async snapshot(account: Account, days: number): Promise<AccountSnapshot> {
    const id = account.account.slice(5);
    if (!/^act_\d+$/.test(id)) throw Error("Invalid Meta account");
    const factor = budgetOffsets.get(account.currency);
    if (factor === undefined) throw Error("Unsupported Meta currency");
    const window = windowFor(days, this.now, account.timezone),
      campaigns = await this.list(id + "/campaigns", {
        fields:
          "id,name,status,start_time,created_time,daily_budget,lifetime_budget",
      }),
      sets = await this.list(id + "/adsets", {
        fields:
          "campaign_id,daily_budget,lifetime_budget,effective_status,learning_stage_info",
      }),
      insights = await this.list(id + "/insights", {
        level: "campaign",
        time_increment: "1",
        time_range: JSON.stringify({
          since: window.start_date,
          until: window.end_date,
        }),
        fields:
          "campaign_id,date_start,spend,impressions,clicks,actions,action_values",
      });
    const purchase = (rows: any[] | undefined) => {
      for (const type of [
        "purchase",
        "omni_purchase",
        "offsite_conversion.fb_pixel_purchase",
      ]) {
        const r = rows?.find((x) => x.action_type === type);
        if (r) return number(r.value);
      }
      return 0;
    };
    return AccountSnapshot.parse({
      snapshot_id: randomUUID(),
      account: account.account,
      platform: "meta",
      currency: account.currency,
      timezone: account.timezone,
      fetched_at: this.now.toISOString(),
      ...window,
      campaigns: campaigns.map((c) => {
        const activeSets = sets.filter(
            (s) => s.campaign_id === c.id && s.effective_status === "ACTIVE",
          ),
          states = activeSets.map((s) => s.learning_stage_info?.status);
        const daily =
          c.daily_budget !== undefined && number(c.daily_budget) > 0
            ? number(c.daily_budget) / factor
            : activeSets.length &&
                activeSets.every((s) => s.daily_budget !== undefined)
              ? activeSets.reduce(
                  (n, s) => n + number(s.daily_budget) / factor,
                  0,
                )
              : null;
        return {
          id: c.id,
          name: c.name ?? c.id,
          status:
            c.status === "ACTIVE"
              ? "active"
              : c.status === "PAUSED"
                ? "paused"
                : ["ARCHIVED", "DELETED"].includes(c.status)
                  ? "archived"
                  : "unknown",
          start_date: (c.start_time ?? c.created_time)?.slice(0, 10),
          currency: account.currency,
          daily_budget: daily,
          budget_kind:
            c.lifetime_budget && number(c.lifetime_budget) > 0
              ? "lifetime"
              : c.daily_budget !== undefined && number(c.daily_budget) > 0
                ? "daily"
                : "unknown",
          learning: states.some(
            (s) => s === "LEARNING" || s === "LEARNING_LIMITED",
          )
            ? "learning"
            : states.length && states.every((s) => s === "SUCCESS")
              ? "stable"
              : "unknown",
          metrics: insights
            .filter((r) => r.campaign_id === c.id)
            .map((r) => ({
              date: r.date_start,
              spend: number(r.spend),
              impressions: number(r.impressions),
              clicks: number(r.clicks),
              conversions: purchase(r.actions),
              revenue: purchase(r.action_values),
            })),
        };
      }),
    });
  }
}
