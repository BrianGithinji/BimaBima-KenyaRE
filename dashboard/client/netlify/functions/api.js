const express        = require("express");
const cors           = require("cors");
const fs             = require("fs");
const path           = require("path");
const csv            = require("csv-parser");
const multer         = require("multer");
const XLSX           = require("xlsx");
const serverless     = require("serverless-http");

async function pdfParse(buffer) {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page    = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(" ") + "\n";
  }
  return { text, numpages: doc.numPages };
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const app = express();
app.use(cors());
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

let portfolio  = [];
let lossTable  = [];
let dataLoaded = false;

async function ensureData() {
  if (dataLoaded) return;
  portfolio  = await loadCSV("nzoia_underwriter_portfolio.csv");
  lossTable  = await loadCSV("nzoia_underwriter_loss_table.csv");
  dataLoaded = true;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function num(v)  { return parseFloat(v) || 0; }
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

// ── middleware to load data before every request ──────────────────────────────

app.use(async (req, res, next) => {
  try { await ensureData(); next(); }
  catch (e) { res.status(500).json({ error: "Data load failed: " + e.message }); }
});

// ── GET /api/portfolio ────────────────────────────────────────────────────────

app.get("/api/portfolio", (req, res) => {
  const data = portfolio.map((b) => {
    const rp100Loss = lossTable.find(
      (r) => r.loc_id === b.loc_id && parseInt(r.return_period) === 100
    );
    const dr   = rp100Loss ? num(rp100Loss.damage_ratio) : 0;
    const tier = tierFromDR(dr);
    return {
      loc_id:             b.loc_id,
      lat:                num(b.lat),
      lon:                num(b.lon),
      housing_class:      b.housing_class,
      floor_area_m2:      num(b.floor_area_m2),
      tiv_kes:            num(b.tiv_kes),
      flood_probability:  num(b.flood_probability_rp100),
      ml3_anomaly_score:  b.ml3_anomaly_score !== "" ? num(b.ml3_anomaly_score) : null,
      ml3_flag:           bool(b.ml3_flag),
      damage_ratio_rp100: dr,
      risk_tier:          tier,
      tier_color:         tierColor(tier),
    };
  });
  res.json(data);
});

// ── GET /api/portfolio/stats ──────────────────────────────────────────────────

app.get("/api/portfolio/stats", (req, res) => {
  const totalTIV   = portfolio.reduce((s, b) => s + num(b.tiv_kes), 0);
  const totalBldgs = portfolio.length;
  const anomalies  = portfolio.filter((b) => bool(b.ml3_flag)).length;

  const tierCounts = { Low: 0, Medium: 0, High: 0, Decline: 0 };
  const tierTIV    = { Low: 0, Medium: 0, High: 0, Decline: 0 };

  portfolio.forEach((b) => {
    const rp100 = lossTable.find(
      (r) => r.loc_id === b.loc_id && parseInt(r.return_period) === 100
    );
    const dr   = rp100 ? num(rp100.damage_ratio) : 0;
    const tier = tierFromDR(dr);
    tierCounts[tier]++;
    tierTIV[tier] += num(b.tiv_kes);
  });

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

  const sorted  = [...epCurve].sort((a, b) => a.aep - b.aep);
  const aepPts  = [0, ...sorted.map((r) => r.aep)];
  const lossPts = [0, ...sorted.map((r) => r.net_loss)];
  let aal = 0;
  for (let i = 1; i < aepPts.length; i++)
    aal += 0.5 * (lossPts[i] + lossPts[i - 1]) * (aepPts[i] - aepPts[i - 1]);

  const pureRate  = aal / totalTIV;
  const grossRate = pureRate * 1.35;

  res.json({
    totalBldgs, totalTIV, anomalies,
    aal, pureRate, grossRate,
    grossPremium: totalTIV * grossRate,
    tierCounts, tierTIV, epCurve,
  });
});

// ── GET /api/building/:id ─────────────────────────────────────────────────────

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

  const sorted  = [...losses].sort((a, b) => a.aep - b.aep);
  const aepPts  = [0, ...sorted.map((r) => r.aep)];
  const lossPts = [0, ...sorted.map((r) => r.net_loss_kes)];
  let bldgAAL = 0;
  for (let i = 1; i < aepPts.length; i++)
    bldgAAL += 0.5 * (lossPts[i] + lossPts[i - 1]) * (aepPts[i] - aepPts[i - 1]);

  const tiv       = num(b.tiv_kes);
  const pureRate  = tiv > 0 ? bldgAAL / tiv : 0;
  const grossRate = pureRate * 1.35;

  res.json({
    loc_id:             b.loc_id,
    lat:                num(b.lat),
    lon:                num(b.lon),
    housing_class:      b.housing_class,
    floor_area_m2:      num(b.floor_area_m2),
    cost_per_m2_kes:    num(b.cost_per_m2_kes),
    tiv_kes:            tiv,
    flood_probability:  num(b.flood_probability_rp100),
    ml3_anomaly_score:  b.ml3_anomaly_score !== "" ? num(b.ml3_anomaly_score) : null,
    ml3_flag:           bool(b.ml3_flag),
    damage_ratio_rp100: dr,
    risk_tier:          tier,
    tier_color:         tierColor(tier),
    recommendation:     recommendation(tier),
    aal:                bldgAAL,
    pure_rate:          pureRate,
    gross_rate:         grossRate,
    suggested_premium:  tiv * grossRate,
    losses,
  });
});

