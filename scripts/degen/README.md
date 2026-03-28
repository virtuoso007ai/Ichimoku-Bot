# dgclaw subscribe (what we use)

Creates a buyer job for the **dgclaw-subscription** agent’s `subscribe` offering. No extra JSON files — subscriber is the **active agent’s wallet** from `config.json` (the same identity as `LITE_AGENT_API_KEY`).

```bash
npm run dgclaw:subscribe
```

Windows (from `virtuals-protocol-acp/`):

```bat
dgclaw-subscribe.cmd
```

Optional env:

- `ACP_SUBSCRIBER_WALLET` — override subscriber address (defaults to active agent).
- `FORUM_TOKEN_ADDRESS` — override the default forum token in `constants.ts`.

---

## Full Degen registration → `dgclaw-skill/.env` (recommended)

From `virtuals-protocol-acp/`:

```bash
npm run degen:dgclaw:join
```

Runs `dgclaw-join-complete.ts`: fresh RSA pair, **`join_leaderboard`** with **bare `publicKey`** (matches `dgclaw.sh`), payment polling + auto-approve when possible, **RSA-OAEP SHA-256** decrypt, writes **`../dgclaw-skill/.env`** with `DGCLAW_API_KEY=...`.

**Current Degen requirements (same as upstream `dgclaw.sh join`):**

1. **Token launched** — run `.\run-acp.cmd token launch <SYMBOL> "<description>"` if `token info` shows none.
2. **`dgclaw-skill`** next to `virtuals-protocol-acp` (parent of CLI folder) for `.env` + optional `bash scripts/dgclaw.sh leaderboard`.
3. **Base USDC** on agent wallet for job fee.

---

## `join_leaderboard` (Degen Claw API key via RSA)

**Idea:** You generate an RSA key pair; the job sends your **public** key in `serviceRequirements`. Degen encrypts the API key for you; the deliverable contains **encryptedApiKey** (Base64). You decrypt with your **private** PEM using RSA-OAEP.

| File / field | Role |
| --- | --- |
| Private key `.pem` (secret) | Decrypt `encryptedApiKey` from the deliverable |
| Public key `.pem` | Sent as `publicKey` inside `serviceRequirements` |
| `agentAddress` | Wallet address of the agent joining (`0x…`) |

### 1) Generate keys + `degen_join_requirements.json` (recommended)

From `virtuals-protocol-acp/` — uses **Node crypto** (no OpenSSL required). Reads the active agent wallet from `config.json` unless you set `AGENT_ADDRESS`:

```bash
npm run degen:join:keys
```

This writes `degen_join_private.pem`, `degen_join_public.pem`, and `degen_join_requirements.json` in the project root.

- **Never commit** `degen_join_private.pem` or the filled `degen_join_requirements.json` (see root `.gitignore`).

**Alternative (OpenSSL)** if you prefer:

```bash
openssl genrsa -out degen_join_private.pem 2048
openssl rsa -in degen_join_private.pem -pubout -out degen_join_public.pem
```

Then build `degen_join_requirements.json`: `publicKey` must be **bare** (all lines of `public.pem` except `-----BEGIN/END-----`, concatenated — same as `grep -v '^\-\-' public.pem | tr -d '\n'` in `dgclaw.sh`).

### 2) Requirements JSON

If you did **not** use `npm run degen:join:keys`, copy `degen_join_requirements.json.example` to `degen_join_requirements.json` and fill in your agent wallet + **bare** `publicKey` (see OpenSSL note above).

Shape is **flat** (do **not** double-wrap `name` / `requirement`).  
**`publicKey`:** use the **bare** SPKI string (no PEM headers) — what `openssl` prints minus `----` lines; `npm run degen:join:keys` writes this format. `npm run degen:join` also accepts legacy full PEM and normalizes it.

```json
{
  "agentAddress": "0xYourAgentWallet",
  "publicKey": "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA..."
}
```

### 3) Create the ACP job

Buyer `x-api-key` must be a **different** agent than the provider (same as other buyer jobs).

```bash
npm run degen:join
```

This runs `post-join-leaderboard.ts`, which POSTs to `https://claw-api.virtuals.io/acp/jobs` with:

```json
{
  "providerWalletAddress": "0xd478a8B40372db16cA8045F28C6FE07228F3781A",
  "jobOfferingName": "join_leaderboard",
  "serviceRequirements": {
    "agentAddress": "0x...",
    "publicKey": "MIIBIj..."
  }
}
```

(`providerWalletAddress` is defined in `constants.ts` as `DEGEN_CLAW_PROVIDER`.)

### 4) Decrypt `encryptedApiKey` after the job completes

When the job is **COMPLETED**, read Base64 `encryptedApiKey` from the deliverable, then:

```bash
npx tsx scripts/degen/decrypt-join-key.ts "<base64>"
```

Or:

```bash
set DEGEN_ENCRYPTED_B64=<base64>
set DEGEN_JOIN_PRIVATE_KEY_PATH=D:\path\to\degen_join_private.pem
npx tsx scripts/degen/decrypt-join-key.ts
```

The script tries RSA-OAEP with **SHA-1** then **SHA-256** (match Degen’s server if one fails).

### One-liner for other repos

> We generate an RSA pair with OpenSSL; we put the **public** key in the `join_leaderboard` job as `publicKey` and keep the **private** key safe. When the job finishes, we decrypt `encryptedApiKey` from the deliverable with the private key using **RSA-OAEP**.

---

## Other Degen scripts (optional)

`post-perp-*.ts` are kept for parity with wolfy-agent. Use only if you need those flows.
