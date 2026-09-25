# ♻ Kabadiwala Connect

**Bringing informal collectors into the formal recycling chain.**
*SIH 2026 · Problem Statement SIH26229 · Clean & Green Technology*

Kabadiwala Connect is a two-sided e-waste platform: a **mobile-first collector app** for kabadiwalas
(photo → AI material ID → indicative price → recycler matching → digital lot → verified handover →
earnings) and an **operations portal** for authorized recyclers (incoming lots → quote → handover →
payment). One coherent ecosystem with a single transaction record flowing between both sides.

---

## ⚠️ Honest scope statement (read first)

This is a **prototype**. Wherever a capability is mocked, the UI and code say so:

| Capability | Prototype implementation | Production path |
|---|---|---|
| AI material classification | Mock inference (`src/convex/ai.ts`) — deterministic demo model, labelled "Demo inference" in the UI | Swap the action body for a `fetch()` to a FastAPI model service (`AI_SERVICE_URL`) |
| Location / distance | Static demo coordinates + demo distances (Delhi NCR) | Real GPS + geocoding + distance matrix |
| Authorization status | Clearly labelled "authorized (demo)" — **no real government IDs anywhere** | CPCB EPR registry integration |
| Handover integrity | Demo checksum (FNV-style hash), labelled "tamper-evident concept" | Server-side signatures / append-only ledger |
| Payments | Simulated cash/UPI marking only — no money moves | UPI collect / PG webhooks |
| Authentication | Convex anonymous sessions + role profile (mock sign-in) | Phone + OTP (structure already separated from role selection) |
| Offline sync | localStorage queue + idempotent `/sync`-style Convex mutation | IndexedDB (localForage) + background sync worker |
| Photos | Client-side compressed JPEG stored inline | Object storage (Supabase Storage / S3) |

No fake claims: the UI never says "real AI", "real GPS", "real OTP", "verified by CPCB" or "payment
processed by a bank".

---

## Tech stack (as built)

- **Frontend:** React 19 + Vite + TypeScript + Tailwind CSS 4 (Claymorphism theme) + framer-motion
- **Backend:** **Convex** (typed serverless functions + reactive database) — plays the role the brief
  assigned to FastAPI + PostgreSQL/Supabase. Every brief API concept maps 1:1 to a Convex function
  (mapping table below). All platform endpoints are authenticated and role-aware.
- **Maps/geo:** demo distance data with a transparent scoring match (no map API key needed); the UI
  never pretends to render live GPS
- **QR:** `qrcode.react` for the digital handover record
- **Voice:** browser SpeechSynthesis (no external service)
- **Charts:** hand-rolled SVG (zero-dependency trends)

---

## Run it

```bash
bun install
bun convex dev --once   # generate Convex types + push functions
bun run dev             # vite dev server
```

Reference data (materials, 90-day price history, 4 Delhi-NCR recyclers, safety guides) seeds itself
on first app load via `seed.seedIfEmpty` (idempotent). Demo recovery: call `seed.reseedDemoData`.

Environment: only `VITE_CONVEX_URL` (already wired in the Freebuff template) and optionally
`AI_SERVICE_URL` (server-side, for the future real model — read via `process.env` inside the action).

---

## The demo flow (under 3 minutes)

1. **Open the app** → landing page → language switcher (EN/हिंदी/मराठी) visible
2. **"Start selling — Collector app"** → role screen → *KABADIWALA* → Continue (mock sign-in)
3. Collector home: greeting, stats, **Add E-Waste** CTA
4. **Add E-Waste** → take/upload a photo → *"Analyzing image…"* → **AI: PCB — 94%** (demo inference)
5. Confirm material → enter **8.5 kg** → condition **Good** → rate **₹410/kg** → **estimated ₹3,485**
6. **Find Authorized Recycler** → ranked list with transparent match score → **GreenCycle (2.4 km, 4.8★)** → Select
7. Lot created → **KC-2026-0001** → tracking timeline (`CREATED → SENT → …`)
8. Sign out / back → **Enter as Recycler** → portal shows the lot in **Available Lots**
9. **Review** → quote **₹410/kg** → **Accept & Send Quote**
10. **Transactions → Active → Confirm Handover**
11. Collector app → lot → **"I have handed over the material"** → **Verified Digital Handover** record with QR + checksum
12. Recycler → **Mark Payment Completed** (Cash / UPI)
13. Collector → **Earnings** → total updated, transaction in ledger

Offline demo: toggle airplane mode, capture a lot (weight + photo + material) → "Saved offline — will
sync when you're connected" → back online → "records synced successfully", lot appears.

---

## Architecture