// ── GET /api/search ───────────────────────────────────────────────────────────

app.get("/api/search", (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  if (!q) return res.json([]);
  const results = portfolio
    .filter((b) =>
      b.loc_id.toLowerCase().includes(q) ||
      b.housing_class.toLowerCase().includes(q)
    )
    .slice(0, 20)
    .map((b) => ({ loc_id: b.loc_id, housing_class: b.housing_class, tiv_kes: num(b.tiv_kes) }));
  res.json(results);
});

// ── POST /api/assess ──────────────────────────────────────────────────────────

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

function estimateDepths(lat, lon) {
  const RPS    = [10, 20, 50, 100, 200, 500];
  const CUTOFF = 1.5;
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
    result[rp] = parseFloat((nearest.depth * Math.max(0, 1 - nearest.d / CUTOFF)).toFixed(3));
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
    return {
      return_period: parseInt(rp), aep: 1 / parseInt(rp),
      depth_m: depth, damage_ratio: dr,
      gross_loss_kes: gross, deductible_kes: deductible, net_loss_kes: gross - deductible,
    };
  }).sort((a, b) => a.return_period - b.return_period);

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
    tiv_kes: tiv, housing_class,
    floor_area_m2: parseFloat(floor_area_m2),
    cost_per_m2_kes: parseFloat(cost_per_m2_kes),
    lat: parseFloat(lat), lon: parseFloat(lon),
    risk_tier: tier, tier_color: tierColor(tier),
    recommendation: recommendation(tier),
    damage_ratio_rp100: rp100.damage_ratio || 0,
    aal, pure_rate: pureRate, gross_rate: grossRate,
    suggested_premium: tiv * grossRate, losses,
  });
});

// ── POST /api/extract ─────────────────────────────────────────────────────────

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

function extractFromPDF(text) {
  const log = ["Parsed PDF text."];
  const buildings = [];
  const lines  = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const latLonRe = /(-?\d{1,2}\.\d{3,6})\s*(?:°?[NS])?[,\s]+(-?\d{2,3}\.\d{3,6})\s*(?:°?[EW])?/i;
  const areaRe   = /~?(\d[\d,]*\.?\d*)\s*m[²2²]/i;
  const costRe   = /(?:kes|ksh|ksh\.)?\s*([\d,]+)\s*(?:\/\s*m[²2]|per\s*m[²2]|per\s*sqm)/i;
  const tivRe    = /(?:tiv|insured value|sum insured|all.risks[^\d]{0,40}|coverage[^\d]{0,40}|property insurance[^\d]{0,10})[:\s]*kes\s*([\d,]+)/i;

  const allLatLons = [];
  for (let i = 0; i < lines.length; i++) {
    const m = latLonRe.exec(lines[i]);
    if (m) allLatLons.push({ lat: parseFloat(m[1]), lon: parseFloat(m[2]), lineIdx: i });
  }

  const isSingleFacility = allLatLons.length > 0 && allLatLons.every(
    (p) => Math.abs(p.lat - allLatLons[0].lat) < 0.01 && Math.abs(p.lon - allLatLons[0].lon) < 0.01
  );

  if (!isSingleFacility) {
    let current = {};
    const flush = () => {
      if (current.lat && current.lon && (current.floor_area_m2 || current.tiv_kes)) {
        buildings.push({ ...current }); current = {};
      }
    };
    for (let i = 0; i < lines.length; i++) {
      const ctx = lines.slice(Math.max(0, i - 2), i + 3).join(" ");
      const ll  = latLonRe.exec(lines[i]);
      if (ll) { flush(); current.lat = parseFloat(ll[1]); current.lon = parseFloat(ll[2]); }
      const ar = areaRe.exec(ctx); if (ar && current.lat) current.floor_area_m2   = parseFloat(ar[1].replace(/,/g, ""));
      const co = costRe.exec(ctx); if (co && current.lat) current.cost_per_m2_kes = parseFloat(co[1].replace(/,/g, ""));
      const tv = tivRe.exec(ctx);  if (tv && current.lat) current.tiv_kes         = parseFloat(tv[1].replace(/,/g, ""));
      const cls = classifyConstruction(ctx); if (cls && current.lat) current.housing_class = cls;
    }
    flush();
  }

  if (!buildings.length || isSingleFacility) {
    buildings.length = 0;
    const fullText    = lines.join(" ");
    const llDoc       = latLonRe.exec(fullText);
    const totalAreaRe = /total\s+(?:floor\s+area|building\s+footprint)[^\d~]*~?([\d,]+)\s*m/i;
    const arDoc       = totalAreaRe.exec(fullText) || areaRe.exec(fullText);
    const tvDoc       = tivRe.exec(fullText);
    const mainIdx     = fullText.search(/main\s+processing\s+building/i);
    const primaryCtx  = mainIdx >= 0 ? fullText.slice(mainIdx, mainIdx + 400) : fullText;
    const clsDoc      = classifyConstruction(primaryCtx) || classifyConstruction(fullText);
    const nameMatch   = /INSURED:\s*([^\n]{3,60}?)(?:\s{2,}|$)/i.exec(fullText);
    if (llDoc) {
      const area = arDoc ? parseFloat(arDoc[1].replace(/,/g, "")) : null;
      const tiv  = tvDoc ? parseFloat(tvDoc[1].replace(/,/g, "")) : null;
      buildings.push({
        lat: parseFloat(llDoc[1]), lon: parseFloat(llDoc[2]),
        floor_area_m2: area, cost_per_m2_kes: area && tiv ? Math.round(tiv / area) : null,
        tiv_kes: tiv, housing_class: clsDoc,
        name: nameMatch ? nameMatch[1].trim() : null,
      });
    }
  }

  log.push(`Extracted ${buildings.length} building(s) from PDF.`);
  return { buildings, log };
}

