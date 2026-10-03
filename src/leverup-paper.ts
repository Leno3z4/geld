import { DurableObject } from "cloudflare:workers";

export interface LeverUpPaperSnapshot { symbol:string; price:number; ts:number; }
type Pos={id:string;symbol:string;side:"LONG"|"SHORT";entry:number;marginUsd:number;leverage:number;stop:number;take:number;peak:number};
type State={startedAt:number;mode:"PAPER"|"LIVE";switchedAt?:number;balanceUsd:number;initialUsd:number;realizedUsd:number;positions:Pos[];samples:Record<string,{ts:number;price:number}[]>;daily:Record<string,{day:string;open:number;high:number;low:number;close:number;samples:number}>;trades:any[];losses:number;lastDecisionAt:number;liveUntil:Record<string,number>};

const LEV=5, FEE=0.00045, MARGIN_PCT=5, STOP=0.008, TAKE=0.016, EXTREME=.18, COOLDOWN=15*60_000;

const day=(t:number)=>new Date(t).toISOString().slice(0,10);
const move=(a:number,b:number)=>b?((a/b)-1)*100:0;

export class GeldLeverUpPaper extends DurableObject {
  async state():Promise<State>{
    const x=await this.ctx.storage.get<State>("state"); if(x)return x;
    const now=Date.now(), usd=50*0.0314;
    const s:State={startedAt:now,mode:"PAPER",balanceUsd:usd,initialUsd:usd,realizedUsd:0,positions:[],samples:{},daily:{},trades:[],losses:0,lastDecisionAt:0,liveUntil:{}};
    await this.ctx.storage.put("state",s); return s;
  }
  async save(s:State){await this.ctx.storage.put("state",s);}
  decide(s:State,m:LeverUpPaperSnapshot){
    const d=s.daily[m.symbol], a=s.samples[m.symbol]??[];
    if(!d||d.samples<20)return ["HOLD","building daily range"] as const;
    const r=d.high-d.low, loc=r>0?(m.price-d.low)/r:.5;
    const h=a.filter(x=>m.ts-x.ts<=3600000), t=move(m.price,h[0]?.price??m.price);
    if(loc<=EXTREME&&t>-0.35)return ["LONG","daily-low zone + reversal"] as const;
    if(loc>=1-EXTREME&&t<0.35)return ["SHORT","daily-high zone + rejection"] as const;
    return ["HOLD","mid-range"] as const;
  }
  close(s:State,p:Pos,price:number,reason:string,ts:number){
    const m=p.side==="LONG"?move(price,p.entry):move(p.entry,price);
    const pnl=p.marginUsd*p.leverage*m/100-(p.marginUsd*p.leverage*FEE*2);
    s.balanceUsd+=pnl;s.realizedUsd+=pnl;s.losses=pnl<0?s.losses+1:0;
    s.trades.push({ts,action:"CLOSE",symbol:p.symbol,side:p.side,entry:p.entry,exit:price,pnlUsd:pnl,reason});
    s.positions=s.positions.filter(x=>x.id!==p.id);
  }
  async fetch(req:Request){
    const u=new URL(req.url),s=await this.state(),now=Date.now();
    if(u.pathname==="/status")return Response.json({...s,switchAt:s.startedAt+86400000,ageMs:now-s.startedAt});
    if(u.pathname==="/live-opened"&&req.method==="POST"){const b=await req.json() as {symbol:string};s.liveUntil[b.symbol]=now+6*3600000;await this.save(s);return Response.json({ok:true});}
    if(req.method!=="POST"||u.pathname!=="/tick")return new Response("Not Found",{status:404});
    const body=await req.json() as {snapshots?:LeverUpPaperSnapshot[]};
    const ms=(body.snapshots??[]).filter(x=>x.price>0&&Number.isFinite(x.price));
    for(const m of ms){
      const k=day(m.ts),d=s.daily[m.symbol];
      s.daily[m.symbol]=d?.day===k?{...d,high:Math.max(d.high,m.price),low:Math.min(d.low,m.price),close:m.price,samples:d.samples+1}:{day:k,open:m.price,high:m.price,low:m.price,close:m.price,samples:1};
      s.samples[m.symbol]=[...(s.samples[m.symbol]??[]).filter(x=>m.ts-x.ts<=86400000),{ts:m.ts,price:m.price}].slice(-1500);
      for(const p of [...s.positions].filter(x=>x.symbol===m.symbol)){
        const mv=p.side==="LONG"?move(m.price,p.entry):move(p.entry,m.price);p.peak=Math.max(p.peak,mv);
        if((p.side==="LONG"&&m.price<=p.stop)||(p.side==="SHORT"&&m.price>=p.stop))this.close(s,p,p.stop,"STOP",m.ts);
        else if((p.side==="LONG"&&m.price>=p.take)||(p.side==="SHORT"&&m.price<=p.take))this.close(s,p,p.take,"TAKE_PROFIT",m.ts);
        else if(p.peak>=.8&&mv<=p.peak-.5)this.close(s,p,m.price,"TRAIL",m.ts);
      }
    }
    if(s.mode==="PAPER"&&now-s.startedAt>=86400000){s.mode="LIVE";s.switchedAt=now;s.trades.push({ts:now,action:"MODE_SWITCH",to:"LIVE",reason:"24h paper window complete"});}
    const signals:any[]=[];
    if(s.losses<3&&now-s.lastDecisionAt>=COOLDOWN){
      for(const m of ms){
        if(s.liveUntil[m.symbol]&&s.liveUntil[m.symbol]>now)continue;
        if(s.positions.some(p=>p.symbol===m.symbol))continue;
        const [a,r]=this.decide(s,m);if(a==="HOLD")continue;
        const margin=Math.max(.05,s.balanceUsd*MARGIN_PCT/100);
        const stop=a==="LONG"?m.price*(1-STOP):m.price*(1+STOP);
        const take=a==="LONG"?m.price*(1+TAKE):m.price*(1-TAKE);
        signals.push({symbol:m.symbol,side:a,entry:m.price,stop,take,leverage:LEV,marginUsd:margin,reason:r});
        if(s.mode==="PAPER"){
          s.positions.push({id:crypto.randomUUID(),symbol:m.symbol,side:a as "LONG"|"SHORT",entry:m.price,marginUsd:margin,leverage:LEV,stop,take,peak:0});
          s.lastDecisionAt=now;s.trades.push({ts:now,action:"OPEN",symbol:m.symbol,side:a,entry:m.price,marginUsd:margin,leverage:LEV,reason:r});
          break;
        }
        if(s.mode==="LIVE")break;
      }
    }
    await this.save(s);return Response.json({ok:true,mode:s.mode,balanceUsd:s.balanceUsd,realizedPnlUsd:s.realizedUsd,positions:s.positions,signals,trades:s.trades.slice(-20)});
  }
}