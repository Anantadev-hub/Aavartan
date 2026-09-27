import { cronJobs } from "convex/server";
import { api, internal } from "./_generated/api";

// ---------------------------------------------------------------------------
// Scheduled jobs. The market-price refresh runs DAILY (§5): fetch → validate →
// store → record timestamps/source → preserve history. No manual price entry.
// The active MarketPriceProvider determines what is fetched; the same
// entrypoint supports more frequent schedules if a provider allows it.
// ---------------------------------------------------------------------------

const crons = cronJobs();

// 00:30 UTC daily (06:00 IST) — before Indian business hours.
crons.daily(
  "daily-market-price-refresh",
  { hourUTC: 0, minuteUTC: 30 },
  api.pricing.refreshAllPricesAction,
  {},
);

// Recompute discovery snapshots daily so expired quotes drop out of the
// reference and the fallback labelling stays accurate (Part 1 §3/§5).
crons.daily(
  "daily-discovery-recompute",
  { hourUTC: 0, minuteUTC: 35 },
  internal.discovery.recomputeAllSnapshots,
  {},
);

// Expire stale pools daily (Part 2 §11 — EXPIRED status).
crons.daily(
  "daily-pool-expiry",
  { hourUTC: 0, minuteUTC: 40 },
  internal.pooling.expireStalePools,
  {},
);

export default crons;
