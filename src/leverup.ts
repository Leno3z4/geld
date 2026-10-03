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
  "function approve(address,uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function deposit() payable"
]);

const ACTION_MARKET_OPEN = 0;
const ACTION_MARKET_CLOSE = 1;
const ACTION_NAMES: Record<number, string> = {
  0: "OneClickMarketOpen",
  1: "OneClickMarketClose"
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
  const list = Array.isArray(rows) ? rows : Object.entries(rows).map(([pairBase, value]) => ({ pairBase, ...(value as any) }));
  const out = new Map<string, number>();
  for (const row of list as any[]) {
    const base = String(row.pairBase ?? row.base ?? row.pair ?? "").toLowerCase();
    const raw = row.price ?? row.priceUsd ?? row.markPrice ?? row.value;
    const price = Number(raw);
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
    .filter((x: FeeOption) => x.enabled && x.action === ACTION_MARKET_OPEN);
  feeCache = { at: Date.now(), options };
  return options;
}

async function chooseFeeToken(additionalSpend: bigint) {
  const { account, publicClient } = clients();
  const options = await refreshFeeConfig();
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
    : ["bytes32", "uint24"];
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
  warnings: string[];
}

export async function getLeverUpQuote(symbol: string, marginMon: number, leverage = config.leverUpDefaultLeverage): Promise<LeverUpQuote> {
  if (!Number.isFinite(marginMon) || marginMon <= 0) throw new Error("marginMon must be positive");
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > config.leverUpMaxLeverage) throw new Error("LeverUp leverage exceeds safety cap");
  const pair = await getPair(symbol);
  const [entry, monPrice] = await Promise.all([getMarketPrice(pair), getMonPrice()]);
  const marginUsd = marginMon * monPrice;
  const notionalUsd = marginUsd * leverage;
  if (notionalUsd < config.leverUpMinNotionalUsd) {
    throw new Error(`Minimum configured LeverUp notional is $${config.leverUpMinNotionalUsd}; calculated $${notionalUsd.toFixed(4)}`);
  }
  if (marginUsd < config.leverUpMinMarginUsd) throw new Error(`Configured minimum margin is $${config.leverUpMinMarginUsd}`);
  const qty = BigInt(Math.floor((notionalUsd * 1e10) / entry));
  const warnings: string[] = [];
  if (marginUsd < 10) warnings.push("Margin is below the published $10 recommended level.");
  return { symbol: pair.pairName, leverage, marginMon, marginUsd, notionalUsd, entryPriceUsd: entry, qty, warnings };
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

  const amountIn = parseUnits(marginMon.toFixed(18), 18);
  const fee = await chooseFeeToken(amountIn);
  if (!fee) throw new Error("No enabled LeverUp execution-fee token has enough balance/allowance. WMON collateral + approval may be required.");

  const { publicClient } = clients();
  const wmonBalance = await publicClient.readContract({ address: WMON, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] });
  if (wmonBalance < amountIn) throw new Error(`Insufficient WMON collateral: have ${formatUnits(wmonBalance, 18)} MON-equivalent, need ${marginMon}`);
  const wmonAllowance = await publicClient.readContract({ address: WMON, abi: ERC20_ABI, functionName: "allowance", args: [account.address, ONECLICK_DIAMOND] });
  if (wmonAllowance < amountIn) throw new Error("WMON is not approved to LeverUp Diamond yet; approve once before live trading.");

  const actionValues = [
    pair.base, isLong, WMON, LVMON, amountIn, q.qty,
    parseUnits(entry.toFixed(18), 18), sl, tp, 0, 0n
  ];

  const intentHash = await submitIntent(ACTION_MARKET_OPEN, account.address, actionValues, fee.feeToken, fee.antiDdosFee);
  const status = await pollIntent(intentHash);
  if (!status.success) throw new Error(`LeverUp intent ${intentHash} failed: ${status.skipReason ?? status.reason ?? "unknown"}`);
  return { intentHash, txHash: status.txnHash ?? "", symbol: pair.pairName, leverage, marginMon, notionalUsd: q.notionalUsd };
}

export async function closeLeverUpTrade(positionHash: Hex) {
  if (!config.leverUpEnabled || !config.liveTrading) throw new Error("LeverUp live adapter disabled");
  const { account } = clients();
  const fee = await chooseFeeToken(0n);
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

export async function probeLeverUpMinimums(symbol = "MON/USD", leverage = 5) {
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
      const amountIn = parseUnits(marginMon.toFixed(18), 18);
      const fee = await chooseFeeToken(amountIn);
      const wmonBalance = await publicClient.readContract({ address: WMON, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] });
      const wmonAllowance = await publicClient.readContract({ address: WMON, abi: ERC20_ABI, functionName: "allowance", args: [account.address, ONECLICK_DIAMOND] });
      results.push({
        marginMon, marginUsd: q.marginUsd, notionalUsd: q.notionalUsd,
        accepted: Boolean(fee && wmonBalance >= amountIn && wmonAllowance >= amountIn),
        hasFeeToken: Boolean(fee),
        wmonBalanceMon: Number(formatUnits(wmonBalance, 18)),
        wmonApproved: wmonAllowance >= amountIn,
        reason: !fee ? "missing execution-fee token/allowance" : wmonBalance < amountIn ? "insufficient WMON" : wmonAllowance < amountIn ? "WMON approval required" : "ready for 1CT submission"
      });
    } catch (error) {
      results.push({ marginMon, accepted: false, error: String(error).slice(0, 500) });
    }
  }

  return {
    mode: "1CT_SELF_SIGNING",
    oracle: "LEVERUP_RELAYER",
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
