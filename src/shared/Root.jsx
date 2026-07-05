import React, { useState } from "react";
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
//   • "chart"    → the Advanced Chart tool (English-first for now).
//
// The toggle is a floating segmented control, pinned (not inserted into any
// tool's layout) so each tool owns its own layout. Root also owns the cross-
// tool "Graph" jump: a right-click "Graph" in any scan tool preloads the stock
// into Chart mode via `openChart`. Same design system throughout.
// ─────────────────────────────────────────────────────────────
export default function Root({ lang = "en", Analyzer }) {
  const [mode, setMode] = useState("analyzer");
  const [chartTarget, setChartTarget] = useState(null); // { symbol, market } from a "Graph" click
  const t = T[lang] || T.en;
  const font = fontFor(lang);

  // Chart mode ships English-first (see ModeToggle), so the Graph jump is only
  // wired for English. A fresh object each call re-triggers ChartApp's loader.
  const openChart = lang === "en"
    ? (target) => { setChartTarget({ ...target }); setMode("chart"); }
    : undefined;

  return (
    <>
      {mode === "analyzer" ? <Analyzer onOpenChart={openChart} />
        : mode === "strategy" ? <StrategyApp lang={lang} onOpenChart={openChart} />
        : mode === "tracker" ? <TrackerApp lang={lang} onOpenChart={openChart} />
        : <ChartApp lang={lang} initial={chartTarget} />}
      <ModeToggle mode={mode} setMode={setMode} t={t} font={font} dir={t.dir} lang={lang} />
    </>
  );
}

function ModeToggle({ mode, setMode, t, font, dir, lang }) {
  const opts = [
    { key: "analyzer", label: t.modeAnalyzer },
    { key: "strategy", label: t.modeStrategy },
    { key: "tracker", label: t.modeTracker },
    // Advanced Chart ships English-first; the Hebrew app gets it in a follow-up.
    ...(lang === "en" ? [{ key: "chart", label: t.modeChart }] : []),
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
              padding: "9px 18px",
              borderRadius: 40,
              border: "none",
              cursor: "pointer",
              whiteSpace: "nowrap",
              font: `700 14px ${font}`,
              background: on ? "#fff" : "transparent",
              color: on ? C.card : C.t50,
              transition: "all .12s",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
