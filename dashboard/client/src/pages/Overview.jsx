import { useEffect, useState } from "react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LineChart, Line,
} from "recharts";
import api from "../api";

const fmt     = (n) => n >= 1e9 ? `KES ${(n/1e9).toFixed(2)}B` : `KES ${(n/1e6).toFixed(1)}M`;
const pct     = (n) => `${(n*100).toFixed(3)}%`;
const TOOLTIP = { background: "#fff", border: "1px solid #e2e8f0", fontSize: 11, color: "#1a202c", borderRadius: 8, boxShadow: "0 4px 6px rgba(0,0,0,0.07)" };

const TIER_FILL  = { Low: "#059669", Medium: "#d97706", High: "#ea580c", Decline: "#dc2626" };
const TIER_LABEL = { Low: "Low Risk", Medium: "Moderate Risk", High: "High Risk", Decline: "Very High Risk" };

export default function Overview() {
  const [stats, setStats] = useState(null);

  useEffect(() => { api.get("/portfolio/stats").then((r) => setStats(r.data)); }, []);

  if (!stats) return <div className="loading">Loading portfolio data...</div>;

  const { epCurve, tierCounts, tierTIV, aal, pureRate, grossRate, grossPremium, totalTIV, totalBldgs, anomalies } = stats;

  const tierData = Object.entries(tierCounts).map(([tier, count]) => ({
    tier: TIER_LABEL[tier], count, fill: TIER_FILL[tier],
  }));

  return (
    <div>
      {/* KPIs */}
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Total Buildings</div>
          <div className="kpi-value">{totalBldgs}</div>
          <div className="kpi-sub">synthetic demo portfolio</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Total Insured Value</div>
          <div className="kpi-value">{fmt(totalTIV)}</div>
          <div className="kpi-sub">across all buildings</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Average Annual Loss</div>
          <div className="kpi-value">{fmt(aal)}</div>
          <div className="kpi-sub">expected loss per year</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Technical Premium Rate</div>
          <div className="kpi-value">{pct(pureRate)}</div>
          <div className="kpi-sub">minimum rate to break even</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Recommended Premium</div>
          <div className="kpi-value">{fmt(grossPremium)}</div>
          <div className="kpi-sub">per year at {pct(grossRate)}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Flagged for Review</div>
          <div className="kpi-value">{anomalies}</div>
          <div className="kpi-sub">unusual loss profiles</div>
        </div>
      </div>

      {/* Charts row */}
      <div className="g2 mb">
        <div className="card">
          <div className="card-title">Buildings by Risk Level (1-in-100 year flood)</div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={tierData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="tier" stroke="#e2e8f0" tick={{ fontSize: 10, fill: "#a0aec0" }} />
              <YAxis stroke="#e2e8f0" tick={{ fontSize: 10, fill: "#a0aec0" }} />
              <Tooltip contentStyle={TOOLTIP} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {tierData.map((d) => (
                  <Cell key={d.tier} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card-title">Portfolio Loss at Different Flood Severities</div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={epCurve} margin={{ top: 4, right: 12, left: 10, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="return_period" tickFormatter={(v) => `${v}yr`}
                stroke="#e2e8f0" tick={{ fontSize: 10, fill: "#a0aec0" }} />
              <YAxis tickFormatter={(v) => `${(v/1e9).toFixed(1)}B`}
                stroke="#e2e8f0" tick={{ fontSize: 10, fill: "#a0aec0" }} />
              <Tooltip
                formatter={(v) => [fmt(v), "Net Loss"]}
                labelFormatter={(l) => `1-in-${l} year flood`}
                contentStyle={TOOLTIP} />
              <Line type="monotone" dataKey="net_loss" stroke="#4f46e5"
                strokeWidth={2} dot={{ r: 3, fill: "#4f46e5" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* TIV by risk level */}
      <div className="card mb">
        <div className="card-title">Insured Value by Risk Level</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
          {Object.entries(tierTIV).map(([tier, tiv]) => (
            <div key={tier} style={{
              background: "#f8fafc", borderRadius: 10, padding: "14px 16px",
              borderLeft: `4px solid ${TIER_FILL[tier]}`,
            }}>
              <div style={{ fontSize: 10, color: "#a0aec0", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
                {TIER_LABEL[tier]}
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: TIER_FILL[tier], marginTop: 4 }}>
                {fmt(tiv)}
              </div>
              <div style={{ fontSize: 11, color: "#718096", marginTop: 2 }}>
                {tierCounts[tier]} buildings
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Loss table */}
      <div className="card">
        <div className="card-title">Loss at Key Flood Scenarios</div>
        <table className="tbl">
          <thead>
            <tr>
              <th>Flood Scenario</th>
              <th>Chance per Year</th>
              <th>Buildings Flooded</th>
              <th>Portfolio Net Loss</th>
              <th>Loss as % of Total Value</th>
            </tr>
          </thead>
          <tbody>
            {epCurve.map((r) => (
              <tr key={r.return_period}>
                <td style={{ color: "#1a202c", fontWeight: 600 }}>1-in-{r.return_period} year</td>
                <td>{(r.aep * 100).toFixed(2)}%</td>
                <td>{r.flooded}</td>
                <td style={{ fontWeight: 700, color: "#4f46e5" }}>{fmt(r.net_loss)}</td>
                <td>{(r.net_loss / totalTIV * 100).toFixed(3)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
