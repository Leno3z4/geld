import { DurableObject } from "cloudflare:workers";

export interface LeverUpPaperSnapshot { symbol: string; price: number; ts: number; }

type Pos = {
  id: string; symbol: string; side: "LONG" | "SHORT"; entry: number;
  marginMon: number; leverage: number; stop: number; take: number;
  peakMovePct: number; openedAt: number; reason: string;
};

type CandleDay = { day: string; open: number; high: number; low: number; close: number; samples: number };

type State = {
  startedAt: number;
  mode: "PAPER" | "LIVE";
  switchedAt?: number;
  balanceMon: number;
  initialMon: number;
  realizedPnlMon: number;
  positions: Pos[];
  samples: Record<string, Array<{ts:number; price:number}>>;
  daily: Record<string, CandleDay>;
  previousDaily: Record<string, CandleDay>;
  trades: any[];
  wins: number;
  losses: number;
  consecutiveLosses: number;
  lastDecisionAt: number;
  liveUntil: Record<string, number>;
  readiness?: { checkedAt:number; ok:boolean; firstAcceptedMarginMon?:number; detail?:any };
  performance: Record<string,{trades:number;wins:number;pnlMon:number}>;
};

const PAPER_START_MON = 50;
const LEVERAGE = 5;
const OPEN_CLOSE_FEE = 0.00045;
const MARGIN_PCT = 5;
const MAX_MARGIN_MON = 5;
const STOP_MOVE_PCT = 0.65;
const TAKE_MOVE_PCT = 1.30;
const TRAIL_ARM_PCT = 0.85;
const TRAIL_GIVEBACK_PCT = 0.40;
const EXTREME_ZONE_PCT = 0.18;
const REVERSAL_5M_PCT = 0.12;
const COOLDOWN_MS = 15 * 60_000;
const PAPER_WINDOW_MS = 24 * 60 * 60_000;
const MAX_CONSECUTIVE_LOSSES = 3;

const utcDay = (ts:number) => new Date(ts).toISOString().slice(0,10);
const pct = (a:number,b:number) => b ? ((a/b)-1)*100 : 0;

function rolling(samples:Array<{ts:number;price:number}>, now:number, ms:number) {
  return samples.filter(x => now - x.ts <= ms);
}

export class GeldLeverUpPaper extends DurableObject {
  private async load():Promise<State> {
    const saved = await this.ctx.storage.get<State>("state");
    if (saved?.version === 2) return saved;
    const now = Date.now();
    const s:State = {
      startedAt: now, mode:"PAPER", balanceMon:PAPER_START_MON,
      initialMon:PAPER_START_MON, realizedPnlMon:0, positions:[],
      samples:{}, daily:{}, previousDaily:{}, trades:[], wins:0, losses:0,
      consecutiveLosses:0, lastDecisionAt:0, liveUntil:{}, performance:{}
    };
    await this.ctx.storage.put("state", s);
    return s;
  }

  private async save(s:State) { await this.ctx.storage.put("state", s); }

  private dailyRange(s:State, symbol:string, now:number) {
    const d=s.daily[symbol], samples=rolling(s.samples[symbol]??[],now,24*60*60_000);
    if (!d || d.samples < 20 || samples.length < 20) return null;
    const high=Math.max(d.high,...samples.map(x=>x.price));
    const low=Math.min(d.low,...samples.map(x=>x.price));
    const range=high-low;
    return {
      high, low, range,
      location: range>0 ? (samples.at(-1)!.price-low)/range : .5,
      previous:s.previousDaily[symbol]??null
    };
  }

  private signal(s:State,m:LeverUpPaperSnapshot) {
    const samples=rolling(s.samples[m.symbol]??[],m.ts,24*60*60_000);
    const range=this.dailyRange(s,m.symbol,m.ts);
    if (!range || samples.length < 20) return ["HOLD","building 24h/daily range"] as const;

    const last5=rolling(samples,m.ts,5*60_000);
    const perfLong=s.performance[m.symbol+":LONG"], perfShort=s.performance[m.symbol+":SHORT"];
    const base=last5[0]?.price ?? m.price;
    const reversal=pct(m.price,base);
    const loc=range.location;

    // Do not blindly short every high or long every low. Require rejection/reversal.
    if (loc >= 1-EXTREME_ZONE_PCT && reversal <= -REVERSAL_5M_PCT) {
      if (perfShort && perfShort.trades >= 3 && (perfShort.pnlMon <= 0 || perfShort.wins / perfShort.trades < 0.35))
        return ["HOLD","paper learning blocked SHORT: negative expectancy"] as const;
      return ["SHORT","daily-high rejection + 5m reversal"] as const;
    }

    if (loc <= EXTREME_ZONE_PCT && reversal >= REVERSAL_5M_PCT) {
      if (perfLong && perfLong.trades >= 3 && (perfLong.pnlMon <= 0 || perfLong.wins / perfLong.trades < 0.35))
        return ["HOLD","paper learning blocked LONG: negative expectancy"] as const;
      return ["LONG","daily-low rejection + 5m reversal"] as const;
    }

    return ["HOLD","inside range / no confirmed reversal"] as const;
  }

  private close(s:State,p:Pos,price:number,reason:string,ts:number) {
    const movePct=p.side==="LONG" ? pct(price,p.entry) : pct(p.entry,price);
    const notional=p.marginMon*p.leverage;
    const pnl=notional*(movePct/100) - notional*OPEN_CLOSE_FEE;
    s.balanceMon += pnl;
    s.realizedPnlMon += pnl;
    if(pnl>0){s.wins++;s.consecutiveLosses=0;} else {s.losses++;s.consecutiveLosses++;}
    s.trades.push({ts,action:"CLOSE",symbol:p.symbol,side:p.side,entry:p.entry,exit:price,pnlMon:pnl,movePct,reason});
    s.positions=s.positions.filter(x=>x.id!==p.id);
  }

