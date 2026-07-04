import { useEffect, useState } from "react";

// Windowed-view state for a candle chart: {start, count} over N candles.
// Same contract as the view state in App.jsx's AnalysisChart — the canvas
// clamps it defensively, this hook just owns it and resets on new data.
export default function useChartView(N, dataKey) {
  const [view, setView] = useState({ start: 0, count: N });
  useEffect(() => { setView({ start: 0, count: N }); }, [dataKey, N]);
  return [view, setView];
}
