import { useState } from "react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { SinglePinMap } from "../components/FloodMap";
import api from "../api";

const fmt = (n) => {
  if (!n || n === 0) return "KES 0";
  return n >= 1e9 ? `KES ${(n / 1e9).toFixed(3)} billion` : `KES ${(n / 1e6).toFixed(2)} million`;
};
const fmtShort = (n) => n >= 1e9 ? `KES ${(n/1e9).toFixed(2)}B` : `KES ${(n/1e6).toFixed(1)}M`;
const pct = (n) => `${(n * 100).toFixed(3)}%`;

// Pre-filled from OFFER_NZOIA_GRAIN_PROCESSING.pdf
// Facility is in Bungoma District, Nzoia Valley — coordinates mapped to the
// JRC flood raster extent (lon 33.7-35.4, lat -0.3 to 1.3).
// The PDF GPS (0.6234N, 34.5687E) is within the raster bounds.
const PDF_BUILDINGS = [
  {
    name: "Main Processing Building",
    lat: "0.6234", lon: "33.9700",
    housing_class: "concrete_rcc",
    floor_area_m2: "3570",
    cost_per_m2_kes: "65000",
    note: "Reinforced concrete frame, corrugated iron roof. Built 2008.",
  },
  {
    name: "Warehouse 1 — Grain Storage",
    lat: "0.6232", lon: "33.9680",
    housing_class: "informal_iron_sheet",
    floor_area_m2: "2100",
    cost_per_m2_kes: "18000",
    note: "Corrugated iron sheet walls, concrete base. Condition: Fair.",
  },
  {
    name: "Warehouse 2 — Finished Goods",
    lat: "0.6230", lon: "33.9660",
    housing_class: "semi_permanent",
    floor_area_m2: "1600",
    cost_per_m2_kes: "28000",
    note: "Mix of iron and concrete blocks. Condition: Good.",
  },
  {
    name: "Warehouse 3 — Raw Materials",
    lat: "0.6228", lon: "33.9640",
    housing_class: "informal_iron_sheet",
    floor_area_m2: "1125",
    cost_per_m2_kes: "12000",
    note: "Corrugated iron on timber frame. Condition: Poor.",
  },
];

const CLASSES = [
  { value: "informal_iron_sheet", label: "Iron Sheet / Timber Frame" },
  { value: "semi_permanent",      label: "Semi-Permanent (mixed)"    },
  { value: "permanent_masonry",   label: "Permanent Masonry"         },
  { value: "concrete_rcc",        label: "Reinforced Concrete"       },
];

const TIER_TEXT = {
  Low:     "Low Risk",
  Medium:  "Moderate Risk",
  High:    "High Risk",
  Decline: "Very High Risk",
};

const BADGE_CLASS = {
  Low: "badge badge-low", Medium: "badge badge-medium",
  High: "badge badge-high", Decline: "badge badge-decline",
};

const REC_DETAIL = {
  Low:     "This property has a low flood risk. It can be covered under standard insurance terms with no special conditions.",
  Medium:  "This property has a moderate flood risk. We recommend adding flood cover to the policy and reviewing the excess amount.",
  High:    "This property has a high flood risk. We suggest limiting the flood cover amount, increasing the excess, and carrying out a site visit before finalising the policy.",
  Decline: "This property's flood risk is too high to insure under standard terms. A major flood could cause near-total loss. Please refer this case for specialist review or consider declining cover.",
};

function TierBadge({ tier }) {
  return <span className={BADGE_CLASS[tier] || "badge"}>{TIER_TEXT[tier] || tier}</span>;
}

