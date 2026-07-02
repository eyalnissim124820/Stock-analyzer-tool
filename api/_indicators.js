// ─────────────────────────────────────────────────────────────
// _indicators.js — classic indicator set for the Advanced Chart.
//
// Same conventions as _engine.js: pure functions over plain arrays, outputs
// null-padded and index-aligned with the input so the chart's polyline helper
// can plot them directly. _engine.js itself is left untouched; its smaSeries
// is reused here.
// ─────────────────────────────────────────────────────────────

const { smaSeries } = require("./_engine.js");

// EMA seeded with the SMA of the first `p` values (standard convention).
function emaSeries(vals, p) {
  const n = vals.length;
  const out = Array(n).fill(null);
  if (n < p) return out;
  let sum = 0;
  for (let i = 0; i < p; i++) sum += vals[i];
  let ema = sum / p;
  out[p - 1] = ema;
  const k = 2 / (p + 1);
  for (let i = p; i < n; i++) {
    ema = vals[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

// Wilder RSI.
function rsiSeries(closes, p = 14) {
  const n = closes.length;
  const out = Array(n).fill(null);
  if (n <= p) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= p; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgG = gain / p, avgL = loss / p;
  out[p] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = p + 1; i < n; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (p - 1) + Math.max(d, 0)) / p;
    avgL = (avgL * (p - 1) + Math.max(-d, 0)) / p;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

// MACD line = EMA(fast) − EMA(slow); signal = EMA(signalP) of the MACD line
// (computed over its non-null run); hist = macd − signal.
function macdSeries(closes, fast = 12, slow = 26, signalP = 9) {
  const n = closes.length;
  const ef = emaSeries(closes, fast);
  const es = emaSeries(closes, slow);
  const macd = Array(n).fill(null);
  let firstIdx = -1;
  for (let i = 0; i < n; i++) {
    if (ef[i] != null && es[i] != null) {
      macd[i] = ef[i] - es[i];
      if (firstIdx < 0) firstIdx = i;
    }
  }
  const signal = Array(n).fill(null);
  const hist = Array(n).fill(null);
  if (firstIdx >= 0) {
    const sig = emaSeries(macd.slice(firstIdx), signalP);
    for (let j = 0; j < sig.length; j++) {
      if (sig[j] != null) {
        signal[firstIdx + j] = sig[j];
        hist[firstIdx + j] = macd[firstIdx + j] - sig[j];
      }
    }
  }
  return { macd, signal, hist };
}

// Full Bollinger bands (population stdev, matching _engine.js bollLowerSeries).
function bollingerSeries(closes, p = 20, mult = 2) {
  const n = closes.length;
  const upper = Array(n).fill(null), mid = Array(n).fill(null), lower = Array(n).fill(null);
  for (let i = p - 1; i < n; i++) {
    let mean = 0;
    for (let k = i - p + 1; k <= i; k++) mean += closes[k];
    mean /= p;
    let varr = 0;
    for (let k = i - p + 1; k <= i; k++) varr += (closes[k] - mean) ** 2;
    const sd = Math.sqrt(varr / p);
    upper[i] = mean + mult * sd;
    mid[i] = mean;
    lower[i] = mean - mult * sd;
  }
  return { upper, mid, lower };
}

module.exports = { emaSeries, rsiSeries, macdSeries, bollingerSeries, smaSeries };
