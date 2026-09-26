import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../src/settings.js';
import { ProviderChain, probeProviders } from '../src/providers.js';
import { post, ProviderError } from '../src/jev-client.js';

const QUESTION={x:{type:'noul' as const,instructions:'keep?'}};
const LOCAL='http://127.0.0.1:8000/v1/systemone';

test('a local route replaces the hosted pair instead of joining it',async()=>{
  const seen:string[]=[];
  const chain=new ProviderChain(settings({jev_provider:'laya'}),{TYPESAFE_API_KEY:'SECRET_A',OPENROUTER_API_KEY:'SECRET_B'},async url=>{seen.push(url);return {answers:{x:{noul:.42}}};});
  assert.deepEqual(chain.order,['laya']);
  assert.deepEqual(await chain.score({history:[]},QUESTION),{x:.42});
  assert.deepEqual(seen,[LOCAL]);
  assert.equal(chain.fallback_count,0);
  assert.equal(chain.last_provider,'laya');
});

test('the local route needs no credential and sends the decisions payload',async()=>{
  let url='',key='SENTINEL',payload:unknown=null;
  const chain=new ProviderChain(settings({jev_provider:'laya'}),{},async(u,k,p)=>{url=u;key=k;payload=p;return {answers:{x:{noul:.5}}};});
  await chain.score({history:[]},QUESTION);
  assert.equal(url,LOCAL);
  assert.equal(key,'');
  assert.deepEqual(payload,{model:'convaiinnovations/laya',state:{history:[]},questions:QUESTION});
  assert.deepEqual(chain.diagnostics().keys_present,[]);
});

test('the hosted chain never selects the local route on its own',async()=>{
  const hosted=new ProviderChain(settings(),{TYPESAFE_API_KEY:'A',OPENROUTER_API_KEY:'B'},async()=>({answers:{x:{noul:.5}}}));
  assert.deepEqual(hosted.order,['typesafe','openrouter']);
  const keyless=new ProviderChain(settings(),{},async()=>{throw new Error('no provider should be reachable');});
  assert.deepEqual(keyless.order,[]);
  await assert.rejects(keyless.score({},QUESTION),(error:ProviderError)=>{assert.equal(error.reason,'disabled');return true;});
});

test('the local route is not a fallback member',()=>{
  assert.throws(()=>settings({jev_fallback_order:['typesafe','laya']}),/provider order/);
  assert.throws(()=>settings({jev_fallback_order:['laya']}),/provider order/);
  assert.throws(()=>settings({jev_provider:'local' as never}),/invalid jev_provider/);
  assert.throws(()=>settings({laya_base_url:'http://192.168.1.10:8000'}),/nonlocal provider requires HTTPS/);
  assert.equal(settings({laya_base_url:'https://laya.example'}).laya_base_url,'https://laya.example');
});

test('a configured server token is forwarded and never printed',async()=>{
  let key='';
  const chain=new ProviderChain(settings({jev_provider:'laya'}),{LAYA_API_KEY:'SECRET_LOCAL'},async(_u,k)=>{key=k;return {answers:{x:{noul:.5}}};});
  await chain.score({},QUESTION);
  assert.equal(key,'SECRET_LOCAL');
  assert.deepEqual(chain.diagnostics().keys_present,['LAYA_API_KEY']);
  assert.ok(!JSON.stringify(chain.diagnostics()).includes('SECRET_LOCAL'));
});

test('the wire client omits the authorization header when there is no key',async()=>{
  const seen:{url:string;headers:Record<string,string>}[]=[];
  const original=globalThis.fetch;
  globalThis.fetch=(async(url:string,init:RequestInit)=>{seen.push({url,headers:init.headers as Record<string,string>});return new Response(JSON.stringify({answers:{}}),{status:200});}) as unknown as typeof fetch;
  try{
    await post(LOCAL,'',{questions:{}},5);
    await post(LOCAL,'local',{questions:{}},5);
  }finally{globalThis.fetch=original;}
  assert.deepEqual(seen[0],{url:LOCAL,headers:{'Content-Type':'application/json'}});
  assert.deepEqual(seen[1].headers,{'Content-Type':'application/json',Authorization:'Bearer local'});
});

test('the dry run probe follows the configured route',async()=>{
  const hosted=await probeProviders(settings(),{TYPESAFE_API_KEY:'A',OPENROUTER_API_KEY:'B'},async()=>({answers:{'calibrate:anchor_keep':{noul:.3}}}));
  assert.deepEqual(hosted.map(p=>p.provider),['typesafe','openrouter']);
  const local=await probeProviders(settings({jev_provider:'laya'}),{},async url=>{assert.equal(url,LOCAL);return {answers:{'calibrate:anchor_keep':{noul:.3}}};});
  assert.deepEqual(local.map(p=>p.provider),['laya']);
  assert.equal(local[0].status,'ok');
});
