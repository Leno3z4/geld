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
  FACTORY: "0xA25b13127e63ddae6d0b35570FF3D39dBD621001" as Address
};

export const routerAbi = parseAbi([
  "function getAmountOut(address token,uint256 amountIn,bool isBuy) view returns (uint256)",
  "function isGraduated(address token) view returns (bool)",
  "function buyWithNative((uint256 amountOutMin,address token,address to,uint256 deadline) params) payable returns (uint256 amountOut)",
  "function sellToNative((uint256 amountIn,uint256 amountOutMin,address token,address to,uint256 deadline) params) returns (uint256 amountOut)"
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

  const results = await publicClient.multicall({
    contracts: requests.map(({ token, amountRaw }) => ({
      address: ADDRESSES.ROUTER,
      abi: routerAbi,
      functionName: "getAmountOut",
      args: [token, amountRaw, false]
    })),
    allowFailure: true
  });

  const quotes = new Map<string, bigint>();
  requests.forEach(({ token }, i) => {
    const result = results[i];
    if (result?.status === "success" && typeof result.result === "bigint") {
      quotes.set(token.toLowerCase(), result.result);
    }
  });
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

export async function quoteBuy(publicClient: any, token: Address, amountMon: number) {
  const amountIn = parseEther(amountMon.toFixed(18));
  const amountOut = await publicClient.readContract({
    address: ADDRESSES.ROUTER,
    abi: routerAbi,
    functionName: "getAmountOut",
    args: [token, amountIn, true]
  }) as bigint;
  return { amountIn, amountOut };
}

export async function quoteSell(publicClient: any, token: Address, amountRaw: bigint) {
  return await publicClient.readContract({
    address: ADDRESSES.ROUTER,
    abi: routerAbi,
    functionName: "getAmountOut",
    args: [token, amountRaw, false]
  }) as bigint;
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
  const { amountIn, amountOut } = await quoteBuy(publicClient, token, amountMon);
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
  slippagePct: number
): Promise<Hex> {
  const account = walletClient.account;
  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account.address, ADDRESSES.ROUTER]
  }) as bigint;

  if (allowance < amountRaw) {
    const approvalTx = await walletClient.writeContract({
      account,
      chain: MONAD,
      address: token,
      abi: erc20Abi,
      functionName: "approve",
      args: [ADDRESSES.ROUTER, amountRaw]
    });
    await publicClient.waitForTransactionReceipt({ hash: approvalTx });
  }

  const amountOut = await quoteSell(publicClient, token, amountRaw);
  return walletClient.writeContract({
    account,
    chain: MONAD,
    address: ADDRESSES.ROUTER,
    abi: routerAbi,
    functionName: "sellToNative",
    // Monad's RPC can reject viem's oversized gas estimate for NadFun sells.
    // Keep the transaction below the network's per-transaction gas cap while
    // leaving ample headroom for the V2 router path.
    gas: BigInt(config.sellGasLimit),
    args: [{
      amountIn: amountRaw,
      amountOutMin: minOut(amountOut, slippagePct),
      token,
      to: account.address,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 90)
    }]
  });
}
