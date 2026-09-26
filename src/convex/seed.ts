import { v } from "convex/values";
import { type MutationCtx, mutation } from "./_generated/server";

// ---------------------------------------------------------------------------
// One-time demo seeding (spec §41). The client calls seedIfEmpty() once on app
// bootstrap; all data is clearly-marked fictional demo data (see README).
// Seeds: 7 materials + 90-day price history, 4 authorized recyclers,
// recycler-material links, 3 demo collectors, safety guides, heatmap areas,
// and a full demo lot/transaction/handover/earnings pipeline.
// ---------------------------------------------------------------------------

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MATERIALS = [
  { code: "pcb", name: "PCB (Circuit Board)", nameHi: "पीसीबी (सर्किट बोर्ड)", nameMr: "पीसीबी (सर्किट बोर्ड)", category: "Electronic Component", price: 410, prev: 393.5, sort: 1, description: "Printed circuit boards from computers, TVs and phones" },
  { code: "lcd", name: "LCD Panel", nameHi: "एलसीडी पैनल", nameMr: "एलसीडी पॅनेल", category: "Display", price: 95, prev: 97, sort: 2, description: "LCD screens and panels from monitors and TVs" },
  { code: "crt", name: "CRT Glass", nameHi: "सीआरटी कांच", nameMr: "सीआरटी काच", category: "Display", price: 42, prev: 43.5, sort: 3, description: "Picture tubes and leaded glass from old TVs" },
  { code: "cable", name: "Copper Cable", nameHi: "तांबे का केबल", nameMr: "तांब्याची केबल", category: "Wire", price: 320, prev: 308, sort: 4, description: "Wires and cables with copper content" },
  { code: "battery", name: "Lead Battery", nameHi: "लेड बैटरी", nameMr: "लीड बॅटरी", category: "Battery", price: 138, prev: 142, sort: 5, description: "Lead-acid batteries from inverters and vehicles" },
  { code: "motor", name: "Motors", nameHi: "मोटर", nameMr: "मोटर", price: 105, prev: 102, sort: 6, description: "Electric motors, pumps and compressors" },
  { code: "plastic", name: "Mixed Plastic", nameHi: "मिश्रित प्लास्टिक", nameMr: "मिश्रित प्लास्टिक", category: "Plastic", price: 38, prev: 39.5, sort: 7, description: "ABS/PC housings and mixed plastic casings" },
] as Array<{ code: string; name: string; nameHi: string; nameMr: string; category?: string; price: number; prev: number; sort: number; description: string }>;

type SeedRecycler = {
  name: string; address: string; area: string; city: string;
  lat: number; lng: number; contact: string;
  materialsAccepted: string[]; rates: Record<string, number>;
  rating: number; pickupAvailable: boolean; pickupRadiusKm: number;
  serviceArea: string; verified: boolean; authorizationStatus: string;
  distanceKm: number; timingNote: string; sort: number;
};

