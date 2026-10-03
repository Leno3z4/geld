import { createPublicClient, createWalletClient, defineChain, formatUnits, http, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";

const MONAD = defineChain({ id: 143, name: "Monad Mainnet", nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } });
const PYTH = "0x2880aB155794e7179c9eE2e38200202908C17B43" as Address;
const WMON = "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A" as Address;
const LVMON = "0x91b81bfbe3A747230F0529Aa28d8b2Bc898E6D56" as Address;

const PYTH_ABI = parseAbi(["function getUpdateFee(bytes[] updateData) view returns (uint256)"]);
const TRADING_ABI = parseAbi([
  "function openMarketTradeWithPyth((address pairBase,bool isLong,address tokenIn,address lvToken,uint96 amountIn,uint128 qty,uint128 price,uint128 stopLoss,uint128 takeProfit,uint24 broker) data,bytes[] priceUpdateData) payable returns (bytes32 tradeHash)",
  "function closeTrade(bytes32 tradeHash)"
]);

type Pair = { symbol: string; pairBase: Address; pythId: Hex; highLeverage: boolean };
const PAIRS: Pair[] = [
  { symbol: "BTC/USD", pairBase: "0xcf5a6076cfa32686c0df13abada2b40dec133f1d", pythId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", highLeverage: false },
  { symbol: "ETH/USD", pairBase: "0xb5a30b0fdc5ea94a52fdc42e3e9760cb8449fb37", pythId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", highLeverage: false },
  { symbol: "MON/USD", pairBase: WMON, pythId: "0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1", highLeverage: false },
  { symbol: "500BTC/USD", pairBase: "0x0000000000000000000000000000000000000003", pythId: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43", highLeverage: true },
  { symbol: "500ETH/USD", pairBase: "0x0000000000000000000000000000000000000004", pythId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", highLeverage: true }
];
const HIGH_LEVERAGE = new Set([500, 750, 1001]);

function getPair(symbol: string) {
  const n = symbol.toUpperCase().trim();
  const p = PAIRS.find((x) => x.symbol === n || x.symbol === n + "/USD");
  if (!p) throw new Error("Unsupported LeverUp pair: " + symbol);
  return p;
}

async function pyth(p: Pair) {
  const u = new URL(config.leverUpPythHermesUrl + "/v2/updates/price/latest");
  u.searchParams.set("ids[]", p.pythId);
  const r = await fetch(u.toString());
  if (!r.ok) throw new Error("Pyth HTTP " + r.status);
  const b = await r.json() as any;
  const x = b.parsed?.[0]?.price;
  if (!x || !b.binary?.data?.length) throw new Error("Pyth returned no price");
  const e = 18 + Number(x.expo);
  if (e < 0) throw new Error("Unsupported Pyth exponent");
  return { price: BigInt(x.price) * 10n ** BigInt(e), data: b.binary.data.map((v: string) => (v.startsWith("0x") ? v : "0x" + v) as Hex) };
}

function clients() {
  const account = privateKeyToAccount(config.privateKey as Hex);
  const publicClient = createPublicClient({ chain: MONAD, transport: http(config.rpcUrl) });
  const walletClient = createWalletClient({ account, chain: MONAD, transport: http(config.rpcUrl) });
  return { account, publicClient, walletClient };
}

async function monUsd() {
  return Number(formatUnits((await pyth(getPair("MON/USD"))).price, 18));
}

export interface LeverUpQuote {
  symbol: string; leverage: number; marginMon: number; marginUsd: number; notionalUsd: number;
  entryPriceUsd: number; qty: bigint; openFeeMon: number; highLeverage: boolean;
  liquidationDistancePct: number; warnings: string[];
}

export async function getLeverUpQuote(symbol: string, marginMon: number, leverage = config.leverUpDefaultLeverage): Promise<LeverUpQuote> {
  if (!Number.isFinite(marginMon) || marginMon <= 0) throw new Error("marginMon must be positive");
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > config.leverUpMaxLeverage) throw new Error("LeverUp leverage exceeds safety cap");
  const p = getPair(symbol);
  if (p.highLeverage && !HIGH_LEVERAGE.has(leverage)) throw new Error("High-leverage markets require 500x, 750x, or 1001x");
  if (!p.highLeverage && leverage > 100) throw new Error("Standard markets are capped at 100x by this adapter");
  const [asset, monPrice] = await Promise.all([pyth(p), monUsd()]);
  const entry = Number(formatUnits(asset.price, 18));
  const marginUsd = marginMon * monPrice;
  const notionalUsd = marginUsd * leverage;
  if (notionalUsd < config.leverUpMinNotionalUsd) throw new Error("Minimum LeverUp notional is $" + config.leverUpMinNotionalUsd + "; order is $" + notionalUsd.toFixed(2));
  if (marginUsd < config.leverUpMinMarginUsd) throw new Error("Adapter minimum margin is $" + config.leverUpMinMarginUsd);
  const qty = BigInt(Math.floor((notionalUsd * 1e10) / entry));
  const high = p.highLeverage;
  const openFeeMon = high ? 0 : marginMon * leverage * 0.00045;
  const feeUsd = high ? 0 : notionalUsd * 0.00045;
  const liquidationDistancePct = Math.max(0, (85 - (feeUsd / Math.max(marginUsd, 1e-18)) * 100) / leverage);
  const warnings: string[] = [];
  if (marginUsd < 10) warnings.push("Margin is below the published $10 recommended level.");
  if (high) warnings.push("500x+ leverage has an extremely small liquidation buffer; use a hard SL.");
  return { symbol: p.symbol, leverage, marginMon, marginUsd, notionalUsd, entryPriceUsd: entry, qty, openFeeMon, highLeverage: high, liquidationDistancePct, warnings };
}

export async function openLeverUpMonTrade(symbol: string, marginMon: number, leverage: number, isLong: boolean, stopLossUsd = 0, takeProfitUsd = 0) {
  if (!config.leverUpEnabled) throw new Error("LeverUp adapter disabled: set LEVERUP_ENABLED=true");
  if (!config.liveTrading) throw new Error("LeverUp adapter requires LIVE_TRADING=true");
  const { account, publicClient, walletClient } = clients();
  const balanceMon = Number(formatUnits(await publicClient.getBalance({ address: account.address }), 18));
  const maxMarginMon = balanceMon * config.leverUpMaxMarginPct / 100;
  if (marginMon > maxMarginMon) {
    throw new Error("LeverUp risk gate: margin " + marginMon.toFixed(6) + " MON exceeds " + config.leverUpMaxMarginPct + "% wallet allocation (" + maxMarginMon.toFixed(6) + " MON)");
  }
  if (stopLossUsd <= 0) throw new Error("LeverUp risk gate: a stop-loss is mandatory for live trades");
  const q = await getLeverUpQuote(symbol, marginMon, leverage);
  const p = getPair(symbol);
  const asset = await pyth(p);
  const stopDistancePct = Math.abs((stopLossUsd / q.entryPriceUsd) - 1) * 100;
  const estimatedStopLossUsd = q.notionalUsd * stopDistancePct / 100;
  const equityUsd = balanceMon * q.marginUsd / Math.max(marginMon, 1e-18);
  const maxRiskUsd = equityUsd * config.leverUpRiskPerTradePct / 100;
  if (estimatedStopLossUsd > maxRiskUsd) {
    throw new Error("LeverUp risk gate: stop-loss risk $" + estimatedStopLossUsd.toFixed(4) + " exceeds " + config.leverUpRiskPerTradePct + "% equity risk $" + maxRiskUsd.toFixed(4));
  }
  const oracleFee = await publicClient.readContract({ address: PYTH, abi: PYTH_ABI, functionName: "getUpdateFee", args: [asset.data] }) as bigint;
  const value = parseUnits((marginMon + q.openFeeMon).toFixed(18), 18) + oracleFee;
  if (await publicClient.getBalance({ address: account.address }) < value) throw new Error("Insufficient MON for margin, LeverUp fee and oracle fee");
  const sl = stopLossUsd > 0 ? parseUnits(stopLossUsd.toFixed(18), 18) : 0n;
  const tp = takeProfitUsd > 0 ? parseUnits(takeProfitUsd.toFixed(18), 18) : 0n;
  if (isLong && sl && sl >= asset.price) throw new Error("Long SL must be below entry");
  if (!isLong && sl && sl <= asset.price) throw new Error("Short SL must be above entry");
  if (isLong && tp && tp <= asset.price) throw new Error("Long TP must be above entry");
  if (!isLong && tp && tp >= asset.price) throw new Error("Short TP must be below entry");
  const data = { pairBase: p.pairBase, isLong, tokenIn: WMON, lvToken: LVMON, amountIn: parseUnits((marginMon + q.openFeeMon).toFixed(18), 18), qty: q.qty, price: asset.price, stopLoss: sl, takeProfit: tp, broker: 0 };
  const txHash = await walletClient.writeContract({ account, chain: MONAD, address: config.leverUpDiamond as Address, abi: TRADING_ABI, functionName: "openMarketTradeWithPyth", args: [data, asset.data], value });
  return { txHash, symbol: p.symbol, leverage, marginMon, notionalUsd: q.notionalUsd };
}

export async function closeLeverUpTrade(tradeHash: Hex) {
  if (!config.leverUpEnabled) throw new Error("LeverUp adapter disabled");
  if (!config.liveTrading) throw new Error("LeverUp adapter requires LIVE_TRADING=true");
  const { account, walletClient } = clients();
  return walletClient.writeContract({ account, chain: MONAD, address: config.leverUpDiamond as Address, abi: TRADING_ABI, functionName: "closeTrade", args: [tradeHash] });
}

export function listLeverUpPairs() { return PAIRS.map((p) => ({ symbol: p.symbol, pairBase: p.pairBase, highLeverage: p.highLeverage })); }
