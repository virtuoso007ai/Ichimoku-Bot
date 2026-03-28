/**
 * HL subaccount USDC deposit — perp_deposit (Degen Claw).
 * amount must be a string (e.g. "15", "25").
 */
import client from "../../src/lib/client.js";
import { loadApiKey } from "../../src/lib/config.js";
import { DEGEN_CLAW_PROVIDER } from "./constants.js";

loadApiKey();

const AMOUNT_USDC = process.argv[2] ?? "15";

async function main() {
  const body = {
    providerWalletAddress: DEGEN_CLAW_PROVIDER,
    jobOfferingName: "perp_deposit",
    serviceRequirements: {
      amount: AMOUNT_USDC,
    },
  };
  const r = await client.post<{ data: { jobId: number } }>("/acp/jobs", body);
  console.log(JSON.stringify(r.data));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
