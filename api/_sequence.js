// ─────────────────────────────────────────────────────────────
// _sequence.js — The Sequence Method (Strategy & Tactics), implemented
// exactly per CHECKLIST_strategy_tactics_{EN,HE}.md. Nothing from outside
// that spec is added (no RSI/MACD/Fibonacci/news/earnings/sentiment).
// Pure functions, no I/O — testable in isolation.
//
// Method boundary (hard rule): candles, two MAs (trend pair 20/40) + MA5,
// volume, CCI(5), Bollinger, and sequence/peak-trough structure ONLY.
//
// The decision flow:
//   Market-first gate → STEP 1 Strategy (S1–S4) → STEP 2 Tactic (horizon /
//   MA5>MA20 gate) → STEP 3 Correction (C1–C3) → STEP 4 Timing (T1–T2).
//
// Confidence tiers returned per check (same vocabulary as the 9-Question tool):
//   "exact" — single deterministic formula
//   "swing" — deterministic given the swing-pivot setting
//   "guess" — best-effort interpretation, needs human confirm
//
// Per the 3-second rule, borderline results FAIL (never round up to a pass)
// and are surfaced at low confidence.
//
// Peaks/troughs come from the shared sequence engine (findSequencePoints in
// _engine.js): a peak forms when a rising sequence breaks and is the highest
// bar's HIGH; a trough when a falling sequence breaks and is the lowest bar's
// LOW. This supersedes the checklist's "closing basis" note for S1/S4 — a
// deliberate product decision to use one peak/trough definition everywhere.
// ─────────────────────────────────────────────────────────────

const { findSequencePoints } = require("./_engine.js");
const { zigzagSequence } = require("./_peaks.js");

