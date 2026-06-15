import React, { useState, useMemo, useEffect } from "react";

// ─────────────────────────────────────────────────────────────
// The 9-Question Method — Auto-Analyzer (React + Vercel)
// Fetches data via /api/analyze, pre-fills every check, lets you
// override, then locks the conclusion + sell plan + monitoring.
// All rules come from the guide; nothing else is added.
// ─────────────────────────────────────────────────────────────

const COL = {
  bg: "#0f1117", surface: "#181c27", surface2: "#1f2435", border: "#2a3045",
  accent: "#5cefb0", accent2: "#7c8dff", danger: "#ff5f5f", warn: "#ffb347",
  text: "#e8ecf4", muted: "#7f8aa8", phaseA: "#7c8dff", phaseB: "#e87fff", phaseC: "#5cefb0",
};

const META = {
  P1: ["Daily volume above 1,000,000", "Pre-Filter"],
  P2: ["Entry candle is green", "Pre-Filter"],
  P3: ["Entry candle is NOT a seller candle", "Pre-Filter"],
  P4: ["Price is NOT in a falling sequence", "Pre-Filter"],
  P5: ["If a fall just broke: latest low > previous low", "Pre-Filter"],
  Q1: ["Peaks & troughs in a rising structure", "Phase A"],
  Q2: ["Volume expanded during the latest rise", "Phase A"],
  Q3: ["Moving averages properly aligned", "Phase A"],
  Q4: ["Broken resistance became support", "Phase A"],
  Q5: ["Fall below red line, red sloping down", "Phase B"],
  Q6: ["CCI(5) dropped below −100", "Phase B"],
  Q7: ["≥1 correction candle below prior sequence low", "Phase B"],
  Q8: ["Falling sequence broke up / close above red", "Phase C"],
  Q9: ["Green/buyer candle below lower Bollinger band", "Phase C"],
};

const GROUPS = [
  { label: "Pre-Filter — all must pass", color: COL.danger, ids: ["P1", "P2", "P3", "P4", "P5"] },
  { label: "Phase A — Confirm the Trend", color: COL.phaseA, ids: ["Q1", "Q2", "Q3", "Q4"] },
  { label: "Phase B — Confirm the Correction", color: COL.phaseB, ids: ["Q5", "Q6", "Q7"] },
  { label: "Phase C — Entry Signal (one Yes is enough)", color: COL.phaseC, ids: ["Q8", "Q9"] },
];

const CONF = {
  exact: { label: "EXACT", color: COL.accent, tip: "Deterministic formula from the chart data" },
  swing: { label: "SWING", color: COL.accent2, tip: "Deterministic given your swing setting — check the detected pivots" },
  guess: { label: "GUESS", color: COL.warn, tip: "Best-effort interpretation — confirm visually" },
};

