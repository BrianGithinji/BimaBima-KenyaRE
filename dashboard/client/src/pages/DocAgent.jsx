import { useState, useRef } from "react";
import api from "../api";

const fmt      = (n) => !n ? "—" : n >= 1e9 ? `KES ${(n/1e9).toFixed(2)}B` : `KES ${(n/1e6).toFixed(2)}M`;
const fmtShort = (n) => !n ? "—" : n >= 1e9 ? `KES ${(n/1e9).toFixed(2)}B` : `KES ${(n/1e6).toFixed(1)}M`;

const CLASSES = [
  { value: "informal_iron_sheet", label: "Iron Sheet / Timber" },
  { value: "semi_permanent",      label: "Semi-Permanent"       },
  { value: "permanent_masonry",   label: "Permanent Masonry"    },
  { value: "concrete_rcc",        label: "Reinforced Concrete"  },
];

const TIER_BADGE = {
  Low:     "badge badge-low",
  Medium:  "badge badge-medium",
  High:    "badge badge-high",
  Decline: "badge badge-decline",
};
const TIER_TEXT = { Low: "Low Risk", Medium: "Moderate Risk", High: "High Risk", Decline: "Very High Risk" };

const STEPS = [
  { key: "upload",   label: "Upload Document"     },
  { key: "extract",  label: "Extract Data"         },
  { key: "review",   label: "Review & Edit"        },
  { key: "assess",   label: "Run Assessments"      },
  { key: "results",  label: "Results"              },
];

