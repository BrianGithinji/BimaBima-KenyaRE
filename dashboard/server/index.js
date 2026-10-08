const express  = require("express");
const cors     = require("cors");
const fs       = require("fs");
const path     = require("path");
const csv      = require("csv-parser");
const multer   = require("multer");
async function pdfParse(buffer) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(" ") + "\n";
  }
  return { text, numpages: doc.numPages };
}
const XLSX     = require("xlsx");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const app  = express();
const PORT = 5000;

app.use(cors({
  origin: process.env.CLIENT_URL || "*",
}));
app.use(express.json());

// ── CSV loader ────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname);

function loadCSV(filename) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(path.join(DATA_DIR, filename))
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end",  () => resolve(rows))
      .on("error", reject);
  });
}

let portfolio = [];
let lossTable = [];

async function loadData() {
  portfolio = await loadCSV("nzoia_underwriter_portfolio.csv");
  lossTable = await loadCSV("nzoia_underwriter_loss_table.csv");
  console.log(`Loaded ${portfolio.length} buildings, ${lossTable.length} loss rows`);
}

// ── helpers ───────────────────────────────────────────────────────────────────

function num(v)  { return parseFloat(v)  || 0; }
function bool(v) { return v === "True" || v === true; }

function tierFromDR(dr) {
  if (dr <= 0.05) return "Low";
  if (dr <= 0.20) return "Medium";
  if (dr <= 0.45) return "High";
  return "Decline";
}

function tierColor(tier) {
  return { Low: "#2ecc71", Medium: "#f1c40f", High: "#e67e22", Decline: "#e74c3c" }[tier] || "#aaa";
}

function recommendation(tier) {
  return {
    Low:     "Accept at standard rate",
    Medium:  "Accept with flood endorsement",
    High:    "Accept — apply sub-limit and higher deductible",
    Decline: "Decline or refer to facultative reinsurance",
  }[tier];
}

// ── GET /api/portfolio  (all buildings, map view) ─────────────────────────────

app.get("/api/portfolio", (req, res) => {
  const data = portfolio.map((b) => {
    const rp100Loss = lossTable.find(
      (r) => r.loc_id === b.loc_id && parseInt(r.return_period) === 100
    );
    const dr   = rp100Loss ? num(rp100Loss.damage_ratio) : 0;
    const tier = tierFromDR(dr);
    return {
      loc_id:               b.loc_id,
      lat:                  num(b.lat),
      lon:                  num(b.lon),
      housing_class:        b.housing_class,
      floor_area_m2:        num(b.floor_area_m2),
      tiv_kes:              num(b.tiv_kes),
      flood_probability:    num(b.flood_probability_rp100),
      ml3_anomaly_score:    b.ml3_anomaly_score !== "" ? num(b.ml3_anomaly_score) : null,
      ml3_flag:             bool(b.ml3_flag),
      damage_ratio_rp100:   dr,
      risk_tier:            tier,
      tier_color:           tierColor(tier),
    };
  });
  res.json(data);
});

// ── GET /api/portfolio/stats  (portfolio-level KPIs) ─────────────────────────

