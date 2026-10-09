import { createHash } from 'node:crypto';import { Candidate,Message,extract } from './anchors.js';import { Settings } from './settings.js';import { ProviderChain } from './providers.js';import { Batcher } from './batcher.js';import { JevThresholdCalibrator } from './calibration.js';import { Metrics } from './metrics.js';import { bytes,shape } from './state-shaper.js';import { decide,questions as questionIds } from './decisions.js';
export class Prepass {
  candidates=new Map<string,Candidate>();messages:Message[]=[];batcher:Batcher;calibrator:JevThresholdCalibrator;metrics:Metrics;
  /**
   * The scoring request in flight for this prepass, keyed by session.
   *
   * `flush` serialises through `flushQueue`, so a session has at most one score
   * call open at a time, and `dispose()` aborts it. Before this existed the
   * caller's `AbortSignal` never reached the transport at all, so a cancelled
   * compaction still burned a full request timeout against the provider.
   */
  private readonly inflight=new Map<string,AbortController>();
  constructor(readonly config:Settings,readonly chain=new ProviderChain(config),log:(s:string)=>void=()=>{},readonly session=''){this.batcher=new Batcher(config.jev_batch_window_turns);this.calibrator=new JevThresholdCalibrator(config);this.metrics=new Metrics(log);}
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
  flush(force=false,signal?:AbortSignal):Promise<void>{
    const next=this.flushQueue.then(()=>this.flushOnce(force,signal));
    this.flushQueue=next.catch(()=>{});
    return next;
  }
  /** Abort the scoring request this session has in flight, if any. */
  dispose(){for(const controller of this.inflight.values())controller.abort();this.inflight.clear();}
  private async flushOnce(force=false,signal?:AbortSignal){
    if(!this.batcher.ready(force))return;this.batcher.flushed();const pending=[...this.candidates.values()].filter(c=>c.jev_unscored);if(!pending.length)return;
    const batch=shape(this.messages,pending,this.config);this.metrics.values.jev_state_tier=batch.tier;
    const [lo,hi]=batch.window;
    const inside=pending.filter(c=>c.message_index>=lo&&c.message_index<hi);
    // A folded history retains only its suffix, so a candidate below that suffix
    // is ranked against evidence the model no longer sees. It is not selected, it
    // stays `jev_unscored`, and it is counted rather than silently dropped.
    this.metrics.values.jev_folded_candidates=batch.state.folded?pending.length-inside.length:0;
    // Candidates the window kept but the budgets could not fit are dropped too;
    // neither count is a fallback, so neither touches `jev_fallbacks`.
    this.metrics.values.jev_dropped_candidates=inside.length-batch.selected.length;
    if(batch.selected.length){
      const controller=new AbortController();this.inflight.set(this.session,controller);
      const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
      try{
        const scores=await this.chain.score(batch.state,batch.questions,combined);
        // A partially readable answer is scored for what it does carry: the
        // chain returns the well-formed ids and the malformed ones, so one bad
        // row among the batch no longer discards every score with it.
        const unusable=new Set(this.chain.malformed_ids);
        const usable=batch.selected.filter(c=>Object.keys(questionIds(c)).every(name=>!unusable.has(name)));
        const malformed=this.chain.malformed_ids.length;
        if(malformed){
          this.metrics.values.jev_partial_fallback_count=Number(this.metrics.values.jev_partial_fallback_count)+1;
          this.metrics.values.jev_malformed_count=Number(this.metrics.values.jev_malformed_count)+malformed;
          this.metrics.log('jev_partial_fallback malformed='+malformed+' of '+Object.keys(batch.questions).length+' answers; the well-formed half is ranked');
        }
        // Nothing readable at all means ranking did not happen for this batch,
        // which is what `jev_fallbacks` counts and what LCM default condensation
        // is the answer to.
        if(!usable.length)this.metrics.values.jev_fallbacks=Number(this.metrics.values.jev_fallbacks)+1;
        if(usable.length){
          const threshold=this.calibrator.observe(Object.entries(scores).filter(([k])=>!k.endsWith(':recovery')).map(([,v])=>v));
          const primary=usable.map(c=>scores[c.id+(c.kind==='anchor'?':anchor_keep':':keep_result')]);
          const retained=this.calibrator.retainedIndices(primary);
          usable.forEach((c,i)=>decide(c,scores,threshold,retained.has(i)));
        }
      }catch{this.metrics.values.jev_fallbacks=Number(this.metrics.values.jev_fallbacks)+1;this.metrics.log('jev_fallback; LCM default condensation');}
      finally{this.inflight.delete(this.session);}
    }
    const all=[...this.candidates.values()];Object.assign(this.metrics.values,{jev_unscored_count:all.filter(c=>c.jev_unscored).length,jev_keep_call_count:all.filter(c=>c.kind==='tool'&&['keep','truncate'].includes(c.action)).length,jev_keep_result_count:all.filter(c=>c.kind==='tool'&&c.action==='keep').length,jev_anchor_count:all.filter(c=>c.kind==='anchor'&&c.action==='keep').length,jev_pruned_units:all.filter(c=>c.action==='drop').length,jev_threshold_current:this.calibrator.current,jev_threshold_calibrated:this.calibrator.calibrated,jev_calls:this.chain.calls,jev_provider_primary:this.chain.last_provider,jev_provider_fallback_count:this.chain.fallback_count});
  }
  /**
   * The protected candidates in the order the Python sibling ranks them: score
   * descending, then by position in the history. This is the only
   * `hint_budget_tokens` enforcement in the shipped path, which is why
   * `summarize()` builds its summary from it rather than from the hint table's
   * table order.
   */
  protected protectedCandidates():Candidate[]{return [...this.candidates.values()].filter(c=>['keep','truncate'].includes(c.action)).sort((a,b)=>Math.max(...Object.values(b.scores),0)-Math.max(...Object.values(a.scores),0)||a.message_index-b.message_index||a.start-b.start);}
  hintBlock(){let text='';for(const c of this.protectedCandidates()){const entry=`[store_id=${c.store_id}; candidate=${c.id}]\n`+(c.call?JSON.stringify(c.call)+'\n':'')+(c.action==='truncate'?c.text.slice(0,this.config.truncate_head_chars)+' [truncated; expand raw evidence]':c.text)+'\n';if(bytes(text+entry)<=this.config.hint_budget_tokens)text+=entry;}return text;}
}
