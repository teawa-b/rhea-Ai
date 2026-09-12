/* Rhea — curated company + country registry.
 *
 * The registry maps tokenized equities (xStocks on Solana) to real-world
 * companies, sectors, countries and headquarters coordinates so the globe can
 * place them. Prices, availability and asset counts are NEVER taken from here
 * — they come from live Jupiter / Pyth data at runtime (spec §3.1).
 *
 * `featured` companies are the polished set that get a hero marker in the
 * country view (spec §3.3: "a limited set of polished company locations").
 */
import type { Company, CountryCode } from "./types";

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
};

/* Numeric ISO 3166-1 ids used by world-atlas topojson → our codes. */
export const ISO_NUMERIC_TO_CODE: Record<string, CountryCode> = {
  "840": "US", "156": "CN", "344": "HK", "158": "TW", "826": "GB", "392": "JP",
  "208": "DK", "528": "NL", "276": "DE", "250": "FR", "756": "CH", "410": "KR",
  "356": "IN", "124": "CA", "036": "AU", "702": "SG", "372": "IE",
};

const c = (
  id: string, name: string, ticker: string, countryCode: CountryCode, sector: string,
  tokenSymbol: string, hq: { name: string; lat: number; lng: number } | undefined,
  extra: Partial<Company> = {},
): Company => ({ id, name, ticker, countryCode, sector, tokenSymbol, headquarters: hq, ...extra });

export const COMPANIES: Company[] = [
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
  c("spacex", "SpaceX", "SPCX", "US", "Aerospace (private)", "SPCXx",
    { name: "Starbase, Texas", lat: 25.9972, lng: -97.1560 }),
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
];


/* Known xStocks mints (Token-2022, 8 decimals) — verified live 12 Sep 2026. */
export const SEED_MINTS: Record<string, string> = {
  "NVDAx": "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
  "AAPLx": "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
  "TSLAx": "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
  "MSFTx": "XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX",
  "AMDx": "XsXcJ6GZ9kVnjqGsjBnktRcuwMBmvKWh8S93RefZ1rF",
  "GOOGLx": "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
  "METAx": "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
  "AMZNx": "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg",
  "COINx": "Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu",
  "MSTRx": "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ",
  "PLTRx": "XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4",
  "AVGOx": "XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo",
  "INTCx": "XshPgPdXFRWB8tP1j82rebb2Q9rPgGX37RuqzohmArM",
  "MUx": "XsQLZycSZ7QnBBdBXQaTbQdiUcbRqjNJgyBGAMzhHav",
  "MRVLx": "XsuxRGDzbLjnJ72v74b7p9VY6N66uYgTCyfwwRjVCJA",
  "NFLXx": "XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL",
  "ORCLx": "XsjFwUPiLofddX5cWFHW35GCbXcSu1BCUGfxoQAQjeL",
  "JPMx": "XsMAqkcKsUewDrzVkait4e5u4y8REgtyS7jWgCpLV2C",
  "BRK.Bx": "Xs6B6zawENwAbWVi7w92rjazLuAr5Az59qgWKcNb45x",
  "LLYx": "Xsnuv4omNoHozR6EEW5mXkw8Nrny5rB3jVfLqi6gKMH",
  "JNJx": "XsGVi5eo1Dh2zUpic4qACcjuWGjNv8GCt3dm5XcX6Dn",
  "UNHx": "XszvaiXGPwvk2nwb3o9C1CX4K6zH8sez11E6uyup6fe",
  "Vx": "XsqgsbXwWogGJsNcVZ3TyVouy2MbTkfCFhCGGGcQZ2p",
  "MAx": "XsApJFV9MAktqnAc6jqzsHVujxkGm9xcSUffaBoYLKC",
  "WMTx": "Xs151QeqTCiuKtinzfRATnUESM2xTU6V9Wy8Vy538ci",
  "XOMx": "XsaHND8sHyfMfsWPj6kSdd5VwvCayZvjYgKmmcNL5qh",
  "CVXx": "XsNNMt7WTNA2sV3jrb1NNfNgapxRF5i4i6GcnTRRHts",
  "KOx": "XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ",
  "PEPx": "Xsv99frTRUeornyvCfvhnDesQDWuvns1M852Pez91vF",
  "MCDx": "XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2",
  "HOODx": "XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg",
  "CRCLx": "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
  "UBERx": "XsAsZLF4MmsvS1sDxRMrUz7REjHfwbC9UAMXSRBqgEB",
  "CRMx": "XsczbcQ3zfcgAEt9qHQES8pxKAVG5rujPSHQEXi4kaN",
  "CSCOx": "Xsr3pdLQyXvDJBFgpR5nexCEZwXvigb8wbPYp4YoNFf",
  "GMEx": "Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc",
  "CRWVx": "Xs3trfdPXSZuxBJsgau6HRfu8SdrCirkwHpPNgSpJz9",
  "APPx": "XsPdAVBi8Zc1xvv53k4JcMrQaEDTgkGqKYeh7AYgPHV",
  "SPCXx": "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8",
  "SPYx": "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
  "QQQx": "Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ",
  "GLDx": "Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re",
  "TSMx": "XsafvsGtzFqqHgTnA3aPC83EAMkacU5mcGtcSayhpVV",
  "AZNx": "Xs3ZFkPYT2BN7qBMqf1j1bfTeTm1rFzEFSsQ1z3wAKU",
  "ARMx": "XswUFSYE5CWsZM3X3yo6e2pZvxcAzx912DonGvgUFka",
  "ASMLx": "XshuHQ6o6SVpUNawvnnTMxsZ4tacZsNgVCLorv7TkFq",
  "NVOx": "XsfAzPzYrYjd4Dpa9BU3cusBsvWfVB9gBcyGC87S57n",
  "TCENTx": "XsXb7KCxcxTi6hqWfYyEe1kpTwtiCeU5TJbEz8N7RWn",
  "XIAOx": "XsvP4b65AoC8f2hEuXj3yAKzRCLtW4aCQupZcuK1vAe",
  "BYDCOx": "Xsbcv5nSVTc5A7jRZNe2Sg6VtgCyyb32SC2nnaPK5MZ",
  "MEITx": "XsLvCfSnXJjoVaAJENHxKRzCZaWJpyVQQfJgkHp9oXM",
  "KUAIx": "XsD9Zgip86m52ob2c9MNTtDVoin1KmgdCNUCCDwsEPF",
  "GEELx": "XsxsXLryvGn9xUBvkzcjNLR9C1krKy8YEySN7yVEyme",
  "ANTASx": "XsdP2Pc9F6UsUujiydSsBGZGNYpDMivEjNfQ1ytHD1P",
  "ICBCx": "XswoSyxJ3NayixJFM4y7JUNL8CFDrL68oUw7nr3Kbnz",
  "CCONBx": "XsvPonyU9dZWsZsT2rJ1MBRAmPw8gMtS7M3ERko8XkK",
  "PICOx": "XsioL5whfekeqi92geGL9hqkDWJ2XuDbXDcmBkJktro",
  "SUOPTx": "XsVpajrhXA4CffEm652abYSS2iDiKnLnarPYxaokYis",
  "SNBIOx": "XsyeAGJ5CS1uDtDcnFaHTW3QCF5eL2CAt8vcrRBeAs5",
  "CSPCx": "Xs5hnQoLHnA2xeHaaxYGkCV2Kp12SwCEeCKBK7BW3gr",
  "CRESBx": "XsptDxuTbpFNx9vic5CMDRiGzPDhNDcVp2i9bUdTktn",
  "HKEXCx": "XsZQt7qW9vH5SWXZPsn1ZAybCSkq5MW2r6HGo891u1X",
  "AIAGRx": "XsQk7zRMNmbgSr4ZnvANH4enGH7zkUAtahKuckYy7x7",
  "BOCHKx": "XsdyyYJSCDVHBdAujSoWnQEDBQi9Y85YxoGVueJNf1j",
  "HKCGAx": "XsgLierNGzsEw1eziSPaKANRPfxXadZ6syo4WdGz2S7",
  "WRFHDx": "XsQqWNfMfAVg8hSfGMFzSvEfqwhid5qcZVmm6ny6g3a",
};

