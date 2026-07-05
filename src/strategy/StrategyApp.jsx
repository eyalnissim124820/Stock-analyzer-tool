import React, { useState, useMemo, useEffect, useRef } from "react";
import { C, INSET, fontFor } from "../shared/design.js";
import { T, CHECK_TITLES } from "./strings.js";
import GraphIcon from "../shared/GraphIcon.jsx";
import useChartTouch from "../shared/useChartTouch.js";
import useLongPress from "../shared/useLongPress.js";

// ─────────────────────────────────────────────────────────────
// StrategyApp — the Sequence Method (Strategy & Tactics) tool.
// Locale-parameterized (lang="en"|"he"): one component renders both the LTR
// English and RTL Hebrew versions, reusing the exact same design system as the
// 9-Question analyzer (it is intentionally a sibling, not a fork of App.jsx).
// Data comes live from /api/strategy; every auto-answer is editable and the
// verdict recomputes from the final answers.
// ─────────────────────────────────────────────────────────────

const CONF_COLOR = { exact: C.green, swing: C.blue, guess: C.amber };
const CONF_LABEL = { exact: "EXACT", swing: "SWING", guess: "GUESS" };

// Groups depend on the technique (Technique 2 adds the MA5>MA20 gate G1).
function groupsFor(technique) {
  return [
    { key: "market", ids: ["M1"] },
    { key: "strategy", ids: ["S1", "S2", "S3a", "S3b", "S3c", "S4"] },
    { key: "tactic", ids: technique === 2 ? ["G1"] : [] },
    { key: "correction", ids: ["C1", "C2", "C3"] },
    { key: "timing", ids: ["T1", "T2"] },
  ];
}

// ── verdict resolver (mirrors api/_sequence.js conclude, override-aware) ──
function verdict(data, overrides) {
  const v = (id) => (id in overrides ? overrides[id] : data.checks?.[id]?.value);
  const tech = data.technique;
  const STRAT = ["S1", "S2", "S3a", "S3b", "S3c", "S4", ...(tech === 2 ? ["G1"] : [])];
  const CORR = ["C1", "C2", "C3"], TIME = ["T1", "T2"];
  const all = ["M1", ...STRAT, ...CORR, ...TIME];
  const anyNull = all.some((id) => v(id) == null);
  const marketVoid = v("M1") === "no";
  const stratOk = STRAT.every((id) => v(id) === "yes");
  const corrOk = CORR.every((id) => v(id) === "yes");
  const t1Ok = v("T1") === "yes", t2Ok = v("T2") === "yes";
  const noSetup = data.horizon === "none";
  let firstFail = null;
  for (const id of [...STRAT, ...CORR, ...TIME]) if (v(id) === "no") { firstFail = id; break; }
  let code;
  if (anyNull) code = "INCOMPLETE";
  else if (marketVoid) code = "MARKET_VOID";
  else if (!stratOk || noSetup) code = "NO_TRADE";
  else if (!corrOk || !t1Ok) code = "DO_NOT_ENTER";
  else if (t2Ok) code = "BUY";
  else code = "BUY_LIMIT";
  return { code, firstFail, stratOk, corrOk, t1Ok, t2Ok };
}
const isGood = (code) => code === "BUY" || code === "BUY_LIMIT";

// Sort options offered by the sidebar's "Sorting" button (labels come from the
// locale strings). A-Z by name; Buy floats buy / limit-buy verdicts to the top;
// Market puts US above TLV; D-M orders by timeframe Daily → Weekly → Monthly.
// Sort is stable, so ties keep their order and loading rows fall to the bottom.
const TF_RANK = { Daily: 0, Weekly: 1, Monthly: 2 };
const SORT_IDS = ["az", "buy", "market", "dm"];
function sortStocks(stocks, mode) {
  const codeOf = (s) => (!s.loading && !s.error && s.data ? verdict(s.data, s.overrides).code : null);
  const name = (s) => (s.name || s.display || "").toLowerCase();
  const buyRank = (s) => (isGood(codeOf(s)) ? 0 : 1);
  const mktRank = (s) => (s.market === "US" ? 0 : 1);
  const tfRank = (s) => { const tf = s.data && s.data.timeframe; return tf in TF_RANK ? TF_RANK[tf] : 3; };
  const cmp = {
    az: (a, b) => name(a).localeCompare(name(b)),
    buy: (a, b) => buyRank(a) - buyRank(b),
    market: (a, b) => mktRank(a) - mktRank(b),
    dm: (a, b) => tfRank(a) - tfRank(b),
  }[mode];
  return cmp ? stocks.slice().sort(cmp) : stocks.slice();
}

// One row in the Sorting dropdown (its own component for the hover highlight).
function SortOption({ o, on, onPick, font, dir }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onPick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, width: "100%",
        background: on || h ? "rgba(255,255,255,0.08)" : "transparent", border: "none", cursor: "pointer",
      }}>
      <span style={{ font: `700 15px ${font}`, color: "#fff", flexShrink: 0 }}>{o.label}</span>
      <span style={{ font: `400 12px ${font}`, color: C.t50, flex: 1, textAlign: dir === "rtl" ? "right" : "left" }}>{o.hint}</span>
      {on && <span style={{ font: `700 14px ${font}`, color: C.green }}>✓</span>}
    </button>
  );
}

// "Sorting" button + dropdown shown above the scan list. Clicking an active
// option again clears the sort (back to the default newest-first order).
function SortMenu({ sortMode, setSortMode, t, font, dir }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const opts = SORT_IDS.map((id) => ({ id, ...t.sort[id] }));
  const active = opts.find((o) => o.id === sortMode);
  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        title={t.sort.title}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          background: C.card, borderRadius: 24, boxShadow: INSET, padding: "16px 20px",
          color: open || hover ? "#fff" : C.t70, font: `700 15px ${font}`, border: "none",
          cursor: "pointer", transition: "color .12s", whiteSpace: "nowrap",
        }}>
        <span style={{ font: `400 16px ${font}`, lineHeight: 1 }}>⇅</span> {t.sort.button}{active ? ` · ${active.label}` : ""}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", insetInlineStart: 0, minWidth: 220, zIndex: 50,
          background: C.card2, borderRadius: 16, boxShadow: `${INSET}, 0 12px 28px rgba(0,0,0,0.35)`,
          padding: 8, display: "flex", flexDirection: "column", gap: 4,
        }}>
          {opts.map((o) => (
            <SortOption key={o.id} o={o} on={o.id === sortMode} font={font} dir={dir}
              onPick={() => { setSortMode(o.id === sortMode ? null : o.id); setOpen(false); }} />
          ))}
        </div>
      )}
    </div>
  );
}

function useWindowWidth() {
  const [w, setW] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1440));
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return w;
}

// ── small helpers ──
const cleanSymbol = (raw) => (raw || "").trim().toUpperCase().replace(/\.TA$/, "");
const resolveTicker = (raw, market) => (market === "TLV" ? `${cleanSymbol(raw)}.TA` : cleanSymbol(raw));

