import React, { useEffect, useRef, useState } from "react";
import { C, INSET, fontFor } from "../shared/design.js";
import { CT } from "./strings.js";
import useChartView from "./useChartView.js";
import AdvancedChart, { MA_DEFS } from "./AdvancedChart.jsx";
import IndicatorPanel, { loadIndicators, saveIndicators } from "./IndicatorPanel.jsx";

// ─────────────────────────────────────────────────────────────
// ChartApp — the Advanced Chart mode: one full-page chart driven by
// /api/chart. Symbol search (US + TASE via the same server-side resolver as
// the analyzers), range pills, log scale, indicator toggles, and the Peaks &
// Troughs structure controls (zigzag mode + sensitivity + trend verdict).
// Same design system as the other tools; mounted by shared/Root.jsx.
// ─────────────────────────────────────────────────────────────

function useWindowWidth() {
  const [w, setW] = useState(typeof window === "undefined" ? 1200 : window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

// Candle interval → the range windows that keep a chartable bar count. Daily
// bars cover shorter windows; weekly bars need ≥1Y to clear the API's minimum-
// bar floor. The API maps each range key to a Yahoo window and honors the
// interval override (see api/chart.js).
const DAILY_RANGES = ["1M", "3M", "6M", "1Y", "2Y", "5Y"];
const WEEKLY_RANGES = ["1Y", "2Y", "5Y", "Max"];

export default function ChartApp({ lang = "en", initial = null }) {
  const t = CT[lang] || CT.en;
  const font = fontFor(lang);
  const isMobile = useWindowWidth() < 920;

  const [market, setMarket] = useState("US");
  const [symbol, setSymbol] = useState("");
  const [barInterval, setBarInterval] = useState("1d"); // "1d" (daily) | "1wk" (weekly)
  const [range, setRange] = useState("1Y");
  const [zigzagMode, setZigzagMode] = useState("sequence");
  const [sensitivity, setSensitivity] = useState(5);
  const [ind, setInd] = useState(loadIndicators);
  const [showWhy, setShowWhy] = useState(false);

  const [state, setState] = useState({ status: "empty", data: null, error: null, ticker: null });
  const [focus, setFocus] = useState(false);
  const reqRef = useRef(0);
  const debounceRef = useRef(null);

  useEffect(() => saveIndicators(ind), [ind]);

  const N = state.data?.candles?.close?.length || 0;
  const [view, setView] = useChartView(N, state.data);

  async function load(sym, opts = {}) {
    const tick = (sym ?? symbol).trim();
    if (!tick) return;
    const rid = ++reqRef.current;
    setState((s) => ({ ...s, status: "loading", ticker: tick, error: null }));
    try {
      const params = new URLSearchParams({
        ticker: tick,
        market: opts.market ?? market,
        range: opts.range ?? range,
        interval: opts.interval ?? barInterval,
        zigzagMode: opts.zigzagMode ?? zigzagMode,
        sensitivity: String(opts.sensitivity ?? sensitivity),
      });
      const res = await fetch(`/api/chart?${params}`);
      const json = await res.json();
      if (rid !== reqRef.current) return; // a newer request superseded this one
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setState({ status: "ready", data: json, error: null, ticker: tick });
    } catch (e) {
      if (rid !== reqRef.current) return;
      setState((s) => ({ ...s, status: "error", error: e.message }));
    }
  }

  // Preload a stock deep-linked from another tool's "Graph" action. This tab
  // was opened with the stock in the URL; Root reads it and hands it in here.
  useEffect(() => {
    if (!initial || !initial.symbol) return;
    const mkt = initial.market || "US";
    setMarket(mkt);
    setSymbol(initial.symbol);
    load(initial.symbol, { market: mkt });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  // Range / mode changes refetch immediately; the sensitivity slider debounces.
  function onRange(r) { setRange(r); if (state.ticker) load(state.ticker, { range: r }); }
  // Daily/Weekly candle view. Snap to a range that has enough bars for the new
  // interval before refetching.
  function onBarInterval(iv) {
    const ranges = iv === "1wk" ? WEEKLY_RANGES : DAILY_RANGES;
    const nextRange = ranges.includes(range) ? range : "1Y";
    setBarInterval(iv);
    if (nextRange !== range) setRange(nextRange);
    if (state.ticker) load(state.ticker, { interval: iv, range: nextRange });
  }
  function onZigzagMode(m) { setZigzagMode(m); if (state.ticker) load(state.ticker, { zigzagMode: m }); }
  function onSensitivity(s) {
    setSensitivity(s);
    if (!state.ticker) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(state.ticker, { sensitivity: s }), 400);
  }
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const data = state.data;
  const trend = data?.peaks?.trend;
  const trendColor = trend ? { uptrend: C.green, downtrend: C.red, range: C.amber }[trend.trend] : null;

  const ctlH = isMobile ? 48 : 56;
  const ctlBtn = { display: "flex", alignItems: "center", justifyContent: "center", height: ctlH, padding: isMobile ? "0 14px" : "0 20px", borderRadius: 16, color: "#fff", font: `700 15px ${font}`, border: "none", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, background: "rgba(0,0,0,0.18)" };
  const pill = (on) => ({ font: `700 12px ${font}`, padding: "6px 12px", borderRadius: 40, border: "none", cursor: "pointer", background: on ? C.chip : "transparent", color: on ? "#fff" : C.t50 });

  return (
    <div dir={t.dir} style={{ minHeight: "100vh", background: C.bg, fontFamily: font, display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 1280, padding: isMobile ? "16px 12px 110px" : "28px 24px 110px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ font: `700 26px ${font}`, color: "#fff" }}>{t.appTitle}</span>
            <span style={{ font: `700 12px ${font}`, letterSpacing: "0.1em", color: C.t50 }}>{t.appSub}</span>
          </div>
          {data && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: t.dir === "rtl" ? "flex-start" : "flex-end", gap: 2 }}>
              <span style={{ font: `700 18px ${font}`, color: "#fff" }}>{data.name || data.ticker}</span>
              <span style={{ font: `400 12px ${font}`, color: C.t50 }}>
                {data.ticker} · {data.exchange || ""} · {t.lastClose} {Number(data.candles.close[N - 1]).toFixed(2)} {data.currency || ""} · {data.lastDate}
              </span>
            </div>
          )}
        </div>

        {/* Control bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, background: C.card, borderRadius: 24, boxShadow: INSET, padding: 14, flexWrap: "wrap" }}>
          <button onClick={() => setMarket(market === "US" ? "TLV" : "US")} style={ctlBtn} title={t.market[market]}>{t.market[market]}</button>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && load()} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
            placeholder={market === "TLV" ? t.symbolPlaceholderTLV : t.symbolPlaceholder} maxLength={24}
            style={{ flex: 1, minWidth: 120, height: ctlH, padding: "0 20px", borderRadius: 16, background: focus ? "rgba(0,0,0,0.30)" : "rgba(0,0,0,0.18)", color: "#fff", font: `700 17px ${font}`, border: "none", outline: "none", textAlign: "center", letterSpacing: "0.04em", boxShadow: focus ? "inset 0 0 0 2px #fff" : "none" }} />
          <button onClick={() => load()} style={{ ...ctlBtn, background: "#fff", color: C.card }}>{t.load}</button>

          <div style={{ display: "flex", gap: 2, background: C.sub, borderRadius: 40, padding: 4 }}>
            {["1d", "1wk"].map((iv) => (
              <button key={iv} onClick={() => onBarInterval(iv)} style={pill(barInterval === iv)}>{t.interval[iv]}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 2, background: C.sub, borderRadius: 40, padding: 4 }}>
            {(barInterval === "1wk" ? WEEKLY_RANGES : DAILY_RANGES).map((r) => (
              <button key={r} onClick={() => onRange(r)} style={pill(range === r)}>{r}</button>
            ))}
          </div>
        </div>

        {/* Structure controls + trend verdict */}
        <div style={{ display: "flex", alignItems: "center", gap: 14, background: C.card, borderRadius: 24, boxShadow: INSET, padding: "12px 18px", flexWrap: "wrap" }}>
          {zigzagMode === "sequence" ? (
            /* Sequence mode is parameter-free — a break either happened or it didn't. */
            <span style={{ flex: 1, minWidth: 120, font: `400 12px ${font}`, color: C.t50 }}>{t.sequenceHint}</span>
          ) : (
            <>
              <span style={{ font: `700 13px ${font}`, color: C.t70, whiteSpace: "nowrap" }} title={t.sensitivityHelp}>{t.sensitivity}</span>
              <input type="range" min={1} max={10} value={sensitivity} onChange={(e) => onSensitivity(+e.target.value)}
                style={{ flex: 1, minWidth: 120, accentColor: C.amber }} />
              <span style={{ font: `700 15px ${font}`, color: "#fff", minWidth: 18, textAlign: "center" }}>{sensitivity}</span>
            </>
          )}
          <div style={{ display: "flex", gap: 2, background: C.sub, borderRadius: 40, padding: 4 }}>
            {["sequence", "percent", "lookback"].map((m) => (
              <button key={m} onClick={() => onZigzagMode(m)} style={pill(zigzagMode === m)}>{t.zigzagMode[m]}</button>
            ))}
          </div>
          {trend && (
            <button onClick={() => setShowWhy(!showWhy)} title={t.trendWhy} style={{
              display: "flex", alignItems: "center", gap: 8, font: `700 13px ${font}`, padding: "8px 16px",
              borderRadius: 40, border: "none", cursor: "pointer", background: `${trendColor}22`, color: trendColor,
              boxShadow: `inset 0 0 0 1px ${trendColor}55`,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: trendColor }} />
              {t.trend[trend.trend]} · {(trend.confidence * 100).toFixed(0)}%
            </button>
          )}
        </div>
        {showWhy && trend && (
          <div style={{ background: C.card, borderRadius: 16, boxShadow: INSET, padding: "12px 18px", display: "flex", flexDirection: "column", gap: 4 }}>
            {trend.reasons.map((r, i) => (
              <span key={i} style={{ font: `400 13px ${font}`, color: C.t70 }}>{r}</span>
            ))}
          </div>
        )}

        {/* Chart */}
        {state.status === "empty" && (
          <div style={{ height: 320, display: "flex", alignItems: "center", justifyContent: "center", background: C.card, borderRadius: 24, boxShadow: INSET }}>
            <span style={{ font: `700 15px ${font}`, color: C.t40 }}>{t.emptyPrompt}</span>
          </div>
        )}
        {state.status === "error" && (
          <div style={{ padding: "14px 18px", background: C.card, borderRadius: 16, boxShadow: `inset 0 0 0 1px ${C.red}66` }}>
            <span style={{ font: `700 13px ${font}`, color: C.red }}>{t.failed(state.ticker, state.error)}</span>
          </div>
        )}
        {(state.status === "ready" || (state.status === "loading" && data)) && data && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, opacity: state.status === "loading" ? 0.6 : 1, transition: "opacity .15s" }}>
            <AdvancedChart data={data} view={view} setView={setView}
              W={1200} H={isMobile ? 480 : 640}
              panels={ind.panels} overlays={ind.overlays} t={t} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <Legend ind={ind} t={t} font={font} />
              <span style={{ font: `400 11px ${font}`, color: C.t50 }}>{t.chartHint}</span>
            </div>
          </div>
        )}
        {state.status === "loading" && !data && (
          <div style={{ height: 320, display: "flex", alignItems: "center", justifyContent: "center", background: C.card, borderRadius: 24, boxShadow: INSET }}>
            <span style={{ font: `700 15px ${font}`, color: C.t50 }}>{t.loading}</span>
          </div>
        )}

        {/* Indicator toggles */}
        <div style={{ background: C.card, borderRadius: 24, boxShadow: INSET, padding: "14px 18px" }}>
          <IndicatorPanel ind={ind} setInd={setInd} t={t} />
        </div>

        <span style={{ font: `400 11px ${font}`, color: C.t25, textAlign: "center" }}>{t.notAdvice}</span>
      </div>
    </div>
  );
}

function Legend({ ind, t, font }) {
  const dot = (color, h = 3) => ({ width: 12, height: h, borderRadius: 2, background: color, flexShrink: 0 });
  const item = (color, label, h) => (
    <span key={label} style={{ display: "flex", alignItems: "center", gap: 6, font: `400 11px ${font}`, color: C.t70 }}>
      <span style={dot(color, h)} />{label}
    </span>
  );
  const items = [];
  if (ind.overlays.zigzag) items.push(item(C.amber, t.legend.zigzag));
  if (ind.overlays.sr) items.push(item(C.blue, t.legend.sr));
  if (ind.overlays.fib) items.push(item("#B37FEB", t.legend.fib));
  if (ind.overlays.boll) items.push(item("#9AA0AE", t.legend.boll));
  for (const d of MA_DEFS) if (ind.overlays[d.key]) items.push(item(d.color, d.label));
  return <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>{items}</div>;
}