```
src/
├── convex/                # Backend (the "FastAPI layer")
│   ├── schema.ts          # Tables: profiles, materials, priceHistory, recyclers,
│   │                      #   lots, anomalyFlags, safetyGuides (+ authTables)
│   ├── seed.ts            # Idempotent demo seed (materials/history/recyclers/safety)
│   ├── materials.ts       # GET /materials, /prices, /prices/trends, /safety-guides
│   ├── recyclers.ts       # GET /recyclers, POST /recyclers/match (transparent scoring)
│   ├── lots.ts            # POST /lots, lifecycle, handover, payment, timeline,
│   │                      #   earnings summary/monthly, recycler stats, anomaly rules
│   ├── ai.ts              # POST /ai/classify-material (mock model — single swap point)
│   ├── sync.ts            # POST /sync (idempotent offline draft ingestion)
│   └── profiles.ts        # GET /auth/me, role selection, demo profile
├── pages/
│   ├── Landing.tsx        # Brand landing → auth entry
│   ├── Auth.tsx           # Role onboarding (mock sign-in)
│   ├── collector/         # CollectorApp (phone shell), Home, Prices, AddFlow,
│   │                      #   FindRecycler, Lots, LotDetail (timeline + handover QR),
│   │                      #   Earnings, SafetyGuide
│   └── recycler/          # RecyclerApp (portal shell), Dashboard, Available Lots,
│                          #   Review/quote/reject, Transactions, Facility
├── components/            # icons.tsx (SVG set), shell.tsx, ui/kit.tsx, ui/timeline.tsx
├── hooks/use-kc-data.ts   # Data hooks incl. offline price cache
└── lib/
    ├── app-state.ts       # Language, online status, offline queue, toasts, speech, sync worker
    ├── i18n.ts            # EN/HI/MR dictionary + spoken price sentences
    └── format.ts          # ₹/kg/date formatting, image compression
```

### API mapping (brief → implementation)

| Brief endpoint | Convex function |
|---|---|
| `POST /auth/*` | Convex Auth (`signIn`/`signOut`) + `profiles.createProfile` |
| `GET /auth/me` | `profiles.myProfile` |
| `GET /materials`, `GET /materials/{id}` | `materials.listMaterials` |
| `GET /prices`, `GET /prices/trends` | `materials.priceTrends` + material rates |
| `POST /lots`, `GET /lots`, `GET /lots/{id}` | `lots.createLot`, `lots.listLots`, `lots.getLot` |
| `POST /ai/classify-material` | `ai.classifyMaterial` (action) |
| `POST /ai/estimate-value` | `lots.estimateValue` (rate × condition multiplier) |
| `POST /recyclers/match`, `GET /recyclers` | `recyclers.matchRecyclers`, `recyclers.listRecyclers` |
| `PATCH /transactions/{id}/status` | `lots.quoteLot` / `lots.sendLot` |
| `POST /transactions/{id}/handover` | `lots.confirmHandover` (two-sided) |
| `POST /transactions/{id}/payment` | `lots.markPaymentCompleted` |
| `GET /earnings/summary`, `/monthly` | `lots.earningsSummary`, `lots.monthlyEarnings` |
| `POST /sync` | `sync.syncQueue` (idempotent per `clientRef`) |
| `GET /safety-guides` | `materials.listSafetyGuides` |

### Transaction dataset fields (as specified in the brief)

`referenceId` · `materialCode` · `photoDataUrl` · `weight` · `estimatedValue` · `quotedPrice` ·
`finalSaleValue` · `createdAt` · `locationLabel` · `collectorId` · `recyclerId` · `status` ·
`paymentMethod` · `handoverAt` (+ handover ref/checksum, sync origin, AI attribution).

### The four AI/ML capabilities

- **A. Material classification** — `ai.classifyMaterial` action returns `{materialCode, confidence,
  candidates, model}`; mock today, one function to replace tomorrow.
- **B. Valuation** — explainable: `rate(material) × condition multiplier × weight`.
- **C. Recycler matching** — **transparent scoring function** (material 40 · verification 20 ·
  distance ≤15 · pickup 10 · rate ≤10 · rating ≤5). Explicitly *not* labelled "AI matching".
- **D. Anomaly detection** — rules engine in `lots.ts` (invalid/unusual weight, quote ≫ market rate,
  damaged-condition overpricing, final ≫ estimate). Writes `anomalyFlags`, renders "Review
  recommended" — never blocks, never accuses.

---

## Product principles in the build

Trust (verified badges, traceable IDs) · Transparency (live rates, trends, quote vs estimate) ·
Accessibility (EN/HI/MR, voice prices, large touch targets, aria labels, focus states) ·
Traceability (KC-2026-XXXX IDs, two-sided handover record + QR) · Inclusion (camera-first, minimal
typing) · Offline-first (queue + honest status chips) · Fairness (estimate vs quote always shown) ·
Safety (per-material guides with TTS) · Data (every lot produces the full structured record) ·
Scalability (single-swap AI seam, reactive backend).

## Demo data

Materials: PCB ₹410/kg, LCD ₹95, CRT ₹42, Copper Cable ₹320, Lead Battery ₹138, Motors ₹105, Mixed
Plastic ₹38 — each with 90 days of generated history. Recyclers: GreenCycle Recycling (Okhla),
Delhi E-Waste Solutions (Anand Parbat), NCR Metal Reclaimers (Kirti Nagar), Yamuna Green Recyclers
(Transport Nagar) — all clearly marked demo.
