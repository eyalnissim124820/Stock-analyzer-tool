# The 9-Question Method — Auto-Analyzer

A React + Vercel app that runs the entire 9-Question chart method automatically.
Enter a ticker; it fetches daily candles, computes every indicator, evaluates all
14 checks, fills them in (editable), and produces the conclusion, sell plan, and
monitoring cadence. **All rules come from the method guide — nothing else is added
(no RSI, MACD, Fibonacci, news, or earnings).**

---

## Deploy (5 minutes, free)

1. Put this folder in a new GitHub repo (or use the Vercel CLI directly).
2. Go to vercel.com → New Project → import the repo. Framework preset: **Vite**.
   Vercel auto-detects `vite build` and the `/api` serverless function.
3. Deploy. That's it — no API keys, no environment variables, no database.

**CLI alternative:**
```bash
npm i -g vercel
cd analyzer
vercel          # follow prompts; accept the Vite defaults
vercel --prod   # promote to production
```

### Run locally
```bash
npm install
vercel dev      # runs BOTH the React app and the /api function together on :3000
```
Open the printed URL. (`npm run dev` alone runs only the front-end; the `/api`
call needs `vercel dev` so the serverless function is live. The Vite proxy in
`vite.config.js` points `/api` at `vercel dev`.)

---

## How it works

```
Browser (React)  ──GET /api/analyze?ticker=AAPL&swingN=2──▶  Vercel function
                                                              │
                                              fetch ~6mo daily OHLCV from Yahoo
                                                              │
                                              _engine.js: indicators + swings + 14 checks
                                                              │
   filled checklist + math + conclusion  ◀────────────────────┘
```

- **`api/_engine.js`** — pure method logic. Indicators (13 SMA green line,
  5-SMA-of-green red line, CCI(5), Bollinger lower 10/1), pivot/swing detection,
  all 14 checks, the risk/reward math, and the conclusion resolver. No I/O — unit-testable.
- **`api/analyze.js`** — fetches data from Yahoo and calls the engine. The only
  file that touches the network.
- **`src/App.jsx`** — the UI: ticker bar, swing slider, auto-filled checks with
  confidence badges and evidence, overrides, math, sell plan, monitoring.

### Confidence badges
- **EXACT** — single deterministic formula (P1–P4, Q2, Q3, Q5, Q6, Q8, Q9 + the math).
- **SWING** — deterministic given your swing-sensitivity setting (Q1, P5, Q7, the
  highest-high target). Check the logic matches what your eye sees; tune the slider if not.
- **GUESS** — best-effort interpretation, confirm visually (Q4 resistance→support,
  and Q1 when pivots are sparse). Always overridable.

Every auto-answer can be overridden with the Yes/No/N-A buttons; the conclusion
recomputes live from your final answers.

### The two additions beyond the guide
- **Sell plan** — derived only from the guide's own values: stop = entry candle low,
  target = highest high of the last rising sequence (the same number used for Reward %).
- **Monitoring cadence** — daily checks for the two price levels + a seller candle near
  the highs; weekly checks for trend integrity (Q1, Q3, Q5). Daily for single price
  levels, weekly for slow-moving structure. Uses only indicators already on the chart.

---

## Honest caveats

1. **Yahoo's endpoint is unofficial.** It works well and needs no key, but Yahoo can
   change it without notice. If fetches start failing, the fix is isolated to
   `fetchCandles()` in `api/analyze.js` — swap in Twelve Data (free, 800 req/day,
   needs a key) or Alpaca. *This data layer was not live-tested in the build sandbox
   (network was restricted there); verify it on first deploy, where Vercel has open
   network access.*
2. **End-of-day data.** Candles are daily closes — correct for this method, which runs
   on completed daily candles. "Buy Price" defaults to the last close; if you have a
   live intraday price, the math reads from the last close unless you adjust your entry.
3. **TASE tickers** need the `.TA` suffix (e.g. `TEVA.TA`). Yahoo covers TASE, but
   thinly-traded names may return sparse data and trip the "need ~30+ candles" guard.
4. **Swing sensitivity is a real knob.** It changes Q1, P5, Q7, and the target. Default
   is 2 (a pivot needs 2 lower-highs/higher-lows on each side). Higher = fewer, larger
   swings. When in doubt, eyeball the detected structure against the slider.
5. **Q4 is the one genuinely interpretive check.** The algorithm clusters prior highs
   into a level and tests for break-then-hold, but a reasonable human read may differ.
   It's flagged GUESS for that reason — confirm it.
6. **Not financial advice.** A faithful implementation of one method, for your own
   decision-making.

---

## Swapping the data source (if needed)

In `api/analyze.js`, replace the body of `fetchCandles(ticker)` to return:
```js
{ candles: { open:[], high:[], low:[], close:[], volume:[] },  // oldest → newest
  lastDate, currency, exchange, name }
```
Everything downstream stays the same.
