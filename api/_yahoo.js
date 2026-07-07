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

// ── TASE calendar aggregation ──
// Yahoo's own 1wk bars are Monday-anchored. TASE trades Sunday–Thursday, so a
// Monday-anchored "week" both misses the Israeli week's opening Sunday session
// AND swallows the NEXT week's Sunday — every weekly candle comes out with a
// different open/high/low/close than the Israeli platforms (bursagraph et al.)
// build for the same stock. For .TA symbols we therefore fetch DAILY bars and
// aggregate the weekly/monthly candles ourselves on the Israeli calendar:
// weeks run Sunday→Thursday (group key = the Sunday on/before the session
// date), months are calendar months. TASE session timestamps are session-start
// in Asia/Jerusalem (UTC+2/+3), so the UTC date of the timestamp IS the local
// trading date — no further tz math needed.
// Trading date of a bar, in Israel's calendar. Yahoo stamps daily bars
// inconsistently across exchanges — session open for some, local MIDNIGHT
// (which is the previous evening in UTC: 00:00 IDT = 21:00 UTC the day
// before) for others, and the live quote time for the current day's bar.
// Deriving the date from the UTC timestamp misfiles a midnight-stamped
// Sunday session into the previous Israeli week — the prior weekly candle
// swallows Sunday and the current week shows as a separate Mon–Thu stub.
// The Asia/Jerusalem calendar date is correct under every convention.
const IL_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit",
});
function taseDate(ts) { return IL_DATE.format(new Date(ts * 1000)); } // "YYYY-MM-DD"

function taseGroupKey(ts, interval) {
  const [y, m, d] = taseDate(ts).split("-").map(Number);
  if (interval === "1mo") return y * 12 + (m - 1);
  const local = new Date(Date.UTC(y, m - 1, d));
  return Math.floor(local.getTime() / 86400000) - local.getUTCDay(); // day-number of the week's Sunday
}

// Aggregate cleaned daily candles into Israeli weekly/monthly bars. Each bar:
// open of the first session, close of the last, extreme high/low, summed
// volume — and it carries the LAST session's timestamp, so the bar is dated by
// its closing day (the Israeli chart convention: a weekly candle shows its
// Thursday date).
function aggregateTaseCandles(candles, T, interval) {
  const { open, high, low, close, volume } = candles;
  const O = [], H = [], L = [], C = [], V = [], TT = [];
  let key = null;
  for (let i = 0; i < close.length; i++) {
    const k = taseGroupKey(T[i], interval);
    if (k !== key) {
      key = k;
      O.push(open[i]); H.push(high[i]); L.push(low[i]); C.push(close[i]);
      V.push(volume[i]); TT.push(T[i]);
    } else {
      const j = C.length - 1;
      H[j] = Math.max(H[j], high[i]);
      L[j] = Math.min(L[j], low[i]);
      C[j] = close[i]; V[j] += volume[i]; TT[j] = T[i];
    }
  }
  return { candles: { open: O, high: H, low: L, close: C, volume: V }, T: TT };
}

// Raw Yahoo hit: cleaned OHLCV arrays + timestamps + meta, no bar-count floor.
async function fetchYahoo(ticker, interval, range) {
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
  return { candles: { open: O, high: H, low: L, close: C, volume: V }, T, meta };
}

// Generic fetch: any interval/range. Returns cleaned OHLCV (oldest→newest)
// plus dates/meta, or throws with a human-readable message. For .TA symbols
// at 1wk/1mo the bars are built from dailies on the Israeli calendar (above);
// everything else takes Yahoo's own bars unchanged.
async function fetchRaw(ticker, interval, range, { minBars = 30 } = {}) {
  const isTa = /\.TA$/i.test(ticker);
  const tase = isTa && (interval === "1wk" || interval === "1mo");
  const raw = await fetchYahoo(ticker, tase ? "1d" : interval, range);
  const { candles, T } = tase ? aggregateTaseCandles(raw.candles, raw.T, interval) : raw;
  const meta = raw.meta;
  if (candles.close.length < minBars) {
    throw new Error(`Only ${candles.close.length} clean candles — need ~${minBars}+. Try a more liquid ticker.`);
  }

  // .TA bars are dated on the Israeli calendar (see taseDate) so a session
  // stamped at local midnight still labels as its own trading day.
  const dateOf = isTa ? taseDate : (t) => new Date(t * 1000).toISOString().slice(0, 10);
  return {
    candles,
    dates: T.map(dateOf),
    lastDate: T.length ? dateOf(T[T.length - 1]) : null,
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

module.exports = { TIMEFRAMES, normalizeTicker, fetchRaw, fetchCandles, aggregateTaseCandles, taseGroupKey };
