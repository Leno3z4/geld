import { createPublicClient, createWalletClient, defineChain, formatUnits, http, parseAbi, parseUnits, keccak256, encodeAbiParameters, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";

const MONAD = defineChain({
  id: 143,
  name: "Monad Mainnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } }
});

const WMON = "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A" as Address;
const LVMON = "0x91b81bfbe3A747230F0529Aa28d8b2Bc898E6D56" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const ONECLICK_BASE = "https://oneclick-01-keeper.leverup.xyz";
const MARKET_API_BASE = "https://service.leverup.xyz";
const ONECLICK_DIAMOND = "0xea1b8E4aB7f14F7dCA68c5B214303B13078FC5ec" as Address;

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function deposit() payable"
]);

const AGENT_AUTH_ABI = [{
  type: "function",
  name: "getAgentAuth",
  stateMutability: "view",
  inputs: [
    { name: "trader", type: "address" },
    { name: "agent", type: "address" }
  ],
  outputs: [{
    name: "",
    type: "tuple",
    components: [
      { name: "agent", type: "address" },
      { name: "name", type: "bytes32" },
      { name: "permissions", type: "uint256" },
      { name: "authorizedAt", type: "uint32" }
    ]
  }]
}] as const;

const AGENT_NONCE_ABI = [{
  type: "function",
  name: "getLastNonce",
  stateMutability: "view",
  inputs: [
    { name: "trader", type: "address" },
    { name: "signer", type: "address" }
  ],
  outputs: [{ name: "", type: "uint64" }]
}] as const;

const ACTION_MARKET_OPEN = 0;
const ACTION_MARKET_CLOSE = 1;
const ACTION_LIMIT_OPEN = 2;
const ACTION_LIMIT_CANCEL = 3;
const MAX_UINT256 = (2n ** 256n) - 1n;
const ACTION_NAMES: Record<number, string> = {
  0: "OneClickMarketOpen",
  1: "OneClickMarketClose",
  2: "OneClickLimitOpen",
  3: "OneClickLimitCancel"
};

const COMMON_FIELDS = [
  { name: "trader", type: "address" },
  { name: "action", type: "uint8" },
  { name: "nonce", type: "uint64" },
  { name: "deadline", type: "uint48" },
  { name: "feeToken", type: "address" },
  { name: "antiDdosFee", type: "uint96" },
  { name: "actionDataHash", type: "bytes32" }
] as const;

type LeverUpPair = {
  base: Address;
  pairName: string;
  symbol: string;
  status?: string;
  pairType?: string;
  minHoldingSeconds?: number;
  volumeUSD?: string;
  pythPriceFeedId?: string | null;
};

type FeeOption = {
  action: number;
  actionName?: string;
  feeToken: Address;
  antiDdosFee: string;
  enabled: boolean;
  priority: number;
};

let pairsCache: { at: number; pairs: LeverUpPair[] } | null = null;
let feeCache: { at: number; options: FeeOption[] } | null = null;
let nonce = 0n;

function clients() {
  const account = privateKeyToAccount(config.privateKey as Hex);
  const publicClient = createPublicClient({ chain: MONAD, transport: http(config.rpcUrl) });
  const walletClient = createWalletClient({ account, chain: MONAD, transport: http(config.rpcUrl) });
  return { account, publicClient, walletClient };
}

function getSigningAccount() {
  if (!config.leverUpAgentPrivateKey) return clients().account;
  try {
    return privateKeyToAccount(config.leverUpAgentPrivateKey as Hex);
  } catch {
    throw new Error("LEVERUP_AGENT_PRIVATE_KEY must be a valid 32-byte hex private key");
  }
}

