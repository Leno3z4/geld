# geld — MONAD / Nad.fun AI meme trading bot

geld is a TypeScript/Node + React system for autonomous meme-token trading on Monad/Nad.fun V2. The Vercel side is the dashboard/API proxy; the long-running trading engine runs in a Cloudflare Container.

## Current deployment shape

```
Vercel browser
   -> /api/*
   -> Vercel Express proxy
   -> Cloudflare Worker
   -> singleton Cloudflare Container
   -> Monad / Nad.fun V2
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
curl -H "x-geld-api-secret: YOUR_GELD_API_SECRET" \
  https://geld.<your-subdomain>.workers.dev/api/health
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

- 24% of current free balance per planned trade
- 90% max portfolio exposure
- up to 5 open positions
- 0.58 minimum AI confidence
- 6% quote slippage
- 30% hard stop
- 70% take profit
- 20% trailing stop
- 240-minute maximum hold
- 800ms event polling fallback
- 2.2s position management loop
- 30s AI position review
- candidates can be evaluated for 180 seconds after creation

These settings are intentionally aggressive and can lose capital quickly. There is no guaranteed profit.

## Vercel production promotion

The GitHub -> Vercel integration for this project is currently staging the newer master deployments rather than automatically moving `geld-seven.vercel.app` to production. Promote the verified deployment to Production in Vercel before treating the dashboard as live.

## Security model

The Gemini layer only proposes BUY/HOLD/SELL decisions. It never receives the private key and never signs transactions. The execution layer gets the AI decision, re-quotes on-chain, applies slippage/deadline parameters, and signs the actual transaction.

The API proxy requires a separate shared secret before forwarding requests to the Cloudflare Worker. State sync uses its own secret.

Re-verify Nad.fun contract addresses/ABIs against the official integration docs after protocol upgrades.
