import { Context } from '@deepseek-ai/cordis';import z from '@deepseek-ai/schemastery';
import type {} from '@deepseek-ai/dsh-tools';
import { JevLCMCompactionEngine,EngineConfig } from './compressor.js';
import { probeProviders } from './providers.js';
import type { Prepass } from './prepass.js';
export { JevLCMCompactionEngine } from './compressor.js';export { JevThresholdCalibrator } from './calibration.js';
export const name='jev-lcm-compaction';export const inject=['llm','tokenMeter','sessions','tools'];
/**
 * The plugin's own configuration surface.
 *
 * `jev` is typed inline rather than `z.any()`. `any` accepts the whole settings
 * blob, so a value of the wrong type — a string budget, a boolean mode, a
 * string where the anchor patterns belong — surfaced from inside `settings()`
 * on a later turn rather than from the configuration that carried it. Deep
 * validation still belongs to `settings()` and still happens there: it is the
 * single place the mode aliases, the endpoint shapes and the budget ranges
 * live, and it resolves every default. This schema only pins each key's shape,
 * so a mistake is reported at load, where it was written.
 *
 * The two array-valued keys (`jev_anchor_patterns`, `jev_fallback_order`) stay
 * `any()`: this schema library fills an unset `z.array(...)` key with `[]`,
 * which would wipe the shipped non-empty defaults in `settings()`. They keep
 * their validation there instead.
 */
const JEV_CONFIG=z.object({
  jev_provider:z.string(),api_provider:z.string(),
  typesafe_base_url:z.string(),openrouter_base_url:z.string(),openrouter_endpoint_path:z.string(),
  jev_endpoint_path:z.string(),jev_model:z.string(),openrouter_model:z.string(),
  laya_base_url:z.string(),laya_endpoint_path:z.string(),local_model:z.string(),laya_model:z.string(),clef_model:z.string(),
  jev_fallback_enabled:z.boolean(),jev_fallback_cooldown_s:z.number(),jev_fallback_max_retries:z.number(),
  request_timeout_s:z.number(),keep_threshold:z.number(),keep_threshold_max:z.number(),min_keep_rate:z.number(),
  jev_calibration_enabled:z.boolean(),jev_calibration_window:z.number(),jev_calibration_min_samples:z.number(),
  conservative:z.boolean(),jev_anchor_protection_enabled:z.boolean(),jev_batch_window_turns:z.number(),
  jev_max_candidates_per_batch:z.number(),jev_urgent_context_ratio:z.number(),max_state_tokens:z.number(),
  max_request_tokens:z.number(),truncate_head_chars:z.number(),min_result_chars:z.number(),
  hint_budget_tokens:z.number(),lcm_rollup_fan_in:z.number(),
  jev_fallback_order:z.any(),jev_fallback_on:z.any(),jev_anchor_patterns:z.any(),
});
export const Config=z.object({databasePath:z.string().default('jev-lcm.sqlite'),thresholdRatio:z.number().default(.8),retainRatio:z.number().default(.16),maxTokens:z.number().default(8192),auto:z.boolean().default(true),jev:JEV_CONFIG});
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
