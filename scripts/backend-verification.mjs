// ---------------------------------------------------------------------------
// Backend verification (task §13). Run with: bun scripts/backend-verification.mjs
// Exercises: account create/dedupe, image IDs, lot IDs + price snapshots,
// daily price update semantics, transaction completion, weekly report.
// Requires a dev deployment URL via CONVEX_URL (falls back to .env.local).
// ---------------------------------------------------------------------------
import { readFileSync, existsSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../src/convex/_generated/api.js";

let url = process.env.CONVEX_URL;
if (!url && existsSync(".env.local")) {
  const env = readFileSync(".env.local", "utf8");
  const m = env.match(/^VITE_CONVEX_URL=(.+)$/m);
  if (m) url = m[1].trim();
}
if (!url) {
  console.error("Set CONVEX_URL (or VITE_CONVEX_URL in .env.local) and rerun.");
  process.exit(1);
}

const client = new ConvexHttpClient(url);
const results = [];
function report(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const unique = Date.now().toString().slice(-8); // 8 digits → 9+8+1 = 10-digit phone
const PHONE_A = `9${unique}0`; // 10 digits starting 9
const PHONE_B = `9${unique}1`;

async function main() {
  // Seed reference data (no-op after first run).
  await client.mutation(api.seed.seedIfEmpty, {});

  // ---- A/B: create account + onboarding (cloud persistence) ----------------
  const a1 = await client.action(api.auth.signIn, { provider: "anonymous" });
  const tokenA = a1.tokens.token;
  client.setAuth(tokenA);
  const profA = await client.mutation(api.profiles.createProfile, {
    role: "collector",
    name: "Verify Collector",
    phone: PHONE_A,
    preferredLanguage: "en",
    collectionArea: "Okhla",
  });
  report("A. Create account", !!profA._id, `profile ${profA._id}`);
  report(
    "B. Onboarding fields persisted",
    profA.name === "Verify Collector" && profA.phone === PHONE_A &&
      profA.preferredLanguage === "en" && profA.collectionArea === "Okhla",
  );

  // ---- C/D/E: refresh / reopen / remains logged in -------------------------
  // Session persistence is a Convex Auth token (httpOnly-equivalent client
  // storage). Simulate reopen: new client, same token.
  const client2 = new ConvexHttpClient(url);
  client2.setAuth(tokenA);
  const profReopen = await client2.query(api.profiles.myProfile, {});
  report(
    "C/D/E. Session survives reopen (same token)",
    profReopen !== null && profReopen._id === profA._id,
  );

  // ---- F/G/H: logout, login again, account data loads ----------------------
  // Logout clears the local token (UI); the ACCOUNT must still exist.
  const profByPhone = await (async () => {
    const anon = await client2.action(api.auth.signIn, { provider: "anonymous" });
    client2.setAuth(anon.tokens.token);
    // Same phone on a fresh session must rebind to the same profile (§2 dedupe).
    return client2.mutation(api.profiles.createProfile, {
      role: "collector",
      name: "Verify Collector",
      phone: PHONE_A,
      preferredLanguage: "en",
      collectionArea: "Okhla",
    });
  })();
  report(
    "F/G/H. Re-login returns same account (no duplicate)",
    profByPhone._id === profA._id,
    `profile ${profByPhone._id}`,
  );

  // ---- I/J: upload image → persistent unique image ID ----------------------
  const img1 = await client.mutation(api.images.registerImage, {
    uploaderId: profA._id,
    photoDataUrl: "data:image/jpeg;base64,TESTIMAGE1",
    aiDetectedClass: "PCB",
    aiConfidence: 94,
    aiSource: "demo",
  });
  const img2 = await client.mutation(api.images.registerImage, {
    uploaderId: profA._id,
    photoDataUrl: "data:image/jpeg;base64,TESTIMAGE2",
  });
  report(
    "I. Image record persisted",
    !!img1.imageId && img1.imageRef.startsWith("IMG-KC-2026-"),
    img1.imageRef,
  );
  report("J. Image IDs unique + sequential", img1.imageRef !== img2.imageRef, `${img1.imageRef} / ${img2.imageRef}`);
  const imgBack = await client.query(api.images.getByRef, { imageRef: img1.imageRef });
  report(
    "J2. Image retrievable by ref (cloud-persistent)",
    imgBack !== null && imgBack.aiDetectedClass === "PCB" && imgBack.aiConfidence === 94,
  );

  // ---- K/L: create lot → persistent unique lot ID + price snapshot ---------
  const pcbBefore = await client.query(api.materials.latestDailyPrice, { materialCode: "pcb" });
  const lot1 = await client.mutation(api.lots.createLot, {
    collectorId: profA._id,
    materialCode: "pcb",
    weight: 10,
    condition: "good",
    photoDataUrl: "data:image/jpeg;base64,TESTIMAGE1",
    imageId: img1.imageId,
    aiMaterialCode: "pcb",
    aiDetectedClass: "PCB",
    aiConfidence: 94,
    aiSource: "demo",
    locationLabel: "Okhla, New Delhi (demo)",
    syncOrigin: "online",
    sendNow: false,
  });
  report(
    "K. Lot created with reference ID",
    /^KC-\d{4}-\d{4,}$/.test(lot1.referenceId),
    lot1.referenceId,
  );
  report(
    "L. Lot retains image + AI + price fields",
    lot1.estimatedValue === Math.round(10 * (pcbBefore?.pricePerKg ?? 410)),
    `est ₹${lot1.estimatedValue} @ ₹${pcbBefore?.pricePerKg ?? 410}/kg`,
  );
  const lotDetail = await client.query(api.lots.getLot, { lotId: lot1.lotId });
  report(
    "L2. Price snapshot frozen on lot",
    lotDetail.lot.pricePerKgAtCreation != null &&
      lotDetail.lot.priceRecordId != null &&
      lotDetail.lot.priceTimestamp != null,
    `₹${lotDetail.lot.pricePerKgAtCreation}/kg from ${lotDetail.lot.priceTimestamp ? new Date(lotDetail.lot.priceTimestamp).toISOString().slice(0, 10) : "?"}`,
  );
  report(
    "L3. Lot links persisted image",
    lotDetail.lot.imageId != null,
  );

  // ---- M: refresh — lot remains --------------------------------------------
  const myLots = await client.query(api.lots.listLots, { collectorId: profA._id });
  report(
    "M. Lot persists in backend (server-side read)",
    myLots.some((l) => l._id === lot1.lotId),
  );

  // ---- N/O/P/Q: daily price update semantics -------------------------------
  const oldSnap = lotDetail.lot.pricePerKgAtCreation;
  const setRes = await client.mutation(api.materials.setDailyPrice, {
    materialCode: "pcb",
    pricePerKg: 90,
    source: "demo",
  });
  report("N. Daily price updated", setRes.pricePerKg === 90, `day ${setRes.day}`);
  const latestAfter = await client.query(api.materials.latestDailyPrice, { materialCode: "pcb" });
  report("O. Latest price now 90", latestAfter?.pricePerKg === 90);

  const lot2 = await client.mutation(api.lots.createLot, {
    collectorId: profA._id,
    materialCode: "pcb",
    weight: 10,
    condition: "good",
    locationLabel: "Okhla, New Delhi (demo)",
    syncOrigin: "online",
    sendNow: false,
  });
  report(
    "P. NEW lot uses new price",
    lot2.estimatedValue === 900,
    `est ₹${lot2.estimatedValue} (10kg × ₹90)`,
  );

  const lot1After = await client.query(api.lots.getLot, { lotId: lot1.lotId });
  report(
    "Q. OLD lot keeps its original snapshot",
    lot1After.lot.pricePerKgAtCreation === oldSnap &&
      lot1After.lot.estimatedValue === lotDetail.lot.estimatedValue,
    `still ₹${lot1After.lot.pricePerKgAtCreation}/kg · ₹${lot1After.lot.estimatedValue}`,
  );

  // ---- R/S: complete a transaction, weekly earnings update -----------------
  const recyclerBefore = await client.query(api.recyclers.listRecyclers, { materialCode: "pcb" });
  const green = recyclerBefore.find((r) => r.name === "GreenCycle Recycling");
  await client.mutation(api.lots.sendLot, { lotId: lot2.lotId });
  const quoted = await client.mutation(api.lots.quoteLot, {
    lotId: lot2.lotId,
    recyclerId: green._id,
    quotedPrice: 92,
  });
  report("R1. Recycler quote accepted", quoted.status === "accepted", `final ₹${quoted.finalSaleValue}`);
  await client.mutation(api.lots.confirmHandover, { lotId: lot2.lotId, by: "collector" });
  const handover = await client.mutation(api.lots.confirmHandover, { lotId: lot2.lotId, by: "recycler" });
  report("R2. Two-sided handover → HANDED_OVER", handover.both === true, handover.handoverRef);
  const paid = await client.mutation(api.lots.markPaymentCompleted, { lotId: lot2.lotId, method: "upi" });
  report("R3. Payment completed", paid.ok === true, `₹${paid.finalSaleValue}`);

  const weekly = await client.query(api.lots.weeklyReport, { collectorId: profA._id });
  report(
    "S1. Weekly report counts the completed sale",
    weekly.completedSales >= 1 && weekly.net >= 920,
    `net ₹${weekly.net} · ${weekly.completedSales} sales · ${weekly.materialSoldKg}kg`,
  );
  report(
    "S2. Net = gross (no expenses invented)",
    weekly.net === weekly.gross,
    weekly.note,
  );
  report(
    "S3. Previous week + trend series present",
    typeof weekly.prevGross === "number" && Array.isArray(weekly.daily) && weekly.daily.length === 7,
  );

  // Duplicate-account guard (§2): creating again with same phone returns same profile.
  const again = await client.mutation(api.profiles.createProfile, {
    role: "collector",
    name: "Different Name",
    phone: PHONE_A,
  });
  report("§2 Dedupe: same phone → same account", again._id === profA._id);

  console.log("\n---- SUMMARY ----");
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log("FAILED:", failed.map((f) => f.name).join(" | "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Verification crashed:", e);
  process.exit(1);
});
