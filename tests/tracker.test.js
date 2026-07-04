// ─────────────────────────────────────────────────────────────
// tests/tracker.test.js — Monthly Tracker method tests.
//   node tests/tracker.test.js
//
// Unit-tests the pure api/_tracker.js against hand-crafted monthly candles
// (each of the seven checks broken in isolation), plus offline end-to-end
// runs of the /api/tracker handler with the mocked Yahoo layer.
// ─────────────────────────────────────────────────────────────
const assert = require("assert");
const { installFetchStub, runHandler } = require("./_mock.js");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failures.push({ name, e }); console.error(`FAIL  ${name}\n      ${e.message}`); }
}

// ── synthetic data builders ─────────────────────────────────
// Rising sawtooth monthly series: trends up ~1.2/bar with a 6-bar wave so
// findPivotsClose(n=2) sees rising peaks AND rising troughs. The last two
// candles are then overwritten by each test to hit/miss the alert checks.
function monthlyFixture(bars = 40) {
  const wave = [0, 2, 4, 6, 3, 1];
  const open = [], high = [], low = [], close = [], volume = [], dates = [];
  for (let i = 0; i < bars; i++) {
    const c = 50 + i * 1.2 + wave[i % 6];
    const o = c - 0.5;
    open.push(o); close.push(c);
    high.push(Math.max(o, c) + 0.8); low.push(Math.min(o, c) - 0.8);
    volume.push(1e6);
    // months counting back from 2026-06 (closed relative to the fixed `now`)
    const m = new Date(Date.UTC(2026, 5 - (bars - 1 - i), 1));
    dates.push(m.toISOString().slice(0, 10));
  }
  return { candles: { open, high, low, close, volume }, dates };
}

// Overwrite the last two candles with an ideal alert pattern: last candle
// green, whole candle above MA5, close above the previous high and in the
// top third of its own range.
function plantAlert(c) {
  const L = c.close.length - 1;
  const P = c.close[L - 1]; // keep the trend anchor
  c.open[L - 1] = P - 1; c.close[L - 1] = P; c.high[L - 1] = P + 1; c.low[L - 1] = P - 2;
  c.open[L] = P + 2; c.close[L] = P + 8; c.high[L] = P + 9; c.low[L] = P + 1.5;
}

function dailyFixture(volumePerDay, bars = 60) {
  const open = [], high = [], low = [], close = [], volume = [];
  for (let i = 0; i < bars; i++) {
    open.push(100); high.push(101); low.push(99); close.push(100.5);
    volume.push(volumePerDay);
  }
  return { open, high, low, close, volume };
}

const NOW = new Date("2026-07-04T12:00:00Z"); // June 2026 candle is closed

function run({ monthly, daily, now = NOW }) {
  const { evaluate } = require("../api/_tracker.js");
  return evaluate({ monthly: monthly.candles, monthlyDates: monthly.dates, daily, lang: "en", now });
}