// ---------- localized "why" messages ----------
// Math/figures are language-agnostic; only the human-readable line is localized.
const MSG = {
  en: {
    M1rising: () => `Leading index rising — market supports entries`,
    M1falling: () => `Leading index falling/topping — per-stock buys are void`,
    M1mixed: () => `Leading index mixed — proceed with caution (pointwise only)`,
    M1unknown: () => `Could not read the market index — confirm the broad market yourself`,
    S1: (p0, p1, t0, t1) => `Peaks ${p0}→${p1}, troughs ${t0}→${t1} (sequence points)`,
    S1sparse: () => `Sparse pivots — coarse half-vs-half structure; confirm visually`,
    S2: (a, b) => `Volume MA now ≈ ${a} vs prior ≈ ${b}`,
    S3a: (s, l, ok) => `MA20 ${s} ${ok ? ">" : "≤"} MA40 ${l}`,
    S3b: (now, prev, ok) => `MA40 slope ${now} vs prior ${prev} → ${ok ? "rising, not flattening" : "flattening/declining"}`,
    S3c: (now, prev, ok) => `MA20–MA40 gap ${now} vs prior ${prev} → ${ok ? "widening/equal" : "contracting"}`,
    S4yes: (lv) => `Broken resistance ≈ ${lv} now holding as support`,
    S4no: () => `No broken-resistance-turned-support found`,
    G1: (a, b, ok) => `MA5 ${a} ${ok ? ">" : "≤"} MA20 ${b} — order ${ok ? "kept" : "broken"} through the correction`,
    C1: (below, down) => `Falling sequence ${below ? "below" : "not below"} MA5; MA5 ${down ? "sloping down" : "not down"}`,
    C2: (m, fresh) => `Min CCI(5) ≈ ${m ?? "n/a"} (need ≤ −100); ${fresh ? "fresh (≤~3 candles)" : "stale oversold"}`,
    C3: (lvl, ok) => `Prior rise high-candle low ${lvl}; ${ok ? "a candle closed fully below it" : "no full undercut"}`,
    T1: (broke, q) => `${broke ? "Sequence broke up" : "No break yet"}; new trough ${q ? "> prior peak ✓ (quality gate)" : "≤ prior peak ✗"}`,
    T2: (r) => `Reward/risk ≈ ${r == null ? "n/a" : r + "×"} (hard gate ≥ 1.5)`,
  },
  he: {
    M1rising: () => `מדד מוביל בעלייה — השוק תומך בכניסות`,
    M1falling: () => `מדד מוביל יורד/טופ — קניות פר-מנייה בטלות`,
    M1mixed: () => `מדד מוביל מעורב — בזהירות בלבד (נקודתית)`,
    M1unknown: () => `לא ניתן לקרוא את מדד השוק — אמתו את השוק הרחב בעצמכם`,
    S1: (p0, p1, t0, t1) => `פסגות ${p0}→${p1}, שפלים ${t0}→${t1} (נקודות רצף)`,
    S1sparse: () => `מעט נקודות מפנה — בדיקת מבנה גסה; ודאו ויזואלית`,
    S2: (a, b) => `MA על המחזור עכשיו ≈ ${a} מול קודם ≈ ${b}`,
    S3a: (s, l, ok) => `MA20 ${s} ${ok ? ">" : "≤"} MA40 ${l}`,
    S3b: (now, prev, ok) => `שיפוע MA40 ${now} מול קודם ${prev} ← ${ok ? "עולה, לא מתיישר" : "מתיישר/יורד"}`,
    S3c: (now, prev, ok) => `מרווח MA20–MA40 ${now} מול קודם ${prev} ← ${ok ? "מתרחב/זהה" : "מתכווץ"}`,
    S4yes: (lv) => `התנגדות שנפרצה ≈ ${lv} מחזיקה כעת כתמיכה`,
    S4no: () => `לא נמצאה התנגדות-שהפכה-לתמיכה`,
    G1: (a, b, ok) => `MA5 ${a} ${ok ? ">" : "≤"} MA20 ${b} — הסדר ${ok ? "נשמר" : "נשבר"} לאורך התיקון`,
    C1: (below, down) => `הרצף היורד ${below ? "מתחת" : "לא מתחת"} ל-MA5; MA5 ${down ? "במגמת ירידה" : "אינו יורד"}`,
    C2: (m, fresh) => `CCI(5) מינ׳ ≈ ${m ?? "אין"} (נדרש ≤ ‎−100); ${fresh ? "טרי (≤~3 נרות)" : "אובר-סולד ישן"}`,
    C3: (lvl, ok) => `נמוך נר השיא ברצף הקודם ${lvl}; ${ok ? "נר נסגר כולו מתחתיו" : "אין חדירה מלאה"}`,
    T1: (broke, q) => `${broke ? "הרצף נשבר כלפי מעלה" : "טרם נשבר"}; שפל חדש ${q ? "> שיא קודם ✓ (שער איכות)" : "≤ שיא קודם ✗"}`,
    T2: (r) => `סיכוי/סיכון ≈ ${r == null ? "אין" : r + "×"} (שער קשיח ≥ 1.5)`,
  },
};

// ---------- basic indicators ----------
function smaSeries(vals, p) {
  const out = Array(vals.length).fill(null);
  let sum = 0;
  for (let i = 0; i < vals.length; i++) {
    sum += vals[i];
    if (i >= p) sum -= vals[i - p];
    if (i >= p - 1) out[i] = sum / p;
  }
  return out;
}

function cciSeries(highs, lows, closes, p = 5) {
  const tp = highs.map((h, i) => (h + lows[i] + closes[i]) / 3);
  const out = Array(closes.length).fill(null);
  for (let i = p - 1; i < tp.length; i++) {
    let mean = 0;
    for (let k = i - p + 1; k <= i; k++) mean += tp[k];
    mean /= p;
    let md = 0;
    for (let k = i - p + 1; k <= i; k++) md += Math.abs(tp[k] - mean);
    md /= p;
    out[i] = md === 0 ? 0 : (tp[i] - mean) / (0.015 * md);
  }
  return out;
}

// Bollinger bands. Params reuse this project's existing convention (10/1) — the
// spec names "Bollinger" without parameters, so we do NOT invent new numbers.
function bollSeries(closes, p = 10, mult = 1) {
  const up = Array(closes.length).fill(null);
  const lo = Array(closes.length).fill(null);
  for (let i = p - 1; i < closes.length; i++) {
    let mean = 0;
    for (let k = i - p + 1; k <= i; k++) mean += closes[k];
    mean /= p;
    let varr = 0;
    for (let k = i - p + 1; k <= i; k++) varr += (closes[k] - mean) ** 2;
    const sd = Math.sqrt(varr / p);
    up[i] = mean + mult * sd;
    lo[i] = mean - mult * sd;
  }
  return { up, lo };
}

