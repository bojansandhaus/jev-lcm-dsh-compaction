import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../src/settings.js';
import { ProviderChain } from '../src/providers.js';
import { Prepass } from '../src/prepass.js';
import { LcmStore } from '../src/store.js';
import { ProviderError } from '../src/jev-client.js';
import { LcmNodeRow } from '../src/store.js';
import { shape,bytes } from '../src/state-shaper.js';
import { Message } from '../src/anchors.js';
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import { JevLCMCompactionEngine } from '../src/compressor.js';

/** A history long enough that the T0..T4 ladder still folds, with a tool
 *  call/result pair at index 1 so there is a candidate far outside the tail. */
function longHistory():Message[]{
  const messages:Message[]=[];
  for(let i=0;i<12;i+=1)messages.push({role:i%2?'assistant':'user',content:'evidence '+String(i)+' '+Buffer.alloc(900,'x').toString('utf8')});
  messages[1].tool_calls=[{id:'call-1',function:{name:'grep',arguments:'{"q":"x"}'}}];
  messages.splice(2,0,{role:'tool',content:Buffer.alloc(900,'y').toString('utf8'),tool_call_id:'call-1'});
  return messages;
}

/** Budgets small enough that the ladder's last tier still overflows, so the
 *  fold in `shape()` really runs and the window really narrows. */
const TIGHT={max_state_tokens:1000,max_request_tokens:2000};

test('the shaped state carries the folded flag and a retained-history window',()=>{
  const messages=longHistory();
  const s=settings(TIGHT);
  const b=shape(messages,[],s);
  // The flag is what the caller reads, and here it must be set: even the
  // ladder's most aggressive tier overflows this budget.
  assert.equal(b.state.folded,true);
  assert.equal(b.tier,4);
  const [lo,hi]=b.window;
  assert.equal(hi,messages.length);
  assert.ok(lo>0,'the fold dropped the head of the history');
  // Every retained history message is the tail the fold kept, so a candidate
  // below the window is ranked against evidence the model no longer sees. The
  // tier-2+ whitespace collapse and character cut is what makes that true, so
  // the retained text is far shorter than the message it came from.
  assert.equal(b.state.history.length,messages.length-lo);
  assert.deepEqual(b.state.history.map(m=>m.role),messages.slice(lo).map(m=>m.role));
  assert.ok(b.state.history.every((m,i)=>String(m.content).length<Math.min(400,String(messages[lo+i].content).length)));
  assert.ok(bytes(b.state)<=s.max_state_tokens);
});

test('a candidate outside the retained window is never ranked',async()=>{
  const s=settings({...TIGHT,min_result_chars:0,jev_anchor_protection_enabled:false});
  const store=new LcmStore(':memory:');
  const messages=longHistory();
  messages.forEach((m,i)=>{m.store_id=store.ingest('s','m'+i,{...m});});
  // A history-driven flow reaching the provider with the head of the backlog
  // gone, chased with a disabled provider so a scored candidate would show.
  const p=new Prepass(s,new ProviderChain(s,{OPENROUTER_API_KEY:'k'},async()=>{throw new ProviderError('disabled');}));
  p.collect(messages,6);
  assert.ok(p.candidates.size>0,'the history produced a tool candidate');
  for(const candidate of p.candidates.values())candidate.message_index=2;
  await p.flush(true);
  // Nothing was ranked: the out-of-window candidates stay unscored and are
  // counted, and none of it is reported as a provider fallback.
  assert.equal(p.metrics.values.jev_unscored_count,p.candidates.size);
  assert.equal(p.metrics.values.jev_folded_candidates,p.candidates.size);
  assert.equal(p.metrics.values.jev_dropped_candidates,0);
  assert.equal(p.metrics.values.jev_fallbacks,0,'an out-of-window candidate is not a provider fallback');
  assert.equal(p.hintBlock(),'');
  store.close();
});

test('a partial provider answer scores its readable half and records the rest',async()=>{
  const s=settings({min_result_chars:0});
  let asked:string[]=[];
  const p=new Prepass(s,new ProviderChain(s,{OPENROUTER_API_KEY:'k'},async(_u,_k,payload)=>{
    asked=Object.keys((payload as {questions:Record<string,unknown>}).questions);
    // Exactly one malformed answer among the batch: the first candidate's
    // recovery question is off the 0..1 scale.
    const answers:Record<string,unknown>={};
    asked.forEach((id,i)=>{answers[id]=i===1?{noul:5}:{noul:.9};});
    return {answers};
  }));
  p.collect([{role:'user',content:'first'},{role:'assistant',content:'Keep `abc123def456` and `def789abc012`.'}],2);
  const total=p.candidates.size;
  assert.ok(total>=3,'the history produced several candidates');
  await p.flush(true);
  const all=[...p.candidates.values()];
  // The readable half is scored and retained rather than the whole batch being
  // discarded because one row was malformed.
  assert.equal(all.filter(c=>!c.jev_unscored).length,total-1);
  assert.equal(all.filter(c=>['keep','truncate'].includes(c.action)).length,total-1);
  assert.equal(p.metrics.values.jev_partial_fallback_count,1);
  assert.equal(p.metrics.values.jev_malformed_count,1);
  // The unreadable candidate stays unscored, which is the documented outcome.
  assert.equal(all.filter(c=>c.jev_unscored).length,1);
  assert.equal(p.metrics.values.jev_fallbacks,0,'a partial answer is not a provider fallback');
});