(async () => {
  installFetchStub(); // charts synthetic, everything else 404s

  const { evaluate, concludeTracker, lastClosedIndex } = require("../api/_tracker.js");
  const tracker = require("../api/tracker.js");

  // ── the ideal case: all seven pass ──
  await test("all seven checks pass → TRACK", () => {
    const mo = monthlyFixture(); plantAlert(mo.candles);
    const r = run({ monthly: mo, daily: dailyFixture(2_000_000) });
    for (const id of ["N1", "N2", "N3", "N4", "N5", "N6", "N7"])
      assert.strictEqual(r.checks[id].value, "yes", `${id} should pass: ${r.checks[id].why}`);
    assert.strictEqual(r.conclusion.code, "TRACK");
    assert.strictEqual(r.meta.volumeTier, "strict");
    assert.strictEqual(r.meta.droppedForming, false);
  });

  // ── N1 liquidity tiers ──
  await test("volume between 800K and 1M passes on the lenient bar", () => {
    const mo = monthlyFixture(); plantAlert(mo.candles);
    const r = run({ monthly: mo, daily: dailyFixture(900_000) });
    assert.strictEqual(r.checks.N1.value, "yes");
    assert.strictEqual(r.meta.volumeTier, "lenient");
    assert.strictEqual(r.conclusion.code, "TRACK");
  });
  await test("volume below 800K fails the gate → NO_TRACK", () => {
    const mo = monthlyFixture(); plantAlert(mo.candles);
    const r = run({ monthly: mo, daily: dailyFixture(500_000) });
    assert.strictEqual(r.checks.N1.value, "no");
    assert.strictEqual(r.conclusion.code, "NO_TRACK");
  });
  await test("no daily data → N1 unanswered → INCOMPLETE", () => {
    const mo = monthlyFixture(); plantAlert(mo.candles);
    const r = run({ monthly: mo, daily: null });
    assert.strictEqual(r.checks.N1.value, null);
    assert.strictEqual(r.conclusion.code, "INCOMPLETE");
  });

  // ── N2 structure ──
  await test("falling monthly chart fails the rising sequence → NO_TRACK", () => {
    const mo = monthlyFixture();
    mo.candles.close = mo.candles.close.slice().reverse();
    mo.candles.open = mo.candles.close.map((c) => c + 0.5);
    mo.candles.high = mo.candles.close.map((c, i) => Math.max(c, mo.candles.open[i]) + 0.8);
    mo.candles.low = mo.candles.close.map((c, i) => Math.min(c, mo.candles.open[i]) - 0.8);
    const r = run({ monthly: mo, daily: dailyFixture(2_000_000) });
    assert.strictEqual(r.checks.N2.value, "no");
    assert.strictEqual(r.conclusion.code, "NO_TRACK");
  });

  // ── N3/N4 trend checks broken in isolation ──
  await test("lower tail under MA5 fails N3 → NO_TRACK", () => {
    const mo = monthlyFixture(); plantAlert(mo.candles);
    mo.candles.low[mo.candles.low.length - 1] -= 40; // tail dives below MA5
    const r = run({ monthly: mo, daily: dailyFixture(2_000_000) });
    assert.strictEqual(r.checks.N3.value, "no");
    assert.strictEqual(r.conclusion.code, "NO_TRACK");
  });

  // ── N5–N7: alert-candle checks broken → WAIT (trend intact) ──
  await test("red last candle fails N5 → WAIT", () => {
    const mo = monthlyFixture(); plantAlert(mo.candles);
    const L = mo.candles.close.length - 1;
    const { open, close } = mo.candles;
    [open[L], close[L]] = [close[L], open[L]]; // swap → red, same range
    const r = run({ monthly: mo, daily: dailyFixture(2_000_000) });
    assert.strictEqual(r.checks.N5.value, "no");
    assert.strictEqual(r.conclusion.code, "WAIT");
  });
  await test("close under the previous high fails N6 → WAIT", () => {
    const mo = monthlyFixture(); plantAlert(mo.candles);
    const L = mo.candles.close.length - 1;
    mo.candles.high[L - 1] = mo.candles.close[L] + 1; // previous high above the close
    const r = run({ monthly: mo, daily: dailyFixture(2_000_000) });
    assert.strictEqual(r.checks.N6.value, "no");
    assert.strictEqual(r.conclusion.code, "WAIT");
  });
  await test("close below the top third fails N7 → WAIT", () => {
    const mo = monthlyFixture(); plantAlert(mo.candles);
    const L = mo.candles.close.length - 1;
    mo.candles.high[L] = mo.candles.close[L] + 20; // huge upper tail → close far from high
    const r = run({ monthly: mo, daily: dailyFixture(2_000_000) });
    assert.strictEqual(r.checks.N7.value, "no");
    assert.strictEqual(r.conclusion.code, "WAIT");
  });
  await test("close exactly on the top-third line still passes N7", () => {
    const mo = monthlyFixture(); plantAlert(mo.candles);
    const L = mo.candles.close.length - 1;
    const { high, low } = mo.candles;
    mo.candles.close[L] = high[L] - (high[L] - low[L]) / 3;
    const r = run({ monthly: mo, daily: dailyFixture(2_000_000) });
    assert.strictEqual(r.checks.N7.value, "yes");
  });

  // ── forming-candle exclusion ──
  await test("a bar in the current month is excluded from the checks", () => {
    const mo = monthlyFixture();
    // append a forming July-2026 candle that would fail everything
    mo.candles.open.push(1); mo.candles.close.push(0.5);
    mo.candles.high.push(2); mo.candles.low.push(0.1); mo.candles.volume.push(1e6);
    mo.dates.push("2026-07-01");
    plantAlert(mo.candles) /* plants on the last two = forming + June */;
    // re-plant correctly on the CLOSED pair (indexes L-2, L-1)
    const c = mo.candles, L = c.close.length - 1;
    const P = 50 + (L - 2) * 1.2;
    c.open[L - 2] = P - 1; c.close[L - 2] = P; c.high[L - 2] = P + 1; c.low[L - 2] = P - 2;
    c.open[L - 1] = P + 2; c.close[L - 1] = P + 8; c.high[L - 1] = P + 9; c.low[L - 1] = P + 1.5;
    const r = run({ monthly: mo, daily: dailyFixture(2_000_000) });
    assert.strictEqual(r.meta.droppedForming, true);
    assert.strictEqual(r.meta.evalDate, "2026-06-01");
    assert.strictEqual(r.conclusion.code, "TRACK"); // forming red candle ignored
  });
  await test("lastClosedIndex keeps the newest bar when its month is over", () => {
    assert.deepStrictEqual(lastClosedIndex(["2026-05-01", "2026-06-01"], NOW), { idx: 1, droppedForming: false });
    assert.deepStrictEqual(lastClosedIndex(["2026-06-01", "2026-07-01"], NOW), { idx: 0, droppedForming: true });
  });

  // ── override-aware resolver contract ──
  await test("concludeTracker mirrors the verdict table", () => {
    const mk = (vals) => Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, { value: v }]));
    const all = { N1: "yes", N2: "yes", N3: "yes", N4: "yes", N5: "yes", N6: "yes", N7: "yes" };
    assert.strictEqual(concludeTracker(mk(all)).code, "TRACK");
    assert.strictEqual(concludeTracker(mk({ ...all, N6: "no" })).code, "WAIT");
    assert.strictEqual(concludeTracker(mk({ ...all, N2: "no" })).code, "NO_TRACK");
    assert.strictEqual(concludeTracker(mk({ ...all, N4: null })).code, "INCOMPLETE");
  });

  // ── /api/tracker end-to-end (mocked Yahoo) ──
  await test("handler returns the full payload for a US ticker", async () => {
    const res = await runHandler(tracker, { ticker: "AAPL", market: "US", lang: "en" });
    assert.strictEqual(res.statusCode, 200);
    const b = res.body;
    assert.strictEqual(b.ticker, "AAPL");
    assert.strictEqual(b.timeframe, "Monthly");
    for (const id of ["N1", "N2", "N3", "N4", "N5", "N6", "N7"]) assert.ok(b.checks[id], `missing check ${id}`);
    assert.ok(["TRACK", "WAIT", "NO_TRACK", "INCOMPLETE"].includes(b.conclusion.code));
    assert.ok(Array.isArray(b.series.ma5));
    assert.ok(b.candles && b.dates && b.dates.length === b.candles.close.length);
    assert.ok(b.meta.avgDailyVolume > 0); // fixture volumes are ≥1M
  });
  await test("handler resolves TASE security numbers like the other tools", async () => {
    const res = await runHandler(tracker, { ticker: "629014", market: "TLV", lang: "he" });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ticker, "TEVA.TA");
  });
  await test("handler rejects a missing ticker", async () => {
    const res = await runHandler(tracker, {});
    assert.strictEqual(res.statusCode, 400);
  });

  console.log(failures.length ? `\n${passed} passed, ${failures.length} FAILED` : `\nAll ${passed} tracker tests passed.`);
  process.exit(failures.length ? 1 : 0);
})();
