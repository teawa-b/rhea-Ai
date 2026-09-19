/* Rhea — company + country registry.
 *
 * DUPLICATED in frontend/shared/ and backend/shared/ (they deploy separately).
 * If you edit this file, copy it to the other folder too.
 *
 * COMPANIES is built from the FULL xStocks catalog (xstocks-catalog.ts, ~830
 * products) so every tokenized equity the issuer has minted on Solana is known
 * to the app. CURATED below overlays real-world metadata — ticker, country,
 * sector, headquarters coordinates — so the globe can place a company at its
 * HQ; uncurated catalog entries fall back to a heuristic country + centroid.
 * Prices, availability and asset counts are NEVER taken from here — they come
 * from live Jupiter / Pyth data at runtime (spec §3.1). Only tokens with
 * onchain liquidity >= MIN_TRADABLE_LIQUIDITY_USD surface as tradable.
 *
 * `featured` companies are the polished set that get a hero marker in the
 * country view (spec §3.3: "a limited set of polished company locations").
 */
import type { Company, CompanyWrapper, CountryCode, IssuerKey } from "./types";
import { XSTOCKS_CATALOG } from "./xstocks-catalog";

/** A token is "tradable" only when Jupiter reports at least this much onchain
 *  liquidity. Below ~$100 a swap of any size slips badly or fails to route.
 *  Drives globe visibility; the trade gate is MIN_TRADE_LIQUIDITY_USD. */
export const MIN_TRADABLE_LIQUIDITY_USD = 100;

/** Buys and limit orders are refused below this onchain liquidity: thin pools
 *  quote fine but fill far from the 4pm close. Sells stay allowed so nobody is
 *  trapped in a position. */
export const MIN_TRADE_LIQUIDITY_USD = 25_000;

export type CountryDef = { code: CountryCode; name: string; lat: number; lng: number; demonym?: string };

export const COUNTRIES: Record<CountryCode, CountryDef> = {
  US: { code: "US", name: "United States", lat: 39.5, lng: -98.4 },
  CN: { code: "CN", name: "China", lat: 35.9, lng: 104.2 },
  HK: { code: "HK", name: "Hong Kong", lat: 22.32, lng: 114.17 },
  TW: { code: "TW", name: "Taiwan", lat: 23.7, lng: 121.0 },
  GB: { code: "GB", name: "United Kingdom", lat: 54.0, lng: -2.5 },
  JP: { code: "JP", name: "Japan", lat: 36.2, lng: 138.3 },
  DK: { code: "DK", name: "Denmark", lat: 56.0, lng: 10.0 },
  NL: { code: "NL", name: "Netherlands", lat: 52.2, lng: 5.3 },
  DE: { code: "DE", name: "Germany", lat: 51.2, lng: 10.4 },
  FR: { code: "FR", name: "France", lat: 46.6, lng: 2.4 },
  CH: { code: "CH", name: "Switzerland", lat: 46.8, lng: 8.2 },
  KR: { code: "KR", name: "South Korea", lat: 36.5, lng: 127.9 },
  IN: { code: "IN", name: "India", lat: 21.0, lng: 78.9 },
  CA: { code: "CA", name: "Canada", lat: 56.1, lng: -106.3 },
  AU: { code: "AU", name: "Australia", lat: -25.3, lng: 133.8 },
  SG: { code: "SG", name: "Singapore", lat: 1.35, lng: 103.8 },
  IE: { code: "IE", name: "Ireland", lat: 53.4, lng: -8.2 },
  IT: { code: "IT", name: "Italy", lat: 41.9, lng: 12.6 },
};

/* Numeric ISO 3166-1 ids used by world-atlas topojson → our codes. */
export const ISO_NUMERIC_TO_CODE: Record<string, CountryCode> = {
  "840": "US", "156": "CN", "344": "HK", "158": "TW", "826": "GB", "392": "JP",
  "208": "DK", "528": "NL", "276": "DE", "250": "FR", "756": "CH", "410": "KR",
  "356": "IN", "124": "CA", "036": "AU", "702": "SG", "372": "IE", "380": "IT",
};

/* Tessera T-Token mints. Seeds only — the live catalog in backend/src/tessera.ts
 * refreshes them, and every price, mark and count is fetched at runtime. */
export const TESSERA_MINTS = {
  tOpenAI: "oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ",
  tKalshi: "TKLSidmLVt3cqGaaodG8tyRzoANfQwoh67AccjmubeZ",
  tSpaceX: "TSPXcLV76s6V2zDiZQ18kBfcbnjaE2ZzNT3ga2Pd99v",
} as const;

const c = (
  id: string, name: string, ticker: string, countryCode: CountryCode, sector: string,
  tokenSymbol: string, hq: { name: string; lat: number; lng: number } | undefined,
  extra: Partial<Company> = {},
): Company => ({ id, name, ticker, countryCode, sector, tokenSymbol, headquarters: hq, ...extra });

