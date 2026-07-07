// ─────────────────────────────────────────────────────────────
// _engine.js — The 9-Question Method, implemented exactly per
// stock-analysis-guide.html. No indicators or rules from outside
// the document. Pure functions, no I/O — testable in isolation.
//
// Confidence tiers returned per check:
//   "exact"  — single deterministic formula (guide Tier 1)
//   "swing"  — deterministic given the swing-pivot setting (Tier 2)
//   "guess"  — best-effort interpretation, needs human confirm (Q4)
// ─────────────────────────────────────────────────────────────

// ---------- localized "why" messages ----------
// The math is language-agnostic; only the human-readable `why` line per check
// is localized. English is kept byte-for-byte identical to the original so the
// existing UI is unaffected; Hebrew is an idiomatic (not literal) rendering
// using standard trading vocabulary. Number formatting is done by the caller
// and passed in, so both languages share identical figures.
const MSG = {
  en: {
    P1: (v) => `20-day avg volume ≈ ${v}`,
    P2: (c, o) => `Last candle close ${c} vs open ${o}`,
    P3yes: (u, b) => `Upper tail ${u} < 2× body ${b}`,
    P3no: (u, b) => `Upper tail ${u} ≥ 2× body ${b} → seller`,
    P4yes: () => `Recent closes not strictly descending`,
    P4no: (n) => `Last ${n} closes each lower → falling`,
    P5cmp: (a, b) => `Latest swing low ${a} vs previous ${b}`,
    P5naRecent: () => `No falling sequence just broke`,
    P5naFew: () => `Not enough swing lows to compare`,
    Q1piv: (a, b, c, d) => `Peaks ${a}→${b}, troughs ${c}→${d}`,
    Q1sparse: () => `Sparse pivots — coarse half-vs-half structure check; confirm visually`,
    Q2: (rv, cv) => `Avg vol rise ≈ ${rv} vs correction ≈ ${cv}`,
    Q2null: () => `Could not segment rise/correction`,
    Q3: (up, below) => `Green line (13 SMA) ${up ? "rising" : "flat/down"}, red line (5 SMA) ${below ? "below" : "above"} green`,
    Q4: () => `Auto-detected level — confirm visually: a prior ceiling that broke and then held as a floor`,
    Q5: (below, down) => `Price ${below ? "went below" : "stayed above"} red line (5 SMA); red line ${down ? "sloping down" : "not down"}`,
    Q6: (m) => `Min CCI(5) in correction ≈ ${m ?? "n/a"} (need < −100)`,
    Q7: (p, under) => `Prior sequence low ${p}; ${under ? "a candle closed entirely below it" : "no full undercut"}`,
    Q7null: () => `Could not locate prior sequence low`,
    Q8: (k1, k2) => `${k1 ? "K1 break-up ✓ " : ""}${k2 ? "K2 close > red line (5 SMA) ✓" : (!k1 ? "neither K1 nor K2" : "")}`.trim(),
    Q9: (k3, k4) => `${k3 ? "K3 green<band ✓ " : ""}${k4 ? "K4 buyer<band ✓" : (!k3 ? "no candle fully below lower band" : "")}`.trim(),
  },
  he: {
    P1: (v) => `מחזור ממוצע ל-20 ימים ≈ ${v}`,
    P2: (c, o) => `סגירת הנר האחרון ${c} מול פתיחה ${o}`,
    P3yes: (u, b) => `צל עליון ${u} < פי 2 מהגוף ${b}`,
    P3no: (u, b) => `צל עליון ${u} ≥ פי 2 מהגוף ${b} ← נר מוכרים`,
    P4yes: () => `הסגירות האחרונות אינן בירידה רציפה`,
    P4no: (n) => `${n} הסגירות האחרונות יורדות ברצף ← רצף יורד`,
    P5cmp: (a, b) => `שפל אחרון ${a} מול השפל הקודם ${b}`,
    P5naRecent: () => `לא נשבר לאחרונה רצף יורד`,
    P5naFew: () => `אין מספיק נקודות שפל להשוואה`,
    Q1piv: (a, b, c, d) => `פסגות ${a}→${b}, שפלים ${c}→${d}`,
    Q1sparse: () => `מעט נקודות מפנה — בדיקת מבנה גסה (מחצית מול מחצית); ודאו ויזואלית`,
    Q2: (rv, cv) => `מחזור ממוצע בעלייה ≈ ${rv} מול בתיקון ≈ ${cv}`,
    Q2null: () => `לא ניתן לבודד את העלייה/התיקון`,
    Q3: (up, below) => `הקו הירוק (SMA 13) ${up ? "עולה" : "שטוח/יורד"}, האדום (SMA 5) ${below ? "מתחת" : "מעל"} לירוק`,
    Q4: () => `רמה שזוהתה אוטומטית — ודאו ויזואלית: תקרה קודמת שנשברה והפכה לרצפה (תמיכה)`,
    Q5: (below, down) => `המחיר ${below ? "ירד מתחת ל" : "נשאר מעל ה"}קו האדום (SMA 5); הקו האדום ${down ? "במגמת ירידה" : "אינו יורד"}`,
    Q6: (m) => `CCI(5) מינימלי בתיקון ≈ ${m ?? "אין"} (נדרש < ‎−100)`,
    Q7: (p, under) => `שפל הרצף הקודם ${p}; ${under ? "נר ירד כולו מתחתיו" : "אין חדירה מלאה מתחתיו"}`,
    Q7null: () => `לא אותר שפל הרצף הקודם`,
    Q8: (k1, k2) => `${k1 ? "K1 שבירה כלפי מעלה ✓ " : ""}${k2 ? "K2 סגירה מעל האדום (SMA 5) ✓" : (!k1 ? "לא K1 ולא K2" : "")}`.trim(),
    Q9: (k3, k4) => `${k3 ? "K3 נר ירוק מתחת לרצועה ✓ " : ""}${k4 ? "K4 נר קונים מתחת לרצועה ✓" : (!k3 ? "אין נר כולו מתחת לרצועה התחתונה" : "")}`.trim(),
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

// Red line = 5 SMA applied to the green line (13 SMA). Per guide.
function redLineSeries(greenLine, p = 5) {
  // greenLine has leading nulls; SMA over the non-null green values,
  // aligned back to original indices.
  const out = Array(greenLine.length).fill(null);
  const buf = [];
  for (let i = 0; i < greenLine.length; i++) {
    if (greenLine[i] == null) { buf.length = 0; continue; }
    buf.push(greenLine[i]);
    if (buf.length > p) buf.shift();
    if (buf.length === p) out[i] = buf.reduce((a, b) => a + b, 0) / p;
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

// Bollinger lower band (10/1): SMA(10) - 1 * stdev(10). Per guide (10/1).
function bollLowerSeries(closes, p = 10, mult = 1) {
  const out = Array(closes.length).fill(null);
  for (let i = p - 1; i < closes.length; i++) {
    let mean = 0;
    for (let k = i - p + 1; k <= i; k++) mean += closes[k];
    mean /= p;
    let varr = 0;
    for (let k = i - p + 1; k <= i; k++) varr += (closes[k] - mean) ** 2;
    const sd = Math.sqrt(varr / p);
    out[i] = mean - mult * sd;
  }
  return out;
}

// ---------- candle helpers ----------
function candleAt(c, i) {
  const o = c.open[i], cl = c.close[i], hi = c.high[i], lo = c.low[i];
  const body = Math.abs(cl - o);
  const upper = hi - Math.max(o, cl);
  const lower = Math.min(o, cl) - lo;
  return { o, c: cl, hi, lo, body, upper, lower, green: cl > o };
}
const isSeller = (k) => k.green && k.upper >= 2 * k.body && k.body > 0;
const isBuyer = (k) => k.green && k.lower >= 2 * k.body && k.body > 0;

// ---------- sequence structure — the course's EXACT definition ----------
// Swing highs/lows come from a running-extreme sequence, judged on the CLOSE
// against the WICK (tail-inclusive extreme) of the running-extreme candle —
// NOT from fractal ±N pivots.
//
//   RISING sequence — running peak = highest-HIGH candle so far in the run.
//     • Continues while the close stays ≥ the LOW of the running-peak candle.
//     • A new higher high moves the running peak forward.
//     • ENDS when a candle CLOSES BELOW the running-peak candle's low → that
//       running peak is a confirmed swing HIGH; a falling sequence begins.
//       (This break rule is identical to sell signal S1.)
//   FALLING sequence — running trough = lowest-LOW candle so far (mirror).
//     • Continues while the close stays ≤ the HIGH of the running-trough candle.
//     • A new lower low moves the running trough forward.
//     • ENDS when a candle CLOSES ABOVE the running-trough candle's high → that
//       running trough is a confirmed swing LOW; a rising sequence begins.
//
// Breaks are judged by the CLOSE; the reference level is the extreme candle's
// wick (its low for a peak, its high for a trough). Points are confirmed only
// on the close of the breaking bar — no look-ahead. Returns the ordered
// confirmed swing highs/lows (each with candle index, high, low, close, and the
// index of the bar that broke/confirmed it) plus the in-progress sequence and
// its running extreme. Drives Q1/Q2/Q5/Q6/Q7/Q8, the highest-high target, and
// sell signal S1.
function sequenceStructure(open, high, low, close) {
  const n = close.length;
  const highs = [], lows = [];
  if (n === 0) return { highs, lows, current: { dir: 0, extremeIdx: null } };

  // Initialize direction from the opening candles: if the second bar closes
  // below the first bar's close we open in a falling sequence, otherwise rising.
  // Candle 0 is the initial running extreme either way; a wrong initial guess
  // self-corrects at the first real break.
  let dir = (n >= 2 && close[1] < close[0]) ? -1 : 1;
  let extremeIdx = 0;

  for (let i = 1; i < n; i++) {
    if (dir === 1) {
      // Rising: a new higher high advances the running peak.
      if (high[i] > high[extremeIdx]) { extremeIdx = i; continue; }
      // Break: a close below the running-peak candle's low confirms the peak.
      // (close == low does NOT break — strict inequality.)
      if (close[i] < low[extremeIdx]) {
        highs.push({ i: extremeIdx, high: high[extremeIdx], low: low[extremeIdx], close: close[extremeIdx], breakIdx: i });
        dir = -1; extremeIdx = i;
      }
      // else: sequence continues, running peak unchanged.
    } else {
      // Falling: a new lower low advances the running trough.
      if (low[i] < low[extremeIdx]) { extremeIdx = i; continue; }
      // Break: a close above the running-trough candle's high confirms the trough.
      if (close[i] > high[extremeIdx]) {
        lows.push({ i: extremeIdx, low: low[extremeIdx], high: high[extremeIdx], close: close[extremeIdx], breakIdx: i });
        dir = 1; extremeIdx = i;
      }
      // else: sequence continues, running trough unchanged.
    }
  }
  return { highs, lows, current: { dir, extremeIdx } };
}

// Back-compat adapter → the { ph, pl } shape the rest of the codebase consumes
// (chart zigzag, tracker, sequence tool). Peaks carry their high, troughs their
// low — same shape as before, now sourced from the exact sequence model above.
function findSequencePoints(open, high, low, close) {
  const s = sequenceStructure(open, high, low, close);
  return {
    ph: s.highs.map((h) => ({ i: h.i, price: h.high })),
    pl: s.lows.map((l) => ({ i: l.i, price: l.low })),
  };
}

// Sell signal S1 (course exit #1): the entry candle broke the CURRENT rising
// sequence — it closed below the low of that sequence's running peak. Uses the
// exact same peak definition as sequenceStructure (a confirmed swing high whose
// break bar is the entry candle), so the walker and the sell signal never
// disagree. `asOf` selects the entry candle (defaults to the last bar).
function sequenceSellS1(candles, asOf) {
  const { open, high, low, close } = candles;
  const last = asOf == null ? close.length - 1 : asOf;
  const sub = { open: open.slice(0, last + 1), high: high.slice(0, last + 1), low: low.slice(0, last + 1), close: close.slice(0, last + 1) };
  const s = sequenceStructure(sub.open, sub.high, sub.low, sub.close);
  const lastHigh = s.highs.length ? s.highs[s.highs.length - 1] : null;
  return {
    fired: lastHigh != null && lastHigh.breakIdx === last,
    peakIdx: lastHigh ? lastHigh.i : null,
    peakLow: lastHigh ? low[lastHigh.i] : null,
  };
}

// ---------- swing detection (pivot lookback) — LEGACY ----------
// A pivot high at i: high[i] strictly greater than the `n` highs on each side.
// Mirror for pivot lows. Retained only as a fallback for degenerate inputs;
// the default detection path is findSequencePoints above.
function findPivots(highs, lows, n = 2) {
  const ph = [], pl = [];
  for (let i = n; i < highs.length - n; i++) {
    let isH = true, isL = true;
    for (let k = 1; k <= n; k++) {
      // Strict on one side, non-strict on the other → tolerates flat/equal bars.
      if (!(highs[i] >= highs[i - k] && highs[i] > highs[i + k])) isH = false;
      if (!(lows[i] <= lows[i - k] && lows[i] < lows[i + k])) isL = false;
    }
    if (isH) ph.push({ i, price: highs[i] });
    if (isL) pl.push({ i, price: lows[i] });
  }
  return { ph, pl };
}

// Identify the most recent rising sequence and the correction that follows it.
// Returns indices and the key prices the math + Q7/Q8 need. `struct` is the
// output of sequenceStructure ({ highs, lows, current }).
function segments(c, struct) {
  const { highs, lows } = struct;
  const lastIdx = c.close.length - 1;
  // Highest High = the peak of the MOST RECENT rising sequence before the
  // current correction = the LAST confirmed swing high. This is the reward
  // target / prior resistance the correction fell from (NOT the maximum peak
  // over all history — the method targets "the prior peak", not the record high).
  let highestHigh = null, highestHighIdx = null;
  if (highs.length) {
    const peak = highs[highs.length - 1];
    highestHigh = peak.high; highestHighIdx = peak.i;
  } else {
    // Fallback (degenerate / no confirmed peak yet): the highest high overall.
    highestHighIdx = c.high.indexOf(Math.max(...c.high));
    highestHigh = c.high[highestHighIdx];
  }
  // Prior sequence low = the trough the most recent rising sequence LAUNCHED
  // FROM = the last confirmed swing low BEFORE that peak (the Q7 anchor).
  let priorSeqLow = null, priorSeqLowIdx = null;
  for (const l of lows) if (l.i < highestHighIdx) { priorSeqLow = l.low; priorSeqLowIdx = l.i; }
  // Fallback: no confirmed trough before the high → lowest low in the window
  // leading up to the high (the base the rise launched from).
  if (priorSeqLow == null && highestHighIdx > 0) {
    const start = Math.max(0, highestHighIdx - 20);
    let lo = Infinity, idx = start;
    for (let i = start; i < highestHighIdx; i++) if (c.low[i] < lo) { lo = c.low[i]; idx = i; }
    if (isFinite(lo)) { priorSeqLow = lo; priorSeqLowIdx = idx; }
  }
  // The correction's own bottom = the MOST RECENT confirmed swing low AFTER the
  // peak (present once the falling sequence has broken up). breakIdx marks the
  // bar that ended the correction (the turn-up) — used by Q8 K1.
  let corrLow = null, corrLowIdx = null, corrBreakIdx = null;
  for (const l of lows) if (l.i > highestHighIdx) { corrLow = l.low; corrLowIdx = l.i; corrBreakIdx = l.breakIdx; }
  return { highestHigh, highestHighIdx, priorSeqLow, priorSeqLowIdx, corrLow, corrLowIdx, corrBreakIdx, lastIdx };
}

// ---------- the analysis ----------
function analyze(candles, opts = {}) {
  const swingN = opts.swingN ?? 2;
  const fallLen = opts.fallLen ?? 2; // consecutive lower closes = "falling sequence"
  const M = MSG[opts.lang === "he" ? "he" : "en"]; // localized `why` strings
  const c = candles; // {open,high,low,close,volume} arrays, oldest→newest
  const N = c.close.length;
  const last = N - 1;

  const green13 = smaSeries(c.close, 13);
  const red = redLineSeries(green13, 5);
  const cci = cciSeries(c.high, c.low, c.close, 5);
  const bollLo = bollLowerSeries(c.close, 10, 1);
  // Method-correct points come from the sequence structure. swingN is accepted
  // and echoed in meta for API/UI compatibility but no longer affects detection;
  // the windowed findPivots remains only as a fallback for degenerate inputs.
  const struct = N < 3
    ? { highs: [], lows: [], current: { dir: 0, extremeIdx: null } }
    : sequenceStructure(c.open, c.high, c.low, c.close);
  // { ph, pl } view for the chart/API zigzag and the sparse-Q1/P5 fallbacks.
  const pivots = N < 3
    ? findPivots(c.high, c.low, swingN)
    : { ph: struct.highs.map((h) => ({ i: h.i, price: h.high })), pl: struct.lows.map((l) => ({ i: l.i, price: l.low })) };
  const seg = segments(c, struct);
  // Most recent confirmed swing low (correction bottom / turn-up) and swing high.
  const lastLow = struct.lows.length ? struct.lows[struct.lows.length - 1] : null;
  const lastHigh = struct.highs.length ? struct.highs[struct.highs.length - 1] : null;

  const k = (i) => candleAt(c, i);
  const lastK = k(last);
  const R = {}; // results keyed by check id: {value, conf, why}

  const put = (id, value, conf, why) => { R[id] = { value, conf, why }; };

  // ===== PRE-FILTER =====
  const avgVol = c.volume.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, N);
  put("P1", avgVol > 1_000_000 ? "yes" : "no", "exact",
    M.P1(Math.round(avgVol).toLocaleString()));

  put("P2", lastK.green ? "yes" : "no", "exact",
    M.P2(lastK.c, lastK.o));

  put("P3", isSeller(lastK) ? "no" : "yes", "exact",
    isSeller(lastK) ? M.P3no(lastK.upper.toFixed(2), lastK.body.toFixed(2))
      : M.P3yes(lastK.upper.toFixed(2), lastK.body.toFixed(2)));

  // P4 — not in a falling sequence (last `fallLen` closes strictly lower-and-lower)
  let falling = true;
  for (let i = last; i > last - fallLen; i--) if (!(c.close[i] < c.close[i - 1])) falling = false;
  put("P4", falling ? "no" : "yes", "exact",
    falling ? M.P4no(fallLen) : M.P4yes());

  // P5 — the prior UPTREND was making HIGHER LOWS: its last two swing lows,
  // strictly BEFORE the most recent peak (Phase A, excluding the current
  // correction's own bottom), are ascending. Anchoring to the uptrend troughs —
  // not "the last two confirmed lows" — keeps P5 consistent with the phase model
  // so the correction's launch-trough undercut (Q7) does not spuriously fail this
  // pre-filter. N/A when there aren't two uptrend lows to compare.
  const upLowsP5 = pivots.pl.filter((p) => seg.highestHighIdx == null || p.i < seg.highestHighIdx);
  if (upLowsP5.length >= 2) {
    const a = upLowsP5[upLowsP5.length - 1], b = upLowsP5[upLowsP5.length - 2];
    put("P5", a.price > b.price ? "yes" : "no", "swing",
      M.P5cmp(a.price.toFixed(2), b.price.toFixed(2)));
  } else put("P5", "na", "swing", M.P5naFew());

  // ===== PHASE A ===== (the PRIOR UPTREND, up to the most recent peak)
  // Q1 — rising peaks AND rising troughs (last 2 of each) in the uptrend that
  // preceded the current correction. Restricted to swing highs at/before the
  // most recent peak and swing lows strictly before it, so the correction's own
  // (lower) bottom — Phase B — is NOT counted against the Phase-A structure.
  const ph = pivots.ph.filter((p) => seg.highestHighIdx == null || p.i <= seg.highestHighIdx);
  const pl = pivots.pl.filter((p) => seg.highestHighIdx == null || p.i < seg.highestHighIdx);
  if (ph.length >= 2 && pl.length >= 2) {
    const risingPeaks = ph[ph.length - 1].price > ph[ph.length - 2].price;
    const risingTroughs = pl[pl.length - 1].price > pl[pl.length - 2].price;
    put("Q1", risingPeaks && risingTroughs ? "yes" : "no", "swing",
      M.Q1piv(ph[ph.length-2].price.toFixed(2), ph[ph.length-1].price.toFixed(2), pl[pl.length-2].price.toFixed(2), pl[pl.length-1].price.toFixed(2)));
  } else {
    // Sparse pivots → compare first vs second half highs/lows as a coarse proxy.
    const mid = Math.floor(N / 2);
    const maxOf = (arr, a, b) => Math.max(...arr.slice(a, b));
    const minOf = (arr, a, b) => Math.min(...arr.slice(a, b));
    const peakUp = maxOf(c.high, mid, N) > maxOf(c.high, 0, mid);
    const troughUp = minOf(c.low, mid, N) > minOf(c.low, 0, mid);
    put("Q1", peakUp && troughUp ? "yes" : "no", "guess", M.Q1sparse());
  }

  // Q2 — volume expanded on the last rise vs the correction
  if (seg.highestHighIdx != null && seg.priorSeqLowIdx != null) {
    const riseVol = c.volume.slice(seg.priorSeqLowIdx, seg.highestHighIdx + 1);
    const corrVol = c.volume.slice(seg.highestHighIdx + 1, last + 1);
    const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const rv = avg(riseVol), cv = avg(corrVol);
    put("Q2", rv > cv ? "yes" : "no", "swing",
      M.Q2(Math.round(rv).toLocaleString(), Math.round(cv).toLocaleString()));
  } else put("Q2", null, "swing", M.Q2null());

  // Q3 — TREND confirmation, measured over the RISING sequence (at the highest
  // high), NOT at `last`. By the method's design `last` sits at the bottom of
  // the pullback, so the green line is falling and the red 5-SMA has crossed
  // above it there — measuring the trend at `last` is self-defeating and
  // contradicts Q5 (which needs the red line falling at `last`). We ask
  // "was the trend up when the rise topped?": green line (13 SMA) rising into
  // the high AND red line (5 SMA) below green there.
  let q3Idx = seg.highestHighIdx != null ? seg.highestHighIdx : last;
  // Ensure a valid prior bar with non-null MA values at the reference point.
  while (q3Idx > 1 && (green13[q3Idx] == null || green13[q3Idx - 1] == null || red[q3Idx] == null)) q3Idx--;
  const greenUp = green13[q3Idx] != null && green13[q3Idx - 1] != null && green13[q3Idx] > green13[q3Idx - 1];
  const redBelow = red[q3Idx] != null && green13[q3Idx] != null && red[q3Idx] < green13[q3Idx];
  put("Q3", greenUp && redBelow ? "yes" : "no", "exact",
    M.Q3(greenUp, redBelow));

  // Q4 — broken resistance became support. Best-guess (Tier 3).
  put("Q4", q4Guess(c, pivots), "guess", M.Q4());

  // ===== PHASE B =====
  // Q5 — over the CURRENT falling sequence (the correction, from the most recent
  // peak through the entry candle) price closed below the red line, AND the red
  // line is sloping down at the entry candle. The span is the DETECTED
  // correction (peak→entry), not a fixed trailing window.
  let belowRed = false;
  if (seg.highestHighIdx != null) {
    for (let i = seg.highestHighIdx; i <= last; i++)
      if (red[i] != null && c.close[i] < red[i]) { belowRed = true; break; }
  }
  const redDown = red[last] != null && red[last - 1] != null && red[last] < red[last - 1];
  put("Q5", belowRed && redDown ? "yes" : "no", "exact",
    M.Q5(belowRed, redDown));

  // Q6 — CCI(5) dropped below −100 somewhere in the current falling sequence
  // (the detected correction, peak→entry — not a fixed trailing window).
  let cciHit = false, cciMin = Infinity;
  const cStart = seg.highestHighIdx ?? Math.max(0, last - 15);
  for (let i = cStart; i <= last; i++) if (cci[i] != null) { cciMin = Math.min(cciMin, cci[i]); if (cci[i] < -100) cciHit = true; }
  put("Q6", cciHit ? "yes" : "no", "exact",
    M.Q6(isFinite(cciMin) ? cciMin.toFixed(0) : null));

  // Q7 — ≥1 candle in the current correction is COMPLETELY below the swing LOW
  // that the most recent rising sequence LAUNCHED FROM (the last confirmed
  // trough before the peak = seg.priorSeqLow), incl. upper tail (high < level).
  // This is the course's "prior sequence low" undercut: it confirms the falling
  // sequence gave back the whole most-recent leg. Because Q1/P5 measure the
  // PRIOR-UPTREND structure (Phase A, up to the peak) and this measures the
  // CORRECTION (Phase B), the two describe different stretches and do not
  // conflict — the correction's own lower low is not counted against the uptrend.
  if (seg.priorSeqLow != null && seg.highestHighIdx != null) {
    let undercut = false;
    for (let i = seg.highestHighIdx + 1; i <= last; i++) if (c.high[i] < seg.priorSeqLow) { undercut = true; break; }
    put("Q7", undercut ? "yes" : "no", "swing",
      M.Q7(seg.priorSeqLow.toFixed(2), undercut));
  } else put("Q7", null, "swing", M.Q7null());

  // ===== PHASE C ===== (only one Yes needed)
  // Q8 — K1: the current correction's falling sequence broke UP by the sequence
  //      rule (a candle closed above the running-trough candle's high) — i.e. a
  //      swing low was confirmed AFTER the peak, with the break at/near the entry
  //      candle. K2: the entry candle closed above the red line (5 SMA).
  const k1 = lastLow != null && seg.highestHighIdx != null &&
    lastLow.i > seg.highestHighIdx && (last - lastLow.breakIdx) <= 3;
  const k2 = red[last] != null && c.close[last] > red[last];
  put("Q8", (k1 || k2) ? "yes" : "no", "exact", M.Q8(k1, k2));

  // Q9 — green (K3) or buyer (K4) candle entirely below lower Bollinger band (10/1)
  let k3 = false, k4 = false;
  for (let i = Math.max(0, last - 5); i <= last; i++) {
    if (bollLo[i] == null) continue;
    const kk = k(i);
    const entirelyBelow = kk.hi < bollLo[i];
    if (entirelyBelow && kk.green) k3 = true;
    if (entirelyBelow && isBuyer(kk)) k4 = true;
  }
  put("Q9", (k3 || k4) ? "yes" : "no", "exact", M.Q9(k3, k4));

  // ===== MATH =====
  const buy = c.close[last];
  const candleLow = c.low[last];
  const highestHigh = seg.highestHigh;
  const risk = ((buy - candleLow) / buy) * 100 * 1.5;
  const reward = ((highestHigh - buy) / buy) * 100;
  const ratio = risk > 0 ? reward / risk : null;
  const maxBuy = (highestHigh + 1.5 * candleLow) / (1 + 1.5 * 1.5);

  const triggeredK = [];
  if (R.Q8.value === "yes") { if (k1) triggeredK.push("K1"); if (k2) triggeredK.push("K2"); }
  if (R.Q9.value === "yes") { if (k3) triggeredK.push("K3"); if (k4) triggeredK.push("K4"); }

  // Sell signal S1 (exit): the entry candle broke the current rising sequence —
  // it closed below the low of that sequence's running peak. Reuses the exact
  // swing-high definition from sequenceStructure (a confirmed peak whose break
  // bar IS the entry candle), so the buy walker and the sell signal agree.
  const sellS1 = lastHigh != null && lastHigh.breakIdx === last;

  return {
    meta: { bars: N, swingN, lastDate: opts.lastDate ?? null, currency: opts.currency ?? null },
    checks: R,
    math: { buy, candleLow, highestHigh, risk, reward, ratio, maxBuy, triggeredK },
    series: { green13, red, cci, bollLo },
    pivots,
    segments: seg,
    sell: { S1: sellS1, peakIdx: lastHigh ? lastHigh.i : null, peakLow: lastHigh ? c.low[lastHigh.i] : null },
  };
}

// Q4 heuristic: cluster prior pivot highs into a level, check it broke and later held as support.
function q4Guess(c, pivots) {
  const { ph } = pivots;
  if (ph.length < 2) return "no"; // can't find a tested level → treat as not-confirmed, not a blocker
  // Take an earlier pivot-high cluster as candidate resistance.
  const level = ph[Math.max(0, ph.length - 3)]?.price ?? ph[0].price;
  const last = c.close.length - 1;
  const tol = level * 0.02;
  let brokeAbove = false, heldAsSupport = false;
  for (let i = 0; i <= last; i++) {
    // Closing-basis break (doc S4: measured on close, not highs).
    if (c.close[i] > level + tol) brokeAbove = true;
    // Held as support: after the break, price revisited the level (low reached
    // near/into it) yet CLOSED back above it → the old ceiling acts as a floor.
    // Relaxed from the previous "close strictly above level" to "close ≥ level −
    // tol" so a clean hold at the level still counts.
    if (brokeAbove && c.low[i] <= level + tol && c.close[i] >= level - tol) heldAsSupport = true;
  }
  return brokeAbove && heldAsSupport ? "yes" : "no";
}

// ----- conclusion resolver (mirrors the guide's outcomes) -----
function conclude(result) {
  const v = (id) => result.checks[id]?.value;
  const PRE = ["P1", "P2", "P3", "P4", "P5"];
  // Q4 (broken-resistance-became-support) is a GUESS-tier heuristic that the
  // README itself flags as needing visual confirmation. It is deliberately NOT
  // in the deterministic Phase-A gate below — a best-effort guess must not
  // hard-fail an otherwise-valid automated verdict. It is still computed and
  // surfaced (as `q4Advisory`) so the UI can prompt "confirm visually".
  const A = ["Q1", "Q2", "Q3"], B = ["Q5", "Q6", "Q7"], C = ["Q8", "Q9"];
  const anyNull = [...PRE, ...A, ...B, ...C].some((id) => v(id) == null);
  const preOk = PRE.every((id) => v(id) === "yes" || v(id) === "na");
  const aOk = A.every((id) => v(id) === "yes");
  const bOk = B.every((id) => v(id) === "yes");
  const cOk = C.some((id) => v(id) === "yes");
  const q4Advisory = v("Q4"); // "yes" | "no" — advisory only, never gates the verdict
  const allPass = preOk && aOk && bOk && cOk;
  const ratio = result.math.ratio;
  const ratioOk = ratio != null && ratio >= 1.5;

  let firstFail = null;
  for (const id of [...PRE, ...A, ...B]) if (v(id) === "no") { firstFail = id; break; }
  if (!firstFail && !cOk) firstFail = "Q8/Q9";

  let code;
  if (anyNull) code = "INCOMPLETE";
  else if (allPass && ratioOk) code = "BUY";
  else if (allPass && !ratioOk) code = "BUY_LIMIT";
  else code = "DO_NOT_ENTER";

  return { code, firstFail, preOk, aOk, bOk, cOk, q4Advisory, allPass, ratioOk };
}

module.exports = { analyze, conclude, smaSeries, redLineSeries, cciSeries, bollLowerSeries, findPivots, findSequencePoints, sequenceStructure, sequenceSellS1 };
