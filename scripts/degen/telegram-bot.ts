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
  type AgentConfig,
} from "./trade-executor.js";

// ---------------------------------------------------------------------------
// Config & Agents
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

type BotAgent = AgentConfig & { active: boolean };
export const agents: Record<string, BotAgent> = {};

if (process.env.ICHIMOKU_LITE_AGENT_API_KEY) {
  agents["ichi"] = {
    name: "Ichimoku",
    apiKey: process.env.ICHIMOKU_LITE_AGENT_API_KEY,
    hlWallet: process.env.ICHIMOKU_HL_WALLET_ADDRESS || "",
    subaccount: process.env.ICHIMOKU_SUBACCOUNT_ADDRESS || "",
    active: false,
  };
}

if (process.env.VIRGEN_LITE_AGENT_API_KEY) {
  agents["virgen"] = {
    name: "Virgen Capital",
    apiKey: process.env.VIRGEN_LITE_AGENT_API_KEY,
    hlWallet: process.env.VIRGEN_HL_WALLET_ADDRESS || "",
    subaccount: process.env.VIRGEN_SUBACCOUNT_ADDRESS || "",
    active: false,
  };
}

if (process.env.RAICHU_LITE_AGENT_API_KEY) {
  agents["raichu"] = {
    name: "Super Saiyan Raichu",
    apiKey: process.env.RAICHU_LITE_AGENT_API_KEY,
    hlWallet: process.env.RAICHU_HL_WALLET_ADDRESS || "",
    subaccount: process.env.RAICHU_SUBACCOUNT_ADDRESS || "",
    active: false,
  };
}

if (process.env.WELLES_LITE_AGENT_API_KEY) {
  agents["welles"] = {
    name: "Welles Wilder",
    apiKey: process.env.WELLES_LITE_AGENT_API_KEY,
    hlWallet: process.env.WELLES_HL_WALLET_ADDRESS || "",
    subaccount: process.env.WELLES_SUBACCOUNT_ADDRESS || "",
    active: false,
  };
}

if (process.env.SQUIRTLE_LITE_AGENT_API_KEY) {
  agents["squirtle"] = {
    name: "Squirtle Squad",
    apiKey: process.env.SQUIRTLE_LITE_AGENT_API_KEY,
    hlWallet: process.env.SQUIRTLE_HL_WALLET_ADDRESS || "",
    subaccount: process.env.SQUIRTLE_SUBACCOUNT_ADDRESS || "",
    active: false,
  };
}

// Fallback logic for backward compatibility
if (Object.keys(agents).length === 0 && process.env.LITE_AGENT_API_KEY) {
  agents["default"] = {
    name: "Default Agent",
    apiKey: process.env.LITE_AGENT_API_KEY,
    hlWallet: process.env.HL_WALLET_ADDRESS || "",
    subaccount: process.env.SUBACCOUNT_ADDRESS || "",
    active: false,
  };
}

const SCAN_INTERVAL_MS = 30_000;
const ACTIVE_INTERVAL_MS = 5_000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

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

