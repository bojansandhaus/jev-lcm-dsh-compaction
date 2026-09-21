export interface Candidate {id:string;kind:'tool'|'anchor';message_index:number;text:string;start:number;end:number;store_id?:number;call?:unknown;scores:Record<string,number>;action:'unscored'|'keep'|'truncate'|'drop';jev_unscored:boolean;}
export interface Message {role:string;content:unknown;tool_calls?:{id:string;function:{name:string;arguments:string}}[];tool_call_id?:string;store_id?:number;}
export function extract(text:string,patterns:string[]):{start:number;end:number;text:string}[]{
  const spans=new Map<string,{start:number;end:number;text:string}>();
  for(const pattern of patterns)for(const match of text.matchAll(new RegExp(pattern,'g')))if(match[0].length){const start=match.index;spans.set(`${start}:${start+match[0].length}`,{start,end:start+match[0].length,text:match[0]});}
  return [...spans.values()].sort((a,b)=>a.start-b.start||a.end-b.end);
}
