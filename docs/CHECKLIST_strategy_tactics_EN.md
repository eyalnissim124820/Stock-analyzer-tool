# Sequence Method — Strategy & Tactics Checklist (EN)

> **Purpose of this file:** authoritative reference for the *decision logic* of the
> Sequence Method, written for Claude Code to implement or verify against. It is the
> "what the method decides and in what order" spec. Thresholds and branch logic are
> explicit. Where the tool currently differs, that is a gap to reconcile — do not
> silently reinterpret a rule to match existing code.

## Method boundary (hard rule)
Use ONLY these inputs: candles, two moving averages (trend pair) + MA5, volume,
CCI(5), Bollinger Bands, and sequence/peak-trough structure. **Never** add RSI,
MACD, Fibonacci, news, earnings, or sentiment. The method is the boundary.

## Shape of the decision
The method is two-phase, then two gating checks:
`Strategy (should we buy?) → choose Tactic (how to enter) → Correction Check → Timing Check`.

Overriding principles that wrap the whole flow:
- **Market-first gate.** Before evaluating any single stock, assess the broad market
  (quarterly chart / leading indices). If the market is topping/falling: no entry, or
  "pointwise only" (small, short-term, easy to exit). A per-stock buy signal in a
  falling market is void.
- **Instant-yes / 3-second rule.** Every Strategy answer must be an immediate yes.
  Borderline or requires-deliberation ⇒ treat as **no**. (Implementation: borderline
  results should fail, not pass; surface low confidence rather than rounding up.)
- **No partial compliance.** All Strategy conditions must hold. Never pass on a subset.

---

## STEP 1 — STRATEGY ("what to do")
Run on the **monthly** chart, ~5 years of history (for Technique 1). All must be YES.

- **S1. Direction:** peaks (highs/extremes) AND troughs are both in a rising structure.
- **S2. Volume:** trading volume rising OR at least static. Objective test when unclear:
  a **moving average of volume** (short MA of volume) sloping up or flat.
- **S3. Moving-average momentum (trend pair = 20/40; long = 2× short). Three sub-checks:**
  - **S3a.** short MA (20) is **above** long MA (40).
  - **S3b.** long MA (40) slopes up, slope **growing or at least equal** (not flattening into decline).
  - **S3c.** gap between the two MAs is **widening or at least equal** (not contracting).
- **S4. Support/resistance:** the last significant resistance broken to the upside has
  since acted as **support**. Measured on a **closing basis** (not highs/lows).

**Verdict:** all YES ⇒ "we want to buy." Proceed to choose a timeframe + tactic.
Any NO ⇒ stop; no trade.

---

## STEP 2 — TACTIC ("what and how"): choose ONE

### Technique 1 — Multi-timeframe cascade (monthly → weekly → daily)
Walk down timeframes; the level where a falling sequence appears sets the trade horizon.

1. Strategy passed on the **monthly**.
2. **Falling sequence on the monthly?**
   - YES ⇒ **long-term** trade; stay on monthly.
   - NO  ⇒ drop to **weekly**; re-verify S1 (peak/trough) and S4 (S/R→support) there.
3. **Falling sequence on the weekly?**
   - YES ⇒ **medium-term** trade; stay on weekly.
   - NO  ⇒ drop to **daily**; find the falling-sequence break there ⇒ **short-term** trade.
4. No valid setup on any timeframe ⇒ **no trade**.
   - (Documented rule-bend, NOT the method: add Bollinger, buy near the lower band.)

Character: very few mistakes; small losses when wrong; cost is effort + few trades.

### Technique 2 — Single timeframe + MA5 momentum gate
Pick ONE timeframe (daily/weekly/monthly); trade only it; ignore the others. To
compensate for dropping multi-timeframe confirmation, require stronger momentum:

- Same Strategy (S1–S4), all on a **closing basis**.
- Put **three** MAs on the chart: **5, 20, 40**. 20/40 read the trend; **5 reads corrections**.
- **Entry gate:** at the moment of purchase, **MA5 must remain above MA20** — the MA
  order (5 > 20 > 40) must not change through the correction.
  - Rationale: MA5 holding above MA20 across the correction ⇒ the correction produced
    no real downward pressure ⇒ momentum strong ⇒ high probability of continuation.

Character: simpler, fewer steps; for momentum-strong names. The MA5>MA20 gate is the
price you pay for using one timeframe.

---

## STEP 3 — CORRECTION CHECK
Evaluated just before the falling sequence breaks. All must hold:

- **C1.** A falling sequence sits **below MA5**, and MA5 is **sloping down**.
- **C2.** CCI(5) dropped to **≤ −100** (at least one candle below −100) during the correction.
  - Timing rule (from the method): the entry (Step 4) should occur **within ~3 candles**
    of CCI crossing below −100 (4 borderline). Stale oversold ⇒ skip.
- **C3.** At least one candle is **entirely below** the low of the **highest candle in
  the prior rising sequence**.

---

## STEP 4 — TIMING CHECK
- **T1.** Has the falling sequence **broken** (close above the high of the lowest
  candle of the falling sequence)?
  - Quality gate (method-critical): the newly formed trough must be **higher than the
    prior resistance (the prior peak)** — not merely higher than the prior trough.
    A break failing this is NOT a valid buy.
- **T2.** Risk/reward ratio. **If below 1.5 : 1 ⇒ do not enter (hard gate).**
  - Risk % = (buy − low)/buy × **1.5** (the 1.5 is the slippage coefficient).
    `low` = low (incl. tail) of the candle that broke the sequence.
  - Target = the **prior resistance / peak** ("up to the prior peak is yours; beyond is bonus").
  - Ratio = reward% / risk%; require ≥ 1.5.

---

## BUY TIMING (long-term) — three options
- **A.** Limit order at **mid-candle** [(high+low)/2], valid **one month**, set to the
  price giving a **≥ 1.5 : 1** ratio.
- **B.** Drop to the **daily** and buy the **next falling-sequence break** (act now).
- **C.** **Half and half** — split between A and B.
- Avoid pre-market / after-market for these entries (unreliable fills).

## POSITION MANAGEMENT (after entry)
- **Risk-zero trigger:** a green candle **entirely above a rising MA5** ⇒ risk ≈ 0 ⇒
  this is the cue to add the next position.
- Only add the next position **after** the previous one has cleared the risk zone.

## SELL SIGNALS (exit) — any one triggers
- **Break of a rising sequence** (close below the low of the highest candle in the
  rising sequence) ⇒ sell, no discretion. (This is exit signal #1.)
- **Red candle above the upper Bollinger band** (upmove ending red) ⇒ weakness.
- **Seller candle after a rise, above the band** (small body low, upper tail ≥ 2× body).

---

## Implementation notes for Claude Code
- The four Strategy MA checks (S3a–c) are a **three-question 20/40 triad**, not a single
  "alignment" boolean. Keep them distinct so a failure points to the specific cause.
- The **MA5>MA20 entry gate** (Technique 2) and the **T1 quality gate** (new trough >
  prior peak) and the **T2 hard 1.5 ratio** are the three rules most often missing from
  naive implementations. Treat them as required.
- The cascade (Technique 1) needs **monthly/weekly/daily** data — the data layer must be
  able to request different intervals, not just daily.
- "Closing basis" for S1/S4 means peaks, troughs, and S/R levels are computed on
  **close** prices, not on highs/lows.
- Borderline results should **fail** (3-second rule), surfaced as low confidence — do not
  round up to a pass.

*Source: course sessions (the Sequence Method). For personal use; not investment advice.*
