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
// The vocabulary of the reason-sentence pre-test, derived from the pattern it
// guards rather than hard-coded beside it.
//
// The previous form was `const _REASON_TRIGGER=/root cause|because|constraint/i`
// — three of the shipped pattern's six terms. `must`, `never` and `always` were
// therefore absent from the guard, so the guard skipped the pattern on text
// whose only trigger was one of them, and every such sentence was silently
// dropped before candidate generation. Verified on the shipped pattern list:
//
//   'We must pin the dependency before the release.'  raw regex 1 span, extract() 0
//   'You never bypass the approval gate.'             raw regex 1 span, extract() 0
//   'The service always validates input.'             raw regex 1 span, extract() 0
//
// `needsReasonTrigger` compounded it: it asked for two specific substrings
// (`root cause` AND `because`) to decide the pattern was reason-shaped, so an
// operator-supplied pattern that shared the shape without those two words lost
// the guard entirely — the 49-second pathological case, reachable from the
// documented `jev_anchor_patterns` setting. Reading the alternation out of the
// pattern makes both the guard and its applicability a property of the pattern,
// so neither can drift again.
//
// The third defect was case. The guard matched case-insensitively, the pattern
// was compiled with `g` only, so 'Because the cache is cold, the call is slow.'
// passed the guard and was then missed by the pattern. Reason text is prose, so
// its trigger word's case depends on where it falls in the sentence; the
// reason-sentence pattern is now the one pattern compiled case-insensitively.
function reasonTriggers(pattern:string):string[]{
  // Case-SENSITIVE, and that matters. `settings.ts` also ships
  // `\b[A-Z_]{2,}_(?:KEY|TOKEN|SECRET|URL|PATH|ID)\b`, whose alternation is
  // just as well formed. An `/i` detector classified that as reason-shaped too
  // and recompiled it case-insensitively, which began matching `superscret_key`
  // — the exact silent widening this fix exists to avoid. Requiring lowercase
  // words keeps the credential pattern out. A pattern whose author writes its
  // triggers in capitals fails the test and simply is not treated as a reason
  // pattern, which costs it the guard but never changes what it matches: the
  // conservative direction.
  const group=pattern.match(/\(\?:((?:[a-z][a-z ]*\|)+[a-z][a-z ]*)\)/);
  if(!group)return [];
  return group[1].split('|').map(term=>term.trim().toLowerCase()).filter(Boolean);
}
type Entry={pattern:RegExp;trigger:RegExp|null};
const _cache=new Map<string,Entry>();
function compiled(pattern:string):Entry{
  const hit=_cache.get(pattern);
  if(hit)return hit;
  // Reason sentences are prose, so the trigger word's case depends on where it
  // falls in the sentence. Only the reason-sentence pattern is compiled
  // case-insensitively; forcing every pattern to `gi` would widen what the
  // identifier and credential patterns match, which is a behaviour change this
  // fix has no business making. `reasonTriggers` is what keeps the two apart,
  // and its case-sensitivity is the mechanism — see the note there.
  const triggers=reasonTriggers(pattern);
  const reason=triggers.length>0;
  const entry:Entry={
    pattern:new RegExp(pattern,reason?'gi':'g'),
    trigger:reason?new RegExp(`(?:${triggers.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})`,'i'):null,
  };
  _cache.set(pattern,entry);
  return entry;
}
export function extract(text:string,patterns:string[]):{start:number;end:number;text:string}[]{
  const spans=new Map<string,{start:number;end:number;text:string}>();
  for(const pattern of patterns){
    const {pattern:re,trigger}=compiled(pattern);
    // A literal scan that no trigger word is present is far cheaper than
    // running the pattern. It is also now provably complete: the vocabulary is
    // the pattern's own alternation, so no trigger can be missing from it.
    if(trigger&&!trigger.test(text))continue;
    re.lastIndex=0;
    for(const match of text.matchAll(re))if(match[0].length){const start=match.index!;spans.set(`${start}:${start+match[0].length}`,{start,end:start+match[0].length,text:match[0]});}
  }
  return [...spans.values()].sort((a,b)=>a.start-b.start||a.end-b.end);
}
