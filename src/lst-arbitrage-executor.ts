import {
  createPublicClient,
  decodeEventLog,
  formatEther,
  parseAbi,
  type Address,
  type Hex
} from "viem";
import { clients } from "./nadfun.js";
import type { ArbitrageSignal } from "./lst-arbitrage.js";
import { config } from "./config.js";

const EXECUTOR_ABI = parseAbi([
  "function owner() view returns (address)",
  "function executeNative((uint8 kind,address tokenIn,address tokenOut,uint24 fee,int128 curveI,int128 curveJ,uint256 minAmountOut)[] legs,uint256 minFinalWmon,uint256 deadline) payable returns (uint256 amountOut,uint256 profit)",
  "event ArbitrageExecuted(address indexed caller,uint256 amountIn,uint256 amountOut,uint256 profit)"
]);

const WMON =
  "0x3bd359c1119da7da1d913d1c4d2b7c461115433a" as Address;
const CURVE_LST_POOL =
  "0x74d80ee400d3026fdd2520265cc98300710b25d4" as Address;
const UNIVERSAL_ROUTER =
  "0xa6CE4F10d83dBdDAc17E68e1837ca9cE6a1b596e" as Address;

const CURVE_INDEX: Record<string, number> = {
  [WMON.toLowerCase()]: 0,
  "0x1b68626dca36c7fe922fd2d55e4f631d962de19c": 1,
  "0xa3227c5969757783154c60bf0bc1944180ed81b9": 2,
  "0x8498312a6b3cbd158bf0c93abdcf29e6e4f55081": 3
};

type ExecutorLeg = {
  kind: number;
  tokenIn: Address;
  tokenOut: Address;
  fee: number;
  curveI: bigint;
  curveJ: bigint;
  minAmountOut: bigint;
};

function lower(value: string) {
  return value.toLowerCase();
}

function curveIndex(address: string) {
  return CURVE_INDEX[lower(address)];
}

function toAddress(value: string) {
  return value as Address;
}

function buildLeg(leg: ArbitrageSignal["legs"][number]): ExecutorLeg {
  const tokenIn = toAddress(leg.tokenIn);
  const tokenOut = toAddress(leg.tokenOut);

  if (leg.quoteKind === "curve-lst") {
    const i = curveIndex(tokenIn);
    const j = curveIndex(tokenOut);
    if (i === undefined || j === undefined || i === j) {
      throw new Error("Curve route is not in the fixed LST index map");
    }
    if (lower(leg.pool) !== lower(CURVE_LST_POOL)) {
      throw new Error("Curve route targets an unexpected pool");
    }
    return {
      kind: 1,
      tokenIn,
      tokenOut,
      fee: 0,
      curveI: BigInt(i),
      curveJ: BigInt(j),
      minAmountOut: BigInt(leg.minAmountOutRaw)
    };
  }

  if (leg.quoteKind === "uniswap-v3") {
    if (Number.isFinite(leg.feeBps) === false || leg.feeBps <= 0) {
      throw new Error("Uniswap V3 route is missing a valid fee");
    }
    return {
      kind: 2,
      tokenIn,
      tokenOut,
      fee: Math.floor(leg.feeBps),
      curveI: 0n,
      curveJ: 0n,
      minAmountOut: BigInt(leg.minAmountOutRaw)
    };
  }

  throw new Error("Unsupported executable leg");
}

export async function executeLSTArbitrageSignal(
  signal: ArbitrageSignal,
  executorAddress?: string
) {
  if (!config.liveTrading) {
    throw new Error("Normal GELD LIVE_TRADING is disabled");
  }
  if (!config.lstArbitrageLiveExecution) {
    throw new Error("LST arbitrage live execution is disabled");
  }

  const configured = executorAddress?.trim() || config.lstArbitrageExecutorAddress.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(configured)) {
    throw new Error("LST_ARBITRAGE_EXECUTOR_ADDRESS is not configured");
  }

  const { publicClient, walletClient, account } = clients();
  if (!account || !walletClient) {
    throw new Error("GELD wallet is not configured");
  }

  const executor = configured as Address;
  const code = await publicClient.getBytecode({ address: executor });
  if (!code || code === "0x") {
    throw new Error("Arbitrage executor has no deployed bytecode");
  }

  const executorOwner = await publicClient.readContract({
    address: executor,
    abi: EXECUTOR_ABI,
    functionName: "owner"
  }) as Address;

  if (lower(executorOwner) !== lower(account.address)) {
    throw new Error(
      "Executor owner mismatch: expected " +
      account.address +
      " got " +
      executorOwner
    );
  }

  if (lower(signal.legs[0].tokenIn) !== lower(WMON)) {
    throw new Error("Arbitrage signal does not start in WMON");
  }
  if (lower(signal.legs.at(-1)?.tokenOut ?? "") !== lower(WMON)) {
    throw new Error("Arbitrage signal does not end in WMON");
  }

  const legs = signal.legs.map(buildLeg);
  const minFinalWmon = BigInt(signal.minFinalWmonRaw);
  const amountIn = BigInt(signal.amountInRaw);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20);

  if (amountIn <= 0n || minFinalWmon <= amountIn) {
    throw new Error("Invalid arbitrage amount/minimum");
  }

  const simulation = await publicClient.simulateContract({
    account: account.address,
    address: executor,
    abi: EXECUTOR_ABI,
    functionName: "executeNative",
    args: [legs, minFinalWmon, deadline],
    value: amountIn
  });

  const txHash = await walletClient.writeContract({
    ...simulation.request,
    account: account.address
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash
  });

  const gasUsed = BigInt(String(receipt.gasUsed ?? 0));
  const effectiveGasPrice = BigInt(String((receipt as any).effectiveGasPrice ?? 0));
  const gasCostRaw = gasUsed * effectiveGasPrice;

  let amountOutRaw = "";
  let profitRaw = "";
  for (const log of receipt.logs) {
    if (lower(log.address) !== lower(executor)) continue;
    try {
      const decoded = decodeEventLog({
        abi: EXECUTOR_ABI,
        data: log.data,
        topics: log.topics
      });
      if (decoded.eventName === "ArbitrageExecuted") {
        const args = decoded.args as {
          amountIn: bigint;
          amountOut: bigint;
          profit: bigint;
        };
        amountOutRaw = args.amountOut.toString();
        profitRaw = args.profit.toString();
        break;
      }
    } catch {}
  }

  const grossProfitMon = amountOutRaw
    ? Number(formatEther(BigInt(amountOutRaw) - amountIn))
    : Number(signal.finalMon) - Number(signal.sizeMon);
  const gasCostMon = Number(formatEther(gasCostRaw));
  const netProfitMon = grossProfitMon - gasCostMon;

  return {
    ok: receipt.status === "success",
    submitted: true,
    txHash: txHash as Hex,
    receiptStatus: receipt.status,
    executor,
    route: signal.path,
    sizeMon: signal.sizeMon,
    amountInRaw: amountIn.toString(),
    amountOutRaw,
    profitRaw,
    grossProfitMon,
    gasCostMon,
    netProfitMon,
    quotedNetProfitMon: signal.netProfitMon,
    simulation: {
      passed: true,
      deadline: Number(deadline),
      minFinalWmonRaw: minFinalWmon.toString()
    }
  };
}

export function executorConstants() {
  return {
    wmon: WMON,
    curvePool: CURVE_LST_POOL,
    universalRouter: UNIVERSAL_ROUTER
  };
}
