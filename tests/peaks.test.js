// ─────────────────────────────────────────────────────────────
// tests/peaks.test.js — Peaks & Troughs engine + /api/chart tests.
//   node tests/peaks.test.js
//
// Pure-math tests run on hand-built deterministic price paths (flat bars:
// open=high=low=close), so every expectation is exact. The endpoint tests
// reuse the offline fetch stub from _mock.js.
// ─────────────────────────────────────────────────────────────
const assert = require("assert");
const { installFetchStub, runHandler, yahooChartFixture } = require("./_mock.js");
const {
  atrSeries, zigzag, zigzagPercent, zigzagLookback, zigzagSequence,
  classifySwings, trendVerdict, srLevels, fibLevels, analyzePeaks,
} = require("../api/_peaks.js");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failures.push({ name, e }); console.error(`FAIL  ${name}\n      ${e.message}`); }
}

// Piecewise-linear price path → flat candles (o=h=l=c), `per` bars per leg.
function line(path, per = 5) {
  const close = [];
  for (let k = 1; k < path.length; k++) {
    for (let j = 0; j < per; j++) {
      close.push(+(path[k - 1] + ((path[k] - path[k - 1]) * (j + 1)) / per).toFixed(4));
    }
  }
  close.unshift(path[0]);
  return { open: [...close], high: [...close], low: [...close], close, volume: close.map(() => 1e6) };
}
const kinds = (pts) => pts.map((p) => p.kind).join("");
const labels = (pts) => pts.map((p) => p.label).join(",");
const alternates = (pts) => pts.every((p, i) => i === 0 || p.kind !== pts[i - 1].kind);