app.get("/api/portfolio/stats", (req, res) => {
  const totalTIV    = portfolio.reduce((s, b) => s + num(b.tiv_kes), 0);
  const totalBldgs  = portfolio.length;
  const anomalies   = portfolio.filter((b) => bool(b.ml3_flag)).length;

  const tierCounts  = { Low: 0, Medium: 0, High: 0, Decline: 0 };
  const tierTIV     = { Low: 0, Medium: 0, High: 0, Decline: 0 };

  portfolio.forEach((b) => {
    const rp100 = lossTable.find(
      (r) => r.loc_id === b.loc_id && parseInt(r.return_period) === 100
    );
    const dr   = rp100 ? num(rp100.damage_ratio) : 0;
    const tier = tierFromDR(dr);
    tierCounts[tier]++;
    tierTIV[tier] += num(b.tiv_kes);
  });

  // EP curve — aggregate net loss per RP
  const rpGroups = {};
  lossTable.forEach((r) => {
    const rp = parseInt(r.return_period);
    if (!rpGroups[rp]) rpGroups[rp] = { net_loss: 0, flooded: 0 };
    rpGroups[rp].net_loss += num(r.net_loss_kes);
    if (num(r.depth_m) > 0) rpGroups[rp].flooded++;
  });
  const epCurve = Object.entries(rpGroups)
    .map(([rp, v]) => ({ return_period: parseInt(rp), aep: 1 / parseInt(rp), ...v }))
    .sort((a, b) => a.return_period - b.return_period);

  // AAL via trapezoid
  const sorted   = [...epCurve].sort((a, b) => a.aep - b.aep);
  const aepPts   = [0, ...sorted.map((r) => r.aep)];
  const lossPts  = [0, ...sorted.map((r) => r.net_loss)];
  let aal = 0;
  for (let i = 1; i < aepPts.length; i++) {
    aal += 0.5 * (lossPts[i] + lossPts[i - 1]) * (aepPts[i] - aepPts[i - 1]);
  }
  const pureRate  = aal / totalTIV;
  const grossRate = pureRate * 1.35;

  res.json({
    totalBldgs, totalTIV, anomalies,
    aal, pureRate, grossRate,
    grossPremium: totalTIV * grossRate,
    tierCounts, tierTIV, epCurve,
  });
});

// ── GET /api/building/:id  (single building deep-dive) ───────────────────────

app.get("/api/building/:id", (req, res) => {
  const b = portfolio.find((r) => r.loc_id === req.params.id);
  if (!b) return res.status(404).json({ error: "Building not found" });

  const losses = lossTable
    .filter((r) => r.loc_id === b.loc_id)
    .map((r) => ({
      return_period:  parseInt(r.return_period),
      aep:            num(r.aep),
      depth_m:        num(r.depth_m),
      damage_ratio:   num(r.damage_ratio),
      gross_loss_kes: num(r.gross_loss_kes),
      deductible_kes: num(r.deductible_kes),
      net_loss_kes:   num(r.net_loss_kes),
    }))
    .sort((a, b) => a.return_period - b.return_period);

  const rp100 = losses.find((r) => r.return_period === 100) || {};
  const dr    = rp100.damage_ratio || 0;
  const tier  = tierFromDR(dr);

  // AAL for this building
  const sorted  = [...losses].sort((a, b) => a.aep - b.aep);
  const aepPts  = [0, ...sorted.map((r) => r.aep)];
  const lossPts = [0, ...sorted.map((r) => r.net_loss_kes)];
  let bldgAAL = 0;
  for (let i = 1; i < aepPts.length; i++) {
    bldgAAL += 0.5 * (lossPts[i] + lossPts[i - 1]) * (aepPts[i] - aepPts[i - 1]);
  }
  const tiv       = num(b.tiv_kes);
  const pureRate  = tiv > 0 ? bldgAAL / tiv : 0;
  const grossRate = pureRate * 1.35;

  res.json({
    loc_id:            b.loc_id,
    lat:               num(b.lat),
    lon:               num(b.lon),
    housing_class:     b.housing_class,
    floor_area_m2:     num(b.floor_area_m2),
    cost_per_m2_kes:   num(b.cost_per_m2_kes),
    tiv_kes:           tiv,
    flood_probability: num(b.flood_probability_rp100),
    ml3_anomaly_score: b.ml3_anomaly_score !== "" ? num(b.ml3_anomaly_score) : null,
    ml3_flag:          bool(b.ml3_flag),
    damage_ratio_rp100: dr,
    risk_tier:         tier,
    tier_color:        tierColor(tier),
    recommendation:    recommendation(tier),
    aal:               bldgAAL,
    pure_rate:         pureRate,
    gross_rate:        grossRate,
    suggested_premium: tiv * grossRate,
    losses,
  });
});

// ── GET /api/search?q=  (search by loc_id or housing_class) ──────────────────

app.get("/api/search", (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  if (!q) return res.json([]);
  const results = portfolio
    .filter(
      (b) =>
        b.loc_id.toLowerCase().includes(q) ||
        b.housing_class.toLowerCase().includes(q)
    )
    .slice(0, 20)
    .map((b) => ({ loc_id: b.loc_id, housing_class: b.housing_class, tiv_kes: num(b.tiv_kes) }));
  res.json(results);
});