// Parse a batch CSV with columns Ticker, Market (US/TLV), Technique (1/2),
// Timeframe (D/W/M — used only by Technique 2). Tolerant of column order, an
// optional header, quotes and blank lines (mirrors the 9-Question batch parser).
function parseBatchCsv(text) {
  const split = (line) => line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const hasHeader = head.some((h) => h.startsWith("ticker"));
  const find = (p, fallback) => { const i = head.findIndex((h) => h.startsWith(p)); return i >= 0 ? i : fallback; };
  const ix = hasHeader
    ? { ticker: find("ticker", 0), market: find("market", 1), tech: find("techn", 2), tf: find("time", 3) >= 0 ? find("time", 3) : find("resol", 3) }
    : { ticker: 0, market: 1, tech: 2, tf: 3 };
  const rows = [];
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const cols = split(lines[i]);
    const rawSymbol = cleanSymbol(cols[ix.ticker] || "");
    if (!rawSymbol) continue;
    const mk = (cols[ix.market] || "US").toUpperCase();
    const market = mk === "TLV" || mk === "TA" || mk === "TASE" ? "TLV" : "US";
    const techRaw = (cols[ix.tech] || "1").toUpperCase();
    const technique = (techRaw.startsWith("2") || techRaw.startsWith("S")) ? 2 : 1; // 2 / "Single"
    const tfRaw = (cols[ix.tf] || "W").toUpperCase();
    const tf = tfRaw.startsWith("D") ? "Daily" : tfRaw.startsWith("M") ? "Monthly" : "Weekly";
    rows.push({ rawSymbol, market, technique, tf });
  }
  return rows;
}

function BatchModal({ batch, t, font, dir, onScanAll, onCancel }) {
  const count = batch.rows.length;
  const parts = t.batch.foundParts(count);
  const btn = { display: "flex", alignItems: "center", justifyContent: "center", padding: "12px 22px", borderRadius: 16, font: `700 15px ${font}`, border: "none", cursor: "pointer", whiteSpace: "nowrap" };
  const b = (txt) => <strong style={{ color: "#fff", fontWeight: 700 }}>{txt}</strong>;
  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.6)", padding: 20 }}>
      <div dir={dir} onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 440, background: C.card, borderRadius: 24, boxShadow: `${INSET}, 0 24px 60px rgba(0,0,0,0.5)`, padding: 28, display: "flex", flexDirection: "column", gap: 16 }}>
        <span style={{ font: `700 20px ${font}`, color: "#fff" }}>{t.batch.title}</span>
        <span style={{ font: `400 14px ${font}`, color: C.t70, lineHeight: 1.6 }}>
          {b(count)}{parts.mid}{b(batch.fileName)}{parts.post}
        </span>
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 4, flexWrap: "wrap" }}>
          <button onClick={onCancel} style={{ ...btn, background: C.chip, color: "#fff" }}>{t.batch.cancel}</button>
          <button onClick={onScanAll} disabled={count === 0} style={{ ...btn, background: count === 0 ? "rgba(255,255,255,0.4)" : "#fff", color: C.card, cursor: count === 0 ? "not-allowed" : "pointer" }}>{t.batch.scanAll}</button>
        </div>
      </div>
    </div>
  );
}

// ── UI atoms ──
function Badge({ conf, font, t }) {
  const color = CONF_COLOR[conf];
  if (!color) return null;
  return (
    <span title={t.confTip[conf]} style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", padding: "2px 8px",
      borderRadius: 40, background: color + "22", color, cursor: "help", flexShrink: 0,
    }}>{CONF_LABEL[conf]}</span>
  );
}

function Pill({ label, on, tint, mobile, onClick, font }) {
  const base = {
    display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 16px",
    borderRadius: 40, font: `700 16px ${font}`, cursor: "pointer", border: "none",
    minWidth: mobile ? 72 : 64, height: mobile ? 44 : 35, transition: "all .12s",
  };
  return <button onClick={onClick} style={on ? { ...base, background: tint, color: "#fff" } : { ...base, background: C.chip, color: C.t40 }}>{label}</button>;
}

// "?" affordance with a styled explanation card (hover/focus), clamped to the viewport.
function HelpTip({ children, font, dir, width = 300 }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const shownAt = useRef(0); // touch taps fire mouseenter+click together — don't let the click instantly re-hide
  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const margin = 8, estH = 230, vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(width, vw - 2 * margin);
    let left = Math.max(margin, Math.min(r.left + r.width / 2 - w / 2, vw - w - margin));
    const below = r.top < estH + 2 * margin;
    setPos({ left: Math.round(left), width: w, ...(below ? { top: Math.round(r.bottom + margin) } : { bottom: Math.round(vh - r.top + margin) }) });
  };
  return (
    <span style={{ display: "inline-flex", flexShrink: 0 }} onMouseEnter={() => { place(); setOpen(true); shownAt.current = Date.now(); }} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label="Help" ref={btnRef} onFocus={() => { place(); setOpen(true); shownAt.current = Date.now(); }} onBlur={() => setOpen(false)}
        onClick={() => (open && Date.now() - shownAt.current > 500 ? setOpen(false) : (place(), setOpen(true), (shownAt.current = Date.now())))}
        style={{ width: 18, height: 18, borderRadius: "50%", border: "none", cursor: "help", background: C.chip, color: C.t70, font: `700 12px ${font}`, lineHeight: "18px", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>?</button>
      {open && pos && (
        <span style={{ position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, zIndex: 1000, background: C.card2, color: C.t70, borderRadius: 12, padding: "12px 14px", boxShadow: `${INSET}, 0 12px 28px rgba(0,0,0,0.35)`, font: `400 12px ${font}`, lineHeight: 1.5, textAlign: dir === "rtl" ? "right" : "left", pointerEvents: "none" }}>{children}</span>
      )}
    </span>
  );
}

function ContextMenu({ x, y, items, onClose, font }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    const w = r?.width || 200, h = r?.height || 100, margin = 8;
    setPos({ left: Math.max(margin, Math.min(x, window.innerWidth - w - margin)), top: Math.max(margin, Math.min(y, window.innerHeight - h - margin)) });
  }, [x, y]);
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close); window.addEventListener("touchstart", close); window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close); window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("touchstart", close); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); window.removeEventListener("keydown", onKey); };
  }, [onClose]);
  return (
    <div ref={ref} onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}
      style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 1100, minWidth: 160, background: C.card2, borderRadius: 12, padding: 6, boxShadow: `${INSET}, 0 12px 28px rgba(0,0,0,0.45)`, display: "flex", flexDirection: "column", gap: 2 }}>
      {items.map((it, i) => <ContextItem key={i} item={it} onClose={onClose} font={font} />)}
    </div>
  );
}
function ContextItem({ item, onClose, font }) {
  const [hover, setHover] = useState(false);
  return (
    <button onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={() => { item.onClick(); onClose(); }}
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "start", padding: "9px 12px", borderRadius: 8, border: "none", cursor: "pointer", background: hover ? "rgba(255,255,255,0.08)" : "transparent", color: item.danger ? C.red : "#fff", font: `600 14px ${font}`, whiteSpace: "nowrap" }}>
      {item.icon && <span style={{ width: 16, textAlign: "center" }}>{item.icon}</span>}{item.label}
    </button>
  );
}

