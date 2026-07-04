import React from "react";
import { C, FONT_EN } from "../shared/design.js";
import { MA_DEFS } from "./AdvancedChart.jsx";

// ─────────────────────────────────────────────────────────────
// IndicatorPanel — chip toggles for the Advanced Chart: sub-panels
// (Volume/RSI/MACD), price overlays (Bollinger + the MA set) and the
// structure overlays (Zigzag, S/R, Fibonacci). Same chip styling as the
// analyzer's TierSelector. Selection is persisted by the parent.
// ─────────────────────────────────────────────────────────────

const FONT = FONT_EN;

export const DEFAULT_INDICATORS = {
  panels: { volume: true, rsi: false, macd: false },
  overlays: {
    boll: false, zigzag: true, sr: true, fib: false,
    sma5: false, sma13: false, sma20: true, sma40: false, sma50: true, sma200: false,
    ema9: false, ema21: false, ema50: false,
  },
};
export const INDICATORS_LS_KEY = "chartIndicators.v1";

export function loadIndicators() {
  try {
    const raw = localStorage.getItem(INDICATORS_LS_KEY);
    if (!raw) return DEFAULT_INDICATORS;
    const saved = JSON.parse(raw);
    return {
      panels: { ...DEFAULT_INDICATORS.panels, ...saved.panels },
      overlays: { ...DEFAULT_INDICATORS.overlays, ...saved.overlays },
    };
  } catch { return DEFAULT_INDICATORS; }
}
export function saveIndicators(ind) {
  try { localStorage.setItem(INDICATORS_LS_KEY, JSON.stringify(ind)); } catch { /* private mode */ }
}

function Chip({ on, label, color, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 6,
      font: `700 12px ${FONT}`, padding: "6px 12px", borderRadius: 40, border: "none", cursor: "pointer",
      background: on ? C.chip : "transparent", color: on ? "#fff" : C.t50,
      boxShadow: on ? "inset 0 0 0 1px rgba(255,255,255,0.14)" : "inset 0 0 0 1px rgba(255,255,255,0.06)",
    }}>
      {color && <span style={{ width: 10, height: 3, borderRadius: 2, background: color, opacity: on ? 1 : 0.35 }} />}
      {label}
    </button>
  );
}

function Group({ title, children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span style={{ font: `700 11px ${FONT}`, letterSpacing: "0.08em", color: C.t40, marginRight: 2, textTransform: "uppercase" }}>{title}</span>
      {children}
    </div>
  );
}

export default function IndicatorPanel({ ind, setInd, t }) {
  const togglePanel = (k) => setInd((v) => ({ ...v, panels: { ...v.panels, [k]: !v.panels[k] } }));
  const toggleOverlay = (k) => setInd((v) => ({ ...v, overlays: { ...v.overlays, [k]: !v.overlays[k] } }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: "8px 20px", flexWrap: "wrap" }}>
        <Group title={t.panels}>
          <Chip on={ind.panels.volume} label="Volume" onClick={() => togglePanel("volume")} />
          <Chip on={ind.panels.rsi} label="RSI" onClick={() => togglePanel("rsi")} />
          <Chip on={ind.panels.macd} label="MACD" onClick={() => togglePanel("macd")} />
        </Group>
        <Group title={t.structure}>
          <Chip on={ind.overlays.zigzag} label="Zigzag" color={C.amber} onClick={() => toggleOverlay("zigzag")} />
          <Chip on={ind.overlays.sr} label="S/R" color={C.blue} onClick={() => toggleOverlay("sr")} />
          <Chip on={ind.overlays.fib} label="Fib" color="#B37FEB" onClick={() => toggleOverlay("fib")} />
        </Group>
      </div>
      <Group title={t.overlays}>
        <Chip on={ind.overlays.boll} label="Bollinger" color="#9AA0AE" onClick={() => toggleOverlay("boll")} />
        {MA_DEFS.map((d) => (
          <Chip key={d.key} on={ind.overlays[d.key]} label={d.label} color={d.color} onClick={() => toggleOverlay(d.key)} />
        ))}
      </Group>
    </div>
  );
}
