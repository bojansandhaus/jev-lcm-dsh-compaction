import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {Context} from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import Include from '@deepseek-ai/cordis-plugin-include';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import SessionStore from '@deepseek-ai/dsh-session';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import Tools from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import * as plugin from '../src/index.js';

// Use the exact YAML parser shipped with the host include loader.
const require=createRequire(import.meta.url);
const includeRequire=createRequire(require.resolve('@deepseek-ai/cordis-plugin-include'));
const yaml=includeRequire('js-yaml') as {load(text:string):Include.Config['patches']};

test('shipped bundle disables native engine and mounts Jev through the real loader',async()=>{
 const dir=await mkdtemp(join(process.env.TMPDIR??tmpdir(),'jev-loader-'));
 const ctx=new Context();
 try{
  const path=join(dir,'cordis.yml');
  const modules=new Map<string,unknown>([['llm',LlmRuntime],['sessions',SessionStore],['projections',SessionProjectionRegistry],['meter',TokenMeter],['prompt',SystemPrompt],['tools',Tools],['@bojansandhaus/jev-lcm-dsh-compaction',plugin],['@deepseek-ai/dsh-compaction-basic',()=>{throw new Error('native engine must be disabled');}]]);
  await writeFile(path,"- name: llm\n- name: sessions\n- name: projections\n- name: meter\n- name: prompt\n- name: tools\n- id: compaction-basic\n  name: '@deepseek-ai/dsh-compaction-basic'\n");
  const patches=yaml.load(await readFile(new URL('../cordis.patch.yml',import.meta.url),'utf8'));
  assert.ok(patches);
  patches.push({id:'jev-lcm-compaction',config:{databasePath:':memory:',auto:false}});
  ctx.baseUrl=pathToFileURL(dir).href+'/';
  await ctx.plugin(Loader);ctx.loader.builtins.include=Include;
  ctx.loader.internal={version:'v2',async import(specifier:string){if(!modules.has(specifier))throw new Error('unknown module '+specifier);return modules.get(specifier);}} as unknown as NonNullable<typeof ctx.loader.internal>;
  await ctx.loader.create({name:'cordis:include',config:{path:pathToFileURL(path).href,patches}});
  await ctx.loader.await();
  assert.ok(ctx.get('compaction') instanceof plugin.JevLCMCompactionEngine);
  assert.equal([...ctx.loader.entries()].filter(e=>!e.fiber&&!e.disabled).length,0);
 }finally{await ctx.fiber.dispose();await rm(dir,{recursive:true,force:true});}
});
