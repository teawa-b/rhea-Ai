/* Meteora Dynamic Bonding Curve — issuer tooling for tokenized equities.
 *
 * DBC is normally used to launch memecoins: the curve starts near zero and the
 * whole point is that nobody knows what the token is worth. A tokenized stock is
 * the opposite case. The asset already has a reference price — Pyth publishes
 * the underlying equity, and for a private company the issuer publishes a mark —
 * so a curve that starts at zero and runs a thousand x is not price discovery,
 * it is just a gift to whoever buys first.
 *
 * This module builds the curve that case actually wants: one anchored on the
 * reference price.
 *
 *   start ──(discovery)──> band low ══(anchor)══> band high ──(premium)──> migration
 *
 *   - discovery: thin liquidity from a launch discount up to the band, so the
 *     opening gap closes quickly instead of being farmed
 *   - anchor:    thick liquidity across a band around the reference price, so
 *     most of the raise happens near fair value and the price is sticky there
 *   - premium:   thin again above the band, so genuine demand can still revalue
 *     the token instead of hitting a wall
 *
 * The curve graduates into DAMM v2 at a price near the reference, which is the
 * point: the migrated pool opens at fair value rather than wherever a launch
 * spike happened to end.
 *
 * Everything here is read-only and deterministic. The module builds, validates
 * and explains a config, and reads live pool state through the SDK; it never
 * signs, sends or funds anything. Launching is a human action with real money.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import {
  ActivationType, BaseFeeMode, CollectFeeMode, DynamicBondingCurveClient, MigrationFeeOption,
  MigrationOption, Rounding, TokenAuthorityOption, TokenDecimal, TokenType,
  buildCurveWithCustomSqrtPrices, createSqrtPrices, getDeltaAmountBaseUnsigned,
  getDeltaAmountQuoteUnsigned, getPriceFromSqrtPrice, validateConfigParameters,
  type ConfigParameters,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import type {
  DbcCurvePlan, DbcCurveSegment, DbcPlanInput, DbcPoolStatus, DbcPreset,
} from "../shared/types";

const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

/* The program buffers the curve's swap amount by this much when checking supply. */
const SWAP_BUFFER_PCT = 25;
/* Migration fee we configure, needed to work back to the migrated base amount. */
const MIGRATION_FEE_PCT = 1;

/* ---------------- Presets ----------------
 *
 * The shape differences are the whole point, so they are stated as numbers
 * rather than adjectives. `anchorWeight` is the anchor segment's liquidity
 * relative to the thin segments on either side: the higher it is, the more
 * quote it takes to move price through fair value.
 */
export const DBC_PRESETS: Record<string, DbcPreset> = {
  "blue-chip": {
    id: "blue-chip",
    name: "Blue chip",
    summary: "A liquid, widely held stock. Tight band, heavy anchor, low steady-state fee.",
    launchDiscountPct: 8,
    bandPct: 4,
    ceilingPct: 18,
    anchorWeight: 12,
    startingFeeBps: 400,
    endingFeeBps: 30,
    feeDecayMinutes: 45,
  },
  "thin-listing": {
    id: "thin-listing",
    name: "Thinly traded",
    summary: "A newly tokenized or illiquid name. Wider band absorbs a jumpy reference price.",
    launchDiscountPct: 15,
    bandPct: 12,
    ceilingPct: 40,
    anchorWeight: 6,
    startingFeeBps: 700,
    endingFeeBps: 60,
    feeDecayMinutes: 90,
  },
  "pre-ipo": {
    id: "pre-ipo",
    name: "Pre-IPO",
    summary:
      "A private company priced off an issuer mark rather than a live market. The mark moves in " +
      "steps, not ticks, so the band is wide and the ceiling is generous.",
    /* The discount has to clear the band or the discovery segment collapses. */
    launchDiscountPct: 30,
    bandPct: 18,
    ceilingPct: 80,
    anchorWeight: 4,
    startingFeeBps: 900,
    endingFeeBps: 100,
    feeDecayMinutes: 180,
  },
};

export const DEFAULT_PRESET = "blue-chip";

/* ---------------- Helpers ---------------- */

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/* The program requires a real leftover receiver: validateTokenSupply rejects the
 * default pubkey outright. When the caller has not named one we validate against
 * a placeholder so the curve can still be checked, but the emitted config leaves
 * the field null — nobody should be able to launch with an address this tool
 * invented and send the leftover float to it. */