// ── POST /api/assess  (manual CAT model for any building input) ─────────────
// Runs the full 4-stage pipeline: Hazard lookup -> Vulnerability -> Loss -> Premium
// Body: { lat, lon, housing_class, floor_area_m2, cost_per_m2_kes }

const VULN = {
  informal_iron_sheet: { max_dr: 0.95, k: 1.80, d0: 0.50 },
  semi_permanent:      { max_dr: 0.85, k: 1.40, d0: 0.80 },
  permanent_masonry:   { max_dr: 0.75, k: 1.10, d0: 1.20 },
  concrete_rcc:        { max_dr: 0.60, k: 0.90, d0: 1.80 },
};

function logistic(depth, cls) {
  if (depth <= 0) return 0;
  const p  = VULN[cls];
  if (!p) return 0;
  const dr = p.max_dr / (1 + Math.exp(-p.k * (depth - p.d0)));
  return Math.min(Math.max(dr, 0), p.max_dr);
}

// Depth lookup from pre-loaded loss table (nearest building by lat/lon per RP)
// For manual inputs we interpolate from the portfolio's depth distribution
function estimateDepths(lat, lon) {
  // Find nearest flooded buildings per RP and interpolate depth by distance.
  // Hard cutoff at 1.5 degrees (~165 km); depth decays linearly with distance.
  const RPS    = [10, 20, 50, 100, 200, 500];
  const CUTOFF = 1.5;   // degrees — beyond this the site is considered outside the basin
  const result = {};
  RPS.forEach((rp) => {
    const rpRows = lossTable.filter((r) => parseInt(r.return_period) === rp && num(r.depth_m) > 0);
    if (!rpRows.length) { result[rp] = 0; return; }
    const dists = rpRows.map((r) => ({
      d:     Math.hypot(num(r.lat) - lat, num(r.lon) - lon),
      depth: num(r.depth_m),
    })).sort((a, b) => a.d - b.d).slice(0, 3);
    const nearest = dists[0];
    if (nearest.d > CUTOFF) { result[rp] = 0; return; }
    // Linear decay: full depth at d=0, zero depth at d=CUTOFF
    const scale   = Math.max(0, 1 - nearest.d / CUTOFF);
    result[rp]    = parseFloat((nearest.depth * scale).toFixed(3));
  });
  return result;
}

app.post("/api/assess", (req, res) => {
  const { lat, lon, housing_class, floor_area_m2, cost_per_m2_kes } = req.body;
  if (!lat || !lon || !housing_class || !floor_area_m2 || !cost_per_m2_kes)
    return res.status(400).json({ error: "Missing required fields" });
  if (!VULN[housing_class])
    return res.status(400).json({ error: "Invalid housing_class" });

  const tiv    = parseFloat(floor_area_m2) * parseFloat(cost_per_m2_kes);
  const depths = estimateDepths(parseFloat(lat), parseFloat(lon));
  const DEDUCT = 0.02;

  const losses = Object.entries(depths).map(([rp, depth]) => {
    const dr         = logistic(depth, housing_class);
    const gross      = dr * tiv;
    const deductible = Math.min(tiv * DEDUCT, gross);
    const net        = gross - deductible;
    return { return_period: parseInt(rp), aep: 1 / parseInt(rp), depth_m: depth, damage_ratio: dr, gross_loss_kes: gross, deductible_kes: deductible, net_loss_kes: net };
  }).sort((a, b) => a.return_period - b.return_period);

  // AAL
  const sorted  = [...losses].sort((a, b) => a.aep - b.aep);
  const aepPts  = [0, ...sorted.map((r) => r.aep)];
  const lossPts = [0, ...sorted.map((r) => r.net_loss_kes)];
  let aal = 0;
  for (let i = 1; i < aepPts.length; i++)
    aal += 0.5 * (lossPts[i] + lossPts[i - 1]) * (aepPts[i] - aepPts[i - 1]);

  const pureRate  = tiv > 0 ? aal / tiv : 0;
  const grossRate = pureRate * 1.35;
  const rp100     = losses.find((r) => r.return_period === 100) || {};
  const tier      = tierFromDR(rp100.damage_ratio || 0);

  res.json({
    tiv_kes: tiv, housing_class, floor_area_m2: parseFloat(floor_area_m2),
    cost_per_m2_kes: parseFloat(cost_per_m2_kes), lat: parseFloat(lat), lon: parseFloat(lon),
    risk_tier: tier, tier_color: tierColor(tier), recommendation: recommendation(tier),
    damage_ratio_rp100: rp100.damage_ratio || 0,
    aal, pure_rate: pureRate, gross_rate: grossRate, suggested_premium: tiv * grossRate,
    losses,
  });
});

