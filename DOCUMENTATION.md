# BimaBima — Nzoia Basin Flood Risk Underwriting Platform
## Technical & Functional Documentation

---

## 1. System Overview

BimaBima is a flood risk underwriting decision-support platform built for the Kenyan insurance market, specifically targeting the Nzoia River Basin. It enables underwriters to:

- Assess flood risk for individual properties using a 4-stage catastrophe (CAT) model
- Browse and filter a portfolio of 500 buildings with risk tiers and loss estimates
- View the portfolio-level Exceedance Probability (EP) curve and Average Annual Loss (AAL)
- Identify anomalous buildings whose loss profiles deviate from expected patterns

The system is a monorepo with two components:

| Component | Technology | Location |
|-----------|-----------|----------|
| Frontend  | React 19 + Vite + Recharts + Leaflet | `dashboard/client/` |
| Backend   | Node.js + Express | `dashboard/server/` |
| Data      | CSV flat files | `FINAL/` root |

---

## 2. Project Structure

```
FINAL/
├── dashboard/
│   ├── client/                        # React frontend
│   │   ├── public/
│   │   │   └── logo.png               # Brand logo (white background PNG)
│   │   └── src/
│   │       ├── App.jsx                # Shell layout, routing, auth gate
│   │       ├── App.css                # Global design system (CSS variables)
│   │       ├── api.js                 # Axios instance (baseURL: localhost:5000/api)
│   │       ├── main.jsx               # React entry point
│   │       └── pages/
│   │           ├── Auth.jsx           # Login / Register page
│   │           ├── Assessor.jsx       # Single-property CAT model UI
│   │           ├── Overview.jsx       # Portfolio KPI dashboard
│   │           ├── EpCurvePage.jsx    # EP curve + methodology
│   │           ├── Portfolio.jsx      # Building table + drawer
│   │           └── Anomalies.jsx      # Flagged risk review
│   └── server/
│       └── index.js                   # Express API server (port 5000)
├── nzoia_underwriter_portfolio.csv    # 500-building portfolio
└── nzoia_underwriter_loss_table.csv   # Loss table (6 return periods × 500 buildings)
```

---

## 3. Data Sources

### 3.1 `nzoia_underwriter_portfolio.csv`
One row per building. Key columns:

| Column | Description |
|--------|-------------|
| `loc_id` | Unique building identifier (e.g. `LOC_001`) |
| `lat`, `lon` | GPS coordinates (WGS84) |
| `housing_class` | Construction type: `informal_iron_sheet`, `semi_permanent`, `permanent_masonry`, `concrete_rcc` |
| `floor_area_m2` | Floor area in square metres |
| `cost_per_m2_kes` | Rebuilding cost per m² in Kenyan Shillings |
| `tiv_kes` | Total Insured Value = `floor_area_m2 × cost_per_m2_kes` |
| `flood_probability_rp100` | Probability of flooding in a 1-in-100 year event |
| `ml3_anomaly_score` | Isolation Forest anomaly score (negative = outlier) |
| `ml3_flag` | Boolean — `True` if building is flagged for review |

### 3.2 `nzoia_underwriter_loss_table.csv`
One row per building per return period (6 RPs × 500 buildings = 3,000 rows). Key columns:

