import { createHash } from "node:crypto";
import {
  AccountSnapshot,
  calendarDate,
  money,
  minorUnits,
  type Campaign,
  type History,
  type CampaignHistory,
} from "./snapshot.js";
import { Config } from "./config.js";
import { signals, targets, rng } from "./signals.js";
export interface Rule {
  id: "PR1" | "PR2" | "PR4" | "PR5" | "PR6";
  budget: number;
  reason: string;
}
export interface PlayRow {
  campaign_id: string;
  campaign_name: string;
  platform: string;
  currency: string;
  from: number | null;
  to: number | null;
  current_daily_budget: {
    value: number | null;
    currency: string;
    basis: "observed";
  };
  proposed_daily_budget: {
    value: number | null;
    currency: string;
    basis: "estimated";
  };
  change_pct: number | null;
  confidence: number;
  marginal_return_per_extra_unit: number | null;
  source: "curve" | "rules" | "curve_blend";
  rule_id: string | null;
  reason: string;
  evidence: ReturnType<typeof signals> & {
    window: { start_date: string; end_date: string };
    target_cpa: number;
    target_roas: number;
    cooldown: CampaignHistory["cooldown"] | null;
    clamps: string[];
  };
  budget_kind: Campaign["budget_kind"];
}
export interface Play {
  play_id: string;
  snapshot_id: string;
  account: string;
  platform: string;
  currency: string;
  basis: "roas";
  generated_at: string;
  expires_at: string;
  scale: PlayRow[];
  shift: PlayRow[];
  hold: PlayRow[];
  watching: PlayRow[];
  warnings: string[];
  total_budget: {
    value: number;
    currency: string;
    basis: "observed" | "estimated";
  };
  synthetic?: boolean;
}
const hours = (a: string, b: Date) => (b.getTime() - Date.parse(a)) / 3600000;
export function evaluateRule(
  c: Campaign,
  s: AccountSnapshot,
  cfg: Config,
  h: CampaignHistory | undefined,
  now: Date,
  rawCurveMove = 0,
): Rule | null {
  const v = signals(c, s, cfg),
    t = targets(c, s, cfg),
    current = c.daily_budget;
  if (current === null) return null;
  if (
    (h?.learning_hold_until &&
      Date.parse(h.learning_hold_until) > now.getTime()) ||
    (c.learning === "learning" && Math.abs(rawCurveMove) > 0.2)
  )
    return {
      id: "PR4",
      budget: current,
      reason: "Learning protection: hold a raw curve move over 20%.",
    };
  const cooldown = h?.cooldown;
  if (
    cooldown &&
    hours(cooldown.applied_at, now) >= 0 &&
    hours(cooldown.applied_at, now) < 14 * 24
  ) {
    const since = c.metrics.filter(
      (d) => d.date > calendarDate(new Date(cooldown.applied_at), s.timezone),
    );
    const spend = since.reduce((n, d) => n + d.spend, 0),
      revenue = since.reduce((n, d) => n + d.revenue, 0);
    if (
      cooldown.after < cooldown.before &&
      Math.abs(current - cooldown.after) < 0.01 &&
      spend > 0 &&
      revenue / spend > 1
    )
      return {
        id: "PR6",
        budget: cooldown.before,
        reason:
          "Post-cut observed ROAS exceeds 1 during the reported cut cooldown; propose restoration.",
      };
    return null;
  }
  if (v.spend < 2 * t.target_cpa && v.spend < 50) return null;
  if (v.days_active >= 5 && v.spend >= 2 * t.target_cpa && v.conversions === 0)
    return {
      id: "PR1",
      budget: Math.min(current, Math.max(5, current * 0.5)),
      reason:
        "Stop-loss: zero conversions after at least twice target CPA and five days active.",
    };
  if (
    v.days_active >= 14 &&
    v.cpa !== null &&
    v.cpa > 1.5 * t.target_cpa &&
    v.roas !== null &&
    v.roas < 0.5 * t.target_roas
  )
    return {
      id: "PR2",
      budget: current * 0.5,
      reason:
        "Sunsetting: CPA exceeds 1.5× target and ROAS is below half target after 14 days.",
    };
  const mature = s.campaigns.filter(
      (x) => x.status === "active" && signals(x, s, cfg).days_active >= 14,
    ),
    pool = mature.map((x) => signals(x, s, cfg)),
    accountConversions = pool.reduce((n, x) => n + x.conversions, 0),
    accountSpend = pool.reduce((n, x) => n + x.spend, 0),
    average = accountConversions > 0 ? accountSpend / accountConversions : null;
  if (
    mature.length >= 3 &&
    average !== null &&
    v.cpa !== null &&
    v.cpa >= 1.5 * average &&
    v.spend >= 2 * average
  )
    return {
      id: "PR5",
      budget: current * 0.7,
      reason:
        "Account-relative: CPA at least 1.5× the mature account average with sufficient spend.",
    };
  return null;
}
function hash(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 24);
}
export function buildPlay(
  raw: AccountSnapshot,
  rawConfig: Config,
  history: History = {},
  now = new Date(),
  totalBudget?: number,
): Play {
  const s = AccountSnapshot.parse(raw),
    cfg = Config.parse(rawConfig),
    age = now.getTime() - Date.parse(s.fetched_at);
  if (age < -300000 || age > 86400000) throw Error("Fresh snapshot required");
  const sumBudgets = (
    items: Campaign[],
    values?: Map<string, number | null>,
  ) => {
    const seen = new Set<string>();
    return items.reduce((n, c) => {
      const key =
        c.budget_kind === "shared" && c.budget_id
          ? "shared:" + c.budget_id
          : "campaign:" + c.id;
      if (seen.has(key)) return n;
      seen.add(key);
      return n + (values ? (values.get(c.id) ?? 0) : (c.daily_budget ?? 0));
    }, 0);
  };
  const observed = sumBudgets(s.campaigns),
    total = totalBudget ?? observed;
  if (!Number.isFinite(total) || total < 0) throw Error("Invalid total budget");
  const beta = cfg.elasticities[s.platform],
    random = rng(cfg.seed),
    rows: PlayRow[] = [],
    warnings: string[] = [
      "ROAS uses platform-attributed revenue, not incrementality or lifetime value. Targets and floors use the account currency.",
    ];
  const locked = (c: Campaign) =>
    c.status !== "active" ||
    cfg.protected_campaigns.includes(c.id) ||
    c.budget_kind !== "daily" ||
    c.daily_budget === null ||
    c.daily_budget <= 0;
  const eligible = s.campaigns.filter((c) => !locked(c)),
    fixed = sumBudgets(s.campaigns.filter(locked)),
    pool = Math.max(0, total - fixed);
  if (s.campaigns.some((c) => c.budget_kind === "shared" && !c.budget_id))
    warnings.push(
      "Shared-budget identifiers are unavailable; the reported campaign budget sum may repeat shared pools. Do not treat it as a verified account spending cap.",
    );
  if (fixed > total)
    warnings.push(
      "Requested budget is infeasible: held/protected budgets already exceed it. No forced cuts were made.",
    );
  const curves = eligible.map((c) => {
      const v = signals(c, s, cfg),
        dailySpend = v.spend7 / 7,
        roas = v.cold_start
          ? s.platform === "meta"
            ? 1
            : 1.1
          : v.spend7 > 0
            ? v.revenue7 / v.spend7
            : 0;
      const k = dailySpend > 0 ? roas * Math.pow(dailySpend, 1 - beta) : 0;
      return { c, v, k, allocated: 0 };
    }),
    step = pool / 200;
  const hasValue = curves.some((item) => item.k > 0);
  if (!hasValue)
    for (const item of curves) item.allocated = item.c.daily_budget ?? 0;
  for (let i = 0; i < 200 && curves.length && hasValue; i++) {
    let best = curves[0]!,
      score = -Infinity;
    for (const item of curves) {
      const marginal =
        item.k *
        (Math.pow(item.allocated + step, beta) -
          Math.pow(item.allocated, beta));
      const adjusted =
        marginal * (1 + (2 * random() - 1) * 0.5 * (1 - item.v.confidence));
      if (adjusted > score) {
        score = adjusted;
        best = item;
      }
    }
    best.allocated += step;
  }
  for (const c of s.campaigns) {
    const v = signals(c, s, cfg),
      t = targets(c, s, cfg),
      h = history[c.id],
      item = curves.find((x) => x.c.id === c.id),
      current = c.daily_budget,
      clamps: string[] = [];
    let proposed = current,
      source: PlayRow["source"] = "curve",
      reason = "No meaningful change.",
      rule: Rule | null = null;
    const decisionToday = h?.decisions.some(
      (d) =>
        calendarDate(new Date(d.at), s.timezone) ===
        calendarDate(now, s.timezone),
    );
    let suppress = false;
    if (locked(c)) {
      reason = cfg.protected_campaigns.includes(c.id)
        ? "Protected campaign: hold."
        : c.status !== "active"
          ? c.status === "unknown"
            ? "Campaign status unavailable: hold."
            : "Inactive campaign: hold."
          : "Budget is shared, lifetime, unknown or not an actionable positive campaign daily budget.";
    } else if (current !== null && item) {
      const rawMove = (item.allocated - current) / current;
      rule = evaluateRule(c, s, cfg, h, now, rawMove);
      if (rule?.id === "PR4") {
        reason = rule.reason;
        source = "rules";
      } else {
        const damped =
          v.confidence >= cfg.min_confidence
            ? Math.max(
                -cfg.max_move_pct,
                Math.min(cfg.max_move_pct, rawMove * v.confidence),
              )
            : 0;
        proposed = current * (1 + damped);
        if (Math.abs(rawMove * v.confidence) > cfg.max_move_pct)
          clamps.push("max_move_pct");
        reason =
          v.confidence < cfg.min_confidence
            ? "Confidence below threshold: hold curve allocation."
            : "Damped marginal-ROAS allocation.";
        if (
          rule &&
          ((rule.id === "PR6" && rule.budget > proposed) ||
            (rule.id !== "PR6" && rule.budget < proposed))
        ) {
          proposed = rule.budget;
          source = proposed === current ? "rules" : "curve_blend";
          reason = rule.reason;
        }
        const cooldown = h?.cooldown;
        if (
          cooldown &&
          hours(cooldown.applied_at, now) < 48 &&
          hours(cooldown.applied_at, now) >= 0 &&
          Math.abs(proposed - current) > 0.2 * current
        ) {
          proposed = current + Math.sign(proposed - current) * 0.2 * current;
          clamps.push("48h_large_move_cooldown");
        }
        const ceiling = cfg.ceilings[c.id];
        if (ceiling !== undefined && proposed > ceiling) {
          proposed = ceiling;
          clamps.push("campaign_ceiling");
        }
        if (proposed > current * (1 + cfg.daily_increase_cap_pct)) {
          proposed = current * (1 + cfg.daily_increase_cap_pct);
          clamps.push("daily_increase_cap_pct");
        }
        proposed = Math.max(0, money(proposed, s.currency));
        if (
          proposed > current &&
          proposed > current * (1 + cfg.daily_increase_cap_pct)
        ) {
          const unit = 10 ** minorUnits(s.currency);
          proposed =
            Math.floor(current * (1 + cfg.daily_increase_cap_pct) * unit) /
            unit;
        }
        if (Math.abs(proposed - current) / current < 0.01) {
          proposed = current;
          reason = "Move below 1%: hold.";
        }
      }
      if (decisionToday) {
        proposed = current;
        reason = "Already applied or dismissed today: hold.";
      } else if (
        h?.surfacings.some((at) => hours(at, now) >= 0 && hours(at, now) < 72)
      ) {
        proposed = current;
        reason = "Shown within 72 hours; watching.";
        suppress = true;
      } else if ((h?.surfacings.length ?? 0) >= 3) {
        const latest = h!.surfacings.at(-1)!;
        const answered = h!.decisions.some(
          (d) => Date.parse(d.at) >= Date.parse(h!.surfacings.at(-3)!),
        );
        if (!answered && hours(latest, now) < 7 * 24) {
          proposed = current;
          reason = "Three unanswered surfacings; weekly watch.";
          suppress = true;
        }
      }
    }
    if (c.learning === "unknown")
      warnings.push("Learning state unavailable for " + c.id + ".");
    const row: PlayRow = {
      campaign_id: c.id,
      campaign_name: c.name,
      platform: s.platform,
      currency: s.currency,
      from: current,
      to: proposed,
      current_daily_budget: {
        value: current,
        currency: s.currency,
        basis: "observed",
      },
      proposed_daily_budget: {
        value: proposed,
        currency: s.currency,
        basis: "estimated",
      },
      change_pct:
        current && proposed !== null ? (proposed - current) / current : null,
      confidence: v.confidence,
      marginal_return_per_extra_unit:
        item && proposed !== null && proposed > 0
          ? beta * item.k * Math.pow(proposed, beta - 1)
          : null,
      source,
      rule_id: rule?.id ?? null,
      reason,
      evidence: {
        ...v,
        window: { start_date: s.start_date, end_date: s.end_date },
        ...t,
        cooldown: h?.cooldown ?? null,
        clamps,
      },
      budget_kind: c.budget_kind,
    };
    if (suppress) row.reason = "Watching: " + reason;
    rows.push(row);
  }
  // Reconcile by trimming increases only. Cuts do not force a different campaign to spend.
  let excess =
    sumBudgets(s.campaigns, new Map(rows.map((r) => [r.campaign_id, r.to]))) -
    total;
  for (const r of rows
    .filter((r) => r.to !== null && r.from !== null && r.to > r.from)
    .sort((a, b) => a.confidence - b.confidence)) {
    if (excess <= 0) break;
    const cut = Math.min(excess, r.to! - r.from!);
    const precision = 10 ** minorUnits(s.currency);
    const target = Math.max(
      r.from!,
      Math.floor((r.to! - cut) * precision) / precision,
    );
    excess -= r.to! - target;
    r.to = target;
    r.proposed_daily_budget.value = target;
    r.change_pct = r.from! > 0 ? (target - r.from!) / r.from! : null;
    r.evidence.clamps.push("account_total_budget");
  }
  if (excess > 0.01 && !warnings.some((w) => w.includes("infeasible")))
    warnings.push(
      "Requested budget is infeasible under current holds and move limits; no extra forced cuts were made.",
    );
  const play: Play = {
    play_id: hash([
      s.snapshot_id,
      cfg,
      history,
      calendarDate(now, s.timezone),
      total,
    ]),
    snapshot_id: s.snapshot_id,
    account: s.account,
    platform: s.platform,
    currency: s.currency,
    basis: "roas",
    generated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 48 * 3600000).toISOString(),
    scale: [],
    shift: [],
    hold: [],
    watching: [],
    warnings: [...new Set(warnings)],
    total_budget: {
      value: total,
      currency: s.currency,
      basis: totalBudget === undefined ? "observed" : "estimated",
    },
  };
  for (const r of rows) {
    if (
      r.from !== null &&
      r.to !== null &&
      r.to > r.from &&
      Math.abs(r.change_pct ?? 0) < 0.01
    ) {
      r.to = r.from;
      r.proposed_daily_budget.value = r.from;
      r.change_pct = 0;
      r.reason = "Reconciled move below 1%: hold.";
    }
  }
  for (const r of rows) {
    if (r.reason.startsWith("Watching:")) play.watching.push(r);
    else if (
      r.to !== null &&
      r.from !== null &&
      r.to > r.from &&
      Math.abs(r.change_pct ?? 0) >= 0.01
    )
      play.scale.push(r);
    else if (
      r.to !== null &&
      r.from !== null &&
      r.to < r.from &&
      Math.abs(r.change_pct ?? 0) >= 0.01
    )
      play.shift.push(r);
    else play.hold.push(r);
  }
  const finite = (value: unknown): void => {
    if (typeof value === "number" && !Number.isFinite(value))
      throw Error("Unavailable arithmetic result");
    if (value && typeof value === "object")
      for (const child of Object.values(value)) finite(child);
  };
  finite(play);
  return play;
}
export function allRows(play: Play) {
  return [...play.scale, ...play.shift, ...play.hold, ...play.watching];
}
export function explainMove(play: Play, campaignId: string) {
  const row = allRows(play).find((r) => r.campaign_id === campaignId);
  if (!row) throw Error("Campaign not in play");
  return { play_id: play.play_id, snapshot_id: play.snapshot_id, ...row };
}
export function proposeMove(play: Play, campaignId: string, now = new Date()) {
  if (Date.parse(play.expires_at) <= now.getTime()) throw Error("Play expired");
  const r = explainMove(play, campaignId);
  if (
    r.from === null ||
    r.to === null ||
    r.budget_kind !== "daily" ||
    Math.abs(r.to - r.from) < 1 ||
    ![...play.scale, ...play.shift].some(
      (row) => row.campaign_id === campaignId,
    )
  )
    throw Error("No actionable daily budget move");
  return {
    play_id: play.play_id,
    campaign_id: campaignId,
    platform: play.platform,
    current_daily_budget: r.current_daily_budget,
    proposed_daily_budget: r.proposed_daily_budget,
    change_pct: r.change_pct,
    expires_at: play.expires_at,
    applied: false as const,
    how_to_apply: [
      play.platform === "meta"
        ? "Open Ads Manager and select the exact account and campaign."
        : "Open Google Ads and select the exact customer and campaign.",
      "Verify the current daily budget still matches the observed amount; stop if it differs.",
      "Review the evidence and account total before editing the campaign daily budget.",
      "Apply the amount yourself only if you agree. Then report applied or dismissed to PULSE.",
    ],
  };
}