async function getAgentAuthorization(trader: Address, agent: Address) {
  const { publicClient } = clients();
  const auth = await publicClient.readContract({
    address: ONECLICK_DIAMOND,
    abi: AGENT_AUTH_ABI,
    functionName: "getAgentAuth",
    args: [trader, agent]
  });
  const requiredPermissions = config.leverUpAgentPermissionMask;
  const authorized = auth.agent !== ZERO;
  const hasConfiguredPermissions = auth.permissions === MAX_UINT256
    || (auth.permissions & requiredPermissions) === requiredPermissions;
  return {
    authorized,
    agent: auth.agent as Address,
    name: auth.name as Hex,
    permissions: auth.permissions.toString(),
    authorizedAt: Number(auth.authorizedAt),
    requiredPermissions: requiredPermissions.toString(),
    requiredPermissionsHex: "0x" + requiredPermissions.toString(16),
    hasConfiguredPermissions,
    permissionsReady: authorized && hasConfiguredPermissions
  };
}

export async function getLeverUpAgentStatus() {
  const trader = clients().account.address;
  if (!config.leverUpAgentPrivateKey) {
    return {
      mode: "SELF_SIGNING",
      trader,
      signer: trader,
      agentConfigured: false,
      authorizationRequired: false,
      authorization: null
    };
  }

  const signer = getSigningAccount();
  if (signer.address.toLowerCase() === trader.toLowerCase()) {
    throw new Error("LEVERUP_AGENT_PRIVATE_KEY must belong to a distinct agent wallet");
  }

  const authorization = await getAgentAuthorization(trader, signer.address);
  return {
    mode: "HOSTED_AGENT",
    trader,
    signer: signer.address,
    agentConfigured: true,
    authorizationRequired: true,
    authorization
  };
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}: ${text.slice(0, 500)}`);
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`${url} returned non-JSON: ${text.slice(0, 500)}`); }
}

async function getPairs(force = false): Promise<LeverUpPair[]> {
  if (!force && pairsCache && Date.now() - pairsCache.at < 60_000) return pairsCache.pairs;
  const body = await jsonFetch<{ content?: LeverUpPair[] }>(
    `${MARKET_API_BASE}/v1/pairs?block_chain=MONAD&is_ready_to_display=true&page=0&size=100`
  );
  const pairs = (body.content ?? []).filter((p) => p.status !== "CLOSE");
  if (!pairs.length) throw new Error("LeverUp REST returned no tradable pairs");
  pairsCache = { at: Date.now(), pairs };
  return pairs;
}

function normalizeSymbol(symbol: string) {
  const s = symbol.toUpperCase().trim();
  return s.endsWith("/USD") ? s : `${s}/USD`;
}

async function getPair(symbol: string): Promise<LeverUpPair> {
  const wanted = normalizeSymbol(symbol);
  const pairs = await getPairs();
  const pair = pairs.find((p) => p.pairName.toUpperCase() === wanted || p.symbol.toUpperCase() === wanted.replace("/USD", ""));
  if (!pair) throw new Error(`LeverUp market not found: ${symbol}`);
  if (pair.status !== "AVAILABLE") throw new Error(`LeverUp market ${pair.pairName} is ${pair.status}`);
  return pair;
}

async function latestPrices(pairBases: Address[]) {
  const body = await jsonFetch<any>(`${MARKET_API_BASE}/v1/oracle/price/pairs/latest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ blockChain: "MONAD", pairBases })
  });
  const rows = Array.isArray(body) ? body : body.content ?? body.data ?? body.prices ?? [];
  const list = Array.isArray(rows) ? rows : Object.entries(rows).map(([pairBase, value]) => ({ pairBase, value }));
  const out = new Map<string, number>();
  for (const row of list as any[]) {
    const base = String(row.pairBase ?? row.base ?? row.pair ?? "").toLowerCase();
    const raw = row.price ?? row.priceUsd ?? row.markPrice ?? row.value;
    const price = Number(raw) / 1e18;
    if (base && Number.isFinite(price) && price > 0) out.set(base, price);
  }
  if (!out.size) throw new Error("LeverUp REST returned no usable latest prices");
  return out;
}