| Column | Description |
|--------|-------------|
| `loc_id` | Links to portfolio |
| `lat`, `lon` | Building coordinates |
| `housing_class` | Construction type |
| `tiv_kes` | Total Insured Value |
| `return_period` | Flood return period: 10, 20, 50, 100, 200, 500 years |
| `aep` | Annual Exceedance Probability = `1 / return_period` |
| `depth_m` | Expected flood water depth in metres (0 = not flooded) |
| `damage_ratio` | Fraction of TIV destroyed (0–1) |
| `gross_loss_kes` | `damage_ratio × tiv_kes` |
| `deductible_kes` | Insured's excess (2% of TIV, capped at gross loss) |
| `net_loss_kes` | `gross_loss_kes − deductible_kes` (insurer's liability) |

---

## 4. Backend — Express API (`server/index.js`)

The server loads both CSVs into memory on startup, then serves 5 REST endpoints.

### 4.1 Startup & Data Loading

#### `loadCSV(filename) → Promise<Array>`
Streams a CSV file from the `FINAL/` directory using `csv-parser` and resolves with an array of row objects. Called once at startup for both CSVs.

```
loadData()
  → portfolio[]   (500 rows from nzoia_underwriter_portfolio.csv)
  → lossTable[]   (3000 rows from nzoia_underwriter_loss_table.csv)
```

---

### 4.2 Helper Functions

#### `num(v) → float`
Safely parses any value to a float, returning 0 on failure. Used throughout to prevent NaN propagation from CSV string values.

#### `bool(v) → boolean`
Converts `"True"` string or native `true` to boolean. Used for the `ml3_flag` column.

#### `tierFromDR(damage_ratio) → string`
Maps a damage ratio (0–1) to a risk tier using fixed thresholds:

| Damage Ratio | Tier | Meaning |
|---|---|---|
| ≤ 0.05 | Low | < 5% of value destroyed |
| ≤ 0.20 | Medium | 5–20% destroyed |
| ≤ 0.45 | High | 20–45% destroyed |
| > 0.45 | Decline | > 45% destroyed |

The damage ratio used is always from the **1-in-100 year return period** — the industry standard benchmark for property underwriting.

#### `tierColor(tier) → hex string`
Returns a hex colour for each tier: green / yellow / orange / red. Used in API responses for frontend badge rendering.

#### `recommendation(tier) → string`
Returns a plain-English underwriting action for each tier:
- **Low** → Accept at standard rate
- **Medium** → Accept with flood endorsement
- **High** → Accept with sub-limit and higher deductible
- **Decline** → Decline or refer to facultative reinsurance

---

### 4.3 API Endpoints

#### `GET /api/portfolio`
Returns all 500 buildings with their RP100 damage ratio and risk tier pre-computed. Used by the Portfolio and Anomalies pages.

**Response fields per building:**
`loc_id`, `lat`, `lon`, `housing_class`, `floor_area_m2`, `tiv_kes`, `flood_probability`, `ml3_anomaly_score`, `ml3_flag`, `damage_ratio_rp100`, `risk_tier`, `tier_color`

---

#### `GET /api/portfolio/stats`
Computes portfolio-level KPIs in a single call. Used by Overview and EP Curve pages.

**Computed values:**

| Field | How it's computed |
|---|---|
| `totalTIV` | Sum of `tiv_kes` across all buildings |
| `totalBldgs` | Count of portfolio rows |
| `anomalies` | Count of buildings where `ml3_flag = True` |
| `tierCounts` | Object `{Low, Medium, High, Decline}` — building counts per tier |
| `tierTIV` | Object `{Low, Medium, High, Decline}` — total TIV per tier |
| `epCurve` | Array of `{return_period, aep, net_loss, flooded}` — one entry per RP |
| `aal` | Average Annual Loss (trapezoid integration of EP curve) |
| `pureRate` | `aal / totalTIV` — minimum break-even premium rate |
| `grossRate` | `pureRate × 1.35` — loaded rate (35% for expenses + profit) |
| `grossPremium` | `totalTIV × grossRate` |

**EP Curve construction:**
All `net_loss_kes` values are summed per return period across all buildings. The `flooded` count is the number of buildings with `depth_m > 0` at that RP.

**AAL (Average Annual Loss) — Trapezoid Integration:**
```
Sort EP curve points by AEP ascending
Prepend (AEP=0, loss=0) as the origin
AAL = Σ [ 0.5 × (loss[i] + loss[i-1]) × (AEP[i] − AEP[i-1]) ]
```
This is the standard actuarial method — it computes the area under the loss-exceedance curve, which equals the expected loss per year.

---

#### `GET /api/building/:id`
Returns full detail for a single building including its complete loss curve across all 6 return periods, plus building-level AAL and premium.

**Additional computed fields vs portfolio endpoint:**
`cost_per_m2_kes`, `recommendation`, `aal` (building-level), `pure_rate`, `gross_rate`, `suggested_premium`, `losses[]`

---

#### `GET /api/search?q=`
Fuzzy text search across `loc_id` and `housing_class`. Returns up to 20 matches. Used by the Portfolio page search bar.

---

#### `POST /api/assess`
The core CAT model endpoint. Runs the full 4-stage pipeline for any arbitrary building input.

**Request body:**
```json
{
  "lat": 0.6234,
  "lon": 33.97,
  "housing_class": "concrete_rcc",
  "floor_area_m2": 3570,
  "cost_per_m2_kes": 65000
}
```

**Response:** Same structure as `/api/building/:id` but computed on-the-fly.

---

## 5. The CAT Model — 4-Stage Pipeline

This is the core scientific engine of the platform. It runs inside `POST /api/assess` for new buildings and was used offline to pre-compute the loss table for portfolio buildings.

### Stage 1 — Hazard: `estimateDepths(lat, lon) → {rp: depth_m}`

Estimates flood water depth at the given coordinates for each of the 6 return periods (10, 20, 50, 100, 200, 500 years).

**Method — Nearest-Neighbour Spatial Interpolation:**

```
For each return period RP:
  1. Filter lossTable to rows where return_period = RP AND depth_m > 0
     (only flooded buildings are used as reference points)
  2. Compute Euclidean distance in degrees from (lat, lon) to each flooded building
  3. Sort by distance, take the 3 nearest
  4. If nearest distance > 1.5° (~165 km): depth = 0 (outside basin)
  5. Otherwise: depth = nearest.depth × max(0, 1 − distance / 1.5)
     (linear decay — full depth at distance=0, zero depth at 1.5°)
```

**Design rationale:** Flood depth is spatially correlated — buildings close to a flooded reference point are likely to experience similar depths. The linear decay prevents unrealistic depth estimates far from the flood corridor. The 1.5° cutoff ensures buildings outside the Nzoia Basin receive zero depth.

**Limitation:** This is a simplified spatial interpolation, not a full hydraulic model. It works well within the basin but should not be used for sites far outside the portfolio's geographic extent.

---

### Stage 2 — Vulnerability: `logistic(depth, housing_class) → damage_ratio`

Converts flood depth to a damage ratio (fraction of TIV destroyed) using a **logistic (sigmoid) function** parameterised by construction type.

**Formula:**
```
DR(d) = max_dr / (1 + exp(−k × (d − d0)))
```

**Parameters by construction type:**

| Class | `max_dr` | `k` (steepness) | `d0` (inflection depth, m) | Interpretation |
|---|---|---|---|---|
| `informal_iron_sheet` | 0.95 | 1.80 | 0.50 | Highly vulnerable; near-total loss at ~1.5m |
| `semi_permanent` | 0.85 | 1.40 | 0.80 | Moderate vulnerability; significant damage at ~1.5m |
| `permanent_masonry` | 0.75 | 1.10 | 1.20 | More resilient; major damage only at deeper floods |
| `concrete_rcc` | 0.60 | 0.90 | 1.80 | Most resilient; limited damage even at deep floods |

**Model explainability:**

- `max_dr` — the maximum possible damage ratio for this construction type. Iron sheet structures can be almost completely destroyed; reinforced concrete has a structural floor that limits total loss.
- `k` — controls how steeply damage increases with depth. Higher k means damage escalates quickly once water enters the building.
- `d0` — the depth at which damage is at 50% of its maximum. Iron sheet buildings are half-destroyed at just 0.5m; concrete buildings need 1.8m before reaching that point.
- The logistic shape reflects real-world flood damage curves: slow initial damage as water enters, rapid escalation through the critical depth range, then diminishing returns as the building is already heavily damaged.

**Why logistic and not linear?**
Linear models overestimate damage at low depths and underestimate at high depths. The logistic curve matches empirical flood damage data from post-event surveys, which consistently show an S-shaped relationship between depth and damage.

---

### Stage 3 — Loss Calculation

For each return period:

```
gross_loss    = damage_ratio × tiv_kes
deductible    = min(tiv_kes × 0.02, gross_loss)   ← 2% of TIV, floored at 0
net_loss      = gross_loss − deductible
```

The 2% deductible represents the insured's excess — the portion of every loss they absorb themselves. This is a standard flood policy condition.

---

### Stage 4 — Premium Calculation

```
AAL        = trapezoid integration of (AEP, net_loss) curve
pure_rate  = AAL / tiv_kes          ← minimum rate to break even
gross_rate = pure_rate × 1.35       ← 35% loading
premium    = tiv_kes × gross_rate
```

The **35% loading** covers:
- Operating expenses (~20%)
- Profit margin (~10%)
- Reinsurance cost (~5%)

This is a simplified loading factor. In production, each component would be modelled separately.

---

## 6. Risk Tier System

The tier is determined solely by the **RP100 damage ratio** (damage in a 1-in-100 year flood):

| Tier | DR Range | Badge Colour | Underwriting Action |
|---|---|---|---|
| Low | 0–5% | Green | Accept at standard rate |
| Medium | 5–20% | Amber | Accept with flood endorsement |
| High | 20–45% | Orange | Accept with sub-limit + higher excess |
| Decline | > 45% | Red | Decline or refer to facultative reinsurance |

**Why RP100?** The 1-in-100 year event is the global insurance industry standard for property risk assessment. It balances frequency (common enough to be meaningful) with severity (severe enough to differentiate risk).

---

## 7. Anomaly Detection — Isolation Forest

### What it detects
Buildings whose combination of flood depth, damage ratio, and insured value is statistically unusual compared to the rest of the portfolio.

### How it works
Isolation Forest is an unsupervised machine learning algorithm. It builds an ensemble of random decision trees, each of which randomly partitions the feature space. Anomalous points — those that are unusual — require fewer splits to isolate, resulting in a shorter average path length and a more negative anomaly score.

**Features used:**
- `depth_m` at RP100
- `damage_ratio` at RP100
- `tiv_kes`
- `housing_class` (encoded)

**Score interpretation:**
- Score < 0 → outlier (flagged)
- Score closer to −1 → stronger anomaly
- Score > 0 → normal

### What triggers a flag
Examples of anomalous patterns:
- A `concrete_rcc` building with very high damage ratio at shallow depth (suggests data error or misclassification)
- An `informal_iron_sheet` building with surprisingly low damage at deep water (suggests TIV may be understated)
- A building with very high TIV but low flood probability in a known flood corridor

### What to do with a flag
A flag does **not** mean decline. It means verify the data before binding:
1. Confirm construction type matches site survey
2. Verify floor area and rebuilding cost
3. Confirm GPS coordinates are correct
4. Check for recent building modifications

---

## 8. Frontend Pages

### 8.1 Auth (`Auth.jsx`)
Login and registration gate. Currently uses simulated authentication (700ms delay). Stores user object `{name, email}` in React state. Sign-out clears state and returns to the auth screen.

**To connect to real auth:** Replace the `setTimeout` in `handleSubmit` with a `POST /api/auth/login` or `POST /api/auth/register` call.

---

### 8.2 Risk Assessment (`Assessor.jsx`)

The primary underwriting tool. Two modes:

**Sample Property mode:** Pre-loaded buildings from `PDF_BUILDINGS` array (4 buildings from a Bungoma grain processing facility). Underwriter selects from a dropdown and runs the model.

**Add New Property mode:** Manual form with fields for GPS coordinates, construction type, floor area, and rebuilding cost. TIV is computed live as `floor_area × cost_per_m2`.

**Output — ResultText component:**
- Underwriting decision badge + risk bar (needle shows DR position on Low→Decline scale)
- Plain-English summary: flood depth, damage %, AAL, premium estimate
- "View Full Flood Risk Analysis" button reveals the Analysis component

**Output — Analysis component:**
- Area chart: net loss by return period
- Bar chart: damage ratio by return period
- Leaflet map: property location on dark CartoDB basemap
- Full loss table: all 6 scenarios with depth, damage, gross loss, deductible, net loss

**Key functions:**

| Function | Purpose |
|---|---|
| `fmt(n)` | Formats KES values as "KES X.XX million/billion" |
| `fmtShort(n)` | Short format "KES X.XM/B" for chart labels |
| `pct(n)` | Formats decimal as percentage string |
| `TierBadge({tier})` | Renders coloured badge for a risk tier |
| `ResultText({result, onViewAnalysis})` | Renders the plain-English assessment summary |
| `Analysis({result})` | Renders charts, map, and loss table |

---

### 8.3 Portfolio Summary (`Overview.jsx`)

Portfolio-level KPI dashboard. Fetches from `GET /api/portfolio/stats`.

**Displays:**
- 6 KPI cards: total buildings, total TIV, AAL, technical rate, recommended premium, flagged count
- Bar chart: building count by risk tier (colour-coded)
- Line chart: portfolio net loss by return period
- TIV by risk tier (4 coloured cards with left border)
- Loss table: all 6 RP scenarios with flooded count and loss as % of TIV

---

### 8.4 Loss Curve (`EpCurvePage.jsx`)

Detailed EP curve analysis. Fetches from `GET /api/portfolio/stats`.

**Displays:**
- Plain-English explanation of what a return period means
- 6 KPI cards including RP100 loss and both premium rates
- Main area chart: net loss vs return period with RP100 reference line
- Secondary line chart: loss vs AEP (probability view)
- Loss table
- Methodology explanation (hazard → damage → loss → AAL → premium)

---

### 8.5 All Buildings (`Portfolio.jsx`)

Full portfolio table with search and filter.

**Features:**
- Text search (debounced 250ms) via `GET /api/search?q=`
- Filter pills by risk tier
- Sortable table with flood probability mini progress bar
- Click any row → opens `Drawer` side panel

**Drawer component:**
Fetches `GET /api/building/:id` and shows:
- Underwriting decision + recommendation
- 6 key figures (TIV, floor area, flood probability, RP100 damage, AAL, suggested premium)
- Bar chart of net loss by scenario
- Full loss table
- Warning banner if `ml3_flag = true`

---

### 8.6 Flagged Risks (`Anomalies.jsx`)

Anomaly review page. Fetches all buildings then fetches full detail for each flagged building in parallel.

**Displays:**
- Info note explaining what a flag means
- KPI cards: flagged count, flag rate, total TIV at risk, detection method
- Scatter chart: damage ratio vs insured value — normal buildings (blue) vs flagged (orange)
- Flagged buildings table with anomaly scores
- Explanation of Isolation Forest methodology

---

## 9. Design System

All styles are in `App.css` using CSS custom properties.

**Colour palette:**

| Variable | Value | Usage |
|---|---|---|
| `--primary` | `#4f46e5` | Indigo — buttons, links, chart lines |
| `--primary-dk` | `#3730a3` | Dark indigo — sidebar background |
| `--primary-lt` | `#eef2ff` | Light indigo — hover states |
| `--bg` | `#f0f4f8` | Page background |
| `--surface` | `#ffffff` | Cards, panels |
| `--green` | `#059669` | Low risk |
| `--yellow` | `#d97706` | Medium risk |
| `--orange` | `#ea580c` | High risk |
| `--red` | `#dc2626` | Decline |

**Component classes:** `.card`, `.kpi`, `.badge`, `.btn`, `.tbl`, `.pill`, `.field`, `.result-block`, `.decision-box`, `.risk-bar`

---

## 10. Running the System

### Prerequisites
- Node.js 18+
- npm

### Start the backend
```bash
cd dashboard/server
npm install
node index.js
# Server running on http://localhost:5000
```

### Start the frontend
```bash
cd dashboard/client
npm install
npm run dev
# Vite dev server on http://localhost:5173
```

Both must be running simultaneously. The frontend proxies all `/api` calls to `localhost:5000` via the Axios base URL in `api.js`.

---

## 11. Known Limitations & Future Work

| Limitation | Recommended Fix |
|---|---|
| Auth is simulated (no real user accounts) | Integrate JWT auth with `POST /api/auth/login` and bcrypt password hashing |
| Hazard uses nearest-neighbour interpolation, not a hydraulic model | Replace with JRC flood raster lookup using `gdal` or `geotiff.js` |
| 35% premium loading is a fixed constant | Break into separate expense, profit, and reinsurance components |
| Portfolio data is synthetic | Replace CSVs with real survey data |
| No persistence — all state is in-memory | Add PostgreSQL or MongoDB for user data, assessments, and audit trail |
| Google OAuth not yet connected | Integrate `@react-oauth/google` with a Client ID from Google Cloud Console |
| No PDF export | Add `react-pdf` or server-side PDF generation for assessment reports |

---

## 12. Glossary

| Term | Definition |
|---|---|
| **TIV** | Total Insured Value — the maximum amount the insurer would pay |
| **Return Period** | The average number of years between events of a given severity. A 1-in-100 year flood has a 1% chance of occurring in any given year |
| **AEP** | Annual Exceedance Probability = 1 / return_period |
| **Damage Ratio** | Fraction of TIV destroyed in a flood event (0 = no damage, 1 = total loss) |
| **AAL** | Average Annual Loss — the expected loss per year, averaged across all possible flood events |
| **Pure Rate** | The minimum premium rate needed to cover expected losses (AAL / TIV) |
| **Gross Rate** | Pure rate plus loadings for expenses, profit, and reinsurance |
| **EP Curve** | Exceedance Probability curve — plots loss against the probability of that loss being exceeded in any year |
| **Deductible / Excess** | The portion of each loss paid by the insured before the insurer pays |
| **Isolation Forest** | An unsupervised ML algorithm for anomaly detection based on random partitioning |
| **Facultative Reinsurance** | Case-by-case reinsurance for individual high-risk policies that exceed the insurer's appetite |
| **CAT Model** | Catastrophe model — a probabilistic model that estimates losses from natural hazard events |
