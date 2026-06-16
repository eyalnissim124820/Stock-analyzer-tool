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

// ---------- swing detection (pivot lookback) ----------
// A pivot high at i: high[i] strictly greater than the `n` highs on each side.
// Mirror for pivot lows. Drives Q1, P5, Q7, and the highest-high target.
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

// Identify the last rising sequence and the correction that follows it.
// Returns indices and the key prices the math + Q7 need.
function segments(c, pivots) {
  const { ph, pl } = pivots;
  const lastIdx = c.close.length - 1;
  // Highest pivot high overall recent = end of last rise (the "highest high").
  let highestHigh = null, highestHighIdx = null;
  for (const p of ph) if (highestHigh == null || p.price >= highestHigh) { highestHigh = p.price; highestHighIdx = p.i; }
  // Fallback: if no clean pivot high, use max high of series.
  if (highestHigh == null) {
    highestHighIdx = c.high.indexOf(Math.max(...c.high));
    highestHigh = c.high[highestHighIdx];
  }
  // Prior rising-sequence low = the pivot low immediately BEFORE the highest high.
  let priorSeqLow = null, priorSeqLowIdx = null;
  for (const p of pl) if (p.i < highestHighIdx) { priorSeqLow = p.price; priorSeqLowIdx = p.i; }
  // Fallback: no clean pivot low before the high → use the lowest low in the
  // window leading up to the high (the base the rise launched from).
  if (priorSeqLow == null && highestHighIdx > 0) {
    const start = Math.max(0, highestHighIdx - 20);
    let lo = Infinity, idx = start;
    for (let i = start; i < highestHighIdx; i++) if (c.low[i] < lo) { lo = c.low[i]; idx = i; }
    if (isFinite(lo)) { priorSeqLow = lo; priorSeqLowIdx = idx; }
  }
  return { highestHigh, highestHighIdx, priorSeqLow, priorSeqLowIdx, lastIdx };
}