function Stat({ label, v, sub, color, font }) {
  return (
    <div style={{ flex: 1, minWidth: 150, background: C.card2, borderRadius: 16, boxShadow: INSET, padding: "14px 18px" }}>
      <div style={{ font: `700 10px ${font}`, letterSpacing: "0.06em", textTransform: "uppercase", color: C.t50 }}>{label}</div>
      <div style={{ font: `700 22px ${font}`, color, margin: "4px 0" }}>{v}</div>
      <div style={{ font: `400 11px ${font}`, color: C.t50, lineHeight: 1.35 }}>{sub}</div>
    </div>
  );
}
function Metric({ label, value, font }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ font: `400 16px ${font}`, color: C.t70 }}>{label}</span>
      <span style={{ font: `700 16px ${font}`, color: "#fff" }}>{value}</span>
    </div>
  );
}
function InfoCard({ children, font, color = C.t70 }) {
  return <div style={{ borderRadius: 16, background: C.sub, padding: "14px 18px", font: `400 14px ${font}`, color, lineHeight: 1.6 }}>{children}</div>;
}

// ── root component ──
export default function StrategyApp({ lang = "en", onOpenChart }) {
  const t = T[lang] || T.en;
  const font = fontFor(lang);
  const dir = t.dir;
  const isMobile = useWindowWidth() < 920;

  const [market, setMarket] = useState("US");
  const [technique, setTechnique] = useState(1);
  const [timeframe, setTimeframe] = useState("Weekly");
  const [symbol, setSymbol] = useState("");
  const [swingN, setSwingN] = useState(2);
  const [stocks, setStocks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [menu, setMenu] = useState(null);
  const [batch, setBatch] = useState(null); // { rows, fileName } while the confirm popup is open
  const nextId = useRef(1);
  const swingTimer = useRef(null);
  const fileRef = useRef(null);

  async function fetchStock({ rawSymbol, market: mkt, tech, tf, n, existingId }) {
    const display = cleanSymbol(rawSymbol);
    if (!display) return;
    const ticker = resolveTicker(rawSymbol, mkt);
    const id = existingId || `s${nextId.current++}`;
    const stub = { id, market: mkt, display, ticker, name: display, loading: true, error: null, data: null, overrides: {}, fetchedAt: new Date() };
    setStocks((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx >= 0) { const copy = prev.slice(); copy[idx] = { ...copy[idx], loading: true, error: null }; return copy; }
      return [stub, ...prev];
    });
    setSelectedId(id);
    try {
      const url = `/api/strategy?ticker=${encodeURIComponent(ticker)}&market=${encodeURIComponent(mkt)}&technique=${tech}&timeframe=${encodeURIComponent(tf)}&swingN=${n}&lang=${lang}`;
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Request failed");
      setStocks((prev) => prev.map((s) => s.id === id
        ? { ...s, loading: false, error: null, data: j, name: j.name || s.name, overrides: existingId ? s.overrides : {}, fetchedAt: new Date() }
        : s));
    } catch (e) {
      setStocks((prev) => prev.map((s) => s.id === id ? { ...s, loading: false, error: e.message } : s));
    }
  }

  function analyze() {
    if (!symbol.trim()) return;
    fetchStock({ rawSymbol: symbol, market, tech: technique, tf: timeframe, n: swingN });
    setSymbol("");
    if (isMobile) setMobileDetail(true);
  }
  const selectStock = (id) => { setSelectedId(id); if (isMobile) setMobileDetail(true); };
  const selected = stocks.find((s) => s.id === selectedId) || null;

  // Re-run the selected scan when a parameter changes so the detail reflects it.
  function reRun(patch) {
    if (selected && !selected.loading && selected.data)
      fetchStock({ rawSymbol: selected.display, market: selected.market, tech: patch.tech ?? technique, tf: patch.tf ?? timeframe, n: patch.n ?? swingN, existingId: selected.id });
  }
  function onTechnique(tech) { setTechnique(tech); reRun({ tech }); }
  function onTimeframe(tf) { setTimeframe(tf); if (technique === 2) reRun({ tf }); }
  function onSwing(n) {
    setSwingN(n);
    if (swingTimer.current) clearTimeout(swingTimer.current);
    if (selected && !selected.loading && selected.data) swingTimer.current = setTimeout(() => reRun({ n }), 450);
  }

  const setOverride = (stockId, checkId, value) =>
    setStocks((prev) => prev.map((s) => s.id === stockId ? { ...s, overrides: { ...s.overrides, [checkId]: value } } : s));
  function removeStock(stockId) {
    setStocks((prev) => { const next = prev.filter((s) => s.id !== stockId); if (stockId === selectedId) setSelectedId(next.length ? next[0].id : null); return next; });
  }

  // ── batch analysis (CSV upload) ──
  function openBatch() { if (fileRef.current) fileRef.current.click(); }
  function onBatchFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setBatch({ rows: parseBatchCsv(String(reader.result || "")), fileName: file.name });
    reader.readAsText(file);
    e.target.value = ""; // reset so re-selecting the same file fires onChange again
  }
  function clearBatch() { setBatch(null); if (fileRef.current) fileRef.current.value = ""; }
  function downloadDemoFile() {
    const csv = "Ticker,Market,Technique,Timeframe\nAAPL,US,1,W\nNVDA,US,2,W\nTEVA,TLV,1,M\n629014,TLV,2,D\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    a.download = "batch_strategy_example.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function scanAll() {
    if (!batch) return;
    const ids = batch.rows.map((r) => {
      const id = `s${nextId.current++}`;
      return { id, display: cleanSymbol(r.rawSymbol), ticker: resolveTicker(r.rawSymbol, r.market), market: r.market, row: r };
    });
    setStocks((prev) => [
      ...ids.map((x) => ({ id: x.id, display: x.display, market: x.market, name: x.display, ticker: x.ticker, loading: true, error: null, data: null, overrides: {}, fetchedAt: new Date() })),
      ...prev,
    ]);
    clearBatch();
    processBatchQueue(ids, 0);
  }
  // Fetch in waves of 5, then recurse to the next wave.
  async function processBatchQueue(ids, startIdx) {
    if (startIdx >= ids.length) return;
    const wave = ids.slice(startIdx, startIdx + 5);
    const results = await Promise.all(wave.map((x) => {
      const r = x.row;
      const url = `/api/strategy?ticker=${encodeURIComponent(x.ticker)}&market=${encodeURIComponent(x.market)}&technique=${r.technique}&timeframe=${encodeURIComponent(r.tf)}&swingN=${swingN}&lang=${lang}`;
      return fetch(url).then((res) => res.json())
        .then((j) => (!j.error ? { id: x.id, data: j } : { id: x.id, error: j.error || "Failed" }))
        .catch((e) => ({ id: x.id, error: e.message }));
    }));
    setStocks((prev) => prev.map((s) => {
      const res = results.find((r) => r.id === s.id);
      if (!res) return s;
      return { ...s, loading: false, error: res.error || null, data: res.data || null, name: res.data?.name || s.name, fetchedAt: new Date() };
    }));
    processBatchQueue(ids, startIdx + 5);
  }

  return (
    <div dir={dir} style={{ display: "flex", flexDirection: isMobile ? "column" : "row", height: isMobile ? "100dvh" : "100vh", width: "100%", background: C.bg, fontFamily: font, color: C.text, overflow: "hidden", ...(isMobile ? { paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" } : null) }}>
      {(!isMobile || !mobileDetail) && (
        <Sidebar {...{ t, font, dir, isMobile, market, setMarket, technique, onTechnique, timeframe, onTimeframe, symbol, setSymbol, analyze, swingN, onSwing, stocks, selectedId, setSelectedId: selectStock, removeStock, onBatch: openBatch, onDownloadDemo: downloadDemoFile, onContext: (e, s) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, stock: s }); } }} />
      )}
      {(!isMobile || mobileDetail) && (
        <Main {...{ t, font, dir, isMobile, onBack: () => setMobileDetail(false), stock: selected, setOverride, refresh: () => selected && reRun({}) }} />
      )}
      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onBatchFile} style={{ display: "none" }} />
      {batch && <BatchModal batch={batch} t={t} font={font} dir={dir} onScanAll={scanAll} onCancel={clearBatch} />}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} font={font} onClose={() => setMenu(null)} items={[
          ...(onOpenChart ? [{ label: lang === "he" ? "גרף" : "Graph", icon: <GraphIcon />, onClick: () => onOpenChart({ symbol: menu.stock.display, market: menu.stock.market }) }] : []),
          { label: lang === "he" ? "הסרה" : "Remove", icon: "×", danger: true, onClick: () => removeStock(menu.stock.id) },
        ]} />
      )}
    </div>
  );
}