// ---------- candle helpers ----------
function candleAt(c, i) {
  const o = c.open[i], cl = c.close[i], hi = c.high[i], lo = c.low[i];
  const body = Math.abs(cl - o);
  const upper = hi - Math.max(o, cl);
  const lower = Math.min(o, cl) - lo;
  return { o, c: cl, hi, lo, body, upper, lower, green: cl > o };
}
// "Seller candle": small body low, upper tail ≥ 2× body (sellers regaining control).
const isSeller = (k) => k.upper >= 2 * k.body && k.body > 0;

// ---------- pivots on a CLOSING basis — LEGACY ----------
// Retained only as a fallback for degenerate inputs (< 3 bars); the default
// detection path is findSequencePoints from _engine.js.
// A pivot high at i: close[i] ≥ the n closes before and > the n after (mirror low).
function findPivotsClose(closes, n = 2) {
  const ph = [], pl = [];
  for (let i = n; i < closes.length - n; i++) {
    let isH = true, isL = true;
    for (let k = 1; k <= n; k++) {
      if (!(closes[i] >= closes[i - k] && closes[i] > closes[i + k])) isH = false;
      if (!(closes[i] <= closes[i - k] && closes[i] < closes[i + k])) isL = false;
    }
    if (isH) ph.push({ i, price: closes[i] });
    if (isL) pl.push({ i, price: closes[i] });
  }
  return { ph, pl };
}

// Identify the last rising sequence (prior trough → most recent peak) and the
// correction (falling sequence) that follows it.
function segments(c, pivots) {
  const { ph, pl } = pivots;
  const last = c.close.length - 1;

  // Most recent peak = the high the current correction came down from ("prior peak").
  let peak = ph.length ? ph[ph.length - 1] : null;
  if (!peak) {
    const idx = c.high.indexOf(Math.max(...c.high));
    peak = { i: idx, price: c.high[idx] };
  }
  // Prior resistance = the peak BEFORE that one (quality-gate reference + S4 level).
  const priorPeak = ph.length >= 2 ? ph[ph.length - 2] : null;

  // Start of the last rise = the pivot low immediately before the peak.
  let riseLow = null;
  for (const p of pl) if (p.i < peak.i) riseLow = p;
  if (!riseLow && peak.i > 0) {
    const start = Math.max(0, peak.i - 20);
    let lo = Infinity, idx = start;
    for (let i = start; i < peak.i; i++) if (c.low[i] < lo) { lo = c.low[i]; idx = i; }
    if (isFinite(lo)) riseLow = { i: idx, price: lo };
  }

  // Within the correction (peak.i → last), the lowest candle by LOW (incl. tail);
  // its high is the break level, its index marks the new trough.
  let corrLowIdx = peak.i, corrLow = c.low[peak.i];
  for (let i = peak.i + 1; i <= last; i++) if (c.low[i] < corrLow) { corrLow = c.low[i]; corrLowIdx = i; }

  return { peak, priorPeak, riseLow, corrLowIdx, corrLow, last };
}