/* Curated overlay, keyed by tokenSymbol when merged with the catalog. Keep the
 * ids stable — they are persisted in saved agent rules and used by aliases. */
const CURATED: Company[] = [
  /* ---------------- United States (featured) ---------------- */
  c("nvidia", "NVIDIA", "NVDA", "US", "Semiconductors", "NVDAx",
    { name: "Santa Clara, California", lat: 37.3708, lng: -121.9691 }, { featured: true, pythSymbol: "Equity.US.NVDA/USD" }),
  c("apple", "Apple", "AAPL", "US", "Consumer Electronics", "AAPLx",
    { name: "Cupertino, California", lat: 37.3349, lng: -122.0090 }, { featured: true, pythSymbol: "Equity.US.AAPL/USD" }),
  c("tesla", "Tesla", "TSLA", "US", "Automotive / Energy", "TSLAx",
    { name: "Austin, Texas", lat: 30.2227, lng: -97.6178 }, { featured: true, pythSymbol: "Equity.US.TSLA/USD" }),
  c("microsoft", "Microsoft", "MSFT", "US", "Software / Cloud", "MSFTx",
    { name: "Redmond, Washington", lat: 47.6423, lng: -122.1391 }, { featured: true, pythSymbol: "Equity.US.MSFT/USD" }),
  c("amd", "AMD", "AMD", "US", "Semiconductors", "AMDx",
    { name: "Santa Clara, California", lat: 37.3841, lng: -121.9762 }, { featured: true, pythSymbol: "Equity.US.AMD/USD" }),
  c("alphabet", "Alphabet", "GOOGL", "US", "Internet / AI", "GOOGLx",
    { name: "Mountain View, California", lat: 37.4220, lng: -122.0841 }, { featured: true, pythSymbol: "Equity.US.GOOGL/USD" }),
  c("meta", "Meta Platforms", "META", "US", "Social / AI", "METAx",
    { name: "Menlo Park, California", lat: 37.4850, lng: -122.1483 }, { pythSymbol: "Equity.US.META/USD" }),
  c("amazon", "Amazon", "AMZN", "US", "E-commerce / Cloud", "AMZNx",
    { name: "Seattle, Washington", lat: 47.6225, lng: -122.3365 }, { pythSymbol: "Equity.US.AMZN/USD" }),
  c("coinbase", "Coinbase", "COIN", "US", "Crypto Exchange", "COINx",
    { name: "Remote-first (San Francisco)", lat: 37.7749, lng: -122.4194 }, { pythSymbol: "Equity.US.COIN/USD" }),
  c("microstrategy", "Strategy (MicroStrategy)", "MSTR", "US", "Software / Bitcoin Treasury", "MSTRx",
    { name: "Tysons Corner, Virginia", lat: 38.9187, lng: -77.2311 }, { pythSymbol: "Equity.US.MSTR/USD" }),
  c("palantir", "Palantir", "PLTR", "US", "Data / Defense Software", "PLTRx",
    { name: "Denver, Colorado", lat: 39.7392, lng: -104.9903 }, { pythSymbol: "Equity.US.PLTR/USD" }),
  c("broadcom", "Broadcom", "AVGO", "US", "Semiconductors", "AVGOx",
    { name: "Palo Alto, California", lat: 37.4419, lng: -122.1430 }, { pythSymbol: "Equity.US.AVGO/USD" }),
  c("intel", "Intel", "INTC", "US", "Semiconductors", "INTCx",
    { name: "Santa Clara, California", lat: 37.3875, lng: -121.9636 }),
  c("micron", "Micron Technology", "MU", "US", "Memory Semiconductors", "MUx",
    { name: "Boise, Idaho", lat: 43.5158, lng: -116.1120 }),
  c("marvell", "Marvell", "MRVL", "US", "Semiconductors", "MRVLx",
    { name: "Santa Clara, California", lat: 37.3899, lng: -121.9654 }),
  c("netflix", "Netflix", "NFLX", "US", "Streaming", "NFLXx",
    { name: "Los Gatos, California", lat: 37.2586, lng: -121.9633 }),
  c("oracle", "Oracle", "ORCL", "US", "Software / Cloud", "ORCLx",
    { name: "Austin, Texas", lat: 30.2672, lng: -97.7431 }),
  c("jpmorgan", "JPMorgan Chase", "JPM", "US", "Banking", "JPMx",
    { name: "New York, New York", lat: 40.7557, lng: -73.9757 }),
  c("berkshire", "Berkshire Hathaway", "BRK.B", "US", "Conglomerate", "BRK.Bx",
    { name: "Omaha, Nebraska", lat: 41.2565, lng: -95.9345 }, { yahooSymbol: "BRK-B" }),
  c("eli-lilly", "Eli Lilly", "LLY", "US", "Pharmaceuticals", "LLYx",
    { name: "Indianapolis, Indiana", lat: 39.7684, lng: -86.1581 }),
  c("jnj", "Johnson & Johnson", "JNJ", "US", "Healthcare", "JNJx",
    { name: "New Brunswick, New Jersey", lat: 40.4862, lng: -74.4518 }),
  c("unitedhealth", "UnitedHealth", "UNH", "US", "Health Insurance", "UNHx",
    { name: "Minnetonka, Minnesota", lat: 44.9133, lng: -93.5030 }),
  c("visa", "Visa", "V", "US", "Payments", "Vx",
    { name: "San Francisco, California", lat: 37.7895, lng: -122.3898 }),
  c("mastercard", "Mastercard", "MA", "US", "Payments", "MAx",
    { name: "Purchase, New York", lat: 41.0416, lng: -73.7146 }),
  c("walmart", "Walmart", "WMT", "US", "Retail", "WMTx",
    { name: "Bentonville, Arkansas", lat: 36.3729, lng: -94.2088 }),
  c("exxon", "Exxon Mobil", "XOM", "US", "Energy", "XOMx",
    { name: "Spring, Texas", lat: 30.0800, lng: -95.4180 }),
  c("chevron", "Chevron", "CVX", "US", "Energy", "CVXx",
    { name: "Houston, Texas", lat: 29.7604, lng: -95.3698 }),
  c("coca-cola", "Coca-Cola", "KO", "US", "Beverages", "KOx",
    { name: "Atlanta, Georgia", lat: 33.7710, lng: -84.3960 }),
  c("pepsico", "PepsiCo", "PEP", "US", "Beverages / Snacks", "PEPx",
    { name: "Purchase, New York", lat: 41.0434, lng: -73.7120 }),
  c("mcdonalds", "McDonald's", "MCD", "US", "Restaurants", "MCDx",
    { name: "Chicago, Illinois", lat: 41.8843, lng: -87.6483 }),
  c("robinhood", "Robinhood", "HOOD", "US", "Brokerage", "HOODx",
    { name: "Menlo Park, California", lat: 37.4529, lng: -122.1817 }),
  c("circle", "Circle", "CRCL", "US", "Stablecoins", "CRCLx",
    { name: "New York, New York", lat: 40.7069, lng: -74.0113 }),
  c("uber", "Uber", "UBER", "US", "Mobility", "UBERx",
    { name: "San Francisco, California", lat: 37.7752, lng: -122.3934 }),
  c("salesforce", "Salesforce", "CRM", "US", "Software", "CRMx",
    { name: "San Francisco, California", lat: 37.7897, lng: -122.3972 }),
  c("cisco", "Cisco", "CSCO", "US", "Networking", "CSCOx",
    { name: "San Jose, California", lat: 37.4085, lng: -121.9530 }),
  c("gamestop", "GameStop", "GME", "US", "Retail", "GMEx",
    { name: "Grapevine, Texas", lat: 32.9343, lng: -97.0781 }),
  c("coreweave", "CoreWeave", "CRWV", "US", "AI Cloud", "CRWVx",
    { name: "Livingston, New Jersey", lat: 40.7959, lng: -74.3149 }),
  c("applovin", "AppLovin", "APP", "US", "Ad-tech", "APPx",
    { name: "Palo Alto, California", lat: 37.4419, lng: -122.1430 }),
  /* Two issuers wrap SpaceX: Backed's SPCXx (primary) and Tessera's tSpaceX,
   * priced side by side in the company panel.
   *
   * Not flagged `private` even though the company is: SPCX is quoted, so the
   * primary wrapper has a real equity reference and a real 4pm close, and
   * suppressing them would throw away accurate data. The T-Token is still
   * priced against Tessera's mark, because that branch keys off the asset's
   * issuer rather than the company. */
  c("spacex", "SpaceX", "SPCX", "US", "Aerospace", "SPCXx",
    { name: "Starbase, Texas", lat: 25.9972, lng: -97.1560 },
    { wrappers: [{ issuerKey: "tessera", tokenSymbol: "tSpaceX", mint: TESSERA_MINTS.tSpaceX }] }),
  c("sp500", "S&P 500 ETF", "SPY", "US", "Index Fund", "SPYx", undefined),
  c("nasdaq100", "Nasdaq-100 ETF", "QQQ", "US", "Index Fund", "QQQx", undefined),
  c("gold", "Gold Trust", "GLD", "US", "Commodity Fund", "GLDx", undefined),

  /* ---------------- Taiwan ---------------- */
  c("tsmc", "TSMC", "TSM", "TW", "Semiconductor Foundry", "TSMx",
    { name: "Hsinchu Science Park", lat: 24.7796, lng: 121.0053 }, { featured: true, pythSymbol: "Equity.US.TSM/USD" }),

  /* ---------------- United Kingdom ---------------- */
  c("astrazeneca", "AstraZeneca", "AZN", "GB", "Pharmaceuticals", "AZNx",
    { name: "Cambridge, England", lat: 52.2011, lng: 0.1325 }, { featured: true }),
  c("arm", "Arm Holdings", "ARM", "GB", "Semiconductor IP", "ARMx",
    { name: "Cambridge, England", lat: 52.2103, lng: 0.1181 }, { featured: true }),

  /* ---------------- Netherlands ---------------- */
  c("asml", "ASML", "ASML", "NL", "Lithography Equipment", "ASMLx",
    { name: "Veldhoven", lat: 51.4106, lng: 5.4030 }, { featured: true }),

  /* ---------------- Denmark ---------------- */
  c("novo-nordisk", "Novo Nordisk", "NVO", "DK", "Pharmaceuticals", "NVOx",
    { name: "Bagsværd, Copenhagen", lat: 55.7624, lng: 12.4486 }, { featured: true }),

  /* ---------------- China / Hong Kong (HK-listed xStocks) ---------------- */
  c("tencent", "Tencent", "0700.HK", "CN", "Internet / Gaming", "TCENTx",
    { name: "Shenzhen, Guangdong", lat: 22.5303, lng: 113.9394 }, { featured: true, yahooSymbol: "0700.HK" }),
  c("xiaomi", "Xiaomi", "1810.HK", "CN", "Consumer Electronics / EV", "XIAOx",
    { name: "Beijing", lat: 40.0598, lng: 116.3175 }, { featured: true, yahooSymbol: "1810.HK" }),
  c("byd", "BYD", "1211.HK", "CN", "Electric Vehicles", "BYDCOx",
    { name: "Shenzhen, Guangdong", lat: 22.6742, lng: 114.0625 }, { featured: true, yahooSymbol: "1211.HK" }),
  c("meituan", "Meituan", "3690.HK", "CN", "Local Services", "MEITx",
    { name: "Beijing", lat: 39.9998, lng: 116.4778 }, { yahooSymbol: "3690.HK" }),
  c("kuaishou", "Kuaishou", "1024.HK", "CN", "Short Video", "KUAIx",
    { name: "Beijing", lat: 40.0300, lng: 116.3400 }, { yahooSymbol: "1024.HK" }),
  c("geely", "Geely Automobile", "0175.HK", "CN", "Automotive", "GEELx",
    { name: "Hangzhou, Zhejiang", lat: 30.2741, lng: 120.1551 }, { yahooSymbol: "0175.HK" }),
  c("anta", "ANTA Sports", "2020.HK", "CN", "Sportswear", "ANTASx",
    { name: "Jinjiang, Fujian", lat: 24.7813, lng: 118.5521 }, { yahooSymbol: "2020.HK" }),
  c("icbc", "ICBC", "1398.HK", "CN", "Banking", "ICBCx",
    { name: "Beijing", lat: 39.9075, lng: 116.3790 }, { yahooSymbol: "1398.HK" }),
  c("ccb", "China Construction Bank", "0939.HK", "CN", "Banking", "CCONBx",
    { name: "Beijing", lat: 39.9153, lng: 116.4128 }, { yahooSymbol: "0939.HK" }),
  c("ping-an", "Ping An Insurance", "2318.HK", "CN", "Insurance", "PICOx",
    { name: "Shenzhen, Guangdong", lat: 22.5350, lng: 114.0550 }, { yahooSymbol: "2318.HK" }),
  c("sunny-optical", "Sunny Optical", "2382.HK", "CN", "Optics", "SUOPTx",
    { name: "Yuyao, Zhejiang", lat: 30.0370, lng: 121.1540 }, { yahooSymbol: "2382.HK" }),
  c("sino-biopharm", "Sino Biopharmaceutical", "1177.HK", "CN", "Pharmaceuticals", "SNBIOx",
    { name: "Beijing", lat: 39.9000, lng: 116.4000 }, { yahooSymbol: "1177.HK" }),
  c("cspc", "CSPC Pharmaceutical", "1093.HK", "CN", "Pharmaceuticals", "CSPCx",
    { name: "Shijiazhuang, Hebei", lat: 38.0428, lng: 114.5149 }, { yahooSymbol: "1093.HK" }),
  c("cr-beer", "China Resources Beer", "0291.HK", "CN", "Beverages", "CRESBx",
    { name: "Beijing", lat: 39.9100, lng: 116.4200 }, { yahooSymbol: "0291.HK" }),
  c("hkex", "Hong Kong Exchanges", "0388.HK", "HK", "Exchange", "HKEXCx",
    { name: "Central, Hong Kong", lat: 22.2830, lng: 114.1588 }, { featured: true, yahooSymbol: "0388.HK" }),
  c("aia", "AIA Group", "1299.HK", "HK", "Insurance", "AIAGRx",
    { name: "Central, Hong Kong", lat: 22.2809, lng: 114.1614 }, { yahooSymbol: "1299.HK" }),
  c("boc-hk", "BOC Hong Kong", "2388.HK", "HK", "Banking", "BOCHKx",
    { name: "Central, Hong Kong", lat: 22.2795, lng: 114.1616 }, { yahooSymbol: "2388.HK" }),
  c("hk-china-gas", "Hong Kong & China Gas", "0003.HK", "HK", "Utilities", "HKCGAx",
    { name: "North Point, Hong Kong", lat: 22.2900, lng: 114.2000 }, { yahooSymbol: "0003.HK" }),
  c("wharf", "The Wharf Holdings", "0004.HK", "HK", "Property", "WRFHDx",
    { name: "Tsim Sha Tsui, Hong Kong", lat: 22.2950, lng: 114.1690 }, { yahooSymbol: "0004.HK" }),
  /* ---------------- Added 14 Sep 2026: liquid on Jupiter but previously uncurated ---------------- */
  c("strategy-strc", "Strategy STRC Preferred", "STRC", "US", "Preferred Stock / Bitcoin Treasury", "STRCx",
    { name: "Tysons Corner, Virginia", lat: 38.9187, lng: -77.2311 }),
  c("defi-development", "DeFi Development Corp", "DFDV", "US", "Solana Treasury", "DFDVx",
    { name: "Boca Raton, Florida", lat: 26.3683, lng: -80.1289 }),
  c("tqqq", "ProShares UltraPro QQQ", "TQQQ", "US", "Leveraged Index Fund", "TQQQx", undefined),
  c("constellation-energy", "Constellation Energy", "CEG", "US", "Nuclear / Utilities", "CEGx",
    { name: "Baltimore, Maryland", lat: 39.2904, lng: -76.6122 }),
  c("bitmine", "Bitmine Immersion", "BMNR", "US", "Ethereum Treasury / Mining", "BMNRx",
    { name: "Las Vegas, Nevada", lat: 36.1699, lng: -115.1398 }),
  c("ibm", "IBM", "IBM", "US", "Enterprise IT", "IBMx",
    { name: "Armonk, New York", lat: 41.1265, lng: -73.7140 }, { pythSymbol: "Equity.US.IBM/USD" }),
  c("procter-gamble", "Procter & Gamble", "PG", "US", "Consumer Goods", "PGx",
    { name: "Cincinnati, Ohio", lat: 39.1031, lng: -84.5120 }),
  c("vti", "Vanguard Total Stock Market ETF", "VTI", "US", "Index Fund", "VTIx", undefined),
  c("linde", "Linde", "LIN", "GB", "Industrial Gases", "LINx",
    { name: "Woking, England", lat: 51.3168, lng: -0.5600 }),
  c("bank-of-america", "Bank of America", "BAC", "US", "Banking", "BACx",
    { name: "Charlotte, North Carolina", lat: 35.2271, lng: -80.8431 }),
  c("comcast", "Comcast", "CMCSA", "US", "Media / Telecom", "CMCSAx",
    { name: "Philadelphia, Pennsylvania", lat: 39.9526, lng: -75.1652 }),
  c("sk-hynix", "SK hynix", "000660.KS", "KR", "Memory Semiconductors", "SKHYx",
    { name: "Icheon, South Korea", lat: 37.2720, lng: 127.4350 }),
  c("amber", "Amber International", "AMBR", "SG", "Crypto Finance", "AMBRx",
    { name: "Singapore", lat: 1.2897, lng: 103.8501 }),
  c("abbott", "Abbott", "ABT", "US", "Healthcare", "ABTx",
    { name: "Abbott Park, Illinois", lat: 42.3061, lng: -87.9052 }),
  c("xle", "Energy Select Sector SPDR", "XLE", "US", "Sector Fund", "XLEx", undefined),
  c("sandisk", "Sandisk", "SNDK", "US", "Flash Memory", "SNDKx",
    { name: "Milpitas, California", lat: 37.4323, lng: -121.8996 }),
  c("pfizer", "Pfizer", "PFE", "US", "Pharmaceuticals", "PFEx",
    { name: "New York, New York", lat: 40.7505, lng: -73.9934 }),
  c("honeywell", "Honeywell", "HON", "US", "Industrial Conglomerate", "HONx",
    { name: "Charlotte, North Carolina", lat: 35.2271, lng: -80.8431 }),
  c("iwm", "iShares Russell 2000 ETF", "IWM", "US", "Index Fund", "IWMx", undefined),
  c("vt", "Vanguard Total World ETF", "VT", "US", "Index Fund", "VTx", undefined),
  c("goldman-sachs", "Goldman Sachs", "GS", "US", "Investment Banking", "GSx",
    { name: "New York, New York", lat: 40.7148, lng: -74.0142 }),
  c("philip-morris", "Philip Morris International", "PM", "US", "Tobacco", "PMx",
    { name: "Stamford, Connecticut", lat: 41.0534, lng: -73.5387 }),
  c("accenture", "Accenture", "ACN", "IE", "IT Consulting", "ACNx",
    { name: "Dublin, Ireland", lat: 53.3498, lng: -6.2603 }),
  c("merck", "Merck", "MRK", "US", "Pharmaceuticals", "MRKx",
    { name: "Rahway, New Jersey", lat: 40.6082, lng: -74.2776 }),
  c("ast-spacemobile", "AST SpaceMobile", "ASTS", "US", "Satellite Telecom", "ASTSx",
    { name: "Midland, Texas", lat: 31.9973, lng: -102.0779 }),
  c("sharplink", "SharpLink Gaming", "SBET", "US", "Ethereum Treasury", "SBETx",
    { name: "Minneapolis, Minnesota", lat: 44.9778, lng: -93.2650 }),
  c("thermo-fisher", "Thermo Fisher Scientific", "TMO", "US", "Life Sciences", "TMOx",
    { name: "Waltham, Massachusetts", lat: 42.3765, lng: -71.2356 }),
  c("crowdstrike", "CrowdStrike", "CRWD", "US", "Cybersecurity", "CRWDx",
    { name: "Austin, Texas", lat: 30.2672, lng: -97.7431 }),
  c("riot", "Riot Platforms", "RIOT", "US", "Bitcoin Mining", "RIOTx",
    { name: "Castle Rock, Colorado", lat: 39.3722, lng: -104.8561 }),
  c("ura", "Global X Uranium ETF", "URA", "US", "Sector Fund", "URAx", undefined),
  c("schf", "Schwab International Equity ETF", "SCHF", "US", "Index Fund", "SCHFx", undefined),
  c("ijr", "iShares Core S&P Small-Cap ETF", "IJR", "US", "Index Fund", "IJRx", undefined),
  c("bending-spoons", "Bending Spoons", "BSP", "IT", "Software (private)", "BSPx",
    { name: "Milan, Italy", lat: 45.4642, lng: 9.1900 }),
  c("abbvie", "AbbVie", "ABBV", "US", "Pharmaceuticals", "ABBVx",
    { name: "North Chicago, Illinois", lat: 42.3256, lng: -87.8412 }),
  c("adobe", "Adobe", "ADBE", "US", "Software", "ADBEx",
    { name: "San Jose, California", lat: 37.3307, lng: -121.8942 }),
  c("energy-fuels", "Energy Fuels", "UUUU", "US", "Uranium Mining", "UUUUx",
    { name: "Lakewood, Colorado", lat: 39.7047, lng: -105.0814 }),
  c("fundrise-innovation", "Fundrise Innovation Fund", "VCX", "US", "Venture Fund", "VCXx", undefined),
  c("slv", "iShares Silver Trust", "SLV", "US", "Commodity Fund", "SLVx", undefined),
];


