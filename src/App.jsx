import React, { useState, useMemo, useEffect, useRef } from "react";

// ─────────────────────────────────────────────────────────────
// Stock Analyzer — The 9-Question Method (React + Vercel)
// Two-pane layout per the Claude Design spec:
//   • Left sidebar: timeframe toggle + swing slider + symbol input +
//     Analyze, then the running list of analyzed stocks grouped by day.
//   • Right detail pane: verdict header, Risk/Reward/Ratio bar, the 14
//     Yes/No checks, plus the Math, Sell Plan and Monitoring sections.
// Data comes live from /api/analyze; every auto-answer is editable and
// the verdict recomputes from the final answers.
// ─────────────────────────────────────────────────────────────

// Design tokens — taken 1:1 from the exported design.
const C = {
  bg: "#1F1E21",
  card: "#29282C",
  card2: "#343238",
  sub: "rgba(31,30,33,0.5)",
  chip: "rgba(85,80,92,0.25)",
  line: "rgba(255,255,255,0.1)",
  green: "#6CD7A4",
  red: "#D23D40",
  blue: "#4193FF",
  text: "#fff",
  t70: "rgba(255,255,255,0.7)",
  t50: "rgba(255,255,255,0.5)",
  t40: "rgba(255,255,255,0.4)",
  t25: "rgba(255,255,255,0.25)",
};
const INSET = "inset 0 0 0 1px rgba(255,255,255,0.1)";
const FONT = "Inter, -apple-system, BlinkMacSystemFont, sans-serif";

const GROUPS_DEF = [
  { title: "Pre-Filter", caption: "ALL MUST PASS", ids: ["P1", "P2", "P3", "P4", "P5"] },
  { title: "Confirm the trend", caption: "PHASE A", ids: ["Q1", "Q2", "Q3", "Q4"] },
  { title: "Confirm the correction", caption: "PHASE B", ids: ["Q5", "Q6", "Q7"] },
  { title: "Entry signal", caption: "PHASE C · ONE YES IS ENOUGH", ids: ["Q8", "Q9"] },
];

const CHECK_TITLES = {
  P1: "Daily volume above 1,000,000",
  P2: "Entry candle is green",
  P3: "Entry candle is not a seller candle",
  P4: "Price is not in a falling sequence",
  P5: "Latest low above the previous low",
  Q1: "Peaks & troughs in a rising structure",
  Q2: "Volume expanded during the latest rise",
  Q3: "Moving averages aligned — green (13 SMA) over red (5 SMA)",
  Q4: "Broken resistance became support",
  Q5: "Fall below the red line (5 SMA), red sloping down",
  Q6: "CCI(5) dropped below −100",
  Q7: "Correction candle below prior sequence low",
  Q8: "Falling sequence broke up, close above red (5 SMA)",
  Q9: "Green buyer candle below lower Bollinger band",
};

const CONF = {
  exact: { label: "EXACT", color: C.green, tip: "Deterministic formula from the chart data" },
  swing: { label: "SWING", color: C.blue, tip: "Deterministic given your swing setting — check the detected pivots" },
  guess: { label: "GUESS", color: "#E0A458", tip: "Best-effort interpretation — confirm visually" },
};

const VLABEL = { BUY: "Buy", BUY_LIMIT: "Buy — limit", DO_NOT_ENTER: "Do not enter", INCOMPLETE: "Incomplete" };

// ── verdict resolver (mirrors api/_engine.js conclude, with overrides) ──
function verdict(checks, overrides, math) {
  const v = (id) => (id in overrides ? overrides[id] : checks?.[id]?.value);
  const PRE = ["P1", "P2", "P3", "P4", "P5"], A = ["Q1", "Q2", "Q3", "Q4"], B = ["Q5", "Q6", "Q7"], C2 = ["Q8", "Q9"];
  const anyNull = [...PRE, ...A, ...B, ...C2].some((id) => v(id) == null);
  const preOk = PRE.every((id) => v(id) === "yes" || v(id) === "na");
  const aOk = A.every((id) => v(id) === "yes");
  const bOk = B.every((id) => v(id) === "yes");
  const cOk = C2.some((id) => v(id) === "yes");
  const allPass = preOk && aOk && bOk && cOk;
  const ratio = math?.ratio;
  const ratioOk = ratio != null && ratio >= 1.5;
  let firstFail = null;
  for (const id of [...PRE, ...A, ...B]) if (v(id) === "no") { firstFail = id; break; }
  if (!firstFail && !cOk) firstFail = "Q8/Q9";
  let code;
  if (anyNull) code = "INCOMPLETE";
  else if (allPass && ratioOk) code = "BUY";
  else if (allPass && !ratioOk) code = "BUY_LIMIT";
  else code = "DO_NOT_ENTER";
  return { code, firstFail, ratioOk, allPass };
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

// ── small UI atoms ──────────────────────────────────────────
function Badge({ conf }) {
  const c = CONF[conf];
  if (!c) return null;
  return (
    <span title={c.tip} style={{
      fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", padding: "2px 8px",
      borderRadius: 40, background: c.color + "22", color: c.color, cursor: "help", flexShrink: 0,
    }}>{c.label}</span>
  );
}

// Small "?" affordance that reveals a styled explanation card on hover/focus.
// Native title tooltips can't carry the multi-line explanation + examples we want.
// Positioned with fixed coords computed from the trigger so it never clips the
// window edges: it flips below the icon when there isn't room above, and clamps
// horizontally into the viewport.
function HelpTip({ title, children, width = 280 }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);

  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const margin = 8, estH = 230;
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(width, vw - 2 * margin);
    let left = r.left + r.width / 2 - w / 2;
    left = Math.max(margin, Math.min(left, vw - w - margin));
    // Prefer above; drop below the icon when the card wouldn't fit above the window.
    const below = r.top < estH + 2 * margin;
    const vert = below ? { top: Math.round(r.bottom + margin) } : { bottom: Math.round(vh - r.top + margin) };
    setPos({ left: Math.round(left), width: w, ...vert });
  };
  const show = () => { place(); setOpen(true); };
  const hide = () => setOpen(false);

  return (
    <span style={{ display: "inline-flex", flexShrink: 0 }}
      onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button" aria-label={title || "Help"} ref={btnRef}
        onFocus={show} onBlur={hide}
        onClick={() => (open ? hide() : show())}
        style={{
          width: 18, height: 18, borderRadius: "50%", border: "none", cursor: "help",
          background: C.chip, color: C.t70, font: `700 12px ${FONT}`, lineHeight: "18px",
          padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
        }}>?</button>
      {open && pos && (
        <span style={{
          position: "fixed", left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width,
          zIndex: 1000, background: C.card2, color: C.t70,
          borderRadius: 12, padding: "12px 14px", boxShadow: `${INSET}, 0 12px 28px rgba(0,0,0,0.35)`,
          font: `400 12px ${FONT}`, lineHeight: 1.5, textAlign: "left", pointerEvents: "none",
        }}>
          {title && <span style={{ display: "block", font: `700 13px ${FONT}`, color: "#fff", marginBottom: 6 }}>{title}</span>}
          {children}
        </span>
      )}
    </span>
  );
}

// Reusable copy for the swing-sensitivity explainer (used by the sidebar HelpTip).
function SwingHelp() {
  return (
    <>
      Controls how many candles on each side of a bar must be lower (for a peak) or higher
      (for a trough) before it counts as a real swing point.
      <span style={{ display: "block", marginTop: 8, color: C.t50 }}>
        <strong style={{ color: C.green, fontWeight: 700 }}>1</strong> — very sensitive: marks
        many small swings (noisier).<br />
        <strong style={{ color: C.green, fontWeight: 700 }}>5</strong> — strict: only major
        turning points.<br />
        <strong style={{ color: "#fff", fontWeight: 700 }}>2</strong> is the default.
      </span>
      <span style={{ display: "block", marginTop: 8 }}>
        These pivots drive Q1, P5, Q7 and the highest-high target (and therefore Reward %).
        If the detected swings don't match what your eye sees, nudge this.
      </span>
    </>
  );
}

function Pill({ label, on, tint, mobile, onClick }) {
  const base = {
    display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 16px",
    borderRadius: 40, font: `700 16px ${FONT}`, cursor: "pointer", border: "none",
    minWidth: mobile ? 72 : 64, height: mobile ? 44 : 35, transition: "all .12s",
  };
  const style = on
    ? { ...base, background: tint, color: "#fff" }
    : { ...base, background: C.chip, color: C.t40 };
  return <button onClick={onClick} style={style}>{label}</button>;
}