// ---------- the analysis ----------
// `candlesByTf` = { Monthly, Weekly, Daily } each {open,high,low,close,volume},
// oldest→newest. Technique 1 walks all three; Technique 2 uses only `timeframe`.
function analyze({ candlesByTf, timeframe, technique = 1, swingN = 2, market, lang, currency, lastDate }) {
  const M = MSG[lang === "he" ? "he" : "en"];
  const tech = technique === 2 ? 2 : 1;

  // The decision timeframe: Technique 2 trades a single chosen one; Technique 1
  // anchors strategy on the monthly, then a cascade picks the trade timeframe.
  const stratTf = tech === 2 ? timeframe : "Monthly";
  const stratC = candlesByTf[stratTf];

  const R = {};
  const put = (id, value, conf, why) => { R[id] = { value, conf, why }; };

  // ===== one timeframe's worth of indicators + structure =====
  const build = (c) => {
    const ma5 = smaSeries(c.close, 5);
    const ma20 = smaSeries(c.close, 20);
    const ma40 = smaSeries(c.close, 40);
    const volMa = smaSeries(c.volume, 5);                  // "short MA of volume"
    const cci = cciSeries(c.high, c.low, c.close, 5);
    const boll = bollSeries(c.close, 10, 1);
    const pivots = c.close.length < 3
      ? findPivotsClose(c.close, swingN)
      : findSequencePoints(c.open, c.high, c.low, c.close);
    const seg = segments(c, pivots);
    return { c, ma5, ma20, ma40, volMa, cci, boll, pivots, seg };
  };

  const S = build(stratC);
  const c = S.c, last = c.close.length - 1;
  const fmt = (x, d = 2) => (x == null || isNaN(x) ? "n/a" : Number(x).toFixed(d));
  const fmt0 = (x) => (x == null || isNaN(x) ? "n/a" : Math.round(x).toLocaleString());

  // ===== STEP 1 — STRATEGY (all must be YES), on stratTf, closing basis =====
  // S1 — peaks AND troughs both rising
  {
    const { ph, pl } = S.pivots;
    if (ph.length >= 2 && pl.length >= 2) {
      const risingPeaks = ph[ph.length - 1].price > ph[ph.length - 2].price;
      const risingTroughs = pl[pl.length - 1].price > pl[pl.length - 2].price;
      put("S1", risingPeaks && risingTroughs ? "yes" : "no", "swing",
        M.S1(fmt(ph[ph.length - 2].price), fmt(ph[ph.length - 1].price), fmt(pl[pl.length - 2].price), fmt(pl[pl.length - 1].price)));
    } else {
      const mid = Math.floor(c.close.length / 2);
      const peakUp = Math.max(...c.close.slice(mid)) > Math.max(...c.close.slice(0, mid));
      const troughUp = Math.min(...c.close.slice(mid)) > Math.min(...c.close.slice(0, mid));
      put("S1", peakUp && troughUp ? "yes" : "no", "guess", M.S1sparse());
    }
  }

  // S2 — volume rising or at least static: short MA of volume sloping up or flat
  {
    const a = S.volMa[last], b = S.volMa[last - 1];
    const ok = a != null && b != null && a >= b;
    put("S2", ok ? "yes" : "no", "swing", M.S2(fmt0(a), fmt0(b)));
  }

  // S3a — MA20 above MA40
  {
    const s = S.ma20[last], l = S.ma40[last];
    const ok = s != null && l != null && s > l;
    put("S3a", ok ? "yes" : "no", "exact", M.S3a(fmt(s), fmt(l), ok));
  }
  // S3b — MA40 slopes up, slope growing or at least equal (not flattening into decline)
  {
    const slopeNow = diff(S.ma40, last), slopePrev = diff(S.ma40, last - 1);
    const ok = slopeNow != null && slopePrev != null && slopeNow > 0 && slopeNow >= slopePrev;
    put("S3b", ok ? "yes" : "no", "exact", M.S3b(fmt(slopeNow, 3), fmt(slopePrev, 3), ok));
  }
  // S3c — gap between the two MAs widening or at least equal (not contracting)
  {
    const gapNow = sub(S.ma20[last], S.ma40[last]);
    const gapPrev = sub(S.ma20[last - 1], S.ma40[last - 1]);
    const ok = gapNow != null && gapPrev != null && gapNow >= gapPrev;
    put("S3c", ok ? "yes" : "no", "exact", M.S3c(fmt(gapNow, 3), fmt(gapPrev, 3), ok));
  }
  // S4 — last broken resistance now acting as support (closing basis)
  {
    const r = s4Support(c.close, S.pivots);
    put("S4", r.ok ? "yes" : "no", "guess", r.ok ? M.S4yes(fmt(r.level)) : M.S4no());
  }

  // ===== STEP 2 — TACTIC =====
  // Technique 2: single timeframe + MA5>MA20 entry gate (order 5>20>40 kept).
  if (tech === 2) {
    const a = S.ma5[last], b = S.ma20[last];
    const ok = a != null && b != null && a > b;
    put("G1", ok ? "yes" : "no", "exact", M.G1(fmt(a), fmt(b), ok));
  }

  // Technique 1: multi-timeframe cascade → trade horizon + timeframe.
  // The level where a falling sequence appears sets the horizon.
  const cascade = tech === 1
    ? runCascade(candlesByTf)
    : { horizon: TF_HORIZON[timeframe], tradeTf: timeframe, reason: "single" };
  const tradeTf = cascade.tradeTf;
  const TR = tradeTf && candlesByTf[tradeTf] ? build(candlesByTf[tradeTf]) : S; // Steps 3/4 run on the trade timeframe

  // ===== STEP 3 — CORRECTION CHECK (on the trade timeframe) =====
  const tc = TR.c, tlast = tc.close.length - 1, tseg = TR.seg;
  // C1 — falling sequence below MA5, MA5 sloping down
  {
    let below = false;
    for (let i = tseg.peak.i; i <= tlast; i++) if (TR.ma5[i] != null && tc.close[i] < TR.ma5[i]) { below = true; break; }
    const down = diff(TR.ma5, tlast) != null && diff(TR.ma5, tlast) < 0;
    put("C1", below && down ? "yes" : "no", "exact", M.C1(below, down));
  }
  // C2 — CCI(5) ≤ −100 during the correction, and entry is fresh (~3 candles)
  let cciCrossIdx = null;
  {
    let hit = false, min = Infinity;
    const start = Math.max(0, tseg.peak.i);
    for (let i = start; i <= tlast; i++) if (TR.cci[i] != null) {
      min = Math.min(min, TR.cci[i]);
      if (TR.cci[i] <= -100) { hit = true; if (cciCrossIdx == null) cciCrossIdx = i; }
    }
    // Freshness: most recent candle ≤ −100 within ~3 (4 borderline → fail) of last.
    let lastBelow = null;
    for (let i = tlast; i >= start; i--) if (TR.cci[i] != null && TR.cci[i] <= -100) { lastBelow = i; break; }
    const fresh = lastBelow != null && (tlast - lastBelow) <= 3;
    put("C2", hit && fresh ? "yes" : "no", "exact", M.C2(isFinite(min) ? Math.round(min) : null, fresh));
  }
  // C3 — ≥1 candle entirely below the low of the highest candle in the prior rise
  {
    const ref = tc.low[tseg.peak.i]; // low of the prior-rise high candle
    let under = false;
    for (let i = tseg.peak.i + 1; i <= tlast; i++) if (tc.high[i] < ref) { under = true; break; }
    put("C3", under ? "yes" : "no", "swing", M.C3(fmt(ref), under));
  }

  // ===== STEP 4 — TIMING CHECK (on the trade timeframe) =====
  // T1 — falling sequence broke up (close above the high of its lowest candle)
  //      + quality gate: the new trough must be above the prior peak (resistance).
  const breakLevel = tc.high[tseg.corrLowIdx];
  let breakIdx = null;
  for (let i = tseg.corrLowIdx + 1; i <= tlast; i++) if (tc.close[i] > breakLevel) { breakIdx = i; break; }
  const broke = breakIdx != null;
  const newTrough = tc.close[tseg.corrLowIdx];
  const priorPeakPrice = tseg.priorPeak ? tseg.priorPeak.price : null;
  const qualityOk = priorPeakPrice != null && newTrough > priorPeakPrice;
  put("T1", broke && qualityOk ? "yes" : "no", "swing", M.T1(broke, qualityOk));

  // ===== MATH (T2) =====
  // Entry = last close. The breaking candle (or the correction-low candle as a
  // pre-break stand-in) defines the stop (its low, incl. tail). Target = prior peak.
  const stopRefIdx = breakIdx != null ? breakIdx : tseg.corrLowIdx;
  const buy = tc.close[tlast];
  const stopLow = tc.low[stopRefIdx];
  const target = tseg.peak.price != null ? tseg.peak.price : null;
  const risk = ((buy - stopLow) / buy) * 100 * 1.5;       // 1.5 = slippage coefficient
  const reward = target != null ? ((target - buy) / buy) * 100 : null;
  const ratio = (reward != null && risk > 0) ? reward / risk : null;
  // Max limit-buy price giving exactly ratio = 1.5: b = (T + 2.25·low) / 3.25
  const maxBuy = target != null ? (target + 2.25 * stopLow) / 3.25 : null;
  const midCandle = (tc.high[stopRefIdx] + tc.low[stopRefIdx]) / 2; // buy-timing option A

  put("T2", ratio != null && ratio >= 1.5 ? "yes" : "no", "exact",
    M.T2(ratio == null ? null : ratio.toFixed(2)));

  // ===== MARKET-FIRST GATE (overriding principle) =====
  // Computed by the caller (needs an index fetch) and injected via opts.market…
  // Here we only record a placeholder; api/strategy.js fills M1 in before verdict.

  // ===== POSITION MANAGEMENT — risk-zero trigger (advisory) =====
  // Green candle entirely above a rising MA5 ⇒ risk ≈ 0 ⇒ cue to add next position.
  const lastK = candleAt(tc, tlast);
  const ma5Rising = diff(TR.ma5, tlast) != null && diff(TR.ma5, tlast) > 0;
  const riskZero = lastK.green && TR.ma5[tlast] != null && lastK.lo > TR.ma5[tlast] && ma5Rising;

  // ===== SELL SIGNALS (advisory monitoring levels) =====
  const sell = {
    risingSeqLow: tc.low[tseg.peak.i],     // close below ⇒ break of rising sequence ⇒ sell
    upperBand: TR.boll.up[tlast],          // red candle above it ⇒ weakness
    lastIsSeller: isSeller(lastK) && TR.boll.up[tlast] != null && lastK.hi > TR.boll.up[tlast],
  };

  return {
    meta: { technique: tech, stratTf, tradeTf, horizon: cascade.horizon, cascade, swingN, lastDate: lastDate ?? null, currency: currency ?? null },
    checks: R,
    math: { buy, stopLow, target, risk, reward, ratio, maxBuy, midCandle, broke, breakLevel },
    position: { riskZero, ma5Rising },
    sell,
    series: { ma5: TR.ma5, ma20: TR.ma20, ma40: TR.ma40, bollUp: TR.boll.up, bollLo: TR.boll.lo, cci: TR.cci },
    pivots: TR.pivots,
    segments: TR.seg,
    candles: tc,
  };
}