(async () => {
  const PCT = { mode: "percent", reversalPct: 2, atrMult: 0 }; // deterministic threshold

  // ── zigzag: percent mode ──
  await test("staircase uptrend → alternating L/H with HH/HL labels", () => {
    const c = line([100, 110, 105, 118, 112, 126, 120, 134]);
    const pts = classifySwings(zigzagPercent(c, PCT));
    assert.ok(alternates(pts), `must alternate, got ${kinds(pts)}`);
    assert.strictEqual(kinds(pts), "LHLHLHLH");
    assert.strictEqual(labels(pts), "L,H,HL,HH,HL,HH,HL,HH");
    assert.strictEqual(pts[pts.length - 1].provisional, true); // final 134 never confirmed
    assert.strictEqual(pts[3].price, 118);
  });

  await test("mirrored downtrend → LH/LL labels + downtrend verdict", () => {
    const c = line([134, 120, 126, 112, 118, 105, 110, 100]);
    const pts = classifySwings(zigzagPercent(c, PCT));
    assert.strictEqual(kinds(pts), "HLHLHLHL");
    assert.strictEqual(labels(pts), "H,L,LH,LL,LH,LL,LH,LL");
    assert.strictEqual(trendVerdict(pts).trend, "downtrend");
  });

  await test("uptrend staircase → uptrend verdict with full confidence", () => {
    const c = line([100, 110, 105, 118, 112, 126, 120, 134]);
    const v = trendVerdict(classifySwings(zigzagPercent(c, PCT)));
    assert.strictEqual(v.trend, "uptrend");
    assert.strictEqual(v.confidence, 1);
    assert.ok(v.reasons.length >= 2);
  });

  await test("flat oscillation → range verdict", () => {
    const c = line([100, 110, 100, 110, 100, 110, 100]);
    const v = trendVerdict(classifySwings(zigzagPercent(c, PCT)));
    assert.strictEqual(v.trend, "range");
  });

  // ── zigzag: lookback mode ──
  await test("lookback mode alternates and finds the same staircase turns", () => {
    const c = line([100, 110, 105, 118, 112, 126, 120, 134]);
    const pts = zigzagLookback(c, { lookback: 2 });
    assert.ok(alternates(pts), `must alternate, got ${kinds(pts)}`);
    const prices = pts.map((p) => p.price);
    for (const turn of [110, 105, 118, 112, 126, 120]) {
      assert.ok(prices.includes(turn), `missing turn ${turn} in ${prices}`);
    }
  });

  await test("zigzag() dispatches by mode", () => {
    const c = line([100, 110, 100, 112]);
    assert.deepStrictEqual(zigzag(c, PCT), zigzagPercent(c, PCT));
    assert.deepStrictEqual(zigzag(c, { mode: "lookback", lookback: 2 }), zigzagLookback(c, { lookback: 2 }));
    assert.deepStrictEqual(zigzag(c, { mode: "sequence" }), zigzagSequence(c));
  });

  // ── zigzag: sequence mode (the course method) ──
  await test("sequence mode: peak confirmed on rising-sequence break, at the run's highest bar", () => {
    // Rising run tops at bar 3 (high 13.2, low 12.8); bar 4 dips but closes
    // above bar 3's low (sequence intact); bar 5 closes below it → break.
    const c = {
      open:  [9.9, 10.9, 11.9, 12.9, 12.95, 11.4],
      high:  [10.2, 11.2, 12.2, 13.2, 13.0, 11.2],
      low:   [9.8, 10.8, 11.8, 12.8, 12.6, 10.8],
      close: [10, 11, 12, 13, 12.9, 11],
      volume: Array(6).fill(1e6),
    };
    const pts = zigzagSequence(c);
    const confirmed = pts.filter((p) => !p.provisional);
    assert.strictEqual(confirmed.length, 1, `expected 1 confirmed point, got ${kinds(confirmed)}`);
    assert.deepStrictEqual(confirmed[0], { i: 3, price: 13.2, kind: "H", breakIdx: 5 });
    // The running falling sequence's low is provisional, and points alternate.
    const last = pts[pts.length - 1];
    assert.strictEqual(last.kind, "L");
    assert.strictEqual(last.provisional, true);
    assert.ok(alternates(pts), `must alternate, got ${kinds(pts)}`);
  });

  await test("sequence mode flows through analyzePeaks with parameter-free params", () => {
    const c = line([100, 110, 105, 118, 112, 126, 120, 134]);
    const a = analyzePeaks(c, { mode: "sequence" });
    assert.strictEqual(a.params.mode, "sequence");
    assert.ok(alternates(a.points), `must alternate, got ${kinds(a.points)}`);
    assert.ok(a.points.filter((p) => !p.provisional).length >= 4, "staircase should confirm several points");
    assert.strictEqual(trendVerdict(a.points).trend, "uptrend");
  });

  await test("sequence mode confirms a break the previous-bar gate used to miss", () => {
    // Regression for the drift between zigzagSequence and _engine.sequenceStructure.
    // Rising run peaks at bar 2 (high 13.0, low 12.0). Bar 3 pulls back, printing a
    // lower LOW (11.0) but closing (12.2) above the peak's low — sequence intact.
    // Bar 4 closes 11.5: BELOW the peak candle's low (12.0) → the rising sequence
    // breaks and bar 2 is a confirmed swing high. The old detector gated the break
    // on the PREVIOUS bar's low (close 11.5 > low[3] 11.0), so it stayed "rising"
    // and never confirmed the peak. Wicks matter here (high ≠ low), which is why the
    // flat-candle tests above never caught this.
    const c = {
      open:  [10,   11,   12,   12.0, 11.0],
      high:  [10.5, 11.5, 13.0, 12.5, 11.8],
      low:   [9.5,  10.5, 12.0, 11.0, 10.5],
      close: [10,   11,   12.8, 12.2, 11.5],
      volume: Array(5).fill(1e6),
    };
    const pts = zigzagSequence(c);
    const confirmed = pts.filter((p) => !p.provisional);
    assert.strictEqual(confirmed.length, 1, `expected the peak to confirm, got ${kinds(confirmed)}`);
    assert.deepStrictEqual(confirmed[0], { i: 2, price: 13.0, kind: "H", breakIdx: 4 });
    const last = pts[pts.length - 1];
    assert.strictEqual(last.kind, "L");
    assert.strictEqual(last.provisional, true);
    assert.ok(alternates(pts), `must alternate, got ${kinds(pts)}`);
  });

  // ── sensitivity monotonicity ──
  await test("higher percent threshold never yields more swing points", () => {
    const fx = yahooChartFixture("TEST", "1d", 200).chart.result[0];
    const q = fx.indicators.quote[0];
    const c = { open: q.open, high: q.high, low: q.low, close: q.close, volume: q.volume };
    let prev = Infinity;
    for (const pct of [0.8, 1.5, 3, 6, 9]) {
      const n = zigzagPercent(c, { reversalPct: pct, atrMult: 0 }).length;
      assert.ok(n <= prev, `pct ${pct} produced ${n} > ${prev}`);
      prev = n;
    }
  });

  // ── support / resistance ──
  await test("flat oscillation → two levels with 3+ touches each", () => {
    const c = line([100, 110, 100, 110, 100, 110, 100]);
    const pts = zigzagPercent(c, PCT);
    const lv = srLevels(pts, c, { tolPct: 1 });
    assert.strictEqual(lv.length, 2);
    const bot = lv.find((l) => Math.abs(l.price - 100) < 1);
    const top = lv.find((l) => Math.abs(l.price - 110) < 1);
    assert.ok(bot.touches >= 3, `bottom touches ${bot.touches}`);
    assert.ok(top.touches >= 3, `top touches ${top.touches}`);
    assert.strictEqual(bot.kind, "support");     // last close 100 sits on it
    assert.strictEqual(top.kind, "resistance");  // price below it now
  });

  await test("double top → resistance with exactly 2 touches", () => {
    const c = line([100, 150, 125, 150, 130]);
    const lv = srLevels(zigzagPercent(c, PCT), c, { tolPct: 1 });
    const top = lv.find((l) => Math.abs(l.price - 150) < 2);
    assert.ok(top, "no cluster near 150");
    assert.strictEqual(top.touches, 2);
    assert.strictEqual(top.kind, "resistance");
  });

  await test("flip zone: broken resistance retested as support", () => {
    // Peaks at 120 twice, then breakout and a trough back at 120.
    const c = line([100, 120, 105, 120, 108, 140, 120, 145]);
    const lv = srLevels(zigzagPercent(c, PCT), c, { tolPct: 1 });
    const flip = lv.find((l) => Math.abs(l.price - 120) < 2);
    assert.ok(flip, "no cluster near 120");
    assert.strictEqual(flip.kind, "flip"); // touched by both H and L pivots
    assert.strictEqual(flip.touches, 3);
  });

  // ── Fibonacci ──
  await test("up-leg 100→150 retraced: 0.5 → 125, 0.618 → 119.1", () => {
    const c = line([100, 150, 125]);
    const fib = fibLevels(zigzagPercent(c, PCT));
    assert.strictEqual(fib.direction, "up");
    assert.strictEqual(fib.from.price, 100);
    assert.strictEqual(fib.to.price, 150);
    const at = (r) => fib.levels.find((l) => l.ratio === r).price;
    assert.strictEqual(at(0), 150);
    assert.strictEqual(at(0.5), 125);
    assert.ok(Math.abs(at(0.618) - 119.1) < 0.01, `0.618 → ${at(0.618)}`);
    assert.strictEqual(at(1), 100);
  });

  await test("down-leg fib measures the fall and retraces upward", () => {
    const c = line([150, 100, 120, 90, 112]);
    const fib = fibLevels(zigzagPercent(c, PCT));
    assert.strictEqual(fib.direction, "down");
    assert.ok(fib.to.price < fib.from.price);
    const at = (r) => fib.levels.find((l) => l.ratio === r).price;
    assert.ok(at(0.5) > at(0), "0.5 retracement must sit above the leg end");
  });

  await test("fib picks the LARGEST recent leg, not just the last", () => {
    const c = line([100, 160, 130, 138, 132]); // 60-pt rise dwarfs later wiggles
    const fib = fibLevels(zigzagPercent(c, PCT));
    assert.strictEqual(fib.from.price, 100);
    assert.strictEqual(fib.to.price, 160);
  });

  // ── ATR ──
  await test("ATR is null-padded then positive", () => {
    const c = line([100, 110, 104, 116], 10);
    const atr = atrSeries(c.high, c.low, c.close, 14);
    assert.strictEqual(atr[12], null);
    assert.ok(atr[13] > 0);
    assert.ok(atr[atr.length - 1] > 0);
  });

  // ── orchestrator ──
  await test("analyzePeaks bundles points/trend/srLevels/fib/params", () => {
    const c = line([100, 110, 105, 118, 112, 126, 120, 134]);
    const r = analyzePeaks(c, { mode: "percent", reversalPct: 2, atrMult: 0 });
    assert.ok(Array.isArray(r.points) && r.points.length >= 6);
    assert.ok(r.points.every((p) => p.label));
    assert.strictEqual(r.trend.trend, "uptrend");
    assert.ok(Array.isArray(r.srLevels));
    assert.ok(r.fib && r.fib.levels.length === 7);
    assert.strictEqual(r.params.mode, "percent");
  });

  // ── /api/chart endpoint (offline, stubbed fetch) ──
  installFetchStub();
  const chart = require("../api/chart.js");

  await test("GET /api/chart 200 with candles, series, peaks", async () => {
    const res = await runHandler(chart, { ticker: "AAPL", market: "US", range: "1Y" });
    assert.strictEqual(res.statusCode, 200);
    const b = res.body;
    assert.strictEqual(b.ticker, "AAPL");
    assert.strictEqual(b.range, "1Y");
    assert.strictEqual(b.interval, "1d");
    const n = b.candles.close.length;
    assert.strictEqual(b.dates.length, n);
    assert.strictEqual(b.series.rsi.length, n);
    assert.strictEqual(b.series.macd.macd.length, n);
    assert.strictEqual(b.series.boll.upper.length, n);
    assert.strictEqual(b.series.sma["200"].length, n);
    assert.strictEqual(b.series.ema["21"].length, n);
    assert.ok(alternates(b.peaks.points), "peaks must alternate");
    assert.ok(["uptrend", "downtrend", "range"].includes(b.peaks.trend.trend));
  });

  await test("lookback mode + sensitivity flow through to params", async () => {
    const res = await runHandler(chart, { ticker: "TEVA.TA", market: "TLV", range: "6M", zigzagMode: "lookback", sensitivity: "8" });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.params.zigzagMode, "lookback");
    assert.strictEqual(res.body.params.sensitivity, 8);
    assert.strictEqual(res.body.peaks.params.mode, "lookback");
    assert.strictEqual(res.body.ticker, "TEVA.TA");
  });

  await test("missing ticker → 400", async () => {
    const res = await runHandler(chart, {});
    assert.strictEqual(res.statusCode, 400);
    assert.ok(res.body.error);
  });

  await test("weekly interval used for 2Y range", async () => {
    const res = await runHandler(chart, { ticker: "MSFT", range: "2Y" });
    assert.strictEqual(res.body.interval, "1wk");
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
