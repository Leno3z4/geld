# LeverUp Hosted Agent Setup

GELD uses LeverUp 1CT Hosted Agent mode so the main trader key is not used for every trade.

## Security boundary

- Trader wallet: `MONAD_PRIVATE_KEY`
- Hosted agent signer: `LEVERUP_AGENT_PRIVATE_KEY`
- The agent key must be a different address from the trader wallet.
- GELD rejects wildcard `uint256.max` agent permissions.
- The default explicit permission mask is `6`:
  - bit 1 = `MARKET_CLOSE`
  - bit 2 = `LIMIT_OPEN`
- GELD does not automatically call ERC-20 `approve` and does not grant unlimited allowances.

## 1. Generate the agent key locally

Run:

```bash
npm run generate:leverup-agent
```

Keep the private key local. Only the public agent address is needed in the LeverUp Agent Wallet Manager.

## 2. Store the agent key as a Cloudflare secret

From the repository root:

```bash
npx wrangler secret put LEVERUP_AGENT_PRIVATE_KEY
```

Paste the locally generated key into the prompt. Never commit it, put it in `GELD_CONFIG`, or paste it into chat.

The non-secret permission mask is:

```text
LEVERUP_AGENT_PERMISSION_MASK=6
```

## 3. Authorize the agent

Use the LeverUp Agent Wallet Manager:

https://app.leverup.xyz/agent-wallets

Connect the trader wallet, add the generated agent address, choose a unique name such as `GELD-1CT`, and select only:

- LIMIT_OPEN
- MARKET_CLOSE

Then confirm the single onchain authorization transaction.

LeverUp documents this as `authorizeAgent(address agent, bytes32 name, uint256 permissions)`.

## 4. Prepare ERC-20 collateral

1CT requires ERC-20 collateral; native MON must be wrapped to WMON first.

For MON collateral GELD uses:

- tokenIn: WMON
- lvToken: LVMON

Do not transfer the separate bankroll into the bot wallet just to test this integration.

## 5. Approve only the required assets

The Diamond is:

`0xea1b8E4aB7f14F7dCA68c5B214303B13078FC5ec`

The first test should use:

- WMON as collateral
- LV as the execution-fee token when the live fee configuration has enough LV

The live fee endpoint currently advertises about 2.395363865476613882 LV for LIMIT_OPEN. GELD's preflight reports the exact raw amount, balance, allowance, and required allowance before an intent can be submitted.

When the fee token is the same as collateral, the allowance must cover collateral amount + extraFee + anti-DDoS fee. When it is different, each asset only needs its own required amount.

## 6. Verify before the first order

Read:

```text
GET /api/leverup/preflight?orderType=limit&symbol=MON/USD&leverage=5
```

The response must show all of these as ready:

- hosted agent authorization and explicit permissions
- WMON balance
- WMON allowance
- an enabled fee token with sufficient balance
- fee-token allowance

Only then should a live LIMIT_OPEN be allowed.

## Important current protocol state

The live execution-fee endpoint currently reports LIMIT_OPEN enabled while MARKET_OPEN and MARKET_CLOSE are disabled. That means the first live path should use LIMIT_OPEN, and the close path must be re-checked before relying on gasless MARKET_CLOSE.

Sources:
- https://developer-docs.leverup.xyz/gasless/overview
- https://developer-docs.leverup.xyz/gasless/authorization
- https://developer-docs.leverup.xyz/gasless/actions
- https://docs.leverup.xyz/reference/contract-addresses
