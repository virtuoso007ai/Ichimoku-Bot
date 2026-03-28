/**
 * Generate 2048-bit RSA key pair (PEM) for join_leaderboard and write degen_join_requirements.json.
 * JSON `publicKey` is bare SPKI (no PEM headers) — required by current Degen join API (same as dgclaw.sh).
 * Does not require OpenSSL — uses Node crypto (PKCS#8 private, SPKI public).
 *
 * Usage (from virtuals-protocol-acp/):
 *   npx tsx scripts/degen/generate-degen-rsa-keys.ts
 *
 * Env:
 *   AGENT_ADDRESS — override wallet (default: active agent in config.json)
 *   DEGEN_JOIN_DIR — directory for .pem + json (default: cwd)
 */
import { generateKeyPairSync } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

/** Matches dgclaw.sh / Degen API: SPKI PEM without headers or whitespace. */
function pemToBarePublicKey(pem: string): string {
  return pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s/g, "");
}

function loadAgentAddress(): string {
  const env = process.env.AGENT_ADDRESS?.trim();
  if (env) return env;
  try {
    const cfg = JSON.parse(readFileSync(join(ROOT, "config.json"), "utf-8")) as {
      agents?: { walletAddress?: string; active?: boolean }[];
    };
    const a = cfg.agents?.find((x) => x.active);
    if (a?.walletAddress) return a.walletAddress;
  } catch {
    /* missing config */
  }
  throw new Error(
    "No agent wallet: set AGENT_ADDRESS or run acp setup so config.json has an active agent."
  );
}

function main() {
  const dir = process.env.DEGEN_JOIN_DIR?.trim() || ROOT;
  const agentAddress = loadAgentAddress();

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const privPath = join(dir, "degen_join_private.pem");
  const pubPath = join(dir, "degen_join_public.pem");
  const reqPath = join(dir, "degen_join_requirements.json");

  writeFileSync(privPath, privateKey, "utf-8");
  writeFileSync(pubPath, publicKey, "utf-8");

  const publicKeyBare = pemToBarePublicKey(publicKey);
  const serviceRequirements = {
    agentAddress,
    publicKey: publicKeyBare,
  };
  writeFileSync(reqPath, JSON.stringify(serviceRequirements, null, 2) + "\n", "utf-8");

  console.log(`Wrote:\n  ${privPath}\n  ${pubPath}\n  ${reqPath}\nagentAddress: ${agentAddress}`);
}

main();
