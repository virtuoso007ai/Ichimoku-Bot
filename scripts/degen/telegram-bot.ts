/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║     ⛩  Ichimoku Kinko Hyo — Telegram Trading Bot              ║
 * ║                                                                ║
 * ║  Telegram-controlled autonomous perpetual trading bot          ║
 * ║  EMA 9/21 crossover + EMA 200 trend filter                    ║
 * ║  Trades via Degen Claw ACP on Hyperliquid                     ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   npx tsx scripts/degen/telegram-bot.ts
 *   npm run ichimoku:telegram
 */

import dotenv from "dotenv";
dotenv.config();

import TelegramBotModule from "node-telegram-bot-api";
// @ts-ignore — CJS default export interop
const TelegramBot: typeof TelegramBotModule = (TelegramBotModule as any).default ?? TelegramBotModule;
type TgMessage = TelegramBotModule.Message;
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
// Config
// ---------------------------------------------------------------------------

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN not set in .env");
  process.exit(1);
}
if (!CHAT_ID) {
  console.error("❌ TELEGRAM_CHAT_ID not set in .env");
  process.exit(1);
}

// Mutable runtime config — can be changed via /set commands
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

const SCAN_INTERVAL_MS = 30_000;
const ACTIVE_INTERVAL_MS = 5_000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let tradingActive = false;
let dryRunMode = true; // Start in dry-run for safety
let loopTimer: ReturnType<typeof setTimeout> | null = null;
let loopRunning = false;

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
  return v ? v.split(",").map((s: string) => s.trim()) : undefined;
}

function ts(): string {
  return new Date().toLocaleTimeString("tr-TR", { hour12: false });
}

// ---------------------------------------------------------------------------
// Telegram Bot Setup
// ---------------------------------------------------------------------------

loadApiKey();

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const chatId = CHAT_ID;

/** Send message to the authorized chat */
async function send(text: string, parseMode: "Markdown" | "HTML" = "Markdown"): Promise<void> {
  try {
    await bot.sendMessage(chatId, text, { parse_mode: parseMode });
  } catch (e: any) {
    console.error(`[Telegram Send Error] ${e.message}`);
  }
}

/** Check if message is from authorized user */
function isAuthorized(msg: TgMessage): boolean {
  return msg.chat.id.toString() === chatId;
}

// ---------------------------------------------------------------------------
// Telegram Commands
// ---------------------------------------------------------------------------

bot.onText(/\/start$/, async (msg) => {
  if (!isAuthorized(msg)) return;

  if (tradingActive) {
    await send("⚠️ Bot zaten çalışıyor. Durdurmak için /stop");
    return;
  }

  tradingActive = true;
  const modeText = dryRunMode ? "🔸 DRY RUN" : "🟢 LIVE";
  await send(
    `⛩ *Ichimoku Kinko Hyo Trading Bot Başlatıldı*\n\n` +
    `Mode: ${modeText}\n` +
    `Pairs: ${config.pairs.join(", ")}\n` +
    `Timeframe: ${config.timeframe}\n` +
    `Leverage: ${config.leverage}x\n` +
    `Size: ${config.sizeUsdc} USDC\n` +
    `TP: $${config.tpUsdc} / SL: $${config.slUsdc}\n\n` +
    `Taramaya başlıyorum... 🔍`
  );

  startTradingLoop();
});

bot.onText(/\/stop$/, async (msg) => {
  if (!isAuthorized(msg)) return;

  if (!tradingActive) {
    await send("Bot zaten durmuş durumda.");
    return;
  }

  tradingActive = false;
  loopRunning = false;
  if (loopTimer) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
  await send("🛑 Bot durduruldu.");
});