const RECYCLERS: SeedRecycler[] = [
  {
    name: "GreenCycle Recycling", address: "Plot 14, Sector 24 eco-park lane", area: "Okhla Phase II", city: "New Delhi",
    lat: 28.5355, lng: 77.2715, contact: "+91 98100 12345 (demo)",
    materialsAccepted: ["pcb", "lcd", "crt", "cable", "battery", "motor", "plastic"],
    rates: { pcb: 410, lcd: 95, crt: 42, cable: 320, battery: 138, motor: 105, plastic: 38 },
    rating: 4.8, pickupAvailable: true, pickupRadiusKm: 25, serviceArea: "Delhi NCR — South & Central",
    verified: true, authorizationStatus: "authorized (demo)", distanceKm: 2.4, timingNote: "Mon–Sat, 9 AM – 6 PM", sort: 1,
  },
  {
    name: "Delhi E-Waste Solutions", address: "Unit 7, Industrial area, near Metro Depot", area: "Anand Parbat", city: "New Delhi",
    lat: 28.6519, lng: 77.1805, contact: "+91 98110 22334 (demo)",
    materialsAccepted: ["pcb", "cable", "battery", "motor"],
    rates: { pcb: 395, cable: 332, battery: 141, motor: 108 },
    rating: 4.5, pickupAvailable: true, pickupRadiusKm: 15, serviceArea: "Central & West Delhi",
    verified: true, authorizationStatus: "authorized (demo)", distanceKm: 6.1, timingNote: "Mon–Sat, 10 AM – 7 PM", sort: 2,
  },
  {
    name: "NCR Metal Reclaimers", address: "Shed 22, Kirti Nagar timber market road", area: "Kirti Nagar", city: "New Delhi",
    lat: 28.6524, lng: 77.1483, contact: "+91 98730 55667 (demo)",
    materialsAccepted: ["cable", "motor", "pcb", "plastic"],
    rates: { cable: 341, motor: 112, pcb: 402, plastic: 40 },
    rating: 4.2, pickupAvailable: false, pickupRadiusKm: 0, serviceArea: "West Delhi walk-in only",
    verified: true, authorizationStatus: "authorized (demo)", distanceKm: 9.3, timingNote: "Mon–Fri, 9 AM – 5 PM", sort: 3,
  },
  {
    name: "Yamuna Green Recyclers", address: "Shop 4, Transport Nagar main road", area: "Transport Nagar", city: "New Delhi",
    lat: 28.6219, lng: 77.2457, contact: "+91 99580 77889 (demo)",
    materialsAccepted: ["crt", "lcd", "plastic", "battery"],
    rates: { crt: 45, lcd: 99, plastic: 41, battery: 135 },
    rating: 4.0, pickupAvailable: true, pickupRadiusKm: 10, serviceArea: "North & East Delhi",
    verified: true, authorizationStatus: "authorized (demo)", distanceKm: 12.8, timingNote: "Tue–Sun, 9 AM – 6 PM", sort: 4,
  },
];

