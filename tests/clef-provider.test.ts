import test from 'node:test';
import assert from 'node:assert/strict';
import { settings, MODE_ALIASES, resolveMode } from '../src/settings.js';
import { ProviderChain, ENV, clefUrl } from '../src/providers.js';
import { ProviderError, parseAnswers, Transport } from '../src/jev-client.js';
import { CLEF_MAX_QUESTIONS, clef_answers, sanitize_question_ids } from '../src/clef.js';

const ACCOUNT='0123456789abcdef0123456789abcdef';
const ENV_OK={CLOUDFLARE_API_TOKEN:'SECRET_CLEF_TOKEN',CLOUDFLARE_ACCOUNT_ID:ACCOUNT};
const QUESTION={x:{type:'noul' as const,instructions:'keep?'}};
/** A transport that must never be reached by the credential checks. */
const noNetwork=async()=>{throw new Error('no network call may be made');};

function clefChain(overrides:Record<string,unknown>={},env:Record<string,string|undefined>=ENV_OK,transport?:Transport){
  return new ProviderChain(settings({jev_provider:'api_only',api_provider:'clef',...overrides} as never),env,transport??noNetwork);
}

test('Clef alone sends no request to Jev or Laya',async()=>{
  const urls:string[]=[];const keys:string[]=[];
  const chain=new ProviderChain(settings({jev_provider:'api_only',api_provider:'clef'}),ENV_OK,async(url,key)=>{urls.push(url);keys.push(key);return {answers:{x:{noul:.42}}};});
  assert.deepEqual(chain.order,['clef']);
  assert.deepEqual(await chain.score({history:[]},QUESTION),{x:.42});
  assert.deepEqual(urls,[clefUrl(ACCOUNT,'clef')]);
  assert.equal(chain.fallback_count,0);
  assert.equal(chain.last_provider,'clef');
  assert.ok(!urls.some(u=>/typesafe|openrouter|laya|127\.0\.0\.1/.test(u)),'Clef must not touch a Jev or Laya URL: '+urls.join(','));
  assert.deepEqual(keys,['SECRET_CLEF_TOKEN']);
});

test('both Cloudflare response envelopes parse',async()=>{
  const bare=await new ProviderChain(settings({jev_provider:'api_only',api_provider:'clef'}),ENV_OK,async()=>({model:'clef',answers:{x:{noul:.31}},usage:{}})).score({},QUESTION);
  const wrapped=await new ProviderChain(settings({jev_provider:'api_only',api_provider:'clef'}),ENV_OK,async()=>({success:true,result:{model:'clef',answers:{x:{noul:.31}},usage:{}},errors:[],messages:[]})).score({},QUESTION);
  assert.deepEqual(bare,{x:.31});
  assert.deepEqual(wrapped,{x:.31});
  // Top level answers win over a stale envelope.
  const both=await new ProviderChain(settings({jev_provider:'api_only',api_provider:'clef'}),ENV_OK,async()=>({answers:{x:{noul:.9}},result:{answers:{x:{noul:.1}}}})).score({},QUESTION);
  assert.deepEqual(both,{x:.9});
  for(const bad of [null,{},{result:{}},{result:{answers:[]}},{success:true,result:'text'}])
    assert.throws(()=>clef_answers(bad),/malformed/);
});

