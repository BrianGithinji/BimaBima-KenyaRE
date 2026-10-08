import { useState } from "react";

export default function Auth({ onLogin }) {
  const [tab, setTab]         = useState("login");
  const [form, setForm]       = useState({ name: "", email: "", password: "" });
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!form.email || !form.password) { setError("Please fill in all fields."); return; }
    if (tab === "register" && !form.name) { setError("Please enter your name."); return; }
    setLoading(true);
    // Simulate auth — replace with real API call if needed
    await new Promise((r) => setTimeout(r, 700));
    setLoading(false);
    onLogin({ name: form.name || form.email.split("@")[0], email: form.email });
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <img src="/logo.png" alt="BimaBima" className="auth-logo" />
          <div className="auth-brand-tag">Smarter Underwriting. Stronger Tomorrow.</div>
        </div>

        <div className="auth-tabs">
          <button className={`auth-tab${tab === "login" ? " active" : ""}`} onClick={() => { setTab("login"); setError(""); }}>Sign In</button>
          <button className={`auth-tab${tab === "register" ? " active" : ""}`} onClick={() => { setTab("register"); setError(""); }}>Register</button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {tab === "register" && (
            <div className="field">
              <label>Full Name</label>
              <input type="text" placeholder="Jane Doe" value={form.name} onChange={set("name")} />
            </div>
          )}
          <div className="field">
            <label>Email Address</label>
            <input type="email" placeholder="you@company.com" value={form.email} onChange={set("email")} />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" placeholder="••••••••" value={form.password} onChange={set("password")} />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button className="btn btn-primary auth-submit" type="submit" disabled={loading}>
            {loading ? "Please wait…" : tab === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <div className="auth-footer">
          Nzoia Basin Flood Risk Platform &mdash; Kenya Re
        </div>
      </div>
    </div>
  );
}