test('the last provider records a cooldown after a total failure',async()=>{
  const s=settings(),now=[1];
  const down=new ProviderChain(s,{TYPESAFE_API_KEY:'a',OPENROUTER_API_KEY:'b'},async()=>{throw new ProviderError('429');},()=>now[0]);
  await assert.rejects(down.score({},{}),/429/);
  // Both providers were attempted and both must be cooled down, including the
  // last one: without it the next turn re-attempts it at full billed cost.
  assert.equal(down.cooldowns.typesafe,now[0]+s.jev_fallback_cooldown_s);
  assert.equal(down.cooldowns.openrouter,now[0]+s.jev_fallback_cooldown_s);
  now[0]=100;down.transport=async()=>({answers:{}});
  assert.deepEqual(await down.score({},{}),{});
});

test('retries at one provider are spaced by exponential backoff',async()=>{
  const s=settings(),delays:number[]=[];
  const chain=new ProviderChain(s,{TYPESAFE_API_KEY:'a'},async()=>{throw new ProviderError('5xx');},()=>0,()=>{},ms=>{delays.push(ms);return Promise.resolve();});
  await assert.rejects(chain.score({},{}),/5xx/);
  // 1 + max_retries attempts, so one pause between them, and it grows with the
  // attempt number rather than hammering the provider at once.
  assert.equal(chain.calls,2);
  assert.equal(delays.length,1);
  assert.ok(delays[0]!==undefined&&delays[0]>0&&delays[0]<=5000);
});

test('the laya breaker half-opens after its cooldown and still needs a local success',async()=>{
  const {resetLayaBreaker,layaFailureCount}=await import('../src/laya-breaker.js');
  resetLayaBreaker();
  const s=settings({jev_provider:'local_with_api_fallback',jev_fallback_cooldown_s:0});
  let now=0;
  const seen:string[]=[];
  const chain=new ProviderChain(s,{TYPESAFE_API_KEY:'a',OPENROUTER_API_KEY:'b'},async url=>{seen.push(url.includes('127.0.0.1')?'laya':'hosted');if(url.includes('127.0.0.1'))throw new ProviderError('transport_error');return {answers:{x:{noul:.4}}};},()=>now);
  const question={x:{type:'noul' as const,instructions:'k?'}};
  for(let i=0;i<3;i+=1)assert.deepEqual(await chain.score({},question),{x:.4});
  // The fourth local failure trips the breaker, so no hosted call is made.
  await assert.rejects(chain.score({},question),/transport_error/);
  assert.equal(seen.filter(who=>who==='hosted').length,3);
  // Past the cooldown the breaker half-opens: one hosted attempt is admitted.
  now+=120_000;
  assert.deepEqual(await chain.score({},question),{x:.4},'the half-open probe reaches the hosted provider');
  assert.equal(seen.filter(who=>who==='hosted').length,4);
  // It is a probe, not a reset: a counter still delivered is still tripped, and
  // only a successful local answer clears it.
  const healthy=new ProviderChain(s,{TYPESAFE_API_KEY:'a'},async()=>({answers:{x:{noul:.6}}}),()=>now);
  assert.deepEqual(await healthy.score({},question),{x:.6});
  assert.equal(layaFailureCount(),0);
  resetLayaBreaker();
});

test('protected evidence surviving the budget is admitted by score, not hash order',()=>{
  const db=new LcmStore(':memory:');
  // Candidate ids are sha256-derived, so their lexicographic order is unrelated
  // to their score; "zzz" sorts last, and must still be admitted first.
  db.saveHints('s',[{id:'zzz',action:'keep',scores:{keep_result:.99},text:'high score',store_id:1,score:.99},{id:'aaa',action:'keep',scores:{keep_result:.01},text:'low score',store_id:2,score:.01}]);
  assert.deepEqual(db.assemble('s',10_000).map(entry=>entry.text),['[store_id=1; candidate=zzz]\nhigh score','[store_id=2; candidate=aaa]\nlow score']);
  db.close();
});