for (const co of COMPANIES) if (SEED_MINTS[co.tokenSymbol]) co.seedMint = SEED_MINTS[co.tokenSymbol];

export const COMPANY_BY_ID = Object.fromEntries(COMPANIES.map((co) => [co.id, co])) as Record<string, Company>;
export const COMPANY_BY_TOKEN = Object.fromEntries(COMPANIES.map((co) => [co.tokenSymbol.toUpperCase(), co])) as Record<string, Company>;

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
};

const COUNTRY_WORDS = new Set(["usa", "united states", "america", "us", "u.s.", "china", "prc", "hong kong", "hk", "taiwan", "uk", "united kingdom", "britain", "england", "japan", "denmark", "netherlands", "holland", "germany", "france", "switzerland", "korea", "south korea", "india", "canada", "australia", "singapore", "ireland"]);

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
    canada: "CA", australia: "AU", singapore: "SG", ireland: "IE",
  };
  const code = aliases[q];
  if (code) return COUNTRIES[code];
  return Object.values(COUNTRIES).find((cd) => cd.name.toLowerCase().includes(q));
}

/* ---- Compliance capability table (spec §15). ----
 * Illustrative, sourced from the issuer's public terms; the exact rules must be
 * confirmed with the issuer (xStocks / Backed) before production use. */
export const XSTOCKS_DISCLOSURE_URL = "https://xstocks.com/";
export const XSTOCKS_RESTRICTED_JURISDICTIONS = ["US", "CA", "GB"];
export const XSTOCKS_MIN_TRADE_USD = 1;

export const JURISDICTIONS: { code: string; name: string }[] = [
  { code: "CH", name: "Switzerland" }, { code: "DE", name: "Germany" }, { code: "FR", name: "France" },
  { code: "NL", name: "Netherlands" }, { code: "ES", name: "Spain" }, { code: "IT", name: "Italy" },
  { code: "AE", name: "United Arab Emirates" }, { code: "SG", name: "Singapore" }, { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" }, { code: "BR", name: "Brazil" }, { code: "AR", name: "Argentina" },
  { code: "MX", name: "Mexico" }, { code: "NG", name: "Nigeria" }, { code: "ZA", name: "South Africa" },
  { code: "IN", name: "India" }, { code: "TR", name: "Türkiye" }, { code: "AU", name: "Australia" },
  { code: "GB", name: "United Kingdom" }, { code: "CA", name: "Canada" }, { code: "US", name: "United States" },
];

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const SOL_MINT = "So11111111111111111111111111111111111111112";