async function getMarketPrice(pair: LeverUpPair) {
  const prices = await latestPrices([pair.base]);
  const price = prices.get(pair.base.toLowerCase());
  if (!price) throw new Error(`No latest price for ${pair.pairName}`);
  return price;
}

async function getMonPrice() {
  const pair = await getPair("MON/USD");
  return getMarketPrice(pair);
}

async function refreshFeeConfig(force = false): Promise<FeeOption[]> {
  if (!force && feeCache && Date.now() - feeCache.at < 60_000) return feeCache.options;
  const body = await jsonFetch<any>(`${ONECLICK_BASE}/v2/trading/anti-ddos-config`);
  const options = (Array.isArray(body) ? body : body.content ?? body.data ?? [])
    .map((x: any) => ({
      action: Number(x.action),
      actionName: x.actionName,
      feeToken: String(x.feeToken) as Address,
      antiDdosFee: String(x.antiDdosFee ?? "0"),
      enabled: Boolean(x.enabled),
      priority: Number(x.priority ?? 999)
    }))
    .filter((x: FeeOption) => x.enabled);
  feeCache = { at: Date.now(), options };
  return options;
}

async function chooseFeeToken(additionalSpend: bigint, action = ACTION_MARKET_OPEN) {
  const { account, publicClient } = clients();
  const options = (await refreshFeeConfig()).filter((x) => x.action === action);
  if (!options.length) {
    const all = await refreshFeeConfig(true);
    const configured = all.filter((x) => x.action === action);
    const name = ACTION_NAMES[action] ?? `action ${action}`;
    if (!configured.length || configured.every((x) => !x.enabled)) {
      throw new Error(`LeverUp ${name} is currently disabled by the live 1CT relayer`);
    }
  }
  for (const option of options.sort((a, b) => a.priority - b.priority)) {
    if (option.feeToken === ZERO) continue;
    const [balance, allowance] = await Promise.all([
      publicClient.readContract({ address: option.feeToken, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] }),
      publicClient.readContract({ address: option.feeToken, abi: ERC20_ABI, functionName: "allowance", args: [account.address, ONECLICK_DIAMOND] })
    ]);
    const required = BigInt(option.antiDdosFee) + (option.feeToken.toLowerCase() === WMON.toLowerCase() ? additionalSpend : 0n);
    if (balance >= required && allowance >= required) return { feeToken: option.feeToken, antiDdosFee: BigInt(option.antiDdosFee) };
  }
  return null;
}

function buildActionData(action: number, trader: Address, values: unknown[]): Hex {
  const types = action === ACTION_MARKET_OPEN
    ? ["address", "bool", "address", "address", "uint96", "uint128", "uint128", "uint128", "uint128", "uint24", "uint96"]
    : action === ACTION_LIMIT_OPEN
      ? ["address", "bool", "address", "address", "uint96", "uint128", "uint128", "uint128", "uint128", "uint24", "uint96"]
      : action === ACTION_MARKET_CLOSE
        ? ["bytes32", "uint24"]
        : (() => { throw new Error(`LeverUp actionData schema is not verified for action ${action}; refusing to submit.`); })();
  const full = (awaitableEncode as any)(types, [trader, ...values]);
  return `0x${full.slice(2 + 64)}` as Hex;
}

function awaitableEncode(types: string[], values: unknown[]) {
  return encodeAbiParameters(types.map((type) => ({ type })), values as any);
}

