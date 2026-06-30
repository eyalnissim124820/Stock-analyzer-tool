import React, { useState } from "react";
import { C, INSET, fontFor } from "./design.js";
import { T } from "../strategy/strings.js";
import StrategyApp from "../strategy/StrategyApp.jsx";

// ─────────────────────────────────────────────────────────────
// Root — hosts the two tools and a persistent in-app mode toggle.
//   • "analyzer" → the original 9-Question tool (passed in as `Analyzer`,
//     rendered completely unchanged).
//   • "strategy" → the new Sequence-Method (Strategy & Tactics) tool.
//
// The toggle is a floating segmented control. It is pinned (not inserted into
// either tool's layout) specifically so the first tool stays byte-for-byte
// untouched — Root never reaches into App.jsx. Same design system throughout.
// ─────────────────────────────────────────────────────────────
export default function Root({ lang = "en", Analyzer }) {
  const [mode, setMode] = useState("analyzer");
  const t = T[lang] || T.en;
  const font = fontFor(lang);

  return (
    <>
      {mode === "analyzer" ? <Analyzer /> : <StrategyApp lang={lang} />}
      <ModeToggle mode={mode} setMode={setMode} t={t} font={font} dir={t.dir} />
    </>
  );
}

function ModeToggle({ mode, setMode, t, font, dir }) {
  const opts = [
    { key: "analyzer", label: t.modeAnalyzer },
    { key: "strategy", label: t.modeStrategy },
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
