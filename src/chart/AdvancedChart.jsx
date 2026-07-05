import React, { useEffect, useMemo, useRef, useState, useId } from "react";
import { C } from "../shared/design.js";
import { FONT_EN } from "../shared/design.js";
import useChartTouch from "../shared/useChartTouch.js";

// ─────────────────────────────────────────────────────────────
// AdvancedChart — the multi-panel SVG chart for the Advanced Chart mode.
// Hand-rolled SVG like the analyzer charts (no chart lib): a price panel with
// candles + overlays (MAs, Bollinger, zigzag structure, S/R, Fibonacci), and
// optional Volume / RSI / MACD sub-panels stacked under it. All panels share
// one x(i) transform, one crosshair and one wheel/drag interaction set, so
// they zoom and pan together. The interaction machinery mirrors App.jsx's
// ChartCanvas (which stays untouched).
// ─────────────────────────────────────────────────────────────

const FONT = FONT_EN;

// Overlay definitions — key into data.series, display label, stroke color.
export const MA_DEFS = [
  { key: "sma5", src: ["sma", "5"], label: "SMA 5", color: "#E0A458" },
  { key: "sma13", src: ["sma", "13"], label: "SMA 13", color: "#6CD7A4" },
  { key: "sma20", src: ["sma", "20"], label: "SMA 20", color: "#4193FF" },
  { key: "sma40", src: ["sma", "40"], label: "SMA 40", color: "#B37FEB" },
  { key: "sma50", src: ["sma", "50"], label: "SMA 50", color: "#F17EB8" },
  { key: "sma200", src: ["sma", "200"], label: "SMA 200", color: "#9AA0AE" },
  { key: "ema9", src: ["ema", "9"], label: "EMA 9", color: "#5AD8E6" },
  { key: "ema21", src: ["ema", "21"], label: "EMA 21", color: "#F2E85C" },
  { key: "ema50", src: ["ema", "50"], label: "EMA 50", color: "#FF8A5C" },
];
const SR_COLORS = { support: C.green, resistance: C.red, flip: C.blue };
const FIB_COLOR = "#B37FEB";

