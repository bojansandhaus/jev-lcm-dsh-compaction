import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../src/settings.js';
import { ProviderChain, probeProviders } from '../src/providers.js';
import { ProviderError } from '../src/jev-client.js';
import { resetLayaBreaker } from '../src/laya-breaker.js';

const QUESTION={x:{type:'noul' as const,instructions:'keep?'}};
const LOCAL='http://127.0.0.1:8000/v1/systemone';
const TYPESAFE='https://api.typesafe.ai/v1/systemone';
const OPENROUTER='https://openrouter.ai/api/alpha/decisions';
const BOTH={TYPESAFE_API_KEY:'SECRET_A',OPENROUTER_API_KEY:'SECRET_B'};

/** A transport that fails the local hop and answers every hosted hop. */
function split(answers:{noul:number}={noul:.37},fail:()=>ProviderError=()=>new ProviderError('transport_error')){
  const seen:string[]=[];
  const transport=async(url:string)=>{
    seen.push(url);
    if(url===LOCAL)throw fail();
    return {answers:{x:answers}};
  };
  return {seen,transport};
}

test('the opt-in chain leads with the local hop and lists only keyed hosted providers',()=>{
  assert.deepEqual(new ProviderChain(settings({jev_provider:'laya_then_hosted'}),BOTH).order,['laya','typesafe','openrouter']);
  assert.deepEqual(new ProviderChain(settings({jev_provider:'laya_then_hosted'}),{TYPESAFE_API_KEY:'a'}).order,['laya','typesafe']);
  assert.deepEqual(new ProviderChain(settings({jev_provider:'laya_then_hosted'}),{OPENROUTER_API_KEY:'b'}).order,['laya','openrouter']);
  assert.deepEqual(new ProviderChain(settings({jev_provider:'laya_then_hosted',laya_base_url:'http://127.0.0.1:8123'}),{OPENROUTER_API_KEY:'b'}).order,['laya','openrouter']);
  assert.deepEqual(new ProviderChain(settings({jev_provider:'laya_then_hosted',jev_fallback_order:['openrouter','typesafe']}),BOTH).order,['laya','openrouter','typesafe']);
  assert.deepEqual(new ProviderChain(settings({jev_provider:'laya_then_hosted',jev_fallback_order:['openrouter']}),BOTH).order,['laya','openrouter']);
});

test('the mode names the missing environment variables when no hosted key exists',()=>{
  assert.throws(()=>new ProviderChain(settings({jev_provider:'laya_then_hosted'}),{}),/TYPESAFE_API_KEY and OPENROUTER_API_KEY/);
  assert.throws(()=>new ProviderChain(settings({jev_provider:'laya_then_hosted'}),{}),/laya_then_hosted/);
  assert.throws(()=>new ProviderChain(settings({jev_provider:'laya_then_hosted',jev_fallback_order:['openrouter']}),{TYPESAFE_API_KEY:'a'}),/OPENROUTER_API_KEY/);
  // A whitespace-only key is not a key.
  assert.throws(()=>new ProviderChain(settings({jev_provider:'laya_then_hosted'}),{TYPESAFE_API_KEY:'  ',OPENROUTER_API_KEY:''}),/TYPESAFE_API_KEY/);
});

test('a local success answers from the local hop and never touches a hosted URL',async()=>{
  const seen:string[]=[];
  const config=settings({jev_provider:'laya_then_hosted',laya_base_url:'http://127.0.0.1:8123'});
  const chain=new ProviderChain(config,BOTH,async url=>{seen.push(url);return {answers:{x:{noul:.42}}};});
  assert.deepEqual(await chain.score({history:[]},QUESTION),{x:.42});
  assert.deepEqual(seen,['http://127.0.0.1:8123/v1/systemone']);
  assert.equal(chain.last_provider,'laya');
  assert.equal(chain.fallback_count,0);
  assert.equal(chain.calls,1);
});

test('every configured local failure falls through to the hosted hop',async()=>{
  for(const reason of ['transport_error','timeout','401','403','429','5xx']){
    // The breaker counts consecutive local failures for the whole process, so
    // each trigger class is exercised on a fresh count. The bounded behaviour
    // itself is pinned in tests/laya-fallback-breaker.test.ts.
    resetLayaBreaker();
    const {seen,transport}=split({noul:.37},()=>new ProviderError(reason));
    const chain=new ProviderChain(settings({jev_provider:'laya_then_hosted'}),BOTH,transport);
    assert.deepEqual(await chain.score({},QUESTION),{x:.37},reason);
    assert.deepEqual(seen,[LOCAL,TYPESAFE],reason);
    assert.equal(chain.fallback_count,1,reason);
    assert.equal(chain.last_provider,'typesafe',reason);
    assert.equal(chain.calls,2,reason);
  }
  // A trigger outside the configured set stays a hard failure.
  for(const reason of ['malformed','http_error']){
    const {transport}=split({noul:.37},()=>new ProviderError(reason));
    const chain=new ProviderChain(settings({jev_provider:'laya_then_hosted'}),BOTH,transport);
    await assert.rejects(chain.score({},QUESTION),new RegExp(reason));
    assert.equal(chain.fallback_count,0,reason);
    assert.equal(chain.last_provider,'',reason);
  }
});

