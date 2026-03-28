/**
 * Degen Claw full registration (same outcome as dgclaw-skill/scripts/dgclaw.sh join):
 * RSA-2048, join_leaderboard job, poll, auto-accept payment, RSA-OAEP SHA-256 decrypt,
 * write ../dgclaw-skill/.env with DGCLAW_API_KEY.
 *
 * publicKey format matches dgclaw.sh (PEM body only, no BEGIN/END lines).
 * Upstream join requires agent tokenization — see token check below.
 *
 * Usage (from virtuals-protocol-acp/):
 *   npx tsx scripts/degen/dgclaw-join-complete.ts
 *
 * Prerequisite: active agent in config.json, agent token launched (`acp token launch`);
 * **Base USDC** on agent wallet (~0.02) or payment stalls.
 */
import { constants, generateKeyPairSync, privateDecrypt } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import client from "../../src/lib/client.js";
import { getActiveAgent, loadApiKey, loadBuilderCode, ROOT } from "../../src/lib/config.js";
import { processNegotiationPhase } from "../../src/lib/api.js";
import { getMyAgentInfo } from "../../src/lib/wallet.js";
import { DEGEN_CLAW_PROVIDER } from "./constants.js";

loadApiKey();
loadBuilderCode();

const __dirname = dirname(fileURLToPath(import.meta.url));
const DGCLAW_SKILL = join(ROOT, "..", "dgclaw-skill");
const ENV_PATH = join(DGCLAW_SKILL, ".env");

function pemToBarePublicKey(pem: string): string {
  return pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s/g, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type JobPayload = {
  phase?: string;
  deliverable?: unknown;
  memos?: Array<{ nextPhase: string; status: string; createdAt: string }>;
};

function extractEncryptedKey(deliverable: unknown): string | undefined {
  if (deliverable == null) return undefined;
  if (typeof deliverable === "object" && deliverable !== null && "encryptedApiKey" in deliverable) {
    const v = (deliverable as { encryptedApiKey?: string }).encryptedApiKey;
    return typeof v === "string" ? v : undefined;
  }
  if (typeof deliverable === "string") {
    try {
      const p = JSON.parse(deliverable) as { encryptedApiKey?: string };
      return p.encryptedApiKey;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function main() {
  const agent = getActiveAgent();
  if (!agent?.walletAddress) {
    throw new Error("No active agent in config.json — run acp setup or acp agent create.");
  }

  const me = await getMyAgentInfo();
  if (!me.tokenAddress?.trim()) {
    throw new Error(
      "Agent is not tokenized — Degen join_leaderboard requires a launched token (same as dgclaw.sh).\n" +
        "Run: .\\run-acp.cmd token launch <SYMBOL> \"<description>\"\n" +
        "Then retry: npm run degen:dgclaw:join"
    );
  }

  console.log(
    "Prerequisite: fund this wallet on **Base** with USDC (~0.02) for the join_leaderboard fee.\n" +
      `  ${agent.walletAddress}\n` +
      `Token: ${me.tokenAddress}\n`
  );

  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  const publicKeyBare = pemToBarePublicKey(publicKey);

  console.log("Creating join_leaderboard job...");
  const createRes = await client.post<{ data: { jobId: number } }>("/acp/jobs", {
    providerWalletAddress: DEGEN_CLAW_PROVIDER,
    jobOfferingName: "join_leaderboard",
    serviceRequirements: {
      agentAddress: agent.walletAddress,
      publicKey: publicKeyBare,
    },
  });

  const created = createRes.data as { data?: { jobId?: number } };
  const jobId = created.data?.jobId;
  if (jobId == null) {
    console.error(JSON.stringify(createRes.data, null, 2));
    throw new Error("No jobId in create response");
  }

  console.log(`Job ${jobId} created. Polling (up to ~10 min), auto-approving payment when possible...\n`);

  const maxPolls = 120;
  for (let i = 0; i < maxPolls; i++) {
    await sleep(5000);
    const res = await client.get(`/acp/jobs/${jobId}`);
    const body = res.data as { data?: JobPayload; errors?: string[] };
    if (body.errors?.length) {
      console.warn("API:", body.errors.join("; "));
    }
    const job = body.data;
    if (!job) continue;

    const memos = job.memos ?? [];
    const sorted = [...memos].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    const latest = sorted[0];
    const latestPhase = latest?.nextPhase ?? job.phase ?? "";

    const pendingPay = memos.filter((m) => m.nextPhase === "TRANSACTION" && m.status === "PENDING");
    if (pendingPay.length > 0) {
      console.log("Approving payment...");
      try {
        await processNegotiationPhase(Number(jobId), {
          accept: true,
          content: "Approved — Degen Claw registration",
        });
      } catch (e) {
        console.error("Payment step:", e instanceof Error ? e.message : e);
      }
    }

    const phaseLower = String(job.phase ?? "").toLowerCase();
    const latestLower = String(latestPhase).toLowerCase();

    if (phaseLower === "completed" || latestLower === "completed") {
      const enc = extractEncryptedKey(job.deliverable);
      if (!enc) {
        console.error("Deliverable:", JSON.stringify(job.deliverable, null, 2));
        throw new Error("No encryptedApiKey in deliverable");
      }

      const buf = Buffer.from(enc, "base64");
      const plain = privateDecrypt(
        {
          key: privateKey,
          padding: constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: "sha256",
        },
        buf
      ).toString("utf8");

      if (!existsSync(DGCLAW_SKILL)) {
        mkdirSync(DGCLAW_SKILL, { recursive: true });
      }
      writeFileSync(ENV_PATH, `DGCLAW_API_KEY=${plain}\n`, "utf8");
      console.log(`\nDone. DGCLAW_API_KEY saved to:\n  ${ENV_PATH}`);
      console.log("\nNext (Git Bash):\n  cd ../dgclaw-skill && bash scripts/dgclaw.sh leaderboard\n");
      return;
    }

    if (phaseLower === "failed" || latestLower === "failed") {
      throw new Error("Job failed — check app.virtuals.io or acp job status " + jobId);
    }

    console.log(`  [${i + 1}/${maxPolls}] phase=${job.phase} latestMemo=${latestPhase || "-"}`);
  }

  throw new Error(
    "Timed out. Ensure Base USDC balance, then run this script again (creates a new job)."
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
