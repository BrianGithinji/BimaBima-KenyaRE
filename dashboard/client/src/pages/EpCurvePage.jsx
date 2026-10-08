import { useEffect, useState } from "react";
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from "recharts";
import api from "../api";

const fmt     = (n) => n >= 1e9 ? `KES ${(n/1e9).toFixed(3)}B` : `KES ${(n/1e6).toFixed(1)}M`;
const pct     = (n) => `${(n*100).toFixed(4)}%`;
const TOOLTIP = { background: "#fff", border: "1px solid #e2e8f0", fontSize: 11, color: "#1a202c", borderRadius: 8, boxShadow: "0 4px 6px rgba(0,0,0,0.07)" };

export default function EpCurvePage() {
  const [stats, setStats] = useState(null);

  useEffect(() => { api.get("/portfolio/stats").then((r) => setStats(r.data)); }, []);

  if (!stats) return <div className="loading">Loading loss curve data...</div>;

  const { epCurve, aal, pureRate, grossRate, grossPremium, totalTIV } = stats;
  const rp100 = epCurve.find((r) => r.return_period === 100) || {};

  return (
    <div>
      {/* Plain English explanation */}
      <div className="info-note mb">
        This curve shows how much the portfolio could lose at different flood severities.
        A 1-in-100 year flood does not mean it happens once every 100 years — it means there is a
        1% chance of it happening in any given year. The curve rises steeply at first because
        most buildings sit in the same flood corridor, then flattens as rarer floods add fewer new buildings.
      </div>

      {/* KPIs */}
      <div className="kpi-grid mb">
        <div className="kpi">
          <div className="kpi-label">Average Annual Loss</div>
          <div className="kpi-value">{fmt(aal)}</div>
          <div className="kpi-sub">expected loss per year across all scenarios</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">1-in-100 Year Loss</div>
          <div className="kpi-value">{fmt(rp100.net_loss || 0)}</div>
          <div className="kpi-sub">1% chance in any year</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Technical Premium Rate</div>
          <div className="kpi-value">{pct(pureRate)}</div>
          <div className="kpi-sub">minimum to cover expected losses</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Recommended Premium Rate</div>
          <div className="kpi-value">{pct(grossRate)}</div>
          <div className="kpi-sub">includes expenses and profit margin</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Annual Portfolio Premium</div>
          <div className="kpi-value">{fmt(grossPremium)}</div>
          <div className="kpi-sub">total recommended premium</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Total Insured Value</div>
          <div className="kpi-value">{fmt(totalTIV)}</div>
          <div className="kpi-sub">across all 500 buildings</div>
        </div>
      </div>

      {/* Main loss curve */}
      <div className="card mb">
        <div className="card-title">Portfolio Loss Curve — Net Loss by Flood Severity</div>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={epCurve} margin={{ top: 12, right: 20, left: 20, bottom: 20 }}>
            <defs>
              <linearGradient id="epg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#4f46e5" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="return_period"
              tickFormatter={(v) => `1-in-${v}yr`}
              stroke="#e2e8f0" tick={{ fontSize: 10, fill: "#a0aec0" }}
              label={{ value: "Flood Severity (return period)", position: "insideBottom", offset: -12, fill: "#a0aec0", fontSize: 10 }} />
            <YAxis
              tickFormatter={(v) => `${(v/1e9).toFixed(2)}B`}
              stroke="#e2e8f0" tick={{ fontSize: 10, fill: "#a0aec0" }}
              label={{ value: "Net Loss (KES)", angle: -90, position: "insideLeft", offset: 10, fill: "#a0aec0", fontSize: 10 }} />
            <Tooltip
              formatter={(v) => [fmt(v), "Net Loss"]}
              labelFormatter={(l) => `1-in-${l} year flood`}
              contentStyle={TOOLTIP} />
            <ReferenceLine x={100} stroke="#4f46e5" strokeDasharray="4 3"
              label={{ value: "1-in-100yr", fill: "#4f46e5", fontSize: 9, position: "top" }} />
            <Area type="monotone" dataKey="net_loss" stroke="#4f46e5" strokeWidth={2}
              fill="url(#epg)" dot={{ r: 4, fill: "#4f46e5", stroke: "#fff", strokeWidth: 1 }} activeDot={{ r: 6 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* AEP view + table */}
      <div className="g2 mb">
        <div className="card">
          <div className="card-title">Loss vs Annual Probability of Exceedance</div>
          <div className="info-note" style={{ marginBottom: 12, fontSize: 10 }}>
            The same data shown differently — higher probability means more common, lower loss.
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart
              data={[...epCurve].sort((a, b) => a.aep - b.aep)}
              margin={{ top: 4, right: 12, left: 12, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="aep" tickFormatter={(v) => `${(v*100).toFixed(1)}%`}
                stroke="#e2e8f0" tick={{ fontSize: 10, fill: "#a0aec0" }} />
              <YAxis tickFormatter={(v) => `${(v/1e9).toFixed(2)}B`}
                stroke="#e2e8f0" tick={{ fontSize: 10, fill: "#a0aec0" }} />
              <Tooltip
                formatter={(v) => [fmt(v), "Net Loss"]}
                labelFormatter={(l) => `${(l*100).toFixed(2)}% annual chance`}
                contentStyle={TOOLTIP} />
              <Line type="monotone" dataKey="net_loss" stroke="#4f46e5"
                strokeWidth={2} dot={{ r: 3, fill: "#4f46e5" }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <div className="card-title">Loss Table</div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Annual Chance</th>
                <th>Flooded</th>
                <th>Net Loss</th>
                <th>% of Portfolio</th>
              </tr>
            </thead>
            <tbody>
              {epCurve.map((r) => (
                <tr key={r.return_period}>
                  <td style={{ color: "#1a202c", fontWeight: 600 }}>1-in-{r.return_period}yr</td>
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

      {/* Methodology */}
      <div className="card">
        <div className="card-title">How This Is Calculated</div>
        <div style={{ fontSize: 12, color: "#4a5568", lineHeight: 1.9 }}>
          <strong style={{ color: "#1a202c" }}>Hazard:</strong> Real flood depth maps from the EU Joint Research Centre (JRC), covering the Nzoia River basin. Each map shows water depth at a different flood severity — from a common 1-in-10 year event to a rare 1-in-500 year event.<br />
          <strong style={{ color: "#1a202c" }}>Damage:</strong> A machine learning model (trained on historical flood damage data) predicts what fraction of a building's value is destroyed at each water depth, depending on construction type.<br />
          <strong style={{ color: "#1a202c" }}>Loss:</strong> Damage fraction × insured value = loss per building. All buildings are summed to get the portfolio total.<br />
          <strong style={{ color: "#1a202c" }}>Average Annual Loss:</strong> Calculated by integrating the loss curve — the area under the curve gives the expected loss per year across all possible flood events.<br />
          <strong style={{ color: "#1a202c" }}>Premium:</strong> The technical (minimum) rate equals average annual loss divided by total insured value. The recommended rate adds a 35% loading for expenses and profit.
        </div>
      </div>
    </div>
  );
}
