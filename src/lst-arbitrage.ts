const MONAD_NETWORK = "monad";
const MIN_LIQUIDITY_USD = 5_000;
const MIN_NET_EDGE_PCT = 0.35;
const TRADE_SIZES_MON = [1, 5, 10];

type Venue = {
  name: string;
  address: string;
  token: string;
};

type PoolSnapshot = Venue & {
  priceUsd: number;
  priceInQuote: number;
  volume24hUsd: number;
  liquidityUsd: number;
  feePct: number;
  monPerToken: number;
};

const LST_VENUES: Venue[] = [
  // shMON
  { name: "Curve LST pool", address: "0x74d80ee400d3026fdd2520265cc98300710b25d4", token: "shMON" },
  { name: "Uniswap V3 shMON/MON", address: "0x1f86a9f2441cac9b942cfb5445530cdbb28717ed", token: "shMON" },
  // sMON
  { name: "Capricorn sMON/MON", address: "0x3a62cebddc88b9cccf61fd44128c2231e057573c", token: "sMON" },
  { name: "Uniswap V3 sMON/MON", address: "0x36a81ebd73b86b485a14911ea16f3d7c96cc00b0", token: "sMON" },
  // gMON
  { name: "Uniswap V3 gMON/MON", address: "0xb80d7a8f5331a907e34cd73f575c784b43e5acb5", token: "gMON" },
  // aprMON
  { name: "Capricorn aprMON/MON 0.01%", address: "0xbab2296c6a98c4e8584051dee817a98ab4069388", token: "aprMON" },
  { name: "Capricorn aprMON/MON 0.05%", address: "0x690fd406ca740b5afa3f37aa9b34ba6c9d72e995", token: "aprMON" }
];

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function pool(venue: Venue): Promise<PoolSnapshot> {
  const r = await fetch(
    `https://api.geckoterminal.com/api/v2/networks/${MONAD_NETWORK}/pools/${venue.address}`,
    { headers: { accept: "application/json" } }
  );
  if (!r.ok) throw new Error(`GeckoTerminal HTTP ${r.status} for ${venue.address}`);

  const j: any = await r.json();
  const a = j?.data?.attributes ?? {};
  const priceInQuote = num(a.base_token_price_quote_token);
  const feePct = num(a.pool_fee_percentage ?? a.fee_percentage ?? a.pool_fee);

  return {
    ...venue,
    priceUsd: num(a.base_token_price_usd),
    priceInQuote,
    volume24hUsd: num(a.volume_usd?.h24),
    liquidityUsd: num(a.reserve_in_usd),
    feePct,
    monPerToken: priceInQuote > 0 ? priceInQuote : 0
  };
}

function analyzeToken(token: string, venues: PoolSnapshot[]) {
  const liquid = venues.filter(v =>
    v.monPerToken > 0 &&
    v.liquidityUsd >= MIN_LIQUIDITY_USD
  );

  if (liquid.length < 2) {
    return {
      token,
      status: "NO_EXECUTABLE_COMPARISON",
      reason: "Fewer than two sufficiently liquid MON/LST venues",
      venues
    };
  }

  let buy: PoolSnapshot | undefined;
  let sell: PoolSnapshot | undefined;
  let bestSpreadPct = 0;

  for (const a of liquid) {
    for (const b of liquid) {
      if (a.address === b.address) continue;
      const spreadPct = (b.monPerToken / a.monPerToken - 1) * 100;
      if (spreadPct > bestSpreadPct) {
        bestSpreadPct = spreadPct;
        buy = a;
        sell = b;
      }
    }
  }

  const opportunities = TRADE_SIZES_MON.map(sizeMon => {
    const gross = buy && sell
      ? sizeMon * (sell.monPerToken / buy.monPerToken - 1)
      : 0;
    const fees = buy && sell
      ? sizeMon * ((buy.feePct + sell.feePct) / 100)
      : 0;
    // Conservative signal-only buffer. This is intentionally not treated
    // as an executable quote; live mode must replace it with router quotes.
    const slippageBuffer = sizeMon * 0.0015;
    const gasBuffer = 0.001;
    const net = gross - fees - slippageBuffer - gasBuffer;

    return {
      sizeMon,
      grossSpreadPct: bestSpreadPct,
      estimatedFeesMon: fees,
      slippageBufferMon: slippageBuffer,
      gasBufferMon: gasBuffer,
      estimatedNetProfitMon: net,
      candidate: Boolean(
        buy &&
        sell &&
        bestSpreadPct >= MIN_NET_EDGE_PCT &&
        net > 0
      )
    };
  });

  return {
    token,
    status: bestSpreadPct >= MIN_NET_EDGE_PCT ? "SIGNAL" : "NO_EDGE",
    bestBuyVenue: buy?.name ?? null,
    bestSellVenue: sell?.name ?? null,
    grossSpreadPct: bestSpreadPct,
    opportunities,
    venues
  };
}

export async function scanLSTArbitrage() {
  const snapshots = await Promise.all(LST_VENUES.map(pool));
  const byToken = new Map<string, PoolSnapshot[]>();

  for (const snapshot of snapshots) {
    const list = byToken.get(snapshot.token) ?? [];
    list.push(snapshot);
    byToken.set(snapshot.token, list);
  }

  const analyses = [...byToken.entries()].map(([token, venues]) =>
    analyzeToken(token, venues)
  );

  const signals = analyses.flatMap(a =>
    a.opportunities
      ?.filter(o => o.candidate)
      .map(o => ({
        token: a.token,
        sizeMon: o.sizeMon,
        buyVenue: a.bestBuyVenue,
        sellVenue: a.bestSellVenue,
        grossSpreadPct: o.grossSpreadPct,
        estimatedNetProfitMon: o.estimatedNetProfitMon
      })) ?? []
  );

  return {
    generatedAt: new Date().toISOString(),
    mode: "PAPER_SIGNAL_ONLY",
    assets: ["MON", "shMON", "sMON", "gMON", "aprMON"],
    analyses,
    signals,
    rules: {
      liveExecution: false,
      minimumLiquidityUsd: MIN_LIQUIDITY_USD,
      minimumNetEdgePct: MIN_NET_EDGE_PCT,
      tradeSizesMon: TRADE_SIZES_MON,
      note: "This scanner finds cross-venue LST discrepancies. It does not trade. Live execution requires exact on-chain/router quotes, route simulation, balance checks, and atomic/rollback-safe execution."
    }
  };
}
