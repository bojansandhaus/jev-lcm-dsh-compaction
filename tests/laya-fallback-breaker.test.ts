import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../src/settings.js';
import { ProviderChain } from '../src/providers.js';
import { ProviderError } from '../src/jev-client.js';
import { LAYA_FALLBACK_FAILURE_LIMIT, layaFailureCount, resetLayaBreaker } from '../src/laya-breaker.js';

const QUESTION={x:{type:'noul' as const,instructions:'keep?'}};
const LOCAL='http://127.0.0.1:8000/v1/systemone';
const TYPESAFE='https://api.typesafe.ai/v1/systemone';
const BOTH={TYPESAFE_API_KEY:'SECRET_A',OPENROUTER_API_KEY:'SECRET_B'};
const LIMIT=LAYA_FALLBACK_FAILURE_LIMIT;
/**
 * A frozen clock with a zero cooldown leaves the local hop available on every
 * call, so a case exercises the breaker and not the per-provider cooldown.
 */
const config=settings({jev_provider:'laya_then_hosted',jev_fallback_cooldown_s:0});
const frozen=()=>0;
const localFails=(hosted:number)=>(url:string)=>{if(url===LOCAL)throw new ProviderError('transport_error');return {answers:{x:{noul:hosted}}};};
/** Fail the local hop `times` times over, including the suppressed calls. */
async function exhaust(times:number,chain:ProviderChain,state:unknown={}){
  let raised=0;
  for(let i=0;i<times;i+=1)try{await chain.score(state,QUESTION);}catch{raised+=1;}
  return raised;
}

test('three consecutive local failures fall back and the fourth suppresses the remote leg',async()=>{
  resetLayaBreaker();
  const seen:string[]=[],log:string[]=[];
  const chain=new ProviderChain(config,BOTH,async url=>{seen.push(url);return localFails(.37)(url);},frozen,l=>log.push(l));
  for(let i=0;i<LIMIT;i+=1)assert.deepEqual(await chain.score({},QUESTION),{x:.37},'fallback '+String(i+1));
  assert.deepEqual(seen,[LOCAL,TYPESAFE,LOCAL,TYPESAFE,LOCAL,TYPESAFE]);
  assert.equal(chain.fallback_count,LIMIT);
  assert.equal(chain.last_provider,'typesafe');
  const remote=seen.filter(url=>url!==LOCAL).length;
  await assert.rejects(chain.score({},QUESTION),/transport_error/);
  assert.equal(seen.filter(url=>url!==LOCAL).length,remote,'no hosted call past the limit');
  assert.equal(seen[seen.length-1],LOCAL);
  assert.equal(layaFailureCount(),LIMIT+1);
  assert.ok(log.some(l=>l.startsWith('laya_fallback_suppressed')));
  assert.ok(log.some(l=>l.includes('count=4 limit=3 reason=transport_error')));
});

test('a healthy local call resets a tripped counter and the next failure falls back again',async()=>{
  resetLayaBreaker();
  const failing=new ProviderChain(config,BOTH,async url=>localFails(.37)(url),frozen);
  assert.equal(await exhaust(LIMIT+1,failing),1,'only the call past the limit raises');
  assert.equal(layaFailureCount(),LIMIT+1);
  // Three hosted answers never cleared the count; only a local success does.
  const healthy=new ProviderChain(config,BOTH,async url=>{assert.equal(url,LOCAL,'the healthy call must stay local');return {answers:{x:{noul:.5}}};},frozen);
  assert.deepEqual(await healthy.score({},QUESTION),{x:.5});
  assert.equal(layaFailureCount(),0);
  const seen:string[]=[];
  const again=new ProviderChain(config,BOTH,async url=>{seen.push(url);return localFails(.37)(url);},frozen);
  assert.deepEqual(await again.score({},QUESTION),{x:.37});
  assert.deepEqual(seen,[LOCAL,TYPESAFE]);
  assert.equal(again.fallback_count,1);
  assert.equal(layaFailureCount(),1);
});

test('the plain local route clears the same counter',async()=>{
  resetLayaBreaker();
  const failing=new ProviderChain(config,BOTH,async url=>localFails(.37)(url),frozen);
  await failing.score({},QUESTION);
  assert.equal(layaFailureCount(),1);
  const localOnly=new ProviderChain(settings({jev_provider:'laya'}),BOTH,async()=>({answers:{x:{noul:.6}}}),frozen);
  assert.deepEqual(await localOnly.score({},QUESTION),{x:.6});
  assert.equal(layaFailureCount(),0);
});