bot.onText(/\/(start_ichi|start_virgen|start_raichu|start_welles|start_squirtle|start_all)$/, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  const cmd = match?.[1] || "";

  let activated: string[] = [];

  if (cmd === "start_ichi" || cmd === "start_all") {
    if (agents["ichi"]) {
      agents["ichi"].active = true;
      activated.push("Ichimoku");
    } else {
      await send("⚠️ Ichimoku kimlik bilgileri (.env) bulunamadı.");
    }
  }

  if (cmd === "start_virgen" || cmd === "start_all") {
    if (agents["virgen"]) {
      agents["virgen"].active = true;
      activated.push("Virgen Capital");
    } else {
      await send("⚠️ Virgen Capital kimlik bilgileri (.env) bulunamadı.");
    }
  }

  if (cmd === "start_raichu" || cmd === "start_all") {
    if (agents["raichu"]) {
      agents["raichu"].active = true;
      activated.push("Super Saiyan Raichu");
    } else {
      await send("⚠️ Raichu kimlik bilgileri (.env) bulunamadı.");
    }
  }

  if (cmd === "start_welles" || cmd === "start_all") {
    if (agents["welles"]) {
      agents["welles"].active = true;
      activated.push("Welles Wilder");
    } else {
      await send("⚠️ Welles kimlik bilgileri (.env) bulunamadı.");
    }
  }

  if (cmd === "start_squirtle" || cmd === "start_all") {
    if (agents["squirtle"]) {
      agents["squirtle"].active = true;
      activated.push("Squirtle Squad");
    } else {
      await send("⚠️ Squirtle kimlik bilgileri (.env) bulunamadı.");
    }
  }

  if (activated.length === 0) return;

  const modeText = dryRunMode ? "🔸 DRY RUN" : "🟢 LIVE";
  await send(
    `⛩ *Çalıştırılan Ajanlar: ${activated.join(", ")}*\n\n` +
    `Mode: ${modeText}\n` +
    `Pairs: ${config.pairs.join(", ")}\n` +
    `Timeframe: ${config.timeframe}\n` +
    `Lev: ${config.leverage}x | Size: ${config.sizeUsdc} USDC\n` +
    `TP: $${config.tpUsdc} / SL: $${config.slUsdc}\n\n` +
    `Taramaya başlıyorum... 🔍`
  );

  if (!loopRunning) {
    startTradingLoop();
  }
});

bot.onText(/\/(stop_ichi|stop_virgen|stop_raichu|stop_welles|stop_squirtle|stop_all)$/, async (msg, match) => {
  if (!isAuthorized(msg)) return;
  const cmd = match?.[1] || "";

  let deactivated: string[] = [];

  if (cmd === "stop_ichi" || cmd === "stop_all") {
    if (agents["ichi"]) {
      agents["ichi"].active = false;
      deactivated.push("Ichimoku");
    }
  }

  if (cmd === "stop_virgen" || cmd === "stop_all") {
    if (agents["virgen"]) {
      agents["virgen"].active = false;
      deactivated.push("Virgen Capital");
    }
  }

  if (cmd === "stop_raichu" || cmd === "stop_all") {
    if (agents["raichu"]) {
      agents["raichu"].active = false;
      deactivated.push("Super Saiyan Raichu");
    }
  }

  if (cmd === "stop_welles" || cmd === "stop_all") {
    if (agents["welles"]) {
      agents["welles"].active = false;
      deactivated.push("Welles Wilder");
    }
  }

  if (cmd === "stop_squirtle" || cmd === "stop_all") {
    if (agents["squirtle"]) {
      agents["squirtle"].active = false;
      deactivated.push("Squirtle Squad");
    }
  }

  if (deactivated.length > 0) {
    await send(`🛑 Durdurulan Ajanlar: ${deactivated.join(", ")}`);
  }

  const anyActive = Object.values(agents).some(a => a.active);
  if (!anyActive && loopRunning) {
    loopRunning = false;
    if (loopTimer) {
      clearTimeout(loopTimer);
      loopTimer = null;
    }
    await send("Tüm ajanlar durduruldu. Tarama döngüsü askıya alındı.");
  }
});

