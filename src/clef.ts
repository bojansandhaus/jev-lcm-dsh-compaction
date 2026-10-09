import { createHash } from 'node:crypto';
import { Questions, ProviderError } from './jev-client.js';

/**
 * Cloudflare Workers AI Clef, the hosted decision-model provider.
 *
 * Clef is not a Jev endpoint. It is a separate model Cloudflare serves from
 * Workers AI that answers the same typed questions, so under `clef` it
 * replaces the hosted pair for a profile rather than joining the fallback
 * chain by default.
 *
 * Three facts about this surface shape the code below, and each is a
 * documented limit rather than a choice:
 *
 *  - The endpoint is per account, so the account id is part of the URL and is
 *    configuration, not a credential. The token is the credential. Both are
 *    required and both are checked before any socket work.
 *  - Clef question ids may contain letters, digits, '_', '.' and '-' only, at
 *    most 100 characters, with at most 64 questions per request. This
 *    repository names its questions `<candidate id>:<question>`, so every
 *    real id contains a ':' and is therefore always remapped. Callers never
 *    see the remap: answers come back under the id they passed in.
 *  - Clef serves three answer types. `noul` is a probability under "noul",
 *    `choice` names one option of the question's criteria, and `score` is a
 *    position in the ordered criteria list rather than a probability. All
 *    three are validated by the repository's single typed-answer entry point
 *    in `parseAnswers`, not by a second rule here.
 */
export const CLEF_API_BASE='https://api.cloudflare.com/client/v4/accounts';
export const CLEF_TOKEN_ENV='CLOUDFLARE_API_TOKEN';
export const CLEF_ACCOUNT_ENV='CLOUDFLARE_ACCOUNT_ID';
export const CLEF_DEFAULT_MODEL='clef';
export const CLEF_MODELS=['clef','clef-flash'] as const;
/** Clef accepts at most 64 questions in one request. */
export const CLEF_MAX_QUESTIONS=64;
/** Clef accepts a question id of at most 100 characters. */
export const CLEF_MAX_ID_LENGTH=100;
const LEGAL_ID=/^[A-Za-z0-9_.-]+$/;

/** The Clef checkpoint: the 27B `clef`, or the 9B `clef-flash` for latency-bound paths. */
export function clef_checkpoint(value:string=CLEF_DEFAULT_MODEL):string {
  const model=(value??'').trim().toLowerCase();
  if(!(CLEF_MODELS as readonly string[]).includes(model))throw new Error('clef_model must be one of: '+CLEF_MODELS.join(', '));
  return model;
}

/** The run URL for one account and checkpoint. Throws when the account is unset. */
export function clefUrl(account:string,model:string=CLEF_DEFAULT_MODEL):string {
  const id=(account??'').trim();
  if(!id)throw new Error('clef is selected but '+CLEF_ACCOUNT_ENV+' is not set');
  if(/[^A-Za-z0-9]/.test(id))throw new Error('invalid '+CLEF_ACCOUNT_ENV);
  return CLEF_API_BASE+'/'+id+'/ai/run/@cf/cloudflare/'+clef_checkpoint(model);
}

/**
 * The message naming whichever Cloudflare variable is absent, or an empty
 * string when both are present. The variable name is returned, never a value.
 */
export function clef_credentials_error(env:Record<string,string|undefined>):string {
  // The token is named first because it is the credential; the account id is
  // configuration. Each missing value must name itself, whichever is absent.
  if(!(env[CLEF_TOKEN_ENV]??'').trim())return 'clef is selected but '+CLEF_TOKEN_ENV+' is not set';
  if(!(env[CLEF_ACCOUNT_ENV]??'').trim())return 'clef is selected but '+CLEF_ACCOUNT_ENV+' is not set';
  return '';
}

/**
 * Map every question id onto one Clef accepts, and keep the way back.
 *
 * An id that is already legal and unused is sent unchanged. Any other id is
 * rebuilt from legal characters and disambiguated with a short digest of the
 * original, so two ids that would otherwise collapse onto one legal id stay
 * distinct instead of merging their answers. `restore` maps a set of sent ids
 * back to the ids the caller passed, and `back` is the same map in the shape
 * the provider chain needs per request.
 */
