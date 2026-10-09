import { Candidate,Message } from './anchors.js';import { Settings } from './settings.js';import { Questions } from './jev-client.js';import { questions } from './decisions.js';

/**
 * The wire size of one value, in UTF-8 bytes.
 *
 * The Python sibling's `tokens()` is `len(wire(value).encode("utf-8"))` and
 * documents UTF-8 bytes as a conservative upper bound on byte-based BPE tokens:
 * the wire form spends a byte on every structural character the model does not
 * see as text, so this over-counts ASCII by roughly four times and never
 * under-counts. It is an estimate with a measured factor, not a token count —
 * `tests/state-shaper.test.ts` pins that factor against a real tokenizer on a
 * known sample rather than assuming it, so the budget it feeds stays a bound.
 */
export function bytes(value:unknown):number{return Buffer.byteLength(JSON.stringify(value),'utf8');}
/** The state the provider is asked about. `folded` records a history fold. */
export interface ShapedState {history:Message[];candidates:unknown[];folded:boolean;}
export interface Shaped {state:ShapedState;questions:Questions;selected:Candidate[];tier:number;window:[number,number];}
export function shape(messages:Message[],candidates:Candidate[],s:Settings):Shaped{
  let state:{history:Message[];candidates:unknown[];folded:boolean}={history:[],candidates:[],folded:false},tier=0;
  for(tier=0;tier<5;tier+=1){
    const history:Message[]=structuredClone(messages);
    for(const m of history){if(tier&&m.role==='tool')m.content=String(m.content).slice(0,[s.truncate_head_chars,50,0,0][tier-1])+' [result omitted; raw evidence retained]';else if(tier>=2)m.content=String(m.content).replace(/\s+/g,' ').slice(0,tier===2?200:60);for(const c of m.tool_calls??[])if(tier)c.function.arguments=c.function.arguments.slice(0,[1000,200,60,30][tier-1]);}
    state={history,candidates:[],folded:false};
    if(bytes(state)<=s.max_state_tokens)break;
  }
  // The retained window is the whole message list until a fold narrows it.
  let window:[number,number]=[0,messages.length];
  if(bytes(state)>s.max_state_tokens){
    const kept:Message[]=[];for(const m of [...state.history].reverse()){if(bytes({history:[m,...kept],candidates:[],folded:true})>s.max_state_tokens/2)break;kept.unshift(m);}
    // The fold walks the history backwards and keeps a contiguous suffix, so
    // what the model still sees is the tail of the message list. A candidate
    // whose `message_index` falls below that suffix is ranked against evidence
    // the model no longer has: its own text ships verbatim, so the ranking
    // would rest on a span whose surrounding context was dropped. The flag
    // travels on the state, exactly as it does in the Python sibling, and the
    // caller leaves such a candidate unscored and counts it.
    state={history:kept,candidates:[],folded:true};
    window=[Math.max(0,messages.length-kept.length),messages.length];
  }
  let qs:Questions={};const selected:Candidate[]=[];
  for(const c of candidates.slice(0,s.jev_max_candidates_per_batch)){
    const trial={history:state.history,candidates:[...state.candidates,{id:c.id,kind:c.kind,text:c.text,call:c.call??{}}],folded:state.folded},q={...qs,...questions(c)};
    if(bytes(trial)>s.max_state_tokens||bytes({model:s.openrouter_model,state:trial,questions:q})>s.max_request_tokens)continue;
    state=trial;qs=q;selected.push(c);
  }
  return {state,questions:qs,selected,tier:Math.min(tier,4),window};
}