// macOS-style right-click menu, opened at the cursor and clamped into the
// viewport. Closes on outside click, Escape, scroll or resize. Clicks inside
// stop propagation so the global "close on mousedown" listener doesn't fire
// before a menu item's onClick runs.
function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    const w = r?.width || 200, h = r?.height || 100, margin = 8;
    setPos({
      left: Math.max(margin, Math.min(x, window.innerWidth - w - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - h - margin)),
    });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "fixed", left: pos.left, top: pos.top, zIndex: 1100, minWidth: 180,
        background: C.card2, borderRadius: 12, padding: 6,
        boxShadow: `${INSET}, 0 12px 28px rgba(0,0,0,0.45)`,
        display: "flex", flexDirection: "column", gap: 2,
      }}>
      {items.map((it, i) => (
        <ContextItem key={i} item={it} onClose={onClose} />
      ))}
    </div>
  );
}

function ContextItem({ item, onClose }) {
  const [hover, setHover] = useState(false);
  const disabled = !!item.disabled;
  const color = disabled ? C.t40 : item.danger ? C.red : "#fff";
  return (
    <button
      disabled={disabled}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={() => { if (disabled) return; item.onClick(); onClose(); }}
      style={{
        display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
        padding: "9px 12px", borderRadius: 8, border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        background: hover && !disabled ? "rgba(255,255,255,0.08)" : "transparent",
        color, font: `600 14px ${FONT}`, whiteSpace: "nowrap",
      }}>
      {item.icon && <span style={{ font: `400 15px ${FONT}`, lineHeight: 1, width: 16, textAlign: "center" }}>{item.icon}</span>}
      {item.label}
    </button>
  );
}

// ── root component ──────────────────────────────────────────
export default function App() {
  const [timeframe, setTimeframe] = useState("Weekly");
  const [market, setMarket] = useState("US");
  const [symbol, setSymbol] = useState("");
  const [swingN, setSwingN] = useState(2);
  const [stocks, setStocks] = useState([]);     // analyzed stocks (newest first)
  const [selectedId, setSelectedId] = useState(null);
  const [mobileDetail, setMobileDetail] = useState(false); // mobile: show detail view vs. list
  const nextId = useRef(1);
  const swingTimer = useRef(null);
  const fileRef = useRef(null);
  const [batch, setBatch] = useState(null); // { rows:[{rawSymbol,market,tf}], fileName } while the popup is open
  const [menu, setMenu] = useState(null);   // { x, y, stock } — open right-click menu

  const isMobile = useWindowWidth() < 920;

  // Fetch + store one scan. `existingId` re-uses a row (refresh / param change);
  // `mkt` is the scan's market (US / TLV) and drives the ticker suffix.
  async function fetchStock({ rawSymbol, market: mkt, tf, n, existingId }) {
    const display = cleanSymbol(rawSymbol);
    if (!display) return;
    const ticker = resolveTicker(rawSymbol, mkt);
    const id = existingId || `s${nextId.current++}`;
    const stub = { id, market: mkt, display, ticker, name: nameGuess(display), loading: true, error: null, data: null, overrides: {}, fetchedAt: new Date() };

    setStocks((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      if (idx >= 0) { const copy = prev.slice(); copy[idx] = { ...copy[idx], loading: true, error: null }; return copy; }
      return [stub, ...prev];
    });
    setSelectedId(id);

    try {
      const r = await fetch(`/api/analyze?ticker=${encodeURIComponent(ticker)}&swingN=${n}&timeframe=${encodeURIComponent(tf)}&market=${encodeURIComponent(mkt)}`);
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
    fetchStock({ rawSymbol: symbol, market, tf: timeframe, n: swingN });
    setSymbol("");
    if (isMobile) setMobileDetail(true); // jump to the detail view on phones
  }

  // Select a stock; on mobile, switch to the full-screen detail view.
  const selectStock = (id) => { setSelectedId(id); if (isMobile) setMobileDetail(true); };

  const selected = stocks.find((s) => s.id === selectedId) || null;

  // Re-run the selected scan when the analysis parameters change, so the detail
  // genuinely reflects the chosen timeframe / swing sensitivity. A scan keeps its
  // own market (not the current toggle) so refreshing a TLV scan stays TLV.
  function onTimeframe(tf) {
    setTimeframe(tf);
    if (selected && !selected.loading && selected.data)
      fetchStock({ rawSymbol: selected.display, market: selected.market, tf, n: swingN, existingId: selected.id });
  }
  function onSwing(n) {
    setSwingN(n);
    if (swingTimer.current) clearTimeout(swingTimer.current);
    if (selected && !selected.loading && selected.data) {
      const { display, market: mkt, id } = selected;
      swingTimer.current = setTimeout(() => fetchStock({ rawSymbol: display, market: mkt, tf: timeframe, n, existingId: id }), 450);
    }
  }

  const setOverride = (stockId, checkId, value) =>
    setStocks((prev) => prev.map((s) => s.id === stockId ? { ...s, overrides: { ...s.overrides, [checkId]: value } } : s));

  // Remove a scan; if it was selected, fall back to the next remaining scan.
  function removeStock(stockId) {
    setStocks((prev) => {
      const next = prev.filter((s) => s.id !== stockId);
      if (stockId === selectedId) setSelectedId(next.length ? next[0].id : null);
      return next;
    });
  }

  // ── CSV export ──
  // Export a single scan as its own CSV (right-click → Export).
  function exportStock(stock) {
    if (!stock) return;
    downloadCsv(`${stock.display || "scan"}_${(stock.data && stock.data.timeframe) || timeframe}_${stamp()}.csv`, buildScansCsv([stock]));
  }
  // Export every scan into one CSV — one row per scan, all steps + data, no chart.
  function exportAll() {
    if (!stocks.length) return;
    downloadCsv(`stock_scans_${stamp()}.csv`, buildScansCsv(stocks));
  }
  // Open the right-click menu for a scan row at the cursor.
  function openMenu(e, stock) {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, stock });
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
    const csv = "Ticker,Market,Resolutions\nAAPL,US,W\nNVDA,US,M\nTEVA,TLV,W\n0745,TLV,M\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "batch_analysis_example.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function scanAll() {
    if (!batch) return;
    const rows = batch.rows;
    const n = swingN, tf = timeframe;

    // Create all scans as loading stubs upfront
    const ids = rows.map((r) => {
      const id = `s${nextId.current++}`;
      const display = cleanSymbol(r.rawSymbol);
      const ticker = resolveTicker(r.rawSymbol, r.market);
      return { id, display, ticker, market: r.market, name: nameGuess(display), row: r };
    });

    setStocks((prev) => [
      ...ids.map((x) => ({
        id: x.id, display: x.display, market: x.market, name: x.name, ticker: x.ticker,
        loading: true, error: null, data: null, overrides: {}, fetchedAt: new Date(),
      })),
      ...prev,
    ]);
    clearBatch();

    // Queue them in batches of 5
    processBatchQueue(ids, 0, n, tf);
  }

  // Fetch a batch of scans concurrently (max 5 at a time), then recursively process the next batch
  async function processBatchQueue(ids, startIdx, n, tf) {
    if (startIdx >= ids.length) return;

    const batchItems = ids.slice(startIdx, startIdx + 5);
    const results = await Promise.all(
      batchItems.map((x) =>
        fetch(`/api/analyze?ticker=${encodeURIComponent(x.ticker)}&swingN=${n}&timeframe=${encodeURIComponent(x.row.tf)}&market=${encodeURIComponent(x.market)}`)
          .then((r) => r.json())
          .then((j) => (!j.error ? { id: x.id, data: j } : { id: x.id, error: j.error || "Failed" }))
          .catch((e) => ({ id: x.id, error: e.message }))
      )
    );

    setStocks((prev) =>
      prev.map((s) => {
        const res = results.find((r) => r.id === s.id);
        if (!res) return s;
        return {
          ...s,
          loading: false,
          error: res.error || null,
          data: res.data || null,
          name: res.data?.name || s.name,
          fetchedAt: new Date(),
        };
      })
    );

    // Process next batch
    processBatchQueue(ids, startIdx + 5, n, tf);
  }

  return (
    <div style={{
      display: "flex", flexDirection: isMobile ? "column" : "row",
      height: isMobile ? "100dvh" : "100vh", width: "100%",
      background: C.bg, fontFamily: FONT, color: C.text, overflow: "hidden",
      ...(isMobile ? { paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" } : null),
    }}>
      {/* On phones only one pane shows at a time (list ↔ detail). Desktop shows both. */}
      {(!isMobile || !mobileDetail) && (
        <Sidebar
          isMobile={isMobile}
          timeframe={timeframe} onTimeframe={onTimeframe}
          market={market} setMarket={setMarket}
          swingN={swingN} onSwing={onSwing}
          symbol={symbol} setSymbol={setSymbol} analyze={analyze}
          stocks={stocks} selectedId={selectedId} setSelectedId={selectStock} removeStock={removeStock}
          onBatch={openBatch} onDownloadDemo={downloadDemoFile}
          onExportAll={exportAll} onContext={openMenu}
        />
      )}
      {(!isMobile || mobileDetail) && (
        <Main
          isMobile={isMobile}
          onBack={() => setMobileDetail(false)}
          stock={selected}
          setOverride={setOverride}
          refresh={() => selected && fetchStock({ rawSymbol: selected.display, market: selected.market, tf: timeframe, n: swingN, existingId: selected.id })}
        />
      )}

      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onBatchFile} style={{ display: "none" }} />
      {batch && <BatchModal batch={batch} onScanAll={scanAll} onCancel={clearBatch} />}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
          { label: "Export", icon: "⬇", disabled: menu.stock.loading, onClick: () => exportStock(menu.stock) },
          { label: "Remove", icon: "×", danger: true, onClick: () => removeStock(menu.stock.id) },
        ]} />
      )}
    </div>
  );
}

