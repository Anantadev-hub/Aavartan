import { v } from "convex/values";
import { type MutationCtx, mutation } from "./_generated/server";

// ---------------------------------------------------------------------------
// One-time demo seeding. The client calls seedIfEmpty() once on app bootstrap;
// all data is clearly-marked demo data (see README).
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MATERIALS = [
  { code: "pcb", name: "PCB (Circuit Board)", nameHi: "पीसीबी (सर्किट बोर्ड)", nameMr: "पीसीबी (सर्किट बोर्ड)", price: 410, prev: 393.5, sort: 1, description: "Printed circuit boards from computers, TVs and phones" },
  { code: "lcd", name: "LCD Panel", nameHi: "एलसीडी पैनल", nameMr: "एलसीडी पॅनेल", price: 95, prev: 97, sort: 2, description: "LCD screens and panels from monitors and TVs" },
  { code: "crt", name: "CRT Glass", nameHi: "सीआरटी कांच", nameMr: "सीआरटी काच", price: 42, prev: 43.5, sort: 3, description: "Picture tubes and leaded glass from old TVs" },
  { code: "cable", name: "Copper Cable", nameHi: "तांबे का केबल", nameMr: "तांब्याची केबल", price: 320, prev: 308, sort: 4, description: "Wires and cables with copper content" },
  { code: "battery", name: "Lead Battery", nameHi: "लेड बैटरी", nameMr: "लीड बॅटरी", price: 138, prev: 142, sort: 5, description: "Lead-acid batteries from inverters and vehicles" },
  { code: "motor", name: "Motors", nameHi: "मोटर", nameMr: "मोटर", price: 105, prev: 102, sort: 6, description: "Electric motors, pumps and compressors" },
  { code: "plastic", name: "Mixed Plastic", nameHi: "मिश्रित प्लास्टिक", nameMr: "मिश्रित प्लास्टिक", price: 38, prev: 39.5, sort: 7, description: "ABS/PC housings and mixed plastic casings" },
];

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
  for (const m of MATERIALS) {
    await ctx.db.insert("materials", {
      code: m.code, name: m.name, nameHi: m.nameHi, nameMr: m.nameMr,
      description: m.description, unit: "kg",
      currentPrice: m.price, prevPrice: m.prev, updatedAt: now, sort: m.sort,
    });
    // 90 days of demo price history: gentle random walk ending at current price.
    const rand = mulberry32(m.code.length * 7919 + m.sort);
    const start = m.price * (0.88 + rand() * 0.1);
    for (let i = 90; i >= 0; i--) {
      const d = new Date(now - i * 86400000);
      const day = d.toISOString().slice(0, 10);
      const t = (90 - i) / 90;
      const drift = start + (m.price - start) * t + (rand() - 0.5) * m.price * 0.02;
      const price = i === 0 ? m.price : Math.round(drift * 10) / 10;
      await ctx.db.insert("priceHistory", { materialCode: m.code, day, price });
    }
  }
  for (const r of RECYCLERS) {
    await ctx.db.insert("recyclers", { ...r });
  }
  for (const s of SAFETY) {
    await ctx.db.insert("safetyGuides", {
      materialCode: s.code,
      title: s.en.title, titleHi: s.hi.title, titleMr: s.mr.title,
      tips: s.en.tips, tipsHi: s.hi.tips, tipsMr: s.mr.tips,
    });
  }
}

// Public bootstrap mutation: seeds once; safe to call from the client on app start.
export const seedIfEmpty = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("materials").first();
    if (existing !== null) return { seeded: false };
    await insertBaseData(ctx);
    return { seeded: true };
  },
});

// Demo recovery: wipes and rebuilds reference data only (lots are never touched).
export const reseedDemoData = mutation({
  args: {},
  handler: async (ctx) => {
    for (const t of ["materials", "priceHistory", "recyclers", "safetyGuides"] as const) {
      const rows = await ctx.db.query(t).collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    await insertBaseData(ctx);
    return { seeded: true };
  },
});
