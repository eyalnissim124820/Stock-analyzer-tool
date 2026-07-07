// ─────────────────────────────────────────────────────────────
// /api/analyze — Vercel serverless function.
// GET /api/analyze?ticker=AAPL&timeframe=Weekly
// Fetches candles from Yahoo (covers US + TASE via .TA) at the
// requested timeframe, runs the method engine, returns the
// filled-in analysis.
//
// Runs server-side, so no API key is exposed and CORS is a non-issue.
// NOTE: Yahoo's chart endpoint is unofficial. If Yahoo changes it,
// patch ONLY the fetchCandles() function below.
// ─────────────────────────────────────────────────────────────

const { analyze, conclude } = require("./_engine.js");
const { resolveTase } = require("./_tase.js");
const { classifySwings, trendVerdict, srLevels, fibLevels } = require("./_peaks.js");

// Build the Peaks & Troughs structure payload from the verdict's own
// sequence-based points, so the chart's zigzag/labels mirror the analysis
// exactly. Same shape as _peaks.js analyzePeaks().
function peaksFromPivots(pivots, candles) {
  const merged = [
    ...pivots.ph.map((p) => ({ i: p.i, price: p.price, kind: "H" })),
    ...pivots.pl.map((p) => ({ i: p.i, price: p.price, kind: "L" })),
  ].sort((a, b) => a.i - b.i);
  const points = classifySwings(merged);
  return {
    params: { mode: "sequence", reversalPct: null, atrMult: null, lookback: null },
    points,
    trend: trendVerdict(points),
    srLevels: srLevels(points, candles),
    fib: fibLevels(points),
  };
}

// Map the UI timeframe to Yahoo's interval + a range that yields
// ~60–120 candles (the engine needs ~30+ to fill every check).
const TIMEFRAMES = {
  Daily:   { interval: "1d",  range: "6mo" },
  Weekly:  { interval: "1wk", range: "2y" },
  Monthly: { interval: "1mo", range: "5y" },
};

// Append the exchange suffix Yahoo expects for the selected market.
// Idempotent (strips any existing .TA first) so it matches the client's
// resolveTicker and can't double-suffix even on direct API calls.
function normalizeTicker(ticker, market) {
  const s = String(ticker || "").trim().toUpperCase().replace(/\.TA$/, "");
  return market === "TLV" ? `${s}.TA` : s;
}

async function fetchCandles(ticker, timeframe) {
  const tf = TIMEFRAMES[timeframe] || TIMEFRAMES.Daily;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?range=${tf.range}&interval=${tf.interval}&includePrePost=false`;
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
    dates: T.map((t) => new Date(t * 1000).toISOString().slice(0, 10)),
    lastDate: T.length ? new Date(T[T.length - 1] * 1000).toISOString().slice(0, 10) : null,
    currency: meta.currency || null,
    exchange: meta.fullExchangeName || meta.exchangeName || null,
    name: meta.longName || meta.shortName || ticker,
  };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "s-maxage=300"); // 5-min CDN cache
  try {
    const { ticker, timeframe, market, lang } = req.query || {};
    if (!ticker) return res.status(400).json({ error: "Missing ?ticker=" });

    const tf = TIMEFRAMES[timeframe] ? timeframe : "Daily";
    // Israeli addition: TASE security numbers / Hebrew or free-text names
    // resolve to the ".TA" Yahoo symbol; returns null for every input the
    // original normalizeTicker flow already handles (incl. all US inputs).
    const il = await resolveTase(ticker, market === "TLV" ? "TLV" : "US");
    const symbol = il ? il.symbol : normalizeTicker(ticker, market);
    const data = await fetchCandles(symbol, tf);
    const result = analyze(data.candles, {
      lastDate: data.lastDate,
      currency: data.currency,
      lang: lang === "he" ? "he" : "en",
    });
    const c = conclude(result);

    return res.status(200).json({
      ticker: symbol,
      market: market === "TLV" ? "TLV" : "US",
      name: data.name,
      exchange: data.exchange,
      currency: data.currency,
      lastDate: data.lastDate,
      timeframe: tf,
      checks: result.checks,
      math: result.math,
      conclusion: c,
      pivots: result.pivots,
      segments: result.segments,
      // Chart data — raw candles + the indicator series the engine already
      // computed + per-candle dates, so the UI can render the analysis visually.
      candles: data.candles,
      series: result.series,
      dates: data.dates,
      // Peaks & Troughs structure (additive) — built from the verdict's own
      // sequence-based pivots, so the zigzag mirrors the analysis exactly.
      peaks: peaksFromPivots(result.pivots, data.candles),
    });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Fetch/analysis failed" });
  }
};