/* ---------------- Private (pre-IPO) companies ----------------
 *
 * These are NOT in the xStocks catalog: the companies are private, so no
 * exchange lists them and Backed has no tracker certificate for two of the
 * three. Tessera wraps them as T-Tokens on Solana instead, and Rhea places them
 * on the globe at their real headquarters like any other company.
 *
 * The mints below are seeds so the globe still renders when Tessera's API is
 * unreachable. What is actually shown — marks, valuations, holders, which
 * markets are live — always comes from the live issuer API at runtime
 * (backend/src/tessera.ts); nothing here is a price.
 */
/* `private` marks a company with no quoted instrument anywhere, which is what
 * switches off the equity machinery: no session, no close to gap against, and
 * no Pyth or Yahoo lookup — querying an equity feed for an unlisted company
 * returns someone else's stock. Verified per company: OPENAI and KALSHI resolve
 * to nothing on Yahoo, while SpaceX's SPCX is quoted and so is not flagged.
 * `ticker` carries the name a person would actually say. */
const PRIVATE_COMPANIES: Company[] = [
  c("openai", "OpenAI", "OPENAI", "US", "Artificial Intelligence", "tOpenAI",
    { name: "Mission Bay, San Francisco", lat: 37.7679, lng: -122.3915 },
    { featured: true, private: true, issuerKey: "tessera", seedMint: TESSERA_MINTS.tOpenAI }),
  c("kalshi", "Kalshi", "KALSHI", "US", "Prediction Markets", "tKalshi",
    { name: "New York, New York", lat: 40.7411, lng: -74.0059 },
    { featured: true, private: true, issuerKey: "tessera", seedMint: TESSERA_MINTS.tKalshi }),
];