bot.onText(/\/status$/, async (msg) => {
  if (!isAuthorized(msg)) return;

  let anyActive = Object.values(agents).some(a => a.active);
  const modeText = !anyActive ? "⚫ Kapalı" : dryRunMode ? "🔸 DRY RUN" : "🟢 LIVE";
  
  let text = `⛩ *Bot Status*\nMode: ${modeText}\n\n`;

  for (const key of Object.keys(agents)) {
    const agent = agents[key];
    text += `🤖 *${agent.name}* [${agent.active ? "🟢 AKTİF" : "⚪ PASİF"}]\n`;
    
    try {
      const state = await getAccountState(agent);
      text += `Balance: $${state.value.toFixed(2)}\n`;

      // Active positions
      if (state.activePositions.length > 0) {
        text += `Açık Pozisyonlar:\n`;
        for (const pos of state.activePositions) {
          const emoji = pos.pnl >= 0 ? "🟢" : "🔴";
          text += `  └ ${emoji} ${pos.coin} ${pos.side.toUpperCase()} | PnL: $${pos.pnl >= 0 ? "+" : ""}${pos.pnl.toFixed(2)}\n`;
        }
      } else {
        text += `  └ _Açık pozisyon yok_\n`;
      }
    } catch (e: any) {
      text += `❌ Bilgi alınamadı: ${e.message}\n`;
    }
    text += `\n`;
  }

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
    `▶️ \\/start\\_ichi — Ichimoku'yu başlat\n` +
    `▶️ \\/start\\_virgen — Virgen'i başlat\n` +
    `▶️ \\/start\\_raichu — Raichu'yu başlat\n` +
    `▶️ \\/start\\_welles — Welles'i başlat\n` +
    `▶️ \\/start\\_squirtle — Squirtle'ı başlat\n` +
    `▶️ \\/start\\_all — İkisini de başlat\n` +
    `⏹ \\/stop\\_all — Tümünü durdur\n` +
    `📊 /status — Durum + piyasa + pozisyon\n` +
    `⚙️ /config — Mevcut ayarlar\n` +
    `💰 /pnl — Son trade sonuçları (aktif ajanlar)\n\n` +
    `*Mod:*\n` +
    `🟢 /live — Canlı trade modu\n` +
    `🔸 /dry — Kuru test modu\n\n` +
    `*Ayarlar:*\n` +
    `\`/set leverage 3\`\n` +
    `\`/set size 50\`\n` +
    `\`/set tp 2\``
  );
});

bot.onText(/\/pnl$/, async (msg) => {
  if (!isAuthorized(msg)) return;

  let text = `📊 *Açık Pozisyonlar (Aktif Ajanlar)*\n\n`;
  let overallPnl = 0;
  let hasPositions = false;

  for (const key of Object.keys(agents)) {
    const agent = agents[key];
    if (!agent.active) continue;

    try {
      const state = await getAccountState(agent);
      if (state.activePositions.length > 0) {
        hasPositions = true;
        text += `🤖 *${agent.name}*\n`;
        let agentPnl = 0;
        for (const pos of state.activePositions) {
          const emoji = pos.pnl >= 0 ? "🟢" : "🔴";
          text += `  └ ${emoji} ${pos.coin} ${pos.side.toUpperCase()}\n`;
          text += `      Entry: $${pos.entryPrice.toFixed(2)} | Size: ${pos.size.toFixed(4)}\n`;
          text += `      PnL: $${pos.pnl >= 0 ? "+" : ""}${pos.pnl.toFixed(2)}\n`;
          agentPnl += pos.pnl;
        }
        overallPnl += agentPnl;
        text += `  *Alt Toplam PnL: $${agentPnl >= 0 ? "+" : ""}${agentPnl.toFixed(2)}*\n\n`;
      }
    } catch {
      // ignore
    }
  }

  if (!hasPositions) {
    await send("📊 Aktif ajanlarda açık pozisyon yok.");
    return;
  }

  const emoji = overallPnl >= 0 ? "🟢" : "🔴";
  text += `${emoji} *Genel Toplam PnL: $${overallPnl >= 0 ? "+" : ""}${overallPnl.toFixed(2)}*`;

  await send(text);
});

// ---------------------------------------------------------------------------
// Trading Loop
// ---------------------------------------------------------------------------

let lastScanTime = 0;
let lastReportTime = Date.now();

const lastSignalMap = new Map<string, number>();
const pendingCloseMap = new Map<string, number>();
// Agent + pair bazında açık işlem kilitleyici — çift giriş önleyici
const pendingOpenMap = new Map<string, number>();

