import {
  createPublicClient,
  createWalletClient,
  formatUnits,
  parseAbi,
  parseEther,
  http,
  webSocket,
  type Address,
  type Hex,
  defineChain
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";

export const MONAD = defineChain({
  id: 143,
  name: "Monad Mainnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11" as Address,
      blockCreated: 9248132
    }
  }
});

export const ADDRESSES = {
  WMON: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A" as Address,
  ROUTER: "0x8986C8fD44eb85294A725a7e61AF35E76bA26F91" as Address,
  CURVE: "0x9f3832732923252A21044F21eE6bd87F09514ae4" as Address,
  FACTORY: "0xA25b13127e63ddae6d0b35570FF3D39dBD621001" as Address,
  V1_LENS: "0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea" as Address,
  V1_DEX_ROUTER: "0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137" as Address,
  V1_BONDING_ROUTER: "0x6F6B8F1a20703309951a5127c45B49b1CD981A22" as Address,
  LVMON: "0x91b81bfbe3A747230F0529Aa28d8b2Bc898E6D56" as Address,
  LVMON_FAST_REDEEM_VAULT: "0x06058fE1FcFAD19181438508600925106309e5fe" as Address
};

export const routerAbi = parseAbi([
  "function getAmountOut(address token,uint256 amountIn,bool isBuy) view returns (uint256)",
  "function isGraduated(address token) view returns (bool)",
  "function buyWithNative((uint256 amountOutMin,address token,address to,uint256 deadline) params) payable returns (uint256 amountOut)",
  "function sell((uint256 amountIn,uint256 amountOutMin,address token,address to,uint256 deadline) params) returns (uint256 amountOut)",
  "function sellToNative((uint256 amountIn,uint256 amountOutMin,address token,address to,uint256 deadline) params) returns (uint256 amountOut)"
]);

export const v1LensAbi = parseAbi([
  "function getAmountOut(address token,uint256 amountIn,bool isBuy) view returns (address router,uint256 amountOut)",
  "function isGraduated(address token) view returns (bool)",
  "function isLocked(address token) view returns (bool)"
]);

export const lvmonFastRedeemAbi = parseAbi([
  "function redeem(address tokenVault,uint256 amount)"
]);

export const wmonAbi = parseAbi([
  "function withdraw(uint256 amount)"
]);

export const v1DexRouterAbi = parseAbi([
  "function buy((uint256 amountOutMin,address token,address to,uint256 deadline) params) payable returns (uint256 amountOut)",
  "function sell((uint256 amountIn,uint256 amountOutMin,address token,address to,uint256 deadline) params) returns (uint256 amountOut)"
]);

export const factoryAbi = parseAbi([
  "function getPair(address tokenA,address tokenB) view returns (address pair)"
]);

export const nadFunPairAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "event Swap(address indexed sender,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out,address indexed to)"
]);

export const erc20Abi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 value)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
]);

export const curveAbi = parseAbi([
  "event Create(address indexed creator,address indexed token,address indexed pair,address quoteToken,string name,string symbol,string tokenURI,uint256 virtualQuoteReserve,uint256 virtualTokenReserve,uint256 minTokenReserve)",
  "event Buy(address indexed token,address indexed buyer,uint256 quoteIn,uint256 tokenOut)",
  "event Sell(address indexed token,address indexed seller,uint256 tokenIn,uint256 quoteOut)",
  "event Graduate(address indexed token,address indexed pair)",
  "event Sync(address indexed token,uint256 realQuoteReserve,uint256 realTokenReserve,uint256 virtualQuoteReserve,uint256 virtualTokenReserve)"
]);

export function clients() {
  const publicClient = createPublicClient({ chain: MONAD, transport: http(config.rpcUrl) });
  const account = config.privateKey.startsWith("0x") && config.privateKey.length === 66
    ? privateKeyToAccount(config.privateKey as Hex)
    : null;
  const walletClient = account
    ? createWalletClient({ account, chain: MONAD, transport: http(config.rpcUrl) })
    : null;
  return { publicClient, walletClient, account };
}

export function streamClient() {
  return config.wsUrl
    ? createPublicClient({ chain: MONAD, transport: webSocket(config.wsUrl) })
    : null;
}

export async function getBalance(publicClient: any, address: Address) {
  return Number(formatUnits(await publicClient.getBalance({ address }), 18));
}