function useWindowWidth() {
  const [w, setW] = useState(() => typeof window !== "undefined" ? window.innerWidth : 800);
  useEffect(() => {
    const handler = () => setW(window.innerWidth);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return w;
}

function Badge({ conf }) {
  const c = CONF[conf] || CONF.guess;
  return (
    <span title={c.tip} style={{ fontFamily: "monospace", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
      padding: "2px 6px", borderRadius: 4, background: c.color + "22", color: c.color, cursor: "help" }}>
      {c.label}
    </span>
  );
}

function Tri({ value, onChange, allowNA, isMobile }) {
  const opts = allowNA ? ["yes", "no", "na"] : ["yes", "no"];
  const lab = { yes: "Yes", no: "No", na: "N/A" };
  const tint = { yes: COL.accent, no: COL.danger, na: COL.muted };
  return (
    <div style={{ display: "flex", gap: 5 }}>
      {opts.map((o) => {
        const on = value === o;
        return (
          <button key={o} onClick={() => onChange(o)}
            style={{ cursor: "pointer", fontFamily: "monospace", fontSize: isMobile ? 13 : 11, fontWeight: 600,
              padding: isMobile ? "9px 16px" : "4px 10px", borderRadius: 6, border: `1px solid ${on ? tint[o] : COL.border}`,
              background: on ? tint[o] + "22" : "transparent", color: on ? tint[o] : COL.muted }}>
            {lab[o]}
          </button>
        );
      })}
    </div>
  );
}

export default function App() {
  const [ticker, setTicker] = useState("");
  const [swingN, setSwingN] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);     // raw API response
  const [overrides, setOverrides] = useState({}); // id -> value (manual)
  const [fetchedAt, setFetchedAt] = useState(null); // when the live data was last pulled

  const isMobile = useWindowWidth() < 600;

  // `sym` lets the Refresh button re-fetch the currently shown ticker.
  // Guard against React passing a click event in as the first arg.
  async function run(sym) {
    const symbol = (typeof sym === "string" ? sym : ticker).trim();
    if (!symbol) return;
    setLoading(true); setError(null); setData(null); setOverrides({});
    try {
      const r = await fetch(`/api/analyze?ticker=${encodeURIComponent(symbol)}&swingN=${swingN}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Request failed");
      setData(j);
      setFetchedAt(new Date());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  // Effective value = manual override if present, else engine's auto value.
  const val = (id) => (id in overrides ? overrides[id] : data?.checks?.[id]?.value);
  const setVal = (id) => (v) => setOverrides((o) => ({ ...o, [id]: v }));

  const conclusion = useMemo(() => {
    if (!data) return null;
    const v = (id) => (id in overrides ? overrides[id] : data.checks[id]?.value);
    const PRE = ["P1", "P2", "P3", "P4", "P5"], A = ["Q1", "Q2", "Q3", "Q4"], B = ["Q5", "Q6", "Q7"], C = ["Q8", "Q9"];
    const anyNull = [...PRE, ...A, ...B, ...C].some((id) => v(id) == null);
    const preOk = PRE.every((id) => v(id) === "yes" || v(id) === "na");
    const aOk = A.every((id) => v(id) === "yes");
    const bOk = B.every((id) => v(id) === "yes");
    const cOk = C.some((id) => v(id) === "yes");
    const allPass = preOk && aOk && bOk && cOk;
    const ratio = data.math.ratio;
    const ratioOk = ratio != null && ratio >= 1.5;
    let firstFail = null;
    for (const id of [...PRE, ...A, ...B]) if (v(id) === "no") { firstFail = id; break; }
    if (!firstFail && !cOk) firstFail = "Q8/Q9";
    let code;
    if (anyNull) code = "INCOMPLETE";
    else if (allPass && ratioOk) code = "BUY";
    else if (allPass && !ratioOk) code = "BUY_LIMIT";
    else code = "DO_NOT_ENTER";
    return { code, firstFail, ratioOk };
  }, [data, overrides]);

  const cur = data?.currency || "";
  const fmt = (x, d = 2) => (x == null || isNaN(x) ? "—" : Number(x).toFixed(d));
  // Absolute fetch timestamp, down to the second (date + HH:MM:SS).
  const fmtFetched = (d) => (d ? d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }) : "—");

  return (
    <div style={{ background: COL.bg, color: COL.text, fontFamily: "Inter, system-ui, sans-serif", minHeight: "100vh",
      padding: isMobile ? "16px 12px 50px" : "28px 20px 70px" }}>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        <div style={{ fontFamily: "monospace", fontSize: isMobile ? 10 : 11, letterSpacing: "0.18em", textTransform: "uppercase", color: COL.accent, marginBottom: 8 }}>
          The 9-Question Method · Auto-Analyzer
        </div>
        <h1 style={{ fontSize: isMobile ? 20 : 27, fontWeight: 700, margin: "0 0 16px", letterSpacing: "-0.01em" }}>
          Enter a ticker — the chart fills itself in
        </h1>

        {/* Control bar */}
        <div style={{ background: COL.surface, border: `1px solid ${COL.border}`, borderRadius: 12, padding: isMobile ? 12 : 16, marginBottom: 22 }}>
          <div style={{ display: "flex", gap: isMobile ? 10 : 16, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: COL.muted, marginBottom: 6 }}>
                Ticker (US, or TASE with .TA)
              </div>
              <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && run()}
                placeholder="AAPL · NVDA · TEVA.TA"
                style={{ width: "100%", background: COL.surface2, border: `1px solid ${COL.border}`, color: COL.text,
                  borderRadius: 8, padding: isMobile ? "12px 12px" : "10px 12px", fontFamily: "monospace",
                  fontSize: isMobile ? 16 : 15, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ flex: "1 1 150px" }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: COL.muted, marginBottom: 6, whiteSpace: "nowrap" }}>
                Swing sensitivity: {swingN}
              </div>
              <input type="range" min={1} max={5} value={swingN} onChange={(e) => setSwingN(+e.target.value)}
                style={{ width: "100%", accentColor: COL.accent2, display: "block" }} />
            </div>
            <button onClick={() => run()} disabled={loading}
              style={{ cursor: loading ? "wait" : "pointer", background: COL.accent, color: "#0b0e14", border: "none",
                borderRadius: 8, padding: isMobile ? "13px 20px" : "11px 22px", fontWeight: 700,
                fontSize: 14, fontFamily: "Inter, sans-serif", whiteSpace: "nowrap" }}>
              {loading ? "Analyzing…" : "Analyze"}
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: COL.muted, marginTop: 10, lineHeight: 1.5 }}>
            Data: end-of-day daily candles. Swing sensitivity drives Q1, P5, Q7 and the target — higher = fewer, larger swings.
            Every auto-answer is editable; the conclusion recomputes from your final answers.
          </div>
        </div>

        {error && (
          <div style={{ background: COL.surface, border: `1px solid ${COL.danger}55`, borderLeft: `3px solid ${COL.danger}`,
            borderRadius: 10, padding: "14px 18px", marginBottom: 22, color: COL.text, fontSize: 14 }}>
            <strong style={{ color: COL.danger }}>Couldn't analyze {ticker}.</strong> {error}
            <div style={{ color: COL.muted, fontSize: 12.5, marginTop: 4 }}>
              Check the symbol (TASE needs the .TA suffix), or try a more liquid ticker.
            </div>
          </div>
        )}

        {data && (
          <>
            {/* Stock header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
              <div>
                <span style={{ fontSize: isMobile ? 17 : 20, fontWeight: 700 }}>{data.ticker}</span>
                <span style={{ color: COL.muted, fontSize: isMobile ? 13 : 14, marginLeft: 10 }}>{data.name}</span>
                <div style={{ fontSize: 12, color: COL.muted, fontFamily: "monospace", marginTop: 4 }}>
                  {data.exchange} · last close {data.lastDate} · {cur}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", justifyContent: isMobile ? "flex-start" : "flex-end" }}>
                <div style={{ textAlign: isMobile ? "left" : "right", lineHeight: 1.35, fontFamily: "monospace" }}>
                  <div style={{ fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: COL.muted }}>Data fetched</div>
                  <div style={{ fontSize: 12, color: COL.text }}>{fmtFetched(fetchedAt)}</div>
                </div>
                <button onClick={() => run(data.ticker)} disabled={loading} title="Fetch the latest data for this ticker"
                  style={{ cursor: loading ? "wait" : "pointer", background: COL.surface2, color: COL.text,
                    border: `1px solid ${COL.border}`, borderRadius: 8,
                    padding: isMobile ? "10px 14px" : "8px 14px", fontWeight: 600,
                    fontSize: 13, fontFamily: "Inter, sans-serif", display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                  <span style={{ fontSize: 14 }}>↻</span> {loading ? "Refreshing…" : "Refresh"}
                </button>
              </div>
            </div>

            {/* Check groups */}
            {GROUPS.map((g) => (
              <div key={g.label} style={{ background: COL.surface, border: `1px solid ${COL.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
                <div style={{ padding: "11px 16px", borderBottom: `1px solid ${COL.border}`, fontFamily: "monospace",
                  fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: g.color, background: g.color + "12" }}>
                  {g.label}
                </div>
                {g.ids.map((id) => {
                  const ch = data.checks[id] || {};
                  return (
                    <div key={id} style={{ padding: isMobile ? "12px 12px" : "13px 16px", borderBottom: `1px solid ${COL.border}` }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                        <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: COL.muted, minWidth: 26, paddingTop: isMobile ? 2 : 3, flexShrink: 0 }}>{id}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <span style={{ fontSize: isMobile ? 13 : 13.5, fontWeight: 600 }}>{META[id][0]}</span>
                            <Badge conf={ch.conf} />
                            {id in overrides && <span style={{ fontSize: 10, color: COL.warn, fontFamily: "monospace" }}>EDITED</span>}
                          </div>
                          {ch.why && <div style={{ fontSize: 12, color: COL.muted, marginTop: 3, lineHeight: 1.45 }}>{ch.why}</div>}
                          {isMobile && (
                            <div style={{ marginTop: 10 }}>
                              <Tri value={val(id)} onChange={setVal(id)} allowNA={id === "P5"} isMobile />
                            </div>
                          )}
                        </div>
                        {!isMobile && <Tri value={val(id)} onChange={setVal(id)} allowNA={id === "P5"} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Math */}
            <div style={{ background: COL.surface, border: `1px solid ${COL.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 18 }}>
              <div style={{ padding: "11px 16px", borderBottom: `1px solid ${COL.border}`, fontFamily: "monospace",
                fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: COL.warn, background: COL.warn + "12" }}>
                The Math — Risk / Reward
              </div>
              <div style={{ padding: isMobile ? "12px 12px" : 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Stat label="Buy (last close)" v={`${fmt(data.math.buy)}`} sub="Last close price" color={COL.accent2} isMobile={isMobile} />
                <Stat label="Candle Low" v={fmt(data.math.candleLow)} sub="Stop-loss" color={COL.danger} isMobile={isMobile} />
                <Stat label="Highest High" v={fmt(data.math.highestHigh)} sub="Target" color={COL.accent} isMobile={isMobile} />
              </div>
              <div style={{ padding: isMobile ? "0 12px 12px" : "0 16px 16px", display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Stat label="Risk %" v={fmt(data.math.risk)} sub="(Buy−Low)/Buy×100×1.5" color={COL.danger} isMobile={isMobile} />
                <Stat label="Reward %" v={fmt(data.math.reward)} sub="(High−Buy)/Buy×100" color={COL.accent} isMobile={isMobile} />
                <Stat label="Ratio" v={fmt(data.math.ratio)} sub="need ≥ 1.5"
                  color={data.math.ratio == null ? COL.muted : data.math.ratio >= 1.5 ? COL.accent : COL.danger} isMobile={isMobile} />
              </div>
              {data.math.ratio != null && data.math.ratio < 1.5 && (
                <div style={{ margin: isMobile ? "0 12px 12px" : "0 16px 16px", padding: "12px 14px", borderRadius: 8, background: COL.surface2, border: `1px solid ${COL.border}`, fontSize: 13 }}>
                  Ratio below 1.5. Max valid limit-order buy price (ratio = 1.5):{" "}
                  <strong style={{ color: COL.warn, fontFamily: "monospace" }}>{fmt(data.math.maxBuy)}</strong>.
                  <div style={{ color: COL.muted, marginTop: 4 }}>Or reduce risk: enter at the candle midpoint, or buy fewer shares.</div>
                </div>
              )}
            </div>

            <Conclusion data={data} conclusion={conclusion} fmt={fmt} cur={cur} isMobile={isMobile} />
          </>
        )}

        {!data && !loading && !error && (
          <div style={{ textAlign: "center", color: COL.muted, fontSize: 14, padding: "40px 0" }}>
            Enter a ticker above to run the full checklist automatically.
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, v, sub, color, isMobile }) {
  return (
    <div style={{ flex: 1, minWidth: isMobile ? 85 : 140, background: COL.surface2, border: `1px solid ${COL.border}`, borderRadius: 10, padding: isMobile ? "10px 10px" : "12px 14px" }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: COL.muted }}>{label}</div>
      <div style={{ fontFamily: "monospace", fontSize: isMobile ? 18 : 22, fontWeight: 700, color, margin: "2px 0" }}>{v}</div>
      <div style={{ fontSize: 10, color: COL.muted, lineHeight: 1.3 }}>{sub}</div>
    </div>
  );
}

function Conclusion({ data, conclusion, fmt, cur, isMobile }) {
  if (!conclusion) return null;
  const m = data.math;
  const map = {
    INCOMPLETE: { emoji: "⚠️", title: "INCOMPLETE", color: COL.warn,
      body: "One or more checks are undecided. Resolve every Yes/No before the conclusion can lock." },
    DO_NOT_ENTER: { emoji: "❌", title: "DO NOT ENTER", color: COL.danger,
      body: `A required check failed${conclusion.firstFail ? ` — first failure: ${conclusion.firstFail}` : ""}. Revisit on a later day.` },
    BUY: { emoji: "✅", title: "BUY SIGNAL", color: COL.accent,
      body: "All 9 passed and ratio ≥ 1.5. Enter at the current price." },
    BUY_LIMIT: { emoji: "✅", title: "BUY — LIMIT ORDER", color: COL.accent,
      body: "All 9 passed but ratio < 1.5 now. Place a limit order at the max valid buy price." },
  };
  const c = map[conclusion.code];
  const showPlan = conclusion.code === "BUY" || conclusion.code === "BUY_LIMIT";
  const entry = conclusion.code === "BUY_LIMIT" ? m.maxBuy : m.buy;

  return (
    <div>
      <div style={{ background: COL.surface, border: `1px solid ${c.color}55`, borderLeft: `3px solid ${c.color}`, borderRadius: 12, padding: isMobile ? "14px 14px" : "18px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 8 : 11, marginBottom: 7 }}>
          <span style={{ fontSize: isMobile ? 18 : 22 }}>{c.emoji}</span>
          <span style={{ fontSize: isMobile ? 15 : 17, fontWeight: 700, color: c.color }}>{data.ticker}: {c.title}</span>
        </div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6 }}>{c.body}</p>
        {showPlan && m.triggeredK?.length > 0 && (
          <div style={{ marginTop: 9, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: COL.muted }}>Entry signal:</span>
            {m.triggeredK.map((k) => (
              <span key={k} style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, padding: "2px 7px",
                borderRadius: 4, background: COL.accent + "22", color: COL.accent }}>{k}</span>
            ))}
          </div>
        )}
      </div>

      {showPlan && (
        <>
          <SectionLabel color={COL.accent2}>The Sell Plan</SectionLabel>
          <div style={{ display: "flex", gap: isMobile ? 8 : 11, flexWrap: "wrap" }}>
            <Plan label="Entry" v={`${fmt(entry)} ${cur}`} color={COL.accent2}
              note={conclusion.code === "BUY_LIMIT" ? "Limit at max valid price" : "Market entry"} isMobile={isMobile} />
            <Plan label="Stop-loss (exit down)" v={`${fmt(m.candleLow)} ${cur}`} color={COL.danger}
              note="Candle low. Close below → exit." isMobile={isMobile} />
            <Plan label="Target (exit up)" v={`${fmt(m.highestHigh)} ${cur}`} color={COL.accent}
              note="Highest high of last rising sequence." isMobile={isMobile} />
          </div>
          <div style={{ marginTop: 11, background: COL.surface, border: `1px solid ${COL.border}`, borderRadius: 10, padding: "13px 15px", fontSize: 12.5, color: COL.muted, lineHeight: 1.6 }}>
            The method defines the trade by two prices: stop = entry candle low, target = highest high of the last rising sequence.
            Risk here is <strong style={{ color: COL.danger }}>{fmt(m.risk)}%</strong>; at target, the reward-to-risk realizes at{" "}
            <strong style={{ color: COL.accent }}>{fmt(m.ratio)}×</strong>. No trailing stops or partial exits — the guide defines none.
          </div>

          <SectionLabel color={COL.warn}>When to re-check</SectionLabel>
          <MonCard label="Daily — at each candle close" color={COL.danger} items={[
            ["Close below the candle low (stop)?", "If yes → exit immediately."],
            ["Reached the Highest High target?", "If yes → take the exit; planned reward realized."],
            ["New seller candle near the highs?", "Green candle, upper tail ≥ 2× body = sellers regaining control."],
          ]} />
          <MonCard label="Weekly — confirm the trend holds" color={COL.phaseA} items={[
            ["Green MA still up, red below it? (Q3)", "Losing this means the trend basis is gone."],
            ["Peaks & troughs still rising? (Q1)", "A lower swing low breaks the uptrend."],
            ["Fresh falling sequence below red line? (Q5)", "Signals a new correction, not continuation."],
          ]} />
          <div style={{ background: COL.surface2, border: `1px solid ${COL.border}`, borderRadius: 10, padding: "11px 14px", fontSize: 12, color: COL.muted, marginTop: 4, lineHeight: 1.55 }}>
            Stop and target are single price levels → a once-daily glance at the close suffices. Trend structure moves slowly across
            many candles → weekly is enough to catch it turning. Re-run this analyzer weekly to refresh all three trend checks at once.
          </div>
        </>
      )}
    </div>
  );
}

function SectionLabel({ children, color }) {
  return <div style={{ fontFamily: "monospace", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color, margin: "24px 0 10px" }}>{children}</div>;
}
function Plan({ label, v, color, note, isMobile }) {
  return (
    <div style={{ flex: 1, minWidth: isMobile ? 130 : 150, background: COL.surface, border: `1px solid ${color}44`, borderRadius: 10, padding: isMobile ? "11px 12px" : "13px 15px" }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: COL.muted }}>{label}</div>
      <div style={{ fontFamily: "monospace", fontSize: isMobile ? 18 : 21, fontWeight: 700, color, margin: "2px 0" }}>{v}</div>
      <div style={{ fontSize: 11, color: COL.muted, lineHeight: 1.45 }}>{note}</div>
    </div>
  );
}
function MonCard({ label, color, items }) {
  return (
    <div style={{ background: COL.surface, border: `1px solid ${COL.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${COL.border}`, fontFamily: "monospace", fontSize: 11,
        fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color, background: color + "12" }}>{label}</div>
      {items.map(([t, d], i) => (
        <div key={i} style={{ padding: "11px 16px", borderBottom: i < items.length - 1 ? `1px solid ${COL.border}` : "none" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{t}</div>
          <div style={{ fontSize: 12, color: COL.muted, marginTop: 2 }}>{d}</div>
        </div>
      ))}
    </div>
  );
}