bot.onText(/\/status$/, async (msg) => {
  if (!isAuthorized(msg)) return;

  const state = await getAccountState();
  const modeText = !tradingActive ? "⚫ Kapalı" : dryRunMode ? "🔸 DRY RUN" : "🟢 LIVE";

  let text =
    `⛩ *Ichimoku Kinko Hyo — Status*\n\n` +
    `Mode: ${modeText}\n` +
    `Balance: $${state.value.toFixed(2)}\n` +
    `Address: \`${state.address.slice(0, 10)}...\`\n\n`;

  // Market data
  text += `📊 *Piyasa Durumu*\n`;
  for (const pair of config.pairs) {
    const data = await getMarketData(pair, config);
    if (data) {
      const trend = data.price > data.emaTrend ? "⬆️" : "⬇️";
      text += `${pair}: $${data.price.toFixed(2)} | EMA9: ${data.emaFast.toFixed(1)} / EMA21: ${data.emaSlow.toFixed(1)} ${trend}\n`;
    } else {
      text += `${pair}: ❌ Veri yok\n`;
    }
  }

  // Active positions
  if (state.activePositions.length > 0) {
    text += `\n📈 *Açık Pozisyonlar*\n`;
    for (const pos of state.activePositions) {
      const emoji = pos.pnl >= 0 ? "🟢" : "🔴";
      text += `${emoji} ${pos.coin} ${pos.side.toUpperCase()} | PnL: $${pos.pnl >= 0 ? "+" : ""}${pos.pnl.toFixed(2)}\n`;
    }
  } else {
    text += `\n_Açık pozisyon yok._`;
  }

  await send(text);
});

bot.onText(/\/config$/, async (msg) => {
  if (!isAuthorized(msg)) return;

  await send(
    `⚙️ *Bot Ayarları*\n\n` +
    `Pairs: ${config.pairs.join(", ")}\n` +
    `Timeframe: ${config.timeframe}\n` +
    `EMA: ${config.emaFast}/${config.emaSlow}/${config.emaTrend}\n` +
    `Leverage: ${config.leverage}x\n` +
    `Size: ${config.sizeUsdc} USDC (= $${config.sizeUsdc * config.leverage} pos.)\n` +
    `TP: $${config.tpUsdc} / SL: $${config.slUsdc}\n\n` +
    `Değiştirmek için:\n` +
    `\`/set leverage 3\`\n` +
    `\`/set size 50\`\n` +
    `\`/set tp 2\`\n` +
    `\`/set sl 1.5\`\n` +
    `\`/set pairs ETH,BTC\``
  );
});

bot.onText(/\/set (.+)/, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  if (!match?.[1]) return;

  const parts = match[1].trim().split(/\s+/);
  const key = parts[0]?.toLowerCase();
  const value = parts[1];

  if (!key || !value) {
    await send("Kullanım: `/set <parametre> <değer>`");
    return;
  }

  switch (key) {
    case "leverage":
      config.leverage = parseInt(value, 10);
      await send(`✅ Leverage: *${config.leverage}x*`);
      break;
    case "size":
      config.sizeUsdc = parseFloat(value);
      await send(`✅ Size: *${config.sizeUsdc} USDC* (= $${config.sizeUsdc * config.leverage} pozisyon)`);
      break;
    case "tp":
      config.tpUsdc = parseFloat(value);
      await send(`✅ Take Profit: *$${config.tpUsdc}*`);
      break;
    case "sl":
      config.slUsdc = parseFloat(value);
      await send(`✅ Stop Loss: *$${config.slUsdc}*`);
      break;
    case "pairs":
      config.pairs = value.split(",").map((s) => s.trim().toUpperCase());
      await send(`✅ Pairs: *${config.pairs.join(", ")}*`);
      break;
    default:
      await send(`❌ Bilinmeyen parametre: \`${key}\`\nKullanılabilir: leverage, size, tp, sl, pairs`);
  }
});

bot.onText(/\/live$/, async (msg) => {
  if (!isAuthorized(msg)) return;
  dryRunMode = false;
  await send("🟢 *LIVE MODE* aktif — gerçek trade yapılacak!\n⚠️ Dikkat: Pozisyonlar gerçek para ile açılacak.");
});