/* ---------------- Build COMPANIES from the catalog ---------------- */

const CURATED_BY_TOKEN = new Map(CURATED.map((co) => [co.tokenSymbol.toUpperCase(), co]));

/* Uncurated entries use the issuer's listing country (the exchange the
 * underlying trades on). Only countries we can draw get a pin; anything else
 * (or unset) sits in the US bucket until someone curates it. */
const listingCountry = (c: string | null): CountryCode => (c && c in COUNTRIES ? (c as CountryCode) : "US");

export const COMPANIES: Company[] = XSTOCKS_CATALOG.map((entry): Company => {
  const cur = CURATED_BY_TOKEN.get(entry.symbol.toUpperCase());
  if (cur) return { ...cur, seedMint: entry.mint, icon: entry.icon };
  return {
    id: entry.slug,
    name: entry.name,
    ticker: entry.ticker,
    countryCode: listingCountry(entry.country),
    sector: entry.fund ? "Fund" : entry.exchange ? `Equity · ${entry.exchange}` : "Equity",
    tokenSymbol: entry.symbol,
    seedMint: entry.mint,
    icon: entry.icon,
  };
}).concat(PRIVATE_COMPANIES);

export const COMPANY_BY_ID = Object.fromEntries(COMPANIES.map((co) => [co.id, co])) as Record<string, Company>;
/* Primary wrappers first, then secondary ones — a company's own tokenSymbol
 * always wins, so "SPCXx" and "tSpaceX" both resolve to SpaceX without a
 * secondary wrapper ever shadowing another company's primary token. */
