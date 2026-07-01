// ─────────────────────────────────────────────────────────────
// _tase.js — Israeli-market (TASE) lookup layer.
//
// The Yahoo data layer stays the single source of candles; this module only
// RESOLVES Israeli inputs into the ".TA" Yahoo symbol that layer already
// understands. It adds two input shapes on top of the existing symbol flow:
//
//   • numeric TASE security numbers  — "629014"       → TEVA.TA
//   • textual names, Hebrew/English  — "טבע", "bank leumi" → TEVA.TA / LUMI.TA
//
// resolveTase() returns null for every input the original flow already
// handles (all US-market inputs, and plain Latin symbols on TLV), so the
// existing behavior is byte-identical for those — the callers fall through
// to their own untouched normalizeTicker() path.
//
// Resolution chain (first hit wins), 100% free, no keys:
//   1. curated static map of large TASE securities (offline, instant)
//   2. numeric  → TASE's own public website JSON endpoints (unofficial)
//   3. textual  → Yahoo's public search endpoint (unofficial), filtered to .TA
//   4. numeric that still failed falls through to the legacy "<id>.TA" fetch,
//      textual that failed throws a clear bilingual error.
// ─────────────────────────────────────────────────────────────

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  "Accept": "application/json",
};

// ── curated static map ──────────────────────────────────────
// Large/liquid TASE securities so the common cases resolve instantly and
// offline. `id` is the TASE security number (מספר נייר); omitted where not
// verified — those names still resolve by symbol, and unknown numbers go to
// the live TASE lookup instead. Aliases are matched after normalization
// (quotes/gershayim/dots stripped), so "בנק הפועלים" and "הפועלים" both hit.
const TASE_SECURITIES = [
  { id: "629014",  symbol: "TEVA",  en: "Teva Pharmaceutical Industries", he: "טבע", aliases: ["טבע תעשיות", "teva"] },
  { id: "662577",  symbol: "POLI",  en: "Bank Hapoalim", he: "בנק הפועלים", aliases: ["הפועלים", "פועלים", "hapoalim"] },
  { id: "604611",  symbol: "LUMI",  en: "Bank Leumi", he: "בנק לאומי", aliases: ["לאומי", "leumi"] },
  { id: "691212",  symbol: "DSCT",  en: "Israel Discount Bank", he: "בנק דיסקונט", aliases: ["דיסקונט", "discount bank"] },
  { id: "695437",  symbol: "MZTF",  en: "Mizrahi Tefahot Bank", he: "מזרחי טפחות", aliases: ["מזרחי", "טפחות", "mizrahi"] },
  { id: "593038",  symbol: "FIBI",  en: "First International Bank of Israel", he: "הבינלאומי", aliases: ["בינלאומי", "בנק בינלאומי"] },
  { id: "1081124", symbol: "ESLT",  en: "Elbit Systems", he: "אלביט מערכות", aliases: ["אלביט", "elbit"] },
  { id: "273011",  symbol: "NICE",  en: "NICE Ltd", he: "נייס", aliases: [] },
  { id: "281014",  symbol: "ICL",   en: "ICL Group", he: "איי.סי.אל", aliases: ["כיל", "icl group"] },
  { id: "1082379", symbol: "TSEM",  en: "Tower Semiconductor", he: "טאואר", aliases: ["טאואר סמיקונדקטור", "tower"] },
  { id: "230011",  symbol: "BEZQ",  en: "Bezeq", he: "בזק", aliases: [] },
  { id: "1119478", symbol: "AZRG",  en: "Azrieli Group", he: "עזריאלי", aliases: ["קבוצת עזריאלי", "azrieli"] },
  { id: "767012",  symbol: "PHOE",  en: "The Phoenix Holdings", he: "הפניקס", aliases: ["פניקס", "phoenix"] },
  { id: "1087824", symbol: "ELAL",  en: "El Al Israel Airlines", he: "אל על", aliases: ["אל-על", "el al"] },
  { id: "746016",  symbol: "STRS",  en: "Strauss Group", he: "שטראוס", aliases: ["strauss"] },
  { id: "777037",  symbol: "SAE",   en: "Shufersal", he: "שופרסל", aliases: [] },
  { id: "1084128", symbol: "DLEKG", en: "Delek Group", he: "דלק קבוצה", aliases: ["קבוצת דלק", "דלק", "delek"] },
  { id: "323014",  symbol: "MLSR",  en: "Melisron", he: "מליסרון", aliases: [] },
  { id: "1097278", symbol: "AMOT",  en: "Amot Investments", he: "אמות", aliases: [] },
  { id: "2590248", symbol: "ORL",   en: "Bazan Oil Refineries", he: "בזן", aliases: ["בתי זיקוק", "bazan"] },
  { id: "1083484", symbol: "PTNR",  en: "Partner Communications", he: "פרטנר", aliases: ["partner"] },
  { id: "1101534", symbol: "CEL",   en: "Cellcom Israel", he: "סלקום", aliases: ["cellcom"] },
  { id: "445015",  symbol: "MTRX",  en: "Matrix IT", he: "מטריקס", aliases: ["matrix"] },
  { id: "1084698", symbol: "HLAN",  en: "Hilan", he: "חילן", aliases: [] },
  { id: "1087659", symbol: "SPNS",  en: "Sapiens International", he: "ספיינס", aliases: ["sapiens"] },
  { id: "1095264", symbol: "CAMT",  en: "Camtek", he: "קמטק", aliases: [] },
  { id: "1081942", symbol: "SKBN",  en: "Shikun & Binui", he: "שיכון ובינוי", aliases: ["שיכון בינוי"] },
  { id: "720011",  symbol: "ENLT",  en: "Enlight Renewable Energy", he: "אנלייט", aliases: ["אנלייט אנרגיה", "enlight"] },
  { id: "390013",  symbol: "ALHE",  en: "Alony Hetz", he: "אלוני חץ", aliases: ["אלוני-חץ"] },
  { id: "576017",  symbol: "ILCO",  en: "Israel Corporation", he: "החברה לישראל", aliases: [] },
  // symbol/name certain, security number intentionally left to live lookup
  { symbol: "NVMI", en: "Nova", he: "נובה", aliases: ["נובה מכשירי מדידה", "nova"] },
  { symbol: "MGDL", en: "Migdal Insurance", he: "מגדל ביטוח", aliases: ["מגדל"] },
  { symbol: "CLIS", en: "Clal Insurance", he: "כלל ביטוח", aliases: ["כלל עסקי ביטוח"] },
  { symbol: "HARL", en: "Harel Insurance", he: "הראל", aliases: ["הראל ביטוח", "harel"] },
  { symbol: "BIG",  en: "Big Shopping Centers", he: "ביג", aliases: ["ביג מרכזי קניות"] },
  { symbol: "ISCD", en: "Isracard", he: "ישראכרט", aliases: [] },
  { symbol: "FTAL", en: "Fattal Holdings", he: "פתאל", aliases: ["פתאל החזקות", "fattal"] },
  { symbol: "MMHD", en: "Menora Mivtachim", he: "מנורה מבטחים", aliases: ["מנורה"] },
];

