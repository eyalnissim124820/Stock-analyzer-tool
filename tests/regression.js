// ─────────────────────────────────────────────────────────────
// tests/regression.js — zero-regression guard for /api/analyze + /api/strategy.
//
//   node tests/regression.js baseline   # snapshot current handler outputs
//   node tests/regression.js check      # re-run and diff against the snapshot
//
// Scenarios cover US + existing TLV symbol usage across timeframes and both
// techniques. Outputs must be byte-identical before/after the Israeli-lookup
// addition: for these inputs the new layer must never engage.
// ─────────────────────────────────────────────────────────────
const fs = require("fs");
const path = require("path");
const { installFetchStub, runHandler } = require("./_mock.js");

const SNAP = path.join(__dirname, "baseline.json");

const SCENARIOS = [
  { api: "analyze", q: { ticker: "AAPL", market: "US", timeframe: "Weekly", swingN: "2" } },
  { api: "analyze", q: { ticker: "NVDA", timeframe: "Monthly", swingN: "4" } },
  { api: "analyze", q: { ticker: "TEVA.TA", market: "TLV", timeframe: "Daily", swingN: "3", lang: "he" } },
  { api: "analyze", q: { ticker: "POLI", market: "TLV", timeframe: "Weekly", swingN: "2" } },
  { api: "analyze", q: {} }, // missing ticker → 400
  { api: "strategy", q: { ticker: "AAPL", market: "US", technique: "1", swingN: "2" } },
  { api: "strategy", q: { ticker: "MSFT", market: "US", technique: "2", timeframe: "Daily" } },
  { api: "strategy", q: { ticker: "TEVA", market: "TLV", technique: "2", timeframe: "Weekly", lang: "he" } },
  { api: "strategy", q: { ticker: "LUMI.TA", market: "TLV", technique: "1" } },
  { api: "chart", q: { ticker: "AAPL", market: "US", range: "1Y" } },
  { api: "chart", q: { ticker: "TEVA.TA", market: "TLV", range: "6M", zigzagMode: "lookback", sensitivity: "7" } },
  { api: "chart", q: {} }, // missing ticker → 400
];

async function collect() {
  installFetchStub();
  const handlers = {
    analyze: require("../api/analyze.js"),
    strategy: require("../api/strategy.js"),
    chart: require("../api/chart.js"),
  };
  const out = [];
  for (const s of SCENARIOS) {
    const res = await runHandler(handlers[s.api], { ...s.q });
    out.push({ scenario: s, status: res.statusCode, body: res.body });
  }
  return JSON.stringify(out, null, 1);
}

(async () => {
  const mode = process.argv[2] || "check";
  const now = await collect();
  if (mode === "baseline") {
    fs.writeFileSync(SNAP, now);
    console.log(`baseline written: ${SNAP} (${SCENARIOS.length} scenarios)`);
    return;
  }
  const before = fs.readFileSync(SNAP, "utf8");
  if (before === now) {
    console.log(`REGRESSION CHECK PASS — ${SCENARIOS.length} scenarios byte-identical`);
  } else {
    const a = before.split("\n"), b = now.split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) { console.error(`first diff at line ${i + 1}:\n- ${a[i]}\n+ ${b[i]}`); break; }
    }
    console.error("REGRESSION CHECK FAIL");
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
