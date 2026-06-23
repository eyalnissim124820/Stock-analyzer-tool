import React, { useState, useMemo, useEffect, useRef } from "react";

// ─────────────────────────────────────────────────────────────
// מנתח המניות — שיטת 9 השאלות (גרסה עברית, React + Vercel)
// זוהי גרסה עברית עצמאית ומלאה של האפליקציה, נפרדת לחלוטין מהגרסה
// האנגלית (src/App.jsx). היא חולקת רק את שכבת ה-API ‎(/api/analyze)‎,
// שאליה היא פונה עם הפרמטר ‎lang=he כדי לקבל את הסברי הבדיקות בעברית.
// הממשק כולו מימין-לשמאל ‎(RTL)‎ והתרגום אינו מילולי אלא בשפת מסחר
// תקנית ושוטפת.
// ─────────────────────────────────────────────────────────────

// אסימוני עיצוב — זהים לגרסה האנגלית.
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
const FONT = "Heebo, -apple-system, BlinkMacSystemFont, sans-serif";

// תוויות תצוגה לערכים שנשמרים פנימית באנגלית (כדי שה-API יקבל את הערך
// הקנוני) אך מוצגים למשתמש בעברית.
const TF_LABEL = { Daily: "יומי", Weekly: "שבועי", Monthly: "חודשי" };
const MK_LABEL = { US: "ארה״ב", TLV: "ת״א" };

const GROUPS_DEF = [
  { title: "סינון מקדים", caption: "הכול חייב לעבור", ids: ["P1", "P2", "P3", "P4", "P5"] },
  { title: "אישור המגמה", caption: "שלב א׳", ids: ["Q1", "Q2", "Q3", "Q4"] },
  { title: "אישור התיקון", caption: "שלב ב׳", ids: ["Q5", "Q6", "Q7"] },
  { title: "איתות כניסה", caption: "שלב ג׳ · מספיק ״כן״ אחד", ids: ["Q8", "Q9"] },
];

const CHECK_TITLES = {
  P1: "מחזור יומי מעל 1,000,000",
  P2: "נר הכניסה ירוק",
  P3: "נר הכניסה אינו נר מוכרים",
  P4: "המחיר אינו ברצף יורד",
  P5: "השפל האחרון גבוה מהשפל הקודם",
  Q1: "פסגות ושפלים במבנה עולה",
  Q2: "המחזור התרחב בעלייה האחרונה",
  Q3: "הממוצעים הנעים מסודרים נכון — הירוק (SMA 13) מעל האדום (SMA 5)",
  Q4: "התנגדות שנשברה הפכה לתמיכה",
  Q5: "ירידה מתחת לקו האדום (SMA 5), האדום במגמת ירידה",
  Q6: "‏CCI(5)‎ ירד מתחת ל‎־100",
  Q7: "נר תיקון מתחת לשפל הרצף הקודם",
  Q8: "הרצף היורד נשבר כלפי מעלה, סגירה מעל האדום (SMA 5)",
  Q9: "נר קונים ירוק מתחת לרצועת בולינגר התחתונה",
};

const CONF = {
  exact: { label: "מדויק", color: C.green, tip: "נוסחה דטרמיניסטית מנתוני הגרף" },
  swing: { label: "סווינג", color: C.blue, tip: "דטרמיניסטי בהתאם להגדרת הסווינג — בדקו את נקודות המפנה שזוהו" },
  guess: { label: "הערכה", color: "#E0A458", tip: "פרשנות בקירוב — ודאו ויזואלית" },
};

const VLABEL = { BUY: "קנייה", BUY_LIMIT: "קנייה — לימיט", DO_NOT_ENTER: "לא להיכנס", INCOMPLETE: "חסרים נתונים" };

// ── פותר ההכרעה (תואם ל-conclude שב-api/_engine.js, עם דריסות ידניות) ──
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

// ── רכיבי UI קטנים ──────────────────────────────────────────
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

// אייקון "?" שמציג בריחוף כרטיס הסבר מעוצב (title רגיל אינו תומך בטקסט מרובה
// שורות עם דוגמאות).
function HelpTip({ title, children, width = 280 }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button" aria-label={title || "עזרה"}
        onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 18, height: 18, borderRadius: "50%", border: "none", cursor: "help",
          background: C.chip, color: C.t70, font: `700 12px ${FONT}`, lineHeight: "18px",
          padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
        }}>?</button>
      {open && (
        <span style={{
          position: "absolute", bottom: "calc(100% + 8px)", right: "50%", transform: "translateX(50%)",
          width, maxWidth: "80vw", zIndex: 50, background: C.card2, color: C.t70, direction: "rtl",
          borderRadius: 12, padding: "12px 14px", boxShadow: `${INSET}, 0 12px 28px rgba(0,0,0,0.35)`,
          font: `400 12px ${FONT}`, lineHeight: 1.6, textAlign: "right", pointerEvents: "none",
        }}>
          {title && <span style={{ display: "block", font: `700 13px ${FONT}`, color: "#fff", marginBottom: 6 }}>{title}</span>}
          {children}
        </span>
      )}
    </span>
  );
}

// טקסט ההסבר לרגישות הסווינג (בשימוש ב-HelpTip שבסרגל הצד).
function SwingHelp() {
  return (
    <>
      קובע כמה נרות בכל צד של נר צריכים להיות נמוכים יותר (לפסגה) או גבוהים יותר
      (לשפל) כדי שייחשב כנקודת מפנה אמיתית.
      <span style={{ display: "block", marginTop: 8, color: C.t50 }}>
        <strong style={{ color: C.green, fontWeight: 700 }}>1</strong> — רגיש מאוד: מסמן הרבה
        סווינגים קטנים (רועש יותר).<br />
        <strong style={{ color: C.green, fontWeight: 700 }}>5</strong> — קפדני: רק נקודות מפנה
        משמעותיות.<br />
        ברירת המחדל היא <strong style={{ color: "#fff", fontWeight: 700 }}>2</strong>.
      </span>
      <span style={{ display: "block", marginTop: 8 }}>
        נקודות אלו מזינות את Q1, P5, Q7 ואת יעד השיא (ולכן גם את אחוז התשואה). אם הסווינגים
        שזוהו אינם תואמים את מה שהעין רואה — כווננו כאן.
      </span>
    </>
  );
}

