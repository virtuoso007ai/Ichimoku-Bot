/**
 * Ichimoku Kinko Hyo — Trade execution module.
 * Wraps Degen Claw ACP job creation for perp_trade / perp_modify.
 *
 * Uses the same `client.post('/acp/jobs', body)` pattern as the existing
 * post-perp-open-*.ts scripts.
 */

import axios from "axios";
import { DEGEN_CLAW_PROVIDER } from "./constants.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentConfig {
  name: string;
  apiKey: string;
  hlWallet: string;
  subaccount: string;
}

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

const HL_INFO_URL = "https://api.hyperliquid.xyz/info";

function getAgentClient(agentRawKey: string) {
  const client = axios.create({
    baseURL: process.env.ACP_API_URL || "https://claw-api.virtuals.io",
    headers: {
      "x-api-key": agentRawKey,
      "x-builder-code": process.env.ACP_BUILDER_CODE || "",
    },
  });
  client.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response) {
        throw new Error(JSON.stringify(error.response.data));
      }
      throw error;
    }
  );
  return client;
}

// ---------------------------------------------------------------------------
// ACP Job helpers
// ---------------------------------------------------------------------------

/**
 * Open a perpetual position via Degen Claw ACP.
 */
export async function openPosition(
  params: OpenPositionParams,
  agent: AgentConfig
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

  const client = getAgentClient(agent.apiKey);
  const r = await client.post<{ data: { jobId: number } }>("/acp/jobs", body);
  return r.data.data.jobId;
}

/**
 * Close a perpetual position via Degen Claw ACP.
 */
export async function closePosition(
  params: ClosePositionParams,
  agent: AgentConfig
): Promise<number> {
  const body = {
    providerWalletAddress: DEGEN_CLAW_PROVIDER,
    jobOfferingName: "perp_trade",
    serviceRequirements: {
      action: "close",
      pair: params.pair,
    },
  };

  const client = getAgentClient(agent.apiKey);
  const r = await client.post<{ data: { jobId: number } }>("/acp/jobs", body);
  return r.data.data.jobId;
}

/**
 * Modify TP/SL on an active perpetual position via Degen Claw ACP.
 */
export async function modifyPosition(
  params: ModifyPositionParams,
  agent: AgentConfig
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

  const client = getAgentClient(agent.apiKey);
  const r = await client.post<{ data: { jobId: number } }>("/acp/jobs", body);
  return r.data.data.jobId;
}

// ---------------------------------------------------------------------------
// Account state (Hyperliquid direct API — read-only, no ACP needed)
// ---------------------------------------------------------------------------

/**
 * Query account / position state from Hyperliquid.
 * Uses the subaccount address assigned to the agent configuration.
 */
export async function getAccountState(
  agent: AgentConfig,
): Promise<AccountState> {
  const queryAddr = agent.subaccount || agent.hlWallet;
  const displayAddr = agent.hlWallet || "unknown";

  if (!queryAddr) {
    throw new Error(`Missing SUBACCOUNT_ADDRESS or HL_WALLET_ADDRESS for agent ${agent.name}.`);
  }

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