async function tradingTick(): Promise<void> {
  const activeAgents = Object.values(agents).filter(a => a.active);
  if (activeAgents.length === 0 || !loopRunning) return;

  const now = Date.now();
  // 5 dakikada bir "hala çalışıyorum" raporu gönder
  if (now - lastReportTime >= 5 * 60 * 1000) {
    lastReportTime = now;
    let report = `⏱ *Sistem Aktif (5 Dk Tarama Özeti)*\n\n`;
    report += `🤖 Ajanlar: ${activeAgents.map(a => a.name).join(", ")}\n`;
    report += `📊 Taranan Çiftler:\n`;
    for (const pair of config.pairs) {
      try {
        const data = await getMarketData(pair, config);
        if (data) {
          const trend = data.price > data.emaTrend ? "⬆️" : "⬇️";
          report += `  • ${pair}: $${data.price.toFixed(2)} | Trend: ${trend}\n`;
        }
      } catch (e) {
        // ignore
      }
    }
    report += `\n_Piyasayı izlemeye devam ediyorum... 🔍_`;
    await send(report);
  }

  let anyStateChanged = false;
  let hasAnyActivePositions = false;

  // 1. Her ajanın Hyperliquid hesabı bakiyesini paralele yakın bir hızda çekiyoruz
  const agentStates = new Map<string, { state: any, activeCoins: Set<string> }>();
  for (const agent of activeAgents) {
    try {
      const state = await getAccountState(agent);
      const activeCoins = new Set(state.activePositions.map((p: any) => p.coin));
      if (state.activePositions.length > 0) hasAnyActivePositions = true;
      agentStates.set(agent.name, { state, activeCoins });
    } catch (e: any) {
      console.error(`[State Error: ${agent.name}] ${e.message}`);
      await send(`⚠️ *[${agent.name}]* Bakiye okuma hatası: ${e.message ?? e}`);
    }
  }

  // 2. Her bir parite için market verilerini (getMarketData) YALNIZCA BİR KEZ tarıyoruz
  for (const pair of config.pairs) {
    const now = Date.now();
    const lastSignalTime = lastSignalMap.get(pair) || 0;
    
    // Cooldown aktifse (son 5 dk'da sinyal verildiyse) API'yi yormadan geç
    if (now - lastSignalTime < 5 * 60 * 1000) {
      continue; 
    }

    try {
      const data = await getMarketData(pair, config);
      if (!data) continue;

      const signal = detectSignal(pair, data, config);
      if (signal.side) {
        lastSignalMap.set(pair, now);
        const totalSize = (config.sizeUsdc * config.leverage).toString();
        const trendLabel = data.price > data.emaTrend ? "⬆️ UP" : "⬇️ DOWN";
        
        // Hangi ajanlar bu işleme girmeye müsait? (Pozisyonu olmayan ve bakiyesi yeten)
        const eligibleAgents = [];
        for (const agent of activeAgents) {
           const aData = agentStates.get(agent.name);
           if (!aData) continue;
           if (aData.activeCoins.has(pair)) continue;
           if (aData.state.value < config.sizeUsdc) continue;
           eligibleAgents.push(agent);
        }

        if (eligibleAgents.length > 0) {
          const agentNames = eligibleAgents.map(a => a.name).join(", ");
          await send(
            `🤖 *ORTAK SİNYAL: ${signal.side.toUpperCase()} ${pair}*\n` +
            `Giriş Yapan Ajanlar: *${agentNames}*\n\n` +
            `Fiyat: $${data.price.toFixed(2)}\n` +
            `EMA9: ${data.emaFast.toFixed(2)} ${signal.side === "long" ? ">" : "<"} EMA21: ${data.emaSlow.toFixed(2)} ✓\n` +
            `Trend: ${trendLabel} (EMA200: ${data.emaTrend.toFixed(2)})\n` +
            `Size: $${totalSize} (Kişi Başına)`
          );

          // Uygun olan tüm ajanlar için işleme gir (çift giriş kontrolü)
          for (const agent of eligibleAgents) {
            const openKey = `${agent.name}:${pair}`;
            const lastOpenTime = pendingOpenMap.get(openKey) || 0;

            // Aynı agent + pair için son 10 dakikada zaten açma isteği gönderdik mi?
            if (Date.now() - lastOpenTime < 10 * 60 * 1000) {
              console.log(`[DUPLICATE BLOCKED] ${agent.name} / ${pair} — son ${Math.round((Date.now() - lastOpenTime) / 1000)} sn önce açıldı`);
              continue;
            }

            // Kilidi hemen set et (job cevabı gelmeden önce de), çift ateşlemeyi önle
            pendingOpenMap.set(openKey, Date.now());

            if (!dryRunMode) {
              try {
                const jobId = await openPosition({
                  pair,
                  side: signal.side,
                  size: totalSize,
                  leverage: config.leverage,
                }, agent);
                await send(`🟢 *[${agent.name}]* AÇILDI — ACP Job: #${jobId}`);
                anyStateChanged = true;
              } catch (e: any) {
                // Hata alırsak kilidi geri al ki bir sonraki tick'te tekrar deneyebilelim
                pendingOpenMap.delete(openKey);
                await send(`❌ *[${agent.name}]* Trade başarısız: ${e.message ?? e}`);
              }
            } else {
              await send(`🔸 DRY RUN — *[${agent.name}]* trade açılmadı`);
            }
          }
        }
      }
    } catch (e: any) {
      console.error(`[Market Data Error: ${pair}]`, e.message);
    }
  }

  // 3. Her ajanın aktif pozisyonlarını denetle ve gerekirse kârı/zararı kapat
  for (const agent of activeAgents) {
    const aData = agentStates.get(agent.name);
    if (!aData || aData.state.activePositions.length === 0) continue;

    for (const pos of aData.state.activePositions) {
      if (shouldClose(pos.pnl, config)) {
        const posKey = `${agent.name}:${pos.coin}:${pos.side}`;
        const pendingTime = pendingCloseMap.get(posKey) || 0;
        
        if (Date.now() - pendingTime < 5 * 60 * 1000) {
          continue;
        }
        
        pendingCloseMap.set(posKey, Date.now());

        const isTP = pos.pnl >= config.tpUsdc;
        const emoji = isTP ? "🎯" : "🔴";
        const reason = isTP ? "TP HIT" : "SL HIT";

        await send(
          `${emoji} *[${agent.name}] ${reason} — ${pos.coin} ${pos.side.toUpperCase()}*\n` +
          `PnL: $${pos.pnl >= 0 ? "+" : ""}${pos.pnl.toFixed(2)}\n` +
          `Kapatılıyor... (ACP Onayı Bekleniyor)`
        );

        if (!dryRunMode) {
          try {
            const jobId = await closePosition({ 
              pair: pos.coin,
              side: pos.side as "long" | "short",
              size: pos.size,
              leverage: config.leverage
            }, agent);
            await send(`✅ *[${agent.name}]* Kapatma İsteği İletildi — ACP Job #${jobId}`);
            anyStateChanged = true;
          } catch (e: any) {
            pendingCloseMap.set(posKey, Date.now() - 4.5 * 60 * 1000); 
            await send(`❌ *[${agent.name}]* Kapatma başarısız: ${e.message ?? e}`);
          }
        } else {
          await send(`🔸 DRY RUN — *[${agent.name}]* pozisyon kapatılmadı`);
        }
      }
    }
  }
  // 4. Schedule next tick
  if (loopRunning) {
    const nextInterval = (hasAnyActivePositions || anyStateChanged) ? ACTIVE_INTERVAL_MS : SCAN_INTERVAL_MS;
    loopTimer = setTimeout(tradingTick, nextInterval);
  }
}

function startTradingLoop(): void {
  loopRunning = true;
  tradingTick();
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

console.log("⛩  Multi-Agent Telegram Bot başlatılıyor...");
send(
  `⛩ *Multi-Agent Trading Bot Online*\n\n` +
  `Mode: 🔸 DRY RUN (güvenli başlangıç)\n` +
  `Komutlar için /help yazın.\n` +
  `Agent'ları başlatmak için \\/start\\_all, \\/start\\_ichi, \\/start\\_virgen, \\/start\\_raichu, \\/start\\_welles veya \\/start\\_squirtle kullanın.`
).then(() => {
  console.log("✅ Telegram bağlantısı başarılı. Komut bekleniyor...");
});

// Graceful shutdown
process.on("SIGINT", async () => {
  loopRunning = false;
  if (loopTimer) clearTimeout(loopTimer);
  await send("🛑 Bot kapatılıyor...");
  bot.stopPolling();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  loopRunning = false;
  if (loopTimer) clearTimeout(loopTimer);
  await send("🛑 Bot kapatılıyor...");
  bot.stopPolling();
  process.exit(0);
});
