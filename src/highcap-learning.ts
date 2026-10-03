import { DurableObject } from "cloudflare:workers";

type HighCapSample = {
  ts:number;
  token:string;
  symbol?:string;
  marketCapUsd:number;
  liquidityUsd:number;
  volume5mUsd:number;
  buySellRatio5m:number;
  buyMakers5m:number;
  trend1hPct:number;
  trend4hPct:number;
  priceMon:number;
  dayHighPriceMon:number;
  dayLowPriceMon:number;
  dayAvgPriceMon:number;
  strategy?:string;
  localScore:number;
};

type Summary = {
  sampleCount:number;
  tokenCount:number;
  positive1hPct:number;
  positive4hPct:number;
  positive24hPct:number;
  mean1hPct:number;
  mean4hPct:number;
  mean24hPct:number;
  daily:{date:string;highPct:number;lowPct:number;closePct:number;samples:number}[];
  weekly:{week:string;highPct:number;lowPct:number;closePct:number;samples:number}[];
  strategy:{name:string;samples:number;mean1hPct:number;positive1hPct:number}[];
  generatedAt:number;
};

function safeNumber(v:unknown, fallback=0){
  const n=Number(v);
  return Number.isFinite(n)?n:fallback;
}

export class GeldHighCapLearning extends DurableObject {
  private initialized=false;

