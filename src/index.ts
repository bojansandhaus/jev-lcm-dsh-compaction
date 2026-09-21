import { Context } from '@deepseek-ai/cordis';import z from '@deepseek-ai/schemastery';
import type {} from '@deepseek-ai/dsh-tools';
import { JevLCMCompactionEngine,EngineConfig } from './compressor.js';
import { probeProviders } from './providers.js';
import type { Prepass } from './prepass.js';
export { JevLCMCompactionEngine } from './compressor.js';export { JevThresholdCalibrator } from './calibration.js';
export const name='jev-lcm-compaction';export const inject=['llm','tokenMeter','sessions','tools'];
export const Config=z.object({databasePath:z.string().default('jev-lcm.sqlite'),thresholdRatio:z.number().default(.8),retainRatio:z.number().default(.16),maxTokens:z.number().default(8192),auto:z.boolean().default(true),jev:z.any()});
export function apply(ctx:Context,config:EngineConfig){
  const engine=new JevLCMCompactionEngine(ctx,config);
  const calibrate=async(p:Prepass,dryRun:boolean)=>{
    const summary={threshold:p.calibrator.current,calibrated:p.calibrator.calibrated,samples:p.calibrator.samples.length,metrics:p.metrics.values};
    if(!dryRun)return summary;
    return {...summary,dry_run:await probeProviders(p.chain.config,process.env,p.chain.transport,p.chain.clock,p.chain.log)};
  };
  for(const name of ['lcm_grep','lcm_expand','lcm_nodes','jev_stats','jev_providers','jev_scores','jev_anchors','jev_calibrate'])ctx.effect(()=>ctx.tools.register({name,description:'Session-scoped LCM evidence and Jev diagnostics. jev_calibrate reports the live threshold, and with dry_run it sends one synthetic probe per configured provider and reports latency and status.',parameters:{type:'object',properties:{query:{type:'string'},store_id:{type:'integer'},dry_run:{type:'boolean'}},additionalProperties:false},output:{schema:{},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},execute:async(args,exec)=>{
    if(!exec.agent)throw new Error('active session required');const session=exec.agent.session.id;const p=engine.state(session);const a=args as {query?:string;store_id?:number;dry_run?:boolean};
    if(name==='lcm_grep')return engine.store.grep(session,a.query??'');
    if(name==='lcm_expand')return engine.store.expand(session,a.store_id??0);
    if(name==='lcm_nodes')return engine.store.nodes(session);
    if(name==='jev_stats')return p.metrics.values;
    if(name==='jev_providers')return p.chain.diagnostics();
    if(name==='jev_calibrate')return calibrate(p,Boolean(a.dry_run));
    return [...p.candidates.values()].filter(c=>name!=='jev_anchors'||c.kind==='anchor').map(c=>({id:c.id,store_id:c.store_id,kind:c.kind,scores:c.scores,action:c.action,jev_unscored:c.jev_unscored}));
  }}));
}
