// ─────────────────────────────────────────────────────────────
// /api/analyze — Vercel serverless function.
// GET /api/analyze?ticker=AAPL&swingN=2
// Fetches ~90 daily candles from Yahoo (covers US + TASE via .TA),
// runs the method engine, returns the filled-in analysis.
//
// Runs server-side, so no API key is exposed and CORS is a non-issue.
// NOTE: Yahoo's chart endpoint is unofficial. If Yahoo changes it,
// patch ONLY the fetchCandles() function below.
// ─────────────────────────────────────────────────────────────

const { analyze, conclude } = require("./_engine.js");

async function fetchCandles(ticker) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?range=6mo&interval=1d&includePrePost=false`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Yahoo responded ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) {
    const msg = json?.chart?.error?.description || "No data for that ticker";
    throw new Error(msg);
  }
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const meta = result.meta || {};
  const open = q.open, high = q.high, low = q.low, close = q.close, volume = q.volume;
  if (!open || !close) throw new Error("Malformed OHLCV from Yahoo");

  // Drop any rows with null fields (Yahoo occasionally returns gaps).
  const O = [], H = [], L = [], C = [], V = [], T = [];
  for (let i = 0; i < close.length; i++) {
    if ([open[i], high[i], low[i], close[i], volume[i]].some((x) => x == null)) continue;
    O.push(open[i]); H.push(high[i]); L.push(low[i]); C.push(close[i]); V.push(volume[i]); T.push(ts[i]);
  }
  if (C.length < 30) throw new Error(`Only ${C.length} clean candles — need ~30+. Try a more liquid ticker.`);

  return {
    candles: { open: O, high: H, low: L, close: C, volume: V },
    lastDate: T.length ? new Date(T[T.length - 1] * 1000).toISOString().slice(0, 10) : null,
    currency: meta.currency || null,
    exchange: meta.fullExchangeName || meta.exchangeName || null,
    name: meta.longName || meta.shortName || ticker,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "s-maxage=300"); // 5-min CDN cache
  try {
    const { ticker, swingN } = req.query || {};
    if (!ticker) return res.status(400).json({ error: "Missing ?ticker=" });

    const data = await fetchCandles(String(ticker).trim().toUpperCase());
    const n = Math.max(1, Math.min(5, parseInt(swingN) || 2));
    const result = analyze(data.candles, {
      swingN: n,
      lastDate: data.lastDate,
      currency: data.currency,
    });
    const c = conclude(result);

    return res.status(200).json({
      ticker: String(ticker).toUpperCase(),
      name: data.name,
      exchange: data.exchange,
      currency: data.currency,
      lastDate: data.lastDate,
      swingN: n,
      checks: result.checks,
      math: result.math,
      conclusion: c,
      pivots: result.pivots,
      segments: result.segments,
    });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Fetch/analysis failed" });
  }
};