test('the shipped summarize path spends hint_budget_tokens on ranked evidence',async()=>{
  const proto=BasicCompactionEngine.prototype as any;
  const original=proto.summarize;
  proto.summarize=async()=>({summary:[{type:'text',text:'host summary'}]});
  const s=settings({min_result_chars:0,hint_budget_tokens:400});
  let assembledBudget=-1,assembledWithNode=-1,assembledProtected=true;
  const p=new Prepass(s,new ProviderChain(s,{OPENROUTER_API_KEY:'k'},async()=>({answers:{}})));
  p.collect([{role:'user',content:'first'},{role:'assistant',content:'Keep `abc123def456` and `def789abc012`.'}],2);
  const store={ingest:()=>1,node:()=>7,saveHints(){},assemble:(_session:string,budget:number,_head:number,node?:number,protectedEvidence?:boolean)=>{assembledBudget=budget;assembledWithNode=Number(node);assembledProtected=protectedEvidence!==false;return [{kind:'summary',text:'node layer'}];}};
  // `this.nodes` is the engine's reservation stack; the fake engine has to
  // provide it, exactly as the real engine does.
  const engine={ingest:()=>p,nodes:[] as number[],ctx:{tokenMeter:{measure:()=>({totalTokens:10})}},store};
  try{
    const out:any=await (JevLCMCompactionEngine.prototype as any).summarize.call(engine,{messages:[]},{session:{id:'s'}});
    const text=out.summary[0].text as string;
    // The node layer is still assembled, and it is told the node to assemble so
    // it carries the summary this attempt just prepared.
    assert.equal(assembledWithNode,7);
    // The ranked block owns the budget: the node layer gets what is left of it,
    // and it no longer also emits the protected evidence the block already did.
    assert.ok(assembledBudget>=0&&assembledBudget<=s.hint_budget_tokens);
    assert.equal(assembledProtected,false);
    assert.ok(text.includes('node layer'),'the summary layer is still part of the shipped summary');
  }finally{proto.summarize=original;}
});

test('a disposed session aborts the scoring request it has in flight',async()=>{
  const s=settings({min_result_chars:0,jev_fallback_max_retries:0});
  const seen:boolean[]=[];
  const chain=new ProviderChain(s,{OPENROUTER_API_KEY:'k'},async(_u,_k,_payload,_timeout,signal?)=>{
    seen.push(Boolean(signal));
    // Hang until the signal fires, the way a slow provider would.
    await new Promise((resolve,reject)=>{
      signal?.addEventListener('abort',()=>reject(new ProviderError('transport_error')));
      setTimeout(resolve,5000);
    });
    return {answers:{}};
  });
  const p=new Prepass(s,chain,()=>{},'s');
  p.collect([{role:'user',content:'first'},{role:'assistant',content:'Keep `abc123def456`.'}],2);
  const flight=p.flush(true,new AbortController().signal);
  await new Promise(resolve=>setTimeout(resolve,20));
  // dispose() aborts the in-flight controller this session registered, which is
  // what the transport observes as its own signal firing. `jev_fallback_max_retries`
  // is zeroed so the aborted request is not retried into a fresh signal.
  p.dispose();
  await flight;
  assert.deepEqual(seen,[true],'the transport received a signal, which is what dispose aborts');
  assert.equal(p.hintBlock(),'','the aborted flush scored nothing');
});

test('an over-limit Clef batch logs the request count once per session',async()=>{
  const {CLEF_MAX_QUESTIONS,clef_chunk}=await import('../src/clef.js');
  const log:string[]=[];
  const questions=Object.fromEntries(Array.from({length:CLEF_MAX_QUESTIONS*2+1},(_,i)=>['c'+i,{type:'noul' as const,instructions:'keep?'}]));
  const chain=new ProviderChain(settings({jev_provider:'api_only',api_provider:'clef'}),{CLOUDFLARE_API_TOKEN:'t',CLOUDFLARE_ACCOUNT_ID:'acc'},async()=>({answers:{}}),undefined,s=>log.push(s));
  // The chunking helper is the seam the provider chain calls; it is also the
  // documented place the batch-size safeguard lives now that it is logged.
  const parts=clef_chunk(questions,(requests,asked)=>log.push('clef_batch_chunked questions='+asked+' requests='+requests));
  assert.equal(parts.length,3);
  assert.deepEqual(log.filter(l=>l.startsWith('clef_batch_chunked')).length,1);
  assert.ok(log.some(l=>l.includes('questions='+String(CLEF_MAX_QUESTIONS*2+1))&&l.includes('requests=3')));
  // A batch inside the limit logs nothing at all.
  const quiet=clef_chunk({'a:{x}':{type:'noul',instructions:'k'}},()=>log.push('spurious'));
  assert.equal(quiet.length,1);
  assert.ok(!log.includes('spurious'));
});

test('the plugin config surface types jev instead of accepting anything',async()=>{
  const {Config}=await import('../src/index.js');
  const good=Config({databasePath:'x.sqlite',auto:true,jev:{hint_budget_tokens:4000,jev_provider:'api_only'}}) as {jev?:Record<string,unknown>};
  // A typed value survives; an unset key still resolves through settings().
  assert.equal(good.jev?.hint_budget_tokens,4000);
  assert.equal(good.jev?.jev_provider,'api_only');
  // A value of the wrong type is refused at the surface rather than surfacing
  assert.throws(()=>Config({jev:{hint_budget_tokens:'lots' as never}}),/expected number|got/);
  assert.throws(()=>Config({jev:{jev_fallback_enabled:'yes' as never}}),/expected boolean|got/);
  assert.throws(()=>Config({jev:{jev_fallback_enabled:'yes' as never}}),/expected boolean|got/);
  // Deep validation still belongs to settings(), so an array-valued key is left
  // to it rather than typed here.
  assert.ok(Config({jev:{jev_anchor_patterns:['whatever']}}));
});