test('success false raises with Cloudflare own error code',async()=>{
  const chain=new ProviderChain(settings({jev_provider:'api_only',api_provider:'clef'}),ENV_OK,async()=>({success:false,errors:[{code:7003,message:'Could not route to model'},{}],messages:[]}));
  // The code is carried on the error detail, never the message, so a diagnostic
  // can print the reason and the code without printing provider prose.
  await assert.rejects(chain.score({},QUESTION),(error:ProviderError)=>{
    assert.equal(error.reason,'malformed');
    assert.match(error.message_with_detail,/7003/);
    assert.match(error.detail,/^cloudflare request failed, code 7003$/);
    for(const prose of ['Could not route to model','could not route'])assert.ok(!error.message_with_detail.includes(prose),prose+' must not be surfaced');
    return true;});
  // A false envelope with no usable code still fails, naming the unknown code.
  await assert.rejects(new ProviderChain(settings({jev_provider:'api_only',api_provider:'clef'}),ENV_OK,async()=>({success:false,errors:[{message:'x'}]})).score({},QUESTION),(error:ProviderError)=>{assert.match(error.message_with_detail,/unknown error/);return true;});
  // Every code in the envelope is surfaced, so several are not collapsed away.
  await assert.rejects(new ProviderChain(settings({jev_provider:'api_only',api_provider:'clef'}),ENV_OK,async()=>({success:false,errors:[{code:7003},{code:1002}]})).score({},QUESTION),(error:ProviderError)=>{assert.match(error.detail,/7003, 1002/);return true;});
});

test('a missing token or account id fails before any network call naming the variable',async()=>{
  for(const [env,named] of [
    [{CLOUDFLARE_ACCOUNT_ID:ACCOUNT},'CLOUDFLARE_API_TOKEN'],
    [{CLOUDFLARE_API_TOKEN:'SECRET_CLEF_TOKEN'},'CLOUDFLARE_ACCOUNT_ID'],
    [{CLOUDFLARE_API_TOKEN:'   ',CLOUDFLARE_ACCOUNT_ID:ACCOUNT},'CLOUDFLARE_API_TOKEN'],
    [{CLOUDFLARE_API_TOKEN:'SECRET_CLEF_TOKEN',CLOUDFLARE_ACCOUNT_ID:''},'CLOUDFLARE_ACCOUNT_ID'],
    [{CLOUDFLARE_API_TOKEN:'\t',CLOUDFLARE_ACCOUNT_ID:'  '},'CLOUDFLARE_API_TOKEN'],
  ] as [Record<string,string|undefined>,string][]){
    // The pinned route refuses to construct, so it can never reach a socket.
    assert.throws(()=>new ProviderChain(settings({jev_provider:'clef_api'}),env,noNetwork),new RegExp(named));
    // And an in-chain Clef is not selected at all on an incomplete credential:
    // `auto` filters to providers that can authenticate.
    const chain=new ProviderChain(settings({jev_fallback_order:['clef','typesafe']}),{...env,TYPESAFE_API_KEY:'ts'},async()=>({answers:{x:{noul:.5}}}));
    assert.deepEqual(chain.order,['typesafe']);
    assert.deepEqual(await chain.score({},QUESTION),{x:.5});
  }
  // A complete credential is the only thing that selects Clef inside a chain.
  const ready=new ProviderChain(settings({jev_fallback_order:['clef','typesafe']}),{...ENV_OK,TYPESAFE_API_KEY:'ts'},async()=>({answers:{x:{noul:.5}}}));
  assert.deepEqual(ready.order,['clef','typesafe']);
  // The account id is validated, not merely present.
  assert.throws(()=>new ProviderChain(settings({jev_provider:'clef_api'}),{CLOUDFLARE_API_TOKEN:'t',CLOUDFLARE_ACCOUNT_ID:'acct/../other'},noNetwork),/invalid CLOUDFLARE_ACCOUNT_ID/);
  assert.deepEqual(new ProviderChain(settings({jev_provider:'api_only',api_provider:'clef'}),ENV_OK,noNetwork).diagnostics().accounts_present,['CLOUDFLARE_ACCOUNT_ID']);
});

