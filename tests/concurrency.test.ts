import test from 'node:test';
import assert from 'node:assert/strict';
import { Prepass } from '../src/prepass.js';
import { settings } from '../src/settings.js';
import { ProviderChain } from '../src/providers.js';
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic';
import { JevLCMCompactionEngine } from '../src/compressor.js';

test('overlapping forced flushes score each candidate once',async()=>{
  const s=settings();let calls=0;
  const chain=new ProviderChain(s,{OPENROUTER_API_KEY:'synthetic'},async(_url,_key,payload)=>{
    calls+=1;await new Promise(resolve=>setTimeout(resolve,20));
    const questions=(payload as {questions:Record<string,unknown>}).questions;
    return {answers:Object.fromEntries(Object.keys(questions).map(k=>[k,{noul:.9}]))};
  });
  const p=new Prepass(s,chain);
  p.collect([{role:'user',content:'first'},{role:'assistant',content:'Keep `abc123def456`.'}],2);
  await Promise.all(Array.from({length:8},()=>p.flush(true)));
  assert.equal(calls,1);
  assert.ok([...p.candidates.values()].every(c=>!c.jev_unscored));
});

test('summary persistence failure prevents returning a replacement',async()=>{
  const proto=BasicCompactionEngine.prototype as any;
  const original=proto.summarize;
  proto.summarize=async()=>({summary:[{type:'text',text:'generated'}]});
  const p=new Prepass(settings(),new ProviderChain(settings(),{}));
  const engine={
    ingest:()=>p,
    ctx:{tokenMeter:{measure:()=>({totalTokens:100})}},
    store:{ingest:()=>1,node:()=>{throw new Error('disk full');},saveHints:()=>assert.fail('must not proceed')}
  };
  try{
    await assert.rejects((JevLCMCompactionEngine.prototype as any).summarize.call(engine,{messages:[]},{session:{id:'s'}}),/disk full/);
  }finally{proto.summarize=original;}
});
