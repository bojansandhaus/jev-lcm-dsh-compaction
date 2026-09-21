import { createHash } from 'node:crypto';import { Candidate,Message,extract } from './anchors.js';import { Settings } from './settings.js';import { ProviderChain } from './providers.js';import { Batcher } from './batcher.js';import { JevThresholdCalibrator } from './calibration.js';import { Metrics } from './metrics.js';import { shape,tokens } from './state-shaper.js';import { decide } from './decisions.js';
export class Prepass {
  candidates=new Map<string,Candidate>();messages:Message[]=[];batcher:Batcher;calibrator:JevThresholdCalibrator;metrics:Metrics;
  constructor(readonly config:Settings,readonly chain=new ProviderChain(config),log:(s:string)=>void=()=>{}){this.batcher=new Batcher(config.jev_batch_window_turns);this.calibrator=new JevThresholdCalibrator(config);this.metrics=new Metrics(log);}
  collect(messages:Message[],tailStart:number){
    this.messages=messages;const previous=this.candidates;this.candidates=new Map();
    const add=(c:Candidate)=>{c.id=createHash('sha256').update(JSON.stringify([c.kind,c.store_id,c.message_index,c.start,c.text,c.call])).digest('hex').slice(0,20);this.candidates.set(c.id,previous.get(c.id)??c);};
    for(let i=1;i<tailStart;i+=1){const m=messages[i];if(m.role==='assistant'&&typeof m.content==='string'&&this.config.jev_anchor_protection_enabled)for(const span of extract(m.content,this.config.jev_anchor_patterns))add({id:'',kind:'anchor',message_index:i,...span,store_id:m.store_id,scores:{},action:'unscored',jev_unscored:true});}
    const calls=new Map<string,{index:number;call:unknown}[]>(),results=new Map<string,{index:number;message:Message}[]>();
    messages.forEach((m,index)=>{for(const call of m.tool_calls??[])calls.set(call.id,[...calls.get(call.id)??[],{index,call}]);if(m.role==='tool'&&m.tool_call_id)results.set(m.tool_call_id,[...results.get(m.tool_call_id)??[],{index,message:m}]);});
    for(const [id,cs] of calls){const rs=results.get(id)??[];if(cs.length!==1||rs.length!==1)continue;const c=cs[0],r=rs[0];if(c.index<=0||c.index>=r.index||r.index>=tailStart||typeof r.message.content!=='string'||r.message.content.length<this.config.min_result_chars)continue;add({id:'',kind:'tool',message_index:c.index,text:r.message.content,start:0,end:0,store_id:r.message.store_id,call:c.call,scores:{},action:'unscored',jev_unscored:true});}
    this.metrics.values.jev_candidates_total=this.candidates.size;
  }
  private flushQueue:Promise<void>=Promise.resolve();
  flush(force=false):Promise<void>{
    const next=this.flushQueue.then(()=>this.flushOnce(force));
    this.flushQueue=next.catch(()=>{});
    return next;
  }
  private async flushOnce(force=false){
    if(!this.batcher.ready(force))return;this.batcher.flushed();const pending=[...this.candidates.values()].filter(c=>c.jev_unscored);if(!pending.length)return;
    const batch=shape(this.messages,pending,this.config);this.metrics.values.jev_state_tier=batch.tier;
    if(batch.selected.length)try{const scores=await this.chain.score(batch.state,batch.questions);const threshold=this.calibrator.observe(Object.entries(scores).filter(([k])=>!k.endsWith(':recovery')).map(([,v])=>v));const primary=batch.selected.map(c=>scores[c.id+(c.kind==='anchor'?':anchor_keep':':keep_result')]);const retained=this.calibrator.retainedIndices(primary);batch.selected.forEach((c,i)=>decide(c,scores,threshold,retained.has(i)));}catch{this.metrics.values.jev_fallbacks=Number(this.metrics.values.jev_fallbacks)+1;this.metrics.log('jev_fallback; LCM default condensation');}
    const all=[...this.candidates.values()];Object.assign(this.metrics.values,{jev_unscored_count:all.filter(c=>c.jev_unscored).length,jev_keep_call_count:all.filter(c=>c.kind==='tool'&&['keep','truncate'].includes(c.action)).length,jev_keep_result_count:all.filter(c=>c.kind==='tool'&&c.action==='keep').length,jev_anchor_count:all.filter(c=>c.kind==='anchor'&&c.action==='keep').length,jev_pruned_units:all.filter(c=>c.action==='drop').length,jev_threshold_current:this.calibrator.current,jev_threshold_calibrated:this.calibrator.calibrated,jev_calls:this.chain.calls,jev_provider_primary:this.chain.last_provider,jev_provider_fallback_count:this.chain.fallback_count});
  }
  hintBlock(){let text='';for(const c of [...this.candidates.values()].filter(c=>['keep','truncate'].includes(c.action)).sort((a,b)=>Math.max(...Object.values(b.scores))-Math.max(...Object.values(a.scores)))){const entry=`[store_id=${c.store_id}; candidate=${c.id}]\n`+(c.call?JSON.stringify(c.call)+'\n':'')+(c.action==='truncate'?c.text.slice(0,this.config.truncate_head_chars)+' [truncated; expand raw evidence]':c.text)+'\n';if(tokens(text+entry)<=this.config.hint_budget_tokens)text+=entry;}return text;}
}
