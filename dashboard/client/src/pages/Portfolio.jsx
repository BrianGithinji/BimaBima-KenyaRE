import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { PortfolioDotMap } from "../components/FloodMap";
import api from "../api";

const fmt     = (n) => n >= 1e9 ? `KES ${(n/1e9).toFixed(2)}B` : `KES ${(n/1e6).toFixed(2)}M`;
const fmtS    = (n) => n >= 1e9 ? `${(n/1e9).toFixed(2)}B` : `${(n/1e6).toFixed(1)}M`;
const TOOLTIP = { background: "#fff", border: "1px solid #e2e8f0", fontSize: 11, color: "#1a202c", borderRadius: 8, boxShadow: "0 4px 6px rgba(0,0,0,0.07)" };

const TIER_LABEL = { Low: "Low Risk", Medium: "Moderate Risk", High: "High Risk", Decline: "Very High Risk" };
const BADGE_CLS  = { Low: "badge badge-low", Medium: "badge badge-medium", High: "badge badge-high", Decline: "badge badge-decline" };
const TIER_COLOR = { Low: "#059669", Medium: "#d97706", High: "#ea580c", Decline: "#dc2626" };
const REC = {
  Low:     "Accept at standard terms.",
  Medium:  "Accept with flood endorsement.",
  High:    "Accept — apply sub-limit and higher deductible.",
  Decline: "Decline or refer to facultative reinsurance.",
};

// ── Legend pill ───────────────────────────────────────────────────────────────
function Legend() {
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
      {Object.entries(TIER_LABEL).map(([tier, label]) => (
        <div key={tier} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#4a5568" }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: TIER_COLOR[tier], border: "1.5px solid #fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
          {label}
        </div>
      ))}
    </div>
  );
}

