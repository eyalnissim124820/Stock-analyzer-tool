// ─────────────────────────────────────────────────────────────
// /api/tracker — Vercel serverless function for the Monthly Tracker tool.
// GET /api/tracker?ticker=AAPL&market=US&lang=en
//
// Fetches the MONTHLY chart (structure checks N2–N7) plus the DAILY chart
// (liquidity check N1 = ~20-day average daily volume). Reuses the exact same
// Yahoo data layer and TASE resolver as the other two tools; the decision
// logic is the pure api/_tracker.js.
// ─────────────────────────────────────────────────────────────

const { evaluate } = require("./_tracker.js");
const { normalizeTicker, fetchCandles } = require("./_yahoo.js");
const { resolveTase } = require("./_tase.js");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "s-maxage=300"); // 5-min CDN cache
  try {
    const q = req.query || {};
    if (!q.ticker) return res.status(400).json({ error: "Missing ?ticker=" });

    const market = q.market === "TLV" ? "TLV" : "US";
    const lang = q.lang === "he" ? "he" : "en";
    // TASE security numbers / Hebrew or English names resolve to the ".TA"
    // Yahoo symbol; null for everything normalizeTicker already handles.
    const il = await resolveTase(q.ticker, market);
    const symbol = il ? il.symbol : normalizeTicker(q.ticker, market);

    // Monthly chart is the method's chart; daily is only for the liquidity
    // gate, so its failure must not sink the whole scan (N1 turns unanswered).
    const [mo, dy] = await Promise.all([
      fetchCandles(symbol, "Monthly"),
      fetchCandles(symbol, "Daily", { minBars: 5 }).catch(() => null),
    ]);

    const result = evaluate({
      monthly: mo.candles,
      monthlyDates: mo.dates,
      daily: dy ? dy.candles : null,
      lang,
    });

    return res.status(200).json({
      ticker: symbol,
      market,
      name: mo.name,
      exchange: mo.exchange,
      currency: mo.currency,
      lastDate: mo.lastDate,
      timeframe: "Monthly",
      checks: result.checks,
      conclusion: result.conclusion,
      meta: result.meta,
      // Chart data — full monthly candles (incl. any forming bar) + MA5.
      candles: mo.candles,
      series: result.series,
      pivots: result.pivots,
      dates: mo.dates,
    });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Fetch/analysis failed" });
  }
};