test('a weak local answer never triggers the hosted fallback',async()=>{
  resetLayaBreaker();
  const seen:string[]=[];
  // The hosted hop would answer .99; the local hop answers 0 and still wins,
  // because the fallback is error-only and there is no quality gate on it.
  const chain=new ProviderChain(config,BOTH,async url=>{seen.push(url);return {answers:{x:{noul:url===LOCAL?0:.99}}};},frozen);
  assert.deepEqual(await chain.score({},QUESTION),{x:0});
  assert.deepEqual(seen,[LOCAL]);
  assert.equal(chain.fallback_count,0);
  assert.equal(chain.last_provider,'laya');
  assert.equal(layaFailureCount(),0);
  // A malformed local answer is a failure the route does not retry remotely.
  const malformed=new ProviderChain(config,BOTH,async()=>{throw new ProviderError('malformed');},frozen);
  await assert.rejects(malformed.score({},QUESTION),/malformed/);
  assert.equal(malformed.fallback_count,0);
});

test('a local-only route never spends breaker budget and never logs suppression',async()=>{
  resetLayaBreaker();
  const log:string[]=[];
  const chain=new ProviderChain(settings({jev_provider:'laya'}),BOTH,async()=>{throw new ProviderError('transport_error');},frozen,l=>log.push(l));
  assert.equal(await exhaust(LIMIT+2,chain),LIMIT+2);
  assert.equal(layaFailureCount(),0);
  assert.deepEqual(log,[]);
});

test('a local failure that is not a configured trigger does not spend breaker budget',async()=>{
  resetLayaBreaker();
  const chain=new ProviderChain(config,BOTH,async()=>{throw new ProviderError('malformed');},frozen);
  assert.equal(await exhaust(LIMIT+1,chain),LIMIT+1);
  assert.equal(layaFailureCount(),0);
  assert.equal(chain.fallback_count,0);
});

test('the DOGA mode aliases resolve to the canonical provider values',()=>{
  assert.equal(settings({jev_provider:'laya_local'}).jev_provider,'laya');
  assert.equal(settings({jev_provider:'laya_with_jev_fallback'}).jev_provider,'laya_then_hosted');
  assert.equal(settings({jev_provider:'Laya_Local' as never}).jev_provider,'laya');
  assert.equal(settings({jev_provider:'LAYA_WITH_JEV_FALLBACK' as never}).jev_provider,'laya_then_hosted');
  assert.deepEqual(new ProviderChain(settings({jev_provider:'laya_local'}),BOTH).order,new ProviderChain(settings({jev_provider:'laya'}),BOTH).order);
  assert.deepEqual(new ProviderChain(settings({jev_provider:'laya_with_jev_fallback'}),BOTH).order,new ProviderChain(settings({jev_provider:'laya_then_hosted'}),BOTH).order);
  assert.deepEqual(new ProviderChain(settings({jev_provider:'laya_with_jev_fallback'}),BOTH).order,['laya','typesafe','openrouter']);
  assert.equal(new ProviderChain(settings({jev_provider:'laya_with_jev_fallback'}),BOTH).diagnostics().mode,'laya_then_hosted');
  for(const mode of ['auto','typesafe','openrouter','laya','laya_then_hosted'] as const)assert.equal(settings({jev_provider:mode}).jev_provider,mode);
  for(const rejected of ['laya_hosted','laya_then_remote','jev_api','local',''])assert.throws(()=>settings({jev_provider:rejected as never}),/invalid jev_provider: expected/);
});

test('the order validator still rejects the local route under either alias',()=>{
  assert.throws(()=>settings({jev_provider:'laya_with_jev_fallback',jev_fallback_order:['laya' as never]}),/provider order/);
  assert.throws(()=>settings({jev_provider:'laya_local',jev_fallback_order:['typesafe','laya' as never]}),/provider order/);
  assert.equal(settings({jev_provider:'laya_with_jev_fallback'}).jev_fallback_order.join(','),'typesafe,openrouter');
});

test('the fallback and suppression logs carry the failure category only',async()=>{
  resetLayaBreaker();
  const log:string[]=[];
  const state={user_request:'PRIVATE_STATE_MARKER',history:['PRIVATE_STATE_MARKER']};
  const chain=new ProviderChain(config,BOTH,async url=>{if(url===LOCAL)throw new ProviderError('transport_error');return {answers:{x:{noul:.4}}};},frozen,l=>log.push(l));
  await exhaust(LIMIT+1,chain,state);
  const joined=log.join('\n');
  assert.ok(joined.includes('from=laya to=typesafe reason=transport_error'));
  assert.ok(joined.includes('laya_fallback_suppressed count=4 limit=3 reason=transport_error'));
  assert.ok(!joined.includes('PRIVATE_STATE_MARKER'));
  assert.ok(!JSON.stringify(chain.diagnostics()).includes('PRIVATE_STATE_MARKER'));
});