test('a local failure records the fallback, the answering provider and the local cooldown',async()=>{
  resetLayaBreaker();
  const log:string[]=[],now=[1];
  const {transport}=split();
  const config=settings({jev_provider:'laya_then_hosted'});
  const chain=new ProviderChain(config,BOTH,transport,()=>now[0],l=>log.push(l));
  assert.deepEqual(await chain.score({},QUESTION),{x:.37});
  assert.equal(chain.fallback_count,1);
  assert.equal(chain.last_provider,'typesafe');
  assert.deepEqual(chain.errors,{laya:'transport_error'});
  assert.equal(log.filter(l=>l.startsWith('jev_provider_fallback')).length,1);
  assert.ok(log[0].includes('from=laya to=typesafe reason=transport_error'));
  const diagnostics=chain.diagnostics();
  assert.equal(diagnostics.mode,'laya_then_hosted');
  assert.deepEqual(diagnostics.order,['laya','typesafe','openrouter']);
  assert.equal(diagnostics.last_provider,'typesafe');
  assert.deepEqual(diagnostics.keys_present,['TYPESAFE_API_KEY','OPENROUTER_API_KEY']);
  assert.ok(diagnostics.cooldown_seconds.laya>0);
  assert.ok(!JSON.stringify(diagnostics).includes('SECRET_'));
  // The local hop is now on cooldown, so the next call answers from hosted.
  assert.deepEqual(await chain.score({},QUESTION),{x:.37});
  assert.equal(chain.last_provider,'typesafe');
});

test('the chain walks past every failing hosted provider and retries the last one',async()=>{
  resetLayaBreaker();
  const seen:string[]=[];
  const chain=new ProviderChain(settings({jev_provider:'laya_then_hosted'}),BOTH,async url=>{seen.push(url);if(url===OPENROUTER)return {answers:{x:{noul:.5}}};throw new ProviderError('5xx');});
  assert.deepEqual(await chain.score({},QUESTION),{x:.5});
  assert.deepEqual(seen,[LOCAL,TYPESAFE,OPENROUTER]);
  assert.equal(chain.fallback_count,2);
  assert.equal(chain.last_provider,'openrouter');
  assert.equal(chain.calls,3);
});

test('standalone laya stays one provider and auto still never selects it',async()=>{
  const seen:string[]=[];
  const local=new ProviderChain(settings({jev_provider:'laya'}),BOTH,async url=>{seen.push(url);return {answers:{x:{noul:.5}}};});
  assert.deepEqual(local.order,['laya']);
  await local.score({},QUESTION);
  assert.deepEqual(seen,[LOCAL]);
  assert.equal(local.fallback_count,0);
  assert.equal(local.diagnostics().mode,'laya');

  const hosted:string[]=[];
  const auto=new ProviderChain(settings(),BOTH,async url=>{hosted.push(url);return {answers:{x:{noul:.5}}};});
  assert.deepEqual(auto.order,['typesafe','openrouter']);
  assert.ok(!auto.order.includes('laya'));
  await auto.score({},QUESTION);
  assert.deepEqual(hosted,[TYPESAFE]);
  // A keyless auto profile still builds an empty hosted chain, not a local one.
  assert.deepEqual(new ProviderChain(settings(),{}).order,[]);
});

test('the fallback order validator still rejects the local route',()=>{
  assert.throws(()=>settings({jev_fallback_order:['laya']}),/provider order/);
  assert.throws(()=>settings({jev_fallback_order:['typesafe','laya']}),/provider order/);
  assert.throws(()=>settings({jev_provider:'laya_hosted' as never}),/invalid jev_provider/);
  assert.equal(settings({jev_provider:'laya_then_hosted'}).jev_fallback_order.join(','),'typesafe,openrouter');
});

test('disabling fallback collapses the opt-in mode to the local hop alone',async()=>{
  const seen:string[]=[];
  const chain=new ProviderChain(settings({jev_provider:'laya_then_hosted',jev_fallback_enabled:false}),BOTH,async url=>{seen.push(url);throw new ProviderError('transport_error');});
  assert.deepEqual(chain.order,['laya']);
  await assert.rejects(chain.score({},QUESTION),/transport_error/);
  // The local hop is the last provider left, so it takes its configured retry
  // and no hosted URL is ever reached.
  assert.ok(seen.length>=1&&seen.every(url=>url===LOCAL));
  assert.equal(chain.fallback_count,0);
});

test('the dry run probes the real opt-in order and never prints a key value',async()=>{
  const seen:string[]=[];
  const probes=await probeProviders(settings({jev_provider:'laya_then_hosted'}),{TYPESAFE_API_KEY:'SECRET_A'},async url=>{seen.push(url);return {answers:{'calibrate:anchor_keep':{noul:.3}}};});
  assert.deepEqual(probes.map(p=>p.provider),['laya','typesafe']);
  assert.deepEqual(seen,[LOCAL,TYPESAFE]);
  assert.ok(probes.every(p=>p.status==='ok'));
  const missing=await probeProviders(settings({jev_provider:'laya_then_hosted'}),{},async()=>({answers:{'calibrate:anchor_keep':{noul:.3}}}));
  assert.deepEqual(missing.map(p=>p.provider),['laya','typesafe','openrouter']);
  assert.ok((missing[1].reason??'').includes('TYPESAFE_API_KEY'));
  assert.ok(!JSON.stringify(probes).includes('SECRET_'));
});