bot.onText(/\/dry$/, async (msg) => {
  if (!isAuthorized(msg)) return;
  dryRunMode = true;
  await send("🔸 *DRY RUN MODE* aktif — trade yapılmayacak, sadece sinyaller loglanacak.");
});

bot.onText(/\/help$/, async (msg) => {
  if (!isAuthorized(msg)) return;

  await send(
    `⛩ *Ichimoku Kinko Hyo — Komutlar*\n\n` +
    `▶️ /start — Trading'i başlat\n` +
    `⏹ /stop — Trading'i durdur\n` +
    `📊 /status — Durum + piyasa + pozisyon\n` +
    `⚙️ /config — Mevcut ayarlar\n` +
    `💰 /pnl — Son trade sonuçları\n\n` +
    `*Mod:*\n` +
    `🟢 /live — Canlı trade modu\n` +
    `🔸 /dry — Kuru test modu\n\n` +
    `*Ayarlar:*\n` +
    `\`/set leverage 3\`\n` +
    `\`/set size 50\`\n` +
    `\`/set tp 2\`\n` +
    `\`/set sl 1.5\`\n` +
    `\`/set pairs ETH,BTC,SOL\``
  );
});

bot.onText(/\/pnl$/, async (msg) => {
  if (!isAuthorized(msg)) return;

  const state = await getAccountState();
  if (state.activePositions.length === 0) {
    await send("📊 Açık pozisyon yok. Bakiye: $" + state.value.toFixed(2));
    return;
  }

  let text = `📊 *Açık Pozisyonlar*\n\n`;
  let totalPnl = 0;
  for (const pos of state.activePositions) {
    const emoji = pos.pnl >= 0 ? "🟢" : "🔴";
    text += `${emoji} *${pos.coin}* ${pos.side.toUpperCase()}\n`;
    text += `   Entry: $${pos.entryPrice.toFixed(2)} | Size: ${pos.size.toFixed(4)}\n`;
    text += `   PnL: $${pos.pnl >= 0 ? "+" : ""}${pos.pnl.toFixed(2)}\n\n`;
    totalPnl += pos.pnl;
  }
  const emoji = totalPnl >= 0 ? "🟢" : "🔴";
  text += `${emoji} *Toplam PnL: $${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}*`;

  await send(text);
});

// ---------------------------------------------------------------------------
// Trading Loop
// ---------------------------------------------------------------------------

let lastScanTime = 0;

const lastSignalMap = new Map<string, number>();

