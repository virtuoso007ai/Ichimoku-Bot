/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║           Ichimoku Kinko Hyo — Autonomous Trading Bot          ║
 * ║                                                                ║
 * ║  EMA 9/21 crossover + EMA 200 trend filter                    ║
 * ║  Executes perp trades on Hyperliquid via Degen Claw ACP       ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   npx tsx scripts/degen/ichimoku-bot.ts           # run (autonomous mode)
 *   npx tsx scripts/degen/ichimoku-bot.ts status     # one-shot dashboard
 *   npx tsx scripts/degen/ichimoku-bot.ts dry        # dry-run (no trades)
 */

import { loadApiKey } from "../../src/lib/config.js";
import {
  type StrategyConfig,
  DEFAULT_CONFIG,
  getMarketData,
  detectSignal,
  shouldClose,
} from "./strategy.js";
import {
  openPosition,
  closePosition,
  getAccountState,
  type AccountState,
} from "./trade-executor.js";

// ---------------------------------------------------------------------------
// Config — override via env or edit here
// ---------------------------------------------------------------------------

const config: StrategyConfig = {
  ...DEFAULT_CONFIG,
  pairs: envList("TRADE_PAIRS") ?? DEFAULT_CONFIG.pairs,
  leverage: envInt("LEVERAGE") ?? DEFAULT_CONFIG.leverage,
  sizeUsdc: envInt("SIZE_USDC") ?? DEFAULT_CONFIG.sizeUsdc,
  tpUsdc: envFloat("TP_USDC") ?? DEFAULT_CONFIG.tpUsdc,
  slUsdc: envFloat("SL_USDC") ?? DEFAULT_CONFIG.slUsdc,
  timeframe: process.env.TIMEFRAME ?? DEFAULT_CONFIG.timeframe,
  emaFast: envInt("EMA_FAST") ?? DEFAULT_CONFIG.emaFast,
  emaSlow: envInt("EMA_SLOW") ?? DEFAULT_CONFIG.emaSlow,
  emaTrend: envInt("EMA_TREND") ?? DEFAULT_CONFIG.emaTrend,
};

const DRY_RUN = process.argv.includes("dry") || process.env.DRY_RUN === "true";
const SCAN_INTERVAL_MS = 30_000; // scanning: 30s
const ACTIVE_INTERVAL_MS = 5_000; // active position: 5s

// ---------------------------------------------------------------------------
// Terminal colours
// ---------------------------------------------------------------------------