async function submitIntent(action: number, trader: Address, values: unknown[], feeToken: Address, antiDdosFee: bigint) {
  const { account } = clients();
  if (account.address.toLowerCase() !== trader.toLowerCase()) throw new Error("1CT self-signing requires signer == trader");
  const actionData = buildActionData(action, trader, values);
  const actionDataHash = keccak256(actionData);
  const now = BigInt(Date.now());
  nonce = now > nonce ? now : nonce + 1n;
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const typeName = ACTION_NAMES[action];

  const signature = await account.signTypedData({
    domain: { name: "LeverupOneClickV2", version: "1", chainId: 143, verifyingContract: ONECLICK_DIAMOND },
    types: { [typeName]: COMMON_FIELDS },
    primaryType: typeName,
    message: { trader, action, nonce, deadline, feeToken, antiDdosFee, actionDataHash }
  } as any);

  const result = await fetch(`${ONECLICK_BASE}/v2/trading/submit-intent?blockchain=MONAD`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      trader,
      action,
      nonce: nonce.toString(),
      deadline,
      feeToken,
      antiDdosFee: antiDdosFee.toString(),
      actionData,
      signature
    })
  });
  const text = await result.text();
  if (!result.ok) throw new Error(`LeverUp intent HTTP ${result.status}: ${text.slice(0, 500)}`);
  return text.replace(/^"|"$/g, "");
}

async function pollIntent(intentHash: string, timeout = 300_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const status = await jsonFetch<any>(`${ONECLICK_BASE}/v2/trading/${intentHash}/status`);
    if (status.executed || status.skipped) return status;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`LeverUp intent timed out: ${intentHash}`);
}

export interface LeverUpQuote {
  symbol: string;
  leverage: number;
  marginMon: number;
  marginUsd: number;
  notionalUsd: number;
  entryPriceUsd: number;
  qty: bigint;
  openFeeMon: number;
  warnings: string[];
}

export async function getLeverUpQuote(symbol: string, marginMon: number, leverage = config.leverUpDefaultLeverage): Promise<LeverUpQuote> {
  if (!Number.isFinite(marginMon) || marginMon <= 0) throw new Error("marginMon must be positive");
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > config.leverUpMaxLeverage) throw new Error("LeverUp leverage exceeds safety cap");
  const pair = await getPair(symbol);
  const [entry, monPrice] = await Promise.all([getMarketPrice(pair), getMonPrice()]);
  const marginUsd = marginMon * monPrice;
  const notionalUsd = marginUsd * leverage;
  const openFeePct = leverage >= 500 ? 0 : 0.0003;
  const openFeeMon = notionalUsd * openFeePct / Math.max(monPrice, 1e-18);
  if (notionalUsd < config.leverUpMinNotionalUsd) {
    throw new Error(`Minimum configured LeverUp notional is $${config.leverUpMinNotionalUsd}; calculated $${notionalUsd.toFixed(4)}`);
  }
  if (marginUsd < config.leverUpMinMarginUsd) throw new Error(`Configured minimum margin is $${config.leverUpMinMarginUsd}`);
  const qty = BigInt(Math.floor((notionalUsd * 1e10) / entry));
  const warnings: string[] = [];
  if (marginUsd < 10) warnings.push("Margin is below the published $10 recommended level.");
  return { symbol: pair.pairName, leverage, marginMon, marginUsd, notionalUsd, entryPriceUsd: entry, qty, openFeeMon, warnings };
}

async function ensureWmon(amountMon: number) {
  const { account, publicClient, walletClient } = clients();
  const amount = parseUnits(amountMon.toFixed(18), 18);
  const balance = await publicClient.readContract({ address: WMON, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] });
  if (balance >= amount) return { wrapped: false, txHash: null };
  const txHash = await walletClient.writeContract({
    account, chain: MONAD, address: WMON, abi: ERC20_ABI, functionName: "deposit", value: amount - balance
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { wrapped: true, txHash };
}

async function ensureApproval(token: Address, amount: bigint) {
  const { account, publicClient, walletClient } = clients();
  const allowance = await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [account.address, ONECLICK_DIAMOND] });
  if (allowance >= amount) return null;
  return walletClient.writeContract({ account, chain: MONAD, address: token, abi: ERC20_ABI, functionName: "approve", args: [ONECLICK_DIAMOND, 2n ** 256n - 1n] });
}