const SAFETY = [
  { code: "battery", en: { title: "Batteries", tips: ["Do not puncture, crush or expose damaged batteries to heat.", "Keep terminals taped and batteries upright.", "Store away from children and flammables."] }, hi: { title: "बैटरी", tips: ["क्षतिग्रस्त बैटरी को छेदें, कुचलें या गर्मी के पास न रखें।", "टर्मिनल पर टेप लगाए रखें।", "बच्चों और ज्वलनशील चीज़ों से दूर रखें।"] }, mr: { title: "बॅटरी", tips: ["खराब झालेल्या बॅटरी टोचू नका, चिरडू नका किंवा उष्णतेजवळ ठेवू नका.", "टर्मिनलवर टेप लावून ठेवा.", "मुलांपासून आणि ज्वलनशील वस्तूंपासून दूर ठेवा."] } },
  { code: "crt", en: { title: "CRT (Old TV glass)", tips: ["Handle carefully. Avoid breaking the glass.", "Never remove the vacuum tube yourself.", "Carry upright, two hands, heavy lift with help."] }, hi: { title: "सीआरटी (पुरानी टीवी कांच)", tips: ["सावधानी से संभालें। कांच न तोड़ें।", "वैक्यूम ट्यूब स्वयं न निकालें।", "सीधा रखकर, दो हाथों से उठाएँ।"] }, mr: { title: "सीआरटी (जुनी टीव्ही काच)", tips: ["काळजीपूर्वक हाताळा. काच तुटू देऊ नका.", "व्हॅक्यूम ट्यूब स्वतः काढू नका.", "सरळ धरून, दोन्ही हातांनी वर करा."] } },
  { code: "lcd", en: { title: "LCD Panels", tips: ["Do not bend or press the screen — backlight can crack.", "Watch for sharp edges after breaking.", "Mercury lamps inside older panels: do not open."] }, hi: { title: "एलसीडी पैनल", tips: ["स्क्रीन को न मोड़ें या दबाएँ।", "टूटने के बाद किनारे तीखे होते हैं।", "पुराने पैनल में पारा लैंप हो सकता है — न खोलें।"] }, mr: { title: "एलसीडी पॅनेल", tips: ["स्क्रीन वाकवू नका किंवा दाबू नका.", "तुटल्यावर कडा धारदार असतात.", "जुन्या पॅनेलमध्ये पारा दिवा असू शकतो — उघडू नका."] } },
  { code: "pcb", en: { title: "PCBs", tips: ["Use gloves when handling dusty or damaged boards.", "Do not burn boards to extract metal.", "Keep away from food and drinking water."] }, hi: { title: "पीसीबी", tips: ["धूल भरे या खराब बोर्ड संभालते समय दस्ताने पहनें।", "धातु निकालने के लिए बोर्ड न जलाएँ।", "खाने-पीने से दूर रखें।"] }, mr: { title: "पीसीबी", tips: ["धूळ असलेले किंवा खराब बोर्ड हाताळताना ग्लोव्ह घाला.", "धातू काढण्यासाठी बोर्ड जाळू नका.", "जेवण-पाण्यापासून दूर ठेवा."] } },
  { code: "cable", en: { title: "Cables & Wires", tips: ["Never burn insulation to recover copper — toxic fumes.", "Cut and coil long cables to avoid tripping.", "Sharp cutters: cut away from your body."] }, hi: { title: "केबल और तार", tips: ["तांबा निकालने के लिए इन्सुलेशन न जलाएँ — ज़हरीली गैस।", "लंबे केबल काटकर गोल करें।", "कटर शरीर से दूर रखकर काटें।"] }, mr: { title: "केबल आणि तार", tips: ["तांबे साठी इन्सुलेशन जाळू नका — विषारी वायू.", "लांब केबल कापून गुंडाळा.", "कटर शरीरापासून दूर ठेवून कापा."] } },
  { code: "motor", en: { title: "Motors & Compressors", tips: ["Heavy — lift with bent knees or use a trolley.", "Discharge capacitors before opening.", "Pinch points on pulleys: keep fingers clear."] }, hi: { title: "मोटर और कंप्रेसर", tips: ["भारी हैं — घुटने मोड़कर उठाएँ।", "खोलने से पहले कैपेसिटर डिस्चार्ज करें।", "पुली के पास उँगलियाँ न रखें।"] }, mr: { title: "मोटर आणि कॉम्प्रेसर", tips: ["जड आहेत — गुडघे वाकून वर करा.", "उघडण्यापूर्वी कॅपेसिटर डिस्चार्ज करा.", "पुलीजवळ बोटा ठेवू नका."] } },
  { code: "other", en: { title: "Unknown Materials", tips: ["Do not open sealed or leaking items.", "Photograph the item and pick 'Other e-waste'.", "When in doubt, ask the recycler before transport."] }, hi: { title: "अज्ञात सामग्री", tips: ["सील या लीक हुई चीज़ न खोलें।", "फोटो लेकर 'अन्य ई-कचरा' चुनें।", "संदेह हो तो पहले रीसायकलर से पूछें।"] }, mr: { title: "अनोळखी वस्तू", tips: ["सील किंवा गळती असलेल्या वस्तू उघडू नका.", "फोटो काढून 'इतर ई-कचरा' निवडा.", "शंका असल्यास रीसायकलरला विचारा."] } },
];