function BatchModal({ batch, onScanAll, onCancel }) {
  const count = batch.rows.length;
  const btn = {
    display: "flex", alignItems: "center", justifyContent: "center", padding: "12px 22px",
    borderRadius: 16, font: `700 15px ${FONT}`, border: "none", cursor: "pointer", whiteSpace: "nowrap",
  };
  return (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.6)", padding: 20,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 440, background: C.card, borderRadius: 24,
        boxShadow: `${INSET}, 0 24px 60px rgba(0,0,0,0.5)`, padding: 28,
        display: "flex", flexDirection: "column", gap: 16,
      }}>
        <span style={{ font: `700 20px ${FONT}`, color: "#fff" }}>Batch analysis scan</span>
        <span style={{ font: `400 14px ${FONT}`, color: C.t70, lineHeight: 1.6 }}>
          <strong style={{ color: "#fff", fontWeight: 700 }}>{count}</strong> stock{count === 1 ? "" : "s"} {count === 1 ? "was" : "were"} found in <strong style={{ color: "#fff", fontWeight: 700 }}>{batch.fileName}</strong>. Uploading it will initiate the scan of all of them.
        </span>
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 4, flexWrap: "wrap" }}>
          <button onClick={onCancel} style={{ ...btn, background: C.chip, color: "#fff" }}>Cancel</button>
          <button onClick={onScanAll} disabled={count === 0}
            style={{ ...btn, background: count === 0 ? "rgba(255,255,255,0.4)" : "#fff", color: C.card, cursor: count === 0 ? "not-allowed" : "pointer" }}>
            Scan all
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sidebar ─────────────────────────────────────────────────
function Sidebar({ isMobile, timeframe, onTimeframe, market, setMarket, swingN, onSwing, symbol, setSymbol, analyze, stocks, selectedId, setSelectedId, removeStock, onBatch, onDownloadDemo, onExportAll, onContext }) {
  const [tfHover, setTfHover] = useState(false);
  const [mkHover, setMkHover] = useState(false);
  const [anHover, setAnHover] = useState(false);
  const [batchHover, setBatchHover] = useState(false);
  const [demoHover, setDemoHover] = useState(false);
  const [exportHover, setExportHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [sortMode, setSortMode] = useState(null);

  const ctlH = isMobile ? 56 : 69;
  const ctlBtn = {
    display: "flex", alignItems: "center", justifyContent: "center", height: ctlH, padding: isMobile ? "0 16px" : "0 24px",
    borderRadius: 16, color: "#fff", font: `700 16px ${FONT}`, border: "none", cursor: "pointer",
    whiteSpace: "nowrap", flexShrink: 0, transition: "background .12s",
  };
  // On phones the toggles share the top row, while input + Analyze each take a full row.
  const mobileToggle = isMobile ? { flex: "1 1 0", minWidth: 0 } : null;
  const mobileFull = isMobile ? { flex: "1 1 100%" } : null;

  // When a sort is active, collapse the day grouping into one flat, sorted
  // list; otherwise keep the default newest-first day grouping.
  const groups = sortMode
    ? [{ key: "sorted", header: null, rows: sortStocks(stocks, sortMode) }]
    : groupByDay(stocks);

  return (
    <aside style={{
      width: isMobile ? "100%" : 640, flexShrink: 0,
      height: "100%", maxHeight: "100%",
      display: "flex", flexDirection: "column", gap: isMobile ? 16 : 24,
      padding: isMobile ? 16 : 36, boxSizing: "border-box",
    }}>
      {/* Control bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, background: C.card, borderRadius: 24,
        boxShadow: INSET, padding: 16, flexShrink: 0, flexWrap: "wrap",
      }}>
        <button
          onClick={() => setMarket(market === "US" ? "TLV" : "US")}
          onMouseEnter={() => setMkHover(true)} onMouseLeave={() => setMkHover(false)}
          title="Select market — appends the right symbol suffix"
          style={{ ...ctlBtn, ...mobileToggle, background: mkHover ? "rgba(0,0,0,0.30)" : "rgba(0,0,0,0.18)" }}>
          {market}
        </button>
        <button
          onClick={() => onTimeframe(timeframe === "Daily" ? "Weekly" : timeframe === "Weekly" ? "Monthly" : "Daily")}
          onMouseEnter={() => setTfHover(true)} onMouseLeave={() => setTfHover(false)}
          title="Cycle candle timeframe — Daily → Weekly → Monthly"
          style={{ ...ctlBtn, ...mobileToggle, background: tfHover ? "rgba(0,0,0,0.30)" : "rgba(0,0,0,0.18)" }}>
          {timeframe}
        </button>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && analyze()}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          placeholder="SYMB" maxLength={8}
          style={{
            flex: 1, minWidth: isMobile ? 0 : 120, height: ctlH, padding: "0 24px", borderRadius: 16,
            background: focus ? "rgba(0,0,0,0.30)" : "rgba(0,0,0,0.18)", color: "#fff",
            font: `700 18px ${FONT}`, border: "none", outline: "none", textAlign: "center",
            letterSpacing: "0.04em", boxShadow: focus ? "inset 0 0 0 2px #fff" : "none",
            ...mobileFull,
          }} />
        <button
          onClick={analyze}
          onMouseEnter={() => setAnHover(true)} onMouseLeave={() => setAnHover(false)}
          style={{ ...ctlBtn, ...mobileFull, background: anHover ? "rgba(255,255,255,0.78)" : "#fff", color: C.card }}>
          Analyze
        </button>
      </div>

      {/* Swing sensitivity (kept from the engine; styled to the design) */}
      <div style={{
        display: "flex", alignItems: "center", gap: 16, background: C.card, borderRadius: 24,
        boxShadow: INSET, padding: "14px 20px", flexShrink: 0,
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <span style={{ font: `700 14px ${FONT}`, color: C.t70, whiteSpace: "nowrap" }}>Swing sensitivity</span>
          <HelpTip title="Swing sensitivity"><SwingHelp /></HelpTip>
        </span>
        <input type="range" min={1} max={5} value={swingN}
          onChange={(e) => onSwing(+e.target.value)}
          style={{ flex: 1, minWidth: 0, accentColor: C.green }} />
        <span style={{ font: `700 16px ${FONT}`, color: "#fff", minWidth: 16, textAlign: "center" }}>{swingN}</span>
      </div>

      {/* Batch analysis + demo + sorting (shown once there are results) */}
      <div style={{ display: "flex", gap: 12, flexShrink: 0 }}>
        <button
          onClick={onBatch}
          onMouseEnter={() => setBatchHover(true)} onMouseLeave={() => setBatchHover(false)}
          title="Upload a CSV to scan many stocks at once"
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            background: C.card, borderRadius: 24, boxShadow: INSET, padding: "16px 20px",
            color: batchHover ? "#fff" : C.t70, font: `700 15px ${FONT}`, border: "none", cursor: "pointer",
            transition: "color .12s",
          }}>
          <span style={{ font: `700 18px ${FONT}`, lineHeight: 1 }}>⬆</span> Batch analysis
        </button>
        <button
          onClick={onDownloadDemo}
          onMouseEnter={() => setDemoHover(true)} onMouseLeave={() => setDemoHover(false)}
          title="Download an example CSV file"
          style={{
            flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            background: C.card, borderRadius: 24, boxShadow: INSET, padding: "16px 18px",
            color: demoHover ? "#fff" : C.t50, font: `700 13px ${FONT}`, border: "none", cursor: "pointer",
            transition: "color .12s", whiteSpace: "nowrap",
          }}>
          <span style={{ font: `400 16px ${FONT}`, lineHeight: 1 }}>⬇</span> Demo file
        </button>
        {stocks.length > 0 && <SortMenu sortMode={sortMode} setSortMode={setSortMode} />}
      </div>

      {/* Export all scans → one CSV, one row per scan (no chart) */}
      {stocks.length > 0 && (
        <div style={{ display: "flex", flexShrink: 0 }}>
          <button
            onClick={onExportAll}
            onMouseEnter={() => setExportHover(true)} onMouseLeave={() => setExportHover(false)}
            title="Download every scan as a single CSV (one row per scan)"
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              background: C.card, borderRadius: 24, boxShadow: INSET, padding: "16px 20px",
              color: exportHover ? "#fff" : C.t70, font: `700 15px ${FONT}`, border: "none", cursor: "pointer",
              transition: "color .12s",
            }}>
            <span style={{ font: `400 16px ${FONT}`, lineHeight: 1 }}>⬇</span> Export all scans
          </button>
        </div>
      )}

      {/* Stock list */}
      <div style={{
        flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column",
        gap: 8, padding: "4px 16px 24px",
      }}>
        {stocks.length === 0 && (
          <div style={{ padding: 16, textAlign: "center" }}>
            <span style={{ font: `700 16px ${FONT}`, color: C.t50 }}>Analyze a stock to add it to your stock list</span>
          </div>
        )}
        {groups.map((g, gi) => (
          <React.Fragment key={g.key}>
            {g.header && (
              <>
                <div style={{ height: 1, background: C.line, margin: "8px 12px" }} />
                <div style={{ padding: 12, textAlign: "center" }}>
                  <span style={{ font: `700 16px ${FONT}`, color: "#fff" }}>{g.header}</span>
                </div>
              </>
            )}
            {g.rows.map((s) => (
              <StockRow key={s.id} s={s} timeframe={timeframe} isMobile={isMobile}
                selected={s.id === selectedId} onClick={() => !s.loading && setSelectedId(s.id)}
                onRemove={() => removeStock(s.id)} onContext={onContext} />
            ))}
          </React.Fragment>
        ))}
      </div>
    </aside>
  );
}

