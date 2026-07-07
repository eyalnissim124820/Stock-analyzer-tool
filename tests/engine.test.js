// ─────────────────────────────────────────────────────────────
// tests/engine.test.js — verdict-logic tests for api/_engine.js.
//
//   node tests/engine.test.js
//
// Guards the three "reference point" fixes (Q3 trend point, Q7 anchor,
// Q4 non-blocking) with synthetic candles built to the method's intent:
//   1. A textbook-perfect setup (clean uptrend → healthy pullback with a CCI
//      washout below a falling red line → turn-up) must now return BUY.
//   2. A genuinely bad setup (brief rise then a dominant decline) must still
//      return DO_NOT_ENTER — the fixes must not turn everything into a buy.
// These are pure-function tests; no network, no fixtures.
// ─────────────────────────────────────────────────────────────
const assert = require("assert");
const { analyze, conclude, sequenceStructure, sequenceSellS1 } = require("../api/_engine.js");
const analyzeHandler = require("../api/analyze.js");

let pass = 0;
const ok = (name) => { pass++; console.log(`  ok — ${name}`); };

// ---- candle builders -------------------------------------------------------
function pushCandle(a, o, c, vol) {
  const hi = Math.max(o, c) + 0.3, lo = Math.min(o, c) - 0.3;
  a.open.push(o); a.close.push(c); a.high.push(hi); a.low.push(lo); a.volume.push(vol);
}

// Textbook BUY (multi-leg, per the sequence method): a rising staircase with
// TWO higher troughs and rising peaks (T0 < T1, P1 < P2) — the prior uptrend
// (Phase A) → a real correction (Phase B) that closes below a falling red 5-SMA,
// washes CCI below −100, and drops a candle entirely below the LAUNCH TROUGH of
// the most recent rising sequence (T1) → a strong turn-up that breaks the
// falling sequence back up (Phase C). Phase-A checks (Q1/P5) read the uptrend
// troughs; Q7 reads the correction's undercut — different stretches, no conflict.
function textbookBuy() {
  const a = { open: [], high: [], low: [], close: [], volume: [] };
  let p = 20;
  for (let i = 0; i < 8; i++)  { pushCandle(a, p, p + 1.0, 2_000_000); p = a.close[a.close.length - 1]; } // rise0 → P0
  for (let i = 0; i < 4; i++)  { pushCandle(a, p, p - 1.4, 1_000_000); p = a.close[a.close.length - 1]; } // dip → T0
  for (let i = 0; i < 10; i++) { pushCandle(a, p, p + 1.2, 2_500_000); p = a.close[a.close.length - 1]; } // rise A → P1
  for (let i = 0; i < 4; i++)  { pushCandle(a, p, p - 1.4, 1_000_000); p = a.close[a.close.length - 1]; } // dip → T1 (> T0)
  for (let i = 0; i < 12; i++) { pushCandle(a, p, p + 1.3, 2_500_000); p = a.close[a.close.length - 1]; } // rise B → P2
  for (let i = 0; i < 14; i++) { pushCandle(a, p, p - 1.5, 900_000);   p = a.close[a.close.length - 1]; } // correction (undercuts T1)
  pushCandle(a, p, p + 2.4, 1_600_000); p = a.close[a.close.length - 1]; // strong turn-up 1
  pushCandle(a, p, p + 2.4, 1_800_000);                                  // strong turn-up 2 (breaks fall)
  return a;
}

// Bad setup: a brief early rise (so the verdict resolves — a highest high with
// a prior low exists) followed by a long, dominant decline. The last candle is
// red and the whole recent structure is falling: no valid uptrend to buy into.
// Nothing to buy.
function riseThenDecline() {
  const a = { open: [], high: [], low: [], close: [], volume: [] };
  let p = 100;
  for (let i = 0; i < 12; i++) { pushCandle(a, p, p + 1.0, 2_000_000); p = a.close[a.close.length - 1]; }
  for (let i = 0; i < 48; i++) { pushCandle(a, p, p - 1.0, 2_000_000); p = a.close[a.close.length - 1]; }
  return a;
}