async function insertBaseData(ctx: MutationCtx) {
  const now = Date.now();
  const recyclerIds: string[] = [];
  for (const m of MATERIALS) {
    await ctx.db.insert("materials", {
      code: m.code, name: m.name, nameHi: m.nameHi, nameMr: m.nameMr,
      category: m.category, description: m.description, unit: "kg",
      currentPrice: m.price, prevPrice: m.prev, updatedAt: now, sort: m.sort,
    });
    // 90 days of demo price history: gentle random walk ending at current price.
    // source marker keeps the demo nature explicit (§7).
    const rand = mulberry32(m.code.length * 7919 + m.sort);
    const start = m.price * (0.88 + rand() * 0.1);
    for (let i = 90; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const day = d.toISOString().slice(0, 10);
      const t = (90 - i) / 90;
      const drift = start + (m.price - start) * t + (rand() - 0.5) * m.price * 0.02;
      const price = i === 0 ? m.price : Math.round(drift * 10) / 10;
      await ctx.db.insert("priceHistory", { materialCode: m.code, day, price, source: "demo" });
    }
  }
  for (const r of RECYCLERS) {
    const id = await ctx.db.insert("recyclers", { ...r });
    recyclerIds.push(id);
    // §9 recycler-material relationship rows.
    for (const code of r.materialsAccepted) {
      await ctx.db.insert("recyclerMaterials", { recyclerId: id, materialCode: code });
    }
  }
  for (const s of SAFETY) {
    await ctx.db.insert("safetyGuides", {
      materialCode: s.code,
      title: s.en.title, titleHi: s.hi.title, titleMr: s.mr.title,
      tips: s.en.tips, tipsHi: s.hi.tips, tipsMr: s.mr.tips,
    });
  }
  // §35 fictional collection-density areas for the recycler heatmap.
  for (const a of DEMO_AREAS_DENSITY) {
    await ctx.db.insert("collectionAreas", { ...a, city: "New Delhi" });
  }
}

// ---- §41 demo activity pipeline --------------------------------------------
// Fictional collectors, lots across the lifecycle, transactions, a handover
// record and earnings rows — enough for every screen to show meaningful data
// on first open. All names/numbers are invented for the SIH demo.

const DEMO_COLLECTORS = [
  { name: "Rahul Kumar", area: "Okhla", phone: "+91 98100 11111 (demo)" },
  { name: "Sunita Devi", area: "Seelampur", phone: "+91 98100 22222 (demo)" },
  { name: "Imran Sheikh", area: "Kirti Nagar", phone: "+91 98100 33333 (demo)" },
];

// §35 fictional collection-density areas (shared by insert + backfill).
const DEMO_AREAS_DENSITY = [
  { area: "Seelampur", lots: 86, weightKg: 1240, lat: 28.6701, lng: 77.2669, intensity: 1 },
  { area: "Okhla", lots: 62, weightKg: 980, lat: 28.5355, lng: 77.2715, intensity: 0.78 },
  { area: "Kirti Nagar", lots: 47, weightKg: 690, lat: 28.6524, lng: 77.1483, intensity: 0.6 },
  { area: "Transport Nagar", lots: 33, weightKg: 510, lat: 28.6219, lng: 77.2457, intensity: 0.45 },
  { area: "Nangloi", lots: 21, weightKg: 340, lat: 28.6834, lng: 77.0698, intensity: 0.3 },
];

