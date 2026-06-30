// ─────────────────────────────────────────────────────────────
// /api/strategy — Vercel serverless function for the Sequence Method tool.
// GET /api/strategy?ticker=AAPL&market=US&technique=1&timeframe=Weekly&swingN=2&lang=en
//
// Technique 1 (cascade): fetches Monthly + Weekly + Daily so the cascade can
// pick the trade horizon. Technique 2 (single timeframe): fetches just the one.
// Also fetches a leading index on a QUARTERLY interval for the market-first
// gate (S&P 500 for US, TA-125 for TLV) — the spec's "quarterly chart /
// leading indices". Reuses the exact same Yahoo data layer as the 9-Question
// tool via api/_yahoo.js (which is left untouched).
// ─────────────────────────────────────────────────────────────

const { analyze, conclude, assessMarket } = require("./_sequence.js");
const { normalizeTicker, fetchCandles, fetchRaw } = require("./_yahoo.js");

// Leading index per market for the market-first gate.
const MARKET_INDEX = { US: "^GSPC", TLV: "^TA125.TA" };

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "s-maxage=300"); // 5-min CDN cache
  try {
    const q = req.query || {};
    if (!q.ticker) return res.status(400).json({ error: "Missing ?ticker=" });

    const market = q.market === "TLV" ? "TLV" : "US";
    const technique = String(q.technique) === "2" ? 2 : 1;
    const timeframe = ["Daily", "Weekly", "Monthly"].includes(q.timeframe) ? q.timeframe : "Weekly";
    const swingN = Math.max(1, Math.min(5, parseInt(q.swingN) || 2));
    const lang = q.lang === "he" ? "he" : "en";
    const symbol = normalizeTicker(q.ticker, market);

    // ── candles ──
    const candlesByTf = {};
    const datesByTf = {};
    let meta = null;
    if (technique === 1) {
      // Cascade needs all three. Fetch concurrently; weekly defines the display meta.
      const [mo, wk, dy] = await Promise.all([
        fetchCandles(symbol, "Monthly"),
        fetchCandles(symbol, "Weekly"),
        fetchCandles(symbol, "Daily"),
      ]);
      candlesByTf.Monthly = mo.candles; datesByTf.Monthly = mo.dates;
      candlesByTf.Weekly = wk.candles;  datesByTf.Weekly = wk.dates;
      candlesByTf.Daily = dy.candles;   datesByTf.Daily = dy.dates;
      meta = wk; // currency/exchange/name are the same across timeframes
    } else {
      const one = await fetchCandles(symbol, timeframe);
      candlesByTf[timeframe] = one.candles;
      datesByTf[timeframe] = one.dates;
      meta = one;
    }

    // ── market-first gate: leading index on a quarterly chart ──
    let marketTrend = "unknown";
    try {
      const idx = MARKET_INDEX[market];
      const idxData = await fetchRaw(idx, "3mo", "10y", { minBars: 5 });
      marketTrend = assessMarket(idxData.candles).trend;
    } catch (_) {
      marketTrend = "unknown"; // non-blocking: the gate only voids on a clear "falling"
    }

    // ── analyze + conclude ──
    const result = analyze({
      candlesByTf,
      timeframe,
      technique,
      swingN,
      market,
      lang,
      currency: meta.currency,
      lastDate: meta.lastDate,
    });
    const conclusion = conclude(result, marketTrend, lang);

    // The chart renders the TRADE timeframe (the one Steps 3/4 ran on).
    const tradeTf = result.meta.tradeTf || timeframe;

    return res.status(200).json({
      ticker: symbol,
      market,
      name: meta.name,
      exchange: meta.exchange,
      currency: meta.currency,
      lastDate: meta.lastDate,
      swingN,
      technique,
      timeframe: tradeTf,         // the timeframe the trade analysis used
      requestedTimeframe: timeframe,
      horizon: result.meta.horizon,
      cascade: result.meta.cascade,
      stratTf: result.meta.stratTf,
      marketTrend,
      checks: result.checks,
      math: result.math,
      position: result.position,
      sell: result.sell,
      conclusion,
      pivots: result.pivots,
      segments: result.segments,
      // Chart data — the trade-timeframe candles + indicator series + dates.
      candles: result.candles,
      series: result.series,
      dates: datesByTf[tradeTf] || meta.dates || null,
    });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Fetch/analysis failed" });
  }
};