// ── Step indicator ────────────────────────────────────────────────────────────
function StepBar({ current }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 24 }}>
      {STEPS.map((s, i) => (
        <div key={s.key} style={{ display: "flex", alignItems: "center", flex: i < STEPS.length - 1 ? 1 : "none" }}>
          <div style={{
            width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 700,
            background: i < idx ? "var(--primary)" : i === idx ? "var(--primary)" : "var(--border)",
            color: i <= idx ? "#fff" : "var(--text-faint)",
            boxShadow: i === idx ? "0 0 0 3px rgba(79,70,229,0.2)" : "none",
          }}>{i < idx ? "✓" : i + 1}</div>
          <div style={{ fontSize: 10, color: i === idx ? "var(--primary)" : "var(--text-faint)",
            fontWeight: i === idx ? 700 : 400, marginLeft: 6, whiteSpace: "nowrap" }}>
            {s.label}
          </div>
          {i < STEPS.length - 1 && (
            <div style={{ flex: 1, height: 2, margin: "0 10px",
              background: i < idx ? "var(--primary)" : "var(--border)" }} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Agent log ─────────────────────────────────────────────────────────────────
function AgentLog({ entries }) {
  return (
    <div style={{ background: "#f8fafc", border: "1px solid var(--border)", borderRadius: 8,
      padding: "12px 16px", fontFamily: "monospace", fontSize: 11, color: "var(--text-dim)",
      maxHeight: 160, overflowY: "auto", lineHeight: 1.8 }}>
      {entries.map((e, i) => (
        <div key={i} style={{ display: "flex", gap: 8 }}>
          <span style={{ color: "var(--primary)", flexShrink: 0 }}>›</span>
          <span>{e}</span>
        </div>
      ))}
    </div>
  );
}

// ── Editable building row ─────────────────────────────────────────────────────
function BuildingRow({ b, idx, onChange }) {
  const tiv = (b.floor_area_m2 && b.cost_per_m2_kes)
    ? b.floor_area_m2 * b.cost_per_m2_kes : b.tiv_kes;

  const cell = (field, type = "text", opts = null) => (
    opts
      ? <select value={b[field] || ""} onChange={(e) => onChange(idx, field, e.target.value)}
          style={{ width: "100%", background: "transparent", border: "none", fontSize: 11,
            color: "var(--text)", outline: "none", cursor: "pointer" }}>
          {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      : <input type={type} value={b[field] ?? ""} onChange={(e) => onChange(idx, field, e.target.value)}
          style={{ width: "100%", background: "transparent", border: "none", fontSize: 11,
            color: "var(--text)", outline: "none" }} />
  );

  return (
    <tr style={{ background: b._needs_review ? "#fffbeb" : "transparent" }}>
      <td style={{ color: "var(--text)", fontWeight: 600 }}>{cell("name")}</td>
      <td>{cell("lat", "number")}</td>
      <td>{cell("lon", "number")}</td>
      <td>{cell("housing_class", "text", CLASSES)}</td>
      <td>{cell("floor_area_m2", "number")}</td>
      <td>{cell("cost_per_m2_kes", "number")}</td>
      <td style={{ color: "var(--primary)", fontWeight: 600 }}>{fmtShort(tiv)}</td>
      <td>
        {b._needs_review
          ? <span style={{ fontSize: 10, color: "#d97706", fontWeight: 600 }}>⚠ Review</span>
          : <span style={{ fontSize: 10, color: "#059669", fontWeight: 600 }}>✓ Ready</span>}
      </td>
    </tr>
  );
}

// ── Results table ─────────────────────────────────────────────────────────────
function ResultsTable({ results }) {
  const [expanded, setExpanded] = useState(null);

  return (
    <div className="card">
      <div className="card-title">Assessment Results — {results.length} Buildings</div>

      {/* Summary KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 16 }}>
        {[
          ["Total Insured Value",   fmt(results.reduce((s, r) => s + (r.tiv_kes || 0), 0))],
          ["Total Annual Premium",  fmt(results.reduce((s, r) => s + (r.suggested_premium || 0), 0))],
          ["Average Annual Loss",   fmt(results.reduce((s, r) => s + (r.aal || 0), 0))],
          ["Decline / High Risk",   results.filter((r) => r.risk_tier === "Decline" || r.risk_tier === "High").length + " buildings"],
        ].map(([l, v]) => (
          <div key={l} style={{ background: "var(--surface2)", borderRadius: 8, padding: "12px 14px",
            border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 10, color: "var(--text-faint)", textTransform: "uppercase",
              letterSpacing: "0.06em", fontWeight: 700 }}>{l}</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--primary)", marginTop: 4 }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Property</th>
              <th>Construction</th>
              <th>Insured Value</th>
              <th>RP100 Damage</th>
              <th>Annual Loss</th>
              <th>Suggested Premium</th>
              <th>Risk Level</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <>
                <tr key={i} style={{ cursor: "pointer" }} onClick={() => setExpanded(expanded === i ? null : i)}>
                  <td style={{ fontWeight: 600, color: "var(--text)" }}>{r.name || `Building ${i+1}`}</td>
                  <td style={{ color: "var(--text-dim)" }}>{r.housing_class?.replace(/_/g, " ")}</td>
                  <td>{fmtShort(r.tiv_kes)}</td>
                  <td>{r.damage_ratio_rp100 > 0 ? `${(r.damage_ratio_rp100*100).toFixed(1)}%` : "—"}</td>
                  <td style={{ color: "var(--primary)", fontWeight: 600 }}>{fmtShort(r.aal)}</td>
                  <td style={{ fontWeight: 700 }}>{fmtShort(r.suggested_premium)}</td>
                  <td><span className={TIER_BADGE[r.risk_tier]}>{TIER_TEXT[r.risk_tier]}</span></td>
                  <td style={{ color: "var(--text-faint)", fontSize: 11 }}>{expanded === i ? "▲" : "▼"}</td>
                </tr>
                {expanded === i && (
                  <tr key={`${i}-exp`}>
                    <td colSpan={8} style={{ background: "var(--surface2)", padding: "12px 16px" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 8 }}>
                        {(r.losses || []).map((l) => (
                          <div key={l.return_period} style={{ background: "var(--surface)",
                            borderRadius: 6, padding: "8px 10px", border: "1px solid var(--border)" }}>
                            <div style={{ fontSize: 9, color: "var(--text-faint)", fontWeight: 700,
                              textTransform: "uppercase" }}>1-in-{l.return_period}yr</div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--primary)", marginTop: 2 }}>
                              {l.net_loss_kes > 0 ? fmtShort(l.net_loss_kes) : "Dry"}
                            </div>
                            <div style={{ fontSize: 10, color: "var(--text-faint)" }}>
                              {l.depth_m > 0 ? `${l.depth_m.toFixed(2)}m depth` : "No flood"}
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function DocAgent() {
  const [step,      setStep]      = useState("upload");
  const [log,       setLog]       = useState([]);
  const [buildings, setBuildings] = useState([]);
  const [results,   setResults]   = useState([]);
  const [assessing, setAssessing] = useState(false);
  const [progress,  setProgress]  = useState(0);
  const [dragOver,  setDragOver]  = useState(false);
  const [rawText,   setRawText]   = useState(null);
  const [showRaw,   setShowRaw]   = useState(false);
  const fileRef = useRef();

  const addLog = (msg) => setLog((l) => [...l, msg]);

  const handleFile = async (file) => {
    if (!file) return;
    setStep("extract");
    setLog([`Uploading "${file.name}"...`]);
    setBuildings([]);
    setResults([]);

    const form = new FormData();
    form.append("file", file);

    try {
      addLog("Sending to extraction agent...");
      const res = await fetch("http://localhost:5000/api/extract", { method: "POST", body: form });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error(`Server error (${res.status}): ${text.slice(0, 120)}`); }

      if (!res.ok) throw new Error(data.error || "Extraction failed");

      setLog(data.log || []);
      setRawText(data.rawText || null);

      if (!data.buildings?.length) {
        addLog("⚠ No buildings could be extracted. Check the file format.");
        setStep("upload");
        return;
      }

      setBuildings(data.buildings);
      setStep("review");
    } catch (err) {
      setLog((l) => [...l, `Error: ${err.message}`]);
      setStep("upload");
    }
  };

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const onChange = (idx, field, value) => {
    setBuildings((bs) => bs.map((b, i) => {
      if (i !== idx) return b;
      const updated = { ...b, [field]: field === "housing_class" ? value : (value === "" ? null : value) };
      updated._needs_review = !updated.housing_class || !updated.floor_area_m2 || !updated.cost_per_m2_kes;
      return updated;
    }));
  };

  const runAssessments = async () => {
    setAssessing(true);
    setStep("assess");
    setResults([]);
    setProgress(0);
    const out = [];

    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      addLog(`Assessing "${b.name}" (${i+1}/${buildings.length})...`);
      try {
        const r = await api.post("/assess", {
          lat:             parseFloat(b.lat),
          lon:             parseFloat(b.lon),
          housing_class:   b.housing_class,
          floor_area_m2:   parseFloat(b.floor_area_m2),
          cost_per_m2_kes: parseFloat(b.cost_per_m2_kes),
        });
        out.push({ ...r.data, name: b.name });
        addLog(`  → ${TIER_TEXT[r.data.risk_tier]} | Premium: ${fmtShort(r.data.suggested_premium)}`);
      } catch (err) {
        addLog(`  ✗ Failed: ${err.response?.data?.error || err.message}`);
        out.push({ name: b.name, error: true });
      }
      setProgress(Math.round(((i + 1) / buildings.length) * 100));
    }

    setResults(out);
    setAssessing(false);
    setStep("results");
    addLog(`Done. ${out.filter((r) => !r.error).length}/${buildings.length} assessments completed.`);
  };

  return (
    <div>
      <StepBar current={step} />

      {/* ── Upload ── */}
      {(step === "upload" || step === "extract") && (
        <div className="card mb">
          <div className="card-title">Upload Portfolio Document</div>
          <div className="info-note" style={{ marginBottom: 16 }}>
            Upload a <strong>PDF</strong> (offer document, survey report), <strong>Excel</strong>, or <strong>CSV</strong> file.
            The agent will automatically extract building names, GPS coordinates, construction types, floor areas, and values.
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => fileRef.current.click()}
            style={{
              border: `2px dashed ${dragOver ? "var(--primary)" : "var(--border)"}`,
              borderRadius: 12, padding: "40px 24px", textAlign: "center",
              background: dragOver ? "var(--primary-lt)" : "var(--surface2)",
              cursor: "pointer", transition: "all 0.15s", marginBottom: 16,
            }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
              Drop your file here, or click to browse
            </div>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
              Supports PDF, Excel (.xlsx, .xls), CSV — max 20 MB
            </div>
            <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.csv"
              style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
          </div>

          {log.length > 0 && <AgentLog entries={log} />}
        </div>
      )}

      {/* ── Review & Edit ── */}
      {step === "review" && (
        <div>
          <div className="card mb">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div className="card-title" style={{ marginBottom: 0 }}>
                Extracted Buildings — {buildings.length} found
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {rawText && (
                  <button className="btn btn-outline" style={{ fontSize: 11 }}
                    onClick={() => setShowRaw(!showRaw)}>
                    {showRaw ? "Hide" : "Show"} Raw Text
                  </button>
                )}
                <button className="btn btn-outline" style={{ fontSize: 11 }}
                  onClick={() => { setStep("upload"); setLog([]); setBuildings([]); }}>
                  ← Upload Different File
                </button>
              </div>
            </div>

            <div className="info-note" style={{ marginBottom: 14 }}>
              Review the extracted data below. Click any cell to edit it.
              Fields marked <strong style={{ color: "#d97706" }}>⚠ Review</strong> are missing required values — fill them in before running assessments.
            </div>

            {showRaw && rawText && (
              <div style={{ background: "#f8fafc", border: "1px solid var(--border)", borderRadius: 8,
                padding: 12, fontFamily: "monospace", fontSize: 10, color: "var(--text-dim)",
                maxHeight: 200, overflowY: "auto", marginBottom: 14, whiteSpace: "pre-wrap" }}>
                {rawText}
              </div>
            )}

            <AgentLog entries={log} />
          </div>

          <div className="card mb">
            <div className="card-title">Building Data — Click any cell to edit</div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Property Name</th>
                    <th>Latitude</th>
                    <th>Longitude</th>
                    <th>Construction Type</th>
                    <th>Floor Area (m²)</th>
                    <th>Cost per m² (KES)</th>
                    <th>Est. Value</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {buildings.map((b, i) => (
                    <BuildingRow key={i} b={b} idx={i} onChange={onChange} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button className="btn btn-primary" onClick={runAssessments}
              disabled={buildings.every((b) => b._needs_review)}>
              Run Flood Risk Assessment for All Buildings
            </button>
            <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
              {buildings.filter((b) => !b._needs_review).length} of {buildings.length} buildings ready
            </span>
          </div>
        </div>
      )}

      {/* ── Assessing ── */}
      {step === "assess" && (
        <div className="card mb">
          <div className="card-title">Running Assessments...</div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11,
              color: "var(--text-faint)", marginBottom: 6 }}>
              <span>Progress</span><span>{progress}%</span>
            </div>
            <div style={{ height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progress}%`, background: "var(--primary)",
                borderRadius: 4, transition: "width 0.3s" }} />
            </div>
          </div>
          <AgentLog entries={log} />
        </div>
      )}

      {/* ── Results ── */}
      {step === "results" && results.length > 0 && (
        <div>
          <div className="card mb">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="card-title" style={{ marginBottom: 0 }}>Assessment Complete</div>
              <button className="btn btn-outline" style={{ fontSize: 11 }}
                onClick={() => { setStep("upload"); setLog([]); setBuildings([]); setResults([]); }}>
                Start New Upload
              </button>
            </div>
            <AgentLog entries={log} />
          </div>
          <ResultsTable results={results.filter((r) => !r.error)} />
        </div>
      )}
    </div>
  );
}