// horizon label for a single timeframe (Technique 2)
const TF_HORIZON = { Monthly: "long", Weekly: "medium", Daily: "short" };

// Does a falling sequence currently exist on this timeframe?
// Answered by the sequence engine itself: zigzagSequence's trailing
// provisional point is the running (not-yet-broken) sequence's extreme — a
// provisional trough means the chart is inside an active falling sequence.
function hasFallingSequence(c) {
  const pts = zigzagSequence(c);
  const last = pts[pts.length - 1];
  return !!(last && last.provisional && last.kind === "L");
}

// Technique 1 cascade: monthly → weekly → daily. The level where a falling
// sequence appears sets the trade horizon/timeframe. (Spec STEP 2, Technique 1.)
function runCascade(byTf) {
  const steps = [
    ["Monthly", "long"],
    ["Weekly", "medium"],
    ["Daily", "short"],
  ];
  for (const [tf, horizon] of steps) {
    const c = byTf[tf];
    if (c && hasFallingSequence(c)) return { horizon, tradeTf: tf, reason: "falling-sequence" };
  }
  // No falling sequence anywhere ⇒ drop to the daily and look for the break there
  // (short-term). If daily exists, trade it; otherwise no valid setup.
  if (byTf.Daily) return { horizon: "short", tradeTf: "Daily", reason: "daily-break-search" };
  return { horizon: "none", tradeTf: null, reason: "no-setup" };
}

