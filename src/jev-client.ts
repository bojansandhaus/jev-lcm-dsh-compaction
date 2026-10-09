export class ProviderError extends Error {
  /**
   * `reason` is the fallback category the chain switches on and must stay one
   * of the known reasons. `detail` carries provider-side context that is safe
   * to surface: a canonical error code, never an upstream message and never
   * reviewed content. It is not a fallback trigger, because a provider's own
   * codes are not comparable across providers.
   */
  constructor(readonly reason:string,readonly detail=''){super(['transport_error','timeout','401','403','429','5xx','http_error','malformed','disabled','cooldown'].includes(reason)?reason:'transport_error');this.reason=this.message;}
  /** reason plus detail, for a diagnostic or an operator-facing error. */
  get message_with_detail():string{return this.detail?this.reason+': '+this.detail:this.reason;}
}
/**
 * One question and, for the answer types that are not a bare probability, the
 * options it may answer with.
 *
 * `noul` is the probability rule this repository already used everywhere.
 * `choice` takes a keyed criteria map and answers with one of its keys.
 * `score` takes an ordered criteria list and answers with a position in it,
 * which is why only that type carries an ordered list rather than a map.
 */
export type Question=
  |{type:'noul';instructions:string;criteria?:Record<string,string>|string[]}
  |{type:'choice';instructions:string;criteria:Record<string,string>}
  |{type:'score';instructions:string;criteria:string[]};
export type Questions=Record<string,Question>;
export type Scores=Record<string,number>;
/**
 * One request to one provider.
 *
 * `signal` is optional and is the caller's own cancellation, so a compaction
 * that the caller aborts reaches the socket instead of only being noticed after
 * `timeout` seconds. The provider-server timeout is merged onto whatever signal
 * arrives, so neither side can be cancelled by the other's settings.
 */
export type Transport=(url:string,key:string,payload:unknown,timeout:number,signal?:AbortSignal)=>Promise<unknown>;
/** The probability a `noul` answer carries, and the only direct rule for it. */
function probability(value:unknown):number|null{
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)return null;
  return value;
}
/**
 * One answer into the single number this repository ranks on.
 *
 * This is the only place a provider answer becomes a score, so every provider
 * is held to the same rule and none can bypass it. `noul` answers with a
 * probability under `noul`. `choice` names one option of the question's
 * criteria and is scored from the probabilities Cloudflare returns for that
 * option, so an option Clef assigned no mass scores 0 instead of fabricating
 * one. `score` answers with a position in the ordered criteria list, not a
 * probability, and is normalised onto 0..1 by that list's length; the
 * probabilities of the mass at that position are preferred when present,
 * which is what keeps a `score` answer on the scale its own criteria define.
 *
 * Anything else is malformed. No question, no answer, an unknown choice, an
 * out-of-range index, or a probability outside 0..1 produces a fabricated
 * score.
 */
/** The assumption for a caller that passes no question: the probability rule. */
const NO_QUESTION:Question={type:'noul',instructions:''};
export function typed_score(answer:unknown,question:Question):number|null{
  if(!answer||typeof answer!=='object'||Array.isArray(answer))return null;
  const a=answer as Record<string,unknown>;
  if(question.type==='noul')return probability(a.noul);
  if(question.type==='choice'){
    const options=Object.keys(question.criteria);
    if(typeof a.choice!=='string'||!Object.prototype.hasOwnProperty.call(question.criteria,a.choice))return null;
    // Cloudflare documents `probabilities` as required on a choice answer, and a
    // bare `choice` with no distribution behind it carries no calibrated weight.
    // Refusing it keeps a decision from resting on an invented uniform guess.
    const weights=probabilityMap(a.probabilities,options.length);
    if(!weights)return null;
    return weights[options.indexOf(a.choice)]??0;
  }
  const list=question.criteria;
  if(!list.length)return null;
  const index=a.score;
  if(typeof index!=='number'||!Number.isInteger(index)||index<0||index>=list.length)return null;
  const weights=probabilityMap(a.probabilities,list.length);
  if(weights)return weights[index]??0;
  // A single point scale has no position to separate, so it reports the
  // midpoint rather than 0 for its only legitimate answer.
  return list.length===1?.5:index/(list.length-1);
}
/** A Clef `probabilities` block, which is keyed for `choice` and positional for `score`. */
function probabilityMap(value:unknown,size:number):number[]|null{
  // A Clef `probabilities` block is keyed by option name for `choice` and
  // positional for `score`, so both an object and an array are legitimate.
  // The array case used to be unreachable: the `Array.isArray` guard returned
  // null before the branch below could run.
  if(!value||typeof value!=='object')return null;
  const entries=Array.isArray(value)?value.map((v,i)=>[String(i),v] as const):Object.entries(value as Record<string,unknown>);
  if(!entries.length)return null;
  const out=new Array<number>(size).fill(0);
  for(const [key,raw] of entries){const i=Array.isArray(value)?Number(key):indexOfKey(value as Record<string,unknown>,key);const p=probability(raw);if(p===null||i===null||i<0||i>=size)return null;out[i]=p;}
  return out;
}
function indexOfKey(map:Record<string,unknown>,key:string):number|null{
  const keys=Object.keys(map);const i=keys.indexOf(key);return i<0?null:i;
}
/** The answers a caller asked for, split into what was readable and what was not. */
export interface ParsedAnswers {scores:Scores;malformedIds:string[];}
/**
 * Every answer the caller asked for, in the caller's own spelling.
 *
 * A payload with no answers mapping at all is a malformed response and throws:
 * nothing about it is readable. Individual answers are per-id results instead,
 * so one row that is out of range, missing, or off the 0..1 scale no longer
 * discards every other score the provider returned with it. The malformed ids
 * come back beside the scores, and the caller records and retains what it has.
 */
export function parseAnswers(data:unknown,names:string[],questions?:Questions):ParsedAnswers {
  if (!data || typeof data!=='object' || !('answers' in data) || !data.answers || typeof data.answers!=='object') throw new ProviderError('malformed');
  const answers=data.answers as Record<string,unknown>;
  const out:Scores={};const malformedIds:string[]=[];
  for(const n of names){const score=typed_score(answers[n],questions?.[n]??NO_QUESTION);if(score===null){malformedIds.push(n);continue;}out[n]=score;}
  return {scores:out,malformedIds};
}
export const post:Transport=async(url,key,payload,timeout,signal)=>{
  try {
    // A keyless provider bound to loopback carries no credential, so the header
    // is omitted entirely rather than sent empty.
    const headers:Record<string,string>={'Content-Type':'application/json'};
    if(key)headers.Authorization='Bearer '+key;
    const response=await fetch(url,{method:'POST',redirect:'error',headers,body:JSON.stringify(payload),signal:AbortSignal.any([AbortSignal.timeout(timeout*1000),...signal?[signal]:[]])});
    if(!response.ok)throw new ProviderError([401,403,429].includes(response.status)?String(response.status):response.status>=500?'5xx':'http_error');
    const text=await response.text();if(text.length>2000000)throw new ProviderError('malformed');
    try{return JSON.parse(text);}catch{throw new ProviderError('malformed');}
  }catch(error){if(error instanceof ProviderError)throw error;throw new ProviderError(error instanceof Error && error.name==='TimeoutError'?'timeout':'transport_error');}
};