// ── Sidebar ──
function Sidebar({ t, font, dir, isMobile, market, setMarket, technique, onTechnique, timeframe, onTimeframe, symbol, setSymbol, analyze, swingN, onSwing, stocks, selectedId, setSelectedId, removeStock, onBatch, onDownloadDemo, onContext }) {
  const [focus, setFocus] = useState(false);
  const [batchHover, setBatchHover] = useState(false);
  const [demoHover, setDemoHover] = useState(false);
  const [sortMode, setSortMode] = useState(null);
  const ctlH = isMobile ? 56 : 69;
  const ctlBtn = { display: "flex", alignItems: "center", justifyContent: "center", height: ctlH, padding: isMobile ? "0 14px" : "0 20px", borderRadius: 16, color: "#fff", font: `700 15px ${font}`, border: "none", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, transition: "background .12s", background: "rgba(0,0,0,0.18)" };
  const mobileToggle = isMobile ? { flex: "1 1 0", minWidth: 0 } : null;
  const mobileFull = isMobile ? { flex: "1 1 100%" } : null;

  return (
    <aside style={{ width: isMobile ? "100%" : 640, flexShrink: 0, height: "100%", maxHeight: "100%", display: "flex", flexDirection: "column", gap: isMobile ? 16 : 24, padding: isMobile ? 16 : 36, boxSizing: "border-box" }}>
      {/* Control bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, background: C.card, borderRadius: 24, boxShadow: INSET, padding: 16, flexShrink: 0, flexWrap: "wrap" }}>
        <button onClick={() => setMarket(market === "US" ? "TLV" : "US")} style={{ ...ctlBtn, ...mobileToggle }} title={t.market[market]}>{t.market[market]}</button>
        <button onClick={() => onTechnique(technique === 1 ? 2 : 1)} style={{ ...ctlBtn, ...mobileToggle }} title={technique === 1 ? t.tech1Full : t.tech2Full}>{technique === 1 ? t.tech1 : t.tech2}</button>
        {technique === 2 && (
          <button onClick={() => onTimeframe(timeframe === "Daily" ? "Weekly" : timeframe === "Weekly" ? "Monthly" : "Daily")} style={{ ...ctlBtn, ...mobileToggle }} title={t.timeframe}>{timeframe}</button>
        )}
        <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && analyze()} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} placeholder={market === "TLV" ? t.symbolPlaceholderTLV : t.symbolPlaceholder} maxLength={24}
          className={dir === "rtl" ? "ltr" : undefined}
          style={{ flex: 1, minWidth: isMobile ? 0 : 110, height: ctlH, padding: "0 20px", borderRadius: 16, background: focus ? "rgba(0,0,0,0.30)" : "rgba(0,0,0,0.18)", color: "#fff", font: `700 18px ${font}`, border: "none", outline: "none", textAlign: "center", letterSpacing: "0.04em", boxShadow: focus ? "inset 0 0 0 2px #fff" : "none", ...mobileFull }} />
        <button onClick={analyze} style={{ ...ctlBtn, ...mobileFull, background: "#fff", color: C.card }}>{t.analyze}</button>
      </div>

      {/* Swing sensitivity */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, background: C.card, borderRadius: 24, boxShadow: INSET, padding: "14px 20px", flexShrink: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <span style={{ font: `700 14px ${font}`, color: C.t70, whiteSpace: "nowrap" }}>{t.swing}</span>
          <HelpTip font={font} dir={dir}>{t.swingHelp}</HelpTip>
        </span>
        <input type="range" min={1} max={5} value={swingN} onChange={(e) => onSwing(+e.target.value)} style={{ flex: 1, minWidth: 0, accentColor: C.green }} />
        <span style={{ font: `700 16px ${font}`, color: "#fff", minWidth: 16, textAlign: "center" }}>{swingN}</span>
      </div>

      {/* Batch analysis + demo + sorting (shown once there are results) */}
      <div style={{ display: "flex", gap: 12, flexShrink: 0 }}>
        <button onClick={onBatch} onMouseEnter={() => setBatchHover(true)} onMouseLeave={() => setBatchHover(false)} title={t.batch.buttonTitle}
          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: C.card, borderRadius: 24, boxShadow: INSET, padding: "16px 20px", color: batchHover ? "#fff" : C.t70, font: `700 15px ${font}`, border: "none", cursor: "pointer", transition: "color .12s" }}>
          <span style={{ font: `700 18px ${font}`, lineHeight: 1 }}>⬆</span> {t.batch.button}
        </button>
        <button onClick={onDownloadDemo} onMouseEnter={() => setDemoHover(true)} onMouseLeave={() => setDemoHover(false)} title={t.batch.demoTitle}
          style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: C.card, borderRadius: 24, boxShadow: INSET, padding: "16px 18px", color: demoHover ? "#fff" : C.t50, font: `700 13px ${font}`, border: "none", cursor: "pointer", transition: "color .12s", whiteSpace: "nowrap" }}>
          <span style={{ font: `400 16px ${font}`, lineHeight: 1 }}>⬇</span> {t.batch.demo}
        </button>
        {stocks.length > 0 && <SortMenu sortMode={sortMode} setSortMode={setSortMode} t={t} font={font} dir={dir} />}
      </div>

      {/* Stock list */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, padding: "4px 16px 24px" }}>
        {stocks.length === 0 && (
          <div style={{ padding: 16, textAlign: "center" }}>
            <span style={{ font: `700 16px ${font}`, color: C.t50 }}>{t.emptyList}</span>
          </div>
        )}
        {(sortMode ? sortStocks(stocks, sortMode) : stocks).map((s) => (
          <StockRow key={s.id} {...{ s, t, font, dir, isMobile, selected: s.id === selectedId, onClick: () => !s.loading && setSelectedId(s.id), onRemove: () => removeStock(s.id), onContext }} />
        ))}
      </div>
    </aside>
  );
}

