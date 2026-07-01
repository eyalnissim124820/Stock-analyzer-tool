// ─────────────────────────────────────────────────────────────
// tests/_mock.js — offline test doubles for the API handlers.
//
// The sandbox has no route to Yahoo/TASE (same restriction the README notes
// from the original build), so tests stub global.fetch with deterministic
// fixtures keyed off the request URL. Candles are synthetic but shaped
// exactly like Yahoo's chart payload, so the engine runs for real.
// ─────────────────────────────────────────────────────────────

// Small deterministic PRNG so every run produces identical candles.
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashCode(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h) + 1;
}

// Build a Yahoo /v8/finance/chart payload: `bars` candles ending 2026-06-26,
// gently trending + noisy, spacing set by the interval.
function yahooChartFixture(symbol, interval, bars = 140) {
  const rnd = mulberry32(hashCode(symbol + interval));
  const stepSec = { "1d": 86400, "1wk": 7 * 86400, "1mo": 30 * 86400, "3mo": 91 * 86400 }[interval] || 86400;
  const end = Date.UTC(2026, 5, 26) / 1000;
  const ts = [], open = [], high = [], low = [], close = [], volume = [];
  let price = 50 + rnd() * 150;
  for (let i = 0; i < bars; i++) {
    const drift = Math.sin(i / 9) * 0.8 + (rnd() - 0.45) * 2;
    const o = price;
    const c = Math.max(1, o + drift);
    const h = Math.max(o, c) + rnd() * 1.5;
    const l = Math.min(o, c) - rnd() * 1.5;
    ts.push(end - (bars - 1 - i) * stepSec);
    open.push(+o.toFixed(2)); high.push(+h.toFixed(2)); low.push(+l.toFixed(2)); close.push(+c.toFixed(2));
    volume.push(Math.floor(1e6 + rnd() * 5e6));
    price = c;
  }
  const isTA = symbol.endsWith(".TA");
  return {
    chart: {
      result: [{
        timestamp: ts,
        indicators: { quote: [{ open, high, low, close, volume }] },
        meta: {
          currency: isTA ? "ILS" : "USD",
          fullExchangeName: isTA ? "Tel Aviv" : "NasdaqGS",
          longName: `${symbol.replace(/\.TA$/, "")} Test Co.`,
        },
      }],
    },
  };
}

// A fetch Response look-alike.
function jsonResponse(obj, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => obj };
}

// Install a fetch stub. `extra(url)` may return a fixture object (served as
// JSON), a {status, body} pair, or undefined to fall through to the chart
// fixture. Every call is recorded in the returned `calls` array.
function installFetchStub(extra) {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (extra) {
      const hit = await extra(String(url));
      if (hit !== undefined) {
        if (hit && hit.__status) return jsonResponse(hit.body, hit.__status);
        return jsonResponse(hit);
      }
    }
    const m = String(url).match(/\/v8\/finance\/chart\/([^?]+)\?range=([^&]+)&interval=([^&]+)/);
    if (m) {
      const symbol = decodeURIComponent(m[1]);
      return jsonResponse(yahooChartFixture(symbol, m[3]));
    }
    return jsonResponse({ error: "unmocked url in test: " + url }, 404);
  };
  return calls;
}

// Minimal Vercel-style res object.
function makeRes() {
  return {
    statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
  };
}

async function runHandler(handler, query) {
  const res = makeRes();
  await handler({ query }, res);
  return res;
}

module.exports = { yahooChartFixture, jsonResponse, installFetchStub, makeRes, runHandler };