export const seedDemoActivity = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Guard on transactions (not lots): a deployment with a few test lots but
    // no transactional pipeline still gets the demo history; a deployment
    // that already has transactions is left untouched.
    const existingTx = await ctx.db.query("transactions").first();
    if (existingTx !== null) return { seeded: false };

    // Reference numbering continues from any existing lots (no collisions).
    let refNum = 0;
    for (const l of await ctx.db.query("lots").collect()) {
      const num = Number(l.referenceId.split("-").pop());
      if (Number.isFinite(num) && num > refNum) refNum = num;
    }

    const now = Date.now();
    const DAY = 86400000;
    // Demo profiles need an owner user row; create one placeholder demo user
    // if the users table is empty (anonymous-style row, clearly demo).
    let owner = await ctx.db.query("users").first();
    if (!owner) {
      const userId = await ctx.db.insert("users", { name: "Demo Owner (demo)", isAnonymous: true });
      owner = await ctx.db.get(userId);
    }
    const collectors: Array<{ profileId: string; name: string; area: string }> = [];
    for (const c of DEMO_COLLECTORS) {
      const id = await ctx.db.insert("profiles", {
        userId: owner!._id as never, // placeholder owner (demo user)
        role: "collector",
        name: c.name,
        phone: c.phone,
        collectionArea: c.area,
        createdAt: now - 30 * DAY,
      });
      collectors.push({ profileId: id, name: c.name, area: c.area });
    }

    const recycler = (await ctx.db.query("recyclers").withIndex("by_name", (q) => q.eq("name", "GreenCycle Recycling")).unique())!;

    // A deterministic pseudo-random for stable demo data.
    let s = 42;
    const rand = () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };

    type DemoLot = {
      collectorIdx: number; materialCode: string; weight: number; daysAgo: number;
      status: "created" | "sent" | "accepted" | "handed_over" | "completed" | "rejected";
    };
    const demoLots: DemoLot[] = [
      { collectorIdx: 0, materialCode: "pcb", weight: 12.5, daysAgo: 26, status: "completed" },
      { collectorIdx: 0, materialCode: "cable", weight: 8, daysAgo: 18, status: "completed" },
      { collectorIdx: 0, materialCode: "battery", weight: 15, daysAgo: 9, status: "handed_over" },
      { collectorIdx: 1, materialCode: "lcd", weight: 6.5, daysAgo: 14, status: "completed" },
      { collectorIdx: 1, materialCode: "pcb", weight: 9.2, daysAgo: 5, status: "sent" },
      { collectorIdx: 2, materialCode: "motor", weight: 22, daysAgo: 21, status: "completed" },
      { collectorIdx: 2, materialCode: "plastic", weight: 18, daysAgo: 7, status: "accepted" },
      { collectorIdx: 2, materialCode: "crt", weight: 14, daysAgo: 3, status: "rejected" },
    ];

    for (const dl of demoLots) {
      refNum += 1;
      const referenceId = `KC-2026-${String(refNum).padStart(4, "0")}`;
      const createdAt = now - dl.daysAgo * DAY;
      const mat = MATERIALS.find((m) => m.code === dl.materialCode)!;
      const estValue = Math.round(dl.weight * mat.price);
      const quotedPrice = Math.round(mat.price * (0.88 + rand() * 0.18));
      const finalSaleValue = Math.round(quotedPrice * dl.weight);
      const isDone = dl.status === "completed";
      const isAcceptedUp = ["accepted", "handed_over", "completed"].includes(dl.status);

      const lotId = await ctx.db.insert("lots", {
        referenceId,
        collectorId: collectors[dl.collectorIdx].profileId as never,
        recyclerId: isAcceptedUp ? (recycler._id as never) : undefined,
        materialCode: dl.materialCode,
        weight: dl.weight,
        condition: rand() > 0.5 ? "good" : "mixed",
        locationLabel: `${collectors[dl.collectorIdx].area}, New Delhi (demo location)`,
        aiMaterialCode: dl.materialCode,
        aiDetectedClass: dl.materialCode.toUpperCase(),
        aiConfidence: Math.round(70 + rand() * 28), // 0-100 integer (UI contract)
        aiSource: "demo",
        estimatedValue: estValue,
        quotedPrice: isAcceptedUp ? quotedPrice : undefined,
        quotedAt: isAcceptedUp ? createdAt + 6 * 3600000 : undefined,
        finalSaleValue: isAcceptedUp ? finalSaleValue : undefined,
        status: dl.status,
        rejectionReason: dl.status === "rejected" ? "Glass shattered in transit (demo)" : undefined,
        handoverRef:
          dl.status === "handed_over" || isDone ? `HANDOVER-KC-${referenceId.slice(-6)}` : undefined,
        handoverAt: dl.status === "handed_over" || isDone ? createdAt + 2 * DAY : undefined,
        handoverConfirmedByCollector: isAcceptedUp ? true : undefined,
        handoverConfirmedByRecycler:
          dl.status === "handed_over" || isDone ? true : undefined,
        paymentMethod: isDone ? (rand() > 0.5 ? "upi" : "cash") : undefined,
        paymentStatus: isDone ? "completed" : dl.status === "handed_over" ? "pending" : "none",
        paymentAt: isDone ? createdAt + 2.2 * DAY : undefined,
        syncOrigin: "online",
        createdAt,
        updatedAt: isDone ? createdAt + 2.2 * DAY : createdAt + DAY,
      });

      // Transaction + handover + earnings mirrors (§10/§11/§12).
      if (isAcceptedUp) {
        const txId = await ctx.db.insert("transactions", {
          lotId: lotId as never,
          referenceId,
          recyclerId: recycler._id as never,
          collectorId: collectors[dl.collectorIdx].profileId as never,
          materialCode: dl.materialCode,
          weight: dl.weight,
          quotedPrice,
          finalPrice: finalSaleValue,
          paymentStatus: isDone ? "PAID" : "PENDING",
          paymentMethod: isDone ? ((rand() > 0.5 ? "DIGITAL" : "CASH") as "CASH" | "DIGITAL") : undefined,
          transactionStatus: isDone ? "COMPLETED" : dl.status === "handed_over" ? "HANDED_OVER" : "ACCEPTED",
          createdAt: createdAt + 6 * 3600000,
          updatedAt: isDone ? createdAt + 2.2 * DAY : createdAt + 2 * DAY,
        });
        if (dl.status === "handed_over" || isDone) {
          await ctx.db.insert("handoverRecords", {
            transactionId: txId as never,
            lotId: lotId as never,
            verificationReference: `HANDOVER-KC-${referenceId.slice(-6)}`,
            weightVerified: dl.weight,
            latitude: 28.5355,
            longitude: 77.2715,
            handoverTime: createdAt + 2 * DAY,
          });
        }
        if (isDone) {
          await ctx.db.insert("earnings", {
            userId: collectors[dl.collectorIdx].profileId as never,
            transactionId: txId as never,
            lotId: lotId as never,
            amount: finalSaleValue,
            createdAt: createdAt + 2.2 * DAY,
          });
        }
      }
    }

    return { seeded: true };
  },
});