// ---- tests -----------------------------------------------------------------
(function textbookBuyReturnsBuy() {
  const r = analyze(textbookBuy(), {});
  const c = conclude(r);
  // Deterministic Phase-A/B/C all satisfied on the intended stretches.
  assert.strictEqual(r.checks.Q3.value, "yes", "Q3 (trend at highest high) should pass");
  assert.strictEqual(r.checks.Q5.value, "yes", "Q5 (correction below falling red) should pass");
  assert.strictEqual(r.checks.Q6.value, "yes", "Q6 (CCI washout) should pass");
  assert.strictEqual(r.checks.Q7.value, "yes", "Q7 (lower low below peak candle) should pass");
  assert.ok(c.code === "BUY" || c.code === "BUY_LIMIT", `expected BUY/BUY_LIMIT, got ${c.code}`);
  ok(`textbook setup returns ${c.code}`);
})();

(function q4DoesNotHardFail() {
  // Q4 is a guess-tier check the README flags as needing visual confirmation, so
  // it must be advisory — never a hard gate. Force it to "no" on an otherwise
  // valid buy and confirm the verdict is unchanged.
  const r = analyze(textbookBuy(), {});
  r.checks.Q4 = { value: "no", conf: "guess", why: "forced 'no' for the test" };
  const c = conclude(r);
  assert.strictEqual(c.q4Advisory, "no", "Q4 surfaced as advisory");
  assert.ok(c.allPass, "allPass true despite Q4 'no' (Q4 non-blocking)");
  assert.ok(c.code === "BUY" || c.code === "BUY_LIMIT", `verdict still a buy, got ${c.code}`);
  ok("Q4 'no' does not block an otherwise-valid buy");
})();

(function badSetupRejected() {
  const r = analyze(riseThenDecline(), {});
  const c = conclude(r);
  assert.strictEqual(c.code, "DO_NOT_ENTER", `bad setup should be DO_NOT_ENTER, got ${c.code}`);
  ok("declining structure returns DO_NOT_ENTER");
})();

// ---- PART 1: sequence structure (course's exact definition) ----------------
// Build OHLC candles directly for full control over the walker.
function candles(rows) {
  const open = [], high = [], low = [], close = [], volume = [];
  for (const [o, h, l, c] of rows) { open.push(o); high.push(h); low.push(l); close.push(c); volume.push(1_500_000); }
  return { open, high, low, close, volume };
}

(function sequenceExactSwings() {
  // Rising → break (peak) → falling → break (trough) → rising. Hand-computed.
  //   idx: 0     1      2      3        4        5      6      7        8      9
  const c = candles([
    [10, 11, 9, 10.5],    // 0  first bar = initial running extreme
    [10.5, 12, 10, 11.5], // 1  rising; new high → running peak
    [11.5, 13, 11, 12.5], // 2  new high → running peak
    [12.5, 13.5, 12, 13], // 3  new high → running peak (high 13.5, low 12)
    [13, 13.2, 10, 10.5], // 4  close 10.5 < peak(3).low 12 → confirm PEAK@3; start falling
    [10.5, 11, 8, 9],     // 5  new low → running trough
    [9, 9.5, 7, 8.5],     // 6  new low → running trough (low 7, high 9.5)
    [8.5, 10, 8, 9.8],    // 7  close 9.8 > trough(6).high 9.5 → confirm TROUGH@6; start rising
    [9.8, 12, 9.5, 11.5], // 8  new high → running peak
    [11.5, 13, 11, 12.5], // 9  new high → running peak (in-progress, unconfirmed)
  ]);
  const s = sequenceStructure(c.open, c.high, c.low, c.close);
  assert.deepStrictEqual(
    s.highs.map((h) => ({ i: h.i, high: h.high, breakIdx: h.breakIdx })),
    [{ i: 3, high: 13.5, breakIdx: 4 }], "one confirmed swing high at idx 3");
  assert.deepStrictEqual(
    s.lows.map((l) => ({ i: l.i, low: l.low, breakIdx: l.breakIdx })),
    [{ i: 6, low: 7, breakIdx: 7 }], "one confirmed swing low at idx 6");
  assert.deepStrictEqual(s.current, { dir: 1, extremeIdx: 9 }, "in-progress rising, running peak at idx 9");
  ok("sequence walker matches hand-computed swing highs/lows and current run");
})();