test('clef-flash routes to the flash endpoint and model string',async()=>{
  const seen:{url:string;body:Record<string,unknown>}[]=[];
  const transport=async(url:string,_k:string,payload:unknown)=>{seen.push({url,body:payload as Record<string,unknown>});return {answers:{x:{noul:.5}}};};
  await new ProviderChain(settings({jev_provider:'clef_api',clef_model:'clef-flash'}),ENV_OK,transport).score({},QUESTION);
  assert.equal(seen[0].url,'https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+'/ai/run/@cf/cloudflare/clef-flash');
  assert.equal(seen[0].body.model,'clef-flash');
  assert.deepEqual(Object.keys(seen[0].body).sort(),['model','questions','state']);
  assert.equal(settings().clef_model,'clef');
  assert.equal(MODE_ALIASES.clef_api,'api_only');
  assert.throws(()=>settings({clef_model:'clef-large' as never}),/clef_model must be one of: clef, clef-flash/);
});

test('clef is a fallback member and clef_api is its no-fallback alias',()=>{
  // `clef_api` now means hosted-alone, and `clef` means hosted-with-the-local
  // model behind it. Both still pin Clef as the hosted provider, because a mode
  // no longer names one.
  assert.equal(resolveMode('clef_api'),'api_only');
  assert.equal(resolveMode('CLEF_API'),'api_only');
  assert.equal(resolveMode('clef'),'api_with_local_fallback');
  assert.equal(settings({jev_provider:'clef_api'}).api_provider,'clef','clef_api pins Clef');
  assert.equal(settings({jev_provider:'clef'}).api_provider,'clef','clef pins Clef');
  // An explicit api_provider is not overridden by the mode name.
  assert.equal(settings({jev_provider:'clef',api_provider:'typesafe'}).api_provider,'typesafe');
  const order=settings({jev_fallback_order:['clef','typesafe']});
  assert.deepEqual(order.jev_fallback_order,['clef','typesafe']);
  // Pinned hosted with no credential refuses to construct rather than reporting
  // an empty route. `auto` is the shape that collapses to no providers, because
  // it only draws from providers it can authenticate.
  assert.throws(()=>new ProviderChain(settings({jev_provider:'clef_api'}),{},noNetwork),/CLOUDFLARE_ACCOUNT_ID|CLOUDFLARE_API_TOKEN|TYPESAFE_API_KEY|OPENROUTER_API_KEY/);
  assert.deepEqual(new ProviderChain(settings(),{},noNetwork).order,[]);
  // `auto` follows the configured order, filtered to providers it can
  // authenticate. Clef is available there but never selected on its own, so
  // the default order yields no Clef and only names it when it is asked for.
  const chain=new ProviderChain(settings({jev_provider:'api_only'}),{...ENV_OK,TYPESAFE_API_KEY:'ts'},async url=>({answers:{x:{noul:.5}}}));
  assert.deepEqual(chain.order,['typesafe'],'the default order does not include Clef');
  const clefFirst=new ProviderChain(settings({jev_provider:'api_only',jev_fallback_order:['clef','typesafe']}),{...ENV_OK,TYPESAFE_API_KEY:'ts'},async url=>({answers:{x:{noul:.5}}}));
  assert.deepEqual(clefFirst.order,['clef','typesafe']);
  // `local_with_api_fallback` draws only from providers it can authenticate, and
  // Clef needs both Cloudflare values, so the account id has to be present too.
  const layaThen=new ProviderChain(settings({jev_provider:'local_with_api_fallback',jev_fallback_order:['clef','typesafe']}),{...ENV_OK,LAYA_API_KEY:'local'},async()=>({answers:{x:{noul:.5}}}));
  assert.deepEqual(layaThen.order,['laya','clef']);
  assert.deepEqual(new ProviderChain(settings({jev_provider:'local_with_api_fallback',jev_fallback_order:['clef','typesafe']}),{LAYA_API_KEY:'local',TYPESAFE_API_KEY:'ts'},async()=>({answers:{x:{noul:.5}}})).order,['laya','typesafe'],'an uncredentialed Clef is dropped from the chain');
  assert.throws(()=>new ProviderChain(settings({jev_provider:'local_with_api_fallback'}),{LAYA_API_KEY:'local'},async()=>({answers:{x:{noul:.5}}})),/OPENROUTER_API_KEY/,'a chain that promises a fallback but has no hosted leg is a load error');
  assert.throws(()=>settings({jev_provider:'clef_then_hosted' as never}),/invalid jev_provider: expected/);
  assert.throws(()=>settings({jev_fallback_order:['clef','laya'] as never}),/provider order/);
});

test('Clef falls back on a configured trigger and cools down',async()=>{
  const urls:string[]=[];let now=1;
  // Hosted first with the local model behind it, which is what the old `clef`
  // mode expressed: Clef leads, and something usable follows it.
  const chain=new ProviderChain(settings({jev_provider:'api_with_local_fallback',api_provider:'clef',clef_model:'clef',jev_fallback_order:['typesafe','clef']}),{...ENV_OK,TYPESAFE_API_KEY:'ts'},async url=>{urls.push(url);if(url.includes('cloudflare'))throw new ProviderError('429');return {answers:{x:{noul:.6}}};},()=>now);
  assert.deepEqual(chain.order,['clef','typesafe','laya']);
  assert.deepEqual(await chain.score({},QUESTION),{x:.6});
  assert.equal(chain.fallback_count,1);
  assert.equal(chain.last_provider,'typesafe');
  assert.equal(chain.errors.clef,'429');
  assert.equal(chain.cooldowns.clef,now+settings().jev_fallback_cooldown_s);
  // The cooldown applies to the provider that failed, not to the whole chain:
  // the next call skips the cooling Clef hop and takes the hosted fallback.
  urls.length=0;
  assert.deepEqual(await chain.score({},QUESTION),{x:.6});
  assert.deepEqual(urls,['https://api.typesafe.ai/v1/systemone'],'the cooling Clef hop must be skipped, not retried');
  assert.equal(chain.cooldowns.clef,now+settings().jev_fallback_cooldown_s);
  // Once the cooldown has expired the chain leads with Clef again.
  now+=61;urls.length=0;
  assert.deepEqual(await chain.score({},QUESTION),{x:.6});
  assert.deepEqual(urls,[clefUrl(ACCOUNT,'clef'),'https://api.typesafe.ai/v1/systemone']);
});

test('an unknown choice is rejected',async()=>{
  const choice={g:{type:'choice' as const,instructions:'goal?',criteria:{information:'facts',action:'a next step'}}};
  const ok=await new ProviderChain(settings({jev_provider:'api_only',api_provider:'clef'}),ENV_OK,async()=>({answers:{g:{choice:'action',probabilities:{information:.3,action:.7},confidence:.7}}})).score({},choice);
  assert.deepEqual(ok,{g:.7});
  for(const answer of [{choice:'understanding',probabilities:{}},{choice:'action'},{choice:7},{noul:.5},{}])
    await assert.rejects(new ProviderChain(settings({jev_provider:'api_only',api_provider:'clef'}),ENV_OK,async()=>({answers:{g:answer}})).score({},choice),/malformed/);
});

test('an out-of-range index scale score is rejected',async()=>{
  const score={s:{type:'score' as const,instructions:'how severe?',criteria:['low','medium','high']}};
  assert.deepEqual(await new ProviderChain(settings({jev_provider:'api_only',api_provider:'clef'}),ENV_OK,async()=>({answers:{s:{score:2,legend:['low','medium','high'],confidence:.8}}})).score({},score),{s:1});
  assert.deepEqual(await new ProviderChain(settings({jev_provider:'api_only',api_provider:'clef'}),ENV_OK,async()=>({answers:{s:{score:0}}})).score({},score),{s:0});
  for(const answer of [{score:3},{score:-1},{score:1.5},{score:'1'},{legend:['low']},{}])
    await assert.rejects(new ProviderChain(settings({jev_provider:'api_only',api_provider:'clef'}),ENV_OK,async()=>({answers:{s:answer}})).score({},score),/malformed/);
  // A single point scale has no position to normalise, and probabilities win when present.
  const single={s:{type:'score' as const,instructions:'any?',criteria:['only']}};
  assert.deepEqual(await new ProviderChain(settings({jev_provider:'api_only',api_provider:'clef'}),ENV_OK,async()=>({answers:{s:{score:0}}})).score({},single),{s:.5});
  assert.deepEqual(await new ProviderChain(settings({jev_provider:'api_only',api_provider:'clef'}),ENV_OK,async()=>({answers:{s:{score:0,probabilities:[.25]}}})).score({},single),{s:.25});
});

test('a disallowed question id is mapped and restored',async()=>{
  const sent:string[]=[];const bodies:Record<string,unknown>[]=[];
  const id='a1b2c3d4e5f60718:keep_call';
  const questions={[id]:{type:'noul' as const,instructions:'keep?'},'already_fine-1.2':{type:'noul' as const,instructions:'keep?'}};
  const scores=await new ProviderChain(settings({jev_provider:'api_only',api_provider:'clef'}),ENV_OK,async(_u,_k,payload)=>{
    bodies.push(payload as Record<string,unknown>);
    sent.push(...Object.keys((payload as {questions:Record<string,unknown>}).questions));
    const answers:Record<string,unknown>={};
    for(const key of sent)answers[key]={noul:.5};
    return {answers};
  }).score({history:[]},questions);
  assert.deepEqual(Object.keys(scores).sort(),[id,'already_fine-1.2'].sort());
  assert.deepEqual(scores,{[id]:.5,'already_fine-1.2':.5});
  assert.ok(!sent.includes(id),'the colon id must not reach Cloudflare: '+sent.join(','));
  assert.ok(sent.includes('already_fine-1.2'),'an already legal id is sent unchanged');
  for(const key of sent)assert.match(key,/^[A-Za-z0-9_.-]+$/);
  assert.ok(Object.keys(bodies[0]).includes('questions'));
  // Long ids are truncated to the documented maximum and stay distinct.
  const long=Object.fromEntries(Array.from({length:3},(_,i)=>['c'.repeat(140)+i,{type:'noul' as const,instructions:'keep?'}]));
  const mapped=sanitize_question_ids(long);
  const sentNames=Object.keys(mapped.sent);
  assert.equal(sentNames.length,3);
  for(const key of sentNames){assert.ok(key.length<=100,key.length+' chars');assert.match(key,/^[A-Za-z0-9_.-]+$/);}
  assert.equal(new Set(sentNames).size,3);
  assert.deepEqual(mapped.restore(new Set(sentNames)),new Set(Object.keys(long)));
  // A collision with an already legal id is broken, not merged.
  const collide=sanitize_question_ids({'a b':{type:'noul',instructions:'k'},a_b:{type:'noul',instructions:'k'}});
  const collideNames=Object.keys(collide.sent);
  assert.equal(new Set(collideNames).size,2);
  assert.deepEqual(collide.restore(new Set(collideNames)),new Set(['a b','a_b']));
});

test('credentials and the reviewed content never appear in log output',async()=>{
  const log:string[]=[];const state={history:[{role:'user',content:'PATIENT_SECRET_9931 my key is sk-live-SECRET_CLEF_TOKEN and account '+ACCOUNT}]};
  const chain=new ProviderChain(settings({jev_fallback_order:['clef','typesafe']}),{...ENV_OK,TYPESAFE_API_KEY:'SECRET_TS'},async url=>{if(url.includes('cloudflare'))throw new ProviderError('429');return {answers:{x:{noul:.4}}};},undefined,line=>log.push(line));
  await chain.score(state,QUESTION);
  const printed=[...log,JSON.stringify(chain.diagnostics())].join('\n');
  assert.ok(log.length>0,'a Clef failure must log its category');
  for(const secret of ['SECRET_CLEF_TOKEN','SECRET_TS','sk-live','PATIENT_SECRET_9931','my key is'])assert.ok(!printed.includes(secret),secret+' leaked into: '+printed);
  assert.ok(log.some(l=>/^clef_provider_failed model=clef reason=429$/.test(l)),'category only: '+log.join(' | '));
  assert.deepEqual(chain.diagnostics().keys_present,['TYPESAFE_API_KEY','CLOUDFLARE_API_TOKEN']);
  assert.deepEqual(chain.diagnostics().accounts_present,['CLOUDFLARE_ACCOUNT_ID']);
  assert.deepEqual(chain.diagnostics().last_errors,{clef:'429'});
  assert.equal(ENV.clef,'CLOUDFLARE_API_TOKEN');
  // A success logs nothing at all.
  const quiet:string[]=[];
  await new ProviderChain(settings({jev_provider:'api_only',api_provider:'clef'}),ENV_OK,async()=>({answers:{x:{noul:.4}}}),undefined,line=>quiet.push(line)).score(state,QUESTION);
  assert.deepEqual(quiet,[]);
});

test('a batch larger than the Clef question limit is chunked, not refused',async()=>{
  const counts:number[]=[];
  const questions=Object.fromEntries(Array.from({length:CLEF_MAX_QUESTIONS*2+1},(_,i)=>['c'+i,{type:'noul' as const,instructions:'keep?'}]));
  const scores=await new ProviderChain(settings({jev_provider:'api_only',api_provider:'clef'}),ENV_OK,async(_u,_k,payload)=>{
    const asked=(payload as {questions:Record<string,unknown>}).questions;
    counts.push(Object.keys(asked).length);
    return {answers:Object.fromEntries(Object.keys(asked).map(k=>[k,{noul:.5}]))};
  }).score({},questions);
  assert.deepEqual(counts,[CLEF_MAX_QUESTIONS,CLEF_MAX_QUESTIONS,1]);
  assert.equal(Object.keys(scores).length,Object.keys(questions).length);
  assert.equal(counts.length,3);
  // The plain repo path is untouched: every existing provider sends one request.
  const single:string[]=[];
  await new ProviderChain(settings({jev_provider:'local_only'}),{},async()=>{single.push('laya');return {answers:Object.fromEntries(Object.keys(questions).map(k=>[k,{noul:.5}]))};}).score({},questions);
  assert.deepEqual(single,['laya']);
});

test('the dry run probe reports Clef status without a credential value',async()=>{
  const {probeProviders}=await import('../src/providers.js');
  // The probe's own anchor id carries a colon, so the transport has to answer
  // under the sanitized id the request actually asked about. A real provider
  // only ever sees the sanitized form.
  const ok=await probeProviders(settings({jev_provider:'clef_api'}),ENV_OK,async(_u,_k,payload)=>{
    const sent=Object.keys((payload as {questions:Record<string,unknown>}).questions);
    return {answers:Object.fromEntries(sent.map(k=>[k,{noul:.3}]))};
  });
  assert.deepEqual(ok.map(p=>[p.provider,p.status]),[['clef','ok']]);
  const bad=await probeProviders(settings({jev_provider:'clef_api'}),{},noNetwork);
  assert.equal(bad[0].status,'error');
  assert.match(bad[0].reason!,/CLOUDFLARE/);
  // The reported reason names the variable and never carries a credential value.
  assert.ok(!/SECRET_CLEF_TOKEN/.test(JSON.stringify(bad)));
});

test('typed answer validation stays the single entry point for every provider',()=>{
  const questions={x:{type:'choice' as const,instructions:'k',criteria:{a:'a',b:'b'}}};
  assert.throws(()=>parseAnswers({answers:{x:{choice:'c'}}},['x'],questions),/malformed/);
  assert.deepEqual(parseAnswers({answers:{x:{noul:.5}}},['x'],{x:{type:'noul',instructions:'k'}}),{x:.5});
  assert.throws(()=>parseAnswers({answers:{x:{noul:2}}},['x']),/malformed/);
  assert.throws(()=>parseAnswers({answers:{x:{noul:true}}},['x']),/malformed/);
  assert.deepEqual(parseAnswers({answers:{}},[]),{});
});
