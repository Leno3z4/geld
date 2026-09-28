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
    reason:{type:"string"},
    invalidation:{type:"string"}
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
      "Optimize expected PnL from the factual snapshot below.",
      "Never invent liquidity, social sentiment, holders, whale behavior or catalysts.",
      "Choose BUY, HOLD or SELL. sizePct is a fraction of the configured trade budget for BUY or current position for SELL.",
      "Return only JSON matching the schema. Give a concise reason and one concrete invalidation condition.",
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
          const decision=Decision.parse(JSON.parse(interaction.output_text??""));
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