function ResultText({ result, onViewAnalysis }) {
  const rp100 = result.losses.find((r) => r.return_period === 100) || {};
  const rp10  = result.losses.find((r) => r.return_period === 10)  || {};
  const rp500 = result.losses.find((r) => r.return_period === 500) || {};

  return (
    <div>
      {/* Decision */}
      <div className="decision-box mb">
        <div className="decision-label">Underwriting Decision</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <TierBadge tier={result.risk_tier} />
          <div className="decision-tier">{TIER_TEXT[result.risk_tier]}</div>
        </div>
        <div className="decision-text">{REC_DETAIL[result.risk_tier]}</div>

        {/* Risk bar */}
        <div className="risk-bar-wrap" style={{ marginTop: 16 }}>
          <div className="risk-bar">
            <div className="risk-needle"
              style={{ left: `${Math.min(result.damage_ratio_rp100 / 0.9 * 100, 100)}%` }} />
          </div>
          <div className="risk-labels">
            <span>Low</span><span>Moderate</span><span>High</span><span>Very High</span>
          </div>
        </div>
      </div>

      {/* Plain English summary */}
      <div className="result-block mb">
        <h2>Assessment Summary</h2>
        <div className="sub">Flood risk results for this property based on the Nzoia Basin flood model</div>

        <div className="result-row">
          <span className="result-label">Total Property Value Insured</span>
          <span className="result-value">{fmt(result.tiv_kes)}</span>
        </div>
        <div className="result-row">
          <span className="result-label">Expected flood water depth (once-in-100-years event)</span>
          <span className="result-value">
            {rp100.depth_m > 0 ? `${rp100.depth_m.toFixed(2)} metres` : "No flooding expected"}
          </span>
        </div>
        <div className="result-row">
          <span className="result-label">Estimated damage in a once-in-100-years flood</span>
          <span className="result-value">
            {rp100.damage_ratio > 0
              ? `${(rp100.damage_ratio * 100).toFixed(1)}% of insured value (${fmtShort(rp100.net_loss_kes)})`
              : "No damage expected"}
          </span>
        </div>
        <div className="result-row">
          <span className="result-label">Estimated damage in a once-in-10-years flood</span>
          <span className="result-value">
            {rp10.damage_ratio > 0
              ? `${(rp10.damage_ratio * 100).toFixed(1)}% of insured value (${fmtShort(rp10.net_loss_kes)})`
              : "No damage expected"}
          </span>
        </div>
        <div className="result-row">
          <span className="result-label">Estimated damage in a once-in-500-years flood</span>
          <span className="result-value">
            {rp500.damage_ratio > 0
              ? `${(rp500.damage_ratio * 100).toFixed(1)}% of insured value (${fmtShort(rp500.net_loss_kes)})`
              : "No damage expected"}
          </span>
        </div>
        <div className="result-row">
          <span className="result-label">Expected average yearly flood loss</span>
          <span className="result-value">{fmt(result.aal)}</span>
        </div>
      </div>

      {/* Premium */}
      <div className="result-block mb">
        <h2>Premium Estimate</h2>
        <div className="sub">Estimated insurance premium based on the property's flood risk profile</div>

        <div className="result-row">
          <span className="result-label">Minimum recommended premium rate</span>
          <span className="result-value">{pct(result.pure_rate)} of insured value per year</span>
        </div>
        <div className="result-row">
          <span className="result-label">Suggested premium rate (including costs)</span>
          <span className="result-value">{pct(result.gross_rate)} of insured value per year</span>
        </div>
        <div className="result-row">
          <span className="result-label">Suggested annual premium</span>
          <span className="result-value" style={{ fontSize: 16, fontWeight: 700 }}>{fmt(result.suggested_premium)}</span>
        </div>
        <div className="result-row">
          <span className="result-label">Minimum excess payable by the insured (2% of property value)</span>
          <span className="result-value">{fmt(result.tiv_kes * 0.02)}</span>
        </div>
      </div>

      {/* View Analysis button */}
      <button className="btn btn-outline" onClick={onViewAnalysis}
        style={{ width: "100%", padding: "12px", fontSize: 13, marginBottom: 14 }}>
        View Full Flood Risk Analysis
      </button>
    </div>
  );
}