export async function getTokenBalances(
  publicClient: any,
  tokens: Address[],
  owner: Address
): Promise<Map<string, bigint>> {
  if (tokens.length === 0) return new Map();

  const results = await publicClient.multicall({
    contracts: tokens.map((token) => ({
      address: token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [owner]
    })),
    allowFailure: true
  });

  const balances = new Map<string, bigint>();
  tokens.forEach((token, i) => {
    const result = results[i];
    if (result?.status === "success" && typeof result.result === "bigint") {
      balances.set(token.toLowerCase(), result.result);
    }
  });
  return balances;
}

export async function quoteSells(
  publicClient: any,
  requests: Array<{ token: Address; amountRaw: bigint }>
): Promise<Map<string, bigint>> {
  if (requests.length === 0) return new Map();

  const v2Results = await publicClient.multicall({
    contracts: requests.map(({ token, amountRaw }) => ({
      address: ADDRESSES.ROUTER,
      abi: routerAbi,
      functionName: "getAmountOut",
      args: [token, amountRaw, false]
    })),
    allowFailure: true
  });

  const quotes = new Map<string, bigint>();
  const fallback = requests.filter((_, i) => {
    const result = v2Results[i];
    return !(result?.status === "success" && typeof result.result === "bigint");
  });

  requests.forEach(({ token }, i) => {
    const result = v2Results[i];
    if (result?.status === "success" && typeof result.result === "bigint") {
      quotes.set(token.toLowerCase(), result.result);
    }
  });

  if (fallback.length) {
    const lensResults = await publicClient.multicall({
      contracts: fallback.map(({ token, amountRaw }) => ({
        address: ADDRESSES.V1_LENS,
        abi: v1LensAbi,
        functionName: "getAmountOut",
        args: [token, amountRaw, false]
      })),
      allowFailure: true
    });
    fallback.forEach(({ token }, i) => {
      const result = lensResults[i];
      const value = result?.status === "success" ? result.result as readonly [Address, bigint] : null;
      if (value && typeof value[1] === "bigint") quotes.set(token.toLowerCase(), value[1]);
    });
  }

  return quotes;
}

export async function getTokenBalance(publicClient: any, token: Address, address: Address) {
  return await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address]
  }) as bigint;
}

export async function getTokenDecimals(publicClient: any, token: Address) {
  return Number(await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "decimals"
  }));
}

async function quoteViaLens(publicClient: any, token: Address, amountIn: bigint, isBuy: boolean) {
  const result = await publicClient.readContract({
    address: ADDRESSES.V1_LENS,
    abi: v1LensAbi,
    functionName: "getAmountOut",
    args: [token, amountIn, isBuy]
  }) as readonly [Address, bigint];
  return { router: result[0], amountOut: result[1] };
}

async function resolveQuote(publicClient: any, token: Address, amountIn: bigint, isBuy: boolean) {
  try {
    const amountOut = await publicClient.readContract({
      address: ADDRESSES.ROUTER,
      abi: routerAbi,
      functionName: "getAmountOut",
      args: [token, amountIn, isBuy]
    }) as bigint;
    return { router: ADDRESSES.ROUTER, amountOut };
  } catch {
    return await quoteViaLens(publicClient, token, amountIn, isBuy);
  }
}

export async function quoteBuy(publicClient: any, token: Address, amountMon: number) {
  const amountIn = parseEther(amountMon.toFixed(18));
  const quote = await resolveQuote(publicClient, token, amountIn, true);
  return { amountIn, amountOut: quote.amountOut, router: quote.router };
}

export async function quoteSell(publicClient: any, token: Address, amountRaw: bigint) {
  const quote = await resolveQuote(publicClient, token, amountRaw, false);
  return quote.amountOut;
}

export function minOut(amount: bigint, slippagePct: number) {
  const bps = BigInt(Math.floor(Math.max(0, Math.min(95, slippagePct)) * 100));
  return amount * (10000n - bps) / 10000n;
}

export async function buyNative(
  walletClient: any,
  publicClient: any,
  token: Address,
  amountMon: number,
  slippagePct: number
): Promise<Hex> {
  const account = walletClient.account;
  const { amountIn, amountOut, router } = await quoteBuy(publicClient, token, amountMon);
  if (router.toLowerCase() !== ADDRESSES.ROUTER.toLowerCase()) {
    return walletClient.writeContract({
      account,
      chain: MONAD,
      address: router,
      abi: v1DexRouterAbi,
      functionName: "buy",
      args: [{
        amountOutMin: minOut(amountOut, slippagePct),
        token,
        to: account.address,
        deadline: BigInt(Math.floor(Date.now() / 1000) + 90)
      }],
      value: amountIn
    });
  }
  return walletClient.writeContract({
    account,
    chain: MONAD,
    address: ADDRESSES.ROUTER,
    abi: routerAbi,
    functionName: "buyWithNative",
    args: [{
      amountOutMin: minOut(amountOut, slippagePct),
      token,
      to: account.address,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 90)
    }],
    value: amountIn
  });
}