export const COMPANY_BY_TOKEN = (() => {
  const m: Record<string, Company> = {};
  for (const co of COMPANIES) for (const w of co.wrappers ?? []) m[w.tokenSymbol.toUpperCase()] = co;
  for (const co of COMPANIES) m[co.tokenSymbol.toUpperCase()] = co;
  return m;
})();

/** Every tokenized wrapper of a company, primary first. */
export function wrappersFor(co: Company): CompanyWrapper[] {
  return [
    { issuerKey: co.issuerKey ?? "xstocks", tokenSymbol: co.tokenSymbol, mint: co.seedMint ?? "" },
    ...(co.wrappers ?? []),
  ];
}

/** Stable asset id: the primary wrapper keeps the historical `id:solana` form
 *  so saved orders and cached state stay valid. */
export function assetIdFor(companyId: string, issuerKey: IssuerKey, primary: boolean): string {
  return primary ? `${companyId}:solana` : `${companyId}:solana:${issuerKey}`;
}

/* Loose matching used by the AI tools: "nvidia", "NVDA", "NVDAx", "Nvidia Corp".
 * Exact matches first; fuzzy matches only on whole words so "China" never
 * resolves to "China Construction Bank". */
export function resolveCompany(query: string): Company | undefined {
  const q = query.trim().toLowerCase().replace(/[.,!?]+$/g, "");
  if (!q) return undefined;
  const exact =
    COMPANY_BY_ID[q] ||
    COMPANIES.find((co) => co.ticker.toLowerCase() === q) ||
    COMPANIES.find((co) => co.tokenSymbol.toLowerCase() === q) ||
    COMPANIES.find((co) => co.name.toLowerCase() === q) ||
    COMPANIES.find((co) => co.id.replace(/-/g, " ") === q);
  if (exact) return exact;
  const alias = COMPANY_ALIASES[q];
  if (alias) return COMPANY_BY_ID[alias];
  /* Never treat a country name as a company. */
  if (COUNTRY_WORDS.has(q)) return undefined;
  const words = q.split(/\s+/).filter((w) => w.length > 1);
  const firstWord = (co: Company) => co.name.toLowerCase().split(/\s+/)[0];
  return (
    COMPANIES.find((co) => co.name.toLowerCase().startsWith(q) && q.length >= 4 && !COUNTRY_WORDS.has(q)) ||
    COMPANIES.find((co) => words.includes(firstWord(co)) && firstWord(co).length > 3 && !COUNTRY_WORDS.has(firstWord(co))) ||
    COMPANIES.find((co) => words.includes(co.ticker.toLowerCase()) && co.ticker.length >= 3)
  );
}