// ── input classification ────────────────────────────────────
const stripTA = (s) => String(s || "").trim().replace(/\.TA$/i, "");
const hasHebrew = (s) => /[֐-׿]/.test(s);
const isNumericId = (s) => /^\d{3,8}$/.test(s);
// What the original flow already accepts: a plain Latin ticker, no spaces.
const isPlainSymbol = (s) => /^[A-Za-z][A-Za-z0-9.\-]{0,11}$/.test(s);

// Normalize a name for matching: lowercase, strip gershayim/quotes/dots/
// hyphens and the בע"מ / Ltd suffix, collapse whitespace. Suffixes are
// filtered token-by-token because \b doesn't work with Hebrew letters.
const NAME_STOPWORDS = new Set(["בעמ", "ltd", "inc", "corp", "corporation", "group"]);
function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/["'׳״`”“]/g, "")
    .replace(/[.\-_/]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !NAME_STOPWORDS.has(w))
    .join(" ");
}

// ── static lookups ──────────────────────────────────────────
function staticById(id) {
  const clean = id.replace(/^0+/, "");
  return TASE_SECURITIES.find((r) => r.id && r.id.replace(/^0+/, "") === clean) || null;
}

function staticByName(query) {
  const q = normName(query);
  if (q.length < 2) return null;
  let best = null, bestScore = 0;
  for (const r of TASE_SECURITIES) {
    const keys = [r.symbol, r.en, r.he, ...(r.aliases || [])].map(normName);
    let score = 0;
    for (const k of keys) {
      if (!k) continue;
      if (k === q) score = Math.max(score, 3);
      else if (k.startsWith(q) || q.startsWith(k)) score = Math.max(score, 2);
      else if (q.length >= 3 && (k.includes(q) || q.includes(k))) score = Math.max(score, 1);
    }
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return bestScore >= 2 || (bestScore === 1 && q.length >= 4) ? best : null;
}

// ── live lookups (unofficial but free, mirroring what the sites' own
//    front-ends call; every failure is swallowed so the chain continues) ──

async function fetchJson(url, headers, timeoutMs = 6000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Depth-first scan for the first key matching `keyRe` whose string value
// matches `valRe`. TASE's JSON shapes differ per endpoint/version, so we
// search rather than hard-code a path.
function deepFind(obj, keyRe, valRe, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return null;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && keyRe.test(k) && valRe.test(v.trim())) return v.trim();
    if (v && typeof v === "object") {
      const hit = deepFind(v, keyRe, valRe, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

// TASE security number → symbol via the exchange's public website JSON.
async function taseById(id) {
  const headers = {
    ...BROWSER_HEADERS,
    "Referer": "https://www.tase.co.il/",
    "Origin": "https://www.tase.co.il",
    "Accept-Language": "en-US,en;q=0.9,he;q=0.8",
    "X-Maya-With": "allow", // required by the maya API variant, ignored by the rest
  };
  const candidates = [
    `https://api.tase.co.il/api/security/securitydata?securityId=${id}&lang=1`,
    `https://api.tase.co.il/api/company/securitydata?securityId=${id}&lang=1`,
    `https://mayaapi.tase.co.il/api/company/securitydata?securityId=${id}`,
  ];
  for (const url of candidates) {
    const json = await fetchJson(url, headers);
    if (!json) continue;
    const symbol = deepFind(json, /symbol/i, /^[A-Za-z][A-Za-z0-9.]{1,9}$/);
    if (symbol) {
      const name =
        deepFind(json, /(securitylongname|companyname|securityname|name)/i, /\S{2,}/) || null;
      return { symbol: symbol.toUpperCase(), name };
    }
  }
  return null;
}

// Name (Hebrew or English) → symbol via Yahoo's public search endpoint,
// filtered to Tel Aviv listings. Hebrew queries also try the he-IL locale.
async function yahooSearch(query, { hebrew }) {
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  const locales = hebrew ? ["&lang=he-IL&region=IL", ""] : ["", "&lang=he-IL&region=IL"];
  for (const host of hosts) {
    for (const loc of locales) {
      const url =
        `https://${host}/v1/finance/search?q=${encodeURIComponent(query)}` +
        `&quotesCount=10&newsCount=0&listsCount=0&enableFuzzyQuery=true${loc}`;
      const json = await fetchJson(url, BROWSER_HEADERS);
      const quotes = (json && json.quotes) || [];
      const ta = quotes.filter(
        (q) => typeof q.symbol === "string" &&
          (q.symbol.toUpperCase().endsWith(".TA") || q.exchange === "TLV")
      );
      if (!ta.length) continue;
      // Prefer equities/ETFs; otherwise take Yahoo's top-ranked TA match.
      const pick =
        ta.find((q) => q.quoteType === "EQUITY") ||
        ta.find((q) => q.quoteType === "ETF") ||
        ta[0];
      const symbol = pick.symbol.toUpperCase().endsWith(".TA")
        ? pick.symbol.toUpperCase()
        : `${pick.symbol.toUpperCase()}.TA`;
      return { symbol, name: pick.longname || pick.shortname || null };
    }
  }
  return null;
}

// ── the public resolver ─────────────────────────────────────
// Cache survives warm serverless invocations; keys are market-scoped.
const cache = new Map();

/**
 * Resolve an Israeli input (numeric security number, Hebrew name, or
 * multi-word English name) to `{ symbol: "XXXX.TA", name, source }`.
 * Returns null whenever the ORIGINAL flow should handle the input —
 * that covers every US-market input and plain Latin TLV symbols —
 * so existing behavior is untouched. Throws only for textual Israeli
 * lookups that found nothing anywhere.
 */
async function resolveTase(rawTicker, market) {
  const stripped = stripTA(rawTicker);
  const hebrew = hasHebrew(stripped);

  // Israeli scenarios are: anything containing Hebrew (whatever the market
  // toggle says), or numbers/names when the TLV market is selected.
  if (!hebrew && market !== "TLV") return null;
  if (!hebrew && market === "TLV" && isPlainSymbol(stripped) && !isNumericId(stripped)) return null;
  if (!stripped) return null;

  const key = `TLV:${stripped.toLowerCase()}`;
  if (cache.has(key)) return cache.get(key);

  let out = null;
  if (isNumericId(stripped)) {
    const hit = staticById(stripped);
    if (hit) out = { symbol: `${hit.symbol}.TA`, name: hit.en, source: "static" };
    if (!out) {
      const live = await taseById(stripped.replace(/^0+/, ""));
      if (live) out = { symbol: `${live.symbol}.TA`, name: live.name, source: "tase" };
    }
    if (!out) {
      const ys = await yahooSearch(stripped, { hebrew: false });
      if (ys) out = { ...ys, source: "yahoo-search" };
    }
    // Still nothing: return null so the legacy "<id>.TA" fetch gets its
    // chance (some instruments trade on Yahoo under the number itself).
  } else {
    const hit = staticByName(stripped);
    if (hit) out = { symbol: `${hit.symbol}.TA`, name: hit.en, source: "static" };
    if (!out) {
      const ys = await yahooSearch(stripped, { hebrew });
      if (ys) out = { ...ys, source: "yahoo-search" };
    }
    if (!out) {
      throw new Error(
        `No Tel Aviv security matched "${stripped}" — try the TASE symbol (e.g. TEVA) or the security number (e.g. 629014). ` +
        `לא נמצא נייר ערך בת"א שתואם ל"${stripped}" — נסו את הסימול או את מספר הנייר.`
      );
    }
  }

  if (out) cache.set(key, out);
  return out;
}

module.exports = { resolveTase, _internal: { staticById, staticByName, normName, isNumericId, hasHebrew, isPlainSymbol, stripTA, deepFind, cache } };
