import React, { useState, useMemo, useEffect, useRef } from "react";
import { C, INSET, fontFor } from "../shared/design.js";
import { T, CHECK_TITLES } from "./strings.js";
import { ChartCanvas } from "../strategy/StrategyApp.jsx";
import GraphIcon from "../shared/GraphIcon.jsx";
import useLongPress from "../shared/useLongPress.js";

// ─────────────────────────────────────────────────────────────
// TrackerApp — the Monthly Tracker (watchlist & buy alerts) tool.
// Finds stocks worth tracking this month: seven checks on the MONTHLY chart
// (liquidity gate → monthly trend → buy-alert candle). Locale-parameterized
// (lang="en"|"he") like StrategyApp — a sibling in the same design system,
// not a fork. Data comes live from /api/tracker; every auto-answer is
// editable and the verdict recomputes from the final answers.
// ─────────────────────────────────────────────────────────────

const CONF_COLOR = { exact: C.green, swing: C.blue, guess: C.amber };
const CONF_LABEL = { exact: "EXACT", swing: "SWING", guess: "GUESS" };

const GROUPS = [
  { key: "liquidity", ids: ["N1"] },
  { key: "trend", ids: ["N2", "N3", "N4"] },
  { key: "alert", ids: ["N5", "N6", "N7"] },
];
const TREND_IDS = ["N1", "N2", "N3", "N4"];
const ALERT_IDS = ["N5", "N6", "N7"];
const ALL_IDS = [...TREND_IDS, ...ALERT_IDS];

// ── verdict resolver (mirrors api/_tracker.js concludeTracker, override-aware) ──
function verdict(data, overrides) {
  const v = (id) => (id in overrides ? overrides[id] : data.checks?.[id]?.value);
  if (ALL_IDS.some((id) => v(id) == null)) return { code: "INCOMPLETE" };
  const trendOk = TREND_IDS.every((id) => v(id) === "yes");
  const alertOk = ALERT_IDS.every((id) => v(id) === "yes");
  if (trendOk && alertOk) return { code: "TRACK" };
  if (trendOk) return { code: "WAIT" };
  return { code: "NO_TRACK" };
}
const VERDICT_COLOR = { TRACK: C.green, WAIT: C.amber, NO_TRACK: C.red, INCOMPLETE: C.chip };

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
const lang_yes = (t) => (t.dir === "rtl" ? "כן" : "Yes");
const lang_no = (t) => (t.dir === "rtl" ? "לא" : "No");
const langOf = (t) => (t.dir === "rtl" ? "he" : "en");

