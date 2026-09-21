import { Settings, ProviderName, endpoint } from './settings.js';
import { Transport, Questions, Scores, post, parseAnswers, ProviderError } from './jev-client.js';
export const ENV={typesafe:'TYPESAFE_API_KEY',openrouter:'OPENROUTER_API_KEY'};
export interface JevProvider { name:ProviderName; url:string; model:string; }
export class TypeSafeProvider implements JevProvider {name='typesafe' as const;url:string;model:string;constructor(s:Settings){this.url=endpoint(s.typesafe_base_url,s.jev_endpoint_path);this.model=s.jev_model;}}
export class OpenRouterProvider implements JevProvider {name='openrouter' as const;url:string;model:string;constructor(s:Settings){this.url=endpoint(s.openrouter_base_url,'/alpha/decisions');this.model=s.openrouter_model;}}
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
        try{const result=parseAnswers(await this.transport(p.url,this.keys[name],{model:p.model,state,questions},this.config.request_timeout_s),Object.keys(questions));this.last_provider=name;delete this.errors[name];return result;}
        catch(error){last=error instanceof ProviderError?error:new ProviderError('transport_error');}
        this.errors[name]=last.reason;if(!this.config.jev_fallback_on.includes(last.reason))throw last;
      }
      this.cooldowns[name]=this.clock()+this.config.jev_fallback_cooldown_s;previous=name;
    }
    throw last;
  }
}
