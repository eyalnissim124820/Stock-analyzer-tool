// ─────────────────────────────────────────────────────────────
// _tracker.js — the Monthly Tracker method: finding stocks worth tracking
// this month and flagging buy-alert candles. Pure functions, no I/O.
//
// The method runs on the MONTHLY chart and admits a stock to the tracking
// list only when ALL seven checks pass:
//   N1 — tradable: average daily volume above 1,000,000 (lenient 800,000)
//   N2 — rising sequence on the monthly chart (closing basis)
//   N3 — the whole last candle, including its lower tail, above MA5
//   N4 — MA5 sloping upward
//   N5 — the last CLOSED candle is green
//   N6 — its close is above the PREVIOUS candle's high
//   N7 — its close sits in the top third of its own range (near its high)
//
// N2–N7 are evaluated on the last CLOSED monthly candle: if the newest bar
// belongs to the still-running calendar month it is a forming candle and is
// excluded from the decision (it still appears on the chart).
//
// Verdicts: TRACK (all pass) · WAIT (N1–N4 pass, alert candle N5–N7 not
// there yet) · NO_TRACK · INCOMPLETE (missing data).
// ─────────────────────────────────────────────────────────────

const { smaSeries, findPivotsClose } = require("./_sequence.js");

const VOL_STRICT = 1_000_000;
const VOL_LENIENT = 800_000;
const VOL_MA_DAYS = 20; // ~1 trading month of daily volume

// Localized "why" lines (figures are language-agnostic).
const MSG = {
  en: {
    N1none: () => `No daily volume data — confirm liquidity yourself`,
    N1: (avg, tier) =>
      tier === "strict" ? `Avg daily volume ≈ ${avg} — clears the 1,000,000 bar`
      : tier === "lenient" ? `Avg daily volume ≈ ${avg} — clears only the lenient 800,000 bar`
      : `Avg daily volume ≈ ${avg} — below 800,000, not liquid enough`,
    N2: (p0, p1, t0, t1) => `Peaks ${p0}→${p1}, troughs ${t0}→${t1} (closing basis, monthly)`,
    N2sparse: () => `Sparse pivots — coarse half-vs-half structure; confirm visually`,
    N3: (lo, ma, ok) => `Candle low ${lo} ${ok ? ">" : "≤"} MA5 ${ma} — whole candle ${ok ? "above" : "not above"}`,
    N4: (now, prev, ok) => `MA5 ${now} vs prior ${prev} → ${ok ? "sloping up" : "not sloping up"}`,
    N5: (c, o, ok) => `Close ${c} vs open ${o} → ${ok ? "green" : "not green"}`,
    N6: (c, h, ok) => `Close ${c} ${ok ? ">" : "≤"} previous candle's high ${h}`,
    N7: (c, thr, h, ok) => `Close ${c} ${ok ? "≥" : "<"} top-third line ${thr} (high ${h})`,
  },
  he: {
    N1none: () => `אין נתוני מחזור יומי — אמתו את הסחירות בעצמכם`,
    N1: (avg, tier) =>
      tier === "strict" ? `מחזור יומי ממוצע ≈ ${avg} — עובר את רף ה-1,000,000`
      : tier === "lenient" ? `מחזור יומי ממוצע ≈ ${avg} — עובר רק את הרף המקל של 800,000`
      : `מחזור יומי ממוצע ≈ ${avg} — מתחת ל-800,000, לא סחיר מספיק`,
    N2: (p0, p1, t0, t1) => `פסגות ${p0}→${p1}, שפלים ${t0}→${t1} (בסיס סגירה, חודשי)`,
    N2sparse: () => `מעט נקודות מפנה — בדיקת מבנה גסה; ודאו ויזואלית`,
    N3: (lo, ma, ok) => `נמוך הנר ${lo} ${ok ? ">" : "≤"} MA5 ${ma} — כל הנר ${ok ? "מעל" : "לא מעל"}`,
    N4: (now, prev, ok) => `MA5 ${now} מול קודם ${prev} ← ${ok ? "משופע מעלה" : "אינו משופע מעלה"}`,
    N5: (c, o, ok) => `סגירה ${c} מול פתיחה ${o} ← ${ok ? "ירוק" : "לא ירוק"}`,
    N6: (c, h, ok) => `סגירה ${c} ${ok ? ">" : "≤"} הגבוה של הנר הקודם ${h}`,
    N7: (c, thr, h, ok) => `סגירה ${c} ${ok ? "≥" : "<"} קו השליש העליון ${thr} (גבוה ${h})`,
  },
};

