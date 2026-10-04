import { Settings, ProviderName, endpoint } from './settings.js';
import { Transport, Questions, Scores, post, parseAnswers, ProviderError } from './jev-client.js';
import { LAYA_FALLBACK_FAILURE_LIMIT,layaFailureCount,noteLayaFailure,noteLayaSuccess } from './laya-breaker.js';
import { CLEF_ACCOUNT_ENV, CLEF_TOKEN_ENV, clef_answers, clef_checkpoint, clef_chunk, clef_credentials_error, clefUrl } from './clef.js';
export const ENV={typesafe:'TYPESAFE_API_KEY',openrouter:'OPENROUTER_API_KEY',laya:'LAYA_API_KEY',clef:CLEF_TOKEN_ENV};
/**
 * The environment variables a provider needs, in the order a missing variable is
 * reported. Clef needs two: the token is its credential and the account id is
 * configuration, because the Workers AI run endpoint is per account.
 */
export const CLEF_ENV=[CLEF_ACCOUNT_ENV,CLEF_TOKEN_ENV];
export {clef_checkpoint,clefUrl};
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
 * A Laya server on loopback, answering the Decisions contract.
 *
 * Laya is not a hosted Jev endpoint. It is a separate local model that speaks
 * the same /v1/systemone shape, so under `laya` it replaces the hosted pair for
 * a profile rather than joining the fallback chain. That route is keyless: no
 * credential is required, and LAYA_API_KEY is sent only when the server was
 * started with its own bearer check.
 *
 * `laya_then_hosted` is the explicit opt-in that does put the local hop inside
 * a chain, with the hosted providers after it. Privacy consequence: the plain
 * `laya` route never leaves the machine, and this one does, because a local
 * attempt that fails with a configured trigger re-sends the same state to the
 * hosted API. That is the point of the mode, and it is why the mode is not
 * reachable through `auto` and why it loads only when a hosted key exists.
 *
 * Repeated local failures are bounded: the third consecutive one still
 * attempts the hosted hop, and every further one until a local success
 * suppresses the remote leg and re-raises the local error instead. The count
 * lives in `laya-breaker.ts`, is per process, and is cleared only by a
 * successful local answer.
 */
export class LayaProvider implements JevProvider {
  name='laya' as const;url:string;model:string;
  constructor(s:Settings){this.url=endpoint(s.laya_base_url,s.laya_endpoint_path);this.model=s.laya_model;}
}
/**
 * Cloudflare Workers AI Clef, a hosted decision model of its own.
 *
 * Clef is not a Jev endpoint and not a proxy for one. It is selected by name,
 * reachable alone, and permitted inside `jev_fallback_order` as a hosted member
 * like the other two. Unlike Laya it needs no separate opt-in chain mode: both
 * are hosted, so both send the request off the machine.
 *
 * Two properties of this surface are handled here rather than in the generic
 * chain, because both concern the request and not the ranking:
 *
 *  - The URL is per account, so it is resolved from the account id at request
 *    time, not from a configured base. `clefUrl` refuses an unset or
 *    malformed account before a socket is opened.
 *  - A caller's batch may exceed what one request can carry, and every real
 *    question id in this repository contains a ':' that Clef rejects, so a
 *    request is more than `{model,state,questions}` on this route. Both are
 *    applied here and undone before the answers leave, so `score()` above this
 *    class, and every caller of it, still sees one question map and one answer
 *    map under the ids it passed in.
 *
 * This class performs no credential check and no request of its own; the chain
 * owns the environment and the transport, and `payload` only shapes a body.
 */
export class ClefProvider implements JevProvider {
  name='clef' as const;url:string;model:string;
  constructor(s:Settings){this.url='';this.model=clef_checkpoint(s.clef_model);}
  /** The request body Clef documents, under ids this provider accepts. */
  body(state:unknown,questions:Questions):{model:string;state:unknown;questions:Questions}{return {model:this.model,state,questions};}
}
/**
 * The order a dry run probes: the local route alone for `laya`, the local hop
 * followed by the hosted members a key exists for in `laya_then_hosted`, and
 * the full hosted pair otherwise so a missing key still reports its variable
 * name.
 */
