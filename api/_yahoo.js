// ─────────────────────────────────────────────────────────────
// _yahoo.js — shared Yahoo data layer.
//
// The 9-Question tool (api/analyze.js) keeps its OWN private copy of the
// fetch logic and is intentionally left untouched. This module exists so the
// new Sequence-Method tool (api/strategy.js) can reuse the exact same data
// source WITHOUT modifying the first tool. Same unofficial Yahoo chart
// endpoint, same cleaning rules, same return shape.
//
// NOTE: Yahoo's chart endpoint is unofficial. If Yahoo changes it, patch ONLY
// fetchRaw() below.
// ─────────────────────────────────────────────────────────────

// UI timeframe → Yahoo interval + a range yielding enough candles for the
// engine. Identical mapping to api/analyze.js so both tools agree.
const TIMEFRAMES = {
  Daily:   { interval: "1d",  range: "6mo" },
  Weekly:  { interval: "1wk", range: "2y" },
  Monthly: { interval: "1mo", range: "5y" },
};

// Append the exchange suffix Yahoo expects for the selected market.
// Idempotent (strips any existing .TA first).
function normalizeTicker(ticker, market) {
  const s = String(ticker || "").trim().toUpperCase().replace(/\.TA$/, "");
  return market === "TLV" ? `${s}.TA` : s;
}

// Generic fetch: any interval/range. Returns cleaned OHLCV (oldest→newest)
// plus dates/meta, or throws with a human-readable message.
async function fetchRaw(ticker, interval, range, { minBars = 30 } = {}) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&includePrePost=false`;
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

  const O = [], H = [], L = [], C = [], V = [], T = [];
  for (let i = 0; i < close.length; i++) {
    if ([open[i], high[i], low[i], close[i]].some((x) => x == null)) continue;
    O.push(open[i]); H.push(high[i]); L.push(low[i]); C.push(close[i]);
    V.push(volume[i] == null ? 0 : volume[i]); T.push(ts[i]);
  }
  if (C.length < minBars) throw new Error(`Only ${C.length} clean candles — need ~${minBars}+. Try a more liquid ticker.`);

  return {
    candles: { open: O, high: H, low: L, close: C, volume: V },
    dates: T.map((t) => new Date(t * 1000).toISOString().slice(0, 10)),
    lastDate: T.length ? new Date(T[T.length - 1] * 1000).toISOString().slice(0, 10) : null,
    currency: meta.currency || null,
    exchange: meta.fullExchangeName || meta.exchangeName || null,
    name: meta.longName || meta.shortName || ticker,
  };
}

// Convenience wrapper keyed by the UI timeframe label.
async function fetchCandles(ticker, timeframe, opts) {
  const tf = TIMEFRAMES[timeframe] || TIMEFRAMES.Daily;
  return fetchRaw(ticker, tf.interval, tf.range, opts);
}

module.exports = { TIMEFRAMES, normalizeTicker, fetchRaw, fetchCandles };
