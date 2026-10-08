import { useEffect, useState } from "react";
import {
  ScatterChart, Scatter, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import api from "../api";

const fmt     = (n) => n >= 1e9 ? `KES ${(n/1e9).toFixed(2)}B` : `KES ${(n/1e6).toFixed(2)}M`;
const TOOLTIP = { background: "#fff", border: "1px solid #e2e8f0", fontSize: 11, color: "#1a202c", borderRadius: 8, boxShadow: "0 4px 6px rgba(0,0,0,0.07)" };

export default function Anomalies() {
  const [buildings, setBuildings] = useState([]);
  const [flagged,   setFlagged]   = useState([]);
  const [loading,   setLoading]   = useState(true);

  useEffect(() => {
    api.get("/portfolio").then(async (pb) => {
      const all      = pb.data;
      setBuildings(all);
      const flagList = all.filter((b) => b.ml3_flag);
      const details  = await Promise.all(flagList.map((b) => api.get(`/building/${b.loc_id}`)));
      const rows     = details.map((r) => {
        const rp100 = r.data.losses.find((l) => l.return_period === 100) || {};
        return {
          loc_id:        r.data.loc_id,
          housing_class: r.data.housing_class,
          depth_m:       rp100.depth_m       || 0,
          damage_ratio:  rp100.damage_ratio  || 0,
          net_loss_kes:  rp100.net_loss_kes  || 0,
          tiv_kes:       r.data.tiv_kes,
          anomaly_score: r.data.ml3_anomaly_score,
        };
      });
      setFlagged(rows.sort((a, b) => a.anomaly_score - b.anomaly_score));
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="loading">Loading flagged buildings...</div>;

  const flooded = buildings.filter((b) => b.damage_ratio_rp100 > 0);
  const scatterNormal  = flooded.filter((b) => !b.ml3_flag).map((b) => ({
    dr: b.damage_ratio_rp100, tiv: b.tiv_kes / 1e6, flag: false, id: b.loc_id,
  }));
  const scatterFlagged = flooded.filter((b) =>  b.ml3_flag).map((b) => ({
    dr: b.damage_ratio_rp100, tiv: b.tiv_kes / 1e6, flag: true,  id: b.loc_id,
  }));

  return (
    <div>
      <div className="info-note mb">
        These buildings have been automatically flagged because their expected loss does not match
        what is typical for their construction type and flood depth. For example, a reinforced concrete
        building showing very high losses at shallow water depth is unusual and warrants a closer look
        before the policy is bound. This does not mean the building should be declined — it means
        the data should be verified.
      </div>

      {/* KPIs */}
      <div className="kpi-grid mb">
        <div className="kpi">
          <div className="kpi-label">Buildings Flagged</div>
          <div className="kpi-value">{flagged.length}</div>
          <div className="kpi-sub">out of {flooded.length} flooded buildings at RP100</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Flag Rate</div>
          <div className="kpi-value">
            {flooded.length > 0 ? `${(flagged.length / flooded.length * 100).toFixed(1)}%` : "—"}
          </div>
          <div className="kpi-sub">of flooded buildings</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Total Insured Value at Risk</div>
          <div className="kpi-value">{fmt(flagged.reduce((s, b) => s + b.tiv_kes, 0))}</div>
          <div className="kpi-sub">across flagged buildings</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Detection Method</div>
          <div className="kpi-value" style={{ fontSize: 13 }}>Isolation Forest</div>
          <div className="kpi-sub">statistical outlier detection</div>
        </div>
      </div>

      {/* Scatter */}
      <div className="card mb">
        <div className="card-title">Damage vs Insured Value — Flooded Buildings at 1-in-100 Year Flood</div>
        <div style={{ fontSize: 11, color: "#4a5568", marginBottom: 12 }}>
          Blue dots are normal. Orange outlined dots are flagged as unusual.
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <ScatterChart margin={{ top: 8, right: 16, left: 8, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="dr" name="Damage" type="number"
              tickFormatter={(v) => `${(v*100).toFixed(0)}%`}
              stroke="#e2e8f0" tick={{ fontSize: 10, fill: "#a0aec0" }}
              label={{ value: "Damage Ratio", position: "insideBottom", offset: -12, fill: "#a0aec0", fontSize: 10 }} />
            <YAxis dataKey="tiv" name="Insured Value (M)" type="number"
              stroke="#e2e8f0" tick={{ fontSize: 10, fill: "#a0aec0" }}
              label={{ value: "Insured Value (KES M)", angle: -90, position: "insideLeft", fill: "#a0aec0", fontSize: 10 }} />
            <Tooltip
              content={({ payload }) => {
                if (!payload?.length) return null;
                const d = payload[0].payload;
                return (
                  <div style={{ background: "#fff", border: "1px solid #e2e8f0",
                    padding: "8px 12px", fontSize: 11, borderRadius: 8, color: "#1a202c", boxShadow: "0 4px 6px rgba(0,0,0,0.07)" }}>
                    <div style={{ fontWeight: 700, marginBottom: 3 }}>{d.id}</div>
                    <div>Damage: {(d.dr*100).toFixed(1)}%</div>
                    <div>Insured Value: KES {d.tiv.toFixed(1)}M</div>
                    {d.flag && <div style={{ color: "#ea580c", marginTop: 3, fontWeight: 600 }}>Flagged for review</div>}
                  </div>
                );
              }}
            />
            <Scatter name="Normal"  data={scatterNormal}  fill="#c7d2fe" stroke="#4f46e5" strokeWidth={1} r={4} />
            <Scatter name="Flagged" data={scatterFlagged} fill="#fed7aa" stroke="#ea580c" strokeWidth={2} r={6} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Flagged table */}
      <div className="card">
        <div className="card-title">Flagged Buildings — Manual Review Required</div>
        {flagged.length === 0 ? (
          <div style={{ color: "#a0aec0", fontSize: 13, padding: "12px 0" }}>
            No buildings flagged in the current flooded set.
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Building ID</th>
                  <th>Construction Type</th>
                  <th>Insured Value</th>
                  <th>Water Depth (RP100)</th>
                  <th>Damage</th>
                  <th>Net Loss</th>
                  <th>Anomaly Score</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {flagged.map((r) => (
                  <tr key={r.loc_id}>
                    <td style={{ color: "#1a202c", fontWeight: 600 }}>{r.loc_id}</td>
                    <td style={{ color: "#4a5568" }}>{r.housing_class.replace(/_/g, " ")}</td>
                    <td>{fmt(r.tiv_kes)}</td>
                    <td style={{ color: "#1a202c" }}>{r.depth_m.toFixed(2)} m</td>
                    <td>{(r.damage_ratio*100).toFixed(1)}%</td>
                    <td style={{ fontWeight: 700, color: "#4f46e5" }}>{fmt(r.net_loss_kes)}</td>
                    <td style={{ fontFamily: "monospace", color: "#a0aec0" }}>
                      {r.anomaly_score?.toFixed(4)}
                    </td>
                    <td style={{ color: "#ea580c", fontSize: 11, fontWeight: 600 }}>Verify before binding</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Explanation */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="card-title">How Flagging Works</div>
        <div style={{ fontSize: 12, color: "#4a5568", lineHeight: 1.9 }}>
          <strong style={{ color: "#1a202c" }}>Method:</strong> Isolation Forest — a statistical algorithm that identifies data points which are unusually easy to separate from the rest. Buildings that are easy to isolate have unusual combinations of flood depth, damage, and insured value.<br />
          <strong style={{ color: "#1a202c" }}>What triggers a flag:</strong> A building whose loss is much higher or lower than expected given its construction type and water depth. For example, a reinforced concrete building with very high damage at shallow depth, or an iron-sheet structure with surprisingly low damage at deep water.<br />
          <strong style={{ color: "#1a202c" }}>What to do:</strong> Verify the building details — construction type, floor area, insured value, and location coordinates. The flag does not mean the building should be declined; it means the data should be checked before a policy is issued.<br />
          <strong style={{ color: "#1a202c" }}>Score:</strong> More negative scores indicate stronger anomalies. A score below zero means the building was classified as an outlier.
        </div>
      </div>
    </div>
  );
}
