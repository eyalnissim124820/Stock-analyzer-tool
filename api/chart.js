// ─────────────────────────────────────────────────────────────
// /api/chart — Vercel serverless function for the Advanced Chart mode.
// GET /api/chart?ticker=AAPL&market=US&range=1Y&zigzagMode=sequence&sensitivity=5
//
// Returns candles + the full indicator series (SMA/EMA set, RSI, MACD,
// Bollinger) + the Peaks & Troughs structure analysis (zigzag points with
// HH/HL/LH/LL labels, trend verdict, support/resistance levels, Fibonacci).
// All math server-side, like the other endpoints. Reuses the shared Yahoo
// data layer and TASE resolver untouched.
// ─────────────────────────────────────────────────────────────

const { normalizeTicker, fetchRaw } = require("./_yahoo.js");
const { resolveTase } = require("./_tase.js");
const { analyzePeaks } = require("./_peaks.js");
const { smaSeries, emaSeries, rsiSeries, macdSeries, bollingerSeries } = require("./_indicators.js");

// UI range → Yahoo interval/range. Weekly beyond 1Y, monthly for Max, so the
// bar count stays chartable. 1M relaxes the min-bar floor (a fresh listing
// still draws). "10Y" exists only for the monthly candle view (the frontend
// never offers it under daily/weekly) — its default interval is "1mo" so the
// generic minBars floor stays honest even without a client interval override.
const RANGES = {
  "1M":  { interval: "1d",  range: "1mo",  minBars: 15 },
  "3M":  { interval: "1d",  range: "3mo",  minBars: 30 },
  "6M":  { interval: "1d",  range: "6mo",  minBars: 30 },
  "1Y":  { interval: "1d",  range: "1y",   minBars: 30 },
  "2Y":  { interval: "1wk", range: "2y",   minBars: 30 },
  "5Y":  { interval: "1wk", range: "5y",   minBars: 30 },
  "10Y": { interval: "1mo", range: "10y",  minBars: 12 },
  "Max": { interval: "1mo", range: "max",  minBars: 12 },
};
const INTERVALS = ["1d", "1wk", "1mo"];

const SMA_PERIODS = [5, 13, 20, 40, 50, 200];
const EMA_PERIODS = [9, 21, 50];

// Zigzag detection modes. "sequence" (the course method) is the default; it
// has no tunable — a sequence break either happened or it didn't.
const ZIGZAG_MODES = ["sequence", "percent", "lookback"];

// Sensitivity 1..10 → swing coarseness. Higher = only the bigger swings.
// Percent mode: threshold grows geometrically 0.8% → ~8.5%.
// Lookback mode: pivot lookback 1..7 bars.
// Sequence mode: parameter-free (sensitivity reported null).
function sensitivityToOpts(s, mode) {
  if (mode === "sequence") return { mode, sensitivity: null };
  const sens = Math.max(1, Math.min(10, parseInt(s) || 5));
  if (mode === "lookback") {
    return { mode, lookback: Math.max(1, Math.min(7, Math.round(sens * 0.7))), sensitivity: sens };
  }
  return { mode: "percent", reversalPct: +(0.8 * Math.pow(1.3, sens - 1)).toFixed(2), atrMult: 0.5, sensitivity: sens };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "s-maxage=300"); // 5-min CDN cache
  try {
    const q = req.query || {};
    if (!q.ticker) return res.status(400).json({ error: "Missing ?ticker=" });

    const market = q.market === "TLV" ? "TLV" : "US";
    const rangeKey = RANGES[q.range] ? q.range : "1Y";
    const rng = RANGES[rangeKey];
    const interval = INTERVALS.includes(q.interval) ? q.interval : rng.interval;
    const zigzagMode = ZIGZAG_MODES.includes(q.zigzagMode) ? q.zigzagMode : "sequence";
    const peakOpts = sensitivityToOpts(q.sensitivity, zigzagMode);

    // Same Israeli-lookup flow as /api/analyze and /api/strategy.
    const il = await resolveTase(q.ticker, market);
    const symbol = il ? il.symbol : normalizeTicker(q.ticker, market);

    const data = await fetchRaw(symbol, interval, rng.range, { minBars: rng.minBars });
    const c = data.candles;

    const sma = {};
    for (const p of SMA_PERIODS) sma[p] = smaSeries(c.close, p);
    const ema = {};
    for (const p of EMA_PERIODS) ema[p] = emaSeries(c.close, p);

    const peaks = analyzePeaks(c, peakOpts);

    return res.status(200).json({
      ticker: symbol,
      market,
      name: data.name,
      exchange: data.exchange,
      currency: data.currency,
      lastDate: data.lastDate,
      range: rangeKey,
      interval,
      params: { zigzagMode, sensitivity: peakOpts.sensitivity },
      candles: c,
      dates: data.dates,
      series: {
        sma,
        ema,
        rsi: rsiSeries(c.close, 14),
        macd: macdSeries(c.close, 12, 26, 9),
        boll: bollingerSeries(c.close, 20, 2),
      },
      peaks,
    });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Fetch/analysis failed" });
  }
};
