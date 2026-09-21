import { Settings, ProviderName, endpoint } from './settings.js';
import { Transport, Questions, Scores, post, parseAnswers, ProviderError } from './jev-client.js';
export const ENV={typesafe:'TYPESAFE_API_KEY',openrouter:'OPENROUTER_API_KEY'};
export interface JevProvider { name:ProviderName; url:string; model:string; payload?(state:unknown,questions:Questions):unknown; normalize?(response:unknown):unknown; }
export const NATIVE_DECISIONS_PATH='/alpha/decisions';
const CHAT_INSTRUCTIONS='You are a retention scorer. For every question id you are given, answer with the probability between 0 and 1 that the answer to that question is yes, judging only from the state you receive. Reply with JSON only, shaped exactly as {"answers": {"<question id>": {"noul": <number>}}}. Add no commentary.';
export function chatRequest(model:string,state:unknown,questions:Questions){return {model,temperature:0,response_format:{type:'json_object'},messages:[{role:'system',content:CHAT_INSTRUCTIONS},{role:'user',content:JSON.stringify({state,questions})}]};}
export function decisionsAnswers(response:unknown):unknown {
  if(!response||typeof response!=='object')throw new ProviderError('malformed');
  const body=response as {answers?:Record<string,unknown>;choices?:unknown[]};
  const wrap=(answers:Record<string,unknown>)=>({answers:Object.fromEntries(Object.entries(answers).map(([q,v])=>[q,v&&typeof v==='object'?v:{noul:v}]))});
  if(body.answers&&typeof body.answers==='object'&&Object.keys(body.answers).length)return wrap(body.answers);
  const choices=body.choices;
  if(!Array.isArray(choices)||!choices.length||typeof choices[0]!=='object')throw new ProviderError('malformed');
  const content=(choices[0] as {message?:{content?:unknown}}).message?.content;
  if(typeof content!=='string'||!content.trim())throw new ProviderError('malformed');
  let parsed:unknown;
  try{parsed=JSON.parse(content.trim().replace(/^```[a-zA-Z0-9]*\s*/,'').replace(/\s*```$/,''));}catch{throw new ProviderError('malformed');}
  const answers=parsed&&typeof parsed==='object'?(parsed as {answers?:Record<string,unknown>}).answers:null;
  if(!answers||typeof answers!=='object'||!Object.keys(answers).length)throw new ProviderError('malformed');
  return wrap(answers);
}
export class TypeSafeProvider implements JevProvider {name='typesafe' as const;url:string;model:string;constructor(s:Settings){this.url=endpoint(s.typesafe_base_url,s.jev_endpoint_path);this.model=s.jev_model;}}
/**
 * Two selectable OpenRouter surfaces behind one chain.
 *
 * The default is the native Decisions surface, because OpenRouter refuses the
 * Jev model anywhere else: a chat completions request for it returns
 * 400 "is a decisions model and cannot be used with the chat/completions
 * endpoint. Use the /api/alpha/decisions endpoint instead." Setting
 * openrouter_endpoint_path to any other path selects the chat completions
 * adapter, which is what a self-hosted or proxied gateway speaks.
 */
export class OpenRouterProvider implements JevProvider {
  name='openrouter' as const;url:string;model:string;readonly chat_surface:boolean;
  constructor(s:Settings){this.url=endpoint(s.openrouter_base_url,s.openrouter_endpoint_path);this.model=s.openrouter_model;this.chat_surface=s.openrouter_endpoint_path!==NATIVE_DECISIONS_PATH;}
  payload(state:unknown,questions:Questions):unknown{return this.chat_surface?chatRequest(this.model,state,questions):{model:this.model,state,questions};}
  normalize(response:unknown):unknown{return this.chat_surface?decisionsAnswers(response):response;}
}
/**
 * One synthetic probe per configured provider, for the jev_calibrate dry run.
 * Reports latency and status for each provider without touching session data.
 */