function StockRow({ s, timeframe, isMobile, selected, onClick, onRemove, onContext }) {
  const [hover, setHover] = useState(false);
  const [xHover, setXHover] = useState(false);
  // Touch devices have no hover, so keep remove reachable (but hide it mid-load
  // where it would overlap the spinner). Desktop hover behavior is unchanged.
  const showX = isMobile ? !s.loading : hover;
  let chipBg = C.card2;
  if (s.error) chipBg = C.red;
  else if (!s.loading && s.data) {
    const code = verdict(s.data.checks, s.overrides, s.data.math).code;
    chipBg = code === "DO_NOT_ENTER" ? C.red : code === "INCOMPLETE" ? C.card2 : C.green;
  }
  const tf = (s.data && s.data.timeframe) || timeframe;
  const sub = s.error ? "Failed to analyze" : `${s.market} · ${tf} · ${s.data ? s.data.lastDate : "…"}`;
  return (
    <div onClick={onClick}
      onContextMenu={(e) => onContext && onContext(e, s)}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); setXHover(false); }}
      style={{
        position: "relative", display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 20,
        cursor: s.loading ? "default" : "pointer", transition: "background .12s",
        background: selected ? "rgba(255,255,255,0.06)" : hover ? "rgba(255,255,255,0.03)" : "transparent",
      }}>
      <div style={{ width: 80, height: 43, flexShrink: 0, borderRadius: 8, background: chipBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ font: `700 16px ${FONT}`, color: "#fff" }}>{s.display}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4, paddingRight: showX ? 28 : 0 }}>
        <span style={{ font: `700 16px ${FONT}`, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
        <span style={{ font: `400 12px ${FONT}`, color: s.error ? C.red : C.t50 }}>{sub}</span>
      </div>
      {s.loading && (
        <div style={{ width: 32, height: 32, flexShrink: 0, borderRadius: "50%", border: "3px solid #343238", borderTopColor: C.blue, animation: "spin .8s linear infinite" }} />
      )}
      {showX && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          onMouseEnter={() => setXHover(true)} onMouseLeave={() => setXHover(false)}
          title="Remove scan" aria-label="Remove scan"
          style={{
            position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            background: xHover ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.35)",
            boxShadow: `inset 0 0 0 1px ${xHover ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.25)"}`,
            color: xHover ? "#fff" : C.t70, border: "none", font: `400 16px ${FONT}`, lineHeight: 1,
            transition: "all .12s",
          }}>×</button>
      )}
    </div>
  );
}

// ── Main detail pane ────────────────────────────────────────
function Main({ isMobile, onBack, stock, setOverride, refresh }) {
  return (
    <main style={{ flex: 1, minWidth: 0, height: "100%", minHeight: 0, padding: isMobile ? "12px 12px 16px" : 20, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: isMobile ? 10 : 0, overflowX: isMobile ? "hidden" : undefined }}>
      {isMobile && (
        <button onClick={onBack} style={{
          flexShrink: 0, alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 8,
          padding: "10px 18px", borderRadius: 40, background: C.card, boxShadow: INSET,
          color: C.t70, font: `700 14px ${FONT}`, border: "none", cursor: "pointer",
        }}>‹ Stock list</button>
      )}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative", borderRadius: isMobile ? 24 : 40, background: C.card, boxShadow: INSET, overflow: "hidden" }}>
        {!stock || stock.loading || stock.error || !stock.data ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
            <span style={{ font: `700 16px ${FONT}`, color: stock && stock.error ? C.red : C.t25 }}>
              {stock && stock.error
                ? `Couldn't analyze ${stock.ticker} — ${stock.error}`
                : stock && stock.loading
                ? `Analyzing ${stock.ticker}…`
                : "Select a stock listing to view analysis"}
            </span>
          </div>
        ) : (
          <Detail isMobile={isMobile} stock={stock} setOverride={setOverride} refresh={refresh} />
        )}
      </div>
    </main>
  );
}

