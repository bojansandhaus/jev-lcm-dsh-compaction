import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../src/settings.js';
import { ProviderChain } from '../src/providers.js';
import { ProviderError } from '../src/jev-client.js';
import { probeProviders } from '../src/providers.js';

test('provider resolution, fallback, cooldown and no secret logging',async()=>{
 const log:string[]=[],now=[1];const s=settings();const c=new ProviderChain(s,{TYPESAFE_API_KEY:'SECRET_A',OPENROUTER_API_KEY:'SECRET_B'},async(url)=>{if(url.includes('typesafe'))throw new ProviderError('429');return {answers:{x:{noul:.19}}};},()=>now[0],s=>log.push(s));
 assert.deepEqual(await c.score({},{x:{type:'noul',instructions:'keep?'}}),{x:.19});assert.equal(c.fallback_count,1);assert.equal(c.last_provider,'openrouter');assert.ok(!JSON.stringify([log,c.diagnostics()]).includes('SECRET_'));
 assert.throws(()=>new ProviderChain(settings({jev_provider:'typesafe'}),{OPENROUTER_API_KEY:'x'}),/TYPESAFE_API_KEY/);
 const only=new ProviderChain(s,{OPENROUTER_API_KEY:'x'},async()=>({answers:{x:{noul:.19}}}));assert.deepEqual(await only.score({},{x:{type:'noul',instructions:'keep?'}}),{x:.19});
 await assert.rejects(new ProviderChain(s,{}).score({},{}),/disabled/);
 const down=new ProviderChain(s,{TYPESAFE_API_KEY:'x',OPENROUTER_API_KEY:'y'},async()=>{throw new ProviderError('429');},()=>now[0]);await assert.rejects(down.score({},{}),/429/);await assert.rejects(down.score({},{}),/cooldown/);now[0]=100;down.transport=async()=>({answers:{}});assert.deepEqual(await down.score({},{}),{});assert.equal(down.last_provider,'typesafe');
});

const CHAT_SURFACE={openrouter_base_url:'https://openrouter.ai/api/v1',openrouter_endpoint_path:'/chat/completions'};

test('OpenRouter chat adapter matches the native decisions surface',async()=>{
 const answers={x:{noul:.42},y:{noul:.07}};
 const questions={x:{type:'noul' as const,instructions:'keep?'},y:{type:'noul' as const,instructions:'keep?'}};
 const seen:{chat?:[string,unknown];native?:[string,unknown]}={};
 const chat=new ProviderChain(settings({jev_provider:'openrouter',...CHAT_SURFACE}),{OPENROUTER_API_KEY:'private'},async(url,_k)=>{
  seen.chat=[url,undefined];return {choices:[{message:{content:JSON.stringify({answers})}}]};});
 const native=new ProviderChain(settings({jev_provider:'openrouter'}),{OPENROUTER_API_KEY:'private'},async(url)=>{
  seen.native=[url,undefined];return {answers};});
 assert.deepEqual(await chat.score({},questions),{x:.42,y:.07});
 assert.deepEqual(await native.score({},questions),{x:.42,y:.07});
 assert.equal(seen.chat![0],'https://openrouter.ai/api/v1/chat/completions');
 assert.equal(seen.native![0],'https://openrouter.ai/api/alpha/decisions');
 assert.equal(settings().openrouter_base_url,'https://openrouter.ai/api');
 assert.equal(settings().openrouter_endpoint_path,'/alpha/decisions');
});

test('OpenRouter chat adapter sends a chat body carrying the same questions',async()=>{
 const questions={x:{type:'noul' as const,instructions:'keep?'}};
 let body:{model:string;messages:{role:string;content:string}[]}|undefined;
 const chain=new ProviderChain(settings({jev_provider:'openrouter',...CHAT_SURFACE}),{OPENROUTER_API_KEY:'private'},async(_u,_k,payload)=>{
  body=payload as {model:string;messages:{role:string;content:string}[]};
  return {choices:[{message:{content:JSON.stringify({answers:{x:{noul:.31}}})}}]};});
 assert.deepEqual(await chain.score({},questions),{x:.31});
 assert.equal(body!.model,settings().openrouter_model);
 assert.equal(body!.messages[0].role,'system');
 assert.deepEqual(JSON.parse(body!.messages[1].content).questions,questions);
});

test('OpenRouter chat adapter rejects malformed completions',async()=>{
 const completions=[null,{},{choices:[]},{choices:['text']},{choices:[{message:{content:''}}]},{choices:[{message:{content:'not json'}}]},{choices:[{message:{content:'{"answers": {}}'}}]},{choices:[{message:{content:17}}]}];
 for(const completion of completions){
  const chain=new ProviderChain(settings({jev_provider:'openrouter',...CHAT_SURFACE}),{OPENROUTER_API_KEY:'private'},async()=>completion);
  await assert.rejects(chain.score({},{x:{type:'noul',instructions:'keep?'}}),/malformed/);
 }
});

test('OpenRouter chat path passes a decisions shaped gateway response through',async()=>{
 const chain=new ProviderChain(settings({jev_provider:'openrouter',...CHAT_SURFACE}),{OPENROUTER_API_KEY:'private'},async()=>({answers:{x:{noul:.55}}}));
 assert.deepEqual(await chain.score({},{x:{type:'noul',instructions:'keep?'}}),{x:.55});
});

test('dry run probe reports latency and status per provider',async()=>{
 const probes=await probeProviders(settings(),{TYPESAFE_API_KEY:'a',OPENROUTER_API_KEY:'b'},async(url)=>{
  if(url.includes('typesafe'))throw new ProviderError('429');
  return {answers:{'calibrate:anchor_keep':{noul:.5}}};});
 assert.deepEqual(probes.map(p=>[p.provider,p.status]),[['typesafe','error'],['openrouter','ok']]);
 assert.equal(probes[0].reason,'429');
 for(const p of probes)assert.ok(Number.isFinite(p.ms)&&p.ms>=0);
 const missing=await probeProviders(settings(),{OPENROUTER_API_KEY:'b'},async()=>({answers:{'calibrate:anchor_keep':{noul:.5}}}));
 assert.equal(missing[0].status,'error');
 assert.ok((missing[0].reason??'').includes('TYPESAFE_API_KEY'));
 assert.equal(missing[1].status,'ok');
});
