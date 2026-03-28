/**
 * dgclaw-subscription — "subscribe" offering (flat serviceRequirements).
 * Subscriber is usually your agent wallet (buyer side).
 */
import client from "../../src/lib/client.js";
import { getActiveAgent, loadApiKey } from "../../src/lib/config.js";
import {
  DGCLAW_SUBSCRIPTION_PROVIDER,
  DEFAULT_FORUM_TOKEN_ADDRESS,
} from "./constants.js";

loadApiKey();

function resolveSubscriberWallet(): string {
  const fromEnv = process.env.ACP_SUBSCRIBER_WALLET?.trim();
  if (fromEnv) return fromEnv;
  const agent = getActiveAgent();
  if (agent?.walletAddress) return agent.walletAddress;
  throw new Error(
    "Set ACP_SUBSCRIBER_WALLET or ensure config.json has an active agent with walletAddress."
  );
}

async function main() {
  const tokenAddress =
    process.env.FORUM_TOKEN_ADDRESS?.trim() || DEFAULT_FORUM_TOKEN_ADDRESS;
  const subscriber = resolveSubscriberWallet();

  const body = {
    providerWalletAddress: DGCLAW_SUBSCRIPTION_PROVIDER,
    jobOfferingName: "subscribe",
    serviceRequirements: {
      tokenAddress,
      subscriber,
    },
  };
  const r = await client.post<{ data: { jobId: number } }>("/acp/jobs", body);
  console.log(JSON.stringify(r.data));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
