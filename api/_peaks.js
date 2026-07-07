// ─────────────────────────────────────────────────────────────
// _peaks.js — reusable Peaks & Troughs (swing structure) engine.
//
// Pure math, no I/O. Generalizes the n-bar pivot idea in api/_engine.js
// (findPivots) into a full structure toolkit:
//   • zigzag()        — alternating swing highs/lows, three detection modes:
//       "sequence" : the course method — a peak appears when a rising sequence
//                    breaks, a trough when a falling sequence breaks (same
//                    definition as findSequencePoints in _engine.js).
//       "percent"  : classic reversal ZigZag — a swing turns only after price
//                    retraces max(reversalPct%, atrMult×ATR14) from the extreme.
//       "lookback" : n-bar pivots (same strict/non-strict rule as findPivots)
//                    with alternation enforced (same-kind runs collapse to the
//                    most extreme point).
//   • classifySwings() — HH / HL / LH / LL labels vs the previous same-kind swing.
//   • trendVerdict()   — uptrend / downtrend / range from the recent labels.
//   • srLevels()       — support/resistance by clustering swing prices.
//   • fibLevels()      — Fibonacci retracement of the dominant recent leg.
//   • analyzePeaks()   — one-call orchestrator; what /api/chart (and the
//                        analyzers) embed in their responses.
//
// Consumed by api/chart.js and api/analyze.js. _engine.js is left untouched.
// ─────────────────────────────────────────────────────────────

const { sequenceStructure } = require("./_engine.js");

// Wilder ATR, null-padded and index-aligned like the _engine.js series.
function atrSeries(highs, lows, closes, p = 14) {
  const n = closes.length;
  const out = Array(n).fill(null);
  if (n < 2) return out;
  const tr = Array(n).fill(0);
  tr[0] = highs[0] - lows[0];
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
  }
  if (n < p) return out;
  let sum = 0;
  for (let i = 0; i < p; i++) sum += tr[i];
  out[p - 1] = sum / p;
  for (let i = p; i < n; i++) out[i] = (out[i - 1] * (p - 1) + tr[i]) / p; // Wilder smoothing
  return out;
}

// ── percent-reversal ZigZag ──
// Confirms a swing high when price drops max(reversalPct%, atrMult×ATR) below
// the running extreme (mirror for lows). The still-unconfirmed final extreme
// is returned flagged `provisional: true` so the UI can draw it dashed.
function zigzagPercent(candles, { reversalPct = 3, atrMult = 0.5, atr = null } = {}) {
  const { high, low } = candles;
  const n = high.length;
  if (n < 3) return [];
  const a = atr || atrSeries(high, low, candles.close);
  const thr = (price, i) => {
    const byPct = price * (reversalPct / 100);
    const byAtr = a[i] != null ? atrMult * a[i] : 0;
    return Math.max(byPct, byAtr);
  };

  const pts = [];
  let dir = 0; // 0 unknown, 1 seeking higher highs, -1 seeking lower lows
  let hiP = high[0], hiI = 0, loP = low[0], loI = 0;

  for (let i = 1; i < n; i++) {
    if (dir >= 0 && high[i] >= hiP) { hiP = high[i]; hiI = i; }
    if (dir <= 0 && low[i] <= loP) { loP = low[i]; loI = i; }

    if (dir === 0) {
      // First leg: whichever side breaks its threshold first sets direction,
      // and the opposite running extreme becomes the first confirmed swing.
      if (high[i] >= loP + thr(loP, i)) {
        pts.push({ i: loI, price: loP, kind: "L" });
        dir = 1; hiP = high[i]; hiI = i;
      } else if (low[i] <= hiP - thr(hiP, i)) {
        pts.push({ i: hiI, price: hiP, kind: "H" });
        dir = -1; loP = low[i]; loI = i;
      }
    } else if (dir === 1) {
      if (low[i] <= hiP - thr(hiP, i)) {
        pts.push({ i: hiI, price: hiP, kind: "H" });
        dir = -1; loP = low[i]; loI = i;
      }
    } else {
      if (high[i] >= loP + thr(loP, i)) {
        pts.push({ i: loI, price: loP, kind: "L" });
        dir = 1; hiP = high[i]; hiI = i;
      }
    }
  }
  // Trailing unconfirmed extreme.
  if (dir === 1) pts.push({ i: hiI, price: hiP, kind: "H", provisional: true });
  else if (dir === -1) pts.push({ i: loI, price: loP, kind: "L", provisional: true });
  return pts;
}