export async function openLeverUpMonTrade(symbol: string, marginMon: number, leverage: number, isLong: boolean, stopLossUsd = 0, takeProfitUsd = 0) {
  if (!config.leverUpEnabled) throw new Error("LeverUp adapter disabled");
  if (!config.liveTrading) throw new Error("LeverUp adapter requires LIVE_TRADING=true");

  const { account } = clients();
  const q = await getLeverUpQuote(symbol, marginMon, leverage);
  const pair = await getPair(symbol);
  const entry = q.entryPriceUsd;
  const sl = stopLossUsd > 0 ? parseUnits(stopLossUsd.toFixed(18), 18) : 0n;
  const tp = takeProfitUsd > 0 ? parseUnits(takeProfitUsd.toFixed(18), 18) : 0n;
  if (isLong && sl && stopLossUsd >= entry) throw new Error("Long SL must be below entry");
  if (!isLong && sl && stopLossUsd <= entry) throw new Error("Short SL must be above entry");
  if (isLong && tp && takeProfitUsd <= entry) throw new Error("Long TP must be above entry");
  if (!isLong && tp && takeProfitUsd >= entry) throw new Error("Short TP must be below entry");

  const amountIn = parseUnits(q.marginMon.toFixed(18), 18) + parseUnits(q.openFeeMon.toFixed(18), 18);

  // Live LeverUp currently enables LIMIT_OPEN (action 2) while MARKET_OPEN (action 0) is disabled.
  // Production validation requires LONG triggers below market and SHORT triggers above market.
  const triggerBufferPct = Math.min(Math.max(config.slippagePct, 0.01), 1);
  const limitPriceUsd = entry * (isLong ? 1 - triggerBufferPct / 100 : 1 + triggerBufferPct / 100);
  if (isLong && limitPriceUsd >= entry) throw new Error("Long limit price must be below market");
  if (!isLong && limitPriceUsd <= entry) throw new Error("Short limit price must be above market");

  const fee = await chooseFeeToken(amountIn, ACTION_LIMIT_OPEN);
  if (!fee) throw new Error("No enabled LeverUp limit-open execution-fee token has enough balance/allowance.");

  const { publicClient } = clients();
  const wmonBalance = await publicClient.readContract({
    address: WMON, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address]
  });
  if (wmonBalance < amountIn) {
    throw new Error(`Insufficient WMON collateral: have ${formatUnits(wmonBalance, 18)} MON-equivalent, need ${marginMon}`);
  }
  const wmonAllowance = await publicClient.readContract({
    address: WMON, abi: ERC20_ABI, functionName: "allowance", args: [account.address, ONECLICK_DIAMOND]
  });
  if (wmonAllowance < amountIn) {
    throw new Error("WMON is not approved to LeverUp Diamond yet; approve once before live trading.");
  }

  const actionValues = [
    pair.base,
    isLong,
    WMON,
    LVMON,
    amountIn,
    q.qty,
    parseUnits(limitPriceUsd.toFixed(18), 18),
    sl,
    tp,
    0,
    0n
  ];

  // LIMIT_OPEN returns after the intent is accepted; execution can remain pending until the trigger is reached.
  const intentHash = await submitIntent(
    ACTION_LIMIT_OPEN,
    account.address,
    actionValues,
    fee.feeToken,
    fee.antiDdosFee
  );

  return {
    intentHash,
    txHash: "",
    symbol: pair.pairName,
    leverage,
    marginMon,
    notionalUsd: q.notionalUsd,
    orderType: "LIMIT",
    limitPriceUsd,
    pending: true
  };
}
export async function closeLeverUpTrade(positionHash: Hex) {
  if (!config.leverUpEnabled || !config.liveTrading) throw new Error("LeverUp live adapter disabled");
  const { account } = clients();
  const fee = await chooseFeeToken(0n, ACTION_MARKET_CLOSE);
  if (!fee) throw new Error("No enabled close execution-fee token available");
  const intentHash = await submitIntent(ACTION_MARKET_CLOSE, account.address, [positionHash, 0], fee.feeToken, fee.antiDdosFee);
  return { intentHash, status: await pollIntent(intentHash) };
}