const fmt = (v, d = 2) => (v == null || isNaN(v) ? "—" : Number(v).toFixed(d));
function fmtVol(v) {
  if (v == null || isNaN(v)) return "—";
  if (v >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return String(Math.round(v));
}

// "Nice" tick values covering [lo, hi] — 1/2/5 step ladder.
function niceTicks(lo, hi, n = 5) {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

// Panel stack layout: price always on; sub-panels take fixed shares of the
// height and price absorbs the rest.
const SUB_SHARE = { volume: 0.12, rsi: 0.15, macd: 0.15 };
function layoutPanels(plotH, panels, gap) {
  const subs = ["volume", "rsi", "macd"].filter((k) => panels[k]);
  const usable = plotH - gap * subs.length;
  const layout = [];
  let y0 = 0;
  const priceH = usable * (1 - subs.reduce((a, k) => a + SUB_SHARE[k], 0));
  layout.push({ key: "price", y0, h: priceH });
  y0 += priceH + gap;
  for (const k of subs) {
    const h = usable * SUB_SHARE[k];
    layout.push({ key: k, y0, h });
    y0 += h + gap;
  }
  return layout;
}

export default function AdvancedChart({ data, view, setView, W = 1200, H = 640, maxH, logScale, panels, overlays, t }) {
  const [hover, setHover] = useState(null); // { i, cy }
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const uid = useId().replace(/[:]/g, "");

  const candles = data.candles;
  const series = data.series || {};
  const dates = data.dates || [];
  const peaks = data.peaks || null;

  const N = candles.close.length;
  const padL = 10, padR = 66, padT = 14, padB = 26, panelGap = 10;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const count = Math.max(2, Math.min(view.count || N, N));
  const start = Math.max(0, Math.min(view.start || 0, N - count));
  const end = start + count;
  const visLast = end - 1;
  const slot = plotW / count;
  const bodyW = Math.max(1.2, Math.min(slot * 0.62, 16));

  const x = (i) => padL + slot * ((i - start) + 0.5);
  const xc = (i) => Math.max(padL, Math.min(padL + plotW, x(i)));

  // ── panel layout + per-panel y transforms ──
  const stack = layoutPanels(plotH, panels || {}, panelGap).map((p) => ({ ...p, y0: p.y0 + padT }));
  const pricePanel = stack[0];

  // Price range fits the visible candles + any enabled band/level overlays.
  let lo = Infinity, hi = -Infinity;
  for (let i = start; i < end; i++) { lo = Math.min(lo, candles.low[i]); hi = Math.max(hi, candles.high[i]); }
  if (overlays.boll && series.boll) {
    for (let i = start; i < end; i++) {
      if (series.boll.lower[i] != null) lo = Math.min(lo, series.boll.lower[i]);
      if (series.boll.upper[i] != null) hi = Math.max(hi, series.boll.upper[i]);
    }
  }
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  const padP = (hi - lo) * 0.06 || 1;
  lo -= padP; hi += padP;
  const tf = logScale ? (p) => Math.log(Math.max(p, 1e-9)) : (p) => p;
  const tLo = tf(Math.max(lo, logScale ? hi / 1e4 : lo)), tHi = tf(hi);
  const tSpan = tHi - tLo || 1;
  const yP = (p) => pricePanel.y0 + ((tHi - tf(p)) / tSpan) * pricePanel.h;
  const invP = (cy) => {
    const tv = tHi - ((cy - pricePanel.y0) / pricePanel.h) * tSpan;
    return logScale ? Math.exp(tv) : tv;
  };

  // Sub-panel scales over the visible window.
  const volPanel = stack.find((p) => p.key === "volume");
  let volMax = 0;
  if (volPanel) for (let i = start; i < end; i++) volMax = Math.max(volMax, candles.volume[i] || 0);
  const yV = volPanel ? (v) => volPanel.y0 + (1 - v / (volMax || 1)) * volPanel.h : null;

  const rsiPanel = stack.find((p) => p.key === "rsi");
  const yR = rsiPanel ? (v) => rsiPanel.y0 + ((100 - v) / 100) * rsiPanel.h : null;

  const macdPanel = stack.find((p) => p.key === "macd");
  let macdAbs = 0;
  if (macdPanel && series.macd) {
    for (let i = start; i < end; i++) {
      for (const arr of [series.macd.macd, series.macd.signal, series.macd.hist]) {
        if (arr[i] != null) macdAbs = Math.max(macdAbs, Math.abs(arr[i]));
      }
    }
  }
  const yM = macdPanel ? (v) => macdPanel.y0 + ((macdAbs - v) / (2 * macdAbs || 1)) * macdPanel.h : null;

  const polyline = (arr, color, w = 1.4, yFn = yP, dash) => {
    if (!arr) return null;
    const pts = [];
    for (let i = start; i < end; i++) if (arr[i] != null) pts.push(`${x(i).toFixed(1)},${yFn(arr[i]).toFixed(1)}`);
    if (pts.length < 2) return null;
    return <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={w}
      strokeDasharray={dash} strokeLinejoin="round" strokeLinecap="round" />;
  };

  // ── interactions (same contract as App.jsx ChartCanvas) ──
  const clientToPoint = (e) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return { i: start, cy: padT };
    const vbX = ((e.clientX - r.left) / r.width) * W;
    const cy = ((e.clientY - r.top) / r.height) * H;
    let i = Math.round((vbX - padL) / slot - 0.5) + start;
    return { i: Math.max(start, Math.min(visLast, i)), cy };
  };
  function onMouseMove(e) {
    // Capture the drag ref up front: the setView updater below runs
    // asynchronously, and a concurrent mouseup can null dragRef.current before
    // it does — reading the ref inside the updater then crashes the tree.
    const drag = dragRef.current;
    if (drag) {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r) return;
      const dxPx = e.clientX - drag.startX;
      const dCandles = -Math.round((dxPx / r.width) * W / slot);
      setView((v) => {
        const cc = Math.max(2, Math.min(v.count, N));
        const st = Math.max(0, Math.min(N - cc, drag.startStart + dCandles));
        return { start: st, count: cc };
      });
      return;
    }
    setHover(clientToPoint(e));
  }
  function onMouseDown(e) {
    dragRef.current = { startX: e.clientX, startStart: start };
    setDragging(true);
    setHover(null);
  }
  function endDrag() { dragRef.current = null; setDragging(false); }
  useEffect(() => {
    if (!dragging) return;
    const up = () => endDrag();
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [dragging]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const vbX = ((e.clientX - r.left) / r.width) * W;
      const plotFrac = Math.max(0, Math.min(1, (vbX - padL) / plotW));
      const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (horizontal) {
        const delta = e.deltaX || e.deltaY;
        setView((v) => {
          const cc = Math.max(2, Math.min(v.count, N));
          const step = Math.sign(delta) * Math.max(1, Math.round(cc * 0.06));
          return { start: Math.max(0, Math.min(N - cc, v.start + step)), count: cc };
        });
      } else {
        const factor = Math.exp(e.deltaY * 0.0015);
        setView((v) => {
          const minC = Math.min(N, 8), maxC = N;
          let cc = Math.max(minC, Math.min(maxC, Math.round((v.count || N) * factor)));
          const pointer = (v.start || 0) + plotFrac * (v.count || N);
          let st = Math.round(pointer - plotFrac * cc);
          st = Math.max(0, Math.min(N - cc, st));
          return { start: st, count: cc };
        });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [N, W, plotW, setView]);

  // Touch: one-finger drag pans, pinch zooms, tap moves the crosshair.
  useChartTouch(svgRef, {
    N, W, padL, plotW, slot, start, count, setView,
    onGesture: () => setHover(null),
    onTap: (cx, cy) => setHover(clientToPoint({ clientX: cx, clientY: cy })),
  });

  // ── memoized heavy geometry ──
  const candleEls = useMemo(() => Array.from({ length: count }, (_, j) => {
    const i = start + j;
    const o = candles.open[i], c = candles.close[i], h = candles.high[i], l = candles.low[i];
    const up = c >= o, col = up ? C.green : C.red;
    const yo = yP(o), yc = yP(c);
    const top = Math.min(yo, yc), bh = Math.max(1, Math.abs(yc - yo));
    return (
      <g key={i}>
        <line x1={x(i)} y1={yP(h)} x2={x(i)} y2={yP(l)} stroke={col} strokeWidth={1} />
        <rect x={x(i) - bodyW / 2} y={top} width={bodyW} height={bh} fill={col} rx={0.5} />
      </g>
    );
  }), [candles, start, count, slot, bodyW, logScale, lo, hi, pricePanel.h]);

  // Bollinger band shading: upper path forward + lower path reversed.
  const bollShade = useMemo(() => {
    if (!overlays.boll || !series.boll) return null;
    const up = [], dn = [];
    for (let i = start; i < end; i++) {
      if (series.boll.upper[i] != null) up.push(`${x(i).toFixed(1)},${yP(series.boll.upper[i]).toFixed(1)}`);
      if (series.boll.lower[i] != null) dn.push(`${x(i).toFixed(1)},${yP(series.boll.lower[i]).toFixed(1)}`);
    }
    if (up.length < 2) return null;
    return <path d={`M ${up.join(" L ")} L ${dn.reverse().join(" L ")} Z`} fill={C.blue} opacity={0.07} />;
  }, [overlays.boll, series.boll, start, count, slot, logScale, lo, hi, pricePanel.h]);

  // ── peaks & troughs overlays ──
  const pts = peaks?.points || [];
  const zigzagEls = overlays.zigzag && pts.length >= 2 && (() => {
    const solid = [], last = pts[pts.length - 1];
    const confirmed = last.provisional ? pts.slice(0, -1) : pts;
    for (const p of confirmed) solid.push(`${x(p.i).toFixed(1)},${yP(p.price).toFixed(1)}`);
    const prev = pts[pts.length - 2];
    return (
      <g>
        {solid.length >= 2 && <polyline points={solid.join(" ")} fill="none" stroke={C.amber} strokeWidth={2} strokeLinejoin="round" opacity={0.9} />}
        {last.provisional && prev && (
          <line x1={x(prev.i)} y1={yP(prev.price)} x2={x(last.i)} y2={yP(last.price)}
            stroke={C.amber} strokeWidth={2} strokeDasharray="5 4" opacity={0.9} />
        )}
        {pts.filter((p) => p.i >= start && p.i < end).map((p, j) => {
          const isH = p.kind === "H";
          const bull = p.label === "HH" || p.label === "HL";
          const labCol = p.label.length === 2 ? (bull ? C.green : C.red) : C.t50;
          return (
            <g key={j}>
              <circle cx={x(p.i)} cy={yP(p.price)} r={2.8} fill={C.amber} />
              {slot >= 9 && (
                <text x={x(p.i)} y={yP(p.price) + (isH ? -7 : 14)} textAnchor="middle"
                  fill={labCol} style={{ font: `700 10px ${FONT}` }}>{p.label}</text>
              )}
            </g>
          );
        })}
      </g>
    );
  })();

  const srEls = overlays.sr && (peaks?.srLevels || []).map((lv, j) => {
    if (lv.price < lo || lv.price > hi) return null;
    const yy = yP(lv.price);
    const x0 = xc(lv.firstIdx);
    const op = 0.3 + 0.14 * Math.min(lv.strength, 5);
    return (
      <g key={`sr${j}`}>
        <line x1={x0} y1={yy} x2={padL + plotW} y2={yy} stroke={SR_COLORS[lv.kind]} strokeWidth={1.4} opacity={op} />
        <text x={padL + plotW - 4} y={yy - 4} textAnchor="end" fill={SR_COLORS[lv.kind]} opacity={Math.min(1, op + 0.2)}
          style={{ font: `700 9px ${FONT}` }}>{fmt(lv.price)} ×{lv.touches}</text>
      </g>
    );
  });

  const fib = peaks?.fib;
  const fibEls = overlays.fib && fib && fib.levels.map((l, j) => {
    if (l.price < lo || l.price > hi) return null;
    const yy = yP(l.price);
    const x0 = xc(fib.from.i);
    return (
      <g key={`fib${j}`}>
        <line x1={x0} y1={yy} x2={padL + plotW} y2={yy} stroke={FIB_COLOR} strokeWidth={1} strokeDasharray="2 4" opacity={0.6} />
        <text x={x0 + 4} y={yy - 3} fill={FIB_COLOR} opacity={0.85} style={{ font: `400 9px ${FONT}` }}>
          {l.ratio} · {fmt(l.price)}
        </text>
      </g>
    );
  });

  // ── last price line ──
  const lastC = candles.close[N - 1], prevC = candles.close[N - 2] ?? lastC;
  const lastCol = lastC >= prevC ? C.green : C.red;
  const lastEls = lastC >= lo && lastC <= hi && (
    <g>
      <line x1={padL} y1={yP(lastC)} x2={padL + plotW} y2={yP(lastC)} stroke={lastCol} strokeWidth={1} strokeDasharray="2 3" opacity={0.7} />
      <g transform={`translate(${padL + plotW + 2}, ${yP(lastC) - 8})`}>
        <rect width={padR - 4} height={16} rx={4} fill={lastCol} />
        <text x={(padR - 4) / 2} y={11.5} textAnchor="middle" fill="#1F1E21" style={{ font: `700 10px ${FONT}` }}>{fmt(lastC)}</text>
      </g>
    </g>
  );

  // ── axes ──
  const priceTicks = niceTicks(lo, hi, 6).map((p) => (
    <g key={p}>
      <line x1={padL} y1={yP(p)} x2={padL + plotW} y2={yP(p)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
      <text x={padL + plotW + 5} y={yP(p) + 3} fill={C.t40} style={{ font: `400 9px ${FONT}` }}>{fmt(p)}</text>
    </g>
  ));
  const nDates = Math.max(2, Math.min(6, Math.floor(plotW / 130)));
  const dateTicks = Array.from({ length: nDates }, (_, j) => {
    const i = Math.round(start + (j / (nDates - 1)) * (count - 1));
    return (
      <text key={j} x={Math.min(Math.max(x(i), padL + 26), padL + plotW - 26)} y={H - 8}
        textAnchor="middle" fill={C.t40} style={{ font: `400 9px ${FONT}` }}>{dates[i] || ""}</text>
    );
  });

  // ── sub-panel content ──
  const volEls = volPanel && (
    <g clipPath={`url(#clip-volume-${uid})`}>
      {Array.from({ length: count }, (_, j) => {
        const i = start + j;
        const v = candles.volume[i] || 0;
        const up = candles.close[i] >= candles.open[i];
        return <rect key={i} x={x(i) - bodyW / 2} y={yV(v)} width={bodyW}
          height={Math.max(0.5, volPanel.y0 + volPanel.h - yV(v))} fill={up ? C.green : C.red} opacity={0.55} />;
      })}
      <text x={padL + 4} y={volPanel.y0 + 11} fill={C.t40} style={{ font: `700 9px ${FONT}` }}>
        VOL {hover ? fmtVol(candles.volume[hover.i]) : fmtVol(candles.volume[N - 1])}
      </text>
    </g>
  );

  const rsiArr = series.rsi;
  const rsiEls = rsiPanel && rsiArr && (
    <g clipPath={`url(#clip-rsi-${uid})`}>
      <rect x={padL} y={yR(70)} width={plotW} height={yR(30) - yR(70)} fill={C.blue} opacity={0.05} />
      {[30, 70].map((v) => (
        <g key={v}>
          <line x1={padL} y1={yR(v)} x2={padL + plotW} y2={yR(v)} stroke={C.t25} strokeWidth={1} strokeDasharray="3 3" />
          <text x={padL + plotW + 5} y={yR(v) + 3} fill={C.t40} style={{ font: `400 9px ${FONT}` }}>{v}</text>
        </g>
      ))}
      {polyline(rsiArr, "#5AD8E6", 1.5, yR)}
      <text x={padL + 4} y={rsiPanel.y0 + 11} fill={C.t40} style={{ font: `700 9px ${FONT}` }}>
        RSI 14 {hover && rsiArr[hover.i] != null ? `· ${fmt(rsiArr[hover.i], 1)}` : ""}
      </text>
    </g>
  );

  const macd = series.macd;
  const macdEls = macdPanel && macd && (
    <g clipPath={`url(#clip-macd-${uid})`}>
      <line x1={padL} y1={yM(0)} x2={padL + plotW} y2={yM(0)} stroke={C.t25} strokeWidth={1} />
      {Array.from({ length: count }, (_, j) => {
        const i = start + j;
        const v = macd.hist[i];
        if (v == null) return null;
        const y0 = yM(Math.max(v, 0)), y1 = yM(Math.min(v, 0));
        return <rect key={i} x={x(i) - bodyW / 2} y={y0} width={bodyW}
          height={Math.max(0.5, y1 - y0)} fill={v >= 0 ? C.green : C.red} opacity={0.5} />;
      })}
      {polyline(macd.macd, C.blue, 1.4, yM)}
      {polyline(macd.signal, C.amber, 1.4, yM)}
      <text x={padL + 4} y={macdPanel.y0 + 11} fill={C.t40} style={{ font: `700 9px ${FONT}` }}>
        MACD 12·26·9 {hover && macd.macd[hover.i] != null ? `· ${fmt(macd.macd[hover.i], 3)}` : ""}
      </text>
    </g>
  );

  // ── crosshair ──
  let crosshair = null;
  if (hover && hover.i >= start && hover.i < end && !dragging) {
    const hx = x(hover.i);
    const panel = stack.find((p) => hover.cy >= p.y0 && hover.cy <= p.y0 + p.h);
    let pill = null;
    if (panel) {
      let val = null;
      if (panel.key === "price") val = fmt(invP(hover.cy));
      else if (panel.key === "volume") val = fmtVol((1 - (hover.cy - panel.y0) / panel.h) * volMax);
      else if (panel.key === "rsi") val = fmt(100 * (1 - (hover.cy - panel.y0) / panel.h), 1);
      else if (panel.key === "macd") val = fmt(macdAbs * (1 - 2 * (hover.cy - panel.y0) / panel.h), 3);
      pill = (
        <g>
          <line x1={padL} y1={hover.cy} x2={padL + plotW} y2={hover.cy} stroke={C.t40} strokeWidth={1} strokeDasharray="3 3" />
          <g transform={`translate(${padL + plotW + 2}, ${hover.cy - 8})`}>
            <rect width={padR - 4} height={16} rx={4} fill={C.card2} stroke="rgba(255,255,255,0.2)" />
            <text x={(padR - 4) / 2} y={11.5} textAnchor="middle" fill="#fff" style={{ font: `700 9px ${FONT}` }}>{val}</text>
          </g>
        </g>
      );
    }
    crosshair = (
      <g pointerEvents="none">
        <line x1={hx} y1={padT} x2={hx} y2={padT + plotH} stroke={C.t40} strokeWidth={1} strokeDasharray="3 3" />
        {pill}
        <g transform={`translate(${Math.min(Math.max(hx - 34, padL), padL + plotW - 68)}, ${H - 20})`}>
          <rect width={68} height={16} rx={4} fill={C.card2} stroke="rgba(255,255,255,0.2)" />
          <text x={34} y={11.5} textAnchor="middle" fill="#fff" style={{ font: `700 9px ${FONT}` }}>{dates[hover.i] || ""}</text>
        </g>
      </g>
    );
  }

  // ── top-left OHLC readout for the hovered (or last) candle ──
  const ri = hover ? hover.i : N - 1;
  const chg = ri > 0 ? ((candles.close[ri] - candles.close[ri - 1]) / candles.close[ri - 1]) * 100 : 0;
  const readout = (
    <text x={padL + 4} y={pricePanel.y0 + 12} style={{ font: `400 10px ${FONT}` }}>
      <tspan fill={C.t50}>O </tspan><tspan fill="#fff">{fmt(candles.open[ri])}</tspan>
      <tspan fill={C.t50}>  H </tspan><tspan fill="#fff">{fmt(candles.high[ri])}</tspan>
      <tspan fill={C.t50}>  L </tspan><tspan fill="#fff">{fmt(candles.low[ri])}</tspan>
      <tspan fill={C.t50}>  C </tspan><tspan fill="#fff">{fmt(candles.close[ri])}</tspan>
      <tspan fill={chg >= 0 ? C.green : C.red}>  {chg >= 0 ? "+" : ""}{fmt(chg)}%</tspan>
    </text>
  );

  const maLines = MA_DEFS.filter((d) => overlays[d.key]).map((d) => {
    const arr = series[d.src[0]]?.[d.src[1]];
    return <g key={d.key}>{polyline(arr, d.color, 1.4)}</g>;
  });

  return (
    <div style={{ width: "100%", aspectRatio: `${W} / ${H}`, maxHeight: maxH, background: C.sub, borderRadius: 16, overflow: "hidden" }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" height="100%"
        onMouseMove={onMouseMove} onMouseDown={onMouseDown} onMouseUp={endDrag}
        onMouseLeave={() => { setHover(null); endDrag(); }}
        style={{ display: "block", cursor: dragging ? "grabbing" : "grab", touchAction: "pan-y" }}>
        <defs>
          {stack.map((p) => (
            <clipPath key={p.key} id={`clip-${p.key}-${uid}`}>
              <rect x={padL} y={p.y0} width={plotW} height={p.h} />
            </clipPath>
          ))}
        </defs>

        {priceTicks}
        {/* separators between stacked panels */}
        {stack.slice(1).map((p) => (
          <line key={p.key} x1={padL} y1={p.y0 - panelGap / 2} x2={padL + plotW} y2={p.y0 - panelGap / 2}
            stroke={C.line} strokeWidth={1} />
        ))}

        <g clipPath={`url(#clip-price-${uid})`}>
          {bollShade}
          {overlays.boll && series.boll && (
            <>
              {polyline(series.boll.upper, "#9AA0AE", 1, yP, "4 3")}
              {polyline(series.boll.mid, "#9AA0AE", 1, yP)}
              {polyline(series.boll.lower, "#9AA0AE", 1, yP, "4 3")}
            </>
          )}
          {candleEls}
          {maLines}
          {fibEls}
          {srEls}
          {zigzagEls}
          {lastEls}
        </g>

        {volEls}
        {rsiEls}
        {macdEls}

        {readout}
        {dateTicks}
        {crosshair}
      </svg>
    </div>
  );
}
