export class Metrics {
  values:Record<string,number|string|boolean|null>={jev_candidates_total:0,jev_keep_call_count:0,jev_keep_result_count:0,jev_anchor_count:0,jev_unscored_count:0,jev_calls:0,jev_pruned_units:0,jev_fallbacks:0,lcm_summary_nodes_created:0,lcm_nodes_created:0,lcm_text_floor_tokens:0,jev_provider_fallback_count:0,jev_threshold_current:.15,jev_threshold_calibrated:false,jev_provider_primary:'',lcm_recall_at_budget:null,lcm_freed_per_compaction:0};low=0;
  constructor(readonly log:(s:string)=>void=()=>{}){}
  compaction(before:number,after:number,nodes:number,floor:number){const freed=before?100*(before-after)/before:0;Object.assign(this.values,{lcm_freed_per_compaction:freed,lcm_summary_nodes_created:nodes,lcm_nodes_created:nodes,lcm_text_floor_tokens:floor});this.low=freed<20?this.low+1:0;if(this.low>=3)this.log('LCM freed less than 20 percent for three consecutive compactions; consider a higher lcm_context_threshold or deeper summaries within the model window');}
}
