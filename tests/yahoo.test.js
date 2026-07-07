// ─────────────────────────────────────────────────────────────
// tests/yahoo.test.js — shared Yahoo data layer: TASE calendar aggregation.
//   node tests/yahoo.test.js
//
// TASE trades Sunday–Thursday; Yahoo's own 1wk bars are Monday-anchored and
// therefore build DIFFERENT weekly candles than the Israeli platforms. For
// .TA symbols fetchRaw must fetch dailies and aggregate them itself on the
// Israeli calendar. Exact expectations come from a hand-built two-week
// session tape served through the fetch stub.
// ─────────────────────────────────────────────────────────────
const assert = require("assert");
const { installFetchStub } = require("./_mock.js");
const { fetchRaw } = require("../api/_yahoo.js");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failures.push({ name, e }); console.error(`FAIL  ${name}\n      ${e.message}`); }
}

// Two Israeli weeks of TASE sessions (timestamps = 07:00 UTC ≈ 10:00 IDT,
// session start, like Yahoo's real .TA payloads):
//   Week 1: Sun 14/06/2026 … Thu 18/06/2026 (a full Sunday→Thursday week)
//   Week 2: Sun 21/06/2026 + Mon 22/06/2026 (partial)
const S = (y, mo, d) => Date.UTC(y, mo - 1, d, 7) / 1000;
const TAPE = {
  ts: [S(2026, 6, 14), S(2026, 6, 15), S(2026, 6, 16), S(2026, 6, 17), S(2026, 6, 18), S(2026, 6, 21), S(2026, 6, 22)],
  open:   [100, 104, 107, 102,  99, 109, 111],
  high:   [105, 108, 107.5, 103, 110, 112, 113],
  low:    [ 99, 103, 101,  98,  99, 108, 110],
  close:  [104, 107, 102,  99, 109, 111, 112],
  volume: [ 10,  20,  30,  40,  50,  60,  70],
};
function tapePayload() {
  return {
    chart: {
      result: [{
        timestamp: TAPE.ts,
        indicators: { quote: [{ open: TAPE.open, high: TAPE.high, low: TAPE.low, close: TAPE.close, volume: TAPE.volume }] },
        meta: { currency: "ILS", fullExchangeName: "Tel Aviv", longName: "Tape Test Co." },
      }],
    },
  };
}

(async () => {
  let calls = installFetchStub((url) => (url.includes("TAPE.TA") ? tapePayload() : undefined));

  await test("TASE weekly bars are Sunday→Thursday aggregates of the dailies", async () => {
    const d = await fetchRaw("TAPE.TA", "1wk", "1mo", { minBars: 2 });
    assert.ok(calls[calls.length - 1].includes("interval=1d"), "must fetch dailies for .TA weekly");
    const c = d.candles;
    assert.strictEqual(c.close.length, 2, `expected 2 weekly bars, got ${c.close.length}`);
    // Week 1 (Sun 14/06 → Thu 18/06): open of Sunday, close of Thursday,
    // extreme high/low across the week, summed volume, dated by its Thursday.
    assert.deepStrictEqual(
      { o: c.open[0], h: c.high[0], l: c.low[0], cl: c.close[0], v: c.volume[0], date: d.dates[0] },
      { o: 100, h: 110, l: 98, cl: 109, v: 150, date: "2026-06-18" }
    );
    // Week 2 (partial: Sun 21/06 + Mon 22/06), dated by its last session.
    assert.deepStrictEqual(
      { o: c.open[1], h: c.high[1], l: c.low[1], cl: c.close[1], v: c.volume[1], date: d.dates[1] },
      { o: 109, h: 113, l: 108, cl: 112, v: 130, date: "2026-06-22" }
    );
    assert.strictEqual(d.lastDate, "2026-06-22");
  });

  await test("TASE monthly bars are calendar-month aggregates of the dailies", async () => {
    const d = await fetchRaw("TAPE.TA", "1mo", "1mo", { minBars: 1 });
    assert.ok(calls[calls.length - 1].includes("interval=1d"), "must fetch dailies for .TA monthly");
    const c = d.candles;
    assert.strictEqual(c.close.length, 1);
    assert.deepStrictEqual(
      { o: c.open[0], h: c.high[0], l: c.low[0], cl: c.close[0], v: c.volume[0], date: d.dates[0] },
      { o: 100, h: 113, l: 98, cl: 112, v: 280, date: "2026-06-22" }
    );
  });

  await test("midnight-stamped sessions still group into their own Israeli week", async () => {
    // Yahoo stamps some daily bars at LOCAL midnight — the previous evening in
    // UTC (00:00 IDT = 21:00 UTC the day before) — and the live bar at quote
    // time. A UTC-date week key misfiles the Sunday session into the previous
    // week (the "split candle" bug); the Israel-calendar key must not.
    const MID = (y, mo, d) => Date.UTC(y, mo - 1, d, 21) / 1000 - 86400; // 00:00 IDT of that day
    const tape2 = {
      ...tapePayload(),
    };
    tape2.chart.result[0].timestamp = [
      MID(2026, 6, 14), MID(2026, 6, 15), MID(2026, 6, 16), MID(2026, 6, 17), MID(2026, 6, 18),
      MID(2026, 6, 21),
      Date.UTC(2026, 5, 22, 11, 4) / 1000, // live Mon 22/06 bar stamped at quote time
    ];
    const calls2 = installFetchStub((url) => (url.includes("MIDTAPE.TA") ? tape2 : undefined));
    const d = await fetchRaw("MIDTAPE.TA", "1wk", "1mo", { minBars: 2 });
    assert.ok(calls2[calls2.length - 1].includes("interval=1d"));
    const c = d.candles;
    assert.strictEqual(c.close.length, 2, `expected 2 weekly bars, got ${c.close.length} (${d.dates})`);
    assert.deepStrictEqual(
      { o: c.open[0], h: c.high[0], l: c.low[0], cl: c.close[0], v: c.volume[0], date: d.dates[0] },
      { o: 100, h: 110, l: 98, cl: 109, v: 150, date: "2026-06-18" }
    );
    assert.deepStrictEqual(
      { o: c.open[1], h: c.high[1], l: c.low[1], cl: c.close[1], v: c.volume[1], date: d.dates[1] },
      { o: 109, h: 113, l: 108, cl: 112, v: 130, date: "2026-06-22" }
    );
    calls = installFetchStub((url) => (url.includes("TAPE.TA") ? tapePayload() : undefined)); // restore
  });

  await test("TASE daily fetch is untouched (no aggregation)", async () => {
    const d = await fetchRaw("TAPE.TA", "1d", "1mo", { minBars: 2 });
    assert.ok(calls[calls.length - 1].includes("interval=1d"));
    assert.strictEqual(d.candles.close.length, 7);
    assert.deepStrictEqual(d.candles.close, TAPE.close);
  });

  await test("US weekly fetch passes through to Yahoo's own 1wk bars", async () => {
    const d = await fetchRaw("AAPL", "1wk", "1y");
    assert.ok(calls[calls.length - 1].includes("interval=1wk"), "US symbols keep Yahoo's weekly bars");
    assert.ok(d.candles.close.length >= 30);
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
