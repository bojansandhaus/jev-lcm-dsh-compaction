export interface Candidate {id:string;kind:'tool'|'anchor';message_index:number;text:string;start:number;end:number;store_id?:number;call?:unknown;scores:Record<string,number>;action:'unscored'|'keep'|'truncate'|'drop';jev_unscored:boolean;}
export interface Message {role:string;content:unknown;tool_calls?:{id:string;function:{name:string;arguments:string}}[];tool_call_id?:string;store_id?:number;}
// `extract` runs over every assistant message on every turn, so a pattern's
// cost is multiplied by the whole backlog. Two guards, both measured on Node's
// V8 engine at a 64 KB input:
//
//   - The reason-sentence pattern is bounded to a 400-character window either
//     side of its trigger word. Its previous form was unbounded, so on text with
//     no sentence terminator (minified JSON, base64, a long path) the engine
//     retried the greedy prefix from every offset: 4.6 seconds for one message.
//     Bounded, the same input takes 118 ms.
//   - `_REASON_TRIGGER` rejects the pattern outright when its trigger words are
//     absent, which is the case that was pathological and the common one. That
//     drops the same input to under a millisecond, and costs one cheap literal
//     scan when the pattern is relevant.
//
// Compiled regexes are cached per pattern. The previous implementation built a
// fresh RegExp inside the loop, once per pattern per message, and `settings.ts`
// validated every pattern and discarded the result.
const _REASON_TRIGGER=/root cause|because|constraint/i;
const _compiledCache=new Map<string,RegExp>();
function needsReasonTrigger(pattern:string):boolean{
  return pattern.includes('root cause')&&pattern.includes('because');
}
function compiled(pattern:string):RegExp{
  const cached=_compiledCache.get(pattern);
  if(cached)return cached;
  const built=new RegExp(pattern,'g');
  _compiledCache.set(pattern,built);
  return built;
}
export function extract(text:string,patterns:string[]):{start:number;end:number;text:string}[]{
  const spans=new Map<string,{start:number;end:number;text:string}>();
  for(const pattern of patterns){
    if(needsReasonTrigger(pattern)&&!_REASON_TRIGGER.test(text))continue;
    const re=compiled(pattern);
    re.lastIndex=0;
    for(const match of text.matchAll(re))if(match[0].length){const start=match.index!;spans.set(`${start}:${start+match[0].length}`,{start,end:start+match[0].length,text:match[0]});}
  }
  return [...spans.values()].sort((a,b)=>a.start-b.start||a.end-b.end);
}