function Detail({ isMobile, stock, setOverride, refresh }) {
  const { data, overrides } = stock;
  const m = data.math;
  const cur = data.currency || "";
  const fmt = (x, d = 2) => (x == null || isNaN(x) ? "—" : Number(x).toFixed(d));
  const v = (id) => (id in overrides ? overrides[id] : data.checks?.[id]?.value);

  const concl = useMemo(() => verdict(data.checks, overrides, m), [data, overrides, m]);
  const vbg = concl.code === "DO_NOT_ENTER" ? C.red : concl.code === "INCOMPLETE" ? C.chip : C.green;
  const rcol = concl.ratioOk ? C.green : C.red;
  const showPlan = concl.code === "BUY" || concl.code === "BUY_LIMIT";
  const entry = concl.code === "BUY_LIMIT" ? m.maxBuy : m.buy;

  const fetchedAt = stock.fetchedAt
    ? stock.fetchedAt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  return (
    <>
      <div style={{ position: "absolute", inset: 0, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 16, padding: 16 }}>

        {/* Verdict header card */}
        <div style={{
          flexShrink: 0, borderRadius: 24, background: C.card2, boxShadow: `${INSET}, 0 12px 24px rgba(0,0,0,0.1)`,
          padding: isMobile ? "16px 18px" : "20px 24px",
          display: "flex", flexDirection: isMobile ? "column" : "row",
          justifyContent: isMobile ? "flex-start" : "space-between",
          alignItems: isMobile ? "stretch" : "center",
          gap: isMobile ? 12 : 16,
        }}>
          {/* Stock identity */}
          <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 6 : 12, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flexWrap: "wrap" }}>
              <span style={{ font: `700 ${isMobile ? 20 : 24}px ${FONT}`, color: "#fff", flexShrink: 0 }}>{stock.display}</span>
              <span style={{ font: `700 11px ${FONT}`, letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 40, background: C.chip, color: C.t70, flexShrink: 0 }}>{stock.market}</span>
              <span style={{ font: `400 ${isMobile ? 15 : 24}px ${FONT}`, color: C.t70, minWidth: 0, ...(isMobile ? {} : { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }) }}>{data.name}</span>
            </div>
            <span style={{ font: `400 12px ${FONT}`, color: C.t70 }}>
              {data.exchange} · {data.timeframe} · last {data.lastDate} · {cur}
            </span>
          </div>

          {isMobile ? (
            // Mobile: verdict pill full-width, then Fetched + Refresh on secondary row
            <>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center", padding: "10px 16px", borderRadius: 40,
                background: vbg, color: "#fff", font: `700 16px ${FONT}`,
              }}>{VLABEL[concl.code]}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>
                  <div style={{ font: `400 10px ${FONT}`, letterSpacing: "0.08em", textTransform: "uppercase", color: C.t50 }}>Fetched</div>
                  <div style={{ font: `400 12px ${FONT}`, color: C.t70 }}>{fetchedAt}</div>
                </div>
                <button onClick={refresh} title="Re-fetch the latest data" style={{
                  flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 40,
                  background: C.chip, color: "#fff", font: `700 14px ${FONT}`, border: "none", cursor: "pointer", whiteSpace: "nowrap",
                }}>↻ Refresh</button>
              </div>
            </>
          ) : (
            // Desktop: unchanged single right-side row
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
              <div style={{ textAlign: "right", lineHeight: 1.35 }}>
                <div style={{ font: `400 10px ${FONT}`, letterSpacing: "0.08em", textTransform: "uppercase", color: C.t50 }}>Fetched</div>
                <div style={{ font: `400 12px ${FONT}`, color: C.t70 }}>{fetchedAt}</div>
              </div>
              <button onClick={refresh} title="Re-fetch the latest data" style={{
                display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 40,
                background: C.chip, color: "#fff", font: `700 14px ${FONT}`, border: "none", cursor: "pointer", whiteSpace: "nowrap",
              }}>↻ Refresh</button>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 16px", borderRadius: 40,
                background: vbg, color: "#fff", font: `700 16px ${FONT}`, whiteSpace: "nowrap", flexShrink: 0,
              }}>{VLABEL[concl.code]}</div>
            </div>
          )}
        </div>

        {/* Risk / Reward / Ratio bar */}
        <div style={{
          flexShrink: 0, borderRadius: 16, background: C.sub, padding: "20px 24px",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 32, flexWrap: "wrap" }}>
            <Metric label="Risk" value={`${fmt(m.risk)}%`} />
            <Metric label="Reward" value={`${fmt(m.reward)}%`} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ font: `400 16px ${FONT}`, color: rcol }}>Ratio</span>
            <span style={{ font: `700 16px ${FONT}`, color: rcol }}>{fmt(m.ratio)}×</span>
          </div>
        </div>

        {/* Check groups */}
        {GROUPS_DEF.map((g, gi) => (
          <React.Fragment key={g.title}>
            {gi > 0 && <div style={{ height: 1, background: C.line, margin: "8px 20px", flexShrink: 0 }} />}
            <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: "0 20px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ font: `700 20px ${FONT}`, color: "#fff" }}>{g.title}</span>
                <span style={{ font: `700 12px ${FONT}`, letterSpacing: "0.08em", color: C.t50 }}>{g.caption}</span>
                {g.caption === "PHASE A" && <MaLegend />}
              </div>
              {g.ids.map((id) => {
                const ch = data.checks[id] || {};
                const cval = v(id);
                const edited = id in overrides;
                const allowNA = id === "P5";
                const pills = (
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <Pill label="Yes" on={cval === "yes"} tint={C.green} mobile={isMobile} onClick={() => setOverride(stock.id, id, "yes")} />
                    <Pill label="No" on={cval === "no"} tint={C.red} mobile={isMobile} onClick={() => setOverride(stock.id, id, "no")} />
                    {allowNA && <Pill label="N/A" on={cval === "na"} tint="#7E8AA0" mobile={isMobile} onClick={() => setOverride(stock.id, id, "na")} />}
                  </div>
                );
                return isMobile ? (
                  // Mobile: [ID + title] on top row, pills on bottom row
                  <div key={id} style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, minWidth: 0 }}>
                      <div style={{ width: 42, height: 42, flexShrink: 0, borderRadius: 12, background: C.chip, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ font: `700 16px ${FONT}`, color: C.t50 }}>{id}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ font: `700 15px ${FONT}`, color: "#fff", lineHeight: 1.3 }}>{CHECK_TITLES[id]}</span>
                          <Badge conf={ch.conf} />
                          {edited && <span style={{ font: `700 10px ${FONT}`, letterSpacing: "0.08em", color: "#E0A458" }}>EDITED</span>}
                        </div>
                        {ch.why && <span style={{ font: `400 12px ${FONT}`, color: C.t70, lineHeight: 1.4, overflowWrap: "break-word" }}>{ch.why}</span>}
                      </div>
                    </div>
                    {/* Pills indented to align under the title text */}
                    <div style={{ paddingLeft: 54 }}>{pills}</div>
                  </div>
                ) : (
                  // Desktop: unchanged single horizontal row
                  <div key={id} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <div style={{ width: 42, height: 42, flexShrink: 0, borderRadius: 12, background: C.chip, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ font: `700 16px ${FONT}`, color: C.t50 }}>{id}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ font: `700 16px ${FONT}`, color: "#fff" }}>{CHECK_TITLES[id]}</span>
                        <Badge conf={ch.conf} />
                        {edited && <span style={{ font: `700 10px ${FONT}`, letterSpacing: "0.08em", color: "#E0A458" }}>EDITED</span>}
                      </div>
                      {ch.why && <span style={{ font: `400 12px ${FONT}`, color: C.t70 }}>{ch.why}</span>}
                    </div>
                    {pills}
                  </div>
                );
              })}
            </div>
          </React.Fragment>
        ))}

        {/* The Math — Risk / Reward */}
        <div style={{ height: 1, background: C.line, margin: "8px 20px", flexShrink: 0 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "0 20px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ font: `700 20px ${FONT}`, color: "#fff" }}>The Math</span>
            <span style={{ font: `700 12px ${FONT}`, letterSpacing: "0.08em", color: C.t50 }}>RISK / REWARD</span>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Stat label="Buy (last close)" v={fmt(m.buy)} sub="Last close price" color={C.blue} />
            <Stat label="Candle Low" v={fmt(m.candleLow)} sub="Stop-loss" color={C.red} />
            <Stat label="Highest High" v={fmt(m.highestHigh)} sub="Target" color={C.green} />
          </div>
          {m.ratio != null && m.ratio < 1.5 && (
            <div style={{ borderRadius: 16, background: C.sub, padding: "14px 18px", font: `400 14px ${FONT}`, color: C.t70, lineHeight: 1.6 }}>
              Ratio below 1.5. Max valid limit-order buy price (ratio = 1.5):{" "}
              <strong style={{ color: "#E0A458", fontWeight: 700 }}>{fmt(m.maxBuy)} {cur}</strong>.
              <div style={{ marginTop: 4, color: C.t50 }}>Or reduce risk: enter at the candle midpoint, or buy fewer shares.</div>
            </div>
          )}
        </div>

        {/* Sell plan + monitoring */}
        {showPlan && (
          <>
            <div style={{ height: 1, background: C.line, margin: "8px 20px", flexShrink: 0 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "0 20px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ font: `700 20px ${FONT}`, color: "#fff" }}>The Sell Plan</span>
                <span style={{ font: `700 12px ${FONT}`, letterSpacing: "0.08em", color: C.t50 }}>TWO PRICES DEFINE THE TRADE</span>
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <Stat label="Entry" v={`${fmt(entry)} ${cur}`} sub={concl.code === "BUY_LIMIT" ? "Limit at max valid price" : "Market entry"} color={C.blue} />
                <Stat label="Stop-loss (exit down)" v={`${fmt(m.candleLow)} ${cur}`} sub="Candle low. Close below → exit." color={C.red} />
                <Stat label="Target (exit up)" v={`${fmt(m.highestHigh)} ${cur}`} sub="Highest high of last rising sequence." color={C.green} />
              </div>
              <div style={{ borderRadius: 16, background: C.sub, padding: "14px 18px", font: `400 14px ${FONT}`, color: C.t70, lineHeight: 1.6 }}>
                The method defines the trade by two prices: stop = entry candle low, target = highest high of the last rising sequence.
                Risk here is <strong style={{ color: C.red, fontWeight: 700 }}>{fmt(m.risk)}%</strong>; at target the reward-to-risk realizes at{" "}
                <strong style={{ color: C.green, fontWeight: 700 }}>{fmt(m.ratio)}×</strong>. No trailing stops or partial exits — the guide defines none.
              </div>
              {m.triggeredK?.length > 0 && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ font: `400 14px ${FONT}`, color: C.t50 }}>Entry signal:</span>
                  {m.triggeredK.map((k) => (
                    <span key={k} style={{ font: `700 12px ${FONT}`, padding: "4px 10px", borderRadius: 40, background: C.green + "22", color: C.green }}>{k}</span>
                  ))}
                </div>
              )}
            </div>

            <div style={{ height: 1, background: C.line, margin: "8px 20px", flexShrink: 0 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "0 20px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ font: `700 20px ${FONT}`, color: "#fff" }}>When to re-check</span>
                <span style={{ font: `700 12px ${FONT}`, letterSpacing: "0.08em", color: C.t50 }}>MONITORING</span>
              </div>
              <MonCard color={C.red} title="Daily — at each candle close" items={[
                ["Close below the candle low (stop)?", "If yes → exit immediately."],
                ["Reached the Highest High target?", "If yes → take the exit; planned reward realized."],
                ["New seller candle near the highs?", "Green candle, upper tail ≥ 2× body = sellers regaining control."],
              ]} />
              <MonCard color={C.blue} title="Weekly — confirm the trend holds" items={[
                ["Green MA still up, red below it? (Q3)", "Losing this means the trend basis is gone."],
                ["Peaks & troughs still rising? (Q1)", "A lower swing low breaks the uptrend."],
                ["Fresh falling sequence below red line? (Q5)", "Signals a new correction, not continuation."],
              ]} />
              <div style={{ borderRadius: 16, background: C.sub, padding: "14px 18px", font: `400 13px ${FONT}`, color: C.t50, lineHeight: 1.6 }}>
                Stop and target are single price levels → a once-daily glance at the close suffices. Trend structure moves slowly across
                many candles → weekly is enough to catch it turning. Re-run this analyzer weekly to refresh all three trend checks at once.
              </div>
            </div>
          </>
        )}

        {/* Generated technical-analysis chart */}
        <AnalysisChart data={data} isMobile={isMobile} />

        <div style={{ height: 60, flexShrink: 0 }} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 100, pointerEvents: "none", background: `linear-gradient(0deg, ${C.card} 0%, rgba(41,40,44,0) 100%)` }} />
    </>
  );
}

