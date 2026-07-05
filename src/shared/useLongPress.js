import { useRef } from "react";

// ─────────────────────────────────────────────────────────────
// useLongPress — long-press → context-menu bridge for touch devices.
// iOS Safari never fires `contextmenu` for touches, so the scan rows spread
// these handlers alongside their onContextMenu: after ~450ms of a steady
// press, `onPress` is called with a minimal event ({ clientX, clientY,
// preventDefault }) matching what the onContextMenu handlers expect. The
// touchend (and any trailing click) is swallowed so the row underneath the
// freshly opened menu doesn't also get selected.
// ─────────────────────────────────────────────────────────────
export default function useLongPress(onPress, ms = 450) {
  const st = useRef(null);   // { timer, x, y, fired } for the active press
  const firedAt = useRef(0); // suppress the click that trails a fired press

  const cancel = () => {
    if (st.current) clearTimeout(st.current.timer);
    st.current = null;
  };

  return {
    onTouchStart: (e) => {
      cancel();
      if (e.touches.length !== 1) return;
      const t0 = e.touches[0];
      const s = { x: t0.clientX, y: t0.clientY, fired: false, timer: 0 };
      s.timer = setTimeout(() => {
        s.fired = true;
        if (navigator.vibrate) { try { navigator.vibrate(10); } catch { /* ignore */ } }
        onPress({ clientX: s.x, clientY: s.y, preventDefault() {}, stopPropagation() {} });
      }, ms);
      st.current = s;
    },
    onTouchMove: (e) => {
      const s = st.current, t0 = e.touches[0];
      if (!s || s.fired || !t0) return;
      if (Math.hypot(t0.clientX - s.x, t0.clientY - s.y) > 10) cancel(); // it's a scroll, not a press
    },
    onTouchEnd: (e) => {
      const fired = !!st.current?.fired;
      cancel();
      if (fired) {
        firedAt.current = Date.now();
        // Stop the browser synthesizing mousedown/click, which would close
        // the menu we just opened and select the row.
        e.preventDefault();
      }
    },
    onTouchCancel: cancel,
    onClickCapture: (e) => {
      // Backup for browsers that synthesize the click anyway — it trails the
      // touchend within ~100ms, so keep the window tight to avoid eating a
      // genuine follow-up tap.
      if (Date.now() - firedAt.current < 300) { e.preventDefault(); e.stopPropagation(); }
    },
  };
}
