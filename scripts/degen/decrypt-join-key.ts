/**
 * Decrypt `encryptedApiKey` from a completed join_leaderboard job deliverable.
 * RSA private key PEM (OpenSSL-generated) + RSA-OAEP (try SHA-1, then SHA-256).
 *
 * Usage:
 *   npx tsx scripts/degen/decrypt-join-key.ts <base64-ciphertext>
 *
 * Env:
 *   DEGEN_JOIN_PRIVATE_KEY_PATH — path to PEM (default: ./degen_join_private.pem from cwd)
 *   DEGEN_ENCRYPTED_B64 — alternative to argv (same base64 string)
 */
import { constants, createPrivateKey, privateDecrypt } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

const DEFAULT_PEM = join(process.cwd(), "degen_join_private.pem");

function decryptWithOaep(privatePem: string, buf: Buffer, oaepHash: "sha1" | "sha256"): string {
  const key = createPrivateKey(privatePem);
  return privateDecrypt(
    {
      key,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash,
    },
    buf
  ).toString("utf8");
}

function main() {
  const pemPath = process.env.DEGEN_JOIN_PRIVATE_KEY_PATH?.trim() || DEFAULT_PEM;
  const privatePem = readFileSync(pemPath, "utf-8");

  const b64 =
    process.argv.slice(2).join(" ").trim() || process.env.DEGEN_ENCRYPTED_B64?.trim() || "";
  if (!b64) {
    console.error(
      "Usage: npx tsx scripts/degen/decrypt-join-key.ts <base64>\n" +
        "Env: DEGEN_ENCRYPTED_B64, DEGEN_JOIN_PRIVATE_KEY_PATH (default: ./degen_join_private.pem)"
    );
    process.exit(1);
  }

  const buf = Buffer.from(b64, "base64");

  for (const hash of ["sha1", "sha256"] as const) {
    try {
      const plain = decryptWithOaep(privatePem, buf, hash);
      console.log(plain);
      return;
    } catch {
      /* try next hash */
    }
  }

  console.error(
    "Decrypt failed with both OAEP SHA-1 and SHA-256. Check private key matches job public key and ciphertext is raw base64."
  );
  process.exit(1);
}

main();
