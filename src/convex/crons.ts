import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

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

export default crons;