// ── Generated candlestick chart ─────────────────────────────
// Hand-rolled SVG (no chart lib). Renders the fetched candles plus the engine's
// own series/pivots/levels so the picture mirrors the verdict. A tier selector
// dials the overlay density; a crosshair reads out the hovered candle; scroll
// zooms and Shift-scroll / drag pans; Expand opens a full-view overlay.
const CHART_TIERS = ["Minimal", "Core", "Full"];

function TierSelector({ tier, setTier }) {
  return (
    <div style={{ display: "flex", gap: 4, background: C.sub, borderRadius: 40, padding: 4 }}>
      {CHART_TIERS.map((t) => (
        <button key={t} onClick={() => setTier(t)} style={{
          font: `700 12px ${FONT}`, padding: "6px 12px", borderRadius: 40, border: "none", cursor: "pointer",
          background: tier === t ? C.chip : "transparent", color: tier === t ? "#fff" : C.t50,
        }}>{t}</button>
      ))}
    </div>
  );
}

// The SVG plot itself, windowed on `view = {start, count}`. Owns its own pointer
// interactions (hover crosshair, wheel zoom/pan, drag pan) so it can be mounted
// twice (inline + expanded) at different W/H while sharing tier/view with the parent.
function ChartCanvas({ data, tier, view, setView, W, H, maxH }) {
  const [hover, setHover] = useState(null);
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef(null);
  const dragRef = useRef(null);

  const candles = data.candles;
  const series = data.series || {};
  const dates = data.dates || [];
  const piv = data.pivots || { ph: [], pl: [] };
  const seg = data.segments || {};
  const m = data.math || {};

  const N = candles.close.length;
  const padL = 10, padR = 62, padT = 14, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  // Clamp the window to a valid range (the parent's view may briefly lag the data).
  const count = Math.max(2, Math.min(view.count || N, N));
  const start = Math.max(0, Math.min(view.start || 0, N - count));
  const end = start + count;       // exclusive
  const visLast = end - 1;
  const slot = plotW / count;
  const bodyW = Math.max(1.2, Math.min(slot * 0.62, 16));

  const showLevels = tier === "Core" || tier === "Full";
  const showFull = tier === "Full";

  const x = (i) => padL + slot * ((i - start) + 0.5);
  const xc = (i) => Math.max(padL, Math.min(padL + plotW, x(i)));
  const fmt = (v, d = 2) => (v == null || isNaN(v) ? "—" : Number(v).toFixed(d));

  // Price range auto-fits the visible candles (so zooming reveals detail).
  let lo = Infinity, hi = -Infinity;
  for (let i = start; i < end; i++) { lo = Math.min(lo, candles.low[i]); hi = Math.max(hi, candles.high[i]); }
  if (showFull && series.bollLo) for (let i = start; i < end; i++) if (series.bollLo[i] != null) lo = Math.min(lo, series.bollLo[i]);
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  const padP = (hi - lo) * 0.06 || 1;
  lo -= padP; hi += padP;
  const span = hi - lo || 1;
  const y = (p) => padT + ((hi - p) / span) * plotH;

  const polyline = (arr, color, w = 1.6, dash) => {
    if (!arr) return null;
    const pts = [];
    for (let i = start; i < end; i++) if (arr[i] != null) pts.push(`${x(i).toFixed(1)},${y(arr[i]).toFixed(1)}`);
    if (pts.length < 2) return null;
    return <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={w}
      strokeDasharray={dash} strokeLinejoin="round" strokeLinecap="round" />;
  };

  // Trade level — only drawn when the price falls inside the visible y-range.
  const level = (price, color, label) => {
    if (price == null || price < lo || price > hi) return null;
    const yy = y(price);
    return (
      <g key={label}>
        <line x1={padL} y1={yy} x2={padL + plotW} y2={yy} stroke={color} strokeWidth={1} strokeDasharray="5 4" opacity={0.9} />
        <text x={padL + plotW + 4} y={yy + 3} fill={color} style={{ font: `700 10px ${FONT}` }}>{label}</text>
        <text x={padL + plotW + 4} y={yy + 14} fill={C.t50} style={{ font: `400 9px ${FONT}` }}>{fmt(price)}</text>
      </g>
    );
  };

  const clientToIdx = (clientX) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return start;
    const vbX = ((clientX - r.left) / r.width) * W;
    let i = Math.round((vbX - padL) / slot - 0.5) + start;
    return Math.max(start, Math.min(visLast, i));
  };

  function onMouseMove(e) {
    if (dragRef.current) {
      const r = svgRef.current?.getBoundingClientRect();
      if (!r) return;
      const dxPx = e.clientX - dragRef.current.startX;
      const dCandles = -Math.round((dxPx / r.width) * W / slot);
      setView((v) => {
        const cc = Math.max(2, Math.min(v.count, N));
        const st = Math.max(0, Math.min(N - cc, dragRef.current.startStart + dCandles));
        return { start: st, count: cc };
      });
      return; // suppress hover while panning
    }
    setHover(clientToIdx(e.clientX));
  }
  function onMouseDown(e) {
    dragRef.current = { startX: e.clientX, startStart: start };
    setDragging(true);
    setHover(null);
  }
  function endDrag() { dragRef.current = null; setDragging(false); }

  // Release the drag even if the mouse comes up outside the SVG.
  useEffect(() => {
    if (!dragging) return;
    const up = () => endDrag();
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [dragging]);

  // Wheel zoom / pan. React's onWheel is passive, so attach a non-passive
  // native listener to call preventDefault() and stop the page from scrolling.
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

  // Hover tooltip geometry (flip to the left near the right edge).
  let tip = null;
  if (hover != null && hover >= start && hover < end) {
    const k = (a) => a[hover];
    const tw = 120, th = 78, gap = 10;
    const hx = x(hover);
    const tx = hx + gap + tw > padL + plotW ? hx - gap - tw : hx + gap;
    const ty = padT + 4;
    const rows = [
      ["", dates[hover] || ""],
      ["O", fmt(k(candles.open))], ["H", fmt(k(candles.high))],
      ["L", fmt(k(candles.low))], ["C", fmt(k(candles.close))],
    ];
    tip = (
      <g pointerEvents="none">
        <line x1={hx} y1={padT} x2={hx} y2={padT + plotH} stroke={C.t40} strokeWidth={1} strokeDasharray="3 3" />
        <rect x={tx} y={ty} width={tw} height={th} rx={8} fill={C.card2} stroke="rgba(255,255,255,0.12)" />
        {rows.map(([lab, val], r) => (
          <text key={r} x={tx + 9} y={ty + 16 + r * 14}
            fill={lab ? C.t50 : "#fff"} style={{ font: `${lab ? 400 : 700} ${lab ? 10 : 11}px ${FONT}` }}>
            {lab ? `${lab}  ` : ""}<tspan fill="#fff">{val}</tspan>
          </text>
        ))}
      </g>
    );
  }

  // Right-edge price gridlines.
  const grid = [0, 0.5, 1].map((f) => {
    const p = lo + span * f, yy = y(p);
    return (
      <g key={f}>
        <line x1={padL} y1={yy} x2={padL + plotW} y2={yy} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
        <text x={padL + plotW + 4} y={yy + 3} fill={C.t40} style={{ font: `400 9px ${FONT}` }}>{fmt(p)}</text>
      </g>
    );
  });

  const axisIdx = [start, Math.floor((start + visLast) / 2), visLast];

  return (
    <div style={{ width: "100%", aspectRatio: `${W} / ${H}`, maxHeight: maxH, background: C.sub, borderRadius: 16, overflow: "hidden" }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" height="100%"
        onMouseMove={onMouseMove} onMouseDown={onMouseDown} onMouseUp={endDrag}
        onMouseLeave={() => { setHover(null); endDrag(); }}
        style={{ display: "block", cursor: dragging ? "grabbing" : "grab", touchAction: "none" }}>
        {grid}

        {/* Full: shade the rise (green) and correction (red) segments. */}
        {showFull && seg.highestHighIdx != null && (
          <>
            {seg.priorSeqLowIdx != null && (
              <rect x={xc(seg.priorSeqLowIdx)} y={padT} width={Math.max(0, xc(seg.highestHighIdx) - xc(seg.priorSeqLowIdx))}
                height={plotH} fill={C.green} opacity={0.07} />
            )}
            <rect x={xc(seg.highestHighIdx)} y={padT} width={Math.max(0, xc(visLast) - xc(seg.highestHighIdx))}
              height={plotH} fill={C.red} opacity={0.07} />
          </>
        )}

        {/* Candles (visible window only) */}
        {Array.from({ length: count }, (_, j) => {
          const i = start + j;
          const o = candles.open[i], c = candles.close[i], h = candles.high[i], l = candles.low[i];
          const up = c >= o, col = up ? C.green : C.red;
          const yo = y(o), yc = y(c);
          const top = Math.min(yo, yc), bh = Math.max(1, Math.abs(yc - yo));
          return (
            <g key={i}>
              <line x1={x(i)} y1={y(h)} x2={x(i)} y2={y(l)} stroke={col} strokeWidth={1} />
              <rect x={x(i) - bodyW / 2} y={top} width={bodyW} height={bh} fill={col} rx={0.5} />
            </g>
          );
        })}

        {/* Full: lower Bollinger band */}
        {showFull && polyline(series.bollLo, "#9AA0AE", 1, "4 3")}

        {/* Moving averages (all tiers) */}
        {polyline(series.green13, C.green, 1.8)}
        {polyline(series.red, C.red, 1.6)}

        {/* Full: swing pivot dots (visible window only) */}
        {showFull && (piv.ph || []).filter((p) => p.i >= start && p.i < end).map((p, j) => (
          <circle key={`ph${j}`} cx={x(p.i)} cy={y(p.price) - 5} r={2.4} fill={C.green} />
        ))}
        {showFull && (piv.pl || []).filter((p) => p.i >= start && p.i < end).map((p, j) => (
          <circle key={`pl${j}`} cx={x(p.i)} cy={y(p.price) + 5} r={2.4} fill={C.red} />
        ))}

        {/* Core+: trade levels */}
        {showLevels && level(m.highestHigh, C.green, "Target")}
        {showLevels && level(m.buy, C.blue, "Buy")}
        {showLevels && level(m.candleLow, C.red, "Stop")}

        {/* Date axis */}
        {axisIdx.map((i, j) => (
          <text key={j} x={Math.min(Math.max(x(i), padL + 14), padL + plotW - 14)} y={H - 8}
            textAnchor="middle" fill={C.t40} style={{ font: `400 9px ${FONT}` }}>{dates[i] || ""}</text>
        ))}

        {tip}
      </svg>
    </div>
  );
}

function AnalysisChart({ data, isMobile }) {
  const [tier, setTier] = useState("Core");
  const [expanded, setExpanded] = useState(false);
  const N = data?.candles?.close?.length || 0;
  const [view, setView] = useState({ start: 0, count: N });

  // Reset the zoom window whenever the underlying scan changes.
  useEffect(() => { setView({ start: 0, count: N }); }, [data, N]);

  // Esc closes the expand overlay.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e) => { if (e.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  if (!N) return null;

  const expandBtn = (
    <button onClick={() => setExpanded(true)} title="Expand chart" style={{
      display: "flex", alignItems: "center", gap: 6, font: `700 12px ${FONT}`, padding: "6px 12px",
      borderRadius: 40, border: "none", cursor: "pointer", background: C.chip, color: "#fff",
    }}>⤢ Expand</button>
  );
  const hint = (
    <span style={{ font: `400 11px ${FONT}`, color: C.t50 }}>Scroll to zoom · Shift-scroll or drag to pan</span>
  );

  return (
    <>
      <div style={{ height: 1, background: C.line, margin: "8px 20px", flexShrink: 0 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 20px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ font: `700 20px ${FONT}`, color: "#fff" }}>Chart</span>
            <span style={{ font: `700 12px ${FONT}`, letterSpacing: "0.08em", color: C.t50 }}>GENERATED FROM THE DATA</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <TierSelector tier={tier} setTier={setTier} />
            {expandBtn}
          </div>
        </div>

        <ChartCanvas data={data} tier={tier} view={view} setView={setView} W={720} H={isMobile ? 280 : 340} />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <ChartLegend tier={tier} />
          {hint}
        </div>
      </div>

      {/* Expand overlay */}
      {expanded && (
        <div onClick={() => setExpanded(false)} style={{
          position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.72)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 12 : 24,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: "94vw", maxWidth: 1400, maxHeight: "92vh", overflow: "auto", background: C.card,
            borderRadius: 24, boxShadow: `${INSET}, 0 24px 60px rgba(0,0,0,0.5)`, padding: isMobile ? 14 : 20,
            display: "flex", flexDirection: "column", gap: 14,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <span style={{ font: `700 20px ${FONT}`, color: "#fff" }}>Chart — {data.name || data.ticker}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <TierSelector tier={tier} setTier={setTier} />
                <button onClick={() => setExpanded(false)} aria-label="Close" title="Close" style={{
                  width: 34, height: 34, borderRadius: "50%", border: "none", cursor: "pointer",
                  background: C.chip, color: "#fff", font: `700 16px ${FONT}`,
                }}>✕</button>
              </div>
            </div>
            <ChartCanvas data={data} tier={tier} view={view} setView={setView} W={1200} H={620} maxH="74vh" />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <ChartLegend tier={tier} />
              {hint}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ChartLegend({ tier }) {
  const dot = (color, round) => ({ width: 12, height: round ? 12 : 3, borderRadius: round ? "50%" : 2, background: color, flexShrink: 0 });
  const item = (node, label) => (
    <span style={{ display: "flex", alignItems: "center", gap: 6, font: `400 11px ${FONT}`, color: C.t70 }}>{node}{label}</span>
  );
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
      {item(<span style={dot(C.green)} />, "Green line (13 SMA)")}
      {item(<span style={dot(C.red)} />, "Red line (5 SMA)")}
      {tier !== "Minimal" && item(<span style={{ ...dot(C.blue), borderRadius: 0 }} />, "Buy / Stop / Target levels")}
      {tier === "Full" && item(<span style={dot(C.green, true)} />, "Swing pivots")}
      {tier === "Full" && item(<span style={dot("#9AA0AE")} />, "Lower Bollinger (10/1)")}
    </div>
  );
}

// Clarifies what the two moving-average "lines" are, the first time they appear.
function MaLegend() {
  const dot = (color) => ({ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 });
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", marginTop: 4 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, font: `400 12px ${FONT}`, color: C.t70 }}>
        <span style={dot(C.green)} />Green line = 13 SMA of price
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, font: `400 12px ${FONT}`, color: C.t70 }}>
        <span style={dot(C.red)} />Red line = 5 SMA of the green line
      </span>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ font: `400 16px ${FONT}`, color: C.t70 }}>{label}</span>
      <span style={{ font: `700 16px ${FONT}`, color: "#fff" }}>{value}</span>
    </div>
  );
}

