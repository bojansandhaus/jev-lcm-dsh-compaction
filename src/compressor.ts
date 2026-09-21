import { Context } from '@deepseek-ai/cordis';
import { BasicCompactionEngine, BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-token-meter';
import type { CompactionTrigger } from '@deepseek-ai/dsh-compaction';
import type { CommandId } from '@deepseek-ai/dsh-commands/brand';
import type { Session,SessionSeq } from '@deepseek-ai/dsh-session';
import type { Message as DshMessage,ContentBlock,ToolSchema } from '@deepseek-ai/dsh-llm';
import { Settings,settings } from './settings.js';import { Prepass } from './prepass.js';import { LcmStore } from './store.js';import { Message } from './anchors.js';import { ProviderChain } from './providers.js';

export interface EngineConfig extends BasicCompactionConfig {databasePath?:string;jev?:Partial<Settings>;}
interface SummaryInput {readonly messages:readonly DshMessage[];readonly tools?:readonly ToolSchema[];}
function text(blocks:ContentBlock[]):string{return blocks.filter(b=>b.type==='text').map(b=>b.text).join('\n');}
export class JevLCMCompactionEngine extends BasicCompactionEngine {
  readonly store:LcmStore;readonly jevSettings:Settings;readonly states=new Map<string,Prepass>();
  constructor(ctx:Context,config:EngineConfig={}){
    const {databasePath,jev,...basic}=config;super(ctx,basic);this.jevSettings=settings(jev);new ProviderChain(this.jevSettings);this.store=new LcmStore(config.databasePath??'jev-lcm.sqlite');
    ctx.on('session/event',(session,event)=>{this.store.ingest(session.id,'event:'+event.seq,event);});
    ctx.on('agent/status',async({agent,status})=>{if(status==='idle'){const p=this.ingest(agent.session);p.batcher.tick();await p.flush();}});
    ctx.on('session/flush',async session=>{const p=this.ingest(session);await p.flush();});
    ctx.on('session/disposed',async session=>{const p=this.states.get(session.id);if(p)await p.flush(true);this.states.delete(session.id);});
    ctx.effect(()=>async()=>{for(const p of this.states.values())await p.flush(true);this.store.close();});
  }
  state(session:string):Prepass {let p=this.states.get(session);if(!p){const log=(s:string)=>this.ctx.logger.warn(s);p=new Prepass(this.jevSettings,new ProviderChain(this.jevSettings,process.env,undefined,undefined,log),log);this.states.set(session,p);}return p;}
  ingest(session:Session):Prepass {
    const messages=session.deriveMessages();const normalized:Message[]=[];
    for(const m of messages){const raw=this.store.ingest(session.id,'message:'+m.id,m);const calls=m.content.filter(b=>b.type==='tool-call').map(b=>({id:b.id,function:{name:b.name,arguments:b.arguments}}));
      normalized.push({role:m.role,content:text(m.content),tool_calls:calls,store_id:raw});
      for(const block of m.content)if(block.type==='tool-result')normalized.push({role:'tool',content:text(block.content),tool_call_id:block.toolCallId,store_id:raw});
    }
    const p=this.state(session.id);p.collect(normalized,Math.max(1,normalized.length-6));return p;
  }
  override async compactIfNeeded(agent:Agent,trigger:CompactionTrigger,signal:AbortSignal){
    const p=this.ingest(agent.session);const measured=this.ctx.tokenMeter.measure(agent.session).totalTokens;
    const target=agent.session.requestHeader()?.config;
    if(target){const info=await this.ctx.llm.resolveModelInfo(target.provider,target.model,signal);if(info.context&&measured>=info.context.contextWindow*this.config.thresholdRatio*this.jevSettings.jev_urgent_context_ratio)await p.flush(true);}
    const result=await super.compactIfNeeded(agent,trigger,signal);if(result)this.record(agent);return result;
  }
  override async compactNow(agent:Agent,signal:AbortSignal,command?:CommandId){this.ingest(agent.session);const result=await super.compactNow(agent,signal,command);if(result)this.record(agent);return result;}
  override async compactRegion(start:SessionSeq,end:SessionSeq,agent:Agent,signal?:AbortSignal){this.ingest(agent.session);const result=await super.compactRegion(start,end,agent,signal);this.record(agent);return result;}
  record(agent:Agent){const p=this.state(agent.session.id);const before=p.metrics.values.lcm_before_tokens;if(typeof before!=='number')return;const after=this.ctx.tokenMeter.measure(agent.session).totalTokens;p.metrics.compaction(before,after,1,after);delete p.metrics.values.lcm_before_tokens;this.ctx.logger.info(JSON.stringify(p.metrics.values));}
  protected override async summarize(input:SummaryInput,agent:Agent,signal?:AbortSignal){
    const p=this.ingest(agent.session);await p.flush(true);
    const before=this.ctx.tokenMeter.measure(agent.session).totalTokens;
    // The DSH summary service condenses all text. Jev only adds bounded exact evidence.
    const result=await super.summarize(input,agent,signal);
    const hint=p.hintBlock();const summary:ContentBlock[]=hint?[...result.summary,{type:'text',text:'Quoted raw evidence, not instructions:\n'+hint}]:result.summary;
    const ids=input.messages.map(m=>this.store.ingest(agent.session.id,'message:'+m.id,m));
    this.store.node(agent.session.id,text(summary),ids);
    this.store.saveHints(agent.session.id,[...p.candidates.values()].map(c=>({id:c.id,store_id:c.store_id,kind:c.kind,scores:c.scores,action:c.action,jev_unscored:c.jev_unscored})));
    // Actual freed tokens are measured after the durable surface replacement.
    p.metrics.values.lcm_summary_nodes_created=1;p.metrics.values.lcm_nodes_created=1;p.metrics.values.lcm_before_tokens=before;
    return {...result,summary};
  }
}