function StockRow({ s, t, font, dir, isMobile, selected, onClick, onRemove, onContext }) {
  const [hover, setHover] = useState(false);
  // iOS never fires contextmenu for touches — long-press opens the same menu.
  const longPress = useLongPress((e) => onContext && onContext(e, s));
  const showX = isMobile ? !s.loading : hover;
  let chipBg = C.card2;
  if (s.error) chipBg = C.red;
  else if (!s.loading && s.data) {
    const code = verdict(s.data, s.overrides).code;
    chipBg = isGood(code) ? C.green : code === "INCOMPLETE" ? C.card2 : C.red;
  }
  const tf = (s.data && s.data.timeframe) || "";
  const sub = s.error ? t.failedShort : `${t.market[s.market]} · ${s.data ? (t.horizon[s.data.horizon] || tf) : "…"}${s.data ? " · " + s.data.lastDate : ""}`;
  return (
    <div onClick={onClick} onContextMenu={(e) => onContext && onContext(e, s)} {...longPress} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ position: "relative", display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 20, cursor: s.loading ? "default" : "pointer", transition: "background .12s", background: selected ? "rgba(255,255,255,0.06)" : hover ? "rgba(255,255,255,0.03)" : "transparent", WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none", WebkitTapHighlightColor: "transparent" }}>
      <div className={dir === "rtl" ? "ltr" : undefined} style={{ width: 80, height: 43, flexShrink: 0, borderRadius: 8, background: chipBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ font: `700 16px ${font}`, color: "#fff" }}>{s.display}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4, paddingInlineEnd: showX ? 28 : 0 }}>
        <span style={{ font: `700 16px ${font}`, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
        <span style={{ font: `400 12px ${font}`, color: s.error ? C.red : C.t50 }}>{sub}</span>
      </div>
      {s.loading && <div style={{ width: 32, height: 32, flexShrink: 0, borderRadius: "50%", border: "3px solid #343238", borderTopColor: C.blue, animation: "spin .8s linear infinite" }} />}
      {showX && (
        <button onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label="Remove" style={{ position: "absolute", top: 8, insetInlineEnd: 8, width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", background: "rgba(0,0,0,0.35)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.25)", color: C.t70, border: "none", font: `400 16px ${font}`, lineHeight: 1 }}>×</button>
      )}
    </div>
  );
}

// ── Main detail pane ──
function Main({ t, font, dir, isMobile, onBack, stock, setOverride, refresh }) {
  return (
    <main style={{ flex: 1, minWidth: 0, height: "100%", minHeight: 0, padding: isMobile ? "12px 12px 16px" : 20, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: isMobile ? 10 : 0, overflowX: isMobile ? "hidden" : undefined }}>
      {isMobile && (
        <button onClick={onBack} style={{ flexShrink: 0, alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 8, padding: "10px 18px", borderRadius: 40, background: C.card, boxShadow: INSET, color: C.t70, font: `700 14px ${font}`, border: "none", cursor: "pointer" }}>{t.backToList}</button>
      )}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative", borderRadius: isMobile ? 24 : 40, background: C.card, boxShadow: INSET, overflow: "hidden" }}>
        {!stock || stock.loading || stock.error || !stock.data ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
            <span style={{ font: `700 16px ${font}`, color: stock && stock.error ? C.red : C.t25 }}>
              {stock && stock.error ? t.failed(stock.ticker, stock.error) : stock && stock.loading ? t.analyzing(stock.ticker) : t.selectPrompt}
            </span>
          </div>
        ) : (
          <Detail {...{ t, font, dir, isMobile, stock, setOverride, refresh }} />
        )}
      </div>
    </main>
  );
}