async function tradingTick(): Promise<void> {
  if (!tradingActive || !loopRunning) return;

  try {
    const state = await getAccountState();
    const active = state.activePositions;
    const activeCoins = new Set(active.map((p) => p.coin));

    let signalFound = false;
    let scanLines: string[] = [];
    let stateChanged = false;

    // 1. ── Scanning for all pairs ──
    for (const pair of config.pairs) {
      const data = await getMarketData(pair, config);
      if (!data) continue;

      const signal = detectSignal(pair, data, config);

      if (signal.side) {
        // Enforce a 5-minute cooldown for signal notifications to prevent spam
        const now = Date.now();
        const lastSignalTime = lastSignalMap.get(pair) || 0;
        if (now - lastSignalTime < 5 * 60 * 1000) {
          continue; 
        }

        lastSignalMap.set(pair, now);
        signalFound = true;
        const totalSize = (config.sizeUsdc * config.leverage).toString();
        const trendLabel = data.price > data.emaTrend ? "⬆️ UP" : "⬇️ DOWN";

        await send(
          `⚡ *SINYAL: ${signal.side.toUpperCase()} ${pair}*\n\n` +
          `Fiyat: $${data.price.toFixed(2)}\n` +
          `EMA9: ${data.emaFast.toFixed(2)} ${signal.side === "long" ? ">" : "<"} EMA21: ${data.emaSlow.toFixed(2)} ✓\n` +
          `Trend: ${trendLabel} (EMA200: ${data.emaTrend.toFixed(2)})\n` +
          `Size: $${totalSize} (${config.sizeUsdc} USDC × ${config.leverage}x)`
        );

        if (activeCoins.has(pair)) {
          await send(`⚠️ *${pair}* için zaten açık pozisyon var, yeni işleme girilmiyor.`);
          continue; // Skip opening trade
        }

        if (state.value < config.sizeUsdc) {
          await send(`⚠️ Yetersiz bakiye: $${state.value.toFixed(2)} < $${config.sizeUsdc}`);
          continue;
        }

        if (!dryRunMode) {
          try {
            const jobId = await openPosition({
              pair,
              side: signal.side,
              size: totalSize,
              leverage: config.leverage,
            });
            await send(
              `🟢 *AÇILDI: ${signal.side.toUpperCase()} ${pair}*\n` +
              `Fiyat: $${data.price.toFixed(2)}\n` +
              `ACP Job: #${jobId}`
            );
            stateChanged = true;
          } catch (e: any) {
            await send(`❌ Trade başarısız: ${e.message ?? e}`);
          }
        } else {
          await send(`🔸 DRY RUN — trade açılmadı`);
        }
      }
    }

    // 2. ── Monitoring active positions ──
    if (active.length > 0) {
      for (const pos of active) {
        if (shouldClose(pos.pnl, config)) {
          const isTP = pos.pnl >= config.tpUsdc;
          const emoji = isTP ? "🎯" : "🔴";
          const reason = isTP ? "TP HIT" : "SL HIT";

          await send(
            `${emoji} *${reason} — ${pos.coin} ${pos.side.toUpperCase()}*\n` +
            `PnL: $${pos.pnl >= 0 ? "+" : ""}${pos.pnl.toFixed(2)}\n` +
            `Kapatılıyor...`
          );

          if (!dryRunMode) {
            try {
              const jobId = await closePosition({ 
                pair: pos.coin,
                side: pos.side as "long" | "short",
                size: pos.size,
                leverage: config.leverage
              });
              await send(`✅ Kapandı — ACP Job #${jobId}`);
              stateChanged = true;
            } catch (e: any) {
              await send(`❌ Kapatma başarısız: ${e.message ?? e}`);
            }
          } else {
            await send(`🔸 DRY RUN — pozisyon kapatılmadı`);
          }
        }
      }
    }

    // 4. Schedule next tick
    if (tradingActive && loopRunning) {
      // If we have active positions, tick faster to monitor TP/SL
      // If we just opened/closed a position, tick fast to catch state updates
      const nextInterval = (active.length > 0 || stateChanged) ? ACTIVE_INTERVAL_MS : SCAN_INTERVAL_MS;
      loopTimer = setTimeout(tradingTick, nextInterval);
    }

  } catch (e: any) {
    console.error(`[Trading Error] ${e.message}`);
    await send(`⚠️ Hata: ${e.message ?? e}`);
    if (tradingActive && loopRunning) {
      loopTimer = setTimeout(tradingTick, 10_000);
    }
  }
}

function startTradingLoop(): void {
  loopRunning = true;
  tradingTick();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

console.log("⛩  Ichimoku Kinko Hyo — Telegram Bot başlatılıyor...");
send(
  `⛩ *Ichimoku Kinko Hyo Bot Online*\n\n` +
  `Mode: 🔸 DRY RUN (güvenli başlangıç)\n` +
  `Komutlar için /help yazın.\n` +
  `Trading başlatmak için /start yazın.`
).then(() => {
  console.log("✅ Telegram bağlantısı başarılı. Komut bekleniyor...");
});

// Graceful shutdown
process.on("SIGINT", async () => {
  tradingActive = false;
  loopRunning = false;
  if (loopTimer) clearTimeout(loopTimer);
  await send("🛑 Bot kapatılıyor...");
  bot.stopPolling();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  tradingActive = false;
  loopRunning = false;
  if (loopTimer) clearTimeout(loopTimer);
  await send("🛑 Bot kapatılıyor...");
  bot.stopPolling();
  process.exit(0);
});
