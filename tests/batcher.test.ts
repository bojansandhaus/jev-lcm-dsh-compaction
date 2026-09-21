import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../src/settings.js';
import { ProviderChain } from '../src/providers.js';
import { Prepass } from '../src/prepass.js';
import { Message } from '../src/anchors.js';
import { LcmStore } from '../src/store.js';

test('541 candidates: batched, bounded, unscored and recoverable',async()=>{
 const db=new LcmStore(':memory:');let calls=0;const s=settings({min_result_chars:0});const p=new Prepass(s,new ProviderChain(s,{OPENROUTER_API_KEY:'x'},async(_u,_k,payload)=>{calls+=1;assert.ok(db.grep('s','abc123def456').length);const q=(payload as {questions:Record<string,unknown>}).questions;return {answers:Object.fromEntries(Object.keys(q).map(k=>[k,{noul:.19}]))};}));
 const messages:Message[]=[{role:'user',content:'first'},{role:'assistant',content:'Keep `abc123def456`.'}];
 for(let i=0;i<541;i+=1)messages.push({role:'assistant',content:'',tool_calls:[{id:String(i),function:{name:'read',arguments:'{}'}}]},{role:'tool',content:`evidence${i} `+'x'.repeat(100),tool_call_id:String(i)});
 messages.push({role:'user',content:'fresh'});messages.forEach((m,i)=>{m.store_id=db.ingest('s','m'+i,{...m});});p.collect(messages,messages.length-1);
 for(let i=0;i<2;i+=1){p.batcher.tick();await p.flush();}assert.equal(calls,0);p.batcher.tick();await p.flush();assert.equal(calls,1);assert.ok(Number(p.metrics.values.jev_unscored_count)>0);assert.ok(p.hintBlock().includes('abc123def456'));
 for(const c of p.candidates.values())if(c.jev_unscored){assert.ok(db.expand('s',c.store_id!));assert.ok(db.grep('s',c.text.split(' ')[0]).length);}
 assert.equal(messages.at(-1)?.content,'fresh');db.close();
});