function Detail({ t, font, dir, isMobile, stock, setOverride, refresh }) {
  const { data, overrides } = stock;
  const m = data.math;
  const cur = data.currency || "";
  const fmt = (x, d = 2) => (x == null || isNaN(x) ? "—" : Number(x).toFixed(d));
  const v = (id) => (id in overrides ? overrides[id] : data.checks?.[id]?.value);
  const concl = useMemo(() => verdict(data, overrides), [data, overrides]);
  const vbg = isGood(concl.code) ? C.green : concl.code === "INCOMPLETE" ? C.chip : C.red;
  const rcol = concl.t2Ok ? C.green : C.red;
  const showPlan = isGood(concl.code);
  const groups = groupsFor(data.technique);
  const cascade = data.cascade || {};
  const reasonFn = t.cascadeReason[cascade.reason] || (() => "");
  const fetchedAt = stock.fetchedAt ? stock.fetchedAt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

  return (
    <div style={{ position: "absolute", inset: 0, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 16, padding: 16 }}>
      {/* Verdict header */}
      <div style={{ flexShrink: 0, borderRadius: 24, background: C.card2, boxShadow: `${INSET}, 0 12px 24px rgba(0,0,0,0.1)`, padding: isMobile ? "16px 18px" : "20px 24px", display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: isMobile ? "flex-start" : "space-between", alignItems: isMobile ? "stretch" : "center", gap: isMobile ? 12 : 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 6 : 12, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flexWrap: "wrap" }}>
            <span className={dir === "rtl" ? "ltr" : undefined} style={{ font: `700 ${isMobile ? 20 : 24}px ${font}`, color: "#fff", flexShrink: 0 }}>{stock.display}</span>
            <span style={{ font: `700 11px ${font}`, letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 40, background: C.chip, color: C.t70, flexShrink: 0 }}>{t.market[stock.market]}</span>
            <span style={{ font: `700 11px ${font}`, letterSpacing: "0.06em", padding: "3px 10px", borderRadius: 40, background: C.blue + "22", color: C.blue, flexShrink: 0 }}>{data.technique === 2 ? t.tech2 : t.tech1}</span>
            <span style={{ font: `400 ${isMobile ? 15 : 22}px ${font}`, color: C.t70, minWidth: 0, ...(isMobile ? {} : { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }) }}>{data.name}</span>
          </div>
          <span style={{ font: `400 12px ${font}`, color: C.t70 }}>
            {data.exchange} · {t.horizonLabel}: {t.horizon[data.horizon] || "—"} · {t.horizonOn(data.timeframe)} · last {data.lastDate} · {cur}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0, ...(isMobile ? { justifyContent: "space-between" } : {}) }}>
          <div style={{ textAlign: dir === "rtl" ? "left" : "right", lineHeight: 1.35 }}>
            <div style={{ font: `400 10px ${font}`, letterSpacing: "0.08em", textTransform: "uppercase", color: C.t50 }}>{t.fetched}</div>
            <div style={{ font: `400 12px ${font}`, color: C.t70 }}>{fetchedAt}</div>
          </div>
          <button onClick={refresh} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 40, background: C.chip, color: "#fff", font: `700 14px ${font}`, border: "none", cursor: "pointer", whiteSpace: "nowrap" }}>↻ {t.refresh}</button>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 16px", borderRadius: 40, background: vbg, color: "#fff", font: `700 16px ${font}`, whiteSpace: "nowrap", flexShrink: 0 }}>{t.verdict[concl.code]}</div>
        </div>
      </div>

      {/* Risk / Reward / Ratio bar */}
      <div style={{ flexShrink: 0, borderRadius: 16, background: C.sub, padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 32, flexWrap: "wrap" }}>
          <Metric label={t.risk} value={`${fmt(m.risk)}%`} font={font} />
          <Metric label={t.reward} value={`${fmt(m.reward)}%`} font={font} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ font: `400 16px ${font}`, color: rcol }}>{t.ratio}</span>
          <span style={{ font: `700 16px ${font}`, color: rcol }}>{fmt(m.ratio)}×</span>
        </div>
      </div>

      {/* Check groups */}
      {groups.map((g, gi) => {
        const meta = t.groups[g.key];
        if (g.key === "tactic" && g.ids.length === 0 && data.technique === 1) {
          // Technique 1: no G1 check — show the cascade resolution instead.
          return (
            <React.Fragment key={g.key}>
              <div style={{ height: 1, background: C.line, margin: "8px 20px", flexShrink: 0 }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 20px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ font: `700 20px ${font}`, color: "#fff" }}>{meta.title}</span>
                  <span style={{ font: `700 12px ${font}`, letterSpacing: "0.08em", color: C.t50 }}>{meta.caption}</span>
                </div>
                <InfoCard font={font}>
                  <strong style={{ color: "#fff", fontWeight: 700 }}>{t.horizon[data.horizon] || "—"}</strong> — {reasonFn(data.timeframe)}
                </InfoCard>
              </div>
            </React.Fragment>
          );
        }
        return (
          <React.Fragment key={g.key}>
            <div style={{ height: 1, background: C.line, margin: "8px 20px", flexShrink: 0 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: "0 20px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ font: `700 20px ${font}`, color: "#fff" }}>{meta.title}</span>
                <span style={{ font: `700 12px ${font}`, letterSpacing: "0.08em", color: C.t50 }}>{meta.caption}</span>
                {g.key === "tactic" && data.technique === 2 && <InfoCard font={font} color={C.t50}>{reasonFn(data.timeframe)}</InfoCard>}
              </div>
              {g.ids.map((id) => {
                const ch = data.checks[id] || {};
                const cval = v(id);
                const edited = id in overrides;
                const allowNA = id === "M1";
                const pills = (
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <Pill label={lang_yes(t)} on={cval === "yes"} tint={C.green} mobile={isMobile} onClick={() => setOverride(stock.id, id, "yes")} font={font} />
                    <Pill label={lang_no(t)} on={cval === "no"} tint={C.red} mobile={isMobile} onClick={() => setOverride(stock.id, id, "no")} font={font} />
                    {allowNA && <Pill label="N/A" on={cval === "na"} tint="#7E8AA0" mobile={isMobile} onClick={() => setOverride(stock.id, id, "na")} font={font} />}
                  </div>
                );
                return isMobile ? (
                  <div key={id} style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, minWidth: 0 }}>
                      <Tag id={id} font={font} />
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ font: `700 15px ${font}`, color: "#fff", lineHeight: 1.3 }}>{CHECK_TITLES[langOf(t)][id]}</span>
                          <Badge conf={ch.conf} font={font} t={t} />
                          {edited && <span style={{ font: `700 10px ${font}`, letterSpacing: "0.08em", color: C.amber }}>{t.edited}</span>}
                        </div>
                        {ch.why && <span style={{ font: `400 12px ${font}`, color: C.t70, lineHeight: 1.4, overflowWrap: "break-word" }}>{ch.why}</span>}
                      </div>
                    </div>
                    <div style={{ paddingInlineStart: 54 }}>{pills}</div>
                  </div>
                ) : (
                  <div key={id} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <Tag id={id} font={font} />
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ font: `700 16px ${font}`, color: "#fff" }}>{CHECK_TITLES[langOf(t)][id]}</span>
                        <Badge conf={ch.conf} font={font} t={t} />
                        {edited && <span style={{ font: `700 10px ${font}`, letterSpacing: "0.08em", color: C.amber }}>{t.edited}</span>}
                      </div>
                      {ch.why && <span style={{ font: `400 12px ${font}`, color: C.t70 }}>{ch.why}</span>}
                    </div>
                    {pills}
                  </div>
                );
              })}
            </div>
          </React.Fragment>
        );
      })}

      {/* The Math */}
      <div style={{ height: 1, background: C.line, margin: "8px 20px", flexShrink: 0 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "0 20px" }}>
        <SectionTitle title={t.math.title} caption={t.math.caption} font={font} />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Stat label={t.buy} v={fmt(m.buy)} sub={t.buySub} color={C.blue} font={font} />
          <Stat label={t.stop} v={fmt(m.stopLow)} sub={t.stopSub} color={C.red} font={font} />
          <Stat label={t.target} v={fmt(m.target)} sub={t.targetSub} color={C.green} font={font} />
        </div>
        {m.ratio != null && m.ratio < 1.5 && m.maxBuy != null && (
          <InfoCard font={font}>
            {t.ratioLow(m.maxBuy, cur)}<strong style={{ color: C.amber, fontWeight: 700 }}>{fmt(m.maxBuy)} {cur}</strong>.
            <div style={{ marginTop: 4, color: C.t50 }}>{t.ratioLowTail}</div>
          </InfoCard>
        )}
      </div>

      {/* Buy timing + position + sell — only when the verdict is a buy */}
      {showPlan && (
        <>
          <div style={{ height: 1, background: C.line, margin: "8px 20px", flexShrink: 0 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "0 20px" }}>
            <SectionTitle title={t.buyTiming.title} caption={t.buyTiming.caption} font={font} />
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Stat label={t.optA} v={`${fmt(m.midCandle)} ${cur}`} sub={t.optASub(cur)} color={C.blue} font={font} />
              <Stat label={t.optB} v="↓ Daily" sub={t.optBSub} color={C.green} font={font} />
              <Stat label={t.optC} v="50 / 50" sub={t.optCSub} color={C.amber} font={font} />
            </div>
            <InfoCard font={font} color={C.t50}>{t.noPrePost}</InfoCard>
          </div>

          <div style={{ height: 1, background: C.line, margin: "8px 20px", flexShrink: 0 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "0 20px" }}>
            <SectionTitle title={t.position.title} caption={t.position.caption} font={font} />
            <InfoCard font={font} color={data.position?.riskZero ? C.green : C.t70}>
              {data.position?.riskZero ? t.riskZeroYes : t.riskZeroNo}
            </InfoCard>
          </div>

          <div style={{ height: 1, background: C.line, margin: "8px 20px", flexShrink: 0 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "0 20px" }}>
            <SectionTitle title={t.sell.title} caption={t.sell.caption} font={font} />
            <MonCard color={C.red} font={font} items={t.sellItems(data.sell || {}, cur, data.sell?.lastIsSeller)} />
          </div>
        </>
      )}

      {/* Chart */}
      <AnalysisChart data={data} t={t} font={font} dir={dir} isMobile={isMobile} />
      <div style={{ height: 60, flexShrink: 0 }} />
    </div>
  );
}