// Convenience: base + activity seeding in one call (internal; invoked by the
// public seedIfEmpty below).
export const seedAllInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    await insertBaseData(ctx);
    await ctx.runMutation(internal.seed.seedDemoActivity, {});
    return { seeded: true };
  },
});

// Public bootstrap mutation: seeds once; safe to call from the client on app start.
export const seedIfEmpty = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("materials").first();
    if (existing !== null) {
      // Backfill: older seedings predate the §5 category / §7 source fields.
      for (const m of await ctx.db.query("materials").collect()) {
        if (!m.category) {
          const def = MATERIALS.find((x) => x.code === m.code);
          if (def?.category) await ctx.db.patch(m._id, { category: def.category });
        }
      }
      for (const h of await ctx.db.query("priceHistory").collect()) {
        if (!h.source) await ctx.db.patch(h._id, { source: "demo" });
      }
      // Backfill §35 heatmap areas for deployments seeded before they existed.
      const existingAreas = await ctx.db.query("collectionAreas").collect();
      const have = new Set(existingAreas.map((a) => a.area));
      for (const a of DEMO_AREAS_DENSITY) {
        if (!have.has(a.area)) {
          await ctx.db.insert("collectionAreas", { ...a, city: "New Delhi" });
        }
      }
      // Top up the demo activity pipeline if absent.
      await ctx.runMutation(internal.seed.seedDemoActivity, {});
      return { seeded: false };
    }
    await ctx.runMutation(internal.seed.seedAllInternal, {});
    return { seeded: true };
  },
});

// Demo recovery: wipes and rebuilds reference data only (lots are never touched).
export const reseedDemoData = mutation({
  args: {},
  handler: async (ctx) => {
    for (const t of [
      "materials", "priceHistory", "recyclers", "safetyGuides", "recyclerMaterials", "collectionAreas",
    ] as const) {
      const rows = await ctx.db.query(t).collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    await insertBaseData(ctx);
    return { seeded: true };
  },
});