export async function probeProviders(config:Settings,env:Record<string,string|undefined>=process.env,transport?:Transport,clock?:()=>number,log?:(s:string)=>void){
  const probes:{provider:ProviderName;status:string;ms:number;scores?:Scores;reason?:string}[]=[];
  for(const provider of ['typesafe','openrouter'] as const){
    const started=performance.now();
    try{
      const probe=new ProviderChain({...config,jev_provider:provider,jev_fallback_enabled:false},env,transport,clock,log);
      const scores=await probe.score({history:[]},{'calibrate:anchor_keep':{type:'noul',instructions:'Dry run probe for '+provider+'.'}});
      probes.push({provider,status:'ok',ms:Math.round(performance.now()-started),scores});
    }catch(error){
      probes.push({provider,status:'error',ms:Math.round(performance.now()-started),reason:error instanceof ProviderError?error.reason:String((error as Error).message??error)});
    }
  }
  return probes;
}
export class ProviderChain {
  order:ProviderName[];private keys:Record<ProviderName,string>;providers:Record<ProviderName,JevProvider>;
  cooldowns:Partial<Record<ProviderName,number>>={};errors:Partial<Record<ProviderName,string>>={};last_provider='';fallback_count=0;calls=0;
  constructor(readonly config:Settings,env:Record<string,string|undefined>=process.env,public transport:Transport=post,readonly clock=()=>performance.now()/1000,readonly log:(s:string)=>void=()=>{}){
    this.keys={typesafe:env.TYPESAFE_API_KEY?.trim()??'',openrouter:env.OPENROUTER_API_KEY?.trim()??''};
    if(config.jev_provider!=='auto'&&!this.keys[config.jev_provider])throw new Error('missing '+ENV[config.jev_provider]);
    this.order=(config.jev_provider==='auto'?config.jev_fallback_order:[config.jev_provider]).filter(p=>this.keys[p]);
    if(!config.jev_fallback_enabled)this.order=this.order.slice(0,1);
    this.providers={typesafe:new TypeSafeProvider(config),openrouter:new OpenRouterProvider(config)};
  }
  diagnostics(){return {order:this.order,keys_present:(Object.keys(ENV) as ProviderName[]).filter(p=>this.keys[p]).map(p=>ENV[p]),cooldown_seconds:Object.fromEntries(Object.entries(this.cooldowns).map(([p,t])=>[p,Math.max(0,t-this.clock())])),last_errors:this.errors,last_provider:this.last_provider};}
  async score(state:unknown,questions:Questions):Promise<Scores>{
    if(!this.order.length)throw new ProviderError('disabled');
    const available=this.order.filter(p=>(this.cooldowns[p]??0)<=this.clock());
    if(!available.length)throw new ProviderError('cooldown');
    let previous=this.order[0],last=new ProviderError('cooldown');
    for(const [index,name] of available.entries()){
      if(name!==this.order[0]){this.fallback_count+=1;this.log(`jev_provider_fallback from=${previous} to=${name} reason=${this.errors[previous]??'cooldown'}`);}
      const attempts=index+1<available.length?1:1+this.config.jev_fallback_max_retries;
      for(let attempt=0;attempt<attempts;attempt+=1){
        this.calls+=1;const p=this.providers[name];
        try{const body=p.payload?p.payload(state,questions):{model:p.model,state,questions};const raw=await this.transport(p.url,this.keys[name],body,this.config.request_timeout_s);const result=parseAnswers(p.normalize?p.normalize(raw):raw,Object.keys(questions));this.last_provider=name;delete this.errors[name];return result;}
        catch(error){last=error instanceof ProviderError?error:new ProviderError('transport_error');}
        this.errors[name]=last.reason;if(!this.config.jev_fallback_on.includes(last.reason))throw last;
      }
      this.cooldowns[name]=this.clock()+this.config.jev_fallback_cooldown_s;previous=name;
    }
    throw last;
  }
}