const COMPANY_ALIASES: Record<string, string> = {
  "taiwan semiconductor": "tsmc", "taiwan semi": "tsmc", google: "alphabet", facebook: "meta", strategy: "microstrategy",
  "s&p 500": "sp500", "s&p": "sp500", spy: "sp500", "sp500": "sp500", nasdaq: "nasdaq100", "nasdaq 100": "nasdaq100", qqq: "nasdaq100",
  "berkshire hathaway": "berkshire", "jp morgan": "jpmorgan", "j&j": "jnj", "johnson and johnson": "jnj", coke: "coca-cola", pepsi: "pepsico",
  "mcdonald's": "mcdonalds", "mcdonalds": "mcdonalds", exxonmobil: "exxon", lilly: "eli-lilly", "eli lilly": "eli-lilly", "gold trust": "gold",
  "novo": "novo-nordisk", astra: "astrazeneca", "arm holdings": "arm", "hong kong exchanges": "hkex", "hkex": "hkex", "spacex": "spacex",
  "united health": "unitedhealth", "space x": "spacex", "core weave": "coreweave", "app lovin": "applovin", "micron": "micron",
  "p&g": "procter-gamble", "procter and gamble": "procter-gamble", "bofa": "bank-of-america", "bank of america": "bank-of-america",
  "open ai": "openai", openai: "openai", chatgpt: "openai", "kalshi": "kalshi",
  "goldman": "goldman-sachs", "strc": "strategy-strc", "dfdv": "defi-development", "defi dev": "defi-development", "russell 2000": "iwm",
};

