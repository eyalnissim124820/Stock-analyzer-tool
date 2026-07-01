// ─────────────────────────────────────────────────────────────
// tests/tase.test.js — Israeli-market lookup layer tests.
//   node tests/tase.test.js
//
// Network is mocked (see _mock.js). Covers: classification/pass-through,
// static number + Hebrew/English name resolution, the live TASE + Yahoo
// search fallbacks, error behavior, and end-to-end handler runs for both
// /api/analyze and /api/strategy with Israeli inputs.
// ─────────────────────────────────────────────────────────────
const assert = require("assert");
const { installFetchStub, runHandler } = require("./_mock.js");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { failures.push({ name, e }); console.error(`FAIL  ${name}\n      ${e.message}`); }
}

(async () => {
  // Default stub: TASE endpoints 404 unless a test overrides; charts synthetic.
  let taseFixture = null;   // set per-test: url → json
  let searchFixture = null; // set per-test: url → json
  const calls = installFetchStub((url) => {
    if (/tase\.co\.il/.test(url)) return taseFixture ? taseFixture(url) : { __status: 404, body: {} };
    if (/\/v1\/finance\/search/.test(url)) return searchFixture ? searchFixture(url) : { quotes: [] };
    return undefined; // fall through to the synthetic chart fixture
  });

  const { resolveTase, _internal } = require("../api/_tase.js");
  const analyze = require("../api/analyze.js");
  const strategy = require("../api/strategy.js");

  // ── classification / pass-through (the zero-regression contract) ──
  await test("US inputs never engage the layer", async () => {
    assert.strictEqual(await resolveTase("AAPL", "US"), null);
    assert.strictEqual(await resolveTase("629014", "US"), null); // numeric but US toggle → untouched
    assert.strictEqual(await resolveTase("BRK-B", "US"), null);
  });
  await test("plain Latin TLV symbols pass through unchanged", async () => {
    assert.strictEqual(await resolveTase("TEVA", "TLV"), null);
    assert.strictEqual(await resolveTase("TEVA.TA", "TLV"), null);
    assert.strictEqual(await resolveTase("poli", "TLV"), null);
  });

  // ── static map: security numbers ──
  await test("security number → symbol (static)", async () => {
    const r = await resolveTase("629014", "TLV");
    assert.strictEqual(r.symbol, "TEVA.TA");
    assert.strictEqual(r.source, "static");
  });
  await test("number with .TA suffix and leading zeros still resolves", async () => {
    assert.strictEqual((await resolveTase("629014.TA", "TLV")).symbol, "TEVA.TA");
    assert.strictEqual((await resolveTase("0662577", "TLV")).symbol, "POLI.TA");
  });

  // ── static map: Hebrew + English names ──
  await test("Hebrew names resolve (even with US toggle)", async () => {
    assert.strictEqual((await resolveTase("טבע", "TLV")).symbol, "TEVA.TA");
    assert.strictEqual((await resolveTase("טבע", "US")).symbol, "TEVA.TA");
    assert.strictEqual((await resolveTase("בנק הפועלים", "TLV")).symbol, "POLI.TA");
    assert.strictEqual((await resolveTase("הפועלים", "TLV")).symbol, "POLI.TA");
    assert.strictEqual((await resolveTase("בנק לאומי.TA", "TLV")).symbol, "LUMI.TA");
    assert.strictEqual((await resolveTase("אלביט מערכות", "TLV")).symbol, "ESLT.TA");
    assert.strictEqual((await resolveTase("מזרחי טפחות", "TLV")).symbol, "MZTF.TA");
    assert.strictEqual((await resolveTase("אל על", "TLV")).symbol, "ELAL.TA");
    assert.strictEqual((await resolveTase('שיכון ובינוי', "TLV")).symbol, "SKBN.TA");
  });
  await test("multi-word English names resolve on TLV", async () => {
    assert.strictEqual((await resolveTase("BANK LEUMI", "TLV")).symbol, "LUMI.TA");
    assert.strictEqual((await resolveTase("EL AL", "TLV")).symbol, "ELAL.TA");
  });
  await test("gershayim/quotes are normalized", async () => {
    assert.strictEqual((await resolveTase('טבע בע"מ', "TLV")).symbol, "TEVA.TA");
  });

  // ── live fallbacks ──
  await test("unknown number → TASE website JSON → symbol", async () => {
    taseFixture = (url) =>
      /securityId=1234567/.test(url)
        ? { SecurityMainData: { Id: 1234567, Symbol: "FAKE", SecurityLongName: "Fake Industries" } }
        : { __status: 404, body: {} };
    const r = await resolveTase("1234567", "TLV");
    assert.strictEqual(r.symbol, "FAKE.TA");
    assert.strictEqual(r.source, "tase");
    assert.strictEqual(r.name, "Fake Industries");
    taseFixture = null;
  });
  await test("unknown number, TASE down → Yahoo search fallback", async () => {
    searchFixture = () => ({ quotes: [{ symbol: "FKB.TA", quoteType: "EQUITY", shortname: "Fake Two" }] });
    const r = await resolveTase("7654321", "TLV");
    assert.strictEqual(r.symbol, "FKB.TA");
    assert.strictEqual(r.source, "yahoo-search");
    searchFixture = null;
  });
  await test("unknown number, everything down → null (legacy <id>.TA path)", async () => {
    assert.strictEqual(await resolveTase("9999999", "TLV"), null);
  });
  await test("unknown name → Yahoo search, .TA results only, equities preferred", async () => {
    searchFixture = (url) => /finance\/search/.test(url)
      ? { quotes: [
          { symbol: "SPEW", quoteType: "EQUITY", exchange: "NYQ", shortname: "US decoy" },
          { symbol: "SPEN.TA", quoteType: "EQUITY", exchange: "TLV", longname: "Shapir Engineering" },
        ] }
      : undefined;
    const r = await resolveTase("שפיר", "TLV");
    assert.strictEqual(r.symbol, "SPEN.TA");
    assert.strictEqual(r.name, "Shapir Engineering");
    searchFixture = null;
  });
  await test("unknown name, nothing found anywhere → clear bilingual error", async () => {
    await assert.rejects(() => resolveTase("חברה שלא קיימת", "TLV"), /No Tel Aviv security matched|לא נמצא/);
  });
  await test("results are cached (second hit makes no network calls)", async () => {
    const before = calls.length;
    await resolveTase("629014", "TLV");
    assert.strictEqual(calls.length, before);
  });

  // ── end-to-end through the real handlers ──
  await test("/api/analyze with a security number returns a full analysis", async () => {
    const res = await runHandler(analyze, { ticker: "629014", market: "TLV", timeframe: "Weekly", swingN: "2" });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ticker, "TEVA.TA");
    assert.strictEqual(res.body.market, "TLV");
    assert.ok(res.body.checks && res.body.conclusion && res.body.candles.close.length > 30);
  });
  await test("/api/analyze with a Hebrew name returns a full analysis", async () => {
    const res = await runHandler(analyze, { ticker: "בנק הפועלים.TA", market: "TLV", timeframe: "Daily", swingN: "2", lang: "he" });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ticker, "POLI.TA");
  });
  await test("/api/analyze failed textual lookup → clean 502 with guidance", async () => {
    const res = await runHandler(analyze, { ticker: "מניה מומצאת", market: "TLV" });
    assert.strictEqual(res.statusCode, 502);
    assert.match(res.body.error, /No Tel Aviv security matched/);
  });
  await test("/api/strategy with a security number runs the cascade", async () => {
    const res = await runHandler(strategy, { ticker: "604611", market: "TLV", technique: "1", swingN: "2" });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ticker, "LUMI.TA");
    assert.ok(res.body.conclusion && res.body.checks);
  });
  await test("/api/strategy with a Hebrew name (single timeframe)", async () => {
    const res = await runHandler(strategy, { ticker: "אלביט מערכות", market: "TLV", technique: "2", timeframe: "Weekly", lang: "he" });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ticker, "ESLT.TA");
  });
  await test("/api/analyze US ticker still bypasses the layer entirely", async () => {
    const before = calls.filter((u) => /tase|search/.test(u)).length;
    const res = await runHandler(analyze, { ticker: "AAPL", market: "US", timeframe: "Weekly", swingN: "2" });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ticker, "AAPL");
    assert.strictEqual(calls.filter((u) => /tase|search/.test(u)).length, before);
  });

  // ── internals sanity ──
  await test("normName strips gershayim, dots, בעמ/Ltd", () => {
    assert.strictEqual(_internal.normName('בנק הפועלים בע"מ'), "בנק הפועלים");
    assert.strictEqual(_internal.normName("Teva Pharmaceutical Ltd."), "teva pharmaceutical");
  });

  console.log(failures.length ? `\n${passed} passed, ${failures.length} FAILED` : `\nALL ${passed} TESTS PASSED`);
  process.exit(failures.length ? 1 : 0);
})();