// Which monthly bar is the last CLOSED one? If the newest bar's date falls in
// the same UTC calendar month as `now`, it is still forming → use the bar
// before it. `dates` are "YYYY-MM-DD" strings (oldest→newest).
function lastClosedIndex(dates, now) {
  const last = dates.length - 1;
  if (last < 0) return { idx: -1, droppedForming: false };
  const nowKey = now.toISOString().slice(0, 7);
  const lastKey = String(dates[last]).slice(0, 7);
  return lastKey === nowKey ? { idx: last - 1, droppedForming: true } : { idx: last, droppedForming: false };
}

// `monthly` = {open,high,low,close,volume} oldest→newest; `monthlyDates`
// aligned with it. `daily` may be null (liquidity check becomes unanswered).
function evaluate({ monthly, monthlyDates, daily, lang = "en", swingN = 2, now = new Date() }) {
  const M = MSG[lang === "he" ? "he" : "en"];
  const fmt = (x, d = 2) => (x == null || isNaN(x) ? "n/a" : Number(x).toFixed(d));
  const fmt0 = (x) => (x == null || isNaN(x) ? "n/a" : Math.round(x).toLocaleString("en-US"));

  const R = {};
  const put = (id, value, conf, why) => { R[id] = { value, conf, why }; };

  const { idx: evalIdx, droppedForming } = lastClosedIndex(monthlyDates || [], now);

  // Slice the monthly series to the last closed candle so a forming bar can
  // never influence the decision. SMA is causal, so MA5 values on the slice
  // equal the full-series values at the same indexes.
  const slice = (arr) => arr.slice(0, evalIdx + 1);
  const c = evalIdx >= 0 ? {
    open: slice(monthly.open), high: slice(monthly.high),
    low: slice(monthly.low), close: slice(monthly.close), volume: slice(monthly.volume),
  } : null;
  const last = evalIdx;
  const ma5 = c ? smaSeries(c.close, 5) : [];
  const pivots = c ? findPivotsClose(c.close, swingN) : { ph: [], pl: [] };

  // N1 — tradable: average daily volume over ~a month of sessions.
  let avgDailyVolume = null, volumeTier = null;
  if (daily && daily.volume && daily.volume.length) {
    const volMa = smaSeries(daily.volume, Math.min(VOL_MA_DAYS, daily.volume.length));
    avgDailyVolume = volMa[volMa.length - 1];
  }
  if (avgDailyVolume == null) {
    put("N1", null, "guess", M.N1none());
  } else {
    volumeTier = avgDailyVolume >= VOL_STRICT ? "strict" : avgDailyVolume >= VOL_LENIENT ? "lenient" : "fail";
    put("N1", volumeTier === "fail" ? "no" : "yes", "exact", M.N1(fmt0(avgDailyVolume), volumeTier));
  }

  if (!c || last < 1) {
    // Not enough closed monthly candles to say anything about N2–N7.
    for (const id of ["N2", "N3", "N4", "N5", "N6", "N7"]) put(id, null, "guess", "");
  } else {
    // N2 — rising sequence on the monthly chart (closing basis), same
    // structure test as the Sequence Method's S1: peaks AND troughs rising.
    {
      const { ph, pl } = pivots;
      if (ph.length >= 2 && pl.length >= 2) {
        const risingPeaks = ph[ph.length - 1].price > ph[ph.length - 2].price;
        const risingTroughs = pl[pl.length - 1].price > pl[pl.length - 2].price;
        put("N2", risingPeaks && risingTroughs ? "yes" : "no", "swing",
          M.N2(fmt(ph[ph.length - 2].price), fmt(ph[ph.length - 1].price), fmt(pl[pl.length - 2].price), fmt(pl[pl.length - 1].price)));
      } else {
        const mid = Math.floor(c.close.length / 2);
        const peakUp = Math.max(...c.close.slice(mid)) > Math.max(...c.close.slice(0, mid));
        const troughUp = Math.min(...c.close.slice(mid)) > Math.min(...c.close.slice(0, mid));
        put("N2", peakUp && troughUp ? "yes" : "no", "guess", M.N2sparse());
      }
    }
    // N3 — the WHOLE candle (incl. lower tail) above MA5.
    {
      const lo = c.low[last], ma = ma5[last];
      const ok = ma != null && lo > ma;
      put("N3", ma == null ? null : ok ? "yes" : "no", "exact", M.N3(fmt(lo), fmt(ma), ok));
    }
    // N4 — MA5 sloping upward.
    {
      const now5 = ma5[last], prev5 = ma5[last - 1];
      const ok = now5 != null && prev5 != null && now5 > prev5;
      put("N4", now5 == null || prev5 == null ? null : ok ? "yes" : "no", "exact", M.N4(fmt(now5), fmt(prev5), ok));
    }
    // N5 — the last closed candle is green.
    {
      const ok = c.close[last] > c.open[last];
      put("N5", ok ? "yes" : "no", "exact", M.N5(fmt(c.close[last]), fmt(c.open[last]), ok));
    }
    // N6 — its close is above the PREVIOUS candle's high.
    {
      const ok = c.close[last] > c.high[last - 1];
      put("N6", ok ? "yes" : "no", "exact", M.N6(fmt(c.close[last]), fmt(c.high[last - 1]), ok));
    }
    // N7 — close in the top third of its own range (near its own high).
    {
      const range = c.high[last] - c.low[last];
      const thr = c.high[last] - range / 3;
      const ok = c.close[last] >= thr;
      put("N7", ok ? "yes" : "no", "exact", M.N7(fmt(c.close[last]), fmt(thr), fmt(c.high[last]), ok));
    }
  }

  return {
    checks: R,
    conclusion: concludeTracker(R),
    meta: {
      evalIdx,
      evalDate: evalIdx >= 0 ? monthlyDates[evalIdx] || null : null,
      droppedForming,
      avgDailyVolume,
      volumeTier,
      volStrict: VOL_STRICT,
      volLenient: VOL_LENIENT,
      swingN,
    },
    series: { ma5: smaSeries(monthly.close, 5) }, // full series for the chart
    pivots,
  };
}

const TREND_IDS = ["N1", "N2", "N3", "N4"];
const ALERT_IDS = ["N5", "N6", "N7"];
const ALL_IDS = [...TREND_IDS, ...ALERT_IDS];

// Resolve the verdict from check values ({id: "yes"|"no"|null}). Exported so
// the UI can recompute it override-aware with the same rules.
function concludeTracker(checks) {
  const v = (id) => checks[id]?.value;
  if (ALL_IDS.some((id) => v(id) == null)) return { code: "INCOMPLETE" };
  const trendOk = TREND_IDS.every((id) => v(id) === "yes");
  const alertOk = ALERT_IDS.every((id) => v(id) === "yes");
  if (trendOk && alertOk) return { code: "TRACK" };
  if (trendOk) return { code: "WAIT" };
  return { code: "NO_TRACK" };
}

module.exports = { evaluate, concludeTracker, lastClosedIndex, TREND_IDS, ALERT_IDS, ALL_IDS, VOL_STRICT, VOL_LENIENT };
