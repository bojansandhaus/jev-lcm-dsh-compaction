import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../src/settings.js';
import { ProviderChain } from '../src/providers.js';
import { Prepass } from '../src/prepass.js';
import { Message } from '../src/anchors.js';
import { LcmStore } from '../src/store.js';
import { ProviderError } from '../src/jev-client.js';

test('missing provider keys disable ranking while LCM condensation proceeds',async()=>{
 const s=settings({min_result_chars:0});const db=new LcmStore(':memory:');
 const raw=db.ingest('s','message:1',{role:'assistant',content:'keep `abc123def456`'});
 const p=new Prepass(s,new ProviderChain(s,{}));
 const messages:Message[]=[{role:'user',content:'first'},{role:'assistant',content:'keep `abc123def456`'},{role:'user',content:'fresh'}];
 messages.forEach((m,i)=>{m.store_id=db.ingest('s','m'+i,{...m});});p.collect(messages,2);
 await p.flush(true);
 assert.equal(p.metrics.values.jev_fallbacks,1);
 assert.ok(Number(p.metrics.values.jev_unscored_count)>0);
 assert.equal(p.hintBlock(),'');
 const node=db.node('s','default LCM condensation summary',[raw]);db.markNodeCommitted(node,1,2);
 const context=db.assemble('s',4000);
 assert.ok(context.some(e=>e.kind==='summary'));
 assert.ok(context.every(e=>e.kind!=='protected'));
 db.close();
});

test('fallback fires once per provider and expires with the cooldown',async()=>{
 const log:string[]=[],now=[1];
 const s=settings();
 const chain=new ProviderChain(s,{TYPESAFE_API_KEY:'a',OPENROUTER_API_KEY:'b'},async()=>{throw new ProviderError('429');},()=>now[0],l=>log.push(l));
 await assert.rejects(chain.score({},{}),/429/);
 assert.equal(chain.fallback_count,1);
 assert.equal(log.filter(l=>l.startsWith('jev_provider_fallback')).length,1);
 assert.ok(log[0].includes('from=typesafe to=openrouter reason=429'));
 await assert.rejects(chain.score({},{}),/cooldown/);
 assert.equal(chain.fallback_count,1);
 now[0]=s.jev_fallback_cooldown_s+2;
 chain.transport=async()=>({answers:{}});
 assert.deepEqual(await chain.score({},{}),{});
 assert.equal(chain.last_provider,'typesafe');
 const both=new ProviderChain(s,{TYPESAFE_API_KEY:'a',OPENROUTER_API_KEY:'b'},async()=>{throw new ProviderError('5xx');});
 await assert.rejects(both.score({},{}),/5xx/);
 assert.equal(both.fallback_count,1);
 assert.equal(both.calls,3);
});