const COUNTRY_WORDS = new Set(["usa", "united states", "america", "us", "u.s.", "china", "prc", "hong kong", "hk", "taiwan", "uk", "united kingdom", "britain", "england", "japan", "denmark", "netherlands", "holland", "germany", "france", "switzerland", "korea", "south korea", "india", "canada", "australia", "singapore", "ireland", "italy"]);

export function resolveCountry(query: string): CountryDef | undefined {
  const q = query.trim().toLowerCase();
  if (!q) return undefined;
  const byCode = (COUNTRIES as Record<string, CountryDef>)[q.toUpperCase()];
  if (byCode) return byCode;
  const aliases: Record<string, CountryCode> = {
    usa: "US", "united states": "US", america: "US", "u.s.": "US", us: "US",
    china: "CN", prc: "CN", "hong kong": "HK", hk: "HK", taiwan: "TW",
    uk: "GB", "united kingdom": "GB", britain: "GB", england: "GB",
    japan: "JP", denmark: "DK", netherlands: "NL", holland: "NL", germany: "DE",
    france: "FR", switzerland: "CH", korea: "KR", "south korea": "KR", india: "IN",
    canada: "CA", australia: "AU", singapore: "SG", ireland: "IE", italy: "IT",
  };
  const code = aliases[q];
  if (code) return COUNTRIES[code];
  return Object.values(COUNTRIES).find((cd) => cd.name.toLowerCase().includes(q));
}