// ── n-bar lookback ZigZag ──
// Same pivot rule as _engine.js findPivots (strict on the future side,
// non-strict on the past side, tolerating flat bars), then alternation:
// consecutive same-kind pivots collapse to the most extreme one.
function zigzagLookback(candles, { lookback = 2 } = {}) {
  const { high, low } = candles;
  const n = high.length;
  const nb = Math.max(1, lookback);
  const raw = [];
  for (let i = nb; i < n - nb; i++) {
    let isH = true, isL = true;
    for (let k = 1; k <= nb; k++) {
      if (!(high[i] >= high[i - k] && high[i] > high[i + k])) isH = false;
      if (!(low[i] <= low[i - k] && low[i] < low[i + k])) isL = false;
    }
    // A bar can pivot both ways (wide-range bar); emit L first so an up-leg
    // reads L→H chronologically inside the same bar.
    if (isL) raw.push({ i, price: low[i], kind: "L" });
    if (isH) raw.push({ i, price: high[i], kind: "H" });
  }
  const pts = [];
  for (const p of raw) {
    const last = pts[pts.length - 1];
    if (!last || last.kind !== p.kind) { pts.push({ ...p }); continue; }
    const better = p.kind === "H" ? p.price >= last.price : p.price <= last.price;
    if (better) pts[pts.length - 1] = { ...p };
  }
  // The last pivot is n bars from the edge at most — anything after it hasn't
  // had the chance to confirm; mark the final point provisional if the series
  // has moved beyond it in its own direction.
  if (pts.length) {
    const last = pts[pts.length - 1];
    for (let i = last.i + 1; i < n; i++) {
      if (last.kind === "H" && high[i] > last.price) { last.i = i; last.price = high[i]; last.provisional = true; }
      if (last.kind === "L" && low[i] < last.price) { last.i = i; last.price = low[i]; last.provisional = true; }
    }
  }
  return pts;
}

// ── sequence-break ZigZag (the course method) ──
// A peak (שיא) forms when a RISING sequence breaks — a bar closes below the
// low of the highest bar in the run; a trough (שפל) when a FALLING sequence
// breaks — a close above the high of the lowest bar.
//
// This is the SINGLE source-of-truth definition: it delegates to
// sequenceStructure in api/_engine.js (the course's exact model, which also
// drives the analyzer's Q-checks, the sell signal S1, and the strategy tool) so
// the chart can never drift from the breakdown. A previous hand-written copy
// here diverged (it gated the break test on the PREVIOUS bar's low and so
// missed intermediate swings) — do not reintroduce a parallel state machine;
// change sequenceStructure and both surfaces move together.
//
// We adapt the engine's { highs, lows, current } shape into merged alternating
// points and flag the still-running sequence's extreme `provisional` so the UI
// can draw its leg dashed.
function zigzagSequence(candles) {
  const { open, high, low, close } = candles;
  const n = close.length;
  if (n < 2) return [];
  const { highs, lows, current } = sequenceStructure(open, high, low, close);
  const pts = [
    ...highs.map((h) => ({ i: h.i, price: h.high, kind: "H" })),
    ...lows.map((l) => ({ i: l.i, price: l.low, kind: "L" })),
  ].sort((a, b) => a.i - b.i);
  // The running sequence hasn't broken yet — its extreme is not a confirmed point.
  const { dir, extremeIdx } = current;
  if (dir === 1) pts.push({ i: extremeIdx, price: high[extremeIdx], kind: "H", provisional: true });
  else if (dir === -1) pts.push({ i: extremeIdx, price: low[extremeIdx], kind: "L", provisional: true });
  return pts;
}

function zigzag(candles, opts = {}) {
  if (opts.mode === "sequence") return zigzagSequence(candles);
  return opts.mode === "lookback" ? zigzagLookback(candles, opts) : zigzagPercent(candles, opts);
}

// ── HH / HL / LH / LL vs the previous swing of the same kind ──
// The first swing of each kind is just "H"/"L" (nothing to compare against).
function classifySwings(points) {
  let prevH = null, prevL = null;
  return points.map((p) => {
    let label;
    if (p.kind === "H") {
      label = prevH == null ? "H" : p.price > prevH ? "HH" : "LH";
      prevH = p.price;
    } else {
      label = prevL == null ? "L" : p.price < prevL ? "LL" : "HL";
      prevL = p.price;
    }
    return { ...p, label };
  });
}