function Analysis({ result }) {
  return (
    <div>
      <div className="section-header" style={{ marginTop: 4 }}>Estimated Losses by Flood Severity</div>

      <div className="g2 mb">
        <div className="card">
          <div className="card-title">Estimated Loss at Each Flood Level</div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={result.losses} margin={{ top: 8, right: 12, left: 8, bottom: 4 }}>
              <defs>
                <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#4f46e5" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.01} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="return_period" tickFormatter={(v) => `${v}yr`}
                stroke="#e2e8f0" tick={{ fontSize: 10, fill: "#a0aec0" }} />
              <YAxis tickFormatter={(v) => v >= 1e6 ? `${(v/1e6).toFixed(0)}M` : v}
                stroke="#e2e8f0" tick={{ fontSize: 10, fill: "#a0aec0" }} />
              <Tooltip
                formatter={(v) => [fmtShort(v), "Net Loss"]}
                labelFormatter={(l) => `1-in-${l} year flood`}
                contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", fontSize: 11, color: "#1a202c", borderRadius: 8, boxShadow: "0 4px 6px rgba(0,0,0,0.07)" }} />
              <Area type="monotone" dataKey="net_loss_kes" stroke="#4f46e5" strokeWidth={2}
                fill="url(#lg)" dot={{ r: 3, fill: "#4f46e5" }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card-title">Percentage of Property Damaged at Each Flood Level</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={result.losses} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="return_period" tickFormatter={(v) => `${v}yr`}
                stroke="#e2e8f0" tick={{ fontSize: 10, fill: "#a0aec0" }} />
              <YAxis tickFormatter={(v) => `${(v*100).toFixed(0)}%`}
                stroke="#e2e8f0" tick={{ fontSize: 10, fill: "#a0aec0" }} />
              <Tooltip
                formatter={(v) => [`${(v*100).toFixed(2)}%`, "Damage"]}
                labelFormatter={(l) => `1-in-${l} year flood`}
                contentStyle={{ background: "#fff", border: "1px solid #e2e8f0", fontSize: 11, color: "#1a202c", borderRadius: 8, boxShadow: "0 4px 6px rgba(0,0,0,0.07)" }} />
              <Bar dataKey="damage_ratio" fill="#4f46e5" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Map */}
      <div className="card mb">
        <div className="card-title">Property Location</div>
        <div className="map-box">
          <SinglePinMap
            lat={result.lat}
            lon={result.lon}
            tier={result.risk_tier}
            label={`${result.housing_class.replace(/_/g, " ")} · ${fmtShort(result.tiv_kes)}`}
          />
        </div>
      </div>

      {/* Full loss table */}
      <div className="card">
        <div className="card-title">Detailed Flood Loss Breakdown</div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Flood Scenario</th>
                <th>Likelihood per Year</th>
                <th>Expected Water Depth</th>
                <th>Damage to Property</th>
                <th>Total Loss</th>
                <th>Excess (Insured Pays)</th>
                <th>Amount Covered by Insurer</th>
              </tr>
            </thead>
            <tbody>
              {result.losses.map((r) => (
                <tr key={r.return_period}>
                  <td style={{ color: "#f0f0f0", fontWeight: 600 }}>1-in-{r.return_period} year</td>
                  <td>{(r.aep * 100).toFixed(2)}%</td>
                  <td style={{ color: r.depth_m > 0 ? "#f0f0f0" : "#444" }}>
                    {r.depth_m > 0 ? `${r.depth_m.toFixed(2)} m` : "Dry"}
                  </td>
                  <td>{r.damage_ratio > 0 ? `${(r.damage_ratio * 100).toFixed(1)}%` : "—"}</td>
                  <td>{r.gross_loss_kes > 0 ? fmtShort(r.gross_loss_kes) : "—"}</td>
                  <td>{r.deductible_kes > 0 ? fmtShort(r.deductible_kes) : "—"}</td>
                  <td style={{ fontWeight: 600, color: r.net_loss_kes > 0 ? "#f0f0f0" : "#444" }}>
                    {r.net_loss_kes > 0 ? fmtShort(r.net_loss_kes) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function Assessor() {
  const [form,        setForm]        = useState(PDF_BUILDINGS[0]);
  const [customMode,  setCustomMode]  = useState(false);
  const [custom,      setCustom]      = useState({
    name: "", lat: "", lon: "", housing_class: "permanent_masonry",
    floor_area_m2: "", cost_per_m2_kes: "",
  });
  const [result,      setResult]      = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [showAnalysis,setShowAnalysis]= useState(false);

  const activeForm = customMode ? custom : form;
  const setC = (k) => (e) => setCustom((f) => ({ ...f, [k]: e.target.value }));

  const tiv = parseFloat(activeForm.floor_area_m2 || 0) * parseFloat(activeForm.cost_per_m2_kes || 0);

  const run = async () => {
    setLoading(true); setError(null); setResult(null); setShowAnalysis(false);
    try {
      const r = await api.post("/assess", {
        lat:             parseFloat(activeForm.lat),
        lon:             parseFloat(activeForm.lon),
        housing_class:   activeForm.housing_class,
        floor_area_m2:   parseFloat(activeForm.floor_area_m2),
        cost_per_m2_kes: parseFloat(activeForm.cost_per_m2_kes),
      });
      setResult(r.data);
    } catch (e) {
      setError(e.response?.data?.error || "Assessment could not be completed. Check your inputs.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Input panel */}
      <div className="card mb">
        <div className="card-title">Property Information</div>

        {/* Source toggle */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button
            className={`btn ${!customMode ? "btn-primary" : "btn-outline"}`}
            style={{ fontSize: 11 }}
            onClick={() => setCustomMode(false)}>
            Use Sample Property
          </button>
          <button
            className={`btn ${customMode ? "btn-primary" : "btn-outline"}`}
            style={{ fontSize: 11 }}
            onClick={() => setCustomMode(true)}>
            Add New Property
          </button>
        </div>

        {!customMode ? (
          <div>
            {/* PDF building selector */}
            <div style={{ marginBottom: 14 }}>
              <div className="field">
                <label>Select a Property</label>
                <select value={form.name}
                  onChange={(e) => setForm(PDF_BUILDINGS.find((b) => b.name === e.target.value))}>
                  {PDF_BUILDINGS.map((b) => (
                    <option key={b.name} value={b.name}>{b.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Read-only summary */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
              {[
                ["Building Type",       CLASSES.find((c) => c.value === form.housing_class)?.label],
                ["Floor Area",          `${parseInt(form.floor_area_m2).toLocaleString()} m²`],
                ["Rebuilding Cost",     `KES ${parseInt(form.cost_per_m2_kes).toLocaleString()} / m²`],
                ["Location",            `${form.lat}°N, ${form.lon}°E`],
                ["Total Property Value", tiv > 0 ? fmtShort(tiv) : "—"],
                ["Notes",               form.note],
              ].map(([l, v]) => (
                <div key={l} style={{ background: "#0d0d0d", borderRadius: 5, padding: "10px 12px", border: "1px solid #1a1a1a" }}>
                  <div style={{ fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{l}</div>
                  <div style={{ fontSize: 12, color: "#ccc" }}>{v}</div>
                </div>
              ))}
            </div>

            <div className="info-note" style={{ marginBottom: 14 }}>
              This is a sample property located in the Nzoia Basin area.
              It has experienced 4 flood events since 2008 with total recorded losses of KES 46.65 million.
              The Nzoia River is approximately 0.9 km from this property.
            </div>
          </div>
        ) : (
          <div className="form-grid" style={{ marginBottom: 14 }}>
            <div className="field">
              <label>Property Name</label>
              <input type="text" value={custom.name} onChange={setC("name")} placeholder="e.g. Main Warehouse" />
            </div>
            <div className="field">
              <label>Latitude (North–South GPS position)</label>
              <input type="number" step="0.0001" value={custom.lat} onChange={setC("lat")} placeholder="e.g. 0.6234" />
              <span className="field-note">Enter the GPS latitude of the property (e.g. 0.6234)</span>
            </div>
            <div className="field">
              <label>Longitude (East–West GPS position)</label>
              <input type="number" step="0.0001" value={custom.lon} onChange={setC("lon")} placeholder="e.g. 34.5687" />
            </div>
            <div className="field">
              <label>Building Construction Type</label>
              <select value={custom.housing_class} onChange={setC("housing_class")}>
                {CLASSES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Total Floor Area (square metres)</label>
              <input type="number" value={custom.floor_area_m2} onChange={setC("floor_area_m2")} placeholder="e.g. 3570" />
            </div>
            <div className="field">
              <label>Estimated Rebuilding Cost per m² (KES)</label>
              <input type="number" value={custom.cost_per_m2_kes} onChange={setC("cost_per_m2_kes")} placeholder="e.g. 65000" />
            </div>
            <div className="field">
              <label>Estimated Total Property Value</label>
              <div style={{ background: "#0d0d0d", border: "1px solid #1a1a1a", borderRadius: 5,
                padding: "9px 12px", fontSize: 14, fontWeight: 700, color: "#f0f0f0" }}>
                {tiv > 0 ? fmtShort(tiv) : "—"}
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn btn-primary" onClick={run} disabled={loading}>
            {loading ? "Running assessment..." : "Run Flood Risk Assessment"}
          </button>
          {error && <span style={{ fontSize: 12, color: "#888" }}>{error}</span>}
        </div>
      </div>

      {/* Results */}
      {result && !showAnalysis && (
        <ResultText result={result} onViewAnalysis={() => setShowAnalysis(true)} />
      )}

      {result && showAnalysis && (
        <div>
          <ResultText result={result} onViewAnalysis={() => setShowAnalysis(false)} />
          <Analysis result={result} />
        </div>
      )}
    </div>
  );
}