// ---------- the analysis ----------
function analyze(candles, opts = {}) {
  const swingN = opts.swingN ?? 2;
  const fallLen = opts.fallLen ?? 2; // consecutive lower closes = "falling sequence"
  const c = candles; // {open,high,low,close,volume} arrays, oldest→newest
  const N = c.close.length;
  const last = N - 1;

  const green13 = smaSeries(c.close, 13);
  const red = redLineSeries(green13, 5);
  const cci = cciSeries(c.high, c.low, c.close, 5);
  const bollLo = bollLowerSeries(c.close, 10, 1);
  const pivots = findPivots(c.high, c.low, swingN);
  const seg = segments(c, pivots);

  const k = (i) => candleAt(c, i);
  const lastK = k(last);
  const R = {}; // results keyed by check id: {value, conf, why}

  const put = (id, value, conf, why) => { R[id] = { value, conf, why }; };

  // ===== PRE-FILTER =====
  const avgVol = c.volume.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, N);
  put("P1", avgVol > 1_000_000 ? "yes" : "no", "exact",
    `20-day avg volume ≈ ${Math.round(avgVol).toLocaleString()}`);

  put("P2", lastK.green ? "yes" : "no", "exact",
    `Last candle close ${lastK.c} vs open ${lastK.o}`);

  put("P3", isSeller(lastK) ? "no" : "yes", "exact",
    isSeller(lastK) ? `Upper tail ${lastK.upper.toFixed(2)} ≥ 2× body ${lastK.body.toFixed(2)} → seller`
      : `Upper tail ${lastK.upper.toFixed(2)} < 2× body ${lastK.body.toFixed(2)}`);

  // P4 — not in a falling sequence (last `fallLen` closes strictly lower-and-lower)
  let falling = true;
  for (let i = last; i > last - fallLen; i--) if (!(c.close[i] < c.close[i - 1])) falling = false;
  put("P4", falling ? "no" : "yes", "exact",
    falling ? `Last ${fallLen} closes each lower → falling` : "Recent closes not strictly descending");

  // P5 — only if a fall just broke: latest swing low > previous swing low. Else N/A.
  const lows = pivots.pl;
  if (lows.length >= 2) {
    const a = lows[lows.length - 1], b = lows[lows.length - 2];
    // "just broke" heuristic: most recent pivot low is within last ~6 candles
    const recentlyBroke = last - a.i <= 6;
    if (recentlyBroke) {
      put("P5", a.price > b.price ? "yes" : "no", "swing",
        `Latest swing low ${a.price.toFixed(2)} vs previous ${b.price.toFixed(2)}`);
    } else put("P5", "na", "swing", "No falling sequence just broke");
  } else put("P5", "na", "swing", "Not enough swing lows to compare");

  // ===== PHASE A =====
  // Q1 — rising peaks AND rising troughs (last 2 of each)
  const ph = pivots.ph, pl = pivots.pl;
  if (ph.length >= 2 && pl.length >= 2) {
    const risingPeaks = ph[ph.length - 1].price > ph[ph.length - 2].price;
    const risingTroughs = pl[pl.length - 1].price > pl[pl.length - 2].price;
    put("Q1", risingPeaks && risingTroughs ? "yes" : "no", "swing",
      `Peaks ${ph[ph.length-2].price.toFixed(2)}→${ph[ph.length-1].price.toFixed(2)}, troughs ${pl[pl.length-2].price.toFixed(2)}→${pl[pl.length-1].price.toFixed(2)}`);
  } else {
    // Sparse pivots → compare first vs second half highs/lows as a coarse proxy.
    const mid = Math.floor(N / 2);
    const maxOf = (arr, a, b) => Math.max(...arr.slice(a, b));
    const minOf = (arr, a, b) => Math.min(...arr.slice(a, b));
    const peakUp = maxOf(c.high, mid, N) > maxOf(c.high, 0, mid);
    const troughUp = minOf(c.low, mid, N) > minOf(c.low, 0, mid);
    put("Q1", peakUp && troughUp ? "yes" : "no", "guess",
      "Sparse pivots — coarse half-vs-half structure check; confirm visually");
  }

  // Q2 — volume expanded on the last rise vs the correction
  if (seg.highestHighIdx != null && seg.priorSeqLowIdx != null) {
    const riseVol = c.volume.slice(seg.priorSeqLowIdx, seg.highestHighIdx + 1);
    const corrVol = c.volume.slice(seg.highestHighIdx + 1, last + 1);
    const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
    const rv = avg(riseVol), cv = avg(corrVol);
    put("Q2", rv > cv ? "yes" : "no", "swing",
      `Avg vol rise ≈ ${Math.round(rv).toLocaleString()} vs correction ≈ ${Math.round(cv).toLocaleString()}`);
  } else put("Q2", null, "swing", "Could not segment rise/correction");

  // Q3 — green line sloping up AND red below green (at last bar)
  const greenUp = green13[last] != null && green13[last - 1] != null && green13[last] > green13[last - 1];
  const redBelow = red[last] != null && green13[last] != null && red[last] < green13[last];
  put("Q3", greenUp && redBelow ? "yes" : "no", "exact",
    `Green line (13 SMA) ${greenUp ? "rising" : "flat/down"}, red line (5 SMA) ${redBelow ? "below" : "above"} green`);

  // Q4 — broken resistance became support. Best-guess (Tier 3).
  put("Q4", q4Guess(c, pivots), "guess",
    "Auto-detected level — confirm visually: a prior ceiling that broke and then held as a floor");

  // ===== PHASE B =====
  // Q5 — during correction, price below red line AND red line sloping down
  let belowRed = false;
  if (seg.highestHighIdx != null) {
    for (let i = seg.highestHighIdx; i <= last; i++)
      if (red[i] != null && c.close[i] < red[i]) { belowRed = true; break; }
  }
  const redDown = red[last] != null && red[last - 1] != null && red[last] < red[last - 1];
  put("Q5", belowRed && redDown ? "yes" : "no", "exact",
    `Price ${belowRed ? "went below" : "stayed above"} red line (5 SMA); red line ${redDown ? "sloping down" : "not down"}`);

  // Q6 — CCI(5) dropped below −100 during the correction
  let cciHit = false, cciMin = Infinity;
  const cStart = seg.highestHighIdx ?? Math.max(0, last - 15);
  for (let i = cStart; i <= last; i++) if (cci[i] != null) { cciMin = Math.min(cciMin, cci[i]); if (cci[i] < -100) cciHit = true; }
  put("Q6", cciHit ? "yes" : "no", "exact",
    `Min CCI(5) in correction ≈ ${isFinite(cciMin) ? cciMin.toFixed(0) : "n/a"} (need < −100)`);

  // Q7 — ≥1 correction candle entirely below the prior sequence low (incl. tail)
  if (seg.priorSeqLow != null && seg.highestHighIdx != null) {
    let undercut = false;
    for (let i = seg.highestHighIdx + 1; i <= last; i++) if (c.high[i] < seg.priorSeqLow) { undercut = true; break; }
    put("Q7", undercut ? "yes" : "no", "swing",
      `Prior sequence low ${seg.priorSeqLow.toFixed(2)}; ${undercut ? "a candle closed entirely below it" : "no full undercut"}`);
  } else put("Q7", null, "swing", "Could not locate prior sequence low");

  // ===== PHASE C ===== (only one Yes needed)
  // Q8 — K1: falling sequence broke up (close above prior falling candle's high)
  //      K2: close above red line
  let k1 = false;
  for (let i = last; i >= Math.max(1, last - 4); i--) {
    if (c.close[i - 1] < c.close[i - 2] && c.close[i] > c.high[i - 1]) { k1 = true; break; }
  }
  const k2 = red[last] != null && c.close[last] > red[last];
  put("Q8", (k1 || k2) ? "yes" : "no", "exact",
    `${k1 ? "K1 break-up ✓ " : ""}${k2 ? "K2 close > red line (5 SMA) ✓" : (!k1 ? "neither K1 nor K2" : "")}`.trim());

  // Q9 — green (K3) or buyer (K4) candle entirely below lower Bollinger band (10/1)
  let k3 = false, k4 = false;
  for (let i = Math.max(0, last - 5); i <= last; i++) {
    if (bollLo[i] == null) continue;
    const kk = k(i);
    const entirelyBelow = kk.hi < bollLo[i];
    if (entirelyBelow && kk.green) k3 = true;
    if (entirelyBelow && isBuyer(kk)) k4 = true;
  }
  put("Q9", (k3 || k4) ? "yes" : "no", "exact",
    `${k3 ? "K3 green<band ✓ " : ""}${k4 ? "K4 buyer<band ✓" : (!k3 ? "no candle fully below lower band" : "")}`.trim());

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

  return {
    meta: { bars: N, swingN, lastDate: opts.lastDate ?? null, currency: opts.currency ?? null },
    checks: R,
    math: { buy, candleLow, highestHigh, risk, reward, ratio, maxBuy, triggeredK },
    series: { green13, red, cci, bollLo },
    pivots,
    segments: seg,
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
    if (c.close[i] > level + tol) brokeAbove = true;
    if (brokeAbove && c.low[i] <= level + tol && c.low[i] >= level - tol && c.close[i] > level) heldAsSupport = true;
  }
  return brokeAbove && heldAsSupport ? "yes" : "no";
}

// ----- conclusion resolver (mirrors the guide's outcomes) -----
function conclude(result) {
  const v = (id) => result.checks[id]?.value;
  const PRE = ["P1", "P2", "P3", "P4", "P5"];
  const A = ["Q1", "Q2", "Q3", "Q4"], B = ["Q5", "Q6", "Q7"], C = ["Q8", "Q9"];
  const anyNull = [...PRE, ...A, ...B, ...C].some((id) => v(id) == null);
  const preOk = PRE.every((id) => v(id) === "yes" || v(id) === "na");
  const aOk = A.every((id) => v(id) === "yes");
  const bOk = B.every((id) => v(id) === "yes");
  const cOk = C.some((id) => v(id) === "yes");
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

  return { code, firstFail, preOk, aOk, bOk, cOk, allPass, ratioOk };
}

module.exports = { analyze, conclude, smaSeries, redLineSeries, cciSeries, bollLowerSeries, findPivots };
