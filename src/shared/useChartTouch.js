import { useEffect, useRef } from "react";

// ─────────────────────────────────────────────────────────────
// useChartTouch — touch gestures for the hand-rolled SVG charts.
//   • one-finger horizontal drag pans the visible window
//   • two-finger pinch zooms about the gesture midpoint
//   • a quick tap places the crosshair (via onTap)
//   • one-finger vertical swipes are left to the browser so the page still
//     scrolls — pair with `touchAction: "pan-y"` on the SVG.
//
// Every chart shares the same view contract ({ start, count } over N candles)
// and the same geometry names (W, padL, plotW, slot), so callers pass their
// per-render values in `params` and the hook re-reads them from a ref on each
// event. Listeners are attached natively (non-passive) because React's
// touchstart/touchmove are passive and can't call preventDefault().
// ─────────────────────────────────────────────────────────────
export default function useChartTouch(svgRef, params) {
  const p = useRef(params);
  p.current = params;
  const gRef = useRef(null); // gesture state carried between events

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;

    const dist = (a, b) => Math.max(24, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY));

    const onStart = (e) => {
      const { start, count } = p.current;
      if (e.touches.length === 2) {
        const [a, b] = [e.touches[0], e.touches[1]];
        const { W, padL, plotW } = p.current;
        const r = el.getBoundingClientRect();
        const vbX = (((a.clientX + b.clientX) / 2 - r.left) / r.width) * W;
        const frac = Math.max(0, Math.min(1, (vbX - padL) / plotW));
        gRef.current = { mode: "pinch", dist: dist(a, b), count, frac, pointer: start + frac * count };
        p.current.onGesture?.();
      } else if (e.touches.length === 1) {
        const t0 = e.touches[0];
        gRef.current = { mode: "tap", x: t0.clientX, y: t0.clientY, t: Date.now(), startStart: start };
      } else {
        gRef.current = null;
      }
    };

    const onMove = (e) => {
      const g = gRef.current;
      if (!g) return;
      const { N, W, slot, setView } = p.current;
      if (g.mode === "pinch" && e.touches.length >= 2) {
        e.preventDefault();
        const factor = g.dist / dist(e.touches[0], e.touches[1]);
        const minC = Math.min(N, 8);
        const cc = Math.max(minC, Math.min(N, Math.round(g.count * factor)));
        const st = Math.max(0, Math.min(N - cc, Math.round(g.pointer - g.frac * cc)));
        setView({ start: st, count: cc });
        return;
      }
      if (e.touches.length !== 1) return;
      const t0 = e.touches[0];
      if (g.mode === "tap") {
        const dx = t0.clientX - g.x, dy = t0.clientY - g.y;
        if (Math.hypot(dx, dy) <= 8) return; // still within tap slop
        if (Math.abs(dx) <= Math.abs(dy)) { gRef.current = null; return; } // vertical → page scroll
        g.mode = "pan";
        p.current.onGesture?.();
      }
      if (g.mode === "pan") {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        const dCandles = -Math.round(((t0.clientX - g.x) / r.width) * W / slot);
        setView((v) => {
          const cc = Math.max(2, Math.min(v.count, N));
          return { start: Math.max(0, Math.min(N - cc, g.startStart + dCandles)), count: cc };
        });
      }
    };

    const onEnd = (e) => {
      const g = gRef.current;
      if (g && g.mode === "tap" && e.touches.length === 0 && Date.now() - g.t < 400) {
        // Handle the tap ourselves and stop the browser from synthesizing
        // mouse events over the SVG afterwards.
        e.preventDefault();
        p.current.onTap?.(g.x, g.y);
      }
      if (e.touches.length === 0) gRef.current = null;
      else if (e.touches.length === 1 && g && g.mode === "pinch") {
        // Pinch released down to one finger — continue as a fresh pan.
        const t0 = e.touches[0];
        gRef.current = { mode: "pan", x: t0.clientX, y: t0.clientY, startStart: p.current.start };
      }
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [svgRef]);
}
