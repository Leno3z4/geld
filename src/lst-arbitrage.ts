const MONAD_NETWORK = "monad";
const POOLS = {
  curveLst: "0x74d80ee400d3026fdd2520265cc98300710b25d4",
  uniswapV4MonShmon: "0x0a2eb246aac042fed4eeaf8bce78df3568cbe21701c969812702633085b8f771"
} as const;

type PoolSnapshot = {
  address: string;
  name?: string;
  priceUsd: number;
  priceInQuote: number;
  baseSymbol: string;
  quoteSymbol: string;
  volume24hUsd: number;
  liquidityUsd: number;
  feePct: number;
  source: string;
};

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function pool(address: string): Promise<PoolSnapshot> {
  const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/${MONAD_NETWORK}/pools/${address}`, {
    headers: { accept: "application/json" }
  });
  if (!r.ok) throw new Error(`GeckoTerminal HTTP ${r.status} for ${address}`);
  const j: any = await r.json();
  const a = j?.data?.attributes ?? {};
  const fee = num(a.pool_fee_percentage ?? a.fee_percentage ?? a.pool_fee);
  return {
    address,
    name: String(a.name ?? address),
    priceUsd: num(a.base_token_price_usd),
    priceInQuote: num(a.base_token_price_quote_token),
    baseSymbol: String(a.name ?? "").split("/")[0]?.trim() ?? "",
    quoteSymbol: String(a.name ?? "").split("/")[1]?.split(" ")[0]?.trim() ?? "",
    volume24hUsd: num(a.volume_usd?.h24),
    liquidityUsd: num(a.reserve_in_usd),
    feePct: fee > 0 ? fee : 0,
    source: "GeckoTerminal"
  };
}

export async function scanLSTArbitrage() {
  const [curve, uni] = await Promise.all([
    pool(POOLS.curveLst),
    pool(POOLS.uniswapV4MonShmon)
  ]);

  const opportunities = [];
  const tradeSizesMon = [1, 5, 10];

  // The Curve pool is a four-asset LST pool; its displayed shMON/WMON
  // conversion is read from GeckoTerminal's current pool price.
  // Uniswap V4 is a direct MON/shMON venue. We use the quoted pool prices
  // only as a signal; execution is deliberately NOT wired here.
  // Both venues are normalized to MON/shMON using the pool's native-currency
  // quote when available. GeckoTerminal documents base_token_price_quote_token
  // and base_token_price_native_currency as canonical pool ratios.
  const curveMonPerShmon = curve.priceInQuote > 0 ? 1 / curve.priceInQuote : 0;
  const uniMonPerShmon = uni.priceInQuote > 0 ? 1 / uni.priceInQuote : 0;
  const ratio = curveMonPerShmon > 0 && uniMonPerShmon > 0
    ? Math.max(curveMonPerShmon, uniMonPerShmon) / Math.min(curveMonPerShmon, uniMonPerShmon) - 1
    : 0;

  for (const sizeMon of tradeSizesMon) {
    const gross = sizeMon * ratio;
    const feeEstimate = sizeMon * ((curve.feePct + uni.feePct) / 100);
    const slippageBuffer = sizeMon * 0.0015;
    const gasBuffer = 0.001;
    const net = gross - feeEstimate - slippageBuffer - gasBuffer;
    opportunities.push({
      sizeMon,
      grossSpreadPct: ratio * 100,
      estimatedFeesMon: feeEstimate,
      slippageBufferMon: slippageBuffer,
      gasBufferMon: gasBuffer,
      estimatedNetProfitMon: net,
      executable: net > 0 && Math.min(curve.liquidityUsd, uni.liquidityUsd) > sizeMon * 0.02838 * 20
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    mode: "PAPER_SIGNAL_ONLY",
    assets: ["MON", "shMON"],
    pools: { curve, uniswapV4: uni },
    opportunities,
    rules: {
      liveExecution: false,
      minimumNetProfitMon: 0,
      note: "Quotes are indicative. Live execution must use on-chain/router quotes and exact calldata before trading."
    }
  };
}
