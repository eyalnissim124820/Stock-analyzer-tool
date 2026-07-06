import React, { useEffect, useState } from "react";
import { C, INSET, fontFor } from "./design.js";
import { T } from "../strategy/strings.js";
import StrategyApp from "../strategy/StrategyApp.jsx";
import TrackerApp from "../tracker/TrackerApp.jsx";
import ChartApp from "../chart/ChartApp.jsx";

// ─────────────────────────────────────────────────────────────
// Root — hosts the tools and a persistent in-app mode toggle.
//   • "analyzer" → the original 9-Question tool (passed in as `Analyzer`,
//     rendered completely unchanged).
//   • "strategy" → the Sequence-Method (Strategy & Tactics) tool.
//   • "tracker"  → the Monthly Tracker (watchlist & buy alerts) tool.
//   • "chart"    → the Advanced Chart tool (English + Hebrew).
//
// The toggle is a floating segmented control, pinned (not inserted into any
// tool's layout) so each tool owns its own layout. Root also owns the cross-
// tool "Graph" jump: a right-click "Graph" in any scan tool opens the Chart
// tool in a NEW browser tab with the stock preloaded via the URL. Same design
// system throughout.
// ─────────────────────────────────────────────────────────────

// Read a "Graph" deep-link off the URL (?tool=chart&symbol=AAPL&market=US).
// Honored in every language now that Chart mode is available in Hebrew too.
function readChartDeepLink() {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  const symbol = p.get("symbol");
  if (p.get("tool") !== "chart" || !symbol) return null;
  return { symbol, market: p.get("market") === "TLV" ? "TLV" : "US" };
}

export default function Root({ lang = "en", Analyzer }) {
  const [deepLink] = useState(() => readChartDeepLink()); // { symbol, market } | null
  const [mode, setMode] = useState(deepLink ? "chart" : "analyzer");
  const t = T[lang] || T.en;
  const font = fontFor(lang);

  // Right-click "Graph" opens the Chart tool in a new browser tab, deep-linked
  // to the stock. Available in every language now.
  const openChart = (target) => {
    const params = new URLSearchParams({ tool: "chart", symbol: target.symbol || "", market: target.market || "US" });
    window.open(`${window.location.pathname}?${params}`, "_blank", "noopener");
  };

  return (
    <>
      {mode === "analyzer" ? <Analyzer onOpenChart={openChart} />
        : mode === "strategy" ? <StrategyApp lang={lang} onOpenChart={openChart} />
        : mode === "tracker" ? <TrackerApp lang={lang} onOpenChart={openChart} />
        : <ChartApp lang={lang} initial={deepLink} />}
      <ModeToggle mode={mode} setMode={setMode} t={t} font={font} dir={t.dir} />
    </>
  );
}

// Full tab labels don't fit a phone screen next to each other, so narrow
// viewports get the compact labels + tighter padding (and the row scrolls
// as a last resort instead of spilling out of the pill).
function useIsNarrow(threshold = 560) {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < threshold);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < threshold);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [threshold]);
  return narrow;
}

function ModeToggle({ mode, setMode, t, font, dir }) {
  const narrow = useIsNarrow();
  const opts = [
    { key: "analyzer", label: t.modeAnalyzer, short: t.modeAnalyzerShort },
    { key: "strategy", label: t.modeStrategy, short: t.modeStrategyShort },
    { key: "tracker", label: t.modeTracker, short: t.modeTrackerShort },
    { key: "chart", label: t.modeChart, short: t.modeChartShort },
  ];
  return (
    <div
      dir={dir}
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "calc(14px + env(safe-area-inset-bottom))",
        zIndex: 1001,
        display: "flex",
        gap: 4,
        padding: 5,
        borderRadius: 40,
        background: C.card,
        boxShadow: `${INSET}, 0 10px 28px rgba(0,0,0,0.45)`,
        maxWidth: "calc(100vw - 24px)",
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {opts.map((o) => {
        const on = mode === o.key;
        return (
          <button
            key={o.key}
            onClick={() => setMode(o.key)}
            title={o.label}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: narrow ? "9px 12px" : "9px 18px",
              borderRadius: 40,
              border: "none",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
              font: `700 ${narrow ? 13 : 14}px ${font}`,
              background: on ? "#fff" : "transparent",
              color: on ? C.card : C.t50,
              transition: "all .12s",
            }}
          >
            {(narrow && o.short) || o.label}
          </button>
        );
      })}
    </div>
  );
}
