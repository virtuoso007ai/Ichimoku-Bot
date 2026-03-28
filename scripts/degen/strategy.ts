/**
 * Ichimoku Kinko Hyo — EMA crossover strategy module.
 * Pure calculation functions — no side effects, no ACP calls.
 *
 * Based on AetherPerp's Neural Delta v2.5 strategy:
 *   - EMA 9 / 21 crossover with EMA 200 trend filter
 *   - Hyperliquid candleSnapshot data source
 */

import axios from "axios";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StrategyConfig {
  emaFast: number; // default 9
  emaSlow: number; // default 21
  emaTrend: number; // default 200
  timeframe: string; // default "5m"
  pairs: string[]; // default ["ETH", "BTC", "HYPE"]
  leverage: number; // default 5
  sizeUsdc: number; // default 20
  tpUsdc: number; // default 1.0
  slUsdc: number; // default 1.0
}

export interface MarketData {
  price: number;
  emaFast: number;
  emaSlow: number;
  emaTrend: number;
  /** Full series of closing prices (oldest → newest). */
  closes: number[];
}

export type SignalSide = "long" | "short" | null;

export interface Signal {
  side: SignalSide;
  pair: string;
  price: number;
  emaFast: number;
  emaSlow: number;
  emaTrend: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: StrategyConfig = {
  emaFast: 9,
  emaSlow: 21,
  emaTrend: 200,
  timeframe: "5m",
  pairs: ["ETH", "BTC", "HYPE"],
  leverage: 5,
  sizeUsdc: 20,
  tpUsdc: 1.0,
  slUsdc: 1.0,
};

const HL_INFO_URL = "https://api.hyperliquid.xyz/info";

// ---------------------------------------------------------------------------
// EMA
// ---------------------------------------------------------------------------

/**
 * Calculate Exponential Moving Average for the given price series.
 * Returns the final EMA value (single number).
 */
export function calculateEMA(prices: number[], period: number): number {
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

// ---------------------------------------------------------------------------
// Market data
// ---------------------------------------------------------------------------

/**
 * Fetch candle data from Hyperliquid and compute EMAs.
 * Returns `null` if data is insufficient or the request fails.
 */
export async function getMarketData(
  coin: string,
  config: StrategyConfig = DEFAULT_CONFIG,
): Promise<MarketData | null> {
  try {
    const startTime = Date.now() - 3 * 24 * 60 * 60 * 1000; // 3 days back
    const payload = {
      type: "candleSnapshot",
      req: { coin, interval: config.timeframe, startTime },
    };

    const resp = await axios.post(HL_INFO_URL, payload, { timeout: 10_000 });
    const candles: unknown[] = resp.data;

    if (!Array.isArray(candles) || candles.length === 0) return null;

    const closes = candles.map((c: any) => parseFloat(c.c));
    if (closes.length < config.emaTrend) return null;

    return {
      price: closes[closes.length - 1],
      emaFast: calculateEMA(closes, config.emaFast),
      emaSlow: calculateEMA(closes, config.emaSlow),
      emaTrend: calculateEMA(closes, config.emaTrend),
      closes,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Signal detection
// ---------------------------------------------------------------------------

/**
 * Detect an EMA 9/21 crossover with 200 trend filter.
 *
 * LONG  → previous EMA9 ≤ EMA21  AND  current EMA9 > EMA21  AND  price > EMA200
 * SHORT → previous EMA9 ≥ EMA21  AND  current EMA9 < EMA21  AND  price < EMA200
 */
export function detectSignal(
  pair: string,
  data: MarketData,
  config: StrategyConfig = DEFAULT_CONFIG,
): Signal {
  const closes = data.closes;
  // Previous bar EMAs (everything except the last candle)
  const prevCloses = closes.slice(0, -1);
  const prevEmaFast = calculateEMA(prevCloses, config.emaFast);
  const prevEmaSlow = calculateEMA(prevCloses, config.emaSlow);

  let side: SignalSide = null;

  // Bullish crossover + uptrend
  if (
    prevEmaFast <= prevEmaSlow &&
    data.emaFast > data.emaSlow &&
    data.price > data.emaTrend
  ) {
    side = "long";
  }
  // Bearish crossover + downtrend
  else if (
    prevEmaFast >= prevEmaSlow &&
    data.emaFast < data.emaSlow &&
    data.price < data.emaTrend
  ) {
    side = "short";
  }

  return {
    side,
    pair,
    price: data.price,
    emaFast: data.emaFast,
    emaSlow: data.emaSlow,
    emaTrend: data.emaTrend,
  };
}

// ---------------------------------------------------------------------------
// TP / SL check
// ---------------------------------------------------------------------------

/**
 * Returns `true` when unrealised PnL has reached the take-profit or
 * stop-loss threshold — meaning the position should be closed.
 */
export function shouldClose(
  pnl: number,
  config: StrategyConfig = DEFAULT_CONFIG,
): boolean {
  return pnl >= config.tpUsdc || pnl <= -config.slUsdc;
}

// ---------------------------------------------------------------------------
// Standalone test helper  (run: npx tsx scripts/degen/strategy.ts test)
// ---------------------------------------------------------------------------

if (
  process.argv[1]?.endsWith("strategy.ts") ||
  process.argv[1]?.endsWith("strategy.js")
) {
  const cmd = process.argv[2];

  if (cmd === "test") {
    (async () => {
      console.log("🧪 Ichimoku Strategy — test mode\n");
      const cfg = DEFAULT_CONFIG;
      for (const pair of cfg.pairs) {
        const data = await getMarketData(pair, cfg);
        if (!data) {
          console.log(`  ❌ ${pair}: no data / insufficient candles`);
          continue;
        }
        const sig = detectSignal(pair, data, cfg);
        const trend = data.price > data.emaTrend ? "UP" : "DOWN";
        console.log(
          `  ${pair}  Px: ${data.price.toFixed(2)}  EMA9: ${data.emaFast.toFixed(2)}  EMA21: ${data.emaSlow.toFixed(2)}  Trend(200): ${trend}  Signal: ${sig.side ?? "---"}`,
        );
      }
      console.log("\n✅ Test complete.");
    })();
  }
}