const VALIDATION_PLACEHOLDER_RECEIVER = new PublicKey("11111111111111111111111111111112");
const round2 = (n: number) => Math.round(n * 100) / 100;

/** BN in raw base units → a human number. */
function toUi(raw: BN, decimals: number): number {
  const d = new BN(10).pow(new BN(decimals));
  const whole = raw.div(d).toNumber();
  const frac = raw.mod(d).toNumber() / 10 ** decimals;
  return whole + frac;
}

const isPubkey = (s: string) => {
  try { new PublicKey(s); return true; } catch { return false; }
};

function asTokenDecimal(n: number): TokenDecimal {
  /* The program only accepts 6-9. */
  const v = clamp(Math.round(n), 6, 9);
  return v as TokenDecimal;
}

/** Base tokens sold across every segment of a built curve. */
function sumBaseSold(config: ConfigParameters, baseDecimals: number): number {
  let cursor = config.sqrtStartPrice as BN;
  let total = new BN(0);
  for (const pt of config.curve ?? []) {
    const upper = pt.sqrtPrice as BN;
    if (upper.lte(cursor)) continue;
    total = total.add(getDeltaAmountBaseUnsigned(cursor, upper, pt.liquidity as BN, Rounding.Down));
    cursor = upper;
  }
  return toUi(total, baseDecimals);
}

/* ---------------- Curve planning ---------------- */

/**
 * Build a reference-anchored DBC config for a tokenized equity, plus the
 * breakdown needed to explain and draw it. Pure: no network, no signing.
 */