// ── POST /api/extract  (document agent — extract buildings from uploaded file) ─
//
// Accepts: PDF, Excel (.xlsx/.xls), CSV
// Returns: { buildings[], log[], rawText? }
//
// Extraction strategy:
//   PDF  → pdf-parse → full text → regex + heuristic field matching
//   XLSX → xlsx      → first sheet rows → column header mapping
//   CSV  → xlsx      → same as XLSX

const HOUSING_ALIASES = {
  informal_iron_sheet: ["iron sheet","iron","mabati","corrugated","timber frame","informal","tin"],
  semi_permanent:      ["semi","semi-permanent","semi permanent","mixed","block and iron"],
  permanent_masonry:   ["masonry","stone","brick","permanent","block","concrete block"],
  concrete_rcc:        ["rcc","reinforced concrete","concrete frame","rc frame","reinforced"],
};

function classifyConstruction(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  for (const [cls, aliases] of Object.entries(HOUSING_ALIASES))
    if (aliases.some((a) => t.includes(a))) return cls;
  return null;
}

// ── PDF extraction ────────────────────────────────────────────────────────────
function extractFromPDF(text) {
  const log = ["Parsed PDF text."];
  const buildings = [];

  // Split into candidate blocks — paragraphs or table rows
  // Strategy: look for repeating patterns of building descriptors
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  log.push(`Found ${lines.length} text lines.`);

  // Pass 1 — look for structured table rows with numeric columns
  // Pattern: any line containing lat/lon-like numbers (±90 / ±180 range)
  const latLonRe = /(-?\d{1,2}\.\d{3,6})\s*(?:°?[NS])?[,\s]+(-?\d{2,3}\.\d{3,6})\s*(?:°?[EW])?/i;
  const areaRe   = /~?(\d[\d,]*\.?\d*)\s*m[²2²]/i;
  const costRe   = /(?:kes|ksh|ksh\.)?\s*([\d,]+)\s*(?:\/\s*m[²2]|per\s*m[²2]|per\s*sqm)/i;
  const tivRe    = /(?:tiv|insured value|sum insured|all.risks[^\d]{0,40}|coverage[^\d]{0,40}|property insurance[^\d]{0,10})[:\s]*kes\s*([\d,]+)/i;

  // Sliding window: accumulate context across nearby lines
  // Collect all lat/lon hits first to detect single-facility documents
  const allLatLons = [];
  for (let i = 0; i < lines.length; i++) {
    const m = latLonRe.exec(lines[i]);
    if (m) allLatLons.push({ lat: parseFloat(m[1]), lon: parseFloat(m[2]), lineIdx: i });
  }

  // If all GPS hits are within 0.01° of each other it's one compound — skip row-by-row pass
  const isSingleFacility = allLatLons.length > 0 && allLatLons.every(
    (p) => Math.abs(p.lat - allLatLons[0].lat) < 0.01 && Math.abs(p.lon - allLatLons[0].lon) < 0.01
  );

  if (!isSingleFacility) {
    // Multi-location document: row-by-row sliding window
    let current = {};
    const flush = () => {
      if (current.lat && current.lon && (current.floor_area_m2 || current.tiv_kes)) {
        buildings.push({ ...current });
        current = {};
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ctx  = lines.slice(Math.max(0, i - 2), i + 3).join(" ");

      const ll = latLonRe.exec(line);
      if (ll) { flush(); current.lat = parseFloat(ll[1]); current.lon = parseFloat(ll[2]); }

      const ar = areaRe.exec(ctx);
      if (ar && current.lat) current.floor_area_m2 = parseFloat(ar[1].replace(/,/g, ""));

      const co = costRe.exec(ctx);
      if (co && current.lat) current.cost_per_m2_kes = parseFloat(co[1].replace(/,/g, ""));

      const tv = tivRe.exec(ctx) || tivRe.exec(lines.slice(Math.max(0, i - 5), i + 5).join(" "));
      if (tv && current.lat) current.tiv_kes = parseFloat(tv[1].replace(/,/g, ""));

      const cls = classifyConstruction(ctx);
      if (cls && current.lat) current.housing_class = cls;

      if (current.lat && !current.name) {
        const nameLine = lines.slice(Math.max(0, i - 4), i).reverse()
          .find((l) => l.length > 3 && l.length < 80 && /[A-Z]/.test(l));
        if (nameLine) current.name = nameLine;
      }
    }
    flush();
  }

  // Pass 1b — document-level extraction for single-facility offer documents
  // (when GPS, area, and TIV are spread across many pages, or all coords are same compound)
  if (!buildings.length || isSingleFacility) {
    buildings.length = 0; // clear any partial row-by-row results for single-facility docs
    const fullText = lines.join(" ");
    const llDoc  = latLonRe.exec(fullText);
    // Total floor area — look for "total floor area" or "total building footprint" label
    const totalAreaRe = /total\s+(?:floor\s+area|building\s+footprint)[^\d~]*~?([\d,]+)\s*m/i;
    const arDoc  = totalAreaRe.exec(fullText) || areaRe.exec(fullText);
    // TIV — look for sum insured / all-risks line
    const tvDoc  = tivRe.exec(fullText);
    // Construction — primary structure type (look near "main" building description first)
    const mainBldgIdx = fullText.search(/main\s+processing\s+building/i);
    const primaryCtx  = mainBldgIdx >= 0 ? fullText.slice(mainBldgIdx, mainBldgIdx + 400) : fullText;
    const clsDoc = classifyConstruction(primaryCtx) || classifyConstruction(fullText);
    // Name — first capitalised multi-word phrase after INSURED:
    const nameMatch = /INSURED:\s*([^\n]{3,60}?)(?:\s{2,}|$)/i.exec(fullText);

    if (llDoc) {
      const area = arDoc ? parseFloat(arDoc[1].replace(/,/g, "")) : null;
      const tiv  = tvDoc ? parseFloat(tvDoc[1].replace(/,/g, "")) : null;
      buildings.push({
        lat:             parseFloat(llDoc[1]),
        lon:             parseFloat(llDoc[2]),
        floor_area_m2:   area,
        cost_per_m2_kes: area && tiv ? Math.round(tiv / area) : null,
        tiv_kes:         tiv,
        housing_class:   clsDoc,
        name:            nameMatch ? nameMatch[1].trim() : null,
      });
      log.push("Used document-level extraction (single-facility offer document).");
    }
  }

  // Pass 2 — if no lat/lon found, try to extract tabular data by column proximity
  if (!buildings.length) {
    log.push("No GPS coordinates found. Attempting column-based extraction.");
    // Look for lines that are purely numeric / delimited
    const numericLines = lines.filter((l) => (l.match(/\d/g) || []).length > 6);
    numericLines.forEach((l) => {
      const nums = l.match(/-?\d+\.?\d*/g)?.map(Number) || [];
      // Heuristic: lat in [-5,5], lon in [33,36] for Kenya
      const lat = nums.find((n) => n >= -5 && n <= 5);
      const lon = nums.find((n) => n >= 33 && n <= 36);
      const area = nums.find((n) => n >= 50 && n <= 50000);
      if (lat && lon) {
        buildings.push({
          lat, lon,
          floor_area_m2:   area || null,
          cost_per_m2_kes: null,
          housing_class:   null,
          name:            null,
        });
      }
    });
  }

  log.push(`Extracted ${buildings.length} building(s) from PDF.`);
  return { buildings, log };
}

// ── Spreadsheet extraction (XLSX / CSV) ───────────────────────────────────────
function extractFromSheet(buffer, mimetype) {
  const log = [];
  const wb  = XLSX.read(buffer, { type: "buffer" });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  log.push(`Read ${rows.length} rows from sheet "${wb.SheetNames[0]}".`);

  if (!rows.length) return { buildings: [], log: [...log, "Sheet is empty."] };

  // Map column headers to our fields (case-insensitive fuzzy)
  const headers = Object.keys(rows[0]).map((h) => h.toLowerCase().trim());
  log.push(`Columns found: ${headers.join(", ")}`);

  const find = (row, ...candidates) => {
    for (const c of candidates) {
      const key = Object.keys(row).find((k) => k.toLowerCase().includes(c));
      if (key && row[key] !== "") return row[key];
    }
    return null;
  };

  const buildings = rows
    .map((row, i) => {
      const lat  = parseFloat(find(row, "lat", "latitude"));
      const lon  = parseFloat(find(row, "lon", "long", "longitude"));
      if (isNaN(lat) || isNaN(lon)) return null;

      const rawClass = find(row, "class", "construction", "type", "housing", "structure");
      const housing_class = classifyConstruction(String(rawClass || "")) || rawClass || null;

      const area = parseFloat(find(row, "area", "floor", "m2", "sqm", "size"));
      const cost = parseFloat(find(row, "cost", "rate", "per_m2", "rebuild", "kes"));
      const tiv  = parseFloat(find(row, "tiv", "insured", "value", "sum"));
      const name = find(row, "name", "building", "property", "description", "loc", "id");

      return {
        name:            String(name || `Building ${i + 1}`),
        lat,
        lon,
        housing_class,
        floor_area_m2:   isNaN(area) ? null : area,
        cost_per_m2_kes: isNaN(cost) ? (tiv && !isNaN(area) ? Math.round(tiv / area) : null) : cost,
        tiv_kes:         isNaN(tiv)  ? null : tiv,
      };
    })
    .filter(Boolean);

  log.push(`Extracted ${buildings.length} building(s) from spreadsheet.`);
  return { buildings, log };
}

app.post("/api/extract", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const { originalname, mimetype, buffer } = req.file;
  const log = [`Received file: ${originalname} (${(buffer.length / 1024).toFixed(1)} KB)`];

  try {
    let result;
    if (mimetype === "application/pdf" || originalname.endsWith(".pdf")) {
      log.push("Detected PDF — extracting text...");
      const parsed = await pdfParse(buffer);
      log.push(`PDF has ${parsed.numpages} page(s), ${parsed.text.length} characters.`);
      result = extractFromPDF(parsed.text);
      result.log = [...log, ...result.log];
      result.rawText = parsed.text.slice(0, 3000); // preview
    } else if (
      mimetype.includes("spreadsheet") || mimetype.includes("excel") ||
      originalname.match(/\.(xlsx|xls|csv)$/i)
    ) {
      log.push("Detected spreadsheet — reading columns...");
      result = extractFromSheet(buffer, mimetype);
      result.log = [...log, ...result.log];
    } else {
      return res.status(400).json({ error: "Unsupported file type. Upload a PDF, Excel, or CSV file." });
    }

    // Post-process: fill missing cost_per_m2 from TIV/area, assign defaults
    result.buildings = result.buildings.map((b, i) => ({
      name:            b.name || `Building ${i + 1}`,
      lat:             b.lat,
      lon:             b.lon,
      housing_class:   b.housing_class || "permanent_masonry",
      floor_area_m2:   b.floor_area_m2 || null,
      cost_per_m2_kes: b.cost_per_m2_kes || (b.tiv_kes && b.floor_area_m2 ? Math.round(b.tiv_kes / b.floor_area_m2) : null),
      tiv_kes:         b.tiv_kes || null,
      _needs_review:   !b.housing_class || !b.floor_area_m2 || !b.cost_per_m2_kes,
    }));

    result.log.push(`Done. ${result.buildings.filter((b) => !b._needs_review).length} building(s) ready, ${result.buildings.filter((b) => b._needs_review).length} need review.`);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Extraction failed: " + err.message, log });
  }
});

// ── start ─────────────────────────────────────────────────────────────────────

loadData().then(() => {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
});
