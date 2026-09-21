import test from 'node:test';import assert from 'node:assert/strict';import { mkdtemp,writeFile,rm } from 'node:fs/promises';import { tmpdir } from 'node:os';import { join } from 'node:path';import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';import Loader from '@deepseek-ai/cordis-plugin-loader';import Include from '@deepseek-ai/cordis-plugin-include';import LlmRuntime from '@deepseek-ai/dsh-llm';import SessionStore from '@deepseek-ai/dsh-session';import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';import TokenMeter from '@deepseek-ai/dsh-token-meter';import Tools from '@deepseek-ai/dsh-tools';import * as plugin from '../src/index.js';import SystemPrompt from '@deepseek-ai/dsh-system-prompt';

test('real Cordis Loader registers one compaction engine and recall tools',async()=>{
 const dir=await mkdtemp(join(process.env.TMPDIR??tmpdir(),'jev-loader-'));const ctx=new Context();
 try{
  const path=join(dir,'cordis.yml');const modules=new Map<string,unknown>([['llm',LlmRuntime],['sessions',SessionStore],['projections',SessionProjectionRegistry],['meter',TokenMeter],['prompt',SystemPrompt],['tools',Tools],['jev',plugin]]);
  await writeFile(path,"- name: llm\n- name: sessions\n- name: projections\n- name: meter\n- name: prompt\n- name: tools\n- name: jev\n  config:\n    databasePath: ':memory:'\n    auto: false\n");
  ctx.baseUrl=pathToFileURL(dir).href+'/';await ctx.plugin(Loader);ctx.loader.builtins.include=Include;
  ctx.loader.internal={version:'v2',async import(specifier:string){if(!modules.has(specifier))throw new Error('unknown module');return modules.get(specifier);}} as NonNullable<typeof ctx.loader.internal>;
  await ctx.loader.create({name:'cordis:include',config:{path:pathToFileURL(path).href}});await ctx.loader.await();
  assert.ok(ctx.get('compaction') instanceof plugin.JevLCMCompactionEngine);assert.equal([...ctx.loader.entries()].filter(e=>!e.fiber&&!e.disabled).length,0);
 }finally{await ctx.fiber.dispose();await rm(dir,{recursive:true,force:true});}
});