export async function sellToNative(
  walletClient: any,
  publicClient: any,
  token: Address,
  amountRaw: bigint,
  slippagePct: number,
  onTxSubmitted?: (hash: Hex, stage: "V1_SELL" | "V2_SELL" | "V2_LVMON_REDEEM" | "V2_WMON_UNWRAP") => Promise<void>
): Promise<{ txHash: Hex; gasCostRaw: bigint }> {
  const account = walletClient.account;
  const quote = await resolveQuote(publicClient, token, amountRaw, false);
  let router = quote.router;

  const receiptGasCost = (receipt: any) => {
    const gasUsed = BigInt(String(receipt.gasUsed ?? 0));
    const effectiveGasPrice = BigInt(String(receipt.effectiveGasPrice ?? 0));
    return gasUsed * effectiveGasPrice;
  };

  const ensureAllowance = async (spender: Address): Promise<bigint> => {
    const allowance = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, spender]
    }) as bigint;

    if (allowance >= amountRaw) return 0n;

    const simulation = await publicClient.simulateContract({
      account: account.address,
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, amountRaw]
    });
    const gasEstimate = await publicClient.estimateContractGas({
      account: account.address,
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, amountRaw]
    });
    const gasLimit = gasEstimate + (gasEstimate * 20n + 99n) / 100n;
    const approvalTx = await walletClient.writeContract({
      ...simulation.request,
      account,
      gas: gasLimit
    });
    const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalTx });
    if (approvalReceipt.status === "reverted") {
      throw new Error("Sell token approval reverted: " + approvalTx);
    }
    return receiptGasCost(approvalReceipt);
  };

  const simulateAndEstimate = async (
    address: Address,
    abi: any,
    functionName: string,
    args: readonly unknown[],
    label: string
  ) => {
    const simulation = await publicClient.simulateContract({
      account: account.address,
      address,
      abi,
      functionName,
      args
    });
    const gasEstimate = await publicClient.estimateContractGas({
      account: account.address,
      address,
      abi,
      functionName,
      args
    });
    const paddedGas = gasEstimate + (gasEstimate * BigInt(Math.round(config.sellGasPaddingPct * 100)) + 9999n) / 10000n;
    const cap = BigInt(config.sellGasLimit);
    if (paddedGas > cap) {
      throw new Error(
        label + " gas estimate exceeds safety cap: estimate=" +
        gasEstimate.toString() + " padded=" + paddedGas.toString() + " cap=" + cap.toString()
      );
    }
    return { simulation, gas: paddedGas };
  };

  const initialApprovalGasCost = await ensureAllowance(router);

  const freshQuote = await resolveQuote(publicClient, token, amountRaw, false);
  if (freshQuote.router.toLowerCase() !== router.toLowerCase()) {
    throw new Error("Sell route changed during preflight: " + router + " -> " + freshQuote.router);
  }
  router = freshQuote.router;

  const amountOutMin = minOut(freshQuote.amountOut, slippagePct);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 90);
  const isV2 = router.toLowerCase() === ADDRESSES.ROUTER.toLowerCase();

  if (!isV2) {
    const preflight = await simulateAndEstimate(
      router,
      v1DexRouterAbi,
      "sell",
      [{ amountIn: amountRaw, amountOutMin, token, to: account.address, deadline }],
      "V1 SELL"
    );
    const txHash = await walletClient.writeContract({
      ...preflight.simulation.request,
      account,
      gas: preflight.gas
    });
    await onTxSubmitted?.(txHash, "V1_SELL");
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status === "reverted") {
      throw new Error("V1 SELL transaction reverted: " + txHash);
    }
    return { txHash, gasCostRaw: initialApprovalGasCost + receiptGasCost(receipt) };
  }

  const lvmonBefore = await getTokenBalance(publicClient, ADDRESSES.LVMON, account.address);
  const wmonBefore = await getTokenBalance(publicClient, ADDRESSES.WMON, account.address);

  const sellPreflight = await simulateAndEstimate(
    ADDRESSES.ROUTER,
    routerAbi,
    "sell",
    [{ amountIn: amountRaw, amountOutMin, token, to: account.address, deadline }],
    "V2 SELL"
  );
  const sellTx = await walletClient.writeContract({
    ...sellPreflight.simulation.request,
    account,
    gas: sellPreflight.gas
  });
  await onTxSubmitted?.(sellTx, "V2_SELL");
  const sellReceipt = await publicClient.waitForTransactionReceipt({ hash: sellTx });
  if (sellReceipt.status === "reverted") {
    throw new Error("V2 SELL transaction reverted: " + sellTx);
  }

  let totalGasCostRaw = initialApprovalGasCost + receiptGasCost(sellReceipt);
  const lvmonAfterSell = await getTokenBalance(publicClient, ADDRESSES.LVMON, account.address);
  const wmonAfterSell = await getTokenBalance(publicClient, ADDRESSES.WMON, account.address);
  const lvmonDelta = lvmonAfterSell > lvmonBefore ? lvmonAfterSell - lvmonBefore : 0n;
  let wmonDelta = wmonAfterSell > wmonBefore ? wmonAfterSell - wmonBefore : 0n;

  if (lvmonDelta > 0n) {
    const lvmonAllowance = await publicClient.readContract({
      address: ADDRESSES.LVMON,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, ADDRESSES.LVMON_FAST_REDEEM_VAULT]
    }) as bigint;

    if (lvmonAllowance < lvmonDelta) {
      const approvalSimulation = await publicClient.simulateContract({
        account: account.address,
        address: ADDRESSES.LVMON,
        abi: erc20Abi,
        functionName: "approve",
        args: [ADDRESSES.LVMON_FAST_REDEEM_VAULT, lvmonDelta]
      });
      const approvalGas = await publicClient.estimateContractGas({
        account: account.address,
        address: ADDRESSES.LVMON,
        abi: erc20Abi,
        functionName: "approve",
        args: [ADDRESSES.LVMON_FAST_REDEEM_VAULT, lvmonDelta]
      });
      const approvalTx = await walletClient.writeContract({
        ...approvalSimulation.request,
        account,
        gas: approvalGas + (approvalGas * 20n + 99n) / 100n
      });
      const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalTx });
      if (approvalReceipt.status === "reverted") {
        throw new Error("LVMON redeem approval reverted: " + approvalTx);
      }
      totalGasCostRaw += receiptGasCost(approvalReceipt);
    }

    const redeemPreflight = await simulateAndEstimate(
      ADDRESSES.LVMON_FAST_REDEEM_VAULT,
      lvmonFastRedeemAbi,
      "redeem",
      [account.address, lvmonDelta],
      "LVMON FAST REDEEM"
    );
    const redeemTx = await walletClient.writeContract({
      ...redeemPreflight.simulation.request,
      account,
      gas: redeemPreflight.gas
    });
    await onTxSubmitted?.(redeemTx, "V2_LVMON_REDEEM");
    const redeemReceipt = await publicClient.waitForTransactionReceipt({ hash: redeemTx });
    if (redeemReceipt.status === "reverted") {
      throw new Error("LVMON fast redeem transaction reverted: " + redeemTx);
    }
    totalGasCostRaw += receiptGasCost(redeemReceipt);

    const wmonAfterRedeem = await getTokenBalance(publicClient, ADDRESSES.WMON, account.address);
    if (wmonAfterRedeem > wmonBefore) wmonDelta = wmonAfterRedeem - wmonBefore;
  }

  if (wmonDelta <= 0n) {
    throw new Error(
      "V2 native conversion failed: sell produced neither LVMON nor WMON for wallet " +
      account.address
    );
  }

  const unwrapPreflight = await simulateAndEstimate(
    ADDRESSES.WMON,
    wmonAbi,
    "withdraw",
    [wmonDelta],
    "WMON UNWRAP"
  );
  const unwrapTx = await walletClient.writeContract({
    ...unwrapPreflight.simulation.request,
    account,
    gas: unwrapPreflight.gas
  });
  await onTxSubmitted?.(unwrapTx, "V2_WMON_UNWRAP");
  const unwrapReceipt = await publicClient.waitForTransactionReceipt({ hash: unwrapTx });
  if (unwrapReceipt.status === "reverted") {
    throw new Error("WMON unwrap transaction reverted: " + unwrapTx);
  }
  totalGasCostRaw += receiptGasCost(unwrapReceipt);

  return { txHash: unwrapTx, gasCostRaw: totalGasCostRaw };
}
