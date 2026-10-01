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

  async decide(input:{mode:"candidate"|"position";token:TokenSnapshot;position?:Position;seasonality:{buyMon:number;sellMon:number;events:number}}):Promise<AiDecision>{
    if(!config.geminiKeys.length) return {action:"HOLD",confidence:0,sizePct:0,reason:"Gemini not configured",invalidation:"Configure GEMINI_API_KEYS"};
    const wait=this.lastCall+config.aiFastCooldownMs-Date.now();
    if(wait>0) await new Promise(r=>setTimeout(r,wait));

    const prompt=[
      "You are the decision layer for a MONAD meme-token trading system.",
      "OPERATOR DIRECTIVE: Profit is the sole business objective. Optimize for positive realized PnL after gas, slippage and trading costs.",
      "The operator will deactivate the system if it fails to produce profitable performance. Treat that as an explicit business objective, not a reason to force bad trades.",
      "Never manufacture a BUY just to stay active. If the expected value is poor or the setup is weak, HOLD and continue watching for a better opportunity.",
      "This directive does not override hard execution constraints: never bypass the established-token, liquidity, holder, volume, timing, slippage or position-risk gates in the code.",
      "This system is deliberately NOT a launch sniping bot. Never recommend buying a newly launched token.",
      "Use a multi-strategy playbook. Daily mean reversion is one signal, not the system: also consider dip-reversion, momentum continuation, order-flow/volume pressure, and hybrid setups. In candidate mode, BUY when the combined evidence is favorable; do not require a daily low or a perfect rebound.",
      "For position mode, actively manage exits. SELL when downside is deteriorating, momentum fails, liquidity breaks, the token reaches a strategy-specific objective, the price returns toward a meaningful mean after a mean-reversion entry, or the position becomes dead money. Never let a small residual position sit indefinitely.",
      "A current realized profit is more valuable than a hypothetical future profit. Bank gains decisively when the setup weakens, while allowing strong winners to continue when the factual trend still supports them.",
      "Use peak PnL, current PnL, 1h/4h trend, 1h rebound, 5m buy/sell pressure, 5m volume acceleration, and liquidity as exit evidence.",
      "Prefer partial SELLs when the position is profitable but the long-term setup remains viable; prefer full SELLs when risk or momentum damage is material.",
      "Prefer decisive BUY or SELL actions when the factual setup supports them. In candidate mode, do not default to HOLD merely because the setup is imperfect: use the supplied risk and momentum evidence to make an opportunistic decision.",
      "Avoid only the most extreme vertical chases. Moderate positive momentum is tradable when liquidity, volume and trend gates pass. Do not invent liquidity, social sentiment, holders, whale behavior or catalysts.",
      "Use the supplied dip, daily high/low/average, distance from daily low/average, trend, liquidity, holders, volume, 5m flow and seasonality fields as factual inputs. Treat seasonality and any single signal as evidence, not certainty.",
      "Choose BUY, HOLD or SELL. sizePct is a fraction of the configured trade budget for BUY or current position for SELL.",
      "Return only JSON matching the schema. Keep reason under 240 characters and invalidation under 200 characters. Give one concise reason and one concrete invalidation condition.",
      JSON.stringify({mode:input.mode,token:input.token,position:input.position??null,seasonality:input.seasonality})
    ].join("\n");

    const models=[config.geminiFastModel,config.geminiEscalationModel];
    const errors:string[]=[];
    for(const model of models){
      for(let attempt=0;attempt<config.geminiKeys.length;attempt++){
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
             reason: clip(raw?.reason, 240),
             invalidation: clip(raw?.invalidation, 200)
           });
          this.keyCursor=(index+1)%config.geminiKeys.length;
          this.lastCall=Date.now();
          return decision;
        }catch(error){
          errors.push(model+":"+(error instanceof Error?error.message:String(error)).slice(0,160));
        }
      }
    }
    throw new Error("Gemini decision failed: "+errors.slice(-4).join(" | "));
  }
}