/* ---- Compliance capability table (spec §15). ----
 * Restricted list per the issuer's distribution terms (Kraken/Bybit xStocks FAQs
 * list US, UK, Canada and Australia). The check is self-declared, not KYC. */
export const XSTOCKS_DISCLOSURE_URL = "https://xstocks.com/";
export const XSTOCKS_RESTRICTED_JURISDICTIONS = ["US", "GB", "CA", "AU"];
export const XSTOCKS_MIN_TRADE_USD = 1;

/* ---- Tessera T-Tokens (private markets) ----
 * A T-Token is a loan participation right against a Tessera issuer entity, not
 * equity and not a security — the holder is repaid from the proceeds of a
 * qualifying liquidity event. Tessera's terms exclude several jurisdictions,
 * the United States and China among them. The check is self-declared, not KYC.
 * https://docs.tessera.pe/overview/how-do-tessera-token-work */
export const TESSERA_ISSUER = "Tessera (T-Tokens)";
export const TESSERA_DISCLOSURE_URL = "https://docs.tessera.pe/overview/how-do-tessera-token-work";
export const TESSERA_TERMS_URL = "https://terms.tessera.pe";
export const TESSERA_RESTRICTED_JURISDICTIONS = ["US", "CN"];
export const TESSERA_MIN_TRADE_USD = 1;
/** Jupiter Trigger V2 rejects deposits worth less than this (400 at deposit/craft). */
export const TRIGGER_MIN_ORDER_USD = 10;

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOL_MINT = "So11111111111111111111111111111111111111112";

/* ---- Token-2022 scaled-UI amounts (xStocks corporate actions) ----
 * An xStock balance onchain is a raw integer; wallets, RPC uiAmount and Jupiter
 * usdPrice all use UI units = raw / 10^decimals × multiplier. Jupiter swap and
 * trigger amounts (inAmount/outAmount/amount/inputAmount) are RAW, so convert at
 * that boundary only. The multiplier switches to newMultiplier once
 * newMultiplierEffectiveAt passes (verified: NVDAx RPC uiAmount/amount = newMultiplier). */
export type ScaledUiConfig = { multiplier: number; newMultiplier?: number; newMultiplierEffectiveAt?: string };

export function effectiveUiMultiplier(cfg: ScaledUiConfig | null | undefined, nowMs = Date.now()): number {
  if (!cfg || !(cfg.multiplier > 0)) return 1;
  const at = cfg.newMultiplierEffectiveAt ? Date.parse(cfg.newMultiplierEffectiveAt) : NaN;
  return cfg.newMultiplier && cfg.newMultiplier > 0 && Number.isFinite(at) && nowMs >= at ? cfg.newMultiplier : cfg.multiplier;
}

/** Raw base units (string or number) → UI amount. */
export function rawToUiAmount(raw: string | number | bigint, decimals: number, multiplier = 1): number {
  return (Number(raw) / 10 ** decimals) * multiplier;
}

/** UI amount → raw base units as a string. Floors, so selling a full displayed
 *  balance never asks for one raw unit more than the wallet holds. */
export function uiToRawAmount(ui: number, decimals: number, multiplier = 1): string {
  /* The tiny relative nudge absorbs float error (19.99 × 1e6 = 19989999.999999996). */
  return BigInt(Math.max(0, Math.floor((ui / (multiplier || 1)) * 10 ** decimals * (1 + 1e-14)))).toString();
}