const C = {
  purple: "\x1b[95m",
  blue: "\x1b[94m",
  green: "\x1b[92m",
  yellow: "\x1b[93m",
  red: "\x1b[91m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function envInt(key: string): number | undefined {
  const v = process.env[key];
  return v ? parseInt(v, 10) : undefined;
}
function envFloat(key: string): number | undefined {
  const v = process.env[key];
  return v ? parseFloat(v) : undefined;
}
function envList(key: string): string[] | undefined {
  const v = process.env[key];
  return v ? v.split(",").map((s) => s.trim()) : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function ts(): string {
  return new Date().toLocaleTimeString("tr-TR", { hour12: false });
}

// ---------------------------------------------------------------------------
// Dashboard (one-shot status display)
// ---------------------------------------------------------------------------

async function printDashboard(state: AccountState): Promise<void> {
  // Clear terminal
  process.stdout.write("\x1b[2J\x1b[H");

  console.log(
    `${C.bold}${C.purple}╔══════════════════════════════════════════════════════╗${C.reset}`,
  );
  console.log(
    `${C.bold}${C.purple}║     ⛩  Ichimoku Kinko Hyo — Trading Dashboard     ║${C.reset}`,
  );
  console.log(
    `${C.bold}${C.purple}╚══════════════════════════════════════════════════════╝${C.reset}`,
  );

  const modeTag = DRY_RUN
    ? `${C.yellow}DRY RUN${C.reset}`
    : `${C.green}LIVE${C.reset}`;
  console.log(
    `${C.green}Balance: $${state.value.toFixed(2)}${C.reset}  |  ${C.yellow}Sub: ${state.address.slice(0, 10)}...${C.reset}  |  Mode: ${modeTag}`,
  );
  console.log(
    `${C.blue}Strategy: ${config.timeframe} TF | ${config.leverage}x Lev | EMA ${config.emaFast}/${config.emaSlow}/${config.emaTrend}${C.reset}`,
  );
  console.log("─".repeat(70));
  console.log(
    `${"Coin".padEnd(6)} | ${"Price".padEnd(10)} | ${"EMA9/21".padEnd(15)} | ${"Trend(200)".padEnd(10)} | ${"PnL".padEnd(8)}`,
  );
  console.log("─".repeat(70));

  const pnlMap = new Map<string, number>();
  for (const p of state.activePositions) {
    pnlMap.set(p.coin, p.pnl);
  }

  const allCoins = [
    ...new Set([...config.pairs, ...pnlMap.keys()]),
  ].sort();

  for (const coin of allCoins) {
    const data = await getMarketData(coin, config);
    const pnl = pnlMap.get(coin);
    const pnlStr = pnl !== undefined ? `$${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}` : "---";
    const pnlColor =
      pnl !== undefined ? (pnl > 0 ? C.green : pnl < 0 ? C.red : C.reset) : C.reset;

    if (data) {
      const trend = data.price > data.emaTrend ? "UP" : "DOWN";
      const trendColor = trend === "UP" ? C.green : C.red;
      console.log(
        `${C.purple}${coin.padEnd(6)}${C.reset} | ${data.price.toFixed(2).padEnd(10)} | ${data.emaFast.toFixed(1)}/${data.emaSlow.toFixed(1)}${" ".repeat(Math.max(0, 9 - `${data.emaFast.toFixed(1)}/${data.emaSlow.toFixed(1)}`.length))} | ${trendColor}${trend.padEnd(10)}${C.reset} | ${pnlColor}${pnlStr}${C.reset}`,
      );
    } else if (pnl !== undefined) {
      console.log(
        `${C.yellow}${coin.padEnd(6)}${C.reset} | ${"SYNCING".padEnd(10)} | ${"---".padEnd(15)} | ${"---".padEnd(10)} | ${pnlColor}${pnlStr}${C.reset}`,
      );
    }
  }
  console.log("─".repeat(70));
}

// ---------------------------------------------------------------------------
// Main trading loop
// ---------------------------------------------------------------------------

const lastSignalMap = new Map<string, number>();

async function run(): Promise<void> {
  loadApiKey();

  console.log(
    `\n${C.bold}${C.purple}⛩  Ichimoku Kinko Hyo | Autonomous Trading Mode${C.reset}`,
  );
  if (DRY_RUN) {
    console.log(
      `${C.yellow}⚠  DRY RUN — signals will be logged but no trades will execute${C.reset}`,
    );
  }
  console.log(
    `${C.blue}Pairs: ${config.pairs.join(", ")} | ${config.timeframe} | ${config.leverage}x | TP $${config.tpUsdc} / SL $${config.slUsdc}${C.reset}\n`,
  );

  while (true) {
    try {
      const state = await getAccountState();
      const active = state.activePositions;
      const activeCoins = new Set(active.map((p) => p.coin));

      let stateChanged = false;

      // 1. ── Scanning mode (all pairs) ────────────────
      for (const pair of config.pairs) {
        const data = await getMarketData(pair, config);
        if (!data) continue;

        const trend = data.price > data.emaTrend ? "UP" : "DN";
        process.stdout.write(
          `\r${C.purple}[${ts()}] [Scan] ${pair} Px:${data.price.toFixed(2)} | Trend:${trend}${C.reset}       `,
        );

        const signal = detectSignal(pair, data, config);

        if (signal.side) {
          const now = Date.now();
          const lastSignalTime = lastSignalMap.get(pair) || 0;
          if (now - lastSignalTime < 5 * 60 * 1000) {
            continue;
          }
          lastSignalMap.set(pair, now);

          const totalSize = (config.sizeUsdc * config.leverage).toString();
          console.log(
            `\n${C.yellow}[${ts()}] ⚡ SIGNAL: ${signal.side.toUpperCase()} ${pair} @ ${data.price.toFixed(2)}${C.reset}`,
          );
          console.log(
            `${C.blue}    EMA9: ${data.emaFast.toFixed(2)} | EMA21: ${data.emaSlow.toFixed(2)} | EMA200: ${data.emaTrend.toFixed(2)}${C.reset}`,
          );

          if (activeCoins.has(pair)) {
            console.log(
              `${C.yellow}    ⚠️ Already holds active position for ${pair}. Trade skipped.${C.reset}`,
            );
            continue;
          }

          if (state.value < config.sizeUsdc) {
            console.log(
              `${C.red}    ✗ Insufficient balance ($${state.value.toFixed(2)} < $${config.sizeUsdc})${C.reset}`,
            );
            continue;
          }

          if (!DRY_RUN) {
            try {
              const jobId = await openPosition({
                pair,
                side: signal.side,
                size: totalSize,
                leverage: config.leverage,
              });
              console.log(
                `${C.green}    ✓ ${signal.side.toUpperCase()} opened — ACP Job #${jobId}${C.reset}`,
              );
              stateChanged = true;
            } catch (e: any) {
              console.log(
                `${C.red}    ✗ Trade failed: ${e.message ?? e}${C.reset}`,
              );
            }
          } else {
            console.log(
              `${C.yellow}    ⏸ DRY RUN — trade skipped${C.reset}`,
            );
          }
        }
      }

      // 2. ── Active position monitoring ────────────────────────────
      if (active.length > 0) {
        for (const pos of active) {
          if (shouldClose(pos.pnl, config)) {
            const reason = pos.pnl >= config.tpUsdc ? "TP HIT ✓" : "SL HIT ✗";
            console.log(
              `\n${C.yellow}[${ts()}] 🎯 ${reason} — PnL $${pos.pnl >= 0 ? "+" : ""}${pos.pnl.toFixed(2)} → Closing ${pos.coin}...${C.reset}`,
            );

            if (!DRY_RUN) {
              try {
                const jobId = await closePosition({ 
                  pair: pos.coin,
                  side: pos.side as "long" | "short",
                  size: pos.size,
                  leverage: config.leverage 
                });
                console.log(
                  `${C.green}    ✓ Close job sent — ACP Job #${jobId}${C.reset}`,
                );
                stateChanged = true;
              } catch (e: any) {
                console.log(
                  `${C.red}    ✗ Close failed: ${e.message ?? e}${C.reset}`,
                );
              }
            } else {
              console.log(
                `${C.yellow}    ⏸ DRY RUN — close skipped${C.reset}`,
              );
            }
          }
        }
      }

      // Sleep
      const sleepMs = (active.length > 0 || stateChanged) ? ACTIVE_INTERVAL_MS : SCAN_INTERVAL_MS;
      await sleep(sleepMs);

    } catch (e: any) {
      console.log(
        `\n${C.red}[${ts()}] [Error] ${e.message ?? e}${C.reset}`,
      );
      await sleep(10_000);
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const cmd = process.argv[2];

if (cmd === "status") {
  loadApiKey();
  getAccountState().then(printDashboard).catch(console.error);
} else {
  run();
}