function Pill({ label, on, tint, mobile, onClick }) {
  const base = {
    display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 16px",
    borderRadius: 40, font: `700 16px ${FONT}`, cursor: "pointer", border: "none",
    minWidth: mobile ? 72 : 64, height: mobile ? 44 : 35, transition: "all .12s", whiteSpace: "nowrap",
  };
  const style = on
    ? { ...base, background: tint, color: "#fff" }
    : { ...base, background: C.chip, color: C.t40 };
  return <button onClick={onClick} style={style}>{label}</button>;
}

// קישור צף למעבר חזרה לגרסה האנגלית.
function LangLink() {
  const [hover, setHover] = useState(false);
  return (
    <a href="/" title="Switch to English" dir="ltr"
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        position: "fixed", bottom: "calc(14px + env(safe-area-inset-bottom))", left: "calc(16px + env(safe-area-inset-left))", zIndex: 1001, display: "flex", alignItems: "center", gap: 6,
        padding: "8px 14px", borderRadius: 40, background: C.card, boxShadow: INSET,
        color: hover ? "#fff" : C.t50, font: `700 13px ${FONT}`, textDecoration: "none", transition: "color .12s",
      }}>English ›</a>
  );
}

// ── רכיב השורש ──────────────────────────────────────────────
export default function App() {
  const [timeframe, setTimeframe] = useState("Weekly");
  const [market, setMarket] = useState("US");
  const [symbol, setSymbol] = useState("");
  const [swingN, setSwingN] = useState(2);
  const [stocks, setStocks] = useState([]);     // מניות שנותחו (החדשות בראש)
  const [selectedId, setSelectedId] = useState(null);
  const [mobileDetail, setMobileDetail] = useState(false); // מובייל: תצוגת פירוט מול רשימה
  const nextId = useRef(1);
  const swingTimer = useRef(null);
  const fileRef = useRef(null);
  const [batch, setBatch] = useState(null); // { rows:[{rawSymbol,market,tf}], fileName } בזמן שהחלון פתוח

  const isMobile = useWindowWidth() < 920;

  // שליפה ושמירה של סריקה אחת. ‎existingId משתמש מחדש בשורה קיימת (רענון /
  // שינוי פרמטר); ‎mkt הוא השוק של הסריקה (US / TLV) וקובע את סיומת הסימול.
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
      const r = await fetch(`/api/analyze?ticker=${encodeURIComponent(ticker)}&swingN=${n}&timeframe=${encodeURIComponent(tf)}&market=${encodeURIComponent(mkt)}&lang=he`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "הבקשה נכשלה");
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
    if (isMobile) setMobileDetail(true); // בנייד עוברים מיד לתצוגת הפירוט
  }

  // בחירת מניה; בנייד עוברים לתצוגת הפירוט במסך מלא.
  const selectStock = (id) => { setSelectedId(id); if (isMobile) setMobileDetail(true); };

  const selected = stocks.find((s) => s.id === selectedId) || null;

  // הרצה מחדש של הסריקה הנבחרת כשפרמטרי הניתוח משתנים, כדי שהפירוט ישקף
  // באמת את הטווח / רגישות הסווינג שנבחרו. כל סריקה שומרת את השוק שלה (ולא
  // את הכפתור הנוכחי) כך שרענון סריקת ת״א נשאר ת״א.
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

  // הסרת סריקה; אם הייתה נבחרת, נופלים חזרה לסריקה הבאה שנותרה.
  function removeStock(stockId) {
    setStocks((prev) => {
      const next = prev.filter((s) => s.id !== stockId);
      if (stockId === selectedId) setSelectedId(next.length ? next[0].id : null);
      return next;
    });
  }

  // ── ניתוח קבוצתי (העלאת CSV) ──
  function openBatch() { if (fileRef.current) fileRef.current.click(); }
  function onBatchFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setBatch({ rows: parseBatchCsv(String(reader.result || "")), fileName: file.name });
    reader.readAsText(file);
    e.target.value = ""; // איפוס כדי שבחירה חוזרת של אותו קובץ תפעיל שוב onChange
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

    // יצירת כל הסריקות כשורות טעינה מראש
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

    // הוספה לתור בקבוצות של 5
    processBatchQueue(ids, 0, n, tf);
  }

  // שליפת קבוצת סריקות במקביל (עד 5 בכל פעם), ואז עיבוד הקבוצה הבאה ברקורסיה
  async function processBatchQueue(ids, startIdx, n, tf) {
    if (startIdx >= ids.length) return;

    const batchItems = ids.slice(startIdx, startIdx + 5);
    const results = await Promise.all(
      batchItems.map((x) =>
        fetch(`/api/analyze?ticker=${encodeURIComponent(x.ticker)}&swingN=${n}&timeframe=${encodeURIComponent(x.row.tf)}&market=${encodeURIComponent(x.market)}&lang=he`)
          .then((r) => r.json())
          .then((j) => (!j.error ? { id: x.id, data: j } : { id: x.id, error: j.error || "נכשל" }))
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

    // עיבוד הקבוצה הבאה
    processBatchQueue(ids, startIdx + 5, n, tf);
  }

  return (
    <div dir="rtl" style={{
      display: "flex", flexDirection: isMobile ? "column" : "row",
      height: isMobile ? "100dvh" : "100vh", width: "100%",
      background: C.bg, fontFamily: FONT, color: C.text, overflow: "hidden",
      ...(isMobile ? { paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" } : null),
    }}>
      {/* בנייד מוצגת תצוגה אחת בכל פעם (רשימה ↔ פירוט). בדסקטופ מוצגות שתיהן. */}
      {(!isMobile || !mobileDetail) && (
        <Sidebar
          isMobile={isMobile}
          timeframe={timeframe} onTimeframe={onTimeframe}
          market={market} setMarket={setMarket}
          swingN={swingN} onSwing={onSwing}
          symbol={symbol} setSymbol={setSymbol} analyze={analyze}
          stocks={stocks} selectedId={selectedId} setSelectedId={selectStock} removeStock={removeStock}
          onBatch={openBatch} onDownloadDemo={downloadDemoFile}
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
      <LangLink />
    </div>
  );
}

function BatchModal({ batch, onScanAll, onCancel }) {
  const count = batch.rows.length;
  const btn = {
    display: "flex", alignItems: "center", justifyContent: "center", padding: "12px 22px",
    borderRadius: 16, font: `700 15px ${FONT}`, border: "none", cursor: "pointer", whiteSpace: "nowrap",
  };
  const found = count === 1 ? "נמצאה מניה אחת" : `נמצאו ${count} מניות`;
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
        <span style={{ font: `700 20px ${FONT}`, color: "#fff" }}>סריקת ניתוח קבוצתי</span>
        <span style={{ font: `400 14px ${FONT}`, color: C.t70, lineHeight: 1.6 }}>
          {found} בקובץ <strong style={{ color: "#fff", fontWeight: 700 }}>{batch.fileName}</strong>. העלאתו תתחיל את סריקת כולן.
        </span>
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 4, flexWrap: "wrap" }}>
          <button onClick={onCancel} style={{ ...btn, background: C.chip, color: "#fff" }}>ביטול</button>
          <button onClick={onScanAll} disabled={count === 0}
            style={{ ...btn, background: count === 0 ? "rgba(255,255,255,0.4)" : "#fff", color: C.card, cursor: count === 0 ? "not-allowed" : "pointer" }}>
            סרוק הכול
          </button>
        </div>
      </div>
    </div>
  );
}

// ── סרגל צד ─────────────────────────────────────────────────
function Sidebar({ isMobile, timeframe, onTimeframe, market, setMarket, swingN, onSwing, symbol, setSymbol, analyze, stocks, selectedId, setSelectedId, removeStock, onBatch, onDownloadDemo }) {
  const [tfHover, setTfHover] = useState(false);
  const [mkHover, setMkHover] = useState(false);
  const [anHover, setAnHover] = useState(false);
  const [batchHover, setBatchHover] = useState(false);
  const [demoHover, setDemoHover] = useState(false);
  const [focus, setFocus] = useState(false);

  const ctlH = isMobile ? 56 : 69;
  const ctlBtn = {
    display: "flex", alignItems: "center", justifyContent: "center", height: ctlH, padding: isMobile ? "0 16px" : "0 24px",
    borderRadius: 16, color: "#fff", font: `700 16px ${FONT}`, border: "none", cursor: "pointer",
    whiteSpace: "nowrap", flexShrink: 0, transition: "background .12s",
  };
  // בנייד הכפתורים העליונים חולקים שורה, והשדה וכפתור הניתוח תופסים שורה מלאה כל אחד.
  const mobileToggle = isMobile ? { flex: "1 1 0", minWidth: 0 } : null;
  const mobileFull = isMobile ? { flex: "1 1 100%" } : null;

  const groups = groupByDay(stocks);

  return (
    <aside style={{
      width: isMobile ? "100%" : 640, flexShrink: 0,
      height: "100%", maxHeight: "100%",
      display: "flex", flexDirection: "column", gap: isMobile ? 16 : 24,
      padding: isMobile ? 16 : 36, boxSizing: "border-box",
    }}>
      {/* סרגל בקרה */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, background: C.card, borderRadius: 24,
        boxShadow: INSET, padding: 16, flexShrink: 0, flexWrap: "wrap",
      }}>
        <button
          onClick={() => setMarket(market === "US" ? "TLV" : "US")}
          onMouseEnter={() => setMkHover(true)} onMouseLeave={() => setMkHover(false)}
          title="בחירת שוק — מוסיף את סיומת הסימול המתאימה"
          style={{ ...ctlBtn, ...mobileToggle, background: mkHover ? "rgba(0,0,0,0.30)" : "rgba(0,0,0,0.18)" }}>
          {MK_LABEL[market]}
        </button>
        <button
          onClick={() => onTimeframe(timeframe === "Daily" ? "Weekly" : timeframe === "Weekly" ? "Monthly" : "Daily")}
          onMouseEnter={() => setTfHover(true)} onMouseLeave={() => setTfHover(false)}
          title="החלפת טווח הנרות — יומי ← שבועי ← חודשי"
          style={{ ...ctlBtn, ...mobileToggle, background: tfHover ? "rgba(0,0,0,0.30)" : "rgba(0,0,0,0.18)" }}>
          {TF_LABEL[timeframe]}
        </button>
        <input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && analyze()}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          placeholder="סימול" maxLength={8} dir="ltr"
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
          נתח
        </button>
      </div>

      {/* רגישות סווינג (נשמר מהמנוע; מעוצב לפי המקור) */}
      <div style={{
        display: "flex", alignItems: "center", gap: 16, background: C.card, borderRadius: 24,
        boxShadow: INSET, padding: "14px 20px", flexShrink: 0,
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <span style={{ font: `700 14px ${FONT}`, color: C.t70, whiteSpace: "nowrap" }}>רגישות סווינג</span>
          <HelpTip title="רגישות סווינג"><SwingHelp /></HelpTip>
        </span>
        <input type="range" min={1} max={5} value={swingN}
          onChange={(e) => onSwing(+e.target.value)}
          style={{ flex: 1, minWidth: 0, accentColor: C.green }} />
        <span style={{ font: `700 16px ${FONT}`, color: "#fff", minWidth: 16, textAlign: "center" }}>{swingN}</span>
      </div>

      {/* ניתוח קבוצתי */}
      <div style={{ display: "flex", gap: 12, flexShrink: 0 }}>
        <button
          onClick={onBatch}
          onMouseEnter={() => setBatchHover(true)} onMouseLeave={() => setBatchHover(false)}
          title="העלאת קובץ CSV לסריקת מניות רבות בבת אחת"
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
            background: C.card, borderRadius: 24, boxShadow: INSET, padding: "16px 20px",
            color: batchHover ? "#fff" : C.t70, font: `700 15px ${FONT}`, border: "none", cursor: "pointer",
            transition: "color .12s",
          }}>
          <span style={{ font: `700 18px ${FONT}`, lineHeight: 1 }}>⬆</span> ניתוח קבוצתי
        </button>
        <button
          onClick={onDownloadDemo}
          onMouseEnter={() => setDemoHover(true)} onMouseLeave={() => setDemoHover(false)}
          title="הורדת קובץ CSV לדוגמה"
          style={{
            flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            background: C.card, borderRadius: 24, boxShadow: INSET, padding: "16px 18px",
            color: demoHover ? "#fff" : C.t50, font: `700 13px ${FONT}`, border: "none", cursor: "pointer",
            transition: "color .12s", whiteSpace: "nowrap",
          }}>
          <span style={{ font: `400 16px ${FONT}`, lineHeight: 1 }}>⬇</span> קובץ דוגמה
        </button>
      </div>

      {/* רשימת המניות */}
      <div style={{
        flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column",
        gap: 8, padding: "4px 16px 24px",
      }}>
        {stocks.length === 0 && (
          <div style={{ padding: 16, textAlign: "center" }}>
            <span style={{ font: `700 16px ${FONT}`, color: C.t50 }}>נתחו מניה כדי להוסיפה לרשימת המניות</span>
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
                onRemove={() => removeStock(s.id)} />
            ))}
          </React.Fragment>
        ))}
      </div>
    </aside>
  );
}

