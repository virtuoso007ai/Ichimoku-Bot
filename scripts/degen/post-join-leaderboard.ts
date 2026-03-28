/**
 * Degen Claw — join_leaderboard
 *
 * Flat serviceRequirements (do not wrap in { name, requirement }).
 * Keeps agentAddress + publicKey (RSA-OAEP) in sync with degen_join_requirements.json.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import client from "../../src/lib/client.js";
import { loadApiKey } from "../../src/lib/config.js";
import { DEGEN_CLAW_PROVIDER } from "./constants.js";

loadApiKey();

const __dirname = dirname(fileURLToPath(import.meta.url));
const reqPath = join(__dirname, "..", "..", "degen_join_requirements.json");

/** Degen / dgclaw.sh expect bare base64 body, not -----BEGIN PUBLIC KEY-----. */
function toBarePublicKey(k: string): string {
  const t = k.trim();
  if (t.includes("BEGIN PUBLIC KEY")) {
    return t
      .replace(/-----BEGIN PUBLIC KEY-----/g, "")
      .replace(/-----END PUBLIC KEY-----/g, "")
      .replace(/\s/g, "");
  }
  return t.replace(/\s/g, "");
}

async function main() {
  const raw = readFileSync(reqPath, "utf-8");
  const parsed = JSON.parse(raw) as {
    agentAddress: string;
    publicKey: string;
  };
  const serviceRequirements = {
    agentAddress: parsed.agentAddress,
    publicKey: toBarePublicKey(parsed.publicKey),
  };

  const body = {
    providerWalletAddress: DEGEN_CLAW_PROVIDER,
    jobOfferingName: "join_leaderboard",
    serviceRequirements,
  };

  const r = await client.post<{ data: { jobId: number } }>("/acp/jobs", body);
  console.log(JSON.stringify(r.data));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