(function boundaryCloseEqualsPeakLowDoesNotBreak() {
  // A candle whose CLOSE == the running peak's low must NOT break the sequence.
  const rows = [
    [10, 11, 9, 10.5],    // 0
    [10.5, 12, 10, 11.5], // 1  running peak
    [11.5, 13, 11, 12.5], // 2  running peak (low 11)
    [12.5, 12.8, 11, 11], // 3  close 11 == peak(2).low 11 → NO break (strict <)
    [11, 11.5, 10, 10.9], // 4  close 10.9 < 11 → NOW break, confirm PEAK@2
  ];
  const upToBoundary = candles(rows.slice(0, 4)); // through idx 3 only
  const s1 = sequenceStructure(upToBoundary.open, upToBoundary.high, upToBoundary.low, upToBoundary.close);
  assert.strictEqual(s1.highs.length, 0, "close == peak low does not confirm a peak");

  const withBreak = candles(rows); // through idx 4
  const s2 = sequenceStructure(withBreak.open, withBreak.high, withBreak.low, withBreak.close);
  assert.deepStrictEqual(
    s2.highs.map((h) => ({ i: h.i, breakIdx: h.breakIdx })),
    [{ i: 2, breakIdx: 4 }], "peak confirmed only on the strictly-below close at idx 4");
  ok("boundary: close == peak low continues the sequence; strict below breaks it");
})();

(function s1FiresOnExactBreakCandle() {
  const c = candles([
    [10, 11, 9, 10.5],    // 0
    [10.5, 12, 10, 11.5], // 1  running peak
    [11.5, 13, 11, 12.5], // 2  running peak
    [12.5, 13.5, 12, 13], // 3  running peak (low 12)
    [13, 13.2, 10, 11.5], // 4  close 11.5 < peak(3).low 12 → breaks the rising sequence
  ]);
  const atBreak = sequenceSellS1(c, 4);
  assert.strictEqual(atBreak.fired, true, "S1 fires on the candle that closes below the running peak's low");
  assert.strictEqual(atBreak.peakIdx, 3, "S1 reports the peak it broke");
  const beforeBreak = sequenceSellS1(c, 3);
  assert.strictEqual(beforeBreak.fired, false, "S1 does not fire before the break candle");
  ok("sell S1 fires on exactly the bar that ends the rising sequence");
})();

// ---- PART 2: entry candle = most recent CLOSED candle ----------------------
(function entryCandleDropsFormingBar() {
  const tz = "America/New_York";
  const day = (s) => Math.floor(Date.parse(s) / 1000);
  // Daily: last bar timestamped today; session close is 16:00 ET.
  const meta = { exchangeTimezoneName: tz, currentTradingPeriod: { regular: { end: day("2026-06-26T20:00:00Z") } } };
  const lastTs = day("2026-06-26T13:30:00Z"); // 09:30 ET, same session date
  // Intraday (before close) → the last daily bar is still forming.
  assert.strictEqual(
    analyzeHandler.isLastBarForming(meta, lastTs, "1d", day("2026-06-26T18:00:00Z")), true,
    "intraday daily bar is forming");
  // After the session close → the same bar is now final.
  assert.strictEqual(
    analyzeHandler.isLastBarForming(meta, lastTs, "1d", day("2026-06-26T20:30:00Z")), false,
    "after close, the daily bar is final");
  // Monthly: a bar in the current calendar month is forming; a prior-month bar is not.
  const monMeta = { exchangeTimezoneName: tz };
  assert.strictEqual(analyzeHandler.isLastBarForming(monMeta, day("2026-06-10T12:00:00Z"), "1mo", day("2026-06-26T12:00:00Z")), true, "current-month bar forming");
  assert.strictEqual(analyzeHandler.isLastBarForming(monMeta, day("2026-05-10T12:00:00Z"), "1mo", day("2026-06-26T12:00:00Z")), false, "prior-month bar final");

  // Integration: dropping the forming bar makes the analysis key off the prior
  // (closed) bar as the entry candle.
  const base = textbookBuy();
  const forming = { // append a still-forming red bar after the closed turn-up
    open: [...base.open, base.close[base.close.length - 1]],
    high: [...base.high, base.close[base.close.length - 1] + 0.2],
    low: [...base.low, base.close[base.close.length - 1] - 3],
    close: [...base.close, base.close[base.close.length - 1] - 2.5],
    volume: [...base.volume, 500_000],
  };
  const full = analyze(forming, {});   // analyzes the forming bar as entry (wrong)
  const dropped = analyze(base, {});    // entry = the closed turn-up (right)
  assert.notStrictEqual(full.math.buy, dropped.math.buy, "forming vs dropped pick different entry candles");
  assert.strictEqual(dropped.math.buy, base.close[base.close.length - 1], "entry candle is the last CLOSED bar");
  ok("entry-candle guard flags a forming bar (daily/monthly) and drops it");
})();

console.log(`\nengine.test.js — ${pass} checks passed`);