function StockRow({ s, timeframe, isMobile, selected, onClick, onRemove }) {
  const [hover, setHover] = useState(false);
  const [xHover, setXHover] = useState(false);
  // במגע אין hover — שומרים על כפתור ההסרה נגיש (ומסתירים בזמן טעינה כדי שלא
  // יתנגש עם הספינר). התנהגות ה-hover בדסקטופ נשמרת ללא שינוי.
  const showX = isMobile ? !s.loading : hover;
  let chipBg = C.card2;
  if (s.error) chipBg = C.red;
  else if (!s.loading && s.data) {
    const code = verdict(s.data.checks, s.overrides, s.data.math).code;
    chipBg = code === "DO_NOT_ENTER" ? C.red : code === "INCOMPLETE" ? C.card2 : C.green;
  }
  const tf = (s.data && s.data.timeframe) || timeframe;
  const sub = s.error ? "הניתוח נכשל" : `${MK_LABEL[s.market] || s.market} · ${TF_LABEL[tf] || tf} · ${s.data ? s.data.lastDate : "…"}`;
  return (
    <div onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); setXHover(false); }}
      style={{
        position: "relative", display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 20,
        cursor: s.loading ? "default" : "pointer", transition: "background .12s",
        background: selected ? "rgba(255,255,255,0.06)" : hover ? "rgba(255,255,255,0.03)" : "transparent",
      }}>
      <div style={{ width: 80, height: 43, flexShrink: 0, borderRadius: 8, background: chipBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span dir="ltr" style={{ font: `700 16px ${FONT}`, color: "#fff" }}>{s.display}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4, paddingLeft: showX ? 28 : 0 }}>
        <span style={{ font: `700 16px ${FONT}`, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
        <span dir="ltr" style={{ font: `400 12px ${FONT}`, color: s.error ? C.red : C.t50, textAlign: "right" }}>{sub}</span>
      </div>
      {s.loading && (
        <div style={{ width: 32, height: 32, flexShrink: 0, borderRadius: "50%", border: "3px solid #343238", borderTopColor: C.blue, animation: "spin .8s linear infinite" }} />
      )}
      {showX && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          onMouseEnter={() => setXHover(true)} onMouseLeave={() => setXHover(false)}
          title="הסרת הסריקה" aria-label="הסרת הסריקה"
          style={{
            position: "absolute", top: 8, left: 8, width: 28, height: 28, borderRadius: "50%",
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

// ── חלונית הפירוט הראשית ─────────────────────────────────────
function Main({ isMobile, onBack, stock, setOverride, refresh }) {
  return (
    <main style={{ flex: 1, minWidth: 0, height: "100%", minHeight: 0, padding: isMobile ? "12px 12px 16px" : 20, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: isMobile ? 10 : 0, overflowX: isMobile ? "hidden" : undefined }}>
      {isMobile && (
        <button onClick={onBack} style={{
          flexShrink: 0, alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 8,
          padding: "10px 18px", borderRadius: 40, background: C.card, boxShadow: INSET,
          color: C.t70, font: `700 14px ${FONT}`, border: "none", cursor: "pointer",
        }}>רשימת המניות ›</button>
      )}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative", borderRadius: isMobile ? 24 : 40, background: C.card, boxShadow: INSET, overflow: "hidden" }}>
        {!stock || stock.loading || stock.error || !stock.data ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
            <span style={{ font: `700 16px ${FONT}`, color: stock && stock.error ? C.red : C.t25 }}>
              {stock && stock.error
                ? `לא ניתן לנתח את ${stock.ticker} — ${stock.error}`
                : stock && stock.loading
                ? `מנתח את ${stock.ticker}…`
                : "בחרו מניה כדי לצפות בניתוח"}
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
    ? stock.fetchedAt.toLocaleString("he-IL", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  return (
    <>
      <div style={{ position: "absolute", inset: 0, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 16, padding: 16 }}>

        {/* כרטיס כותרת ההכרעה */}
        <div style={{
          flexShrink: 0, borderRadius: 24, background: C.card2, boxShadow: `${INSET}, 0 12px 24px rgba(0,0,0,0.1)`,
          padding: isMobile ? "16px 18px" : "20px 24px",
          display: "flex", flexDirection: isMobile ? "column" : "row",
          justifyContent: isMobile ? "flex-start" : "space-between",
          alignItems: isMobile ? "stretch" : "center",
          gap: isMobile ? 12 : 16,
        }}>
          {/* פרטי המניה */}
          <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 6 : 12, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flexWrap: "wrap" }}>
              <span dir="ltr" style={{ font: `700 ${isMobile ? 20 : 24}px ${FONT}`, color: "#fff", flexShrink: 0 }}>{stock.display}</span>
              <span style={{ font: `700 11px ${FONT}`, letterSpacing: "0.08em", padding: "3px 10px", borderRadius: 40, background: C.chip, color: C.t70, flexShrink: 0 }}>{MK_LABEL[stock.market] || stock.market}</span>
              <span style={{ font: `400 ${isMobile ? 15 : 24}px ${FONT}`, color: C.t70, minWidth: 0, ...(isMobile ? {} : { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }) }}>{data.name}</span>
            </div>
            <span dir="ltr" style={{ font: `400 12px ${FONT}`, color: C.t70, textAlign: "right" }}>
              {data.exchange} · {TF_LABEL[data.timeframe] || data.timeframe} · {data.lastDate} · {cur}
            </span>
          </div>

          {isMobile ? (
            // נייד: פסיקה בולטת בשורה מלאה, עודכן + רענון בשורה משנית
            <>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center", padding: "10px 16px", borderRadius: 40,
                background: vbg, color: "#fff", font: `700 16px ${FONT}`,
              }}>{VLABEL[concl.code]}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button onClick={refresh} title="שליפת הנתונים העדכניים" style={{
                  flexShrink: 0, display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 40,
                  background: C.chip, color: "#fff", font: `700 14px ${FONT}`, border: "none", cursor: "pointer", whiteSpace: "nowrap",
                }}>↻ רענון</button>
                <div style={{ flex: 1, minWidth: 0, lineHeight: 1.35, textAlign: "left" }}>
                  <div style={{ font: `400 10px ${FONT}`, letterSpacing: "0.08em", textTransform: "uppercase", color: C.t50 }}>עודכן</div>
                  <div style={{ font: `400 12px ${FONT}`, color: C.t70 }}>{fetchedAt}</div>
                </div>
              </div>
            </>
          ) : (
            // דסקטופ: שורת ימין ללא שינוי
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
              <div style={{ textAlign: "left", lineHeight: 1.35 }}>
                <div style={{ font: `400 10px ${FONT}`, letterSpacing: "0.08em", textTransform: "uppercase", color: C.t50 }}>עודכן</div>
                <div style={{ font: `400 12px ${FONT}`, color: C.t70 }}>{fetchedAt}</div>
              </div>
              <button onClick={refresh} title="שליפת הנתונים העדכניים" style={{
                display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 40,
                background: C.chip, color: "#fff", font: `700 14px ${FONT}`, border: "none", cursor: "pointer", whiteSpace: "nowrap",
              }}>↻ רענון</button>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center", padding: "8px 16px", borderRadius: 40,
                background: vbg, color: "#fff", font: `700 16px ${FONT}`, whiteSpace: "nowrap", flexShrink: 0,
              }}>{VLABEL[concl.code]}</div>
            </div>
          )}
        </div>

        {/* סרגל סיכון / סיכוי / יחס */}
        <div style={{
          flexShrink: 0, borderRadius: 16, background: C.sub, padding: "20px 24px",
          display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 32, flexWrap: "wrap" }}>
            <Metric label="סיכון" value={`${fmt(m.risk)}%`} />
            <Metric label="סיכוי" value={`${fmt(m.reward)}%`} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ font: `400 16px ${FONT}`, color: rcol }}>יחס</span>
            <span style={{ font: `700 16px ${FONT}`, color: rcol }}>{fmt(m.ratio)}×</span>
          </div>
        </div>

        {/* קבוצות הבדיקות */}
        {GROUPS_DEF.map((g, gi) => (
          <React.Fragment key={g.title}>
            {gi > 0 && <div style={{ height: 1, background: C.line, margin: "8px 20px", flexShrink: 0 }} />}
            <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: "0 20px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ font: `700 20px ${FONT}`, color: "#fff" }}>{g.title}</span>
                <span style={{ font: `700 12px ${FONT}`, letterSpacing: "0.08em", color: C.t50 }}>{g.caption}</span>
                {g.ids.includes("Q3") && <MaLegend />}
              </div>
              {g.ids.map((id) => {
                const ch = data.checks[id] || {};
                const cval = v(id);
                const edited = id in overrides;
                const allowNA = id === "P5";
                const pills = (
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <Pill label="כן" on={cval === "yes"} tint={C.green} mobile={isMobile} onClick={() => setOverride(stock.id, id, "yes")} />
                    <Pill label="לא" on={cval === "no"} tint={C.red} mobile={isMobile} onClick={() => setOverride(stock.id, id, "no")} />
                    {allowNA && <Pill label="לא רלוונטי" on={cval === "na"} tint="#7E8AA0" mobile={isMobile} onClick={() => setOverride(stock.id, id, "na")} />}
                  </div>
                );
                return isMobile ? (
                  // נייד: [תג + כותרת] בשורה עליונה, כפתורים בשורה תחתונה
                  <div key={id} style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, minWidth: 0 }}>
                      <div style={{ width: 42, height: 42, flexShrink: 0, borderRadius: 12, background: C.chip, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span dir="ltr" style={{ font: `700 16px ${FONT}`, color: C.t50 }}>{id}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ font: `700 15px ${FONT}`, color: "#fff", lineHeight: 1.3 }}>{CHECK_TITLES[id]}</span>
                          <Badge conf={ch.conf} />
                          {edited && <span style={{ font: `700 10px ${FONT}`, letterSpacing: "0.08em", color: "#E0A458" }}>נערך</span>}
                        </div>
                        {ch.why && <span style={{ font: `400 12px ${FONT}`, color: C.t70, lineHeight: 1.4, overflowWrap: "break-word" }}>{ch.why}</span>}
                      </div>
                    </div>
                    {/* כפתורים מוזחים כדי להתיישר מתחת לטקסט הכותרת (RTL: paddingRight) */}
                    <div style={{ paddingRight: 54 }}>{pills}</div>
                  </div>
                ) : (
                  // דסקטופ: שורה אופקית אחת — ללא שינוי
                  <div key={id} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <div style={{ width: 42, height: 42, flexShrink: 0, borderRadius: 12, background: C.chip, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span dir="ltr" style={{ font: `700 16px ${FONT}`, color: C.t50 }}>{id}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ font: `700 16px ${FONT}`, color: "#fff" }}>{CHECK_TITLES[id]}</span>
                        <Badge conf={ch.conf} />
                        {edited && <span style={{ font: `700 10px ${FONT}`, letterSpacing: "0.08em", color: "#E0A458" }}>נערך</span>}
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

        {/* החישוב — סיכון / סיכוי */}
        <div style={{ height: 1, background: C.line, margin: "8px 20px", flexShrink: 0 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "0 20px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ font: `700 20px ${FONT}`, color: "#fff" }}>החישוב</span>
            <span style={{ font: `700 12px ${FONT}`, letterSpacing: "0.08em", color: C.t50 }}>סיכון / סיכוי</span>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Stat label="קנייה (סגירה אחרונה)" v={fmt(m.buy)} sub="מחיר הסגירה האחרון" color={C.blue} />
            <Stat label="שפל הנר" v={fmt(m.candleLow)} sub="סטופ-לוס" color={C.red} />
            <Stat label="השיא הגבוה ביותר" v={fmt(m.highestHigh)} sub="יעד" color={C.green} />
          </div>
          {m.ratio != null && m.ratio < 1.5 && (
            <div style={{ borderRadius: 16, background: C.sub, padding: "14px 18px", font: `400 14px ${FONT}`, color: C.t70, lineHeight: 1.6 }}>
              היחס נמוך מ-1.5. מחיר הקנייה המרבי התקף בהוראת לימיט (יחס = 1.5):{" "}
              <strong style={{ color: "#E0A458", fontWeight: 700 }}>{fmt(m.maxBuy)} {cur}</strong>.
              <div style={{ marginTop: 4, color: C.t50 }}>לחלופין הקטינו את הסיכון: היכנסו באמצע הנר, או קנו פחות מניות.</div>
            </div>
          )}
        </div>

        {/* תוכנית מכירה + מעקב */}
        {showPlan && (
          <>
            <div style={{ height: 1, background: C.line, margin: "8px 20px", flexShrink: 0 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "0 20px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ font: `700 20px ${FONT}`, color: "#fff" }}>תוכנית המכירה</span>
                <span style={{ font: `700 12px ${FONT}`, letterSpacing: "0.08em", color: C.t50 }}>שני מחירים מגדירים את העסקה</span>
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <Stat label="כניסה" v={`${fmt(entry)} ${cur}`} sub={concl.code === "BUY_LIMIT" ? "לימיט במחיר המרבי התקף" : "כניסה בשוק"} color={C.blue} />
                <Stat label="סטופ-לוס (יציאה למטה)" v={`${fmt(m.candleLow)} ${cur}`} sub="שפל הנר. סגירה מתחתיו ← יציאה." color={C.red} />
                <Stat label="יעד (יציאה למעלה)" v={`${fmt(m.highestHigh)} ${cur}`} sub="השיא הגבוה ביותר של הרצף העולה האחרון." color={C.green} />
              </div>
              <div style={{ borderRadius: 16, background: C.sub, padding: "14px 18px", font: `400 14px ${FONT}`, color: C.t70, lineHeight: 1.6 }}>
                השיטה מגדירה את העסקה בשני מחירים: סטופ = שפל נר הכניסה, יעד = השיא הגבוה ביותר של הרצף העולה האחרון.
                הסיכון כאן הוא <strong style={{ color: C.red, fontWeight: 700 }}>{fmt(m.risk)}%</strong>; ביעד יחס הסיכוי-לסיכון מתממש ב-{" "}
                <strong style={{ color: C.green, fontWeight: 700 }}>{fmt(m.ratio)}×</strong>. ללא סטופ נגרר וללא יציאות חלקיות — המדריך אינו מגדיר כאלה.
              </div>
              {m.triggeredK?.length > 0 && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ font: `400 14px ${FONT}`, color: C.t50 }}>איתות כניסה:</span>
                  {m.triggeredK.map((k) => (
                    <span key={k} dir="ltr" style={{ font: `700 12px ${FONT}`, padding: "4px 10px", borderRadius: 40, background: C.green + "22", color: C.green }}>{k}</span>
                  ))}
                </div>
              )}
            </div>

            <div style={{ height: 1, background: C.line, margin: "8px 20px", flexShrink: 0 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "0 20px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ font: `700 20px ${FONT}`, color: "#fff" }}>מתי לבדוק שוב</span>
                <span style={{ font: `700 12px ${FONT}`, letterSpacing: "0.08em", color: C.t50 }}>מעקב</span>
              </div>
              <MonCard color={C.red} title="יומי — בכל סגירת נר" items={[
                ["סגירה מתחת לשפל הנר (סטופ)?", "אם כן ← יציאה מיידית."],
                ["הגעה ליעד השיא הגבוה ביותר?", "אם כן ← מימוש היציאה; הסיכוי המתוכנן הושג."],
                ["נר מוכרים חדש סמוך לשיאים?", "נר ירוק, צל עליון ≥ פי 2 מהגוף = המוכרים חוזרים לשלוט."],
              ]} />
              <MonCard color={C.blue} title="שבועי — אימות שהמגמה נשמרת" items={[
                ["הממוצע הירוק עדיין עולה והאדום מתחתיו? (Q3)", "אובדן זה משמעו שבסיס המגמה נעלם."],
                ["פסגות ושפלים עדיין עולים? (Q1)", "שפל נמוך יותר שובר את המגמה העולה."],
                ["רצף יורד חדש מתחת לקו האדום? (Q5)", "מסמן תיקון חדש, לא המשך מגמה."],
              ]} />
              <div style={{ borderRadius: 16, background: C.sub, padding: "14px 18px", font: `400 13px ${FONT}`, color: C.t50, lineHeight: 1.6 }}>
                הסטופ והיעד הם רמות מחיר בודדות ← מבט יומי אחד בסגירה מספיק. מבנה המגמה משתנה לאט על פני נרות רבים ←
                בדיקה שבועית מספיקה כדי לזהות תפנית. הריצו את המנתח מחדש מדי שבוע כדי לרענן את שלוש בדיקות המגמה בבת אחת.
              </div>
            </div>
          </>
        )}

        {/* גרף ניתוח טכני מופק */}
        <AnalysisChart data={data} isMobile={isMobile} />

        <div style={{ height: 60, flexShrink: 0 }} />
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 100, pointerEvents: "none", background: `linear-gradient(0deg, ${C.card} 0%, rgba(41,40,44,0) 100%)` }} />
    </>
  );
}

// ── גרף נרות מופק ───────────────────────────────────────────
// SVG בעבודת יד (ללא ספריית גרפים). מצייר את הנרות שנמשכו יחד עם הסדרות,
// נקודות הסווינג והרמות שהמנוע חישב — כך שהתמונה משקפת את ההכרעה. בורר רמות
// קובע את צפיפות השכבות; צלב כוונת מציג את נתוני הנר שמתחת לעכבר.
const CHART_TIERS = [
  { key: "Minimal", label: "מינימלי" },
  { key: "Core", label: "רגיל" },
  { key: "Full", label: "מלא" },
];

function AnalysisChart({ data, isMobile }) {
  const [tier, setTier] = useState("Core");
  const [hover, setHover] = useState(null);
  const svgRef = useRef(null);

  const candles = data.candles;
  const series = data.series || {};
  const dates = data.dates || [];
  const piv = data.pivots || { ph: [], pl: [] };
  const seg = data.segments || {};
  const m = data.math || {};
  if (!candles || !candles.close || candles.close.length === 0) return null;

  const N = candles.close.length;
  const last = N - 1;
  const W = 720, H = isMobile ? 280 : 340;
  const padL = 10, padR = 62, padT = 14, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const slot = plotW / N;
  const bodyW = Math.max(1.2, Math.min(slot * 0.62, 13));

  const showLevels = tier === "Core" || tier === "Full";
  const showFull = tier === "Full";

  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < N; i++) { lo = Math.min(lo, candles.low[i]); hi = Math.max(hi, candles.high[i]); }
  if (showLevels) for (const lvl of [m.buy, m.candleLow, m.highestHigh])
    if (lvl != null) { lo = Math.min(lo, lvl); hi = Math.max(hi, lvl); }
  if (showFull && series.bollLo) for (const b of series.bollLo) if (b != null) lo = Math.min(lo, b);
  const padP = (hi - lo) * 0.06 || 1;
  lo -= padP; hi += padP;
  const span = hi - lo || 1;
  const x = (i) => padL + slot * (i + 0.5);
  const y = (p) => padT + ((hi - p) / span) * plotH;
  const fmt = (v, d = 2) => (v == null || isNaN(v) ? "—" : Number(v).toFixed(d));

  const polyline = (arr, color, w = 1.6, dash) => {
    if (!arr) return null;
    const pts = [];
    for (let i = 0; i < N; i++) if (arr[i] != null) pts.push(`${x(i).toFixed(1)},${y(arr[i]).toFixed(1)}`);
    if (pts.length < 2) return null;
    return <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={w}
      strokeDasharray={dash} strokeLinejoin="round" strokeLinecap="round" />;
  };

  const level = (price, color, label) => {
    if (price == null) return null;
    const yy = y(price);
    return (
      <g key={label}>
        <line x1={padL} y1={yy} x2={padL + plotW} y2={yy} stroke={color} strokeWidth={1} strokeDasharray="5 4" opacity={0.9} />
        <text x={padL + plotW + 4} y={yy + 3} fill={color} style={{ font: `700 10px ${FONT}` }}>{label}</text>
        <text x={padL + plotW + 4} y={yy + 14} fill={C.t50} style={{ font: `400 9px ${FONT}` }}>{fmt(price)}</text>
      </g>
    );
  };

  function onMove(e) {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const vbX = ((e.clientX - r.left) / r.width) * W;
    let i = Math.round((vbX - padL) / slot - 0.5);
    i = Math.max(0, Math.min(last, i));
    setHover(i);
  }

  let tip = null;
  if (hover != null) {
    const k = (a) => a[hover];
    const tw = 120, th = 78, gap = 10;
    const hx = x(hover);
    const tx = hx + gap + tw > padL + plotW ? hx - gap - tw : hx + gap;
    const ty = padT + 4;
    const rows = [
      ["", dates[hover] || ""],
      ["פ", fmt(k(candles.open))], ["ג", fmt(k(candles.high))],
      ["נ", fmt(k(candles.low))], ["ס", fmt(k(candles.close))],
    ];
    tip = (
      <g pointerEvents="none">
        <line x1={hx} y1={padT} x2={hx} y2={padT + plotH} stroke={C.t40} strokeWidth={1} strokeDasharray="3 3" />
        <rect x={tx} y={ty} width={tw} height={th} rx={8} fill={C.card2} stroke="rgba(255,255,255,0.12)" />
        {rows.map(([lab, val], r) => (
          <text key={r} x={tx + 9} y={ty + 16 + r * 14}
            fill={lab ? C.t50 : "#fff"} style={{ font: `${lab ? 400 : 700} ${lab ? 10 : 11}px ${FONT}` }}>
            {lab ? `${lab}  ` : ""}{val}
          </text>
        ))}
      </g>
    );
  }

  const grid = [0, 0.5, 1].map((f) => {
    const p = lo + span * f, yy = y(p);
    return (
      <g key={f}>
        <line x1={padL} y1={yy} x2={padL + plotW} y2={yy} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
        <text x={padL + plotW + 4} y={yy + 3} fill={C.t40} style={{ font: `400 9px ${FONT}` }}>{fmt(p)}</text>
      </g>
    );
  });

  return (
    <>
      <div style={{ height: 1, background: C.line, margin: "8px 20px", flexShrink: 0 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "0 20px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ font: `700 20px ${FONT}`, color: "#fff" }}>גרף</span>
            <span style={{ font: `700 12px ${FONT}`, letterSpacing: "0.08em", color: C.t50 }}>מופק מהנתונים</span>
          </div>
          <div style={{ display: "flex", gap: 4, background: C.sub, borderRadius: 40, padding: 4 }}>
            {CHART_TIERS.map((t) => (
              <button key={t.key} onClick={() => setTier(t.key)} style={{
                font: `700 12px ${FONT}`, padding: "6px 12px", borderRadius: 40, border: "none", cursor: "pointer",
                background: tier === t.key ? C.chip : "transparent", color: tier === t.key ? "#fff" : C.t50,
              }}>{t.label}</button>
            ))}
          </div>
        </div>

        <div style={{ width: "100%", aspectRatio: `${W} / ${H}`, background: C.sub, borderRadius: 16, overflow: "hidden" }}>
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" height="100%"
            onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: "block", cursor: "crosshair" }}>
            {grid}

            {showFull && seg.highestHighIdx != null && (
              <>
                {seg.priorSeqLowIdx != null && (
                  <rect x={x(seg.priorSeqLowIdx)} y={padT} width={Math.max(0, x(seg.highestHighIdx) - x(seg.priorSeqLowIdx))}
                    height={plotH} fill={C.green} opacity={0.07} />
                )}
                <rect x={x(seg.highestHighIdx)} y={padT} width={Math.max(0, x(last) - x(seg.highestHighIdx))}
                  height={plotH} fill={C.red} opacity={0.07} />
              </>
            )}

            {Array.from({ length: N }, (_, i) => {
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

            {showFull && polyline(series.bollLo, "#9AA0AE", 1, "4 3")}

            {polyline(series.green13, C.green, 1.8)}
            {polyline(series.red, C.red, 1.6)}

            {showFull && (piv.ph || []).map((p, j) => (
              <circle key={`ph${j}`} cx={x(p.i)} cy={y(p.price) - 5} r={2.4} fill={C.green} />
            ))}
            {showFull && (piv.pl || []).map((p, j) => (
              <circle key={`pl${j}`} cx={x(p.i)} cy={y(p.price) + 5} r={2.4} fill={C.red} />
            ))}

            {showLevels && level(m.highestHigh, C.green, "יעד")}
            {showLevels && level(m.buy, C.blue, "קנייה")}
            {showLevels && level(m.candleLow, C.red, "סטופ")}

            {[0, Math.floor(last / 2), last].map((i, j) => (
              <text key={j} x={Math.min(Math.max(x(i), padL + 14), padL + plotW - 14)} y={H - 8}
                textAnchor="middle" fill={C.t40} style={{ font: `400 9px ${FONT}` }}>{dates[i] || ""}</text>
            ))}

            {tip}
          </svg>
        </div>

        <ChartLegend tier={tier} />
      </div>
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
      {item(<span style={dot(C.green)} />, "קו ירוק (SMA 13)")}
      {item(<span style={dot(C.red)} />, "קו אדום (SMA 5)")}
      {tier !== "Minimal" && item(<span style={{ ...dot(C.blue), borderRadius: 0 }} />, "רמות קנייה / סטופ / יעד")}
      {tier === "Full" && item(<span style={dot(C.green, true)} />, "נקודות סווינג")}
      {tier === "Full" && item(<span style={dot("#9AA0AE")} />, "בולינגר תחתון (10/1)")}
    </div>
  );
}

// מבהיר מהם שני קווי הממוצע הנע, בפעם הראשונה שהם מופיעים.
function MaLegend() {
  const dot = (color) => ({ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 });
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", marginTop: 4 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 6, font: `400 12px ${FONT}`, color: C.t70 }}>
        <span style={dot(C.green)} />קו ירוק = ממוצע נע 13 של המחיר
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, font: `400 12px ${FONT}`, color: C.t70 }}>
        <span style={dot(C.red)} />קו אדום = ממוצע נע 5 של הקו הירוק
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

// ── פונקציות עזר ─────────────────────────────────────────────
// פירוק קובץ CSV של ניתוח קבוצתי עם העמודות Ticker, Market (US/TLV),
// Resolutions (W/M). סלחני לסדר העמודות, כותרת אופציונלית, מרכאות ושורות ריקות.
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

// הסימול הגולמי שהמשתמש רואה מול הסימול עם הסיומת ש-Yahoo דורש.
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

// קיבוץ המניות שנותחו לפי יום הסריקה. היום העדכני ביותר ללא כותרת (בלוק
// ה״לאחרונה״ של העיצוב); ימים קודמים מקבלים קו מפריד + תווית תאריך.
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
      if (g.day.getTime() === yest.getTime()) header = "אתמול";
      else header = g.day.toLocaleDateString("he-IL", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
    }
    return { key: g.key, header, rows: g.rows };
  });
}