function SectionTitle({ title, caption, font }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ font: `700 20px ${font}`, color: "#fff" }}>{title}</span>
      <span style={{ font: `700 12px ${font}`, letterSpacing: "0.08em", color: C.t50 }}>{caption}</span>
    </div>
  );
}
function Tag({ id, font }) {
  return (
    <div style={{ width: 46, height: 42, flexShrink: 0, borderRadius: 12, background: C.chip, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ font: `700 14px ${font}`, color: C.t50 }}>{id}</span>
    </div>
  );
}
function MonCard({ font, color, items }) {
  return (
    <div style={{ borderRadius: 16, background: C.card2, boxShadow: INSET, overflow: "hidden" }}>
      {items.map(([title, desc], i) => (
        <div key={i} style={{ padding: "12px 18px", borderBottom: i < items.length - 1 ? `1px solid ${C.line}` : "none" }}>
          <div style={{ font: `700 14px ${font}`, color }}>{title}</div>
          <div style={{ font: `400 12px ${font}`, color: C.t50, marginTop: 2, lineHeight: 1.5 }}>{desc}</div>
        </div>
      ))}
    </div>
  );
}

// tiny locale helpers (Yes/No are not in `t` to keep strings lean)
const lang_yes = (t) => (t.dir === "rtl" ? "כן" : "Yes");
const lang_no = (t) => (t.dir === "rtl" ? "לא" : "No");
const langOf = (t) => (t.dir === "rtl" ? "he" : "en");

