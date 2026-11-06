import { randomUUID } from "node:crypto";
import { AccountSnapshot, type Account, windowFor } from "../core/snapshot.js";
import type { Grant } from "./credentials.js";
import { jsonRequest, number, type Fetch } from "./http.js";
const api = "https://googleads.googleapis.com/v26/";
export class GoogleAdapter {
  constructor(
    private grant: Grant,
    private fetcher: Fetch = fetch,
    private now = new Date(),
  ) {}
  private headers(loginCustomerId = this.grant.login_customer_id) {
    if (!this.grant.developer_token)
      throw Error("Google developer token unavailable");
    return {
      Authorization: "Bearer " + this.grant.access_token,
      "developer-token": this.grant.developer_token,
      ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
      "Content-Type": "application/json",
    };
  }
  private async search(id: string, query: string, loginCustomerId?: string) {
    if (
      !/^\d+$/.test(id) ||
      !query.startsWith("SELECT ") ||
      !["FROM customer", "FROM campaign"].some((s) => query.includes(s))
    )
      throw Error("Google read refused");
    const pages = await jsonRequest(
      this.fetcher,
      new URL(api + "customers/" + id + "/googleAds:searchStream"),
      {
        method: "POST",
        headers: this.headers(loginCustomerId),
        body: JSON.stringify({ query }),
      },
      "googleads.googleapis.com",
    );
    if (!Array.isArray(pages) || pages.some((p) => p.error))
      throw Error("Invalid Google response");
    return pages.flatMap((p) => p.results ?? []);
  }
  async accounts(): Promise<Account[]> {
    const r = await jsonRequest(
      this.fetcher,
      new URL(api + "customers:listAccessibleCustomers"),
      { method: "GET", headers: this.headers() },
      "googleads.googleapis.com",
    );
    if (!Array.isArray(r.resourceNames))
      throw Error("Invalid Google customer list");
    const rows: Account[] = [];
    for (const name of r.resourceNames) {
      const id = String(name).replace(/^customers\//, "");
      for (const row of await this.search(
        id,
        "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer",
      )) {
        const c = row.customer;
        if (!c) throw Error("Invalid Google customer");
        if (c.manager) {
          const manager = String(c.id);
          const children = await this.search(
            manager,
            "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.manager FROM customer_client WHERE customer_client.manager = FALSE",
            manager,
          );
          for (const child of children) {
            const cc = child.customerClient;
            if (!cc || cc.manager) continue;
            rows.push({
              account: "google:" + cc.id,
              platform: "google",
              name: cc.descriptiveName ?? cc.id,
              currency: cc.currencyCode,
              timezone: cc.timeZone,
              login_customer_id: manager,
              last_successful_read: this.now.toISOString(),
            });
          }
          continue;
        }
        rows.push({
          account: "google:" + c.id,
          platform: "google",
          name: c.descriptiveName ?? c.id,
          currency: c.currencyCode,
          timezone: c.timeZone,
          last_successful_read: this.now.toISOString(),
        });
      }
    }
    return [...new Map(rows.map((a) => [a.account, a])).values()];
  }
  async snapshot(account: Account, days: number): Promise<AccountSnapshot> {
    const window = windowFor(days, this.now, account.timezone),
      rows = await this.search(
        account.account.slice(7),
        `SELECT campaign.id, campaign.name, campaign.status, campaign.start_date, campaign_budget.id, campaign_budget.amount_micros, campaign_budget.explicitly_shared, campaign_budget.type, campaign_budget.period, campaign_budget.total_amount_micros, segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${window.start_date}' AND '${window.end_date}'`,
        account.login_customer_id,
      );
    const map = new Map<string, any>();
    for (const row of rows) {
      const c = row.campaign,
        b = row.campaignBudget;
      if (!c?.id || !b) throw Error("Invalid Google campaign");
      let item = map.get(c.id);
      if (!item) {
        item = {
          id: c.id,
          name: c.name ?? c.id,
          status:
            c.status === "ENABLED"
              ? "active"
              : c.status === "PAUSED"
                ? "paused"
                : c.status === "REMOVED"
                  ? "archived"
                  : "unknown",
          start_date: c.startDate,
          currency: account.currency,
          daily_budget:
            b.period === "CUSTOM_PERIOD" || b.amountMicros === undefined
              ? null
              : number(b.amountMicros) / 1e6,
          ...(b.id ? { budget_id: String(b.id) } : {}),
          budget_kind: b.explicitlyShared
            ? "shared"
            : b.period === "CUSTOM_PERIOD"
              ? "lifetime"
              : b.period === "DAILY" && b.amountMicros !== undefined
                ? "daily"
                : "unknown",
          learning: "unknown",
          metrics: [],
        };
        map.set(c.id, item);
      }
      const m = row.metrics;
      if (!m || !row.segments?.date)
        throw Error("Missing Google daily metrics");
      item.metrics.push({
        date: row.segments.date,
        spend: number(m.costMicros, true) / 1e6,
        conversions: number(m.conversions, true),
        revenue: number(m.conversionsValue, true),
        impressions: number(m.impressions, true),
        clicks: number(m.clicks, true),
      });
    }
    return AccountSnapshot.parse({
      snapshot_id: randomUUID(),
      account: account.account,
      platform: "google",
      currency: account.currency,
      timezone: account.timezone,
      fetched_at: this.now.toISOString(),
      ...window,
      campaigns: [...map.values()],
    });
  }
}