// ── trend structure from the recent labels ──
// Classic Dow reading: rising highs AND rising lows → uptrend; falling both →
// downtrend; mixed → range. Looks at the last `window` labeled swings.
function trendVerdict(labeled, window = 4) {
  const recent = labeled.slice(-window).filter((p) => p.label.length === 2);
  if (recent.length < 2) {
    return { trend: "range", confidence: 0, reasons: ["Not enough confirmed swings to read a structure."] };
  }
  const bull = recent.filter((p) => p.label === "HH" || p.label === "HL").length;
  const bear = recent.filter((p) => p.label === "LL" || p.label === "LH").length;
  const seq = recent.map((p) => p.label).join(" → ");
  const reasons = [`Last ${recent.length} swings: ${seq}`];
  let trend = "range";
  if (bull === recent.length) trend = "uptrend";
  else if (bear === recent.length) trend = "downtrend";
  else if (bull >= recent.length - 1 && bull > bear) trend = "uptrend";
  else if (bear >= recent.length - 1 && bear > bull) trend = "downtrend";
  const confidence = +(Math.max(bull, bear) / recent.length).toFixed(2);
  if (trend === "uptrend") reasons.push("Rising highs and rising lows — buyers in control.");
  else if (trend === "downtrend") reasons.push("Falling highs and falling lows — sellers in control.");
  else reasons.push("Mixed highs/lows — no clear one-sided structure.");
  return { trend, confidence, reasons };
}

// ── support/resistance via price clustering of the swings ──
// Greedy cluster: swings within max(tolPct%, 0.5×ATR) of a cluster's mean join
// it. Levels need ≥2 touches. kind: where price sits now (support below,
// resistance above); a cluster touched by both peaks AND troughs is a "flip"
// zone. strength favors touch count and recency.
function srLevels(points, candles, { tolPct = 1.0, maxLevels = 8 } = {}) {
  const n = candles.close.length;
  if (!points.length || !n) return [];
  const lastClose = candles.close[n - 1];
  const atr = atrSeries(candles.high, candles.low, candles.close);
  const lastAtr = atr[n - 1] || 0;

  const sorted = [...points].sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const p of sorted) {
    const c = clusters[clusters.length - 1];
    const tol = Math.max(p.price * (tolPct / 100), 0.5 * lastAtr);
    if (c && Math.abs(p.price - c.sum / c.pts.length) <= tol) { c.pts.push(p); c.sum += p.price; }
    else clusters.push({ pts: [p], sum: p.price });
  }

  const levels = [];
  for (const c of clusters) {
    if (c.pts.length < 2) continue;
    const price = +(c.sum / c.pts.length).toFixed(4);
    const hasH = c.pts.some((p) => p.kind === "H");
    const hasL = c.pts.some((p) => p.kind === "L");
    const kind = hasH && hasL ? "flip" : price <= lastClose ? "support" : "resistance";
    const firstIdx = Math.min(...c.pts.map((p) => p.i));
    const lastIdx = Math.max(...c.pts.map((p) => p.i));
    // Touches count linearly; a recent touch (last quarter of the chart) adds weight.
    const strength = +(c.pts.length + (lastIdx >= n * 0.75 ? 1 : 0)).toFixed(2);
    levels.push({ price, touches: c.pts.length, kind, strength, firstIdx, lastIdx });
  }
  levels.sort((a, b) => b.strength - a.strength || b.touches - a.touches);
  return levels.slice(0, maxLevels);
}

// ── Fibonacci retracement of the dominant recent leg ──
// Among the last few CONFIRMED legs, retrace the one with the largest price
// travel (later legs win ties). Ratios follow chart convention: 0 at the leg
// end, 1 at the leg start.
const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
function fibLevels(points, { legsBack = 5 } = {}) {
  const confirmed = points.filter((p) => !p.provisional);
  if (confirmed.length < 2) return null;
  const startK = Math.max(1, confirmed.length - legsBack);
  let from = null, to = null;
  for (let k = startK; k < confirmed.length; k++) {
    const a = confirmed[k - 1], b = confirmed[k];
    if (!from || Math.abs(b.price - a.price) >= Math.abs(to.price - from.price)) { from = a; to = b; }
  }
  const direction = to.price >= from.price ? "up" : "down";
  const span = to.price - from.price;
  const levels = FIB_RATIOS.map((ratio) => ({
    ratio,
    price: +(to.price - ratio * span).toFixed(4),
  }));
  return { from, to, direction, levels };
}

// ── one-call orchestrator ──
// opts: { mode, reversalPct, atrMult, lookback, tolPct, maxLevels }
function analyzePeaks(candles, opts = {}) {
  const points = classifySwings(zigzag(candles, opts));
  const trend = trendVerdict(points);
  const sr = srLevels(points, candles, opts);
  const fib = fibLevels(points);
  return {
    params: {
      mode: ["lookback", "sequence"].includes(opts.mode) ? opts.mode : "percent",
      reversalPct: opts.reversalPct ?? null,
      atrMult: opts.atrMult ?? null,
      lookback: opts.lookback ?? null,
    },
    points,
    trend,
    srLevels: sr,
    fib,
  };
}

module.exports = {
  atrSeries,
  zigzag,
  zigzagPercent,
  zigzagLookback,
  zigzagSequence,
  classifySwings,
  trendVerdict,
  srLevels,
  fibLevels,
  analyzePeaks,
  FIB_RATIOS,
};
