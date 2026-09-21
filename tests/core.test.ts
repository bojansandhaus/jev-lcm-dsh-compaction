import test from 'node:test';import assert from 'node:assert/strict';
import { settings,endpoint } from '../src/settings.js';import { JevThresholdCalibrator } from '../src/calibration.js';import { ProviderChain } from '../src/providers.js';import { ProviderError,parseAnswers } from '../src/jev-client.js';import { Prepass } from '../src/prepass.js';import { Message } from '../src/anchors.js';import { extract } from '../src/anchors.js';import { LcmStore } from '../src/store.js';import { Metrics } from '../src/metrics.js';import { shape,tokens } from '../src/state-shaper.js';

test('calibration and minimum retention',()=>{const c=new JevThresholdCalibrator();const values=Array.from({length:500},(_,i)=>i/2500);assert.ok(Math.abs(c.observe(values)-.01996)<1e-12);assert.ok(c.retainedIndices(values).size>=50);assert.equal(new JevThresholdCalibrator(settings({conservative:true})).observe(Array(50).fill(.1)),0);});

test('provider resolution, fallback, cooldown and no secret logging',async()=>{
 const log:string[]=[],now=[1];const s=settings();const c=new ProviderChain(s,{TYPESAFE_API_KEY:'SECRET_A',OPENROUTER_API_KEY:'SECRET_B'},async(url)=>{if(url.includes('typesafe'))throw new ProviderError('429');return {answers:{x:{noul:.19}}};},()=>now[0],s=>log.push(s));
 assert.deepEqual(await c.score({},{x:{type:'noul',instructions:'keep?'}}),{x:.19});assert.equal(c.fallback_count,1);assert.equal(c.last_provider,'openrouter');assert.ok(!JSON.stringify([log,c.diagnostics()]).includes('SECRET_'));
 assert.throws(()=>new ProviderChain(settings({jev_provider:'typesafe'}),{OPENROUTER_API_KEY:'x'}),/TYPESAFE_API_KEY/);
 const only=new ProviderChain(s,{OPENROUTER_API_KEY:'x'},async()=>({answers:{x:{noul:.19}}}));assert.deepEqual(await only.score({},{x:{type:'noul',instructions:'keep?'}}),{x:.19});
 await assert.rejects(new ProviderChain(s,{}).score({},{}),/disabled/);
 const down=new ProviderChain(s,{TYPESAFE_API_KEY:'x',OPENROUTER_API_KEY:'y'},async()=>{throw new ProviderError('429');},()=>now[0]);await assert.rejects(down.score({},{}),/429/);await assert.rejects(down.score({},{}),/cooldown/);now[0]=100;down.transport=async()=>({answers:{}});assert.deepEqual(await down.score({},{}),{});assert.equal(down.last_provider,'typesafe');
});

test('assistant spans are exact',()=>{const text='We must retain `abc123def456` at v1.2.3.';const spans=extract(text,settings().jev_anchor_patterns);assert.ok(spans.some(s=>s.text==='`abc123def456`'));assert.ok(spans.every(s=>text.slice(s.start,s.end)===s.text));});

test('541 candidates: batched, bounded, unscored and recoverable',async()=>{
 const db=new LcmStore(':memory:');let calls=0;const s=settings({min_result_chars:0});const p=new Prepass(s,new ProviderChain(s,{OPENROUTER_API_KEY:'x'},async(_u,_k,payload)=>{calls+=1;assert.ok(db.grep('s','abc123def456').length);const q=(payload as {questions:Record<string,unknown>}).questions;return {answers:Object.fromEntries(Object.keys(q).map(k=>[k,{noul:.19}]))};}));
 const messages:Message[]=[{role:'user',content:'first'},{role:'assistant',content:'Keep `abc123def456`.'}];
 for(let i=0;i<541;i+=1)messages.push({role:'assistant',content:'',tool_calls:[{id:String(i),function:{name:'read',arguments:'{}'}}]},{role:'tool',content:`evidence${i} `+'x'.repeat(100),tool_call_id:String(i)});
 messages.push({role:'user',content:'fresh'});messages.forEach((m,i)=>{m.store_id=db.ingest('s','m'+i,{...m});});p.collect(messages,messages.length-1);
 for(let i=0;i<2;i+=1){p.batcher.tick();await p.flush();}assert.equal(calls,0);p.batcher.tick();await p.flush();assert.equal(calls,1);assert.ok(Number(p.metrics.values.jev_unscored_count)>0);assert.ok(p.hintBlock().includes('abc123def456'));
 for(const c of p.candidates.values())if(c.jev_unscored){assert.ok(db.expand('s',c.store_id!));assert.ok(db.grep('s',c.text.split(' ')[0]).length);}
 assert.equal(messages.at(-1)?.content,'fresh');db.close();
});

test('SQLite raw ownership and DAG links survive reopen',()=>{const db=new LcmStore(':memory:');const id=db.ingest('s','m1',{content:'exact'});assert.equal(db.ingest('s','m1',{content:'exact'}),id);assert.throws(()=>db.ingest('s','m1',{content:'changed'}),/ownership/);const a=db.node('s','leaf',[id]);const b=db.node('s','parent',[id]);assert.equal(db.nodes('s')[0].depth,1);assert.deepEqual(db.expand('s',id)?.raw,{content:'exact'});assert.equal(db.expand('other',id),null);assert.ok(db.db.prepare('SELECT * FROM edges WHERE parent=? AND child=?').get(b,a));db.close();});

test('bad input and low freed warnings',()=>{for(const data of [null,{}, {answers:{x:{noul:true}}},{answers:{x:{noul:2}}}])assert.throws(()=>parseAnswers(data,['x']),/malformed/);assert.throws(()=>endpoint('https://api.typesafe.ai/v1'+String.fromCharCode(92),'/systemone'));assert.throws(()=>endpoint('https://example.test','/%2e%2e/x'));const logs:string[]=[];const m=new Metrics(s=>logs.push(s));for(let i=0;i<3;i+=1)m.compaction(100,90,1,30);assert.equal(logs.length,1);assert.equal(m.values.lcm_recall_at_budget,null);});

test('CJK state cap preserves candidates or marks them unscored',()=>{const s=settings({max_state_tokens:1000,max_request_tokens:2000});const b=shape([{role:'user',content:'中文'.repeat(10000)}],[],s);assert.ok(tokens(b.state)<=1000);assert.ok(b.tier>=2);});
