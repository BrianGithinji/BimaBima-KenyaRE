const http    = require("http");
const path    = require("path");

// Patch require so index.js loads from its own directory
process.chdir(path.join(__dirname, "dashboard", "server"));
require("./dashboard/server/index.js");

setTimeout(() => {
  const body = JSON.stringify({
    lat: 0.6234, lon: 33.9700,
    housing_class: "concrete_rcc",
    floor_area_m2: 3570,
    cost_per_m2_kes: 65000,
  });
  const req = http.request({
    hostname: "localhost", port: 5000, path: "/api/assess",
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
  }, (res) => {
    let data = "";
    res.on("data", (c) => data += c);
    res.on("end", () => {
      const j = JSON.parse(data);
      console.log("risk_tier:", j.risk_tier);
      console.log("damage_ratio_rp100:", j.damage_ratio_rp100);
      console.log("aal:", j.aal);
      console.log("suggested_premium:", j.suggested_premium);
      j.losses.forEach((l) => console.log(`  RP${l.return_period}: depth=${l.depth_m}m  DR=${(l.damage_ratio*100).toFixed(1)}%  net=${(l.net_loss_kes/1e6).toFixed(2)}M`));
      process.exit(0);
    });
  });
  req.on("error", (e) => { console.error("Request failed:", e.message); process.exit(1); });
  req.write(body);
  req.end();
}, 3000);