export async function getLeverUpMarketSnapshots() {
  const pairs = (await getPairs()).filter((p) => p.status === "AVAILABLE" && p.pairType === "CRYPTO");
  const selected = pairs.filter((p) => ["MON", "BTC", "ETH"].includes(p.symbol.toUpperCase())).slice(0, 8);
  if (!selected.length) throw new Error("LeverUp REST has no supported crypto markets for GELD");
  const prices = await latestPrices(selected.map((p) => p.base));
  return selected.flatMap((p) => {
    const price = prices.get(p.base.toLowerCase());
    return price ? [{ symbol: p.pairName, price, ts: Date.now() }] : [];
  });
}

export async function probeLeverUpMinimums(symbol = "MON/USD", leverage = 5, action = ACTION_MARKET_OPEN) {
  const { account, publicClient } = clients();
  const pair = await getPair(symbol);
  const [balanceMon, monPrice] = await Promise.all([
    publicClient.getBalance({ address: account.address }).then((x) => Number(formatUnits(x, 18))),
    getMonPrice()
  ]);
  const maxAllowedMarginMon = balanceMon * config.leverUpMaxMarginPct / 100;
  const candidates = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5].filter((x) => x <= maxAllowedMarginMon);
  const results: Array<Record<string, unknown>> = [];

  for (const marginMon of candidates) {
    try {
      const q = await getLeverUpQuote(pair.pairName, marginMon, leverage);
      const amountIn = parseUnits(q.marginMon.toFixed(18), 18) + parseUnits(q.openFeeMon.toFixed(18), 18);
      const fee = await chooseFeeToken(amountIn, action);
      if (!fee) {
        results.push({
          marginMon,
          marginUsd: q.marginUsd,
          notionalUsd: q.notionalUsd,
          openFeeMon: q.openFeeMon,
          accepted: false,
          hasFeeToken: false,
          wmonBalanceMon: 0,
          wmonApproved: false,
          reason: "missing execution-fee token/allowance"
        });
        // Fee-token readiness is monotonic across larger margins: non-WMON fees are fixed,
        // while WMON requires at least as much collateral as the margin grows. Stop probing.
        break;
      }
      const wmonBalance = await publicClient.readContract({ address: WMON, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] });
      const wmonAllowance = await publicClient.readContract({ address: WMON, abi: ERC20_ABI, functionName: "allowance", args: [account.address, ONECLICK_DIAMOND] });
      results.push({
        marginMon, marginUsd: q.marginUsd, notionalUsd: q.notionalUsd, openFeeMon: q.openFeeMon,
        accepted: wmonBalance >= amountIn && wmonAllowance >= amountIn,
        hasFeeToken: true,
        wmonBalanceMon: Number(formatUnits(wmonBalance, 18)),
        wmonApproved: wmonAllowance >= amountIn,
        reason: wmonBalance < amountIn ? "insufficient WMON" : wmonAllowance < amountIn ? "WMON approval required" : "ready for 1CT submission"
      });
      if (wmonBalance < amountIn || wmonAllowance < amountIn) break;
    } catch (error) {
      const message = String(error).slice(0, 500);
      results.push({ marginMon, accepted: false, error: message });
      if (message.includes("currently disabled by the live 1CT relayer")) break;
    }
  }

  return {
    mode: "1CT_SELF_SIGNING",
    oracle: "LEVERUP_RELAYER",
    action,
    actionName: ACTION_NAMES[action] ?? `action ${action}`,
    balanceMon,
    monPriceUsd: monPrice,
    maxAllowedMarginMon,
    pair: pair.pairName,
    leverage,
    results,
    firstReady: results.find((x) => x.accepted) ?? null
  };
}

export function listLeverUpPairs() {
  return (pairsCache?.pairs ?? []).map((p) => ({ symbol: p.pairName, pairBase: p.base, status: p.status }));
}
