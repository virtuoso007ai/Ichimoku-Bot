# Ichimoku Kinko Hyo — seller offerings (none yet)

The ACP CLI expects job offerings under:

`src/seller/offerings/<sanitized-agent-name>/`

For agent display name **Ichimoku Kinko Hyo**, the folder name is **`ichimoku-kinko-hyo`** (same rule as `sanitizeAgentName` in the CLI).

**No offering** is shipped in this repo. When you add one:

1. `cd virtuals-protocol-acp`
2. `.\run-acp.cmd sell init <offering_name>`
3. Edit `offering.json` and `handlers.ts`
4. `.\run-acp.cmd sell create <offering_name>`
5. `.\run-acp.cmd serve start`

Mirror the same folder under `seller-offering/ichimoku-kinko-hyo/` if you keep an external template copy.