export function routeNames(config:Settings,env:Record<string,string|undefined>):ProviderName[] {
  if(config.jev_provider==='laya')return ['laya'];
  if(config.jev_provider==='clef')return ['clef'];
  const hosted=config.jev_fallback_order.filter(p=>usable(p,env));
  if(config.jev_provider==='laya_then_hosted')return ['laya',...(hosted.length?hosted:config.jev_fallback_order)];
  return ['typesafe','openrouter'];
}
/**
 * Whether a provider can authenticate at all. The hosted providers do not
 * agree on what a credential is, so this asks each one in its own terms: a key
 * for TypeSafe and OpenRouter, and both Cloudflare values for Clef, because
 * the account id is part of its endpoint rather than an optional setting.
 */
function usable(provider:ProviderName,env:Record<string,string|undefined>):boolean{
  return provider==='clef'?!clef_credentials_error(env):Boolean(env[ENV[provider]]?.trim());
}
/**
 * The provider's environment values, trimmed, read one at a time.
 *
 * Written as a helper rather than four `env.X?.trim()??''` chains inside one
 * object literal on purpose: that compact sequence miscompiles under the
 * tsx/esbuild transform this package's test runner uses, and it dropped the
 * Clef token while the account id on the next line still arrived, which is a
 * silent credential loss rather than a visible failure.
 */
export function credentials(env:Record<string,string|undefined>):Record<ProviderName,string>{
  return {typesafe:env.TYPESAFE_API_KEY?.trim()??'',openrouter:env.OPENROUTER_API_KEY?.trim()??'',laya:env.LAYA_API_KEY?.trim()??'',clef:env.CLOUDFLARE_API_TOKEN?.trim()??''};
}
/**
 * One synthetic probe per provider in the configured route, for the
 * jev_calibrate dry run. Reports latency and status without touching session
 * data. A local route probes only the local server, since it replaces the
 * hosted pair.
 */
