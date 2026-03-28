/**
 * Ichimoku Kinko Hyo — Trade execution module.
 * Wraps Degen Claw ACP job creation for perp_trade / perp_modify.
 *
 * Uses the same `client.post('/acp/jobs', body)` pattern as the existing
 * post-perp-open-*.ts scripts.
 */

import axios from "axios";
import client from "../../src/lib/client.js";
import { loadApiKey } from "../../src/lib/config.js";
import { DEGEN_CLAW_PROVIDER } from "./constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenPositionParams {
  pair: string;
  side: "long" | "short";
  size: string; // USDC string, e.g. "100"
  leverage: number;
}

export interface ClosePositionParams {
  pair: string;
  side: "long" | "short";
  size: number;
  leverage: number;
}

export interface ModifyPositionParams {
  pair: string;
  takeProfit?: string;
  stopLoss?: string;
}

export interface ActivePosition {
  coin: string;
  pnl: number;
  size: number;
  side: string;
  entryPrice: number;
}

export interface AccountState {
  value: number; // total account value in USDC
  activePositions: ActivePosition[];
  address: string;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

loadApiKey();

const HL_INFO_URL = "https://api.hyperliquid.xyz/info";

// ---------------------------------------------------------------------------
// ACP Job helpers
// ---------------------------------------------------------------------------

/**
 * Open a perpetual position via Degen Claw ACP.
 * Equivalent to `acp job create <provider> perp_trade --requirements {...}`.
 */
export async function openPosition(
  params: OpenPositionParams,
): Promise<number> {
  const body = {
    providerWalletAddress: DEGEN_CLAW_PROVIDER,
    jobOfferingName: "perp_trade",
    serviceRequirements: {
      action: "open",
      pair: params.pair,
      side: params.side,
      size: params.size,
      leverage: params.leverage,
    },
  };

  const r = await client.post<{ data: { jobId: number } }>("/acp/jobs", body);
  return r.data.data.jobId;
}

/**
 * Close a perpetual position via Degen Claw ACP.
 */
export async function closePosition(
  params: ClosePositionParams,
): Promise<number> {
  const body = {
    providerWalletAddress: DEGEN_CLAW_PROVIDER,
    jobOfferingName: "perp_trade",
    serviceRequirements: {
      action: "close",
      pair: params.pair,
      side: params.side,
      size: params.size.toString(),
      leverage: params.leverage,
    },
  };

  const r = await client.post<{ data: { jobId: number } }>("/acp/jobs", body);
  return r.data.data.jobId;
}

/**
 * Modify TP/SL on an active perpetual position via Degen Claw ACP.
 */
export async function modifyPosition(
  params: ModifyPositionParams,
): Promise<number> {
  const body = {
    providerWalletAddress: DEGEN_CLAW_PROVIDER,
    jobOfferingName: "perp_modify",
    serviceRequirements: {
      pair: params.pair,
      ...(params.takeProfit && { takeProfit: params.takeProfit }),
      ...(params.stopLoss && { stopLoss: params.stopLoss }),
    },
  };

  const r = await client.post<{ data: { jobId: number } }>("/acp/jobs", body);
  return r.data.data.jobId;
}

// ---------------------------------------------------------------------------
// Account state (Hyperliquid direct API — read-only, no ACP needed)
// ---------------------------------------------------------------------------

/**
 * Query account / position state from Hyperliquid.
 * Uses the subaccount address from env, or falls back to the wallet used
 * for ACP authentication.
 */
export async function getAccountState(
  walletAddress?: string,
): Promise<AccountState> {
  // Priority: SUBACCOUNT_ADDRESS (HL subaccount) → HL_WALLET_ADDRESS → config.json
  const hlAddr = walletAddress ||
    process.env.SUBACCOUNT_ADDRESS ||
    process.env.HL_WALLET_ADDRESS;

  // For display, use the agent wallet (not subaccount)
  let displayAddr = process.env.HL_WALLET_ADDRESS || "unknown";

  // Fall back to config.json
  let queryAddr = hlAddr;
  if (!queryAddr) {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const cfgPath = path.resolve(
        import.meta.dirname ?? ".",
        "../../config.json",
      );
      const cfgJson = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      const active = cfgJson.agents?.find((a: any) => a.active);
      if (active?.walletAddress) {
        queryAddr = active.walletAddress;
        displayAddr = active.walletAddress;
      }
    } catch {}
  }

  if (!queryAddr) queryAddr = "unknown";

  try {
    const payload = { type: "webData2", user: queryAddr };
    const resp = await axios.post(HL_INFO_URL, payload, { timeout: 10_000 });
    const data = resp.data;

    // Account value (perp margin + spot)
    const perpVal = parseFloat(
      data?.clearinghouseState?.marginSummary?.accountValue ?? "0",
    );
    let spotVal = 0;
    for (const b of (data?.spotState?.balances ?? [])) {
      if (b.coin === "USDC") { spotVal = parseFloat(b.total ?? "0"); break; }
    }

    // Active positions
    const positions: any[] = data?.clearinghouseState?.assetPositions ?? [];
    const activePositions: ActivePosition[] = [];

    for (const p of positions) {
      const entry = p.position ?? {};
      const szi = parseFloat(entry.szi ?? "0");
      if (Math.abs(szi) > 0) {
        activePositions.push({
          coin: entry.coin ?? "?",
          pnl: parseFloat(entry.unrealizedPnl ?? "0"),
          size: Math.abs(szi),
          side: szi > 0 ? "long" : "short",
          entryPrice: parseFloat(entry.entryPx ?? "0"),
        });
      }
    }

    return {
      value: perpVal + spotVal,
      activePositions,
      address: displayAddr,
    };
  } catch {
    return { value: 0, activePositions: [], address: displayAddr };
  }
}