function extractFromSheet(buffer) {
  const log  = [];
  const wb   = XLSX.read(buffer, { type: "buffer" });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
  log.push(`Read ${rows.length} rows.`);
  if (!rows.length) return { buildings: [], log: [...log, "Sheet is empty."] };

  const find = (row, ...candidates) => {
    for (const c of candidates) {
      const key = Object.keys(row).find((k) => k.toLowerCase().includes(c));
      if (key && row[key] !== "") return row[key];
    }
    return null;
  };

  const buildings = rows.map((row, i) => {
    const lat = parseFloat(find(row, "lat", "latitude"));
    const lon = parseFloat(find(row, "lon", "long", "longitude"));
    if (isNaN(lat) || isNaN(lon)) return null;
    const rawClass      = find(row, "class", "construction", "type", "housing", "structure");
    const housing_class = classifyConstruction(String(rawClass || "")) || rawClass || null;
    const area = parseFloat(find(row, "area", "floor", "m2", "sqm", "size"));
    const cost = parseFloat(find(row, "cost", "rate", "per_m2", "rebuild", "kes"));
    const tiv  = parseFloat(find(row, "tiv", "insured", "value", "sum"));
    const name = find(row, "name", "building", "property", "description", "loc", "id");
    return {
      name: String(name || `Building ${i + 1}`), lat, lon, housing_class,
      floor_area_m2:   isNaN(area) ? null : area,
      cost_per_m2_kes: isNaN(cost) ? (tiv && !isNaN(area) ? Math.round(tiv / area) : null) : cost,
      tiv_kes:         isNaN(tiv)  ? null : tiv,
    };
  }).filter(Boolean);

  log.push(`Extracted ${buildings.length} building(s).`);
  return { buildings, log };
}

app.post("/api/extract", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const { originalname, mimetype, buffer } = req.file;
  const log = [`Received: ${originalname}`];
  try {
    let result;
    if (mimetype === "application/pdf" || originalname.endsWith(".pdf")) {
      const parsed = await pdfParse(buffer);
      result = extractFromPDF(parsed.text);
      result.log = [...log, ...result.log];
      result.rawText = parsed.text.slice(0, 3000);
    } else if (mimetype.includes("spreadsheet") || mimetype.includes("excel") || originalname.match(/\.(xlsx|xls|csv)$/i)) {
      result = extractFromSheet(buffer);
      result.log = [...log, ...result.log];
    } else {
      return res.status(400).json({ error: "Unsupported file type." });
    }
    result.buildings = result.buildings.map((b, i) => ({
      name:            b.name || `Building ${i + 1}`,
      lat:             b.lat, lon: b.lon,
      housing_class:   b.housing_class || "permanent_masonry",
      floor_area_m2:   b.floor_area_m2 || null,
      cost_per_m2_kes: b.cost_per_m2_kes || (b.tiv_kes && b.floor_area_m2 ? Math.round(b.tiv_kes / b.floor_area_m2) : null),
      tiv_kes:         b.tiv_kes || null,
      _needs_review:   !b.housing_class || !b.floor_area_m2 || !b.cost_per_m2_kes,
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Extraction failed: " + err.message, log });
  }
});

module.exports.handler = serverless(app);