export async function probeProviders(config:Settings,env:Record<string,string|undefined>=process.env,transport?:Transport,clock?:()=>number,log?:(s:string)=>void){
  const probes:{provider:ProviderName;status:string;ms:number;scores?:Scores;reason?:string}[]=[];
  const names=routeNames(config,env);
  for(const provider of names){
    const started=performance.now();
    try{
      const probe=new ProviderChain({...config,jev_provider:provider,jev_fallback_enabled:false},env,transport,clock,log);
      const scores=await probe.score({history:[]},{'calibrate:anchor_keep':{type:'noul',instructions:'Dry run probe for '+provider+'.'}});
      probes.push({provider,status:'ok',ms:Math.round(performance.now()-started),scores});
    }catch(error){
      // A route can fail to construct at all, when its credential is missing,
      // so the probe reports that the same way it reports a failed request.
      probes.push({provider,status:'error',ms:Math.round(performance.now()-started),reason:error instanceof ProviderError?error.reason:String((error as Error).message??error)});
    }
  }
  return probes;
}
export class ProviderChain {
  order:ProviderName[];private keys:Record<ProviderName,string>;accounts:Partial<Record<ProviderName,string>>={};providers:Record<ProviderName,JevProvider>;
  cooldowns:Partial<Record<ProviderName,number>>={};errors:Partial<Record<ProviderName,string>>={};last_provider='';fallback_count=0;calls=0;
  constructor(readonly config:Settings,env:Record<string,string|undefined>=process.env,public transport:Transport=post,readonly clock=()=>performance.now()/1000,readonly log:(s:string)=>void=()=>{}){
    // Read each value once, through a helper, rather than inlining four
    // `env.X?.trim()??''` chains into one object literal. The compact form
    // miscompiles under the tsx/esbuild transform this test runner uses, and
    // it silently dropped the Clef token while the account id still arrived.
    this.keys=credentials(env);
    // Clef's account id is configuration rather than a credential: it names the
    // account whose endpoint and billing the request uses. It is kept beside
    // the keys so one diagnostics object describes the whole route, and only
    // its presence is ever reported.
    this.accounts={clef:env.CLOUDFLARE_ACCOUNT_ID?.trim()??''};
    if(config.jev_provider==='laya'){
      // Local mode replaces the hosted pair: one provider, no credential, and
      // no chain to fall through.
      this.order=['laya'];
    }else if(config.jev_provider==='clef'){
      // Clef mode leads with Clef. Both Cloudflare values are required, because
      // the run endpoint is per account and the account is not inferable from
      // the token, so a route that cannot address the account must fail here
      // rather than on the first scored batch.
      const missing=clef_credentials_error(env);
      if(missing)throw new Error(missing);
      // The account id goes into the URL, so it is resolved once here: a value
      // that cannot address an account fails at load, not on the first batch.
      clefUrl(this.accounts.clef??'',clef_checkpoint(config.clef_model));
      this.order=['clef',...config.jev_fallback_order.filter(p=>p!=='clef'&&usable(p,env))];
    }else if(config.jev_provider==='laya_then_hosted'){
      // Explicit opt-in chain: the local hop leads and the hosted providers it
      // can authenticate against follow. The mode promises a fallback, so an
      // order with no hosted member is a load error rather than a quiet
      // local-only route.
      const hosted=config.jev_fallback_order.filter(p=>usable(p,env));
      if(!hosted.length)throw new Error('missing '+config.jev_fallback_order.map(p=>ENV[p]).join(' and ')+' for jev_provider laya_then_hosted');
      this.order=['laya',...hosted];
    }else if(config.jev_provider==='auto'){
      // The hosted chain contains only providers with a usable key. The keyless
      // local route is never selected on its own initiative.
      this.order=config.jev_fallback_order.filter(p=>usable(p,env));
    }else{
      // Only `typesafe` and `openrouter` reach here: `laya`, `clef`,
      // `laya_then_hosted`, and `auto` are each handled above.
      if(!this.keys[config.jev_provider])throw new Error('missing '+ENV[config.jev_provider]);
      this.order=[config.jev_provider];
    }
    if(!config.jev_fallback_enabled)this.order=this.order.slice(0,1);
    this.providers={typesafe:new TypeSafeProvider(config),openrouter:new OpenRouterProvider(config),laya:new LayaProvider(config),clef:new ClefProvider(config)};
  }
  diagnostics(){return {mode:this.config.jev_provider,order:this.order,keys_present:(Object.keys(ENV) as ProviderName[]).filter(p=>this.keys[p]).map(p=>ENV[p]),accounts_present:this.accounts.clef?[CLEF_ACCOUNT_ENV]:[],cooldown_seconds:Object.fromEntries(Object.entries(this.cooldowns).map(([p,t])=>[p,Math.max(0,t-this.clock())])),last_errors:this.errors,last_provider:this.last_provider};}
  /**
   * One request for the generic providers: their configured body, through the
   * chain's transport, then the shared typed-answer validation.
   */
  private async ask(p:JevProvider,name:ProviderName,state:unknown,questions:Questions):Promise<Scores>{
    const body=p.payload?p.payload(state,questions):{model:p.model,state,questions};
    const raw=await this.transport(p.url,this.keys[name],body,this.config.request_timeout_s);
    return parseAnswers(p.normalize?p.normalize(raw):raw,Object.keys(questions),questions);
  }
  /**
   * One score() for the Clef route, however many requests that needs.
   *
   * Clef addresses a per-account endpoint and accepts at most 64 questions per
   * request, while one batch here can hold up to 600 questions under the
   * default candidate cap. The batch is therefore split into requests Clef will
   * accept, every question id is mapped onto one it accepts, and each answer is
   * mapped back before it leaves this method, so a caller sees exactly the ids
   * it passed in and exactly the score count it asked for.
   *
   * The credentials are re-checked per request rather than trusted from
   * construction, because a chain can be built before the environment is
   * populated and because this method is the only place a socket is opened for
   * this provider. A missing value fails here, naming the variable, before any
   * request is sent.
   */
  private async clefScore(p:ClefProvider,state:unknown,questions:Questions):Promise<Scores>{
    const missing=clef_credentials_error({[CLEF_ACCOUNT_ENV]:this.accounts.clef??'',[CLEF_TOKEN_ENV]:this.keys.clef});
    if(missing)throw new ProviderError('malformed',missing);
    const url=clefUrl(this.accounts.clef!,p.model);
    const out:Scores={};
    for(const part of clef_chunk(questions)){
      const raw=await this.transport(url,this.keys.clef,p.body(state,part.questions),this.config.request_timeout_s);
      const parsed=parseAnswers(clef_answers(raw),Object.keys(part.questions),part.questions);
      for(const [sent,score] of Object.entries(parsed)){const original=part.back[sent];if(original!==undefined)out[original]=score;}
    }
    return out;
  }
  async score(state:unknown,questions:Questions):Promise<Scores>{
    if(!this.order.length)throw new ProviderError('disabled');
    const available=this.order.filter(p=>(this.cooldowns[p]??0)<=this.clock());
    if(!available.length)throw new ProviderError('cooldown');
    let previous=this.order[0],last=new ProviderError('cooldown');
    for(const [index,name] of available.entries()){
      if(name!==this.order[0]){this.fallback_count+=1;this.log(`jev_provider_fallback from=${previous} to=${name} reason=${this.errors[previous]??'cooldown'}`);}
      // The provider just handed over is reported after the fallback decision,
      // so a reader sees the switch and then why. The failure category is the
      // whole of the line: a provider error can quote the state it was asked
      // about, and the state on this path is the reviewed content the next
      // compaction is about to drop, so no message, question, id, answer, or
      // credential value is logged.
      if(index)this.log(`${previous}_provider_failed model=${this.providers[previous].model} reason=${last.reason}`);
      const attempts=index+1<available.length?1:1+this.config.jev_fallback_max_retries;
      for(let attempt=0;attempt<attempts;attempt+=1){
        this.calls+=1;const p=this.providers[name];
        try{const result=name==='clef'?await this.clefScore(p as ClefProvider,state,questions):await this.ask(p,name,state,questions);this.last_provider=name;delete this.errors[name];if(name==='laya')await noteLayaSuccess();return result;}
        catch(error){last=error instanceof ProviderError?error:new ProviderError('transport_error');}
        this.errors[name]=last.reason;if(!this.config.jev_fallback_on.includes(last.reason)){
          // A non-trigger failure ends the chain here and nothing follows it.
          this.log(`${name}_provider_failed model=${p.model} reason=${last.reason}`);throw last;}
      }
      // The local hop is the only provider this breaker covers, and an order of
      // one has no hosted leg to protect, so neither a standalone `laya`
      // profile nor a collapsed chain spends breaker budget. A failure that is
      // not a configured trigger has already thrown above and never reached a
      // hosted URL, so it does not count either.
      if(name==='laya'&&this.order.length>1&&!(await noteLayaFailure())){
        this.log(`laya_fallback_suppressed count=${layaFailureCount()} limit=${LAYA_FALLBACK_FAILURE_LIMIT} reason=${last.reason}`);
        throw last;
      }
      this.cooldowns[name]=this.clock()+this.config.jev_fallback_cooldown_s;previous=name;
    }
    // The last available provider ran out of attempts with no successor, so its
    // category is reported here rather than by the loop above. An order of one
    // is the exception: with no successor there is no handover for the line to
    // explain, and the thrown error already carries the same category to the
    // caller, so a standalone route stays silent.
    if(this.order.length>1)this.log(`${previous}_provider_failed model=${this.providers[previous].model} reason=${last.reason}`);
    throw last;
  }
}