  private markPositions(s:State,m:LeverUpPaperSnapshot) {
    for(const p of [...s.positions].filter(x=>x.symbol===m.symbol)){
      const movePct=p.side==="LONG" ? pct(m.price,p.entry) : pct(p.entry,m.price);
      p.peakMovePct=Math.max(p.peakMovePct,movePct);
      if((p.side==="LONG"&&m.price<=p.stop)||(p.side==="SHORT"&&m.price>=p.stop))
        this.close(s,p,p.stop,"STOP",m.ts);
      else if((p.side==="LONG"&&m.price>=p.take)||(p.side==="SHORT"&&m.price<=p.take))
        this.close(s,p,p.take,"TAKE_PROFIT",m.ts);
      else if(p.peakMovePct>=TRAIL_ARM_PCT && movePct<=p.peakMovePct-TRAIL_GIVEBACK_PCT)
        this.close(s,p,m.price,"TRAIL",m.ts);
    }
  }

  async fetch(req:Request) {
    const u=new URL(req.url), s=await this.load(), now=Date.now();

    if(u.pathname==="/status")
      return Response.json({
        ...s,
        switchAt:s.startedAt+PAPER_WINDOW_MS,
        remainingMs:Math.max(0,s.startedAt+PAPER_WINDOW_MS-now),
        paperHours:Math.min(24,(now-s.startedAt)/3600000)
      });

    if(u.pathname==="/readiness" && req.method==="POST") {
      const body=await req.json() as any;
      s.readiness={checkedAt:now,ok:Boolean(body.ok),firstAcceptedMarginMon:body.firstAcceptedMarginMon,detail:body.detail};
      await this.save(s);
      return Response.json(s.readiness);
    }

    if(u.pathname==="/live-opened" && req.method==="POST") {
      const b=await req.json() as {symbol:string};
      s.liveUntil[b.symbol]=now+6*3600000;
      await this.save(s);
      return Response.json({ok:true});
    }

    if(req.method!=="POST" || u.pathname!=="/tick")
      return new Response("Not Found",{status:404});

    const body=await req.json() as {snapshots?:LeverUpPaperSnapshot[]};
    const ms=(body.snapshots??[]).filter(x=>x.price>0&&Number.isFinite(x.price));

    for(const m of ms) {
      const k=utcDay(m.ts), d=s.daily[m.symbol];
      if(d?.day===k) {
        s.daily[m.symbol]={...d,high:Math.max(d.high,m.price),low:Math.min(d.low,m.price),close:m.price,samples:d.samples+1};
      } else {
        if(d) s.previousDaily[m.symbol]=d;
        s.daily[m.symbol]={day:k,open:m.price,high:m.price,low:m.price,close:m.price,samples:1};
      }
      s.samples[m.symbol]=[...(s.samples[m.symbol]??[]).filter(x=>m.ts-x.ts<=24*60*60_000),{ts:m.ts,price:m.price}].slice(-3000);
      this.markPositions(s,m);
    }

    if(s.mode==="PAPER" && now-s.startedAt>=PAPER_WINDOW_MS) {
      s.mode="LIVE";
      s.switchedAt=now;
      s.trades.push({ts:now,action:"MODE_SWITCH",to:"LIVE",reason:"exactly 24h paper window completed"});
    }

    const signals:any[]=[];
    if(s.consecutiveLosses<MAX_CONSECUTIVE_LOSSES && now-s.lastDecisionAt>=COOLDOWN_MS) {
      for(const m of ms) {
        if(s.liveUntil[m.symbol]&&s.liveUntil[m.symbol]>now) continue;
        if(s.positions.some(p=>p.symbol===m.symbol)) continue;
        const [action,reason]=this.signal(s,m);
        if(action==="HOLD") continue;

        const marginMon=Math.min(MAX_MARGIN_MON,Math.max(0.05,s.balanceMon*MARGIN_PCT/100));
        const stop=action==="LONG"?m.price*(1-STOP_MOVE_PCT/100):m.price*(1+STOP_MOVE_PCT/100);
        const take=action==="LONG"?m.price*(1+TAKE_MOVE_PCT/100):m.price*(1-TAKE_MOVE_PCT/100);
        signals.push({symbol:m.symbol,side:action,entry:m.price,stop,take,leverage:LEVERAGE,marginMon,reason});

        if(s.mode==="PAPER") {
          s.positions.push({id:crypto.randomUUID(),symbol:m.symbol,side:action as "LONG"|"SHORT",entry:m.price,marginMon,leverage:LEVERAGE,stop,take,peakMovePct:0,openedAt:now,reason});
          s.lastDecisionAt=now;
          s.trades.push({ts:now,action:"OPEN",symbol:m.symbol,side:action,entry:m.price,marginMon,leverage:LEVERAGE,reason});
          break;
        }
        // LIVE execution is deliberately performed by the worker only after
        // the contract readiness/minimum probe succeeds.
        break;
      }
    }

    await this.save(s);
    return Response.json({
      ok:true,mode:s.mode,balanceMon:s.balanceMon,realizedPnlMon:s.realizedPnlMon,
      positions:s.positions,signals,readiness:s.readiness,
      wins:s.wins,losses:s.losses,consecutiveLosses:s.consecutiveLosses,
      trades:s.trades.slice(-50)
    });
  }
}
