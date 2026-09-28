# geld — Monad / Nad.fun AI meme trading bot

This branch fully replaces the old Solana/Rust application with a TypeScript/Node + React + Tailwind application built around Nad.fun V2 on Monad.

## Architecture

- Monad mainnet, chain 143.
- Nad.fun V2 lifecycle-aware router for native MON buys/sells.
- Nad.fun V2 BondingCurve event stream with HTTP log polling fallback.
- Optional Nad.fun API for token metadata and market enrichment.
- Gemini Interactions API with strict structured JSON decisions.
- Adaptive 168-bucket hour-of-week market-flow seasonality.
- Local scoring before AI calls, so Gemini is not called for every event.
- Aggressive sizing defaults that are configurable through environment variables.
- React/Tailwind dashboard based on the supplied shadcn dashboard layout.
- Cloudflare Container for the long-lived Node process and Cron Trigger to revive it.
- Durable Object-backed state endpoint for restart-safe state synchronization.

## Old fork audit

The original fork is Solana-specific: Solana RPC, Solana keypairs, Jupiter, Helius, Telegram and a large Rust trading stack. I inspected its repository metadata, local agent settings, CI, Dockerfile, wallet, web server/routes, Jupiter client and trading entrypoints. I did not find an obvious credential-exfiltration payload in those inspected files. A complete local dependency/binary audit was not possible because the environment could not clone external repositories directly.

The rewrite branch removes the legacy runtime rather than carrying unknown old behavior into the Monad trader. The original master branch is untouched.

## Nad.fun V2 mainnet contracts used

- Chain: 143
- WMON: 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A
- NadFunRouter: 0x8986C8fD44eb85294A725a7e61AF35E76bA26F91
- BondingCurve: 0x9f3832732923252A21044F21eE6bd87F09514ae4
- NadFunFactory: 0xA25b13127e63ddae6d0b35570FF3D39dBD621001

Re-verify official deployment docs before deploying after a protocol upgrade.

## Run locally

npm install
cp .env.example .env
edit .env
npm run build
npm start

Dashboard: http://localhost:8787
Tests: npm test

## Live execution

Set:
LIVE_TRADING=true
AUTO_START=true

Then configure MONAD_PRIVATE_KEY, MONAD_RPC_URL, MONAD_WS_URL and GEMINI_API_KEYS.

Use a dedicated hot wallet containing only the capital you intend to trade. Never commit the private key.

Gemini is never given the private key and never signs transactions. It returns BUY/HOLD/SELL, confidence, suggested size fraction and invalidation text. The execution layer independently calculates quotes, slippage bounds, deadlines, approvals and signs the on-chain call.

There is no guaranteed profit. With a small bankroll, gas, slippage and adverse price selection can dominate returns.

## Gemini fallback behavior

GEMINI_API_KEYS accepts comma-separated current Gemini auth keys. The bot advances to another key when the current key hits credential, transient or quota errors.

This is a failure fallback, not a quota multiplier: Gemini documents that rate limits are project-scoped rather than API-key-scoped.

Use the appropriate Google AI Studio/Gemini billing tier if higher throughput is needed.

## Cloudflare

Cloudflare Containers are available on the Workers Paid plan. The singleton container is configured with a 24-hour idle timeout and a one-minute Cron Trigger that calls startAndWaitForPorts.

Container disk is ephemeral, so the process writes a compact JSON journal and can POST it to a Durable Object state endpoint using STATE_SYNC_URL + STATE_SYNC_SECRET.

Deploy:
npx wrangler login
npx wrangler secret put MONAD_PRIVATE_KEY
npx wrangler secret put GEMINI_API_KEYS
npx wrangler secret put STATE_SYNC_SECRET
npx wrangler secret put MONAD_RPC_URL
npx wrangler secret put MONAD_WS_URL
npx wrangler deploy

The Worker class passes the secrets to the Container at startup.

## Research basis

Primary sources were the official Nad.fun V2 integration repository/API guide, the official Nad.fun TypeScript SDK repository, current Gemini API documentation, and current Cloudflare Containers documentation. Public meme-bot repositories were used as implementation references only; the rewrite intentionally does not implement wash-trading, stealth-volume or market-manipulation features.