// last broken resistance now acting as support. Uses sequence-peak highs as
// candidate resistances: a level that closes broke ABOVE and which a later
// pullback close held at/above (within tolerance).
function s4Support(closes, pivots) {
  const { ph } = pivots;
  const last = closes.length - 1;
  // Walk candidate resistances newest→oldest; return the most recent that qualifies.
  for (let p = ph.length - 1; p >= 0; p--) {
    const level = ph[p].price, tol = level * 0.02;
    let brokeAbove = false, heldAsSupport = false;
    for (let i = ph[p].i; i <= last; i++) {
      if (closes[i] > level + tol) brokeAbove = true;
      if (brokeAbove && closes[i] >= level - tol && closes[i] <= level + tol) heldAsSupport = true;
    }
    if (brokeAbove && heldAsSupport) return { ok: true, level };
  }
  return { ok: false, level: null };
}

// numeric helpers (null-safe)
function diff(arr, i) { return (i > 0 && arr[i] != null && arr[i - 1] != null) ? arr[i] - arr[i - 1] : null; }
function sub(a, b) { return (a != null && b != null) ? a - b : null; }

// ----- market-first gate, from a leading index's quarterly closes -----
// rising  → market supports entries
// falling → topping/falling: a per-stock buy is VOID
// mixed   → proceed pointwise only (does not void)
// unknown → could not read the index (does not void; warn)
function assessMarket(indexCandles) {
  if (!indexCandles || !indexCandles.close || indexCandles.close.length < 5)
    return { trend: "unknown" };
  const cl = indexCandles.close, last = cl.length - 1;
  const ma = smaSeries(cl, Math.min(4, cl.length));       // ~1yr of quarters
  const aboveMa = ma[last] != null && cl[last] > ma[last];
  const slopeUp = cl[last] >= cl[last - 1];
  const twoDown = cl[last] < cl[last - 1] && cl[last - 1] < cl[last - 2];
  let trend;
  if (aboveMa && slopeUp) trend = "rising";
  else if ((ma[last] != null && cl[last] < ma[last]) && twoDown) trend = "falling";
  else trend = "mixed";
  return { trend };
}

