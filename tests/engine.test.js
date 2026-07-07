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
const { analyze, conclude } = require("../api/_engine.js");

let pass = 0;
const ok = (name) => { pass++; console.log(`  ok — ${name}`); };

// ---- candle builders -------------------------------------------------------
function pushCandle(a, o, c, vol) {
  const hi = Math.max(o, c) + 0.3, lo = Math.min(o, c) - 0.3;
  a.open.push(o); a.close.push(c); a.high.push(hi); a.low.push(lo); a.volume.push(vol);
}

// Textbook BUY: seed → long clean uptrend (rising peaks+troughs, high volume)
// → a real correction (below a falling red 5-SMA, CCI washes below −100, price
// drops entirely below the peak candle's low) → a single turn-up green candle
// that breaks the falling sequence back up.
function textbookBuy() {
  const a = { open: [], high: [], low: [], close: [], volume: [] };
  let p = 20;
  for (let i = 0; i < 15; i++) { pushCandle(a, p, p + (i % 2 ? 0.1 : -0.1), 1_500_000); p = a.close[a.close.length - 1]; }
  for (let i = 0; i < 30; i++) { pushCandle(a, p, p + 1.2, 2_500_000); p = a.close[a.close.length - 1]; }
  for (let i = 0; i < 14; i++) { pushCandle(a, p, p - 0.9, 900_000); p = a.close[a.close.length - 1]; }
  pushCandle(a, p, p + 1.4, 1_800_000); // turn-up
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
  // Even though Q4 is a "no" guess on the textbook setup, the verdict is still
  // a buy — the guess-tier check must be advisory, not a hard gate.
  const r = analyze(textbookBuy(), {});
  const c = conclude(r);
  assert.strictEqual(r.checks.Q4.value, "no", "sanity: Q4 guess is 'no' here");
  assert.strictEqual(c.q4Advisory, "no", "Q4 surfaced as advisory");
  assert.ok(c.allPass, "allPass true despite Q4 'no' (Q4 non-blocking)");
  ok("Q4 'no' does not block an otherwise-valid buy");
})();

(function badSetupRejected() {
  const r = analyze(riseThenDecline(), {});
  const c = conclude(r);
  assert.strictEqual(c.code, "DO_NOT_ENTER", `bad setup should be DO_NOT_ENTER, got ${c.code}`);
  ok("declining structure returns DO_NOT_ENTER");
})();

console.log(`\nengine.test.js — ${pass} checks passed`);