export function planEquityCurve(input: DbcPlanInput): DbcCurvePlan {
  const preset = DBC_PRESETS[input.presetId ?? DEFAULT_PRESET] ?? DBC_PRESETS[DEFAULT_PRESET];
  const warnings: string[] = [];

  const reference = input.referencePriceUsd;
  if (!Number.isFinite(reference) || reference <= 0) {
    throw new Error("A positive reference price is required to anchor the curve.");
  }

  /* Caller overrides win over the preset, within ranges the program accepts. */
  const launchDiscountPct = clamp(input.launchDiscountPct ?? preset.launchDiscountPct, 0.5, 90);
  const bandPct = clamp(input.bandPct ?? preset.bandPct, 0.5, 60);
  const ceilingPct = clamp(input.ceilingPct ?? preset.ceilingPct, bandPct + 1, 1000);
  const anchorWeight = clamp(input.anchorWeight ?? preset.anchorWeight, 1, 64);

  const baseDecimals = asTokenDecimal(input.baseDecimals ?? 9);
  const quoteDecimals = asTokenDecimal(input.quoteDecimals ?? 6);
  const requestedSupply = Math.max(1, Math.round(input.totalTokenSupply ?? 1_000_000));

  /* The prices that define the curve. Quote units per base token. The anchor
   * band is always present; the discovery segment only exists when the launch
   * discount actually opens below the band. */
  const bandLowPrice = reference * (1 - bandPct / 100);
  const bandHighPrice = reference * (1 + bandPct / 100);
  const migrationPrice = reference * (1 + ceilingPct / 100);
  const startPrice = Math.min(reference * (1 - launchDiscountPct / 100), bandLowPrice);

  const hasDiscovery = startPrice < bandLowPrice * 0.999;
  if (!hasDiscovery) {
    warnings.push(
      "The launch discount is no wider than the anchor band, so the curve opens at the band edge and there is no separate discovery segment.",
    );
  }

  const prices = hasDiscovery
    ? [startPrice, bandLowPrice, bandHighPrice, migrationPrice]
    : [startPrice, bandHighPrice, migrationPrice];
  const segmentNames = hasDiscovery ? ["discovery", "anchor", "premium"] : ["anchor", "premium"];
  const liquidityWeights = hasDiscovery ? [1, anchorWeight, 1] : [anchorWeight, 1];

  for (let i = 1; i < prices.length; i++) {
    if (!(prices[i] > prices[i - 1])) {
      throw new Error("Curve prices must increase from start to migration — widen the band or the ceiling.");
    }
  }

  const sqrtPrices = createSqrtPrices(prices, baseDecimals, quoteDecimals);

  const buildAt = (supply: number): ConfigParameters => buildCurveWithCustomSqrtPrices({
    token: {
      tokenType: input.baseTokenType === "token2022" ? TokenType.Token2022 : TokenType.SPLToken,
      tokenBaseDecimal: baseDecimals,
      tokenQuoteDecimal: quoteDecimals,
      /* An equity wrapper's metadata has to stay updatable: tickers change,
       * corporate actions happen, and the issuer has to be able to say so. */
      tokenAuthorityOption: TokenAuthorityOption.PartnerUpdateAuthority,
      totalTokenSupply: supply,
      /* The builder treats leftover as slack: when the curve needs slightly
       * more supply than configured, the shortfall has to fit inside it. One
       * percent absorbs rounding without materially changing the float. */
      leftover: Math.max(1, Math.round(supply * 0.01)),
    },
    fee: {
      baseFeeParams: {
        /* Exponential decay: the opening fee is high enough that buying the
         * launch discount ahead of everyone else is not free money, and it
         * falls away once the price has found the band. */
        baseFeeMode: BaseFeeMode.FeeSchedulerExponential,
        feeSchedulerParam: {
          startingFeeBps: preset.startingFeeBps,
          endingFeeBps: preset.endingFeeBps,
          numberOfPeriod: 60,
          totalDuration: preset.feeDecayMinutes * 60,
        },
      },
      /* Volatility-responsive fee on top: a reference-priced asset should get
       * more expensive to trade exactly when it is being pushed away from fair
       * value. */
      dynamicFeeEnabled: true,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 50,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps100,
      migrationFee: { feePercentage: MIGRATION_FEE_PCT, creatorFeePercentage: 50 },
    },
    liquidityDistribution: {
      /* Half the migrated liquidity is locked permanently. A tokenized equity
       * that graduates and then loses its pool is worse than one that never
       * launched, so the floor is structural rather than a promise. */
      partnerPermanentLockedLiquidityPercentage: 50,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 50,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    sqrtPrices,
    liquidityWeights,
  });

  /* Sizing the supply.
   *
   * The program needs the supply to cover the tokens sold along the curve plus
   * a 25% buffer, plus the base side of the migrated DAMM pool. The builder
   * refuses outright when the gap is larger than the leftover slack, and the
   * validator refuses when the buffered total does not fit. Both scale linearly
   * with supply for fixed prices and weights, so a measured step lands it in
   * one or two tries; the geometric fallback only runs when the builder threw
   * before there was a config to measure.
   */
  const receiverInput = input.leftoverReceiver?.trim();
  if (receiverInput && !isPubkey(receiverInput)) {
    throw new Error("The leftover receiver is not a valid Solana address.");
  }
  const leftoverReceiver = receiverInput ? new PublicKey(receiverInput) : null;
  if (!leftoverReceiver) {
    warnings.push(
      "No leftover receiver was given, so the config leaves it unset. The program rejects a launch without one — set it to an address you control before creating the config.",
    );
  }

  let totalTokenSupply = requestedSupply;
  let config: ConfigParameters | null = null;
  let valid = false;
  let validationError: string | null = null;
  let scaledFrom: number | null = null;
  const grow = (next: number) => {
    if (scaledFrom == null) scaledFrom = totalTokenSupply;
    totalTokenSupply = Math.max(totalTokenSupply + 1, Math.ceil(next));
  };

  for (let attempt = 0; attempt < 6; attempt++) {
    let built: ConfigParameters;
    try {
      built = buildAt(totalTokenSupply);
    } catch (e) {
      /* No config to measure against — step up and try again. */
      validationError = (e as Error).message;
      if (attempt === 5) break;
      grow(totalTokenSupply * 1.5);
      continue;
    }
    config = built;
    try {
      validateConfigParameters({ ...built, leftoverReceiver: leftoverReceiver ?? VALIDATION_PLACEHOLDER_RECEIVER } as never);
      valid = true;
      validationError = null;
      break;
    } catch (e) {
      validationError = (e as Error).message;
      if (!/supply/i.test(validationError) || attempt === 5) break;
      /* Base sold along the curve, plus the base deposited at migration. */
      const sold = sumBaseSold(built, baseDecimals);
      const migrationQuote = toUi(built.migrationQuoteThreshold as BN, quoteDecimals) * (100 - MIGRATION_FEE_PCT) / 100;
      const migrationBase = migrationQuote / migrationPrice;
      const needed = (sold * (1 + SWAP_BUFFER_PCT / 100) + migrationBase) * 1.03;
      grow(Number.isFinite(needed) && needed > totalTokenSupply ? needed : totalTokenSupply * 1.5);
    }
  }

  if (!config) throw new Error(`Could not build a curve for these settings: ${validationError ?? "unknown error"}`);

  if (scaledFrom != null && valid) {
    warnings.push(
      `Total supply was raised from ${(scaledFrom as number).toLocaleString("en-US")} to ${totalTokenSupply.toLocaleString("en-US")} tokens: the program requires the supply to cover the curve plus a ${SWAP_BUFFER_PCT}% buffer and the base side of the migrated pool.`,
    );
  }
  if (!valid && validationError) {
    warnings.push(`The SDK rejected this configuration: ${validationError}`);
  }

  /* Per-segment amounts, computed with the SDK's own fixed-point helpers so the
   * breakdown matches what the program will do rather than approximating it. */
  const points = config.curve ?? [];
  const segments: DbcCurveSegment[] = [];
  let cursor = config.sqrtStartPrice as BN;
  let totalQuote = new BN(0);
  let totalBase = new BN(0);

  for (let i = 0; i < points.length; i++) {
    const upper = points[i].sqrtPrice as BN;
    const liquidity = points[i].liquidity as BN;
    if (upper.lte(cursor)) continue;
    const quoteRaw = getDeltaAmountQuoteUnsigned(cursor, upper, liquidity, Rounding.Down);
    const baseRaw = getDeltaAmountBaseUnsigned(cursor, upper, liquidity, Rounding.Down);
    totalQuote = totalQuote.add(quoteRaw);
    totalBase = totalBase.add(baseRaw);
    segments.push({
      name: segmentNames[i] ?? `segment ${i + 1}`,
      lowerPriceUsd: Number(getPriceFromSqrtPrice(cursor, baseDecimals, quoteDecimals)),
      upperPriceUsd: Number(getPriceFromSqrtPrice(upper, baseDecimals, quoteDecimals)),
      quoteIn: toUi(quoteRaw, quoteDecimals),
      baseOut: toUi(baseRaw, baseDecimals),
      liquidityWeight: liquidityWeights[i] ?? 1,
      sharePct: 0,
    });
    cursor = upper;
  }

  const totalQuoteUi = toUi(totalQuote, quoteDecimals);
  for (const seg of segments) {
    seg.sharePct = totalQuoteUi > 0 ? round2((seg.quoteIn / totalQuoteUi) * 100) : 0;
    seg.lowerPriceUsd = round2(seg.lowerPriceUsd);
    seg.upperPriceUsd = round2(seg.upperPriceUsd);
  }

  const migrationQuoteThreshold = toUi(config.migrationQuoteThreshold as BN, quoteDecimals);
  const anchor = segments.find((s) => s.name === "anchor");
  if (anchor && anchor.sharePct < 40) {
    warnings.push(
      `Only ${anchor.sharePct}% of the raise happens inside the anchor band. Raise the anchor weight if you want price to settle near the reference.`,
    );
  }
  if (input.quoteIsTokenizedStock) {
    warnings.push(
      "The quote token is itself a tokenized stock, so this curve prices a ratio between two equities. Both legs move, and the reference price has to be refreshed from both feeds.",
    );
  }

  return {
    base: { symbol: input.baseSymbol, name: input.baseName ?? input.baseSymbol, decimals: baseDecimals, tokenType: input.baseTokenType ?? "spl" },
    quote: { symbol: input.quoteSymbol ?? "USDC", mint: input.quoteMint ?? "", decimals: quoteDecimals, isTokenizedStock: Boolean(input.quoteIsTokenizedStock) },
    preset,
    referencePriceUsd: round2(reference),
    referenceSource: input.referenceSource,
    referenceAt: input.referenceAt ?? null,
    startPriceUsd: round2(startPrice),
    bandLowPriceUsd: round2(bandLowPrice),
    bandHighPriceUsd: round2(bandHighPrice),
    migrationPriceUsd: round2(migrationPrice),
    launchDiscountPct: round2(launchDiscountPct),
    bandPct: round2(bandPct),
    ceilingPct: round2(ceilingPct),
    anchorWeight,
    totalTokenSupply,
    segments,
    totalQuoteToMigrate: round2(totalQuoteUi),
    totalBaseSold: round2(toUi(totalBase, baseDecimals)),
    migrationQuoteThreshold: round2(migrationQuoteThreshold),
    fee: {
      startingFeeBps: preset.startingFeeBps,
      endingFeeBps: preset.endingFeeBps,
      decayMinutes: preset.feeDecayMinutes,
      dynamicFeeEnabled: true,
    },
    valid,
    validationError,
    warnings,
    /* The config the SDK would hand to createConfig, as JSON. Big numbers are
     * strings so nothing is silently truncated on the way to the client. */
    leftoverReceiver: leftoverReceiver?.toBase58() ?? null,
    config: {
      ...JSON.parse(JSON.stringify(config, (_k, v) => (BN.isBN(v) ? (v as BN).toString() : v))),
      leftoverReceiver: leftoverReceiver?.toBase58() ?? null,
    },
  };
}

/* ---------------- Live pool monitoring ---------------- */

let client: DynamicBondingCurveClient | null = null;
function dbcClient(): DynamicBondingCurveClient {
  if (!client) client = new DynamicBondingCurveClient(new Connection(RPC_URL, "confirmed"), "confirmed");
  return client;
}

/* The IDL nests every pool field under `poolState`, and anchor's generated
 * types bottom out at `any` there, so the fields we read are named explicitly.
 * Same for the config account: only what we actually use is declared. */
type PoolStateFields = {
  config: PublicKey; creator: PublicKey; baseMint: PublicKey;
  quoteReserve: BN; baseReserve: BN; sqrtPrice: BN; isMigrated: number | boolean;
};
type ConfigFields = { quoteTokenFlag?: number; tokenDecimal?: number };

const poolStateOf = (pool: unknown): PoolStateFields =>
  ((pool as { poolState?: PoolStateFields }).poolState ?? (pool as PoolStateFields));

/**
 * Read a live DBC pool: how far along the curve it is and how close it is to
 * graduating into DAMM v2. Accepts a pool address or the launched token's mint.
 * Read-only — this only ever fetches accounts.
 */
export async function dbcPoolStatus(addressOrMint: string): Promise<DbcPoolStatus> {
  if (!isPubkey(addressOrMint)) throw new Error("That is not a valid Solana address.");
  const { state } = dbcClient();

  let poolAddress = addressOrMint;
  let pool: unknown = await state.getPool(addressOrMint);
  if (!pool) {
    /* Not a pool account — try it as the launched token's mint. */
    const byMint = await state.getPoolByBaseMint(addressOrMint);
    if (!byMint) throw new Error("No Dynamic Bonding Curve pool found for that address or mint.");
    pool = byMint.account;
    poolAddress = byMint.publicKey.toBase58();
  }
  const ps = poolStateOf(pool);

  const [quoteProgress, baseProgress, threshold, feeMetrics, cfgRaw] = await Promise.all([
    state.getPoolQuoteTokenCurveProgress(poolAddress).catch(() => null),
    state.getPoolBaseTokenCurveProgress(poolAddress).catch(() => null),
    state.getPoolMigrationQuoteThreshold(poolAddress).catch(() => null),
    state.getPoolFeeMetrics(poolAddress).catch(() => null),
    state.getPoolConfig(ps.config).catch(() => null),
  ]);

  const cfg = (cfgRaw ? ((cfgRaw as { poolState?: ConfigFields }).poolState ?? cfgRaw) : null) as ConfigFields | null;
  /* quoteTokenFlag 1 marks a 9-decimal quote (wrapped SOL); USDC-style quotes are 6. */
  const quoteDecimals = asTokenDecimal(cfg?.quoteTokenFlag === 1 ? 9 : 6);
  const baseDecimals = asTokenDecimal(cfg?.tokenDecimal ?? 9);

  const cur = (feeMetrics as { current?: Record<string, BN> } | null)?.current;
  const unclaimed = cur && BN.isBN(cur.partnerQuoteFee) && BN.isBN(cur.creatorQuoteFee)
    ? toUi(cur.partnerQuoteFee.add(cur.creatorQuoteFee), quoteDecimals)
    : null;

  return {
    poolAddress,
    baseMint: ps.baseMint.toBase58(),
    config: ps.config.toBase58(),
    creator: ps.creator.toBase58(),
    /* `isMigrated` is a program flag, not an inference from progress. */
    migrated: Boolean(ps.isMigrated),
    quoteProgressPct: quoteProgress == null ? null : round2(quoteProgress * 100),
    baseProgressPct: baseProgress == null ? null : round2(baseProgress * 100),
    quoteReserve: toUi(ps.quoteReserve, quoteDecimals),
    migrationQuoteThreshold: threshold ? toUi(threshold, quoteDecimals) : null,
    currentPriceUsd: round2(Number(getPriceFromSqrtPrice(ps.sqrtPrice, baseDecimals, quoteDecimals))),
    unclaimedQuoteFee: unclaimed,
    fetchedAt: new Date().toISOString(),
  };
}