// Parse a batch CSV with columns Ticker, Market (US/TLV). Tolerant of column
// order, an optional header, quotes and blank lines (same parser family as
// the other two tools; the tracker needs no technique/timeframe columns).
function parseBatchCsv(text) {
  const split = (line) => line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const lines = String(text || "").replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const hasHeader = head.some((h) => h.startsWith("ticker"));
  const find = (p, fallback) => { const i = head.findIndex((h) => h.startsWith(p)); return i >= 0 ? i : fallback; };
  const ix = hasHeader ? { ticker: find("ticker", 0), market: find("market", 1) } : { ticker: 0, market: 1 };
  const rows = [];
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const cols = split(lines[i]);
    const rawSymbol = cleanSymbol(cols[ix.ticker] || "");
    if (!rawSymbol) continue;
    const mk = (cols[ix.market] || "US").toUpperCase();
    rows.push({ rawSymbol, market: mk === "TLV" || mk === "TA" || mk === "TASE" ? "TLV" : "US" });
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

// ── UI atoms (same visual language as the other tools) ──
function Badge({ conf, font, t }) {
  const color = CONF_COLOR[conf];
  if (!color) return null;
  return (
    <span title={t.confTip[conf]} style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", padding: "2px 8px", borderRadius: 40, background: color + "22", color, cursor: "help", flexShrink: 0 }}>{CONF_LABEL[conf]}</span>
  );
}
function Pill({ label, on, tint, mobile, onClick, font }) {
  const base = { display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 16px", borderRadius: 40, font: `700 16px ${font}`, cursor: "pointer", border: "none", minWidth: mobile ? 72 : 64, height: mobile ? 44 : 35, transition: "all .12s" };
  return <button onClick={onClick} style={on ? { ...base, background: tint, color: "#fff" } : { ...base, background: C.chip, color: C.t40 }}>{label}</button>;
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
function InfoCard({ children, font, color = C.t70 }) {
  return <div style={{ borderRadius: 16, background: C.sub, padding: "14px 18px", font: `400 14px ${font}`, color, lineHeight: 1.6 }}>{children}</div>;
}

// ── right-click menu (same behaviour as the other two tools) ──
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

// ── root component ──
export default function TrackerApp({ lang = "en", onOpenChart }) {
  const t = T[lang] || T.en;
  const font = fontFor(lang);
  const dir = t.dir;
  const isMobile = useWindowWidth() < 920;

  const [market, setMarket] = useState("US");
  const [symbol, setSymbol] = useState("");
  const [stocks, setStocks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [batch, setBatch] = useState(null); // { rows, fileName } while the confirm popup is open
  const [menu, setMenu] = useState(null); // { x, y, stock } — open right-click menu
  const nextId = useRef(1);
  const fileRef = useRef(null);

  async function fetchStock({ rawSymbol, market: mkt, existingId }) {
    const display = cleanSymbol(rawSymbol);
    if (!display) return;
    const ticker = resolveTicker(rawSymbol, mkt);
    const id = existingId || `w${nextId.current++}`;
    const stub = { id, market: mkt, display, ticker, name: display, loading: true, error: null, data: null, overrides: {}, fetchedAt: new Date() };
    setStocks((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx >= 0) { const copy = prev.slice(); copy[idx] = { ...copy[idx], loading: true, error: null }; return copy; }
      return [stub, ...prev];
    });
    setSelectedId(id);
    try {
      const url = `/api/tracker?ticker=${encodeURIComponent(ticker)}&market=${encodeURIComponent(mkt)}&lang=${lang}`;
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
    fetchStock({ rawSymbol: symbol, market });
    setSymbol("");
    if (isMobile) setMobileDetail(true);
  }
  const selectStock = (id) => { setSelectedId(id); if (isMobile) setMobileDetail(true); };
  const selected = stocks.find((s) => s.id === selectedId) || null;

  const setOverride = (stockId, checkId, value) =>
    setStocks((prev) => prev.map((s) => s.id === stockId ? { ...s, overrides: { ...s.overrides, [checkId]: value } } : s));
  function removeStock(stockId) {
    setStocks((prev) => { const next = prev.filter((s) => s.id !== stockId); if (stockId === selectedId) setSelectedId(next.length ? next[0].id : null); return next; });
  }

  // ── batch scan (CSV upload) ──
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
    const csv = "Ticker,Market\nAAPL,US\nNVDA,US\nTEVA,TLV\n629014,TLV\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    a.download = "batch_tracker_example.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function scanAll() {
    if (!batch) return;
    const ids = batch.rows.map((r) => ({ id: `w${nextId.current++}`, display: cleanSymbol(r.rawSymbol), ticker: resolveTicker(r.rawSymbol, r.market), market: r.market }));
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
      const url = `/api/tracker?ticker=${encodeURIComponent(x.ticker)}&market=${encodeURIComponent(x.market)}&lang=${lang}`;
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
        <Sidebar {...{ t, font, dir, isMobile, market, setMarket, symbol, setSymbol, analyze, stocks, selectedId, setSelectedId: selectStock, removeStock, onBatch: openBatch, onDownloadDemo: downloadDemoFile, onContext: (e, s) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, stock: s }); } }} />
      )}
      {(!isMobile || mobileDetail) && (
        <Main {...{ t, font, dir, isMobile, onBack: () => setMobileDetail(false), stock: selected, setOverride, refresh: () => selected && !selected.loading && fetchStock({ rawSymbol: selected.display, market: selected.market, existingId: selected.id }) }} />
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
function Sidebar({ t, font, dir, isMobile, market, setMarket, symbol, setSymbol, analyze, stocks, selectedId, setSelectedId, removeStock, onBatch, onDownloadDemo, onContext }) {
  const [focus, setFocus] = useState(false);
  const [batchHover, setBatchHover] = useState(false);
  const [demoHover, setDemoHover] = useState(false);
  const ctlH = isMobile ? 56 : 69;
  const ctlBtn = { display: "flex", alignItems: "center", justifyContent: "center", height: ctlH, padding: isMobile ? "0 14px" : "0 20px", borderRadius: 16, color: "#fff", font: `700 15px ${font}`, border: "none", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, transition: "background .12s", background: "rgba(0,0,0,0.18)" };

  return (
    <aside style={{ width: isMobile ? "100%" : 640, flexShrink: 0, height: "100%", maxHeight: "100%", display: "flex", flexDirection: "column", gap: isMobile ? 16 : 24, padding: isMobile ? 16 : 36, boxSizing: "border-box" }}>
      {/* Control bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, background: C.card, borderRadius: 24, boxShadow: INSET, padding: 16, flexShrink: 0, flexWrap: "wrap" }}>
        <button onClick={() => setMarket(market === "US" ? "TLV" : "US")} style={ctlBtn} title={t.market[market]}>{t.market[market]}</button>
        <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === "Enter" && analyze()} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} placeholder={market === "TLV" ? t.symbolPlaceholderTLV : t.symbolPlaceholder} maxLength={24}
          className={dir === "rtl" ? "ltr" : undefined}
          style={{ flex: 1, minWidth: isMobile ? 0 : 110, height: ctlH, padding: "0 20px", borderRadius: 16, background: focus ? "rgba(0,0,0,0.30)" : "rgba(0,0,0,0.18)", color: "#fff", font: `700 18px ${font}`, border: "none", outline: "none", textAlign: "center", letterSpacing: "0.04em", boxShadow: focus ? "inset 0 0 0 2px #fff" : "none" }} />
        <button onClick={analyze} style={{ ...ctlBtn, background: "#fff", color: C.card }}>{t.analyze}</button>
      </div>

      {/* Batch scan + demo */}
      <div style={{ display: "flex", gap: 12, flexShrink: 0 }}>
        <button onClick={onBatch} onMouseEnter={() => setBatchHover(true)} onMouseLeave={() => setBatchHover(false)} title={t.batch.buttonTitle}
          style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: C.card, borderRadius: 24, boxShadow: INSET, padding: "16px 20px", color: batchHover ? "#fff" : C.t70, font: `700 15px ${font}`, border: "none", cursor: "pointer", transition: "color .12s" }}>
          <span style={{ font: `700 18px ${font}`, lineHeight: 1 }}>⬆</span> {t.batch.button}
        </button>
        <button onClick={onDownloadDemo} onMouseEnter={() => setDemoHover(true)} onMouseLeave={() => setDemoHover(false)} title={t.batch.demoTitle}
          style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: C.card, borderRadius: 24, boxShadow: INSET, padding: "16px 18px", color: demoHover ? "#fff" : C.t50, font: `700 13px ${font}`, border: "none", cursor: "pointer", transition: "color .12s", whiteSpace: "nowrap" }}>
          <span style={{ font: `400 16px ${font}`, lineHeight: 1 }}>⬇</span> {t.batch.demo}
        </button>
      </div>

      {/* Stock list */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, padding: "4px 16px 24px" }}>
        {stocks.length === 0 && (
          <div style={{ padding: 16, textAlign: "center" }}>
            <span style={{ font: `700 16px ${font}`, color: C.t50 }}>{t.emptyList}</span>
          </div>
        )}
        {stocks.map((s) => (
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
  else if (!s.loading && s.data) chipBg = VERDICT_COLOR[verdict(s.data, s.overrides).code] || C.card2;
  const sub = s.error ? t.failedShort : `${t.market[s.market]} · ${t.monthly}${s.data ? " · " + s.data.lastDate : ""}`;
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
  const v = (id) => (id in overrides ? overrides[id] : data.checks?.[id]?.value);
  const concl = useMemo(() => verdict(data, overrides), [data, overrides]);
  const vbg = VERDICT_COLOR[concl.code] || C.chip;
  const fetchedAt = stock.fetchedAt ? stock.fetchedAt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
  const meta = data.meta || {};
  const avgVol = meta.avgDailyVolume;

  return (
    <div style={{ position: "absolute", inset: 0, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 16, padding: 16 }}>
      {/* Verdict header */}
      <div style={{ flexShrink: 0, borderRadius: 24, background: C.card2, boxShadow: `${INSET}, 0 12px 24px rgba(0,0,0,0.1)`, padding: isMobile ? "16px 18px" : "20px 24px", display: "flex", flexDirection: isMobile ? "column" : "row", justifyContent: isMobile ? "flex-start" : "space-between", alignItems: isMobile ? "stretch" : "center", gap: isMobile ? 12 : 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 6 : 12, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flexWrap: "wrap" }}>
            <span className={dir === "rtl" ? "ltr" : undefined} style={{ font: `700 ${isMobile ? 20 : 24}px ${font}`, color: "#fff", flexShrink: 0 }}>{stock.display}</span>
            <span style={{ font: `700 11px ${font}`, letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 40, background: C.chip, color: C.t70, flexShrink: 0 }}>{t.market[stock.market]}</span>
            <span style={{ font: `700 11px ${font}`, letterSpacing: "0.06em", padding: "3px 10px", borderRadius: 40, background: C.blue + "22", color: C.blue, flexShrink: 0 }}>{t.monthly}</span>
            <span style={{ font: `400 ${isMobile ? 15 : 22}px ${font}`, color: C.t70, minWidth: 0, ...(isMobile ? {} : { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }) }}>{data.name}</span>
          </div>
          <span style={{ font: `400 12px ${font}`, color: C.t70 }}>
            {data.exchange} · {meta.evalDate ? t.evalOn(meta.evalDate) : ""} · last {data.lastDate} · {data.currency || ""}
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

      {/* Verdict explanation + volume + forming-candle note */}
      <div style={{ flexShrink: 0, borderRadius: 16, background: C.sub, padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span style={{ font: `400 14px ${font}`, color: C.t70, lineHeight: 1.6, flex: 1, minWidth: 220 }}>{t.verdictHint[concl.code]}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ font: `400 16px ${font}`, color: C.t70 }}>{t.avgVolume}</span>
          <span style={{ font: `700 16px ${font}`, color: avgVol == null ? C.t50 : avgVol >= meta.volStrict ? C.green : avgVol >= meta.volLenient ? C.amber : C.red }}>
            {avgVol == null ? "—" : Math.round(avgVol).toLocaleString("en-US")}
          </span>
        </div>
      </div>
      {meta.droppedForming && <InfoCard font={font} color={C.t50}>{t.formingNote}</InfoCard>}

      {/* Check groups */}
      {GROUPS.map((g) => {
        const gm = t.groups[g.key];
        return (
          <React.Fragment key={g.key}>
            <div style={{ height: 1, background: C.line, margin: "8px 20px", flexShrink: 0 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: "0 20px" }}>
              <SectionTitle title={gm.title} caption={gm.caption} font={font} />
              {g.ids.map((id) => {
                const ch = data.checks[id] || {};
                const cval = v(id);
                const edited = id in overrides;
                const pills = (
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <Pill label={lang_yes(t)} on={cval === "yes"} tint={C.green} mobile={isMobile} onClick={() => setOverride(stock.id, id, "yes")} font={font} />
                    <Pill label={lang_no(t)} on={cval === "no"} tint={C.red} mobile={isMobile} onClick={() => setOverride(stock.id, id, "no")} font={font} />
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

      {/* Chart */}
      <TrackerChart data={data} t={t} font={font} dir={dir} isMobile={isMobile} />
      <div style={{ height: 60, flexShrink: 0 }} />
    </div>
  );
}

// ── Chart (monthly candles + MA5, via the shared ChartCanvas) ──
function TrackerChart({ data, t, font, dir, isMobile }) {
  const N = data?.candles?.close?.length || 0;
  const [view, setView] = useState({ start: 0, count: N });
  useEffect(() => { setView({ start: 0, count: N }); }, [data, N]);
  if (!N) return null;
  // ChartCanvas at tier "Minimal" draws only candles + whatever MA series
  // exist — here just MA5 (no levels, pivots, or Bollinger).
  const chartData = { candles: data.candles, series: { ma5: data.series?.ma5 }, dates: data.dates, pivots: { ph: [], pl: [] }, math: {} };
  return (
    <>
      <div style={{ height: 1, background: C.line, margin: "8px 20px", flexShrink: 0 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 20px" }}>
        <SectionTitle title={t.chart.title} caption={t.chart.caption} font={font} />
        <ChartCanvas data={chartData} tier="Minimal" view={view} setView={setView} W={720} H={isMobile ? 280 : 340} font={font} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, font: `400 11px ${font}`, color: C.t70 }}>
            <span style={{ width: 12, height: 3, borderRadius: 2, background: C.green, flexShrink: 0 }} />{t.legendMa5}
          </span>
          <span style={{ font: `400 11px ${font}`, color: C.t50 }}>{t.chartHint}</span>
        </div>
      </div>
    </>
  );
}