// ── Chart (candlesticks + MA5/MA20/MA40 + Bollinger + levels) ──
function AnalysisChart({ data, t, font, dir, isMobile }) {
  const [tier, setTier] = useState("Core");
  const [expanded, setExpanded] = useState(false);
  const N = data?.candles?.close?.length || 0;
  const [view, setView] = useState({ start: 0, count: N });
  useEffect(() => { setView({ start: 0, count: N }); }, [data, N]);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);
  if (!N) return null;

  const TIERS = ["Minimal", "Core", "Full"];
  const tierSel = (
    <div style={{ display: "flex", gap: 4, background: C.sub, borderRadius: 40, padding: 4 }}>
      {TIERS.map((k, i) => (
        <button key={k} onClick={() => setTier(k)} style={{ font: `700 12px ${font}`, padding: "6px 12px", borderRadius: 40, border: "none", cursor: "pointer", background: tier === k ? C.chip : "transparent", color: tier === k ? "#fff" : C.t50 }}>{t.tiers[i]}</button>
      ))}
    </div>
  );
  const hint = <span style={{ font: `400 11px ${font}`, color: C.t50 }}>{t.chartHint}</span>;

  return (
    <>
      <div style={{ height: 1, background: C.line, margin: "8px 20px", flexShrink: 0 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 20px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <SectionTitle title={t.chart.title} caption={t.chart.caption} font={font} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {tierSel}
            <button onClick={() => setExpanded(true)} style={{ display: "flex", alignItems: "center", gap: 6, font: `700 12px ${font}`, padding: "6px 12px", borderRadius: 40, border: "none", cursor: "pointer", background: C.chip, color: "#fff" }}>{t.expand}</button>
          </div>
        </div>
        <ChartCanvas data={data} tier={tier} view={view} setView={setView} W={720} H={isMobile ? 280 : 340} font={font} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <ChartLegend tier={tier} t={t} font={font} />
          {hint}
        </div>
      </div>
      {expanded && (
        <div onClick={() => setExpanded(false)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 12 : 24 }}>
          <div dir={dir} onClick={(e) => e.stopPropagation()} style={{ width: "94vw", maxWidth: 1400, maxHeight: "92vh", overflow: "auto", background: C.card, borderRadius: 24, boxShadow: `${INSET}, 0 24px 60px rgba(0,0,0,0.5)`, padding: isMobile ? 14 : 20, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <span style={{ font: `700 20px ${font}`, color: "#fff" }}>{t.chart.title} — {data.name || data.ticker}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {tierSel}
                <button onClick={() => setExpanded(false)} aria-label={t.close} style={{ width: 34, height: 34, borderRadius: "50%", border: "none", cursor: "pointer", background: C.chip, color: "#fff", font: `700 16px ${font}` }}>✕</button>
              </div>
            </div>
            <ChartCanvas data={data} tier={tier} view={view} setView={setView} W={1200} H={620} maxH="74vh" font={font} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <ChartLegend tier={tier} t={t} font={font} />
              {hint}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Exported: the Monthly Tracker tool reuses this canvas (tier "Minimal",
// series = {ma5} only) so both tools render the exact same chart.
export function ChartCanvas({ data, tier, view, setView, W, H, maxH, font }) {
  const [hover, setHover] = useState(null);
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const candles = data.candles;
  const series = data.series || {};
  const dates = data.dates || [];
  const piv = data.pivots || { ph: [], pl: [] };
  const m = data.math || {};
  const N = candles.close.length;
  const padL = 10, padR = 62, padT = 14, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const count = Math.max(2, Math.min(view.count || N, N));
  const start = Math.max(0, Math.min(view.start || 0, N - count));
  const end = start + count, visLast = end - 1;
  const slot = plotW / count;
  const bodyW = Math.max(1.2, Math.min(slot * 0.62, 16));
  const showLevels = tier !== "Minimal", showFull = tier === "Full";
  const x = (i) => padL + slot * ((i - start) + 0.5);
  const xc = (i) => Math.max(padL, Math.min(padL + plotW, x(i)));
  const fmt = (val, d = 2) => (val == null || isNaN(val) ? "—" : Number(val).toFixed(d));

  let lo = Infinity, hi = -Infinity;
  for (let i = start; i < end; i++) { lo = Math.min(lo, candles.low[i]); hi = Math.max(hi, candles.high[i]); }
  if (showFull && series.bollLo) for (let i = start; i < end; i++) if (series.bollLo[i] != null) lo = Math.min(lo, series.bollLo[i]);
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  const padP = (hi - lo) * 0.06 || 1; lo -= padP; hi += padP;
  const span = hi - lo || 1;
  const y = (p) => padT + ((hi - p) / span) * plotH;

  const polyline = (arr, color, w = 1.6, dash) => {
    if (!arr) return null;
    const pts = [];
    for (let i = start; i < end; i++) if (arr[i] != null) pts.push(`${x(i).toFixed(1)},${y(arr[i]).toFixed(1)}`);
    if (pts.length < 2) return null;
    return <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={w} strokeDasharray={dash} strokeLinejoin="round" strokeLinecap="round" />;
  };
  const level = (price, color, label) => {
    if (price == null || price < lo || price > hi) return null;
    const yy = y(price);
    return (
      <g key={label}>
        <line x1={padL} y1={yy} x2={padL + plotW} y2={yy} stroke={color} strokeWidth={1} strokeDasharray="5 4" opacity={0.9} />
        <text x={padL + plotW + 4} y={yy + 3} fill={color} style={{ font: `700 10px ${font}` }}>{label}</text>
        <text x={padL + plotW + 4} y={yy + 14} fill={C.t50} style={{ font: `400 9px ${font}` }}>{fmt(price)}</text>
      </g>
    );
  };
  const clientToIdx = (clientX) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return start;
    const vbX = ((clientX - r.left) / r.width) * W;
    return Math.max(start, Math.min(visLast, Math.round((vbX - padL) / slot - 0.5) + start));
  };
  function onMouseMove(e) {
    // Capture the drag ref up front: the setView updater runs asynchronously,
    // and a concurrent mouseup can null dragRef.current before it does —
    // reading the ref inside the updater then crashes the tree.
    const drag = dragRef.current;
    if (drag) {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r) return;
      const dCandles = -Math.round(((e.clientX - drag.startX) / r.width) * W / slot);
      setView((vw) => { const cc = Math.max(2, Math.min(vw.count, N)); return { start: Math.max(0, Math.min(N - cc, drag.startStart + dCandles)), count: cc }; });
      return;
    }
    setHover(clientToIdx(e.clientX));
  }
  function onMouseDown(e) { dragRef.current = { startX: e.clientX, startStart: start }; setDragging(true); setHover(null); }
  function endDrag() { dragRef.current = null; setDragging(false); }
  useEffect(() => { if (!dragging) return; const up = () => endDrag(); window.addEventListener("mouseup", up); return () => window.removeEventListener("mouseup", up); }, [dragging]);
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const vbX = ((e.clientX - r.left) / r.width) * W;
      const plotFrac = Math.max(0, Math.min(1, (vbX - padL) / plotW));
      const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (horizontal) {
        const delta = e.deltaX || e.deltaY;
        setView((vw) => { const cc = Math.max(2, Math.min(vw.count, N)); const step = Math.sign(delta) * Math.max(1, Math.round(cc * 0.06)); return { start: Math.max(0, Math.min(N - cc, vw.start + step)), count: cc }; });
      } else {
        const factor = Math.exp(e.deltaY * 0.0015);
        setView((vw) => { const minC = Math.min(N, 8); let cc = Math.max(minC, Math.min(N, Math.round((vw.count || N) * factor))); const pointer = (vw.start || 0) + plotFrac * (vw.count || N); let st = Math.round(pointer - plotFrac * cc); return { start: Math.max(0, Math.min(N - cc, st)), count: cc }; });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [N, W, plotW, setView]);

  // Touch: one-finger drag pans, pinch zooms, tap moves the crosshair.
  useChartTouch(svgRef, {
    N, W, padL, plotW, slot, start, count, setView,
    onGesture: () => setHover(null),
    onTap: (cx) => setHover(clientToIdx(cx)),
  });

  let tip = null;
  if (hover != null && hover >= start && hover < end) {
    const k = (a) => a[hover];
    const tw = 120, th = 78, gap = 10, hx = x(hover);
    const tx = hx + gap + tw > padL + plotW ? hx - gap - tw : hx + gap, ty = padT + 4;
    const rows = [["", dates[hover] || ""], ["O", fmt(k(candles.open))], ["H", fmt(k(candles.high))], ["L", fmt(k(candles.low))], ["C", fmt(k(candles.close))]];
    tip = (
      <g pointerEvents="none">
        <line x1={hx} y1={padT} x2={hx} y2={padT + plotH} stroke={C.t40} strokeWidth={1} strokeDasharray="3 3" />
        <rect x={tx} y={ty} width={tw} height={th} rx={8} fill={C.card2} stroke="rgba(255,255,255,0.12)" />
        {rows.map(([lab, val], r) => (
          <text key={r} x={tx + 9} y={ty + 16 + r * 14} fill={lab ? C.t50 : "#fff"} style={{ font: `${lab ? 400 : 700} ${lab ? 10 : 11}px ${font}` }}>{lab ? `${lab}  ` : ""}<tspan fill="#fff">{val}</tspan></text>
        ))}
      </g>
    );
  }
  const grid = [0, 0.5, 1].map((f) => {
    const p = lo + span * f, yy = y(p);
    return <g key={f}><line x1={padL} y1={yy} x2={padL + plotW} y2={yy} stroke="rgba(255,255,255,0.05)" strokeWidth={1} /><text x={padL + plotW + 4} y={yy + 3} fill={C.t40} style={{ font: `400 9px ${font}` }}>{fmt(p)}</text></g>;
  });
  const axisIdx = [start, Math.floor((start + visLast) / 2), visLast];

  return (
    <div dir="ltr" style={{ width: "100%", aspectRatio: `${W} / ${H}`, maxHeight: maxH, background: C.sub, borderRadius: 16, overflow: "hidden" }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" onMouseMove={onMouseMove} onMouseDown={onMouseDown} onMouseUp={endDrag} onMouseLeave={() => { setHover(null); endDrag(); }} style={{ display: "block", cursor: dragging ? "grabbing" : "grab", touchAction: "pan-y" }}>
        {grid}
        {Array.from({ length: count }, (_, j) => {
          const i = start + j;
          const o = candles.open[i], c = candles.close[i], h = candles.high[i], l = candles.low[i];
          const up = c >= o, col = up ? C.green : C.red;
          const top = Math.min(y(o), y(c)), bh = Math.max(1, Math.abs(y(c) - y(o)));
          return <g key={i}><line x1={x(i)} y1={y(h)} x2={x(i)} y2={y(l)} stroke={col} strokeWidth={1} /><rect x={x(i) - bodyW / 2} y={top} width={bodyW} height={bh} fill={col} rx={0.5} /></g>;
        })}
        {showFull && polyline(series.bollUp, "#9AA0AE", 1, "4 3")}
        {showFull && polyline(series.bollLo, "#9AA0AE", 1, "4 3")}
        {polyline(series.ma40, C.amber, 1.6)}
        {polyline(series.ma20, C.blue, 1.6)}
        {polyline(series.ma5, C.green, 1.8)}
        {showFull && (piv.ph || []).filter((p) => p.i >= start && p.i < end).map((p, j) => <circle key={`ph${j}`} cx={x(p.i)} cy={y(p.price) - 5} r={2.4} fill={C.green} />)}
        {showFull && (piv.pl || []).filter((p) => p.i >= start && p.i < end).map((p, j) => <circle key={`pl${j}`} cx={x(p.i)} cy={y(p.price) + 5} r={2.4} fill={C.red} />)}
        {showLevels && level(m.target, C.green, "Target")}
        {showLevels && level(m.buy, C.blue, "Buy")}
        {showLevels && level(m.stopLow, C.red, "Stop")}
        {axisIdx.map((i, j) => <text key={j} x={Math.min(Math.max(x(i), padL + 14), padL + plotW - 14)} y={H - 8} textAnchor="middle" fill={C.t40} style={{ font: `400 9px ${font}` }}>{dates[i] || ""}</text>)}
        {tip}
      </svg>
    </div>
  );
}

function ChartLegend({ tier, t, font }) {
  const dot = (color, round) => ({ width: 12, height: round ? 12 : 3, borderRadius: round ? "50%" : 2, background: color, flexShrink: 0 });
  const item = (node, label) => <span style={{ display: "flex", alignItems: "center", gap: 6, font: `400 11px ${font}`, color: C.t70 }}>{node}{label}</span>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
      {item(<span style={dot(C.green)} />, t.legend.ma5)}
      {item(<span style={dot(C.blue)} />, t.legend.ma20)}
      {item(<span style={dot(C.amber)} />, t.legend.ma40)}
      {tier !== "Minimal" && item(<span style={{ ...dot(C.blue), borderRadius: 0 }} />, t.legend.levels)}
      {tier === "Full" && item(<span style={dot(C.green, true)} />, t.legend.pivots)}
      {tier === "Full" && item(<span style={dot("#9AA0AE")} />, t.legend.boll)}
    </div>
  );
}
