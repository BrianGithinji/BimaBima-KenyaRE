const { execSync } = require("child_process");
try {
  const out = execSync("node index.js", { cwd: __dirname, timeout: 5000 });
  console.log(out.toString());
} catch (e) {
  console.error(e.stderr?.toString() || e.message);
}
