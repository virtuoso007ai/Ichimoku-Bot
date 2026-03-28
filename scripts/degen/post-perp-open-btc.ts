/**
 * BTC long open — perp_trade (Degen Claw).
 * size: USDC notional / margin unit as used by the offering (same pattern as ETH/VIRTUAL scripts).
 */
import client from "../../src/lib/client.js";
import { loadApiKey } from "../../src/lib/config.js";
import { DEGEN_CLAW_PROVIDER } from "./constants.js";

loadApiKey();

const SIZE = process.argv[2] ?? "11";
const LEVERAGE = Number(process.argv[3] ?? "5") || 5;

async function main() {
  const body = {
    providerWalletAddress: DEGEN_CLAW_PROVIDER,
    jobOfferingName: "perp_trade",
    serviceRequirements: {
      action: "open",
      pair: "BTC",
      side: "long",
      size: SIZE,
      leverage: LEVERAGE,
    },
  };
  const r = await client.post<{ data: { jobId: number } }>("/acp/jobs", body);
  console.log(JSON.stringify(r.data));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
