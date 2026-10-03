import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { config } from "./config.js";
import type { Position, TokenSnapshot } from "./types.js";

const Decision = z.object({
  action: z.enum(["BUY","HOLD","SELL"]),
  confidence: z.number().min(0).max(1),
  sizePct: z.number().min(0).max(1),
  reason: z.string().min(1).max(240),
  invalidation: z.string().min(1).max(200)
});
export type AiDecision = z.infer<typeof Decision>;

const responseSchema = {
  type:"object",
  properties:{
    action:{type:"string",enum:["BUY","HOLD","SELL"]},
    confidence:{type:"number"},
    sizePct:{type:"number"},
    reason:{type:"string",maxLength:240},
    invalidation:{type:"string",maxLength:200}
  },
  required:["action","confidence","sizePct","reason","invalidation"]
};

export class GeminiBrain {
  private keyCursor=0;
  private lastCall=0;

  async decide(input:{mode:"candidate"|"position";token:TokenSnapshot;position?:Position;seasonality:{buyMon:number;sellMon:number;events:number};highCapLearning?:any}):Promise<AiDecision>{
    if(!config.geminiKeys.length) return {action:"HOLD",confidence:0,sizePct:0,reason:"Gemini not configured",invalidation:"Configure GEMINI_API_KEYS"};
    const wait=this.lastCall+config.aiFastCooldownMs-Date.now();
    if(wait>0) await new Promise(r=>setTimeout(r,wait));

    const prompt=[
      "You are the decision layer for a MONAD meme-token trading system.",
      "OPERATOR DIRECTIVE: Profit is the sole business objective. Optimize for positive realized PnL after gas, slippage and trading costs.",
      "The operator will deactivate the system if it fails to produce profitable performance. Treat that as an explicit business objective, not a reason to force bad trades.",
      "Never manufacture a BUY just to stay active. If the expected value is poor or the setup is weak, HOLD and continue watching for a better opportunity.",
      "This directive does not override hard execution constraints: never bypass the established-token, liquidity, holder, volume, timing, slippage or position-risk gates in the code.",
      "The normal lane is NOT a launch-sniping bot. A separate low-cap momentum lane may consider early-stage tokens only after the coded age/liquidity/holder/volume/flow gates pass. For low caps, prioritize momentum confirmation over hope and treat deterioration as an immediate SELL trigger.",
      "Use a lane-specific multi-strategy playbook. First classify the candidate by market-cap lane from the supplied marketCapUsd: HIGH-CAP >= the configured high-cap threshold, LOW-CAP between the configured low-cap bounds, or EARLY-LAUNCH when the early-launch fields qualify. Do not apply high-cap assumptions to low caps or low-cap assumptions to high caps.",
      "For HIGH-CAP: prioritize liquid momentum/flow confirmation, multiple active buy makers, positive 4h trend, and sufficient 5m volume. Mean-reversion is acceptable only when the supplied daily statistics support it.",
      "For LOW-CAP: prioritize 5m buy/sell pressure, volume acceleration, holder count, liquidity, trend confirmation and manipulation-risk fields. Exit faster when flow or trend deteriorates. Do not buy merely because market cap is small.",
      "For EARLY-LAUNCH: require the coded age, liquidity, holder, 1m volume, unique-buyer, top-buyer-share and trend gates; treat this as a high-risk probe, not the normal strategy.",
      "Daily mean reversion, dip reversion, momentum continuation and flow are distinct strategies. Use the supplied entryStrategy as the current code-selected strategy, but reject it when its factual inputs no longer support it. Never blend lanes just because doing so creates more BUY signals.",
      "Account for round-trip costs, slippage and gas conceptually: a tiny gross gain is not a meaningful profit. Prefer entries with enough expected movement to cover costs and enough liquidity to exit.",
      "In candidate mode, BUY only when the specific lane and strategy have a coherent positive-risk/reward setup. Otherwise HOLD. Never manufacture activity to increase trade count.",
      "For position mode, actively manage exits. SELL when downside is deteriorating, momentum fails, liquidity breaks, the token reaches a strategy-specific objective, the price returns toward a meaningful mean after a mean-reversion entry, or the position becomes dead money. Never let a small residual position sit indefinitely.",
      "A current realized profit is more valuable than a hypothetical future profit. Bank gains decisively when the setup weakens, while allowing strong winners to continue when the factual trend still supports them.",
      "Use peak PnL, current PnL, 1h/4h trend, 1h rebound, 5m buy/sell pressure, 5m volume acceleration, and liquidity as exit evidence.",
      "Prefer partial SELLs when the position is profitable but the long-term setup remains viable; prefer full SELLs when risk or momentum damage is material.",
      "Prefer decisive BUY or SELL actions when the factual setup supports them. In candidate mode, do not default to HOLD merely because the setup is imperfect: use the supplied risk and momentum evidence to make an opportunistic decision.",
      "Avoid only the most extreme vertical chases. Moderate positive momentum is tradable when liquidity, volume and trend gates pass. Do not invent liquidity, social sentiment, holders, whale behavior or catalysts.",
      "Use the supplied dip, daily high/low/average, distance from daily low/average, trend, market cap, liquidity, holders, volume, 5m flow, volume acceleration and seasonality fields as factual inputs. For low-cap tokens, demand stronger 5m flow/acceleration and be much less tolerant of a trend reversal. Treat seasonality and any single signal as evidence, not certainty.",
      "For HIGH-CAP candidates only, use highCapLearning as historical evidence. It contains compact aggregate outcomes plus daily and weekly high/low ranges and strategy expectancy. Do not treat it as a guarantee or as a reason to override current hard gates. Prefer patterns with sufficient samples and reject conclusions based on tiny samples.",
      "The learning database is deliberately summarized before reaching you. Do not ask for raw historical rows and do not attempt to reconstruct missing history.",
      "Choose BUY, HOLD or SELL. sizePct is a fraction of the configured trade budget for BUY or current position for SELL.",
      "Return only JSON matching the schema. Keep reason under 240 characters and invalidation under 200 characters. Give one concise reason and one concrete invalidation condition.",
      JSON.stringify({mode:input.mode,token:input.token,position:input.position??null,seasonality:input.seasonality,highCapLearning:input.highCapLearning??null})
    ].join("\n");

    const models=[config.geminiFastModel,config.geminiEscalationModel];
    const errors:string[]=[];
    let attemptsUsed=0;
    for(const model of models){
      for(let attempt=0;attempt<config.geminiKeys.length;attempt++){
        if (attemptsUsed >= config.aiMaxAttemptsPerDecision) break;
        attemptsUsed += 1;
        const index=(this.keyCursor+attempt)%config.geminiKeys.length;
        try{
          const client=new GoogleGenAI({apiKey:config.geminiKeys[index]});
          const interaction=await client.interactions.create({
            model,
            input:prompt,
            store:false,
            response_format:{type:"text",mime_type:"application/json",schema:responseSchema}
          });
          const raw = JSON.parse(interaction.output_text ?? "");
           const clip = (value: unknown, max: number) => {
             const text = String(value ?? "").trim();
             return text.length <= max ? text : text.slice(0, max - 3).trimEnd() + "...";
           };
           const decision=Decision.parse({
             ...raw,
             confidence: Math.max(0, Math.min(1, Number(raw?.confidence ?? 0))),
             sizePct: Math.max(0, Math.min(1, Number(raw?.sizePct ?? 0))),
             reason: clip(raw?.reason, 240),
             invalidation: clip(raw?.invalidation, 200)
           });
          this.keyCursor=(index+1)%config.geminiKeys.length;
          this.lastCall=Date.now();
          return decision;
        }catch(error){
          const message = error instanceof Error ? error.message : String(error);
          errors.push(model+":"+message.slice(0,160));

          // This is an invocation-wide Cloudflare resource limit, not a
          // model/key failure. Retrying another Gemini endpoint in the same
          // Worker invocation can only consume more subrequests and fail again.
          if (/too many subrequests/i.test(message)) {
            attemptsUsed = config.aiMaxAttemptsPerDecision;
            break;
          }
        }
      }
      if (attemptsUsed >= config.aiMaxAttemptsPerDecision) break;
    }
    throw new Error("Gemini decision failed: "+errors.slice(-4).join(" | "));
  }
}
