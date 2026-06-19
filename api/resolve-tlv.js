// ─────────────────────────────────────────────────────────────
// /api/resolve-tlv — resolves a TASE paper number (מספר נייר) to a
// Yahoo Finance ticker symbol.
//
// GET /api/resolve-tlv?code=1081124
// → { ticker: "ESLT", name: "Elbit Systems" }
//
// Strategy (in order):
//   1. TASE public API with browser-like headers + Referer
//   2. Yahoo Finance search as fallback
// ─────────────────────────────────────────────────────────────

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9,he;q=0.8",
};

async function tryTaseApi(paperNumber) {
  const url = `https://api.tase.co.il/api/security/securities?code=${paperNumber}&lang=en`;
  const res = await fetch(url, {
    headers: {
      ...BROWSER_HEADERS,
      Referer: "https://www.tase.co.il/",
      Origin: "https://www.tase.co.il",
    },
  });
  if (!res.ok) throw new Error(`TASE API responded ${res.status}`);
  const data = await res.json();

  // Handle both array and object response shapes
  const sec = Array.isArray(data) ? data[0] : data?.security ?? data;
  if (!sec) throw new Error("Empty TASE response");

  // Try multiple field name conventions
  const ticker = (
    sec.stockCode ||
    sec.securityCode ||
    sec.ticker ||
    sec.symbol ||
    ""
  )
    .trim()
    .toUpperCase();
  if (!ticker) throw new Error("Ticker field missing in TASE response");

  const name =
    sec.nameEng ||
    sec.shortNameEng ||
    sec.companyNameEng ||
    sec.nameHeb ||
    sec.name ||
    ticker;
  return { ticker, name };
}

async function tryYahooSearch(paperNumber) {
  const url =
    `https://query1.finance.yahoo.com/v1/finance/search` +
    `?q=${encodeURIComponent(paperNumber)}&newsCount=0&listsCount=0&quotesCount=10`;
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`Yahoo search responded ${res.status}`);
  const data = await res.json();

  const quotes = data?.quotes || [];
  const tlvQuote = quotes.find(
    (q) => q.exchange === "TLV" || String(q.symbol || "").endsWith(".TA")
  );
  if (!tlvQuote) throw new Error("No TLV stock found via Yahoo search");

  const ticker = String(tlvQuote.symbol || "")
    .replace(/\.TA$/i, "")
    .toUpperCase();
  if (!ticker) throw new Error("Invalid symbol in Yahoo search response");

  const name = tlvQuote.longname || tlvQuote.shortname || ticker;
  return { ticker, name };
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "s-maxage=3600"); // 1-hour CDN cache
  const { code } = req.query || {};
  if (!code || !/^\d{5,9}$/.test(String(code))) {
    return res
      .status(400)
      .json({ error: "Invalid paper number — expected 5–9 digits" });
  }

  // Try TASE API first
  try {
    const result = await tryTaseApi(code);
    return res.status(200).json(result);
  } catch (_) {
    // Fall through to Yahoo search
  }

  // Try Yahoo Finance search
  try {
    const result = await tryYahooSearch(code);
    return res.status(200).json(result);
  } catch (_) {
    return res.status(502).json({
      error: `Could not resolve paper number ${code}. Try entering the ticker symbol directly (e.g. ESLT for אלביט מערכות).`,
    });
  }
};
