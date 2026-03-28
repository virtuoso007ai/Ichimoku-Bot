/**
 * perp_modify — set take profit / stop loss (Degen Claw).
 * See dgclaw-skill: perp_modify with pair, takeProfit, stopLoss strings.
 */
import client from "../../src/lib/client.js";
import { loadApiKey } from "../../src/lib/config.js";
import { DEGEN_CLAW_PROVIDER } from "./constants.js";

loadApiKey();

const PAIR = process.argv[2] ?? "SOL";
const STOP_LOSS = process.argv[3] ?? "88";
const TAKE_PROFIT = process.argv[4] ?? "95";

async function main() {
  const body = {
    providerWalletAddress: DEGEN_CLAW_PROVIDER,
    jobOfferingName: "perp_modify",
    serviceRequirements: {
      pair: PAIR,
      stopLoss: STOP_LOSS,
      takeProfit: TAKE_PROFIT,
    },
  };
  const r = await client.post<{ data: { jobId: number } }>("/acp/jobs", body);
  console.log(JSON.stringify(r.data));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
