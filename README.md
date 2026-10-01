 # geld — MONAD / Nad.fun AI meme trading bot

geld is a TypeScript/Node + React system for autonomous meme-token trading on Monad/Nad.fun V2. The dashboard is hosted on Vercel, while the trading API and long-running engine run on Cloudflare. Read-only dashboard telemetry comes directly from the Cloudflare Worker. Protected operator actions still use the Vercel proxy so the API secret never ships to the browser.

## Current deployment shape

```
Vercel browser
   -> Cloudflare Worker /api/* (read-only telemetry)
   -> singleton Cloudflare Durable Object
   -> Monad / Nad.fun V2

Operator POST actions
   -> Vercel /api/*
   -> Cloudflare Worker (secret injected server-side)
   -> singleton Durable Object
```

The Worker uses a one-minute Cron Trigger to make sure the singleton container is started. The container itself runs the trading loop continuously and has a 24-hour idle timeout. The Cron expression is UTC.

## Live environment setup

Never paste your wallet private key into chat or commit it to git.

### 1. Cloudflare plan

Cloudflare Containers require the Workers Paid plan. The repo already contains the Container + Durable Object bindings and a `* * * * *` Cron Trigger.

### 2. Login

From the repository root:

```bash
npx wrangler login
```

### 3. Add Worker secrets

Use interactive prompts so secrets do not end up in shell history. The repo declares the core secrets as required:

```bash
npx wrangler secret put GELD_API_SECRET
npx wrangler secret put MONAD_PRIVATE_KEY
npx wrangler secret put GEMINI_API_KEYS
npx wrangler secret put STATE_SYNC_SECRET
```

Optional:

```bash
npx wrangler secret put MONAD_RPC_URL
npx wrangler secret put MONAD_WS_URL
npx wrangler secret put NADFUN_API_KEY
```

`GEMINI_API_KEYS` is a comma-separated list of Gemini keys. Multiple keys are used for failure fallback; Gemini rate limits are project-scoped, so additional keys are not an automatic quota multiplier.

### 4. Deploy and configure state sync

Deploy after the required secrets exist:

```bash
npx wrangler deploy
```

After deploy, Cloudflare gives you a Worker URL such as:

```
https://geld.<your-subdomain>.workers.dev
```

Set:

```
npx wrangler secret put STATE_SYNC_SECRET
npx wrangler deploy
```

and put this non-secret URL into the Worker's Variables:

```
STATE_SYNC_URL=https://geld.<your-subdomain>.workers.dev/internal/state/singleton
```

You can also put `STATE_SYNC_URL` in the `vars` object in `wrangler.jsonc` once you know the final Worker hostname, then redeploy.

### 5. Vercel environment variables

In the Vercel project `geld`, add these variables for Production:

```
GELD_CLOUDFLARE_URL=https://geld.<your-subdomain>.workers.dev
GELD_CLOUDFLARE_SECRET=<same value as Cloudflare GELD_API_SECRET>
```

Do not put the wallet key or Gemini keys in Vercel. They belong on Cloudflare.

### 6. Optional GitHub auto-deploy

The repo includes `.github/workflows/cloudflare-deploy.yml`. To make every push to `master` deploy the Worker + Container automatically, add these GitHub repository secrets:

```
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

Cloudflare's current GitHub Actions guidance uses the official `cloudflare/wrangler-action` and recommends storing the account ID and API token as CI secrets rather than in the repository.

### 7. Verify the live worker

From your terminal:

```bash
curl https://geld.mahoraga6190.workers.dev/api/health
```

You want:

```json
{
  "ok": true,
  "running": true,
  "liveTrading": true,
  "chainId": 143
}
```

For Cron/runtime logs:

```bash
npx wrangler tail geld
```

Watch for `geld container started`, followed by engine events / state updates. The Cron schedule is every minute in UTC.

## Live trading configuration

The current high-aggression defaults are:

- established-token DEX trading only; new-token launch buys are disabled
- $2,500 minimum liquidity before a token can become an entry candidate
- $25,000 minimum market cap before a token can become an entry candidate
- 10-minute minimum token age
- 10 minimum holders
- 25 MON minimum tracked volume
- 3-50% pullback entry band, plus controlled positive-momentum entries
- 24% of current free balance per planned trade
- 90% max portfolio exposure
- up to 5 open positions
- 0.45 minimum AI confidence
- 6% quote slippage
- 22% hard stop
- 70% take profit
- 15% trailing stop
- 180-minute maximum hold
- market discovery every minute; 1-minute local price sampling

These settings are intentionally aggressive. AI is advisory for strong setups, and a deterministic fallback can enter qualified setups during Gemini outages/rate limits. Trading can lose capital quickly; there is no guaranteed profit.

## API endpoints

The Cloudflare Worker is the canonical read-only API for the dashboard:

```
https://geld.mahoraga6190.workers.dev/api/health
https://geld.mahoraga6190.workers.dev/api/config
https://geld.mahoraga6190.workers.dev/api/state
```

GET requests to the dashboard telemetry endpoints are public and CORS-enabled. Start/stop/liquidate POST actions remain protected by `GELD_API_SECRET` and continue through the server-side Vercel proxy, so that secret is never exposed to the browser.

## Vercel production

Vercel still hosts the React dashboard. Its Express service remains only as the protected operator-action proxy.

## Security model

The Gemini layer only proposes BUY/HOLD/SELL decisions. It never receives the private key and never signs transactions. The execution layer gets the AI decision, re-quotes on-chain, applies slippage/deadline parameters, and signs the actual transaction.

Protected operator API calls require a separate shared secret before the Vercel proxy forwards them to the Cloudflare Worker. Read-only telemetry is intentionally public. State sync uses its own secret.

Re-verify Nad.fun contract addresses/ABIs against the official integration docs after protocol upgrades.

<!-- vercel-main-deploy-check -->

<!-- production-deploy-sync-2026-10-01 -->