// ── Building detail drawer ────────────────────────────────────────────────────
function Drawer({ id, onClose }) {
  const [data, setData] = useState(null);
  useEffect(() => { api.get(`/building/${id}`).then((r) => setData(r.data)); }, [id]);

  if (!data) return (
    <div style={{ position: "fixed", top: 0, right: 0, width: 400, height: "100vh",
      background: "#fff", borderLeft: "1px solid #e2e8f0", zIndex: 200,
      display: "flex", alignItems: "center", justifyContent: "center", color: "#a0aec0" }}>
      Loading...
    </div>
  );

  return (
    <div style={{ position: "fixed", top: 0, right: 0, width: 420, height: "100vh",
      background: "#fff", borderLeft: "1px solid #e2e8f0", zIndex: 200,
      overflowY: "auto", padding: 24, boxShadow: "-4px 0 20px rgba(0,0,0,0.08)" }}>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1a202c" }}>{data.loc_id}</div>
          <div style={{ fontSize: 11, color: "#a0aec0", marginTop: 3 }}>
            {data.housing_class.replace(/_/g, " ")} &nbsp;·&nbsp; {data.lat.toFixed(4)}°N, {data.lon.toFixed(4)}°E
          </div>
        </div>
        <button onClick={onClose} style={{ background: "#f0f4f8", border: "1px solid #e2e8f0",
          color: "#4a5568", borderRadius: 6, padding: "5px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
          Close
        </button>
      </div>

      {/* Decision */}
      <div style={{ background: "#f8faff", border: "1px solid #e2e8f0", borderRadius: 10,
        padding: "14px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 9, color: "#a0aec0", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6, fontWeight: 700 }}>
          Underwriting Decision
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span className={BADGE_CLS[data.risk_tier]}>{TIER_LABEL[data.risk_tier]}</span>
        </div>
        <div style={{ fontSize: 12, color: "#4a5568" }}>{REC[data.risk_tier]}</div>
      </div>

      {/* Key figures */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
        {[
          ["Insured Value",      fmt(data.tiv_kes)],
          ["Floor Area",         `${data.floor_area_m2} m²`],
          ["Flood Probability",  `${(data.flood_probability*100).toFixed(1)}%`],
          ["Damage at RP100",    `${(data.damage_ratio_rp100*100).toFixed(1)}%`],
          ["Average Annual Loss",fmt(data.aal)],
          ["Suggested Premium",  fmt(data.suggested_premium)],
        ].map(([l, v]) => (
          <div key={l} style={{ background: "#f8fafc", borderRadius: 8, padding: "10px 12px", border: "1px solid #e2e8f0" }}>
            <div style={{ fontSize: 9, color: "#a0aec0", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>{l}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1a202c", marginTop: 3 }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Loss chart */}
      <div style={{ fontSize: 9, color: "#a0aec0", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 8, fontWeight: 700 }}>
        Net Loss by Flood Scenario
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={data.losses} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="return_period" tickFormatter={(v) => `${v}yr`}
            stroke="#e2e8f0" tick={{ fontSize: 9, fill: "#a0aec0" }} />
          <YAxis tickFormatter={(v) => `${(v/1e6).toFixed(0)}M`}
            stroke="#e2e8f0" tick={{ fontSize: 9, fill: "#a0aec0" }} />
          <Tooltip formatter={(v) => [fmt(v), "Net Loss"]} labelFormatter={(l) => `1-in-${l}yr`}
            contentStyle={TOOLTIP} />
          <Bar dataKey="net_loss_kes" fill="#4f46e5" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      {/* Loss table */}
      <div style={{ fontSize: 9, color: "#a0aec0", textTransform: "uppercase", letterSpacing: "0.07em", margin: "14px 0 8px", fontWeight: 700 }}>
        Loss Table
      </div>
      <table className="tbl">
        <thead>
          <tr><th>Scenario</th><th>Depth</th><th>Damage</th><th>Net Loss</th></tr>
        </thead>
        <tbody>
          {data.losses.map((r) => (
            <tr key={r.return_period}>
              <td style={{ fontWeight: 600, color: "#1a202c" }}>1-in-{r.return_period}yr</td>
              <td style={{ color: r.depth_m > 0 ? "#1a202c" : "#a0aec0" }}>
                {r.depth_m > 0 ? `${r.depth_m.toFixed(2)}m` : "Dry"}
              </td>
              <td>{r.damage_ratio > 0 ? `${(r.damage_ratio*100).toFixed(1)}%` : "—"}</td>
              <td style={{ fontWeight: 700, color: r.net_loss_kes > 0 ? "#4f46e5" : "#a0aec0" }}>
                {r.net_loss_kes > 0 ? `KES ${fmtS(r.net_loss_kes)}` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.ml3_flag && (
        <div style={{ marginTop: 14, background: "#fffbeb", border: "1px solid #fde68a",
          borderRadius: 8, padding: "10px 14px", fontSize: 11, color: "#92400e" }}>
          This building has been flagged for review. Its loss profile does not match
          what is expected for its construction type and flood depth. Manual review recommended before binding.
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Portfolio() {
  const [buildings, setBuildings] = useState([]);
  const [search,    setSearch]    = useState("");
  const [results,   setResults]   = useState([]);
  const [filter,    setFilter]    = useState("All");
  const [selected,  setSelected]  = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [mapView,   setMapView]   = useState(true);

  useEffect(() => {
    api.get("/portfolio").then((r) => { setBuildings(r.data); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!search) { setResults([]); return; }
    const t = setTimeout(() => api.get(`/search?q=${search}`).then((r) => setResults(r.data)), 250);
    return () => clearTimeout(t);
  }, [search]);

  if (loading) return <div className="loading">Loading buildings...</div>;

  const TIERS    = ["All", "Low", "Medium", "High", "Decline"];
  const filtered = filter === "All" ? buildings : buildings.filter((b) => b.risk_tier === filter);

  return (
    <div>
      <div className="info-note mb">
        This portfolio contains 500 synthetic buildings placed across the Nzoia Basin flood zone.
        Click any dot on the map or any row in the table to see the full risk breakdown.
      </div>

      {/* Search + filter + view toggle */}
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 14, flexWrap: "wrap" }}>
        <div className="search-wrap" style={{ marginBottom: 0 }}>
          <input className="search-input" placeholder="Search by building ID or type..."
            value={search} onChange={(e) => setSearch(e.target.value)}
            onBlur={() => setTimeout(() => setResults([]), 200)} />
          {results.length > 0 && (
            <div className="search-drop">
              {results.map((r) => (
                <div key={r.loc_id} className="search-item"
                  onMouseDown={() => { setSelected(r.loc_id); setSearch(""); setResults([]); }}>
                  <strong style={{ color: "#1a202c" }}>{r.loc_id}</strong>
                  &nbsp;·&nbsp;{r.housing_class.replace(/_/g, " ")}
                  &nbsp;·&nbsp;KES {(r.tiv_kes/1e6).toFixed(1)}M
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pills" style={{ marginBottom: 0 }}>
          {TIERS.map((t) => (
            <button key={t} className={`pill${filter === t ? " active" : ""}`} onClick={() => setFilter(t)}>
              {t === "All" ? "All" : TIER_LABEL[t] || t}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#a0aec0" }}>{filtered.length} buildings</span>
          <button
            className={`btn ${mapView ? "btn-primary" : "btn-outline"}`}
            style={{ fontSize: 11, padding: "6px 14px" }}
            onClick={() => setMapView(true)}>
            Map
          </button>
          <button
            className={`btn ${!mapView ? "btn-primary" : "btn-outline"}`}
            style={{ fontSize: 11, padding: "6px 14px" }}
            onClick={() => setMapView(false)}>
            Table
          </button>
        </div>
      </div>

      {/* Dot map */}
      {mapView && (
        <div className="card mb" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #e2e8f0" }}>
            <div className="card-title" style={{ marginBottom: 0 }}>Portfolio Map — Nzoia Basin</div>
            <Legend />
          </div>
          <div style={{ height: 480 }}>
            <PortfolioDotMap
              buildings={filtered}
              onSelect={setSelected}
              selectedId={selected}
            />
          </div>
        </div>
      )}

      {/* Table */}
      {!mapView && (
        <div className="card">
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Building ID</th>
                  <th>Construction Type</th>
                  <th>Floor Area</th>
                  <th>Insured Value</th>
                  <th>Flood Probability</th>
                  <th>Damage at RP100</th>
                  <th>Risk Level</th>
                  <th>Flagged</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <tr key={b.loc_id} onClick={() => setSelected(b.loc_id)}
                    style={{ background: selected === b.loc_id ? "#eef2ff" : undefined }}>
                    <td style={{ color: "#1a202c", fontWeight: 600 }}>{b.loc_id}</td>
                    <td style={{ color: "#4a5568" }}>{b.housing_class.replace(/_/g, " ")}</td>
                    <td>{b.floor_area_m2} m²</td>
                    <td>KES {(b.tiv_kes/1e6).toFixed(1)}M</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 44, height: 4, borderRadius: 2, background: "#e2e8f0", overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(b.flood_probability*100, 100)}%`,
                            height: "100%", background: "#4f46e5" }} />
                        </div>
                        <span>{(b.flood_probability*100).toFixed(1)}%</span>
                      </div>
                    </td>
                    <td>{(b.damage_ratio_rp100*100).toFixed(1)}%</td>
                    <td><span className={BADGE_CLS[b.risk_tier]}>{TIER_LABEL[b.risk_tier]}</span></td>
                    <td style={{ color: b.ml3_flag ? "#888" : "#333" }}>
                      {b.ml3_flag ? "Review" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && <Drawer id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