function Stat({ label, v, sub, color }) {
  return (
    <div style={{ flex: 1, minWidth: 150, background: C.card2, borderRadius: 16, boxShadow: INSET, padding: "14px 18px" }}>
      <div style={{ font: `700 10px ${FONT}`, letterSpacing: "0.06em", textTransform: "uppercase", color: C.t50 }}>{label}</div>
      <div style={{ font: `700 22px ${FONT}`, color, margin: "4px 0" }}>{v}</div>
      <div style={{ font: `400 11px ${FONT}`, color: C.t50, lineHeight: 1.35 }}>{sub}</div>
    </div>
  );
}

function MonCard({ title, color, items }) {
  return (
    <div style={{ borderRadius: 16, background: C.card2, boxShadow: INSET, overflow: "hidden" }}>
      <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.line}`, font: `700 13px ${FONT}`, letterSpacing: "0.06em", color }}>{title}</div>
      {items.map(([t, d], i) => (
        <div key={i} style={{ padding: "12px 18px", borderBottom: i < items.length - 1 ? `1px solid ${C.line}` : "none" }}>
          <div style={{ font: `700 14px ${FONT}`, color: "#fff" }}>{t}</div>
          <div style={{ font: `400 12px ${FONT}`, color: C.t50, marginTop: 2 }}>{d}</div>
        </div>
      ))}
    </div>
  );
}

// ── CSV export ──────────────────────────────────────────────
// Flatten one scan into a row of columns: identity + verdict + the
// risk/reward math + every check (the method's "steps") with its final
// answer, confidence and evidence. The visual chart (candles / series /
// pivots) is intentionally excluded.
const EXPORT_CHECK_IDS = ["P1", "P2", "P3", "P4", "P5", "Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9"];
const VAL_LABEL = { yes: "Yes", no: "No", na: "N/A" };

function scanRecord(stock) {
  const d = stock.data || {};
  const o = stock.overrides || {};
  const m = d.math || {};
  const fv = (id) => (id in o ? o[id] : d.checks?.[id]?.value);  // final answer (override wins)
  const num = (x, dec = 2) => (x == null || isNaN(x) ? "" : Number(x).toFixed(dec));
  const concl = !stock.loading && !stock.error && d.checks ? verdict(d.checks, o, m) : null;

  const rec = {
    Symbol: stock.display || "",
    Ticker: stock.ticker || "",
    Market: stock.market || "",
    Name: d.name || stock.name || "",
    Exchange: d.exchange || "",
    Currency: d.currency || "",
    Timeframe: d.timeframe || "",
    "Last candle": d.lastDate || "",
    "Fetched at": stock.fetchedAt ? new Date(stock.fetchedAt).toISOString() : "",
    "Swing sensitivity": d.swingN ?? "",
    Status: stock.error ? "Error" : stock.loading ? "Loading" : "Analyzed",
    Error: stock.error || "",
    Verdict: concl ? VLABEL[concl.code] : "",
    "Risk %": num(m.risk),
    "Reward %": num(m.reward),
    Ratio: num(m.ratio),
    "Buy (last close)": num(m.buy),
    "Candle low (stop)": num(m.candleLow),
    "Highest high (target)": num(m.highestHigh),
    "Max limit buy": num(m.maxBuy),
    "Entry signal": (m.triggeredK || []).join(" "),
  };
  for (const id of EXPORT_CHECK_IDS) {
    const ch = d.checks?.[id] || {};
    rec[`${id} · ${CHECK_TITLES[id]}`] = VAL_LABEL[fv(id)] || "";
    rec[`${id} confidence`] = ch.conf ? CONF[ch.conf]?.label || ch.conf : "";
    rec[`${id} edited`] = id in o ? "Yes" : "";
    rec[`${id} evidence`] = ch.why || "";
  }
  return rec;
}

function csvCell(val) {
  const s = val == null ? "" : String(val);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One row per scan, all sharing one header (union of keys, first-seen order).
function buildScansCsv(stocks) {
  const records = stocks.map(scanRecord);
  const cols = [];
  const seen = new Set();
  for (const r of records) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); cols.push(k); }
  const lines = [cols.map(csvCell).join(",")];
  for (const r of records) lines.push(cols.map((c) => csvCell(r[c])).join(","));
  return "﻿" + lines.join("\r\n"); // UTF-8 BOM so Excel reads non-ASCII correctly
}

function downloadCsv(filename, csv) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Filesystem-safe timestamp (YYYY-MM-DD-HH-MM-SS) for export filenames.
function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

// ── helpers ─────────────────────────────────────────────────
// Parse a batch CSV with columns Ticker, Market (US/TLV), Resolutions (W/M).
// Tolerant of column order, optional header, quotes and blank lines.
function parseBatchCsv(text) {
  const split = (line) => line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const lines = String(text || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const hasHeader = head.some((h) => h.startsWith("ticker"));
  const find = (p, fallback) => { const i = head.findIndex((h) => h.startsWith(p)); return i >= 0 ? i : fallback; };
  const ix = hasHeader
    ? { ticker: find("ticker", 0), market: find("market", 1), res: find("resolution", 2) }
    : { ticker: 0, market: 1, res: 2 };
  const rows = [];
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const cols = split(lines[i]);
    const rawSymbol = cleanSymbol(cols[ix.ticker] || "");
    if (!rawSymbol) continue;
    const m = (cols[ix.market] || "US").toUpperCase();
    const market = m === "TLV" || m === "TA" || m === "TASE" ? "TLV" : "US";
    const tfRaw = (cols[ix.res] || "W").toUpperCase();
    const tf = tfRaw.startsWith("D") ? "Daily" : tfRaw.startsWith("M") ? "Monthly" : "Weekly";
    rows.push({ rawSymbol, market, tf });
  }
  return rows;
}

// Bare symbol the user sees vs. the suffixed symbol Yahoo needs.
function cleanSymbol(raw) { return (raw || "").trim().toUpperCase().replace(/\.TA$/, ""); }
function resolveTicker(raw, market) {
  const s = cleanSymbol(raw);
  return market === "TLV" ? `${s}.TA` : s;
}

function nameGuess(t) {
  const m = {
    AAPL: "Apple Inc.", NVDA: "NVIDIA Corporation", META: "Meta Platforms, Inc.", TSLA: "Tesla, Inc.",
    MSFT: "Microsoft Corporation", GOOGL: "Alphabet Inc.", AMZN: "Amazon.com, Inc.", NFLX: "Netflix, Inc.",
    AMD: "Advanced Micro Devices", VOO: "Vanguard S&P 500 ETF", QQQ: "Invesco QQQ Trust", SPY: "SPDR S&P 500 ETF Trust",
  };
  return m[t] || t;
}

// Sort options offered by the sidebar's "Sorting" button.
const TF_RANK = { Daily: 0, Weekly: 1, Monthly: 2 };
const SORT_OPTIONS = [
  { id: "az", label: "A–Z", hint: "by name" },
  { id: "buy", label: "Buy", hint: "buy at top" },
  { id: "market", label: "Market", hint: "US at top" },
  { id: "dm", label: "D–M", hint: "daily → monthly" },
];

// Sort the scan list for the Sorting menu. A-Z by name; Buy floats buy /
// limit-buy verdicts to the top; Market puts US above TLV; D-M orders by
// timeframe Daily → Weekly → Monthly. Sort is stable, so ties keep their
// existing newest-first order and still-loading rows fall to the bottom.
function sortStocks(stocks, mode) {
  const codeOf = (s) => (!s.loading && !s.error && s.data ? verdict(s.data.checks, s.overrides, s.data.math).code : null);
  const name = (s) => (s.name || s.display || "").toLowerCase();
  const buyRank = (s) => { const c = codeOf(s); return c === "BUY" || c === "BUY_LIMIT" ? 0 : 1; };
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
function SortOption({ o, on, onPick }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onPick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 12, width: "100%",
        background: on || h ? "rgba(255,255,255,0.08)" : "transparent", border: "none", cursor: "pointer",
      }}>
      <span style={{ font: `700 15px ${FONT}`, color: "#fff", flexShrink: 0 }}>{o.label}</span>
      <span style={{ font: `400 12px ${FONT}`, color: C.t50, flex: 1, textAlign: "left" }}>{o.hint}</span>
      {on && <span style={{ font: `700 14px ${FONT}`, color: C.green }}>✓</span>}
    </button>
  );
}

// "Sorting" button + dropdown shown above the scan list. Clicking an active
// option again clears the sort (back to the default day grouping).
function SortMenu({ sortMode, setSortMode }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const active = SORT_OPTIONS.find((o) => o.id === sortMode);
  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        title="Sort the scan list"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          background: C.card, borderRadius: 24, boxShadow: INSET, padding: "16px 20px",
          color: open || hover ? "#fff" : C.t70, font: `700 15px ${FONT}`, border: "none",
          cursor: "pointer", transition: "color .12s", whiteSpace: "nowrap",
        }}>
        <span style={{ font: `400 16px ${FONT}`, lineHeight: 1 }}>⇅</span> Sorting{active ? ` · ${active.label}` : ""}
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", left: 0, minWidth: 220, zIndex: 50,
          background: C.card2, borderRadius: 16, boxShadow: `${INSET}, 0 12px 28px rgba(0,0,0,0.35)`,
          padding: 8, display: "flex", flexDirection: "column", gap: 4,
        }}>
          {SORT_OPTIONS.map((o) => (
            <SortOption key={o.id} o={o} on={o.id === sortMode}
              onPick={() => { setSortMode(o.id === sortMode ? null : o.id); setOpen(false); }} />
          ))}
        </div>
      )}
    </div>
  );
}

// Group analyzed stocks by the calendar day they were fetched. The most
// recent day shows no header (the design's "recent" block); older days get
// a divider + a date label.
function groupByDay(stocks) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yest = new Date(today); yest.setDate(yest.getDate() - 1);
  const order = [], map = {};
  for (const s of stocks) {
    const d = s.fetchedAt ? new Date(s.fetchedAt) : new Date();
    d.setHours(0, 0, 0, 0);
    const key = d.getTime();
    if (!(key in map)) { map[key] = { key, day: d, rows: [] }; order.push(key); }
    map[key].rows.push(s);
  }
  return order.map((k, i) => {
    const g = map[k];
    let header = null;
    if (i > 0) {
      if (g.day.getTime() === yest.getTime()) header = "Yesterday";
      else header = g.day.toLocaleDateString(undefined, { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
    }
    return { key: g.key, header, rows: g.rows };
  });
}