// Attach the market gate (M1) and resolve the final verdict.
function conclude(result, marketTrend, lang) {
  const M = MSG[lang === "he" ? "he" : "en"];
  const tech = result.meta.technique;

  // M1 — market-first gate
  const trend = marketTrend || "unknown";
  const m1val = trend === "falling" ? "no" : trend === "unknown" ? "na" : "yes";
  const m1why = trend === "rising" ? M.M1rising() : trend === "falling" ? M.M1falling()
    : trend === "mixed" ? M.M1mixed() : M.M1unknown();
  result.checks.M1 = { value: m1val, conf: "guess", why: m1why };

  const v = (id) => result.checks[id]?.value;
  const STRAT = ["S1", "S2", "S3a", "S3b", "S3c", "S4", ...(tech === 2 ? ["G1"] : [])];
  const CORR = ["C1", "C2", "C3"];
  const TIME = ["T1", "T2"];
  const all = ["M1", ...STRAT, ...CORR, ...TIME];

  const anyNull = all.some((id) => v(id) == null);
  const marketVoid = trend === "falling";
  const stratOk = STRAT.every((id) => v(id) === "yes");
  const corrOk = CORR.every((id) => v(id) === "yes");
  const t1Ok = v("T1") === "yes";
  const t2Ok = v("T2") === "yes";
  const noSetup = result.meta.horizon === "none";

  // first failing step (for the headline reason)
  let firstFail = null;
  for (const id of [...STRAT, ...CORR, ...TIME]) if (v(id) === "no") { firstFail = id; break; }

  let code;
  if (anyNull) code = "INCOMPLETE";
  else if (marketVoid) code = "MARKET_VOID";
  else if (!stratOk) code = "NO_TRADE";          // strategy failed ⇒ "do not buy"
  else if (noSetup) code = "NO_TRADE";           // no valid setup on any timeframe
  else if (!corrOk || !t1Ok) code = "DO_NOT_ENTER";
  else if (t2Ok) code = "BUY";                   // everything passes incl. ratio ≥ 1.5
  else code = "BUY_LIMIT";                        // strategy+correction+break ok, ratio short → limit entry

  return { code, firstFail, marketTrend: trend, stratOk, corrOk, t1Ok, t2Ok, horizon: result.meta.horizon };
}

module.exports = { analyze, conclude, assessMarket, smaSeries, cciSeries, bollSeries, findPivotsClose, runCascade };
