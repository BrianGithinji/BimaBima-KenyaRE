import { useState } from "react";
import "./App.css";
import Overview    from "./pages/Overview";
import EpCurvePage from "./pages/EpCurvePage";
import Portfolio   from "./pages/Portfolio";
import Assessor    from "./pages/Assessor";
import Anomalies   from "./pages/Anomalies";
import Auth        from "./pages/Auth";
import DocAgent    from "./pages/DocAgent";

const NAV = [
  { id: "agent",    label: "Document Agent"   },
  { id: "assessor",  label: "Risk Assessment"   },
  { id: "overview",  label: "Portfolio Summary"  },
  { id: "ep",        label: "Loss Curve"         },
  { id: "portfolio", label: "All Buildings"      },
  { id: "anomalies", label: "Flagged Risks"      },
];

const TITLES = {
  agent:    { title: "Document Agent",         sub: "Upload a portfolio document and the agent will extract and assess all buildings automatically" },
  assessor:  { title: "Risk Assessment",        sub: "Enter building details to assess flood risk and get a premium estimate" },
  overview:  { title: "Portfolio Summary",      sub: "Key figures across all buildings in the Nzoia Basin portfolio" },
  ep:        { title: "Loss Curve",             sub: "How much the portfolio could lose at different flood severities" },
  portfolio: { title: "All Buildings",          sub: "Browse, search and inspect individual buildings" },
  anomalies: { title: "Flagged Risks",          sub: "Buildings whose loss profile does not match their construction type" },
};

const NAV_ICONS = {
  agent:     "📄",
  assessor:  "🔍",
  overview:  "📊",
  ep:        "📈",
  portfolio: "🗺️",
  anomalies: "⚠️",
};

export default function App() {
  const [user, setUser]     = useState(null);
  const [page, setPage]     = useState("assessor");
  const [menuOpen, setMenu] = useState(false);

  if (!user) return <Auth onLogin={setUser} />;

  const { title, sub } = TITLES[page];

  const navigate = (id) => { setPage(id); setMenu(false); };

  return (
    <div className="shell">
      {/* Desktop sidebar */}
      <aside className={`sidebar${menuOpen ? " sidebar-open" : ""}`}>
        <div className="sidebar-brand">
          <img src="/logo.png" alt="BimaBima" className="sidebar-logo" />
          <div className="sidebar-name">BimaBima</div>
          <div className="sidebar-tag">Smarter Underwriting. Stronger Tomorrow.</div>
        </div>
        <nav className="sidebar-nav">
          {NAV.map((n) => (
            <button key={n.id} className={`nav-btn${page === n.id ? " active" : ""}`}
              onClick={() => navigate(n.id)}>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          Signed in as <strong style={{color:"rgba(255,255,255,0.7)"}}>{user.name}</strong><br />
          Nzoia Basin, Kenya<br />
          <button onClick={() => setUser(null)}
            style={{marginTop:8,background:"rgba(255,255,255,0.1)",border:"none",color:"rgba(255,255,255,0.6)",borderRadius:6,padding:"4px 10px",fontSize:10,cursor:"pointer"}}>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {menuOpen && <div className="sidebar-overlay" onClick={() => setMenu(false)} />}

      <div className="main">
        <header className="topbar">
          {/* Hamburger — mobile only */}
          <button className="hamburger" onClick={() => setMenu(!menuOpen)} aria-label="Menu">
            <span /><span /><span />
          </button>
          <div style={{flex:1}}>
            <div className="topbar-title">{title}</div>
            <div className="topbar-sub">{sub}</div>
          </div>
        </header>

        <div className="page">
          {page === "agent"     && <DocAgent />}
          {page === "assessor"  && <Assessor />}
          {page === "overview"  && <Overview />}
          {page === "ep"        && <EpCurvePage />}
          {page === "portfolio" && <Portfolio />}
          {page === "anomalies" && <Anomalies />}
        </div>

        {/* Bottom nav — mobile only */}
        <nav className="bottom-nav">
          {NAV.map((n) => (
            <button key={n.id} className={`bottom-nav-btn${page === n.id ? " active" : ""}`}
              onClick={() => navigate(n.id)}>
              <span className="bottom-nav-icon">{NAV_ICONS[n.id]}</span>
              <span className="bottom-nav-label">{n.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