export function sanitize_question_ids(questions:Questions):{sent:Questions;back:Record<string,string>;restore:(names:Set<string>)=>Set<string>} {
  const used=new Set<string>();
  const back:Record<string,string>={};
  const sent:Questions={};
  const put=(id:string,original:string)=>{used.add(id);back[id]=original;sent[id]=questions[original];};
  const disambiguate=(base:string,original:string)=>{
    const digest=createHash('sha256').update(original).digest('hex').slice(0,8);
    let id=base.slice(0,CLEF_MAX_ID_LENGTH-9)+'_'+digest;
    for(let n=2;used.has(id);n+=1)id=base.slice(0,CLEF_MAX_ID_LENGTH-3)+'_'+n;
    return id;
  };
  for(const original of Object.keys(questions)){
    if(LEGAL_ID.test(original)&&original.length<=CLEF_MAX_ID_LENGTH&&!used.has(original)){put(original,original);continue;}
    const base=original.replace(/[^A-Za-z0-9_.-]+/g,'_').replace(/^[^A-Za-z0-9]+/,'').replace(/[^A-Za-z0-9]+$/,'')||'q';
    const id=LEGAL_ID.test(base)&&base.length<=CLEF_MAX_ID_LENGTH&&!used.has(base)?base:disambiguate(base,original);
    put(id,original);
  }
  return {sent,back,restore:(names:Set<string>)=>new Set([...names].map(n=>back[n]).filter((n):n is string=>typeof n==='string'))};
}

/**
 * Split one caller's questions into requests Clef will accept: legal ids, and
 * at most 64 per request. Each part carries its own way back to the caller's
 * ids, so the chunking is invisible above this module.
 *
 * `onChunked` is called once, and only when the batch really did exceed
 * `CLEF_MAX_QUESTIONS`, with the request count and the question count. The
 * Python sibling refuses such a batch outright with `ClefError(...lower
 * jev_max_candidates_per_batch)`; this port chunks instead, which is the right
 * behaviour for the shipped path, and this callback is the diagnostic that
 * refusal used to carry. Without it the safeguard was silently dropped.
 */
export function clef_chunk(questions:Questions,onChunked?:(requests:number,questions:number)=>void):{questions:Questions;back:Record<string,string>}[] {
  const mapped=sanitize_question_ids(questions);
  const entries=Object.entries(mapped.sent);
  if(!entries.length)return [{questions:{},back:{}}];
  const parts:{questions:Questions;back:Record<string,string>}[]=[];
  for(let i=0;i<entries.length;i+=CLEF_MAX_QUESTIONS){
    const slice=entries.slice(i,i+CLEF_MAX_QUESTIONS);
    parts.push({questions:Object.fromEntries(slice),back:Object.fromEntries(slice.map(([sent])=>[sent,mapped.back[sent]]))});
  }
  if(parts.length>1)onChunked?.(parts.length,entries.length);
  return parts;
}

/**
 * Unwrap a Clef response and hand the answers to the shared validator.
 *
 * Cloudflare serves Clef from a REST endpoint that answers with the model
 * output directly, while the general API surface wraps results in a
 * `success`/`result` envelope. Both are accepted, top-level answers first. A
 * `success: false` envelope carries Cloudflare's own error codes, which say
 * more than a bare parse failure, so the codes are surfaced on the error
 * detail and the error messages are dropped: an upstream message can quote
 * the request.
 *
 * `success: false` is reported as `malformed`, which is not a configured
 * fallback trigger, so a rejected Clef answer raises instead of quietly
 * reaching for another classifier.
 */
export function clef_answers(data:unknown):unknown {
  if(!data||typeof data!=='object')throw new ProviderError('malformed','cloudflare returned an invalid response');
  const body=data as {answers?:unknown;success?:unknown;errors?:unknown;result?:unknown};
  if(body.success===false){
    const codes=(Array.isArray(body.errors)?body.errors:[]).filter(e=>e&&typeof e==='object'&&'code' in e).map(e=>String((e as {code:unknown}).code));
    throw new ProviderError('malformed','cloudflare request failed, code '+(codes.length?codes.join(', '):'unknown error'));
  }
  const isAnswers=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
  const inner=isAnswers(body.result)?body.result.answers:undefined;
  const answers=isAnswers(body.answers)?body.answers:isAnswers(inner)?inner:null;
  if(!answers)throw new ProviderError('malformed','cloudflare returned no answers');
  return {answers};
}