  private init(){
    if(this.initialized) return;
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS highcap_observations (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        token TEXT NOT NULL,
        symbol TEXT,
        market_cap REAL NOT NULL,
        liquidity REAL NOT NULL,
        volume_5m REAL NOT NULL,
        buy_sell REAL NOT NULL,
        buy_makers INTEGER NOT NULL,
        trend_1h REAL NOT NULL,
        trend_4h REAL NOT NULL,
        price REAL NOT NULL,
        day_high REAL NOT NULL,
        day_low REAL NOT NULL,
        day_avg REAL NOT NULL,
        strategy TEXT,
        local_score REAL NOT NULL
      )
    `);
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS idx_highcap_token_ts ON highcap_observations(token, ts)");
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS idx_highcap_ts ON highcap_observations(ts)");
    this.initialized=true;
  }

  async fetch(request:Request){
    this.init();
    const url=new URL(request.url);

    if(request.method==="POST" && url.pathname==="/observe"){
      const body=await request.json() as {samples?:HighCapSample[]};
      const samples=Array.isArray(body.samples)?body.samples:[];
      const now=Date.now();
      const cutoff=now-45*24*60*60*1000;

      const insert=this.ctx.storage.sql;
      for(const raw of samples.slice(0,30)){
        const s:HighCapSample={
          ts:Math.floor(safeNumber(raw.ts,now)/300000)*300000,
          token:String(raw.token||"").toLowerCase(),
          symbol:raw.symbol,
          marketCapUsd:safeNumber(raw.marketCapUsd),
          liquidityUsd:safeNumber(raw.liquidityUsd),
          volume5mUsd:safeNumber(raw.volume5mUsd),
          buySellRatio5m:safeNumber(raw.buySellRatio5m),
          buyMakers5m:Math.max(0,Math.floor(safeNumber(raw.buyMakers5m))),
          trend1hPct:safeNumber(raw.trend1hPct),
          trend4hPct:safeNumber(raw.trend4hPct),
          priceMon:safeNumber(raw.priceMon),
          dayHighPriceMon:safeNumber(raw.dayHighPriceMon),
          dayLowPriceMon:safeNumber(raw.dayLowPriceMon),
          dayAvgPriceMon:safeNumber(raw.dayAvgPriceMon),
          strategy:raw.strategy,
          localScore:safeNumber(raw.localScore)
        };
        if(!/^0x[0-9a-f]{40}$/.test(s.token)||!(s.priceMon>0)) continue;
        const id=s.token+":"+s.ts;
        insert.exec(
          `INSERT OR REPLACE INTO highcap_observations
           (id,ts,token,symbol,market_cap,liquidity,volume_5m,buy_sell,buy_makers,trend_1h,trend_4h,price,day_high,day_low,day_avg,strategy,local_score)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          id,s.ts,s.token,s.symbol??null,s.marketCapUsd,s.liquidityUsd,s.volume5mUsd,s.buySellRatio5m,
          s.buyMakers5m,s.trend1hPct,s.trend4hPct,s.priceMon,s.dayHighPriceMon,s.dayLowPriceMon,s.dayAvgPriceMon,
          s.strategy??null,s.localScore
        );
      }

      insert.exec("DELETE FROM highcap_observations WHERE ts < ?",cutoff);
      return Response.json({ok:true,stored:samples.length,retentionDays:45});
    }

    if(request.method==="GET" && url.pathname==="/summary"){
      return Response.json(this.summary());
    }

    if(request.method==="POST" && url.pathname==="/prune"){
      this.ctx.storage.sql.exec("DELETE FROM highcap_observations WHERE ts < ?",Date.now()-45*24*60*60*1000);
      return Response.json({ok:true});
    }

    return new Response("Not Found",{status:404});
  }

  private summary():Summary{
    const sql=this.ctx.storage.sql;
    const count=sql.exec("SELECT COUNT(*) AS c, COUNT(DISTINCT token) AS t FROM highcap_observations").one() as any;
    const outcomes=sql.exec(`
      WITH future AS (
        SELECT a.token,a.ts,a.price,
          (SELECT b.price FROM highcap_observations b WHERE b.token=a.token AND b.ts BETWEEN a.ts+45*60000 AND a.ts+75*60000 ORDER BY ABS(b.ts-(a.ts+60*60000)) LIMIT 1) AS p1,
          (SELECT b.price FROM highcap_observations b WHERE b.token=a.token AND b.ts BETWEEN a.ts+210*60000 AND a.ts+270*60000 ORDER BY ABS(b.ts-(a.ts+240*60000)) LIMIT 1) AS p4,
          (SELECT b.price FROM highcap_observations b WHERE b.token=a.token AND b.ts BETWEEN a.ts+20*60*60000 AND a.ts+28*60*60000 ORDER BY ABS(b.ts-(a.ts+24*60*60000)) LIMIT 1) AS p24
        FROM highcap_observations a
        WHERE a.ts >= ?
      )
      SELECT
        AVG(CASE WHEN p1 IS NOT NULL THEN (p1/price-1)*100 END) m1,
        AVG(CASE WHEN p4 IS NOT NULL THEN (p4/price-1)*100 END) m4,
        AVG(CASE WHEN p24 IS NOT NULL THEN (p24/price-1)*100 END) m24,
        AVG(CASE WHEN p1 IS NOT NULL AND p1>price THEN 1.0 ELSE 0.0 END) q1,
        AVG(CASE WHEN p4 IS NOT NULL AND p4>price THEN 1.0 ELSE 0.0 END) q4,
        AVG(CASE WHEN p24 IS NOT NULL AND p24>price THEN 1.0 ELSE 0.0 END) q24
      FROM future
    `,Date.now()-30*24*60*60*1000).one() as any;

    const daily=sql.exec(`
      WITH base AS (
        SELECT date(ts/1000,'unixepoch') d,price,
               FIRST_VALUE(price) OVER(PARTITION BY date(ts/1000,'unixepoch') ORDER BY ts) op
        FROM highcap_observations WHERE ts>=?
      )
      SELECT d date,
        (MAX(price)/MAX(op)-1)*100 highPct,
        (MIN(price)/MAX(op)-1)*100 lowPct,
        (MAX(price)/MAX(op)-1)*100 closePct,
        COUNT(*) samples
      FROM base GROUP BY d ORDER BY d DESC LIMIT 14
    `,Date.now()-30*24*60*60*1000).toArray() as any[];

    const weekly=sql.exec(`
      WITH base AS (
        SELECT strftime('%Y-W%W',ts/1000,'unixepoch') w,ts,price,
               FIRST_VALUE(price) OVER(PARTITION BY strftime('%Y-W%W',ts/1000,'unixepoch') ORDER BY ts) op
        FROM highcap_observations WHERE ts>=?
      )
      SELECT w week,
        (MAX(price)/MAX(op)-1)*100 highPct,
        (MIN(price)/MAX(op)-1)*100 lowPct,
        (MAX(price)/MAX(op)-1)*100 closePct,
        COUNT(*) samples
      FROM base GROUP BY w ORDER BY w DESC LIMIT 8
    `,Date.now()-60*24*60*60*1000).toArray() as any[];

    const strategy=sql.exec(`
      WITH future AS (
        SELECT a.strategy,a.price,
          (SELECT b.price FROM highcap_observations b WHERE b.token=a.token AND b.ts BETWEEN a.ts+45*60000 AND a.ts+75*60000 ORDER BY ABS(b.ts-(a.ts+60*60000)) LIMIT 1) p1
        FROM highcap_observations a
        WHERE a.ts>=? AND a.strategy IS NOT NULL
      )
      SELECT strategy name,COUNT(*) samples,
        AVG(CASE WHEN p1 IS NOT NULL THEN (p1/price-1)*100 END) mean1hPct,
        AVG(CASE WHEN p1 IS NOT NULL AND p1>price THEN 1.0 ELSE 0.0 END) positive1hPct
      FROM future GROUP BY strategy ORDER BY samples DESC LIMIT 8
    `,Date.now()-30*24*60*60*1000).toArray() as any[];

    return {
      sampleCount:safeNumber(count?.c),
      tokenCount:safeNumber(count?.t),
      positive1hPct:safeNumber(outcomes?.q1)*100,
      positive4hPct:safeNumber(outcomes?.q4)*100,
      positive24hPct:safeNumber(outcomes?.q24)*100,
      mean1hPct:safeNumber(outcomes?.m1),
      mean4hPct:safeNumber(outcomes?.m4),
      mean24hPct:safeNumber(outcomes?.m24),
      daily:daily.map(x=>({date:String(x.date),highPct:safeNumber(x.highPct),lowPct:safeNumber(x.lowPct),closePct:safeNumber(x.closePct),samples:safeNumber(x.samples)})),
      weekly:weekly.map(x=>({week:String(x.week),highPct:safeNumber(x.highPct),lowPct:safeNumber(x.lowPct),closePct:safeNumber(x.closePct),samples:safeNumber(x.samples)})),
      strategy:strategy.map(x=>({name:String(x.name),samples:safeNumber(x.samples),mean1hPct:safeNumber(x.mean1hPct),positive1hPct:safeNumber(x.positive1hPct)*100})),
      generatedAt:Date.now()
    };
  }
}
